import { test as base, expect, type Page } from '@playwright/test';

/** 固定在 2026-10-26（周一）07:30 柏林时间：课表、节假日、提醒都按这一天算。 */
export const TODAY = '2026-10-26';
export const NOW = new Date('2026-10-26T07:30:00+01:00');

type Fixtures = { network: { external: string[] } };

export const test = base.extend<Fixtures>({
  // 每个测试都自动生效：时间固定，并且记下、拦截所有发往本机开发服务器以外的请求。
  network: [async ({ page }, use) => {
    const external: string[] = [];
    await page.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
      external.push(route.request().url());
      return route.abort();
    });
    await page.clock.setFixedTime(NOW);
    await use({ external });
    expect(external.filter((url) => url.includes('supabase')), '测试中不应访问 Supabase').toEqual([]);
  }, { auto: true }],
});

export { expect };

/** 把本机保存的数据读出来（与应用使用同一个 localStorage 键）。 */
export async function savedData(page: Page, key = 'shiri-data:local'): Promise<any> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
}

/** 一条演示日程（字段与 src/types.ts 的 Task 一致）。 */
export function demoTask(patch: Record<string, unknown> = {}) {
  return { id: 'demo-1', title: '演示日程', date: TODAY, time: '09:00', duration: 60, listId: 'work', notes: '', priority: 'normal', repeat: 'none', completed: false, doneDates: [], createdAt: '2026-10-20T08:00:00.000Z', updatedAt: '2026-10-20T08:00:00.000Z', ...patch };
}

/** 打开页面前写入本机数据（只在这个测试的浏览器里）。 */
export async function seed(page: Page, tasks: unknown[], extra: Record<string, unknown> = {}, key = 'shiri-data:local') {
  const data = { version: 1, tasks, lists: [{ id: 'work', name: '工作', color: '#6D8DCA' }, { id: 'life', name: '生活', color: '#80A38F' }, { id: 'personal', name: '个人', color: '#BD96B8' }], ...extra };
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [key, JSON.stringify(data)] as const);
}
