// 自动从 拾日/src/reflections.ts 复制，请勿手改；运行 node scripts/sync-shared.mjs 更新。
import type { Reflection } from './types.ts';

// 复盘：一条一条的感悟。回车就是一条，按天自动编号；每周日 20:00 提醒看本周汇总。

export const REFLECTION_MAX_TEXT = 5_000;
const MAX_ITEMS = 50_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
/** 每周日这个时间提醒看本周复盘汇总。 */
export const REVIEW_REMINDER_TIME = '20:00';

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return year >= 1 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
const validStamp = (value: unknown): value is string => typeof value === 'string' && STAMP.test(value) && new Date(value).toISOString() === value;

export function validateReflection(value: unknown): Reflection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('复盘格式不正确');
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!['id', 'date', 'text', 'createdAt', 'updatedAt', 'deletedAt'].includes(key)) throw new Error(`复盘包含未知字段：${key}`);
  if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id)) throw new Error('复盘 ID 无效');
  if (typeof item.date !== 'string' || !validDate(item.date)) throw new Error('复盘日期无效');
  if (typeof item.text !== 'string' || item.text.length > REFLECTION_MAX_TEXT || CONTROL.test(item.text)) throw new Error('复盘内容不正确或过长');
  if (!validStamp(item.createdAt) || !validStamp(item.updatedAt)) throw new Error('复盘时间无效');
  if (item.deletedAt !== undefined && !validStamp(item.deletedAt)) throw new Error('复盘删除时间无效');
  return { id: item.id, date: item.date, text: item.text, createdAt: item.createdAt, updatedAt: item.updatedAt, ...(item.deletedAt ? { deletedAt: item.deletedAt as string } : {}) };
}

export function validateReflections(input: unknown): Reflection[] {
  if (!Array.isArray(input) || input.length > MAX_ITEMS) throw new Error('复盘数量无效');
  const items = input.map(validateReflection);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('复盘 ID 重复');
  return items;
}

const revision = (item: Reflection) => item.deletedAt && item.deletedAt > item.updatedAt ? item.deletedAt : item.updatedAt;

/** 同一条取较新的；时间相同删除优先，再按内容决出，两端结果一致。 */
export function newerReflection(a: Reflection, b: Reflection): Reflection {
  const ra = revision(a), rb = revision(b);
  if (ra !== rb) return ra > rb ? a : b;
  if (!!a.deletedAt !== !!b.deletedAt) return a.deletedAt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function mergeReflections(a: Reflection[] = [], b: Reflection[] = []): Reflection[] {
  const byId = new Map<string, Reflection>();
  for (const item of [...a, ...b]) {
    const previous = byId.get(item.id);
    byId.set(item.id, previous ? newerReflection(previous, item) : item);
  }
  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
}

const clean = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, REFLECTION_MAX_TEXT);
const stamp = (now: number, after?: string) => new Date(Math.max(now, after ? Date.parse(after) + 1 : 0)).toISOString();

/** 记一条；空内容不记。 */
export function addReflection(list: Reflection[] | undefined, date: string, text: string, id: string, now = Date.now()): Reflection[] {
  const value = clean(text);
  if (!value || !validDate(date)) return list ?? [];
  const at = stamp(now);
  return [...(list ?? []), { id, date, text: value, createdAt: at, updatedAt: at }];
}

/** 改一条；改成空的就是删除。 */
export function editReflection(list: Reflection[] | undefined, id: string, text: string, now = Date.now()): Reflection[] {
  const items = list ?? [];
  const current = items.find(item => item.id === id);
  if (!current || current.deletedAt) return items;
  const value = clean(text);
  if (value === current.text) return items;
  const at = stamp(now, revision(current));
  const next: Reflection = value ? { ...current, text: value, updatedAt: at } : { ...current, updatedAt: at, deletedAt: at };
  return items.map(item => item.id === id ? next : item);
}

export function deleteReflection(list: Reflection[] | undefined, id: string, now = Date.now()): Reflection[] {
  return editReflection(list, id, '', now);
}

/** 没删的，按日期、再按记下的先后。 */
export function activeReflections(list: Reflection[] | undefined): Reflection[] {
  return (list ?? []).filter(item => !item.deletedAt).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** 按天分组，最近的日子在前；每天里按先后编号。 */
export function reflectionsByDay(list: Reflection[] | undefined): { date: string; items: Reflection[] }[] {
  const groups = new Map<string, Reflection[]>();
  for (const item of activeReflections(list)) groups.set(item.date, [...(groups.get(item.date) ?? []), item]);
  return [...groups.entries()].map(([date, items]) => ({ date, items })).sort((a, b) => b.date.localeCompare(a.date));
}

function keyOf(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function noon(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(2000, m - 1, d, 12);
  date.setFullYear(y);
  return date;
}

/** 某天所在的一周（周一到周日）。 */
export function weekRange(date: string): { start: string; end: string } {
  const day = noon(date);
  const monday = new Date(day);
  monday.setDate(day.getDate() - (day.getDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: keyOf(monday), end: keyOf(sunday) };
}

export function monthRange(date: string): { start: string; end: string } {
  const day = noon(date);
  return { start: keyOf(new Date(day.getFullYear(), day.getMonth(), 1, 12)), end: keyOf(new Date(day.getFullYear(), day.getMonth() + 1, 0, 12)) };
}

/** 往前或往后挪一周 / 一个月，返回新范围里的某一天。 */
export function shiftRange(date: string, kind: 'week' | 'month', step: number): string {
  const day = noon(date);
  if (kind === 'week') day.setDate(day.getDate() + step * 7);
  else day.setMonth(day.getMonth() + step, 1);
  return keyOf(day);
}

export function reflectionsBetween(list: Reflection[] | undefined, start: string, end: string): Reflection[] {
  return activeReflections(list).filter(item => item.date >= start && item.date <= end);
}

/** 本周日 20:00 提醒看汇总（这周写过才提醒，已过的不算）。 */
export function reviewReminders(list: Reflection[] | undefined, now = Date.now()): { id: string; title: string; body: string; at: number }[] {
  const today = keyOf(new Date(now));
  const { start, end } = weekRange(today);
  const count = reflectionsBetween(list, start, end).length;
  const [hour, minute] = REVIEW_REMINDER_TIME.split(':').map(Number);
  const at = noon(end);
  at.setHours(hour, minute, 0, 0);
  if (!count || at.getTime() <= now) return [];
  return [{ id: `review:${end}`, title: '本周复盘汇总好了', body: `这周写下了 ${count} 条感悟，打开昱时 → 复盘 → 本周汇总看看吧`, at: at.getTime() }];
}
