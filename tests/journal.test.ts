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

test('段落间空一行：旧日记显示时隔开，回车自动空行', async () => {
  const { paragraphBreak, spaceParagraphs } = await import('../src/journal');
  assert.equal(spaceParagraphs('第一段\n第二段\n\n第三段'), '第一段\n\n第二段\n\n第三段');
  assert.equal(spaceParagraphs('一\r\n二'), '一\n\n二');
  assert.deepEqual(paragraphBreak('第一段', 3, 3), { text: '第一段\n\n', caret: 5 });
  assert.deepEqual(paragraphBreak('第一段\n\n', 5, 5), { text: '第一段\n\n\n', caret: 6 });
  assert.deepEqual(paragraphBreak('前半后半', 2, 2), { text: '前半\n\n后半', caret: 4 });
});

test('复盘：回车记一条按天编号、改空即删、合并取较新、周汇总与周日提醒', async () => {
  const r = await import('../src/reflections');
  let list = r.addReflection(undefined, '2026-10-12', '  第一条感悟  ', 'a', Date.parse('2026-10-12T08:00:00.000Z'));
  list = r.addReflection(list, '2026-10-12', '第二条', 'b', Date.parse('2026-10-12T09:00:00.000Z'));
  list = r.addReflection(list, '2026-10-13', '   ', 'c');
  assert.equal(list.length, 2);
  assert.deepEqual(r.reflectionsByDay(list).map(g => [g.date, g.items.map(i => i.text)]), [['2026-10-12', ['第一条感悟', '第二条']]]);
  const edited = r.editReflection(list, 'a', '改过的', Date.parse('2026-10-12T07:00:00.000Z'));
  assert.equal(edited.find(i => i.id === 'a')?.text, '改过的');
  assert.equal(edited.find(i => i.id === 'a')?.updatedAt, '2026-10-12T08:00:00.001Z');
  const removed = r.deleteReflection(edited, 'b', Date.parse('2026-10-12T10:00:00.000Z'));
  assert.deepEqual(r.activeReflections(removed).map(i => i.id), ['a']);
  assert.deepEqual(r.mergeReflections(list, removed), r.mergeReflections(removed, list));
  assert.equal(r.mergeReflections(list, removed).find(i => i.id === 'b')?.deletedAt, '2026-10-12T10:00:00.000Z');
  assert.deepEqual(r.validateReflections(JSON.parse(JSON.stringify(removed))), removed);
  assert.deepEqual(r.weekRange('2026-10-14'), { start: '2026-10-12', end: '2026-10-18' });
  assert.deepEqual(r.monthRange('2026-02-10'), { start: '2026-02-01', end: '2026-02-28' });
  assert.equal(r.shiftRange('2026-01-31', 'month', 1).slice(0, 7), '2026-02');
  const now = new Date(2026, 9, 14, 12).getTime();
  const due = r.reviewReminders(list, now);
  assert.equal(due.length, 1);
  assert.equal(due[0].at, new Date(2026, 9, 18, 20, 0).getTime());
  assert.deepEqual(r.reviewReminders([], now), []);
  const backup = validateBackup({ ...defaultData(), reflections: removed });
  assert.equal(backup.reflections?.length, 2);
});
