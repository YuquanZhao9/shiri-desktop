# Windows 桌面运行层

昱时首次启动默认显示桌面日历组件。日历组件使用独立、无标题栏的窗口，通过 `#desktop` 加载专用日历界面，嵌入 Explorer 的 `WorkerW` 或 `Progman`。窗口贴齐主显示器工作区，默认显示两周，可切换一周或整月；日期行随周数自动伸展。双击日期或点击任务后在原日期格位置输入和编辑；表单由无边框、无任务栏图标的顶层焦点层承载，以便 Windows 输入法正常定位。普通应用窗口可以盖在日历上方。

日程管理界面是另一扇普通窗口。通过托盘、日历上的管理入口或 `Ctrl+Alt+D` 打开管理窗口时，桌面日历继续显示。两扇窗口共用应用的数据空间，渲染层负责同步编辑。选择“普通窗口”或“全屏”会在本次运行中移除桌面日历；下次点开 Windows 程序仍以桌面日历为默认界面。旧版保存的窗口模式也会自动转为新的桌面默认值。

日历位于桌面图标层上方。日期格接收左键和双击；右键通过短暂启用鼠标穿透并转发一次原生右键给 Windows 桌面。日期标题、日程、顶部按钮和小时表保留交互。图标没有被移动、删除或隐藏。当前实现不提供多显示器独立布局或 Windows 虚拟桌面绑定。

Windows 的桌面窗口层级没有稳定的公开扩展协议。此实现识别经典 WorkerW 图标宿主与 Windows 11 24H2 之后的 Progman 图标宿主，仅对昱时自己的 HWND 调用 Win32 API，不结束 Explorer，不移动图标窗口，不修改注册表或壁纸设置。若本机的桌面工具、DPI 或系统版本拒绝附着，会返回具体错误并恢复普通窗口。

## 使用与恢复

- 关闭管理窗口会隐藏到系统托盘，桌面日历与主进程提醒继续运行。
- 托盘双击、托盘“打开管理窗口”或 `Ctrl+Alt+D` 会打开管理窗口，保留桌面日历。热键如被其他程序占用，托盘入口仍可用。要收起日历，可在托盘取消“常驻桌面”，或在设置中选择“普通窗口”。
- 托盘“退出昱时”才会结束程序并停止提醒。
- 每次启动 Windows 程序默认进入桌面日历。普通窗口和全屏选项只影响本次运行；再次双击程序时，即使程序已经在后台运行，也会回到桌面日历并收起管理窗口。打开管理窗口、点击提醒或恢复快捷键不会改写启动行为。
- 桌面日历在内容加载和原生附着完成前保持隐藏，避免先闪出完整管理界面。若附着失败，只关闭自己的日历窗口并打开最大化管理窗口，通过 `lastError` 和模式事件说明失败原因；不会改写启动偏好，也不会循环重试。
- 开机启动仅在打包后的 Windows 版本中可设置。便携版使用其原始 EXE 路径；开启后请保持该文件的位置。
- 提醒需要昱时进程运行。系统关机、睡眠或退出期间不会显示通知；恢复运行时补发最近 24 小时内的错过提醒。Windows 勿扰与通知权限可能影响显示。

## 打包

入口是 `desktop/main.cjs`。构建产物必须保留 `dist/index.html` 及其资源，Electron Builder 配置至少包含：

```json
{
  "main": "desktop/main.cjs",
  "build": {
    "appId": "app.shiri.calendar",
    "files": ["dist/**/*", "desktop/**/*", "package.json"],
    "asarUnpack": ["desktop/desktop.ps1"]
  }
}
```

开发入口接受 `SHIRI_DEV_URL=http://127.0.0.1:端口`，只允许本机 HTTP，打包版忽略该环境变量。正式版加载本地构建文件。

渲染进程启用 `sandbox`、`contextIsolation`，关闭 Node 集成和 webview；不向渲染进程暴露文件系统、shell、任意 IPC 或执行能力。桌面原生操作通过隐藏的 PowerShell 子进程执行，参数以数组传递，辅助程序核对窗口归属并保存原始父窗口、样式与位置用于恢复。

## 前端 API

全部操作经 `window.desktop` 提供，除订阅外均返回 Promise。

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `getSettings()` | 无 | 当前设置对象 |
| `setMode(mode)` | `window`、`desktop`、`fullscreen` | `{ok, ...设置, error?}` |
| `setWidgetSpan(span)` | `week`、`twoWeeks`、`month` | `{ok, ...设置, error?}` |
| `setCalendarInteractive(enabled)` | boolean，仅桌面日历可调用 | `{ok, error?}`，控制日历鼠标交互 |
| `passDesktopContextMenu()` | 无，仅桌面日历可调用 | `{ok, error?}`，将格内右键转交 Windows 桌面 |
| `openInlineEditor({date, time?, taskId?, rect})` | 日程信息与日期格位置，仅桌面日历可调用 | `{ok, error?}`，在格子位置打开可聚焦输入层 |
| `setWidgetSide(side)` | `left`、`right` | 旧版兼容设置；全屏桌面日历不再改变位置 |
| `openEditor({date, time?, taskId?})` | 日期、可选时间或已有任务编号 | `{ok, error?}` |
| `closeEditor()` | 仅编辑窗口可调用 | `{ok, error?}` |
| `setOpacity(value)` | 0.35 至 1 | `{ok, ...设置, error?}` |
| `setAutostart(enabled)` | boolean | `{ok, ...设置, error?}` |
| `showWindow()` | 无 | `{ok, ...设置, error?}` |
| `notify({title, body})` | 标题最长 160 字，正文最长 1000 字 | `{ok, error?}` |
| `syncReminders(items)` | `[{id,title,body,at}]` | `{ok, count, error?}` |
| `onModeChanged(callback)` | 收到设置对象的函数 | 取消订阅函数 |

设置对象包括 `mode`、`startupMode`、`surface`、`opacity`、`autostart`、`widgetSpan`、`widgetSide`、`desktopAvailable`、`notificationsSupported`、`shortcutRegistered`、`desktopHost` 和 `lastError`。`surface` 为 `app` 或 `desktop`，表示调用来自普通窗口还是桌面组件；编辑窗口按普通窗口处理。`mode` 表示整体显示模式，因此管理窗口打开期间仍可能为 `desktop`。`opacity` 仅作用于桌面日历，管理窗口保持完全不透明。`desktopAvailable` 仅表示运行于 Windows，不代表该机器的桌面宿主已经验证可用；真正结果以 `setMode('desktop')` 的 `ok` 为准。

`syncReminders` 是全量替换，最多 2000 条；`at` 为毫秒时间戳或 ISO 字符串。前端负责展开重复任务的未来提醒，推荐覆盖未来 90 天并在任务变更和页面打开时更新。主进程每 15 秒独立检查，并在系统恢复与解锁时检查；它将队列及已发记录保存到 Electron 的 `userData/scheduled-reminders.json`，不依赖页面定时器。相同 `id + at` 不会重复发送，改期会成为新提醒。一次最多发送 5 条以避免大量补发，之后每 15 秒继续发送。

## 验证

自动检查：

```powershell
node --check desktop/main.cjs
node --check desktop/preload.cjs
node --test desktop/reminders.test.cjs
node --test desktop/startup.test.cjs
node desktop/smoke.cjs
node desktop/verify-package.cjs
```

`smoke.cjs` 需要开发依赖中的 Playwright 与 Electron 二进制；也可传入已有 `electron.exe` 的绝对路径。它仅在未打包程序中设置 `SHIRI_SMOKE_TEST=1`，使用任务工作目录内的独立 profile，保持窗口隐藏，不创建托盘或全局热键，不附着桌面，也不显示通知。它检查本地构建加载、预加载 API、沙盒与上下文隔离、提醒 IPC 和时间表切换，将截图与报告写入 `work/`。普通启动和打包版本不受该模式影响。

`verify-package.cjs` 在打包后静态检查 `release/win-unpacked`，验证 ASAR 内入口、预加载与网页构建和源码一致、PowerShell 辅助文件已解包、资源齐全、EXE 为 x64。可依次传入其他解包目录和便携 EXE 路径。该检查不会运行打包程序，也不代替实际桌面/通知验收。

已验证主进程与预加载脚本语法、PowerShell 语法、内嵌 C# 编译以及提醒的持久化、去重、取消、改期、补发和输入校验。隐藏 Electron 集成测试已实际加载本地构建，验证预加载 API、沙盒、上下文隔离、提醒 IPC 与月历/时间表切换，页面无运行错误，并取得原生截图。未实际验证桌面附着或系统通知显示，这两项仍需在用户的交互式 Windows 桌面验收。

交互式 Windows 验收步骤：

1. 首次启动打包版，确认两周日历贴齐主显示器工作区四边；切换一周、两周、整月时行高变化，在日期格右键确认 Windows 桌面菜单可用。
2. 双击日期格或点击已有日程，确认格内编辑栏能输入中文标题、日期、时间与备注并保存；编辑栏不应出现在侧边或任务栏。打开其他应用应覆盖桌面日历。
3. 按 `Win+D` 检查桌面常驻情况，再按 `Ctrl+Alt+D` 打开管理窗口，确认桌面日历继续显示、两边编辑能同步。通过托盘取消常驻桌面，检查原桌面图标与位置未变。
4. 在 100%、125%、150% 缩放以及 Windows 11 24H2 或更新版本上分别验证。显示器配置改变后先恢复窗口，再重新进入桌面模式。
5. 设置一分钟后的提醒，关闭窗口到托盘，确认仍触发；重新打开页面不应重复提示。取消或改期后旧时间不应提示。
6. 分别选择普通窗口和全屏，托盘退出后重新启动，确认数据存在且均以桌面日历启动；程序运行中再次双击 EXE，应收起管理窗口并显示桌面日历。验证系统通知与勿扰设置；若便携版本的系统通知不可用，使用包含开始菜单快捷方式及相同 AppUserModelID 的安装包验证。

## 实现依据

本目录是原创实现，没有复制其他项目代码。设计参考公开接口文档与桌面层级兼容性说明：

- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron 进程沙盒](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Microsoft SetParent：样式与 DPI 约束](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)
- [Lively 项目关于 Windows 11 桌面层级变化的说明](https://github.com/rocksdanister/lively/discussions/3004)
