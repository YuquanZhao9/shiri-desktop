// 自动从 拾日/src/holidays.ts 复制，请勿手改；运行 node scripts/sync-shared.mjs 更新。
import { addDays, parseDate } from './core.ts';

export interface DayMark { kind: 'rest'|'work'; name: string; }

// 国务院办公厅公布的放假与调休安排：
// 2025 年为国办发明电〔2024〕12 号，2026 年为国办发明电〔2025〕7 号。
// 次年安排一般在每年 11 月公布，公布后在此追加。
const OFFICIAL: { name: string; rest: [string, string]; work: string[] }[] = [
  { name: '元旦', rest: ['2025-01-01', '2025-01-01'], work: [] },
  { name: '春节', rest: ['2025-01-28', '2025-02-04'], work: ['2025-01-26', '2025-02-08'] },
  { name: '清明', rest: ['2025-04-04', '2025-04-06'], work: [] },
  { name: '劳动节', rest: ['2025-05-01', '2025-05-05'], work: ['2025-04-27'] },
  { name: '端午', rest: ['2025-05-31', '2025-06-02'], work: [] },
  { name: '国庆', rest: ['2025-10-01', '2025-10-08'], work: ['2025-09-28', '2025-10-11'] },
  { name: '元旦', rest: ['2026-01-01', '2026-01-03'], work: ['2026-01-04'] },
  { name: '春节', rest: ['2026-02-15', '2026-02-23'], work: ['2026-02-14', '2026-02-28'] },
  { name: '清明', rest: ['2026-04-04', '2026-04-06'], work: [] },
  { name: '劳动节', rest: ['2026-05-01', '2026-05-05'], work: ['2026-05-09'] },
  { name: '端午', rest: ['2026-06-19', '2026-06-21'], work: [] },
  { name: '中秋', rest: ['2026-09-25', '2026-09-27'], work: [] },
  { name: '国庆', rest: ['2026-10-01', '2026-10-07'], work: ['2026-09-20', '2026-10-10'] },
];

const marks = new Map<string, DayMark>();
for (const holiday of OFFICIAL) {
  for (let day = holiday.rest[0]; day <= holiday.rest[1]; day = addDays(day, 1)) marks.set(day, { kind: 'rest', name: holiday.name });
  for (const day of holiday.work) marks.set(day, { kind: 'work', name: holiday.name });
}

/** 法定放假日返回“休”，调休上班日返回“班”；未收录的年份返回 null。 */
export function dayMark(key: string): DayMark | null {
  return marks.get(key) ?? null;
}

const lunarParts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
const LUNAR_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', ['十一月', '冬月'], ['十二月', '腊月']];

/** 农历月（1–12，闰月返回 0）与日。 */
export function lunarMonthDay(key: string): { month: number; day: number } {
  const parts = lunarParts.formatToParts(parseDate(key));
  const monthText = parts.find(part => part.type === 'month')?.value ?? '';
  const day = Number(parts.find(part => part.type === 'day')?.value);
  const month = monthText.startsWith('闰') ? 0 : LUNAR_MONTHS.findIndex(name => Array.isArray(name) ? name.includes(monthText) : name === monthText) + 1;
  return { month, day };
}

const LUNAR_FESTIVALS: Record<string, string> = { '1-1': '春节', '1-15': '元宵', '5-5': '端午', '7-7': '七夕', '7-15': '中元', '8-15': '中秋', '9-9': '重阳', '12-8': '腊八' };
const SOLAR_FESTIVALS: Record<string, string> = { '1-1': '元旦', '2-14': '情人节', '3-8': '妇女节', '3-12': '植树节', '5-1': '劳动节', '5-4': '青年节', '6-1': '儿童节', '7-1': '建党节', '8-1': '建军节', '9-10': '教师节', '10-1': '国庆节', '12-25': '圣诞节' };

// 21 世纪清明日期公式：[Y×0.2422+4.81]−[(Y−1)/4]，Y 为年份后两位。
function qingmingDay(year: number): number {
  const y = year % 100;
  return Math.floor(y * 0.2422 + 4.81) - Math.floor((y - 1) / 4);
}

/** 日期格显示用的节日名称：农历节日优先，其次公历节日和清明、除夕。 */
const festivalCache = new Map<string, string>();
export function festivalName(key: string): string {
  let name = festivalCache.get(key);
  if (name === undefined) {
    name = computeFestival(key);
    if (festivalCache.size > 2000) festivalCache.clear();
    festivalCache.set(key, name);
  }
  return name;
}

function computeFestival(key: string): string {
  const date = parseDate(key);
  const lunar = lunarMonthDay(key);
  const lunarName = lunar.month ? LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`] : undefined;
  if (lunarName) return lunarName;
  const next = lunarMonthDay(addDays(key, 1));
  if (next.month === 1 && next.day === 1) return '除夕';
  const year = date.getFullYear();
  if (year >= 2001 && year <= 2099 && date.getMonth() === 3 && date.getDate() === qingmingDay(year)) return '清明';
  return SOLAR_FESTIVALS[`${date.getMonth() + 1}-${date.getDate()}`] ?? '';
}

// ---- 德国法定节假日（按复活节推算，无需每年更新） ----
export const GERMAN_STATES = [
  ['', '仅全国性假日'], ['BW', '巴登-符腾堡'], ['BY', '巴伐利亚'], ['BE', '柏林'], ['BB', '勃兰登堡'], ['HB', '不来梅'], ['HH', '汉堡'],
  ['HE', '黑森'], ['MV', '梅克伦堡-前波美拉尼亚'], ['NI', '下萨克森'], ['NW', '北莱茵-威斯特法伦'], ['RP', '莱茵兰-普法尔茨'],
  ['SL', '萨尔'], ['SN', '萨克森'], ['ST', '萨克森-安哈尔特'], ['SH', '石勒苏益格-荷尔斯泰因'], ['TH', '图林根'],
] as const;
export type GermanState = typeof GERMAN_STATES[number][0];
export interface GermanHoliday { name: string; german: string; }

function pad(value: number) { return String(value).padStart(2, '0'); }
// Gregorian Easter Sunday (anonymous Gregorian algorithm).
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const germanCache = new Map<string, Map<string, GermanHoliday>>();
function germanYear(year: number, state: GermanState): Map<string, GermanHoliday> {
  const cacheKey = `${year}:${state}`;
  const cached = germanCache.get(cacheKey);
  if (cached) return cached;
  const easter = easterSunday(year);
  const list: [string, string, string, string[] | null][] = [
    [`${year}-01-01`, '新年', 'Neujahr', null],
    [`${year}-01-06`, '三王节', 'Heilige Drei Könige', ['BW', 'BY', 'ST']],
    [`${year}-03-08`, '妇女节', 'Internationaler Frauentag', ['BE', 'MV']],
    [addDays(easter, -2), '耶稣受难日', 'Karfreitag', null],
    [easter, '复活节', 'Ostersonntag', ['BB']],
    [addDays(easter, 1), '复活节星期一', 'Ostermontag', null],
    [`${year}-05-01`, '劳动节', 'Tag der Arbeit', null],
    [addDays(easter, 39), '耶稣升天节', 'Christi Himmelfahrt', null],
    [addDays(easter, 49), '圣灵降临节', 'Pfingstsonntag', ['BB']],
    [addDays(easter, 50), '圣灵降临节星期一', 'Pfingstmontag', null],
    [addDays(easter, 60), '基督圣体节', 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']],
    [`${year}-08-15`, '圣母升天节', 'Mariä Himmelfahrt', ['SL']],
    [`${year}-09-20`, '儿童节', 'Weltkindertag', ['TH']],
    [`${year}-10-03`, '统一日', 'Tag der Deutschen Einheit', null],
    [`${year}-10-31`, '宗教改革日', 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']],
    [`${year}-11-01`, '万圣节', 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']],
    // Buß- und Bettag: the Wednesday before 23 November.
    [addDays(`${year}-11-23`, -(((parseDate(`${year}-11-23`).getDay() - 3 + 7) % 7) || 7)), '忏悔祈祷日', 'Buß- und Bettag', ['SN']],
    [`${year}-12-25`, '圣诞节', '1. Weihnachtstag', null],
    [`${year}-12-26`, '圣诞节次日', '2. Weihnachtstag', null],
  ];
  const result = new Map<string, GermanHoliday>();
  for (const [key, name, german, states] of list) if (!states || (state && states.includes(state))) result.set(key, { name, german });
  if (germanCache.size > 40) germanCache.clear();
  germanCache.set(cacheKey, result);
  return result;
}

/** 德国法定假日：默认只含全国性假日，选了联邦州时加上该州假日。 */
export function germanHoliday(key: string, state: GermanState = ''): GermanHoliday | null {
  const year = Number(key.slice(0, 4));
  if (!Number.isInteger(year) || year < 1990 || year > 2200) return null;
  return germanYear(year, state).get(key) ?? null;
}
