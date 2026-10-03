# 昱时 · 仓库结构

整个项目放在这一个私有仓库里：

| 位置 | 内容 |
| --- | --- |
| 仓库根目录 | 桌面版（Windows / Mac，Electron + React），`src/` 也是手机网页版共用的数据、重复规则、节假日、课表与同步代码 |
| `cloud/` | Supabase 数据库脚本（schema.sql 到 schema-v4.sql，按顺序运行） |
| `web/` | iPhone 网页版（PWA）源码；`web/supabase/` 是云函数 `ai-sync`、`shiri-reminders` 和定时任务脚本；`web/AI同步接口.md` 是 AI 同步接口说明 |
| `docs/` | 进度、测试记录、使用说明和交接文档 |

## 说明

- 手机网页版通过 `../拾日/src` 引用桌面版共用代码（本机目录名是“拾日”）。在本仓库里构建网页版时，先在仓库的上一级建一个指向仓库根目录、名为 `拾日` 的链接，或者把仓库克隆到名为 `拾日` 的文件夹旁边。
- 公开仓库 `YuquanZhao9/yushi-app` 只放网页版的构建产物（GitHub Pages），不含源码，所以源码只在这里保存一份。
- 仓库不含 `.env.local` 等配置文件。构建需要 `VITE_SUPABASE_URL`、`VITE_SUPABASE_KEY`（网页版还可设 `VITE_VAPID_PUBLIC_KEY`），格式见 `web/.env.example`。只填公开的 publishable key，不要提交任何密钥。
- `web/` 和 `docs/` 由 `node scripts/sync-repo-extras.mjs` 从本机的源码目录复制，更新后重新运行再提交。
