import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBackup, defaultData } from '../../拾日/src/core.ts';
import { applyFields, busy, free, newTask, nextStamp, occurrences, setDone } from '../supabase/functions/ai-sync/ops.ts';

const lists = defaultData().lists;
const now = Date.parse('2026-09-28T18:00:00.000Z');

test('云函数用的数据代码与电脑版一致（改了桌面版要重新运行 sync-shared）', () => {
  for (const file of ['types.ts', 'core.ts', 'timetable.ts', 'holidays.ts']) {
    const desktop = readFileSync(new URL(`../../拾日/src/${file}`, import.meta.url), 'utf8').replace(/from '\.\/([a-z-]+)'/g, "from './$1.ts'");
    const copy = readFileSync(new URL(`../supabase/functions/_shared/${file}`, import.meta.url), 'utf8');
    assert.equal(copy.slice(copy.indexOf('\n') + 1), desktop, file);
  }
});

test('新建、修改、完成、删除写出的日程都能被电脑版读入', () => {
  const created = newTask('ai-1', now, lists, { title: '和导师开会', date: '2026-10-15', start: '15:00', end: '16:30', notes: '带上报告', color: '#e5534b', list: '工作' });
  assert.equal(created.duration, 90);
  assert.equal(created.color, '#E5534B');
  const moved = { ...applyFields(created, { start: '16:00', duration: 45, color: null }, lists), updatedAt: nextStamp(now, created.updatedAt) };
  assert.equal(moved.time, '16:00'); assert.equal(moved.duration, 45); assert.equal(moved.color, undefined);
  assert.ok(moved.updatedAt > created.updatedAt);
  const done = setDone(moved, undefined, true);
  const at = nextStamp(now, done.updatedAt);
  const deleted = { ...done, updatedAt: at, deletedAt: at };
  for (const task of [created, moved, done, deleted]) validateBackup({ version: 1, tasks: [task], lists });
});

test('错误输入给出明确错误码', () => {
  assert.throws(() => newTask('x', now, lists, { title: '' }), /title/);
  assert.throws(() => newTask('x', now, lists, { title: 'a', date: '2026-02-30' }), /date/);
  assert.throws(() => newTask('x', now, lists, { title: 'a', list: '不存在' }), (e: { code: string }) => e.code === 'unknown_list');
  assert.throws(() => newTask('x', now, lists, { title: 'a', evil: 1 }), /不支持的字段/);
  assert.throws(() => newTask('x', now, lists, { title: 'a', repeat: 'weekly' }), /收集箱/);
});

test('重复日程：按日期完成、在范围内展开', () => {
  const weekly = newTask('w', now, lists, { title: '组会', date: '2026-10-05', start: '10:00', repeat: 'weekly' });
  assert.throws(() => setDone(weekly, '2026-10-06', true), (e: { code: string }) => e.code === 'not_on_date');
  const done = setDone(weekly, '2026-10-12', true);
  const occ = occurrences([done], lists, '2026-10-01', '2026-10-20');
  assert.deepEqual(occ.map(o => [o.date, o.done]), [['2026-10-05', false], ['2026-10-12', true], ['2026-10-19', false]]);
});

test('忙碌与空闲：日程 + 课表（默认 WS 2026/27），周五没课，德国统一日不上课', () => {
  const meeting = newTask('m', now, lists, { title: '开会', date: '2026-10-13', start: '10:00', end: '11:00' });
  const days = busy([meeting], undefined, '2026-10-13', '2026-10-13', '').days;
  assert.deepEqual(days[0].blocks.map(b => `${b.start}-${b.end} ${b.kind}${b.optional ? '?' : ''}`),
    ['08:00-09:30 class', '10:00-11:00 event', '11:30-13:00 class', '14:00-15:30 class?']);
  const slots = free(days, { dayStart: '08:00', dayEnd: '18:00', minMinutes: 30 })[0].free.map(s => `${s.start}-${s.end}`);
  assert.deepEqual(slots, ['09:30-10:00', '11:00-11:30', '13:00-14:00', '15:30-18:00']);
  const withOptional = free(days, { dayStart: '08:00', dayEnd: '18:00', ignoreOptional: true })[0].free.map(s => `${s.start}-${s.end}`);
  assert.deepEqual(withOptional, ['09:30-10:00', '11:00-11:30', '13:00-18:00']);
  const friday = busy([], undefined, '2026-10-16', '2026-10-16', '').days[0];
  assert.equal(friday.blocks.length, 0);
  assert.equal(free([friday], {}).length, 1);
  assert.equal(free(busy([], undefined, '2026-10-17', '2026-10-18', '').days, {}).length, 0); // 周末默认不排
});
