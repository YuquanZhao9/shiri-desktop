// 昱时 云端提醒：由数据库定时任务每分钟调用一次，给开启提醒的 iPhone 发网页推送。
// 部署：supabase functions deploy shiri-reminders --no-verify-jwt
// 需要的函数密钥：VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、CRON_SECRET（SUPABASE_URL 与
// SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动提供）。
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import webpush from 'npm:web-push@3.6.7';
import { dueReminders, goalDue, goalWindow, journalDue, MULTI_LEADS, reviewDue, zonedDateKey, type GoalRow, type MarkRow, type ReminderTask } from './schedule.ts';

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`缺少函数密钥 ${name}`);
  return value;
};

// Apple 的推送服务会拒绝无效域名的联系方式（BadJwtToken），这里用网页版的正式地址。
webpush.setVapidDetails('https://yuquanzhao9.github.io/yushi-app/', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

interface Subscription { endpoint: string; user_id: string; p256dh: string; auth: string; time_zone: string; lead_minutes: number; journal_reminder: boolean; review_reminder: boolean; goal_reminder: boolean }

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async request => {
  if (!sameSecret(request.headers.get('x-cron-secret') ?? '', env('CRON_SECRET'))) return new Response('forbidden', { status: 403 });

  const { data: subscriptions, error } = await admin.from('shiri_push_subscriptions').select('endpoint,user_id,p256dh,auth,time_zone,lead_minutes,journal_reminder,review_reminder,goal_reminder');
  if (error) return new Response(error.message, { status: 500 });

  const now = Date.now();
  const tasksByUser = new Map<string, ReminderTask[]>();
  for (const userId of new Set((subscriptions as Subscription[]).map(sub => sub.user_id))) {
    const { data, error: taskError } = await admin.from('shiri_tasks').select('payload')
      .eq('user_id', userId).eq('deleted', false).neq('payload->>time', '');
    if (taskError) return new Response(taskError.message, { status: 500 });
    tasksByUser.set(userId, (data || []).map((row: { payload: ReminderTask }) => row.payload));
  }

  // 当天有没有写日记：只在某台设备到了 21:00 时才去查，并按账号 + 日期缓存。
  const writtenCache = new Map<string, boolean>();
  async function written(userId: string, day: string): Promise<boolean> {
    const key = `${userId}:${day}`;
    if (!writtenCache.has(key)) {
      const { data, error: journalError } = await admin.from('shiri_journal').select('payload').eq('user_id', userId).eq('day', day).maybeSingle();
      // 读不到就当作写了，宁可漏提醒也不乱提醒。
      const text = (data as { payload?: { text?: unknown } } | null)?.payload?.text;
      writtenCache.set(key, !!journalError || (typeof text === 'string' && text.trim().length > 0));
    }
    return writtenCache.get(key)!;
  }

  // 这一周写了几条复盘：只在周日 20:00 查，按账号 + 周缓存。
  const reviewCache = new Map<string, number>();
  async function reviewCount(userId: string, start: string, end: string): Promise<number> {
    const key = `${userId}:${start}`;
    if (!reviewCache.has(key)) {
      const { count, error: reviewError } = await admin.from('shiri_reflections').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('deleted', false).gte('day', start).lte('day', end);
      reviewCache.set(key, reviewError ? 0 : count ?? 0);
    }
    return reviewCache.get(key)!;
  }

  // 周次任务进度：只在周五 19:00 查，按账号 + 周缓存。
  const goalCache = new Map<string, Due | null>();
  async function goalsBehind(userId: string, window: { start: string; end: string; at: number }): Promise<Due | null> {
    const key = `${userId}:${window.start}`;
    if (!goalCache.has(key)) {
      const { data: goalRows, error: goalError } = await admin.from('shiri_weekly').select('payload').eq('user_id', userId).eq('kind', 'goal').eq('deleted', false);
      const { data: markRows, error: markError } = await admin.from('shiri_weekly').select('payload').eq('user_id', userId).eq('kind', 'mark').eq('deleted', false).gte('day', window.start).lte('day', window.end);
      goalCache.set(key, goalError || markError ? null : goalDue((goalRows || []).map((row: { payload: GoalRow }) => row.payload), (markRows || []).map((row: { payload: MarkRow }) => row.payload), window));
    }
    return goalCache.get(key)!;
  }

  let sent = 0;
  // 失败原因写进响应（pg_net 会保存在 net._http_response），方便排查推送没到的问题。
  const failures: { occurrence: string; status?: number; reason: string }[] = [];
  for (const sub of subscriptions as Subscription[]) {
    let due;
    try { due = dueReminders(tasksByUser.get(sub.user_id) ?? [], sub.time_zone, MULTI_LEADS, now); }
    catch { continue; } // 无效时区：跳过这台设备，不影响其他人
    if (sub.journal_reminder !== false) {
      // 先看是否到点，到点了才查当天日记。
      const diary = journalDue(sub.time_zone, now, () => false);
      if (diary && !(await written(sub.user_id, zonedDateKey(now, sub.time_zone)))) due.push(diary);
    }
    if (sub.goal_reminder !== false) {
      const window = goalWindow(sub.time_zone, now);
      if (window) { const goals = await goalsBehind(sub.user_id, window); if (goals) due.push(goals); }
    }
    if (sub.review_reminder !== false) {
      const review = reviewDue(sub.time_zone, now);
      if (review) {
        const count = await reviewCount(sub.user_id, review.start, review.end);
        if (count) due.push({ ...review.due, body: `这周写下了 ${count} 条感悟，点开看本周汇总` });
      }
    }
    for (const item of due) {
      // 先占位再发送：并发或重跑时同一提醒只发一次。
      const { error: claimError } = await admin.from('shiri_push_sent').insert({ endpoint: sub.endpoint, occurrence: item.occurrence });
      if (claimError) { failures.push({ occurrence: item.occurrence, reason: `claim: ${claimError.message}` }); continue; }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: item.title, body: item.body, tag: item.occurrence, ...(item.occurrence.startsWith('review:') ? { hash: 'review' } : { date: item.occurrence.split(':')[1] }) }),
          { TTL: 3600, urgency: 'high' },
        );
        sent++;
      } catch (pushError) {
        const status = (pushError as { statusCode?: number }).statusCode;
        const body = String((pushError as { body?: unknown }).body ?? (pushError as Error).message ?? '').slice(0, 300);
        failures.push({ occurrence: item.occurrence, status, reason: body });
        console.error('push failed', status, body);
        // 设备已取消订阅（删除了主屏幕图标等），清掉这条订阅。
        if (status === 404 || status === 410) await admin.from('shiri_push_subscriptions').delete().eq('endpoint', sub.endpoint);
        else await admin.from('shiri_push_sent').delete().eq('endpoint', sub.endpoint).eq('occurrence', item.occurrence);
      }
    }
  }

  await admin.from('shiri_push_sent').delete().lt('sent_at', new Date(now - 3 * 86_400_000).toISOString());
  return Response.json({ devices: subscriptions?.length ?? 0, sent, failures });
});
