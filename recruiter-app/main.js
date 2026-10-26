const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, clipboard, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let runtimeConfig = {};
try {
  runtimeConfig = require('./src/config/runtime-config.json');
} catch {}

const SessionManager = require('./src/session/manager');
const LocalRisk = require('./src/ai/local-risk');
const { ResponseWindowAnalyzer } = require('./src/ai/response-window');
const { ChunkReview } = require('./src/ai/chunk-review');
const { confidenceValue } = require('./src/ai/transcript-quality');
const { DesktopProviderReview, CONSENT_VERSION } = require('./src/ai/desktop-provider-review');
const ReportGenerator = require('./src/report/generator');
const SettingsStore = require('./src/settings/store');
const { LocalTranscriber } = require('./src/audio/local-transcriber');
const { DeepgramTranscriber } = require('./src/audio/deepgram-transcriber');
const { GroqTranscriber } = require('./src/audio/groq-transcriber');
const { evaluateReview } = require('./src/review/evidence');
const { computeSessionVerdict } = require('./src/review/verdict');

let mainWindow;
let tray;
let activeSession = null;
let sessionData = null; // in-memory log for report
let supabase = null;
let realtimeChannel = null;
let localTranscriber = null;
let deepgramTranscriber = null;
let groqTranscriber = null;
let pendingAuthUrl = null;
let creatingSession = false;
let endingSession = false;
let startingSession = false;
const providerReview = new DesktopProviderReview({ getOwner: () => sessionData, appPath: __dirname,
  userDataPath: app.getPath('userData'), getEnvFile: () => SettingsStore.getAll().providerReviewEnvFile || '' });

function getTechnicalVocabulary() {
  return activeSession?.technicalVocabulary || sessionData?.session?.technicalVocabulary || [];
}

function getResponseAnalyzer() {
  if (!sessionData) return null;
  if (!sessionData.responseAnalyzer) {
    sessionData.responseAnalyzer = new ResponseWindowAnalyzer();
  }
  return sessionData.responseAnalyzer;
}

function recentAiEventContext(timestamp = Date.now()) {
  const pattern = /\b(chatgpt(?:\.com)?|claude(?:\.ai)?|gemini(?:\.google\.com)?|copilot(?:\.microsoft\.com)?|perplexity(?:\.ai)?|poe(?:\.com)?|you\.com|phind(?:\.com)?|interviewcoder|interview coder|cluely|finalround|lockedin|parakeet|leetcode wizard|ultracode|interview copilot)\b/i;
  const occurredAt = Number(timestamp) || Date.now();
  const events = (sessionData?.flags || [])
    .map(flag => ({
      ...flag,
      timestamp: typeof (flag.timestamp || flag.occurredAt || flag.createdAt) === 'number'
        ? (flag.timestamp || flag.occurredAt || flag.createdAt)
        : Date.parse(flag.timestamp || flag.occurredAt || flag.createdAt || '')
    }))
    .filter(flag => {
      if (!flag.timestamp || flag.timestamp > occurredAt) return false;
      if (occurredAt - flag.timestamp > 120000) return false;
      if (flag.policyDecision === 'allowed' || flag.reviewStatus === 'allowed') return false;
      if (flag.detectionSource !== 'url' && !flag.closedRestrictedTarget && flag.eventType !== 'overlay_detected') return false;
      return pattern.test([
        flag.text,
        flag.detectedHost,
        flag.detectedUrl,
        flag.matchedRule,
        flag.processName,
        flag.windowTitle
      ].filter(Boolean).join(' '));
    })
    .sort((a, b) => b.timestamp - a.timestamp);
  const latest = events[0];
  return {
    secondsSinceAiEvent: latest ? Math.max(0, (occurredAt - latest.timestamp) / 1000) : Infinity,
    behavioralAiEventCount: events.length
  };
}

function analyzeResponseWindow(segment = {}) {
  const analyzer = getResponseAnalyzer();
  if (!analyzer) return null;
  const technicalVocabulary = getTechnicalVocabulary();
  return analyzer.addSegment(
    segment,
    (text, context) => LocalRisk.analyzeTranscript(text, {
      ...context,
      technicalVocabulary,
      ...recentAiEventContext(context.startedAt || segment.startedAt || segment.timestamp)
    }),
    { technicalVocabulary }
  );
}

function refreshChunkReview(owner, final = false) {
  if (owner !== sessionData || !owner?.startedAt || (!final && owner.endedAt)) return;
  try {
    owner.chunkReviewer ||= new ChunkReview();
    owner.chunkReview = owner.chunkReviewer.build(owner.transcripts, {
      final, technicalVocabulary: getTechnicalVocabulary(),
      contextForRange: startedAt => recentAiEventContext(startedAt)
    });
    sendToRenderer('realtime:chunk-review', { ...owner.chunkReview, sessionId: owner.session.sessionId });
  } catch {
    owner.chunkReview = { final, chunks: [], windows: [], summary: { score: null,
      totalWords: 0, reviewedWords: 0, reviewedChunks: 0,
      summaryText: 'Chunk review is unavailable. The original transcript is retained for human review.' } };
    sendToRenderer('realtime:chunk-review', { ...owner.chunkReview, sessionId: owner.session.sessionId });
  }
}

function authStoragePath() {
  return path.join(app.getPath('userData'), 'auth-session.json');
}

function readAuthStorage() {
  try { return JSON.parse(fs.readFileSync(authStoragePath(), 'utf8')); } catch { return {}; }
}

function writeAuthStorage(data) {
  fs.mkdirSync(path.dirname(authStoragePath()), { recursive: true });
  fs.writeFileSync(authStoragePath(), JSON.stringify(data));
}

const authStorage = {
  getItem(key) {
    const value = readAuthStorage()[key];
    if (!value) return null;
    try {
      return safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(value, 'base64'))
        : Buffer.from(value, 'base64').toString('utf8');
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    const data = readAuthStorage();
    const buffer = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8');
    data[key] = buffer.toString('base64');
    writeAuthStorage(data);
  },
  removeItem(key) {
    const data = readAuthStorage();
    delete data[key];
    writeAuthStorage(data);
  }
};

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
    if (value == null) return fallback;
    const items = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,]/);
    const cleaned = items.map(item => String(item).trim()).filter(Boolean);
    return cleaned;
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
  if (workspaceMode === 'demo' || activeSession?.demo) return null;
  if (supabase) return supabase;
  const url = runtimeConfig.supabaseUrl || process.env.SUPABASE_URL || process.env.TRUVEIL_SUPABASE_URL;
  const key = runtimeConfig.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || process.env.TRUVEIL_SUPABASE_ANON_KEY;
  if (url?.includes('dummy.supabase.co') || key === 'dummy') return null;
  if (!url || !key) return null;
  supabase = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: authStorage },
    realtime: {
      transport: WebSocket,
      params: { eventsPerSecond: 10 }
    }
  });
  return supabase;
}

async function authState() {
  const client = getSupabase();
  if (!client) return { configured: false, signedIn: false };
  const { data } = await client.auth.getSession();
  return {
    configured: true,
    signedIn: Boolean(data.session?.user),
    user: data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null
  };
}

async function handleAuthUrl(url) {
  const client = getSupabase();
  if (!client || !url) return;
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const hash = new URLSearchParams(String(parsed.hash || '').replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    let error = null;
    if (code) {
      ({ error } = await client.auth.exchangeCodeForSession(code));
    } else if (accessToken && refreshToken) {
      ({ error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }));
    } else {
      return;
    }
    if (error) throw error;
    sendToRenderer('auth:changed', await authState());
  } catch (err) {
    sendToRenderer('auth:error', { message: err.message });
  }
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
      if (text) return { text, confidence: confidenceValue(result.confidence), lowConfidenceWordRatio: result.lowConfidenceWordRatio, source: 'deepgram-nova-3', result };
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
      if (text) return { text, confidence: null, source: 'groq-whisper', result };
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
    if (text) return { text, confidence: null, source: 'local-whisper', result };
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

function candidateSiteUrl() {
  const configured = runtimeConfig.candidateAppUrl || process.env.CANDIDATE_APP_URL || process.env.TRUVEIL_CANDIDATE_APP_URL;
  const url = new URL(configured || 'https://truveil-secure.vercel.app');
  if (url.hostname === 'truveil-client.vercel.app') url.hostname = 'truveil-secure.vercel.app';
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Candidate website must use a valid HTTPS URL.');
  return url.origin;
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
  const candidateBaseUrl = candidateSiteUrl();
  const client = getSupabase();
  if (!client) throw new Error('Supabase is not configured. A connected session cannot be created.');
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user || authData.user.is_anonymous) throw new Error('Sign in to a recruiter account before creating an interview.');

  const result = await client.functions.invoke('create-session', {
    body: {
      candidateAppUrl: candidateBaseUrl,
      candidateName: session.candidateName,
      role: session.role,
      technicalVocabulary: session.technicalVocabulary || [],
      policyPreset: session.policyPreset || 'standard_technical',
      policy: normalizePolicy(session.policy)
    }
  });
  if (result.error) throw new Error(result.data?.error || result.error.message || 'Session service unavailable.');
  const remote = result.data?.session;
  if (!remote?.internal_id || !/^TRV-[A-Z0-9]{6}$/.test(remote.join_code || remote.id || '')) {
    throw new Error('Session service returned an incomplete invitation. Please retry.');
  }
  session.sessionId = remote.join_code || remote.id;
  session.internalId = remote.internal_id;
  session.organizationId = remote.organization_id;
  session.recruiterId = remote.recruiter_id;
  session.candidateLink = `${candidateBaseUrl}/?code=${encodeURIComponent(session.sessionId)}&open=1`;
  return true;
}

async function updateSessionStatus(status, patch = {}, session = activeSession) {
  if (session?.demo) {
    if (status === 'active') return realtimeChannel.start();
    if (['cancelled', 'completed', 'interrupted'].includes(status)) return realtimeChannel?.end();
    return;
  }
  const client = getSupabase();
  if (!client || !session?.internalId) throw new Error('No connected interview session.');
  const { data, error } = await client.from('sessions')
    .update({ status, ...patch }).eq('internal_id', session.internalId).select('internal_id').single();
  if (error) throw new Error(error.message || 'Could not update the interview.');
  if (!data) throw new Error('The interview could not be updated. Check your connection and sign-in.');
}

async function updateRemotePolicy(sessionId, policy) {
  if (activeSession?.demo) return;
  const client = getSupabase();
  if (!client || activeSession?.localOnly) return;

  const { error } = await client.from('sessions').update({
    allowed_apps: policy.allowed_apps,
    allowed_sites: policy.allowed_sites,
    blocked_sites: policy.blocked_sites,
    blocking_mode: policy.blocking_mode
  }).eq('id', sessionId);

  if (error) throw new Error(error.message || 'Could not save the interview policy.');
}

async function updateRemoteSessionDetails(session) {
  if (session?.demo) return realtimeChannel?.update(demoDetails(session));
  const client = getSupabase();
  if (!client || !session || session.localOnly) return;
  const patch = {
    candidate_name: session.candidateName || null,
    role_title: session.role || null,
    technical_vocabulary: session.technicalVocabulary || [],
    policy_preset: session.policyPreset || 'standard_technical'
  };
  const query = client.from('sessions').update(patch);
  const { error } = session.internalId
    ? await query.eq('internal_id', session.internalId)
    : await query.eq('id', session.sessionId);
  if (error) throw new Error(error.message || 'Could not save the interview details.');
}

async function broadcastSessionPolicy() {
  if (activeSession?.demo) return;
  if (!activeSession || activeSession.localOnly || !realtimeChannel) return;
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

async function sendCandidateAction(action, target = {}) {
  if (!activeSession || !realtimeChannel) throw new Error('No connected candidate session.');
  const payload = {
    sessionId: activeSession.sessionId,
    action,
    target,
    timestamp: Date.now()
  };
  await realtimeChannel.send({ type: 'broadcast', event: 'recruiter_action', payload });
  return payload;
}

async function joinRealtimeSession(sessionId, { privateChannel = false } = {}) {
  const client = getSupabase();
  if (!client) return false;
  if (realtimeChannel) await client.removeChannel(realtimeChannel);

  const channel = client
    .channel(sessionChannelName(sessionId), {
      config: { private: privateChannel, broadcast: { self: false, ack: true }, presence: { key: 'recruiter' } }
    })
    .on('broadcast', { event: 'candidate_transcript' }, ({ payload }) => {
      if (realtimeChannel !== channel || sessionData?.endedAt) return;
      receiveCandidateCaption(payload);
    })
    .on('broadcast', { event: 'candidate_audio_chunk' }, ({ payload }) => {
      if (realtimeChannel !== channel || sessionData?.endedAt) return;
      handleCandidateAudioChunk(payload);
    })
    .on('broadcast', { event: 'candidate_audio_level' }, ({ payload }) => {
      if (realtimeChannel !== channel || sessionData?.endedAt) return;
      handleCandidateAudioLevel(payload);
    })
    .on('broadcast', { event: 'candidate_event' }, ({ payload }) => {
      if (realtimeChannel !== channel || sessionData?.endedAt) return;
      handleCandidateEvent(payload);
    });

  realtimeChannel = channel;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out joining realtime session.')), 12000);
    channel.subscribe((status) => {
      if (realtimeChannel !== channel) return;
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        if (sessionData) sessionData.telemetry.connected = true;
        resolve();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timeout);
        providerReview.cancel();
        if (sessionData) {
          sessionData.externalReviewConsent = null;
          sessionData.candidateReady = false;
          sessionData.telemetry.connected = false;
          sessionData.telemetry.monitoring = 'unavailable';
        }
        sendToRenderer('realtime:status', { text: 'Connection interrupted', candidateReady: false });
        reject(new Error(`Could not join realtime session (${status}).`));
      }
    });
  });

  await realtimeChannel.track({ role: 'recruiter', joinedAt: Date.now() });
  return true;
}

function validatedCandidateCaption(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (['senderRole', 'role'].some(key => payload[key] != null && payload[key] !== 'candidate')) return null;
  const modern = payload.captionStreamId != null;
  if (payload.sessionId != null && payload.sessionId !== activeSession.sessionId && payload.sessionId !== activeSession.internalId) return null;
  if (modern && !payload.sessionId) return null;
  if (typeof payload.text !== 'string' || payload.text.length > 16000) return null;
  for (const key of ['interim', 'isFinal', 'captionClear']) {
    if (payload[key] != null && typeof payload[key] !== 'boolean') return null;
  }
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,200}$/.test(value);
  if (modern && !id(payload.captionStreamId)) return null;
  if (payload.segmentId != null && !id(payload.segmentId)) return null;
  for (const key of ['revision', 'streamEpoch', 'sequence', 'utteranceId']) {
    if (payload[key] != null && (!Number.isSafeInteger(payload[key]) || payload[key] < 0 || payload[key] > 2147483647)) return null;
  }
  if (modern && (!(payload.revision > 0) || payload.streamEpoch == null)) return null;
  for (const key of ['timestamp', 'startedAt', 'endedAt', 'durationMs']) {
    if (payload[key] != null && (typeof payload[key] !== 'number' || !Number.isFinite(payload[key]) || payload[key] < 0 || payload[key] > 8640000000000000)) return null;
  }
  if (payload.durationMs > 600000 || (payload.startedAt != null && payload.endedAt != null && payload.endedAt < payload.startedAt)) return null;
  for (const [key, maximum] of [['source', 100], ['finalReason', 80], ['qualityReason', 500]]) {
    if (payload[key] != null && (typeof payload[key] !== 'string' || payload[key].length > maximum)) return null;
  }
  const interim = payload.interim === true || payload.isFinal === false;
  const text = payload.text.trim();
  if (!text && !(interim && payload.captionClear === true)) return null;
  if (payload.captionClear && (!interim || text)) return null;
  if (modern && !interim && !payload.segmentId) return null;
  return {
    sessionId: activeSession.sessionId, text, interim, isFinal: !interim,
    captionClear: Boolean(payload.captionClear), captionStreamId: payload.captionStreamId || null,
    revision: payload.revision, streamEpoch: payload.streamEpoch ?? null,
    segmentId: payload.segmentId || null, sequence: payload.sequence ?? null, utteranceId: payload.utteranceId ?? null,
    timestamp: payload.timestamp ?? Date.now(), startedAt: payload.startedAt ?? null, endedAt: payload.endedAt ?? null,
    durationMs: payload.durationMs ?? null, transcriptConfidence: confidenceValue(payload.transcriptConfidence),
    lowConfidenceWordRatio: confidenceValue(payload.lowConfidenceWordRatio), qualityReason: payload.qualityReason || null,
    source: payload.source || 'candidate-transcript', finalReason: payload.finalReason || 'speech_final',
    captionReceivedAt: Date.now()
  };
}

function captionOrder(a, b) {
  if (a.captionStreamId === b.captionStreamId) {
    return (a.streamEpoch || 0) - (b.streamEpoch || 0)
      || (a.sequence != null && b.sequence != null ? a.sequence - b.sequence : 0)
      || (a.startedAt ?? a.timestamp) - (b.startedAt ?? b.timestamp)
      || a.captionOrder - b.captionOrder;
  }
  return a.captionStreamOrder - b.captionStreamOrder || a.captionOrder - b.captionOrder;
}

function receiveCandidateCaption(payload) {
  const owner = sessionData;
  if (!owner?.startedAt || owner.endedAt || !activeSession) return;
  const caption = validatedCandidateCaption(payload);
  if (!caption) return;
  const state = owner.captionState ||= {
    streamId: null, streamOrder: 0, epoch: 0, revision: 0, retiredStreams: new Set(),
    legacyRevision: 0, legacyTime: -1, order: 0
  };
  const modern = Boolean(caption.captionStreamId);
  const identity = caption.segmentId || (caption.sequence != null ? `sequence-${caption.sequence}`
    : crypto.createHash('sha256').update(`${caption.timestamp}:${caption.text}`).digest('hex'));
  caption.captionKey = JSON.stringify([caption.captionStreamId, caption.streamEpoch, identity]);
  // Finals can arrive behind a newer interim. Deduplication must not use the
  // interim revision watermark or discard previously unseen finalized speech.
  if (!caption.interim && owner.transcripts.some(entry => entry.captionKey === caption.captionKey)) return;
  if (modern) {
    if (state.retiredStreams.has(caption.captionStreamId)) return;
    if (state.streamId !== caption.captionStreamId) {
      if (state.streamId) state.retiredStreams.add(state.streamId);
      while (state.retiredStreams.size > 32) state.retiredStreams.delete(state.retiredStreams.values().next().value);
      state.streamId = caption.captionStreamId;
      state.streamOrder++;
      state.epoch = caption.streamEpoch;
      state.revision = 0;
    }
    if (caption.interim && (caption.streamEpoch < state.epoch || caption.revision <= state.revision)) return;
    caption.captionCanClear = caption.streamEpoch >= state.epoch && caption.revision >= state.revision;
    state.epoch = Math.max(state.epoch, caption.streamEpoch);
    state.revision = Math.max(state.revision, caption.revision);
    caption.captionStreamOrder = state.streamOrder;
  } else {
    if (caption.interim && (state.streamId || caption.timestamp <= state.legacyTime)) return;
    caption.captionCanClear = !state.streamId && caption.timestamp >= state.legacyTime;
    state.legacyTime = Math.max(state.legacyTime, caption.timestamp);
    caption.revision = ++state.legacyRevision;
    caption.captionStreamOrder = 0;
  }
  caption.captionOrder = ++state.order;
  if (caption.interim) {
    sendToRenderer('realtime:caption', caption);
    return;
  }
  const entry = {
    ...caption, analysisPending: true, aiScore: null, scorable: false, scoreWeight: 0,
    label: 'unscorable', displayLabel: 'Pattern review pending', flags: [],
    reasoning: 'Waiting for finalized speech analysis.', aiSignals: [], humanSignals: [], evidence: []
  };
  owner.transcripts.push(entry);
  owner.transcripts.sort(captionOrder);
  owner.telemetry.transcription = 'healthy';
  sendToRenderer('realtime:caption', { ...entry });
  persistCandidateCaption(entry, owner);
  owner.captionAnalysisQueue ||= [];
  if (owner.captionAnalysisQueue.length >= 256) {
    owner.responseAnalyzer?.reset();
    finishCaptionAnalysis(entry, { reasoning: 'Pattern review unavailable: speech analysis queue is full.' }, owner);
    return;
  }
  owner.captionAnalysisQueue.push(entry);
  scheduleCaptionAnalysis(owner);
}

function finishCaptionAnalysis(entry, analysis = {}, owner) {
  if (sessionData !== owner || owner.endedAt) return;
  Object.assign(entry, {
    analysisPending: false,
    aiScore: analysis.score,
    label: analysis.label,
    displayLabel: analysis.displayLabel,
    confidence: analysis.confidence,
    scorable: analysis.scorable === true && typeof analysis.score === 'number',
    scoreWeight: analysis.scoreWeight || 0,
    flags: analysis.flags || [],
    reasoning: analysis.reasoning || 'Pattern review unavailable. The transcript is retained.',
    aiSignals: analysis.aiSignals || [],
    humanSignals: analysis.humanSignals || [],
    evidence: analysis.evidence || [],
    counterSignal: analysis.counterSignal || null,
    modelVersion: analysis.modelVersion,
    unscorableReason: analysis.unscorableReason || null,
    analysisWindowId: analysis.analysisWindowId || null,
    responseWindowWordCount: analysis.responseWindowWordCount || 0,
    responseWindowText: analysis.responseWindowText || ''
  });
  if (typeof entry.aiScore === 'number' && entry.scorable) {
    owner.scores.push({ score: entry.aiScore, weight: entry.scoreWeight || 1 });
  }
  sendToRenderer('realtime:transcript', { ...entry });
  refreshChunkReview(owner);
}

function scheduleCaptionAnalysis(owner) {
  if (owner.captionAnalysisTimer) return;
  owner.captionAnalysisTimer = setTimeout(() => {
    owner.captionAnalysisTimer = null;
    if (sessionData !== owner || owner.endedAt || !owner.startedAt) {
      owner.captionAnalysisQueue = [];
      return;
    }
    owner.captionAnalysisQueue.sort(captionOrder);
    const entry = owner.captionAnalysisQueue.shift();
    if (!entry) return;
    try {
      const previous = owner.lastAnalyzedCaption;
      if (previous && captionOrder(entry, previous) < 0) {
        finishCaptionAnalysis(entry, { reasoning: 'Pattern review abstained: this speech segment arrived out of order.' }, owner);
      } else {
        owner.lastAnalyzedCaption = entry;
        finishCaptionAnalysis(entry, analyzeResponseWindow({ ...entry, confidence: entry.transcriptConfidence }) || {}, owner);
      }
    } catch (error) {
      owner.responseAnalyzer?.reset();
      console.warn('[Caption analysis] Pattern review unavailable:', error.message);
      finishCaptionAnalysis(entry, {}, owner);
    }
    if (owner.captionAnalysisQueue.length) scheduleCaptionAnalysis(owner);
  }, 0);
}

function stopCaptionAnalysis(owner) {
  clearTimeout(owner.captionAnalysisTimer);
  owner.captionAnalysisTimer = null;
  for (const entry of owner.captionAnalysisQueue || []) {
    Object.assign(entry, {
      analysisPending: false, aiScore: null, scorable: false, scoreWeight: 0,
      reasoning: 'Interview ended before pattern review completed. The transcript is retained.',
      unscorableReason: 'Interview ended before pattern review completed.'
    });
  }
  owner.captionAnalysisQueue = [];
}

function persistCandidateCaption(entry, owner) {
  const client = getSupabase();
  if (client && owner.session.internalId) {
    Promise.resolve().then(() => client.from('transcript_segments').upsert({
      session_id: owner.session.internalId,
      segment_id: entry.captionStreamId ? crypto.createHash('sha256').update(entry.captionKey).digest('hex') : entry.segmentId || `legacy-${entry.captionOrder}`,
      sequence: entry.sequence || 0,
      revision: entry.revision || 0,
      text: entry.text,
      confidence: entry.transcriptConfidence,
      source: entry.source,
      started_at: entry.startedAt != null ? new Date(entry.startedAt).toISOString() : null,
      ended_at: entry.endedAt != null ? new Date(entry.endedAt).toISOString() : null,
      emitted_at: new Date(entry.timestamp).toISOString()
    }, { onConflict: 'session_id,segment_id,revision' }).then(({ error }) => {
      if (error) console.warn('[Supabase] transcript persistence failed:', error.message);
    })).catch(error => console.warn('[Supabase] transcript persistence failed:', error.message));
  }
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
  const owner = sessionData;
  if (!owner || owner.endedAt) return;
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

  const sessionId = owner.session.sessionId;
  if (!String(payload.storagePath).startsWith(`${sessionId}/`) || String(payload.storagePath).includes('..')) return;
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
    startedAt: payload.startedAt,
    endedAt: payload.endedAt,
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
    if (sessionData !== owner || owner.endedAt) return;
    if (buffer.length > 12 * 1024 * 1024) throw new Error('Audio chunk exceeds the 12 MB limit.');
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

    processAudioTranscription(entry, owner).catch((err) => {
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

async function processAudioTranscription(entry, owner = sessionData) {
  try {
    sendToRenderer('realtime:audio-status', {
      state: 'transcribing',
      message: `Transcribing fallback chunk ${entry.sequence + 1}`,
      chunkId: entry.chunkId,
      timestamp: Date.now()
    });

    const transcription = await transcribeAudioEntry(entry);
    if (!owner || sessionData !== owner || owner.endedAt) return;
    const text = transcription.text;
    entry.status = text ? 'transcribed' : 'received';
    entry.transcript = text;
    entry.source = transcription.source;

    if (text) {
      if (sessionData?.telemetry) sessionData.telemetry.transcription = 'healthy';
      const segmentId = `fallback-${Number(entry.sequence || 0)}-${entry.chunkId || entry.timestamp}`;
      const analysis = analyzeResponseWindow({
        text,
        timestamp: entry.timestamp,
        durationMs: entry.durationMs,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        sequence: entry.sequence,
        transcriptConfidence: transcription.confidence,
        lowConfidenceWordRatio: transcription.lowConfidenceWordRatio,
        confidence: transcription.confidence,
        segmentId,
        finalReason: 'fallback_chunk',
        source: transcription.source
      });
      if (!analysis) return;
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
        evidence: analysis.evidence || [],
        counterSignal: analysis.counterSignal || null,
        modelVersion: analysis.modelVersion,
        unscorableReason: analysis.unscorableReason || null,
        source: transcription.source,
        transcriptConfidence: transcription.confidence,
        lowConfidenceWordRatio: transcription.lowConfidenceWordRatio ?? null,
        chunkId: entry.chunkId,
        segmentId,
        finalReason: 'fallback_chunk',
        analysisWindowId: analysis.analysisWindowId || null,
        responseWindowWordCount: analysis.responseWindowWordCount || 0,
        responseWindowText: analysis.responseWindowText || ''
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
      refreshChunkReview(sessionData);
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
    if (sessionData !== owner || owner?.endedAt) return;
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
  } finally {
    if (entry.localPath) {
      try { fs.rmSync(entry.localPath, { force: true }); } catch (err) {
        console.warn('[Audio cleanup] local fallback audio cleanup failed:', err.message);
      }
      entry.localPath = '';
    }
  }
}

function handleCandidateEvent(payload = {}) {
  if (!sessionData || sessionData.endedAt || !payload.type) return;
  if (activeSession?.demo && payload.sessionId !== activeSession.sessionId) return;
  if (payload.type === 'browser_tabs') {
    if (!activeSession?.demo || !sessionData.startedAt) return;
    const state = payload.state || {};
    browserTabs = {
      connected: state.connected === true, closeConsent: state.closeConsent === true,
      tabs: Array.isArray(state.tabs) ? state.tabs.filter(tab => typeof tab.id === 'string' && tab.id.length <= 256
        && Number.isSafeInteger(tab.revision) && tab.revision >= 0).slice(0, 128).map(tab => ({
          id: tab.id, revision: tab.revision, hostname: String(tab.hostname || '').slice(0, 253),
          active: tab.active === true, protected: tab.protected === true
        })) : []
    };
    if (!browserTabs.connected || !browserTabs.closeConsent) cancelTabRequests();
    if (!browserTabs.connected) lastBrowserEventSequence = 0;
    sendToRenderer('browser:tabs', browserTabs);
    for (const event of (browserTabs.connected && Array.isArray(state.events) ? state.events : []).slice(-64)) {
      if (!Number.isSafeInteger(event.sequence) || event.sequence <= lastBrowserEventSequence) continue;
      lastBrowserEventSequence = event.sequence;
      if (!['created', 'navigated', 'activated', 'removed', 'attached', 'detached'].includes(event.kind)) continue;
      const flag = { eventType: `browser_tab_${event.kind}`, text: `Shared tab ${event.kind}: ${String(event.hostname || 'New tab').slice(0, 253)}`,
        timestamp: Date.now(), severity: 'low', detectionSource: 'browser-extension' };
      const host = String(event.hostname || '').toLowerCase();
      const restricted = activeSession.policy?.blocking_mode !== 'none' && (activeSession.policy?.blocked_sites || []).some(rule => {
        const domain = String(rule).toLowerCase().replace(/^www\./, '');
        return host && domain && (host === domain || host.endsWith('.' + domain));
      });
      flag.policyDecision = restricted ? 'restricted' : 'allowed';
      if (restricted) flag.detectedHost = host;
      sessionData.flags.push(flag);
      sendToRenderer('realtime:flag', flag);
    }
    return;
  }
  if (payload.type === 'browser_tab_close_result') {
    const request = tabRequests.get(payload.commandId);
    if (!request) return;
    tabRequests.delete(payload.commandId);
    clearTimeout(request.timer);
    const status = ['closed', 'stale', 'denied', 'unavailable', 'failed'].includes(payload.result?.status) ? payload.result.status : 'failed';
    request.resolve({ status });
    return;
  }

  if (['candidate_ready', 'candidate_review_consent', 'provider_review_consent_withdrawn'].includes(payload.type)) {
    const matchesSession = typeof payload.sessionId === 'string' && activeSession &&
      (payload.sessionId === activeSession.sessionId || payload.sessionId === activeSession.internalId);
    const consent = payload.type === 'provider_review_consent_withdrawn'
      ? { version: CONSENT_VERSION, enabled: false } : payload.externalReviewConsent;
    if (matchesSession && consent?.version === CONSENT_VERSION && typeof consent.enabled === 'boolean') {
      sessionData.externalReviewConsent = { version: CONSENT_VERSION, enabled: consent.enabled, receivedAt: Date.now() };
      if (!consent.enabled) providerReview.cancel();
      sendToRenderer('provider-review:consent', { enabled: consent.enabled });
    } else if (payload.type === 'candidate_ready') {
      sessionData.externalReviewConsent = null;
      providerReview.cancel();
      sendToRenderer('provider-review:consent', { enabled: false });
    }
    if (payload.type !== 'candidate_ready') return;
  }

  if (payload.type === 'candidate_ready') {
    sessionData.candidateReady = true;
    sessionData.telemetry.connected = true;
  }
  if (['candidate_interrupted', 'candidate_completed', 'session_ended_remote'].includes(payload.type)) {
    providerReview.cancel();
    sessionData.externalReviewConsent = null;
    sessionData.candidateReady = false;
    sessionData.telemetry.connected = false;
    sessionData.telemetry.monitoring = 'unavailable';
    sendToRenderer('realtime:status', { text: 'Candidate disconnected', candidateReady: false });
  }

  if (payload.type === 'candidate_connected' || payload.type === 'candidate_ready') {
    broadcastSessionPolicy();
  }

  const describeBlockingWarning = () => {
    const host = String(payload.detectedHost || '').trim();
    const url = String(payload.detectedUrl || '').trim();
    const processName = String(payload.processName || '').trim();
    const title = String(payload.windowTitle || '').trim();
    const rule = payload.matchedRule ? ` (matched ${payload.matchedRule})` : '';
    if (host) return `Candidate switched to ${host} in ${processName || 'a browser'}${rule}`;
    if (url) return `Candidate switched to ${url} in ${processName || 'a browser'}${rule}`;
    if (processName && title) return `Candidate switched to ${processName} - ${title}${rule}`;
    if (processName) return `Candidate switched to ${processName}${rule}`;
    return 'Candidate opened a disallowed app or tab';
  };

  const labels = {
    candidate_ready: 'Candidate completed consent and microphone preflight',
    candidate_connected: 'Candidate connected to Truveil Secure',
    focus_lost: 'Candidate switched away from Truveil Secure',
    focus_gained: 'Candidate returned to Truveil Secure',
    shortcut_blocked: 'Candidate attempted a blocked shortcut',
    blocking_warning: describeBlockingWarning(),
    foreground_changed: describeBlockingWarning(),
    audio_upload_failed: 'Candidate audio upload failed',
    overlay_detected: 'Potential hidden overlay or AI assistant detected',
    recruiter_allowed_target: 'Interviewer allowed the reviewed destination',
    recruiter_reopened_target: 'Interviewer reopened the reviewed destination',
    recruiter_closed_target: payload.closedRestrictedTarget ? 'Legacy close action reported; exact tab removal was not verified' : 'Tab close failed',
    recruiter_close_target_missed: 'Close request skipped because the candidate had already switched away',
    candidate_interrupted: 'Candidate ended or closed the secure session',
    candidate_completed: 'Candidate completed the secure session',
    session_ended_remote: 'Candidate received recruiter end-session signal'
  };

  const text = labels[payload.type] || payload.type;
  const severity = payload.severity || (payload.type === 'focus_lost' ? 'medium' : 'low');
  const flag = {
    text,
    severity,
    timestamp: payload.timestamp || Date.now(),
    eventType: payload.type,
    processName: payload.processName || '',
    windowTitle: payload.windowTitle || '',
    detectedUrl: payload.detectedUrl || '',
    detectedHost: payload.detectedHost || '',
    matchedRule: payload.matchedRule || '',
    detectionSource: payload.detectionSource || '',
    policyDecision: payload.policyDecision || '',
    closedRestrictedTarget: Boolean(payload.closedRestrictedTarget)
  };
  sessionData.flags.push(flag);

  const client = getSupabase();
  if (client && activeSession?.internalId) {
    client.from('session_events').insert({
      session_id: activeSession.internalId,
      event_type: flag.eventType,
      severity: flag.severity,
      occurred_at: new Date(flag.timestamp).toISOString(),
      process_name: flag.processName || null,
      window_title: flag.windowTitle || null,
      detected_url: flag.detectedUrl || null,
      detected_host: flag.detectedHost || null,
      detection_source: flag.detectionSource || null,
      matched_rule: flag.matchedRule || null,
      metadata: {
        policyDecision: flag.policyDecision,
        closedRestrictedTarget: flag.closedRestrictedTarget
      }
    }).then(({ error }) => {
      if (error) console.warn('[Supabase] event persistence failed:', error.message);
    });
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('realtime:flag', flag);
    if (payload.type === 'candidate_ready') {
      mainWindow.webContents.send('realtime:status', { text: 'Candidate ready', candidateReady: true });
    } else if (payload.type === 'candidate_connected') {
      mainWindow.webContents.send('realtime:status', { text: 'Candidate connected', candidateConnected: true });
    }
  }
}

async function closeRealtimeSession({ notifyCandidate = false } = {}) {
  clearBrowserTabs();
  if (activeSession?.demo) {
    const channel = realtimeChannel;
    realtimeChannel = null;
    if (channel) {
      try { await channel.end(); } catch {}
      channel.close();
    }
    return;
  }
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

  await updateSessionStatus('completed', {
    transcript,
    flags: sessionData.flags,
    ended_at: new Date(sessionData.endedAt || Date.now()).toISOString()
  });
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
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    icon: path.join(__dirname, 'assets/truveil.ico'),
    titleBarStyle: process.platform === 'darwin' ? 'default' : 'hiddenInset',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  // Keep the window pinned to the bundled app: no renderer-spawned windows,
  // no navigation off the local file:// renderer. External links go through the
  // allow-listed shell:open-external IPC handler instead.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guardNavigation = (event, url) => {
    if (!String(url || '').startsWith('file://')) event.preventDefault();
  };
  mainWindow.webContents.on('will-navigate', guardNavigation);
  mainWindow.webContents.on('will-redirect', guardNavigation);
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/brand/mark.png')).resize({ width: 18, height: 18 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Truveil Command Center');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Truveil', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => mainWindow.show());
}

function cleanupLocalFallbackAudio() {
  const sessionsRoot = path.join(app.getPath('userData'), 'sessions');
  if (!fs.existsSync(sessionsRoot)) return;
  try {
    for (const session of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      const audioDir = path.join(sessionsRoot, session.name, 'audio');
      if (fs.existsSync(audioDir)) fs.rmSync(audioDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('[Audio cleanup] startup cleanup failed:', err.message);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.whenReady().then(() => {
  app.setAsDefaultProtocolClient('truveil-recruiter');
  cleanupLocalFallbackAudio();
  createWindow();
  createTray();
  if (pendingAuthUrl) handleAuthUrl(pendingAuthUrl);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
});
app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => { app.isQuitting = true; });
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) handleAuthUrl(url);
  else pendingAuthUrl = url;
});
app.on('second-instance', (_event, argv) => {
  const url = argv.find(value => String(value).startsWith('truveil-recruiter://'));
  if (url) handleAuthUrl(url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// ─── IPC ───────────────────────────────────────────────────────────────

// Settings
function rendererPreferences() {
  const saved = SettingsStore.getAll();
  return { transcriptSize: saved.transcriptSize === 'large' ? 'large' : 'standard', reduceMotion: saved.reduceMotion === true };
}
ipcMain.handle('settings:get', () => rendererPreferences());
ipcMain.handle('provider-review:status', () => providerReview.status());
ipcMain.handle('provider-review:connect-file', async () => {
  const selected = await dialog.showOpenDialog(mainWindow, { title: 'Connect saved provider environment file', properties: ['openFile'] });
  if (selected.canceled || selected.filePaths.length !== 1) return providerReview.status();
  const file = selected.filePaths[0];
  if (fs.statSync(file).size > 64000) throw new Error('PROVIDER_KEY_FILE_TOO_LARGE');
  const parsed = require('dotenv').parse(fs.readFileSync(file));
  if (!parsed.PANGRAM_API_KEY || !parsed.OPENROUTER_API_KEY) throw new Error('BOTH_PROVIDER_KEYS_REQUIRED');
  SettingsStore.save({ providerReviewEnvFile: file });
  return providerReview.status();
});
ipcMain.handle('provider-review:check', () => providerReview.checkConnections());
ipcMain.handle('provider-review:begin', () => providerReview.begin());
ipcMain.handle('provider-review:finish', () => providerReview.finish());
ipcMain.handle('provider-review:discard', () => providerReview.cancel());
ipcMain.handle('provider-review:run', (_, confirmations) => providerReview.review(confirmations));
ipcMain.handle('settings:save', (_, patch = {}) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('INVALID_PREFERENCES');
  const preferences = rendererPreferences();
  if (Object.hasOwn(patch, 'transcriptSize')) preferences.transcriptSize = patch.transcriptSize === 'large' ? 'large' : 'standard';
  if (Object.hasOwn(patch, 'reduceMotion')) preferences.reduceMotion = patch.reduceMotion === true;
  SettingsStore.save(preferences);
  return preferences;
});
ipcMain.handle('auth:get', () => authState());
ipcMain.handle('auth:send-link', async (_, email) => {
  const client = getSupabase();
  if (!client) throw new Error('Supabase is not configured.');
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new Error('Enter a valid work email.');
  const { error } = await client.auth.signInWithOtp({
    email: cleanEmail,
    options: {
      emailRedirectTo: 'truveil-recruiter://auth/callback',
      shouldCreateUser: false
    }
  });
  if (error) throw error;
  return { ok: true };
});
ipcMain.handle('auth:verify-code', async (_, { email, token } = {}) => {
  const client = getSupabase();
  if (!client) throw new Error('Supabase is not configured.');
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanToken = String(token || '').replace(/\D/g, '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new Error('Enter the email you used for the sign-in code.');
  if (!/^\d{6}$/.test(cleanToken)) throw new Error('Enter the 6 digit sign-in code from your email.');
  const { error } = await client.auth.verifyOtp({
    email: cleanEmail,
    token: cleanToken,
    type: 'email'
  });
  if (error) throw error;
  return authState();
});
ipcMain.handle('auth:sign-out', async () => {
  if (activeSession || creatingSession) throw new Error('Finish or cancel the current interview before signing out.');
  const client = getSupabase();
  if (client) await client.auth.signOut();
  return authState();
});

ipcMain.handle('auth:sign-in-password', async (_, { email, password } = {}) => {
  if (activeSession || creatingSession) throw new Error('Finish or cancel the current interview before changing accounts.');
  const client = getSupabase();
  if (!client) throw new Error('Supabase is not configured.');
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new Error('Enter a valid work email.');
  if (typeof password !== 'string' || !password || password.length > 1024) throw new Error('Enter your account password.');
  const { error } = await client.auth.signInWithPassword({ email: cleanEmail, password });
  if (error) throw new Error('Sign-in failed. Check your account email and password.');
  return authState();
});

ipcMain.handle('shell:open-external', async (_, url) => {
  const cleanUrl = String(url || '').trim();
  const parsed = new URL(cleanUrl);
  const allowedSite = parsed.protocol === 'https:' && [candidateSiteUrl(), 'https://truveil-recruiter.vercel.app'].includes(parsed.origin);
  if (parsed.username || parsed.password || (parsed.protocol !== 'mailto:' && !allowedSite)) {
    throw new Error('Unsupported external link.');
  }
  await shell.openExternal(cleanUrl);
  return { ok: true };
});

// Session lifecycle
let workspaceMode = 'cloud';
let browserTabs = { connected: false, closeConsent: false, tabs: [] };
let lastBrowserEventSequence = 0;
const tabRequests = new Map();

function cancelTabRequests() {
  for (const request of tabRequests.values()) { clearTimeout(request.timer); request.resolve({ status: 'unavailable' }); }
  tabRequests.clear();
}
function clearBrowserTabs() {
  lastBrowserEventSequence = 0;
  cancelTabRequests();
  browserTabs = { connected: false, closeConsent: false, tabs: [] };
  sendToRenderer('browser:tabs', browserTabs);
}
function demoDetails(session) {
  return { candidateName: session.candidateName, role: session.role,
    policy: session.policy, technicalVocabulary: session.technicalVocabulary || [] };
}
ipcMain.handle('demo:config', () => {
  workspaceMode = process.env.TRUVEIL_APP_MODE === 'cloud' ? 'cloud' : 'demo';
  return { enabled: workspaceMode === 'demo', relayUrl: process.env.TRUVEIL_DEMO_RELAY_URL || runtimeConfig.demoRelayUrl || SettingsStore.getAll().demoRelayUrl || '' };
});
ipcMain.handle('demo:create', async (_, data = {}) => {
  if (activeSession || creatingSession || endingSession) throw new Error('Finish the current interview first.');
  const { DemoRelayClient, normalizeRelayUrl } = require('./src/demo/relay-client');
  const url = normalizeRelayUrl(data.relayUrl || process.env.TRUVEIL_DEMO_RELAY_URL || runtimeConfig.demoRelayUrl || SettingsStore.getAll().demoRelayUrl || '');
  creatingSession = true;
  workspaceMode = 'demo';
  const channel = new DemoRelayClient({ url });
  const session = SessionManager.create({ candidateName: data.candidateName, role: data.role });
  session.demo = true;
  session.policy = normalizePolicy(data.policy || { allowed_apps: [], allowed_sites: [], blocked_sites: [], blocking_mode: 'none' });
  session.technicalVocabulary = data.technicalVocabulary || [];
  let disconnected = false;
  channel.on('closed', () => {
    disconnected = true;
    if (realtimeChannel !== channel) return;
    clearBrowserTabs();
    providerReview.cancel();
    if (sessionData) {
      sessionData.externalReviewConsent = null;
      sessionData.candidateReady = false;
      sessionData.telemetry.connected = false;
      sessionData.telemetry.monitoring = 'unavailable';
    }
    sendToRenderer('realtime:status', { text: 'Session connection ended. Save the local report, then create a new interview.', candidateReady: false });
  });
  channel.on('join-request', request => { if (realtimeChannel === channel) sendToRenderer('demo:join-request', request); });
  channel.on('event', ({ event, payload }) => {
    if (realtimeChannel !== channel || sessionData?.endedAt) return;
    if (event === 'candidate_transcript') receiveCandidateCaption(payload);
    if (event === 'candidate_audio_level') handleCandidateAudioLevel(payload);
    if (event === 'candidate_event') handleCandidateEvent(payload);
  });
  try {
    const room = await channel.create(demoDetails(session), typeof data.hostAccessCode === 'string' ? data.hostAccessCode : '');
    if (disconnected) throw new Error('Session server disconnected while creating the interview.');
    session.sessionId = room.code;
    session.expiresAt = room.expiresAt;
    session.relayUrl = url;
    session.candidateLink = require('./src/session/presentation').invitation(room.code, url);
    LocalRisk.resetHistory();
    activeSession = session;
    realtimeChannel = channel;
    sessionData = { session, startedAt: null, endedAt: null, transcripts: [], flags: [], scores: [], audioChunks: [], notes: [],
      responseAnalyzer: new ResponseWindowAnalyzer(), candidateReady: false,
      telemetry: { connected: true, transcription: 'waiting', monitoring: 'waiting' } };
    SettingsStore.save({ demoRelayUrl: url });
    return session;
  } catch (error) {
    channel.close();
    throw error;
  } finally { creatingSession = false; }
});
ipcMain.handle('demo:approve', async (_, { requestId, allow } = {}) => {
  if (!activeSession?.demo || !realtimeChannel || !sessionData?.telemetry.connected) throw new Error('No connected demo room.');
  if (typeof requestId !== 'string' || typeof allow !== 'boolean') throw new Error('Invalid approval.');
  return realtimeChannel.approve(requestId, allow);
});
ipcMain.handle('browser:close-tab', async (_, target = {}) => {
  if (!activeSession?.demo || !sessionData?.startedAt || sessionData.endedAt || !sessionData.telemetry.connected
    || !browserTabs.connected || !browserTabs.closeConsent || !realtimeChannel) throw new Error('No active shared browser is available.');
  const observed = browserTabs.tabs.find(tab => tab.id === target.id && tab.revision === target.revision);
  if (!observed || observed.protected) throw new Error('This shared tab is protected or no longer current.');
  if (tabRequests.size >= 8) throw new Error('Wait for the pending tab requests.');
  const commandId = crypto.randomUUID();
  const channel = realtimeChannel;
  return new Promise(resolve => {
    const timer = setTimeout(() => { tabRequests.delete(commandId); resolve({ status: 'unavailable' }); }, 10000);
    tabRequests.set(commandId, { resolve, timer });
    channel.send({ type: 'broadcast', event: 'recruiter_action', payload: {
      sessionId: activeSession.sessionId, action: 'close_tab', target: { id: observed.id, revision: observed.revision }, commandId
    } }).catch(() => { clearTimeout(timer); tabRequests.delete(commandId); resolve({ status: 'failed' }); });
  });
});

ipcMain.handle('session:create', async (_, { candidateName, role, policy, technicalVocabulary, policyPreset }) => {
  if (activeSession || creatingSession) throw new Error('Finish or cancel the current interview before creating another.');
  creatingSession = true;
  LocalRisk.resetHistory();
  const session = SessionManager.create({ candidateName, role });
  session.policy = normalizePolicy(policy);
  session.technicalVocabulary = technicalVocabulary || [];
  session.policyPreset = policyPreset || 'standard_technical';
  try {
    await ensureRemoteSession(session);
  activeSession = session;
  sessionData = {
    session,
    startedAt: null,
    endedAt: null,
    transcripts: [],
    flags: [],
    scores: [],
    audioChunks: [],
    notes: [],
    responseAnalyzer: new ResponseWindowAnalyzer(),
    candidateReady: false,
    telemetry: { connected: false, transcription: 'waiting', monitoring: 'waiting' }
  };
    await joinRealtimeSession(session.internalId || session.sessionId, { privateChannel: Boolean(session.internalId) });
    return session;
  } catch (error) {
    if (activeSession?.internalId) {
      try { await updateSessionStatus('cancelled', { ended_at: new Date().toISOString() }); } catch (cleanupError) { console.warn('[Session cleanup]', cleanupError.message); }
    }
    await closeRealtimeSession();
    activeSession = null;
    sessionData = null;
    throw error;
  } finally {
    creatingSession = false;
  }
});

ipcMain.handle('session:cancel', async () => {
  if (startingSession) throw new Error('Wait for the interview start to finish, then end or cancel it.');
  if (endingSession) throw new Error('Wait for the current interview action to finish.');
  if (!activeSession) return { cancelled: false };
  if (sessionData?.startedAt) throw new Error('End the running interview to save its report.');
  endingSession = true;
  providerReview.cancel();
  try {
    try { await updateSessionStatus('cancelled', { ended_at: new Date().toISOString() }); }
    catch (error) { if (!activeSession.demo) throw error; }
    await closeRealtimeSession({ notifyCandidate: true });
    activeSession = null;
    sessionData = null;
    return { cancelled: true };
  } finally {
    endingSession = false;
  }
});

ipcMain.handle('session:update', async (_, { candidateName, role, policy, technicalVocabulary, policyPreset }) => {
  if (startingSession || endingSession) throw new Error('Wait for the current interview action to finish.');
  if (!activeSession || !sessionData) throw new Error('No active session');
  const normalizedPolicy = normalizePolicy(policy || activeSession.policy);

  activeSession = {
    ...activeSession,
    candidateName: candidateName || 'Candidate',
    role: role || 'Interview',
    technicalVocabulary: technicalVocabulary || activeSession.technicalVocabulary || [],
    policyPreset: policyPreset || activeSession.policyPreset || 'standard_technical',
    policy: normalizedPolicy
  };
  sessionData.session = activeSession;

  await updateRemotePolicy(activeSession.sessionId, normalizedPolicy);
  await updateRemoteSessionDetails(activeSession);
  await broadcastSessionPolicy();

  return activeSession;
});

ipcMain.handle('session:start', async () => {
  if (startingSession || endingSession) throw new Error('Wait for the current interview action to finish.');
  if (!sessionData) throw new Error('No active session');
  if (sessionData.endedAt) throw new Error('This interview has already ended.');
  if (sessionData.startedAt) return { started: true, startedAt: sessionData.startedAt };
  if (!sessionData.candidateReady) throw new Error('Wait for the candidate to complete consent and microphone preflight.');
  if (!realtimeChannel || !sessionData.telemetry.connected) throw new Error('Reconnect the interview before starting.');
  const owner = sessionData;
  const session = activeSession;
  const channel = realtimeChannel;
  const startedAt = Date.now();
  startingSession = true;
  try {
    await updateSessionStatus('active', { started_at: new Date(startedAt).toISOString() }, session);
    if (sessionData !== owner || activeSession !== session) throw new Error('The interview changed while starting.');
    owner.startedAt = startedAt;
    owner.telemetry.monitoring = 'healthy';
    owner.telemetry.transcription = 'waiting';
    let sent;
    try { sent = session.demo ? 'ok' : await channel.send({
      type: 'broadcast',
      event: 'session_started',
      payload: { sessionId: session.sessionId, startedAt }
    }); } catch { sent = 'error'; }
    if (sessionData !== owner || activeSession !== session) throw new Error('The interview changed while starting.');
    // The persisted status is authoritative; the candidate also polls it. Rolling
    // back after a missed broadcast could hide already-started candidate capture.
    return { started: true, startedAt, deliveryPending: sent !== 'ok' };
  } finally {
    startingSession = false;
  }
});

ipcMain.handle('session:note', async (_, note = {}) => {
  if (!sessionData || !activeSession) throw new Error('No active session');
  const entry = {
    id: crypto.randomUUID(),
    note: String(note.note || '').trim(),
    bookmarkedAt: note.bookmarkedAt || null,
    transcriptSegmentId: note.transcriptSegmentId || null,
    eventId: note.eventId || null,
    createdAt: Date.now()
  };
  if (!entry.note) throw new Error('Note cannot be empty.');
  sessionData.notes.push(entry);

  const client = getSupabase();
  if (client && activeSession.internalId) {
    const { data: authData } = await client.auth.getSession();
    const { error } = await client.from('session_notes').insert({
      id: entry.id,
      session_id: activeSession.internalId,
      author_id: authData.session?.user?.id || null,
      note: entry.note,
      bookmarked_at: entry.bookmarkedAt ? new Date(entry.bookmarkedAt).toISOString() : null,
      transcript_segment_id: entry.transcriptSegmentId
    });
    if (error) throw new Error(error.message);
  }
  return entry;
});

// Analyze a final transcript chunk from the renderer (Web Speech result)
ipcMain.handle('analyze:transcript', async (_, { text, timestamp }) => {
  if (!sessionData || sessionData.endedAt) return null;
  if (!text || text.trim().length < 4) return null;

  if (sessionData.telemetry) sessionData.telemetry.transcription = 'healthy';
  const analysis = analyzeResponseWindow({
    text,
    timestamp,
    source: 'local',
    segmentId: `manual-${Date.now()}`,
    finalReason: 'manual'
  });
  if (!analysis) return null;

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
    source: 'local',
    analysisWindowId: analysis.analysisWindowId || null,
    responseWindowWordCount: analysis.responseWindowWordCount || 0,
    responseWindowText: analysis.responseWindowText || '',
    unscorableReason: analysis.unscorableReason || null
  };
  sessionData.transcripts.push(entry);
  refreshChunkReview(sessionData);
  if (typeof analysis.score === 'number' && analysis.scorable !== false) {
    sessionData.scores.push({ score: analysis.score, weight: analysis.scoreWeight || 1 });
  }
  return entry;
});

// Manual flag (from renderer, e.g. candidate joined / tab switch events)
ipcMain.handle('flag:add', (_, { text, severity, timestamp }) => {
  if (!sessionData) return;
  sessionData.flags.push({ text, severity, timestamp });
});

ipcMain.handle('candidate:action', async (_, { action, target }) => {
  if (!activeSession || !sessionData) throw new Error('No active session');
  if (!['allow_target', 'reopen_target'].includes(action) || activeSession.demo) {
    throw new Error('Unsupported candidate action');
  }

  if (action === 'allow_target') {
    const policy = normalizePolicy(activeSession.policy);
    const host = String(target?.detectedHost || '').trim();
    const processName = String(target?.processName || '').trim();
    if (host && !policy.allowed_sites.includes(host)) policy.allowed_sites.push(host);
    if (host) policy.blocked_sites = policy.blocked_sites.filter(item => !String(item).toLowerCase().includes(host.toLowerCase()));
    if (!host && processName && !policy.allowed_apps.includes(processName)) policy.allowed_apps.push(processName);
    activeSession.policy = policy;
    sessionData.session = activeSession;
    await updateRemotePolicy(activeSession.sessionId, policy);
    await broadcastSessionPolicy();
  }

  return sendCandidateAction(action, target || {});
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
  if (startingSession) throw new Error('Wait for the interview start to finish before ending.');
  if (!sessionData) return { ended: false };
  if (endingSession) throw new Error('The interview report is already being saved.');
  endingSession = true;
  sessionData.endedAt = sessionData.endedAt || Date.now();
  stopCaptionAnalysis(sessionData);
  refreshChunkReview(sessionData, true);
  sessionData.reportId = sessionData.reportId || crypto.randomUUID();
  if (sessionData.audioChunks.some(chunk => ['received', 'transcribing'].includes(chunk.status))) {
    sessionData.telemetry.transcription = 'unavailable';
  }

  try {
    await closeRealtimeSession({ notifyCandidate: true });
    await persistCompletedSession();
    await cleanupRemoteAudioChunks();
    const review = evaluateReview({
      events: sessionData.flags,
      transcripts: sessionData.transcripts,
      transcriptAnalyses: sessionData.transcripts,
      telemetry: sessionData.telemetry || {}
    });
    sessionData.review = review;
    const behavior = ReportGenerator.behavioralEvidence(sessionData.flags);
    const verdict = computeSessionVerdict({ scores: sessionData.scores, review, behavior });
    sessionData.verdict = verdict;
    const reportPath = await ReportGenerator.generate(sessionData);
    const client = getSupabase();
    if (client && sessionData.session.internalId) {
      const { data: authData } = await client.auth.getSession();
      const { error } = await client.from('reports').upsert({
        id: sessionData.reportId,
        session_id: sessionData.session.internalId,
        organization_id: sessionData.session.organizationId || null,
        recruiter_id: authData.session?.user?.id || null,
        review_band: review.reviewBand,
        summary: {
          candidateName: sessionData.session.candidateName,
          role: sessionData.session.role,
          review: review.summary,
          verdict,
          startedAt: sessionData.startedAt,
          endedAt: sessionData.endedAt
        },
        evidence: sessionData.flags,
        notes: sessionData.notes || [],
        telemetry_health: review.telemetryHealth
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw new Error('Could not save the cloud report. Your evidence is retained; retry saving.');
    }
    shell.openPath(reportPath);
    activeSession = null;
    sessionData = null;
    return { ended: true, reportPath };
  } catch (err) {
    console.error('[Report]', err);
    dialog.showErrorBox('Report generation failed', err.message);
    return { ended: true, reportPending: true, error: err.message };
  } finally {
    endingSession = false;
  }
});

// Open the last-generated report folder
ipcMain.handle('report:openFolder', () => {
  const dir = path.join(app.getPath('userData'), 'reports');
  if (fs.existsSync(dir)) shell.openPath(dir);
});

ipcMain.handle('report:list', async () => {
  const client = getSupabase();
  if (client) {
    const { data, error } = await client.from('reports')
      .select('id,session_id,review_band,summary,created_at,retention_until')
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error) return data || [];
  }
  const dir = path.join(app.getPath('userData'), 'reports');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.html')).map(name => {
    const stat = fs.statSync(path.join(dir, name));
    return { id: name, review_band: 'incomplete_evidence', summary: { candidateName: name }, created_at: stat.mtime.toISOString() };
  });
});

ipcMain.handle('report:delete', async (_, id) => {
  const client = getSupabase();
  if (client && /^[0-9a-f-]{36}$/i.test(String(id || ''))) {
    const { error } = await client.from('reports').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  const candidate = path.resolve(app.getPath('userData'), 'reports', path.basename(String(id || '')));
  const root = path.resolve(app.getPath('userData'), 'reports');
  if (candidate.startsWith(root) && fs.existsSync(candidate)) fs.unlinkSync(candidate);
  return { ok: true };
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
