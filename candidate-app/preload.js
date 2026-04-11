const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('truveil', {
  startSession: (data) => ipcRenderer.invoke('session:start', data),
  endSession: () => ipcRenderer.invoke('session:end'),
  quit: () => ipcRenderer.invoke('app:quit'),

  onFocusLost: (cb) => ipcRenderer.on('focus-lost', cb),
  onFocusGained: (cb) => ipcRenderer.on('focus-gained', cb),
  onShortcutBlocked: (cb) => ipcRenderer.on('shortcut-blocked', cb)
});
