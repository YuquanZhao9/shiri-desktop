import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { TaskList, Timetable } from './types';
import { validateTimetable } from './timetable';

// 清单、课表同步与实时推送，电脑版和 iPhone 网页版共用。
// 云端需先运行 cloud/schema-v2.sql、schema-v3.sql；没运行时对应部分自动跳过，日程同步不受影响。

const snapshotKey = (storageKey: string) => `shiri-lists-synced:${storageKey}`;
const listJson = (list: TaskList) => JSON.stringify({ id: list.id, name: list.name, color: list.color });

function readSnapshot(storageKey: string): Map<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(snapshotKey(storageKey)) || '[]');
    return new Map(Array.isArray(raw) ? raw.filter((item): item is TaskList => !!item && typeof item.id === 'string').map(item => [item.id, listJson(item)]) : []);
  } catch { return new Map(); }
}

async function pullLists(client: SupabaseClient, userId: string): Promise<TaskList[] | null> {
  const { data, error } = await client.from('shiri_lists').select('payload').eq('user_id', userId).order('id');
  // 表还没建（只运行了第 1 版脚本）时，清单同步静默跳过，日程同步照常。
  if (error) return null;
  return (data || []).map((row: { payload: TaskList }) => row.payload)
    .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && /^#[0-9A-Fa-f]{6}$/.test(item.color));
}

/**
 * 清单同步：只上传本机改过的（与上次拉到的版本不同），其余以云端为准。
 * 另一台设备还没同步过清单时，本机用 listsForTasks 生成的“同步清单 N”占位名
 * 不会上传覆盖真实名称，因为云端已有同 ID 的清单且本机没有它的上次版本。
 */
export function planListSync(local: TaskList[], remote: TaskList[], snapshot: Map<string, string>) {
  const remoteById = new Map(remote.map(list => [list.id, list]));
  return local.filter(list => {
    const before = snapshot.get(list.id);
    // 占位名只是本机为了显示临时起的，真实名称在别的设备上，不能传上去。
    if (before === undefined) return !remoteById.has(list.id) && !PLACEHOLDER.test(list.name);
    return before !== listJson(list);
  });
}

const PLACEHOLDER = /^同步清单 \d+$/;

export function applyRemoteLists(local: TaskList[], canonical: TaskList[]): TaskList[] {
  const remoteById = new Map(canonical.map(list => [list.id, list]));
  const result = local.map(list => remoteById.get(list.id) ?? list);
  for (const list of canonical) if (!local.some(item => item.id === list.id)) result.push(list);
  return result;
}

/** 返回云端的全部清单（调用方用 applyRemoteLists 并入最新本机数据）；云端没建清单表时返回 null。 */
export async function syncLists(client: SupabaseClient, userId: string, storageKey: string, local: TaskList[]): Promise<TaskList[] | null> {
  const remote = await pullLists(client, userId);
  if (remote === null) return null;
  const push = planListSync(local, remote, readSnapshot(storageKey));
  if (push.length) {
    const { error } = await client.rpc('merge_lists', { incoming: push.map(list => JSON.parse(listJson(list))), expected_user: userId });
    if (error) return null;
  }
  const canonical = push.length ? await pullLists(client, userId) : remote;
  if (canonical === null) return null;
  localStorage.setItem(snapshotKey(storageKey), JSON.stringify(canonical));
  return canonical;
}

/**
 * 课表同步：每个账号一份，较新的 updatedAt 为准。本机更新就上传；
 * 时间戳相同时以云端为准，保证两端收敛。返回应保存的课表；云端没有且本机也没有时返回 undefined，
 * 云端没建课表表或读取失败时返回 null（调用方保持本机不变）。
 */
export async function syncTimetable(client: SupabaseClient, userId: string, local: Timetable | undefined): Promise<Timetable | undefined | null> {
  const { data, error } = await client.from('shiri_timetable').select('payload').eq('user_id', userId).maybeSingle();
  if (error) return null;
  let remote: Timetable | undefined;
  try { remote = data ? validateTimetable((data as { payload: unknown }).payload) : undefined; } catch { remote = undefined; }
  if (local && (!remote || local.updatedAt > remote.updatedAt)) {
    const { error: pushError } = await client.rpc('merge_timetable', { incoming: local, expected_user: userId });
    return pushError ? null : local;
  }
  return remote ?? local;
}

/** 另一台设备改了日程或清单时立即通知；手机从后台回来时由调用方再补一次同步。 */
export function subscribeLive(client: SupabaseClient, userId: string, onChange: () => void): () => void {
  const channel: RealtimeChannel = client.channel(`shiri-live-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shiri_tasks', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shiri_lists', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shiri_timetable', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => { void client.removeChannel(channel); };
}
