// 自动从 拾日/src/weekly.ts 复制，请勿手改；运行 node scripts/sync-shared.mjs 更新。
import type { GoalMark, WeeklyGoal } from './types.ts';
import { weekRange } from './reflections.ts';

// 周次任务：每周做几次、不定具体时间（如 健身 3 次、德语 2 次）。
// 每个任务有 slots 个格子（默认比目标多一格），这周里任选其中 target 个完成就算达标。
// 打卡 = 某天的一条完成记录；也可以先把一格“安排”到某天，到时再点完成。每周一自动重新开始。

export const GOAL_COLORS = ['#3FA66B', '#3B7DDD', '#E5534B', '#F08C2E', '#8B5CF6', '#1FA3A3', '#D6559A', '#D6A92B'];
/** 周五这个时间，还差 2 次及以上的任务提醒一次。 */
export const GOAL_REMINDER_TIME = '19:00';
const MAX = 20_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

const validStamp = (value: unknown): value is string => typeof value === 'string' && STAMP.test(value) && new Date(value).toISOString() === value;
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(2000, m - 1, d));
  date.setUTCFullYear(y);
  return y >= 1 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
function only(item: Record<string, unknown>, keys: string[], label: string) {
  for (const key of Object.keys(item)) if (!keys.includes(key)) throw new Error(`${label}包含未知字段：${key}`);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value as Record<string, unknown>;
}
function stamps(item: Record<string, unknown>, label: string) {
  if (!validStamp(item.createdAt) || !validStamp(item.updatedAt)) throw new Error(`${label}时间无效`);
  if (item.deletedAt !== undefined && !validStamp(item.deletedAt)) throw new Error(`${label}删除时间无效`);
  return { createdAt: item.createdAt, updatedAt: item.updatedAt, ...(item.deletedAt ? { deletedAt: item.deletedAt as string } : {}) };
}

export function validateGoal(value: unknown): WeeklyGoal {
  const item = record(value, '周次任务');
  only(item, ['id', 'name', 'color', 'target', 'slots', 'createdAt', 'updatedAt', 'deletedAt'], '周次任务');
  if (typeof item.id !== 'string' || !ID.test(item.id)) throw new Error('周次任务 ID 无效');
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40 || /[\u0000-\u001F]/.test(item.name)) throw new Error('周次任务名称无效');
  if (typeof item.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(item.color)) throw new Error('周次任务颜色无效');
  if (!Number.isInteger(item.target) || (item.target as number) < 1 || (item.target as number) > 14) throw new Error('每周次数须为 1 至 14');
  if (!Number.isInteger(item.slots) || (item.slots as number) < (item.target as number) || (item.slots as number) > 14) throw new Error('格子数不能少于每周次数');
  return { id: item.id, name: item.name, color: item.color, target: item.target as number, slots: item.slots as number, ...stamps(item, '周次任务') };
}

export function validateMark(value: unknown): GoalMark {
  const item = record(value, '打卡');
  only(item, ['id', 'goalId', 'date', 'done', 'createdAt', 'updatedAt', 'deletedAt'], '打卡');
  if (typeof item.id !== 'string' || !ID.test(item.id) || typeof item.goalId !== 'string' || !ID.test(item.goalId)) throw new Error('打卡 ID 无效');
  if (!validDate(item.date)) throw new Error('打卡日期无效');
  if (typeof item.done !== 'boolean') throw new Error('打卡状态无效');
  return { id: item.id, goalId: item.goalId, date: item.date, done: item.done, ...stamps(item, '打卡') };
}

function validateList<T extends { id: string }>(input: unknown, one: (value: unknown) => T, label: string): T[] {
  if (!Array.isArray(input) || input.length > MAX) throw new Error(`${label}数量无效`);
  const items = input.map(one);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error(`${label} ID 重复`);
  return items;
}
export const validateGoals = (input: unknown) => validateList(input, validateGoal, '周次任务');
export const validateMarks = (input: unknown) => validateList(input, validateMark, '打卡');

type Versioned = { id: string; updatedAt: string; deletedAt?: string };
const revision = (item: Versioned) => item.deletedAt && item.deletedAt > item.updatedAt ? item.deletedAt : item.updatedAt;

/** 同一条取较新的；时间相同删除优先，再按内容决出，两端结果一致。 */
export function newerItem<T extends Versioned>(a: T, b: T): T {
  const ra = revision(a), rb = revision(b);
  if (ra !== rb) return ra > rb ? a : b;
  if (!!a.deletedAt !== !!b.deletedAt) return a.deletedAt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
export function mergeItems<T extends Versioned>(a: T[] = [], b: T[] = []): T[] {
  const byId = new Map<string, T>();
  for (const item of [...a, ...b]) { const previous = byId.get(item.id); byId.set(item.id, previous ? newerItem(previous, item) : item); }
  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
}

const at = (now: number, after?: string) => new Date(Math.max(now, after ? Date.parse(after) + 1 : 0)).toISOString();

export function activeGoals(goals: WeeklyGoal[] | undefined): WeeklyGoal[] {
  return (goals ?? []).filter(goal => !goal.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function saveGoal(goals: WeeklyGoal[] | undefined, goal: { id: string; name: string; color: string; target: number; slots: number }, now = Date.now()): WeeklyGoal[] {
  const list = goals ?? [];
  const current = list.find(item => item.id === goal.id);
  const target = Math.min(14, Math.max(1, Math.round(goal.target)));
  const next = { id: goal.id, name: goal.name.trim().slice(0, 40), color: goal.color, target, slots: Math.min(14, Math.max(target, Math.round(goal.slots))) };
  if (!next.name) return list;
  if (current && !current.deletedAt && ['name', 'color', 'target', 'slots'].every(key => current[key as keyof WeeklyGoal] === next[key as keyof typeof next])) return list;
  const stamp = at(now, current ? revision(current) : undefined);
  const saved: WeeklyGoal = { ...next, createdAt: current?.createdAt ?? stamp, updatedAt: stamp };
  return [...list.filter(item => item.id !== goal.id), saved];
}

export function deleteGoal(goals: WeeklyGoal[] | undefined, id: string, now = Date.now()): WeeklyGoal[] {
  return (goals ?? []).map(goal => goal.id === id && !goal.deletedAt ? { ...goal, updatedAt: at(now, revision(goal)), deletedAt: at(now, revision(goal)) } : goal);
}

/** 某天完成一次（done）或先安排到某天（planned）。 */
export function addMark(marks: GoalMark[] | undefined, goalId: string, date: string, done: boolean, id: string, now = Date.now()): GoalMark[] {
  if (!validDate(date)) return marks ?? [];
  const stamp = at(now);
  return [...(marks ?? []), { id, goalId, date, done, createdAt: stamp, updatedAt: stamp }];
}
export function setMarkDone(marks: GoalMark[] | undefined, id: string, done: boolean, now = Date.now()): GoalMark[] {
  return (marks ?? []).map(mark => mark.id === id && !mark.deletedAt && mark.done !== done ? { ...mark, done, updatedAt: at(now, revision(mark)) } : mark);
}
export function removeMark(marks: GoalMark[] | undefined, id: string, now = Date.now()): GoalMark[] {
  return (marks ?? []).map(mark => mark.id === id && !mark.deletedAt ? { ...mark, updatedAt: at(now, revision(mark)), deletedAt: at(now, revision(mark)) } : mark);
}

export function activeMarks(marks: GoalMark[] | undefined): GoalMark[] {
  return (marks ?? []).filter(mark => !mark.deletedAt).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export interface GoalWeek {
  goal: WeeklyGoal;
  done: GoalMark[];
  planned: GoalMark[];
  /** 还差几次达标。 */
  remaining: number;
  reached: boolean;
  /** 每个格子：已完成 / 已安排 / 空。超出格子数的完成也照样算。 */
  cells: ({ kind: 'done' | 'planned'; mark: GoalMark } | { kind: 'empty' })[];
}

/** 某天所在那周（周一到周日）每个任务的进度。 */
export function goalWeeks(goals: WeeklyGoal[] | undefined, marks: GoalMark[] | undefined, date: string): GoalWeek[] {
  const { start, end } = weekRange(date);
  const inWeek = activeMarks(marks).filter(mark => mark.date >= start && mark.date <= end);
  return activeGoals(goals).map(goal => {
    const mine = inWeek.filter(mark => mark.goalId === goal.id);
    const done = mine.filter(mark => mark.done), planned = mine.filter(mark => !mark.done);
    const cells: GoalWeek['cells'] = [...done.map(mark => ({ kind: 'done' as const, mark })), ...planned.map(mark => ({ kind: 'planned' as const, mark }))];
    while (cells.length < goal.slots) cells.push({ kind: 'empty' });
    return { goal, done, planned, remaining: Math.max(0, goal.target - done.length), reached: done.length >= goal.target, cells };
  });
}

/** 某天的打卡（含安排），给日期格显示小标记。 */
export function marksOn(goals: WeeklyGoal[] | undefined, marks: GoalMark[] | undefined, date: string): { goal: WeeklyGoal; mark: GoalMark }[] {
  const byId = new Map(activeGoals(goals).map(goal => [goal.id, goal]));
  return activeMarks(marks).filter(mark => mark.date === date && byId.has(mark.goalId)).map(mark => ({ goal: byId.get(mark.goalId)!, mark }));
}

function shiftWeek(date: string, weeks: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const value = new Date(y, m - 1, d + weeks * 7, 12);
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** 最近几周（含本周）每周完成几次，最早的在前；任务创建之前的周不算。 */
export function goalHistory(goal: WeeklyGoal, marks: GoalMark[] | undefined, today: string, weeks = 8): { start: string; done: number; reached: boolean }[] {
  const created = weekRange(goal.createdAt.slice(0, 10)).start;
  const result: { start: string; done: number; reached: boolean }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const { start, end } = weekRange(shiftWeek(today, -i));
    if (end < created) continue;
    const done = activeMarks(marks).filter(mark => mark.goalId === goal.id && mark.done && mark.date >= start && mark.date <= end).length;
    result.push({ start, done, reached: done >= goal.target });
  }
  return result;
}

/** 本周五 19:00：还差 2 次及以上的任务提醒一次。 */
export function goalReminders(goals: WeeklyGoal[] | undefined, marks: GoalMark[] | undefined, now = Date.now()): { id: string; title: string; body: string; at: number }[] {
  const today = new Date(now);
  const key = `${String(today.getFullYear()).padStart(4, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { start } = weekRange(key);
  const [y, m, d] = start.split('-').map(Number);
  const [hour, minute] = GOAL_REMINDER_TIME.split(':').map(Number);
  const friday = new Date(y, m - 1, d + 4, hour, minute, 0, 0);
  if (friday.getTime() <= now) return [];
  const behind = goalWeeks(goals, marks, key).filter(week => week.remaining >= 2);
  if (!behind.length) return [];
  return [{ id: `goals:${start}`, title: '这周的周次任务还差几次', body: `${behind.map(week => `${week.goal.name}还差 ${week.remaining} 次`).join('，')}，周末安排一下吧`, at: friday.getTime() }];
}
