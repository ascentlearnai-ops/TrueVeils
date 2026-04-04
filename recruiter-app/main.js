const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, clipboard } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 400,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Create a simple 16x16 tray icon programmatically
  const icon = nativeImage.createFromBuffer(
    Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 }
  );
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Truveil', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('Truveil — Interview Monitor');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => e.preventDefault());

// ——— IPC HANDLERS ————————————————————————————————————————————————————————————

const SessionManager = require('./src/session/manager');
const AudioCapture = require('./src/audio/capture');
const WhisperService = require('./src/audio/whisper');
const AIDetector = require('./src/ai/detector');
const WSClient = require('./src/websocket/client');

let activeSession = null;
let audioCapture = null;
let wsClient = null;

ipcMain.handle('create-session', async (event, { recruiterId }) => {
  const session = await SessionManager.create(recruiterId);
  activeSession = session;

  wsClient = new WSClient(session.sessionId, 'recruiter');
  wsClient.on('candidate_connected', () => {
    mainWindow.webContents.send('candidate-joined');
  });
  wsClient.on('transcript', (data) => {
    mainWindow.webContents.send('transcript-update', data);
  });
  wsClient.on('flag', (data) => {
    mainWindow.webContents.send('flag-received', data);
  });
  wsClient.on('candidate_disconnected', () => {
    mainWindow.webContents.send('candidate-disconnected');
  });

  return session;
});

ipcMain.handle('start-audio', async () => {
  audioCapture = new AudioCapture();

  audioCapture.on('chunk', async (audioBuffer) => {
    try {
      const transcript = await WhisperService.transcribe(audioBuffer);
      if (!transcript || transcript.trim().length < 3) return;

      const analysis = await AIDetector.analyze(transcript);

      mainWindow.webContents.send('transcript-update', {
        text: transcript,
        aiScore: analysis.score,
        flags: analysis.flags,
        reasoning: analysis.reasoning,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error('Audio processing error:', err);
    }
  });

  audioCapture.start();
  return { started: true };
});

ipcMain.handle('end-session', async () => {
  if (audioCapture) { audioCapture.stop(); audioCapture = null; }
  if (wsClient) {
    wsClient.send({ type: 'end_session' });
    wsClient.close();
    wsClient = null;
  }
  if (activeSession) {
    const reportUrl = `${process.env.BACKEND_URL}/reports/${activeSession.sessionId}`;
    shell.openExternal(reportUrl);
  }
  activeSession = null;
  return { ended: true };
});

ipcMain.handle('copy-link', async (event, link) => {
  clipboard.writeText(link);
  return true;
});
