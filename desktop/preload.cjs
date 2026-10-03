'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Deliberately expose named operations only, never ipcRenderer or arbitrary channels.
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  setMode: (mode) => ipcRenderer.invoke('desktop:set-mode', mode),
  setWidgetSpan: (span) => ipcRenderer.invoke('desktop:set-widget-span', span),
  setWidgetSide: (side) => ipcRenderer.invoke('desktop:set-widget-side', side),
  setCalendarInteractive: (interactive) => ipcRenderer.invoke('desktop:set-calendar-interactive', interactive),
  passDesktopContextMenu: () => ipcRenderer.invoke('desktop:pass-context-menu'),
  openEditor: (request) => ipcRenderer.invoke('desktop:open-editor', request),
  openInlineEditor: (request) => ipcRenderer.invoke('desktop:open-inline-editor', request),
  closeEditor: (seq) => ipcRenderer.invoke('desktop:close-editor', typeof seq === 'number' ? seq : undefined),
  cellEditorReady: () => ipcRenderer.invoke('desktop:cell-editor-ready'),
  resizeCellEditor: (expanded) => ipcRenderer.invoke('desktop:resize-cell-editor', expanded),
  setOpacity: (opacity) => ipcRenderer.invoke('desktop:set-opacity', opacity),
  setAutostart: (enabled) => ipcRenderer.invoke('desktop:set-autostart', enabled),
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  notify: (notification) => ipcRenderer.invoke('desktop:notify', notification),
  syncReminders: (reminders) => ipcRenderer.invoke('desktop:sync-reminders', reminders),
  showWindow: () => ipcRenderer.invoke('desktop:show-window'),
  onModeChanged: (callback) => subscribe('desktop:mode-changed', callback),
  onCellEditorOpen: (callback) => subscribe('desktop:cell-editor-open', callback),
  onCellEditorBlur: (callback) => subscribe('desktop:cell-editor-blur', callback),
  onPointerReset: (callback) => subscribe('desktop:pointer-reset', callback),
}));
