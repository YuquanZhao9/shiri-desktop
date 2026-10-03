import type { SupabaseClient } from '@supabase/supabase-js';

export const VAPID_PUBLIC_KEY = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || '').trim();

/** iPhone 只有从主屏幕图标打开（独立模式）时才允许网页推送。 */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/** 必须在用户点按时调用：iOS 只在手势里弹出通知授权。 */
export async function enablePush(client: SupabaseClient, userId: string, leadMinutes: number): Promise<void> {
  if (!pushSupported()) throw new Error(isStandalone() ? '这台设备的系统版本不支持网页提醒，需要 iOS 16.4 或更高。' : '请先用 Safari 的“添加到主屏幕”，再从主屏幕图标打开昱时开启提醒。');
  if (!VAPID_PUBLIC_KEY) throw new Error('提醒服务还没配置（缺少 VAPID 公钥）。');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('没有获得通知权限。可在 设置 → 通知 → 昱时 中打开。');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  await saveSubscription(client, userId, subscription, leadMinutes);
}

export async function saveSubscription(client: SupabaseClient, userId: string, subscription: PushSubscription, leadMinutes: number): Promise<void> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('推送订阅信息不完整，请关闭后重新开启提醒。');
  const { error } = await client.from('shiri_push_subscriptions').upsert({
    endpoint: json.endpoint,
    user_id: userId,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    lead_minutes: leadMinutes,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw new Error(/shiri_push_subscriptions|schema cache/i.test(error.message) ? '云端提醒表还没建，请先运行 supabase/schema-v2.sql。' : error.message);
}

export async function disablePush(client: SupabaseClient | null): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  if (client) await client.from('shiri_push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe();
}
