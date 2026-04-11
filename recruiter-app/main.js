const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SessionManager = require('./src/session/manager');
const AIDetector = require('./src/ai/detector');
const ReportGenerator = require('./src/report/generator');
const SettingsStore = require('./src/settings/store');

let mainWindow;
let tray;
let activeSession = null;
let sessionData = null; // in-memory log for report

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#050507',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

function createTray() {
  const icon = nativeImage.createFromBuffer(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Truveil Command Center');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Truveil', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', (e) => e.preventDefault());

// ─── IPC ───────────────────────────────────────────────────────────────

// Settings
ipcMain.handle('settings:get', () => SettingsStore.getAll());
ipcMain.handle('settings:save', (_, patch) => SettingsStore.save(patch));

// Session lifecycle
ipcMain.handle('session:create', async (_, { candidateName, role }) => {
  const session = SessionManager.create({ candidateName, role });
  activeSession = session;
  sessionData = {
    session,
    startedAt: null,
    endedAt: null,
    transcripts: [],
    flags: [],
    scores: []
  };
  return session;
});

ipcMain.handle('session:start', async () => {
  if (!sessionData) throw new Error('No active session');
  sessionData.startedAt = Date.now();
  return { started: true, startedAt: sessionData.startedAt };
});

// Analyze a final transcript chunk from the renderer (Web Speech result)
ipcMain.handle('analyze:transcript', async (_, { text, timestamp }) => {
  if (!sessionData) return null;
  if (!text || text.trim().length < 4) return null;

  const settings = SettingsStore.getAll();
  const apiKey = settings.openrouterKey || process.env.OPENROUTER_API_KEY;

  let analysis;
  try {
    analysis = await AIDetector.analyze(text, apiKey);
  } catch (err) {
    console.error('[AI Detector]', err.message);
    return {
      text,
      timestamp,
      aiScore: null,
      flags: [],
      reasoning: 'AI analysis unavailable — ' + err.message,
      error: true
    };
  }

  const entry = {
    text,
    timestamp,
    aiScore: analysis.score,
    confidence: analysis.confidence,
    flags: analysis.flags || [],
    reasoning: analysis.reasoning
  };
  sessionData.transcripts.push(entry);
  sessionData.scores.push(analysis.score);
  (analysis.flags || []).forEach(f =>
    sessionData.flags.push({ text: f, timestamp, severity: analysis.score >= 70 ? 'high' : 'medium' })
  );
  return entry;
});

// Manual flag (from renderer, e.g. candidate joined / tab switch events)
ipcMain.handle('flag:add', (_, { text, severity, timestamp }) => {
  if (!sessionData) return;
  sessionData.flags.push({ text, severity, timestamp });
});

// End session — generate + open report
ipcMain.handle('session:end', async () => {
  if (!sessionData) return { ended: false };
  sessionData.endedAt = Date.now();

  try {
    const reportPath = await ReportGenerator.generate(sessionData);
    shell.openPath(reportPath);
    const finalData = { ...sessionData, reportPath };
    activeSession = null;
    sessionData = null;
    return { ended: true, reportPath };
  } catch (err) {
    console.error('[Report]', err);
    dialog.showErrorBox('Report generation failed', err.message);
    activeSession = null;
    sessionData = null;
    return { ended: true, error: err.message };
  }
});

// Open the last-generated report folder
ipcMain.handle('report:openFolder', () => {
  const dir = path.join(app.getPath('userData'), 'reports');
  if (fs.existsSync(dir)) shell.openPath(dir);
});

// Clipboard helper
ipcMain.handle('clipboard:write', (_, text) => {
  clipboard.writeText(text);
  return true;
});

// Desktop capturer for system-audio mode (loopback)
const { desktopCapturer, session } = require('electron');
ipcMain.handle('get-audio-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false });
  return sources.map(s => ({ id: s.id, name: s.name }));
});
