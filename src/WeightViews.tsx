import { useState } from 'react';
import { Scale, Trash2 } from 'lucide-react';
import type { WeightEntry } from './types';
import { parseDate } from './core';
import { parseKg, weightHistory, weightOn } from './weight';
import { weightChart, WEIGHT_RANGES, type WeightRange } from './weight-chart';

const dayLabel = (key: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(parseDate(key));
const fmt = (kg: number) => kg.toFixed(1);

/** 填某天的体重：回车保存，Esc 关闭。 */
export function WeightEditor({ date, weights, onSave, onClose }: { date: string; weights?: WeightEntry[]; onSave: (kg: number | null) => void; onClose: () => void }) {
  const current = weightOn(weights, date);
  const [text, setText] = useState(current ? fmt(current.kg) : '');
  const kg = parseKg(text);
  const previous = weightHistory(weights).find(item => item.date < date);
  const save = () => { if (kg === null) return; onSave(kg); onClose(); };
  return <form className="weight-editor" onSubmit={e => { e.preventDefault(); save(); }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
    <header><Scale size={17} /><div><strong>测体重</strong><small>{dayLabel(date)} · 08:00</small></div></header>
    <label className="weight-input"><input autoFocus inputMode="decimal" placeholder={previous ? fmt(previous.kg) : '例如 72.5'} value={text} onChange={e => setText(e.target.value)} /><span>kg</span></label>
    <p className="weight-hint">{text && kg === null ? '请输入 20–400 之间的数字，例如 72.5' : kg !== null && previous ? `比上次（${dayLabel(previous.date)} ${fmt(previous.kg)} kg）${kg > previous.kg ? '多' : kg < previous.kg ? '少' : '持平'}${kg !== previous.kg ? ` ${fmt(Math.abs(kg - previous.kg))} kg` : ''}` : '回车保存 · Esc 关闭'}</p>
    <footer>{current && <button type="button" className="icon-button" title="删除这天的记录" aria-label="删除这天的记录" onClick={() => { onSave(null); onClose(); }}><Trash2 size={15} /></button>}<span /><button type="button" className="secondary" onClick={onClose}>取消</button><button type="submit" className="primary" disabled={kg === null}>保存</button></footer>
  </form>;
}

/** 体重折线图：横轴日期，纵轴 kg；可切换 30 天 / 3 个月 / 1 年 / 全部。 */
export function WeightChart({ weights, today, compact = false }: { weights?: WeightEntry[]; today: string; compact?: boolean }) {
  const [range, setRange] = useState<WeightRange>(() => { try { const raw = localStorage.getItem('shiri-weight-range'); const v = Number(raw); return raw !== null && WEIGHT_RANGES.some(r => r.days === v) ? v as WeightRange : 90; } catch { return 90; } });
  const pick = (days: WeightRange) => { setRange(days); try { localStorage.setItem('shiri-weight-range', String(days)); } catch { /* ignore */ } };
  const box = { width: 600, height: compact ? 170 : 220, left: 34, right: 12, top: 12, bottom: 24 };
  const chart = weightChart(weights, today, range, box);
  const change = chart.first && chart.last && chart.first.id !== chart.last.id ? chart.last.kg - chart.first.kg : null;
  return <div className={`weight-chart-card${compact ? ' compact' : ''}`}>
    <div className="weight-chart-head"><span>{change === null ? '体重走势' : `这段时间 ${change > 0 ? '+' : change < 0 ? '−' : '±'}${fmt(Math.abs(change))} kg`}</span><div className="weight-ranges">{WEIGHT_RANGES.map(r => <button key={r.days} type="button" className={range === r.days ? 'active' : ''} onClick={() => pick(r.days)}>{r.label}</button>)}</div></div>
    {chart.points.length ? <svg className="weight-chart" viewBox={`0 0 ${box.width} ${box.height}`} role="img" aria-label="体重随日期变化的折线图">
      {chart.yTicks.map(t => <g key={t.kg}><line x1={box.left} x2={box.width - box.right} y1={t.y} y2={t.y} /><text x={box.left - 6} y={t.y + 4} textAnchor="end">{t.kg}</text></g>)}
      {chart.xTicks.map(t => <text key={t.date} x={t.x} y={box.height - 6} textAnchor={t.x < box.left + 20 ? 'start' : t.x > box.width - box.right - 20 ? 'end' : 'middle'}>{t.label}</text>)}
      {chart.points.length > 1 && <polyline points={chart.line} />}
      {chart.points.map(p => <circle key={p.id} cx={p.x} cy={p.y} r={chart.points.length > 60 ? 2 : 3}><title>{`${dayLabel(p.date)} ${fmt(p.kg)} kg`}</title></circle>)}
    </svg> : <p className="weight-chart-empty">这段时间还没有体重记录</p>}
  </div>;
}

/** 管理窗口“体重”页：走势和每天的记录。 */
export function WeightView({ weights, today, remind, onOpen }: { weights?: WeightEntry[]; today: string; remind: boolean; onOpen: (date: string) => void }) {
  const history = weightHistory(weights);
  return <div className="list-view weight-view">
    <div className="list-view-title"><h2><Scale size={16} />体重</h2><span>{history.length} 天</span><button className="primary weight-today" onClick={() => onOpen(today)}>{weightOn(weights, today) ? '改今天的体重' : '记今天的体重'}</button></div>
    <p className="weight-hint">每天 08:00 的日程里有“测体重”，点它填数字，填了就算完成。{remind ? '没填的话 08:00 会提醒一次。' : ''}</p>
    <WeightChart weights={weights} today={today} />
    <ol className="weight-list">{history.map((item, index) => {
      const before = history[index + 1];
      const diff = before ? item.kg - before.kg : 0;
      return <li key={item.id}><button onClick={() => onOpen(item.date)}><span>{dayLabel(item.date)}</span><b>{fmt(item.kg)} kg</b><small className={diff > 0 ? 'up' : diff < 0 ? 'down' : ''}>{before ? `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${fmt(Math.abs(diff))}` : ''}</small></button></li>;
    })}</ol>
    {!history.length && <div className="empty-state"><Scale size={34} /><h3>还没有体重记录</h3><p>点上面的按钮，或日历里 08:00 的“测体重”。</p></div>}
  </div>;
}
