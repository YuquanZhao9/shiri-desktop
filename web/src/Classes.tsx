import { useState } from 'react';
import { Check } from 'lucide-react';
import type { ClassMark, ClassStatus } from '@shared/types';
import { parseDate } from '@shared/core';
import { CLASS_STATUS_LABEL, reviewClasses } from '@shared/classes';
import type { ClassState } from '@shared/classes';

const dayLabel = (key: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(parseDate(key));

/** 一节课：选 已上 / 未上 / 待复习，写一句备注。 */
export function ClassSheet({ title, time, date, mark, state, onSave, onClose }: { title: string; time: string; date: string; mark?: ClassMark; state: ClassState; onSave: (status: ClassStatus, note: string) => void; onClose: () => void }) {
  const [status, setStatus] = useState<ClassStatus>(state === 'upcoming' ? 'todo' : state);
  const [note, setNote] = useState(mark?.note ?? '');
  const done = () => { onSave(status, note); onClose(); };
  return (
    <div className="sheet-layer" onClick={done}>
      <div className="sheet class-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-bar"><button className="text-btn" onClick={onClose}>取消</button><span className="grab" /><button className="text-btn strong" onClick={done}>完成</button></div>
        <h3 className="class-sheet-title"><i className="class-tag">课</i>{title || '未命名课程'}<small>{dayLabel(date)}{time && ` · ${time}`}</small></h3>
        <div className="class-pick">{(['done', 'todo', 'review'] as const).map(value => <button key={value} className={`status-${value}${status === value ? ' on' : ''}`} onClick={() => setStatus(value)}>{CLASS_STATUS_LABEL[value]}</button>)}</div>
        <textarea className="class-note-input" rows={3} maxLength={2000} value={note} placeholder={status === 'review' ? '要复习什么？比如：第 3 章例题、作业 2' : '备注（可选）'} onChange={e => setNote(e.target.value)} />
      </div>
    </div>
  );
}

/** 课表页顶部的“待复习”清单。 */
export function ReviewClassCard({ marks, onDone, onOpen }: { marks?: ClassMark[]; onDone: (mark: ClassMark) => void; onOpen: (mark: ClassMark) => void }) {
  const items = reviewClasses(marks);
  if (!items.length) return null;
  return (
    <div className="review-classes">
      <h3>待复习<span>{items.length} 节</span></h3>
      {items.map(mark => (
        <div key={mark.id} className="review-class">
          <button className="review-class-main" onClick={() => onOpen(mark)}><b>{mark.title || '未命名课程'}</b><small>{dayLabel(mark.date)}</small>{mark.note && <span>{mark.note}</span>}</button>
          <button className="review-class-done" onClick={() => onDone(mark)}><Check size={16} />已复习</button>
        </div>
      ))}
    </div>
  );
}
