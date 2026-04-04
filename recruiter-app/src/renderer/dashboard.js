// ——— Screen Management ————————————————————————————————————————
const screens = {
  idle: document.getElementById('idle-screen'),
  waiting: document.getElementById('waiting-screen'),
  dashboard: document.getElementById('dashboard-screen'),
  ended: document.getElementById('ended-screen')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  // Small delay for transition effect
  requestAnimationFrame(() => {
    screens[name].classList.add('active');
  });
}

// ——— State ———————————————————————————————————————————————————
let sessionStartTime = null;
let timerInterval = null;
let currentScore = 0;
let previousScore = 0;
let totalFlags = 0;
let totalResponses = 0;
let hasFirstTranscript = false;

// ——— Elements ————————————————————————————————————————————————
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const candidateLinkEl = document.getElementById('candidateLink');
const sessionIdEl = document.getElementById('sessionId');
const sessionTimerEl = document.getElementById('sessionTimer');
const scoreRing = document.getElementById('scoreRing');
const scoreValue = document.getElementById('scoreValue');
const scoreLabel = document.getElementById('scoreLabel');
const scoreReasoning = document.getElementById('scoreReasoning');
const scoreTrend = document.getElementById('scoreTrend');
const scoreSection = document.getElementById('scoreSection');
const transcriptList = document.getElementById('transcriptList');
const flagsList = document.getElementById('flagsList');
const statsScore = document.getElementById('statsScore');
const statsFlags = document.getElementById('statsFlags');
const statsResponses = document.getElementById('statsResponses');
const flagCount = document.getElementById('flagCount');
const transcriptCount = document.getElementById('transcriptCount');

// ——— New Session ————————————————————————————————————————————
document.getElementById('newSessionBtn').addEventListener('click', startNewSession);
document.getElementById('newSessionBtn2').addEventListener('click', startNewSession);

async function startNewSession() {
  try {
    statusDot.className = 'status-dot';
    statusText.textContent = 'Creating...';
    totalFlags = 0;
    totalResponses = 0;
    currentScore = 0;
    previousScore = 0;

    const session = await window.truveil.createSession({ recruiterId: null });
    candidateLinkEl.textContent = session.candidateLink;
    sessionIdEl.textContent = `SESSION: ${session.sessionId}`;

    statusDot.className = 'status-dot active';
    statusText.textContent = 'Waiting';
    showScreen('waiting');
  } catch (err) {
    console.error('Failed to create session:', err);
    statusText.textContent = 'Error';
  }
}

// ——— Copy Link ——————————————————————————————————————————————
document.getElementById('copyLinkBtn').addEventListener('click', async () => {
  const link = candidateLinkEl.textContent;
  await window.truveil.copyLink(link);
  const btn = document.getElementById('copyLinkBtn');
  btn.textContent = '✓ Copied!';
  btn.classList.add('btn-success');
  btn.classList.remove('btn-primary');
  setTimeout(() => {
    btn.textContent = 'Copy Link';
    btn.classList.remove('btn-success');
    btn.classList.add('btn-primary');
  }, 2000);
});

// ——— Start Audio ————————————————————————————————————————————
document.getElementById('startAnywayBtn').addEventListener('click', startDashboard);

async function startDashboard() {
  await window.truveil.startAudio();
  sessionStartTime = Date.now();
  startTimer();
  showScreen('dashboard');
  statusDot.className = 'status-dot recording';
  statusText.textContent = 'Recording';
}

// ——— Candidate Joined ——————————————————————————————————————
window.truveil.onCandidateJoined(() => {
  startDashboard();
});

// ——— Timer —————————————————————————————————————————————————
function startTimer() {
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - sessionStartTime;
    const h = String(Math.floor(elapsed / 3600000)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    sessionTimerEl.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

// ——— Transcript Updates ——————————————————————————————————————
window.truveil.onTranscript((data) => {
  if (!hasFirstTranscript) {
    transcriptList.innerHTML = '';
    flagsList.innerHTML = '';
    hasFirstTranscript = true;
  }

  totalResponses++;
  transcriptCount.textContent = totalResponses;
  statsResponses.textContent = totalResponses;

  // Update score
  if (data.aiScore != null) {
    previousScore = currentScore;
    currentScore = data.aiScore;
    updateScoreRing(currentScore);
    statsScore.textContent = currentScore + '%';

    // Score trend
    if (previousScore > 0) {
      const diff = currentScore - previousScore;
      if (diff > 5) {
        scoreTrend.textContent = `↑ Rising (+${diff})`;
        scoreTrend.className = 'score-trend rising';
      } else if (diff < -5) {
        scoreTrend.textContent = `↓ Falling (${diff})`;
        scoreTrend.className = 'score-trend falling';
      } else {
        scoreTrend.textContent = '→ Stable';
        scoreTrend.className = 'score-trend';
      }
    }
  }

  // Add transcript entry
  const time = new Date(data.timestamp || Date.now()).toLocaleTimeString();
  const scoreClass = data.aiScore >= 70 ? 'high' : data.aiScore >= 40 ? 'medium' : 'low';

  const entry = document.createElement('div');
  entry.className = 'transcript-entry';
  entry.innerHTML = `
    <div class="entry-header">
      <span class="entry-time">${time}</span>
      <span class="entry-score ${scoreClass}">${data.aiScore ?? '-'}%</span>
    </div>
    <div class="entry-text">${escapeHtml(data.text)}</div>
    ${data.reasoning ? `<div class="entry-reasoning">${escapeHtml(data.reasoning)}</div>` : ''}
  `;
  transcriptList.prepend(entry);

  // Add flags from analysis
  if (data.flags?.length) {
    data.flags.forEach(flag => addFlag(flag, data.timestamp, 'high'));
  }
});

// ——— Flag Updates ————————————————————————————————————————————
window.truveil.onFlag((data) => {
  if (!hasFirstTranscript) {
    flagsList.innerHTML = '';
    hasFirstTranscript = true;
  }
  const severity = data.severity || 'medium';
  addFlag(data.detail || data.type, data.timestamp, severity.toLowerCase());
});

function addFlag(text, timestamp, severity = 'medium') {
  totalFlags++;
  flagCount.textContent = totalFlags;
  statsFlags.textContent = totalFlags;

  const time = new Date(timestamp || Date.now()).toLocaleTimeString();
  const flag = document.createElement('div');
  flag.className = `flag-item ${severity}`;

  const icons = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };
  flag.innerHTML = `
    <span class="flag-icon">${icons[severity] || '⚠'}</span>
    <div>
      <div class="flag-text">${escapeHtml(text)}</div>
      <div class="flag-time">${time}</div>
    </div>
  `;
  flagsList.prepend(flag);
}

// ——— Score Ring ——————————————————————————————————————————————
function updateScoreRing(score) {
  const circumference = 150.8;
  const offset = circumference - (score / 100) * circumference;
  scoreRing.style.strokeDashoffset = offset;

  // Color + section styling
  scoreSection.className = 'score-section';
  if (score >= 70) {
    scoreRing.setAttribute('stroke', '#ff4444');
    scoreLabel.textContent = 'High Risk';
    scoreSection.classList.add('high-risk');
  } else if (score >= 40) {
    scoreRing.setAttribute('stroke', '#ff8800');
    scoreLabel.textContent = 'Medium Risk';
    scoreSection.classList.add('medium-risk');
  } else {
    scoreRing.setAttribute('stroke', '#22cc66');
    scoreLabel.textContent = 'Low Risk';
  }

  scoreValue.textContent = `${score}%`;
  scoreReasoning.textContent = 'Latest AI confidence assessment';
}

// ——— End Session ——————————————————————————————————————————————
document.getElementById('endSessionBtn').addEventListener('click', async () => {
  clearInterval(timerInterval);
  await window.truveil.endSession();
  statusDot.className = 'status-dot';
  statusText.textContent = 'Complete';
  hasFirstTranscript = false;
  showScreen('ended');
});

// ——— Helpers ————————————————————————————————————————————————
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
