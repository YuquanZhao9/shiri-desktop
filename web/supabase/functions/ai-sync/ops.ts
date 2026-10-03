// ai-sync 的纯逻辑（不碰数据库），Node 测试直接引用。
// 日程格式、重复规则、课表和节假日全部来自 _shared（桌面版 拾日/src 的副本），写出前再用 validateBackup 校验。
import { isDone, occursOn, validateBackup } from '../_shared/core.ts';
import { classesForDate, effectiveTimetable } from '../_shared/timetable.ts';
import { germanHoliday, GERMAN_STATES } from '../_shared/holidays.ts';
import type { GermanState } from '../_shared/holidays.ts';
import type { Task, TaskList, Timetable } from '../_shared/types.ts';

export type { Task, TaskList, Timetable };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Repeat = Task['repeat'];
const REPEATS: Repeat[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const EVENT_KEYS = ['title', 'date', 'start', 'end', 'duration', 'notes', 'color', 'repeat', 'list', 'priority', 'completed'];
export const bad = (message: string, code = 'invalid_request') => new ApiError(400, code, message);

export const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const hhmm = (value: number) => `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
function dayShift(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
const dayCount = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
const weekday = (key: string) => { const [y, m, d] = key.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 + 1; };

export function checkRange(from: unknown, to: unknown, max = 366): [string, string] {
  if (!validDate(from) || !validDate(to)) throw bad('from / to 格式为 YYYY-MM-DD');
  if (to < from) throw bad('to 早于 from');
  if (dayCount(from, to) > max) throw bad(`一次最多查询 ${max} 天`);
  return [from, to];
}

/** 更新时间必须晚于旧版本，各设备按“最后修改为准”合并时才会采用这次修改。 */
export function nextStamp(now: number, previous?: string): string {
  return new Date(Math.max(now, previous ? Date.parse(previous) + 1 : 0)).toISOString();
}

export function resolveList(lists: TaskList[], value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw bad('list 必须是清单名称或 ID');
  const match = lists.find(list => list.id === value) ?? lists.find(list => list.name === value) ?? lists.find(list => list.name.toLowerCase() === value.trim().toLowerCase());
  if (!match) throw bad(`没有名为“${value}”的清单。可用：${lists.map(list => list.name).join('、')}`, 'unknown_list');
  return match.id;
}

/** 把接口里的事件字段套到日程上（新建时 base 为默认值）。 */
export function applyFields(base: Task, input: unknown, lists: TaskList[]): Task {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('event / changes 必须是对象');
  const fields = input as Record<string, unknown>;
  for (const key of Object.keys(fields)) if (!EVENT_KEYS.includes(key)) throw bad(`不支持的字段：${key}`);
  const next: Task = { ...base, doneDates: [...base.doneDates] };

  if ('title' in fields) {
    if (typeof fields.title !== 'string' || !fields.title.trim() || fields.title.length > 500) throw bad('title 必须是 1–500 字的文字');
    next.title = fields.title.trim();
  }
  if ('notes' in fields) {
    const notes = fields.notes ?? '';
    if (typeof notes !== 'string' || notes.length > 20_000) throw bad('notes 必须是 20000 字以内的文字');
    next.notes = notes;
  }
  if ('date' in fields) {
    if (fields.date === null || fields.date === '') { next.date = ''; next.time = ''; next.repeat = 'none'; next.doneDates = []; }
    else if (!validDate(fields.date)) throw bad('date 格式为 YYYY-MM-DD，或 null 表示收集箱');
    else next.date = fields.date;
  }
  if ('start' in fields) {
    if (fields.start === null || fields.start === '') next.time = '';
    else if (typeof fields.start !== 'string' || !TIME.test(fields.start)) throw bad('start 格式为 HH:mm（24 小时制），或 null 表示全天');
    else next.time = fields.start;
  }
  if ('end' in fields && 'duration' in fields && fields.end !== null) throw bad('end 和 duration 只能给一个');
  if ('end' in fields && fields.end !== null) {
    if (typeof fields.end !== 'string' || !TIME.test(fields.end)) throw bad('end 格式为 HH:mm');
    if (!next.time) throw bad('设置 end 需要同时有 start');
    let length = minutes(fields.end) - minutes(next.time);
    if (length <= 0) length += 1440; // 跨午夜
    next.duration = length;
  }
  if ('duration' in fields) {
    if (typeof fields.duration !== 'number' || !Number.isInteger(fields.duration)) throw bad('duration 为整数分钟');
    next.duration = fields.duration;
  }
  if (next.duration < 5 || next.duration > 1440) throw bad('时长须为 5 至 1440 分钟');
  if ('color' in fields) {
    if (fields.color === null || fields.color === '') delete next.color;
    else if (typeof fields.color !== 'string' || !COLOR.test(fields.color)) throw bad('color 格式为 #RRGGBB，或 null 使用清单颜色');
    else next.color = fields.color.toUpperCase();
  }
  if ('repeat' in fields) {
    if (!REPEATS.includes(fields.repeat as Repeat)) throw bad(`repeat 只能是 ${REPEATS.join(' / ')}`);
    next.repeat = fields.repeat as Repeat;
    if (next.repeat === 'none') next.doneDates = [];
  }
  if ('priority' in fields) {
    if (fields.priority !== 'normal' && fields.priority !== 'high') throw bad('priority 只能是 normal / high');
    next.priority = fields.priority;
  }
  if ('completed' in fields) {
    if (typeof fields.completed !== 'boolean') throw bad('completed 为 true / false');
    if (next.repeat !== 'none') throw bad('重复日程请用 complete 操作按日期标记');
    next.completed = fields.completed;
  }
  if ('list' in fields) next.listId = resolveList(lists, fields.list, next.listId);
  if (!next.date && next.repeat !== 'none') throw bad('收集箱里的日程不能重复');
  if (!next.date) next.time = '';
  if (!next.title) throw bad('缺少 title');
  return next;
}

export function newTask(id: string, now: number, lists: TaskList[], input: unknown): Task {
  const stamp = new Date(now).toISOString();
  const base: Task = { id, title: '', date: '', time: '', duration: 60, listId: lists[0]?.id ?? 'work', notes: '', priority: 'normal', repeat: 'none', completed: false, doneDates: [], createdAt: stamp, updatedAt: stamp };
  return applyFields(base, input, lists);
}

export function setDone(task: Task, date: unknown, done: boolean): Task {
  if (task.repeat === 'none') return { ...task, completed: done };
  if (!validDate(date)) throw bad('重复日程需要 date 指定完成哪一天');
  if (!occursOn(task, date)) throw bad(`这条重复日程在 ${date} 不发生`, 'not_on_date');
  const set = new Set(task.doneDates);
  if (done) set.add(date); else set.delete(date);
  return { ...task, completed: false, doneDates: [...set].sort() };
}

/** 写入前最后一道关：必须能被电脑版和手机版原样读入。 */
export function assertStorable(task: Task, lists: TaskList[]): Task {
  const listSet = lists.some(list => list.id === task.listId) ? lists : [...lists, { id: task.listId, name: task.listId, color: '#6D8DCA' }];
  return validateBackup({ version: 1, tasks: [task], lists: listSet }).tasks[0];
}

export function eventView(task: Task, lists: TaskList[], externalId?: string) {
  const list = lists.find(item => item.id === task.listId);
  return {
    id: task.id, title: task.title, date: task.date || null,
    start: task.time || null, end: task.time ? hhmm(minutes(task.time) + task.duration) : null,
    duration: task.duration, allDay: !task.time, notes: task.notes, color: task.color ?? null,
    repeat: task.repeat, list: list ? { id: list.id, name: list.name } : { id: task.listId, name: task.listId },
    priority: task.priority, completed: task.completed, doneDates: task.doneDates, updatedAt: task.updatedAt,
    ...(externalId ? { externalId } : {}),
  };
}

/** 日期范围内每一次发生（重复日程展开），按日期和时间排序。 */
export function occurrences(tasks: Task[], lists: TaskList[], from: string, to: string, query?: unknown, externalIds: Map<string, string> = new Map()) {
  if (query !== undefined && typeof query !== 'string') throw bad('query 必须是文字');
  const needle = query?.trim().toLowerCase();
  const matches = (task: Task) => !needle || task.title.toLowerCase().includes(needle) || task.notes.toLowerCase().includes(needle);
  const result = [];
  for (let day = from; day <= to; day = dayShift(day, 1)) {
    for (const task of tasks) {
      if (task.deletedAt || !matches(task) || !occursOn(task, day)) continue;
      result.push({ ...eventView(task, lists, externalIds.get(task.id)), date: day, done: isDone(task, day), seriesStart: task.date });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? '') || a.title.localeCompare(b.title));
}

export function parseState(value: unknown): GermanState {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !GERMAN_STATES.some(([code]) => code === value)) throw bad('state 为德国联邦州代码，如 BW、BY，或留空只算全国性假日');
  return value as GermanState;
}

export interface BusyBlock { date: string; start: string; end: string; kind: 'event' | 'class'; title: string; id?: string; optional?: boolean }

/**
 * 忙碌时间：未完成的定时日程 + 课表课程（学期内、停课期和德国假日除外，与电脑版显示一致）。
 * 虚线课程（可选/看录像）标 optional。全天日程单列在 allDay，不占时段。
 */
export function busy(tasks: Task[], timetable: Timetable | undefined, from: string, to: string, state: GermanState) {
  const table = effectiveTimetable(timetable);
  const days = [];
  for (let day = from; day <= to; day = dayShift(day, 1)) {
    const blocks: BusyBlock[] = [];
    const allDay: { id: string; title: string }[] = [];
    for (const task of tasks) {
      if (task.deletedAt || !occursOn(task, day) || isDone(task, day)) continue;
      if (!task.time) { allDay.push({ id: task.id, title: task.title }); continue; }
      const end = Math.min(1440, minutes(task.time) + task.duration);
      blocks.push({ date: day, start: task.time, end: end === 1440 ? '24:00' : hhmm(end), kind: 'event', title: task.title, id: task.id });
    }
    const holiday = germanHoliday(day, state);
    for (const row of classesForDate(table, day, !!holiday) ?? []) {
      for (const slot of row.slots) blocks.push({ date: day, start: slot.start, end: slot.end, kind: 'class', title: slot.title, ...(slot.dashed ? { optional: true } : {}) });
    }
    blocks.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    days.push({ date: day, weekday: weekday(day), holiday: holiday ? holiday.german : null, allDay, blocks });
  }
  return { timetable: table.name, days };
}

/** 空闲时段：在每天 dayStart–dayEnd 之间去掉忙碌时间，留下不短于 minMinutes 的空档。 */
export function free(busyDays: ReturnType<typeof busy>['days'], options: { dayStart?: unknown; dayEnd?: unknown; minMinutes?: unknown; weekends?: unknown; ignoreOptional?: unknown }) {
  const dayStart = options.dayStart ?? '08:00', dayEnd = options.dayEnd ?? '20:00';
  if (typeof dayStart !== 'string' || !TIME.test(dayStart) || typeof dayEnd !== 'string' || !TIME.test(dayEnd) || dayEnd <= dayStart) throw bad('dayStart / dayEnd 格式为 HH:mm，且结束晚于开始');
  const min = options.minMinutes ?? 30;
  if (typeof min !== 'number' || !Number.isInteger(min) || min < 5 || min > 720) throw bad('minMinutes 为 5–720 的整数');
  const weekends = options.weekends === true, ignoreOptional = options.ignoreOptional === true;
  return busyDays.filter(day => weekends || day.weekday <= 5).map(day => {
    let cursor = minutes(dayStart);
    const stop = minutes(dayEnd);
    const slots: { start: string; end: string; minutes: number }[] = [];
    for (const block of day.blocks) {
      if (ignoreOptional && block.optional) continue;
      const s = minutes(block.start), e = block.end === '24:00' ? 1440 : minutes(block.end);
      if (s > cursor && Math.min(s, stop) - cursor >= min) slots.push({ start: hhmm(cursor), end: hhmm(Math.min(s, stop)), minutes: Math.min(s, stop) - cursor });
      cursor = Math.max(cursor, e);
      if (cursor >= stop) break;
    }
    if (stop - cursor >= min) slots.push({ start: hhmm(cursor), end: hhmm(stop), minutes: stop - cursor });
    return { date: day.date, holiday: day.holiday, free: slots };
  });
}
