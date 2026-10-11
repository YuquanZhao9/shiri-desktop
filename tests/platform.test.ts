import assert from 'node:assert/strict';
import test from 'node:test';
import { reminderQueue, scheduleNative, MULTI_REMINDER_LEADS } from '../src/platform';
import { addDays, dateKey } from '../src/core';
import type { Task } from '../src/types';

const now=new Date(2026,8,14,8,0,0).getTime();
const today=dateKey(new Date(now));
function task(patch:Partial<Task>={}):Task {
  return {id:'test',title:'提醒测试',date:today,time:'09:00',duration:30,listId:'work',notes:'',priority:'normal',repeat:'none',completed:false,doneDates:[],createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',...patch};
}

test('queue excludes past, all-day, deleted and individually completed reminders',()=>{
  const queue=reminderQueue([
    task({id:'daily',repeat:'daily',doneDates:[addDays(today,1)]}),
    task({id:'past',time:'07:00'}),task({id:'all-day',time:''}),
    task({id:'done',completed:true}),task({id:'deleted',deletedAt:'2026-09-14T00:00:00.000Z'}),
  ],3,now);
  assert.equal(queue.length,2);
  assert.equal(queue[0].id,`daily:${today}:09:00`);
  assert.equal(queue[1].id,`daily:${addDays(today,2)}:09:00`);
  assert.ok(queue[0].at<queue[1].at);
});

test('queue has an explicit rolling horizon and desktop-compatible title size',()=>{
  const queue=reminderQueue([task({repeat:'daily',title:'长'.repeat(200)})],30,now);
  assert.equal(queue.length,30);
  assert.equal(queue[0].title.length,160);
  assert.equal(queue.at(-1)?.id,`test:${addDays(today,29)}:09:00`);
  assert.throws(()=>reminderQueue([],Infinity,now));
});

test('overlapping schedule calls finish in order and disabling wins last',async()=>{
  const globalWindow=globalThis as unknown as {window:Window};
  const previousWindow=globalWindow.window;
  let release:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;});
  const calls:number[]=[];
  globalWindow.window={desktop:{async syncReminders(items:unknown[]){calls.push(items.length);if(calls.length===1)await held;return {ok:true};}}} as Window;
  try {
    const tomorrow=addDays(dateKey(new Date()),1);
    const first=scheduleNative([task({date:tomorrow})],true);
    await new Promise(resolve=>setTimeout(resolve,0));
    const second=scheduleNative([],false);
    release();
    await Promise.all([first,second]);
    assert.deepEqual(calls,[1,0]);
  } finally {globalWindow.window=previousWindow;}
});

test('reminders can fire a chosen number of minutes before the start',()=>{
  const queue=reminderQueue([task({time:'09:00'})],1,now,10);
  assert.equal(queue.length,1);
  assert.equal(queue[0].at,new Date(`${today}T08:50:00`).getTime());
  assert.match(queue[0].body,/^10 分钟后开始/);
  assert.equal(reminderQueue([task({time:'08:05'})],1,now,10).length,0,'a lead time already in the past is skipped');
  assert.throws(()=>reminderQueue([],30,now,-5));
});

test('default multi-lead schedule reminds 2 h, 1 h, 30 min and 10 min before each event',()=>{
  const queue=reminderQueue([task({time:'12:00'})],1,now,MULTI_REMINDER_LEADS);
  assert.deepEqual(queue.map(item=>item.at),['10:00','11:00','11:30','11:50'].map(time=>new Date(`${today}T${time}:00`).getTime()));
  assert.equal(new Set(queue.map(item=>item.id)).size,4,'each lead time is a separate reminder');
  assert.match(queue[0].body,/^2 小时后开始/);
  assert.match(queue[2].body,/^30 分钟后开始/);
  assert.deepEqual(reminderQueue([task({time:'09:00'})],1,now,MULTI_REMINDER_LEADS).map(item=>item.body.split(' · ')[0]),['30 分钟后开始','10 分钟后开始'],'leads already in the past are skipped');
});
