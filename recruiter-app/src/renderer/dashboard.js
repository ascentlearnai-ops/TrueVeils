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
let scoreSum = 0;
let scoreCount = 0;
let latestScore = null;
let hasFirstTranscript = false;
let recognition = null;
let recognitionActive = false;
let recognitionShouldRun = false;
let audioSource = 'microphone';
let currentSession = null;
let mediaStream = null;

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
const flagCount = $('flagCount');
const transcriptCount = $('transcriptCount');
const candidateNameInput = $('candidateNameInput');
const roleInput = $('roleInput');
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

document.querySelectorAll('.seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    audioSource = btn.dataset.source;
    $('audioHint').textContent = audioSource === 'system'
      ? 'Captures system audio directly (Zoom, Meet, Teams). You will be asked to share your screen with audio.'
      : 'Captures your microphone. Works anywhere — put your interview audio on speakers.';
  });
});

$('startMonitoringBtn').addEventListener('click', startMonitoring);

async function startMonitoring() {
  const name = candidateNameInput.value.trim() || 'Candidate';
  const role = roleInput.value.trim() || 'Interview';

  // Re-create session with names so main has the metadata for the report
  try {
    currentSession = await window.truveil.createSession({ candidateName: name, role });
  } catch (err) {
    toast('Failed to create session: ' + err.message, 'error');
    return;
  }

  // Obtain audio stream
  try {
    if (audioSource === 'system') {
      mediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const audioTracks = mediaStream.getAudioTracks();
      if (!audioTracks.length) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
        toast('No system audio available — when sharing, check "Share audio". Falling back to microphone.', 'warn');
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        // stop video track, we only need audio
        mediaStream.getVideoTracks().forEach(t => t.stop());
      }
    } else {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  } catch (err) {
    console.error('Audio capture error:', err);
    toast('Microphone permission denied. Cannot start session.', 'error');
    return;
  }

  // Kick off session timer + Web Speech
  await window.truveil.startSession();
  sessionStartTime = Date.now();
  startTimer();

  sessionIdEl.textContent = `SESSION: ${currentSession.sessionId}`;
  glassTitleEl.textContent = `${name} · ${role}`;

  startRecognition();

  statusDot.className = 'status-dot recording';
  statusText.textContent = 'Recording';
  showScreen('dashboard');
}

// ─── Web Speech API wrapper ───────────────────────────────────────────
function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast('Speech recognition not available in this runtime.', 'error');
    return;
  }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognitionShouldRun = true;

  let currentInterimEl = null;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const text = res[0].transcript;
      if (res.isFinal) {
        commitFinalTranscript(text);
      } else {
        interim += text;
      }
    }
    updateInterim(interim);
  };

  recognition.onend = () => {
    recognitionActive = false;
    if (recognitionShouldRun) {
      // auto-restart after natural timeout
      setTimeout(() => {
        try { recognition.start(); recognitionActive = true; }
        catch (e) { /* already started */ }
      }, 250);
    }
  };

  recognition.onerror = (e) => {
    console.warn('[Speech error]', e.error);
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      toast('Microphone access was blocked. Reload and allow mic.', 'error');
      recognitionShouldRun = false;
    }
  };

  try {
    recognition.start();
    recognitionActive = true;
  } catch (e) {
    console.warn(e);
  }
}

function stopRecognition() {
  recognitionShouldRun = false;
  try { recognition && recognition.stop(); } catch {}
  recognitionActive = false;
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
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
  const { aiScore, reasoning, flags, error } = result;
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
  scoreEl.textContent = `${aiScore}%`;
  scoreEl.className = `entry-score ${cls}`;

  if (reasoning) {
    reasoningEl.textContent = reasoning;
    reasoningEl.classList.remove('hidden');
  }

  // Update aggregate
  scoreSum += aiScore;
  scoreCount++;
  const avg = Math.round(scoreSum / scoreCount);
  latestScore = aiScore;
  updateScoreRing(avg, latestScore, reasoning);

  // Add flags
  if (flags && flags.length) {
    flags.forEach(f => addFlag(f, result.timestamp, aiScore >= 70 ? 'high' : 'medium'));
  }
}

function updateScoreRing(avgScore, latest, reasoning) {
  const circumference = 175.9;
  const offset = circumference - (latest / 100) * circumference;
  scoreRing.style.strokeDashoffset = offset;

  // Clear risk classes then reapply
  scoreSection.classList.remove('high-risk', 'medium-risk');
  let color, label;
  if (latest >= 70) {
    color = '#ef4444';
    label = 'High Interference';
    scoreSection.classList.add('high-risk');
  } else if (latest >= 40) {
    color = '#f59e0b';
    label = 'Moderate Signal';
    scoreSection.classList.add('medium-risk');
  } else {
    color = '#22c55e';
    label = 'Low Signal';
  }
  scoreRing.setAttribute('stroke', color);
  scoreValue.textContent = `${latest}%`;
  scoreLabel.textContent = label;
  if (reasoning) scoreReasoning.textContent = reasoning;

  // Metrics
  statsScore.textContent = `${avgScore}%`;
  statsScore.className = 'mm-val ' + (avgScore >= 70 ? 'risk-high' : avgScore >= 40 ? 'risk-med' : 'risk-low');
  scoreTrendEl.textContent = `${latest}%`;
  scoreTrendEl.className = 'mm-val mm-trend ' + (latest >= 70 ? 'rising' : latest < 40 ? 'falling' : '');
}

// ─── Flags ────────────────────────────────────────────────────────────
function addFlag(text, timestamp, severity = 'medium') {
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

  window.truveil.addFlag({ text, severity, timestamp: timestamp || Date.now() });
}

// ─── Timer ────────────────────────────────────────────────────────────
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
  stopRecognition();
  statusDot.className = 'status-dot';
  statusText.textContent = 'Complete';

  const avg = scoreCount ? Math.round(scoreSum / scoreCount) : 0;
  $('endedStats').innerHTML = `
    <div class="es-item"><span>${avg}%</span>Avg Risk</div>
    <div class="es-item"><span>${totalResponses}</span>Responses</div>
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
  scoreSum = 0;
  scoreCount = 0;
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
