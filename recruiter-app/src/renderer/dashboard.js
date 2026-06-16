// ─── Truveil Command Center — Renderer ──────────────────────────────────

const $ = id => document.getElementById(id);

const screens = {
  auth: $('auth-screen'),
  idle: $('idle-screen'),
  setup: $('setup-screen'),
  dashboard: $('dashboard-screen'),
  reports: $('reports-screen'),
  ended: $('ended-screen')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  document.querySelectorAll('.workspace-nav-btn').forEach(button => button.classList.remove('active'));
  if (name === 'dashboard') $('navLiveSession')?.classList.add('active');
  else if (name === 'reports') $('navReports')?.classList.add('active');
  else $('navNewSession')?.classList.add('active');
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
let flagEvidence = [];
let candidateReady = false;
let telemetryState = { connected: true, transcription: 'waiting', monitoring: 'waiting' };
let manualSessionMode = false;

// ─── Elements ──────────────────────────────────────────────────────────
const statusDot = $('statusDot');
const statusText = $('statusText');
const sessionCodeEl = $('sessionCode');
const sessionServiceNotice = $('sessionServiceNotice');
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
const authEmailInput = $('authEmailInput');
const authCodeInput = $('authCodeInput');
const authMessage = $('authMessage');
const authUser = $('authUser');
const signOutBtn = $('signOutBtn');
const technicalVocabularyInput = $('technicalVocabularyInput');
const policyPresetSelect = $('policyPresetSelect');
const startMonitoringBtn = $('startMonitoringBtn');
const notesList = $('notesList');

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

async function renderAuthState(state = {}) {
  const signedIn = Boolean(state.signedIn);
  authUser.hidden = !signedIn;
  authUser.textContent = state.user?.email || '';
  signOutBtn.hidden = !signedIn;
  showScreen(signedIn || manualSessionMode || state.configured === false ? 'idle' : 'auth');
}

$('sendSignInLinkBtn').addEventListener('click', async () => {
  const button = $('sendSignInLinkBtn');
  button.disabled = true;
  authMessage.textContent = 'Sending secure sign-in link...';
  try {
    await window.truveil.sendSignInLink(authEmailInput.value);
    authMessage.textContent = 'Check your email. You can click the link or paste the 6 digit email code here. To create a candidate TRV code now, use the button below.';
  } catch (err) {
    const message = String(err.message || '');
    authMessage.textContent = message.includes('rate limit')
      ? 'Email sign-in is rate-limited. Click "Create interview code without email" and share the TRV code from the next screen.'
      : message;
  } finally {
    button.disabled = false;
  }
});

authCodeInput?.addEventListener('input', (event) => {
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
});

$('verifySignInCodeBtn')?.addEventListener('click', async () => {
  const button = $('verifySignInCodeBtn');
  button.disabled = true;
  authMessage.textContent = 'Verifying sign-in code...';
  try {
    await renderAuthState(await window.truveil.verifySignInCode({
      email: authEmailInput.value,
      token: authCodeInput.value
    }));
    authMessage.textContent = 'Signed in.';
  } catch (err) {
    authMessage.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$('continueOfflineBtn')?.addEventListener('click', () => {
  manualSessionMode = true;
  authMessage.textContent = '';
  showScreen('idle');
  toast('Email skipped. Create a session and share the TRV code with the candidate.', 'success');
});

signOutBtn.addEventListener('click', async () => {
  await renderAuthState(await window.truveil.signOut());
});

window.truveil.onAuthChanged(renderAuthState);
window.truveil.onAuthError(error => {
  authMessage.textContent = error?.message || 'Sign-in failed.';
  showScreen('auth');
});

function behaviorBoostFromFlags(flags = []) {
  let aiToolHits = 0;
  let overlayHits = 0;
  let focusSwitches = 0;
  let unlistedAppHits = 0;
  let criticalHits = 0;
  for (const flag of flags) {
    const text = flagEvidenceText(flag);
    const severity = String(flag.severity || '').toLowerCase();
    if (severity === 'critical') criticalHits++;
    if (/\b(chatgpt\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|perplexity\.ai|poe\.com|you\.com|phind\.com|interviewcoder|interview coder|cluely|finalround|lockedin|parakeet|leetcode wizard|ultracode|interview copilot)\b/.test(text)) aiToolHits++;
    if (/\b(hidden overlay|overlay detected|exclude.?from.?capture|interview coder|interviewcoder|cluely|lockedin|finalround|parakeet)\b/.test(text)) overlayHits++;
    if (/\bswitched away\b/.test(text)) focusSwitches++;
    if (/\bunlisted app\/site\b/.test(text)) unlistedAppHits++;
  }
  return Math.min(100, Math.round(
    (aiToolHits ? 48 + Math.min(34, (aiToolHits - 1) * 17) : 0)
    + overlayHits * 24
    + criticalHits * 4
    + Math.min(8, focusSwitches)
    + Math.min(8, unlistedAppHits * 2)
  ));
}

function flagEvidenceText(flag = {}) {
  return [
    flag.text,
    flag.detectedHost,
    flag.detectedUrl,
    flag.matchedRule,
    flag.processName,
    flag.windowTitle
  ].filter(Boolean).join(' ').toLowerCase();
}

function currentTranscriptAverage() {
  return scoreWeightSum ? Math.round(scoreSum / scoreWeightSum) : 0;
}

function currentOverallRisk() {
  return Math.max(currentTranscriptAverage(), behaviorBoostFromFlags(flagEvidence));
}

function currentReviewBand() {
  const exactAi = flagEvidence.some(flag => {
    const text = flagEvidenceText(flag);
    return /(chatgpt\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|perplexity\.ai|interviewcoder|cluely|lockedin|finalround)/i.test(text)
      && (flag.detectionSource === 'url' || flag.closedRestrictedTarget || flag.eventType === 'overlay_detected');
  });
  const possibleAi = flagEvidence.some(flag => /(chatgpt|claude|gemini|copilot|perplexity|interviewcoder|cluely)/i.test(flagEvidenceText(flag)));
  const switches = flagEvidence.filter(flag => flag.eventType === 'focus_lost' || flag.eventType === 'foreground_changed').length;
  if (exactAi) return { key: 'high_priority_review', label: 'High-priority review', reason: 'Exact restricted AI-tool or hidden-overlay evidence was recorded.' };
  if (possibleAi || switches >= 4) return { key: 'review', label: 'Review', reason: 'One or more monitored events should be reviewed with interview context.' };
  if (telemetryState.connected === false || telemetryState.transcription === 'unavailable') return { key: 'incomplete_evidence', label: 'Incomplete evidence', reason: 'Telemetry was incomplete during this session.' };
  return { key: 'clear', label: 'Clear', reason: 'No meaningful integrity evidence has been recorded.' };
}

function refreshOverallRiskMetric() {
  const band = currentReviewBand();
  statsScore.textContent = band.label;
  statsScore.className = 'mm-val ' + (band.key === 'high_priority_review' ? 'risk-high' : band.key === 'review' ? 'risk-med' : 'risk-low');
  scoreSection.classList.toggle('high-risk', band.key === 'high_priority_review');
  scoreSection.classList.toggle('medium-risk', band.key === 'review');
  scoreValue.textContent = band.label;
  scoreLabel.textContent = band.label;
  scoreReasoning.textContent = band.reason;
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
      role: '',
      technicalVocabulary: [],
      policyPreset: 'standard_technical'
    });
    sessionCodeEl.textContent = currentSession.sessionId;
    if (currentSession.localOnly) {
      toast(`Code generated: ${currentSession.sessionId}. Supabase rejected session sync, so use this as a manual code for now.`, 'warn');
      $('candidateReadyState').innerHTML = '<i></i> Manual code generated';
      sessionServiceNotice.hidden = false;
      sessionServiceNotice.textContent = `Manual code mode: ${currentSession.remoteError || 'Supabase session sync is unavailable.'}`;
    } else {
      toast(`Candidate code created: ${currentSession.sessionId}`, 'success');
      $('candidateReadyState').innerHTML = '<i></i> Candidate preflight pending';
      sessionServiceNotice.hidden = true;
      sessionServiceNotice.textContent = '';
    }
    candidateNameInput.value = '';
    roleInput.value = '';
    allowedAppsInput.value = ['TruveilSecure', 'Zoom', 'Microsoft Teams', 'Google Chrome', 'Microsoft Edge'].join('\n');
    allowedSitesInput.value = ['meet.google.com', 'zoom.us', 'teams.microsoft.com'].join('\n');
    customBlockedSitesInput.value = '';
    technicalVocabularyInput.value = '';
    policyPresetSelect.value = 'standard_technical';
    candidateReady = false;
    startMonitoringBtn.disabled = true;
    startMonitoringBtn.innerHTML = currentSession.localOnly
      ? 'Session service needs Supabase sync'
      : '<span class="dots-pulse"><span></span><span></span><span></span></span> Waiting for candidate preflight';
    document.querySelectorAll('[data-blocked-site]').forEach(input => {
      input.checked = [
        'chatgpt.com',
        'claude.ai',
        'gemini.google.com',
        'copilot.microsoft.com',
        'perplexity.ai',
        'poe.com',
        'you.com',
        'phind.com',
        'interviewcoder',
        'cluely',
        'finalround',
        'lockedin'
      ]
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
  if (!candidateReady) {
    toast('Wait for the candidate to complete consent and microphone preflight.', 'error');
    return;
  }
  const name = candidateNameInput.value.trim() || 'Candidate';
  const role = roleInput.value.trim() || 'Interview';

  try {
    currentSession = await window.truveil.updateSession({
      candidateName: name,
      role,
      policy: getAllowedPolicy(),
      technicalVocabulary: listFromTextarea(technicalVocabularyInput.value),
      policyPreset: policyPresetSelect.value
    });
  } catch (err) {
    toast('Failed to update session: ' + err.message, 'error');
    return;
  }

  // Kick off session timer. Candidate audio/transcript arrives over Supabase Realtime.
  await window.truveil.startSession();
  sessionStartTime = Date.now();
  startTimer();

  sessionIdEl.textContent = `SESSION: ${currentSession.sessionId}`;
  glassTitleEl.textContent = `${name} / ${role}`;

  statusDot.className = 'status-dot active';
  statusText.textContent = 'Waiting for candidate';
  showScreen('dashboard');
}

function candidateInviteLink() {
  const code = currentSession?.sessionId || sessionCodeEl.textContent;
  return currentSession?.candidateLink || `https://truveil-client.vercel.app/?code=${encodeURIComponent(code)}#download`;
}

$('copySessionCodeBtn')?.addEventListener('click', async () => {
  const code = currentSession?.sessionId || sessionCodeEl.textContent;
  await window.truveil.copyLink(code);
  toast(`Copied ${code}. Candidate can paste it in Truveil Secure.`, 'success');
});

$('copyCandidateLinkBtn')?.addEventListener('click', async () => {
  await window.truveil.copyLink(candidateInviteLink());
  toast('Copied candidate invite link.', 'success');
});

policyPresetSelect?.addEventListener('change', () => {
  const preset = policyPresetSelect.value;
  const checks = Array.from(document.querySelectorAll('[data-blocked-site]'));
  if (preset === 'open_book') {
    checks.forEach(input => { input.checked = ['interviewcoder', 'cluely', 'finalround', 'lockedin'].includes(input.dataset.blockedSite); });
  } else if (preset === 'strict') {
    checks.forEach(input => { input.checked = true; });
  } else if (preset === 'standard_technical') {
    checks.forEach(input => { input.checked = !['poe.com', 'you.com', 'phind.com'].includes(input.dataset.blockedSite); });
  }
});

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
        <span class="entry-score pending">Live interim</span>
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
      <span class="entry-score pending">Pattern review pending</span>
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
  const { aiScore, reasoning, flags, error, displayLabel, aiSignals = [], source, scorable, scoreWeight } = result;
  const scoreEl = entryEl.querySelector('.entry-score');
  const reasoningEl = entryEl.querySelector('.entry-reasoning');

  if (error || aiScore == null) {
    scoreEl.textContent = '-';
    scoreEl.className = 'entry-score';
    reasoningEl.textContent = reasoning || 'Analysis unavailable';
    reasoningEl.classList.remove('hidden');
    return;
  }

  const cls = aiScore >= 70 ? 'high' : aiScore >= 40 ? 'medium' : 'low';
  scoreEl.textContent = scorable === false ? 'Pattern review abstained' : 'Experimental pattern note';
  scoreEl.className = `entry-score ${scorable === false ? '' : cls}`;

  if (reasoning) {
    const evidence = aiSignals.length ? aiSignals.slice(0, 2).join(' + ') : 'No strong signal';
    const sourceText = source ? `Source: ${source}` : 'Source: live transcript';
    reasoningEl.textContent = `${evidence}. ${sourceText}.`;
    reasoningEl.classList.remove('hidden');
  }

  const canScore = typeof aiScore === 'number' && scorable !== false;
  if (canScore) {
    const weight = typeof scoreWeight === 'number' && scoreWeight > 0 ? scoreWeight : 1;
    scoreSum += aiScore * weight;
    scoreWeightSum += weight;
    scoreCount++;
    latestScore = aiScore;
  }
  const avg = currentOverallRisk();
  updateScoreRing(avg, canScore ? latestScore : null, reasoning, displayLabel);

  // Transcript-pattern analysis is advisory context only. It never creates a
  // behavioral event or overrides observed app/site evidence.
}

function riskChipLabel(score) {
  if (score >= 70) return 'Review';
  if (score >= 40) return 'Watch';
  return 'Clear';
}
function updateScoreRing(avgScore, latest, reasoning, displayLabel) {
  refreshOverallRiskMetric();
  scoreTrendEl.textContent = telemetryState.transcription === 'healthy' ? 'Healthy' : 'Listening';
  scoreTrendEl.className = 'mm-val mm-trend';
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
function addFlag(text, timestamp, severity = 'medium', persist = true, evidence = {}) {
  totalFlags++;
  flagCount.textContent = totalFlags;
  statsFlags.textContent = totalFlags;
  flagEvidence.push({ text, severity, timestamp: timestamp || Date.now(), ...evidence });
  refreshOverallRiskMetric();

  if (flagsList.querySelector('.empty-state')) flagsList.innerHTML = '';

  const icons = { critical: '!', high: '!', medium: '+', low: '-' };
  const target = {
    processName: evidence.processName || '',
    windowTitle: evidence.windowTitle || '',
    detectedHost: evidence.detectedHost || '',
    detectedUrl: evidence.detectedUrl || '',
    matchedRule: evidence.matchedRule || ''
  };
  const hasTarget = Object.values(target).some(Boolean);
  const controls = hasTarget ? `
    <div class="flag-actions">
      <button data-candidate-action="allow_target">Allow</button>
      <button data-candidate-action="close_target">Close / refocus</button>
      ${(target.detectedUrl || target.detectedHost) ? '<button data-candidate-action="reopen_target">Reopen</button>' : ''}
    </div>` : '';
  const el = document.createElement('div');
  el.dataset.target = JSON.stringify(target);
  el.className = `flag-item ${severity}`;
  el.innerHTML = `
    <span class="flag-icon">${icons[severity] || '+'}</span>
    <div style="flex:1;min-width:0">
      <div class="flag-text">${esc(text)}</div>
      <div class="flag-time">${fmtTime(timestamp || Date.now())}</div>
      ${controls}
    </div>`;
  flagsList.prepend(el);

  if (persist) {
    window.truveil.addFlag({ text, severity, timestamp: timestamp || Date.now() });
  }
}

flagsList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-candidate-action]');
  if (!button) return;

  const item = button.closest('.flag-item');
  const target = JSON.parse(item?.dataset.target || '{}');
  const action = button.dataset.candidateAction;
  button.disabled = true;

  try {
    await window.truveil.sendCandidateAction({ action, target });
    const labels = {
      allow_target: 'Destination allowed for this session',
      close_target: 'Close/refocus request sent',
      reopen_target: 'Reopen request sent'
    };
    toast(labels[action] || 'Action sent', 'success');
  } catch (err) {
    toast(err.message || 'Could not send action', 'error');
  } finally {
    button.disabled = false;
  }
});

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
  telemetryState.transcription = 'healthy';
  renderRealtimeTranscript(entry);
});

if (window.truveil.onRealtimeInterimTranscript) {
  window.truveil.onRealtimeInterimTranscript((entry) => {
    statusDot.className = 'status-dot recording';
    statusText.textContent = 'Listening live';
    updateInterim(entry?.text || '');
  });
}

window.truveil.onRealtimeFlag((flag) => {
  addFlag(flag.text, flag.timestamp, flag.severity || 'medium', false, flag);
});

window.truveil.onRealtimeStatus((status) => {
  if (status?.text) statusText.textContent = status.text;
  if (status?.candidateReady) {
    candidateReady = true;
    $('candidateReadyState').innerHTML = '<i></i> Candidate ready';
    startMonitoringBtn.disabled = false;
    startMonitoringBtn.textContent = 'Start interview';
    toast('Candidate completed consent and microphone preflight.', 'success');
  }
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

  const band = currentReviewBand();
  $('endedStats').innerHTML = `
    <div class="es-item"><span>${band.label}</span>Review band</div>
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

async function addNote(bookmark = false, overrideText = '') {
  const input = $('noteInput');
  const note = String(overrideText || input.value || '').trim();
  if (!note) return;
  try {
    const entry = await window.truveil.addSessionNote({
      note,
      bookmarkedAt: bookmark ? Date.now() : null
    });
    const row = document.createElement('div');
    row.className = 'note-item';
    row.innerHTML = `${bookmark ? '<strong>Bookmark</strong> ' : ''}${esc(entry.note)}<span>${fmtTime(entry.createdAt)}</span>`;
    notesList.prepend(row);
    input.value = '';
    toast(bookmark ? 'Moment bookmarked' : 'Note added', 'success');
  } catch (error) {
    toast(error.message || 'Could not add note', 'error');
  }
}

$('addNoteBtn')?.addEventListener('click', () => addNote(false));
$('bookmarkBtn')?.addEventListener('click', () => addNote(true, $('noteInput').value || 'Bookmarked interview moment'));
document.querySelectorAll('[data-followup]').forEach(button => button.addEventListener('click', () => {
  const question = button.dataset.followup;
  window.truveil.copyLink(question);
  addNote(false, `Suggested follow-up copied: ${question}`);
}));

async function loadReports() {
  const list = $('reportList');
  list.innerHTML = '<div class="empty-state">Loading reports...</div>';
  const reports = await window.truveil.listReports();
  if (!reports.length) {
    list.innerHTML = '<div class="empty-state">No reports yet</div>';
    return;
  }
  list.innerHTML = reports.map(report => `
    <div class="report-row" data-report-id="${esc(report.id)}">
      <div><strong>${esc(report.summary?.candidateName || 'Interview report')}</strong><span>${esc(report.summary?.role || '')} / ${new Date(report.created_at).toLocaleString()}</span></div>
      <div class="review-band">${esc(String(report.review_band || 'incomplete_evidence').replaceAll('_', ' '))}</div>
      <button class="btn sm" data-delete-report>Delete</button>
    </div>`).join('');
}

$('reportList')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-report]');
  if (!button) return;
  const row = button.closest('.report-row');
  await window.truveil.deleteReport(row.dataset.reportId);
  row.remove();
});

$('navNewSession')?.addEventListener('click', () => showScreen(currentSession ? 'setup' : 'idle'));
$('navLiveSession')?.addEventListener('click', () => currentSession && showScreen('dashboard'));
$('navReports')?.addEventListener('click', () => {
  showScreen('reports');
  loadReports().catch(error => toast(error.message, 'error'));
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
  flagEvidence = [];
  candidateReady = false;
  if (sessionServiceNotice) {
    sessionServiceNotice.hidden = true;
    sessionServiceNotice.textContent = '';
  }
  telemetryState = { connected: true, transcription: 'waiting', monitoring: 'waiting' };
  hasFirstTranscript = false;
  interimBubble = null;
  transcriptList.innerHTML = '<div class="empty-state"><span class="empty-cursor"></span>Waiting for the first reliable transcript segment</div>';
  flagsList.innerHTML = '<div class="empty-state">No active anomalies</div>';
  transcriptCount.textContent = '0';
  flagCount.textContent = '0';
  statsScore.textContent = 'Clear';
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
  scoreTrendEl.textContent = 'Waiting';
  scoreTrendEl.className = 'mm-val mm-trend';
  scoreValue.textContent = 'Clear';
  scoreLabel.textContent = 'Candidate preflight';
  scoreReasoning.textContent = 'Behavioral evidence determines the review band. Transcript patterns remain experimental.';
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
    await renderAuthState(await window.truveil.getAuth());
    const s = await window.truveil.getSettings();
    console.log('[Truveil] settings loaded', !!s);
  } catch (e) {
    console.warn('Settings load failed', e);
  }
})();
