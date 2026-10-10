import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Task } from './types';
import { addDays, dateKey, tasksForDate, isDone } from './core';

export interface DesktopSettings { mode: 'window'|'desktop'|'fullscreen'; surface?: 'desktop'|'app'|'editor'; opacity: number; autostart: boolean; desktopAvailable: boolean; widgetSpan: 'week'|'twoWeeks'|'month'; widgetSide: 'left'|'right'; lastError?: string; }
export interface CellEditorRequest { taskId:string; date:string; time:string; keepDraft:boolean; seq:number; }
declare global { interface Window { desktop?: {
  getSettings(): Promise<DesktopSettings>;
  setMode(mode: DesktopSettings['mode']): Promise<DesktopSettings & {ok:boolean;error?:string}>;
  setWidgetSpan(span: DesktopSettings['widgetSpan']): Promise<DesktopSettings & {ok:boolean;error?:string}>;
  setWidgetSide(side: DesktopSettings['widgetSide']): Promise<DesktopSettings & {ok:boolean;error?:string}>;
  setCalendarInteractive(interactive:boolean):Promise<{ok:boolean;error?:string}>;
  passDesktopContextMenu():Promise<{ok:boolean;error?:string}>;
  openEditor(request:{taskId?:string;date:string;time?:string}):Promise<{ok:boolean;error?:string}>;
  openInlineEditor(request:{taskId?:string;date:string;time?:string;rect:{x:number;y:number;width:number;height:number}}):Promise<{ok:boolean;error?:string}>;
  closeEditor(seq?:number):Promise<{ok:boolean;error?:string}>;
  cellEditorReady():Promise<{ok:boolean;error?:string}>;
  resizeCellEditor(expanded:boolean):Promise<{ok:boolean;error?:string}>;
  setOpacity(value:number): Promise<any>; setAutostart(value:boolean): Promise<any>;
  syncReminders(items:{id:string;title:string;body:string;at:number}[]): Promise<any>;
  notify(item:{title:string;body:string}): Promise<any>; showWindow():Promise<any>;
  onModeChanged(cb:(s:DesktopSettings)=>void):()=>void;
  onCellEditorOpen(cb:(request:CellEditorRequest)=>void):()=>void;
  onCellEditorBlur(cb:()=>void):()=>void;
  onPointerReset(cb:()=>void):()=>void;
} } }
export const isNative = Capacitor.isNativePlatform();
const pendingWrites = new Map<string, Promise<void>>();
export async function readSaved(key:string) {
  // Account switches may read a space immediately after its final async save.
  await pendingWrites.get(key);
  return isNative ? (await Preferences.get({key})).value : localStorage.getItem(key);
}
export async function writeSaved(key:string,value:string) {
  if(!isNative) { localStorage.setItem(key,value); return; }
  // Preferences writes are async: older snapshots must never finish after newer ones.
  const previous=pendingWrites.get(key)??Promise.resolve();
  const next=previous.catch(()=>{}).then(()=>Preferences.set({key,value}));
  pendingWrites.set(key,next);
  try { await next; }
  finally { if(pendingWrites.get(key)===next)pendingWrites.delete(key); }
}
// 默认每个日程提前 2 小时、1 小时、30 分钟、10 分钟各提醒一次。
export const MULTI_REMINDER_LEADS=[120,60,30,10];
export function leadLabel(minutes:number) {
  return minutes>=60&&minutes%60===0?`${minutes/60} 小时`:`${minutes} 分钟`;
}
export function reminderQueue(tasks:Task[],days=30,now=Date.now(),leadMinutes:number|number[]=0) {
  if(!Number.isInteger(days)||days<1||days>366||!Number.isFinite(now))throw new Error('提醒时间范围无效');
  const leads=[...new Set(Array.isArray(leadMinutes)?leadMinutes:[leadMinutes])];
  if(!leads.length||leads.some(lead=>!Number.isInteger(lead)||lead<0||lead>1440))throw new Error('提前提醒时间无效');
  const start=dateKey(new Date(now)), result:{id:string;title:string;body:string;at:number}[]=[];
  for(let i=0;i<days;i++) {
    const date=addDays(start,i);
    for(const task of tasksForDate(tasks,date)) {
      if(!task.time || isDone(task,date)) continue;
      const begin=new Date(`${date}T${task.time}:00`).getTime();
      for(const lead of leads) {
        const at=begin-lead*60_000;
        // 每个提前量是单独的一条提醒，标识里带上提前量以免互相覆盖。
        if(at>now) result.push({id:`${task.id}:${date}:${task.time}${lead&&leads.length>1?`:-${lead}`:''}`,title:task.title.slice(0,160),body:lead?`${leadLabel(lead)}后开始 · ${date} ${task.time}`:`${date} ${task.time} · 昱时`,at});
      }
    }
  }
  return result.sort((a,b)=>a.at-b.at).slice(0,2000);
}
export async function enableNotifications() {
  if(window.desktop) return true;
  if(isNative) return (await LocalNotifications.requestPermissions()).display==='granted';
  if(!('Notification' in window)) return false;
  return (await Notification.requestPermission())==='granted';
}
let scheduleRevision=0;
let pendingSchedule:Promise<void>=Promise.resolve();
export function scheduleNative(tasks:Task[],enabled:boolean,leadMinutes:number|number[]=0):Promise<void> {
  const revision=++scheduleRevision;
  const next=pendingSchedule.catch(()=>{}).then(async()=>{
    if(revision!==scheduleRevision)return;
    const queue=enabled?reminderQueue(tasks,30,Date.now(),leadMinutes):[];
    if(window.desktop) { const result=await window.desktop.syncReminders(queue); if(!result.ok) throw new Error(result.error); return; }
    if(isNative) {
      const pending=await LocalNotifications.getPending();
      if(revision!==scheduleRevision)return;
      if(pending.notifications.length) await LocalNotifications.cancel({notifications:pending.notifications});
      if(!queue.length || revision!==scheduleRevision || (await LocalNotifications.checkPermissions()).display!=='granted') return;
      if(revision!==scheduleRevision)return;
      await LocalNotifications.schedule({notifications:queue.slice(0,60).map((n,index)=>({id:index+1,title:n.title,body:n.body,schedule:{at:new Date(n.at)},sound:'default'}))});
    }
  });
  pendingSchedule=next;
  return next;
}
