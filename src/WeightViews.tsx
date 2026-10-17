import { useState } from 'react';
import { Scale, Trash2 } from 'lucide-react';
import type { WeightEntry } from './types';
import { parseDate } from './core';
import { parseKg, weightHistory, weightOn, weightSeries } from './weight';

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

/** 体重走势（最近 days 天的点连成线）。 */
export function WeightChart({ weights, today, days = 60 }: { weights?: WeightEntry[]; today: string; days?: number }) {
  const series = weightSeries(weights, today, days);
  if (series.length < 2) return null;
  const min = Math.min(...series.map(item => item.kg)), max = Math.max(...series.map(item => item.kg));
  const low = Math.floor(min - 0.5), high = Math.ceil(max + 0.5);
  const start = parseDate(series[0].date).getTime(), span = Math.max(1, parseDate(series[series.length - 1].date).getTime() - start);
  const x = (date: string) => 24 + (parseDate(date).getTime() - start) / span * 552;
  const y = (kg: number) => 10 + (high - kg) / (high - low) * 120;
  return <svg className="weight-chart" viewBox="0 0 600 150" role="img" aria-label={`最近 ${days} 天体重走势`}>
    <text x="0" y="14">{high}</text><text x="0" y="134">{low}</text>
    <line x1="24" x2="576" y1="130" y2="130" />
    <polyline points={series.map(item => `${x(item.date)},${y(item.kg)}`).join(' ')} />
    {series.map(item => <circle key={item.id} cx={x(item.date)} cy={y(item.kg)} r="3"><title>{`${item.date} ${fmt(item.kg)} kg`}</title></circle>)}
  </svg>;
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
