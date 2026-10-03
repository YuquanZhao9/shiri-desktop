'use strict';

// Run from the project root: node desktop/smoke.cjs [path-to-electron.exe]
// The app stays hidden and uses work/desktop-smoke-profile, never the real profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');

const project = path.resolve(__dirname, '..');
const work = path.resolve(project, '..', '..', 'work');
const executablePath = process.argv[2] || require('electron');
const environment = { ...process.env, SHIRI_SMOKE_TEST: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.SHIRI_DEV_URL;
const errors = [];
let application;

(async () => {
  fs.mkdirSync(work, { recursive: true });
  application = await _electron.launch({ executablePath, args: [project, '--disable-gpu'], env: environment, timeout: 30_000 });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForSelector('.calendar-body', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.desktop));
  const main = await application.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const prefs = window.webContents.getLastWebPreferences();
    return {
      packaged: app.isPackaged, userData: app.getPath('userData'), visible: window.isVisible(),
      contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration,
      entry: window.webContents.getURL(),
    };
  });
  assert.equal(main.visible, false, 'smoke test must not display a native window');
  assert.equal(main.contextIsolation, true);
  assert.equal(main.sandbox, true);
  assert.equal(main.nodeIntegration, false);
  assert.equal(path.resolve(main.userData), path.join(work, 'desktop-smoke-profile'));
  assert.ok(main.entry.startsWith('file:') && main.entry.endsWith('/dist/index.html'));
  const renderer = await page.evaluate(async () => ({
    settings: await window.desktop.getSettings(),
    queue: await window.desktop.syncReminders([]),
    invalidQueue: await window.desktop.syncReminders([{ id: 'bad', title: 'Invalid', at: -1 }]),
    api: Object.keys(window.desktop).sort(),
    require: typeof window.require,
    nodeProcess: typeof window.process,
  }));
  assert.equal(renderer.settings.mode, 'window');
  assert.equal(renderer.settings.shortcutRegistered, false);
  assert.equal(renderer.queue.ok, true);
  assert.equal(renderer.queue.count, 0);
  assert.equal(renderer.invalidQueue.ok, false);
  assert.equal(renderer.require, 'undefined');
  assert.equal(renderer.nodeProcess, 'undefined');
  assert.deepEqual(renderer.api, ['cellEditorReady', 'closeEditor', 'getSettings', 'notify', 'onCellEditorBlur', 'onCellEditorOpen', 'onModeChanged', 'onPointerReset', 'openEditor', 'openInlineEditor', 'passDesktopContextMenu', 'resizeCellEditor', 'setAutostart', 'setCalendarInteractive', 'setMode', 'setOpacity', 'setWidgetSide', 'setWidgetSpan', 'showWindow', 'syncReminders']);
  await page.getByRole('button', { name: '时间表', exact: true }).click();
  await page.waitForSelector('.timeline', { state: 'attached' });
  await page.getByRole('button', { name: '月历', exact: true }).click();
  await page.waitForSelector('.month-grid', { state: 'attached' });
  const editorWait = application.waitForEvent('window');
  const editorResult = await page.evaluate(() => window.desktop.openEditor({ date: '2026-09-20', time: '09:30' }));
  assert.equal(editorResult.ok, true);
  const editorPage = await editorWait;
  await editorPage.getByRole('textbox', { name: '日程名称' }).fill('桌面输入测试');
  await editorPage.getByRole('textbox', { name: '备注' }).fill('输入框可编辑');
  assert.equal(await editorPage.getByRole('textbox', { name: '日程名称' }).inputValue(), '桌面输入测试');
  assert.equal(await editorPage.getByRole('textbox', { name: '备注' }).inputValue(), '输入框可编辑');
  const editorClosed = editorPage.waitForEvent('close');
  await editorPage.evaluate(() => setTimeout(() => document.querySelector('.task-modal button[type="submit"]').click(), 0));
  await editorClosed;
  const savedTask = await page.evaluate(() => JSON.parse(localStorage.getItem('shiri-data:local') || '{}').tasks?.find(task => task.title === '桌面输入测试'));
  assert.equal(savedTask?.notes, '输入框可编辑');
  await page.goto(`${main.entry}#desktop`);
  await page.reload();
  await page.waitForSelector('.widget-span-switch', { state: 'attached' });
  await page.evaluate(() => window.desktop.setWidgetSpan('twoWeeks'));
  await page.waitForFunction(() => document.querySelectorAll('.day-cell').length === 14);
  assert.equal(await page.locator('.day-cell').count(), 14);
  await page.getByRole('button', { name: '一周' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.day-cell').length === 7);
  assert.equal(await page.locator('.day-cell').count(), 7);
  await page.getByRole('button', { name: '整月' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.day-cell').length === 42);
  assert.equal(await page.locator('.day-cell').count(), 42);
  await page.getByRole('button', { name: '两周' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.day-cell').length === 14);
  assert.equal(await page.locator('.day-cell').count(), 14);
  const targetDate = await page.locator('.day-cell').nth(1).getAttribute('data-date');
  // The isolated profile keeps earlier runs, so titles are unique per run.
  const run = Date.now().toString(36);
  const firstTitle = `桌面格内双击编辑测试 ${run}`;
  const reopenTitle = `关闭后再次双击 ${run}`;
  const cellRect = await page.locator('.day-cell').nth(1).boundingBox();
  const windowCount = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const inlineWait = application.waitForEvent('window');
  let started = Date.now();
  await page.locator('.day-cell').nth(1).dblclick({ position: { x: 90, y: 130 } });
  const inlinePage = await inlineWait;
  inlinePage.on('pageerror', (error) => errors.push(`cell editor: ${error.message}`));
  inlinePage.on('console', (message) => { if (message.type() === 'error') errors.push(`cell editor: ${message.text()}`); });
  const inlineEditor = inlinePage.locator('.cell-editor-surface .desktop-inline-editor');
  await inlineEditor.waitFor({ state: 'visible' });
  const firstOpenMs = Date.now() - started;
  assert.equal(await inlineEditor.locator('input[type="date"]').count(), 0, 'date and other details stay under 更多');
  assert.equal(await inlineEditor.getByRole('textbox', { name: '备注' }).count(), 1, 'notes are editable without opening 更多');
  assert.equal(await inlinePage.locator('.modal-overlay').count(), 0);
  const inlineBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#cell-editor'))?.getBounds());
  assert.ok(inlineBounds, 'inline editor is a focusable overlay aligned to the date cell');
  assert.ok(Math.abs(inlineBounds.x - cellRect.x) <= 2);
  assert.ok(Math.abs(inlineBounds.y - cellRect.y) <= 2);
  assert.ok(Math.abs(inlineBounds.width - Math.max(180, cellRect.width)) <= 6);
  await inlineEditor.getByRole('button', { name: '更多' }).click();
  assert.equal(await inlineEditor.locator('input[type="date"]').inputValue(), targetDate);
  await inlineEditor.getByRole('textbox', { name: '日程名称' }).fill(firstTitle);
  await inlineEditor.getByRole('textbox', { name: '备注' }).fill(`格内备注 ${run}`);
  await inlineEditor.getByRole('button', { name: '保存' }).click();
  await inlineEditor.waitFor({ state: 'detached' });
  assert.equal(await windowCount(), 2, 'the prepared cell editor stays loaded for the next date');
  await page.waitForFunction((title) => JSON.parse(localStorage.getItem('shiri-data:local') || '{}').tasks?.some(task => task.title === title), firstTitle);
  const inlineSaved = await page.evaluate((title) => JSON.parse(localStorage.getItem('shiri-data:local') || '{}').tasks?.find(task => task.title === title), firstTitle);
  assert.equal(inlineSaved?.date, targetDate);
  assert.equal(inlineSaved?.notes, `格内备注 ${run}`);
  await page.waitForFunction((text) => [...document.querySelectorAll('.calendar-event .event-notes')].some(item => item.textContent === text), `格内备注 ${run}`);
  // Reported bug: after dismissing with ×, double-clicking another date must still edit it.
  started = Date.now();
  await page.locator('.day-cell').nth(3).dblclick({ position: { x: 90, y: 130 } });
  await inlineEditor.waitFor({ state: 'visible' });
  const reopenMs = Date.now() - started;
  await inlineEditor.getByRole('button', { name: '取消编辑' }).click();
  await inlineEditor.waitFor({ state: 'detached' });
  const afterCloseDate = await page.locator('.day-cell').nth(4).getAttribute('data-date');
  await page.locator('.day-cell').nth(4).dblclick({ position: { x: 90, y: 130 } });
  await inlineEditor.waitFor({ state: 'visible' });
  await inlineEditor.getByRole('textbox', { name: '日程名称' }).fill(reopenTitle);
  await inlineEditor.getByRole('textbox', { name: '日程名称' }).press('Enter');
  await page.waitForFunction(([title, date]) => JSON.parse(localStorage.getItem('shiri-data:local') || '{}').tasks?.some(task => task.title === title && task.date === date), [reopenTitle, afterCloseDate]);
  const existingWait = inlineEditor.waitFor({ state: 'visible' });
  await page.locator('.day-cell').nth(4).locator('.calendar-event', { hasText: reopenTitle }).dblclick();
  await existingWait;
  assert.equal(await inlineEditor.getByRole('textbox', { name: '日程名称' }).inputValue(), reopenTitle, 'double-clicking an event edits it in its cell');
  await inlineEditor.getByRole('textbox', { name: '日程名称' }).press('Escape');
  await inlineEditor.waitFor({ state: 'detached' });
  assert.equal(await windowCount(), 2, 'no extra window was created for later edits');
  const doneEvent = page.locator('.day-cell').nth(4).locator('.calendar-event', { hasText: reopenTitle });
  await doneEvent.click();
  await page.waitForFunction((title) => JSON.parse(localStorage.getItem('shiri-data:local') || '{}').tasks?.some(task => task.title === title && task.completed), reopenTitle);
  await page.waitForFunction((title) => [...document.querySelectorAll('.calendar-event.done')].some(item => item.textContent.includes(title)), reopenTitle);
  assert.equal(await inlineEditor.count(), 0, 'a single click marks done without opening the editor');
  assert.equal(await page.locator('.desktop-hours').count(), 0, 'the hours panel never opens on the desktop');
  await doneEvent.click();
  await page.waitForFunction((title) => JSON.parse(localStorage.getItem('shiri-data:local') || '{}').tasks?.some(task => task.title === title && !task.completed), reopenTitle);
  console.log(JSON.stringify({ cellEditorFirstOpenMs: firstOpenMs, cellEditorReopenMs: reopenMs }));
  const bounds = await page.evaluate(() => {
    const app = document.querySelector('.desktop-calendar').getBoundingClientRect();
    const grid = document.querySelector('.month-grid').getBoundingClientRect();
    const strip = document.querySelector('.timetable-strip')?.getBoundingClientRect();
    return { app: { x: app.x, y: app.y, width: app.width, height: app.height }, grid: { x: grid.x, right: grid.right, bottom: strip ? strip.bottom : grid.bottom, stripTop: strip ? strip.top : null, gridBottom: grid.bottom }, viewport: { width: innerWidth, height: innerHeight } };
  });
  assert.equal(bounds.app.x, 0);
  assert.equal(bounds.app.y, 0);
  assert.equal(bounds.app.width, bounds.viewport.width);
  assert.equal(bounds.app.height, bounds.viewport.height);
  assert.equal(bounds.grid.x, 0);
  assert.equal(bounds.grid.right, bounds.viewport.width);
  assert.equal(bounds.grid.bottom, bounds.viewport.height);
  assert.equal(bounds.grid.stripTop, null, 'classes live inside the date cells, not in a bottom strip');
  // Semester weeks show each weekday's classes by period inside the date cell.
  await page.getByRole('button', { name: '下一段' }).click();
  await page.waitForSelector('[data-date="2026-10-12"] .cell-classes', { state: 'attached' });
  const mondayClasses = await page.evaluate(() => [...document.querySelectorAll('[data-date="2026-10-12"] .class-period')].map(row => ({ empty: row.classList.contains('empty'), chips: [...row.querySelectorAll('.class-chip')].map(chip => chip.textContent) })));
  assert.equal(mondayClasses.length, 5);
  assert.deepEqual(mondayClasses[0].chips, ['AR 讲课', 'MC 讲课']);
  assert.equal(mondayClasses[1].empty, true);
  assert.equal(await page.locator('[data-date="2026-10-16"] .cell-classes').count(), 0, 'no classes on Friday');
  assert.equal(await page.locator('[data-date="2026-10-11"] .cell-classes').count(), 0, 'nothing before the semester');
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('#desktop'));
    window.setMinimumSize(560, 240);
    window.setBounds({ x: 100, y: 100, width: 1440, height: 900 });
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const screenshot = path.join(work, 'desktop-widget-smoke.png');
  const screenshotBase64 = await application.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('#desktop'));
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return image.toPNG().toString('base64');
  });
  fs.writeFileSync(screenshot, Buffer.from(screenshotBase64, 'base64'));
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('#desktop')).isVisible()), false);
  assert.deepEqual(errors, [], 'renderer should have no runtime or console errors');
  const report = { ok: true, main, renderer, errors, screenshot, testedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(work, 'desktop-smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (application) await application.close();
});
