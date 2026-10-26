import { test, expect, savedData, seed, demoTask, TODAY } from './fixtures';

// iPhone 网页版（PWA）：手机尺寸、触屏，只用本机数据。

const quickAdd = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: '添加日程，如“15:00 开会”' });
const dayList = (page: import('@playwright/test').Page) => page.getByRole('main').getByRole('list').first();

test('快速添加「15:00 开会」：识别时间，刷新后还在', async ({ page }) => {
  await page.goto('/');
  await quickAdd(page).fill('15:00 开会');
  await quickAdd(page).press('Enter');
  await expect(dayList(page).getByRole('button', { name: '开会 15:00–16:00 工作' })).toBeVisible();

  await page.reload();
  await expect(dayList(page).getByRole('button', { name: '开会 15:00–16:00 工作' })).toBeVisible();
  const data = await savedData(page);
  expect(data.tasks).toHaveLength(1);
  expect(data.tasks[0]).toMatchObject({ title: '开会', date: TODAY, time: '15:00', completed: false });
});

test('当天列表按时间排序，课程夹在日程中间', async ({ page }) => {
  await seed(page, [demoTask({ id: 'a', title: '演示：晚上', time: '19:00' }), demoTask({ id: 'b', title: '演示：中午', time: '12:00' })]);
  await page.goto('/');
  const items = dayList(page).getByRole('listitem');
  const texts = (await items.allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  const order = ['AR 讲课', '演示：中午', 'AM 讲课', '演示：晚上'].map((name) => texts.findIndex((t) => t.includes(name)));
  expect(order.every((i) => i >= 0), texts.join(' | ')).toBe(true);
  expect([...order].sort((x, y) => x - y)).toEqual(order);
});

test('标为完成后沉到最下面，不显示时间；取消后回到原位', async ({ page }) => {
  await seed(page, [demoTask({ id: 'a', title: '演示：早上', time: '07:00' })]);
  await page.goto('/');
  const list = dayList(page);
  await list.getByRole('listitem').filter({ hasText: '演示：早上' }).getByRole('button', { name: '标为完成' }).click();
  await expect.poll(async () => (await savedData(page)).tasks[0].completed).toBe(true);
  const done = list.getByRole('listitem').filter({ hasText: '演示：早上' });
  await expect(done).not.toContainText('07:00');
  const texts = await list.getByRole('listitem').allInnerTexts();
  expect(texts.findIndex((t) => t.includes('演示：早上'))).toBe(texts.length - 1);

  await done.getByRole('button', { name: /完成/ }).first().click();
  await expect.poll(async () => (await savedData(page)).tasks[0].completed).toBe(false);
  await expect(list.getByRole('button', { name: '演示：早上 07:00–08:00 工作' })).toBeVisible();
  const after = await list.getByRole('listitem').allInnerTexts();
  expect(after.findIndex((t) => t.includes('演示：早上'))).toBeLessThan(after.findIndex((t) => t.includes('AR 讲课')));
});

test('月历：节假日和课程都标在格子上', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^1 休 国庆节/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^3 休 统一日/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^26 十七 .*AR 讲课/ })).toBeVisible();
  // 周六没课
  await expect(page.getByRole('button', { name: /^31 廿二$/ })).toBeVisible();
});

test('测体重：在列表里直接填 kg，填完就不再出现', async ({ page }) => {
  await page.goto('/');
  const kg = dayList(page).getByRole('textbox', { name: 'kg' });
  await kg.fill('70.5');
  await kg.press('Enter');
  await expect.poll(async () => (await savedData(page))?.weights?.find((w: any) => w.date === TODAY)?.kg).toBe(70.5);
  await expect(dayList(page).getByRole('textbox', { name: 'kg' })).toHaveCount(0);
});

test('课表页列出每周的课程和起止时间', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: '课表' }).click();
  await expect(page.getByRole('heading', { name: '课表' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^AM 讲课 15:45–17:15/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^SASP 讲课 11:30–13:00/ })).toBeVisible();
});

test('日记：写今天，保存在本机，日历上显示已写', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: '日记' }).click();
  await page.getByRole('button', { name: '写今天' }).click();
  await page.getByRole('textbox').first().fill('演示日记内容');
  await expect.poll(async () => (await savedData(page))?.journal?.find((j: any) => j.date === TODAY)?.text).toBe('演示日记内容');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: /^10月26日周一 .*演示日记内容/ })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: '日历' }).click();
  await expect(page.getByRole('button', { name: /^日记 还没写/ })).toHaveCount(0);
});
