import { useState } from 'react';
import { BookMarked, Check, GraduationCap } from 'lucide-react';
import type { ClassMark, ClassStatus } from './types';
import { parseDate } from './core';
import { CLASS_STATUS_LABEL, classMarkFor, classState, reviewClasses } from './classes';
import type { ClassState } from './classes';
import type { DayClass } from './timetable';

const dayLabel = (key: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(parseDate(key));
export const STATE_TAG: Record<ClassState, string> = { done: '✓', todo: '未', review: '复', upcoming: '' };
const STATE_TEXT: Record<ClassState, string> = { ...CLASS_STATUS_LABEL, upcoming: '还没上' };

/** 一节课的编辑：选状态、写一句备注。 */
export function ClassEditor({ title, time, date, mark, state, onSave, onClose }: { title: string; time: string; date: string; mark?: ClassMark; state: ClassState; onSave: (status: ClassStatus, note: string) => void; onClose: () => void }) {
  const [status, setStatus] = useState<ClassStatus>(state === 'upcoming' ? 'todo' : state);
  const [note, setNote] = useState(mark?.note ?? '');
  return <form className="class-editor" onSubmit={e => { e.preventDefault(); onSave(status, note); onClose(); }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
    <header><GraduationCap size={17} /><div><strong>{title || '未命名课程'}</strong><small>{dayLabel(date)} · {time}</small></div></header>
    <div className="class-status-pick" role="radiogroup" aria-label="这节课的状态">{(['done', 'todo', 'review'] as const).map(value =>
      <button key={value} type="button" role="radio" aria-checked={status === value} className={`status-${value} ${status === value ? 'on' : ''}`} onClick={() => setStatus(value)}>{CLASS_STATUS_LABEL[value]}</button>)}</div>
    <textarea autoFocus rows={3} maxLength={2000} value={note} placeholder={status === 'review' ? '要复习什么？比如：第 3 章例题、作业 2' : '备注（可选）'} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(status, note); onClose(); } }} />
    <footer><span>Ctrl+回车保存 · Esc 关闭</span><button type="button" className="secondary" onClick={onClose}>取消</button><button type="submit" className="primary">保存</button></footer>
  </form>;
}

/** 管理窗口右栏：这天的课和状态，点状态直接改。 */
export function DayClasses({ classes, date, marks, onSet, onEdit }: { classes: DayClass[]; date: string; marks?: ClassMark[]; onSet: (slot: DayClass, status: ClassStatus) => void; onEdit: (slot: DayClass) => void }) {
  if (!classes.length) return null;
  return <div className="day-classes">{classes.map(slot => {
    const mark = classMarkFor(marks, slot.id, date);
    const state = classState(mark, date, slot.end);
    return <div key={slot.id} className={`day-class status-${state}`}>
      <button className="day-class-main" onClick={() => onEdit(slot)} title="编辑状态和备注"><small>{slot.start}</small><span>{slot.title}{mark?.note && <em>{mark.note}</em>}</span></button>
      <span className="day-class-states">{(['done', 'todo', 'review'] as const).map(value => <button key={value} className={`status-${value} ${state === value ? 'on' : ''}`} onClick={() => onSet(slot, value)}>{CLASS_STATUS_LABEL[value]}</button>)}</span>
    </div>;
  })}</div>;
}

/** 待复习清单：复习完点“已复习”就变成已上。 */
export function ReviewClassList({ marks, onDone, onOpen }: { marks?: ClassMark[]; onDone: (mark: ClassMark) => void; onOpen: (mark: ClassMark) => void }) {
  const items = reviewClasses(marks);
  return <div className="list-view class-review-list">
    <div className="list-view-title"><h2>待复习的课</h2><span>{items.length} 节</span></div>
    {items.map(mark => <div key={mark.id} className="class-review-item">
      <button className="class-review-main" onClick={() => onOpen(mark)}><strong>{mark.title || '未命名课程'}</strong><small>{dayLabel(mark.date)}</small>{mark.note && <p>{mark.note}</p>}</button>
      <button className="secondary" onClick={() => onDone(mark)}><Check size={14} />已复习</button>
    </div>)}
    {!items.length && <div className="empty-state"><BookMarked size={34} /><h3>没有待复习的课</h3><p>在日历上单击课程切换“已上 / 待复习 / 未上”，双击可以写备注。</p></div>}
  </div>;
}

export function classTitle(slot: DayClass, state: ClassState, mark?: ClassMark): string {
  return `${slot.start}–${slot.end} ${slot.title} · ${STATE_TEXT[state]}${mark?.note ? ` · ${mark.note}` : ''}${slot.alert ? ` · ⚠ ${slot.alert}` : ''}${slot.note ? ` · ${slot.note}` : ''}`;
}
