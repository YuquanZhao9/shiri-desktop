// 内存里的假 Supabase：只实现同步代码用到的那几个调用（from/select/eq/order/range/maybeSingle、rpc、auth.getUser）。
// 用来在测试里模拟“云端 + 多台设备”，不发任何网络请求。
import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeTasks } from '../src/core';
import type { Task } from '../src/types';

type Row = { user_id: string; key: string; kind?: string; payload: any };
const KEY: Record<string, (p: any) => string> = {
  shiri_tasks: (p) => p.id, shiri_lists: (p) => p.id, shiri_timetable: () => 'one',
  shiri_journal: (p) => p.date, shiri_reflections: (p) => p.id, shiri_weekly: (p) => p.id,
};
const newer = (a: any, b: any) => (a.updatedAt > b.updatedAt ? a : b);

export class FakeCloud {
  tables = new Map<string, Row[]>();
  calls: { fn: string; count: number }[] = [];
  /** 当成“还没运行建表脚本”的表，读取时返回错误。 */
  missing = new Set<string>();

  rows(table: string, userId: string) { return (this.tables.get(table) ?? []).filter((r) => r.user_id === userId); }
  payloads(table: string, userId = 'user-1') { return this.rows(table, userId).sort((a, b) => a.key.localeCompare(b.key)).map((r) => r.payload); }

  private upsert(table: string, userId: string, payload: any, kind?: string, keep = newer) {
    const list = this.tables.get(table) ?? [];
    const key = KEY[table](payload);
    const at = list.findIndex((r) => r.user_id === userId && r.key === key);
    if (at < 0) list.push({ user_id: userId, key, kind, payload });
    else list[at] = { ...list[at], payload: keep(payload, list[at].payload) };
    this.tables.set(table, list);
  }

  /** 一台设备的客户端；userId 可以在中途改掉，模拟同步时换了账号。 */
  client(device: { userId: string } = { userId: 'user-1' }): SupabaseClient {
    const cloud = this;
    const query = (table: string) => {
      let userId = '';
      let from = 0, to = Infinity;
      const result = () => {
        if (cloud.missing.has(table)) return { data: null, error: { message: `relation "${table}" does not exist`, code: '42P01' } };
        const rows = cloud.rows(table, userId).sort((a, b) => a.key.localeCompare(b.key)).slice(from, to + 1);
        return { data: rows.map((r) => ({ payload: r.payload, kind: r.kind })), error: null };
      };
      const q: any = {
        select: () => q, order: () => q,
        eq: (_col: string, value: string) => { userId = value; return q; },
        range: (a: number, b: number) => { from = a; to = b; return Promise.resolve(result()); },
        maybeSingle: () => { const r = result(); return Promise.resolve(r.error ? r : { data: r.data![0] ?? null, error: null }); },
        then: (ok: any, fail: any) => Promise.resolve(result()).then(ok, fail),
      };
      return q;
    };
    const rpc = async (fn: string, args: { incoming: any; expected_user: string }) => {
      if (args.expected_user !== device.userId) return { data: null, error: { message: 'Account changed during sync', code: '42501' } };
      const items = Array.isArray(args.incoming) ? args.incoming : [args.incoming];
      cloud.calls.push({ fn, count: items.length });
      const u = device.userId;
      if (fn === 'merge_tasks') {
        const merged = mergeTasks(items as Task[], cloud.payloads('shiri_tasks', u));
        cloud.tables.set('shiri_tasks', [...(cloud.tables.get('shiri_tasks') ?? []).filter((r) => r.user_id !== u), ...merged.map((p) => ({ user_id: u, key: p.id, payload: p }))]);
      } else if (fn === 'merge_lists') items.forEach((p) => cloud.upsert('shiri_lists', u, p, undefined, (a) => a));
      else if (fn === 'merge_timetable') items.forEach((p) => cloud.upsert('shiri_timetable', u, p));
      else if (fn === 'merge_journal') items.forEach((p) => cloud.upsert('shiri_journal', u, p));
      else if (fn === 'merge_reflections') items.forEach((p) => cloud.upsert('shiri_reflections', u, p));
      else if (fn === 'merge_weekly') items.forEach(({ kind, item }) => cloud.upsert('shiri_weekly', u, item, kind));
      else return { data: null, error: { message: `unknown rpc ${fn}` } };
      return { data: null, error: null };
    };
    return { from: query, rpc, auth: { getUser: async () => ({ data: { user: { id: device.userId } }, error: null }) } } as unknown as SupabaseClient;
  }
}
