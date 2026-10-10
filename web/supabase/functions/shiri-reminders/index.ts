// 昱时 云端提醒：由数据库定时任务每分钟调用一次，给开启提醒的 iPhone 发网页推送。
// 部署：supabase functions deploy shiri-reminders --no-verify-jwt
// 需要的函数密钥：VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、CRON_SECRET（SUPABASE_URL 与
// SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动提供）。
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import webpush from 'npm:web-push@3.6.7';
import { dueReminders, MULTI_LEADS, type ReminderTask } from './schedule.ts';

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`缺少函数密钥 ${name}`);
  return value;
};

webpush.setVapidDetails('mailto:reminders@yushi.invalid', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

interface Subscription { endpoint: string; user_id: string; p256dh: string; auth: string; time_zone: string; lead_minutes: number }

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async request => {
  if (!sameSecret(request.headers.get('x-cron-secret') ?? '', env('CRON_SECRET'))) return new Response('forbidden', { status: 403 });

  const { data: subscriptions, error } = await admin.from('shiri_push_subscriptions').select('endpoint,user_id,p256dh,auth,time_zone,lead_minutes');
  if (error) return new Response(error.message, { status: 500 });

  const now = Date.now();
  const tasksByUser = new Map<string, ReminderTask[]>();
  for (const userId of new Set((subscriptions as Subscription[]).map(sub => sub.user_id))) {
    const { data, error: taskError } = await admin.from('shiri_tasks').select('payload')
      .eq('user_id', userId).eq('deleted', false).neq('payload->>time', '');
    if (taskError) return new Response(taskError.message, { status: 500 });
    tasksByUser.set(userId, (data || []).map((row: { payload: ReminderTask }) => row.payload));
  }

  let sent = 0;
  for (const sub of subscriptions as Subscription[]) {
    let due;
    try { due = dueReminders(tasksByUser.get(sub.user_id) ?? [], sub.time_zone, MULTI_LEADS, now); }
    catch { continue; } // 无效时区：跳过这台设备，不影响其他人
    for (const item of due) {
      // 先占位再发送：并发或重跑时同一提醒只发一次。
      const { error: claimError } = await admin.from('shiri_push_sent').insert({ endpoint: sub.endpoint, occurrence: item.occurrence });
      if (claimError) continue;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: item.title, body: item.body, tag: item.occurrence, date: item.occurrence.split(':')[1] }),
          { TTL: 3600, urgency: 'high' },
        );
        sent++;
      } catch (pushError) {
        const status = (pushError as { statusCode?: number }).statusCode;
        // 设备已取消订阅（删除了主屏幕图标等），清掉这条订阅。
        if (status === 404 || status === 410) await admin.from('shiri_push_subscriptions').delete().eq('endpoint', sub.endpoint);
        else await admin.from('shiri_push_sent').delete().eq('endpoint', sub.endpoint).eq('occurrence', item.occurrence);
      }
    }
  }

  await admin.from('shiri_push_sent').delete().lt('sent_at', new Date(now - 3 * 86_400_000).toISOString());
  return Response.json({ devices: subscriptions?.length ?? 0, sent });
});
