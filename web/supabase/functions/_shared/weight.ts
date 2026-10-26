// 自动从 拾日/src/weight.ts 复制，请勿手改；运行 node scripts/sync-shared.mjs 更新。
import type { WeightEntry } from './types.ts';

// 每天 08:00 测体重：一天一个数字（kg），填了就算这天完成。删掉 = 留一条带删除时间的记录，好让删除也同步。

export const WEIGHT_TIME = '08:00';
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const validStamp = (value: unknown): value is string => typeof value === 'string' && STAMP.test(value) && new Date(value).toISOString() === value;

export const weightId = (date: string) => `weight_${date.replace(/-/g, '')}`;

export function validateWeight(value: unknown): WeightEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('体重记录格式不正确');
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!['id', 'date', 'kg', 'createdAt', 'updatedAt', 'deletedAt'].includes(key)) throw new Error(`体重记录包含未知字段：${key}`);
  if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.id !== weightId(item.date)) throw new Error('体重记录日期无效');
  if (typeof item.kg !== 'number' || !Number.isFinite(item.kg) || item.kg < 20 || item.kg > 400) throw new Error('体重须在 20 到 400 kg 之间');
  if (!validStamp(item.createdAt) || !validStamp(item.updatedAt) || (item.deletedAt !== undefined && !validStamp(item.deletedAt))) throw new Error('体重记录时间无效');
  return { id: item.id, date: item.date, kg: Math.round(item.kg * 10) / 10, createdAt: item.createdAt, updatedAt: item.updatedAt, ...(item.deletedAt ? { deletedAt: item.deletedAt as string } : {}) };
}

export function validateWeights(input: unknown): WeightEntry[] {
  if (!Array.isArray(input) || input.length > 20_000) throw new Error('体重记录数量无效');
  const items = input.map(validateWeight);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('体重记录重复');
  return items;
}

/** 把输入的文字读成 kg（允许“72.5”“72,5”“72.5kg”）；读不出返回 null。 */
export function parseKg(text: string): number | null {
  const match = /^\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|公斤)?\s*$/i.exec(text);
  if (!match) return null;
  const kg = Number(match[1].replace(',', '.'));
  return kg >= 20 && kg <= 400 ? Math.round(kg * 10) / 10 : null;
}

export function weightOn(list: WeightEntry[] | undefined, date: string): WeightEntry | undefined {
  return list?.find(item => item.date === date && !item.deletedAt);
}

/** 记下或改掉某天的体重；kg 为 null 就是删除。 */
export function setWeight(list: WeightEntry[] | undefined, date: string, kg: number | null, now = Date.now()): WeightEntry[] {
  const items = list ?? [];
  const id = weightId(date);
  const current = items.find(item => item.id === id);
  if (kg === null ? !current || current.deletedAt : current && !current.deletedAt && current.kg === kg) return items;
  const previous = current ? (current.deletedAt && current.deletedAt > current.updatedAt ? current.deletedAt : current.updatedAt) : undefined;
  const stamp = new Date(Math.max(now, previous ? Date.parse(previous) + 1 : 0)).toISOString();
  const next: WeightEntry = kg === null
    ? { ...current!, updatedAt: stamp, deletedAt: stamp }
    : { id, date, kg: Math.round(kg * 10) / 10, createdAt: current?.createdAt ?? stamp, updatedAt: stamp };
  return [...items.filter(item => item.id !== id), next];
}

/** 记过的体重，最近的在前。 */
export function weightHistory(list: WeightEntry[] | undefined): WeightEntry[] {
  return (list ?? []).filter(item => !item.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
}

/** 从今天起 days 天里还没记体重的日子，08:00 提醒一次（已过的不算）。 */
export function weightReminders(list: WeightEntry[] | undefined, days = 7, now = Date.now()): { id: string; title: string; body: string; at: number }[] {
  const result: { id: string; title: string; body: string; at: number }[] = [];
  const [hour, minute] = WEIGHT_TIME.split(':').map(Number);
  for (let i = 0; i < days; i++) {
    const day = new Date(now);
    day.setDate(day.getDate() + i);
    day.setHours(hour, minute, 0, 0);
    const date = `${String(day.getFullYear()).padStart(4, '0')}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    if (day.getTime() <= now || weightOn(list, date)) continue;
    result.push({ id: `weight:${date}`, title: '测体重', body: '早上测一下体重，在昱时里填上数字', at: day.getTime() });
  }
  return result;
}

/** 走势图用：最近 days 天里记过的点（最早的在前）。 */
export function weightSeries(list: WeightEntry[] | undefined, today: string, days = 30): WeightEntry[] {
  const [y, m, d] = today.split('-').map(Number);
  const from = new Date(y, m - 1, d - days + 1, 12);
  const start = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  return weightHistory(list).filter(item => item.date >= start && item.date <= today).reverse();
}
