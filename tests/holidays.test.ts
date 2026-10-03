import assert from 'node:assert/strict';
import test from 'node:test';
import { dayMark, festivalName, lunarMonthDay } from '../src/holidays';

test('2026 official rest days and make-up workdays follow the State Council notice', () => {
  assert.deepEqual(dayMark('2026-02-15'), { kind: 'rest', name: '春节' });
  assert.deepEqual(dayMark('2026-02-23'), { kind: 'rest', name: '春节' });
  assert.deepEqual(dayMark('2026-02-14'), { kind: 'work', name: '春节' });
  assert.deepEqual(dayMark('2026-02-28'), { kind: 'work', name: '春节' });
  assert.deepEqual(dayMark('2026-09-20'), { kind: 'work', name: '国庆' });
  assert.deepEqual(dayMark('2026-10-07'), { kind: 'rest', name: '国庆' });
  assert.deepEqual(dayMark('2026-10-10'), { kind: 'work', name: '国庆' });
  assert.equal(dayMark('2026-10-08'), null);
  assert.equal(dayMark('2026-09-28'), null);
  assert.equal(dayMark('2027-03-01'), null, 'unpublished years show no marks');
});

test('festival names come from the lunar calendar, fixed dates and Qingming', () => {
  assert.equal(festivalName('2026-02-17'), '春节');
  assert.equal(festivalName('2026-02-16'), '除夕');
  assert.equal(festivalName('2026-06-19'), '端午');
  assert.equal(festivalName('2026-09-25'), '中秋');
  assert.equal(festivalName('2026-04-05'), '清明');
  assert.equal(festivalName('2025-04-04'), '清明');
  assert.equal(festivalName('2026-10-01'), '国庆节');
  assert.equal(festivalName('2026-09-29'), '');
  assert.deepEqual(lunarMonthDay('2025-07-30'), { month: 0, day: 6 }, 'leap months never match festivals');
});

test('German public holidays: nationwide by default, state holidays when a state is chosen', async () => {
  const { germanHoliday, easterSunday } = await import('../src/holidays');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
  assert.equal(germanHoliday('2026-04-03')?.german, 'Karfreitag');
  assert.equal(germanHoliday('2026-04-06')?.german, 'Ostermontag');
  assert.equal(germanHoliday('2026-05-14')?.german, 'Christi Himmelfahrt');
  assert.equal(germanHoliday('2026-05-25')?.german, 'Pfingstmontag');
  assert.equal(germanHoliday('2026-10-03')?.name, '统一日');
  assert.equal(germanHoliday('2026-06-04'), null, 'Fronleichnam is regional');
  assert.equal(germanHoliday('2026-06-04', 'BY')?.german, 'Fronleichnam');
  assert.equal(germanHoliday('2026-11-18', 'SN')?.german, 'Buß- und Bettag');
  assert.equal(germanHoliday('2027-11-17', 'SN')?.german, 'Buß- und Bettag');
  assert.equal(germanHoliday('2026-10-31', 'BE'), null);
  assert.equal(germanHoliday('2026-10-31', 'NI')?.german, 'Reformationstag');
  assert.equal(germanHoliday('2026-03-08', 'BE')?.german, 'Internationaler Frauentag');
});
