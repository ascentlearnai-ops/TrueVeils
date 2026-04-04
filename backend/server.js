require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');

const sessionsRoute = require('./routes/sessions');
const authRoute = require('./routes/auth');
const reportsRoute = require('./routes/reports');
const wsHandler = require('./ws/handler');

const app = express();
const server = http.createServer(app);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json());

// Serve candidate app installers
app.use('/files', express.static(path.join(__dirname, 'public/files')));

// REST routes
app.use('/sessions', sessionsRoute);
app.use('/auth', authRoute);
app.use('/reports', reportsRoute);

// Candidate download page
app.get('/download/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const userAgent = req.headers['user-agent'] || '';
  const isMac = /Mac|iPhone|iPad/.test(userAgent);
  const fileName = 'TruveilSecure-Setup.exe';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    setTimeout(() => document.getElementById('dl').click(), 1500);
  </script>
</body>
</html>`);
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// WebSocket setup
const wss = new WebSocketServer({ noServer: true });
wsHandler.init(wss);

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
