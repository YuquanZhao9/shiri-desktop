import type { SupabaseClient } from '@supabase/supabase-js';
import { createCloudClient } from '@shared/cloud';

// 与桌面版 App.tsx 使用相同的本机键名，同一浏览器里两端的数据互认。
const URL_KEY = 'shiri-cloud-url';
const KEY_KEY = 'shiri-cloud-key';

export interface CloudConfig { url: string; key: string; baked: boolean }

const pref = (key: string) => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };

/** 构建时写入的项目地址优先；没有时使用设置页里手动填写的。 */
export function cloudConfig(): CloudConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const key = (import.meta.env.VITE_SUPABASE_KEY as string | undefined)?.trim();
  if (url && key) return { url, key, baked: true };
  const savedUrl = pref(URL_KEY), savedKey = pref(KEY_KEY);
  return savedUrl && savedKey ? { url: savedUrl, key: savedKey, baked: false } : null;
}

export function saveCloudConfig(url: string, key: string): SupabaseClient {
  const client = createCloudClient(url.trim(), key.trim());
  localStorage.setItem(URL_KEY, url.trim());
  localStorage.setItem(KEY_KEY, key.trim());
  return client;
}

/** 与桌面版 accountKey 相同：按云项目和账号隔离本机数据。 */
export function accountKey(url: string, userId: string): string {
  return `shiri-data:${encodeURIComponent(new URL(url).origin)}:${userId}`;
}

export { applyRemoteLists, planListSync, subscribeLive, syncLists, syncTimetable } from '@shared/live-sync';
