import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, DragEvent, ReactNode } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, ChevronDown, Plus, Search, Settings, ListTodo, Inbox, Sun, X, Clock3, Repeat2, Trash2, ArrowUpRight, PanelRightClose, PanelRightOpen, Maximize2, Cloud, Download, Upload, Monitor, Smartphone, Bell, MoreHorizontal, CheckCheck, Circle, LogOut, RefreshCw, Menu, GraduationCap } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppData, Task, Timetable, TimetableSlot } from './types';
import { DEFAULT_TIMETABLE, breaksOf, classesForDate, effectiveTimetable, slotsForWeekday, validateTimetable } from './timetable';
import type { DayClass } from './timetable';
import { todayKey, dateKey, parseDate, addDays, monthDays, occursOn, isDone, toggleTask, moveTask, tasksForDate, formatLunar, validateBackup, defaultData, mergeTasks, TASK_COLORS } from './core';
import { createCloudClient, syncTasks, listsForTasks, cloudErrorMessage, requestPasswordReset, signIn, signUp, updatePassword } from './cloud';
import { applyRemoteLists, subscribeLive, syncLists, syncTimetable } from './live-sync';
import { aiSyncUrl, createAiToken, listAiTokens, revokeAiToken } from './ai-token';
import type { AiTokenInfo } from './ai-token';
import { readSaved, writeSaved, scheduleNative, enableNotifications, reminderQueue, isNative } from './platform';
import type { DesktopSettings, CellEditorRequest } from './platform';
import { mergeWindowData } from './window-data';
import { dayMark, festivalName, germanHoliday, GERMAN_STATES } from './holidays';
import type { GermanState } from './holidays';

const WEEK=['一','二','三','四','五','六','日'];
const REPEATS:Record<Task['repeat'],string>={none:'不重复',daily:'每天',weekdays:'每个工作日（周一至周五）',weekly:'每周',monthly:'每月',yearly:'每年'};
const uid=()=>crypto.randomUUID();
const stamp=()=>new Date().toISOString();
const dateLabel=(key:string)=>new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(parseDate(key));
// 打包时写入的云项目地址和公开密钥，作为没有手动填写时的默认值（与 iPhone 网页版相同）。
const BAKED:Record<string,string>={'shiri-cloud-url':(import.meta.env.VITE_SUPABASE_URL as string|undefined)?.trim()||'','shiri-cloud-key':(import.meta.env.VITE_SUPABASE_KEY as string|undefined)?.trim()||''};
const getPref=(key:string,fallback:string)=>{try{return localStorage.getItem(key)??(BAKED[key]||fallback);}catch{return BAKED[key]||fallback;}};
const timeMinutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
const REMINDER_LEADS=[0,5,10,15,30,60];
const reminderLeadPref=()=>{const minutes=Number(getPref('shiri-reminder-lead','10'));return REMINDER_LEADS.includes(minutes)?minutes:10;};
const germanStatePref=()=>{const value=getPref('shiri-de-state','BW');return (GERMAN_STATES.some(([code])=>code===value)?value:'') as GermanState;};
const minutesTime=(mins:number)=>`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;

function App() {
  const [desktopSurface] = useState(() => window.location.hash === '#desktop');
  // The cell editor page is loaded once, kept hidden and told each date over desktop IPC.
  const [cellEditorSurface] = useState(() => window.location.hash==='#cell-editor');
  const [editorIntent] = useState(() => {
    const hash=window.location.hash;
    if (!hash.startsWith('#editor?')) return null;
    const params = new URLSearchParams(hash.slice(hash.indexOf('?')+1));
    return { taskId: params.get('taskId') || '', date: params.get('date') || '', time: params.get('time') || '' };
  });
  const editorSurface = editorIntent !== null || cellEditorSurface;
  const [previewSpan,setPreviewSpan] = useState<DesktopSettings['widgetSpan']>('twoWeeks');
  const [today,setToday]=useState(todayKey);
  const [selected,setSelected]=useState(todayKey);
  const [month,setMonth]=useState(()=>parseDate(todayKey()));
  const [view,setView]=useState<'month'|'day'|'list'>('month');
  const [section,setSection]=useState('calendar');
  const [filter,setFilter]=useState('all');
  const [query,setQuery]=useState('');
  const [data,setData]=useState<AppData>(defaultData);
  const [ready,setReady]=useState(false);
  const [storageKey,setStorageKey]=useState('shiri-data:local');
  const [panel,setPanel]=useState(true);
  const [mobileMenu,setMobileMenu]=useState(false);
  const [hideDone,setHideDone]=useState(false);
  const [edit,setEdit]=useState<Task|null>(null);
  const [editorWasOpen,setEditorWasOpen]=useState(false);
  const editorInitialized=useRef(false);
  const editRef=useRef(edit); editRef.current=edit;
  const titleRef=useRef<HTMLInputElement>(null);
  const cellOriginal=useRef('');
  const [cellExpanded,setCellExpanded]=useState(false);
  const [cellRequest,setCellRequest]=useState<CellEditorRequest|null>(null);
  const [cellReveal,setCellReveal]=useState(0);
  const cellSeq=useRef(0);
  const cellBlurTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [editDate,setEditDate]=useState('');
  const [settings,setSettings]=useState(false);
  const [message,setMessage]=useState('');
  const [undo,setUndo]=useState<Task|null>(null);
  const calendarDrag=useRef<{x:number;y:number;moved:boolean}|null>(null);
  const skipCalendarClick=useRef(false);
  const desktopClickTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const eventClickTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [quick,setQuick]=useState('');
  const [reminders,setReminders]=useState(()=>getPref('shiri-reminders',window.desktop?'true':'false')==='true');
  const [reminderLead,setReminderLead]=useState(reminderLeadPref);
  const [germanState,setGermanState]=useState<GermanState>(germanStatePref);
  const [showTimetable,setShowTimetable]=useState(()=>getPref('shiri-timetable','1')!=='0');
  const [desktop,setDesktop]=useState<DesktopSettings|null>(null);
  const [cloudUrl,setCloudUrl]=useState(()=>getPref('shiri-cloud-url',''));
  const [cloudKey,setCloudKey]=useState(()=>getPref('shiri-cloud-key',''));
  const [client,setClient]=useState<SupabaseClient|null>(null);
  const [user,setUser]=useState<{id:string;email?:string}|null>(null);
  const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [resetOffer,setResetOffer]=useState('');
  const [changingPassword,setChangingPassword]=useState(false);
  const [newPassword,setNewPassword]=useState(''); const [confirmPassword,setConfirmPassword]=useState('');
  const [busy,setBusy]=useState(false); const [syncState,setSyncState]=useState('本机保存');
  const [cloudConfigured,setCloudConfigured]=useState(false);
  const [syncRetry,setSyncRetry]=useState(0);
  const [loadedKey,setLoadedKey]=useState('');
  const monthGridRef=useRef<HTMLDivElement>(null);
  const importRef=useRef<HTMLInputElement>(null);
  const timelineRef=useRef<HTMLDivElement>(null);
  const taskRef=useRef(data.tasks); taskRef.current=data.tasks;
  const dataRef=useRef(data); dataRef.current=data;
  const keyRef=useRef(storageKey); keyRef.current=storageKey;
  const uidRef=useRef(user?.id); uidRef.current=user?.id;
  const readyRef=useRef(ready); readyRef.current=ready;
  const loadedKeyRef=useRef(loadedKey); loadedKeyRef.current=loadedKey;
  const accountKey=useCallback((id:string)=>`shiri-data:${encodeURIComponent(new URL(getPref('shiri-cloud-url','https://local.invalid')).origin)}:${id}`,[]);
  const canEdit=()=>readyRef.current&&loadedKeyRef.current===keyRef.current;
  const toast=useCallback((text:string)=>setMessage(text),[]);

  useEffect(()=>{document.documentElement.classList.toggle('desktop-surface',desktopSurface);document.documentElement.classList.toggle('widget-preview',desktopSurface&&!window.desktop);document.documentElement.classList.toggle('editor-surface',editorSurface);return()=>{document.documentElement.classList.remove('desktop-surface','widget-preview','editor-surface');};},[desktopSurface,editorSurface]);
  useEffect(()=>{
    const receive=(event:StorageEvent)=>{
      if(event.storageArea!==localStorage)return;
      if(event.key===keyRef.current&&event.newValue&&canEdit()){
        try{const incoming=validateBackup(JSON.parse(event.newValue));setData(previous=>mergeWindowData(previous,incoming));}catch{toast('另一个窗口的数据未能读取，请先导出备份');}
      }
      if(event.key==='shiri-reminders')setReminders(event.newValue==='true');
      if(event.key==='shiri-reminder-lead')setReminderLead(reminderLeadPref());
      if(event.key==='shiri-de-state')setGermanState(germanStatePref());
      if(event.key==='shiri-timetable')setShowTimetable(event.newValue!=='0');
      if(event.key==='shiri-cloud-key'){
        const url=getPref('shiri-cloud-url',''),key=getPref('shiri-cloud-key','');
        setCloudUrl(url);setCloudKey(key);
        if(url&&key)try{setClient(createCloudClient(url,key));setCloudConfigured(true);}catch{toast('云同步配置无效，请在管理窗口更新');}
      }
    };
    window.addEventListener('storage',receive);return()=>window.removeEventListener('storage',receive);
  },[toast]);

  useEffect(()=>{const t=setInterval(()=>setToday(todayKey()),30000);return()=>clearInterval(t);},[]);
  
  useEffect(()=>{if(!message)return;const t=setTimeout(()=>setMessage(''),5500);return()=>clearTimeout(t);},[message]);
  useEffect(()=>{
    let cancelled=false; setReady(false);setData(defaultData());setEdit(null);setUndo(null);setQuick('');setQuery('');setFilter('all');setLoadedKey('');
    if(!window.desktop||loadedKeyRef.current)void scheduleNative([],false).catch(()=>{});
    readSaved(storageKey).then(saved=>{if(cancelled)return;setData(saved?validateBackup(JSON.parse(saved)):defaultData());setLoadedKey(storageKey);setReady(true);}).catch(()=>{if(!cancelled){toast('本机数据未能读取。请先导出或检查存储，避免覆盖原数据。');setLoadedKey('');}});
    return()=>{cancelled=true;};
  },[storageKey,toast]);
  useEffect(()=>{
    if(!ready||loadedKey!==storageKey)return;
    if(window.desktop){
      try{const raw=localStorage.getItem(storageKey);if(raw){const merged=mergeWindowData(data,validateBackup(JSON.parse(raw)));if(merged!==data){setData(merged);return;}}}
      catch{toast('本机数据异常，已暂停覆盖保存，请先导出备份');return;}
    }
    writeSaved(storageKey,JSON.stringify(data)).catch(()=>toast('保存失败：设备存储空间不足或不可用，请立即导出备份。'));
  },[data,ready,loadedKey,storageKey,toast]);
  useEffect(()=>{
    if(!window.desktop)return;
    const receive=(value:DesktopSettings)=>{setDesktop(value);if(value.lastError)toast(value.lastError);};
    window.desktop.getSettings().then(receive).catch(()=>toast('桌面服务暂不可用'));
    return window.desktop.onModeChanged(receive);
  },[toast]);
  useEffect(()=>{
    if(!desktopSurface||!window.desktop||desktop?.mode!=='desktop')return;
    const bridge=window.desktop;
    let interactive=false, dragging=false, forwardingContext=false, lastSync=0;
    const sync=(next:boolean)=>{interactive=next;lastSync=performance.now();void bridge.setCalendarInteractive(next);};
    const reset=()=>{dragging=false;sync(false);};
    const move=(event:MouseEvent)=>{
      if(forwardingContext)return;
      const element=document.elementFromPoint(event.clientX,event.clientY);
      const hit=!!element?.closest('.widget-heading,.day-cell,.desktop-hours');
      const next=!!edit||dragging||hit;
      // Re-assert now and then: the main process may release the mouse (cell
      // editor, desktop menu) without this page seeing the change.
      if(next!==interactive||(next&&performance.now()-lastSync>1000))sync(next);
    };
    // Sent when the main process released the mouse: forget the cached state so
    // the next hover over a date asks for clicks again.
    const offPointerReset=bridge.onPointerReset?.(()=>{dragging=false;interactive=false;lastSync=0;});
    const down=(event:PointerEvent)=>{if(event.button===0&&interactive)dragging=true;};
    const up=(event:PointerEvent)=>{dragging=false;move(event as unknown as MouseEvent);};
    const context=(event:MouseEvent)=>{
      const target=event.target as Element;
      if(!target.closest('.day-cell')||target.closest('.desktop-inline-editor'))return;
      event.preventDefault();
      event.stopPropagation();
      forwardingContext=true;interactive=false;
      void bridge.passDesktopContextMenu().finally(()=>{forwardingContext=false;move(event);});
    };
    reset();
    if(edit){interactive=true;void bridge.setCalendarInteractive(true);}
    document.addEventListener('mousemove',move,true);
    document.addEventListener('pointerdown',down,true);
    document.addEventListener('pointerup',up,true);
    document.addEventListener('contextmenu',context,true);
    window.addEventListener('blur',reset);
    return()=>{document.removeEventListener('mousemove',move,true);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('contextmenu',context,true);window.removeEventListener('blur',reset);offPointerReset?.();reset();};
  },[desktopSurface,desktop?.mode,!!edit]);
  useEffect(()=>()=>{if(desktopClickTimer.current)clearTimeout(desktopClickTimer.current);if(eventClickTimer.current)clearTimeout(eventClickTimer.current);},[]);
  useEffect(()=>{
    if(!ready||loadedKey!==storageKey)return; const timer=setTimeout(()=>scheduleNative(data.tasks,reminders,reminderLead).catch(()=>toast('提醒计划未能更新，请检查通知权限')),800);
    return()=>clearTimeout(timer);
  },[data.tasks,reminders,reminderLead,ready,loadedKey,storageKey,today,toast]);
  useEffect(()=>{
    if(!reminders||window.desktop||isNative)return;
    let due=reminderQueue(data.tasks,30,Date.now(),reminderLead); const timer=setInterval(()=>{
      const now=Date.now();for(const item of due.filter(i=>i.at<=now&&i.at>now-60000)){
        if('Notification' in window&&Notification.permission==='granted') new Notification(item.title,{body:item.body,icon:'./icon.svg'});
        toast(`到时间了：${item.title}`);
      }due=due.filter(i=>i.at>now);
    },15000);return()=>clearInterval(timer);
  },[reminders,reminderLead,data.tasks,today,toast]);
  useEffect(()=>{
    if(!client)return;let active=true;
    const {data:listener}=client.auth.onAuthStateChange((_event,session)=>{if(active){const next=session?.user??null;setUser(next);setStorageKey(next?accountKey(next.id):'shiri-data:local');setSyncState(next?'等待同步':'本机保存');}});
    client.auth.getSession().then(({data,error})=>{if(error)toast(error.message);if(active){const next=data.session?.user??null;setUser(next);setStorageKey(next?accountKey(next.id):'shiri-data:local');}});
    return()=>{active=false;listener.subscription.unsubscribe();};
  },[client,toast,accountKey]);
  useEffect(()=>{
    const savedUrl=getPref('shiri-cloud-url',''),savedKey=getPref('shiri-cloud-key','');
    if(savedUrl&&savedKey)try{setClient(createCloudClient(savedUrl,savedKey));setCloudConfigured(true);}catch{toast('云同步配置无效，请在设置中更新');}
  },[toast]);
  const syncing=useRef(false);
  const runSync=useCallback(async()=>{
    if(!client||!user||!readyRef.current||syncing.current)return;
    const owner=user.id, expectedKey=accountKey(owner);
    if(keyRef.current!==expectedKey||loadedKeyRef.current!==expectedKey)return;
    syncing.current=true;setSyncState('正在同步');
    try{
      const result=await syncTasks(client,taskRef.current);
      if(uidRef.current===owner&&keyRef.current===expectedKey&&loadedKeyRef.current===expectedKey){setData(prev=>{const tasks=mergeTasks(prev.tasks,result);const lists=listsForTasks(tasks,prev.lists);return JSON.stringify(tasks)===JSON.stringify(prev.tasks)&&JSON.stringify(lists)===JSON.stringify(prev.lists)?prev:{...prev,tasks,lists};});const canonical=await syncLists(client,owner,expectedKey,dataRef.current.lists);
        if(canonical&&uidRef.current===owner&&keyRef.current===expectedKey)setData(prev=>{const lists=listsForTasks(prev.tasks,applyRemoteLists(prev.lists,canonical));return JSON.stringify(lists)===JSON.stringify(prev.lists)?prev:{...prev,lists};});
        const syncedTimetable=await syncTimetable(client,owner,dataRef.current.timetable);
        if(syncedTimetable&&uidRef.current===owner&&keyRef.current===expectedKey)setData(prev=>prev.timetable&&prev.timetable.updatedAt>syncedTimetable.updatedAt||JSON.stringify(prev.timetable)===JSON.stringify(syncedTimetable)?prev:{...prev,timetable:syncedTimetable});
        setSyncState('已同步');}
    }catch(e){if(uidRef.current===owner)setSyncState(navigator.onLine?'同步失败，已保存在本机':'离线 · 已保存在本机');}
    finally{syncing.current=false;}
  },[client,user,accountKey]);
  useEffect(()=>{if(!user||!ready||loadedKey!==storageKey)return;const t=setTimeout(()=>void runSync(),1800);return()=>clearTimeout(t);},[data.tasks,data.lists,data.timetable,ready,loadedKey,storageKey,runSync,syncRetry,user]);
  // 手机上的改动几秒内推到电脑：云端有变更就立刻同步一次。
  useEffect(()=>{if(!client||!user)return;let t:ReturnType<typeof setTimeout>|undefined;const stop=subscribeLive(client,user.id,()=>{clearTimeout(t);t=setTimeout(()=>setSyncRetry(n=>n+1),350);});return()=>{clearTimeout(t);stop();};},[client,user]);
  useEffect(()=>{if(!user)return;const sync=()=>setSyncRetry(n=>n+1);const t=setInterval(sync,45000);window.addEventListener('online',sync);window.addEventListener('focus',sync);return()=>{clearInterval(t);window.removeEventListener('online',sync);window.removeEventListener('focus',sync);};},[user]);
  useEffect(()=>{if(view==='day'&&timelineRef.current)timelineRef.current.scrollTop=7*60;},[view,selected]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setEdit(null);setSettings(false);setMobileMenu(false);}if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();document.getElementById('search')?.focus();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);

  useEffect(()=>{if(edit&&data.tasks.some(t=>t.id===edit.id&&t.deletedAt)){setEdit(null);toast('这条日程已在另一窗口删除');}},[data.tasks,edit,toast]);
  useEffect(()=>{
    if (!editorIntent || !ready || loadedKey!==storageKey || editorInitialized.current) return;
    editorInitialized.current=true;
    if (editorIntent.taskId) {
      const task=data.tasks.find(item=>item.id===editorIntent.taskId&&!item.deletedAt);
      if (!task) { void window.desktop?.closeEditor(); return; }
      setEdit(task); setEditDate(editorIntent.date || task.date);
    } else newTask(editorIntent.date,editorIntent.time);
  },[editorIntent,ready,loadedKey,storageKey,data.tasks]);
  useEffect(()=>{if(editorSurface&&edit)setEditorWasOpen(true);},[editorSurface,edit]);
  useEffect(()=>{if(editorSurface&&editorWasOpen&&!edit)void window.desktop?.closeEditor(cellEditorSurface?cellSeq.current:undefined);},[editorSurface,editorWasOpen,edit,cellEditorSurface]);
  useEffect(()=>{
    if(!cellEditorSurface||!window.desktop?.onCellEditorOpen)return;
    return window.desktop.onCellEditorOpen(request=>setCellRequest({taskId:request.taskId||'',date:request.date,time:request.time||'',keepDraft:request.keepDraft===true,seq:request.seq}));
  },[cellEditorSurface]);
  useEffect(()=>{
    if(!cellRequest||!ready||loadedKey!==storageKey)return;
    setCellRequest(null);
    clearTimeout(cellBlurTimer.current);
    cellSeq.current=cellRequest.seq;
    // Double-clicking another date keeps what was typed in the visible editor.
    if(cellRequest.keepDraft)commitCellEdit();
    let fresh=dataRef.current;
    try{const raw=localStorage.getItem(storageKey);if(raw){const incoming=validateBackup(JSON.parse(raw));fresh=mergeWindowData(fresh,incoming);setData(previous=>mergeWindowData(previous,incoming));}}catch{/* the storage listener reports unreadable data */}
    const now=stamp();
    const task:Task|undefined=cellRequest.taskId
      ?fresh.tasks.find(item=>item.id===cellRequest.taskId&&!item.deletedAt)
      :{id:uid(),title:'',date:cellRequest.date,time:cellRequest.time,duration:60,listId:fresh.lists[0].id,notes:'',priority:'normal',repeat:'none',completed:false,doneDates:[],createdAt:now,updatedAt:now};
    setMessage('');setCellExpanded(false);
    if(!task){setEdit(null);void window.desktop?.closeEditor(cellRequest.seq);return;}
    cellOriginal.current=JSON.stringify(task);
    setEdit(task);setEditDate(cellRequest.date||task.date);setCellReveal(n=>n+1);
  },[cellRequest,ready,loadedKey,storageKey]);
  useEffect(()=>{
    if(!cellReveal||!cellEditorSurface)return;
    const input=titleRef.current;
    if(input){input.focus();const end=input.value.length;input.setSelectionRange(end,end);}
    void window.desktop?.cellEditorReady();
  },[cellReveal,cellEditorSurface]);
  useEffect(()=>{
    if(!cellEditorSurface||!window.desktop?.onCellEditorBlur)return;
    const refocus=()=>{if(editRef.current&&(!document.activeElement||document.activeElement===document.body))titleRef.current?.focus();};
    const off=window.desktop.onCellEditorBlur(()=>{
      clearTimeout(cellBlurTimer.current);
      // Pickers and the input method keep focus in this window; only a real
      // click elsewhere finishes the edit, saving it when there is a title.
      cellBlurTimer.current=setTimeout(()=>{if(!document.hasFocus()&&editRef.current&&commitCellEdit())setEdit(null);},150);
    });
    window.addEventListener('focus',refocus);
    return()=>{clearTimeout(cellBlurTimer.current);off();window.removeEventListener('focus',refocus);};
  },[cellEditorSurface]);

  const timetable=effectiveTimetable(data.timetable);
  function setTimetableVisible(visible:boolean){setShowTimetable(visible);try{localStorage.setItem('shiri-timetable',visible?'1':'0');}catch{toast('课表显示设置未能保存');}}
  // Only valid timetables are stored, so a half-typed edit can never make the saved data unreadable.
  function saveTimetable(next:Timetable){if(!canEdit()){toast('数据还未载入，暂时无法编辑');return;}const candidate={...next,updatedAt:stamp()};try{validateTimetable(candidate);}catch(e){toast((e as Error).message);return;}setData(prev=>({...prev,timetable:candidate}));}
  function updateSlot(id:string,patch:Partial<TimetableSlot>){saveTimetable({...timetable,slots:timetable.slots.map(slot=>slot.id===id?{...slot,...patch}:slot)});}
  const listOf=(id:string)=>data.lists.find(l=>l.id===id)??data.lists[0];
  const activeTasks=data.tasks.filter(t=>!t.deletedAt);
  const filtered=activeTasks.filter(t=>(filter==='all'||t.listId===filter)&&(!query||`${t.title} ${t.notes}`.toLowerCase().includes(query.toLowerCase())));
  const onDate=(key:string)=>tasksForDate(filtered,key).filter(t=>!hideDone||!isDone(t,key));
  const dayTasks=onDate(selected);
  const todayTasks=tasksForDate(activeTasks,today);
  const completedToday=todayTasks.filter(t=>isDone(t,today)).length;
  const inbox=filtered.filter(t=>!t.date&&(!hideDone||!t.completed));
  const widgetSpan=desktop?.widgetSpan??previewSpan;
  const weekStart=addDays(selected,-((parseDate(selected).getDay()+6)%7));
  const days=desktopSurface&&widgetSpan!=='month'
    ?Array.from({length:widgetSpan==='week'?7:14},(_,index)=>addDays(weekStart,index))
    :monthDays(month.getFullYear(),month.getMonth());
  const rangeStart=parseDate(days[0]);
  const rangeEnd=parseDate(days[days.length-1]);
  const widgetRangeLabel=`${rangeStart.getMonth()+1}月${rangeStart.getDate()}日–${rangeEnd.getMonth()+1}月${rangeEnd.getDate()}日`;
  const isList=view==='list'||section==='inbox';
  const listed=section==='inbox'?inbox:filtered.filter(t=>!hideDone||!isDone(t,t.date||today)).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.time.localeCompare(b.time));

  function openDesktopCellEditor(request:{date:string;time?:string;taskId?:string}) {
    selectDate(request.date);
    const locate=()=>document.querySelector<HTMLElement>(`[data-date="${request.date}"]`);
    const open=()=>{
      const cell=locate();
      if(!cell){toast('请先切换到该日期后再编辑');return;}
      const {x,y,width,height}=cell.getBoundingClientRect();
      void window.desktop!.openInlineEditor({...request,rect:{x,y,width,height}}).then(result=>{if(!result.ok)toast(result.error||'无法在日期格内编辑');});
    };
    if(locate())open();else requestAnimationFrame(()=>requestAnimationFrame(open));
  }
  function newTask(date=selected,time='') {
    if(!canEdit()){toast('数据还未载入，暂时无法编辑');return;}
    if(desktopSurface&&window.desktop){openDesktopCellEditor({date,...(time?{time}:{})});return;}
    const now=stamp();setEditDate(date);setEdit({id:uid(),title:'',date,time,duration:60,listId:filter==='all'?data.lists[0].id:filter,notes:'',priority:'normal',repeat:'none',completed:false,doneDates:[],createdAt:now,updatedAt:now});
  }
  function editTask(task:Task,date:string){
    if(desktopSurface&&window.desktop){openDesktopCellEditor({taskId:task.id,date});return;}
    setEdit(task);setEditDate(date);
  }
  function updateTask(task:Task,allowRestore=false) {
    if(!canEdit()){toast('请等待当前空间载入');return false;}
    if(!allowRestore&&taskRef.current.some(t=>t.id===task.id&&t.deletedAt&&!task.deletedAt)){toast('这条日程已在另一窗口删除');setEdit(null);return false;}
    setData(prev=>{
      const previous=prev.tasks.find(t=>t.id===task.id);
      if(previous?.deletedAt&&!task.deletedAt&&!allowRestore)return prev;
      const updatedAt=new Date(Math.max(Date.now(),Date.parse(previous?.updatedAt||task.updatedAt)+1,Date.parse(task.updatedAt))).toISOString();
      return {...prev,tasks:[...prev.tasks.filter(t=>t.id!==task.id),{...task,updatedAt,deletedAt:task.deletedAt?updatedAt:undefined}]};
    });
    return true;
  }
  function complete(task:Task,date=task.date||selected){updateTask(toggleTask(task,date));}
  function selectDate(date:string){setSelected(date);if(date.slice(0,7)!==dateKey(month).slice(0,7))setMonth(parseDate(date));setPanel(true);}
  function goToday(){setSelected(today);setMonth(parseDate(today));setSection('calendar');setFilter('all');}
  function navigate(delta:number){if(desktopSurface&&widgetSpan!=='month'){selectDate(addDays(selected,delta*(widgetSpan==='week'?7:14)));}else if(view==='day'&&!desktopSurface){const next=addDays(selected,delta);selectDate(next);}else setMonth(new Date(month.getFullYear(),month.getMonth()+delta,1));}
  function dragStart(e:DragEvent,task:Task,date:string){e.dataTransfer.setData('application/x-shiri',JSON.stringify({id:task.id,date}));e.dataTransfer.effectAllowed='move';}
  function calendarPointerDown(e:React.PointerEvent<HTMLButtonElement>){if(e.button!==0)return;calendarDrag.current={x:e.clientX,y:e.clientY,moved:false};skipCalendarClick.current=false;e.currentTarget.setPointerCapture(e.pointerId);}
  function calendarPointerMove(e:React.PointerEvent<HTMLButtonElement>){const drag=calendarDrag.current;if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8){drag.moved=true;e.currentTarget.style.opacity='.45';}}
  function calendarPointerUp(e:React.PointerEvent<HTMLButtonElement>,task:Task,date:string){const drag=calendarDrag.current;calendarDrag.current=null;e.currentTarget.style.opacity='';if(!drag?.moved)return;skipCalendarClick.current=true;e.currentTarget.style.pointerEvents='none';const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-date]')?.dataset.date;e.currentTarget.style.pointerEvents='';if(target&&target!==date){updateTask(moveTask(task,date,target));toast(task.repeat==='none'?'已调整日程日期':'已调整整个重复系列');}}
  function drop(e:DragEvent,date:string,time?:string){
    e.preventDefault();e.currentTarget.classList.remove('dragover');
    try{const item=JSON.parse(e.dataTransfer.getData('application/x-shiri'));const task=activeTasks.find(t=>t.id===item.id);if(task){const start=time??task.time;if(start&&timeMinutes(start)+task.duration>1440){toast('这个时段放不下整条日程，请选择更早的时间');return;}updateTask(moveTask(task,item.date,date,time));toast(task.repeat==='none'?'已调整日程':'已调整整个重复系列');}}catch{/* unrelated drag */}
  }
  function prepareTask(task:Task):Task|string{if(!task.title.trim())return '请输入任务名称';if(task.time&&timeMinutes(task.time)+task.duration>1440)return '结束时间不能超过当天 24:00，请缩短时长或拆成两条日程';const next={...task,title:task.title.trim(),repeat:task.date?task.repeat:'none',time:task.date?task.time:''} as Task;next.completed=next.repeat==='none'?next.completed:false;next.doneDates=next.repeat==='none'?[]:next.doneDates.filter(date=>occursOn(next,date));return next;}
  function saveTask(e:FormEvent){e.preventDefault();if(!edit||!canEdit())return;const next=prepareTask(edit);if(typeof next==='string'){toast(next);return;}if(updateTask(next)){setEdit(null);toast('已保存');}}
  // Click-away and moving to another date: save a titled, changed draft; drop an empty or untouched one.
  function commitCellEdit(){const current=editRef.current;if(!current||!current.title.trim()||JSON.stringify(current)===cellOriginal.current)return true;const next=prepareTask(current);if(typeof next==='string'){toast(next);return false;}return updateTask(next);}
  function toggleCellDetails(){const next=!cellExpanded;setCellExpanded(next);if(cellEditorSurface)void window.desktop?.resizeCellEditor(next);}
  function deleteTask(){if(!edit)return;const original=edit;setUndo(original);updateTask({...original,deletedAt:stamp()});setEdit(null);toast('任务已删除');}
  function quickAdd(e:FormEvent){e.preventDefault();if(!quick.trim()||!canEdit())return;if(quick.trim().length>200){toast('任务名称最多 200 字');return;}const now=stamp();updateTask({id:uid(),title:quick.trim(),date:section==='inbox'?'':selected,time:'',duration:60,listId:filter==='all'?data.lists[0].id:filter,notes:'',priority:'normal',repeat:'none',completed:false,doneDates:[],createdAt:now,updatedAt:now});setQuick('');}
  function downloadBackup(){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`昱时备份-${today}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  async function importBackup(file?:File){if(!file||!canEdit())return;const owner=keyRef.current;try{if(file.size>10_000_000)throw new Error('备份文件过大');const imported=validateBackup(JSON.parse(await file.text()));if(owner!==keyRef.current||!canEdit())return;setData(prev=>({...prev,tasks:mergeTasks(prev.tasks,imported.tasks),lists:[...prev.lists,...imported.lists.filter(l=>!prev.lists.some(p=>p.id===l.id))]}));toast('备份已合并，已有的较新任务会保留');}catch(e){toast(`导入失败：${(e as Error).message}`);}if(importRef.current)importRef.current.value='';}
  function loadExamples(){const now=stamp();const sample=[['项目周会','09:00',60,0],['专注时间 · 整理本周计划','11:00',90,0],['去公园走一走','18:00',45,1],['读书 20 分钟','21:00',30,2],['准备下周的旅行清单','',60,1]] as const;const tasks:Task[]=sample.map(([title,time,duration,list],i)=>({id:uid(),title,date:i===4?addDays(today,2):today,time,duration,listId:data.lists[list]?.id??data.lists[0].id,notes:'这是一条示例任务，可以编辑或删除。',priority:i===0?'high':'normal',repeat:i===3?'daily':'none',completed:false,doneDates:[],createdAt:now,updatedAt:now}));setData(prev=>({...prev,tasks:[...prev.tasks,...tasks]}));goToday();toast('已添加 5 条示例任务，你可以编辑或删除它们');}
  async function changeMode(mode:DesktopSettings['mode']){if(window.desktop){const result=await window.desktop.setMode(mode);setDesktop(result);if(!result.ok)toast(result.error||'切换失败');else if(mode==='desktop')toast('桌面日历已显示 · Ctrl+Alt+D 打开管理窗口');}else{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('请使用浏览器的全屏选项');}}}
  async function changeWidgetSpan(span:DesktopSettings['widgetSpan']){if(window.desktop){const result=await window.desktop.setWidgetSpan(span);if(result.ok)setDesktop(result);else toast(result.error||'调整日历范围失败');}else setPreviewSpan(span);}
  async function auth(action:'login'|'signup'){
    if(!client){toast('请先保存云项目连接配置');return;}setBusy(true);
    try{
      if(action==='login')await signIn(client,email,password);
      else{
        const result=await signUp(client,email,password);
        if(result.alreadyRegistered){setResetOffer(email.trim());toast('该邮箱已被注册。是否发送重置密码邮件？');return;}
      }
      setPassword('');setResetOffer('');toast(action==='signup'?'注册请求成功，请检查邮箱验证邮件':'已登录，正在载入此账号的数据');
    }catch(e){toast(cloudErrorMessage(e));}finally{setBusy(false);}
  }
  async function sendPasswordReset(target=email){
    if(!client){toast('请先保存云项目连接配置');return;}setBusy(true);
    try{await requestPasswordReset(client,target);setResetOffer('');toast('重置邮件已发送。请在邮箱打开链接，设置新密码；当前日程不会被删除。');}catch(e){toast(cloudErrorMessage(e));}finally{setBusy(false);}
  }
  async function saveNewPassword(){
    if(!client)return;if(newPassword!==confirmPassword){toast('两次输入的新密码不一致。');return;}setBusy(true);
    try{await updatePassword(client,newPassword);setNewPassword('');setConfirmPassword('');setChangingPassword(false);toast('新密码已保存。账号和现有日程保持不变。');}catch(e){toast(cloudErrorMessage(e));}finally{setBusy(false);}
  }
  async function migrateLocal(){if(!canEdit()||!user)return;const owner=keyRef.current;try{const raw=await readSaved('shiri-data:local');if(owner!==keyRef.current||!canEdit())return;if(raw){const local=validateBackup(JSON.parse(raw));setData(prev=>({...prev,tasks:mergeTasks(prev.tasks,local.tasks),lists:[...prev.lists,...local.lists.filter(l=>!prev.lists.some(p=>p.id===l.id))]}));toast('本机任务已合并到当前账号，正在等待同步');}else toast('没有本机任务可合并');}catch{toast('本机数据未能读取');}}

  function taskRow(task:Task,date:string,compact=false){const done=isDone(task,date);const list=listOf(task.listId);return <div key={`${task.id}:${date}`} className={`task-row ${done?'done':''} ${compact?'compact':''}`} draggable onDragStart={e=>dragStart(e,task,date)}>
    <button className={`check ${done?'checked':''}`} aria-label={`${done?'取消完成':'完成'} ${task.title}`} onClick={()=>complete(task,date)}>{done&&<Check size={12}/>}</button>
    <button className="task-text" onClick={()=>editTask(task,date)}><span>{task.title}</span><small>{task.time&&<><Clock3 size={11}/>{task.time} · </>}{list?.name}{task.repeat!=='none'&&<Repeat2 size={11}/>}</small></button>
    <span className={`priority ${task.priority==='high'?'high':''}`} style={{background:task.priority==='high'?undefined:task.color||list?.color}}/>
  </div>;}

  const daySchedule = <div className="day-view"><div className="all-day"><span>全天</span><div>{dayTasks.filter(t=>!t.time).map(t=>taskRow(t,selected,true))}<button className="all-day-add" onClick={()=>newTask(selected)}><Plus size={14}/>全天日程</button></div></div><div className="timeline-scroll" ref={timelineRef}><div className="timeline"><div className="time-gutter">{Array.from({length:24},(_,h)=><span key={h} style={{top:h*60}}>{String(h).padStart(2,'0')}:00</span>)}</div><div className="time-slots">{Array.from({length:48},(_,half)=><button key={half} className={`time-slot ${half%2?'half':''}`} aria-label={`${selected} ${minutesTime(half*30)} 新建日程`} onClick={()=>newTask(selected,minutesTime(half*30))} onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,selected,minutesTime(half*30))}/>)}<TimelineEvents tasks={dayTasks.filter(t=>t.time)} date={selected} color={task=>task.color||listOf(task.listId)?.color||'#6475d5'} onEdit={task=>editTask(task,selected)} onDrag={dragStart} onMove={(task,time)=>{updateTask(moveTask(task,selected,selected,time));toast(task.repeat==='none'?'已调整日程时间':'已调整整个重复系列的时间');}}/>{selected===today&&<div className="now-line" style={{top:new Date().getHours()*60+new Date().getMinutes()}}><i/></div>}</div></div></div></div>;

  const editExists=!!edit&&activeTasks.some(t=>t.id===edit.id);
  const inlineEditor=edit&&<form className={`desktop-inline-editor ${cellExpanded?'expanded':'compact'}`} onSubmit={saveTask} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();setEdit(null);}}}>
    <div className="inline-editor-heading">{cellEditorSurface&&message?<strong className="inline-editor-message" role="status">{message}</strong>:<strong>{edit.date?`${parseDate(edit.date).getMonth()+1}月${parseDate(edit.date).getDate()}日`:'收集箱'} · {editExists?'编辑日程':'新建日程'}</strong>}<span>{editExists&&<button type="button" aria-label="删除日程" title="删除日程" onClick={deleteTask}><Trash2 size={14}/></button>}<button type="button" aria-label="取消编辑" title="取消（Esc）" onClick={()=>setEdit(null)}><X size={15}/></button></span></div>
    <input ref={titleRef} autoFocus aria-label="日程名称" placeholder="输入日程，回车保存" maxLength={200} required value={edit.title} onChange={e=>setEdit({...edit,title:e.target.value})}/>
    <ColorSwatches value={edit.color} fallback={listOf(edit.listId)?.color} onChange={color=>setEdit(withColor(edit,color))}/>
    <textarea aria-label="备注" placeholder="备注（可选，Ctrl+Enter 保存）" maxLength={10000} value={edit.notes} onChange={e=>setEdit({...edit,notes:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/>
    <div className="inline-editor-quick"><input type="time" aria-label="开始时间" title="开始时间，留空为全天" value={edit.time} onChange={e=>setEdit({...edit,time:e.target.value})}/><button type="button" aria-expanded={cellExpanded} onClick={toggleCellDetails}>{cellExpanded?'收起':'更多'}</button><button type="submit">保存</button></div>
    {cellExpanded&&<><div className="inline-editor-fields"><label>日期<input type="date" aria-label="日期" value={edit.date} onChange={e=>setEdit({...edit,date:e.target.value})}/></label><label>时长<select aria-label="持续时长" disabled={!edit.time} value={edit.duration} onChange={e=>setEdit({...edit,duration:Number(e.target.value)})}>{[15,30,45,60,90,120,180,240,480].map(n=><option key={n} value={n}>{n<60?`${n} 分钟`:`${n/60} 小时`}</option>)}</select></label><label>重复<select aria-label="重复" value={edit.repeat} onChange={e=>setEdit({...edit,repeat:e.target.value as Task['repeat']})}>{Object.entries(REPEATS).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><label>清单<select aria-label="所属清单" value={edit.listId} onChange={e=>setEdit({...edit,listId:e.target.value})}>{data.lists.map(list=><option key={list.id} value={list.id}>{list.name}</option>)}</select></label><label>优先级<select aria-label="优先级" value={edit.priority} onChange={e=>setEdit({...edit,priority:e.target.value as Task['priority']})}><option value="normal">普通</option><option value="high">重要</option></select></label></div></>}
  </form>;

  return <div className={`app ${!panel?'panel-hidden':''} ${mobileMenu?'menu-open':''} ${desktopSurface?'desktop-calendar':''}  ${editorSurface&&!cellEditorSurface?'editor-only':''} ${cellEditorSurface?'cell-editor-surface':''}`} data-span={desktopSurface?widgetSpan:undefined}>
    {!desktopSurface&&!cellEditorSurface&&<aside className="sidebar">
      <a className="brand" href="#" onClick={e=>{e.preventDefault();goToday();}}><img src="./icon.svg" alt=""/><span>昱时<small>让每一天，有条不紊</small></span></a>
      <button className="create-button" onClick={()=>newTask(section==='inbox'?'':selected)}><Plus size={18}/> 新建日程 <kbd>+</kbd></button>
      <nav className="main-nav">
        <button className={section==='calendar'&&filter==='all'?'active':''} onClick={()=>{setSection('calendar');setFilter('all');setView('month');setMobileMenu(false);}}><CalendarDays size={18}/>我的日历</button>
        <button className={section==='today'?'active':''} onClick={()=>{goToday();setSection('today');setView('day');setMobileMenu(false);}}><Sun size={18}/>今天<span>{todayTasks.filter(t=>!isDone(t,today)).length}</span></button>
        <button className={section==='inbox'?'active':''} onClick={()=>{setSection('inbox');setFilter('all');setMobileMenu(false);}}><Inbox size={18}/>收集箱<span>{activeTasks.filter(t=>!t.date&&!t.completed).length}</span></button>
      </nav>
      <div className="nav-heading">我的清单 <span>{data.lists.length}</span></div>
      <nav className="list-nav">{data.lists.map(list=><button key={list.id} className={filter===list.id?'active':''} onClick={()=>{setFilter(list.id);setSection('calendar');setMobileMenu(false);}}><i style={{background:list.color}}/>{list.name}<span>{activeTasks.filter(t=>t.listId===list.id&&!isDone(t,t.date||today)).length}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="daily-progress"><div><span>今天的每一小步</span><strong>{completedToday}<em> / {todayTasks.length}</em></strong></div><div className="progress-track"><i style={{width:`${todayTasks.length?completedToday/todayTasks.length*100:0}%`}}/></div><small>{todayTasks.length?'按自己的节奏，慢慢完成。':'留一点时间，给重要的事。'}</small></div>
      <button className="settings-link" onClick={()=>setSettings(true)}><Settings size={17}/>设置与同步<span className={`status-dot ${user&&syncState==='已同步'?'online':''}`}/></button>
      <div className="profile"><div className="avatar">{user?'我':'昱'}</div><div><strong>{user?.email?.split('@')[0]||'我的空间'}</strong><small>{user?syncState:'离线可用 · 本机保存'}</small></div><button className="icon-button" title="账号与同步" onClick={()=>setSettings(true)}><MoreHorizontal size={18}/></button></div></div>
    </aside>}
    {!desktopSurface&&mobileMenu&&<button className="menu-scrim" aria-label="关闭导航" onClick={()=>setMobileMenu(false)}/>}
    {!cellEditorSurface&&<main className="main">
      {!desktopSurface&&<><header className="topbar"><div className="location"><button className="icon-button mobile-only" aria-label="菜单" onClick={()=>setMobileMenu(true)}><Menu size={20}/></button><span className="breadcrumb">我的空间</span><span className="slash">/</span><strong>{section==='inbox'?'收集箱':filter==='all'?'日历':listOf(filter)?.name}</strong><span className="private-pill">个人</span></div><div className="top-actions"><label className="search"><Search size={16}/><input id="search" placeholder="搜索日程" value={query} onChange={e=>setQuery(e.target.value)}/><kbd>⌘ K</kbd></label><button className="icon-button" title="显示设置" onClick={()=>setSettings(true)}><Settings size={18}/></button></div></header>
      <div className="calendar-heading"><div><div className="eyebrow">A LITTLE SPACE FOR YOUR EVERYDAY</div><h1>{section==='inbox'?'收集箱':view==='day'?dateLabel(selected):`${month.getFullYear()} 年 ${month.getMonth()+1} 月`}<span className="month-en">{!isList&&view==='month'?month.toLocaleString('en',{month:'long'}):''}</span></h1><p>{section==='inbox'?'先记下来，再为它找一个合适的时间。':view==='day'?'展开一天，让时间为重要的事留白。':'生活的大小事，都在这一页。'}</p></div><button className="today-button" onClick={goToday}><span/>回到今天</button></div>
      <div className="toolbar"><div className="toolbar-left"><div className="arrow-group"><button className="icon-button" aria-label="上一页" onClick={()=>navigate(-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="下一页" onClick={()=>navigate(1)}><ChevronRight size={18}/></button></div><span className="toolbar-date">{view==='day'?formatLunar(selected):`${month.getMonth()+1} 月 · ${month.getFullYear()}`}</span><span className="divider"/><button className={`text-button ${hideDone?'selected':''}`} onClick={()=>setHideDone(v=>!v)}><CheckCheck size={15}/>{hideDone?'已隐藏完成':'显示已完成'}</button></div><div className="toolbar-right"><div className="view-switch">{([['month','月历'],['day','时间表'],['list','清单']] as const).map(([value,label])=><button key={value} className={view===value&&section!=='inbox'?'active':''} onClick={()=>{setView(value);if(section==='inbox')setSection('calendar');}}>{label}</button>)}</div><button className="icon-button fullscreen-button" title="铺满屏幕" onClick={()=>void changeMode('fullscreen')}><Maximize2 size={16}/></button><button className="icon-button panel-toggle" title={panel?'收起当天安排':'打开当天安排'} onClick={()=>setPanel(v=>!v)}>{panel?<PanelRightClose size={18}/>:<PanelRightOpen size={18}/>}</button></div></div>
      </>}
      {desktopSurface&&<header className="widget-heading"><div className="widget-month"><CalendarDays size={21}/><h1>{widgetSpan==='month'?<>{month.getFullYear()} 年 <strong>{month.getMonth()+1} 月</strong></>:<strong>{widgetRangeLabel}</strong>}</h1></div><div className="widget-controls"><button title="上一段" aria-label="上一段" onClick={()=>navigate(-1)}><ChevronLeft size={18}/></button><button onClick={goToday}>今天</button><button title="下一段" aria-label="下一段" onClick={()=>navigate(1)}><ChevronRight size={18}/></button><i/><div className="widget-span-switch" aria-label="显示范围">{([['week','一周'],['twoWeeks','两周'],['month','整月']] as const).map(([span,label])=><button key={span} className={widgetSpan===span?'active':''} onClick={()=>void changeWidgetSpan(span)}>{label}</button>)}</div><button onClick={()=>setTimetableVisible(!showTimetable)} className={showTimetable?'active':''} title="在日期格里显示或隐藏课表" aria-label="课表"><GraduationCap size={16}/></button><button onClick={()=>newTask(selected)} title="新建日程"><Plus size={16}/></button><button title="打开管理窗口" aria-label="打开管理窗口" onClick={()=>{if(window.desktop)void window.desktop.showWindow();else window.open(window.location.href.split('#')[0],'yushi-manager');}}><Settings size={17}/></button></div></header>}
      {!ready&&<div className="load-notice">正在载入你的安排…</div>}
      <div className="calendar-body">
      {isList?<div className="list-view"><div className="list-view-title"><h2>{section==='inbox'?'还没有日期的事':'全部日程'}</h2><span>{listed.length} 项</span></div><form className="inline-add" onSubmit={quickAdd}><Plus size={18}/><input aria-label="快速添加任务" placeholder={section==='inbox'?'记下一个待办，按 Enter 保存':'添加到选中的日期，按 Enter 保存'} value={quick} onChange={e=>setQuick(e.target.value)}/><button type="submit">添加</button></form>{listed.map(task=><div className="list-item" key={task.id}>{taskRow(task,task.date||selected)}<span className="list-date">{task.date||'未安排'}{task.repeat!=='none'&&' 起 · 重复'}</span></div>)}{!listed.length&&<div className="empty-state"><Inbox size={34}/><h3>{query?'没有找到相关日程':'先把想做的事，记下来'}</h3><p>{query?'换一个关键词再试试。':'你可以稍后再安排日期和时间。'}</p></div>}</div>
      :view==='month'||desktopSurface?<div className="month-view"><div className="weekdays">{WEEK.map((w,i)=><span key={w} className={i>4?'weekend':''}>周{w}</span>)}</div><div className="month-grid" ref={monthGridRef}>{days.map(day=>{const dt=parseDate(day),tasks=onDate(day),mark=dayMark(day),festival=festivalName(day),german=germanHoliday(day,germanState),classes=desktopSurface&&showTimetable?classesForDate(timetable,day,!!german):null;return <div key={day} data-date={day} tabIndex={0} role="button" aria-label={`${day}，${tasks.length} 项日程`} className={`day-cell ${dt.getMonth()!==month.getMonth()?'outside':''} ${day===today?'today':''} ${day===selected?'selected':''} ${mark?.kind==='rest'?'rest-day':''}`} onClick={()=>{selectDate(day);if(desktopSurface){if(desktopClickTimer.current)clearTimeout(desktopClickTimer.current);}else if(window.innerWidth<=1000)setView('day');}} onDoubleClick={e=>{if((e.target as Element).closest('button,.desktop-inline-editor'))return;if(desktopClickTimer.current)clearTimeout(desktopClickTimer.current);selectDate(day);if(desktopSurface){e.preventDefault();newTask(day);}else setView('day');}} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();selectDate(day);if(desktopSurface)newTask(day);}}} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('dragover');}} onDragLeave={e=>e.currentTarget.classList.remove('dragover')} onDrop={e=>drop(e,day)}>
        <div className="cell-top"><span className="day-number">{dt.getDate()}</span><span className={`lunar ${festival?'festival':''}`}>{festival||formatLunar(day)}</span>{mark&&<span className={`day-mark ${mark.kind}`} title={`${mark.name}${mark.kind==='rest'?'放假':'调休上班'}`}>{mark.kind==='rest'?'休':'班'}</span>}{german&&<span className="de-holiday" title={`德国假日：${german.german}（${german.name}）`}>德·{german.name}</span>}<button className="cell-add" title={`在 ${day} 新建日程`} onClick={e=>{e.stopPropagation();newTask(day);}}><Plus size={13}/></button></div>
        <CellTasks onMore={()=>{selectDate(day);if(!desktopSurface&&window.innerWidth<=1000)setView('day');}}>{tasks.map(task=><button key={task.id} onPointerDown={calendarPointerDown} onPointerMove={calendarPointerMove} onPointerUp={e=>calendarPointerUp(e,task,day)} onPointerCancel={e=>{calendarDrag.current=null;e.currentTarget.style.opacity=''}} className={`calendar-event ${isDone(task,day)?'done':''}`} style={{'--event-color':task.color||listOf(task.listId)?.color} as React.CSSProperties} title={desktopSurface?'单击标记完成，双击编辑':undefined} onClick={e=>{e.stopPropagation();if(skipCalendarClick.current){skipCalendarClick.current=false;return;}if(!desktopSurface){editTask(task,day);return;}if(eventClickTimer.current)clearTimeout(eventClickTimer.current);eventClickTimer.current=setTimeout(()=>{eventClickTimer.current=null;complete(task,day);},250);}} onDoubleClick={e=>{e.stopPropagation();if(!desktopSurface)return;if(eventClickTimer.current){clearTimeout(eventClickTimer.current);eventClickTimer.current=null;}editTask(task,day);}}><i/>{task.time&&<small>{task.time}</small>}<span>{task.title}</span>{task.notes&&<em className="event-notes">{task.notes}</em>}{task.repeat!=='none'&&<Repeat2 size={10}/>}</button>)}</CellTasks>{classes&&<CellClasses rows={classes}/>}
        {desktopSurface&&edit&&editDate===day&&inlineEditor}
      </div>;})}</div><footer className="calendar-footer"><span><i className="hint-dot"/>{desktopSurface?'单击日程标记完成 · 双击日程或日期编辑 · 右键打开桌面菜单':'双击日期展开时间表 · 拖动日程调整日期'}</span><span>{filtered.length} 项日程 <span className="footer-sep">·</span> 周一开始</span></footer></div>
      :daySchedule}

      </div>
    </main>}
    {false&&desktopSurface&&view==='day'&&<aside className="desktop-hours" aria-label="桌面小时日程"><header><div><small>{formatLunar(selected)}</small><h2>{dateLabel(selected)}</h2></div><button aria-label="收起小时表" title="收起小时表" onClick={()=>setView('month')}><X size={20}/></button></header><div className="hours-tools"><button aria-label="前一天" onClick={()=>selectDate(addDays(selected,-1))}><ChevronLeft size={17}/></button><span>{dayTasks.length} 项安排</span><button aria-label="后一天" onClick={()=>selectDate(addDays(selected,1))}><ChevronRight size={17}/></button><button onClick={()=>newTask(selected)}><Plus size={16}/>添加</button></div>{daySchedule}</aside>}
    {!desktopSurface&&!cellEditorSurface&&panel&&<aside className="day-panel"><div className="panel-title"><span><Sun size={16}/> {selected===today?'今天的安排':'当天安排'}</span><button className="icon-button" title="收起面板" onClick={()=>setPanel(false)}><PanelRightClose size={17}/></button></div><div className="selected-date"><span>{parseDate(selected).getDate()}</span><div><strong>{parseDate(selected).toLocaleDateString('zh-CN',{weekday:'long'})}</strong><small>{parseDate(selected).getFullYear()} 年 {parseDate(selected).getMonth()+1} 月 · {formatLunar(selected)}</small></div><button className="icon-button" title="展开小时日程" onClick={()=>{setView('day');setSection('calendar');}}><ArrowUpRight size={19}/></button></div><button className="expand-timeline" onClick={()=>{setView(view==='day'?'month':'day');setSection('calendar');}}><Clock3 size={16}/>{view==='day'?'返回月历':'展开 24 小时时间表'}<ChevronRight size={15}/></button>
      <div className="day-summary"><div><strong>{dayTasks.length}</strong><span>项安排</span></div><div><strong>{dayTasks.filter(t=>isDone(t,selected)).length}</strong><span>已完成</span></div><div><strong>{Math.round(dayTasks.filter(t=>t.time).reduce((n,t)=>n+t.duration,0)/60*10)/10}<small>h</small></strong><span>计划用时</span></div></div>
      <div className="panel-section-title">日程与待办 <button className="icon-button" title="添加当天日程" onClick={()=>newTask(selected)}><Plus size={16}/></button></div><div className="panel-tasks">{dayTasks.map(task=>taskRow(task,selected))}{!dayTasks.length&&<div className="empty-day"><div className="empty-day-icon"><Sun size={28}/></div><h3>{query?'没有匹配的安排':'今天，留白也很好'}</h3><p>把重要的事记在这里，<br/>剩下的时间，交给生活。</p><button onClick={()=>newTask(selected)}><Plus size={14}/> 添加第一项安排</button></div>}</div><form className="panel-quick" onSubmit={quickAdd}><Plus size={16}/><input aria-label="添加当天待办" placeholder="添加一个待办…" value={quick} onChange={e=>setQuick(e.target.value)}/></form>
      {!activeTasks.length&&<div className="welcome-card"><span>HELLO, NEW DAY</span><h3>从一个小计划开始</h3><p>还没想好记什么？试试示例安排，感受一下昱时的节奏。</p><button onClick={loadExamples}>看看示例 <ArrowUpRight size={14}/></button></div>}
      <div className="panel-bottom"><span className="status-dot"/>{user?syncState:'所有改动保存在本机'}<button title="备份与云同步" onClick={()=>setSettings(true)}><Cloud size={15}/></button></div></aside>}
    {!desktopSurface&&<button className="mobile-fab" aria-label="新建日程" onClick={()=>newTask(selected)}><Plus size={24}/></button>}
    {edit&&!desktopSurface&&!cellEditorSurface&&<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setEdit(null);}}><section className="modal task-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><header><span><CalendarDays size={18}/><h2 id="edit-title">{activeTasks.some(t=>t.id===edit.id)?'编辑日程':'新建日程'}</h2></span><button className="icon-button" aria-label="关闭编辑" onClick={()=>setEdit(null)}><X size={20}/></button></header><form onSubmit={saveTask}><input className="title-input" autoFocus placeholder="想安排什么事？" aria-label="日程名称" maxLength={200} value={edit.title} onChange={e=>setEdit({...edit,title:e.target.value})} required/><ColorSwatches value={edit.color} fallback={listOf(edit.listId)?.color} onChange={color=>setEdit(withColor(edit,color))}/><div className="form-grid"><label>日期<input type="date" aria-label="日期" min="0001-01-01" max="9999-12-31" value={edit.date} onInput={e=>setEdit({...edit,date:e.currentTarget.value})} onChange={e=>setEdit({...edit,date:e.target.value})}/></label><label>所属清单<select value={edit.listId} onChange={e=>setEdit({...edit,listId:e.target.value})}>{data.lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>开始时间<input type="time" aria-label="开始时间" disabled={!edit.date} value={edit.time} onInput={e=>setEdit({...edit,time:e.currentTarget.value})} onChange={e=>setEdit({...edit,time:e.target.value})}/></label><label>持续时长<select disabled={!edit.time||!edit.date} value={edit.duration} onChange={e=>setEdit({...edit,duration:Number(e.target.value)})}>{[15,30,45,60,90,120,180,240,480].map(n=><option key={n} value={n}>{n<60?`${n} 分钟`:`${n/60} 小时`}</option>)}</select></label><label>重复<select disabled={!edit.date} value={edit.repeat} onChange={e=>setEdit({...edit,repeat:e.target.value as Task['repeat']})}>{Object.entries(REPEATS).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><label>优先级<select value={edit.priority} onChange={e=>setEdit({...edit,priority:e.target.value as Task['priority']})}><option value="normal">普通</option><option value="high">重要</option></select></label></div><label className="notes-label">备注<textarea value={edit.notes} maxLength={10000} placeholder="补充地点、准备事项或一点灵感…" onChange={e=>setEdit({...edit,notes:e.target.value})}/></label><div className="form-hints"><span><Bell size={13}/>{edit.time?(reminders?'将在开始时提醒':'提醒未开启，可在设置中开启'):'全天待办不发送定时提醒'}</span>{edit.repeat!=='none'&&<span><Repeat2 size={13}/>修改与删除会应用于整个重复系列；勾选仅完成当天。</span>}</div><footer><div>{activeTasks.some(t=>t.id===edit.id)&&<button type="button" className="danger icon-button" title="删除任务（重复任务删除整个系列）" onClick={deleteTask}><Trash2 size={17}/></button>}<button type="button" className="text-button" onClick={()=>setEdit({...edit,date:'',time:'',repeat:'none'})}>放入收集箱</button></div><div>{activeTasks.some(t=>t.id===edit.id)&&<button type="button" className="secondary" onClick={()=>{complete(edit,editDate||edit.date||selected);setEdit(null);}}><Check size={14}/>{isDone(edit,editDate||edit.date||selected)?'取消完成':'完成'}</button>}<button type="button" className="secondary" onClick={()=>setEdit(null)}>取消</button><button className="primary" type="submit">保存日程</button></div></footer></form></section></div>}
    {cellEditorSurface&&inlineEditor}
    {!desktopSurface&&settings&&<div className="modal-overlay"><section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><span><Settings size={18}/><h2 id="settings-title">设置与同步</h2></span><button className="icon-button" aria-label="关闭设置" onClick={()=>setSettings(false)}><X size={20}/></button></header><div className="settings-content">
      <div className="settings-section"><h3><Monitor size={17}/>桌面显示</h3>{desktop?<><p>桌面只显示可编辑的日历组件，点击日期展开小时表。按 Ctrl + Alt + D 打开管理窗口，也可使用系统托盘菜单。</p><div className="mode-buttons">{([['window','仅管理窗口'],['desktop','显示桌面日历'],['fullscreen','管理窗口全屏']] as const).map(([value,label])=><button key={value} className={desktop.mode===value?'selected':''} onClick={()=>void changeMode(value)}>{label}</button>)}</div><p className="minor">日历铺满主显示器工作区；空白格可右键桌面。日期标题和日程保留操作。</p>{desktop.lastError&&<p className="minor" role="status">桌面连接状态：{desktop.lastError}</p>}<label className="setting-row">桌面日历不透明度<input type="range" min="0.35" max="1" step="0.05" value={desktop.opacity} onChange={async e=>{const result=await window.desktop!.setOpacity(Number(e.target.value));if(result.ok)setDesktop(result);}}/></label><label className="setting-row">开机启动<input type="checkbox" checked={desktop.autostart} onChange={async e=>{const result=await window.desktop!.setAutostart(e.target.checked);if(result.ok)setDesktop(result);else toast(result.error);}}/></label></>:<p>当前是浏览器 / 手机界面。Windows 客户端提供贴在桌面、透明度和系统托盘功能。</p>}</div>
      <div className="settings-section timetable-settings"><h3><GraduationCap size={17}/>课表</h3><p>学期内每天的日期格下方按时段显示当天课程，没课的时段留空框；德国法定假日不显示课程。虚线表示不去现场或可调整的安排，鼠标停在课程上可看备注。</p><label className="setting-row">在桌面日期格里显示课表<input type="checkbox" checked={showTimetable} onChange={e=>setTimetableVisible(e.target.checked)}/></label>
        <div className="timetable-term"><label>学期<input value={timetable.name} maxLength={60} onChange={e=>saveTimetable({...timetable,name:e.target.value})}/></label><label>开始<input type="date" value={timetable.start} onChange={e=>saveTimetable({...timetable,start:e.target.value})}/></label><label>结束<input type="date" value={timetable.end} onChange={e=>saveTimetable({...timetable,end:e.target.value})}/></label></div>
        <div className="timetable-rows">{[...timetable.slots].sort((a,b)=>a.day-b.day||a.start.localeCompare(b.start)).map(slot=><div className="timetable-row" key={slot.id}><select aria-label="星期" value={slot.day} onChange={e=>updateSlot(slot.id,{day:Number(e.target.value)})}>{WEEK.map((w,i)=><option key={w} value={i+1}>周{w}</option>)}</select><input type="time" aria-label="上课时间" value={slot.start} onChange={e=>updateSlot(slot.id,{start:e.target.value})}/><input type="time" aria-label="下课时间" value={slot.end} onChange={e=>updateSlot(slot.id,{end:e.target.value})}/><input aria-label="课程名称" placeholder="课程" maxLength={80} value={slot.title} onChange={e=>updateSlot(slot.id,{title:e.target.value})}/><input aria-label="课程备注" placeholder="备注" maxLength={200} value={slot.note} onChange={e=>updateSlot(slot.id,{note:e.target.value})}/><input type="color" aria-label="课程颜色" value={slot.color} onChange={e=>updateSlot(slot.id,{color:e.target.value.toUpperCase()})}/><label className="dashed-toggle"><input type="checkbox" checked={slot.dashed} onChange={e=>updateSlot(slot.id,{dashed:e.target.checked})}/>虚线</label><button type="button" className="icon-button" aria-label="删除课程" title="删除课程" onClick={()=>saveTimetable({...timetable,slots:timetable.slots.filter(item=>item.id!==slot.id)})}><Trash2 size={15}/></button></div>)}</div>
        <div className="backup-buttons"><button className="secondary" onClick={()=>saveTimetable({...timetable,slots:[...timetable.slots,{id:`slot-${uid().slice(0,8)}`,day:1,start:'08:00',end:'09:30',title:'新课程',note:'',color:'#3B7DDD',dashed:false}]})}><Plus size={15}/>添加课程</button><button className="secondary" onClick={()=>{if(window.confirm('恢复为预设的 WS 2026/27 课表？当前课表修改会被替换。'))saveTimetable(DEFAULT_TIMETABLE);}}>恢复预设课表</button></div>
        <div className="timetable-breaks"><strong>停课期（这些日子不显示课程）</strong>{breaksOf(timetable).map((item,index)=><div className="timetable-row break-row" key={index}><input aria-label="停课期名称" placeholder="名称" maxLength={60} value={item.name} onChange={e=>saveTimetable({...timetable,breaks:breaksOf(timetable).map((value,i)=>i===index?{...value,name:e.target.value}:value)})}/><input type="date" aria-label="停课开始" value={item.start} onChange={e=>saveTimetable({...timetable,breaks:breaksOf(timetable).map((value,i)=>i===index?{...value,start:e.target.value}:value)})}/><input type="date" aria-label="停课结束" value={item.end} onChange={e=>saveTimetable({...timetable,breaks:breaksOf(timetable).map((value,i)=>i===index?{...value,end:e.target.value}:value)})}/><button type="button" className="icon-button" aria-label="删除停课期" onClick={()=>saveTimetable({...timetable,breaks:breaksOf(timetable).filter((_,i)=>i!==index)})}><Trash2 size={15}/></button></div>)}<button className="secondary" onClick={()=>saveTimetable({...timetable,breaks:[...breaksOf(timetable),{name:'停课',start:timetable.start,end:timetable.start}]})}><Plus size={15}/>添加停课期</button></div>
        <details><summary>课程图例（{timetable.courses.length}）</summary><div className="timetable-rows">{timetable.courses.map((course,index)=><div className="timetable-row legend-row" key={index}><input aria-label="课程代号" placeholder="代号" maxLength={20} value={course.code} onChange={e=>saveTimetable({...timetable,courses:timetable.courses.map((item,i)=>i===index?{...item,code:e.target.value}:item)})}/><input aria-label="课程全名" placeholder="全名" maxLength={120} value={course.name} onChange={e=>saveTimetable({...timetable,courses:timetable.courses.map((item,i)=>i===index?{...item,name:e.target.value}:item)})}/><input type="color" aria-label="图例颜色" value={course.color} onChange={e=>saveTimetable({...timetable,courses:timetable.courses.map((item,i)=>i===index?{...item,color:e.target.value.toUpperCase()}:item)})}/><button type="button" className="icon-button" aria-label="删除图例" onClick={()=>saveTimetable({...timetable,courses:timetable.courses.filter((_,i)=>i!==index)})}><Trash2 size={15}/></button></div>)}</div><button className="secondary" onClick={()=>saveTimetable({...timetable,courses:[...timetable.courses,{code:'',name:'',color:'#3B7DDD'}]})}><Plus size={15}/>添加图例</button></details></div>
      <div className="settings-section"><h3><CalendarDays size={17}/>假日显示</h3><p>日期格显示中国法定节假日的“休/班”和节日名称，以及德国全国性法定假日（蓝色“德”标记）。德国各州假日不同，选择所在州后会加上该州的假日。</p><label className="setting-row">德国联邦州<select aria-label="德国联邦州" value={germanState} onChange={e=>{const value=e.target.value as GermanState;setGermanState(value);try{localStorage.setItem('shiri-de-state',value);}catch{toast('联邦州设置未能保存');}}}>{GERMAN_STATES.map(([code,label])=><option key={code} value={code}>{code?`${label}（${code}）`:label}</option>)}</select></label></div>
      <div className="settings-section"><h3><Bell size={17}/>日程提醒</h3><label className="setting-row">开启日程提醒<input type="checkbox" checked={reminders} onChange={async e=>{const enabled=e.target.checked;if(!enabled||await enableNotifications()){setReminders(enabled);localStorage.setItem('shiri-reminders',String(enabled));}else toast('通知权限未开启，请在系统设置中允许通知');}}/></label><label className="setting-row">提醒时间<select aria-label="提醒时间" value={reminderLead} onChange={e=>{const minutes=Number(e.target.value);setReminderLead(minutes);try{localStorage.setItem('shiri-reminder-lead',String(minutes));}catch{toast('提醒时间未能保存');}}}>{REMINDER_LEADS.map(minutes=><option key={minutes} value={minutes}>{minutes?`提前 ${minutes} 分钟`:'开始时'}</option>)}</select></label><p>Windows 到点在屏幕右下角弹出提醒，可以点“10 分钟后再提醒”；关闭窗口后在托盘继续提醒；退出软件或电脑关机后不提醒。iPhone 原生版预排未来 30 天内最近 60 条提醒，打开应用时更新。网页版需要保持页面运行。</p></div>
      <div className="settings-section"><h3><Cloud size={17}/>电脑与 iPhone 同步 <span className="small-pill">可选</span></h3><p>使用托管 Supabase 项目，不需要自己购买服务器。当前{user?`登录为 ${user.email}`:'尚未登录账号，数据仅在这台设备'}。</p><details open={!cloudConfigured}><summary>连接云项目</summary><label>项目 URL<input type="url" placeholder="https://你的项目.supabase.co" value={cloudUrl} onChange={e=>setCloudUrl(e.target.value)}/></label><label>Publishable / anon key<input type="text" autoComplete="off" placeholder="项目公开客户端密钥" value={cloudKey} onChange={e=>setCloudKey(e.target.value)}/></label><p className="minor">先在云项目执行随软件提供的 cloud/schema.sql。这里只填写公开客户端密钥，不能填写 service_role 密钥。</p><button className="secondary" disabled={!!user} onClick={()=>{try{const next=createCloudClient(cloudUrl.trim(),cloudKey.trim());localStorage.setItem('shiri-cloud-url',cloudUrl.trim());localStorage.setItem('shiri-cloud-key',cloudKey.trim());setClient(next);setCloudConfigured(true);toast('云连接配置已保存，请登录后验证同步');}catch(e){toast(cloudErrorMessage(e));}}}>保存连接配置</button>{user&&<p className="minor">更换云项目之前请先退出账号。</p>}</details>
      {user?<><div className="account-row"><div className="avatar">我</div><div><strong>{user.email}</strong><small>{syncState}</small></div><button className="icon-button" title="立即同步" onClick={()=>void runSync()}><RefreshCw size={17}/></button><button className="icon-button" title="退出账号" onClick={async()=>{const result=await client?.auth.signOut({scope:'local'});if(result?.error)toast(cloudErrorMessage(result.error));else toast('已退出，切换回本机空间');}}><LogOut size={17}/></button></div><div className="account-actions"><button className="secondary" onClick={()=>void migrateLocal()}>将本机任务合并到此账号</button><button className="secondary" onClick={()=>setChangingPassword(value=>!value)}>{changingPassword?'取消修改':'修改密码'}</button></div>{changingPassword&&<form className="password-change" onSubmit={e=>{e.preventDefault();void saveNewPassword();}}><label>新密码<input type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="至少 8 位字符"/></label><label>确认新密码<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="再次输入新密码"/></label><button className="primary" type="submit" disabled={busy||newPassword.length<8||confirmPassword.length<8}>保存新密码</button><p className="minor">修改密码不会改变账号，也不会删除电脑、手机或云端日程。</p></form>}</>:<div className="auth-form"><label>邮箱<input type="email" autoComplete="username" value={email} onChange={e=>{setEmail(e.target.value);setResetOffer('');}} placeholder="you@example.com"/></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="至少 8 位字符"/></label><div><button className="primary" disabled={!client||busy||!email||password.length<8} onClick={()=>void auth('login')}>登录并同步</button><button className="secondary" disabled={!client||busy||!email||password.length<8} onClick={()=>void auth('signup')}>注册账号</button></div><button className="auth-link" type="button" disabled={!client||busy||!email} onClick={()=>void sendPasswordReset()}>忘记密码？发送重置邮件</button>{resetOffer&&<div className="reset-offer" role="alert"><p>该邮箱已被注册。是否发送重置密码邮件？</p><div><button className="primary" type="button" disabled={busy} onClick={()=>void sendPasswordReset(resetOffer)}>发送重置邮件</button><button className="secondary" type="button" onClick={()=>setResetOffer('')}>暂不</button></div></div>}</div>}</div>
      {user&&client&&<AiTokenSection client={client} userId={user.id} projectUrl={cloudUrl} toast={toast}/>}
      <div className="settings-section"><h3><Download size={17}/>数据备份</h3><p>导入采用合并方式。建议定期导出备份；不同账号拥有独立的本机空间。</p><div className="backup-buttons"><button className="secondary" onClick={downloadBackup}><Download size={15}/>导出 JSON 备份</button><button className="secondary" onClick={()=>importRef.current?.click()}><Upload size={15}/>导入并合并</button></div><input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e=>void importBackup(e.target.files?.[0])}/></div>
      <div className="settings-section"><h3><Smartphone size={17}/>iPhone 使用</h3><p>在 iPhone 的 Safari 打开 https://yuquanzhao9.github.io/yushi-app/ ，点分享 →「添加到主屏幕」，用同一账号登录即可同步；在“我的”里开启提醒后，到点由云端推送。</p></div>
      <div className="about">昱时 <span>0.1.1 · 把日子安排好</span></div>
    </div></section></div>}
    {message&&<div className="toast" role="status"><Check size={17}/>{message}{undo&&message==='任务已删除'&&<button onClick={()=>{updateTask({...undo,deletedAt:undefined},true);setUndo(null);toast('已恢复任务');}}>撤销</button>}<button aria-label="关闭提示" onClick={()=>setMessage('')}><X size={15}/></button></div>}
  </div>;
}

function withColor(task:Task,color:string|undefined):Task{const {color:_previous,...rest}=task;return color?{...rest,color}:rest;}

function ColorSwatches({value,fallback,onChange}:{value?:string;fallback?:string;onChange:(color:string|undefined)=>void}){
  return <div className="color-swatches" role="radiogroup" aria-label="颜色标签">
    <button type="button" role="radio" aria-checked={!value} aria-label="使用清单颜色" title="使用清单颜色" className={`swatch list-color ${!value?'selected':''}`} style={{'--swatch':fallback||'#8B97A8'} as React.CSSProperties} onClick={()=>onChange(undefined)}/>
    {TASK_COLORS.map(color=><button key={color} type="button" role="radio" aria-checked={value===color} aria-label={`颜色 ${color}`} title="设为此颜色" className={`swatch ${value===color?'selected':''}`} style={{'--swatch':color} as React.CSSProperties} onClick={()=>onChange(color)}/>)}
  </div>;
}

/** Shows every event that fits in the cell; "还有 N 项" only for the ones that really do not. */
function CellTasks({children,onMore}:{children:ReactNode;onMore:()=>void}){
  const box=useRef<HTMLDivElement>(null);
  const [hidden,setHidden]=useState(0);
  const measure=useCallback(()=>{
    const element=box.current;if(!element)return;
    const items=Array.from(element.querySelectorAll<HTMLElement>(':scope>.calendar-event'));
    const more=element.querySelector<HTMLElement>(':scope>.more-events');
    for(const item of items)item.style.display='';
    if(more)more.style.display='none';
    const top=element.getBoundingClientRect().top,limit=element.clientHeight;
    const bottom=(item:HTMLElement)=>item.getBoundingClientRect().bottom-top;
    let fit=items.length;
    if(items.length&&bottom(items[items.length-1])>limit+0.5){
      const reserve=(more?.offsetHeight||14)+3;
      fit=0;while(fit<items.length&&bottom(items[fit])<=limit-reserve)fit++;
    }
    items.forEach((item,index)=>{item.style.display=index<fit?'':'none';});
    if(more)more.style.display=fit<items.length?'':'none';
    setHidden(items.length-fit);
  },[]);
  useLayoutEffect(()=>{measure();});
  useEffect(()=>{const element=box.current;if(!element)return;const observer=new ResizeObserver(()=>measure());observer.observe(element);return()=>observer.disconnect();},[measure]);
  return <div className="cell-tasks" ref={box}>{children}<button className="more-events" style={{display:'none'}} onClick={e=>{e.stopPropagation();onMore();}}>还有 {hidden} 项安排</button></div>;
}

function TimetableStrip({timetable,today}:{timetable:Timetable;today:string}){
  const inTerm=today>=timetable.start&&today<=timetable.end;
  const weekday=(parseDate(today).getDay()+6)%7+1;
  const short=(key:string)=>`${Number(key.slice(5,7))}/${Number(key.slice(8,10))}`;
  return <section className="timetable-strip" aria-label="课表">
    {[1,2,3,4,5].map(day=>{const slots=slotsForWeekday(timetable,day);return <div key={day} className={`timetable-day ${inTerm&&day===weekday?'today':''}`}>{slots.map(slot=><div key={slot.id} className={`timetable-slot ${slot.dashed?'dashed':''}`} style={{'--slot-color':slot.color} as React.CSSProperties} title={`${slot.start}–${slot.end} ${slot.title}${slot.note?` · ${slot.note}`:''}`}><small>{slot.start}</small><span>{slot.title||'未命名'}</span></div>)}{!slots.length&&<em>无课</em>}</div>;})}
    <div className="timetable-legend"><strong>课表 · {timetable.name}<small>{short(timetable.start)}–{short(timetable.end)}{inTerm?'':today<timetable.start?' · 未开学':' · 已结束'}</small></strong>{timetable.courses.map((course,index)=><span key={index} title={course.name}><i style={{background:course.color}}/>{course.code} {course.name}</span>)}</div>
  </section>;
}

/** The day's classes by period at the bottom of a desktop date cell; empty periods stay visible. */
function CellClasses({rows}:{rows:{start:string;slots:DayClass[]}[]}){
  return <div className="cell-classes" aria-label="当天课表">{rows.map(row=><div key={row.start} className={`class-period ${row.slots.length?'':'empty'}`}><small>{row.start}</small>{row.slots.map(slot=><span key={slot.id} className={`class-chip ${slot.dashed?'dashed':''} ${slot.alert?'alert':''}`} style={{'--slot-color':slot.color} as React.CSSProperties} title={`${slot.start}–${slot.end} ${slot.title}${slot.alert?` · ⚠ ${slot.alert}`:''}${slot.note?` · ${slot.note}`:''}`}>{slot.alert&&<b aria-label={slot.alert}>⚠</b>}{slot.title||'未命名'}</span>)}</div>)}</div>;
}

function TimelineEvents({tasks,date,color,onEdit,onDrag,onMove}:{tasks:Task[];date:string;color:(t:Task)=>string;onEdit:(t:Task)=>void;onDrag:(e:DragEvent,t:Task,date:string)=>void;onMove:(t:Task,time:string)=>void}) {
  const drag=useRef<{id:string;y:number;moved:boolean}|null>(null);
  const skipClick=useRef(false);
  const sorted=[...tasks].sort((a,b)=>timeMinutes(a.time)-timeMinutes(b.time));
  const groups:Task[][]=[];let end=-1;
  for(const task of sorted){const start=timeMinutes(task.time);if(start>=end){groups.push([task]);end=start+task.duration;}else{groups[groups.length-1].push(task);end=Math.max(end,start+task.duration);}}
  return <>{groups.flatMap(group=>{const ends:number[]=[];const lanes=group.map(task=>{const start=timeMinutes(task.time);let lane=ends.findIndex(n=>n<=start);if(lane===-1)lane=ends.length;ends[lane]=start+task.duration;return{task,lane};});return lanes.map(({task,lane})=><button key={task.id}
    onPointerDown={e=>{if(e.button!==0)return;drag.current={id:task.id,y:e.clientY,moved:false};skipClick.current=false;e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const current=drag.current;if(!current||current.id!==task.id)return;const delta=e.clientY-current.y;if(Math.abs(delta)>8)current.moved=true;if(current.moved){e.currentTarget.style.transform=`translateY(${Math.round(delta/30)*30}px)`;e.currentTarget.style.zIndex='5';}}}
    onPointerUp={e=>{const current=drag.current;drag.current=null;e.currentTarget.style.transform='';e.currentTarget.style.zIndex='';if(current?.moved){skipClick.current=true;const mins=Math.max(0,Math.min(1440-task.duration,Math.round((timeMinutes(task.time)+e.clientY-current.y)/30)*30));onMove(task,minutesTime(mins));}}}
    onPointerCancel={e=>{drag.current=null;skipClick.current=true;e.currentTarget.style.transform='';e.currentTarget.style.zIndex='';}}
    onClick={()=>{if(skipClick.current){skipClick.current=false;return;}onEdit(task);}}
    className={`timeline-event ${isDone(task,date)?'done':''}`} style={{top:timeMinutes(task.time),height:Math.max(task.duration-3,24),left:`calc(${lane/ends.length*100}% + 5px)`,width:`calc(${100/ends.length}% - 12px)`,'--event-color':color(task)} as React.CSSProperties}><strong>{task.title}</strong><small>{task.time} – {minutesTime(Math.min(1440,timeMinutes(task.time)+task.duration))}{task.repeat!=='none'&&' · 重复'}</small>{task.notes&&task.duration>=60&&<span>{task.notes}</span>}</button>);})}</>;
}
export default App;







/** AI 同步令牌（与手机版“我的”里相同）：交给 Claude 技能或自动任务，只能读写日程。 */
function AiTokenSection({client,userId,projectUrl,toast}:{client:SupabaseClient;userId:string;projectUrl:string;toast:(text:string)=>void}){
  const [tokens,setTokens]=useState<AiTokenInfo[]|null>(null);
  const [fresh,setFresh]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(()=>{listAiTokens(client).then(setTokens).catch(e=>{setTokens([]);toast((e as Error).message);});},[client,toast]);
  useEffect(()=>{refresh();},[refresh]);
  const copy=async(text:string,what:string)=>{try{await navigator.clipboard.writeText(text);toast(`${what}已复制`);}catch{toast('复制失败，请手动选中复制');}};
  const when=(iso:string|null)=>iso?new Date(iso).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'从未';
  let url='';try{url=aiSyncUrl(projectUrl);}catch{/* 未配置云项目 */}
  return <div className="settings-section ai-token-section"><h3><Cloud size={17}/>AI 同步令牌</h3>
    <p>把令牌交给 Claude 的“昱时日程同步”技能，AI 对话里改的日程会自动进到电脑和手机。令牌只能改日程、不能登录；不用了随时撤销。</p>
    {fresh?<div className="ai-token-fresh"><p>新令牌只显示这一次，请现在复制保存：</p><code>{fresh}</code><div className="backup-buttons"><button className="primary" onClick={()=>void copy(fresh,'令牌')}>复制令牌</button><button className="secondary" onClick={()=>setFresh('')}>我已保存</button></div></div>
      :<div className="backup-buttons"><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{setFresh(await createAiToken(client,userId,'Claude'));refresh();}catch(e){toast((e as Error).message);}finally{setBusy(false);}}}>生成新令牌</button>{url&&<button className="secondary" onClick={()=>void copy(url,'接口地址')}>复制接口地址</button>}</div>}
    {tokens&&tokens.length>0&&<ul className="ai-token-list">{tokens.map(token=><li key={token.hash}><span><strong>{token.label}</strong><small>生成 {when(token.createdAt)} · 上次使用 {when(token.lastUsedAt)}</small></span><button className="secondary" onClick={async()=>{try{await revokeAiToken(client,token.hash);toast('已撤销');refresh();}catch(e){toast((e as Error).message);}}}>撤销</button></li>)}</ul>}
  </div>;
}
