// 昱时 AI 同步接口：AI 对话或自动任务用“AI 同步令牌”读写这个账号的日程和体重记录。
// 部署：supabase functions deploy ai-sync --no-verify-jwt --use-api（先运行 node scripts/sync-shared.mjs）
// 令牌只存 SHA-256 哈希（表 shiri_ai_tokens）；写入 shiri_tasks 后，电脑和手机经实时推送几秒内更新。
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { defaultData } from '../_shared/core.ts';
import { validateTimetable as checkTimetable } from '../_shared/timetable.ts';
import { validateWeight } from '../_shared/weight.ts';
import { ApiError, applyFields, assertStorable, bad, busy, checkRange, eventView, free, getWeight, listWeights, newTask, nextStamp, occurrences, parseState, removeWeight, setDone, weightView, writeWeight, type Task, type TaskList, type Timetable, type WeightEntry } from './ops.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const MAX_OPS = 50;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

interface Ctx {
  userId: string; now: number;
  tasks: Map<string, Task>; lists: TaskList[]; timetable?: Timetable;
  stored: Map<string, string>; // taskId -> 读取时云端的 modified_at，写入前用来检查有没有被别的设备改过
  links: Map<string, string>; // externalId -> taskId
  dirty: Map<string, Task>; newLinks: { external_id: string; task_id: string; source: string }[];
  weights: WeightEntry[]; weightStored: Map<string, string>; weightDirty: Map<string, WeightEntry>;
}

async function load(userId: string): Promise<Ctx> {
  const [tasks, lists, timetable, links, weights] = await Promise.all([
    admin.from('shiri_tasks').select('payload, modified_at').eq('user_id', userId),
    admin.from('shiri_lists').select('payload').eq('user_id', userId),
    admin.from('shiri_timetable').select('payload').eq('user_id', userId).maybeSingle(),
    admin.from('shiri_ai_links').select('external_id, task_id').eq('user_id', userId),
    admin.from('shiri_weekly').select('payload, updated_at').eq('user_id', userId).eq('kind', 'weight'),
  ]);
  for (const result of [tasks, lists, timetable, links, weights]) if (result.error) throw new ApiError(500, 'storage_error', result.error.message);
  const listRows = (lists.data ?? []).map((row: { payload: TaskList }) => row.payload);
  let table: Timetable | undefined;
  try { table = timetable.data ? checkTimetable((timetable.data as { payload: unknown }).payload) : undefined; } catch { table = undefined; }
  return {
    userId, now: Date.now(),
    tasks: new Map((tasks.data ?? []).map((row: { payload: Task }) => [row.payload.id, row.payload])),
    stored: new Map((tasks.data ?? []).map((row: { payload: Task; modified_at: string }) => [row.payload.id, row.modified_at])),
    lists: listRows.length ? listRows : defaultData().lists,
    timetable: table,
    links: new Map((links.data ?? []).map((row: { external_id: string; task_id: string }) => [row.external_id, row.task_id])),
    dirty: new Map(), newLinks: [],
    ...loadWeights((weights.data ?? []) as { payload: unknown; updated_at: string }[]),
  };
}

function loadWeights(rows: { payload: unknown; updated_at: string }[]) {
  const weights: WeightEntry[] = [], weightStored = new Map<string, string>();
  for (const row of rows) {
    try { const entry = validateWeight(row.payload); weights.push(entry); weightStored.set(entry.id, row.updated_at); } catch { /* 跳过损坏的一行 */ }
  }
  return { weights, weightStored, weightDirty: new Map<string, WeightEntry>() };
}

function keepWeight(ctx: Ctx, list: WeightEntry[], entry?: WeightEntry) {
  ctx.weights = list;
  if (entry) ctx.weightDirty.set(entry.id, entry);
}

function live(ctx: Ctx, id: unknown): Task {
  if (typeof id !== 'string' || !id) throw bad('缺少 id');
  const task = ctx.tasks.get(id);
  if (!task || task.deletedAt) throw new ApiError(404, 'not_found', `找不到日程 ${id}（可能已删除）`);
  return task;
}

function save(ctx: Ctx, task: Task): Task {
  const stored = assertStorable(task, ctx.lists);
  ctx.tasks.set(stored.id, stored); ctx.dirty.set(stored.id, stored);
  return stored;
}

function externalOf(ctx: Ctx): Map<string, string> {
  return new Map([...ctx.links].map(([ext, id]) => [id, ext]));
}

function externalId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) throw bad('externalId 为 1–300 字的文字');
  return value.trim();
}

function run(ctx: Ctx, op: Record<string, unknown>): unknown {
  const ids = () => externalOf(ctx);
  switch (op.action) {
    case 'info':
      return { lists: ctx.lists.map(({ id, name, color }) => ({ id, name, color })), timetable: ctx.timetable ? ctx.timetable.name : null, timezoneNote: '所有日期和时间都是用户当地时间（Europe/Berlin），格式 YYYY-MM-DD / HH:mm', serverTime: new Date(ctx.now).toISOString() };
    case 'list': {
      const [from, to] = checkRange(op.from, op.to);
      const inbox = op.includeInbox === true ? [...ctx.tasks.values()].filter(t => !t.deletedAt && !t.date).map(t => eventView(t, ctx.lists, ids().get(t.id))) : undefined;
      return { events: occurrences([...ctx.tasks.values()], ctx.lists, from, to, op.query, ids()), ...(inbox ? { inbox } : {}) };
    }
    case 'get': return { event: eventView(live(ctx, op.id), ctx.lists, ids().get(String(op.id))) };
    case 'find': {
      const task = ctx.tasks.get(ctx.links.get(externalId(op.externalId)) ?? '');
      return { event: task && !task.deletedAt ? eventView(task, ctx.lists, String(op.externalId).trim()) : null, deleted: !!task?.deletedAt };
    }
    case 'create': {
      const task = save(ctx, newTask(crypto.randomUUID(), ctx.now, ctx.lists, op.event));
      return { event: eventView(task, ctx.lists) };
    }
    case 'upsert': {
      const ext = externalId(op.externalId);
      const source = typeof op.source === 'string' ? op.source.slice(0, 60) : 'ai';
      const existing = ctx.tasks.get(ctx.links.get(ext) ?? '');
      // 用户已经删掉的就不再加回来（例如同一封邮件被再次处理）。
      if (existing?.deletedAt) return { status: 'skipped_deleted', event: null };
      // 已经做完的也不改（2026-10-21 同一封邮件里的新事项把已完成的旧日程改掉了）；确实要改就传 force: true，
      // 或者换一个 externalId 新建。
      if (existing && existing.repeat === 'none' && existing.completed && op.force !== true) return { status: 'skipped_completed', event: eventView(existing, ctx.lists, ext) };
      if (existing) {
        const next = applyFields(existing, op.event, ctx.lists);
        if (JSON.stringify({ ...next, updatedAt: '' }) === JSON.stringify({ ...existing, updatedAt: '' })) return { status: 'unchanged', event: eventView(existing, ctx.lists, ext) };
        return { status: 'updated', event: eventView(save(ctx, { ...next, updatedAt: nextStamp(ctx.now, existing.updatedAt) }), ctx.lists, ext) };
      }
      const task = save(ctx, newTask(crypto.randomUUID(), ctx.now, ctx.lists, op.event));
      ctx.links.set(ext, task.id); ctx.newLinks.push({ external_id: ext, task_id: task.id, source });
      return { status: 'created', event: eventView(task, ctx.lists, ext) };
    }
    case 'update': {
      const current = live(ctx, op.id);
      const next = applyFields(current, op.changes, ctx.lists);
      return { event: eventView(save(ctx, { ...next, updatedAt: nextStamp(ctx.now, current.updatedAt) }), ctx.lists, ids().get(current.id)) };
    }
    case 'complete': {
      const current = live(ctx, op.id);
      if (op.done !== undefined && typeof op.done !== 'boolean') throw bad('done 为 true / false');
      const next = setDone(current, op.date, op.done !== false);
      return { event: eventView(save(ctx, { ...next, updatedAt: nextStamp(ctx.now, current.updatedAt) }), ctx.lists, ids().get(current.id)) };
    }
    case 'delete': {
      const current = live(ctx, op.id);
      const at = nextStamp(ctx.now, current.updatedAt);
      save(ctx, { ...current, updatedAt: at, deletedAt: at });
      return { deleted: current.id };
    }
    case 'busy': {
      const [from, to] = checkRange(op.from, op.to, 62);
      return busy([...ctx.tasks.values()], ctx.timetable, from, to, parseState(op.state));
    }
    case 'free': {
      const [from, to] = checkRange(op.from, op.to, 62);
      return { days: free(busy([...ctx.tasks.values()], ctx.timetable, from, to, parseState(op.state)).days, op) };
    }
    case 'weight_list': return { weights: listWeights(ctx.weights, op.from, op.to) };
    case 'weight_get': return { weight: getWeight(ctx.weights, op.date) };
    case 'weight_set': {
      const { list, entry, status } = writeWeight(ctx.weights, op.date, op.kg, ctx.now);
      keepWeight(ctx, list, status === 'unchanged' ? undefined : entry);
      return { status, weight: weightView(entry) };
    }
    case 'weight_delete': {
      const { list, entry, deleted } = removeWeight(ctx.weights, op.date, ctx.now);
      keepWeight(ctx, list, entry);
      return { deleted };
    }
    default:
      throw bad('action 只能是 info / list / get / find / create / upsert / update / complete / delete / busy / free / weight_list / weight_get / weight_set / weight_delete', 'unknown_action');
  }
}

async function commit(ctx: Ctx) {
  if (ctx.dirty.size) {
    // 读取到写入之间，电脑或手机可能刚改过同一条；直接覆盖会把那次修改丢掉。有变化就整批放弃，让调用方重新读取再试。
    const ids = [...ctx.dirty.keys()].filter(id => ctx.stored.has(id));
    if (ids.length) {
      const { data, error } = await admin.from('shiri_tasks').select('id, modified_at').eq('user_id', ctx.userId).in('id', ids);
      if (error) throw new ApiError(500, 'storage_error', error.message);
      const changed = (data ?? []).filter((row: { id: string; modified_at: string }) => Date.parse(row.modified_at) !== Date.parse(ctx.stored.get(row.id)!));
      if (changed.length) throw new ApiError(409, 'conflict', `日程 ${changed.map((row: { id: string }) => row.id).join('、')} 刚在别的设备上改过，这次没有写入，请重新读取后再试`);
    }
    const rows = [...ctx.dirty.values()].map(task => ({
      user_id: ctx.userId, id: task.id, payload: task, deleted: !!task.deletedAt,
      modified_at: task.deletedAt && task.deletedAt > task.updatedAt ? task.deletedAt : task.updatedAt,
    }));
    const { error } = await admin.from('shiri_tasks').upsert(rows, { onConflict: 'user_id,id' });
    if (error) throw new ApiError(500, 'storage_error', error.message);
  }
  if (ctx.weightDirty.size) {
    // 和日程一样：读取后别的设备改过同一天，就整批不写，让调用方重新读取再试。
    const ids = [...ctx.weightDirty.keys()];
    const { data, error } = await admin.from('shiri_weekly').select('id, updated_at').eq('user_id', ctx.userId).eq('kind', 'weight').in('id', ids);
    if (error) throw new ApiError(500, 'storage_error', error.message);
    const changed = (data ?? []).filter((row: { id: string; updated_at: string }) => !ctx.weightStored.has(row.id) || Date.parse(row.updated_at) !== Date.parse(ctx.weightStored.get(row.id)!));
    if (changed.length) throw new ApiError(409, 'conflict', `体重 ${changed.map((row: { id: string }) => row.id.slice(7)).join('、')} 刚在别的设备上改过，这次没有写入，请重新读取后再试`);
    const rows = [...ctx.weightDirty.values()].map(entry => ({
      user_id: ctx.userId, id: entry.id, kind: 'weight', day: entry.date, payload: entry, deleted: !!entry.deletedAt,
      updated_at: entry.deletedAt && entry.deletedAt > entry.updatedAt ? entry.deletedAt : entry.updatedAt,
    }));
    const { error: writeError } = await admin.from('shiri_weekly').upsert(rows, { onConflict: 'user_id,id' });
    if (writeError) throw new ApiError(500, 'storage_error', writeError.message);
  }
  if (ctx.newLinks.length) {
    const { error } = await admin.from('shiri_ai_links').upsert(ctx.newLinks.map(link => ({ ...link, user_id: ctx.userId })), { onConflict: 'user_id,external_id' });
    if (error) throw new ApiError(500, 'storage_error', error.message);
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed', '请用 POST');
    const token = /^Bearer\s+(yst_[A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) throw new ApiError(401, 'invalid_token', '缺少或无效的 AI 同步令牌（Authorization: Bearer yst_…）');
    const { data: owner, error } = await admin.from('shiri_ai_tokens').select('user_id').eq('token_hash', await sha256(token)).maybeSingle();
    if (error) throw new ApiError(500, 'storage_error', error.message);
    if (!owner) throw new ApiError(401, 'invalid_token', '令牌无效或已撤销，请在昱时里重新生成');

    const text = await request.text();
    if (text.length > 1_000_000) throw new ApiError(413, 'too_large', '请求超过 1 MB');
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw bad('请求体必须是 JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('请求体必须是 JSON 对象');
    const batch = Array.isArray((body as { operations?: unknown }).operations) ? (body as { operations: unknown[] }).operations : null;
    if (batch && batch.length > MAX_OPS) throw bad(`一次最多 ${MAX_OPS} 个操作`);

    const ctx = await load(owner.user_id);
    await admin.from('shiri_ai_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', await sha256(token));

    if (!batch) {
      const result = run(ctx, body as Record<string, unknown>);
      await commit(ctx);
      return json({ ok: true, ...(result as object) });
    }
    // 批量：逐个执行，单个失败不影响其他，最后一次性写入。
    const results = batch.map(op => {
      try {
        if (!op || typeof op !== 'object' || Array.isArray(op)) throw bad('每个操作必须是对象');
        return { ok: true, ...(run(ctx, op as Record<string, unknown>) as object) };
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(500, 'internal_error', String(e));
        return { ok: false, error: { code: err.code, message: err.message } };
      }
    });
    await commit(ctx);
    return json({ ok: true, results });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(500, 'internal_error', e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: { code: err.code, message: err.message } }, err.status);
  }
});
