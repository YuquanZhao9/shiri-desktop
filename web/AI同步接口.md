# 昱时 AI 同步接口（ai-sync）

AI 对话、Claude 技能或自动任务用它读写用户的日程。写入后，电脑版和手机版会通过实时推送在几秒内更新。

## 调用方式

- 地址：`POST https://kaoqvxmxcywlzqhnkacg.supabase.co/functions/v1/ai-sync`
- 请求头：`Authorization: Bearer yst_…`（AI 同步令牌）、`Content-Type: application/json`
- 令牌在哪里生成：手机版「我的 → AI 同步令牌 → 生成新令牌」，或电脑版管理窗口（Ctrl+Alt+D）「设置 → AI 同步令牌」。令牌只显示一次，可随时撤销。它只能读写日程，不能登录账号。
- 请求体可以是单个操作 `{ "action": … }`，也可以是批量 `{ "operations": [ {…}, … ] }`（最多 50 个）。批量时逐个执行，一个失败不影响其余，最后一起写入。后面的操作可以用前面新建日程返回的 id。
- 成功：`{ "ok": true, …结果 }`；批量：`{ "ok": true, "results": [ { "ok": true, … } | { "ok": false, "error": { "code", "message" } } ] }`
- 失败：`{ "ok": false, "error": { "code": "…", "message": "中文说明" } }`，HTTP 状态码见下表

## 日期、时间、时区

- 全部使用**用户当地时间**（德国，Europe/Berlin）的钟面时间，不带时区：日期 `YYYY-MM-DD`，时间 `HH:mm`（24 小时制）
- 日程存的就是当地钟面时间，所以夏令时切换不会让它偏移
- 调用方需要自己把“下周四下午三点”这类说法换算成 Europe/Berlin 的日期。`info` 会返回服务器的 UTC 时间，可以用来参考

## 事件字段（create 的 `event`、update 的 `changes`、upsert 的 `event`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| title | string 1–500 | 标题（新建时必填） |
| date | `YYYY-MM-DD` \| null | 日期；null 表示放进收集箱（没有日期） |
| start | `HH:mm` \| null | 开始时间；null 表示全天 |
| end | `HH:mm` | 结束时间（跨午夜会自动加一天）；和 duration 二选一 |
| duration | 整数分钟 5–1440 | 时长，默认 60 |
| notes | string ≤ 20000 | 备注 |
| color | `#RRGGBB` \| null | 颜色标签；null 表示使用清单颜色。应用里提供的色板：#E5534B #F08C2E #D6A92B #3FA66B #1FA3A3 #3B7DDD #8B5CF6 #D6559A |
| repeat | none / daily / weekdays / weekly / monthly / yearly | 重复规则（每周按起始日期的星期几；每月按几号，没有这一天的月份跳过） |
| list | string | 清单名称或 ID（如“工作”“生活”“个人”），默认是第一个清单 |
| priority | normal / high | 优先级 |
| completed | boolean | 不重复的日程是否完成（重复日程请用 complete 操作） |

update 只改传进来的字段。

返回的事件（`event`）格式：
```json
{ "id": "uuid", "title": "…", "date": "2026-10-15" | null, "start": "15:00" | null, "end": "16:30" | null,
  "duration": 90, "allDay": false, "notes": "", "color": "#E5534B" | null, "repeat": "none",
  "list": { "id": "work", "name": "工作" }, "priority": "normal", "completed": false,
  "doneDates": [], "updatedAt": "2026-09-28T18:14:42.568Z", "externalId": "…(仅 upsert 建的有)" }
```

## 操作

| action | 参数 | 返回 |
| --- | --- | --- |
| `info` | — | `lists`（id、name、color），`timetable`（课表名，没有保存过为 null），`serverTime` |
| `list` | `from`, `to`（最多 366 天）, 可选 `query`（按标题或备注搜索）, 可选 `includeInbox: true` | `events`：范围内每一次发生（重复日程会展开），每项是 event 加上 `date`（这一次的日期）、`done`、`seriesStart`；如果 includeInbox，另有 `inbox` |
| `get` | `id` | `event` |
| `create` | `event` | `event` |
| `update` | `id`, `changes` | `event`（重复日程改日期或时间会影响整个系列） |
| `complete` | `id`, 可选 `done`（默认 true）, 重复日程需要 `date` | `event` |
| `delete` | `id` | `{ "deleted": id }`（软删除，各设备会同步删掉） |
| `upsert` | `externalId`（1–300 字，如 `gmail:<messageId>`）, 可选 `source`, `event` | `status`：`created` / `updated` / `unchanged` / `skipped_deleted`（用户删过就不再加回来），以及 `event` |
| `find` | `externalId` | `event`（没有为 null），`deleted` |
| `busy` | `from`, `to`（最多 62 天）, 可选 `state`（德国联邦州代码，如 BW；默认只算全国性假日） | `days[]`：`date`、`weekday`（1=周一）、`holiday`（德国假日名或 null）、`allDay[]`（全天日程）、`blocks[]`：`{start, end, kind: "event"|"class", title, id?, optional?}`。未完成的定时日程和课表课程都算在内；课程已去掉停课期和德国假日，虚线课（可选或看录像）带 `optional: true` |
| `free` | `from`, `to`（最多 62 天）, 可选 `dayStart`（默认 08:00）、`dayEnd`（默认 20:00）、`minMinutes`（默认 30）、`weekends`（默认 false）、`ignoreOptional`（默认 false）、`state` | `days[]`：`date`、`holiday`、`free[]`：`{start, end, minutes}` |

## 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | invalid_request | 字段缺失或格式不对（message 会说明是哪一项） |
| 400 | unknown_list | 清单名不存在（message 里列出可用的清单） |
| 400 | unknown_action | action 不认识 |
| 400 | not_on_date | 重复日程在这一天不发生 |
| 401 | invalid_token | 令牌缺失、格式不对或已撤销 |
| 404 | not_found | 日程不存在或已删除 |
| 405 | method_not_allowed | 没有用 POST |
| 413 | too_large | 请求超过 1 MB |
| 500 | storage_error / internal_error | 服务器问题，可以稍后重试 |

## 示例

```bash
curl -X POST https://kaoqvxmxcywlzqhnkacg.supabase.co/functions/v1/ai-sync \
  -H "Authorization: Bearer $YUSHI_TOKEN" -H "Content-Type: application/json" \
  -d '{"operations":[
        {"action":"list","from":"2026-10-12","to":"2026-10-18","query":"开会"},
        {"action":"create","event":{"title":"和导师开会","date":"2026-10-15","start":"15:00","end":"16:00","list":"工作","color":"#E5534B"}}
      ]}'
```

Windows 下请用 UTF-8 发送请求体（比如 `--data-binary @file.json`），否则中文会变成乱码。
