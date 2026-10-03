#!/usr/bin/env bash
# Requires macOS, Xcode 26.6 and `npm ci --include=optional` in the repository.
# Produces a compiled, unsigned device IPA; personal signing is a separate step.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$project_root"

if [[ "$(uname -s)" != Darwin ]]; then
  printf '%s\n' 'iPhone compilation requires macOS and Xcode. Use the manual GitHub Actions workflow.' >&2
  exit 1
fi
for tool in node npm python3 xcodebuild xcrun plutil ditto zip unzip shasum; do
  command -v "$tool" >/dev/null || { printf 'Missing build tool: %s\n' "$tool" >&2; exit 1; }
done
required_xcode="${SHIRI_XCODE_VERSION:-26.6}"
actual_xcode="$(xcodebuild -version | awk 'NR == 1 {print $2}')"
[[ "$actual_xcode" == "$required_xcode" ]] || {
  printf 'Expected Xcode %s, found %s. Set DEVELOPER_DIR to the pinned Xcode installation.\n' "$required_xcode" "$actual_xcode" >&2
  exit 1
}
[[ -f node_modules/@capacitor/cli/package.json ]] || { printf '%s\n' 'Run npm ci --include=optional before this script.' >&2; exit 1; }

artifact_dir="$project_root/ios/App/output"
mkdir -p "$artifact_dir" "$project_root/ios/App/build"
# A new derived-data and Payload directory on each run avoids stale app contents.
work_dir="$(mktemp -d "$project_root/ios/App/build/unsigned.XXXXXX")"
derived_dir="$work_dir/DerivedData"
package_dir="$work_dir/SourcePackages"
project_file="$project_root/ios/App/App.xcodeproj"
app_version="$(node -p "require('./package.json').version")"
[[ "$app_version" =~ ^[0-9A-Za-z.+-]+$ ]] || { printf '%s\n' 'Invalid app version.' >&2; exit 1; }
build_number="${GITHUB_RUN_NUMBER:-1}"
[[ "$build_number" =~ ^[1-9][0-9]*$ ]] || { printf '%s\n' 'Invalid iOS build number.' >&2; exit 1; }
ipa_name="Shiri-${app_version}-unsigned-iphoneos-arm64.ipa"

{
  xcodebuild -version
  xcrun --sdk iphoneos --show-sdk-version
  node --version
  npm --version
} > "$artifact_dir/toolchain.log"

npm run icons -- --ios-only
node --test tests/ios-package.test.cjs
npm test
npm run build
npx --no-install cap sync ios

plutil -lint ios/App/App/Info.plist ios/App/App/PrivacyInfo.xcprivacy ios/App/App.xcodeproj/project.pbxproj
python3 - <<'PY'
import json
import pathlib
import plistlib
import re
import struct
import xml.etree.ElementTree as ET

root = pathlib.Path.cwd()
scheme = root / 'ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme'
refs = ET.parse(scheme).findall('.//BuildableReference')
assert refs and all(ref.get('BlueprintIdentifier') == '504EC3031FED79650016851F' for ref in refs), 'Shared scheme targets the wrong application'
plistlib.loads((root / 'ios/App/App/Info.plist').read_bytes())
privacy = plistlib.loads((root / 'ios/App/App/PrivacyInfo.xcprivacy').read_bytes())
assert any(api.get('NSPrivacyAccessedAPIType') == 'NSPrivacyAccessedAPICategoryUserDefaults' and 'CA92.1' in api.get('NSPrivacyAccessedAPITypeReasons', []) for api in privacy.get('NSPrivacyAccessedAPITypes', [])), 'Missing Preferences privacy reason'
icons = root / 'ios/App/App/Assets.xcassets/AppIcon.appiconset'
icon_config = json.loads((icons / 'Contents.json').read_text())
entry = next(item for item in icon_config['images'] if item.get('size') == '1024x1024')
png = (icons / entry['filename']).read_bytes()
assert png[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', png[16:24]) == (1024, 1024), 'Invalid 1024px app icon'
assert png[25] == 2, 'App icon must be RGB without an alpha channel'
spm = root / 'ios/App/CapApp-SPM/Package.swift'
source = spm.read_text()
expected = json.loads((root / 'package.json').read_text())['dependencies']['@capacitor/ios']
assert 'exact: "' + expected + '"' in source, 'Capacitor SPM version does not match the npm lock'
for relative in re.findall(r'\.package\(name:\s*"[^"]+",\s*path:\s*"([^"]+)"', source):
    assert (spm.parent / relative / 'Package.swift').is_file(), 'Missing local SPM plugin: ' + relative
assert (root / 'ios/App/App/public/index.html').is_file(), 'Capacitor web assets were not copied'
print('iOS source, scheme, plugin, icon and privacy preflight passed.')
PY

xcodebuild -resolvePackageDependencies \
  -project "$project_file" \
  -scheme App \
  -clonedSourcePackagesDirPath "$package_dir" \
  | tee "$artifact_dir/package-resolution.log"

xcodebuild build \
  -project "$project_file" \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$derived_dir" \
  -clonedSourcePackagesDirPath "$package_dir" \
  -disableAutomaticPackageResolution \
  -resultBundlePath "$work_dir/build.xcresult" \
  ARCHS=arm64 \
  MARKETING_VERSION="$app_version" \
  CURRENT_PROJECT_VERSION="$build_number" \
  ONLY_ACTIVE_ARCH=NO \
  SUPPORTED_PLATFORMS=iphoneos \
  SUPPORTS_MACCATALYST=NO \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  DEVELOPMENT_TEAM= \
  PROVISIONING_PROFILE_SPECIFIER= \
  COMPILER_INDEX_STORE_ENABLE=NO \
  | tee "$artifact_dir/xcodebuild.log"

app_bundle="$derived_dir/Build/Products/Release-iphoneos/App.app"
[[ -d "$app_bundle" ]] || { printf '%s\n' 'xcodebuild did not produce the expected iPhone App.app.' >&2; exit 1; }
# This inspects the real Mach-O load commands. An arm64 simulator binary fails.
node tests/ios-package.test.cjs --verify-app "$app_bundle" > "$artifact_dir/BUILD-INFO.json"

mkdir -p "$work_dir/Payload"
ditto "$app_bundle" "$work_dir/Payload/App.app"
(
  cd "$work_dir"
  COPYFILE_DISABLE=1 zip -q -r "$ipa_name" Payload
  unzip -tq "$ipa_name"
  unzip -Z1 "$ipa_name" | grep -Fx 'Payload/App.app/App' >/dev/null
)
mv -f "$work_dir/$ipa_name" "$artifact_dir/$ipa_name"
(
  cd "$artifact_dir"
  shasum -a 256 "$ipa_name" > SHA256SUMS.txt
)
cat > "$artifact_dir/INSTALL-READ-ME.txt" <<'README'
拾日 iPhone 编译包 / UNSIGNED — NEEDS PERSONAL SIGNING

此 IPA 包含通过 Xcode 编译的 arm64 iPhoneOS 应用，不是模拟器包。
它尚未签名，不能直接安装到 iPhone，也不能直接上传 TestFlight 或 App Store。
请在自己的设备上，使用支持个人签名的安装工具与自己的 Apple 账号完成签名。
本次云构建没有使用或保存 Apple 密码、证书和描述文件。

BUILD-INFO.json 记录了主程序 Mach-O 平台、架构和 SHA256；SHA256SUMS.txt 校验 IPA。
GitHub Actions 下载附件保留 3 天，请及时下载。
README
printf 'Compiled and verified: %s\n' "$artifact_dir/$ipa_name"
