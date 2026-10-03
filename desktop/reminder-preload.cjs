'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The reminder popup can only list its items and answer them.
contextBridge.exposeInMainWorld('reminderPopup', Object.freeze({
  onItems: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, items) => callback(items);
    ipcRenderer.on('reminder:items', listener);
    return () => ipcRenderer.removeListener('reminder:items', listener);
  },
  act: (key, action) => ipcRenderer.invoke('reminder:act', key, action),
}));
