import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { defaultData, mergeTasks, validateBackup } from './core';
import type { Task, TaskList } from './types';

export interface CloudSettings {
  url: string;
  key: string;
}

const SETTINGS_KEY = 'shiri.cloud.settings.v1';
const PAGE_SIZE = 500;

/** Settings are stored on this device. Never put a secret/service-role key here. */
export function loadCloudSettings(): CloudSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const settings: unknown = JSON.parse(raw);
    if (!settings || typeof settings !== 'object') return null;
    const value = settings as Record<string, unknown>;
    if (typeof value.url !== 'string' || typeof value.key !== 'string') return null;
    return normalizeCloudSettings(value.url, value.key);
  } catch {
    return null;
  }
}

export function saveCloudSettings(url: string, key: string): CloudSettings {
  const settings = normalizeCloudSettings(url, key);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export function clearCloudSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}

function normalizeCloudSettings(rawUrl: string, rawKey: string): CloudSettings {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('请输入有效的 Supabase 项目地址。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('项目地址必须使用 HTTPS，且不能包含账号、密码或查询参数。');
  }
  const key = rawKey.trim();
  if (key.length < 20 || /\s/.test(key)) {
    throw new Error('请输入 Supabase 的 Publishable key 或旧版 anon key。');
  }
  if (key.startsWith('sb_secret_')) {
    throw new Error('客户端只能使用 Publishable key，不能使用 Secret key。');
  }
  if (key.split('.').length === 3) {
    try {
      const middle = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(middle.padEnd(Math.ceil(middle.length / 4) * 4, '=')));
      if (payload.role === 'service_role') {
        throw new Error('不能在客户端保存 service_role 密钥，请改用 anon key。');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('service_role')) throw error;
      throw new Error('anon key 格式无效，请从 Supabase 项目设置重新复制。');
    }
  } else if (!key.startsWith('sb_publishable_')) {
    throw new Error('密钥格式无效，请使用 Supabase Publishable key。');
  }
  return { url: url.href.replace(/\/$/, ''), key };
}

export function createCloudClient(url: string, key: string): SupabaseClient {
  const settings = normalizeCloudSettings(url, key);
  return createClient(settings.url, settings.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export async function signUp(client: SupabaseClient, email: string, password: string) {
  const { data, error } = await client.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(cloudErrorMessage(error));
  return { ...data, needsEmailConfirmation: !data.session };
}

export async function signIn(client: SupabaseClient, email: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(cloudErrorMessage(error));
  return data;
}

export async function signOut(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw new Error(cloudErrorMessage(error));
}

export function cloudErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message || error);
  if (/invalid login credentials/i.test(message)) return '邮箱或密码不正确。';
  if (/email not confirmed/i.test(message)) return '请先打开邮箱中的确认邮件，再登录。';
  if (/user already registered/i.test(message)) return '此邮箱已经注册，请直接登录。';
  if (/password.*least|weak.password/i.test(message)) return '密码强度不足，请使用更长的密码。';
  if (/rate limit|too many requests/i.test(message)) return '操作太频繁，请稍后再试。';
  if (/failed to fetch|network|load failed/i.test(message)) return '无法连接同步服务。请检查网络及项目地址，本机任务仍已保留。';
  if (/merge_tasks|shiri_tasks|schema cache/i.test(message)) return '同步数据库尚未准备好，请先在 Supabase 运行 cloud/schema.sql。';
  return message || '同步失败，请稍后重试。本机任务仍已保留。';
}

async function readTasks(client: SupabaseClient, userId: string): Promise<Task[]> {
  const payloads: unknown[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await client.from('shiri_tasks')
      .select('payload').eq('user_id', userId).order('id')
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(cloudErrorMessage(error));
    payloads.push(...(data || []).map((row: { payload: unknown }) => row.payload));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return parseRemoteTasks(payloads);
}

/** Preserve task references when a different device has no local list metadata. */
export function listsForTasks(tasks: readonly Pick<Task, 'listId'>[], current: readonly TaskList[] = defaultData().lists): TaskList[] {
  const lists = current.map(list => ({ ...list }));
  for (const task of tasks) {
    if (!lists.some(list => list.id === task.listId)) {
      lists.push({ id: task.listId, name: `同步清单 ${lists.length + 1}`, color: '#6D8DCA' });
    }
  }
  return lists;
}

function parseRemoteTasks(payloads: unknown[]): Task[] {
  // Task-only sync retains IDs. The UI must also call listsForTasks when saving
  // a merged snapshot so its next backup validation has matching list records.
  const references = payloads.flatMap(payload => {
    const listId = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).listId : null;
    return typeof listId === 'string' ? [{ listId }] : [];
  });
  const lists = listsForTasks(references);
  const backup = validateBackup({ version: 1, tasks: payloads, lists });
  return backup.tasks;
}

/**
 * Local-first snapshot sync. Caller must isolate datasets by project + user ID,
 * and merge edits made while awaiting this promise into the returned snapshot.
 * LWW uses client timestamps, so badly incorrect device clocks affect ordering.
 */
export async function syncTasks(client: SupabaseClient, tasks: Task[]): Promise<Task[]> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('请先登录后再同步。');
  const userId = data.user.id;
  const before = await readTasks(client, userId);
  const merged = mergeTasks(parseRemoteTasks(tasks), before);
  for (let start = 0; start < merged.length; start += PAGE_SIZE) {
    const { error: mergeError } = await client.rpc('merge_tasks', {
      incoming: merged.slice(start, start + PAGE_SIZE),
      expected_user: userId,
    });
    if (mergeError) throw new Error(cloudErrorMessage(mergeError));
  }
  const canonical = await readTasks(client, userId);
  const { data: finalAuth, error: authError } = await client.auth.getUser();
  if (authError || finalAuth.user?.id !== userId) {
    throw new Error('同步期间账号发生变化，请在当前账号重新同步。');
  }
  return canonical;
}
