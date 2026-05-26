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

// Legacy installer files remain available for old links.
app.use('/files', express.static(path.join(__dirname, 'public/files')));

app.use('/sessions', sessionsRoute);
app.use('/auth', authRoute);
app.use('/reports', reportsRoute);

app.get('/download/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const candidateBaseUrl = process.env.CANDIDATE_APP_URL || process.env.TRUVEIL_CANDIDATE_APP_URL || 'https://truveil-client.vercel.app';
  res.redirect(302, `${candidateBaseUrl.replace(/\/+$/, '')}/?code=${encodeURIComponent(sessionId)}#download`);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

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
