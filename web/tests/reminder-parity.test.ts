import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../src/types.ts';
import { MULTI_REMINDER_LEADS, reminderQueue } from '../../src/platform.ts';
import { dueReminders, MULTI_LEADS } from '../supabase/functions/shiri-reminders/schedule.ts';

// 电脑版（本机排队）和 iPhone 推送（云端每 5 分钟跑一次）要在同一时刻提醒同一件事。
// 这里把云端按 5 分钟一步跑过三天，和电脑版的提醒队列逐条比对，并专门覆盖夏令时切换的那天。

const ZONE = 'Europe/Berlin';
const t = (patch: Partial<Task>): Task => ({ id: 'x', title: '演示', date: '2026-10-24', time: '09:00', duration: 60, listId: 'work', notes: '', priority: 'normal', repeat: 'none', completed: false, doneDates: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...patch });

function cloudSweep(tasks: Task[], from: number, to: number): Set<string> {
  const fired = new Set<string>();
  for (let now = from; now <= to; now += 5 * 60_000) {
    for (const due of dueReminders(tasks, ZONE, MULTI_LEADS, now, 10 * 60_000, 30_000)) {
      const m = /^(.+):(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2}):(\d+)$/.exec(due.occurrence)!;
      fired.add(`${m[1]}|${m[2]}|${m[3]}|${m[4]}`);
    }
  }
  return fired;
}

function desktopQueue(tasks: Task[], from: number, to: number): Set<string> {
  const previous = process.env.TZ;
  process.env.TZ = ZONE;
  try {
    return new Set(reminderQueue(tasks, 5, from, MULTI_REMINDER_LEADS).filter((r) => r.at <= to).map((r) => {
      const m = /^(.+):(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2}):-(\d+)$/.exec(r.id)!;
      return `${m[1]}|${m[2]}|${m[3]}|${m[4]}`;
    }));
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}

test('两端默认提前量都是 2 小时、1 小时、10 分钟', () => {
  assert.deepEqual(MULTI_REMINDER_LEADS, [120, 60, 10]);
  assert.deepEqual(MULTI_LEADS, [120, 60, 10]);
});

test('电脑版和云端推送在三天里（含 10/25 夏令时结束）提醒完全相同的事件', () => {
  const tasks = [
    t({ id: 'daily', repeat: 'daily', time: '09:00', date: '2026-10-20', doneDates: ['2026-10-25'] }),
    t({ id: 'early', date: '2026-10-25', time: '03:30' }), // 夏令时 03:00 → 02:00 这天的凌晨
    t({ id: 'evening', date: '2026-10-26', time: '18:15' }),
    t({ id: 'done', date: '2026-10-26', time: '12:00', completed: true }),
    t({ id: 'allday', date: '2026-10-26', time: '' }),
    t({ id: 'gone', date: '2026-10-26', time: '11:00', deletedAt: '2026-10-02T00:00:00.000Z' }),
  ];
  const from = Date.parse('2026-10-24T22:00:00Z'), to = Date.parse('2026-10-27T22:00:00Z');
  const desktop = desktopQueue(tasks, from, to), cloud = cloudSweep(tasks, from, to);
  assert.ok(desktop.size >= 12, `只排出了 ${desktop.size} 条`);
  assert.deepEqual([...cloud].sort(), [...desktop].sort());
  // 已完成、全天、已删除、当天打了勾的重复日程都不提醒
  for (const id of ['done', 'allday', 'gone']) assert.ok(![...desktop].some((k) => k.startsWith(`${id}|`)), id);
  assert.ok(![...desktop].some((k) => k.startsWith('daily|2026-10-25|')));
  // 每个要提醒的事件恰好三条
  assert.equal([...desktop].filter((k) => k.startsWith('evening|')).length, 3);
});

test('夏令时结束那天 09:00 的日程：2 小时提醒在当地 07:00（UTC 06:00）', () => {
  const tasks = [t({ id: 'dst', date: '2026-10-25', time: '09:00' })];
  const due = dueReminders(tasks, ZONE, MULTI_LEADS, Date.parse('2026-10-25T06:00:00Z'));
  assert.equal(due.length, 1);
  assert.match(due[0].occurrence, /:120$/);
  assert.equal(due[0].at, Date.parse('2026-10-25T08:00:00Z'));
});
