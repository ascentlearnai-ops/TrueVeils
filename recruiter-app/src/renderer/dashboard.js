// ─── Truveil Command Center — Renderer ──────────────────────────────────

const $ = id => document.getElementById(id);

const screens = {
  idle: $('idle-screen'),
  setup: $('setup-screen'),
  dashboard: $('dashboard-screen'),
  ended: $('ended-screen')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  requestAnimationFrame(() => screens[name].classList.add('active'));
}

// ─── State ─────────────────────────────────────────────────────────────
let sessionStartTime = null;
let timerInterval = null;
let totalFlags = 0;
let totalResponses = 0;
let totalTranscriptSignals = 0;
let scoreSum = 0;
let scoreCount = 0;
let scoreWeightSum = 0;
let latestScore = null;
let hasFirstTranscript = false;
let currentSession = null;

// ─── Elements ──────────────────────────────────────────────────────────
const statusDot = $('statusDot');
const statusText = $('statusText');
const sessionCodeEl = $('sessionCode');
const sessionIdEl = $('sessionId');
const sessionTimerEl = $('sessionTimer');
const glassTitleEl = $('glassTitle');
const scoreRing = $('scoreRing');
const scoreValue = $('scoreValue');
const scoreLabel = $('scoreLabel');
const scoreReasoning = $('scoreReasoning');
const scoreTrendEl = $('scoreTrend');
const scoreSection = $('scoreSection');
const transcriptList = $('transcriptList');
const flagsList = $('flagsList');
const statsScore = $('statsScore');
const statsFlags = $('statsFlags');
const statsResponses = $('statsResponses');
const statsAudio = $('statsAudio');
const flagCount = $('flagCount');
const transcriptCount = $('transcriptCount');
const audioCount = $('audioCount');
const audioQueue = $('audioQueue');
const audioModelStatus = $('audioModelStatus');
const audioHealth = $('audioHealth');
const audioLevelFill = $('audioLevelFill');
const audioLevelValue = $('audioLevelValue');
const candidateNameInput = $('candidateNameInput');
const roleInput = $('roleInput');
const allowedAppsInput = $('allowedAppsInput');
const allowedSitesInput = $('allowedSitesInput');
const customBlockedSitesInput = $('customBlockedSitesInput');
const toastEl = $('toast');

// ─── Utility ───────────────────────────────────────────────────────────
function toast(msg, variant = 'info') {
  toastEl.textContent = msg;
  toastEl.className = `toast visible ${variant}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('visible'), 3000);
}
function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString(); }
function listFromTextarea(value) {
  return String(value || '')
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}
function getBlockedSites() {
  const checked = Array.from(document.querySelectorAll('[data-blocked-site]:checked'))
    .map(input => input.getAttribute('data-blocked-site'))
    .filter(Boolean);
  return Array.from(new Set([...checked, ...listFromTextarea(customBlockedSitesInput.value)]));
}
function getAllowedPolicy() {
  return {
    allowed_apps: listFromTextarea(allowedAppsInput.value),
    allowed_sites: listFromTextarea(allowedSitesInput.value),
    blocked_sites: getBlockedSites(),
    blocking_mode: 'warn_refocus'
  };
}

// ─── Idle: New Session ────────────────────────────────────────────────
$('newSessionBtn').addEventListener('click', onNewSession);
$('newSessionBtn2').addEventListener('click', onNewSession);

async function onNewSession() {
  resetState();
  try {
    statusDot.className = 'status-dot active';
    statusText.textContent = 'Configuring';
    // We create the session object now (generates TRV-XXXXXX), but don't start timer
    currentSession = await window.truveil.createSession({
      candidateName: '',
      role: ''
    });
    sessionCodeEl.textContent = currentSession.sessionId;
    candidateNameInput.value = '';
    roleInput.value = '';
    allowedAppsInput.value = ['TruveilSecure', 'Zoom', 'Microsoft Teams', 'Google Chrome', 'Microsoft Edge'].join('\n');
    allowedSitesInput.value = ['meet.google.com', 'zoom.us', 'teams.microsoft.com'].join('\n');
    customBlockedSitesInput.value = '';
    document.querySelectorAll('[data-blocked-site]').forEach(input => {
      input.checked = ['chatgpt.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com', 'perplexity.ai']
        .includes(input.getAttribute('data-blocked-site'));
    });
    showScreen('setup');
    setTimeout(() => candidateNameInput.focus(), 300);
  } catch (err) {
    console.error(err);
    toast('Failed to create session: ' + err.message, 'error');
  }
}

// ─── Setup Screen ──────────────────────────────────────────────────────
$('cancelSetupBtn').addEventListener('click', () => {
  currentSession = null;
  statusDot.className = 'status-dot';
  statusText.textContent = 'Idle';
  showScreen('idle');
});

$('startMonitoringBtn').addEventListener('click', startMonitoring);

async function startMonitoring() {
  const name = candidateNameInput.value.trim() || 'Candidate';
  const role = roleInput.value.trim() || 'Interview';

  try {
    currentSession = await window.truveil.updateSession({ candidateName: name, role, policy: getAllowedPolicy() });
  } catch (err) {
    toast('Failed to update session: ' + err.message, 'error');
    return;
  }

  // Kick off session timer. Candidate audio/transcript arrives over Supabase Realtime.
  await window.truveil.startSession();
  sessionStartTime = Date.now();
  startTimer();

  sessionIdEl.textContent = `SESSION: ${currentSession.sessionId}`;
  glassTitleEl.textContent = `${name} · ${role}`;

  statusDot.className = 'status-dot active';
  statusText.textContent = 'Waiting for candidate';
  showScreen('dashboard');
}

// ─── Interim / final transcript ───────────────────────────────────────
let interimBubble = null;
function updateInterim(text) {
  if (!text) { if (interimBubble) { interimBubble.remove(); interimBubble = null; } return; }
  if (!hasFirstTranscript) {
    transcriptList.innerHTML = '';
    hasFirstTranscript = true;
  }
  if (!interimBubble) {
    interimBubble = document.createElement('div');
    interimBubble.className = 'transcript-entry interim';
    interimBubble.innerHTML = `
      <div class="entry-header">
        <span class="entry-time">${fmtTime(Date.now())}</span>
        <span class="entry-score pending">Listening…</span>
      </div>
      <div class="entry-text"></div>`;
    transcriptList.prepend(interimBubble);
  }
  interimBubble.querySelector('.entry-text').textContent = text;
}

async function commitFinalTranscript(text) {
  if (!text || text.trim().length < 3) return;
  if (interimBubble) { interimBubble.remove(); interimBubble = null; }
  if (!hasFirstTranscript) {
    transcriptList.innerHTML = '';
    hasFirstTranscript = true;
  }

  totalResponses++;
  transcriptCount.textContent = totalResponses;
  statsResponses.textContent = totalResponses;

  const timestamp = Date.now();
  const entryEl = document.createElement('div');
  entryEl.className = 'transcript-entry';
  entryEl.innerHTML = `
    <div class="entry-header">
      <span class="entry-time">${fmtTime(timestamp)}</span>
      <span class="entry-score pending">Analyzing…</span>
    </div>
    <div class="entry-text">${esc(text)}</div>
    <div class="entry-reasoning hidden"></div>`;
  transcriptList.prepend(entryEl);

  try {
    const result = await window.truveil.analyzeTranscript({ text, timestamp });
    if (!result) return;
    renderAnalysis(entryEl, result);
  } catch (err) {
    console.error('[analyze error]', err);
    const scoreEl = entryEl.querySelector('.entry-score');
    scoreEl.textContent = 'error';
    scoreEl.className = 'entry-score high';
  }
}

function renderAnalysis(entryEl, result) {
  const { aiScore, reasoning, flags, error, displayLabel, aiSignals = [], humanSignals = [], source, scorable, scoreWeight } = result;
  const scoreEl = entryEl.querySelector('.entry-score');
  const reasoningEl = entryEl.querySelector('.entry-reasoning');

  if (error || aiScore == null) {
    scoreEl.textContent = '—';
    scoreEl.className = 'entry-score';
    reasoningEl.textContent = reasoning || 'Analysis unavailable';
    reasoningEl.classList.remove('hidden');
    return;
  }

  const cls = aiScore >= 70 ? 'high' : aiScore >= 40 ? 'medium' : 'low';
  scoreEl.textContent = displayLabel ? `${displayLabel} · ${aiScore}%` : `${aiScore}%`;
  scoreEl.className = `entry-score ${cls}`;

  if (reasoning) {
    const evidence = aiSignals.length ? ` Evidence: ${aiSignals.slice(0, 3).join('; ')}.` : '';
    const counter = humanSignals.length ? ` Human counter-signal: ${humanSignals[0]}.` : '';
    const sourceText = source ? ` Source: ${source}.` : '';
    reasoningEl.textContent = `${reasoning}${evidence}${counter}${sourceText}`;
    reasoningEl.classList.remove('hidden');
  }

  // Update aggregate. Inconclusive short fragments do not count as low-risk evidence.
  const canScore = typeof aiScore === 'number' && scorable !== false;
  if (canScore) {
    const weight = typeof scoreWeight === 'number' && scoreWeight > 0 ? scoreWeight : 1;
    scoreSum += aiScore * weight;
    scoreWeightSum += weight;
    scoreCount++;
    latestScore = aiScore;
  }
  const avg = scoreWeightSum ? Math.round(scoreSum / scoreWeightSum) : 0;
  updateScoreRing(avg, canScore ? latestScore : null, reasoning, displayLabel);

  // Add flags
  if (flags && flags.length) {
    flags.forEach(f => addFlag(f, result.timestamp, aiScore >= 70 ? 'high' : 'medium', false));
  }
}

function updateScoreRing(avgScore, latest, reasoning, displayLabel) {
  const circumference = 175.9;
  const visibleScore = typeof latest === 'number' ? latest : avgScore;
  const offset = circumference - (visibleScore / 100) * circumference;
  scoreRing.style.strokeDashoffset = offset;

  // Clear risk classes then reapply
  scoreSection.classList.remove('high-risk', 'medium-risk');
  let color, label;
  if (typeof latest !== 'number') {
    color = '#64748b';
    label = displayLabel || 'Inconclusive';
  } else if (latest >= 70) {
    color = '#ef4444';
    label = displayLabel || 'High AI Risk';
    scoreSection.classList.add('high-risk');
  } else if (latest >= 40) {
    color = '#f59e0b';
    label = displayLabel || 'Elevated AI Risk';
    scoreSection.classList.add('medium-risk');
  } else {
    color = '#22c55e';
    label = displayLabel || 'Low AI-assistance risk';
  }
  scoreRing.setAttribute('stroke', color);
  scoreValue.textContent = typeof latest === 'number' ? `${latest}%` : '—';
  scoreLabel.textContent = label;
  if (reasoning) scoreReasoning.textContent = reasoning;

  // Metrics
  statsScore.textContent = `${avgScore}%`;
  statsScore.className = 'mm-val ' + (avgScore >= 70 ? 'risk-high' : avgScore >= 40 ? 'risk-med' : 'risk-low');
  scoreTrendEl.textContent = typeof latest === 'number' ? `${latest}%` : '—';
  scoreTrendEl.className = 'mm-val mm-trend ' + (typeof latest === 'number' && latest >= 70 ? 'rising' : typeof latest === 'number' && latest < 40 ? 'falling' : '');
}

function audioStatusLabel(status) {
  const labels = {
    received: 'Received',
    transcribing: 'Transcribing',
    transcribed: 'Transcribed',
    transcribed_deleted: 'Transcribed + deleted',
    failed: 'Needs attention',
    failed_deleted: 'Failed + deleted',
    deleted: 'Cleaned'
  };
  return labels[status] || status || 'Received';
}

function audioStatusClass(status) {
  if (status === 'failed' || status === 'failed_deleted') return 'bad';
  if (status === 'transcribed' || status === 'transcribed_deleted' || status === 'deleted') return 'ok';
  return 'busy';
}

function renderAudioChunk(chunk = {}) {
  if (!audioQueue || !chunk.chunkId) return;

  if (audioQueue.querySelector('.empty-state')) audioQueue.innerHTML = '';
  let el = audioQueue.querySelector(`[data-audio-chunk="${chunk.chunkId}"]`);
  const isNew = !el;
  if (!el) {
    el = document.createElement('div');
    el.className = 'audio-item';
    el.dataset.audioChunk = chunk.chunkId;
    audioQueue.prepend(el);
  }

  if (isNew) {
    totalTranscriptSignals++;
    if (audioCount) audioCount.textContent = totalTranscriptSignals;
    if (statsAudio) statsAudio.textContent = totalTranscriptSignals;
  }

  const status = audioStatusLabel(chunk.status);
  const cls = audioStatusClass(chunk.status);
  const duration = chunk.durationMs ? `${Math.round(chunk.durationMs / 1000)}s` : 'live';
  const source = chunk.source ? `<div class="audio-item-meta">Source: ${esc(chunk.source)}${chunk.remoteDeleted ? ' - remote audio deleted' : ''}</div>` : '';
  el.className = `audio-item ${cls}`;
  el.innerHTML = `
    <div class="audio-item-main">
      <div class="audio-item-top">
        <strong>Transcript signal ${Number(chunk.sequence || 0) + 1}</strong>
        <span class="audio-chip ${cls}">${esc(status)}</span>
      </div>
      <div class="audio-item-meta">${fmtTime(chunk.timestamp || Date.now())} - ${duration}</div>
      ${source}
      ${chunk.transcript ? `<div class="audio-mini-transcript">${esc(chunk.transcript)}</div>` : ''}
      ${chunk.reasoning ? `<div class="audio-reason">${esc(chunk.reasoning)}</div>` : ''}
    </div>`;
}

function updateAudioLevel(level = {}) {
  const rms = Math.max(0, Math.min(1, Number(level.rms) || 0));
  const peak = Math.max(0, Math.min(1, Number(level.peak) || 0));
  const visual = Math.max(rms * 4, peak * .8);
  if (audioLevelFill) audioLevelFill.style.width = `${Math.round(Math.min(1, visual) * 100)}%`;
  if (audioLevelValue) audioLevelValue.textContent = `${Math.round(Math.min(1, visual) * 100)}%`;
  if (audioHealth) audioHealth.textContent = visual > .02 ? 'Candidate mic live' : 'Waiting for speech';
}

function updateAudioStatus(status = {}) {
  if (!audioModelStatus) return;
  audioModelStatus.textContent = status.message || 'Local speech engine ready';
  audioModelStatus.className = `audio-model-status ${status.state === 'error' ? 'error' : status.state === 'ready' ? 'ready' : 'busy'}`;
}

if (audioQueue) {
  audioQueue.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-play-audio]');
    if (!button) return;
    const chunkId = button.getAttribute('data-play-audio');
    button.disabled = true;
    try {
      const result = await window.truveil.getAudioChunk({ chunkId });
      if (!result?.ok) throw new Error(result?.error || 'Audio not ready yet');
      const audio = new Audio(result.dataUrl);
      await audio.play();
    } catch (err) {
      toast('Replay failed: ' + err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

// ─── Flags ────────────────────────────────────────────────────────────
function addFlag(text, timestamp, severity = 'medium', persist = true) {
  totalFlags++;
  flagCount.textContent = totalFlags;
  statsFlags.textContent = totalFlags;

  if (flagsList.querySelector('.empty-state')) flagsList.innerHTML = '';

  const icons = { critical: '●', high: '●', medium: '●', low: '○' };
  const el = document.createElement('div');
  el.className = `flag-item ${severity}`;
  el.innerHTML = `
    <span class="flag-icon">${icons[severity] || '●'}</span>
    <div style="flex:1;min-width:0">
      <div class="flag-text">${esc(text)}</div>
      <div class="flag-time">${fmtTime(timestamp || Date.now())}</div>
    </div>`;
  flagsList.prepend(el);

  if (persist) {
    window.truveil.addFlag({ text, severity, timestamp: timestamp || Date.now() });
  }
}

// ─── Timer ────────────────────────────────────────────────────────────
function renderRealtimeTranscript(result) {
  if (!result || !result.text) return;
  if (interimBubble) { interimBubble.remove(); interimBubble = null; }
  if (!hasFirstTranscript) {
    transcriptList.innerHTML = '';
    hasFirstTranscript = true;
  }

  totalResponses++;
  totalTranscriptSignals++;
  transcriptCount.textContent = totalResponses;
  statsResponses.textContent = totalResponses;
  if (audioCount) audioCount.textContent = totalTranscriptSignals;
  if (statsAudio) statsAudio.textContent = totalTranscriptSignals;

  const timestamp = result.timestamp || Date.now();
  const entryEl = document.createElement('div');
  entryEl.className = 'transcript-entry';
  entryEl.innerHTML = `
    <div class="entry-header">
      <span class="entry-time">${fmtTime(timestamp)}</span>
      <span class="entry-score pending">Analyzing...</span>
    </div>
    <div class="entry-text">${esc(result.text)}</div>
    <div class="entry-reasoning hidden"></div>`;
  transcriptList.prepend(entryEl);

  renderAnalysis(entryEl, { ...result, timestamp });
}

window.truveil.onRealtimeTranscript((entry) => {
  statusDot.className = 'status-dot recording';
  statusText.textContent = 'Transcript live';
  renderRealtimeTranscript(entry);
});

window.truveil.onRealtimeFlag((flag) => {
  addFlag(flag.text, flag.timestamp, flag.severity || 'medium', false);
});

window.truveil.onRealtimeStatus((status) => {
  if (status?.text) statusText.textContent = status.text;
});

window.truveil.onRealtimeAudioChunk((chunk) => {
  statusDot.className = 'status-dot recording';
  statusText.textContent = chunk?.status === 'transcribing' ? 'Processing transcript' : 'Transcript signal';
  renderAudioChunk(chunk);
});

window.truveil.onRealtimeAudioLevel((level) => {
  updateAudioLevel(level);
});

window.truveil.onRealtimeAudioStatus((status) => {
  updateAudioStatus(status);
});

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - sessionStartTime;
    const h = String(Math.floor(elapsed / 3600000)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    sessionTimerEl.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

// ─── End Session ──────────────────────────────────────────────────────
$('endSessionBtn').addEventListener('click', endSession);

async function endSession() {
  clearInterval(timerInterval);
  statusDot.className = 'status-dot';
  statusText.textContent = 'Complete';

  const avg = scoreWeightSum ? Math.round(scoreSum / scoreWeightSum) : 0;
  $('endedStats').innerHTML = `
    <div class="es-item"><span>${avg}%</span>Avg Risk</div>
    <div class="es-item"><span>${totalResponses}</span>Responses</div>
    <div class="es-item"><span>${totalTranscriptSignals}</span>Text Signals</div>
    <div class="es-item"><span>${totalFlags}</span>Flags</div>`;

  try {
    const result = await window.truveil.endSession();
    if (result && result.reportPath) {
      $('endedSub').textContent = 'Your interview report has been saved and opened in your browser.';
    } else {
      $('endedSub').textContent = 'Session ended. No report generated.';
    }
  } catch (err) {
    console.error(err);
    toast('Failed to generate report: ' + err.message, 'error');
  }
  showScreen('ended');
}

$('openReportsFolderBtn').addEventListener('click', () => {
  window.truveil.openReportsFolder();
});

// ─── Reset ────────────────────────────────────────────────────────────
function resetState() {
  totalFlags = 0;
  totalResponses = 0;
  totalTranscriptSignals = 0;
  scoreSum = 0;
  scoreCount = 0;
  scoreWeightSum = 0;
  latestScore = null;
  hasFirstTranscript = false;
  interimBubble = null;
  transcriptList.innerHTML = '<div class="empty-state"><span class="empty-cursor"></span>Listening for voice signature…</div>';
  flagsList.innerHTML = '<div class="empty-state">No active anomalies</div>';
  transcriptCount.textContent = '0';
  flagCount.textContent = '0';
  statsScore.textContent = '0%';
  statsScore.className = 'mm-val risk-low';
  statsFlags.textContent = '0';
  statsResponses.textContent = '0';
  if (statsAudio) statsAudio.textContent = '0';
  if (audioCount) audioCount.textContent = '0';
  if (audioQueue) audioQueue.innerHTML = '<div class="empty-state">Waiting for live transcript or audio fallback signals</div>';
  if (audioModelStatus) {
    audioModelStatus.textContent = 'Ready for live text or audio fallback transcription';
    audioModelStatus.className = 'audio-model-status ready';
  }
  if (audioHealth) audioHealth.textContent = 'No signal yet';
  if (audioLevelFill) audioLevelFill.style.width = '0%';
  if (audioLevelValue) audioLevelValue.textContent = '0%';
  scoreTrendEl.textContent = '—';
  scoreTrendEl.className = 'mm-val mm-trend';
  scoreValue.textContent = '—';
  scoreLabel.textContent = 'Listening';
  scoreReasoning.textContent = 'Waiting for first response…';
  scoreRing.style.strokeDashoffset = '175.9';
  scoreRing.setAttribute('stroke', '#22c55e');
  scoreSection.classList.remove('high-risk', 'medium-risk');
  sessionTimerEl.textContent = '00:00:00';
}

// ─── Settings Modal ───────────────────────────────────────────────────
const settingsModal = $('settingsModal');
$('openSettingsBtn').addEventListener('click', openSettings);
$('closeSettingsBtn').addEventListener('click', () => settingsModal.classList.remove('active'));
$('cancelSettingsBtn').addEventListener('click', () => settingsModal.classList.remove('active'));
$('saveSettingsBtn').addEventListener('click', saveSettings);

async function openSettings() {
  const s = await window.truveil.getSettings();
  $('openrouterKeyInput').value = s.openrouterKey || '';
  $('modelSelect').value = s.model || 'google/gemini-2.0-flash-001';
  $('settingsStatus').textContent = '';
  settingsModal.classList.add('active');
}

async function saveSettings() {
  const patch = {
    openrouterKey: $('openrouterKeyInput').value.trim(),
    model: $('modelSelect').value
  };
  await window.truveil.saveSettings(patch);
  $('settingsStatus').textContent = 'Settings saved.';
  $('settingsStatus').className = 'settings-status success';
  setTimeout(() => settingsModal.classList.remove('active'), 700);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (settingsModal.classList.contains('active')) settingsModal.classList.remove('active');
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault();
    openSettings();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────
(async () => {
  try {
    const s = await window.truveil.getSettings();
    console.log('[Truveil] settings loaded', !!s);
  } catch (e) {
    console.warn('Settings load failed', e);
  }
})();
