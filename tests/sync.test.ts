import assert from 'node:assert/strict';
import test from 'node:test';
import { syncTasks } from '../src/cloud';
import { syncJournal, syncLists, syncReflections, syncTimetable, syncWeekly } from '../src/live-sync';
import { DEFAULT_TIMETABLE } from '../src/timetable';
import { mergeTasks } from '../src/core';
import { writeJournal } from '../src/journal';
import { setWeight } from '../src/weight';
import { setClassMark } from '../src/classes';
import type { Task } from '../src/types';
import { FakeCloud } from './fake-supabase';

// 用内存里的假云端模拟两台设备（电脑、手机）先后同步，检查最后两边一致、较新的改动胜出、删除能传过去。

const T0 = Date.parse('2026-10-26T08:00:00Z');
const stamp = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, title: id, date: '2026-10-26', time: '09:00', duration: 60, listId: 'work', notes: '', priority: 'normal', repeat: 'none', completed: false, doneDates: [], createdAt: stamp(0), updatedAt: stamp(0), ...patch };
}

// localStorage 在 Node 里不存在；清单同步要用它记上次版本。
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

test('日程：两台设备各自新增、改同一条、删一条，同步两轮后完全一致', async () => {
  const cloud = new FakeCloud();
  const pc = cloud.client(), phone = cloud.client();
  let pcTasks = [task('shared'), task('pc-only')];
  pcTasks = await syncTasks(pc, pcTasks);
  let phoneTasks = await syncTasks(phone, []);
  assert.deepEqual(phoneTasks.map((t) => t.id).sort(), ['pc-only', 'shared']);

  // 离线时：电脑改标题（较早），手机改标题（较晚）并删掉 pc-only，手机还新增一条
  pcTasks = pcTasks.map((t) => (t.id === 'shared' ? { ...t, title: '电脑改的', updatedAt: stamp(5) } : t));
  phoneTasks = phoneTasks.map((t) => (t.id === 'shared' ? { ...t, title: '手机改的', updatedAt: stamp(10) } : t.id === 'pc-only' ? { ...t, deletedAt: stamp(10), updatedAt: stamp(10) } : t));
  phoneTasks.push(task('phone-only', { updatedAt: stamp(10) }));

  pcTasks = await syncTasks(pc, pcTasks);
  phoneTasks = await syncTasks(phone, phoneTasks);
  pcTasks = await syncTasks(pc, pcTasks);

  assert.deepEqual(pcTasks, phoneTasks);
  const byId = new Map(pcTasks.map((t) => [t.id, t]));
  assert.equal(byId.get('shared')?.title, '手机改的');
  assert.ok(byId.get('pc-only')?.deletedAt, '删除要以墓碑形式保留，旧设备不会把它复活');
  assert.ok(byId.has('phone-only'));
});

test('日程：超过一页（500 条）也能完整读回', async () => {
  const cloud = new FakeCloud();
  const many = Array.from({ length: 1203 }, (_, i) => task(`t${String(i).padStart(4, '0')}`));
  const result = await syncTasks(cloud.client(), many);
  assert.equal(result.length, 1203);
  assert.deepEqual(cloud.calls.filter((c) => c.fn === 'merge_tasks').map((c) => c.count), [500, 500, 203]);
});

test('日程：同步途中换了账号会报错，不会把数据写进别人的账号', async () => {
  const cloud = new FakeCloud();
  const device = { userId: 'user-1' };
  const client = cloud.client(device);
  const original = client.rpc.bind(client);
  (client as any).rpc = async (...args: any[]) => { const r = await (original as any)(...args); device.userId = 'user-2'; return r; };
  await assert.rejects(syncTasks(client, [task('a')]), /账号发生变化/);
  assert.equal(cloud.rows('shiri_tasks', 'user-2').length, 0);
});

test('日程合并与顺序无关：先同步哪台设备结果都一样', () => {
  const a = [task('x', { title: 'A', updatedAt: stamp(1) }), task('y', { deletedAt: stamp(3), updatedAt: stamp(3) })];
  const b = [task('x', { title: 'B', updatedAt: stamp(2) }), task('y', { title: '改了但更早', updatedAt: stamp(2) })];
  assert.deepEqual(mergeTasks(a, b), mergeTasks(b, a));
  assert.equal(mergeTasks(a, b).find((t) => t.id === 'x')?.title, 'B');
  assert.ok(mergeTasks(a, b).find((t) => t.id === 'y')?.deletedAt);
});

test('日记：只上传比云端新的那天，同一天以较新为准', async () => {
  const cloud = new FakeCloud();
  const pc = cloud.client(), phone = cloud.client();
  const pcJournal = writeJournal(writeJournal([], '2026-10-25', '演示：电脑写的', T0), '2026-10-26', '演示：电脑先写', T0);
  await syncJournal(pc, 'user-1', pcJournal);
  assert.equal(cloud.calls.at(-1)?.count, 2);

  const phoneJournal = writeJournal(await syncJournal(phone, 'user-1', []) ?? [], '2026-10-26', '演示：手机后改', T0 + 60_000);
  cloud.calls.length = 0;
  await syncJournal(phone, 'user-1', phoneJournal);
  assert.deepEqual(cloud.calls, [{ fn: 'merge_journal', count: 1 }], '没改动的那天不重复上传');

  const merged = await syncJournal(pc, 'user-1', pcJournal);
  assert.equal(merged?.find((e) => e.date === '2026-10-26')?.text, '演示：手机后改');
  assert.equal(merged?.find((e) => e.date === '2026-10-25')?.text, '演示：电脑写的');
});

test('没建表（旧版云端）时各部分同步返回 null，本机数据保持不变', async () => {
  const cloud = new FakeCloud();
  for (const t of ['shiri_journal', 'shiri_reflections', 'shiri_weekly', 'shiri_timetable', 'shiri_lists']) cloud.missing.add(t);
  const c = cloud.client();
  assert.equal(await syncJournal(c, 'user-1', []), null);
  assert.equal(await syncReflections(c, 'user-1', []), null);
  assert.equal(await syncWeekly(c, 'user-1'), null);
  assert.equal(await syncTimetable(c, 'user-1', DEFAULT_TIMETABLE), null);
  assert.equal(await syncLists(c, 'user-1', 'k', []), null);
});

test('课表：本机较新就上传，云端较新就用云端，时间相同以云端为准', async () => {
  const cloud = new FakeCloud();
  const c = cloud.client();
  const older = { ...DEFAULT_TIMETABLE, updatedAt: stamp(1) };
  const newer = { ...DEFAULT_TIMETABLE, updatedAt: stamp(2), slots: DEFAULT_TIMETABLE.slots.slice(1) };
  assert.equal(await syncTimetable(c, 'user-1', newer), newer);
  const got = await syncTimetable(c, 'user-1', older);
  assert.equal(got?.updatedAt, newer.updatedAt);
  assert.equal(got?.slots.length, newer.slots.length);
  const sameTime = { ...newer, slots: DEFAULT_TIMETABLE.slots };
  assert.equal((await syncTimetable(c, 'user-1', sameTime))?.slots.length, newer.slots.length);
});

test('周次任务、课程状态、体重一起同步，较新的为准', async () => {
  const cloud = new FakeCloud();
  const pc = cloud.client(), phone = cloud.client();
  const weights = setWeight([], '2026-10-26', 70, T0);
  const slot = { id: 'mc', title: 'MC 讲课' };
  const classMarks = setClassMark([], slot, '2026-10-26', 'done', '', T0);
  await syncWeekly(pc, 'user-1', [], [], classMarks, weights);
  const later = setWeight(weights, '2026-10-26', 71, T0 + 60_000);
  await syncWeekly(phone, 'user-1', [], [], setClassMark(classMarks, slot, '2026-10-26', 'review', '', T0 + 60_000), later);
  const back = await syncWeekly(pc, 'user-1', [], [], classMarks, weights);
  assert.equal(back?.weights.find((w) => w.date === '2026-10-26')?.kg, 71);
  assert.equal(back?.classMarks[0].status, 'review');
});
