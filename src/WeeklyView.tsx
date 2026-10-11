import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import type { GoalMark, WeeklyGoal } from './types';
import { parseDate } from './core';
import { weekRange } from './reflections';
import { GOAL_COLORS, GOAL_REMINDER_TIME, goalHistory, goalWeeks } from './weekly';
import type { GoalWeek } from './weekly';

export interface WeeklyActions {
  saveGoal: (goal: { id?: string; name: string; color: string; target: number; slots: number }) => void;
  deleteGoal: (id: string) => void;
  addMark: (goalId: string, date: string, done: boolean) => void;
  setMarkDone: (id: string, done: boolean) => void;
  removeMark: (id: string) => void;
}

const short = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const weekday = (key: string) => ['日', '一', '二', '三', '四', '五', '六'][parseDate(key).getDay()];
const shiftWeek = (key: string, step: number) => { const d = parseDate(key); d.setDate(d.getDate() + step * 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** 一个任务这周的格子：空格点一下 = 那天完成一次；已完成点一下 = 撤销；已安排点一下 = 完成。 */
export function GoalCells({ week, date, actions, compact = false }: { week: GoalWeek; date: string; actions: WeeklyActions; compact?: boolean }) {
  return <span className={`goal-cells ${compact ? 'compact' : ''}`}>
    {week.cells.map((cell, index) => {
      const extra = week.reached && cell.kind === 'empty';
      if (cell.kind === 'done') return <button key={cell.mark.id} className="goal-cell done" style={{ '--goal': week.goal.color } as React.CSSProperties} title={`${short(cell.mark.date)} 周${weekday(cell.mark.date)}完成 · 点一下撤销`} aria-label={`撤销 ${week.goal.name} ${cell.mark.date} 的完成`} onClick={e => { e.stopPropagation(); actions.removeMark(cell.mark.id); }}><Check size={compact ? 10 : 12} strokeWidth={3} /></button>;
      if (cell.kind === 'planned') return <button key={cell.mark.id} className="goal-cell planned" style={{ '--goal': week.goal.color } as React.CSSProperties} title={`安排在 ${short(cell.mark.date)} 周${weekday(cell.mark.date)} · 点一下标记完成`} aria-label={`完成 ${week.goal.name}（安排在 ${cell.mark.date}）`} onClick={e => { e.stopPropagation(); actions.setMarkDone(cell.mark.id, true); }}>{weekday(cell.mark.date)}</button>;
      return <button key={`empty-${index}`} className={`goal-cell empty ${extra ? 'extra' : ''}`} style={{ '--goal': week.goal.color } as React.CSSProperties} title={`点一下：${short(date)} 完成一次`} aria-label={`${week.goal.name} 在 ${date} 完成一次`} onClick={e => { e.stopPropagation(); actions.addMark(week.goal.id, date, true); }} />;
    })}
  </span>;
}

/** 桌面日历顶部的一条：每个任务的名字、格子和 n/目标。 */
export function GoalStrip({ goals, marks, today, actions }: { goals?: WeeklyGoal[]; marks?: GoalMark[]; today: string; actions: WeeklyActions }) {
  const weeks = goalWeeks(goals, marks, today);
  if (!weeks.length) return null;
  return <div className="goal-strip" aria-label="本周周次任务">
    {weeks.map(week => <span key={week.goal.id} className={`goal-chip ${week.reached ? 'reached' : ''}`} style={{ '--goal': week.goal.color } as React.CSSProperties}>
      <b>{week.goal.name}</b><GoalCells week={week} date={today} actions={actions} compact /><small>{week.done.length}/{week.goal.target}</small>
    </span>)}
  </div>;
}

/** 管理窗口右栏：选中那天可以直接记完成或安排到这天。 */
export function GoalDay({ goals, marks, date, actions }: { goals?: WeeklyGoal[]; marks?: GoalMark[]; date: string; actions: WeeklyActions }) {
  const weeks = goalWeeks(goals, marks, date);
  if (!weeks.length) return null;
  return <div className="goal-day">{weeks.map(week => {
    const doneHere = week.done.find(mark => mark.date === date);
    const plannedHere = week.planned.find(mark => mark.date === date);
    return <div key={week.goal.id} className={`goal-day-row ${week.reached ? 'reached' : ''}`} style={{ '--goal': week.goal.color } as React.CSSProperties}>
      <i /><span>{week.goal.name}<small>本周 {week.done.length}/{week.goal.target}</small></span>
      {doneHere ? <button className="goal-day-btn on" onClick={() => actions.removeMark(doneHere.id)} title="撤销这天的完成"><Check size={12} />这天已完成</button>
        : plannedHere ? <><button className="goal-day-btn" onClick={() => actions.setMarkDone(plannedHere.id, true)}>完成</button><button className="goal-day-btn ghost" title="取消安排" onClick={() => actions.removeMark(plannedHere.id)}>取消安排</button></>
          : <><button className="goal-day-btn" onClick={() => actions.addMark(week.goal.id, date, true)}>这天完成</button>{!week.reached && <button className="goal-day-btn ghost" onClick={() => actions.addMark(week.goal.id, date, false)}>安排到这天</button>}</>}
    </div>;
  })}</div>;
}

/** 管理窗口“周次任务”：本周进度、添加和修改任务、最近 8 周达成情况。 */
export function WeeklyView({ goals, marks, today, remind, actions }: { goals?: WeeklyGoal[]; marks?: GoalMark[]; today: string; remind: boolean; actions: WeeklyActions }) {
  const [anchor, setAnchor] = useState(today);
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<{ id?: string; name: string; color: string; target: number; slots: number } | null>(null);
  const weeks = goalWeeks(goals, marks, anchor);
  const range = weekRange(anchor);
  const thisWeek = range.start === weekRange(today).start;
  const markDate = date >= range.start && date <= range.end ? date : range.start;
  return <div className="list-view weekly-view">
    <div className="weekly-top">
      <h2><Target size={17} />周次任务</h2>
      <div className="weekly-range"><button className="icon-button" aria-label="上一周" onClick={() => setAnchor(shiftWeek(anchor, -1))}><ChevronLeft size={16} /></button><strong>{short(range.start)} – {short(range.end)}{thisWeek && ' · 本周'}</strong><button className="icon-button" aria-label="下一周" onClick={() => setAnchor(shiftWeek(anchor, 1))}><ChevronRight size={16} /></button></div>
      <button className="secondary" onClick={() => setEditing({ name: '', color: GOAL_COLORS[(goals?.length ?? 0) % GOAL_COLORS.length], target: 3, slots: 4 })}><Plus size={14} />添加</button>
    </div>
    <p className="weekly-hint">不定具体时间、每周做几次的事。点空格子记一次完成（记在<input type="date" value={markDate} min={range.start} max={range.end} onChange={e => setDate(e.target.value || today)} />），点已完成的格子撤销。达标后变绿，多出来的格子变淡。每周一重新开始。{remind ? `周五 ${GOAL_REMINDER_TIME} 还差 2 次及以上会提醒你。` : ''}</p>
    {editing && <GoalForm value={editing} onCancel={() => setEditing(null)} onSave={value => { actions.saveGoal(value); setEditing(null); }} />}
    {weeks.map(week => <section key={week.goal.id} className={`weekly-goal ${week.reached ? 'reached' : ''}`} style={{ '--goal': week.goal.color } as React.CSSProperties}>
      <header><i /><strong>{week.goal.name}</strong><span className="weekly-count">{week.done.length}<small> / {week.goal.target}</small></span>{week.reached ? <em className="weekly-state done">已达标</em> : <em className="weekly-state">还差 {week.remaining} 次</em>}
        <span className="weekly-tools"><button className="icon-button" title="修改" aria-label={`修改 ${week.goal.name}`} onClick={() => setEditing({ id: week.goal.id, name: week.goal.name, color: week.goal.color, target: week.goal.target, slots: week.goal.slots })}><Pencil size={13} /></button><button className="icon-button" title="删除" aria-label={`删除 ${week.goal.name}`} onClick={() => { if (window.confirm(`删除周次任务“${week.goal.name}”？已记的完成也会一起隐藏。`)) actions.deleteGoal(week.goal.id); }}><Trash2 size={13} /></button></span></header>
      <GoalCells week={week} date={markDate} actions={actions} />
      {week.done.length + week.planned.length > 0 && <p className="weekly-days">{[...week.done.map(m => `周${weekday(m.date)}✓`), ...week.planned.map(m => `周${weekday(m.date)}（安排）`)].join('  ')}</p>}
      <History goal={week.goal} marks={marks} today={today} />
    </section>)}
    {!weeks.length && !editing && <div className="empty-state"><Target size={34} /><h3>还没有周次任务</h3><p>比如“健身 每周 3 次”“德语学习 每周 2 次”，点右上角添加。</p></div>}
  </div>;
}

function History({ goal, marks, today }: { goal: WeeklyGoal; marks?: GoalMark[]; today: string }) {
  const weeks = goalHistory(goal, marks, today, 8);
  if (weeks.length < 2) return null;
  const hit = weeks.slice(0, -1).filter(week => week.reached).length;
  const max = Math.max(goal.target, ...weeks.map(week => week.done));
  return <div className="weekly-history" title="最近几周每周完成次数">
    <span className="weekly-bars">{weeks.map(week => <i key={week.start} className={week.reached ? 'hit' : ''} style={{ height: `${Math.max(8, week.done / max * 100)}%` }} title={`${short(week.start)} 那周 ${week.done} 次`} />)}</span>
    <small>过去 {weeks.length - 1} 周达标 {hit} 周</small>
  </div>;
}

function GoalForm({ value, onSave, onCancel }: { value: { id?: string; name: string; color: string; target: number; slots: number }; onSave: (value: { id?: string; name: string; color: string; target: number; slots: number }) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value);
  const set = (patch: Partial<typeof draft>) => setDraft(previous => { const next = { ...previous, ...patch }; if (patch.target !== undefined && next.slots < next.target) next.slots = next.target; if (patch.target !== undefined && previous.slots === previous.target + 1) next.slots = Math.min(14, next.target + 1); return next; });
  return <form className="goal-form" onSubmit={e => { e.preventDefault(); if (draft.name.trim()) onSave(draft); }}>
    <input autoFocus placeholder="名称，如 健身" maxLength={40} value={draft.name} onChange={e => set({ name: e.target.value })} />
    <label>每周<select value={draft.target} onChange={e => set({ target: Number(e.target.value) })}>{Array.from({ length: 14 }, (_, i) => <option key={i} value={i + 1}>{i + 1} 次</option>)}</select></label>
    <label>格子<select value={draft.slots} onChange={e => set({ slots: Number(e.target.value) })}>{Array.from({ length: 15 - draft.target }, (_, i) => <option key={i} value={draft.target + i}>{draft.target + i} 格</option>)}</select></label>
    <span className="goal-colors">{GOAL_COLORS.map(color => <button type="button" key={color} className={draft.color === color ? 'on' : ''} style={{ '--goal': color } as React.CSSProperties} aria-label={`颜色 ${color}`} onClick={() => set({ color })} />)}</span>
    <button type="submit" className="primary" disabled={!draft.name.trim()}>保存</button><button type="button" className="secondary" onClick={onCancel}>取消</button>
  </form>;
}
