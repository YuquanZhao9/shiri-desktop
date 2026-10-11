// 云端提醒计算。重复规则逐字复制自桌面版 拾日/src/core.ts 的 occursOn / isDone，
// tests/schedule.test.ts 会拿两份实现逐日比对，桌面版改规则时测试会失败提醒同步修改。

export interface ReminderTask {
  id: string;
  title: string;
  date: string;
  time: string;
  repeat: string;
  completed: boolean;
  doneDates: string[];
  deletedAt?: string;
}

export interface Due { occurrence: string; title: string; body: string; at: number }

function parseDate(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('日期必须是 YYYY-MM-DD');
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(2000, month - 1, day, 12, 0, 0, 0);
  date.setFullYear(year);
  return date;
}

export function occursOn(task: ReminderTask, key: string): boolean {
  if (task.deletedAt || !task.date || !key || key < task.date) return false;
  const date = parseDate(key);
  const start = parseDate(task.date);
  switch (task.repeat) {
    case 'none': return key === task.date;
    case 'daily': return true;
    case 'weekdays': return date.getDay() !== 0 && date.getDay() !== 6;
    case 'weekly': return date.getDay() === start.getDay();
    case 'monthly': return date.getDate() === start.getDate();
    case 'yearly': return date.getMonth() === start.getMonth() && date.getDate() === start.getDate();
    default: return false;
  }
}

export function isDone(task: ReminderTask, key: string): boolean {
  return task.repeat === 'none' ? task.completed : task.doneDates.includes(key);
}

function zonedParts(epoch: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(epoch));
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** 某时区在该时刻比 UTC 快多少毫秒。 */
function offset(epoch: number, timeZone: string): number {
  const p = zonedParts(epoch, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(epoch / 1000) * 1000;
}

/** 把用户所在时区的“某日 HH:mm”换成绝对时间。 */
export function zonedTime(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offset(guess, timeZone);
  return guess - offset(first, timeZone);
}

export function zonedDateKey(epoch: number, timeZone: string): string {
  const p = zonedParts(epoch, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${String(utc.getUTCFullYear()).padStart(4, '0')}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 找出此刻该推送的提醒：提醒时刻（日程时间减提前量）落在 (now - lookback, now + ahead]。
 * 定时任务每分钟跑一次；lookback 覆盖偶尔延迟或漏跑的那一两分钟，重复由已发送表挡住。
 */
/** 默认每个日程提前 2 小时、1 小时、30 分钟、10 分钟各推送一次（与桌面版一致）。 */
export const MULTI_LEADS = [120, 60, 30, 10];

const leadText = (minutes: number) => minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`;

export function dueReminders(tasks: ReminderTask[], timeZone: string, leadMinutes: number | number[], now: number, lookbackMs = 10 * 60_000, aheadMs = 30_000): Due[] {
  const leads = [...new Set(Array.isArray(leadMinutes) ? leadMinutes : [leadMinutes])];
  const today = zonedDateKey(now, timeZone);
  const days = [shiftKey(today, -1), today, shiftKey(today, 1), shiftKey(today, 2)];
  const result: Due[] = [];
  for (const task of tasks) {
    if (task.deletedAt || !task.time || !task.date) continue;
    for (const day of days) {
      if (!occursOn(task, day) || isDone(task, day)) continue;
      const at = zonedTime(day, task.time, timeZone);
      // 日程开始后就不再补发。
      if (at < now - 60_000) continue;
      // 只发最近到点的一条：漏跑几分钟后不会把 30 分钟和 10 分钟的提醒同时推出来。
      const fired = leads.filter(lead => { const fire = at - lead * 60_000; return fire > now - lookbackMs && fire <= now + aheadMs; });
      if (!fired.length) continue;
      const lead = Math.min(...fired);
      const when = lead ? `${leadText(lead)}后开始` : '现在开始';
      result.push({ occurrence: `${task.id}:${day}:${task.time}:${lead}`, title: task.title.slice(0, 160), body: `${task.time} · ${when}`, at });
    }
  }
  return result.sort((a, b) => a.at - b.at);
}

/** 每天这个时间还没写日记就推送（与桌面版 src/journal.ts 的 JOURNAL_REMINDER_TIME 相同）。 */
export const JOURNAL_TIME = '21:00';

/** 用户所在时区今天 21:00 到点、且今天还没写日记时返回一条推送。 */
export function journalDue(timeZone: string, now: number, written: (day: string) => boolean, lookbackMs = 10 * 60_000, aheadMs = 30_000): Due | null {
  const today = zonedDateKey(now, timeZone);
  const at = zonedTime(today, JOURNAL_TIME, timeZone);
  if (at <= now - lookbackMs || at > now + aheadMs || written(today)) return null;
  return { occurrence: `journal:${today}:${JOURNAL_TIME}`, title: '该写今天的日记了', body: '今天的日记还没写，花几分钟记下今天吧', at };
}

/** 每周日这个时间提醒看本周复盘汇总（与桌面版 src/reflections.ts 的 REVIEW_REMINDER_TIME 相同）。 */
export const REVIEW_TIME = '20:00';

/** 用户所在时区的周日 20:00 到点时返回本周（周一到周日）的范围和推送；不是这个时刻返回 null。 */
export function reviewDue(timeZone: string, now: number, lookbackMs = 10 * 60_000, aheadMs = 30_000): { start: string; end: string; due: Due } | null {
  const today = zonedDateKey(now, timeZone);
  const [y, m, d] = today.split('-').map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) return null;
  const at = zonedTime(today, REVIEW_TIME, timeZone);
  if (at <= now - lookbackMs || at > now + aheadMs) return null;
  return { start: shiftKey(today, -6), end: today, due: { occurrence: `review:${today}:${REVIEW_TIME}`, title: '本周复盘汇总好了', body: '这周的感悟都整理在一起了，点开看看', at } };
}

/** 周五这个时间，周次任务还差 2 次及以上时提醒（与桌面版 src/weekly.ts 的 GOAL_REMINDER_TIME 相同）。 */
export const GOAL_TIME = '19:00';

export interface GoalRow { id: string; name: string; target: number; deletedAt?: string }
export interface MarkRow { goalId: string; date: string; done: boolean; deletedAt?: string }

/** 用户所在时区的周五 19:00：返回本周（周一起）范围和推送用的进度；不是这个时刻返回 null。 */
export function goalWindow(timeZone: string, now: number, lookbackMs = 10 * 60_000, aheadMs = 30_000): { start: string; end: string; at: number } | null {
  const today = zonedDateKey(now, timeZone);
  const [y, m, d] = today.split('-').map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 5) return null;
  const at = zonedTime(today, GOAL_TIME, timeZone);
  if (at <= now - lookbackMs || at > now + aheadMs) return null;
  return { start: shiftKey(today, -4), end: shiftKey(today, 2), at };
}

/** 还差 2 次及以上的任务拼成一条推送；都快完成了返回 null。 */
export function goalDue(goals: GoalRow[], marks: MarkRow[], window: { start: string; end: string; at: number }): Due | null {
  const behind = goals.filter(goal => !goal.deletedAt).map(goal => {
    const done = marks.filter(mark => !mark.deletedAt && mark.done && mark.goalId === goal.id && mark.date >= window.start && mark.date <= window.end).length;
    return { name: goal.name, remaining: Math.max(0, goal.target - done) };
  }).filter(item => item.remaining >= 2);
  if (!behind.length) return null;
  return { occurrence: `goals:${window.start}:${GOAL_TIME}`, title: '这周的周次任务还差几次', body: `${behind.map(item => `${item.name}还差 ${item.remaining} 次`).join('，')}，周末安排一下吧`, at: window.at };
}
