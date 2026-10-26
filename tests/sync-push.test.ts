import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsToPush, journalToPush, reflectionsToPush } from '../src/live-sync.ts';
import { tasksToPush } from '../src/cloud.ts';
import { newerItem } from '../src/weekly.ts';
import { occursOn } from '../src/core.ts';
import { sameContent } from '../src/stable-json.ts';
import type { GoalMark, Task } from '../src/types.ts';

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, title: id, date: '2026-10-26', time: '09:00', duration: 60, listId: 'work', notes: '', priority: 'normal',
  repeat: 'none', completed: false, doneDates: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...patch,
});

test('字段顺序不同但内容相同算同一份', () => {
  assert.equal(sameContent({ a: 1, b: { c: 2, d: [1, 2] } }, { b: { d: [1, 2], c: 2 }, a: 1 }), true);
  assert.equal(sameContent({ a: 1 }, { a: 2 }), false);
  assert.equal(sameContent({ a: 1, b: undefined }, { a: 1 }), true);
});

test('日程同步只上传和云端不一样的', () => {
  const remote = [task('a'), task('b'), task('c', { title: '云端改过', updatedAt: '2026-10-02T00:00:00.000Z' })];
  // 云端的字段顺序和本机不同，不该因此重传。
  const reordered = remote.map(item => Object.fromEntries(Object.entries(item).reverse()) as Task);
  const local = [task('a'), task('b', { title: '本机改过', updatedAt: '2026-10-03T00:00:00.000Z' }), task('c'), task('d')];
  assert.deepEqual(tasksToPush(local, reordered).map(item => item.id), ['b', 'd']);
  assert.deepEqual(tasksToPush(remote, reordered), []);
});

test('周次任务：只传本机更新的，云端字段顺序不同不重传', () => {
  const mark: GoalMark = { id: 'plan_g_2026-10-26_1', goalId: 'g', date: '2026-10-27', done: false, time: '10:00', auto: true, createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z' };
  const fromCloud = Object.fromEntries(Object.entries(mark).sort(([a], [b]) => a.length - b.length || a.localeCompare(b))) as GoalMark;
  assert.deepEqual(itemsToPush([mark], [fromCloud], newerItem), []);
  const later = { ...mark, done: true, updatedAt: '2026-10-27T09:00:00.000Z' };
  assert.deepEqual(itemsToPush([later], [mark], newerItem), [later]);
  assert.deepEqual(itemsToPush([mark], [later], newerItem), []);
});

test('周次任务：时间戳相同内容不同，胜出的一方推后 1 毫秒再传，两台设备最后一致', () => {
  const a: GoalMark = { id: 'plan_g_2026-10-26_1', goalId: 'g', date: '2026-10-27', done: false, time: '10:00', auto: true, createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z' };
  const b: GoalMark = { ...a, time: '14:00' };
  const winner = newerItem(a, b);
  const loser = winner === a ? b : a;
  const pushed = itemsToPush([winner], [loser], newerItem);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].time, winner.time);
  assert.equal(pushed[0].updatedAt, '2026-10-26T00:00:00.001Z');
  // 另一台设备拿到推后的版本后，按规则会换成它，不再上传自己的。
  assert.equal(newerItem(loser, pushed[0]), pushed[0]);
  assert.deepEqual(itemsToPush([loser], [winner], newerItem), []);
});

test('复盘和日记的上传判断也按内容比', () => {
  const reflection = { id: 'r1', date: '2026-10-26', text: '示例', createdAt: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z' };
  assert.deepEqual(reflectionsToPush([reflection], [{ updatedAt: reflection.updatedAt, text: '示例', id: 'r1', createdAt: reflection.createdAt, date: reflection.date }]), []);
  const entry = { date: '2026-10-26', text: '示例', updatedAt: '2026-10-26T08:00:00.000Z' };
  assert.deepEqual(journalToPush([entry], [{ updatedAt: entry.updatedAt, text: entry.text, date: entry.date }]), []);
});

test('不重复的日程只在当天出现', () => {
  const once = task('x');
  assert.equal(occursOn(once, '2026-10-26'), true);
  assert.equal(occursOn(once, '2026-10-27'), false);
  assert.equal(occursOn(once, '2026-10-25'), false);
  assert.equal(occursOn({ ...once, deletedAt: '2026-10-02T00:00:00.000Z' }, '2026-10-26'), false);
});
