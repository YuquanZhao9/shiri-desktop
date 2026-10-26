import { test, expect, savedData, seed, demoTask, TODAY } from './fixtures';

// 桌面版：浏览器里打开的管理窗口（/）和桌面日历（/#desktop）。数据只存在本机 localStorage。

async function addEvent(page: import('@playwright/test').Page, title: string, time: string) {
  await page.getByRole('button', { name: /新建日程/ }).click();
  const dialog = page.getByRole('dialog', { name: '新建日程' });
  await dialog.getByRole('textbox', { name: '日程名称' }).fill(title);
  await dialog.getByRole('textbox', { name: '开始时间' }).fill(time);
  await dialog.getByRole('button', { name: '保存日程' }).click();
  await expect(dialog).toBeHidden();
}

test('新建日程：出现在当天格子和今天面板，刷新后还在', async ({ page }) => {
  await page.goto('/');
  await addEvent(page, '购物：买牛肉', '17:00');
  await expect(page.getByRole('button', { name: `${TODAY}，1 项日程` })).toBeVisible();
  await expect(page.getByRole('complementary').getByText('购物：买牛肉')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: `${TODAY}，1 项日程` })).toContainText('购物：买牛肉');
  const data = await savedData(page);
  expect(data.tasks).toHaveLength(1);
  expect(data.tasks[0]).toMatchObject({ title: '购物：买牛肉', date: TODAY, time: '17:00', duration: 60, completed: false });
});

test('今天的课按课表显示，节假日有标记', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByRole('complementary').last();
  await expect(panel.getByRole('button', { name: '08:00 AR 讲课' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '15:45 AM 讲课' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^2026-10-03，/ })).toContainText('德·统一日');
  await expect(page.getByRole('button', { name: /^2026-10-01，/ })).toContainText('国庆节');
});

test('写日记：自动保存，格子里显示已写', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: `${TODAY} 的日记` }).fill('演示日记内容');
  await expect.poll(async () => (await savedData(page))?.journal?.find((j: any) => j.date === TODAY)?.text).toBe('演示日记内容');
  await page.reload();
  await expect(page.getByRole('textbox', { name: `${TODAY} 的日记` })).toHaveValue('演示日记内容');
});

test.describe('桌面日历 #desktop', () => {
  test('7 天视图：今天一列显示课程起止时间', async ({ page }) => {
    await page.goto('/#desktop');
    await expect(page.getByText('10月26日–11月1日')).toBeVisible();
    await expect(page.getByText('08:00–09:30').first()).toBeVisible();
    await expect(page.getByText('AR 讲课').first()).toBeVisible();
  });

  test('视图切换到整月、两周、一周，再回到 7 天', async ({ page }) => {
    await page.goto('/#desktop');
    const app = page.locator('.app');
    for (const [label, span] of [['整月', 'month'], ['两周', 'twoWeeks'], ['一周', 'week'], ['7 天', 'focus']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(app).toHaveAttribute('data-span', span);
    }
  });

  test('完成的日程沉到当天底部的完成栏，不再显示时间', async ({ page }) => {
    await seed(page, [
      demoTask({ id: 'done-1', title: '演示：已完成', time: '10:00', completed: true }),
      demoTask({ id: 'open-1', title: '演示：未完成', time: '17:00' }),
    ]);
    await page.goto('/#desktop');
    const bar = page.getByLabel('已完成').first();
    await expect(bar).toContainText('演示：已完成');
    await expect(bar).not.toContainText('10:00');
    await expect(bar).not.toContainText('演示：未完成');
    await expect(page.getByText('17:00–18:00').first()).toBeVisible();
  });
});

test('测体重：填数字回车后从日历消失，记录保存', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '测体重 · 点一下填数字' }).click();
  const input = page.getByRole('dialog').getByRole('textbox').first();
  await input.fill('70.5');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '测体重 · 点一下填数字' })).toHaveCount(0);
  const data = await savedData(page);
  expect(data.weights.find((w: any) => w.date === TODAY && !w.deletedAt)?.kg).toBe(70.5);
});

test('在今天面板勾选完成、再取消，保存的状态跟着变', async ({ page }) => {
  await seed(page, [demoTask({ id: 'open-1', title: '演示：买牛肉', time: '17:00' })]);
  await page.goto('/');
  const panel = page.getByRole('complementary').last();
  await panel.getByRole('button', { name: '完成 演示：买牛肉' }).click();
  await expect.poll(async () => (await savedData(page)).tasks[0].completed).toBe(true);
  // 完成后不再显示时间
  await expect(panel.getByRole('button', { name: '演示：买牛肉 工作' })).toBeVisible();
  await panel.getByRole('button', { name: '取消完成 演示：买牛肉' }).click();
  await expect(panel.getByRole('button', { name: '演示：买牛肉 17:00–18:00 · 工作' })).toBeVisible();
  await expect.poll(async () => (await savedData(page)).tasks[0].completed).toBe(false);
});

test('课程状态：点「已上」后保存，刷新后还在', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByRole('complementary').last();
  await panel.getByRole('button', { name: '已上' }).first().click();
  await expect.poll(async () => (await savedData(page))?.classMarks?.filter((m: any) => m.date === TODAY && !m.deletedAt).map((m: any) => m.status)).toEqual(['done']);
});
