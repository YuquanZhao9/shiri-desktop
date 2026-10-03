import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultData, occursOn, validateBackup } from '../src/core';
import { mergeWindowData } from '../src/window-data';
import type { AppData, Task, TaskList } from '../src/types';

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id, title: `任务 ${id}`, date: '2026-09-14', time: '09:00', duration: 60,
    listId: 'work', notes: '', priority: 'normal', repeat: 'none', completed: false,
    doneDates: [], createdAt: '2026-09-14T07:00:00.000Z',
    updatedAt: '2026-09-14T07:00:00.000Z', ...patch,
  };
}

function data(tasks: Task[], lists: TaskList[] = defaultData().lists): AppData {
  return { version: 1, tasks, lists };
}

test('independent desktop and management additions both survive an interleaved save', () => {
  const original = task('shared');
  const desktop = data([original, task('desktop-add')]);
  const management = data([original, task('management-add')]);
  const desktopResult = mergeWindowData(desktop, management);
  const managementResult = mergeWindowData(management, desktop);
  assert.deepEqual(desktopResult, managementResult);
  assert.deepEqual(desktopResult.tasks.map(item => item.id), ['desktop-add', 'management-add', 'shared']);
  // Simulate a delayed original storage event after both windows have converged.
  assert.equal(mergeWindowData(desktopResult, data([original])), desktopResult);
  assert.deepEqual(desktop.tasks.map(item => item.id), ['shared', 'desktop-add']);
  assert.deepEqual(management.tasks.map(item => item.id), ['shared', 'management-add']);
});

test('a stale window snapshot cannot resurrect a newer deleted task', () => {
  const original = task('deleted');
  const tombstone = task('deleted', {
    updatedAt: '2026-09-14T07:01:00.000Z', deletedAt: '2026-09-14T07:01:00.000Z',
  });
  const first = mergeWindowData(data([original]), data([tombstone]));
  assert.equal(first.tasks.length, 1, 'Deletion markers remain available to other windows');
  assert.deepEqual(first.tasks[0], tombstone);
  assert.equal(occursOn(first.tasks[0], '2026-09-14'), false);
  assert.equal(mergeWindowData(first, data([original])), first);
  assert.deepEqual(mergeWindowData(data([tombstone]), data([original])), first);
  const tiedEdit = task('deleted', { title: '同时保存', updatedAt: tombstone.updatedAt });
  assert.deepEqual(mergeWindowData(data([tiedEdit]), data([tombstone])).tasks[0], tombstone);
});

test('equal-revision edits converge regardless of window order and preserve an unchanged reference', () => {
  const desktop = data([task('same', { title: '桌面编辑 🗓️', notes: '备注一' })]);
  const management = data([task('same', { title: '管理窗口编辑', notes: '备注二' })]);
  const fromDesktop = mergeWindowData(desktop, management);
  const fromManagement = mergeWindowData(management, desktop);
  assert.deepEqual(fromDesktop, fromManagement);
  assert.equal(mergeWindowData(fromDesktop, fromManagement), fromDesktop);
  assert.equal(mergeWindowData(fromDesktop, fromDesktop), fromDesktop);
  assert.equal(mergeWindowData(fromDesktop, desktop), fromDesktop);
  assert.equal(mergeWindowData(fromDesktop, management), fromDesktop);
});

test('several out-of-order storage events converge associatively without event ping-pong', () => {
  const first = data([task('a'), task('conflict', { title: '第一版' })]);
  const second = data([task('b'), task('conflict', { title: '第二版', updatedAt: '2026-09-14T07:02:00.000Z' })]);
  const third = data([task('c'), task('a', {
    updatedAt: '2026-09-14T07:03:00.000Z', deletedAt: '2026-09-14T07:03:00.000Z',
  })]);
  const left = mergeWindowData(mergeWindowData(first, second), third);
  const right = mergeWindowData(first, mergeWindowData(second, third));
  const reordered = mergeWindowData(third, mergeWindowData(second, first));
  assert.deepEqual(left, right);
  assert.deepEqual(left, reordered);
  assert.equal(left.tasks.find(item => item.id === 'conflict')?.title, '第二版');
  assert.ok(left.tasks.find(item => item.id === 'a')?.deletedAt);
  for (const stale of [first, second, third]) assert.equal(mergeWindowData(left, stale), left);
});

test('imported custom lists survive cross-window task merges and remain valid on reload', () => {
  const desktop = data([task('a')]);
  const custom = { id: 'travel', name: '旅行', color: '#557799' };
  const management = data([task('b', { listId: 'travel' })], [...defaultData().lists, custom]);
  const merged = mergeWindowData(desktop, management);
  assert.deepEqual(merged, mergeWindowData(management, desktop));
  assert.equal(merged.lists.find(list => list.id === 'travel')?.name, '旅行');
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(merged))), merged);
  assert.equal(mergeWindowData(merged, management), merged);
});

test('conflicting imported list descriptions resolve consistently in either direction', () => {
  const first = data([], [{ id: 'work', name: '工作', color: '#557799' }]);
  const second = data([], [{ id: 'work', name: '团队', color: '#8899AA' }]);
  const merged = mergeWindowData(first, second);
  assert.deepEqual(merged, mergeWindowData(second, first));
  assert.equal(merged.lists.length, 1);
  assert.equal(mergeWindowData(merged, second), merged);
});
