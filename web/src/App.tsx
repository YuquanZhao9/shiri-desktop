import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode, TouchEvent } from 'react';
import { Bell, CalendarDays, Copy, GraduationCap, KeyRound, Check, ChevronLeft, ChevronRight, Cloud, Download, Inbox, ListTodo, LogOut, Plus, RefreshCw, Repeat2, Share, Trash2, UserRound } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppData, Task, TaskList, Timetable, TimetableSlot } from '@shared/types';
import { addDays, dateKey, defaultData, formatLunar, isDone, mergeTasks, monthDays, parseDate, tasksForDate, TASK_COLORS, todayKey, toggleTask, validateBackup } from '@shared/core';
import { breaksOf, classesForDate, effectiveTimetable, slotsForWeekday } from '@shared/timetable';
import type { PeriodRow } from '@shared/timetable';
import { createCloudClient, cloudErrorMessage, listsForTasks, PASSWORD_RESET_REDIRECT, requestPasswordReset, signIn, signUp, syncTasks, updatePassword } from '@shared/cloud';
import { dayMark, festivalName, germanHoliday, GERMAN_STATES } from '@shared/holidays';
import type { GermanState } from '@shared/holidays';
import { accountKey, applyRemoteLists, cloudConfig, saveCloudConfig, subscribeLive, syncLists, syncTimetable } from './sync';
import { parseQuick } from './quick';
import { aiSyncUrl, createAiToken, listAiTokens, revokeAiToken } from '@shared/ai-token';
import type { AiTokenInfo } from '@shared/ai-token';
import { currentSubscription, disablePush, enablePush, isStandalone, pushSupported, saveSubscription, VAPID_PUBLIC_KEY } from './push';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const REPEATS: Record<Task['repeat'], string> = { none: '不重复', daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月', yearly: '每年' };
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const LEADS = [0, 5, 10, 15, 30, 60];
const LOCAL_KEY = 'shiri-data:local';

const pref = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const setPref = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* 隐私模式 */ } };
const uid = () => crypto.randomUUID();
/** 更新时间严格递增，同一毫秒内的两次修改也能分出先后。 */
const bump = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
const statePref = () => { const value = pref('shiri-de-state', ''); return (GERMAN_STATES.some(([code]) => code === value) ? value : '') as GermanState; };
const leadPref = () => { const value = Number(pref('shiri-reminder-lead', '10')); return LEADS.includes(value) ? value : 10; };
const dayTitle = (key: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(parseDate(key));
const shortDay = (key: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(parseDate(key));
const endTime = (time: string, duration: number) => {
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + duration;
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
const hashDate = () => { const match = /^#date=(\d{4}-\d{2}-\d{2})$/.exec(location.hash); try { return match ? (parseDate(match[1]), match[1]) : ''; } catch { return ''; } };
const hasPasswordRecoveryLink = () => new URLSearchParams(location.search).get('password-reset') === '1' || /(?:^|&)type=recovery(?:&|$)/.test(location.hash.slice(1));

type Tab = 'calendar' | 'list' | 'timetable' | 'me';


export default function App() {
  const [config, setConfig] = useState(cloudConfig);
  const [client, setClient] = useState<SupabaseClient | null>(() => { try { return config ? createCloudClient(config.url, config.key, { detectSessionInUrl: true }) : null; } catch { return null; } });
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const storageKey = user && config ? accountKey(config.url, user.id) : LOCAL_KEY;
  const [data, setData] = useState<AppData>(defaultData);
  const [loadedKey, setLoadedKey] = useState('');
  const [today, setToday] = useState(todayKey);
  const [selected, setSelected] = useState(() => hashDate() || todayKey());
  const [cursor, setCursor] = useState(() => { const d = parseDate(hashDate() || todayKey()); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [compact, setCompact] = useState(() => pref('shiri-m-compact', 'false') === 'true');
  const [tab, setTab] = useState<Tab>(() => hasPasswordRecoveryLink() ? 'me' : 'calendar');
  const [passwordRecovery, setPasswordRecovery] = useState(hasPasswordRecoveryLink);
  const [editing, setEditing] = useState<{ task: Task; isNew: boolean } | null>(null);
  const [quick, setQuick] = useState('');
  const [toast, setToast] = useState<{ text: string; undo?: Task } | null>(null);
  const [syncState, setSyncState] = useState('仅保存在本机');
  const [pushOn, setPushOn] = useState(false);
  const [lead, setLead] = useState(leadPref);
  const [germanState, setGermanState] = useState(statePref);
  const [showTimetable, setShowTimetable] = useState(() => pref('shiri-timetable', '1') !== '0');
  const [pillCap, setPillCap] = useState(2);
  const gridRef = useRef<HTMLDivElement>(null);
  const [hideDone, setHideDone] = useState(() => pref('shiri-m-hide-done', 'false') === 'true');

  const dataRef = useRef(data); dataRef.current = data;
  const keyRef = useRef(storageKey); keyRef.current = storageKey;
  const loadedRef = useRef(loadedKey); loadedRef.current = loadedKey;
  const userRef = useRef(user); userRef.current = user;
  const syncing = useRef(false);
  const again = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const say = useCallback((text: string, undo?: Task) => setToast({ text, undo }), []);
  const ready = loadedKey === storageKey;

  // ---------- 本机存储：与桌面版相同的键和格式 ----------
  useEffect(() => {
    let next = defaultData();
    try { const raw = localStorage.getItem(storageKey); if (raw) next = validateBackup(JSON.parse(raw)); }
    catch { say('本机数据未能读取，已用空白日历打开；原数据没有被覆盖。'); setLoadedKey(''); return; }
    setData(next); setLoadedKey(storageKey);
  }, [storageKey, say]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify(data)); }
    catch { say('保存失败：手机存储空间不足，请尽快导出备份。'); }
  }, [data, ready, storageKey, say]);

  useEffect(() => { const t = setInterval(() => setToday(todayKey()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const open = () => { const key = hashDate(); if (key) { pick(key); setTab('calendar'); history.replaceState(null, '', location.pathname); } };
    open(); window.addEventListener('hashchange', open); return () => window.removeEventListener('hashchange', open);
  }, []);

  // ---------- 账号 ----------
  useEffect(() => {
    if (!client) { setAuthChecked(true); return; }
    let active = true;
    const apply = (next: { id: string; email?: string } | null) => { if (active) { setUser(next); setAuthChecked(true); } };
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { setPasswordRecovery(true); setTab('me'); }
      apply(session?.user ?? null);
    });
    client.auth.getSession().then(({ data: result }) => apply(result.session?.user ?? null)).catch(() => apply(null));
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [client]);
  useEffect(() => { setSyncState(user ? '等待同步' : '仅保存在本机'); }, [user]);

  // ---------- 同步：先日程后清单，结果并入同步期间的新改动 ----------
  const runSync = useCallback(async () => {
    const owner = userRef.current;
    if (!client || !owner || loadedRef.current !== keyRef.current || keyRef.current === LOCAL_KEY) return;
    if (syncing.current) { again.current = true; return; }
    const key = keyRef.current;
    syncing.current = true; setSyncState('正在同步…');
    try {
      const remote = await syncTasks(client, dataRef.current.tasks);
      if (keyRef.current !== key) return;
      setData(prev => {
        const tasks = mergeTasks(prev.tasks, remote);
        const lists = listsForTasks(tasks, prev.lists);
        return JSON.stringify(tasks) === JSON.stringify(prev.tasks) && JSON.stringify(lists) === JSON.stringify(prev.lists) ? prev : { ...prev, tasks, lists };
      });
      const canonical = await syncLists(client, owner.id, key, dataRef.current.lists);
      if (canonical && keyRef.current === key) {
        setData(prev => {
          const lists = listsForTasks(prev.tasks, applyRemoteLists(prev.lists, canonical));
          return JSON.stringify(lists) === JSON.stringify(prev.lists) ? prev : { ...prev, lists };
        });
      }
      const timetable = await syncTimetable(client, owner.id, dataRef.current.timetable);
      if (timetable && keyRef.current === key) {
        setData(prev => prev.timetable && prev.timetable.updatedAt > timetable.updatedAt || JSON.stringify(prev.timetable) === JSON.stringify(timetable) ? prev : { ...prev, timetable });
      }
      setSyncState(`已同步 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      setSyncState(navigator.onLine ? '同步失败，已保存在本机' : '离线 · 已保存在本机');
      if (navigator.onLine) console.warn(cloudErrorMessage(error));
    } finally {
      syncing.current = false;
      if (again.current) { again.current = false; setTimeout(() => void runSync(), 300); }
    }
  }, [client]);

  // 本机改动 1 秒后上传。
  useEffect(() => { if (!user || !ready) return; const t = setTimeout(() => void runSync(), 1000); return () => clearTimeout(t); }, [data, user, ready, runSync]);
  // 另一台设备的改动：实时通知 + 回到前台 + 网络恢复 + 每分钟兜底。
  useEffect(() => {
    if (!client || !user) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => void runSync(), 350); };
    const stop = subscribeLive(client, user.id, soon);
    const visible = () => { if (document.visibilityState === 'visible') { setToday(todayKey()); soon(); } };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', soon);
    const interval = setInterval(soon, 60_000);
    return () => { stop(); clearTimeout(timer); clearInterval(interval); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', soon); };
  }, [client, user, runSync]);

  // ---------- 提醒 ----------
  useEffect(() => { void currentSubscription().then(sub => setPushOn(!!sub)).catch(() => setPushOn(false)); }, [user]);

  // ---------- 修改日程 ----------
  const lists = data.lists;
  const listOf = (id: string): TaskList => lists.find(list => list.id === id) ?? lists[0];
  const colorOf = (task: Task) => task.color || listOf(task.listId).color;
  const timetable = effectiveTimetable(data.timetable);
  // 与电脑版相同：学期内、非德国假日、当天有课的工作日才显示；空时段画成淡虚线框。
  const classRows = (key: string): PeriodRow[] | null => showTimetable ? classesForDate(timetable, key, !!germanHoliday(key, germanState)) : null;
  function commit(task: Task) {
    if (!ready) return;
    setData(prev => ({ ...prev, tasks: [...prev.tasks.filter(t => t.id !== task.id), task] }));
  }
  function newTask(date: string, title = '', time = ''): Task {
    const now = new Date().toISOString();
    return { id: uid(), title, date, time, duration: 60, listId: lists[0].id, notes: '', priority: 'normal', repeat: 'none', completed: false, doneDates: [], createdAt: now, updatedAt: now };
  }
  function toggle(task: Task, date: string) {
    const fresh = dataRef.current.tasks.find(t => t.id === task.id);
    if (fresh) commit(toggleTask(fresh, date || fresh.date));
  }
  function remove(task: Task) {
    const fresh = dataRef.current.tasks.find(t => t.id === task.id) ?? task;
    const at = bump(fresh.updatedAt);
    commit({ ...fresh, deletedAt: at, updatedAt: at });
    setEditing(null);
    say(`已删除“${fresh.title}”`, fresh);
  }
  function restore(task: Task) {
    const current = dataRef.current.tasks.find(t => t.id === task.id);
    const { deletedAt: _gone, ...rest } = task;
    commit({ ...rest, updatedAt: bump(current?.updatedAt ?? task.updatedAt) });
    setToast(null);
  }
  function save(task: Task, isNew: boolean) {
    const title = task.title.trim();
    if (!title) { if (!isNew) say('标题不能为空'); setEditing(null); return; }
    const current = dataRef.current.tasks.find(t => t.id === task.id);
    if (current?.deletedAt) { say('这条日程已在另一台设备上删除'); setEditing(null); return; }
    const { color, ...rest } = task;
    const next: Task = { ...rest, ...(color ? { color } : {}), title: title.slice(0, 500), time: task.date ? task.time : '', repeat: task.date ? task.repeat : 'none' };
    if (!isNew && current && JSON.stringify({ ...current, updatedAt: '' }) === JSON.stringify({ ...next, updatedAt: '' })) { setEditing(null); return; }
    commit({ ...next, updatedAt: bump(current?.updatedAt ?? next.updatedAt) });
    setEditing(null);
  }
  function quickAdd(event: FormEvent, date: string) {
    event.preventDefault();
    const { title, time } = parseQuick(quick);
    if (!title) return;
    commit(newTask(date, title.slice(0, 200), time));
    setQuick('');
  }

  // ---------- 日历导航 ----------
  function pick(key: string) {
    setSelected(key);
    const d = parseDate(key);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }
  function shift(step: number) {
    if (compact) { pick(addDays(selected, step * 7)); return; }
    const d = new Date(cursor.year, cursor.month + step, 1, 12);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    const keep = Math.min(parseDate(selected).getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
    setSelected(dateKey(new Date(d.getFullYear(), d.getMonth(), keep, 12)));
  }
  function onTouchStart(event: TouchEvent) { touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }
  function onTouchEnd(event: TouchEvent) {
    const start = touch.current; touch.current = null;
    if (!start) return;
    const dx = event.changedTouches[0].clientX - start.x, dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
    else if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5) { const next = dy < 0; setCompact(next); setPref('shiri-m-compact', String(next)); }
  }

  const active = useMemo(() => data.tasks.filter(t => !t.deletedAt), [data.tasks]);
  const grid = useMemo(() => {
    const days = monthDays(cursor.year, cursor.month);
    if (!compact) return days;
    const monday = addDays(selected, -((parseDate(selected).getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [cursor, compact, selected]);
  const byDay = useMemo(() => new Map(grid.map(key => [key, tasksForDate(active, key)])), [grid, active]);
  const dayTasks = useMemo(() => tasksForDate(active, selected).filter(t => !hideDone || !isDone(t, selected)), [active, selected, hideDone]);
  const monthLabel = `${cursor.year}年${cursor.month + 1}月`;

  // 日期格能放几条就放几条（与电脑版一致），放不下的显示 +N。
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || compact) return;
    // 观察整个网格（日期格换月时会重建）；每格内容高度 = 网格高度 / 6 行 − 内边距。
    const observer = new ResizeObserver(([entry]) => setPillCap(Math.max(1, Math.floor((entry.contentRect.height / 6 - 4 - 35 - (showTimetable ? 7 : 0)) / 15))));
    observer.observe(grid);
    return () => observer.disconnect();
  }, [compact, tab, showTimetable]);

  // ---------- 界面 ----------
  const row = (task: Task, date: string, showDate = false) => {
    const done = date ? isDone(task, date) : task.completed;
    const list = listOf(task.listId);
    return (
      <li key={`${task.id}:${date}`} className={`task-row${done ? ' done' : ''}`} style={{ '--c': colorOf(task) } as React.CSSProperties}>
        <button className="check" aria-label={done ? '标为未完成' : '标为完成'} onClick={() => toggle(task, date)}>{done && <Check size={14} strokeWidth={3} />}</button>
        <button className="task-main" onClick={() => setEditing({ task, isNew: false })}>
          <span className="task-title">{task.priority === 'high' && <b className="flag">!</b>}{task.title}</span>
          <span className="task-meta">
            {showDate && date && <span>{shortDay(date)}</span>}
            <span>{task.time ? `${task.time}–${endTime(task.time, task.duration)}` : (date ? '全天' : '未安排日期')}</span>
            {task.repeat !== 'none' && <span className="meta-icon"><Repeat2 size={12} />{REPEATS[task.repeat]}</span>}
            <span className="dot" />{list.name}
          </span>
          {task.notes.trim() && <span className="task-notes">{task.notes.trim()}</span>}
        </button>
      </li>
    );
  };

  const calendar = (
    <section className="page calendar-page">
      <header className="top">
        <button className="month-title" onClick={() => { setCompact(!compact); setPref('shiri-m-compact', String(!compact)); }} aria-label="切换周视图和月视图">
          {monthLabel}<span className="mode-chip">{compact ? '周' : '月'}</span>
        </button>
        <div className="top-actions">
          {selected !== today && <button className="today-btn" onClick={() => pick(today)}>今天</button>}
          <button className={`icon-btn${showTimetable ? ' on' : ''}`} aria-label={showTimetable ? '隐藏日历里的课表' : '在日历里显示课表'} aria-pressed={showTimetable} onClick={() => { setShowTimetable(!showTimetable); setPref('shiri-timetable', showTimetable ? '0' : '1'); }}><GraduationCap size={20} /></button>
          <button className="icon-btn" aria-label="上一页" onClick={() => shift(-1)}><ChevronLeft size={22} /></button>
          <button className="icon-btn" aria-label="下一页" onClick={() => shift(1)}><ChevronRight size={22} /></button>
        </div>
      </header>
      <div className="weekdays">{WEEK.map((d, i) => <span key={d} className={i > 4 ? 'weekend' : ''}>{d}</span>)}</div>
      <div ref={gridRef} className={`grid${compact ? ' compact' : ''}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {grid.map(key => {
          const d = parseDate(key);
          const tasks = byDay.get(key) ?? [];
          const mark = dayMark(key);
          const festival = festivalName(key);
          const german = germanHoliday(key, germanState);
          const outside = !compact && d.getMonth() !== cursor.month;
          const classes = classRows(key);
          return (
            <button key={key} className={`cell${outside ? ' outside' : ''}${key === selected ? ' selected' : ''}${key === today ? ' today' : ''}${mark ? ` ${mark.kind}` : ''}`} onClick={() => key === selected && !compact ? setCompact(true) : pick(key)}>
              <span className="cell-head">
                <span className="num">{d.getDate()}</span>
                {mark && <span className="badge">{mark.kind === 'rest' ? '休' : '班'}</span>}
              </span>
              <span className={`lunar${festival ? ' festival' : german ? ' german' : ''}`}>{festival || (german ? german.name : formatLunar(key))}</span>
              <span className="pills">
                {tasks.slice(0, compact ? 0 : pillCap).map(t => <span key={t.id} className={`pill${isDone(t, key) ? ' done' : ''}`} style={{ '--c': colorOf(t) } as React.CSSProperties}>{t.title}</span>)}
                {compact ? tasks.length > 0 && <span className="dots">{tasks.slice(0, 3).map(t => <i key={t.id} style={{ background: colorOf(t) }} />)}</span>
                  : tasks.length > pillCap && <span className="more">+{tasks.length - pillCap}</span>}
              </span>
              {classes && (compact
                ? <span className="cell-classes">{classes.map(row => (
                    <span key={row.start} className={`class-period${row.slots.length ? '' : ' empty'}`}>
                      {row.slots.map(slot => <span key={slot.id} className={`class-chip${slot.dashed ? ' dashed' : ''}${slot.alert ? ' alert' : ''}`} style={{ '--c': slot.color } as React.CSSProperties}>{timetable.courses.find(course => course.code && slot.title.includes(course.code))?.code ?? slot.title.slice(0, 2)}</span>)}
                    </span>
                  ))}</span>
                : <span className="class-strip">{classes.map(row => row.slots.length
                    ? <i key={row.start} className={row.slots.every(slot => slot.dashed) ? 'dashed' : ''} style={{ '--c': row.slots[0].color } as React.CSSProperties} />
                    : <i key={row.start} className="empty" />)}</span>)}
            </button>
          );
        })}
      </div>
      <div className="agenda">
        <div className="agenda-head">
          <h2>{dayTitle(selected)}<small>{festivalName(selected) || `农历${formatLunar(selected)}`}{dayMark(selected) ? ` · ${dayMark(selected)!.name}${dayMark(selected)!.kind === 'rest' ? '假期' : '调休上班'}` : ''}{germanHoliday(selected, germanState) ? ` · 德国：${germanHoliday(selected, germanState)!.german}` : ''}</small></h2>
          <button className="text-btn" onClick={() => { setHideDone(!hideDone); setPref('shiri-m-hide-done', String(!hideDone)); }}>{hideDone ? '显示已完成' : '隐藏已完成'}</button>
        </div>
        <form className="quick" onSubmit={event => quickAdd(event, selected)}>
          <Plus size={18} />
          <input value={quick} onChange={e => setQuick(e.target.value)} placeholder="添加日程，如“15:00 开会”" enterKeyHint="done" maxLength={200} />
          {quick && <button type="submit" className="quick-save">添加</button>}
        </form>
        {dayTasks.length ? <ul className="tasks">{dayTasks.map(t => row(t, selected))}</ul>
          : <p className="empty">这一天还没有安排</p>}
        {classRows(selected) && (
          <div className="group">
            <h3><GraduationCap size={14} />课程 · {timetable.name}</h3>
            <ul className="tasks classes">{classRows(selected)!.map(row => row.slots.length ? row.slots.map(slot => (
              <li key={slot.id} className={`class-row${slot.dashed ? ' dashed' : ''}`} style={{ '--c': slot.color } as React.CSSProperties}>
                <span className="class-time">{slot.start}<br />{slot.end}</span>
                <span className="class-main"><b>{slot.title}</b>{slot.note && <small>{slot.note}</small>}{slot.alert && <small className="alert">⚠ {slot.alert}</small>}</span>
              </li>
            )) : <li key={row.start} className="class-row free"><span className="class-time">{row.start}</span><span className="class-main"><small>空闲</small></span></li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );

  const listPage = (() => {
    const inbox = active.filter(t => !t.date && (!hideDone || !t.completed));
    const overdue = active.filter(t => t.date && t.date < today && t.repeat === 'none' && !t.completed);
    const upcoming = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map(key => ({ key, tasks: tasksForDate(active, key).filter(t => !isDone(t, key)) })).filter(day => day.tasks.length);
    return (
      <section className="page list-page">
        <header className="top"><h1>清单</h1></header>
        <div className="scroll">
          <form className="quick" onSubmit={event => quickAdd(event, '')}>
            <Inbox size={18} />
            <input value={quick} onChange={e => setQuick(e.target.value)} placeholder="记到收集箱，稍后再安排日期" enterKeyHint="done" maxLength={200} />
            {quick && <button type="submit" className="quick-save">添加</button>}
          </form>
          {overdue.length > 0 && <Group title="已过期" count={overdue.length} warn><ul className="tasks">{overdue.map(t => row(t, t.date, true))}</ul></Group>}
          <Group title="收集箱" count={inbox.length}>{inbox.length ? <ul className="tasks">{inbox.map(t => row(t, ''))}</ul> : <p className="empty small">收集箱是空的</p>}</Group>
          {upcoming.map(day => (
            <Group key={day.key} title={day.key === today ? `今天 · ${shortDay(day.key)}` : day.key === addDays(today, 1) ? `明天 · ${shortDay(day.key)}` : shortDay(day.key)} count={day.tasks.length}>
              <ul className="tasks">{day.tasks.map(t => row(t, day.key))}</ul>
            </Group>
          ))}
          {!upcoming.length && <p className="empty">未来 7 天没有待办</p>}
        </div>
      </section>
    );
  })();

  return (
    <div className="app">
      <main className="main">
        {tab === 'calendar' && calendar}
        {tab === 'list' && listPage}
        {tab === 'timetable' && <TimetablePage timetable={timetable} today={today} visible={showTimetable} onVisible={value => { setShowTimetable(value); setPref('shiri-timetable', value ? '1' : '0'); }} />}
        {tab === 'me' && (
          <MePage
            config={config} client={client} user={user} authChecked={authChecked} syncState={syncState} data={data}
            pushOn={pushOn} lead={lead} germanState={germanState}
            onGermanState={value => { setGermanState(value); setPref('shiri-de-state', value); }} say={say} sync={() => void runSync()}
            onConfig={(url, key) => { const next = saveCloudConfig(url, key); setClient(next); setConfig(cloudConfig()); }}
            onPush={setPushOn}
            passwordRecovery={passwordRecovery}
            onRecoveryComplete={() => {
              setPasswordRecovery(false);
              const clean = new URL(location.href); clean.searchParams.delete('password-reset'); clean.hash = '';
              history.replaceState(null, '', `${clean.pathname}${clean.search}`);
            }}
            onLead={async value => {
              setLead(value); setPref('shiri-reminder-lead', String(value));
              const sub = await currentSubscription();
              if (sub && client && user) await saveSubscription(client, user.id, sub, value).catch(e => say((e as Error).message));
            }}
            onMergeLocal={() => {
              try {
                const raw = localStorage.getItem(LOCAL_KEY);
                if (!raw) { say('这台手机上没有未登录时记下的日程'); return; }
                const local = validateBackup(JSON.parse(raw));
                setData(prev => ({ ...prev, tasks: mergeTasks(prev.tasks, local.tasks), lists: [...prev.lists, ...local.lists.filter(l => !prev.lists.some(p => p.id === l.id))] }));
                say('已并入当前账号，正在同步');
              } catch { say('本机数据未能读取'); }
            }}
          />
        )}
      </main>

      {(tab === 'calendar' || tab === 'list') && (
        <button className="fab" aria-label="新建日程" onClick={() => setEditing({ task: newTask(tab === 'list' ? '' : selected), isNew: true })}><Plus size={26} /></button>
      )}

      <nav className="tabbar">
        <TabButton on={tab === 'calendar'} onClick={() => setTab('calendar')} icon={<CalendarDays size={22} />} label="日历" />
        <TabButton on={tab === 'list'} onClick={() => setTab('list')} icon={<ListTodo size={22} />} label="清单" />
        <TabButton on={tab === 'timetable'} onClick={() => setTab('timetable')} icon={<GraduationCap size={22} />} label="课表" />
        <TabButton on={tab === 'me'} onClick={() => setTab('me')} icon={<UserRound size={22} />} label="我的" badge={!user && !!config} />
      </nav>

      {editing && <Editor key={editing.task.id} task={editing.task} isNew={editing.isNew} lists={lists} onSave={save} onDelete={remove} onClose={() => setEditing(null)} />}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button onClick={() => restore(toast.undo!)}>撤销</button>}
        </div>
      )}
    </div>
  );
}

function TabButton({ on, onClick, icon, label, badge }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: boolean }) {
  return <button className={`tab${on ? ' on' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{badge && <i className="tab-badge" />}</button>;
}

function Group({ title, count, warn, children }: { title: string; count: number; warn?: boolean; children: ReactNode }) {
  return <div className={`group${warn ? ' warn' : ''}`}><h3>{title}<span>{count}</span></h3>{children}</div>;
}

function Editor({ task, isNew, lists, onSave, onDelete, onClose }: { task: Task; isNew: boolean; lists: TaskList[]; onSave: (task: Task, isNew: boolean) => void; onDelete: (task: Task) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(task);
  const [more, setMore] = useState(!isNew && (task.repeat !== 'none' || task.priority === 'high'));
  const set = <K extends keyof Task>(key: K, value: Task[K]) => setDraft(prev => ({ ...prev, [key]: value }));
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isNew) setTimeout(() => title.current?.focus(), 60); }, [isNew]);
  const submit = (event?: FormEvent) => { event?.preventDefault(); onSave(draft, isNew); };
  return (
    <div className="sheet-layer" onClick={() => submit()}>
      <form className="sheet" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="sheet-bar">
          <button type="button" className="text-btn" onClick={onClose}>取消</button>
          <span className="grab" />
          <button type="submit" className="text-btn strong">完成</button>
        </div>
        <div className="title-box">
          <input ref={title} className="title-input" value={draft.title} onChange={e => set('title', e.target.value)} placeholder="准备做什么？" maxLength={500} enterKeyHint="done" />
          <textarea className="notes" value={draft.notes} onChange={e => set('notes', e.target.value)} placeholder="备注" rows={2} maxLength={20000} />
        </div>
        <div className="fields">
          <label className="field"><span>日期</span>
            <span className="field-right">
              {draft.date ? <input type="date" value={draft.date} onChange={e => e.target.value && set('date', e.target.value)} /> : <em>收集箱</em>}
              <button type="button" className="mini" onClick={() => set('date', draft.date ? '' : todayKey())}>{draft.date ? '移出' : '安排'}</button>
            </span>
          </label>
          {draft.date && (
            <label className="field"><span>时间</span>
              <span className="field-right">
                {draft.time ? <input type="time" value={draft.time} step={300} onChange={e => set('time', e.target.value)} /> : <em>全天</em>}
                <button type="button" className="mini" onClick={() => set('time', draft.time ? '' : '09:00')}>{draft.time ? '改为全天' : '设定时间'}</button>
              </span>
            </label>
          )}
          {draft.date && draft.time && (
            <label className="field"><span>时长</span>
              <select value={draft.duration} onChange={e => set('duration', Number(e.target.value))}>
                {[...new Set([...DURATIONS, draft.duration])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{m < 60 ? `${m} 分钟` : `${m / 60} 小时`}</option>)}
              </select>
            </label>
          )}
          <div className="field lists-field"><span>清单</span>
            <span className="chips">{lists.map(list => (
              <button type="button" key={list.id} className={`chip${draft.listId === list.id ? ' on' : ''}`} style={{ '--c': list.color } as React.CSSProperties} onClick={() => set('listId', list.id)}>{list.name}</button>
            ))}</span>
          </div>
          <div className="field lists-field"><span>颜色</span>
            <span className="swatches">
              <button type="button" className={`swatch auto${!draft.color ? ' on' : ''}`} style={{ '--c': (lists.find(l => l.id === draft.listId) ?? lists[0]).color } as React.CSSProperties} onClick={() => set('color', undefined)} aria-label="使用清单颜色">清单</button>
              {TASK_COLORS.map(color => <button type="button" key={color} className={`swatch${draft.color === color ? ' on' : ''}`} style={{ '--c': color } as React.CSSProperties} onClick={() => set('color', color)} aria-label={`颜色 ${color}`} />)}
            </span>
          </div>
          {!more && <button type="button" className="more-btn" onClick={() => setMore(true)}>重复、优先级…</button>}
          {more && <>
            {draft.date && (
              <label className="field"><span>重复</span>
                <select value={draft.repeat} onChange={e => set('repeat', e.target.value as Task['repeat'])}>
                  {Object.entries(REPEATS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            )}
            <label className="field"><span>重要</span>
              <input type="checkbox" className="switch" checked={draft.priority === 'high'} onChange={e => set('priority', e.target.checked ? 'high' : 'normal')} />
            </label>
          </>}
        </div>
        {!isNew && <button type="button" className="delete-btn" onClick={() => onDelete(task)}><Trash2 size={17} />删除日程</button>}
      </form>
    </div>
  );
}

interface MeProps {
  config: ReturnType<typeof cloudConfig>; client: SupabaseClient | null; user: { id: string; email?: string } | null; authChecked: boolean;
  syncState: string; data: AppData; pushOn: boolean; lead: number; germanState: GermanState; onGermanState: (value: GermanState) => void;
  say: (text: string) => void; sync: () => void; onConfig: (url: string, key: string) => void;
  onPush: (on: boolean) => void; onLead: (value: number) => void; onMergeLocal: () => void;
  passwordRecovery: boolean; onRecoveryComplete: () => void;
}

function MePage({ config, client, user, authChecked, syncState, data, pushOn, lead, germanState, onGermanState, say, sync, onConfig, onPush, onLead, onMergeLocal, passwordRecovery, onRecoveryComplete }: MeProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetOffer, setResetOffer] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(config?.url ?? '');
  const [key, setKey] = useState(config?.baked ? '' : config?.key ?? '');
  const [showConfig, setShowConfig] = useState(!config);
  const standalone = isStandalone();

  async function auth(mode: 'in' | 'up') {
    if (!client) return;
    setBusy(true);
    try {
      if (mode === 'in') await signIn(client, email, password);
      else {
        const result = await signUp(client, email, password);
        if (result.alreadyRegistered) {
          setResetOffer(email.trim());
          say('该邮箱已被注册。是否发送重置密码邮件？');
          return;
        }
      }
      setPassword('');
      setResetOffer('');
      say(mode === 'up' ? '注册成功，请打开邮箱里的确认邮件，然后回来登录' : '已登录，正在同步');
    } catch (error) { say(cloudErrorMessage(error)); }
    finally { setBusy(false); }
  }
  async function sendReset(target = email) {
    if (!client) return;
    setBusy(true);
    try {
      const redirect = location.protocol === 'http:' || location.protocol === 'https:'
        ? `${location.origin}${location.pathname}?password-reset=1`
        : PASSWORD_RESET_REDIRECT;
      await requestPasswordReset(client, target, redirect);
      setResetOffer('');
      say('重置邮件已发送。请在邮箱打开链接，设置新密码；当前日程不会被删除。');
    } catch (error) { say(cloudErrorMessage(error)); }
    finally { setBusy(false); }
  }
  async function saveNewPassword() {
    if (!client) return;
    if (newPassword !== confirmPassword) { say('两次输入的新密码不一致。'); return; }
    setBusy(true);
    try {
      await updatePassword(client, newPassword);
      setNewPassword(''); setConfirmPassword(''); setChangingPassword(false);
      onRecoveryComplete();
      say('新密码已保存。账号和现有日程保持不变。');
    } catch (error) { say(cloudErrorMessage(error)); }
    finally { setBusy(false); }
  }
  async function togglePush() {
    if (!client || !user) { say('请先登录'); return; }
    setBusy(true);
    try {
      if (pushOn) { await disablePush(client); onPush(false); say('已关闭这台手机的提醒'); }
      else { await enablePush(client, user.id, lead); onPush(true); say('提醒已开启，到点会推送到这台手机'); }
    } catch (error) { say((error as Error).message); }
    finally { setBusy(false); }
  }
  async function exportBackup() {
    const file = new File([JSON.stringify(data, null, 2)], `昱时备份-${todayKey()}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch { /* 取消分享 */ } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <section className="page me-page">
      <header className="top"><h1>我的</h1></header>
      <div className="scroll">
        {!standalone && (
          <div className="card hint">
            <Share size={20} />
            <p>在 Safari 里点底部的<b>分享</b>按钮，选<b>“添加到主屏幕”</b>，以后从桌面图标打开，像 App 一样全屏使用，还能收到提醒。</p>
          </div>
        )}

        <div className="card">
          <h3><Cloud size={17} />云同步</h3>
          {passwordRecovery ? (
            <form className="stack" onSubmit={event => { event.preventDefault(); void saveNewPassword(); }}>
              <p className="muted">正在为当前账号设置新密码。修改密码不会删除手机、电脑或云端日程。</p>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="新密码（至少 8 位）" autoComplete="new-password" />
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" autoComplete="new-password" />
              <button className="primary" type="submit" disabled={busy || newPassword.length < 8 || confirmPassword.length < 8}>保存新密码</button>
            </form>
          ) : !config || showConfig ? (
            <form className="stack" onSubmit={e => { e.preventDefault(); try { onConfig(url, key); setShowConfig(false); say('已连接云项目，请登录'); } catch (error) { say((error as Error).message); } }}>
              <p className="muted">填入 Supabase 项目的地址和 Publishable key（公开密钥）。</p>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" inputMode="url" autoCapitalize="off" autoCorrect="off" />
              <input value={key} onChange={e => setKey(e.target.value)} placeholder="sb_publishable_…" autoCapitalize="off" autoCorrect="off" />
              <button className="primary" type="submit">保存</button>
            </form>
          ) : !authChecked ? <p className="muted">正在读取登录状态…</p>
          : user ? (
            <div className="stack">
              <div className="kv"><span>账号</span><b>{user.email}</b></div>
              <div className="kv"><span>状态</span><b>{syncState}</b></div>
              <div className="row-btns">
                <button className="secondary" onClick={sync}><RefreshCw size={16} />立即同步</button>
                <button className="secondary" onClick={async () => { if (pushOn) await disablePush(client).catch(() => {}); onPush(false); await client!.auth.signOut({ scope: 'local' }); say('已退出，本机仍保留该账号的数据'); }}><LogOut size={16} />退出</button>
              </div>
              {changingPassword ? <form className="stack password-change" onSubmit={event => { event.preventDefault(); void saveNewPassword(); }}>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="新密码（至少 8 位）" autoComplete="new-password" />
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" autoComplete="new-password" />
                <div className="row-btns"><button className="primary" type="submit" disabled={busy || newPassword.length < 8 || confirmPassword.length < 8}>保存新密码</button><button className="secondary" type="button" onClick={() => { setChangingPassword(false); setNewPassword(''); setConfirmPassword(''); }}>取消</button></div>
              </form> : <button className="link-btn" onClick={() => setChangingPassword(true)}>修改密码</button>}
              <button className="link-btn" onClick={onMergeLocal}>把未登录时记下的日程并入此账号</button>
            </div>
          ) : (
            <form className="stack" onSubmit={e => { e.preventDefault(); void auth('in'); }}>
              <p className="muted">和电脑版登录同一个账号，日程会自动互相同步。</p>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="邮箱" autoComplete="username" autoCapitalize="off" />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密码（至少 6 位）" autoComplete="current-password" />
              <div className="row-btns">
                <button className="primary" type="submit" disabled={busy || !email || password.length < 6}>登录</button>
                <button className="secondary" type="button" disabled={busy || !email || password.length < 6} onClick={() => void auth('up')}>注册</button>
              </div>
              <button className="link-btn" type="button" disabled={busy || !email} onClick={() => void sendReset()}>忘记密码？发送重置邮件</button>
              {resetOffer && <div className="reset-offer" role="alert"><p>该邮箱已被注册。是否发送重置密码邮件？</p><div className="row-btns"><button className="primary" type="button" disabled={busy} onClick={() => void sendReset(resetOffer)}>发送重置邮件</button><button className="secondary" type="button" onClick={() => setResetOffer('')}>暂不</button></div></div>}
            </form>
          )}
          {config && !config.baked && !showConfig && <button className="link-btn" onClick={() => setShowConfig(true)}>更改云项目</button>}
        </div>

        {client && user && config && <AiTokenCard client={client} userId={user.id} projectUrl={config.url} say={say} />}

        <div className="card">
          <h3><Bell size={17} />日程提醒</h3>
          {!VAPID_PUBLIC_KEY ? <p className="muted">云端提醒服务还没配置。</p> : !standalone ? <p className="muted">从主屏幕图标打开昱时后才能开启提醒。</p> : !pushSupported() ? <p className="muted">需要 iOS 16.4 或更高版本。</p> : (
            <div className="stack">
              <label className="kv"><span>推送到这台手机</span><input type="checkbox" className="switch" checked={pushOn} disabled={busy || !user} onChange={() => void togglePush()} /></label>
              <label className="kv"><span>提前</span>
                <select value={lead} onChange={e => onLead(Number(e.target.value))}>{LEADS.map(m => <option key={m} value={m}>{m ? `${m} 分钟` : '准时'}</option>)}</select>
              </label>
              <p className="muted">只提醒设了具体时间的日程。{!user && '登录后可开启。'}</p>
            </div>
          )}
        </div>

        <div className="card">
          <h3><CalendarDays size={17} />节假日</h3>
          <p className="muted">日历里显示中国节假日的“休”“班”和传统节日；德国法定假日以蓝字显示。</p>
          <label className="kv"><span>德国联邦州</span>
            <select value={germanState} onChange={e => onGermanState(e.target.value as GermanState)}>{GERMAN_STATES.map(([code, label]) => <option key={code} value={code}>{code ? `${label}（${code}）` : label}</option>)}</select>
          </label>
        </div>

        <div className="card">
          <h3><Download size={17} />数据</h3>
          <div className="kv"><span>日程</span><b>{data.tasks.filter(t => !t.deletedAt).length} 条</b></div>
          <button className="secondary wide" onClick={() => void exportBackup()}><Download size={16} />导出备份</button>
        </div>
        <p className="footer">昱时 · iPhone 网页版 0.1.0</p>
      </div>
    </section>
  );
}


const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const toMin = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** 同一时间段重叠的课并排显示。 */
function lanes(slots: TimetableSlot[]) {
  const placed: { slot: TimetableSlot; lane: number; lanes: number }[] = [];
  let group: typeof placed = [];
  let groupEnd = -1;
  const flush = () => { const count = Math.max(...group.map(g => g.lane)) + 1; group.forEach(g => { g.lanes = count; }); group = []; };
  for (const slot of slots) {
    if (group.length && toMin(slot.start) >= groupEnd) flush();
    const used = new Set(group.filter(g => toMin(g.slot.end) > toMin(slot.start)).map(g => g.lane));
    let lane = 0; while (used.has(lane)) lane++;
    const item = { slot, lane, lanes: 1 };
    group.push(item); placed.push(item);
    groupEnd = Math.max(groupEnd, toMin(slot.end));
  }
  if (group.length) flush();
  return placed;
}

function TimetablePage({ timetable, today, visible, onVisible }: { timetable: Timetable; today: string; visible: boolean; onVisible: (value: boolean) => void }) {
  const days = timetable.slots.some(slot => slot.day > 5) ? 7 : 5;
  const all = timetable.slots;
  const first = all.length ? Math.min(...all.map(s => toMin(s.start))) : 8 * 60;
  const last = all.length ? Math.max(...all.map(s => toMin(s.end))) : 18 * 60;
  const from = Math.floor(first / 60) * 60, to = Math.ceil(last / 60) * 60;
  const px = 0.9; // 每分钟高度
  const todayDay = today >= timetable.start && today <= timetable.end ? (parseDate(today).getDay() + 6) % 7 + 1 : 0;
  const [open, setOpen] = useState<TimetableSlot | null>(null);
  return (
    <section className="page timetable-page">
      <header className="top"><h1>课表</h1><span className="term">{timetable.name}</span></header>
      <div className="scroll">
        <p className="muted term-range">{timetable.start.replace(/-/g, '/')} – {timetable.end.replace(/-/g, '/')} · 虚线为可选或看录像 · 课表在电脑版设置里编辑</p>
        <div className="tt" style={{ '--days': days } as React.CSSProperties}>
          <div className="tt-head"><span />{DAY_NAMES.slice(0, days).map((name, i) => <span key={name} className={i + 1 === todayDay ? 'now' : ''}>{name}</span>)}</div>
          <div className="tt-body" style={{ height: (to - from) * px }}>
            <div className="tt-hours">{Array.from({ length: (to - from) / 60 + 1 }, (_, i) => <span key={i} style={{ top: i * 60 * px }}>{String(from / 60 + i).padStart(2, '0')}:00</span>)}</div>
            {Array.from({ length: days }, (_, d) => (
              <div key={d} className={`tt-col${d + 1 === todayDay ? ' now' : ''}`}>
                {lanes(slotsForWeekday(timetable, d + 1)).map(({ slot, lane, lanes: count }) => (
                  <button key={slot.id} className={`tt-slot${slot.dashed ? ' dashed' : ''}`} onClick={() => setOpen(slot)}
                    style={{ '--c': slot.color, top: (toMin(slot.start) - from) * px, height: (toMin(slot.end) - toMin(slot.start)) * px - 2, left: `${lane / count * 100}%`, width: `calc(${100 / count}% - 2px)` } as React.CSSProperties}>
                    <b>{slot.title}</b><small>{slot.start}</small>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        {breaksOf(timetable).length > 0 && (
          <div className="card legend"><h3>停课期</h3>{breaksOf(timetable).map(item => <div key={item.start} className="legend-item"><b>{item.name}</b><span>{item.start.slice(5).replace('-', '/')} – {item.end.slice(5).replace('-', '/')}</span></div>)}</div>
        )}
        {timetable.courses.length > 0 && (
          <div className="card legend">{timetable.courses.map(course => <div key={course.code + course.name} className="legend-item"><i style={{ background: course.color }} /><b>{course.code}</b><span>{course.name}</span></div>)}</div>
        )}
        <div className="card"><label className="kv"><span>在日历的当天日程下显示课程</span><input type="checkbox" className="switch" checked={visible} onChange={e => onVisible(e.target.checked)} /></label></div>
      </div>
      {open && (
        <div className="toast slot-detail" onClick={() => setOpen(null)}>
          <span><b>{open.title}</b> · {DAY_NAMES[open.day - 1]} {open.start}–{open.end}{open.note ? `\n${open.note}` : ''}</span>
          <button>好</button>
        </div>
      )}
    </section>
  );
}

/** AI 同步令牌：生成后只显示一次，交给 Claude 的技能或自动任务使用；可随时撤销。 */
function AiTokenCard({ client, userId, projectUrl, say }: { client: SupabaseClient; userId: string; projectUrl: string; say: (text: string) => void }) {
  const [tokens, setTokens] = useState<AiTokenInfo[] | null>(null);
  const [fresh, setFresh] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => { listAiTokens(client).then(setTokens).catch(e => { setTokens([]); say((e as Error).message); }); }, [client, say]);
  useEffect(() => { refresh(); }, [refresh]);
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); say(`${what}已复制`); } catch { say('复制失败，请长按选中后手动复制'); } };
  const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '从未';
  return (
    <div className="card">
      <h3><KeyRound size={17} />AI 同步令牌</h3>
      <p className="muted">把令牌交给 Claude 的“昱时日程同步”技能，AI 对话里改的日程会自动进到电脑和手机。令牌只能改日程，不能登录账号；不用了随时撤销。</p>
      {fresh ? (
        <div className="stack token-fresh">
          <p className="muted">这是新令牌，<b>只显示这一次</b>，请现在复制保存：</p>
          <code className="token">{fresh}</code>
          <div className="row-btns">
            <button className="primary" onClick={() => void copy(fresh, '令牌')}><Copy size={16} />复制令牌</button>
            <button className="secondary" onClick={() => setFresh('')}>我已保存</button>
          </div>
        </div>
      ) : (
        <button className="secondary wide" disabled={busy} onClick={async () => {
          setBusy(true);
          try { setFresh(await createAiToken(client, userId, 'Claude')); refresh(); }
          catch (e) { say((e as Error).message); }
          finally { setBusy(false); }
        }}><KeyRound size={16} />生成新令牌</button>
      )}
      <div className="kv token-url"><span>接口地址</span><button className="link-btn" onClick={() => void copy(aiSyncUrl(projectUrl), '接口地址')}>复制</button></div>
      {tokens && tokens.length > 0 && (
        <ul className="token-list">{tokens.map(token => (
          <li key={token.hash}>
            <span><b>{token.label}</b><small>生成 {when(token.createdAt)} · 上次使用 {when(token.lastUsedAt)}</small></span>
            <button className="text-btn danger" onClick={async () => { try { await revokeAiToken(client, token.hash); say('已撤销'); refresh(); } catch (e) { say((e as Error).message); } }}>撤销</button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
