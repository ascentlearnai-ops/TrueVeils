const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('truveil', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),

  // Session
  createSession: (data) => ipcRenderer.invoke('session:create', data),
  updateSession: (data) => ipcRenderer.invoke('session:update', data),
  startSession: () => ipcRenderer.invoke('session:start'),
  endSession: () => ipcRenderer.invoke('session:end'),

  // Live analysis
  analyzeTranscript: (data) => ipcRenderer.invoke('analyze:transcript', data),
  addFlag: (data) => ipcRenderer.invoke('flag:add', data),
  onRealtimeTranscript: (cb) => ipcRenderer.on('realtime:transcript', (_, data) => cb(data)),
  onRealtimeFlag: (cb) => ipcRenderer.on('realtime:flag', (_, data) => cb(data)),
  onRealtimeStatus: (cb) => ipcRenderer.on('realtime:status', (_, data) => cb(data)),

  // Misc
  copyLink: (text) => ipcRenderer.invoke('clipboard:write', text),
  openReportsFolder: () => ipcRenderer.invoke('report:openFolder'),
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
});
