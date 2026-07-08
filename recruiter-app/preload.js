const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('truveil', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getAuth: () => ipcRenderer.invoke('auth:get'),
  sendSignInLink: (email) => ipcRenderer.invoke('auth:send-link', email),
  verifySignInCode: (data) => ipcRenderer.invoke('auth:verify-code', data),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  onAuthChanged: (cb) => ipcRenderer.on('auth:changed', (_, data) => cb(data)),
  onAuthError: (cb) => ipcRenderer.on('auth:error', (_, data) => cb(data)),

  // Session
  createSession: (data) => ipcRenderer.invoke('session:create', data),
  updateSession: (data) => ipcRenderer.invoke('session:update', data),
  startSession: () => ipcRenderer.invoke('session:start'),
  endSession: () => ipcRenderer.invoke('session:end'),
  addSessionNote: (data) => ipcRenderer.invoke('session:note', data),

  // Live analysis
  analyzeTranscript: (data) => ipcRenderer.invoke('analyze:transcript', data),
  addFlag: (data) => ipcRenderer.invoke('flag:add', data),
  sendCandidateAction: (data) => ipcRenderer.invoke('candidate:action', data),
  getAudioChunk: (data) => ipcRenderer.invoke('audio:get', data),
  onRealtimeInterimTranscript: (cb) => ipcRenderer.on('realtime:transcript-interim', (_, data) => cb(data)),
  onRealtimeTranscript: (cb) => ipcRenderer.on('realtime:transcript', (_, data) => cb(data)),
  onRealtimeFlag: (cb) => ipcRenderer.on('realtime:flag', (_, data) => cb(data)),
  onRealtimeStatus: (cb) => ipcRenderer.on('realtime:status', (_, data) => cb(data)),
  onRealtimeAudioChunk: (cb) => ipcRenderer.on('realtime:audio-chunk', (_, data) => cb(data)),
  onRealtimeAudioLevel: (cb) => ipcRenderer.on('realtime:audio-level', (_, data) => cb(data)),
  onRealtimeAudioStatus: (cb) => ipcRenderer.on('realtime:audio-status', (_, data) => cb(data)),

  // Misc
  copyLink: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openReportsFolder: () => ipcRenderer.invoke('report:openFolder'),
  listReports: () => ipcRenderer.invoke('report:list'),
  openReport: (file) => ipcRenderer.invoke('report:open', file),
  deleteReport: (id) => ipcRenderer.invoke('report:delete', id),
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
});
