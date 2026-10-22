import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightChart } from '../src/weight-chart';
import type { WeightEntry } from '../src/types';

const at = '2026-10-01T06:00:00.000Z';
const entry = (date: string, kg: number): WeightEntry => ({ id: `weight_${date.replace(/-/g, '')}`, date, kg, createdAt: at, updatedAt: at });
const box = { width: 600, height: 200, left: 30, right: 10, top: 10, bottom: 20 };

test('weight chart places points by date and spans the chosen range', () => {
  const list = [entry('2026-10-01', 70), entry('2026-10-11', 72), entry('2026-10-21', 71), { ...entry('2026-10-15', 90), deletedAt: at }];
  const chart = weightChart(list, '2026-10-21', 30, box);
  assert.deepEqual(chart.points.map(p => p.date), ['2026-10-01', '2026-10-11', '2026-10-21']);
  assert.equal(chart.points[2].x, 590);
  assert.ok(chart.points[0].x > 30 && chart.points[0].x < chart.points[1].x);
  assert.ok(chart.points[1].y < chart.points[0].y, 'heavier is higher');
  assert.ok(chart.yTicks[0].kg <= 70 && chart.yTicks[chart.yTicks.length - 1].kg >= 72);
  assert.equal(chart.xTicks[chart.xTicks.length - 1].label, '10/21');
});

test('weight chart handles no data, one point and the whole history', () => {
  assert.equal(weightChart([], '2026-10-21', 30, box).points.length, 0);
  const one = weightChart([entry('2026-10-21', 70)], '2026-10-21', 0, box);
  assert.equal(one.points.length, 1);
  assert.ok(one.yTicks.length >= 2);
  const all = weightChart([entry('2025-01-01', 80), entry('2026-10-21', 70)], '2026-10-21', 0, box);
  assert.equal(all.points[0].x, 30);
  assert.equal(weightChart([entry('2025-01-01', 80), entry('2026-10-21', 70)], '2026-10-21', 30, box).points.length, 1);
});

test('weight chart 7-day range labels every day and drops older points', () => {
  const week = weightChart([entry('2026-10-14', 72), entry('2026-10-15', 71.8), entry('2026-10-21', 71.2)], '2026-10-21', 7, box);
  assert.equal(week.points.length, 2);
  assert.equal(week.xTicks.length, 7);
  assert.equal(week.xTicks[0].label, '10/15');
  assert.equal(week.xTicks[6].label, '10/21');
});
