import { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import type { WeightEntry } from '@shared/types';
import { parseDate } from '@shared/core';
import { parseKg, WEIGHT_TIME, weightHistory, weightOn } from '@shared/weight';
import { weightChart, WEIGHT_RANGES, type WeightRange } from '@shared/weight-chart';

const dayLabel = (key: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(parseDate(key));

/** 当天列表里的“测体重”：直接填数字，回车或离开输入框就保存，填了算完成。 */
export function WeightRow({ date, weights, onSave, onHistory }: { date: string; weights?: WeightEntry[]; onSave: (kg: number | null) => void; onHistory: () => void }) {
  const current = weightOn(weights, date);
  const [text, setText] = useState(current ? current.kg.toFixed(1) : '');
  useEffect(() => { setText(current ? current.kg.toFixed(1) : ''); }, [current?.kg, date]);
  const commit = () => {
    if (!text.trim()) { if (current) onSave(null); return; }
    const kg = parseKg(text);
    if (kg === null) { setText(current ? current.kg.toFixed(1) : ''); return; }
    if (kg !== current?.kg) onSave(kg);
  };
  return (
    <li className={`task-row weight-row${current ? ' done-weight' : ''}`} style={{ '--c': '#C9822B' } as React.CSSProperties}>
      <span className="weight-icon"><Scale size={18} /></span>
      <span className="task-main weight-main">
        <span className="task-title">测体重</span>
        <span className="task-meta"><span>{WEIGHT_TIME}</span><button className="link-btn weight-history-btn" onClick={onHistory}>看记录</button></span>
      </span>
      <label className="weight-field"><input inputMode="decimal" enterKeyHint="done" placeholder="—" value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /><span>kg</span></label>
    </li>
  );
}

/** 体重折线图：横轴日期，纵轴 kg，可切换 30 天 / 3 个月 / 1 年 / 全部。 */
export function WeightChart({ weights, today }: { weights?: WeightEntry[]; today: string }) {
  const [range, setRange] = useState<WeightRange>(() => { try { const raw = localStorage.getItem('shiri-weight-range'); const v = Number(raw); return raw !== null && WEIGHT_RANGES.some(r => r.days === v) ? v as WeightRange : 90; } catch { return 90; } });
  const pick = (days: WeightRange) => { setRange(days); try { localStorage.setItem('shiri-weight-range', String(days)); } catch { /* ignore */ } };
  const box = { width: 350, height: 180, left: 30, right: 8, top: 10, bottom: 22 };
  const chart = weightChart(weights, today, range, box);
  const change = chart.first && chart.last && chart.first.id !== chart.last.id ? chart.last.kg - chart.first.kg : null;
  return (
    <div className="weight-chart-box">
      <div className="weight-chart-head"><span>{change === null ? '体重走势' : `这段时间 ${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change).toFixed(1)} kg`}</span></div>
      <div className="weight-ranges">{WEIGHT_RANGES.map(r => <button key={r.days} className={range === r.days ? 'active' : ''} onClick={() => pick(r.days)}>{r.label}</button>)}</div>
      {chart.points.length ? <svg className="weight-chart" viewBox={`0 0 ${box.width} ${box.height}`} role="img" aria-label="体重随日期变化的折线图">
        {chart.yTicks.map(t => <g key={t.kg}><line x1={box.left} x2={box.width - box.right} y1={t.y} y2={t.y} /><text x={box.left - 5} y={t.y + 3.5} textAnchor="end">{t.kg}</text></g>)}
        {chart.xTicks.map(t => <text key={t.date} x={t.x} y={box.height - 5} textAnchor={t.x < box.left + 14 ? 'start' : t.x > box.width - box.right - 14 ? 'end' : 'middle'}>{t.label}</text>)}
        {chart.points.length > 1 && <polyline points={chart.line} />}
        {chart.points.map(p => <circle key={p.id} cx={p.x} cy={p.y} r={chart.points.length > 60 ? 1.8 : 2.8} />)}
      </svg> : <p className="weight-chart-empty">这段时间还没有体重记录</p>}
    </div>
  );
}

/** 体重记录：走势和每天的数字。 */
export function WeightHistorySheet({ weights, today, onClose }: { weights?: WeightEntry[]; today: string; onClose: () => void }) {
  const history = weightHistory(weights);
  const chart = <WeightChart weights={weights} today={today} />;
  return (
    <div className="sheet-layer" onClick={onClose}>
      <div className="sheet weight-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-bar"><span /><span className="grab" /><button className="text-btn strong" onClick={onClose}>完成</button></div>
        <h3 className="weight-sheet-title"><Scale size={18} />体重记录</h3>
        {chart}
        <ul className="weight-days">{history.map((item, index) => { const before = history[index + 1]; const diff = before ? item.kg - before.kg : 0; return <li key={item.id}><span>{dayLabel(item.date)}</span><b>{item.kg.toFixed(1)} kg</b><small className={diff > 0 ? 'up' : diff < 0 ? 'down' : ''}>{before ? `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff).toFixed(1)}` : ''}</small></li>; })}</ul>
        {!history.length && <p className="empty">还没有记录。每天早上在 08:00 的“测体重”里填上数字。</p>}
      </div>
    </div>
  );
}
