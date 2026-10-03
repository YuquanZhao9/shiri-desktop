import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultData, validateBackup } from '../src/core';
import { DEFAULT_TIMETABLE, newerTimetable, slotsForWeekday, validateTimetable } from '../src/timetable';
import { mergeWindowData } from '../src/window-data';
import type { Task } from '../src/types';

const task: Task = { id: 'a', title: '洗东西', date: '2026-09-29', time: '', duration: 60, listId: 'work', notes: '', priority: 'normal', repeat: 'none', completed: false, doneDates: [], createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z' };

test('tasks keep an optional color tag and reject malformed colors', () => {
  const data = validateBackup({ ...defaultData(), tasks: [{ ...task, color: '#E5534B' }, { ...task, id: 'b' }] });
  assert.equal(data.tasks[0].color, '#E5534B');
  assert.equal('color' in data.tasks[1], false);
  assert.throws(() => validateBackup({ ...defaultData(), tasks: [{ ...task, color: 'red' }] }), /颜色/);
});

test('the preset WS 2026/27 timetable is valid and ordered by weekday', () => {
  assert.deepEqual(validateTimetable(DEFAULT_TIMETABLE), DEFAULT_TIMETABLE);
  assert.deepEqual(slotsForWeekday(DEFAULT_TIMETABLE, 1).map(slot => slot.title), ['AR 讲课', 'MC 讲课', 'AM 讲课']);
  assert.equal(slotsForWeekday(DEFAULT_TIMETABLE, 5).length, 0);
  assert.equal(slotsForWeekday(DEFAULT_TIMETABLE, 2).find(slot => slot.title === '看 AR 录像')?.dashed, true);
  const backup = validateBackup({ ...defaultData(), timetable: DEFAULT_TIMETABLE });
  assert.equal(backup.timetable?.slots.length, 10);
  assert.throws(() => validateTimetable({ ...DEFAULT_TIMETABLE, slots: [{ ...DEFAULT_TIMETABLE.slots[0], end: '07:00' }] }), /下课时间/);
  assert.throws(() => validateTimetable({ ...DEFAULT_TIMETABLE, start: '2027-03-01' }), /学期/);
});

test('windows keep the most recently edited timetable', () => {
  const older = { ...DEFAULT_TIMETABLE, name: 'old' };
  const newer = { ...DEFAULT_TIMETABLE, name: 'new', updatedAt: '2026-10-01T08:00:00.000Z' };
  assert.equal(newerTimetable(older, newer)?.name, 'new');
  assert.equal(newerTimetable(undefined, older)?.name, 'old');
  const merged = mergeWindowData({ ...defaultData(), timetable: newer }, { ...defaultData(), timetable: older });
  assert.equal(merged.timetable?.name, 'new');
  assert.equal(mergeWindowData(defaultData(), defaultData()).timetable, undefined);
});

test('each semester weekday lists its classes by period, keeping empty periods', async () => {
  const { classesForDate } = await import('../src/timetable');
  const monday = classesForDate(DEFAULT_TIMETABLE, '2026-10-12');
  assert.deepEqual(monday?.map(row => row.start), ['08:00', '09:45', '11:30', '14:00', '15:45']);
  assert.deepEqual(monday?.[0].slots.map(slot => slot.title), ['AR 讲课', 'MC 讲课']);
  assert.equal(monday?.[1].slots.length, 0, 'empty periods stay in the layout');
  assert.deepEqual(monday?.[4].slots.map(slot => slot.title), ['AM 讲课']);
  assert.equal(classesForDate(DEFAULT_TIMETABLE, '2026-10-16'), null, 'Friday has no classes');
  assert.equal(classesForDate(DEFAULT_TIMETABLE, '2026-10-05'), null, 'before the semester');
  assert.equal(classesForDate(DEFAULT_TIMETABLE, '2027-02-15'), null, 'after the semester');
  assert.equal(classesForDate(DEFAULT_TIMETABLE, '2026-10-13', true), null, 'holidays have no classes');
  assert.ok(classesForDate(DEFAULT_TIMETABLE, '2027-02-11'), 'the last week is still filled');
});

test('no classes during the Uni Stuttgart Christmas break, including older saves without breaks', async () => {
  const { classesForDate, breaksOf } = await import('../src/timetable');
  assert.equal(classesForDate(DEFAULT_TIMETABLE, '2026-12-22')?.length, 5, 'Tuesday before the break still has classes');
  for (const day of ['2026-12-23', '2026-12-28', '2027-01-04', '2027-01-06']) assert.equal(classesForDate(DEFAULT_TIMETABLE, day), null, day);
  assert.ok(classesForDate(DEFAULT_TIMETABLE, '2027-01-07'), 'classes resume on 7 January');
  const { breaks: _omitted, ...older } = DEFAULT_TIMETABLE;
  assert.equal(breaksOf(older).length, 2, 'same semester saved before breaks existed');
  assert.equal(classesForDate(older, '2026-12-28'), null);
  assert.deepEqual(breaksOf({ ...older, start: '2027-04-20', end: '2027-07-24' }), []);
  assert.throws(() => validateTimetable({ ...DEFAULT_TIMETABLE, breaks: [{ name: 'x', start: '2027-01-06', end: '2026-12-23' }] }), /停课/);
});

test('clash dates carry a warning on that class only, and old preset saves follow the new preset', async () => {
  const { classesForDate, effectiveTimetable } = await import('../src/timetable');
  const find = (date: string, title: string) => classesForDate(DEFAULT_TIMETABLE, date)?.flatMap(row => row.slots).find(slot => slot.title === title);
  assert.match(find('2026-11-16', 'AM 讲课')?.alert ?? '', /重叠 15 分钟/);
  assert.equal(find('2026-11-23', 'AM 讲课')?.alert, undefined);
  for (const date of ['2026-11-19', '2026-11-26', '2026-12-10']) assert.match(find(date, 'ITCL 讲课')?.alert ?? '', /冲突/, date);
  assert.equal(find('2026-12-03', 'ITCL 讲课')?.alert, undefined);
  assert.equal(find('2026-11-19', 'SASP 讲课')?.alert, undefined);
  const oldPreset = { ...DEFAULT_TIMETABLE, updatedAt: '2026-09-28T00:00:00.000Z', breaks: undefined };
  assert.equal(effectiveTimetable(oldPreset), DEFAULT_TIMETABLE);
  const edited = { ...DEFAULT_TIMETABLE, name: '我的课表', updatedAt: '2026-10-01T00:00:00.000Z' };
  assert.equal(effectiveTimetable(edited), edited);
  assert.equal(effectiveTimetable(undefined), DEFAULT_TIMETABLE);
});
