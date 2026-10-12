import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { JournalEntry, Reflection, TaskList, Timetable } from './types';
import { mergeReflections, newerReflection, validateReflection } from './reflections';
import { mergeItems, newerItem, validateGoal, validateMark } from './weekly';
import type { ClassMark, GoalMark, WeeklyGoal } from './types';
import { validateClassMark } from './classes';
import { validateTimetable } from './timetable';
import { mergeJournal, newerEntry, validateJournalEntry } from './journal';

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

/**
 * 日记同步：云端每天一行，较新的 updatedAt 为准（同 src/journal.ts newerEntry）。
 * 只上传本机比云端新的；返回本机与云端合并后的日记，调用方再用 mergeJournal 并入同步期间的新改动。
 * 云端没建日记表（schema-v5.sql）或读取失败时返回 null，本机保持不变。
 */
export async function syncJournal(client: SupabaseClient, userId: string, local: JournalEntry[] = []): Promise<JournalEntry[] | null> {
  const remote: JournalEntry[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await client.from('shiri_journal').select('payload').eq('user_id', userId).order('day').range(start, start + 499);
    if (error) return null;
    for (const row of (data || []) as { payload: unknown }[]) { try { remote.push(validateJournalEntry(row.payload)); } catch { /* 跳过损坏的一行 */ } }
    if (!data || data.length < 500) break;
  }
  const push = journalToPush(local, remote);
  for (let start = 0; start < push.length; start += 200) {
    const { error } = await client.rpc('merge_journal', { incoming: push.slice(start, start + 200), expected_user: userId });
    if (error) return null;
  }
  return mergeJournal(local, remote);
}

/**
 * 复盘同步：云端每条一行，较新的为准（同 src/reflections.ts newerReflection）。
 * 云端没建复盘表（schema-v6.sql）或读取失败时返回 null。
 */
export async function syncReflections(client: SupabaseClient, userId: string, local: Reflection[] = []): Promise<Reflection[] | null> {
  const remote: Reflection[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await client.from('shiri_reflections').select('payload').eq('user_id', userId).order('id').range(start, start + 499);
    if (error) return null;
    for (const row of (data || []) as { payload: unknown }[]) { try { remote.push(validateReflection(row.payload)); } catch { /* 跳过损坏的一行 */ } }
    if (!data || data.length < 500) break;
  }
  const push = reflectionsToPush(local, remote);
  for (let start = 0; start < push.length; start += 200) {
    const { error } = await client.rpc('merge_reflections', { incoming: push.slice(start, start + 200), expected_user: userId });
    if (error) return null;
  }
  return mergeReflections(local, remote);
}

/**
 * 周次任务同步：任务和打卡都放在 shiri_weekly 表，每条一行（kind = goal / mark），较新的为准。
 * 云端没建表（schema-v7.sql）或读取失败时返回 null。
 */
export async function syncWeekly(client: SupabaseClient, userId: string, goals: WeeklyGoal[] = [], marks: GoalMark[] = [], classMarks: ClassMark[] = []): Promise<{ goals: WeeklyGoal[]; marks: GoalMark[]; classMarks: ClassMark[] } | null> {
  const remoteGoals: WeeklyGoal[] = [], remoteMarks: GoalMark[] = [], remoteClasses: ClassMark[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await client.from('shiri_weekly').select('kind,payload').eq('user_id', userId).order('id').range(start, start + 499);
    if (error) return null;
    for (const row of (data || []) as { kind: string; payload: unknown }[]) {
      try { if (row.kind === 'goal') remoteGoals.push(validateGoal(row.payload)); else if (row.kind === 'class') remoteClasses.push(validateClassMark(row.payload)); else remoteMarks.push(validateMark(row.payload)); } catch { /* 跳过损坏的一行 */ }
    }
    if (!data || data.length < 500) break;
  }
  const newer = <T extends { id: string; updatedAt: string; deletedAt?: string }>(local: T[], remote: T[]) => {
    const byId = new Map(remote.map(item => [item.id, item]));
    return local.filter(item => { const other = byId.get(item.id); return !other || newerItem(item, other) === item && JSON.stringify(item) !== JSON.stringify(other); });
  };
  const push = [...newer(goals, remoteGoals).map(item => ({ kind: 'goal', item })), ...newer(marks, remoteMarks).map(item => ({ kind: 'mark', item })), ...newer(classMarks, remoteClasses).map(item => ({ kind: 'class', item }))];
  for (let start = 0; start < push.length; start += 200) {
    const { error } = await client.rpc('merge_weekly', { incoming: push.slice(start, start + 200), expected_user: userId });
    if (error) return null;
  }
  return { goals: mergeItems(goals, remoteGoals), marks: mergeItems(marks, remoteMarks), classMarks: mergeItems(classMarks, remoteClasses) };
}

export function reflectionsToPush(local: Reflection[], remote: Reflection[]): Reflection[] {
  const byId = new Map(remote.map(item => [item.id, item]));
  return local.filter(item => { const other = byId.get(item.id); return !other || newerReflection(item, other) === item && JSON.stringify(item) !== JSON.stringify(other); });
}

/** 本机比云端新的日记（云端没有的也算）。 */
export function journalToPush(local: JournalEntry[], remote: JournalEntry[]): JournalEntry[] {
  const remoteByDate = new Map(remote.map(entry => [entry.date, entry]));
  return local.filter(entry => { const other = remoteByDate.get(entry.date); return !other || newerEntry(entry, other) === entry && JSON.stringify(entry) !== JSON.stringify(other); });
}

/** 另一台设备改了日程或清单时立即通知；手机从后台回来时由调用方再补一次同步。 */
export function subscribeLive(client: SupabaseClient, userId: string, onChange: () => void): () => void {
  const channel: RealtimeChannel = client.channel(`shiri-live-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shiri_tasks', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shiri_lists', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shiri_timetable', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shiri_journal', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shiri_reflections', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shiri_weekly', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => { void client.removeChannel(channel); };
}
