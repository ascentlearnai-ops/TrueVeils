// ─── Truveil Secure — Candidate Renderer ──────────────────────────────
const $ = id => document.getElementById(id);

const screens = {
  setup: $('setup-screen'),
  active: $('active-screen'),
  ended: $('ended-screen')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ─── State ─────────────────────────────────────────────────────────────
let sessionStart = null;
let timerInterval = null;
let eventCount = 0;
let integrity = 100;
let audioStream = null;

const statusPill = $('statusPill');
const statusText = $('statusText');
const toastEl = $('toast');

function setStatus(kind, text) {
  statusPill.classList.remove('active', 'warn');
  if (kind) statusPill.classList.add(kind);
  statusText.textContent = text;
}

function toast(msg, kind = 'info') {
  toastEl.textContent = msg;
  toastEl.className = `toast visible ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('visible'), 3200);
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${ss}`;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Setup ─────────────────────────────────────────────────────────────
const sessionCodeInput = $('sessionCodeInput');
sessionCodeInput.addEventListener('input', (e) => {
  let v = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (v.length > 3 && v.startsWith('TRV') && v[3] !== '-') v = 'TRV-' + v.slice(3);
  e.target.value = v;
});
sessionCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('startBtn').click();
});

$('startBtn').addEventListener('click', startSession);

async function startSession() {
  const code = sessionCodeInput.value.trim();
  const name = $('candidateNameInput').value.trim();

  if (!code) { toast('Enter your session code (TRV-XXXXXX)', 'error'); sessionCodeInput.focus(); return; }
  if (!/^TRV-[A-Z0-9]{6}$/.test(code)) {
    toast('Session code should look like TRV-8FR2XP (10 characters)', 'error');
    sessionCodeInput.focus();
    return;
  }
  if (!name) { toast('Please enter your name', 'error'); $('candidateNameInput').focus(); return; }

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    toast('Microphone permission is required for a verified session.', 'error');
    return;
  }

  const result = await window.truveil.startSession({ sessionCode: code, candidateName: name });
  if (!result.ok) {
    toast(result.error || 'Could not start session', 'error');
    stopAudio();
    return;
  }

  $('displayName').textContent = name;
  $('displayCode').textContent = code;
  setStatus('active', 'Monitoring');

  sessionStart = Date.now();
  startTimer();
  showScreen('active');
}

function stopAudio() {
  if (audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }
}

// ─── Timer ─────────────────────────────────────────────────────────────
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    $('elapsed').textContent = fmtElapsed(Date.now() - sessionStart);
  }, 1000);
}

// ─── Events / flags ────────────────────────────────────────────────────
function logEvent(text, kind = 'warn') {
  const feed = $('flagFeed');
  if (feed.querySelector('.ff-empty')) feed.innerHTML = '';

  eventCount++;
  if (kind === 'warn') integrity = Math.max(0, integrity - 5);
  $('integrity').textContent = integrity + '%';

  const el = document.createElement('div');
  el.className = 'ff-item';
  el.innerHTML = `<span>${text}</span><span class="ff-time">${fmtTime(Date.now())}</span>`;
  feed.prepend(el);
}

window.truveil.onFocusLost(() => {
  if (!sessionStart) return;
  logEvent('You switched away from Truveil Secure');
  setStatus('warn', 'Focus lost');
});
window.truveil.onFocusGained(() => {
  if (!sessionStart) return;
  setStatus('active', 'Monitoring');
});
window.truveil.onShortcutBlocked(() => {
  logEvent('Blocked a close/minimize shortcut');
});

// ─── End session ───────────────────────────────────────────────────────
$('endBtn').addEventListener('click', async () => {
  if (!confirm('End your secure session now? This will tell your recruiter the interview is finished.')) return;
  clearInterval(timerInterval);
  stopAudio();
  await window.truveil.endSession();
  setStatus(null, 'Complete');
  showScreen('ended');
});

$('quitBtn').addEventListener('click', () => {
  window.truveil.quit();
});

// ─── Boot ──────────────────────────────────────────────────────────────
setStatus(null, 'Not started');
setTimeout(() => sessionCodeInput.focus(), 400);
