import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isDone as coreIsDone, occursOn as coreOccursOn } from '../../src/core.ts';
import type { Task } from '../../src/types.ts';
import { dueReminders, isDone, MULTI_LEADS, occursOn, zonedDateKey, zonedTime } from '../supabase/functions/shiri-reminders/schedule.ts';
import { applyRemoteLists, planListSync } from '../../src/live-sync.ts';

const base: Task = { id: 't1', title: '开会', date: '2026-01-31', time: '09:30', duration: 60, listId: 'work', notes: '', priority: 'normal', repeat: 'none', completed: false, doneDates: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

test('云端重复规则与桌面版逐日一致', () => {
  for (const repeat of ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const) {
    for (const date of ['2024-02-29', '2026-01-31', '2026-03-15']) {
      const task = { ...base, repeat, date, doneDates: [addDays(date, 7)] };
      for (let i = -3; i < 800; i++) {
        const key = addDays(date, i);
        assert.equal(occursOn(task, key), coreOccursOn(task, key), `${repeat} ${date} ${key}`);
        assert.equal(isDone(task, key), coreIsDone(task, key));
      }
    }
  }
});

test('时区换算：上海没有夏令时，纽约跨夏令时', () => {
  assert.equal(new Date(zonedTime('2026-09-28', '09:30', 'Asia/Shanghai')).toISOString(), '2026-09-28T01:30:00.000Z');
  assert.equal(new Date(zonedTime('2026-03-08', '09:00', 'America/New_York')).toISOString(), '2026-03-08T13:00:00.000Z');
  assert.equal(new Date(zonedTime('2026-03-07', '09:00', 'America/New_York')).toISOString(), '2026-03-07T14:00:00.000Z');
  assert.equal(zonedDateKey(Date.parse('2026-09-28T17:00:00Z'), 'Asia/Shanghai'), '2026-09-29');
});

test('到点提醒：提前量、只发一次的窗口、已完成与全天不提醒', () => {
  const task = { ...base, date: '2026-09-28', time: '09:30' };
  const at = Date.parse('2026-09-28T01:30:00Z');
  assert.equal(dueReminders([task], 'Asia/Shanghai', 10, at - 11 * 60_000).length, 0);
  const due = dueReminders([task], 'Asia/Shanghai', 10, at - 10 * 60_000);
  assert.equal(due.length, 1);
  assert.equal(due[0].occurrence, 't1:2026-09-28:09:30:10');
  assert.match(due[0].body, /10 分钟后开始/);
  // 定时器晚了 3 分钟也补发；日程开始后不再补。
  assert.equal(dueReminders([task], 'Asia/Shanghai', 10, at - 7 * 60_000).length, 1);
  assert.equal(dueReminders([task], 'Asia/Shanghai', 0, at + 2 * 60_000).length, 0);
  assert.equal(dueReminders([{ ...task, completed: true }], 'Asia/Shanghai', 10, at - 10 * 60_000).length, 0);
  assert.equal(dueReminders([{ ...task, time: '' }], 'Asia/Shanghai', 10, at - 10 * 60_000).length, 0);
  assert.equal(dueReminders([{ ...task, deletedAt: '2026-09-01T00:00:00.000Z' }], 'Asia/Shanghai', 10, at - 10 * 60_000).length, 0);
});

test('重复日程：每天的提醒按当天日期区分，完成某天只跳过那天', () => {
  const task = { ...base, date: '2026-09-01', time: '00:05', repeat: 'daily' as const, doneDates: ['2026-09-29'] };
  const beforeMidnight = Date.parse('2026-09-28T16:00:00Z'); // 上海 9/29 00:00
  assert.equal(dueReminders([task], 'Asia/Shanghai', 10, beforeMidnight - 5 * 60_000).length, 0);
  const next = Date.parse('2026-09-29T16:00:00Z'); // 上海 9/30 00:00
  const due = dueReminders([task], 'Asia/Shanghai', 5, next);
  assert.deepEqual(due.map(d => d.occurrence), ['t1:2026-09-30:00:05:5']);
});

test('清单同步：只上传本机改过的，占位名不覆盖云端真实名称', () => {
  const remote = [{ id: 'work', name: '工作', color: '#6D8DCA' }, { id: 'abc', name: '读书', color: '#80A38F' }];
  const local = [{ id: 'work', name: '工作项目', color: '#6D8DCA' }, { id: 'abc', name: '同步清单 4', color: '#6D8DCA' }, { id: 'new1', name: '健身', color: '#BD96B8' }, { id: 'ph', name: '同步清单 5', color: '#6D8DCA' }];
  const snapshot = new Map([['work', JSON.stringify({ id: 'work', name: '工作', color: '#6D8DCA' })]]);
  assert.deepEqual(planListSync(local, remote, snapshot).map(l => l.id), ['work', 'new1']);
  const merged = applyRemoteLists(local, [...remote, { id: 'x', name: '旅行', color: '#123456' }]);
  assert.deepEqual(merged.map(l => l.name), ['工作', '读书', '健身', '同步清单 5', '旅行']);
});

test('快速添加识别开头的时间', async () => {
  const { parseQuick } = await import('../src/quick.ts');
  assert.deepEqual(parseQuick('15:00 开会'), { title: '开会', time: '15:00' });
  assert.deepEqual(parseQuick('下午3点 取快递'), { title: '取快递', time: '15:00' });
  assert.deepEqual(parseQuick('晚上8点半跑步'), { title: '跑步', time: '20:30' });
  assert.deepEqual(parseQuick('9：05 晨会'), { title: '晨会', time: '09:05' });
  assert.deepEqual(parseQuick('买3个苹果'), { title: '买3个苹果', time: '' });
  assert.deepEqual(parseQuick('25:00 错'), { title: '25:00 错', time: '' });
});

test('cloud push reminds 2 h, 1 h, 30 min and 10 min before, once each', () => {
  const task = { id: 'multi', title: '多次提醒', date: '2026-09-14', time: '12:00', repeat: 'none', completed: false, doneDates: [] };
  const at = zonedTime('2026-09-14', '12:00', 'Europe/Berlin');
  const fired = [120, 60, 30, 10].map(lead => dueReminders([task], 'Europe/Berlin', MULTI_LEADS, at - lead * 60_000));
  assert.deepEqual(fired.map(due => due.length), [1, 1, 1, 1]);
  assert.equal(new Set(fired.map(due => due[0].occurrence)).size, 4);
  assert.match(fired[0][0].body, /2 小时后开始/);
  assert.equal(dueReminders([task], 'Europe/Berlin', MULTI_LEADS, at - 45 * 60_000).length, 0);
});
