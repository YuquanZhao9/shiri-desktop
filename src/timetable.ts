import type { Timetable, TimetableAlert, TimetableBreak, TimetableCourse, TimetableSlot } from './types';

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;

/** WS 2026/27 (M.Sc. ETIT) timetable the user supplied; shown until they save their own. */
export const DEFAULT_TIMETABLE: Timetable = {
  name: 'WS 2026/27',
  start: '2026-10-12',
  end: '2027-02-13',
  // Bumped whenever the preset changes; saves at or before this time are treated as the preset.
  updatedAt: '2026-09-28T18:00:00.000Z',
  // Universität Stuttgart, Semestertermine WS 2026/27: "Jahreswechsel 2026/27: 23.12.2026 bis 06.01.2027".
  // Every lecture-free day the university lists for WS 2026/27.
  breaks: [
    { name: '万圣节（Allerheiligen）', start: '2026-11-01', end: '2026-11-01' },
    { name: '年末停课（Jahreswechsel）', start: '2026-12-23', end: '2027-01-06' },
  ],
  courses: [
    { code: 'AM', name: '高等数学（信号与信息处理）', color: '#3B7DDD' },
    { code: 'ITCL', name: '信息论、编码与学习', color: '#8B5CF6' },
    { code: 'MC', name: '矩阵计算', color: '#1FA3A3' },
    { code: 'SASP', name: '统计与自适应信号处理', color: '#3FA66B' },
    { code: 'AR', name: '智能体机器人（讲课有录像）', color: '#F08C2E' },
    { code: 'iCPS', name: '研讨课（集中活动）', color: '#E5534B' },
  ],
  slots: [
    { id: 'mon-mc', day: 1, start: '08:00', end: '09:30', title: 'MC 讲课', note: '现场上课', color: '#1FA3A3', dashed: false },
    { id: 'mon-ar', day: 1, start: '08:00', end: '09:30', title: 'AR 讲课', note: '不去现场，看录像', color: '#F08C2E', dashed: true },
    { id: 'mon-am', day: 1, start: '15:45', end: '17:15', title: 'AM 讲课', note: '', color: '#3B7DDD', dashed: false, alerts: [{ date: '2026-11-16', note: '与 iCPS 研讨课重叠 15 分钟' }] },
    { id: 'tue-am', day: 2, start: '08:00', end: '09:30', title: 'AM 练习', note: '', color: '#3B7DDD', dashed: false },
    { id: 'tue-sasp', day: 2, start: '11:30', end: '13:00', title: 'SASP 练习', note: '', color: '#3FA66B', dashed: false },
    { id: 'tue-ar-video', day: 2, start: '14:00', end: '15:30', title: '看 AR 录像', note: '建议时间，可调整', color: '#F08C2E', dashed: true },
    { id: 'wed-itcl', day: 3, start: '14:00', end: '15:30', title: 'ITCL 练习', note: '', color: '#8B5CF6', dashed: false },
    { id: 'wed-ar', day: 3, start: '15:45', end: '17:15', title: 'AR 练习', note: '', color: '#F08C2E', dashed: false },
    { id: 'thu-sasp', day: 4, start: '11:30', end: '13:00', title: 'SASP 讲课', note: '', color: '#3FA66B', dashed: false },
    { id: 'thu-itcl', day: 4, start: '14:00', end: '15:30', title: 'ITCL 讲课', note: '', color: '#8B5CF6', dashed: false, alerts: ['2026-11-19', '2026-11-26', '2026-12-10'].map(date => ({ date, note: '与 iCPS 研讨课冲突' })) },
  ],
};

function plain(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label}格式不正确`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label}包含未知字段：${key}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, label: string, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u001F]/.test(value)) throw new Error(`${label}无效`);
  return value;
}
function pattern(value: unknown, regex: RegExp, label: string): string {
  if (typeof value !== 'string' || !regex.test(value)) throw new Error(`${label}无效`);
  return value;
}

/** Validate an untrusted timetable (local storage, backup or cloud payload). */
export function validateTimetable(input: unknown): Timetable {
  const root = plain(input, ['name', 'start', 'end', 'slots', 'courses', 'breaks', 'updatedAt'], '课表');
  const start = pattern(root.start, DATE, '学期开始日期');
  const end = pattern(root.end, DATE, '学期结束日期');
  if (end < start) throw new Error('学期结束日期早于开始日期');
  if (!Array.isArray(root.slots) || root.slots.length > 200) throw new Error('课表课程过多');
  if (!Array.isArray(root.courses) || root.courses.length > 60) throw new Error('课程图例过多');
  const ids = new Set<string>();
  const slots: TimetableSlot[] = root.slots.map((value: unknown) => {
    const item = plain(value, ['id', 'day', 'start', 'end', 'title', 'note', 'color', 'dashed', 'alerts'], '课表课程');
    const id = pattern(item.id, /^[A-Za-z0-9_-]{1,64}$/, '课程 ID');
    if (ids.has(id)) throw new Error('课程 ID 重复');
    ids.add(id);
    if (typeof item.day !== 'number' || !Number.isInteger(item.day) || item.day < 1 || item.day > 7) throw new Error('上课星期无效');
    const slotStart = pattern(item.start, TIME, '上课时间');
    const slotEnd = pattern(item.end, TIME, '下课时间');
    if (slotEnd <= slotStart) throw new Error('下课时间须晚于上课时间');
    if (typeof item.dashed !== 'boolean') throw new Error('虚线标记无效');
    let alerts: TimetableAlert[] | undefined;
    if (item.alerts !== undefined) {
      if (!Array.isArray(item.alerts) || item.alerts.length > 100) throw new Error('课程提醒过多');
      alerts = item.alerts.map((alert: unknown) => {
        const entry = plain(alert, ['date', 'note'], '课程提醒');
        return { date: pattern(entry.date, DATE, '提醒日期'), note: text(entry.note, 200, '提醒内容') };
      });
    }
    return { id, day: item.day, start: slotStart, end: slotEnd, title: text(item.title, 80, '课程名称'), note: text(item.note, 200, '课程备注'), color: pattern(item.color, COLOR, '课程颜色'), dashed: item.dashed, ...(alerts ? { alerts } : {}) };
  });
  const courses: TimetableCourse[] = root.courses.map((value: unknown) => {
    const item = plain(value, ['code', 'name', 'color'], '课程图例');
    return { code: text(item.code, 20, '课程代号'), name: text(item.name, 120, '课程全名'), color: pattern(item.color, COLOR, '图例颜色') };
  });
  const updatedAt = pattern(root.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, '课表更新时间');
  let breaks: TimetableBreak[] | undefined;
  if (root.breaks !== undefined) {
    if (!Array.isArray(root.breaks) || root.breaks.length > 50) throw new Error('停课期过多');
    breaks = root.breaks.map((value: unknown) => {
      const item = plain(value, ['name', 'start', 'end'], '停课期');
      const breakStart = pattern(item.start, DATE, '停课开始日期');
      const breakEnd = pattern(item.end, DATE, '停课结束日期');
      if (breakEnd < breakStart) throw new Error('停课结束日期早于开始日期');
      return { name: text(item.name, 60, '停课期名称'), start: breakStart, end: breakEnd };
    });
  }
  return { name: text(root.name, 60, '学期名称'), start, end, slots, courses, ...(breaks ? { breaks } : {}), updatedAt };
}

/** Later edit wins; equal timestamps converge on the larger serialization. */
export function newerTimetable(a: Timetable | undefined, b: Timetable | undefined): Timetable | undefined {
  if (!a || !b) return a ?? b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function slotsForWeekday(timetable: Timetable, day: number): TimetableSlot[] {
  return timetable.slots.filter(slot => slot.day === day).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** Standard 90-minute periods of the timetable (08:00, 09:45, 11:30, 14:00, 15:45). */
export const DEFAULT_PERIODS = ['08:00', '09:45', '11:30', '14:00', '15:45'];

/** A class on one date, with that date's warning if any. */
export type DayClass = TimetableSlot & { alert?: string };
export interface PeriodRow { start: string; slots: DayClass[]; }

/**
 * Classes for one calendar date laid out by period, empty periods included.
 * Returns null outside the semester, on holidays, or on weekdays without any class.
 */
export function classesForDate(timetable: Timetable, date: string, holiday = false): PeriodRow[] | null {
  if (holiday || date < timetable.start || date > timetable.end) return null;
  if (breaksOf(timetable).some(item => date >= item.start && date <= item.end)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const weekday = (new Date(year, month - 1, day).getDay() + 6) % 7 + 1;
  if (!timetable.slots.some(slot => slot.day === weekday)) return null;
  // Periods come from the standard grid plus any other start time the user entered.
  const starts = [...new Set([...DEFAULT_PERIODS, ...timetable.slots.map(slot => slot.start)])].sort();
  const today = slotsForWeekday(timetable, weekday);
  const withAlert = (slot: TimetableSlot): DayClass => {
    const alert = slot.alerts?.find(item => item.date === date)?.note;
    return alert ? { ...slot, alert } : slot;
  };
  return starts.map(start => ({ start, slots: today.filter(slot => slot.start === start).map(withAlert) }));
}

/** Saved timetables from before breaks existed get the preset breaks when they are the same semester. */
export function breaksOf(timetable: Timetable): TimetableBreak[] {
  if (timetable.breaks) return timetable.breaks;
  return timetable.start === DEFAULT_TIMETABLE.start && timetable.end === DEFAULT_TIMETABLE.end ? DEFAULT_TIMETABLE.breaks ?? [] : [];
}

/** The timetable to show: the user's saved one, or the preset when nothing newer than the preset was saved. */
export function effectiveTimetable(saved: Timetable | undefined): Timetable {
  return !saved || saved.updatedAt <= DEFAULT_TIMETABLE.updatedAt ? DEFAULT_TIMETABLE : saved;
}
