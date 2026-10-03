// 自动从 拾日/src/core.ts 复制，请勿手改；运行 node scripts/sync-shared.mjs 更新。
import type { AppData, Task, TaskList } from './types.ts';
import { validateTimetable } from './timetable.ts';

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const REPEATS = new Set(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']);
const MAX_TASKS = 20_000;
const MAX_LISTS = 200;

/** Date keys deliberately use local fields, never UTC ISO slicing. */
export function dateKey(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('无效日期');
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

/** Noon avoids DST transitions around midnight in common local time zones. */
export function parseDate(key: string): Date {
  if (!DATE_PATTERN.test(key)) throw new Error('日期必须是 YYYY-MM-DD');
  const [year, month, day] = key.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) throw new Error('无效日期');
  const date = new Date(2000, month - 1, day, 12, 0, 0, 0);
  date.setFullYear(year);
  if (dateKey(date) !== key) throw new Error('无效日期');
  return date;
}

function dayNumber(key: string): number {
  const date = parseDate(key);
  const utc = new Date(0);
  utc.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  utc.setUTCHours(0, 0, 0, 0);
  return utc.getTime() / DAY_MS;
}

export function addDays(key: string, count: number): string {
  if (!Number.isSafeInteger(count)) throw new Error('天数必须是整数');
  const date = parseDate(key);
  date.setDate(date.getDate() + count);
  const result = dateKey(date);
  if (!DATE_PATTERN.test(result) || date.getFullYear() < 1) throw new Error('日期超出范围');
  return result;
}

/** A fixed six-week, Monday-first grid, including adjacent-month days. */
export function monthDays(year: number, month: number): string[] {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error('无效年月');
  }
  const first = parseDate(`${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => addDays(dateKey(first), index - offset));
}

export function occursOn(task: Task, key: string): boolean {
  if (task.deletedAt || !task.date || !key || key < task.date) return false;
  const date = parseDate(key);
  const start = parseDate(task.date);
  switch (task.repeat) {
    case 'none': return key === task.date;
    case 'daily': return true;
    case 'weekdays': return date.getDay() !== 0 && date.getDay() !== 6;
    case 'weekly': return date.getDay() === start.getDay();
    // Missing dates are skipped: a task on the 31st does not land on the 28th.
    case 'monthly': return date.getDate() === start.getDate();
    case 'yearly': return date.getMonth() === start.getMonth() && date.getDate() === start.getDate();
    default: return false;
  }
}

export function isDone(task: Task, key: string): boolean {
  return task.repeat === 'none' ? task.completed : task.doneDates.includes(key);
}

function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export function toggleTask(task: Task, key: string): Task {
  if (task.deletedAt) return task;
  if (task.repeat === 'none') {
    return { ...task, completed: !task.completed, updatedAt: nextTimestamp(task.updatedAt) };
  }
  if (!occursOn(task, key)) return task;
  const doneDates = task.doneDates.includes(key)
    ? task.doneDates.filter(date => date !== key)
    : [...task.doneDates, key].sort();
  return { ...task, completed: false, doneDates, updatedAt: nextTimestamp(task.updatedAt) };
}

/** Repeating-task moves apply to the entire series, including its time. */
export function moveTask(task: Task, oldDate: string, newDate: string, time?: string): Task {
  if (task.deletedAt) return task;
  if (newDate) parseDate(newDate);
  if (time !== undefined && time !== '' && !TIME_PATTERN.test(time)) throw new Error('无效时间');
  const updatedAt = nextTimestamp(task.updatedAt);
  if (!newDate) return { ...task, date: '', time: '', repeat: 'none', doneDates: [], updatedAt };
  if (task.repeat === 'none' || !task.date) {
    return { ...task, date: newDate, time: time ?? task.time, updatedAt };
  }
  const delta = dayNumber(newDate) - dayNumber(oldDate || task.date);
  const moved = { ...task, date: addDays(task.date, delta), time: time ?? task.time, updatedAt };
  moved.doneDates = [...new Set(task.doneDates.map(date => addDays(date, delta)))].filter(date => occursOn(moved, date)).sort();
  return moved;
}

export function tasksForDate(tasks: Task[], key: string): Task[] {
  return tasks.filter(task => occursOn(task, key)).sort((a, b) =>
    Number(isDone(a, key)) - Number(isDone(b, key)) ||
    a.time.localeCompare(b.time) ||
    Number(b.priority === 'high') - Number(a.priority === 'high') ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
const lunarDays = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

export function formatLunar(key: string): string {
  const parts = lunarFormatter.formatToParts(parseDate(key));
  const day = Number(parts.find(part => part.type === 'day')?.value);
  return day === 1 ? (parts.find(part => part.type === 'month')?.value ?? '初一') : (lunarDays[day - 1] ?? '');
}

function record(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式不正确`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label}格式不正确`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}包含未知字段：${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Error(`${label}不允许访问器属性`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, max: number, label: string, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    throw new Error(`${label}内容不正确或过长`);
  }
  return value;
}

function idValue(value: unknown, label: string): string {
  const id = stringValue(value, 128, label, false);
  if (!/^[A-Za-z0-9_-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error(`${label}无效`);
  return id;
}

function dateValue(value: unknown, label: string, allowEmpty = false): string {
  const key = stringValue(value, 10, label, allowEmpty);
  if (key || !allowEmpty) parseDate(key);
  return key;
}

function timestamp(value: unknown, label: string): string {
  const result = stringValue(value, 24, label, false);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new Error(`${label}无效`);
  return result;
}

/** Color tags offered in the editors (empty = use the list color). */
export const TASK_COLORS = ['#E5534B', '#F08C2E', '#D6A92B', '#3FA66B', '#1FA3A3', '#3B7DDD', '#8B5CF6', '#D6559A'];

/** Validate and copy untrusted imports before they can replace local data. */
export function validateBackup(input: unknown): AppData {
  const root = record(input, ['version', 'tasks', 'lists', 'timetable'], '备份');
  if (root.version !== 1) throw new Error('不支持的备份版本');
  if (!Array.isArray(root.tasks) || root.tasks.length > MAX_TASKS) throw new Error(`任务数量不能超过 ${MAX_TASKS}`);
  if (!Array.isArray(root.lists) || !root.lists.length || root.lists.length > MAX_LISTS) throw new Error(`清单数量须为 1 至 ${MAX_LISTS}`);
  const listIds = new Set<string>();
  const lists: TaskList[] = root.lists.map((value: unknown) => {
    const item = record(value, ['id', 'name', 'color'], '清单');
    const id = idValue(item.id, '清单 ID');
    if (listIds.has(id)) throw new Error('清单 ID 重复');
    listIds.add(id);
    const name = stringValue(item.name, 80, '清单名称', false);
    const color = stringValue(item.color, 7, '清单颜色', false);
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Error('清单颜色无效');
    return { id, name, color };
  });
  const taskIds = new Set<string>();
  let textSize = 0;
  const tasks: Task[] = root.tasks.map((value: unknown) => {
    const item = record(value, ['id', 'title', 'date', 'time', 'duration', 'listId', 'notes', 'priority', 'repeat', 'completed', 'doneDates', 'createdAt', 'updatedAt', 'deletedAt', 'color'], '任务');
    const id = idValue(item.id, '任务 ID');
    if (taskIds.has(id)) throw new Error('任务 ID 重复');
    taskIds.add(id);
    const title = stringValue(item.title, 500, '任务名称', false);
    const notes = stringValue(item.notes, 20_000, '备注');
    const date = dateValue(item.date, '任务日期', true);
    const time = stringValue(item.time, 5, '任务时间');
    if (time && (!date || !TIME_PATTERN.test(time))) throw new Error('任务时间无效');
    if (typeof item.duration !== 'number' || !Number.isInteger(item.duration) || item.duration < 5 || item.duration > 1440) throw new Error('任务时长须为 5 至 1440 分钟');
    const listId = idValue(item.listId, '任务清单 ID');
    if (!listIds.has(listId)) throw new Error('任务指向不存在的清单');
    if (item.priority !== 'normal' && item.priority !== 'high') throw new Error('任务优先级无效');
    if (typeof item.repeat !== 'string' || !REPEATS.has(item.repeat) || (!date && item.repeat !== 'none')) throw new Error('重复规则无效');
    if (typeof item.completed !== 'boolean') throw new Error('完成状态无效');
    if (!Array.isArray(item.doneDates) || item.doneDates.length > 20_000) throw new Error('重复完成记录无效或过多');
    const doneDates = item.doneDates.map(value => dateValue(value, '完成日期'));
    if (new Set(doneDates).size !== doneDates.length) throw new Error('完成日期重复');
    const createdAt = timestamp(item.createdAt, '创建时间');
    const updatedAt = timestamp(item.updatedAt, '更新时间');
    if (updatedAt < createdAt) throw new Error('更新时间早于创建时间');
    const deletedAt = item.deletedAt === undefined ? undefined : timestamp(item.deletedAt, '删除时间');
    if (deletedAt && deletedAt < createdAt) throw new Error('删除时间早于创建时间');
    const color = item.color === undefined ? undefined : stringValue(item.color, 7, '日程颜色', false);
    if (color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Error('日程颜色无效');
    textSize += title.length + notes.length + doneDates.length * 10 + 350;
    if (textSize > 10_000_000) throw new Error('备份内容超过 10 MB 限制');
    return { id, title, date, time, duration: item.duration, listId, notes, priority: item.priority, repeat: item.repeat as Task['repeat'], completed: item.completed, doneDates: doneDates.sort(), createdAt, updatedAt, ...(deletedAt ? { deletedAt } : {}), ...(color ? { color } : {}) };
  });
  const timetable = root.timetable === undefined ? undefined : validateTimetable(root.timetable);
  return { version: 1, tasks, lists, ...(timetable ? { timetable } : {}) };
}

function taskRevision(task: Task): string {
  return task.deletedAt && task.deletedAt > task.updatedAt ? task.deletedAt : task.updatedAt;
}

/** SQL can reproduce this as encode(convert_to(array_to_string(fields, chr(31)), 'UTF8'), 'hex'). */
export function taskConflictKey(task: Task): string {
  const fields = [task.id, task.title, task.date, task.time, String(task.duration), task.listId, task.notes, task.priority, task.repeat, String(task.completed), [...task.doneDates].sort().join(','), task.createdAt, task.updatedAt, task.deletedAt ?? ''];
  return Array.from(new TextEncoder().encode(fields.join('\u001F')), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Timestamp last-write-wins; deletion wins equal-time edits; ties converge. */
export function mergeTasks(local: Task[], remote: Task[]): Task[] {
  const result = new Map<string, Task>();
  for (const task of [...local, ...remote]) {
    const previous = result.get(task.id);
    const comparison = previous ? taskRevision(task).localeCompare(taskRevision(previous)) : 1;
    if (!previous || comparison > 0 || (comparison === 0 && (
      (Boolean(task.deletedAt) && !previous.deletedAt) ||
      (Boolean(task.deletedAt) === Boolean(previous.deletedAt) && taskConflictKey(task) > taskConflictKey(previous))
    ))) result.set(task.id, { ...task, doneDates: [...task.doneDates].sort() });
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function defaultData(): AppData {
  return {
    version: 1,
    tasks: [],
    lists: [
      { id: 'work', name: '工作', color: '#6D8DCA' },
      { id: 'life', name: '生活', color: '#80A38F' },
      { id: 'personal', name: '个人', color: '#BD96B8' },
    ],
  };
}
