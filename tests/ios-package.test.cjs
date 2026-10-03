'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/** Read the compiled binary rather than trusting its filename or CPU alone. */
function inspectDeviceExecutable(buffer) {
  assert.ok(buffer.length >= 32, 'Executable is missing or truncated');
  assert.equal(buffer.readUInt32LE(0), 0xfeedfacf, 'Expected a thin 64-bit Mach-O executable');
  assert.equal(buffer.readUInt32LE(4), 0x0100000c, 'Expected arm64 CPU architecture');
  assert.equal(buffer.readUInt32LE(12), 2, 'Mach-O must be an executable, not an object file or library');
  const commands = buffer.readUInt32LE(16);
  const commandBytes = buffer.readUInt32LE(20);
  const end = 32 + commandBytes;
  assert.ok(commands > 0 && commands <= 4096 && end <= buffer.length, 'Invalid Mach-O load command table');
  let offset = 32;
  let platform;
  for (let index = 0; index < commands; index++) {
    assert.ok(offset + 8 <= end, 'Truncated Mach-O load command');
    const command = buffer.readUInt32LE(offset);
    const size = buffer.readUInt32LE(offset + 4);
    assert.ok(size >= 8 && offset + size <= end, 'Invalid Mach-O load command size');
    if (command === 0x32) { // LC_BUILD_VERSION
      assert.ok(size >= 24, 'Truncated LC_BUILD_VERSION command');
      assert.equal(platform, undefined, 'Multiple platform commands are not supported');
      platform = buffer.readUInt32LE(offset + 8);
    }
    offset += size;
  }
  assert.equal(offset, end, 'Mach-O load command length mismatch');
  assert.equal(platform, 2, 'Expected iPhoneOS device platform; simulator or non-iOS binaries are not installable on iPhone');
  return { architecture: 'arm64', format: 'Mach-O 64-bit executable', platform: 'iPhoneOS', platformId: platform };
}

function verifyBundleVersion(info) {
  const expected = JSON.parse(read('package.json')).version;
  assert.equal(info.CFBundleShortVersionString, expected, 'Compiled bundle version must match package.json');
}

function verifyCompiledApp(directory) {
  const bundle = path.resolve(directory);
  assert.ok(bundle.endsWith('.app') && fs.statSync(bundle).isDirectory(), 'Expected a compiled .app bundle');
  const plist = (name) => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, name)], { encoding: 'utf8' }));
  const info = plist('Info.plist');
  assert.equal(info.CFBundlePackageType, 'APPL');
  verifyBundleVersion(info);
  assert.equal(info.CFBundleIdentifier, 'app.shiri.calendar');
  assert.equal(info.DTPlatformName, 'iphoneos');
  assert.deepEqual(info.CFBundleSupportedPlatforms, ['iPhoneOS']);
  assert.ok(Array.isArray(info.UIDeviceFamily) && info.UIDeviceFamily.includes(1), 'Bundle does not support iPhone');
  assert.ok(typeof info.CFBundleExecutable === 'string' && /^[A-Za-z0-9_.-]+$/.test(info.CFBundleExecutable), 'Invalid bundle executable name');
  const executable = path.join(bundle, info.CFBundleExecutable);
  const stats = fs.statSync(executable);
  assert.ok(stats.isFile() && (stats.mode & 0o111) !== 0, 'Compiled executable is missing or is not executable');
  const binary = fs.readFileSync(executable);
  const macho = inspectDeviceExecutable(binary);
  assert.ok(fs.statSync(path.join(bundle, 'Assets.car')).size > 0, 'Compiled icon asset catalog is missing');
  const privacy = plist('PrivacyInfo.xcprivacy');
  assert.ok(privacy.NSPrivacyAccessedAPITypes.some((api) => api.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategoryUserDefaults' && api.NSPrivacyAccessedAPITypeReasons.includes('CA92.1')), 'Compiled bundle is missing the Preferences privacy declaration');
  const publicDirectory = path.join(bundle, 'public');
  const html = fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)].map((match) => match[1]);
  assert.ok(assets.some((name) => name.endsWith('.js')), 'Bundled frontend entry is missing');
  for (const name of assets) {
    const file = path.resolve(publicDirectory, name);
    assert.ok(file.startsWith(publicDirectory + path.sep), 'Asset escapes bundle public directory');
    assert.ok(fs.statSync(file).size > 0, `Missing bundled web asset: ${name}`);
  }
  return {
    ...macho,
    bundleId: info.CFBundleIdentifier,
    displayName: info.CFBundleDisplayName,
    version: info.CFBundleShortVersionString,
    build: info.CFBundleVersion,
    executable: info.CFBundleExecutable,
    executableBytes: binary.length,
    executableSha256: crypto.createHash('sha256').update(binary).digest('hex'),
    sourceCommit: process.env.GITHUB_SHA || null,
    xcode: execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim(),
    node: process.version,
    assets,
    signing: 'Unsigned build. Personal signing is required before installation.',
    verifiedAt: new Date().toISOString(),
  };
}

module.exports = { inspectDeviceExecutable, verifyBundleVersion, verifyCompiledApp };

if (require.main === module && process.argv[2] === '--verify-app') {
  try {
    assert.ok(process.argv[3], 'Provide the compiled .app path');
    console.log(JSON.stringify(verifyCompiledApp(process.argv[3]), null, 2));
  } catch (error) {
    console.error(`iPhone package verification failed: ${error.message}`);
    process.exitCode = 1;
  }
} else if (require.main === module) {
  const { test } = require('node:test');
  const yaml = require('js-yaml');

  function executableFixture(platform = 2) {
    const buffer = Buffer.alloc(56);
    buffer.writeUInt32LE(0xfeedfacf, 0);
    buffer.writeUInt32LE(0x0100000c, 4);
    buffer.writeUInt32LE(2, 12);
    buffer.writeUInt32LE(1, 16);
    buffer.writeUInt32LE(24, 20);
    buffer.writeUInt32LE(0x32, 32);
    buffer.writeUInt32LE(24, 36);
    buffer.writeUInt32LE(platform, 40);
    return buffer;
  }

  test('accepts an arm64 iPhoneOS executable', () => {
    assert.equal(inspectDeviceExecutable(executableFixture()).platform, 'iPhoneOS');
  });

  test('rejects an arm64 simulator binary even though its architecture matches', () => {
    assert.throws(() => inspectDeviceExecutable(executableFixture(7)), /device platform/);
  });

  test('compiled bundle version must match the source package version', () => {
    const version = JSON.parse(read('package.json')).version;
    assert.doesNotThrow(() => verifyBundleVersion({ CFBundleShortVersionString: version }));
    assert.throws(() => verifyBundleVersion({ CFBundleShortVersionString: '0.1.0' }), /must match package.json/);
    assert.throws(() => verifyBundleVersion({}), /must match package.json/);
    const nativeVersions = [...read('ios/App/App.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]);
    assert.deepEqual(nativeVersions, [version, version], 'Debug and Release project versions must match package.json');
  });

  test('rejects missing, truncated, foreign-architecture and non-executable payloads', () => {
    assert.throws(() => inspectDeviceExecutable(Buffer.from('not a compiled app')), /truncated/);
    const wrongCPU = executableFixture(); wrongCPU.writeUInt32LE(0x01000007, 4);
    assert.throws(() => inspectDeviceExecutable(wrongCPU), /arm64/);
    const library = executableFixture(); library.writeUInt32LE(6, 12);
    assert.throws(() => inspectDeviceExecutable(library), /not an object file or library/);
    const truncated = executableFixture(); truncated.writeUInt32LE(512, 36);
    assert.throws(() => inspectDeviceExecutable(truncated), /load command size/);
  });

  test('shared scheme references the actual app target and supports Release archiving', () => {
    const scheme = read('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme');
    const project = read('ios/App/App.xcodeproj/project.pbxproj');
    const references = [...scheme.matchAll(/BlueprintIdentifier="([0-9A-F]+)"/g)].map((match) => match[1]);
    assert.ok(references.length >= 1 && references.every((id) => id === '504EC3031FED79650016851F'));
    assert.match(project, /504EC3031FED79650016851F \/\* App \*\/ = \{\s*isa = PBXNativeTarget;/);
    assert.match(scheme, /ArchiveAction buildConfiguration="Release"/);
    assert.match(scheme, /buildForArchiving="YES"/);
  });

  test('cloud workflow is manual, read-only, pinned and keeps artifacts for three days', () => {
    const workflow = yaml.load(read('.github/workflows/ios-build.yml'));
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    const job = workflow.jobs.iphone;
    assert.equal(job['runs-on'], 'macos-26');
    assert.ok(job['timeout-minutes'] <= 30);
    assert.equal(job.env.ELECTRON_SKIP_BINARY_DOWNLOAD, '1');
    assert.equal(job.env.DEVELOPER_DIR, '/Applications/Xcode_26.6.app/Contents/Developer');
    for (const step of job.steps.filter((value) => value.uses)) assert.match(step.uses, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
    for (const step of job.steps.filter((value) => value.uses?.startsWith('actions/upload-artifact@'))) assert.equal(step.with['retention-days'], 3);
    assert.equal(job.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false);
    const expandIndex = job.steps.findIndex((step) => step.run?.includes('unzip -o source.zip'));
    const nodeIndex = job.steps.findIndex((step) => step.uses?.startsWith('actions/setup-node@'));
    assert.ok(expandIndex >= 0 && expandIndex < nodeIndex, 'Source archive must be unpacked before setup-node reads the lockfile');
    assert.doesNotMatch(read('.github/workflows/ios-build.yml'), /secrets\.|id-token:\s*write|contents:\s*write/);
  });

  test('device build disables signing and verifies compiled output before zipping Payload', () => {
    const script = read('scripts/build-ios.sh');
    assert.match(script, /set -euo pipefail/);
    assert.match(script, /-sdk iphoneos/);
    assert.match(script, /-destination 'generic\/platform=iOS'/);
    assert.match(script, /ARCHS=arm64/);
    assert.ok(script.includes('MARKETING_VERSION="$app_version"'));
    assert.ok(script.includes('CURRENT_PROJECT_VERSION="$build_number"'));
    assert.ok(script.includes('build_number="${GITHUB_RUN_NUMBER:-1}"'));
    assert.match(script, /CODE_SIGNING_ALLOWED=NO/);
    assert.match(script, /CODE_SIGNING_REQUIRED=NO/);
    assert.ok(script.indexOf('--verify-app') < script.indexOf('zip -q -r'));
    assert.match(script, /unzip -tq/);
    assert.match(script, /unsigned-iphoneos-arm64\.ipa/);
    assert.doesNotMatch(script, /-allowProvisioningUpdates|codesign --sign|security import/);
  });

  test('icon and privacy resources required by the iPhone build are present', () => {
    const iconRoot = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
    const metadata = JSON.parse(read(`${iconRoot}/Contents.json`));
    const icon = metadata.images.find((item) => item.size === '1024x1024');
    assert.ok(icon?.filename);
    const png = fs.readFileSync(path.join(root, iconRoot, icon.filename));
    assert.equal(png.readUInt32BE(16), 1024);
    assert.equal(png.readUInt32BE(20), 1024);
    assert.equal(png[25], 2, 'App Store icon must have no alpha channel');
    assert.match(read('ios/App/App/PrivacyInfo.xcprivacy'), /NSPrivacyAccessedAPICategoryUserDefaults/);
    assert.match(read('ios/App/App/PrivacyInfo.xcprivacy'), /CA92\.1/);
    assert.match(read('ios/App/App.xcodeproj/project.pbxproj'), /PrivacyInfo.xcprivacy in Resources/);
  });

  test('SPM paths and npm optional dependencies support the macOS arm64 runner', () => {
    const spm = read('ios/App/CapApp-SPM/Package.swift');
    const npm = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    assert.ok(spm.includes(`exact: "${npm.dependencies['@capacitor/ios']}"`));
    for (const relative of [...spm.matchAll(/\.package\(name:\s*"[^"]+",\s*path:\s*"([^"]+)"/g)].map((match) => match[1])) {
      assert.ok(fs.existsSync(path.resolve(root, 'ios/App/CapApp-SPM', relative, 'Package.swift')), relative);
    }
    for (const dependency of ['@resvg/resvg-js-darwin-arm64', '@rolldown/binding-darwin-arm64', '@typescript/typescript-darwin-arm64']) {
      assert.ok(lock.packages[`node_modules/${dependency}`], `Lock file lacks ${dependency}`);
    }
  });
}
