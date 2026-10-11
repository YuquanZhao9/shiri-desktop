import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import type { Reflection } from '@shared/types';
import { parseDate } from '@shared/core';
import { monthRange, reflectionsBetween, reflectionsByDay, REFLECTION_MAX_TEXT, REVIEW_REMINDER_TIME, shiftRange, weekRange } from '@shared/reflections';

type Mode = 'day' | 'week' | 'month';
const dayLabel = (key: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(parseDate(key));
const shortLabel = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const isEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229;

/** 手机复盘：回车记一条，按天编号；本周 / 本月汇总连起来编号。 */
export function Review({ reflections, today, mode, onMode, remind, onAdd, onEdit }: {
  reflections: Reflection[] | undefined; today: string; mode: Mode; onMode: (mode: Mode) => void; remind: boolean;
  onAdd: (date: string, text: string) => void; onEdit: (id: string, text: string) => void;
}) {
  const [anchor, setAnchor] = useState(today);
  const [draft, setDraft] = useState('');
  useEffect(() => setAnchor(today), [mode, today]);
  const submit = () => { if (!draft.trim()) return; onAdd(today, draft); setDraft(''); };
  const range = mode === 'week' ? weekRange(anchor) : monthRange(anchor);
  const items = mode === 'day' ? [] : reflectionsBetween(reflections, range.start, range.end);
  const days = reflectionsByDay(reflections);
  return (
    <div className="review">
      <div className="seg small">{([['day', '按天'], ['week', '本周汇总'], ['month', '本月汇总']] as const).map(([value, label]) =>
        <button key={value} className={mode === value ? 'on' : ''} onClick={() => onMode(value)}>{label}</button>)}</div>
      {mode === 'day' ? <>
        <form className="review-add" onSubmit={e => { e.preventDefault(); submit(); }}>
          <textarea rows={2} value={draft} maxLength={REFLECTION_MAX_TEXT} enterKeyHint="send" placeholder="写下一条感悟，回车就记一条" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (isEnter(e)) { e.preventDefault(); submit(); } }} />
          {draft.trim() && <button type="submit" className="quick-save">记下</button>}
        </form>
        <p className="review-hint">每周日 {REVIEW_REMINDER_TIME}{remind ? ' 把这一周的感悟汇总，提醒你来看' : ' 的汇总提醒已关闭（我的 → 日程提醒）'}</p>
        {days.map(group => (
          <section key={group.date} className="review-day">
            <h3>{dayLabel(group.date)}{group.date === today && <em>今天</em>}<span>{group.items.length} 条</span></h3>
            <ol>{group.items.map((item, i) => <Item key={item.id} item={item} n={i + 1} onEdit={onEdit} />)}</ol>
          </section>
        ))}
        {!days.length && <p className="empty">还没有复盘。对一件事有了感悟，写一句，回车记下。</p>}
      </> : <>
        <div className="review-range">
          <button aria-label="上一段" onClick={() => setAnchor(shiftRange(anchor, mode, -1))}><ChevronLeft size={20} /></button>
          <b>{mode === 'week' ? `${shortLabel(range.start)} – ${shortLabel(range.end)}` : `${Number(range.start.slice(0, 4))} 年 ${Number(range.start.slice(5, 7))} 月`}</b>
          <button aria-label="下一段" onClick={() => setAnchor(shiftRange(anchor, mode, 1))}><ChevronRight size={20} /></button>
        </div>
        <p className="review-hint">{items.length ? `共 ${items.length} 条感悟，来自 ${new Set(items.map(i => i.date)).size} 天` : '这段时间还没有复盘'}</p>
        <ol className="review-summary">{items.map((item, i) => <Item key={item.id} item={item} n={i + 1} tag={shortLabel(item.date)} onEdit={onEdit} />)}</ol>
      </>}
    </div>
  );
}

function Item({ item, n, tag, onEdit }: { item: Reflection; n: number; tag?: string; onEdit: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setText(item.text); }, [item.text, editing]);
  useEffect(() => { if (editing) box.current?.focus(); }, [editing]);
  const finish = () => { setEditing(false); if (text.trim() !== item.text) onEdit(item.id, text); };
  return (
    <li className="review-item">
      <span className="review-num">{n}</span>
      {editing
        ? <textarea ref={box} rows={3} value={text} maxLength={REFLECTION_MAX_TEXT} enterKeyHint="done" onChange={e => setText(e.target.value)} onBlur={finish} onKeyDown={e => { if (isEnter(e)) { e.preventDefault(); finish(); } }} />
        : <p onClick={() => setEditing(true)}>{item.text}{tag && <small>{tag}</small>}</p>}
      {editing && <button className="review-del" aria-label="删除这条" onMouseDown={e => e.preventDefault()} onClick={() => { if (confirm('删除这条复盘？')) { setEditing(false); onEdit(item.id, ''); } }}><Trash2 size={16} /></button>}
    </li>
  );
}
