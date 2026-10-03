import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, dateKey, defaultData, formatLunar, isDone, mergeTasks, monthDays, moveTask, occursOn, parseDate, tasksForDate, toggleTask, validateBackup } from '../src/core';
import type { Task } from '../src/types';

function task(patch: Partial<Task> = {}): Task {
  return { id: 'task-1', title: '测试任务', date: '2024-01-31', time: '09:00', duration: 60, listId: 'work', notes: '', priority: 'normal', repeat: 'none', completed: false, doneDates: [], createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', ...patch };
}

test('calendar date parsing is strict and leap-year aware', () => {
  assert.equal(dateKey(parseDate('2024-02-29')), '2024-02-29');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2023-03-01', -1), '2023-02-28');
  assert.throws(() => parseDate('2023-02-29'));
  assert.throws(() => parseDate('2024-04-31'));
  assert.throws(() => parseDate('2024-1-01'));
  assert.throws(() => parseDate('0000-01-01'));
});

test('date keys preserve local calendar fields and local DST boundaries', () => {
  const previousZone = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(dateKey(new Date('2024-03-10T01:30:00Z')), '2024-03-09');
    assert.equal(addDays('2024-03-09', 2), '2024-03-11');
    process.env.TZ = 'Asia/Tokyo';
    assert.equal(dateKey(new Date('2024-03-10T22:30:00Z')), '2024-03-11');
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test('month grids always contain 42 consecutive days and begin on Monday', () => {
  const days = monthDays(2024, 1);
  assert.equal(days.length, 42);
  assert.equal(days[0], '2024-01-29');
  assert.equal(days[41], '2024-03-10');
  assert.ok(days.includes('2024-02-29'));
  assert.equal(parseDate(days[0]).getDay(), 1);
  assert.throws(() => monthDays(2024, 12));
});

test('recurrences never occur before their start and skip missing month/year dates', () => {
  for (const repeat of ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const) {
    assert.equal(occursOn(task({ repeat }), '2023-01-31'), false);
  }
  assert.equal(occursOn(task({ repeat: 'monthly' }), '2024-02-29'), false);
  assert.equal(occursOn(task({ repeat: 'monthly' }), '2024-03-31'), true);
  const leap = task({ date: '2024-02-29', repeat: 'yearly' });
  assert.equal(occursOn(leap, '2025-02-28'), false);
  assert.equal(occursOn(leap, '2028-02-29'), true);
  assert.equal(occursOn(task({ repeat: 'weekly' }), '2024-02-07'), true);
  assert.equal(occursOn(task({ repeat: 'weekdays' }), '2024-02-03'), false);
  assert.equal(occursOn(task({ repeat: 'weekdays' }), '2024-02-05'), true);
  assert.equal(occursOn(task({ date: '', time: '' }), '2024-02-05'), false);
});

test('completing a recurrence toggles only that occurrence without mutation', () => {
  const original = task({ repeat: 'daily' });
  const complete = toggleTask(original, '2024-02-01');
  assert.equal(isDone(complete, '2024-02-01'), true);
  assert.equal(isDone(complete, '2024-02-02'), false);
  assert.equal(complete.completed, false);
  assert.deepEqual(original.doneDates, []);
  assert.deepEqual(toggleTask(complete, '2024-02-01').doneDates, []);
  assert.equal(toggleTask(original, '2023-01-01'), original);
  assert.equal(toggleTask(task(), '2024-01-31').completed, true);
});

test('series move shifts the start and completed occurrences while inbox moves clear recurrence', () => {
  const original = task({ repeat: 'weekly', doneDates: ['2024-02-07'] });
  const moved = moveTask(original, '2024-02-07', '2024-02-08', '10:30');
  assert.equal(moved.date, '2024-02-01');
  assert.equal(moved.time, '10:30');
  assert.deepEqual(moved.doneDates, ['2024-02-08']);
  assert.equal(occursOn(moved, '2024-02-15'), true);
  assert.equal(original.date, '2024-01-31');
  const inbox = moveTask(moved, '2024-02-08', '');
  assert.equal(inbox.repeat, 'none');
  assert.equal(inbox.time, '');
  assert.throws(() => moveTask(original, original.date, '2024-02-02', '25:00'));
});

test('merge converges regardless of order and retains deletion tombstones', () => {
  const original = task();
  const edited = task({ title: '已编辑', updatedAt: '2024-02-01T00:00:00.000Z' });
  const deleted = task({ deletedAt: '2024-03-01T00:00:00.000Z', updatedAt: '2024-03-01T00:00:00.000Z' });
  assert.deepEqual(mergeTasks([original], [edited]), [edited]);
  assert.deepEqual(mergeTasks([deleted], [edited]), [deleted]);
  assert.deepEqual(mergeTasks([edited], [deleted]), [deleted]);
  const simultaneous = task({ title: '同时编辑', updatedAt: deleted.updatedAt });
  assert.deepEqual(mergeTasks([simultaneous], [deleted]), [deleted]);
  const conflict = { ...edited, title: '其他设备编辑' };
  assert.deepEqual(mergeTasks([edited], [conflict]), mergeTasks([conflict], [edited]));
  assert.deepEqual(tasksForDate([deleted], '2024-01-31'), []);
});

test('backup validation copies good input and rejects corrupted or hostile input', () => {
  const backup = { ...defaultData(), tasks: [task()] };
  const validated = validateBackup(backup);
  assert.deepEqual(validated, backup);
  assert.notEqual(validated.tasks[0], backup.tasks[0]);
  assert.notEqual(validated.tasks[0].doneDates, backup.tasks[0].doneDates);
  for (const patch of [
    { date: '2024-02-30' }, { time: '24:00' }, { duration: NaN }, { duration: -1 },
    { repeat: 'sometimes' }, { priority: 'urgent' }, { completed: 'true' },
    { listId: 'missing' }, { title: 'x'.repeat(501) }, { notes: 'x'.repeat(20_001) },
    { createdAt: 'not-a-date' }, { updatedAt: '2023-01-01T00:00:00.000Z' },
    { doneDates: ['2024-02-01', '2024-02-01'] }, { dangerous: true },
    { date: '', time: '', repeat: 'daily' }, { id: '__proto__' },
  ]) assert.throws(() => validateBackup({ ...backup, tasks: [{ ...task(), ...patch }] }), JSON.stringify(patch));
  assert.throws(() => validateBackup({ ...backup, tasks: [task(), task()] }));
  assert.throws(() => validateBackup({ ...backup, tasks: Array(20_001).fill(task()) }));
  assert.throws(() => validateBackup({ ...backup, lists: [{ id: 'work', name: '工作', color: 'red' }] }));
  assert.throws(() => validateBackup(JSON.parse('{"version":1,"lists":[],"tasks":[],"__proto__":{"polluted":true}}')));
  assert.throws(() => validateBackup(Object.create({ version: 1 })));
  const hostile = { ...backup };
  Object.defineProperty(hostile, 'tasks', { enumerable: true, get() { throw new Error('getter executed'); } });
  assert.throws(() => validateBackup(hostile), /不允许访问器/);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('lunar dates format through the Chinese calendar', () => {
  assert.match(formatLunar('2024-02-10'), /正月|一月/);
  assert.equal(formatLunar('2024-02-11'), '初二');
});
