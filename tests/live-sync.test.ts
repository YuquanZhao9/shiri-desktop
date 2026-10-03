import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRemoteLists, planListSync } from '../src/live-sync.ts';

test('清单同步只上传本机改过的，占位名不覆盖云端', () => {
  const remote = [{ id: 'work', name: '工作', color: '#6D8DCA' }, { id: 'abc', name: '读书', color: '#80A38F' }];
  const local = [{ id: 'work', name: '工作项目', color: '#6D8DCA' }, { id: 'abc', name: '同步清单 4', color: '#6D8DCA' }, { id: 'n1', name: '健身', color: '#BD96B8' }];
  const snapshot = new Map([['work', JSON.stringify({ id: 'work', name: '工作', color: '#6D8DCA' })]]);
  assert.deepEqual(planListSync(local, remote, snapshot).map(l => l.id), ['work', 'n1']);
  assert.deepEqual(applyRemoteLists(local, remote).map(l => l.name), ['工作', '读书', '健身']);
});
