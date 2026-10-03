'use strict';

// These tests exercise the real main-process startup and IPC code in a VM.
// Every Electron and native-shell boundary is mocked: no window, notification,
// profile file, login setting, shortcut, or Windows desktop is actually changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

const sourceFile = path.join(__dirname, 'main.cjs');
const source = fs.readFileSync(sourceFile, 'utf8');

async function launch({ saved = {}, platform = 'win32', smoke = false, failAttach = false, hasLock = true, due = [], packaged = false } = {}) {
  const snoozes = [];
  const shortcuts_written = [];
  const loginItems = [];
  const windows = [];
  const helperCalls = [];
  const writes = [];
  const handlers = new Map();
  const startupErrors = [];
  const shortcuts = [];
  const timers = [];
  const trays = [];
  const userPaths = new Map([
    ['appData', path.join(__dirname, 'mock-profile-parent')],
    ['userData', path.join(__dirname, 'mock-profile')],
  ]);
  const app = Object.assign(new EventEmitter(), {
    isPackaged: packaged,
    setName() {},
    setAppUserModelId() {},
    setPath(name, value) { userPaths.set(name, value); },
    getPath(name) { return userPaths.get(name); },
    requestSingleInstanceLock() { return hasLock; },
    whenReady() { return Promise.resolve(); },
    quit() { this.quitCount = (this.quitCount || 0) + 1; },
    setLoginItemSettings(value) { if (!packaged) throw new Error('Startup must not change login settings.'); loginItems.push(value); },
  });

  class MockWindow extends EventEmitter {
    constructor(options) {
      super();
      this.id = windows.length + 1;
      this.options = options;
      this.visible = Boolean(options.show);
      this.destroyed = false;
      this.maximized = false;
      this.minimized = false;
      this.fullScreen = false;
      this.calls = [];
      this.webContents = Object.assign(new EventEmitter(), {
        id: this.id,
        mainFrame: { url: '' },
        session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} },
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler() {},
        send: (channel, value) => this.calls.push(['send', channel, value]),
        reload: () => this.calls.push(['reload']),
        getURL: () => this.webContents.mainFrame.url,
      });
      windows.push(this);
    }
    static getAllWindows() { return windows.filter(window => !window.destroyed); }
    static fromWebContents(contents) { return windows.find(window => window.webContents === contents); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    isMaximized() { return this.maximized; }
    isFullScreen() { return this.fullScreen; }
    setMenu() {}
    setOpacity(value) { this.opacity = value; this.calls.push(['setOpacity', value]); }
    setSkipTaskbar(value) { this.skipTaskbar = value; }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; }
    setFullScreen(value) { this.fullScreen = value; this.calls.push(['setFullScreen', value]); }
    setBounds(value) { this.bounds = value; }
    setPosition(...value) { this.position = value; }
    setSize(...value) { this.size = value; }
    setResizable(value) { this.resizable = value; }
    setMovable(value) { this.movable = value; }
    setFocusable(value) { this.focusable = value; }
    setIgnoreMouseEvents(value, options) { this.ignoreMouseEvents = value; this.calls.push(['setIgnoreMouseEvents', value, options]); }
    setVisibleOnAllWorkspaces() {}
    show() { this.visible = true; this.calls.push(['show']); }
    showInactive() { this.visible = true; this.calls.push(['showInactive']); }
    hide() { this.visible = false; this.calls.push(['hide']); }
    close() { this.destroy(); }
    focus() { this.calls.push(['focus']); }
    maximize() { this.maximized = true; this.calls.push(['maximize']); }
    unmaximize() { this.maximized = false; }
    restore() { this.minimized = false; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
    getNativeWindowHandle() {
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64LE(BigInt(this.id));
      return buffer;
    }
    async loadURL(url) {
      this.url = url;
      this.webContents.mainFrame.url = url;
      this.webContents.emit('did-finish-load');
    }
    async loadFile(file, options = {}) {
      const url = new URL(pathToFileURL(file).href);
      if (options.hash) url.hash = options.hash;
      await this.loadURL(url.href);
    }
  }

  class MockTray extends EventEmitter {
    constructor() { super(); trays.push(this); }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    destroy() {}
  }
  class MockNotification extends EventEmitter {
    static isSupported() { return true; }
    show() { throw new Error('No notification is expected during an empty startup.'); }
  }
  class MockReminderStore {
    takeDue() { return due.splice(0); }
    snooze(item, at) { snoozes.push({ id: item.id, title: item.title, at }); }
    sync(values) { return values.length; }
  }

  const electron = {
    app,
    BrowserWindow: MockWindow,
    ipcMain: { handle: (channel, action) => handlers.set(channel, action) },
    Menu: { buildFromTemplate: value => value },
    Tray: MockTray,
    nativeImage: { createFromBitmap: () => ({}) },
    shell: {
      readShortcutLink() { throw new Error('missing'); },
      writeShortcutLink(file, operation, options) { shortcuts_written.push({ file, operation, options }); return true; },
      beep() {},
    },
    Notification: MockNotification,
    globalShortcut: {
      register: (accelerator, action) => { shortcuts.push({ accelerator, action }); return true; },
      unregisterAll() {},
    },
    powerMonitor: new EventEmitter(),
    screen: Object.assign(new EventEmitter(), {
      dipToScreenRect: (_window, rect) => rect,
      getPrimaryDisplay: () => ({
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        workAreaSize: { width: 1920, height: 1040 },
        scaleFactor: 1,
      }),
    }),
  };
  const reminders = {
    ReminderStore: MockReminderStore,
    validateNotification: value => value,
    readJson: () => ({ ...saved }),
    writeJson: (file, value) => writes.push({ file, value: { ...value } }),
  };
  const childProcess = {
    execFile(executable, args, options, callback) {
      const action = args[args.indexOf('-Action') + 1];
      const hwnd = args[args.indexOf('-Hwnd') + 1];
      helperCalls.push({ executable, args, options, action, hwnd });
      const result = action === 'attach' && failAttach
        ? { ok: false, error: 'mock desktop attach unavailable' }
        : { ok: true, state: { hwnd, parent: '0', style: 1 }, host: 'MockWorkerW' };
      queueMicrotask(() => callback(null, JSON.stringify(result), ''));
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    require(name) {
      if (name === 'electron') return electron;
      if (name === './reminders.cjs') return reminders;
      if (name === 'node:child_process') return childProcess;
      if (name === 'node:fs') return { existsSync: () => false };
      if (['node:path', 'node:url'].includes(name)) return require(name);
      throw new Error(`Unexpected main-process dependency: ${name}`);
    },
    __dirname, __filename: sourceFile, module, exports: module.exports,
    process: {
      platform, pid: 100, resourcesPath: path.join(__dirname, 'mock-resources'),
      execPath: 'mock-electron.exe', env: smoke ? { SHIRI_SMOKE_TEST: '1' } : (packaged ? { PORTABLE_EXECUTABLE_FILE: 'D:\Apps\昱时.exe' } : {}),
    },
    Buffer, URL, URLSearchParams,
    setInterval: (action, interval) => { timers.push({ action, interval }); return timers.length; },
    clearInterval() {},
    setTimeout, clearTimeout,
    console: { error: (...values) => startupErrors.push(values.join(' ')), log() {}, warn() {} },
  }, { filename: sourceFile });

  // Let the real readiness, window loading and queued mode transitions settle.
  for (let turn = 0; turn < 12; turn++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(startupErrors, [], 'Application readiness must not fail');

  function trustedEvent(window) {
    return { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  }
  async function ipc(channel, window, ...values) {
    assert.ok(handlers.has(channel), `IPC channel ${channel} must be registered`);
    return handlers.get(channel)(trustedEvent(window), ...values);
  }
  return { windows, helperCalls, writes, handlers, shortcuts, timers, trays, userPaths, app, ipc, snoozes, shortcuts_written, loginItems, exports: module.exports };
}

const isWidget = window => window.options.frame === false && window.options.transparent === true;
const liveWindows = harness => harness.windows.filter(window => !window.destroyed);
const isCellEditor = window => window.options.title === '昱时 · 格内编辑' || window.options.title === '昱时 · 提醒';
const managerWindow = harness => liveWindows(harness).find(window => !isWidget(window) && !isCellEditor(window));
const sent = (window, channel) => window.calls.filter(call => call[0] === 'send' && call[1] === channel).map(call => call[2]);
const widgetWindow = harness => liveWindows(harness).find(isWidget);

test('Windows launches the desktop calendar even when an older release saved a window mode', async () => {
  const harness = await launch({ hasLock: false });
  const { resolveStartupMode } = harness.exports;
  assert.equal(resolveStartupMode(undefined, 'win32', false), 'desktop');
  assert.equal(resolveStartupMode('invalid', 'win32', false), 'desktop');
  assert.equal(resolveStartupMode('window', 'win32', false), 'desktop');
  assert.equal(resolveStartupMode('fullscreen', 'win32', false), 'desktop');
  assert.equal(resolveStartupMode('desktop', 'darwin', false), 'window');
  assert.equal(resolveStartupMode('desktop', 'win32', true), 'window');
  assert.equal(harness.windows.length, 0, 'A second instance must not create windows');
});

test('default startup shows only the transparent desktop widget; opening its manager preserves attachment', async () => {
  const harness = await launch();
  const widget = widgetWindow(harness);
  assert.ok(widget, 'A separate frameless transparent widget must be created');
  assert.equal(new URL(widget.url).hash, '#desktop');
  assert.equal(widget.visible, true);
  assert.equal(widget.skipTaskbar, true);
  assert.ok(liveWindows(harness).filter(window => !isWidget(window)).every(window => !window.visible), 'Management windows must stay hidden on desktop startup');
  assert.equal(harness.helperCalls.length, 1);
  assert.equal(harness.helperCalls[0].action, 'attach');
  assert.equal(harness.helperCalls[0].hwnd, String(widget.id), 'Only the desktop widget may be attached to the shell');
  assert.equal(harness.helperCalls[0].options.windowsHide, true);
  const attachArgs = harness.helperCalls[0].args;
  assert.equal(attachArgs[attachArgs.indexOf('-Width') + 1], '1920');
  assert.equal(attachArgs[attachArgs.indexOf('-Height') + 1], '1040');
  assert.equal(widget.ignoreMouseEvents, true, 'Blank calendar cells should pass clicks to Explorer');
  assert.ok(widget.calls.some(call => call[0] === 'setIgnoreMouseEvents' && call[1] === true && call[2]?.forward === true));
  assert.equal(harness.userPaths.get('userData'), path.join(__dirname, 'mock-profile-parent', '拾日'), 'Renaming must retain the existing calendar profile');

  const before = await harness.ipc('desktop:get-settings', widget);
  assert.equal(before.mode, 'desktop');
  assert.equal(before.startupMode, 'desktop');
  assert.equal(before.widgetSpan, 'twoWeeks');
  assert.equal(before.widgetSide, 'right');
  assert.equal(before.lastError, null);

  const opened = await harness.ipc('desktop:show-window', widget);
  assert.equal(opened.ok, true);
  const manager = managerWindow(harness);
  assert.ok(manager, 'Opening management must create or reveal a regular window');
  assert.equal(manager.visible, true);
  assert.equal(manager.maximized, true);
  assert.notEqual(new URL(manager.url).hash, '#desktop');
  assert.equal(widget.visible, true);
  assert.equal(widget.destroyed, false);
  assert.deepEqual(harness.helperCalls.map(call => call.action), ['attach'], 'Opening management must not detach the widget');
  const after = await harness.ipc('desktop:get-settings', manager);
  assert.equal(after.mode, 'desktop');
  assert.equal(after.startupMode, 'desktop');
  assert.equal(after.desktopHost, before.desktopHost);
  assert.equal(harness.writes.length, 0, 'Startup and opening management must not rewrite the preferred mode');
});

test('desktop week and two-week views keep the full work area and persist the selected range', async () => {
  const harness = await launch();
  const widget = widgetWindow(harness);
  const week = await harness.ipc('desktop:set-widget-span', widget, 'week');
  assert.equal(week.ok, true);
  assert.equal(week.widgetSpan, 'week');
  const weekPlace = harness.helperCalls.at(-1);
  assert.equal(weekPlace.action, 'place');
  assert.equal(weekPlace.args[weekPlace.args.indexOf('-Height') + 1], '1040');
  const left = await harness.ipc('desktop:set-widget-side', widget, 'left');
  assert.equal(left.ok, true);
  assert.equal(left.widgetSide, 'left');
  const leftPlace = harness.helperCalls.at(-1);
  assert.equal(leftPlace.args[leftPlace.args.indexOf('-Left') + 1], '0');
  assert.deepEqual(harness.writes.map(write => write.value.widgetSpan), ['week', 'week']);
  assert.deepEqual(harness.writes.map(write => write.value.widgetSide), ['right', 'left']);
  const refused = await harness.ipc('desktop:set-widget-span', widget, 'sixWeeks');
  assert.equal(refused.ok, false);
  assert.equal(harness.helperCalls.length, 3);
});

test('only the desktop calendar can enable controls while empty space passes clicks to Windows', async () => {
  const harness = await launch();
  const widget = widgetWindow(harness);
  assert.equal((await harness.ipc('desktop:set-calendar-interactive', widget, true)).ok, true);
  assert.equal(widget.ignoreMouseEvents, false);
  assert.equal((await harness.ipc('desktop:set-calendar-interactive', widget, false)).ok, true);
  assert.equal(widget.ignoreMouseEvents, true);
  assert.ok(widget.calls.at(-1)[2]?.forward);
  const manager = managerWindow(harness) || await (async () => {
    await harness.ipc('desktop:show-window', widget);
    return managerWindow(harness);
  })();
  assert.equal((await harness.ipc('desktop:set-calendar-interactive', manager, true)).ok, false);
  assert.equal((await harness.ipc('desktop:set-calendar-interactive', widget, 'true')).ok, false);
  assert.equal(widget.ignoreMouseEvents, true);
});

test('right-clicking a date cell forwards the desktop context menu without opening a window', async () => {
  const harness = await launch();
  const widget = widgetWindow(harness);
  const before = liveWindows(harness).length;
  const forwarded = await harness.ipc('desktop:pass-context-menu', widget);
  assert.equal(forwarded.ok, true);
  assert.equal(harness.helperCalls.at(-1).action, 'contextmenu');
  assert.equal(widget.ignoreMouseEvents, true);
  assert.equal(liveWindows(harness).length, before);
  assert.equal(widget.visible, true);
  const manager = await harness.ipc('desktop:show-window', widget);
  assert.equal(manager.ok, true);
  assert.equal((await harness.ipc('desktop:pass-context-menu', managerWindow(harness))).ok, false);
});

test('desktop editing reuses one prepared borderless layer and hands the mouse back when it closes', async () => {
  const harness = await launch();
  const widget = widgetWindow(harness);
  const prepared = liveWindows(harness).filter(isCellEditor);
  assert.equal(prepared.length, 1, 'The cell editor is loaded when the desktop calendar attaches');
  const editor = prepared[0];
  assert.equal(editor.visible, false);
  assert.equal(editor.options.frame, false);
  assert.equal(editor.options.skipTaskbar, true);
  assert.equal(new URL(editor.url).hash, '#cell-editor');

  const opened = await harness.ipc('desktop:open-inline-editor', widget, { date: '2026-09-30', rect: { x: 640, y: 84, width: 275, height: 420 } });
  assert.equal(opened.ok, true);
  assert.equal(liveWindows(harness).filter(isCellEditor).length, 1, 'Opening must not start another renderer');
  assert.deepEqual({ ...editor.bounds }, { x: 640, y: 84, width: 275, height: 204 });
  assert.deepEqual({ ...sent(editor, 'desktop:cell-editor-open').at(-1) }, { taskId: '', date: '2026-09-30', time: '', keepDraft: false, seq: 1 });
  assert.equal(editor.visible, false, 'The layer waits until the page has drawn the date');
  assert.equal((await harness.ipc('desktop:cell-editor-ready', editor)).ok, true);
  assert.equal(editor.visible, true);
  assert.ok(editor.calls.some(call => call[0] === 'focus'));
  assert.equal(widget.visible, true);

  assert.equal((await harness.ipc('desktop:resize-cell-editor', editor, true)).ok, true);
  assert.equal(editor.bounds.height, 382);
  assert.equal((await harness.ipc('desktop:resize-cell-editor', widget, true)).ok, false);
  assert.equal((await harness.ipc('desktop:cell-editor-ready', widget)).ok, false);

  // The reported bug: after closing with ×, the calendar must accept clicks again.
  assert.equal((await harness.ipc('desktop:set-calendar-interactive', widget, true)).ok, true);
  const resetsBefore = sent(widget, 'desktop:pointer-reset').length;
  assert.equal((await harness.ipc('desktop:close-editor', editor)).ok, true);
  assert.equal(editor.destroyed, false, 'Closing keeps the prepared layer for the next date');
  assert.equal(editor.visible, false);
  assert.equal(widget.ignoreMouseEvents, true);
  assert.ok(sent(widget, 'desktop:pointer-reset').length > resetsBefore, 'The calendar page must forget its cached mouse state');

  const second = await harness.ipc('desktop:open-inline-editor', widget, { taskId: 'task-1', date: '2026-10-02', rect: { x: 10, y: 1000, width: 150, height: 90 } });
  assert.equal(second.ok, true);
  assert.equal(liveWindows(harness).filter(isCellEditor).length, 1);
  assert.deepEqual({ ...editor.bounds }, { x: 10, y: 1040 - 204, width: 180, height: 204 }, 'The layer stays inside the work area');
  assert.deepEqual({ ...sent(editor, 'desktop:cell-editor-open').at(-1) }, { taskId: 'task-1', date: '2026-10-02', time: '', keepDraft: false, seq: 2 });
  await harness.ipc('desktop:cell-editor-ready', editor);
  assert.equal(editor.visible, true);
  await harness.ipc('desktop:open-inline-editor', widget, { date: '2026-10-03', rect: { x: 200, y: 84, width: 200, height: 200 } });
  assert.equal(sent(editor, 'desktop:cell-editor-open').at(-1).keepDraft, true, 'Switching dates keeps a visible draft');
  await harness.ipc('desktop:cell-editor-ready', editor);
  const stale = await harness.ipc('desktop:close-editor', editor, 2);
  assert.equal(stale.ok, true);
  assert.equal(editor.visible, true, 'A late close for the previous date must not hide the new one');

  const closeEvent = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  editor.emit('close', closeEvent);
  assert.equal(closeEvent.defaultPrevented, true, 'Alt+F4 hides instead of destroying the layer');
  assert.equal(editor.visible, false);
  assert.equal(editor.destroyed, false);

  const invalid = await harness.ipc('desktop:open-inline-editor', widget, { date: 'tomorrow', rect: { x: 0, y: 0, width: 10, height: 10 } });
  assert.equal(invalid.ok, false);
  await harness.ipc('desktop:show-window', widget);
  assert.equal((await harness.ipc('desktop:open-inline-editor', managerWindow(harness), { date: '2026-09-30', rect: { x: 0, y: 0, width: 200, height: 200 } })).ok, false);
  assert.equal((await harness.ipc('desktop:open-inline-editor', editor, { date: '2026-09-30', rect: { x: 0, y: 0, width: 200, height: 200 } })).ok, false);

  assert.equal((await harness.ipc('desktop:set-mode', widget, 'window')).ok, true);
  assert.equal(editor.destroyed, true, 'Leaving the desktop removes the prepared layer');
});

test('saved window and fullscreen preferences migrate to the desktop calendar on Windows', async t => {
  for (const startupMode of ['window', 'fullscreen']) {
    await t.test(startupMode, async () => {
      const harness = await launch({ saved: { startupMode } });
      const widget = widgetWindow(harness);
      assert.ok(widget?.visible);
      assert.equal(harness.helperCalls.length, 1);
      assert.equal(harness.helperCalls[0].action, 'attach');
      assert.ok(liveWindows(harness).filter(window => !isWidget(window)).every(window => !window.visible));
      const settings = await harness.ipc('desktop:get-settings', widget);
      assert.equal(settings.mode, 'desktop');
      assert.equal(settings.startupMode, 'desktop');
      assert.equal(harness.writes.length, 0);
    });
  }
});

test('explicit mode changes detach the old widget and reattach a fresh widget while preserving management', async () => {
  const harness = await launch();
  const originalWidget = widgetWindow(harness);
  assert.ok(originalWidget);

  const windowResult = await harness.ipc('desktop:set-mode', originalWidget, 'window');
  assert.equal(windowResult.ok, true);
  assert.equal(windowResult.mode, 'window');
  assert.equal(windowResult.startupMode, 'desktop');
  assert.equal(windowResult.desktopHost, null);
  assert.equal(originalWidget.destroyed, true);
  assert.equal(originalWidget.visible, false);
  assert.equal(widgetWindow(harness), undefined);
  const manager = managerWindow(harness);
  assert.ok(manager);
  assert.equal(manager.visible, true);
  assert.equal(manager.maximized, true);
  assert.deepEqual(harness.helperCalls.map(call => call.action), ['attach', 'detach']);
  assert.equal(harness.helperCalls[1].hwnd, String(originalWidget.id));
  const detachArgs = harness.helperCalls[1].args;
  const restoredState = JSON.parse(Buffer.from(detachArgs[detachArgs.indexOf('-StateBase64') + 1], 'base64').toString('utf8'));
  assert.equal(restoredState.hwnd, String(originalWidget.id), 'Detachment must use the state returned for the original widget');
  assert.deepEqual(harness.writes.map(write => write.value.startupMode), ['desktop']);

  const desktopResult = await harness.ipc('desktop:set-mode', manager, 'desktop');
  assert.equal(desktopResult.ok, true);
  assert.equal(desktopResult.mode, 'desktop');
  assert.equal(desktopResult.startupMode, 'desktop');
  assert.equal(desktopResult.lastError, null);
  const replacementWidget = widgetWindow(harness);
  assert.ok(replacementWidget);
  assert.notEqual(replacementWidget, originalWidget);
  assert.equal(new URL(replacementWidget.url).hash, '#desktop');
  assert.equal(replacementWidget.visible, true);
  assert.equal(replacementWidget.skipTaskbar, true);
  assert.equal(managerWindow(harness), manager, 'The existing manager must remain usable when enabling desktop mode');
  assert.equal(manager.destroyed, false);
  assert.equal(manager.visible, true);
  assert.deepEqual(harness.helperCalls.map(call => call.action), ['attach', 'detach', 'attach']);
  assert.equal(harness.helperCalls[2].hwnd, String(replacementWidget.id));
  assert.deepEqual(harness.writes.map(write => write.value.startupMode), ['desktop', 'desktop']);
  assert.equal((await harness.ipc('desktop:get-settings', replacementWidget)).surface, 'desktop');
  assert.equal((await harness.ipc('desktop:get-settings', manager)).surface, 'app');
});

test('opening the EXE again returns from temporary manager mode to the desktop calendar', async () => {
  const harness = await launch();
  const firstWidget = widgetWindow(harness);
  const windowResult = await harness.ipc('desktop:set-mode', firstWidget, 'window');
  assert.equal(windowResult.ok, true);
  const manager = managerWindow(harness);
  assert.equal(manager.visible, true);
  harness.app.emit('second-instance');
  for (let turn = 0; turn < 12; turn++) await new Promise(resolve => setImmediate(resolve));
  const nextWidget = widgetWindow(harness);
  assert.ok(nextWidget?.visible);
  assert.equal(manager.visible, false, 'Launching again must not leave the management window covering the calendar');
  assert.deepEqual(harness.helperCalls.map(call => call.action), ['attach', 'detach', 'attach']);
  assert.equal((await harness.ipc('desktop:get-settings', nextWidget)).startupMode, 'desktop');
});

test('smoke startup remains hidden in window mode and never calls the shell helper', async () => {
  const harness = await launch({ smoke: true, saved: { startupMode: 'desktop' } });
  const manager = managerWindow(harness);
  assert.ok(manager);
  assert.ok(harness.windows.every(window => !window.visible));
  assert.equal(harness.helperCalls.length, 0);
  assert.equal(harness.trays.length, 0);
  assert.equal(harness.shortcuts.length, 0);
  assert.equal(harness.timers.length, 0);
  assert.match(harness.userPaths.get('userData'), /desktop-smoke-profile$/);
  const settings = await harness.ipc('desktop:get-settings', manager);
  assert.equal(settings.mode, 'window');
  assert.equal(settings.startupMode, 'window');
  const refused = await harness.ipc('desktop:set-mode', manager, 'desktop');
  assert.equal(refused.ok, false);
  assert.equal(harness.helperCalls.length, 0);
  assert.ok(harness.windows.every(window => !window.visible));
  assert.equal(harness.writes.length, 0);
});

test('failed default attachment reveals a maximized manager, reports the failure, and preserves desktop preference', async () => {
  const harness = await launch({ failAttach: true });
  const manager = managerWindow(harness);
  assert.ok(manager);
  assert.equal(manager.visible, true);
  assert.equal(manager.maximized, true);
  assert.ok(liveWindows(harness).filter(isWidget).every(window => !window.visible), 'A failed desktop widget must not cover the fallback manager');
  const settings = await harness.ipc('desktop:get-settings', manager);
  assert.equal(settings.mode, 'window');
  assert.equal(settings.startupMode, 'desktop');
  assert.match(settings.lastError, /mock desktop attach unavailable/);
  assert.equal(settings.desktopHost, null);
  assert.equal(harness.helperCalls.filter(call => call.action === 'attach').length, 1, 'Recovery must not keep retrying desktop attachment');
  assert.equal(harness.writes.length, 0, 'A transient attachment failure must not overwrite the desktop startup preference');
});

test('desktop IPC rejects unknown senders and subframes before opening management', async () => {
  const harness = await launch();
  const widget = widgetWindow(harness);
  assert.ok(widget);
  const handler = harness.handlers.get('desktop:show-window');
  const unknown = await handler({ sender: {}, senderFrame: widget.webContents.mainFrame });
  assert.equal(unknown.ok, false);
  const subframe = await handler({ sender: widget.webContents, senderFrame: { url: widget.url } });
  assert.equal(subframe.ok, false);
  assert.ok(liveWindows(harness).filter(window => !isWidget(window)).every(window => !window.visible));
  assert.deepEqual(harness.helperCalls.map(call => call.action), ['attach']);
});

test('due reminders appear in a corner popup that can snooze for ten minutes', async () => {
  const before = Date.now();
  const harness = await launch({ due: [
    { id: 'meeting:2026-09-28:09:00', title: '周会', body: '10 分钟后开始 · 2026-09-28 09:00', at: before - 1000, late: false },
    { id: 'call:2026-09-28:09:30', title: '电话', body: '2026-09-28 09:30 · 昱时', at: before - 500, late: true },
  ] });
  for (let turn = 0; turn < 6; turn++) await new Promise(resolve => setImmediate(resolve));
  const popup = liveWindows(harness).find(window => window.options.title === '昱时 · 提醒');
  assert.ok(popup, 'A reminder popup is created');
  assert.equal(popup.visible, true);
  assert.equal(popup.options.skipTaskbar, true);
  assert.ok(popup.calls.some(call => call[0] === 'showInactive'), 'The popup must not steal keyboard focus');
  assert.ok(!popup.calls.some(call => call[0] === 'focus'));
  const items = sent(popup, 'reminder:items').at(-1);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '周会');
  assert.match(items[1].body, /^错过的提醒/);
  assert.equal(popup.bounds.x + popup.bounds.width, 1920 - 16);
  assert.equal(popup.bounds.y + popup.bounds.height, 1040 - 16);

  const widget = widgetWindow(harness);
  assert.equal((await harness.ipc('reminder:act', widget, items[0].key, 'snooze')).ok, false, 'Only the popup may answer reminders');
  assert.equal((await harness.ipc('reminder:act', popup, items[0].key, 'delete')).ok, false);
  assert.equal((await harness.ipc('reminder:act', popup, items[0].key, 'snooze')).ok, true);
  assert.equal(harness.snoozes.length, 1);
  assert.equal(harness.snoozes[0].title, '周会');
  assert.ok(harness.snoozes[0].at >= before + 10 * 60_000);
  assert.equal(sent(popup, 'reminder:items').at(-1).length, 1);
  assert.equal(popup.visible, true);
  assert.equal((await harness.ipc('reminder:act', popup, items[1].key, 'dismiss')).ok, true);
  assert.equal(popup.visible, false, 'The popup hides once every reminder is handled');
  assert.equal((await harness.ipc('reminder:act', popup, items[1].key, 'dismiss')).ok, false);
});

test('packaged Windows app adds a Start menu shortcut and turns on launch at login once', async () => {
  const harness = await launch({ packaged: true });
  assert.equal(harness.shortcuts_written.length, 1);
  const [shortcut] = harness.shortcuts_written;
  assert.ok(shortcut.file.endsWith(require("node:path").join("Start Menu", "Programs", "昱时.lnk")));
  assert.equal(shortcut.options.target, 'D:\Apps\昱时.exe', 'The shortcut points at the portable EXE, not its temporary unpack folder');
  assert.deepEqual(harness.loginItems.map(item => [item.openAtLogin, item.path, item.args.join(' ')]), [[true, 'D:\Apps\昱时.exe', '--autostart']]);
  const saved = harness.writes.at(-1).value;
  assert.equal(saved.autostart, true);
  assert.equal(saved.autostartDefaulted, true);

  const turnedOff = await launch({ packaged: true, saved: { autostart: false, autostartDefaulted: true } });
  assert.equal(turnedOff.loginItems.length, 0, 'Once the user turns it off it stays off');
  assert.equal(turnedOff.writes.length, 0);
});
