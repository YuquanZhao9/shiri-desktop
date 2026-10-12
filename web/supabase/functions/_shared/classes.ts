// 自动从 拾日/src/classes.ts 复制，请勿手改；运行 node scripts/sync-shared.mjs 更新。
import type { ClassMark, ClassStatus } from './types.ts';

// 每节课（某门课在某一天）的状态：已上 / 未上 / 待复习，外加一句备注。
// 没记过的：已经下课的算“已上”，还没下课的算“还没到”。

export const CLASS_STATUS_LABEL: Record<ClassStatus, string> = { done: '已上', todo: '未上', review: '待复习' };
export type ClassState = ClassStatus | 'upcoming';

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const validStamp = (value: unknown): value is string => typeof value === 'string' && STAMP.test(value) && new Date(value).toISOString() === value;

export function classMarkId(slotId: string, date: string): string {
  return `class_${slotId}_${date.replace(/-/g, '')}`.slice(0, 128);
}

export function validateClassMark(value: unknown): ClassMark {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('课程状态格式不正确');
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!['id', 'slotId', 'date', 'title', 'status', 'note', 'createdAt', 'updatedAt', 'deletedAt'].includes(key)) throw new Error(`课程状态包含未知字段：${key}`);
  if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || typeof item.slotId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.slotId)) throw new Error('课程状态 ID 无效');
  if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw new Error('课程日期无效');
  if (typeof item.title !== 'string' || item.title.length > 120) throw new Error('课程名称无效');
  if (item.status !== 'done' && item.status !== 'todo' && item.status !== 'review') throw new Error('课程状态无效');
  if (typeof item.note !== 'string' || item.note.length > 2000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(item.note)) throw new Error('课程备注无效');
  if (!validStamp(item.createdAt) || !validStamp(item.updatedAt) || (item.deletedAt !== undefined && !validStamp(item.deletedAt))) throw new Error('课程状态时间无效');
  return { id: item.id, slotId: item.slotId, date: item.date, title: item.title, status: item.status, note: item.note, createdAt: item.createdAt, updatedAt: item.updatedAt, ...(item.deletedAt ? { deletedAt: item.deletedAt as string } : {}) };
}

export function validateClassMarks(input: unknown): ClassMark[] {
  if (!Array.isArray(input) || input.length > 20_000) throw new Error('课程状态数量无效');
  const items = input.map(validateClassMark);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('课程状态 ID 重复');
  return items;
}

export function classMarkFor(marks: ClassMark[] | undefined, slotId: string, date: string): ClassMark | undefined {
  const id = classMarkId(slotId, date);
  return marks?.find(mark => mark.id === id && !mark.deletedAt);
}

/** 这节课现在的状态；没记过的按是否已经下课推断。 */
export function classState(mark: ClassMark | undefined, date: string, end: string, now = Date.now()): ClassState {
  if (mark) return mark.status;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = end.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime() <= now ? 'done' : 'upcoming';
}

/** 单击切换：已上 → 待复习 → 未上 → 已上；还没到的先变成已上。 */
export function nextClassState(state: ClassState): ClassStatus {
  return state === 'done' ? 'review' : state === 'review' ? 'todo' : 'done';
}

/** 记下某节课的状态和备注。 */
export function setClassMark(marks: ClassMark[] | undefined, slot: { id: string; title: string }, date: string, status: ClassStatus, note?: string, now = Date.now()): ClassMark[] {
  const list = marks ?? [];
  const id = classMarkId(slot.id, date);
  const current = list.find(mark => mark.id === id);
  const value = { status, note: (note ?? current?.note ?? '').replace(/\r\n?/g, '\n').slice(0, 2000), title: slot.title.slice(0, 120) };
  if (current && !current.deletedAt && current.status === value.status && current.note === value.note && current.title === value.title) return list;
  const previous = current ? (current.deletedAt && current.deletedAt > current.updatedAt ? current.deletedAt : current.updatedAt) : undefined;
  const stamp = new Date(Math.max(now, previous ? Date.parse(previous) + 1 : 0)).toISOString();
  const next: ClassMark = { id, slotId: slot.id, date, ...value, createdAt: current?.createdAt ?? stamp, updatedAt: stamp };
  return [...list.filter(mark => mark.id !== id), next];
}

/** 待复习的课，最早的在前。 */
export function reviewClasses(marks: ClassMark[] | undefined): ClassMark[] {
  return (marks ?? []).filter(mark => !mark.deletedAt && mark.status === 'review').sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
