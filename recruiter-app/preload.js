const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('truveil', {
  createSession: (data) => ipcRenderer.invoke('create-session', data),
  startAudio: () => ipcRenderer.invoke('start-audio'),
  endSession: () => ipcRenderer.invoke('end-session'),
  copyLink: (link) => ipcRenderer.invoke('copy-link', link),

  onCandidateJoined: (cb) => ipcRenderer.on('candidate-joined', () => cb()),
  onCandidateDisconnected: (cb) => ipcRenderer.on('candidate-disconnected', () => cb()),
  onTranscript: (cb) => ipcRenderer.on('transcript-update', (_, data) => cb(data)),
  onFlag: (cb) => ipcRenderer.on('flag-received', (_, data) => cb(data)),
});
