import type { WeightEntry } from './types';
import { weightHistory, weightSeries } from './weight';

// 体重折线图的坐标：横轴是日期（按真实天数排开），纵轴是 kg。电脑和手机各自画 SVG，坐标在这里算好。

export type WeightRange = 30 | 90 | 365 | 0;
export const WEIGHT_RANGES: { days: WeightRange; label: string }[] = [
  { days: 30, label: '30 天' }, { days: 90, label: '3 个月' }, { days: 365, label: '1 年' }, { days: 0, label: '全部' },
];

export interface WeightChartBox { width: number; height: number; left: number; right: number; top: number; bottom: number }
export interface WeightChartModel {
  points: { id: string; date: string; kg: number; x: number; y: number }[];
  /** 纵轴刻度（kg）。 */
  yTicks: { kg: number; y: number }[];
  /** 横轴日期刻度。 */
  xTicks: { date: string; label: string; x: number }[];
  line: string;
  min: number; max: number; first?: WeightEntry; last?: WeightEntry;
}

const dayNumber = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
const keyOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const shortDate = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

/** days = 0 表示全部记录；横轴从起点日期排到今天。 */
export function weightChart(list: WeightEntry[] | undefined, today: string, days: WeightRange, box: WeightChartBox): WeightChartModel {
  const series = days ? weightSeries(list, today, days) : weightHistory(list).filter(item => item.date <= today).reverse();
  const empty: WeightChartModel = { points: [], yTicks: [], xTicks: [], line: '', min: 0, max: 0 };
  if (!series.length) return empty;
  const end = dayNumber(today);
  const start = days ? end - days + 1 : Math.min(dayNumber(series[0].date), end - 6);
  const kgs = series.map(item => item.kg);
  const min = Math.min(...kgs), max = Math.max(...kgs);
  // 纵轴至少留 2 kg 的范围，刻度取整数或 0.5。
  let low = Math.floor(min - 0.5), high = Math.ceil(max + 0.5);
  if (high - low < 2) { low -= 1; high += 1; }
  const step = high - low <= 4 ? 1 : high - low <= 10 ? 2 : 5;
  low = Math.floor(low / step) * step; high = Math.ceil(high / step) * step;
  const plotW = box.width - box.left - box.right, plotH = box.height - box.top - box.bottom;
  const x = (key: string) => box.left + (end === start ? plotW / 2 : (dayNumber(key) - start) / (end - start) * plotW);
  const y = (kg: number) => box.top + (high - kg) / (high - low) * plotH;
  const points = series.map(item => ({ id: item.id, date: item.date, kg: item.kg, x: x(item.date), y: y(item.kg) }));
  const yTicks: WeightChartModel['yTicks'] = [];
  for (let kg = low; kg <= high + 1e-9; kg += step) yTicks.push({ kg, y: y(kg) });
  const xTicks: WeightChartModel['xTicks'] = [];
  const count = 4;
  for (let i = 0; i <= count; i++) { const date = keyOf(Math.round(start + (end - start) * i / count)); if (!xTicks.some(t => t.date === date)) xTicks.push({ date, label: shortDate(date), x: x(date) }); }
  return { points, yTicks, xTicks, line: points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), min, max, first: series[0], last: series[series.length - 1] };
}
