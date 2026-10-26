import assert from 'node:assert/strict';
import test from 'node:test';
import { cellLayout, classesForDate, dayAgenda, DEFAULT_TIMETABLE, doneToBottom } from '../src/timetable';
import { addMark, goalWeeks, saveGoal } from '../src/weekly';
import { isDone } from '../src/core';
import type { Task } from '../src/types';

// 日期格里的排版：时间重叠的并排、完成的沉底，以及周次任务每周一清零。

const task = (id: string, time: string, duration = 60, patch: Partial<Task> = {}): Task => ({ id, title: id, date: '2026-10-26', time, duration, listId: 'work', notes: '', priority: 'normal', repeat: 'none', completed: false, doneDates: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...patch });
const ids = (placed: { item: any }[]) => placed.map((p) => p.item.task?.id ?? p.item.slot?.title);

test('时间重叠的日程并排成几列，首尾相接的不算重叠', () => {
  const { timed, untimed } = cellLayout(dayAgenda([task('a', '10:00'), task('b', '10:30'), task('c', '11:00'), task('d', '14:00'), task('e', '')], null));
  assert.deepEqual(ids(timed), ['a', 'b', 'c', 'd']);
  const by = new Map(timed.map((p) => [p.item.kind === 'task' ? p.item.task.id : '', p]));
  assert.equal(by.get('a')!.lanes, 2);
  assert.equal(by.get('b')!.lane, 1);
  assert.equal(by.get('c')!.lane, 0, 'a 10:00–11:00 结束后 c 11:00 回到第一列');
  assert.equal(by.get('d')!.lanes, 1);
  assert.deepEqual(untimed.map((i) => i.kind === 'task' && i.task.id), ['e']);
});

test('很短的日程至少有最小高度，并且不会画出格子底部', () => {
  const { timed } = cellLayout(dayAgenda([task('short', '12:00', 5), task('late', '23:55', 30)], null), 0.06);
  for (const p of timed) {
    assert.ok(p.height >= 0.06 - 1e-9);
    assert.ok(p.top + p.height <= 1 + 1e-9);
  }
});

test('课程和日程一起排版，课程用课表的结束时间', () => {
  const classes = classesForDate(DEFAULT_TIMETABLE, '2026-10-26');
  const { timed } = cellLayout(dayAgenda([task('lunch', '12:00')], classes));
  const titles = ids(timed);
  assert.ok(titles.includes('AM 讲课') && titles.includes('lunch'));
  const am = timed.find((p) => p.item.kind === 'class' && p.item.slot.title === 'AM 讲课')!;
  assert.ok(am.height > 1 / 16, '15:45–17:15 比一小时高');
});

test('完成的日程沉底并去掉时间，课程不受影响，取消完成回到原位', () => {
  const tasks = [task('morning', '07:00', 60, { completed: true }), task('noon', '12:00')];
  const agenda = dayAgenda(tasks, classesForDate(DEFAULT_TIMETABLE, '2026-10-26'));
  const sorted = doneToBottom(agenda, (t) => isDone(t, '2026-10-26'));
  const last = sorted.at(-1)!;
  assert.equal(last.kind === 'task' && last.task.id, 'morning');
  assert.equal(last.time, '');
  assert.ok(sorted.filter((i) => i.kind === 'class').every((i) => i.time), '课程保留时间');
  const undone = doneToBottom(dayAgenda([{ ...tasks[0], completed: false }, tasks[1]], null), (t) => isDone(t, '2026-10-26'));
  assert.deepEqual(undone.map((i) => i.kind === 'task' && i.task.id), ['morning', 'noon']);
});

test('周次任务：本周完成数到周日为止，下周一清零', () => {
  const goals = saveGoal([], { id: 'gym', name: '健身', color: '#3FA66B', target: 3, slots: 4 }, 0);
  let marks = addMark([], 'gym', '2026-10-26', true, 'm1', 0);
  marks = addMark(marks, 'gym', '2026-10-28', true, 'm2', 0);
  marks = addMark(marks, 'gym', '2026-11-01', true, 'm3', 0); // 周日
  const week = goalWeeks(goals, marks, '2026-11-01')[0];
  assert.equal(week.done.length, 3);
  assert.equal(week.reached, true);
  assert.equal(week.cells.length, 4);
  const next = goalWeeks(goals, marks, '2026-11-02')[0]; // 周一
  assert.equal(next.done.length, 0);
  assert.equal(next.remaining, 3);
  assert.deepEqual(next.cells.map((c) => c.kind), ['empty', 'empty', 'empty', 'empty']);
});
