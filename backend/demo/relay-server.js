'use strict';

const http = require('node:http');
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { check, object, sanitizeDetails, sanitizeJoin, transcript, candidateEvent, closeCommand, number } = require('./validation');
const { createDeepgramTokenProvider, validateToken } = require('./token-provider');
const { createTokenBudget } = require('./token-budget');

const DEFAULT_LIMITS = Object.freeze({
  ttlMs: 30 * 60 * 1000, approvalTimeoutMs: 120000, idleTimeoutMs: 10000,
  heartbeatMs: 10000, maxRooms: 32, maxPeersPerRoom: 2, maxConnections: 128,
  maxConnectionsPerIp: 8, maxIpEntries: 4096, maxMessageBytes: 65536,
  maxBufferedBytes: 131072, rateWindowMs: 60000, maxRequestsPerIp: 1800,
  maxUpgradesPerIp: 30, maxCommandsPerRoom: 256,
  tokenMinIntervalMs: 10000, tokenWindowMs: 60000, maxTokensPerWindow: 3,
  maxTokensPerRoom: 10, tokenTimeoutMs: 5000,
  tokenBudgetWindowMs: 60000, maxTokensPerIpWindow: 6,
  maxTokensPerServerWindow: 24, maxTokensLifetime: 100
});

function roomCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let value = 0; let output = 'DEMO-';
  for (const byte of randomBytes(10)) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; output += alphabet[(value >>> bits) & 31]; }
  }
  return output;
}

function createDemoRelay(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) check(Number.isSafeInteger(value) && value > 0, `Invalid relay limit: ${key}.`);
  check(limits.ttlMs <= DEFAULT_LIMITS.ttlMs && limits.approvalTimeoutMs <= 120000, 'Demo lifetime cannot exceed 30 minutes.');
  const injectedProvider = Object.hasOwn(options, 'tokenProvider');
  const tokenProvider = injectedProvider ? options.tokenProvider : createDeepgramTokenProvider();
  check(tokenProvider === null || typeof tokenProvider === 'function', 'Invalid token provider.');
  const hostKey = Object.hasOwn(options, 'hostKey') ? options.hostKey : process.env.TRUVEIL_DEMO_HOST_KEY || '';
  check(typeof hostKey === 'string' && (hostKey === '' || /^[A-Za-z0-9_-]{32,256}$/.test(hostKey)),
    'TRUVEIL_DEMO_HOST_KEY must contain 32-256 random base64url or hex characters.');
  check(hostKey || (injectedProvider && tokenProvider === null), 'TRUVEIL_DEMO_HOST_KEY is required.');
  const hostKeyHash = hostKey ? createHash('sha256').update(hostKey).digest() : null;
  const tokenBudget = createTokenBudget(limits);
  const rooms = new Map();
  const peers = new Set();
  const ips = new Map();
  const httpSockets = new Set();
  let stopped = false;
  let closing;

  function bucket(ip) {
    const now = Date.now();
    let b = ips.get(ip);
    if (b && now - b.start >= limits.rateWindowMs) {
      b.start = now; b.requests = 0; b.upgrades = 0;
    }
    if (!b) {
      if (ips.size >= limits.maxIpEntries) return null;
      b = { start: now, requests: 0, upgrades: 0, connections: 0 };
      ips.set(ip, b);
    }
    return b;
  }

  function closePeer(peer, reason) {
    if (peer.closing) return;
    peer.closing = true;
    clearTimeout(peer.idleTimer);
    if (peer.ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ kind: 'closed', reason });
      if (peer.ws.bufferedAmount + Buffer.byteLength(message) <= limits.maxBufferedBytes) peer.ws.send(message, () => {});
      peer.ws.close(1000, reason);
    }
    peer.killTimer = setTimeout(() => peer.ws.terminate(), 200);
    peer.killTimer.unref();
  }

  function endRoom(room, reason) {
    if (!room || room.ended) return;
    room.ended = true;
    rooms.delete(room.code);
    clearTimeout(room.expiryTimer);
    clearTimeout(room.approvalTimer);
    room.tokenController?.abort();
    const members = [room.host, room.candidate || room.pending?.peer].filter(Boolean);
    for (const peer of members) {
      const message = JSON.stringify({ kind: 'event', event: 'session_ended', payload: { sessionId: room.code, reason, senderRole: 'server', timestamp: Date.now() } });
      if (peer.ws.readyState === WebSocket.OPEN && peer.ws.bufferedAmount + Buffer.byteLength(message) <= limits.maxBufferedBytes) peer.ws.send(message, () => {});
      peer.room = null; peer.role = null; peer.join = null;
      closePeer(peer, reason);
    }
    room.commands.clear();
    room.usedCommands.clear();
    room.tokenTimes.length = 0;
    room.details = null; room.tabs = null; room.pending = null;
    room.host = null; room.candidate = null; room.tokenController = null;
  }

  function drop(peer, reason) {
    if (peer.room) endRoom(peer.room, reason);
    else closePeer(peer, reason);
  }

  function send(peer, value) {
    if (!peer || peer.closing || peer.ws.readyState !== WebSocket.OPEN) return false;
    const data = JSON.stringify(value);
    if (peer.ws.bufferedAmount + Buffer.byteLength(data) > limits.maxBufferedBytes) { drop(peer, 'backpressure'); return false; }
    peer.ws.send(data, error => { if (error) drop(peer, 'disconnected'); });
    return true;
  }

  function reply(peer, id, result) { return send(peer, { id, ok: true, result }); }
  function failure(peer, id, error) { send(peer, { id, ok: false, error }); }
  function emit(room, peer, event, payload, senderRole = 'server') {
    return send(peer, { kind: 'event', event, payload: {
      ...payload, sessionId: room.code, senderRole, role: senderRole,
      ...(senderRole === 'candidate' ? { candidateName: room.candidate.join.name } : {}), timestamp: Date.now()
    } });
  }
  function metadata(room) { return { roomId: room.id, code: room.code, details: room.details, expiresAt: room.expiresAt }; }
  function authorized(peer, role, active = false) {
    const room = peer.room;
    check(room && !room.ended, 'No authorized demo room.');
    if (Date.now() >= room.expiresAt) { endRoom(room, 'expired'); throw new Error('Demo room expired.'); }
    check(!role || peer.role === role, `Not authorized; ${role} role required.`);
    check(!active || room.startedAt, 'An active approved demo session is required.');
    return room;
  }

  async function grant(peer, room) {
    check(room.candidate === peer && peer.join.consentConfirmed && peer.join.microphoneReady, 'Approved candidate microphone consent required.');
    check(typeof tokenProvider === 'function', 'Transcription provider not configured.');
    const now = Date.now();
    room.tokenTimes = room.tokenTimes.filter(time => now - time < limits.tokenWindowMs);
    check(!room.tokenController && now - room.lastTokenAt >= limits.tokenMinIntervalMs &&
      room.tokenTimes.length < limits.maxTokensPerWindow && room.tokenCount < limits.maxTokensPerRoom, 'Temporary token request throttled.');
    tokenBudget.consume(peer.ip);
    room.tokenTimes.push(now); room.lastTokenAt = now; room.tokenCount++;
    const controller = new AbortController();
    room.tokenController = controller;
    const timeout = setTimeout(() => controller.abort(), limits.tokenTimeoutMs);
    let onAbort;
    try {
      const cancelled = new Promise((resolve, reject) => {
        onAbort = () => reject(new Error('Transcription request cancelled or timed out.'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const token = await Promise.race([Promise.resolve().then(() => tokenProvider({ signal: controller.signal })), cancelled]);
      check(!controller.signal.aborted && !room.ended && peer.room === room && room.candidate === peer && Date.now() < room.expiresAt, 'Demo session ended.');
      return { ok: true, ...validateToken(token) };
    } catch {
      throw new Error('Transcription provider unavailable or request cancelled.');
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', onAbort);
      if (room.tokenController === controller) room.tokenController = null;
    }
  }

  function broadcast(peer, data) {
    object(data);
    check(data.type === 'broadcast', 'Unsupported channel type.');
    if (data.event === 'candidate_audio_chunk') throw new Error('Audio chunk fallback is unsupported in demo mode.');
    const room = authorized(peer);
    if (peer.role === 'host') {
      check(data.event === 'recruiter_action', 'Not authorized for this host event; use start/update/end methods.');
      authorized(peer, 'host', true);
      check(room.candidate && room.tabs?.connected && room.tabs.observeConsent && room.tabs.closeConsent && room.candidate.join.tabObserveConsent && room.candidate.join.tabCloseConsent, 'Candidate tab observation and close consent required.');
      const command = closeCommand(data.payload);
      check(!room.usedCommands.has(command.commandId), 'Duplicate command replay denied.');
      check(room.usedCommands.size < limits.maxCommandsPerRoom, 'Room command limit reached.');
      const tab = room.tabs.tabs.find(item => item.id === command.target.id);
      check(tab && !tab.protected && tab.revision === command.target.revision, 'Missing, protected or stale tab target.');
      room.usedCommands.add(command.commandId);
      room.commands.set(command.commandId, Date.now());
      check(emit(room, room.candidate, data.event, command, 'host'), 'Candidate disconnected.');
      return;
    }
    check(peer.role === 'candidate', 'Approved candidate required.');
    check(['candidate_transcript', 'candidate_audio_level', 'candidate_event'].includes(data.event), 'Not authorized for this candidate event.');
    let payload;
    if (data.event === 'candidate_transcript') {
      authorized(peer, 'candidate', true);
      payload = transcript(data.payload);
    } else if (data.event === 'candidate_audio_level') {
      authorized(peer, 'candidate', true);
      object(data.payload);
      payload = { type: 'candidate_audio_level', rms: number(data.payload.rms, 1), peak: number(data.payload.peak, 1) };
    } else {
      payload = candidateEvent(data.payload);
      if (payload.type === 'browser_tabs') {
        authorized(peer, 'candidate', true);
        check(!payload.state.observeConsent || peer.join.tabObserveConsent, 'Tab observation consent was not granted at join.');
        check(!payload.state.closeConsent || peer.join.tabCloseConsent, 'Tab close consent was not granted at join.');
        peer.join.tabObserveConsent &&= payload.state.observeConsent;
        // The bridge initially advertises no close capability until pairing completes.
        if (payload.state.connected || !payload.state.observeConsent) peer.join.tabCloseConsent &&= payload.state.closeConsent;
        room.tabs = payload.state;
        if (!payload.state.closeConsent || !payload.state.observeConsent || !payload.state.connected) room.commands.clear();
      }
      if (payload.type === 'browser_tab_close_result') {
        authorized(peer, 'candidate', true);
        const issued = room.commands.get(payload.commandId);
        check(issued !== undefined && Date.now() - issued <= 30000, 'Unknown, expired or duplicate close command.');
        room.commands.delete(payload.commandId);
      }
      if (payload.externalReviewConsent) peer.join.externalReviewConsent = payload.externalReviewConsent.enabled;
      if (payload.consentConfirmed === false || payload.microphoneReady === false) {
        emit(room, room.host, data.event, payload, 'candidate');
        return 'consent_revoked';
      }
    }
    check(emit(room, room.host, data.event, payload, 'candidate'), 'Host disconnected.');
    if (['candidate_interrupted', 'session_ended_remote', 'candidate_completed', 'candidate_cancelled'].includes(payload.type)) return 'candidate_ended';
  }

  async function handle(peer, bytes, binary) {
    if (peer.closing) return;
    const ip = bucket(peer.ip);
    if (!ip || ++ip.requests > limits.maxRequestsPerIp) { drop(peer, 'rate_limit'); return; }
    if (binary || bytes.length > limits.maxMessageBytes) { drop(peer, 'invalid_message'); return; }
    let message;
    try { message = JSON.parse(bytes.toString('utf8')); object(message); }
    catch { drop(peer, 'invalid_message'); return; }
    const { id, op, data = {} } = message;
    const envelopeKeys = op === 'create' ? ['id', 'op', 'data', 'hostAccessCode'] : ['id', 'op', 'data'];
    if (!Number.isSafeInteger(id) || id < 1 || Object.keys(message).some(key => !envelopeKeys.includes(key))) { drop(peer, 'invalid_message'); return; }
    if (id <= peer.lastId) { failure(peer, id, 'Request replay denied.'); return; }
    peer.lastId = id;
    try {
      object(data);
      if (['start', 'token', 'end'].includes(op)) check(Object.keys(data).length === 0, 'Room selectors and authority overrides are not authorized.');
      if (op === 'create') {
        if (hostKeyHash) {
          const supplied = message.hostAccessCode;
          check(typeof supplied === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(supplied) &&
            timingSafeEqual(hostKeyHash, createHash('sha256').update(supplied).digest()), 'Host access denied.');
        }
        delete message.hostAccessCode;
        check(!peer.room, 'Socket already bound to a room.');
        const details = sanitizeDetails(data);
        check(rooms.size < limits.maxRooms, 'Demo room capacity limit reached.');
        let code;
        do { code = roomCode(); } while (rooms.has(code));
        const room = { id: randomUUID(), code, details, host: peer, candidate: null, pending: null,
          expiresAt: Date.now() + limits.ttlMs, startedAt: null, ended: false, tabs: null,
          commands: new Map(), usedCommands: new Set(), tokenTimes: [], tokenCount: 0, lastTokenAt: -Infinity, tokenController: null };
        rooms.set(code, room); peer.room = room; peer.role = 'host';
        clearTimeout(peer.idleTimer);
        room.expiryTimer = setTimeout(() => endRoom(room, 'expired'), limits.ttlMs);
        reply(peer, id, metadata(room));
      } else if (op === 'join') {
        check(!peer.room, 'Socket already bound to a room.');
        const join = sanitizeJoin(data);
        const room = rooms.get(join.code);
        check(room && !room.ended && Date.now() < room.expiresAt, 'Demo room unavailable.');
        check(limits.maxPeersPerRoom >= 2 && !room.candidate && !room.pending, 'Demo peer limit reached.');
        check(!room.startedAt, 'Demo already started.');
        peer.room = room; peer.role = 'pending'; peer.join = join;
        clearTimeout(peer.idleTimer);
        room.pending = { peer, requestId: randomUUID(), responseId: id };
        room.approvalTimer = setTimeout(() => endRoom(room, 'approval_timeout'), limits.approvalTimeoutMs);
        send(room.host, { kind: 'join-request', requestId: room.pending.requestId, name: join.name });
      } else if (op === 'approve') {
        const room = authorized(peer, 'host');
        check(typeof data.allow === 'boolean' && room.pending && room.pending.requestId === data.requestId, 'Join request unavailable or already approved.');
        const pending = room.pending;
        check(!pending.peer.closing && pending.peer.ws.readyState === WebSocket.OPEN, 'Candidate disconnected.');
        if (!reply(peer, id, { ok: true })) return;
        if (!data.allow) { endRoom(room, 'declined'); return; }
        clearTimeout(room.approvalTimer);
        room.candidate = pending.peer; room.candidate.role = 'candidate'; room.pending = null;
        reply(room.candidate, pending.responseId, metadata(room));
      } else if (op === 'update') {
        const room = authorized(peer, 'host');
        room.details = sanitizeDetails(data, room.details);
        if (room.candidate) emit(room, room.candidate, 'session_policy', { policy: room.details.policy, technicalVocabulary: room.details.technicalVocabulary, details: room.details });
        reply(peer, id, { ok: true });
      } else if (op === 'start') {
        const room = authorized(peer, 'host');
        check(room.candidate && room.candidate.join.consentConfirmed && room.candidate.join.microphoneReady, 'An approved candidate with consent and microphone readiness is required.');
        if (!room.startedAt) {
          room.startedAt = Date.now();
          const payload = { startedAt: room.startedAt };
          emit(room, room.candidate, 'session_started', payload);
          if (!room.ended) emit(room, room.host, 'session_started', payload);
        }
        reply(peer, id, { ok: true, startedAt: room.startedAt });
      } else if (op === 'broadcast') {
        const room = peer.room;
        const reason = broadcast(peer, data);
        reply(peer, id, 'ok');
        if (reason) endRoom(room, reason);
      } else if (op === 'token') {
        const room = authorized(peer, 'candidate', true);
        reply(peer, id, await grant(peer, room));
      } else if (op === 'end') {
        const room = authorized(peer);
        reply(peer, id, { ok: true });
        endRoom(room, 'ended');
      } else throw new Error('Unsupported demo operation.');
    } catch (error) { failure(peer, id, error.message); }
  }

  const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const ip = bucket(req.socket.remoteAddress);
    const limited = !ip || ++ip.requests > limits.maxRequestsPerIp;
    res.writeHead(limited ? 429 : 404, { Connection: 'close', 'Cache-Control': 'no-store' });
    res.end();
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.timeout = 10000;
  server.maxConnections = limits.maxConnections * 2;
  server.on('connection', socket => { httpSockets.add(socket); socket.on('close', () => httpSockets.delete(socket)); });
  server.on('clientError', (_, socket) => socket.destroy());
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxMessageBytes, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const reject = status => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (stopped || req.url !== '/demo' || req.method !== 'GET') return reject('404 Not Found');
    if (Object.hasOwn(req.headers, 'origin') || req.headers['sec-websocket-protocol']) return reject('403 Forbidden');
    const ip = req.socket.remoteAddress;
    const b = bucket(ip);
    if (!b || ++b.upgrades > limits.maxUpgradesPerIp || b.connections >= limits.maxConnectionsPerIp || peers.size >= limits.maxConnections) return reject('429 Too Many Requests');
    wss.handleUpgrade(req, socket, head, ws => {
      b.connections++;
      const peer = { ws, ip, room: null, role: null, join: null, lastId: 0, alive: true, closing: false };
      peers.add(peer);
      peer.idleTimer = setTimeout(() => drop(peer, 'idle_timeout'), limits.idleTimeoutMs);
      ws.on('pong', () => { peer.alive = true; });
      ws.on('message', (bytes, binary) => { handle(peer, bytes, binary).catch(() => drop(peer, 'invalid_message')); });
      ws.on('error', () => drop(peer, 'disconnected'));
      ws.on('close', () => {
        clearTimeout(peer.idleTimer); clearTimeout(peer.killTimer);
        if (peer.room) endRoom(peer.room, 'disconnected');
        peers.delete(peer); b.connections--;
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      if (!peer.alive) { drop(peer, 'disconnected'); continue; }
      peer.alive = false;
      if (peer.ws.readyState === WebSocket.OPEN && !peer.closing) peer.ws.ping();
    }
    for (const [ip, b] of ips) if (!b.connections && Date.now() - b.start >= limits.rateWindowMs) ips.delete(ip);
  }, limits.heartbeatMs);
  heartbeat.unref();

  return {
    get stats() { return { rooms: rooms.size, peers: peers.size, trackedIps: ips.size }; },
    listen(port = 43180, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        if (stopped) { reject(new Error('Relay closed.')); return; }
        if (!hostKeyHash && !['127.0.0.1', '::1'].includes(host)) {
          reject(new Error('TRUVEIL_DEMO_HOST_KEY is required for a non-loopback listener.')); return;
        }
        const onError = error => { server.off('listening', onListen); reject(error); };
        const onListen = () => { server.off('error', onError); resolve(server.address()); };
        server.once('error', onError); server.once('listening', onListen); server.listen(port, host);
      });
    },
    close() {
      if (closing) return closing;
      stopped = true; clearInterval(heartbeat);
      for (const room of rooms.values()) endRoom(room, 'server_shutdown');
      for (const peer of peers) { closePeer(peer, 'server_shutdown'); peer.ws.terminate(); }
      for (const socket of httpSockets) socket.destroy();
      ips.clear();
      closing = new Promise(resolve => { wss.close(() => {}); server.close(() => resolve()); });
      return closing;
    }
  };
}

module.exports = { createDemoRelay, DEFAULT_LIMITS };
