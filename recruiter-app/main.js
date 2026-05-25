const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SessionManager = require('./src/session/manager');
const AIDetector = require('./src/ai/detector');
const ReportGenerator = require('./src/report/generator');
const SettingsStore = require('./src/settings/store');

let mainWindow;
let tray;
let activeSession = null;
let sessionData = null; // in-memory log for report
let supabase = null;
let realtimeChannel = null;

function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL || process.env.TRUVEIL_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.TRUVEIL_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } }
  });
  return supabase;
}

function sessionChannelName(sessionId) {
  return `truveil-session:${sessionId}`;
}

async function ensureRemoteSession(session) {
  const client = getSupabase();
  if (!client) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in recruiter-app/.env.');
  }

  const candidateBaseUrl = process.env.CANDIDATE_APP_URL || process.env.TRUVEIL_CANDIDATE_APP_URL || 'https://trueveil-client.vercel.app';
  const candidateLink = `${candidateBaseUrl.replace(/\/+$/, '')}/#download`;

  const { error } = await client.from('sessions').upsert({
    id: session.sessionId,
    candidate_link: candidateLink,
    status: 'waiting',
    flags: [],
    transcript: [],
    created_at: new Date(session.createdAt).toISOString()
  });

  if (error) throw new Error(error.message);
}

async function joinRealtimeSession(sessionId) {
  const client = getSupabase();
  if (!client) return;
  if (realtimeChannel) await client.removeChannel(realtimeChannel);

  realtimeChannel = client
    .channel(sessionChannelName(sessionId), {
      config: { broadcast: { self: false }, presence: { key: 'recruiter' } }
    })
    .on('broadcast', { event: 'candidate_transcript' }, ({ payload }) => {
      analyzeCandidateTranscript(payload);
    })
    .on('broadcast', { event: 'candidate_event' }, ({ payload }) => {
      handleCandidateEvent(payload);
    });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out joining realtime session.')), 12000);
    realtimeChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timeout);
        reject(new Error(`Could not join realtime session (${status}).`));
      }
    });
  });

  await realtimeChannel.track({ role: 'recruiter', joinedAt: Date.now() });
}

async function analyzeCandidateTranscript(payload = {}) {
  if (!sessionData || !payload.text) return;

  const text = String(payload.text || '').trim();
  if (text.length < 4) return;

  const timestamp = payload.timestamp || Date.now();
  const settings = SettingsStore.getAll();
  const apiKey = settings.openrouterKey || process.env.OPENROUTER_API_KEY;

  let entry;
  try {
    const analysis = await AIDetector.analyze(text, apiKey);
    entry = {
      text,
      timestamp,
      aiScore: analysis.score,
      confidence: analysis.confidence,
      flags: analysis.flags || [],
      reasoning: analysis.reasoning
    };
  } catch (err) {
    console.error('[AI Detector]', err.message);
    entry = {
      text,
      timestamp,
      aiScore: null,
      flags: [],
      reasoning: 'AI analysis unavailable - ' + err.message,
      error: true
    };
  }

  sessionData.transcripts.push(entry);
  if (typeof entry.aiScore === 'number') sessionData.scores.push(entry.aiScore);
  (entry.flags || []).forEach(flagText => {
    sessionData.flags.push({
      text: flagText,
      timestamp,
      severity: entry.aiScore >= 70 ? 'high' : 'medium'
    });
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('realtime:transcript', entry);
  }
}

function handleCandidateEvent(payload = {}) {
  if (!sessionData || !payload.type) return;

  const labels = {
    candidate_connected: 'Candidate connected to Truveil Secure',
    focus_lost: 'Candidate switched away from Truveil Secure',
    focus_gained: 'Candidate returned to Truveil Secure',
    shortcut_blocked: 'Candidate attempted a blocked shortcut',
    candidate_interrupted: 'Candidate ended or closed the secure session',
    candidate_completed: 'Candidate completed the secure session',
    session_ended_remote: 'Candidate received recruiter end-session signal'
  };

  const text = labels[payload.type] || payload.type;
  const severity = payload.severity || (payload.type === 'focus_lost' ? 'medium' : 'low');
  const flag = { text, severity, timestamp: payload.timestamp || Date.now() };
  sessionData.flags.push(flag);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('realtime:flag', flag);
    if (payload.type === 'candidate_connected') {
      mainWindow.webContents.send('realtime:status', { text: 'Candidate connected' });
    }
  }
}

async function closeRealtimeSession({ notifyCandidate = false } = {}) {
  if (realtimeChannel) {
    if (notifyCandidate) {
      try {
        await realtimeChannel.send({
          type: 'broadcast',
          event: 'recruiter_end_session',
          payload: { timestamp: Date.now() }
        });
      } catch (err) {
        console.warn('[Realtime]', err.message);
      }
    }

    try { await getSupabase()?.removeChannel(realtimeChannel); } catch {}
    realtimeChannel = null;
  }
}

async function persistCompletedSession() {
  if (!sessionData) return;
  const client = getSupabase();
  if (!client) return;

  const transcript = sessionData.transcripts.map(entry => ({
    text: entry.text,
    timestamp: entry.timestamp,
    score: entry.aiScore,
    reasoning: entry.reasoning,
    flags: entry.flags || []
  }));

  await client.from('sessions').update({
    status: 'completed',
    transcript,
    flags: sessionData.flags,
    ended_at: new Date(sessionData.endedAt || Date.now()).toISOString()
  }).eq('id', sessionData.session.sessionId);
}

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
  await ensureRemoteSession(session);
  await joinRealtimeSession(session.sessionId);

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
    await closeRealtimeSession({ notifyCandidate: true });
    await persistCompletedSession();
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
