const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let runtimeConfig = {};
try {
  runtimeConfig = require('./src/config/runtime-config.json');
} catch {}

const SessionManager = require('./src/session/manager');
const LocalRisk = require('./src/ai/local-risk');
const ReportGenerator = require('./src/report/generator');
const SettingsStore = require('./src/settings/store');
const { LocalTranscriber } = require('./src/audio/local-transcriber');
const { DeepgramTranscriber } = require('./src/audio/deepgram-transcriber');
const { GroqTranscriber } = require('./src/audio/groq-transcriber');

let mainWindow;
let tray;
let activeSession = null;
let sessionData = null; // in-memory log for report
let supabase = null;
let realtimeChannel = null;
let localTranscriber = null;
let deepgramTranscriber = null;
let groqTranscriber = null;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWithRetry(operation, { attempts = 3, baseDelayMs = 650 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await delay(baseDelayMs * attempt);
    }
  }
  throw lastError;
}

function normalizePolicy(policy = {}) {
  const defaultBlockedSites = [
    'chatgpt.com',
    'claude.ai',
    'gemini.google.com',
    'copilot.microsoft.com',
    'perplexity.ai',
    'poe.com',
    'you.com',
    'phind.com',
    'interviewcoder',
    'interview coder',
    'cluely',
    'finalround',
    'lockedin',
    'parakeet',
    'leetcode wizard',
    'ultracode',
    'interview copilot'
  ];
  const toList = (value, fallback = []) => {
    const items = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,]/);
    const cleaned = items.map(item => String(item).trim()).filter(Boolean);
    return cleaned.length ? cleaned : fallback;
  };

  return {
    allowed_apps: toList(policy.allowed_apps || policy.allowedApps, [
      'TruveilSecure',
      'Zoom',
      'Microsoft Teams',
      'Google Chrome',
      'Microsoft Edge'
    ]),
    allowed_sites: toList(policy.allowed_sites || policy.allowedSites, [
      'meet.google.com',
      'zoom.us',
      'teams.microsoft.com'
    ]),
    blocked_sites: toList(policy.blocked_sites || policy.blockedSites, defaultBlockedSites),
    blocking_mode: policy.blocking_mode || policy.blockingMode || 'warn_refocus'
  };
}

function getSupabase() {
  if (supabase) return supabase;
  const url = runtimeConfig.supabaseUrl || process.env.SUPABASE_URL || process.env.TRUVEIL_SUPABASE_URL;
  const key = runtimeConfig.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || process.env.TRUVEIL_SUPABASE_ANON_KEY;
  if (url?.includes('dummy.supabase.co') || key === 'dummy') return null;
  if (!url || !key) return null;
  supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      transport: WebSocket,
      params: { eventsPerSecond: 10 }
    }
  });
  return supabase;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function getLocalTranscriber() {
  if (localTranscriber) return localTranscriber;
  localTranscriber = new LocalTranscriber({
    userDataPath: app.getPath('userData'),
    onStatus: (status) => sendToRenderer('realtime:audio-status', status)
  });
  return localTranscriber;
}

function getGroqTranscriber() {
  if (groqTranscriber) return groqTranscriber;
  groqTranscriber = new GroqTranscriber({
    apiKey: runtimeConfig.groqApiKey || process.env.GROQ_API_KEY || process.env.TRUVEIL_GROQ_API_KEY || '',
    onStatus: (status) => sendToRenderer('realtime:audio-status', status)
  });
  return groqTranscriber;
}

function getDeepgramTranscriber() {
  if (deepgramTranscriber) return deepgramTranscriber;
  deepgramTranscriber = new DeepgramTranscriber({
    apiKey: runtimeConfig.deepgramApiKey || process.env.DEEPGRAM_API_KEY || process.env.TRUVEIL_DEEPGRAM_API_KEY || '',
    onStatus: (status) => sendToRenderer('realtime:audio-status', status)
  });
  return deepgramTranscriber;
}

async function transcribeAudioEntry(entry) {
  const errors = [];

  const deepgram = getDeepgramTranscriber();
  if (deepgram.isConfigured()) {
    try {
      sendToRenderer('realtime:audio-status', {
        state: 'transcribing',
        message: 'Transcribing with Deepgram',
        chunkId: entry.chunkId,
        timestamp: Date.now()
      });
      const result = await deepgram.transcribe(entry.localPath, entry);
      const text = String(result.text || '').trim();
      if (text) return { text, source: 'deepgram-nova-3', result };
      errors.push(new Error('Deepgram did not detect clear speech in this audio chunk.'));
    } catch (err) {
      errors.push(err);
    }
  }

  const groq = getGroqTranscriber();
  if (groq.isConfigured()) {
    try {
      sendToRenderer('realtime:audio-status', {
        state: 'transcribing',
        message: 'Deepgram unavailable; trying Groq Whisper',
        chunkId: entry.chunkId,
        timestamp: Date.now()
      });

      const result = await groq.transcribe(entry.localPath, entry);
      const text = String(result.text || '').trim();
      if (text) return { text, source: 'groq-whisper', result };
      errors.push(new Error('Groq did not detect clear speech in this audio chunk.'));
    } catch (err) {
      errors.push(err);
    }
  }

  try {
    sendToRenderer('realtime:audio-status', {
      state: 'transcribing',
      message: 'Cloud transcription unavailable; trying local Whisper',
      chunkId: entry.chunkId,
      timestamp: Date.now()
    });
    const result = await getLocalTranscriber().transcribeQueued(entry.localPath, entry);
    const text = String(result.text || '').trim();
    if (text) return { text, source: 'local-whisper', result };
    errors.push(new Error('Local speech engine did not detect clear speech in this audio chunk.'));
  } catch (err) {
    errors.push(err);
  }

  const message = errors.map(err => err?.message).filter(Boolean).slice(-2).join(' | ');
  throw new Error(message || 'No transcription provider returned text.');
}

function sessionChannelName(sessionId) {
  return `truveil-session:${sessionId}`;
}

function buildSessionPayload(session, { includePolicy = true } = {}) {
  const candidateBaseUrl = process.env.CANDIDATE_APP_URL || process.env.TRUVEIL_CANDIDATE_APP_URL || 'https://truveil-client.vercel.app';
  const candidateLink = `${candidateBaseUrl.replace(/\/+$/, '')}/?code=${encodeURIComponent(session.sessionId)}#download`;
  const payload = {
    id: session.sessionId,
    candidate_link: candidateLink,
    status: 'waiting',
    flags: [],
    transcript: [],
    created_at: new Date(session.createdAt).toISOString()
  };

  if (includePolicy) {
    const policy = normalizePolicy(session.policy);
    payload.allowed_apps = policy.allowed_apps;
    payload.allowed_sites = policy.allowed_sites;
    payload.blocked_sites = policy.blocked_sites;
    payload.blocking_mode = policy.blocking_mode;
  }

  return payload;
}

function isPolicySchemaError(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return text.includes('allowed_apps')
    || text.includes('allowed_sites')
    || text.includes('blocked_sites')
    || text.includes('blocking_mode')
    || text.includes('schema cache')
    || text.includes('column');
}

async function ensureRemoteSession(session) {
  const client = getSupabase();
  if (!client) {
    console.warn('[Supabase] Not configured; created a local-only session code.');
    return false;
  }

  const withPolicy = await client.from('sessions').upsert(buildSessionPayload(session));
  if (!withPolicy.error) return true;
  if (!isPolicySchemaError(withPolicy.error)) throw new Error(withPolicy.error.message);

  console.warn('[Supabase] Policy columns missing; creating session without persisted policy.');
  const baseOnly = await client.from('sessions').upsert(buildSessionPayload(session, { includePolicy: false }));
  if (baseOnly.error) throw new Error(baseOnly.error.message);
  return true;
}

async function updateRemotePolicy(sessionId, policy) {
  const client = getSupabase();
  if (!client) return;

  const { error } = await client.from('sessions').update({
    allowed_apps: policy.allowed_apps,
    allowed_sites: policy.allowed_sites,
    blocked_sites: policy.blocked_sites,
    blocking_mode: policy.blocking_mode
  }).eq('id', sessionId);

  if (!error) return;
  if (!isPolicySchemaError(error)) throw new Error(error.message);
  console.warn('[Supabase] Policy columns missing; policy will be sent over realtime only.');
}

async function broadcastSessionPolicy() {
  if (!activeSession || !realtimeChannel) return;
  try {
    await realtimeChannel.send({
      type: 'broadcast',
      event: 'session_policy',
      payload: {
        sessionId: activeSession.sessionId,
        policy: normalizePolicy(activeSession.policy),
        timestamp: Date.now()
      }
    });
  } catch (err) {
    console.warn('[Realtime] policy broadcast failed:', err.message);
  }
}

async function joinRealtimeSession(sessionId) {
  const client = getSupabase();
  if (!client) return false;
  if (realtimeChannel) await client.removeChannel(realtimeChannel);

  realtimeChannel = client
    .channel(sessionChannelName(sessionId), {
      config: { broadcast: { self: false }, presence: { key: 'recruiter' } }
    })
    .on('broadcast', { event: 'candidate_transcript' }, ({ payload }) => {
      if (payload?.interim) {
        sendToRenderer('realtime:transcript-interim', {
          text: payload.text,
          timestamp: payload.timestamp || Date.now(),
          source: payload.source || 'candidate-web-speech-interim'
        });
        return;
      }
      analyzeCandidateTranscript(payload);
    })
    .on('broadcast', { event: 'candidate_audio_chunk' }, ({ payload }) => {
      handleCandidateAudioChunk(payload);
    })
    .on('broadcast', { event: 'candidate_audio_level' }, ({ payload }) => {
      handleCandidateAudioLevel(payload);
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
  return true;
}

async function analyzeCandidateTranscript(payload = {}) {
  if (!sessionData || !payload.text) return;

  const text = String(payload.text || '').trim();
  if (text.length < 4) return;

  const timestamp = payload.timestamp || Date.now();
  const analysis = LocalRisk.analyzeTranscript(text, {
    durationMs: payload.durationMs,
    sequence: payload.sequence
  });
  const entry = {
    text,
    timestamp,
    aiScore: analysis.score,
    label: analysis.label,
    displayLabel: analysis.displayLabel,
    confidence: analysis.confidence,
    scorable: analysis.scorable !== false,
    scoreWeight: analysis.scoreWeight || 0,
    flags: analysis.flags || [],
    reasoning: analysis.reasoning,
    aiSignals: analysis.aiSignals || [],
    humanSignals: analysis.humanSignals || [],
    source: payload.source || 'candidate-transcript'
  };

  sessionData.transcripts.push(entry);
  if (typeof entry.aiScore === 'number' && entry.scorable) {
    sessionData.scores.push({ score: entry.aiScore, weight: entry.scoreWeight || 1 });
  }
  (entry.flags || []).forEach(flagText => {
    sessionData.flags.push({
      text: flagText,
      timestamp,
      severity: entry.aiScore >= 70 ? 'high' : 'medium'
    });
  });

  sendToRenderer('realtime:transcript', entry);
}

function safeFilePart(value) {
  return String(value || 'audio').replace(/[^a-z0-9._-]/gi, '_');
}

async function blobToBuffer(blob) {
  if (Buffer.isBuffer(blob)) return blob;
  if (blob instanceof ArrayBuffer) return Buffer.from(blob);
  if (ArrayBuffer.isView(blob)) return Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (blob?.arrayBuffer) return Buffer.from(await blob.arrayBuffer());
  throw new Error('Unsupported storage download payload.');
}

async function updateAudioChunkRow(chunkId, patch = {}) {
  const client = getSupabase();
  if (!client || !chunkId) return;
  const { error } = await client.from('audio_chunks').update(patch).eq('id', chunkId);
  if (error) console.warn('[Supabase] audio chunk update failed:', error.message);
}

async function broadcastAudioChunkStatus(entry, patch = {}) {
  const payload = {
    sessionId: entry.sessionId,
    chunkId: entry.chunkId,
    sequence: entry.sequence,
    durationMs: entry.durationMs,
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
    status: entry.status,
    transcript: entry.transcript || '',
    aiScore: entry.aiScore,
    flags: entry.flags || [],
    reasoning: entry.reasoning || '',
    source: entry.source || '',
    remoteDeleted: Boolean(entry.remoteDeleted),
    timestamp: Date.now(),
    ...patch
  };

  sendToRenderer('realtime:audio-chunk', payload);
  if (realtimeChannel) {
    try {
      await realtimeChannel.send({ type: 'broadcast', event: 'audio_chunk_status', payload });
    } catch (err) {
      console.warn('[Realtime] audio status broadcast failed:', err.message);
    }
  }
}

async function deleteRemoteAudioChunk(entry, finalStatus) {
  if (!entry || entry.remoteDeleted) return;
  const client = getSupabase();
  const storagePath = entry.storagePath;
  if (!client || !storagePath) return;

  try {
    const { error } = await client.storage.from('session-audio').remove([storagePath]);
    if (error) throw new Error(error.message);
    entry.remoteDeleted = true;
    entry.status = finalStatus;
    entry.storagePath = '';
    await updateAudioChunkRow(entry.chunkId, {
      status: finalStatus,
      cleaned_at: new Date().toISOString()
    });
    await broadcastAudioChunkStatus(entry, { status: finalStatus, remoteDeleted: true });
  } catch (err) {
    console.warn('[Supabase] immediate audio cleanup failed:', err.message);
  }
}

function handleCandidateAudioLevel(payload = {}) {
  if (!sessionData) return;
  sessionData.lastAudioLevel = {
    rms: Number(payload.rms) || 0,
    peak: Number(payload.peak) || 0,
    timestamp: payload.timestamp || Date.now()
  };
  sendToRenderer('realtime:audio-level', sessionData.lastAudioLevel);
}

async function handleCandidateAudioChunk(payload = {}) {
  if (!sessionData || !payload.chunkId || !payload.storagePath) {
    sendToRenderer('realtime:audio-status', {
      state: 'error',
      message: 'Received an incomplete fallback audio signal.',
      timestamp: Date.now()
    });
    return;
  }
  if (!Array.isArray(sessionData.audioChunks)) sessionData.audioChunks = [];

  const existing = sessionData.audioChunks.find(chunk => chunk.chunkId === payload.chunkId);
  if (existing) {
    await broadcastAudioChunkStatus(existing);
    return;
  }

  const client = getSupabase();
  if (!client) {
    sendToRenderer('realtime:audio-status', {
      state: 'error',
      message: 'Supabase storage is not configured, so fallback audio cannot be transcribed.',
      chunkId: payload.chunkId,
      timestamp: Date.now()
    });
    return;
  }

  const sessionId = payload.sessionId || activeSession?.sessionId || sessionData.session.sessionId;
  const sessionDir = path.join(app.getPath('userData'), 'sessions', safeFilePart(sessionId), 'audio');
  fs.mkdirSync(sessionDir, { recursive: true });

  const extension = payload.mimeType?.includes('ogg') ? 'ogg' : payload.mimeType?.includes('wav') ? 'wav' : 'webm';
  const localPath = path.join(sessionDir, `${safeFilePart(payload.chunkId)}.${extension}`);
  const entry = {
    sessionId,
    chunkId: payload.chunkId,
    storagePath: payload.storagePath,
    sequence: Number(payload.sequence) || 0,
    durationMs: Number(payload.durationMs) || 0,
    mimeType: payload.mimeType || 'audio/webm',
    sizeBytes: Number(payload.sizeBytes) || 0,
    peak: Number(payload.peak) || 0,
    rms: Number(payload.rms) || 0,
    timestamp: payload.timestamp || Date.now(),
    localPath,
    status: 'received',
    transcript: '',
    aiScore: null,
    flags: [],
    reasoning: ''
  };

  sessionData.audioChunks.push(entry);
  sendToRenderer('realtime:status', { text: 'Audio chunk received' });
  sendToRenderer('realtime:audio-status', {
    state: 'received',
    message: `Fallback audio chunk ${entry.sequence + 1} received`,
    chunkId: entry.chunkId,
    timestamp: Date.now()
  });
  await broadcastAudioChunkStatus(entry);

  try {
    const download = await runWithRetry(async () => {
      const result = await client.storage.from('session-audio').download(payload.storagePath);
      if (result.error) throw new Error(result.error.message);
      return result;
    });

    const buffer = await blobToBuffer(download.data);
    fs.writeFileSync(localPath, buffer);

    const audioRisk = LocalRisk.analyzeAudio(entry);
    entry.aiScore = audioRisk.score;
    entry.flags = audioRisk.flags || [];
    entry.reasoning = audioRisk.reasoning;
    entry.status = 'transcribing';

    await updateAudioChunkRow(entry.chunkId, {
      status: 'transcribing',
      score: entry.aiScore,
      reasoning: entry.reasoning,
      flags: entry.flags
    });
    await broadcastAudioChunkStatus(entry);

    processAudioTranscription(entry).catch((err) => {
      console.error('[Local transcription]', err);
    });
  } catch (err) {
    entry.status = 'failed';
    entry.reasoning = `Audio download failed: ${err.message}`;
    entry.flags = ['Audio chunk download failed'];
    await updateAudioChunkRow(entry.chunkId, {
      status: 'failed',
      reasoning: entry.reasoning,
      flags: entry.flags
    });
    await broadcastAudioChunkStatus(entry);
    await deleteRemoteAudioChunk(entry, 'failed_deleted');
  }
}

async function processAudioTranscription(entry) {
  try {
    sendToRenderer('realtime:audio-status', {
      state: 'transcribing',
      message: `Transcribing fallback chunk ${entry.sequence + 1}`,
      chunkId: entry.chunkId,
      timestamp: Date.now()
    });

    const transcription = await transcribeAudioEntry(entry);
    const text = transcription.text;
    entry.status = text ? 'transcribed' : 'received';
    entry.transcript = text;
    entry.source = transcription.source;

    if (text) {
      const analysis = LocalRisk.analyzeTranscript(text, {
        durationMs: entry.durationMs,
        sequence: entry.sequence
      });
      entry.aiScore = analysis.score;
      entry.flags = analysis.flags || [];
      entry.reasoning = analysis.reasoning;

      const transcriptEntry = {
        text,
        timestamp: entry.timestamp,
        aiScore: entry.aiScore,
        displayLabel: analysis.displayLabel,
        confidence: analysis.confidence,
        scorable: analysis.scorable !== false,
        scoreWeight: analysis.scoreWeight || 0,
        flags: entry.flags,
        reasoning: entry.reasoning,
        aiSignals: analysis.aiSignals || [],
        humanSignals: analysis.humanSignals || [],
        source: transcription.source,
        chunkId: entry.chunkId
      };

      sessionData.transcripts.push(transcriptEntry);
      if (typeof entry.aiScore === 'number' && analysis.scorable !== false) {
        sessionData.scores.push({ score: entry.aiScore, weight: analysis.scoreWeight || 1 });
      }
      entry.flags.forEach(flagText => {
        sessionData.flags.push({
          text: flagText,
          timestamp: entry.timestamp,
          severity: entry.aiScore >= 70 ? 'high' : 'medium'
        });
      });
      sendToRenderer('realtime:transcript', transcriptEntry);
    } else {
      entry.reasoning = 'Local speech engine did not detect clear speech in this audio chunk.';
    }

    await updateAudioChunkRow(entry.chunkId, {
      status: entry.status,
      transcript: entry.transcript || null,
      score: entry.aiScore,
      reasoning: entry.reasoning,
      flags: entry.flags || [],
      source: entry.source || null,
      transcribed_at: new Date().toISOString()
    });
    await broadcastAudioChunkStatus(entry);
    await deleteRemoteAudioChunk(entry, text ? 'transcribed_deleted' : 'failed_deleted');
  } catch (err) {
    entry.status = 'failed';
    entry.reasoning = `Transcription unavailable: ${err.message}`;
    entry.flags = [...(entry.flags || []), 'Transcription unavailable'].slice(0, 4);
    await updateAudioChunkRow(entry.chunkId, {
      status: 'failed',
      score: entry.aiScore,
      reasoning: entry.reasoning,
      flags: entry.flags
    });
    await broadcastAudioChunkStatus(entry);
    sendToRenderer('realtime:audio-status', {
      state: 'error',
      message: entry.reasoning,
      chunkId: entry.chunkId,
      timestamp: Date.now()
    });
    await deleteRemoteAudioChunk(entry, 'failed_deleted');
  }
}

function handleCandidateEvent(payload = {}) {
  if (!sessionData || !payload.type) return;

  if (payload.type === 'candidate_connected') {
    broadcastSessionPolicy();
  }

  const describeBlockingWarning = () => {
    const host = String(payload.detectedHost || '').trim();
    const url = String(payload.detectedUrl || '').trim();
    const processName = String(payload.processName || '').trim();
    const title = String(payload.windowTitle || '').trim();
    const rule = payload.matchedRule ? ` (matched ${payload.matchedRule})` : '';
    if (host) return `Candidate opened ${host} in ${processName || 'a browser'}${rule}`;
    if (url) return `Candidate opened ${url} in ${processName || 'a browser'}${rule}`;
    if (processName && title) return `Candidate switched to ${processName} - ${title}${rule}`;
    if (processName) return `Candidate switched to ${processName}${rule}`;
    return 'Candidate opened a disallowed app or tab';
  };

  const labels = {
    candidate_connected: 'Candidate connected to Truveil Secure',
    focus_lost: 'Candidate switched away from Truveil Secure',
    focus_gained: 'Candidate returned to Truveil Secure',
    shortcut_blocked: 'Candidate attempted a blocked shortcut',
    blocking_warning: describeBlockingWarning(),
    audio_upload_failed: 'Candidate audio upload failed',
    overlay_detected: 'Potential hidden overlay or AI assistant detected',
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
    flags: entry.flags || [],
    source: entry.source || 'local',
    chunkId: entry.chunkId || null
  }));

  await client.from('sessions').update({
    status: 'completed',
    transcript,
    flags: sessionData.flags,
    ended_at: new Date(sessionData.endedAt || Date.now()).toISOString()
  }).eq('id', sessionData.session.sessionId);
}

async function cleanupRemoteAudioChunks() {
  if (!sessionData?.audioChunks?.length) return;
  const client = getSupabase();
  if (!client) return;

  const paths = Array.from(new Set(sessionData.audioChunks
    .filter(chunk => !chunk.remoteDeleted)
    .map(chunk => chunk.storagePath)
    .filter(Boolean)));
  if (paths.length) {
    const { error } = await client.storage.from('session-audio').remove(paths);
    if (error) console.warn('[Supabase] remote audio cleanup failed:', error.message);
  }

  const ids = sessionData.audioChunks
    .filter(chunk => !chunk.remoteDeleted && chunk.status !== 'transcribed_deleted' && chunk.status !== 'failed_deleted')
    .map(chunk => chunk.chunkId)
    .filter(Boolean);
  if (ids.length) {
    const { error } = await client
      .from('audio_chunks')
      .update({ status: 'deleted', cleaned_at: new Date().toISOString() })
      .in('id', ids);
    if (error) console.warn('[Supabase] audio metadata cleanup failed:', error.message);
  }
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
ipcMain.handle('session:create', async (_, { candidateName, role, policy }) => {
  LocalRisk.resetHistory();
  const session = SessionManager.create({ candidateName, role });
  session.policy = normalizePolicy(policy);
  const remoteReady = await ensureRemoteSession(session);
  if (remoteReady) {
    try {
      await joinRealtimeSession(session.sessionId);
    } catch (err) {
      console.warn('[Realtime]', err.message);
    }
  }

  activeSession = session;
  sessionData = {
    session,
    startedAt: null,
    endedAt: null,
    transcripts: [],
    flags: [],
    scores: [],
    audioChunks: []
  };
  return session;
});

ipcMain.handle('session:update', async (_, { candidateName, role, policy }) => {
  if (!activeSession || !sessionData) throw new Error('No active session');
  const normalizedPolicy = normalizePolicy(policy || activeSession.policy);

  activeSession = {
    ...activeSession,
    candidateName: candidateName || 'Candidate',
    role: role || 'Interview',
    policy: normalizedPolicy
  };
  sessionData.session = activeSession;

  await updateRemotePolicy(activeSession.sessionId, normalizedPolicy);
  await broadcastSessionPolicy();

  return activeSession;
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

  const analysis = LocalRisk.analyzeTranscript(text);

  const entry = {
    text,
    timestamp,
    aiScore: analysis.score,
    displayLabel: analysis.displayLabel,
    confidence: analysis.confidence,
    scorable: analysis.scorable !== false,
    scoreWeight: analysis.scoreWeight || 0,
    flags: analysis.flags || [],
    reasoning: analysis.reasoning,
    source: 'local'
  };
  sessionData.transcripts.push(entry);
  if (typeof analysis.score === 'number' && analysis.scorable !== false) {
    sessionData.scores.push({ score: analysis.score, weight: analysis.scoreWeight || 1 });
  }
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

ipcMain.handle('audio:get', (_, { chunkId }) => {
  if (!sessionData || !chunkId) return { ok: false, error: 'No active audio session.' };
  const chunk = sessionData.audioChunks.find(item => item.chunkId === chunkId);
  if (!chunk || !chunk.localPath || !fs.existsSync(chunk.localPath)) {
    return { ok: false, error: 'Audio chunk is not available locally yet.' };
  }
  const base64 = fs.readFileSync(chunk.localPath).toString('base64');
  return {
    ok: true,
    chunkId,
    mimeType: chunk.mimeType || 'audio/webm',
    dataUrl: `data:${chunk.mimeType || 'audio/webm'};base64,${base64}`
  };
});

// End session — generate + open report
ipcMain.handle('session:end', async () => {
  if (!sessionData) return { ended: false };
  sessionData.endedAt = Date.now();

  try {
    await closeRealtimeSession({ notifyCandidate: true });
    await persistCompletedSession();
    await cleanupRemoteAudioChunks();
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
