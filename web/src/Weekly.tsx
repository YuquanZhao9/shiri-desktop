import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import type { GoalMark, WeeklyGoal } from '@shared/types';
import { parseDate } from '@shared/core';
import { weekRange } from '@shared/reflections';
import { activeGoals, defaultTime, GOAL_COLORS, goalHistory, goalWeeks, markDuration } from '@shared/weekly';
import type { GoalSettings, GoalWeek } from '@shared/weekly';

export interface WeeklyActions {
  saveGoal: (goal: GoalSettings) => void;
  deleteGoal: (id: string) => void;
  addMark: (goalId: string, date: string, done: boolean, time?: string) => void;
  moveMark: (id: string, date: string, time?: string) => void;
  setMarkDone: (id: string, done: boolean) => void;
  removeMark: (id: string) => void;
  replan: (goalId?: string) => void;
  openSettings: () => void;
}

const short = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const weekday = (key: string) => ['日', '一', '二', '三', '四', '五', '六'][parseDate(key).getDay()];
const shiftWeek = (key: string, step: number) => { const d = parseDate(key); d.setDate(d.getDate() + step * 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function Cells({ week, date, actions }: { week: GoalWeek; date: string; actions: WeeklyActions }) {
  return <span className="wk-cells">{week.cells.map((cell, i) => cell.kind === 'done'
    ? <button key={cell.mark.id} className="wk-cell done" style={{ '--goal': week.goal.color } as React.CSSProperties} aria-label={`撤销 ${short(cell.mark.date)} 的完成`} onClick={() => actions.removeMark(cell.mark.id)}><Check size={14} strokeWidth={3} /></button>
    : cell.kind === 'planned'
      ? <button key={cell.mark.id} className="wk-cell planned" style={{ '--goal': week.goal.color } as React.CSSProperties} aria-label={`完成（安排在 ${cell.mark.date}）`} onClick={() => actions.setMarkDone(cell.mark.id, true)}>{weekday(cell.mark.date)}</button>
      : <button key={`e${i}`} className={`wk-cell${week.reached ? ' extra' : ''}`} style={{ '--goal': week.goal.color } as React.CSSProperties} aria-label={`${short(date)} 完成一次`} onClick={() => actions.addMark(week.goal.id, date, true)} />)}</span>;
}

/** 日历页的“本周周次任务”卡片：点空格 = 选中的那天完成一次。 */
export function WeeklyCard({ goals, marks, date, onManage, actions }: { goals?: WeeklyGoal[]; marks?: GoalMark[]; date: string; onManage: () => void; actions: WeeklyActions }) {
  const weeks = goalWeeks(goals, marks, date);
  return (
    <div className="wk-card">
      <div className="wk-head"><span><Target size={16} />本周周次任务</span><small>点空格 = {short(date)} 完成一次</small><button className="text-btn" onClick={onManage}>{weeks.length ? '调整时间' : '添加'}</button></div>
      {weeks.map(week => (
        <div key={week.goal.id} className={`wk-row${week.reached ? ' reached' : ''}`} style={{ '--goal': week.goal.color } as React.CSSProperties}>
          <b>{week.goal.name}</b><Cells week={week} date={date} actions={actions} /><span className="wk-count">{week.done.length}/{week.goal.target}</span>
        </div>
      ))}
      {!weeks.length && <p className="wk-empty">比如“健身 每周 3 次”，不用定哪天，做够次数就好。</p>}
    </div>
  );
}

/** 管理：添加、修改、删除任务，看最近几周。 */
export function WeeklySheet({ goals, marks, today, onClose, actions }: { goals?: WeeklyGoal[]; marks?: GoalMark[]; today: string; onClose: () => void; actions: WeeklyActions }) {
  const [anchor, setAnchor] = useState(today);
  const [editing, setEditing] = useState<GoalSettings | null>(activeGoals(goals).length ? null : { name: '', color: GOAL_COLORS[0], target: 3, slots: 4, duration: 60, time: '10:00' });
  const weeks = goalWeeks(goals, marks, anchor);
  const range = weekRange(anchor);
  return (
    <div className="sheet-layer" onClick={onClose}>
      <div className="sheet wk-sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-bar"><button className="text-btn" onClick={() => setEditing({ name: '', color: GOAL_COLORS[(goals?.length ?? 0) % GOAL_COLORS.length], target: 3, slots: 4, duration: 60, time: '10:00' })}><Plus size={16} />添加</button><span className="grab" /><button className="text-btn strong" onClick={onClose}>完成</button></div>
        {range.start === weekRange(today).start && weeks.length > 0 && <button className="secondary wide wk-replan" onClick={() => actions.replan()}>按现在的设置重新排本周剩下的</button>}
        <div className="wk-range"><button aria-label="上一周" onClick={() => setAnchor(shiftWeek(anchor, -1))}><ChevronLeft size={20} /></button><b>{short(range.start)} – {short(range.end)}</b><button aria-label="下一周" onClick={() => setAnchor(shiftWeek(anchor, 1))}><ChevronRight size={20} /></button></div>
        {editing && <Form value={editing} onCancel={() => setEditing(null)} onSave={value => { actions.saveGoal(value); setEditing(null); }} />}
        {weeks.map(week => {
          const history = goalHistory(week.goal, marks, today, 8);
          return (
            <section key={week.goal.id} className={`wk-goal${week.reached ? ' reached' : ''}`} style={{ '--goal': week.goal.color } as React.CSSProperties}>
              <header><b>{week.goal.name}</b><span className="wk-count">{week.done.length}/{week.goal.target}</span><em>{week.reached ? '已达标' : `还差 ${week.remaining} 次`}</em>
                <button aria-label="修改" onClick={() => setEditing({ id: week.goal.id, name: week.goal.name, color: week.goal.color, target: week.goal.target, slots: week.goal.slots, duration: week.goal.duration ?? 60, time: week.goal.time ?? defaultTime(week.goal.name), earliest: week.goal.earliest ?? '09:00', latest: week.goal.latest ?? '21:00', days: week.goal.days ?? [1, 2, 3, 4, 5, 6, 7] })}><Pencil size={15} /></button>
                <button aria-label="删除" onClick={() => { if (confirm(`删除周次任务“${week.goal.name}”？`)) actions.deleteGoal(week.goal.id); }}><Trash2 size={15} /></button></header>
              <p className="wk-settings">每次 {(week.goal.duration ?? 60) < 60 ? `${week.goal.duration} 分钟` : `${(week.goal.duration ?? 60) / 60} 小时`} · 习惯 {week.goal.time ?? defaultTime(week.goal.name)} · {week.goal.earliest ?? '09:00'}–{week.goal.latest ?? '21:00'} · {week.goal.days && week.goal.days.length < 7 ? week.goal.days.map(d => `周${'一二三四五六日'[d - 1]}`).join('、') : '每天'} · 每周排 {week.goal.slots} 次</p>
              {week.done.length + week.planned.length > 0 && <p className="wk-days">{[...week.done.map(m => `周${weekday(m.date)}✓`), ...week.planned.map(m => `周${weekday(m.date)}（安排）`)].join('  ')}</p>}
              {history.length > 1 && <div className="wk-history"><span>{history.map(h => <i key={h.start} className={h.reached ? 'hit' : ''} style={{ height: `${Math.max(10, h.done / Math.max(week.goal.target, ...history.map(x => x.done)) * 100)}%` }} />)}</span><small>过去 {history.length - 1} 周达标 {history.slice(0, -1).filter(h => h.reached).length} 周</small></div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Form({ value, onSave, onCancel }: { value: GoalSettings; onSave: (value: GoalSettings) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value);
  const set = (patch: Partial<typeof draft>) => setDraft(prev => { const next = { ...prev, ...patch }; if (patch.target !== undefined && (next.slots < next.target || prev.slots === prev.target + 1)) next.slots = Math.min(14, Math.max(next.target, prev.slots === prev.target + 1 ? next.target + 1 : next.slots)); return next; });
  return (
    <form className="wk-form" onSubmit={e => { e.preventDefault(); if (draft.name.trim()) onSave(draft); }}>
      <input value={draft.name} maxLength={40} placeholder="名称，如 健身" onChange={e => set({ name: e.target.value })} />
      <div className="wk-form-row">
        <label>每周<select value={draft.target} onChange={e => set({ target: Number(e.target.value) })}>{Array.from({ length: 14 }, (_, i) => <option key={i} value={i + 1}>{i + 1} 次</option>)}</select></label>
        <label>每周排<select value={draft.slots} onChange={e => set({ slots: Number(e.target.value) })}>{Array.from({ length: 15 - draft.target }, (_, i) => <option key={i} value={draft.target + i}>{draft.target + i} 次</option>)}</select></label>
      </div>
      <div className="wk-form-row">
        <label>每次<select value={draft.duration ?? 60} onChange={e => set({ duration: Number(e.target.value) })}>{[30, 45, 60, 90, 120, 150, 180].map(m => <option key={m} value={m}>{m < 60 ? `${m} 分钟` : `${m / 60} 小时`}</option>)}</select></label>
        <label>习惯时间<input type="time" value={draft.time ?? '10:00'} onChange={e => set({ time: e.target.value || undefined })} /></label>
      </div>
      <div className="wk-form-row">
        <label>只排在<input type="time" value={draft.earliest ?? '09:00'} onChange={e => set({ earliest: e.target.value || undefined })} />到<input type="time" value={draft.latest ?? '21:00'} onChange={e => set({ latest: e.target.value || undefined })} /></label>
      </div>
      <div className="wk-days-pick">{'一二三四五六日'.split('').map((label, i) => { const day = i + 1; const on = !draft.days || draft.days.includes(day); return <button type="button" key={day} className={on ? 'on' : ''} aria-pressed={on} onClick={() => { const current = draft.days ?? [1, 2, 3, 4, 5, 6, 7]; const next = on ? current.filter(d => d !== day) : [...current, day].sort(); if (next.length) set({ days: next }); }}>{label}</button>; })}</div>
      <div className="wk-colors">{GOAL_COLORS.map(color => <button type="button" key={color} className={draft.color === color ? 'on' : ''} style={{ '--goal': color } as React.CSSProperties} aria-label={`颜色 ${color}`} onClick={() => set({ color })} />)}</div>
      <div className="row-btns"><button className="primary" type="submit" disabled={!draft.name.trim()}>保存</button><button className="secondary" type="button" onClick={onCancel}>取消</button></div>
    </form>
  );
}

/** 排好时间的一格：标完成、改日期和时间、取消。 */
export function GoalMarkSheet({ goal, mark, onClose, actions }: { goal: WeeklyGoal; mark: GoalMark; onClose: () => void; actions: WeeklyActions }) {
  const [date, setDate] = useState(mark.date);
  const [time, setTime] = useState(mark.time ?? '');
  const save = () => { if (date !== mark.date || (time || undefined) !== mark.time) actions.moveMark(mark.id, date, time || undefined); onClose(); };
  const end = (() => { if (!time) return ''; const m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + markDuration(goal, mark); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })();
  return (
    <div className="sheet-layer" onClick={save}>
      <div className="sheet wk-mark-sheet" onClick={e => e.stopPropagation()} style={{ '--goal': goal.color } as React.CSSProperties}>
        <div className="sheet-bar"><button className="text-btn" onClick={onClose}>取消</button><span className="grab" /><button className="text-btn strong" onClick={save}>完成</button></div>
        <h3 className="wk-mark-title"><i />{goal.name}<small>{mark.done ? '已完成' : '安排'}{time && ` · ${time}–${end}`}</small></h3>
        <div className="fields">
          <label className="field"><span>日期</span><input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></label>
          <label className="field"><span>时间</span><input type="time" value={time} step={300} onChange={e => setTime(e.target.value)} /></label>
        </div>
        <div className="row-btns wk-mark-btns">
          <button className="primary" onClick={() => { actions.setMarkDone(mark.id, !mark.done); if (date !== mark.date || (time || undefined) !== mark.time) actions.moveMark(mark.id, date, time || undefined); onClose(); }}>{mark.done ? '改回未完成' : '标记完成'}</button>
          <button className="secondary" onClick={() => { actions.removeMark(mark.id); onClose(); }}>取消这次</button>
        </div>
      </div>
    </div>
  );
}
