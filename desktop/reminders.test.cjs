'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ReminderStore, normalizeReminders } = require('./reminders.cjs');

const NOW = Date.now();
const DAY = 86_400_000;
function withStore(action) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiri-reminder-test-'));
  const file = path.join(directory, 'reminders.json');
  try { action(new ReminderStore(file), file); }
  finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('shiri-reminder-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

test('delivery survives a process restart without duplicate notifications', () => withStore((store, file) => {
  store.sync([{ id: 'weekly-task:2026-09-14', title: '周会', body: '会议室', at: NOW - 1000 }], NOW);
  assert.equal(store.takeDue(NOW).length, 1);
  const restarted = new ReminderStore(file);
  assert.deepEqual(restarted.takeDue(NOW + 1000), []);
}));

test('sync removes cancelled tasks and a rescheduled occurrence can notify again', () => withStore((store, file) => {
  store.sync([{ id: 'task', title: '任务', at: NOW - 1000 }], NOW);
  assert.equal(store.takeDue(NOW).length, 1);
  store.sync([], NOW);
  assert.equal(new ReminderStore(file).items.length, 0);
  store.sync([{ id: 'task', title: '任务', at: NOW + 1000 }], NOW);
  assert.equal(store.takeDue(NOW + 2000).length, 1);
}));

test('wake-up catch-up is bounded and ignores reminders older than 24 hours', () => withStore((store) => {
  const values = Array.from({ length: 8 }, (_, index) => ({ id: `task-${index}`, title: '待办', at: NOW - 120_000 + index }));
  values.push({ id: 'old', title: '旧任务', at: NOW - DAY - 1 });
  store.sync(values, NOW);
  const first = store.takeDue(NOW);
  assert.equal(first.length, 5);
  assert.ok(first.every((item) => item.late && item.id !== 'old'));
  assert.equal(store.takeDue(NOW + 15_000).length, 3);
  assert.equal(store.takeDue(NOW + 30_000).length, 0);
}));

test('invalid IPC schedules are rejected without replacing the valid saved queue', () => withStore((store, file) => {
  store.sync([{ id: 'valid', title: '保留', at: NOW + 1000 }], NOW);
  assert.throws(() => store.sync([{ id: 'invalid', title: '失败', at: NaN }], NOW));
  assert.equal(new ReminderStore(file).items[0].id, 'valid');
  assert.throws(() => normalizeReminders(Array.from({ length: 2001 }, () => ({})), NOW));
  assert.throws(() => normalizeReminders([{ id: 'x', title: '标题', body: {}, at: NOW }], NOW));
  assert.throws(() => normalizeReminders([{ id: 'x', title: '标题', at: NOW + 10 * 366 * DAY }], NOW));
}));

test('duplicate occurrence keys coalesce and ISO times are accepted', () => {
  const input = { id: 'same', title: '重复', at: new Date(NOW).toISOString() };
  const result = normalizeReminders([input, input], NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].at, NOW);
});

test('malformed disk files do not prevent a fresh schedule from being saved', () => withStore((_store, file) => {
  fs.writeFileSync(file, '{not JSON');
  const store = new ReminderStore(file);
  assert.deepEqual(store.items, []);
  store.sync([{ id: 'new', title: '新任务', at: NOW + 1000 }], NOW);
  assert.equal(new ReminderStore(file).items.length, 1);
}));

test('snoozed reminders fire once later, survive sync and restarts', () => withStore((store, file) => {
  store.sync([{ id: 'meeting:2026-09-28:09:00', title: '周会', body: '10 分钟后开始', at: NOW - 1000 }], NOW);
  const [shown] = store.takeDue(NOW);
  store.snooze(shown, NOW + 10 * 60_000, NOW);
  store.sync([], NOW);
  const restarted = new ReminderStore(file);
  assert.deepEqual(restarted.takeDue(NOW + 5 * 60_000), []);
  const again = restarted.takeDue(NOW + 10 * 60_000);
  assert.equal(again.length, 1);
  assert.equal(again[0].title, '周会');
  assert.equal(restarted.snoozed.length, 0);
  assert.deepEqual(new ReminderStore(file).takeDue(NOW + 20 * 60_000), []);
  assert.throws(() => restarted.snooze(shown, NOW - 1, NOW));
}));
