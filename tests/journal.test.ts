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

test('周次任务：四格选三格完成、达标、撤销、安排、历史、周五提醒、合并', async () => {
  const w = await import('../src/weekly');
  let goals = w.saveGoal(undefined, { id: 'gym', name: '健身', color: '#3FA66B', target: 3, slots: 4 }, Date.parse('2026-10-01T08:00:00.000Z'));
  goals = w.saveGoal(goals, { id: 'de', name: '德语学习', color: '#3B7DDD', target: 2, slots: 3 }, Date.parse('2026-10-01T09:00:00.000Z'));
  let marks = w.addMark(undefined, 'gym', '2026-10-12', true, 'm1');
  marks = w.addMark(marks, 'gym', '2026-10-14', true, 'm2');
  marks = w.addMark(marks, 'gym', '2026-10-17', false, 'm3');
  let week = w.goalWeeks(goals, marks, '2026-10-15');
  assert.deepEqual(week.map(g => [g.goal.name, g.done.length, g.remaining, g.cells.map(c => c.kind)]), [['健身', 2, 1, ['done', 'done', 'planned', 'empty']], ['德语学习', 0, 2, ['empty', 'empty', 'empty']]]);
  marks = w.setMarkDone(marks, 'm3', true, Date.parse('2026-10-17T10:00:00.000Z'));
  week = w.goalWeeks(goals, marks, '2026-10-18');
  assert.equal(week[0].reached, true);
  assert.equal(w.goalWeeks(goals, marks, '2026-10-19')[0].done.length, 0, '下周一重新开始');
  marks = w.removeMark(marks, 'm1', Date.parse('2026-10-18T10:00:00.000Z'));
  assert.equal(w.goalWeeks(goals, marks, '2026-10-18')[0].done.length, 2);
  assert.deepEqual(w.marksOn(goals, marks, '2026-10-14').map(x => x.goal.name), ['健身']);
  const history = w.goalHistory(goals[0], marks, '2026-10-18', 8);
  assert.equal(history[history.length - 1].done, 2);
  assert.equal(history[0].start, '2026-09-28');
  const fridayNoon = new Date(2026, 9, 16, 12).getTime();
  const due = w.goalReminders(goals, [], fridayNoon);
  assert.equal(due.length, 1);
  assert.equal(due[0].at, new Date(2026, 9, 16, 19, 0).getTime());
  assert.match(due[0].body, /健身还差 3 次，德语学习还差 2 次/);
  assert.deepEqual(w.goalReminders(goals, [], new Date(2026, 9, 16, 20).getTime()), []);
  const withM4 = w.addMark(marks, 'de', '2026-10-15', true, 'm4');
  assert.deepEqual(w.mergeItems(marks, withM4), w.mergeItems(withM4, marks));
  assert.throws(() => w.validateGoal({ ...goals[0], slots: 2 }));
  const backup = validateBackup({ ...defaultData(), goals, goalMarks: marks });
  assert.equal(backup.goals?.length, 2);
  assert.equal(w.activeGoals(w.deleteGoal(goals, 'de')).length, 1);
});

test('课程状态：已下课默认已上、单击循环、备注、待复习清单、合并', async () => {
  const c = await import('../src/classes');
  const w = await import('../src/weekly');
  const now = new Date(2026, 9, 14, 12).getTime();
  assert.equal(c.classState(undefined, '2026-10-12', '09:30', now), 'done');
  assert.equal(c.classState(undefined, '2026-10-15', '09:30', now), 'upcoming');
  assert.deepEqual(['upcoming', 'done', 'review', 'todo'].map(s => c.nextClassState(s as never)), ['done', 'review', 'todo', 'done']);
  const slot = { id: 'slot-am', title: 'AM 讲课' };
  let marks = c.setClassMark(undefined, slot, '2026-10-12', 'review', '第 3 章例题', now);
  assert.equal(c.classState(c.classMarkFor(marks, 'slot-am', '2026-10-12'), '2026-10-12', '09:30', now), 'review');
  assert.deepEqual(c.reviewClasses(marks).map(m => [m.title, m.note]), [['AM 讲课', '第 3 章例题']]);
  const later = c.setClassMark(marks, slot, '2026-10-12', 'done', undefined, now - 1000);
  assert.equal(later[0].note, '第 3 章例题', '只改状态时保留备注');
  assert.ok(later[0].updatedAt > marks[0].updatedAt);
  assert.equal(c.setClassMark(later, slot, '2026-10-12', 'done', undefined, now), later);
  assert.deepEqual(c.reviewClasses(later), []);
  assert.deepEqual(w.mergeItems(marks, later), w.mergeItems(later, marks));
  assert.equal(w.mergeItems(marks, later)[0].status, 'done');
  assert.deepEqual(validateBackup({ ...defaultData(), classMarks: later }).classMarks, later);
  assert.throws(() => c.validateClassMark({ ...later[0], status: 'skip' }));
});

test('周次任务自动排时间：从今天起、9–21 点、避开忙的时段、同一天不排两次、删掉的不再补', async () => {
  const w = await import('../src/weekly');
  const goals = [
    { id: 'gym', name: '健身', color: '#3FA66B', target: 3, slots: 4, duration: 90, time: '17:30', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' },
    { id: 'de', name: '德语学习', color: '#3B7DDD', target: 2, slots: 4, duration: 60, time: '10:00', createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z' },
  ];
  const now = new Date(2026, 9, 13, 15, 40).getTime();
  const busy = (date: string): [number, number][] => date === '2026-10-14' ? [[600, 690], [1050, 1140]] : [];
  const plan = w.autoPlanWeek(goals, [], '2026-10-13', now, busy);
  const gym = plan.filter(m => m.goalId === 'gym'), de = plan.filter(m => m.goalId === 'de');
  assert.equal(gym.length, 4);
  assert.equal(de.length, 4);
  for (const list of [gym, de]) assert.equal(new Set(list.map(m => m.date)).size, list.length, '同一天不排两次');
  for (const m of plan) {
    assert.ok(m.date >= '2026-10-13' && m.date <= '2026-10-18');
    const start = Number(m.time!.slice(0, 2)) * 60 + Number(m.time!.slice(3));
    assert.ok(start >= 540 && start + (m.goalId === 'gym' ? 90 : 60) <= 1260, m.time);
    if (m.date === '2026-10-13') assert.ok(start >= 16 * 60 + 30, '今天只排现在之后');
    if (m.date === '2026-10-14') for (const [a, b] of busy(m.date)) assert.ok(start + (m.goalId === 'gym' ? 90 : 60) + 15 <= a || start >= b + 15, `${m.goalId} ${m.time} 避开忙的时段`);
  }
  const sameDay = plan.filter(m => m.date === '2026-10-15');
  if (sameDay.length === 2) { const [a, b] = sameDay.map(m => Number(m.time!.slice(0, 2)) * 60 + Number(m.time!.slice(3))); assert.ok(Math.abs(a - b) >= 75, '两个任务不重叠'); }
  assert.deepEqual(w.autoPlanWeek(goals, plan, '2026-10-13', now, busy), [], '排过一次不重复');
  const removed = w.removeMark(plan, gym[0].id, now);
  assert.deepEqual(w.autoPlanWeek(goals, removed, '2026-10-13', now, busy), [], '删掉的不再补回');
  const moved = w.moveMark(plan, gym[0].id, '2026-10-18', '09:00', now);
  assert.equal(moved.find(m => m.id === gym[0].id)?.time, '09:00');
  assert.ok(moved.find(m => m.id === gym[0].id)!.updatedAt > gym[0].updatedAt, '用户改过的比自动排的新');
  assert.deepEqual(w.plannedAsTasks(goals, plan).length, 8);
  assert.deepEqual(w.validateMarks(JSON.parse(JSON.stringify(plan))), plan);
});

test('周次任务可调整：时间范围、可排的星期、重新排保留做完和挪过的', async () => {
  const w = await import('../src/weekly');
  let goals = w.saveGoal(undefined, { id: 'de', name: '德语学习', color: '#3B7DDD', target: 2, slots: 3, duration: 60, time: '10:00' }, Date.parse('2026-10-01T09:00:00.000Z'));
  const now = new Date(2026, 9, 13, 8, 0).getTime();
  const free = () => [] as [number, number][];
  const plan = w.autoPlanWeek(goals, [], '2026-10-13', now, free);
  assert.equal(plan.length, 3);
  assert.ok(plan.every(m => m.auto && m.time === '10:00'));
  // 只排周二、周四、周六，下午 14–18 点
  goals = w.saveGoal(goals, { ...goals[0], earliest: '14:00', latest: '18:00', days: [2, 4, 6] }, now);
  assert.deepEqual([goals[0].earliest, goals[0].latest, goals[0].days], ['14:00', '18:00', [2, 4, 6]]);
  let marks = w.setMarkDone(plan, plan[0].id, true, now);
  marks = w.moveMark(marks, plan[1].id, plan[1].date, '08:00', now);
  const { removed, added } = w.replanWeek(goals, marks, '2026-10-13', now, free, () => `n${Math.random().toString(36).slice(2, 8)}`);
  assert.deepEqual(removed, [plan[2].id], '只重排没做、没挪过的');
  assert.equal(added.length, 1);
  const weekday = (d: string) => (new Date(`${d}T12:00:00`).getDay() + 6) % 7 + 1;
  assert.ok([2, 4, 6].includes(weekday(added[0].date)) && added[0].time! >= '14:00' && added[0].time! <= '17:00', `${added[0].date} ${added[0].time}`);
  assert.throws(() => w.validateGoal({ ...goals[0], earliest: '18:00', latest: '09:00' }));
  assert.deepEqual(w.validateGoal(JSON.parse(JSON.stringify(goals[0]))), goals[0]);
});

test('测体重：读数字、记下改掉删掉、合并、08:00 没记才提醒', async () => {
  const w = await import('../src/weight');
  const m = await import('../src/weekly');
  assert.equal(w.parseKg('72.5'), 72.5);
  assert.equal(w.parseKg(' 72,46 kg '), 72.5);
  assert.equal(w.parseKg('abc'), null);
  assert.equal(w.parseKg('5'), null);
  const t = Date.parse('2026-10-17T06:10:00.000Z');
  let list = w.setWeight(undefined, '2026-10-17', 72.5, t);
  assert.equal(w.weightOn(list, '2026-10-17')?.kg, 72.5);
  assert.equal(w.setWeight(list, '2026-10-17', 72.5, t + 1), list);
  const changed = w.setWeight(list, '2026-10-17', 72.1, t - 1000);
  assert.ok(changed[0].updatedAt > list[0].updatedAt);
  list = w.setWeight(changed, '2026-10-16', 73, t);
  assert.deepEqual(w.weightHistory(list).map(e => e.kg), [72.1, 73]);
  const removed = w.setWeight(list, '2026-10-16', null, t + 5000);
  assert.equal(w.weightOn(removed, '2026-10-16'), undefined);
  assert.deepEqual(m.mergeItems(list, removed), m.mergeItems(removed, list));
  assert.deepEqual(w.validateWeights(JSON.parse(JSON.stringify(removed))), removed);
  assert.throws(() => w.validateWeight({ ...list[0], kg: 5 }));
  const now = new Date(2026, 9, 17, 7, 0).getTime();
  assert.deepEqual(w.weightReminders([], 2, now).map(r => r.id), ['weight:2026-10-17', 'weight:2026-10-18']);
  assert.deepEqual(w.weightReminders(w.setWeight(undefined, '2026-10-17', 70, now), 2, now).map(r => r.id), ['weight:2026-10-18']);
  assert.deepEqual(w.weightReminders([], 1, new Date(2026, 9, 17, 9, 0).getTime()), []);
  assert.equal(validateBackup({ ...defaultData(), weights: list }).weights?.length, 2);
});

test('完成的日程放到当天最下面、不显示时间，取消完成回到原位', async () => {
  const { dayAgenda, doneToBottom, cellLayout } = await import('../src/timetable');
  const { doneLast } = await import('../src/core');
  const t = '2026-10-01T08:00:00.000Z';
  const mk = (id: string, time: string, completed: boolean) => ({ id, title: id, date: '2026-10-18', time, duration: 60, listId: 'work', notes: '', priority: 'normal' as const, repeat: 'none' as const, completed, doneDates: [], createdAt: t, updatedAt: t });
  const tasks = [mk('a', '09:00', true), mk('b', '10:00', false), mk('c', '', false)];
  const items = doneToBottom(dayAgenda(tasks, null), task => task.completed);
  assert.deepEqual(items.map(i => i.kind === 'task' ? [i.task.id, i.time] : null), [['b', '10:00'], ['c', ''], ['a', '']]);
  const layout = cellLayout(items);
  assert.deepEqual(layout.timed.map(p => p.item.kind === 'task' && p.item.task.id), ['b']);
  assert.deepEqual(layout.untimed.map(i => i.kind === 'task' && i.task.id), ['c', 'a']);
  assert.equal(tasks[0].time, '09:00', '日程本身的时间不变');
  assert.deepEqual(doneLast(tasks, '2026-10-18').map(x => x.id), ['b', 'c', 'a']);
});
