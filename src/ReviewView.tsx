import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb, Trash2 } from 'lucide-react';
import type { Reflection } from './types';
import { monthRange, reflectionsBetween, reflectionsByDay, REFLECTION_MAX_TEXT, REVIEW_REMINDER_TIME, shiftRange, weekRange } from './reflections';
import { parseDate } from './core';

type Mode = 'day' | 'week' | 'month';

const dayLabel = (key: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(parseDate(key));
const shortLabel = (key: string) => `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日`;

/** 复盘：回车记一条，按天编号；本周 / 本月汇总把感悟连起来编号，方便回看。 */
export function ReviewView({ reflections, today, initialMode = 'day', remind, onAdd, onEdit }: {
  reflections: Reflection[] | undefined; today: string; initialMode?: Mode; remind: boolean;
  onAdd: (date: string, text: string) => void; onEdit: (id: string, text: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [anchor, setAnchor] = useState(today);
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState('');
  useEffect(() => { setMode(initialMode); setAnchor(today); }, [initialMode, today]);

  function submit() {
    if (!draft.trim()) return;
    onAdd(date || today, draft);
    setDraft('');
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  }

  const range = mode === 'week' ? weekRange(anchor) : monthRange(anchor);
  const inRange = mode === 'day' ? [] : reflectionsBetween(reflections, range.start, range.end);
  const days = reflectionsByDay(reflections);
  const rangeTitle = mode === 'week' ? `${shortLabel(range.start)} – ${shortLabel(range.end)}` : `${Number(range.start.slice(0, 4))} 年 ${Number(range.start.slice(5, 7))} 月`;

  return <div className="list-view review-view">
    <div className="review-top">
      <h2><Lightbulb size={17} />复盘</h2>
      <div className="view-switch">{([['day', '按天'], ['week', '本周汇总'], ['month', '本月汇总']] as const).map(([value, label]) =>
        <button key={value} className={mode === value ? 'active' : ''} onClick={() => { setMode(value); setAnchor(today); }}>{label}</button>)}</div>
    </div>
    {mode === 'day' ? <>
      <div className="review-add">
        <textarea rows={2} value={draft} maxLength={REFLECTION_MAX_TEXT} placeholder="写下一条感悟或想法，回车记一条（Shift+回车换行）" onChange={e => setDraft(e.target.value)} onKeyDown={onKey} />
        <div className="review-add-bar"><label>记在<input type="date" value={date} onChange={e => setDate(e.target.value || today)} /></label><span>每周日 {REVIEW_REMINDER_TIME}{remind ? ' 提醒你看本周汇总' : ' 的汇总提醒已关闭'}</span><button className="primary" disabled={!draft.trim()} onClick={submit}>记下</button></div>
      </div>
      {days.map(group => <section key={group.date} className="review-day">
        <h3>{dayLabel(group.date)}{group.date === today && <em>今天</em>}<span>{group.items.length} 条</span></h3>
        <ol>{group.items.map((item, index) => <ReviewItem key={item.id} item={item} number={index + 1} onEdit={onEdit} />)}</ol>
      </section>)}
      {!days.length && <div className="empty-state"><Lightbulb size={34} /><h3>还没有复盘</h3><p>对一件事有了感悟，就在上面写一句，回车记下。</p></div>}
    </> : <>
      <div className="review-range">
        <button className="icon-button" aria-label="上一段" onClick={() => setAnchor(shiftRange(anchor, mode, -1))}><ChevronLeft size={17} /></button>
        <strong>{rangeTitle}</strong>
        <button className="icon-button" aria-label="下一段" onClick={() => setAnchor(shiftRange(anchor, mode, 1))}><ChevronRight size={17} /></button>
        <span>{inRange.length ? `共 ${inRange.length} 条感悟，来自 ${new Set(inRange.map(item => item.date)).size} 天` : '这段时间还没有复盘'}</span>
      </div>
      <ol className="review-summary">{inRange.map((item, index) => <ReviewItem key={item.id} item={item} number={index + 1} tag={shortLabel(item.date)} onEdit={onEdit} />)}</ol>
    </>}
  </div>;
}

function ReviewItem({ item, number, tag, onEdit }: { item: Reflection; number: number; tag?: string; onEdit: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setText(item.text); }, [item.text, editing]);
  useEffect(() => { if (editing) { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } }, [editing]);
  const finish = () => { setEditing(false); if (text.trim() !== item.text) onEdit(item.id, text); };
  return <li className="review-item">
    <span className="review-num">{number}</span>
    {editing
      ? <textarea ref={box} rows={Math.min(6, text.split('\n').length + 1)} value={text} maxLength={REFLECTION_MAX_TEXT} onChange={e => setText(e.target.value)} onBlur={finish} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); finish(); } if (e.key === 'Escape') { setText(item.text); setEditing(false); } }} />
      : <p onClick={() => setEditing(true)} title="点一下修改">{item.text}{tag && <small>{tag}</small>}</p>}
    <button className="icon-button review-delete" title="删除这条" aria-label="删除这条" onClick={() => { if (window.confirm('删除这条复盘？')) onEdit(item.id, ''); }}><Trash2 size={14} /></button>
  </li>;
}
