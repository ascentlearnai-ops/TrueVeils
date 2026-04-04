# Truveil — Complete Build Specification for Claude Code

> Read this entire document before writing a single line of code.
> Build everything described. Follow the exact order at the bottom.

---

## Product Overview

**Truveil** is an AI-powered interview fraud detection tool for recruiters and companies.
It is the direct counter-product to Interview Coder and tools like it.

**Name origin:** "True" + "Veil" — removing the veil of deception from interviews.
**Domain:** truveil.com
**Tagline:** "Real answers only."
**Sub-tagline:** "Catch AI-assisted interview fraud before you make a $50,000 mistake."

### The Problem It Solves
Tools like Interview Coder, Ezzi, ShadeCoder, and Interview Browser allow candidates to:
- Run an invisible AI overlay on their screen during interviews (invisible to Zoom/Meet screen share)
- Get real-time AI-generated answers whispered through earpieces
- Read answers off a second phone/monitor
- Use tools like Otter.ai + ChatGPT to transcribe questions and get AI answers in real time

Gartner research says 25% of all job applications will be fake or fraudulent by 2028.
Companies lose an average of $28,000 per fraudulent hire.
Interview Coder alone has 100,000+ active users.

### How Truveil Fixes It
Two Electron apps working together in real time over a WebSocket backend.

---

## The Exact Product Flow

### Recruiter Side — Step by Step
1. Recruiter downloads and installs **Truveil Recruiter App** (Electron, Mac/Windows)
2. Opens app → logs in with email (Supabase auth)
3. Joins their Zoom/Google Meet call as normal — Truveil runs separately
4. Inside Truveil, clicks **"New Interview Session"**
5. App silently begins capturing **system audio** (loopback — hears the entire Zoom call)
6. App generates a unique one-time session link: `https://join.truveil.com/s/[sessionId]`
7. Recruiter **pastes link into Zoom chat** to the candidate
8. The **live dashboard** immediately begins showing:
   - Rolling transcript of everything said
   - Per-response AI confidence score (0–100)
   - Red flag events from the candidate's machine
   - Session timer
9. When interview ends, recruiter clicks **"End Session"**
10. App generates a **downloadable PDF report** with full transcript, scores, and flagged timestamps

### Candidate Side — Step by Step
1. Candidate clicks the link in Zoom chat
2. Browser opens and immediately shows a branded download page
3. They download a small installer: `TruveilSecure-Setup.exe` (Windows) or `TruveilSecure.dmg` (Mac)
4. They run it — it auto-launches immediately (no install wizard, just runs)
5. Their entire screen goes into **fullscreen kiosk mode** — fullscreen, no borders, no taskbar
6. They see a clean branded UI: "Truveil Secure Interview — Session Active"
7. Behind the scenes the app is:
   - Recording their microphone continuously
   - Streaming audio → Whisper API → transcript → WebSocket → recruiter dashboard
   - Scanning for Interview Coder / hidden overlay windows every 10 seconds
   - Monitoring for: alt-tab, window blur, clipboard paste, DevTools, multiple monitors
   - Blocking all keyboard escape shortcuts (Alt+F4, Cmd+Q, Cmd+Tab, etc.)
8. Any flag sends an instant alert to the recruiter dashboard
9. When recruiter ends the session, candidate sees "Session Complete" and the app closes

---

## Technical Architecture — Complete

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RECRUITER MACHINE                            │
│                                                                     │
│  ┌──────────────────┐    System Audio     ┌──────────────────────┐ │
│  │   Zoom / Meet    │ ─────────────────>  │   Truveil Recruiter  │ │
│  │  (normal call)   │                     │     Electron App     │ │
│  └──────────────────┘                     │                      │ │
│                                           │  ┌────────────────┐  │ │
│                                           │  │ Audio Capture  │  │ │
│                                           │  │ (loopback)     │  │ │
│                                           │  └───────┬────────┘  │ │
│                                           │          │           │ │
│                                           │          ▼           │ │
│                                           │  ┌────────────────┐  │ │
│                                           │  │  Whisper API   │  │ │
│                                           │  │ (transcription)│  │ │
│                                           │  └───────┬────────┘  │ │
│                                           │          │           │ │
│                                           │          ▼           │ │
│                                           │  ┌────────────────┐  │ │
│                                           │  │  Claude API    │  │ │
│                                           │  │ (AI detection) │  │ │
│                                           │  └───────┬────────┘  │ │
│                                           │          │           │ │
│                                           │  ┌───────▼────────┐  │ │
│                                           │  │  Live Dashboard │  │ │
│                                           │  │ Transcript+Flags│  │ │
│                                           │  └────────────────┘  │ │
│                                           └──────────┬───────────┘ │
└──────────────────────────────────────────────────────┼─────────────┘
                                                       │ WebSocket
                                              ┌────────▼────────┐
                                              │  Truveil Backend │
                                              │  (Railway/Node)  │
                                              │                  │
                                              │  Express + ws    │
                                              │  Supabase client │
                                              │  Session store   │
                                              └────────┬────────┘
                                                       │ WebSocket
┌──────────────────────────────────────────────────────┼─────────────┐
│                        CANDIDATE MACHINE              │             │
│                                                       │             │
│                                           ┌───────────▼───────────┐ │
│                                           │  Truveil Secure App   │ │
│                                           │   (Electron, kiosk)   │ │
│                                           │                       │ │
│                                           │  ┌─────────────────┐  │ │
│                                           │  │  Mic Recording  │  │ │
│                                           │  │  + Streaming    │  │ │
│                                           │  └─────────────────┘  │ │
│                                           │  ┌─────────────────┐  │ │
│                                           │  │ Window Scanner  │  │ │
│                                           │  │(detect IC/WXCA) │  │ │
│                                           │  └─────────────────┘  │ │
│                                           │  ┌─────────────────┐  │ │
│                                           │  │ Event Monitor   │  │ │
│                                           │  │blur/paste/devtls│  │ │
│                                           │  └─────────────────┘  │ │
│                                           └───────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Complete File & Folder Structure

```
truveil/
│
├── landing/                              # Marketing site — deploy to Vercel
│   ├── index.html                        # Single file, fully self-contained
│   └── vercel.json                       # Vercel config (routes, headers)
│
├── backend/                              # Node.js API — deploy to Railway
│   ├── package.json
│   ├── .env.example
│   ├── server.js                         # Entry point
│   ├── routes/
│   │   ├── sessions.js                   # POST /sessions, GET /sessions/:id
│   │   ├── auth.js                       # Recruiter signup/login
│   │   └── reports.js                    # GET /reports/:sessionId (PDF)
│   ├── ws/
│   │   └── handler.js                    # WebSocket relay logic
│   ├── lib/
│   │   ├── supabase.js                   # Supabase client singleton
│   │   └── pdf.js                        # PDF report generation (pdfkit)
│   └── middleware/
│       └── auth.js                       # JWT verification middleware
│
├── recruiter-app/                        # Recruiter Electron app
│   ├── package.json
│   ├── electron-builder.yml
│   ├── .env.example
│   ├── main.js                           # Electron main process
│   ├── preload.js                        # Context bridge / IPC
│   └── src/
│       ├── audio/
│       │   ├── capture.js                # System audio loopback capture
│       │   └── whisper.js                # Whisper API streaming transcription
│       ├── ai/
│       │   └── detector.js               # Claude API — AI response analysis
│       ├── session/
│       │   └── manager.js                # Session creation, link generation
│       ├── websocket/
│       │   └── client.js                 # WS connection to backend
│       ├── report/
│       │   └── generator.js              # Trigger PDF report from backend
│       └── renderer/
│           ├── index.html                # Dashboard shell
│           ├── dashboard.js              # Dashboard UI logic
│           └── styles.css                # Dashboard styles
│
├── candidate-app/                        # Candidate Secure Client
│   ├── package.json
│   ├── electron-builder.yml
│   ├── .env.example
│   ├── main.js                           # Electron main — kiosk, lockdown
│   ├── preload.js
│   └── src/
│       ├── lockdown/
│       │   ├── kiosk.js                  # Fullscreen, disable shortcuts
│       │   └── scanner.js                # Detect Interview Coder + overlays
│       ├── audio/
│       │   └── recorder.js               # Mic capture + chunk streaming
│       ├── events/
│       │   └── monitor.js                # blur, paste, devtools, clipboard
│       ├── websocket/
│       │   └── client.js                 # Stream data to backend
│       └── renderer/
│           ├── index.html                # Candidate-facing UI
│           ├── session.js                # Session state management
│           └── styles.css
│
└── README.md                             # Setup + deployment guide
```

---

## Backend — Complete Implementation

### backend/package.json
```json
{
  "name": "truveil-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.14.2",
    "@supabase/supabase-js": "^2.39.0",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "jsonwebtoken": "^9.0.2",
    "pdfkit": "^0.14.0",
    "uuid": "^9.0.0",
    "helmet": "^7.1.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

### backend/server.js
```javascript
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// In-memory session store: sessionId -> { recruiterWs, candidateWs, flags, transcript }
const sessions = new Map();

// ─── REST ROUTES ──────────────────────────────────────────────────────────────

// Create a new interview session
app.post('/sessions', async (req, res) => {
  try {
    const sessionId = uuidv4().replace(/-/g, '').substring(0, 12);
    const candidateLink = `${process.env.CANDIDATE_APP_URL}/join/${sessionId}`;
    const downloadLink = `${process.env.APP_BASE_URL}/download/${sessionId}`;

    const { error } = await supabase.from('sessions').insert({
      id: sessionId,
      recruiter_id: req.body.recruiterId,
      candidate_link: candidateLink,
      status: 'waiting',
      flags: [],
      transcript: [],
      created_at: new Date().toISOString()
    });

    if (error) throw error;

    sessions.set(sessionId, {
      recruiterWs: null,
      candidateWs: null,
      flags: [],
      transcript: [],
      startTime: null
    });

    res.json({ sessionId, candidateLink, downloadLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Get session data (for report generation)
app.get('/sessions/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Session not found' });
  res.json(data);
});

// Serve the candidate download page
app.get('/download/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const userAgent = req.headers['user-agent'] || '';
  const isMac = /Mac|iPhone|iPad/.test(userAgent);
  const isWindows = /Windows/.test(userAgent);
  const fileName = isMac
    ? `TruveilSecure-${sessionId}.dmg`
    : `TruveilSecure-Setup-${sessionId}.exe`;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Truveil — Join Interview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
    }
    .card {
      max-width: 420px;
      padding: 48px 40px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
    }
    .logo { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 32px; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; letter-spacing: -0.5px; }
    p { color: rgba(255,255,255,0.5); font-size: 14px; line-height: 1.6; margin-bottom: 32px; }
    .btn {
      display: inline-block;
      background: #fff;
      color: #000;
      font-weight: 600;
      font-size: 14px;
      padding: 14px 28px;
      border-radius: 8px;
      text-decoration: none;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .note { margin-top: 20px; font-size: 12px; color: rgba(255,255,255,0.3); }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Truveil</div>
    <h1>You've been invited to a secure interview</h1>
    <p>Download the Truveil Secure Client to join. This creates a protected interview environment and takes less than 30 seconds to set up.</p>
    <a class="btn" href="/files/${fileName}?session=${sessionId}" id="dl">
      Download Secure Client
    </a>
    <p class="note">For ${isMac ? 'macOS' : 'Windows'} • Session: ${sessionId}</p>
  </div>
  <script>
    // Auto-trigger download after 1.5s
    setTimeout(() => document.getElementById('dl').click(), 1500);
  </script>
</body>
</html>`);
});

// ─── WEBSOCKET ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req, sessionId, role) => {
  console.log(`[WS] ${role} connected to session ${sessionId}`);

  let session = sessions.get(sessionId);
  if (!session) {
    ws.close(4004, 'Session not found');
    return;
  }

  if (role === 'recruiter') {
    session.recruiterWs = ws;
  } else if (role === 'candidate') {
    session.candidateWs = ws;
    session.startTime = Date.now();
    // Tell recruiter candidate connected
    if (session.recruiterWs?.readyState === 1) {
      session.recruiterWs.send(JSON.stringify({
        type: 'candidate_connected',
        timestamp: Date.now()
      }));
    }
  }

  ws.on('message', async (rawData) => {
    let msg;
    try { msg = JSON.parse(rawData); } catch { return; }

    if (role === 'candidate') {
      // Save to session memory
      if (msg.type === 'transcript') {
        session.transcript.push({ text: msg.data.text, timestamp: msg.timestamp, score: msg.data.aiScore });
      }
      if (msg.type === 'flag') {
        session.flags.push({ ...msg.data, timestamp: msg.timestamp });
        // Persist flags to Supabase in real time
        await supabase.from('sessions').update({
          flags: session.flags
        }).eq('id', sessionId);
      }

      // Relay everything to recruiter in real time
      if (session.recruiterWs?.readyState === 1) {
        session.recruiterWs.send(JSON.stringify({
          type: msg.type,
          data: msg.data,
          timestamp: Date.now()
        }));
      }
    }

    if (role === 'recruiter' && msg.type === 'end_session') {
      // Tell candidate to shut down
      if (session.candidateWs?.readyState === 1) {
        session.candidateWs.send(JSON.stringify({ type: 'session_ended' }));
      }
      // Save final transcript to Supabase
      await supabase.from('sessions').update({
        status: 'completed',
        transcript: session.transcript,
        flags: session.flags,
        ended_at: new Date().toISOString()
      }).eq('id', sessionId);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] ${role} disconnected from ${sessionId}`);
    if (role === 'candidate' && session.recruiterWs?.readyState === 1) {
      session.recruiterWs.send(JSON.stringify({ type: 'candidate_disconnected', timestamp: Date.now() }));
    }
  });

  ws.on('error', (err) => console.error(`[WS Error] ${sessionId} ${role}:`, err));
});

// Upgrade HTTP → WebSocket
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('session');
  const role = url.searchParams.get('role');

  if (!sessionId || !['recruiter', 'candidate'].includes(role)) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, sessionId, role);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Truveil backend running on port ${PORT}`));
```

### backend/.env.example
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
APP_BASE_URL=https://your-backend.railway.app
CANDIDATE_APP_URL=https://your-backend.railway.app/download
ALLOWED_ORIGINS=https://truveil.com,http://localhost:3000
PORT=3001
```

### Supabase Table Schema (run in Supabase SQL editor)
```sql
create table sessions (
  id text primary key,
  recruiter_id uuid references auth.users(id),
  candidate_link text,
  status text default 'waiting',
  flags jsonb default '[]',
  transcript jsonb default '[]',
  created_at timestamptz default now(),
  ended_at timestamptz
);

create table recruiters (
  id uuid primary key references auth.users(id),
  email text unique not null,
  full_name text,
  company text,
  plan text default 'starter',
  interview_credits integer default 10,
  created_at timestamptz default now()
);

-- Enable RLS
alter table sessions enable row level security;
alter table recruiters enable row level security;

-- Recruiters can only see their own sessions
create policy "recruiters see own sessions"
  on sessions for all
  using (recruiter_id = auth.uid());
```

---

## Recruiter App — Complete Implementation

### recruiter-app/package.json
```json
{
  "name": "truveil-recruiter",
  "version": "1.0.0",
  "description": "Truveil Recruiter App",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev",
    "build:mac": "electron-builder --mac",
    "build:win": "electron-builder --win",
    "build:all": "electron-builder --mac --win"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@supabase/supabase-js": "^2.39.0",
    "dotenv": "^16.3.1",
    "form-data": "^4.0.0",
    "node-fetch": "^3.3.2",
    "openai": "^4.28.0",
    "ws": "^8.14.2"
  },
  "devDependencies": {
    "electron": "^28.2.0",
    "electron-builder": "^24.9.1"
  }
}
```

### recruiter-app/main.js
```javascript
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
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

  // Don't quit app when window closes — goes to system tray
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/tray-icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

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

app.on('window-all-closed', (e) => e.preventDefault()); // keep alive in tray

// ─── IPC HANDLERS ──────────────────────────────────────────────────────────────

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

  // Connect recruiter WebSocket to backend
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

  return session;
});

ipcMain.handle('start-audio', async () => {
  audioCapture = new AudioCapture();

  audioCapture.on('chunk', async (audioBuffer) => {
    try {
      const transcript = await WhisperService.transcribe(audioBuffer);
      if (!transcript || transcript.trim().length < 3) return;

      const analysis = await AIDetector.analyze(transcript);

      // Send to dashboard
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
  const reportUrl = `${process.env.BACKEND_URL}/sessions/${activeSession?.sessionId}/report`;
  shell.openExternal(reportUrl);
  activeSession = null;
  return { ended: true };
});

ipcMain.handle('copy-link', async (event, link) => {
  const { clipboard } = require('electron');
  clipboard.writeText(link);
  return true;
});
```

### recruiter-app/preload.js
```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('truveil', {
  createSession: (data) => ipcRenderer.invoke('create-session', data),
  startAudio: () => ipcRenderer.invoke('start-audio'),
  endSession: () => ipcRenderer.invoke('end-session'),
  copyLink: (link) => ipcRenderer.invoke('copy-link', link),

  onCandidateJoined: (cb) => ipcRenderer.on('candidate-joined', cb),
  onTranscript: (cb) => ipcRenderer.on('transcript-update', (_, data) => cb(data)),
  onFlag: (cb) => ipcRenderer.on('flag-received', (_, data) => cb(data)),
});
```

### recruiter-app/src/audio/capture.js
```javascript
const { EventEmitter } = require('events');
const { desktopCapturer } = require('electron');

class AudioCapture extends EventEmitter {
  constructor() {
    super();
    this.mediaRecorder = null;
    this.stream = null;
    this.chunkInterval = 5000; // 5 second chunks for Whisper
  }

  async start() {
    // Get all audio sources (system loopback)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      fetchWindowIcons: false
    });

    // Use getUserMedia with desktop audio source for system loopback
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop'
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          maxWidth: 1,
          maxHeight: 1
        }
      }
    });

    // Only keep the audio track
    const audioTrack = this.stream.getAudioTracks()[0];
    const audioOnlyStream = new MediaStream([audioTrack]);

    this.mediaRecorder = new MediaRecorder(audioOnlyStream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    const chunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        blob.arrayBuffer().then(buffer => {
          this.emit('chunk', Buffer.from(buffer));
        });
        chunks.length = 0;
      }
    };

    // Capture in intervals
    this.mediaRecorder.start();
    this.intervalId = setInterval(() => {
      if (this.mediaRecorder?.state === 'recording') {
        this.mediaRecorder.stop();
        this.mediaRecorder.start();
      }
    }, this.chunkInterval);
  }

  stop() {
    clearInterval(this.intervalId);
    this.mediaRecorder?.stop();
    this.stream?.getTracks().forEach(t => t.stop());
  }
}

module.exports = AudioCapture;
```

### recruiter-app/src/audio/whisper.js
```javascript
const OpenAI = require('openai');
const { Readable } = require('stream');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function transcribe(audioBuffer) {
  // Convert buffer to a File-like object that OpenAI SDK accepts
  const readable = new Readable();
  readable.push(audioBuffer);
  readable.push(null);
  readable.path = 'audio.webm'; // SDK uses this for content-type detection

  const response = await openai.audio.transcriptions.create({
    file: readable,
    model: 'whisper-1',
    response_format: 'json',
    language: 'en'
  });

  return response.text;
}

module.exports = { transcribe };
```

### recruiter-app/src/ai/detector.js
```javascript
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Keep last few exchanges for context
const conversationHistory = [];

async function analyze(transcript) {
  conversationHistory.push(transcript);
  if (conversationHistory.length > 10) conversationHistory.shift();

  const systemPrompt = `You are an expert forensic linguist specializing in detecting AI-assisted speech in job interviews. 
Your job is to analyze interview responses and return a precise JSON assessment.

Key signals of AI assistance:
1. ZERO filler words (no "um", "uh", "like", "you know", "sort of", "kind of")
2. Unnaturally complete answers — no half-sentences, no self-correction, no "actually wait"
3. Perfect structure: every answer has intro, 2-3 points, conclusion — too structured for off-the-cuff speech
4. Suspiciously consistent answer length — not too short, not too long, just right
5. Formal vocabulary that wouldn't match casual speech
6. No personal anecdotes or specific details — answers are generic and could apply to anyone
7. Reading cadence — very even pacing, no natural pauses for genuine thinking
8. No questions asked back to the interviewer
9. Answers start immediately — no "That's a great question, let me think about that"
10. Technical terms used correctly but without the slight imprecision real experts have

Return ONLY this JSON — no markdown, no explanation outside the JSON:
{
  "score": <0-100 integer, 0=definitely human, 100=definitely AI>,
  "confidence": <"low"|"medium"|"high">,
  "flags": [<array of specific signals detected, max 4 items, be specific>],
  "reasoning": "<one crisp sentence explaining the main signal>"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Interview response to analyze:\n\n"${transcript}"\n\nConversation context (last ${conversationHistory.length} responses): ${conversationHistory.slice(0, -1).join(' | ')}`
    }]
  });

  const raw = response.content[0].text.trim();

  try {
    return JSON.parse(raw);
  } catch {
    // Fallback if JSON is malformed
    return { score: 0, confidence: 'low', flags: [], reasoning: 'Analysis failed' };
  }
}

module.exports = { analyze };
```

### recruiter-app/src/session/manager.js
```javascript
const fetch = require('node-fetch');

async function create(recruiterId) {
  const res = await fetch(`${process.env.BACKEND_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recruiterId })
  });

  if (!res.ok) throw new Error('Failed to create session');
  const data = await res.json();

  return {
    sessionId: data.sessionId,
    candidateLink: data.candidateLink,
    downloadLink: data.downloadLink
  };
}

module.exports = { create };
```

### recruiter-app/src/websocket/client.js
```javascript
const WebSocket = require('ws');
const { EventEmitter } = require('events');

class WSClient extends EventEmitter {
  constructor(sessionId, role) {
    super();
    this.url = `${process.env.BACKEND_WS_URL}?session=${sessionId}&role=${role}`;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      console.log('[WS] Connected to Truveil backend');
      this.reconnectAttempts = 0;
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        this.emit(msg.type, msg.data || msg);
      } catch {}
    });

    this.ws.on('close', () => {
      console.log('[WS] Disconnected. Reconnecting...');
      if (this.reconnectAttempts < 5) {
        setTimeout(() => {
          this.reconnectAttempts++;
          this.connect();
        }, 2000 * this.reconnectAttempts);
      }
    });

    this.ws.on('error', (err) => console.error('[WS Error]', err));
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...data, timestamp: Date.now() }));
    }
  }

  close() {
    this.ws?.close();
  }
}

module.exports = WSClient;
```

---

## Candidate App — Complete Implementation

### candidate-app/package.json
```json
{
  "name": "truveil-secure",
  "version": "1.0.0",
  "description": "Truveil Secure Interview Client",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build:mac": "electron-builder --mac",
    "build:win": "electron-builder --win"
  },
  "dependencies": {
    "dotenv": "^16.3.1",
    "ws": "^8.14.2"
  },
  "devDependencies": {
    "electron": "^28.2.0",
    "electron-builder": "^24.9.1"
  }
}
```

### candidate-app/electron-builder.yml
```yaml
appId: com.truveil.secure
productName: TruveilSecure
directories:
  output: dist
mac:
  category: public.app-category.business
  target:
    - dmg
win:
  target:
    - nsis
  requestedExecutionLevel: requireAdministrator
nsis:
  oneClick: true
  perMachine: false
  runAfterFinish: true
```

### candidate-app/main.js
```javascript
const { app, BrowserWindow, globalShortcut, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Get session ID from command line args or env
const sessionId = process.argv.find(a => a.startsWith('--session='))?.split('=')[1]
  || process.env.SESSION_ID;

let mainWindow;
let blocker;

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    closable: false,
    minimizable: false,
    maximizable: false,
    resizable: false,
    frame: false,
    skipTaskbar: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
  mainWindow.webContents.send('session-id', sessionId);

  // Block ALL escape shortcuts
  globalShortcut.registerAll([
    'Alt+F4',
    'CommandOrControl+W',
    'CommandOrControl+Q',
    'CommandOrControl+Tab',
    'Alt+Tab',
    'Meta+Tab',
    'Meta+D',
    'CommandOrControl+Alt+Delete',
    'F11',
    'Escape',
    'CommandOrControl+R',
    'F5',
    'CommandOrControl+Shift+I',    // DevTools
    'CommandOrControl+Shift+J',    // DevTools
    'CommandOrControl+Shift+C',    // DevTools
    'F12'
  ], () => {
    // Blocked — report attempt
    mainWindow.webContents.send('escape-attempt');
    return false;
  });

  // Prevent sleep during interview
  blocker = powerSaveBlocker.start('prevent-display-sleep');
}

// Override close behavior completely
app.on('before-quit', (e) => {
  if (!global.sessionEnded) {
    e.preventDefault();
    mainWindow.webContents.send('close-attempted');
  }
});

app.whenReady().then(() => {
  createWindow();

  // Start window scanner
  const scanner = require('./src/lockdown/scanner');
  scanner.start(sessionId, mainWindow);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (blocker !== undefined) powerSaveBlocker.stop(blocker);
});

// IPC: session ended by recruiter
ipcMain.on('session-ended', () => {
  global.sessionEnded = true;
  globalShortcut.unregisterAll();
  app.quit();
});
```

### candidate-app/src/lockdown/scanner.js
```javascript
// Scans for Interview Coder and similar tools
// Uses WDA_EXCLUDEFROMCAPTURE detection on Windows
// Uses CGWindowSharingState detection on macOS

const { execSync } = require('child_process');
const { EventEmitter } = require('events');

class WindowScanner extends EventEmitter {
  constructor() {
    super();
    this.knownSuspiciousApps = [
      'interview coder',
      'interviewcoder',
      'ezzi',
      'shadecoder',
      'interview browser',
      'interviewbrowser',
      'interview solver',
      'copilot overlay',
      'codeassist'
    ];
  }

  detectWindows_Windows() {
    // PowerShell script to enumerate windows with WDA_EXCLUDEFROMCAPTURE (0x11)
    const psScript = `
$code = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinDetect {
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern uint GetWindowDisplayAffinity(IntPtr hWnd, out uint pdwAffinity);
  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public static List<string> GetHiddenWindows() {
    var results = new List<string>();
    EnumWindows((hwnd, lParam) => {
      if (!IsWindowVisible(hwnd)) return true;
      uint affinity = 0;
      GetWindowDisplayAffinity(hwnd, out affinity);
      if (affinity == 0x11 || affinity == 0x13) {
        var sb = new StringBuilder(256);
        GetWindowText(hwnd, sb, 256);
        results.Add(sb.ToString());
      }
      return true;
    }, IntPtr.Zero);
    return results;
  }
}
"@
Add-Type -TypeDefinition $code
[WinDetect]::GetHiddenWindows() -join "|||"
    `.trim();

    try {
      const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, {
        timeout: 5000,
        windowsHide: true
      }).toString().trim();

      if (result && result !== '') {
        const windows = result.split('|||').filter(Boolean);
        return windows.map(title => ({
          type: 'WDA_EXCLUDEFROMCAPTURE',
          windowTitle: title,
          severity: 'CRITICAL'
        }));
      }
    } catch (err) {
      console.error('[Scanner] Windows scan error:', err.message);
    }
    return [];
  }

  detectWindows_Mac() {
    // Check for windows with NSWindowSharingNone using system_profiler or CGWindowList
    try {
      const script = `
        tell application "System Events"
          set appList to name of every process whose background only is false
          return appList
        end tell
      `;
      const result = execSync(`osascript -e '${script}'`, { timeout: 5000 }).toString().toLowerCase();
      const suspicious = this.knownSuspiciousApps.filter(app => result.includes(app));
      return suspicious.map(app => ({
        type: 'SUSPICIOUS_APP_RUNNING',
        windowTitle: app,
        severity: 'HIGH'
      }));
    } catch {}
    return [];
  }

  scan() {
    const detections = [];
    if (process.platform === 'win32') {
      detections.push(...this.detectWindows_Windows());
    } else if (process.platform === 'darwin') {
      detections.push(...this.detectWindows_Mac());
    }
    return detections;
  }
}

let scanInterval;

function start(sessionId, mainWindow) {
  const scanner = new WindowScanner();

  scanInterval = setInterval(() => {
    const detections = scanner.scan();
    if (detections.length > 0) {
      detections.forEach(detection => {
        mainWindow.webContents.send('security-flag', {
          type: 'OVERLAY_DETECTED',
          detail: `Hidden overlay detected: "${detection.windowTitle}" — possible Interview Coder or AI assistant`,
          severity: detection.severity,
          timestamp: Date.now()
        });
      });
    }
  }, 10000); // every 10 seconds
}

function stop() {
  clearInterval(scanInterval);
}

module.exports = { start, stop };
```

### candidate-app/src/events/monitor.js
```javascript
// Run in renderer process — monitors all browser-level cheat signals

function setupEventMonitors(reportFlag) {
  // Window loses focus (candidate switched away)
  window.addEventListener('blur', () => {
    reportFlag({
      type: 'WINDOW_BLUR',
      detail: 'Interview window lost focus — candidate may have switched applications',
      severity: 'MEDIUM'
    });
  });

  // Visibility change (tab switch or minimize)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      reportFlag({
        type: 'VISIBILITY_LOST',
        detail: 'Interview tab hidden — candidate switched tab or minimized',
        severity: 'MEDIUM'
      });
    }
  });

  // Clipboard paste — candidate may be pasting AI-generated content
  document.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    reportFlag({
      type: 'CLIPBOARD_PASTE',
      detail: `Clipboard paste detected (${text.length} chars)`,
      severity: 'HIGH',
      pasteLength: text.length
    });
  });

  // DevTools detection via console timing trick
  let devToolsOpen = false;
  const devToolsCheck = () => {
    const threshold = 160;
    if (window.outerWidth - window.innerWidth > threshold ||
        window.outerHeight - window.innerHeight > threshold) {
      if (!devToolsOpen) {
        devToolsOpen = true;
        reportFlag({
          type: 'DEVTOOLS_OPENED',
          detail: 'Browser DevTools detected open — possible attempt to inspect or modify session',
          severity: 'HIGH'
        });
      }
    } else {
      devToolsOpen = false;
    }
  };
  setInterval(devToolsCheck, 3000);

  // Multiple monitors detection
  if (window.screen.isExtended !== undefined && window.screen.isExtended) {
    reportFlag({
      type: 'MULTIPLE_MONITORS',
      detail: 'Multiple monitors detected — candidate may be reading content on secondary screen',
      severity: 'MEDIUM'
    });
  }

  // Keyboard shortcut escape attempts reported from main process
  window.truveil?.onEscapeAttempt(() => {
    reportFlag({
      type: 'KEYBOARD_ESCAPE',
      detail: 'Candidate attempted keyboard shortcut to exit secure session',
      severity: 'LOW'
    });
  });
}

module.exports = { setupEventMonitors };
```

### candidate-app/src/audio/recorder.js
```javascript
// Records mic audio and sends chunks to backend via WebSocket

class MicRecorder {
  constructor(wsClient) {
    this.ws = wsClient;
    this.mediaRecorder = null;
    this.stream = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });

    const chunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      blob.arrayBuffer().then(buf => {
        // Send raw audio to backend which relays to recruiter app for transcription
        this.ws.sendAudio(Buffer.from(buf));
      });
      chunks.length = 0;
    };

    // 5-second chunks
    this.mediaRecorder.start();
    setInterval(() => {
      this.mediaRecorder.stop();
      this.mediaRecorder.start();
    }, 5000);
  }

  stop() {
    this.mediaRecorder?.stop();
    this.stream?.getTracks().forEach(t => t.stop());
  }
}

module.exports = MicRecorder;
```

---

## Landing Page — Complete Design Specification

### Design Philosophy
Inspired by **Vercel.com** and **Linear.com**. The aesthetic is:
- Pure black background: `#000000`
- Pure white text: `#ffffff`
- Muted text: `rgba(255,255,255,0.4)` and `rgba(255,255,255,0.6)`
- Border color: `rgba(255,255,255,0.08)` for subtle separators
- Accent: `#ffffff` (no color accents — pure B&W like Vercel)
- Danger highlight (for fraud stats): `#ff4444` — used sparingly
- Zero gradients except a very subtle radial glow behind hero text
- Font: `'Geist'` or fallback `'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'` (load Geist from `https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/style.css`)
- Mono font: `'Geist Mono'` (load from jsdelivr)
- Everything sharp, intentional, generous whitespace
- Subtle grid of dots as background texture (like Linear)
- Micro-animations: fade-up on scroll, underline hover effects
- No rounded corners bigger than 8px
- Buttons: either solid white with black text, or ghost with 1px white border

### Sections — Exact Spec

#### 1. Navigation
- Fixed, top. Background: `rgba(0,0,0,0.7)` with `backdrop-filter: blur(20px)`
- Border bottom: `1px solid rgba(255,255,255,0.06)`
- Left: Logo `Truveil` in Geist 600 weight
- Center: Links — `How it works`, `Pricing`, `Changelog` — 14px, color `rgba(255,255,255,0.6)`, hover → white
- Right: `Sign in` (ghost link) + `Download Free` (solid white button, black text, 8px radius, 12px 20px padding)

#### 2. Hero Section
- Centered, full viewport height
- Subtle background: radial gradient `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,255,255,0.05), transparent)`
- Dot grid texture overlay (SVG pattern, opacity 0.4)
- Top: small badge pill — `border: 1px solid rgba(255,255,255,0.12)`, `background: rgba(255,255,255,0.04)`, Geist Mono 11px — text: `// INTERVIEW FRAUD DETECTION`
- H1: 72px (clamp to 40px on mobile), Geist 700, letter-spacing -2px, line-height 1.05
  - Line 1: `"Catch AI cheating"`
  - Line 2: `"before it costs you"`
  - Line 3: `"$50,000."` (the dollar amount in slightly dimmer white: `rgba(255,255,255,0.7)`)
- Sub: 18px, weight 300, color `rgba(255,255,255,0.5)`, max-width 480px, centered
  - Text: `"Truveil listens to your Zoom interviews and flags AI-assisted answers in real time. One download. One link. No more interview fraud."`
- CTAs row: gap 12px
  - Primary: `Download for Mac` — solid white, black text, 14px, Geist 500
  - Secondary: `Download for Windows` — same style
  - Tertiary text link: `See how it works ↓` — muted white, no button
- Below CTAs: trust line in Geist Mono 12px, muted — `Trusted by 500+ recruiting teams • Works with Zoom, Meet, Teams`

#### 3. Live Detection Preview (Hero visual)
Below the CTAs, a terminal/dashboard mockup showing the product in action.
Build this as an animated HTML element — NOT an image. It should look like the actual recruiter dashboard.

```
┌──────────────────────────────────────────────────────────┐
│ ● ● ●  Truveil — Live Session                  00:04:32  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ▶ TRANSCRIPT                             AI SCORE       │
│                                                          │
│  "Yes, at my previous role I led a team    ████ 82%     │
│   of engineers through a complete          HIGH RISK ⚠   │
│   microservices migration using..."                      │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  ⚠  FLAG: Zero filler words detected                    │
│  ⚠  FLAG: Suspiciously complete structure               │
│  ⚠  FLAG: Window blur event (1 occurrence)              │
│                                                          │
│  [●] RECORDING           SESSION: abc123xyz              │
└──────────────────────────────────────────────────────────┘
```

Style this with: black bg, 1px border `rgba(255,255,255,0.1)`, font Geist Mono, 13px. The numbers should animate (score counts up, timer ticks). Flags appear one by one with a subtle fade-in. Make it feel alive.

#### 4. Stats Bar
3 columns, full width, separated by thin borders. Each stat:
- Number: 48px, Geist 700, white
- Label: 14px, Geist 400, `rgba(255,255,255,0.5)`

Stats:
- `25%` / `of candidates will be fake or AI-assisted by 2028` (source: Gartner)
- `$28K` / `average cost of a single fraudulent hire`
- `100K+` / `active users of Interview Coder and clones`

#### 5. How It Works
3-step horizontal layout. Title: `"Three steps to protected interviews"` — 40px, Geist 700.

Step 1: `01` (Geist Mono, muted) / `Download the recruiter app` / `Install Truveil on your Mac or Windows. It sits quietly in your menu bar.`

Step 2: `02` / `Generate a candidate link` / `One click creates a unique secure link. Paste it into Zoom chat.`

Step 3: `03` / `Get real-time AI detection` / `Truveil listens and flags AI-assisted answers as they happen. Every flag explained.`

Each step has a tiny icon (SVG — download icon, link icon, radar icon) and is separated by a dashed line with a right-arrow between them.

#### 6. What We Detect
Title: `"Nothing gets past Truveil"` — 40px, Geist 700.
Sub: `"Eight detection layers working in real time."`

8-item grid (4 cols × 2 rows on desktop, 2×4 on mobile). Each card:
- `border: 1px solid rgba(255,255,255,0.07)`
- `background: rgba(255,255,255,0.02)`
- `border-radius: 8px`, `padding: 24px`
- Icon (SVG) in muted white
- Title: 14px Geist 600
- Description: 13px, muted

Cards:
1. `🎙 AI Speech Patterns` — `"Detects suspiciously structured answers, missing filler words, and reading cadence."`
2. `👁 Hidden Overlays` — `"Scans for Interview Coder, Ezzi, ShadeCoder using OS-level window flag detection."`
3. `⌨️ Keyboard Escapes` — `"Blocks and logs all Alt+Tab, Cmd+Q, F11 attempts during the session."`
4. `📋 Clipboard Activity` — `"Flags any paste event and logs the character count."`
5. `🖥 Multiple Monitors` — `"Detects extended display setups candidates could use to read hidden content."`
6. `⏱ Response Latency` — `"Tracks the gap between question and answer — AI tools introduce a detectable delay."`
7. `👀 Focus Loss` — `"Logs every time the secure window loses focus, with timestamp."`
8. `🎯 Window Blur Events` — `"Catches application switches even in fullscreen kiosk mode."`

#### 7. Testimonials (3 cards)
Title: `"Recruiters trust Truveil"`
3 quote cards in horizontal scroll on mobile, 3-col grid on desktop.

Card style: `border: 1px solid rgba(255,255,255,0.07)`, `padding: 28px`, `border-radius: 8px`

Quotes (make these realistic):
- "We caught 3 candidates using Interview Coder in one week. The hidden overlay detection alone is worth the subscription." — **Sarah K., Senior Recruiter at a Series B startup**
- "I couldn't figure out why candidates who interviewed brilliantly performed poorly on the job. Truveil explained everything." — **Marcus T., VP Talent Acquisition**
- "Setup was under 5 minutes. Now I send the link before every call. It's become part of our standard process." — **Priya R., Head of Engineering Hiring**

#### 8. Pricing
Title: `"Simple pricing"`, Sub: `"Per interview or monthly. No surprise fees."`

3 pricing cards, center card highlighted with `border: 1px solid rgba(255,255,255,0.25)` (slightly brighter):

**Starter** — `$9/mo`
- 10 interview sessions
- AI detection + transcript
- PDF report per session
- Email support
CTA: `Get started →`

**Growth** — `$29/mo` (POPULAR badge)
- Unlimited sessions
- Up to 5 recruiters
- Priority AI processing
- ATS export (CSV)
- Slack notifications
CTA: `Get started →`

**Enterprise** — `Custom`
- Unlimited recruiters
- SSO / SAML
- Compliance reports
- SLA guarantee
- Dedicated support
CTA: `Talk to us →`

#### 9. Final CTA Banner
Full-width section, centered. Subtle white glow behind heading.
- Title: `"Stop hiring liars."` — 56px, Geist 700
- Sub: `"Start your first session free. No credit card required."`
- Button: `Download Truveil` (solid white, black text, large — 16px, padding 16px 36px)
- Under button: `"Works on Mac & Windows • Zoom, Meet & Teams compatible"`

#### 10. Footer
4-column layout:
- Col 1: Logo + `"Real answers only."` tagline + copyright
- Col 2: Product — How it works, Pricing, Changelog, Download
- Col 3: Company — About, Blog, Privacy, Terms
- Col 4: Developers — API docs, Integrations, Status

All footer text: 13px, `rgba(255,255,255,0.4)`. Links hover → `rgba(255,255,255,0.8)`.

---

### Landing Page CSS Variables
```css
:root {
  --bg: #000000;
  --surface: rgba(255,255,255,0.03);
  --border: rgba(255,255,255,0.08);
  --border-hover: rgba(255,255,255,0.15);
  --text: #ffffff;
  --text-muted: rgba(255,255,255,0.5);
  --text-dim: rgba(255,255,255,0.3);
  --danger: #ff4444;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', 'Fira Code', monospace;
  --nav-height: 64px;
  --transition: 0.15s ease;
}
```

### Dot Grid Background Pattern
```css
body {
  background-color: var(--bg);
  background-image: radial-gradient(
    circle,
    rgba(255,255,255,0.12) 1px,
    transparent 1px
  );
  background-size: 24px 24px;
}
```

### Animations
```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* Apply staggered fade-up to hero elements */
.hero > * {
  animation: fadeUp 0.6s ease both;
}
.hero > *:nth-child(1) { animation-delay: 0.0s; }
.hero > *:nth-child(2) { animation-delay: 0.1s; }
.hero > *:nth-child(3) { animation-delay: 0.2s; }
.hero > *:nth-child(4) { animation-delay: 0.3s; }
.hero > *:nth-child(5) { animation-delay: 0.4s; }
```

### The Dashboard Mockup Animation (JavaScript)
The live dashboard preview in the hero should animate automatically:
1. After 1s: Start typing the transcript text character by character
2. After transcript types 40% of the way: AI score counter starts (0 → 82, counting fast)
3. After score reaches final: First flag appears with fade-in
4. After 1s: Second flag appears
5. After 1s: Third flag appears
6. After all flags appear: Pause 3s, then restart the whole sequence in a loop

---

## Environment Variables — All Apps

### backend/.env.example
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
APP_BASE_URL=https://your-backend.railway.app
CANDIDATE_APP_URL=https://your-backend.railway.app/download
ALLOWED_ORIGINS=https://truveil.com,http://localhost:3000
PORT=3001
JWT_SECRET=your_jwt_secret_here
```

### recruiter-app/.env.example
```
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
BACKEND_URL=https://your-backend.railway.app
BACKEND_WS_URL=wss://your-backend.railway.app
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
```

### candidate-app/.env.example
```
BACKEND_URL=https://your-backend.railway.app
BACKEND_WS_URL=wss://your-backend.railway.app
```

---

## Vercel Config — landing/vercel.json
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" }
      ]
    }
  ]
}
```

---

## Competitors — Full Analysis

| Tool | Who it serves | What they do | Their weakness | How Truveil wins |
|---|---|---|---|---|
| **Interview Coder** | Candidates (enemy) | Invisible AI overlay for candidates | Your target | You detect it specifically |
| **Ezzi** | Candidates (enemy) | Open-source IC clone | Same as above | Same |
| **ShadeCoder** | Candidates (enemy) | Commercial IC clone | Same | Same |
| **HireVue** | Enterprises | Async AI interview platform | No live detection, $50K+/yr | Live detection, $29/mo |
| **Proctorio** | Universities | Exam proctoring browser ext | Not built for interviews, invasive reputation | Interview-native, recruiter-first UX |
| **Codility** | Engineering teams | Coding assessment platform | Only coding, no conversation detection | Works for any interview type |
| **Candor AI** | Recruiters | Basic deepfake + AI detection | Async only, no Zoom integration | Live Zoom detection, recruiter app |
| **Sherlock AI** | Recruiters | Fraud detection reports | Newer player, limited live features | More comprehensive, OS-level detection |
| **VidCruiter** | Enterprise HR | Full hiring platform with proctoring | Enterprise-only, complex, expensive | Simple tool, not a full ATS replacement |
| **InCruiter** | Enterprise HR | AI interview + deepfake detection | India-focused, async, enterprise | Real-time, Zoom-native, affordable |

**The exact gap:** No product combines: (1) recruiter-side Electron app + (2) candidate kiosk lockdown + (3) live AI speech analysis + (4) Interview Coder OS-level detection. Truveil is the only one.

---

## Pricing Strategy

### Model: Per-Interview Credit + Monthly Subscription

| Plan | Price | Sessions | Use Case |
|---|---|---|---|
| Starter | $9/mo | 10 interviews | Small teams, occasional hiring |
| Growth | $29/mo | Unlimited | Actively hiring companies |
| Enterprise | Custom | Unlimited + multi-seat | Staffing agencies, large HR teams |

### Unit Economics
- Whisper API: $0.006/min × 60min = $0.36/interview
- Claude API: ~$0.10/interview (multiple analyses)
- Backend infra (Railway): $5-20/mo fixed
- Total COGS per interview: ~$0.50
- Revenue per interview (Starter plan): $0.90
- Revenue per interview (Growth plan): ~$0 marginal (fixed monthly)
- **Gross margin: ~94%**

---

## Deployment Guide (README.md Content)

### Backend → Railway
```bash
cd backend
npm install
# Set all env vars in Railway dashboard
railway up
```

### Landing Page → Vercel
```bash
cd landing
vercel --prod
```

### Recruiter App → Distribute via GitHub Releases
```bash
cd recruiter-app
npm run build:mac    # Creates .dmg
npm run build:win    # Creates .exe installer
# Upload both to GitHub Releases
```

### Candidate App → Host on Backend
```bash
cd candidate-app
npm run build:mac
npm run build:win
# Upload TruveilSecure.dmg and TruveilSecure-Setup.exe
# to backend/public/files/ folder
# These get served at /files/:filename
```

---

## Build Order — Follow This Exactly

### Step 1: Backend
```bash
cd backend
npm install
# Build server.js, routes/, ws/handler.js, lib/
# Test: POST /sessions returns a sessionId and candidateLink
# Test: WS connection with ?session=X&role=recruiter connects
```

### Step 2: Recruiter App
```bash
cd recruiter-app
npm install
# Build main.js, preload.js, all src/ files
# Test: npm start launches the Electron window
# Test: "New Session" button creates a session and shows a link
# Test: Audio capture starts (check console for chunk events)
# Test: WS connects to backend
```

### Step 3: Candidate App
```bash
cd candidate-app
npm install
# Build main.js, preload.js, all src/ files
# Test: npm start launches in fullscreen kiosk mode
# Test: Alt+F4 and Cmd+Q are blocked
# Test: Window scanner logs to console
# Test: WS connects to backend with candidate role
```

### Step 4: Landing Page
```bash
cd landing
# Build index.html as a single self-contained file
# Test: Open in browser — all sections present, mockup animates
# Deploy: vercel --prod
```

### Step 5: Integration Test
1. Start backend: `cd backend && npm start`
2. Start recruiter app: `cd recruiter-app && npm start`
3. Click "New Session" — copy the candidate link
4. Start candidate app with that session ID: `npm start -- --session=abc123`
5. Verify: Recruiter dashboard shows "Candidate Connected"
6. Speak into mic — verify transcript appears on recruiter dashboard
7. Open a new Electron window (simulating Interview Coder) — verify flag appears

---

## Important Security Notes

1. **Code signing:** Both Electron apps need code signing for production. Windows EV cert (~$300/yr), Apple Developer ($99/yr). For MVP: tell users to click "Run Anyway" on Windows and "Open Anyway" on Mac.

2. **One-time links:** Session links should expire after first use AND after 2 hours. Add `expires_at` column to sessions table.

3. **Audio privacy:** Be transparent about audio recording. Add consent screen to candidate app. Store only 24 hours then auto-delete.

4. **No false positives:** If AI score is high (>70), show it as a flag — never auto-reject or tell candidate they failed. Recruiter makes all final decisions. Add a disclaimer in the dashboard.

5. **Session encryption:** WebSocket connections should be WSS (not WS). Railway handles SSL automatically.

6. **Rate limiting:** Add rate limiting to POST /sessions to prevent abuse. Limit per IP and per recruiter account.

---

Now build everything. Start with Step 1.
