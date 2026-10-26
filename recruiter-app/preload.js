const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('truveil', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getDemoConfig: () => ipcRenderer.invoke('demo:config'),
  createDemo: (data) => ipcRenderer.invoke('demo:create', data),
  approveDemo: (data) => ipcRenderer.invoke('demo:approve', data),
  onDemoJoinRequest: (cb) => ipcRenderer.on('demo:join-request', (_, data) => cb(data)),
  onBrowserTabs: (cb) => ipcRenderer.on('browser:tabs', (_, data) => cb(data)),
  closeBrowserTab: (data) => ipcRenderer.invoke('browser:close-tab', data),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getAuth: () => ipcRenderer.invoke('auth:get'),
  sendSignInLink: (email) => ipcRenderer.invoke('auth:send-link', email),
  verifySignInCode: (data) => ipcRenderer.invoke('auth:verify-code', data),
  signInWithPassword: (data) => ipcRenderer.invoke('auth:sign-in-password', data),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  onAuthChanged: (cb) => ipcRenderer.on('auth:changed', (_, data) => cb(data)),
  onAuthError: (cb) => ipcRenderer.on('auth:error', (_, data) => cb(data)),

  // Session
  createSession: (data) => ipcRenderer.invoke('session:create', data),
  cancelSession: () => ipcRenderer.invoke('session:cancel'),
  updateSession: (data) => ipcRenderer.invoke('session:update', data),
  startSession: () => ipcRenderer.invoke('session:start'),
  endSession: () => ipcRenderer.invoke('session:end'),
  addSessionNote: (data) => ipcRenderer.invoke('session:note', data),

  // Live analysis
  getProviderReviewStatus: () => ipcRenderer.invoke('provider-review:status'),
  connectProviderKeyFile: () => ipcRenderer.invoke('provider-review:connect-file'),
  checkProviderConnections: () => ipcRenderer.invoke('provider-review:check'),
  beginProviderAnswer: () => ipcRenderer.invoke('provider-review:begin'),
  finishProviderAnswer: () => ipcRenderer.invoke('provider-review:finish'),
  discardProviderAnswer: () => ipcRenderer.invoke('provider-review:discard'),
  reviewProviderAnswer: (confirmations) => ipcRenderer.invoke('provider-review:run', confirmations),
  onProviderReviewConsent: (cb) => ipcRenderer.on('provider-review:consent', (_, data) => cb(data)),
  analyzeTranscript: (data) => ipcRenderer.invoke('analyze:transcript', data),
  addFlag: (data) => ipcRenderer.invoke('flag:add', data),
  sendCandidateAction: (data) => ipcRenderer.invoke('candidate:action', data),
  getAudioChunk: (data) => ipcRenderer.invoke('audio:get', data),
  onRealtimeCaption: (cb) => ipcRenderer.on('realtime:caption', (_, data) => cb(data)),
  onRealtimeInterimTranscript: (cb) => ipcRenderer.on('realtime:transcript-interim', (_, data) => cb(data)),
  onRealtimeTranscript: (cb) => ipcRenderer.on('realtime:transcript', (_, data) => cb(data)),
  onChunkReview: (cb) => ipcRenderer.on('realtime:chunk-review', (_, data) => cb(data)),
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
  deleteReport: (id) => ipcRenderer.invoke('report:delete', id),
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
});
