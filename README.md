# 昱时 · 日历与清单

一个以本机保存为基础的中文日历应用，提供可直接编辑的 Windows 桌面日历组件、独立管理窗口、适配 iPhone 的界面和可选 Supabase 账号同步。当前版本为 **0.1.1**。

## 开始使用

交付目录中的新版 Windows 便携包名为 `昱时-0.1.1-Windows-输入修复版.exe`，与本源代码目录并列。每次双击启动都会显示贴齐主显示器工作区边缘的桌面日历，默认显示两周；可在右上角切换一周、两周或整月。显示的周数少时，每行日期会随之变高。单击日期展开当天按小时排列的时间表；双击日期格可直接在格内新建日程，点击已有日程也在原格位置编辑，没有侧栏或独立弹窗。为让 Windows 输入法可靠工作，格内表单使用无边框、无任务栏图标的焦点层。日期格的右键会转交给 Windows 桌面菜单。通过日历上的管理入口、系统托盘或 `Ctrl+Alt+D` 打开管理窗口，桌面日历继续显示，两边的编辑会互通。

「设置与同步」可选择普通窗口、全屏或「贴在桌面」。普通窗口和全屏只影响本次运行，下次打开 Windows 程序仍以桌面日历开始。便携包未做发行者代码签名；自行构建的程序输出到本项目的 `release/`。更名仅改变显示名称，保留原有数据目录与应用标识。

无需注册即可记录任务。首次打开没有预置的私人数据，管理窗口右侧「看看示例」会由你主动添加 5 条可删除的示例任务。

| 操作 | 行为 |
| --- | --- |
| 日历视图 | 桌面组件可切换一周、两周、整月；整月视图包含相邻月份日期。单击日期展开当天小时表，双击直接在格内编辑，管理窗口同时提供当天清单 |
| 日视图 | 查看全天任务和时间安排；同时段日程分列显示 |
| 清单与收集箱 | 未设置日期的任务放入收集箱，可之后补日期 |
| 新建与编辑 | 设置标题、日期、时间、时长、清单、优先级、重复规则和备注 |
| 拖动日程 | 月视图拖到另一日期；日视图上下拖动，以 30 分钟为步长调整开始时间；也可用编辑表单精确改期 |
| 完成任务 | 普通任务标记完成；重复任务仅完成选中的那一天 |
| 删除与撤销 | 删除后，在短暂出现的提示中点击「撤销」可立即恢复；当前没有长期回收站 |
| 搜索 | 搜索标题与备注；快捷键为 Ctrl / Command + K |
| 备份 | 在设置中导出 JSON；导入会合并任务，保留较新的版本 |

重复支持每天、周一至周五、每周、每月和每年。「工作日」按星期判断，不包含节假日调休表。每月 31 日会跳过没有 31 日的月份；每年 2 月 29 日会跳过非闰年。编辑、拖动和删除重复任务作用于整个系列，勾选仅影响当天。日期与开始时间按设备当地日期及墙上时间处理，当前不提供独立时区选择或跨天单条日程。

月视图与日视图的指针拖动已完成本机预览交互测试；这不代表已完成 iPhone 真机测试。旧备份导入按版本合并，因此不能保证用旧备份撤销较新的删除；需要撤销时请及时使用删除提示中的按钮。

## Windows 桌面与提醒

- 「贴在桌面」通过 Windows 原生窗口桥接，将独立日历组件常驻于主显示器上的普通软件窗口下方。双击日期或点击已有日程时，表单在原格位置显示；独立的无边框焦点层承接键盘输入，不显示为侧栏或任务栏窗口。每次打开 Windows 程序默认使用此模式。
- 日历贴齐主显示器工作区四边；日期格左键用于选择或编辑，右键转交给 Windows 桌面菜单。显示桌面时，日历继续附着在桌面层。
- 使用 **Ctrl + Alt + D**、日历管理入口或托盘菜单打开管理窗口，日历组件继续显示。要收起组件并恢复桌面图标，可取消托盘的常驻桌面选项，或在设置中明确选择普通窗口。透明度仅作用于日历组件；开机启动需在打包后的应用中设置。
- 桌面组件附着失败时会打开最大化管理窗口并说明原因；失败不会改写已保存的启动偏好。
- 当前仅处理主显示器。原生桌面嵌入仍需要在你的实际 Windows 会话中验证，尤其是桌面布局、Explorer 重启和显示缩放；普通窗口与全屏可独立使用。

提醒只在有具体开始时间且未完成的日程开始时触发。Windows 预排未来 **30 天内最多 2000 条**提醒，任务变化及打开界面后更新。关闭管理窗口后桌面组件与托盘进程继续工作；退出软件、关机或系统禁用通知时不会准时提醒。建议保留托盘进程并允许系统通知。

## 从源代码运行

安装 Node.js 22 或更新版本，在本项目目录打开终端。首次安装需要联网下载依赖。

```powershell
npm ci
npm run dev
```

打开终端显示的本机地址预览网页版。运行与构建 Windows 应用：

```powershell
npm run desktop
npm run pack:win
```

`npm run desktop` 先构建再启动 Electron；`npm run pack:win` 生成 Windows x64 便携包。构建时需下载 Electron 和打包工具。验证命令：

```powershell
npm test
npm run build
```

主要目录：`src/` 为共享界面和业务逻辑，`desktop/` 为 Windows 外壳和提醒服务，`ios/` 为已生成的原生 iOS 工程，`cloud/schema.sql` 为可选云数据库配置，`public/` 为网页资源。

## iPhone 运行与安装

界面已适配窄屏和触摸操作，`ios/` 原生工程已生成，包含昱时自己的应用图标。原生版使用 Capacitor 8；官方要求 **macOS、Xcode 26.0+、Xcode Command Line Tools、Node.js 22+**，支持 iOS 15+。原生源码的编译仍需 macOS 与 Xcode；没有自己的 Mac 时可以使用下面的云端编译路线，再在 Windows 上个人签名安装。[Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[iOS 支持](https://capacitorjs.com/docs/ios)

**已实际完成 GitHub 云端 iPhoneOS arm64 编译，产物下载后通过 SHA-256 和 Mach-O 架构检查；Apple 个人签名与真机运行仍待完成。** 未签名 IPA 需要个人签名后才能安装。[首次成功的云构建记录](https://github.com/YuquanZhao9/shiri-calendar/actions/runs/34823616585)

### 没有 Mac：GitHub 云编译，再用 Windows 安装

私有仓库为 [YuquanZhao9/shiri-calendar](https://github.com/YuquanZhao9/shiri-calendar)，需要登录有权访问的 GitHub 账号。仓库中的 `.github/workflows/ios-build.yml` 仅手动运行，使用 macOS runner 编译 arm64 iPhone 真机应用；`scripts/build-ios.sh` 执行编译与包结构检查。私有仓库的 Actions 会使用账号额度，超额处理取决于账号计费与预算配置。[GitHub Actions 额度说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

1. 确认仓库中已提交要编译的最新源码。在仓库 **Actions → Build iPhone IPA (unsigned) → Run workflow** 中选定分支并开始运行。当前 workflow 支持先展开仓库里的 `source.zip`，因此采用源码压缩包上传时也应更新该文件。
2. 只有本次运行成功，才到运行页的 **Artifacts** 下载 `Shiri-iPhone-unsigned-needs-signing`。产物按 workflow 保留 **3 天**，其中应包含未签名的 `.ipa`、`BUILD-INFO.json`、校验和及安装说明。若运行失败，读取失败步骤和诊断日志；不能把尚未完成的 workflow 当成已有安装包。
3. 在 Windows 从 [Sideloadly 官网](https://sideloadly.io/) 下载工具，并按官网要求准备 Windows 版 iTunes / iCloud 组件。Sideloadly 支持免费 Apple 账号，个人安装不要求付费 Apple Developer Program。
4. 用 USB 连接自己的 iPhone，在手机上信任电脑。将成功构建的 `.ipa` 拖进 Sideloadly，选择设备，使用自己的 Apple 账号完成签名与安装。Apple 账号验证在你自己的电脑上完成；此 GitHub workflow 不需要 Apple 密码、证书或描述文件。
5. 首次启动若出现系统提示，在 iPhone 的「通用 → VPN 与设备管理」信任对应开发者；iOS 16 及更新系统按提示在「隐私与安全」启用开发者模式。[Sideloadly 安装与设备设置](https://sideloadly.io/faq)

免费账号签名有效期为 **7 天**，到期需要续签；Apple 的个人测试限制包括每台设备最多 3 个此类应用。Sideloadly 可自动尝试续签，但需要电脑上的后台程序运行，并能通过 USB 或已配对的同一 Wi-Fi 网络连接手机。更新时保持同一 Apple 账号与 Bundle ID，并事先导出昱时 JSON 备份。这个路线使你不用自备 Mac，但不是永久免续签安装。[Apple 个人测试限制](https://developer.apple.com/help/account/basics/about-your-developer-account)、[Sideloadly 续签说明](https://sideloadly.io/faq)

### 有 Mac：本地 Xcode 编译与签名

将项目复制到 Mac，在项目目录运行：

```bash
npm ci
npm run build
npm run ios:sync
npm run ios:open
```

在 Xcode 中选择自己的 Signing Team、设备和唯一 Bundle Identifier，按你的 Apple 开发者账号条件签名运行。后续每次修改共享界面后重新执行 `npm run ios:sync`。正式 TestFlight / App Store 分发还需要相应账号、签名与发布流程。

iPhone 原生版最多预排未来 **30 天中最近 60 条**本地提醒，打开应用或修改任务时更新。长期不打开应用可能耗尽已排提醒；当前没有后台云推送补排。通知权限、系统专注模式和系统调度会影响展示。

手机网页版已发布到 <https://yuquanzhao9.github.io/yushi-app/>，可用 iPhone Safari「添加到主屏幕」。也可以将 `dist/` 部署到自己的 HTTPS 网站；网页推送仍受通知权限、系统策略和云端提醒服务状态影响。

## 可选：电脑与手机云同步

注册、登录、重复邮箱处理、密码恢复、数据隔离和安全边界的当前实现见 [注册与账户管理说明](docs/注册与账户管理.md)。

正式 Windows 包和手机网页版已经连接昱时的 Supabase 项目，构建中只包含项目地址和可公开使用的 Publishable key，不包含账号密码、Secret key 或 service_role 密钥。两端登录同一账号即可使用各自的本机副本和云同步；未登录时数据仍保存在当前设备。浏览器清除站点数据会删除该浏览器的本机副本，建议定期导出 JSON。

以下步骤用于重新部署自己的 Supabase 项目或更换项目；正式昱时用户不需要手工填写服务器配置：

1. 在自己的 Supabase 项目中打开 SQL Editor，执行完整的 `cloud/schema.sql`。脚本创建任务表、各操作的所有者 RLS 规则和防旧版本覆盖的合并函数，可重复执行。
2. 在 Authentication 的 Email 配置中启用邮箱密码登录，并按你的需要允许注册。建议保留邮箱确认；配置可接收验证邮件的 SMTP 服务，生产邮件不要依赖测试额度。
3. 在 Authentication 的 URL Configuration 中把 `https://yuquanzhao9.github.io/yushi-app/` 设为 Site URL，并允许 `https://yuquanzhao9.github.io/yushi-app/**` 作为 Redirect URL。登录页可发送密码恢复邮件；邮件链接返回网页版后显示新密码表单。用户完成邮箱验证后，也可返回昱时使用邮箱密码登录。[Supabase 邮箱密码配置](https://supabase.com/docs/guides/auth/passwords)
4. 在自行构建的昱时中填入该项目的 HTTPS URL 和 **Publishable key / 旧版 anon key**，或通过 `VITE_SUPABASE_URL`、`VITE_SUPABASE_KEY` 在构建时写入。不能填写 Secret key 或 service_role 密钥。
5. 在 Windows 和 iPhone 上填写同一项目配置、登录同一账号。登录不会自动上传原来未登录空间的数据；需要时点击「将本机任务合并到此账号」。

当前通过本机保存加周期性快照合并同步：修改后约 1.8 秒尝试同步，应用运行期间约每 45 秒再检查一次；回到应用、恢复联网或点击同步按钮也会触发。离线编辑保留在本机，重新联网后重试。只有登录成功、SQL 已配置且实际请求成功，才能确认双端同步可用。

数据库仅允许用户访问自己的数据；RPC 再核验预期账号。云端数据和导入备份使用相同的数据校验。实现与 SQL 已测试账号隔离、旧版本保护、删除标记和相同时间冲突一致性；正式手机网页也已发布。真实恢复邮件送达和用户修改密码后的双端重新登录仍需现场验证。[RLS 官方说明](https://supabase.com/docs/guides/database/postgres/row-level-security)

同步的当前限制：

- 冲突按客户端 `updatedAt` / `deletedAt` 时间选择较新版本，相同时间优先删除，再使用确定性字段排序；它不是逐字段协作合并。设备时钟严重不准可能影响胜出版本。
- 删除保留 tombstone，防止离线设备重新上传后恢复旧任务。不要直接清除云表里的删除标记。
- 当前同步日程、清单和课表；提醒权限、浏览器推送订阅和设备本机设置仍按设备分别管理。
- 登录会话保存在当前设备。当前提供恢复邮件和已登录修改密码；不提供应用内数据库加密、端到端加密、账号删除页面或团队共享。

## 设计参考与开源依赖

界面、业务逻辑和昱时应用图标为本项目编写，没有复制下列参考项目的源码或品牌素材。参考的是日历布局、任务分类和交互方式；界面里的通用操作图标使用 Lucide React，遵循其许可证：

- [Super Productivity](https://github.com/super-productivity/super-productivity)：任务组织、时间安排与跨设备思路；[MIT 许可证](https://github.com/super-productivity/super-productivity/blob/master/LICENSE)。
- [FullCalendar](https://github.com/fullcalendar/fullcalendar)：月历与拖动安排的交互；[MIT 许可证](https://github.com/fullcalendar/fullcalendar/blob/main/LICENSE.md)。
- [TOAST UI Calendar](https://github.com/nhn/tui.calendar)：多视图和编辑弹窗；[MIT 许可证](https://github.com/nhn/tui.calendar/blob/main/LICENSE)。该仓库在 2026-09-02 归档，仅作为设计参考。

实际使用的 React、Electron、Capacitor、Supabase JS 和图标等依赖见 `package.json` 与锁文件，各自适用其原有许可证。
