import { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import type { WeightEntry } from '@shared/types';
import { parseDate } from '@shared/core';
import { parseKg, WEIGHT_TIME, weightHistory, weightOn, weightSeries } from '@shared/weight';

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

/** 体重记录：最近 30 天走势和每天的数字。 */
export function WeightHistorySheet({ weights, today, onClose }: { weights?: WeightEntry[]; today: string; onClose: () => void }) {
  const history = weightHistory(weights);
  const series = weightSeries(weights, today, 30);
  let chart = null;
  if (series.length >= 2) {
    const min = Math.min(...series.map(i => i.kg)), max = Math.max(...series.map(i => i.kg));
    const low = Math.floor(min - 0.5), high = Math.ceil(max + 0.5);
    const start = parseDate(series[0].date).getTime(), span = Math.max(1, parseDate(series[series.length - 1].date).getTime() - start);
    const x = (d: string) => 22 + (parseDate(d).getTime() - start) / span * 316, y = (kg: number) => 8 + (high - kg) / (high - low) * 104;
    chart = <svg className="weight-chart" viewBox="0 0 350 120"><text x="0" y="12">{high}</text><text x="0" y="114">{low}</text><polyline points={series.map(i => `${x(i.date)},${y(i.kg)}`).join(' ')} />{series.map(i => <circle key={i.id} cx={x(i.date)} cy={y(i.kg)} r="3" />)}</svg>;
  }
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
