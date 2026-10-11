// 自动从 拾日/src/journal.ts 复制，请勿手改；运行 node scripts/sync-shared.mjs 更新。
import type { JournalEntry } from './types.ts';

// 日记：每天一篇纯文本。删除时保留一条空文本记录，好让删除也能同步到其他设备。

export const JOURNAL_MAX_TEXT = 50_000;
const MAX_ENTRIES = 20_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return year >= 1 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 校验一篇日记（本机存储、备份或云端数据）。 */
export function validateJournalEntry(value: unknown): JournalEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('日记格式不正确');
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!['date', 'text', 'updatedAt'].includes(key)) throw new Error(`日记包含未知字段：${key}`);
  if (typeof item.date !== 'string' || !validDate(item.date)) throw new Error('日记日期无效');
  if (typeof item.text !== 'string' || item.text.length > JOURNAL_MAX_TEXT || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(item.text)) throw new Error('日记内容不正确或过长');
  if (typeof item.updatedAt !== 'string' || !STAMP.test(item.updatedAt) || new Date(item.updatedAt).toISOString() !== item.updatedAt) throw new Error('日记更新时间无效');
  return { date: item.date, text: item.text, updatedAt: item.updatedAt };
}

export function validateJournal(input: unknown): JournalEntry[] {
  if (!Array.isArray(input) || input.length > MAX_ENTRIES) throw new Error('日记数量无效');
  const entries = input.map(validateJournalEntry);
  if (new Set(entries.map(entry => entry.date)).size !== entries.length) throw new Error('同一天有两篇日记');
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

/** 两篇同一天的日记取较新的；时间相同按文本决出，两端结果一致。 */
export function newerEntry(a: JournalEntry, b: JournalEntry): JournalEntry {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return a.text >= b.text ? a : b;
}

export function mergeJournal(a: JournalEntry[] = [], b: JournalEntry[] = []): JournalEntry[] {
  const byDate = new Map<string, JournalEntry>();
  for (const entry of [...a, ...b]) {
    const previous = byDate.get(entry.date);
    byDate.set(entry.date, previous ? newerEntry(previous, entry) : entry);
  }
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
}

export function journalText(journal: JournalEntry[] | undefined, date: string): string {
  return journal?.find(entry => entry.date === date)?.text ?? '';
}

/** 写入某天的日记；内容没变时原样返回。更新时间严格晚于上一版。 */
export function writeJournal(journal: JournalEntry[] | undefined, date: string, text: string, now = Date.now()): JournalEntry[] {
  const list = journal ?? [];
  const previous = list.find(entry => entry.date === date);
  if (!validDate(date)) throw new Error('日记日期无效');
  const clean = text.slice(0, JOURNAL_MAX_TEXT).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (previous ? previous.text === clean : !clean.trim()) return list;
  const updatedAt = new Date(Math.max(now, previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
  return [...list.filter(entry => entry.date !== date), { date, text: clean, updatedAt }].sort((x, y) => x.date.localeCompare(y.date));
}

/** 有内容的日记，最新的日期在前。 */
export function writtenEntries(journal: JournalEntry[] | undefined): JournalEntry[] {
  return (journal ?? []).filter(entry => entry.text.trim()).sort((a, b) => b.date.localeCompare(a.date));
}

export function hasJournal(journal: JournalEntry[] | undefined, date: string): boolean {
  return !!journalText(journal, date).trim();
}

/** 每天这个时间还没写日记就提醒（电脑弹窗、iPhone 推送）。 */
export const JOURNAL_REMINDER_TIME = '21:00';

/** 从今天起 days 天内、还没写日记的那些天在 21:00 的提醒（已过的时刻不算）。 */
export function journalReminders(journal: JournalEntry[] | undefined, days = 7, now = Date.now()): { id: string; title: string; body: string; at: number }[] {
  const result: { id: string; title: string; body: string; at: number }[] = [];
  const [hour, minute] = JOURNAL_REMINDER_TIME.split(':').map(Number);
  for (let i = 0; i < days; i++) {
    const day = new Date(now);
    day.setDate(day.getDate() + i);
    day.setHours(hour, minute, 0, 0);
    const date = `${String(day.getFullYear()).padStart(4, '0')}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    if (day.getTime() <= now || hasJournal(journal, date)) continue;
    result.push({ id: `journal:${date}`, title: '该写今天的日记了', body: `${date} 的日记还没写，花几分钟记下今天吧`, at: day.getTime() });
  }
  return result;
}
