import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultData, validateBackup } from '../src/core';
import { hasJournal, journalReminders, journalText, mergeJournal, validateJournal, writeJournal, writtenEntries } from '../src/journal';
import { journalToPush } from '../src/live-sync';
import { mergeWindowData } from '../src/window-data';

const at = (iso: string) => Date.parse(iso);

test('写日记：新建、修改、清空都留下更新时间，内容没变不改动', () => {
  const first = writeJournal(undefined, '2026-10-11', '今天开学', at('2026-10-11T19:00:00.000Z'));
  assert.deepEqual(first, [{ date: '2026-10-11', text: '今天开学', updatedAt: '2026-10-11T19:00:00.000Z' }]);
  assert.equal(writeJournal(first, '2026-10-11', '今天开学'), first);
  assert.deepEqual(writeJournal(undefined, '2026-10-11', '   '), []);
  // 时钟落后时仍严格递增
  const edited = writeJournal(first, '2026-10-11', '今天开学，很累', at('2026-10-11T18:00:00.000Z'));
  assert.equal(edited[0].updatedAt, '2026-10-11T19:00:00.001Z');
  const cleared = writeJournal(edited, '2026-10-11', '', at('2026-10-11T20:00:00.000Z'));
  assert.equal(cleared[0].text, '');
  assert.equal(hasJournal(cleared, '2026-10-11'), false);
  assert.deepEqual(writtenEntries(cleared), []);
});

test('合并日记：同一天较新的为准，删除（空文本）也能胜出，两端结果一致', () => {
  const a = [{ date: '2026-10-10', text: '旧', updatedAt: '2026-10-10T10:00:00.000Z' }, { date: '2026-10-11', text: '只在电脑', updatedAt: '2026-10-11T10:00:00.000Z' }];
  const b = [{ date: '2026-10-10', text: '', updatedAt: '2026-10-10T11:00:00.000Z' }, { date: '2026-10-09', text: '只在手机', updatedAt: '2026-10-09T10:00:00.000Z' }];
  const merged = mergeJournal(a, b);
  assert.deepEqual(merged, mergeJournal(b, a));
  assert.deepEqual(merged.map(e => [e.date, e.text]), [['2026-10-09', '只在手机'], ['2026-10-10', ''], ['2026-10-11', '只在电脑']]);
  assert.deepEqual(writtenEntries(merged).map(e => e.date), ['2026-10-11', '2026-10-09']);
  assert.equal(journalText(merged, '2026-10-09'), '只在手机');
});

test('只上传本机比云端新的日记', () => {
  const remote = [{ date: '2026-10-10', text: '云端', updatedAt: '2026-10-10T11:00:00.000Z' }];
  const local = [{ date: '2026-10-10', text: '本机旧', updatedAt: '2026-10-10T10:00:00.000Z' }, { date: '2026-10-11', text: '新写的', updatedAt: '2026-10-11T10:00:00.000Z' }];
  assert.deepEqual(journalToPush(local, remote).map(e => e.date), ['2026-10-11']);
  assert.deepEqual(journalToPush(remote, remote), []);
});

test('备份与窗口合并带上日记，非法日记被拒绝', () => {
  const data = { ...defaultData(), journal: [{ date: '2026-10-11', text: '第一段\n第二段', updatedAt: '2026-10-11T10:00:00.000Z' }] };
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(data))).journal, data.journal);
  assert.equal(validateBackup(defaultData()).journal, undefined);
  assert.throws(() => validateJournal([{ date: '2026-02-30', text: 'x', updatedAt: '2026-10-11T10:00:00.000Z' }]));
  assert.throws(() => validateJournal([{ date: '2026-10-11', text: 'x', updatedAt: 'bad' }]));
  assert.throws(() => validateJournal([{ date: '2026-10-11', text: 'x', updatedAt: '2026-10-11T10:00:00.000Z', extra: 1 }]));
  const other = { ...defaultData(), journal: [{ date: '2026-10-11', text: '更新', updatedAt: '2026-10-11T12:00:00.000Z' }] };
  assert.equal(mergeWindowData(data, other).journal?.[0].text, '更新');
  assert.equal(mergeWindowData(defaultData(), defaultData()).journal, undefined);
});

test('21:00 日记提醒：没写才提醒，已过的不提醒', () => {
  const now = new Date(2026, 9, 11, 20, 0).getTime();
  const items = journalReminders([], 3, now);
  assert.deepEqual(items.map(i => i.id), ['journal:2026-10-11', 'journal:2026-10-12', 'journal:2026-10-13']);
  assert.equal(items[0].at, new Date(2026, 9, 11, 21, 0).getTime());
  const written = [{ date: '2026-10-11', text: '写了', updatedAt: '2026-10-11T10:00:00.000Z' }];
  assert.deepEqual(journalReminders(written, 2, now).map(i => i.id), ['journal:2026-10-12']);
  assert.deepEqual(journalReminders([], 1, new Date(2026, 9, 11, 21, 30).getTime()), []);
});
