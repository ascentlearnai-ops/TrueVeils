const supabase = require('../lib/supabase');

// In-memory session store
const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      recruiterWs: null,
      candidateWs: null,
      flags: [],
      transcript: [],
      startTime: null
    });
  }
  return sessions.get(sessionId);
}

function init(wss) {
  // ——— Heartbeat: Ping every 30s to keep connections alive ———
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) {
        console.log('[WS] Terminating dead connection');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeatInterval));

  wss.on('connection', (ws, req, sessionId, role) => {
    console.log(`[WS] ${role} connected to session ${sessionId}`);

    // Mark alive for heartbeat
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const session = getOrCreateSession(sessionId);

    if (role === 'recruiter') {
      session.recruiterWs = ws;
    } else if (role === 'candidate') {
      session.candidateWs = ws;
      session.startTime = Date.now();
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
        if (msg.type === 'transcript') {
          session.transcript.push({
            text: msg.data?.text,
            timestamp: msg.timestamp || Date.now(),
            score: msg.data?.aiScore
          });
        }

        if (msg.type === 'flag') {
          session.flags.push({ ...msg.data, timestamp: msg.timestamp || Date.now() });
          await supabase.from('sessions').update({
            flags: session.flags
          }).eq('id', sessionId);
        }

        // Relay to recruiter
        if (session.recruiterWs?.readyState === 1) {
          session.recruiterWs.send(JSON.stringify({
            type: msg.type,
            data: msg.data,
            timestamp: Date.now()
          }));
        }
      }

      if (role === 'recruiter' && msg.type === 'end_session') {
        if (session.candidateWs?.readyState === 1) {
          session.candidateWs.send(JSON.stringify({ type: 'session_ended' }));
        }
        await supabase.from('sessions').update({
          status: 'completed',
          transcript: session.transcript,
          flags: session.flags,
          ended_at: new Date().toISOString()
        }).eq('id', sessionId);
      }
    });

    ws.on('close', () => {
      const duration = session.startTime ? Math.round((Date.now() - session.startTime) / 1000) : 0;
      console.log(`[WS] ${role} disconnected from ${sessionId} | Duration: ${duration}s | Flags: ${session.flags.length} | Transcripts: ${session.transcript.length}`);
      if (role === 'candidate' && session.recruiterWs?.readyState === 1) {
        session.recruiterWs.send(JSON.stringify({
          type: 'candidate_disconnected',
          timestamp: Date.now(),
          metrics: { duration, flagCount: session.flags.length, transcriptCount: session.transcript.length }
        }));
      }
    });

    ws.on('error', (err) => console.error(`[WS Error] ${sessionId} ${role}:`, err));
  });
}

module.exports = { init, sessions };

