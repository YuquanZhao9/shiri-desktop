# 昱时 · iPhone 网页版

在 iPhone 的 Safari 里打开网址，点"分享 → 添加到主屏幕"，之后从桌面图标打开，全屏使用，和电脑版通过 Supabase 同步。

## 与电脑版的关系

- 数据格式、重复规则、农历与节假日、日程同步全部直接引用 `../拾日/src`（`core.ts`、`types.ts`、`cloud.ts`、`holidays.ts`、`live-sync.ts`），两端不会各写一套。
- 本机存储键与电脑版相同：未登录 `shiri-data:local`，登录后 `shiri-data:<项目地址>:<账号 ID>`。
- 偏好键与电脑版相同：`shiri-reminder-lead`（提前提醒分钟）、`shiri-de-state`（德国联邦州）。

## 同步

- 日程：沿用 `cloud/schema.sql` 的 `shiri_tasks` 表和 `merge_tasks`（按更新时间合并，删除保留墓碑）。
- 清单名称和颜色：`cloud/schema-v2.sql` 新增 `shiri_lists` 表和 `merge_lists`；只上传本机改过的清单，占位名"同步清单 N"不会上传。
- 实时：`schema-v2.sql` 把两张表加入 Supabase Realtime；一端保存后另一端约 1–2 秒内收到。手机回到前台、网络恢复、每分钟也会补一次同步。

## 提醒（iPhone 需要 iOS 16.4 以上，且必须从主屏幕图标打开）

网页不能在手机上自己定时弹通知，所以提醒由云端发：

1. 手机在"我的 → 日程提醒"开启后，把推送订阅（含时区和提前分钟）存进 `shiri_push_subscriptions`。
2. 数据库定时任务（`supabase/schema-cron.sql`，pg_cron 每分钟）调用云函数 `supabase/functions/shiri-reminders`。
3. 云函数用与电脑版相同的重复规则算出到点的日程，发网页推送；`shiri_push_sent` 防止重复。

## 部署步骤

1. Supabase SQL：依次运行 `../拾日/cloud/schema.sql`、`../拾日/cloud/schema-v2.sql`。
2. 生成 VAPID 密钥：`npx web-push generate-vapid-keys`。
3. 函数密钥：`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`CRON_SECRET`（随机串）。
4. 部署函数：`npx supabase functions deploy shiri-reminders --project-ref <ref> --no-verify-jwt --use-api`。
5. 把 `supabase/schema-cron.sql` 里的 `PROJECT_REF`、`CRON_SECRET` 换成实际值后运行。
6. 复制 `.env.example` 为 `.env.local` 填好，`npm run build`，把 `dist/` 发布到 HTTPS 静态网站。

## 命令

```powershell
npm install
npm test        # 重复规则与电脑版逐日比对、时区、提醒窗口、清单同步、快速添加解析
npm run build   # 生成 dist/，含离线缓存和推送处理的 sw.js
npm run dev:local
```

公开密钥（Publishable key）可以放进网页；`service_role` / Secret key 只能放在 Supabase 函数密钥里。
