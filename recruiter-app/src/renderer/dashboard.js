// ─── Truveil Command Center — Renderer ──────────────────────────────────

const $ = id => document.getElementById(id);
const sessionPresentation = window.TruveilSession;

const screens = {
  access: $('access-screen'),
  auth: $('auth-screen'),
  idle: $('idle-screen'),
  setup: $('setup-screen'),
  dashboard: $('dashboard-screen'),
  reports: $('reports-screen'),
  ended: $('ended-screen')
};

function showScreen(name) {
  document.body.dataset.screen = name;
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  document.querySelector('.skip-link')?.setAttribute('href', '#' + screens[name].id);
  screens[name].setAttribute('tabindex', '-1');
  document.querySelectorAll('.workspace-nav-btn').forEach(button => {
    button.classList.remove('active');
    button.removeAttribute('aria-current');
  });
  const active = $(name === 'reports' ? 'navReports' : name === 'dashboard' || name === 'setup' ? 'navLiveSession' : 'navNewSession');
  active?.classList.add('active');
  active?.setAttribute('aria-current', 'page');
  $('navLiveSession').disabled = !signedIn || !currentSession;
  $('navNewSession').disabled = !signedIn;
  $('navReports').disabled = !signedIn;
  updateRecruiterGuide();
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
let creatingSession = false;
let startingSession = false;
let endingSession = false;
let signedIn = false;
let demoMode = false;
let pendingDemoJoin = null;
let invitationCopied = false;
let reportNeedsRetry = false;
let reportSaved = false;
let guideConnectionLost = false;
let sharedTabGeneration = 0;
let sharedBrowserView = { connected: false, closeConsent: false };
const sharedTabRows = new Map();
const sharedTabRequests = new Map();
let sharedTabEmpty = null;

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
const candidateEmailInput = $('candidateEmailInput');
const candidateInviteMessage = $('candidateInviteMessage');
const inviteLinkPreview = $('inviteLinkPreview');
const inviteLinkState = $('inviteLinkState');
const customBlockedSitesInput = $('customBlockedSitesInput');
const customBlockedSitesChips = $('customBlockedSitesChips');
const customBlockedSiteDraft = $('customBlockedSiteDraft');
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
const recruiterConfirmationInputs = [
  $('noticeConfirmedInput'),
  $('policyConfirmedInput'),
  $('humanReviewConfirmedInput')
].filter(Boolean);

// ─── Utility ───────────────────────────────────────────────────────────
function updateRecruiterGuide() {
  const screen = document.body.dataset.screen;
  const guide = $('recruiterGuide');
  const slot = document.querySelector(`[data-guide-slot="${screen}"]`);
  if (!guide || !slot) return;
  if (guide.parentElement !== slot) slot.appendChild(guide);
  let text = '';
  if (screen === 'access') text = $('demoAccessMessage').textContent
    ? 'Check your access code and connection address below, then try again. Keep your private code to yourself.'
    : "Enter your private access code here. Keep it separate from the candidate's code.";
  if (screen === 'idle') text = 'Choose New interview. You will get an invitation to send to your candidate.';
  if (screen === 'setup') {
    if (startingSession) text = 'Starting the interview. Keep your usual calling app open.';
    else if (pendingDemoJoin) text = 'Check the candidate\'s name below, then choose Approve candidate if it is the person you invited.';
    else if (guideConnectionLost) text = 'The candidate disconnected. Check the connection and contact them before continuing.';
    else if (candidateReady) text = 'Your candidate is ready. Review the three checks below, then choose Start interview.';
    else text = invitationCopied
      ? 'Send the invitation you copied. Their name will appear here for approval; copying does not send it.'
      : 'Choose Copy invitation and send it to your candidate. The link carries their code and connection address.';
  }
  if (screen === 'dashboard') text = reportNeedsRetry
    ? 'The report was not saved. Keep this window open and retry saving the report.'
    : endingSession ? 'Finishing the interview and saving its report. Keep this window open.'
      : guideConnectionLost ? 'The session connection needs attention. Check its status before continuing.'
        : 'Use your usual calling app. Captions appear here; browser sharing is optional and needs the candidate\'s permission.';
  if (screen === 'reports') text = 'Open a saved report to review the transcript and events. The decision stays yours.';
  if (screen === 'ended') text = reportSaved
    ? 'Your report is saved. Open Reports in the sidebar to review the conversation.'
    : 'The interview has ended. No report was generated for this session.';
  const body = $('recruiterGuideBody');
  if (body.textContent !== text) body.textContent = text;
  const image = $('recruiterGuideImage');
  const src = `../../assets/app-ui/tavi-${screen === 'dashboard' ? 'listen' : screen === 'ended' && reportSaved ? 'celebrate' : 'checklist'}.webp`;
  if (image.getAttribute('src') !== src) image.setAttribute('src', src);
}

function toast(msg, variant = 'info') {
  toastEl.textContent = sessionPresentation.message(msg);
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
function buildCandidateInviteMessage() {
  const code = sessionPresentation.displayCode(currentSession?.sessionId || '');
  const link = candidateInviteLink();
  const candidateName = candidateNameInput.value.trim();
  const role = roleInput.value.trim();
  const greeting = candidateName ? `Hi ${candidateName},` : 'Hi,';
  if (!link) {
    return {
      code: '',
      link: '',
      subject: 'Your Truveil interview code',
      body: 'Create a session to generate the candidate invite message.'
    };
  }
  if (currentSession.demo) return {
    code, link, subject: 'Your Truveil interview invitation',
    body: `${greeting}\n\nJoin your interview in Truveil Secure:\n${link}\n\n1. Open the link and enter your name.\n2. Review permissions, then choose Join interview.\n3. Wait for your interviewer to approve and start.\n\nIf the link will not open, enter these in Truveil Secure:\nRoom code: ${code}\nSession server: ${sessionPresentation.serverAddress(currentSession.relayUrl)}\n\nUse your usual calling app and keep Truveil Secure open. No account is needed. Browser sharing is optional. Interview reports stay on the interviewer's computer.`
  };
  const roleLine = role ? `This is for your ${role} interview.` : 'This is for your upcoming interview.';
  return {
    code,
    link,
    subject: `Your Truveil interview code: ${code}`,
    body: [
      greeting,
      '',
      `${roleLine} Please install/open Truveil Secure and join with this code: ${code}`,
      '',
      `Open Truveil Secure here: ${link}`,
      '',
      'Before the call, enter the code, review the session notice, allow microphone access, and keep Truveil Secure open while the interview runs.',
      '',
      'Truveil Secure may share live transcript text, foreground app/window details, browser host/URL when Windows exposes it, and restricted-target events with the interviewer. It does not use camera, screen recording, file access, clipboard access, or stored raw audio.',
      '',
      'Thanks.'
    ].join('\n')
  };
}

function recruiterConfirmationReady() {
  return recruiterConfirmationInputs.length === 0 || recruiterConfirmationInputs.every(input => input.checked);
}

function resetRecruiterConfirmations() {
  recruiterConfirmationInputs.forEach(input => { input.checked = false; });
}
function refreshCandidateInvite() {
  if (!candidateInviteMessage || !inviteLinkPreview || !inviteLinkState) return;
  const invite = buildCandidateInviteMessage();
  candidateInviteMessage.value = invite.body;
  inviteLinkPreview.textContent = invite.link || 'Your candidate invite link will appear here.';
  inviteLinkState.textContent = invite.link ? `Ready: ${invite.code}` : 'Create a session first';
}
function normalizePolicyInput(value, type = 'text') {
  let clean = String(value || '').trim();
  if (!clean) return '';
  if (type === 'site') {
    clean = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim();
  }
  return clean;
}
function setTextareaList(textarea, items) {
  textarea.value = Array.from(new Set(items.map(item => String(item).trim()).filter(Boolean))).join('\n');
}
function renderPolicyList(textarea, container, type = 'text') {
  if (!textarea || !container) return;
  const items = listFromTextarea(textarea.value).map(item => normalizePolicyInput(item, type)).filter(Boolean);
  setTextareaList(textarea, items);
  container.innerHTML = items.length
    ? items.map((item) => `
        <button class="policy-chip" type="button" data-policy-remove="${esc(item)}">
          <span>${esc(item)}</span>
          <strong aria-hidden="true">x</strong>
        </button>`).join('')
    : '<span class="policy-empty">None added</span>';
}
function renderPolicyControls() {
  renderPolicyList(customBlockedSitesInput, customBlockedSitesChips, 'site');
}
function addPolicyItem(textarea, draft, container, type = 'text') {
  const value = normalizePolicyInput(draft.value, type);
  if (!value) return;
  if (demoMode && type === 'site' && !isBrowserDestination(value)) {
    toast('Enter a website domain, such as example.com. Other apps are not monitored in this session.', 'error');
    draft.focus();
    return;
  }
  setTextareaList(textarea, [...listFromTextarea(textarea.value), value]);
  draft.value = '';
  renderPolicyList(textarea, container, type);
}
function removePolicyItem(textarea, value, container, type = 'text') {
  const needle = normalizePolicyInput(value, type).toLowerCase();
  setTextareaList(textarea, listFromTextarea(textarea.value).filter(item => normalizePolicyInput(item, type).toLowerCase() !== needle));
  renderPolicyList(textarea, container, type);
}
function getBlockedSites() {
  const checked = Array.from(document.querySelectorAll('[data-blocked-site]'))
    .filter(input => input.checked === true)
    .map(input => input.getAttribute('data-blocked-site'))
    .filter(Boolean);
  return Array.from(new Set([...checked, ...listFromTextarea(customBlockedSitesInput.value)]))
    .filter(rule => !demoMode || isBrowserDestination(rule));
}
function isBrowserDestination(value) {
  return typeof value === 'string' && value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}
function getAllowedPolicy() {
  const enabled = $('restrictionsEnabledInput').checked === true;
  return {
    allowed_apps: [],
    allowed_sites: [],
    blocked_sites: enabled ? getBlockedSites() : [],
    blocking_mode: enabled ? (demoMode ? 'observe' : 'warn_refocus') : 'none'
  };
}

async function renderAuthState(state = {}) {
  if (demoMode) return;
  signedIn = Boolean(state.signedIn);
  authUser.hidden = !signedIn;
  authUser.textContent = state.user?.email || '';
  signOutBtn.hidden = !signedIn;
  showScreen(signedIn ? 'idle' : 'auth');
  if (state.configured === false) authMessage.textContent = 'This build is missing its server configuration. Use the product preview while setup is completed.';
  $('noticeConfirmedText').textContent = 'Candidate notice covers microphone transcription, foreground app/window monitoring, restricted-target controls, and report retention.';
  $('transcriptRelayNote').textContent = 'Candidate speech appears in the live dashboard. Backup recordings, when needed, are temporary and deleted after transcription.';
}

async function signInWithPassword() {
  const button = $('signInPasswordBtn');
  if (button.disabled) return;
  button.disabled = true;
  authMessage.textContent = 'Signing in...';
  try {
    await renderAuthState(await window.truveil.signInWithPassword({ email: authEmailInput.value, password: $('authPasswordInput').value }));
    authMessage.textContent = 'Signed in.';
  } catch (error) {
    authMessage.textContent = error.message || 'Could not sign in.';
  } finally {
    $('authPasswordInput').value = '';
    button.disabled = false;
  }
}
$('signInPasswordBtn').addEventListener('click', signInWithPassword);
$('authPasswordInput').addEventListener('keydown', event => { if (event.key === 'Enter') signInWithPassword(); });

$('sendSignInLinkBtn').addEventListener('click', async () => {
  const button = $('sendSignInLinkBtn');
  button.disabled = true;
  authMessage.textContent = 'Sending secure sign-in link...';
  try {
    await window.truveil.sendSignInLink(authEmailInput.value);
    authMessage.textContent = 'For a supported beta account, check your email and enter the sign-in code. Public email delivery is not yet enabled.';
  } catch (err) {
    const message = String(err.message || '');
    authMessage.textContent = message.includes('rate limit')
      ? 'Email sign-in is rate-limited. Use your provisioned account password or try again later.'
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

$('continueOfflineBtn')?.addEventListener('click', async () => {
  try { await window.truveil.openExternal('https://truveil-recruiter.vercel.app/demo.html'); }
  catch (error) { authMessage.textContent = error.message; }
});

signOutBtn.addEventListener('click', async () => {
  try { await renderAuthState(await window.truveil.signOut()); }
  catch (error) { toast(error.message, 'error'); }
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
    if (flag.policyDecision === 'allowed' || flag.reviewStatus === 'allowed') continue;
    const text = flagEvidenceText(flag);
    const severity = String(flag.severity || '').toLowerCase();
    if (severity === 'critical') criticalHits++;
    if (/\b(chatgpt(?:\.com)?|claude(?:\.ai)?|gemini(?:\.google\.com)?|copilot(?:\.microsoft\.com)?|perplexity(?:\.ai)?|poe(?:\.com)?|you\.com|phind(?:\.com)?|interviewcoder|interview coder|cluely|finalround|lockedin|parakeet|leetcode wizard|ultracode|interview copilot)\b/.test(text)) aiToolHits++;
    if (flag.eventType === 'overlay_detected' || /\b(hidden overlay|overlay detected|exclude.?from.?capture)\b/.test(text)) overlayHits++;
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
  const restrictedAi = flagEvidence.filter(flag => {
    const text = flagEvidenceText(flag);
    return /(chatgpt(?:\.com)?|claude(?:\.ai)?|gemini(?:\.google\.com)?|copilot(?:\.microsoft\.com)?|perplexity(?:\.ai)?|interviewcoder|cluely|lockedin|finalround)/i.test(text)
      && flag.reviewStatus !== 'allowed'
      && flag.policyDecision !== 'allowed';
  });
  const exactAi = restrictedAi.some(flag => flag.detectionSource === 'url' || flag.closedRestrictedTarget || flag.eventType === 'overlay_detected');
  const possibleAi = restrictedAi.length > 0;
  const switches = flagEvidence.filter(flag => flag.eventType === 'focus_lost' || flag.eventType === 'foreground_changed').length;
  if (exactAi || restrictedAi.length >= 1) {
    const target = restrictedAi[0]?.detectedHost || restrictedAi[0]?.matchedRule || restrictedAi[0]?.windowTitle || 'a restricted AI destination';
    return { key: 'high_priority_review', label: 'High-priority review', reason: `${target} was detected during the session. Behavioral evidence overrides transcript-only pattern notes.` };
  }
  if (possibleAi || switches >= 4) return { key: 'review', label: 'Review', reason: 'One or more monitored events should be reviewed with interview context.' };
  if (telemetryState.connected === false || telemetryState.transcription === 'unavailable') return { key: 'incomplete_evidence', label: 'Incomplete evidence', reason: 'Telemetry was incomplete during this session.' };
  return { key: 'clear', label: 'Clear', reason: 'No meaningful integrity evidence has been recorded.' };
}

function liveVerdictEstimate() {
  const band = currentReviewBand();
  const floor = band.key === 'high_priority_review' ? 80 : band.key === 'review' ? 55 : 0;
  const score = Math.max(currentTranscriptAverage(), floor);
  const windows = scoreCount;
  if (!windows && !floor) {
    return { label: 'Insufficient evidence', cls: '', meta: 'Verdict estimate builds as scored responses arrive' };
  }
  const confidence = floor >= 80
    ? (windows >= 3 ? 'high' : 'medium')
    : windows < 3 ? 'low' : windows < 6 ? 'medium' : 'high';
  const label = score >= 70 ? 'Likely AI-assisted'
    : score <= 35 && windows >= 3 ? 'Likely unassisted'
      : 'Uncertain — needs review';
  const cls = score >= 70 ? 'high' : label === 'Likely unassisted' ? 'low' : 'med';
  return { label, cls, meta: `Confidence ${confidence} · ${windows} scored window${windows === 1 ? '' : 's'} · advisory only` };
}

function refreshVerdictStrip() {
  const chip = $('verdictChip');
  const meta = $('verdictMeta');
  if (!chip || !meta) return;
  const verdict = liveVerdictEstimate();
  chip.textContent = verdict.label;
  chip.className = `verdict-chip ${verdict.cls}`;
  meta.textContent = verdict.meta;
}

function refreshOverallRiskMetric() {
  refreshVerdictStrip();
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
function showDemoAccess(message = '') {
  signedIn = false;
  authUser.hidden = true;
  $('demoAccessMessage').textContent = sessionPresentation.message(message);
  showScreen('access');
  $('demoHostCodeInput').focus();
}

$('demoAccessForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!demoMode || currentSession || creatingSession) return;
  if (!$('demoHostCodeInput').value.trim()) return showDemoAccess('Enter your host access code.');
  if (!$('demoRelayInput').value.trim()) {
    $('demoConnectionSettings').open = true;
    showDemoAccess('Enter the session server address in Connection settings.');
    $('demoRelayInput').focus();
    return;
  }
  // This only prepares the workspace. The relay authorizes room creation below.
  signedIn = true;
  authUser.hidden = false;
  authUser.textContent = 'Interview workspace';
  $('demoAccessMessage').textContent = '';
  showScreen('idle');
  $('newSessionBtn').focus();
});

$('newSessionBtn').addEventListener('click', onNewSession);
$('newSessionBtn2').addEventListener('click', onNewSession);

async function onNewSession() {
  if (creatingSession) return;
  if (currentSession) return showScreen(sessionStartTime ? 'dashboard' : 'setup');
  if (demoMode && (!signedIn || !$('demoHostCodeInput').value.trim())) return showDemoAccess();
  creatingSession = true;
  resetState();
  try {
    statusDot.className = 'status-dot active';
    statusText.textContent = 'Configuring';
    // Only a server-backed invitation can be shared with a candidate.
    const create = demoMode ? window.truveil.createDemo : window.truveil.createSession;
    const hostAccessCode = $('demoHostCodeInput').value.trim();
    $('demoHostCodeInput').value = '';
    currentSession = await create({
      hostAccessCode,
      relayUrl: $('demoRelayInput')?.value.trim(),
      candidateName: '',
      role: '',
      technicalVocabulary: [],
      policyPreset: 'custom',
      policy: { allowed_apps: [], allowed_sites: [], blocked_sites: [], blocking_mode: 'none' }
    });
    sessionCodeEl.textContent = sessionPresentation.displayCode(currentSession.sessionId);
      toast(`Candidate code created: ${sessionPresentation.displayCode(currentSession.sessionId)}`, 'success');
      $('candidateReadyState').innerHTML = '<i></i> Candidate preflight pending';
      sessionServiceNotice.hidden = true;
      sessionServiceNotice.textContent = '';
    if (currentSession.demo) {
      $('openCandidateLinkBtn').disabled = true;
      $('openCandidateLinkBtn').hidden = true;
      $('demoApproval').hidden = true;
    } else {
      $('openCandidateLinkBtn').disabled = false;
      $('openCandidateLinkBtn').hidden = false;
    }
    candidateNameInput.value = '';
    roleInput.value = '';
    customBlockedSitesInput.value = '';
    candidateEmailInput.value = '';
    technicalVocabularyInput.value = '';
    policyPresetSelect.value = 'custom';
    $('restrictionsEnabledInput').checked = false;
    renderRestrictionState();
    resetRecruiterConfirmations();
    renderPolicyControls();
    refreshCandidateInvite();
      candidateReady = false;
      startMonitoringBtn.disabled = true;
      startMonitoringBtn.innerHTML = '<span class="dots-pulse"><span></span><span></span><span></span></span> Waiting for candidate preflight';
    document.querySelectorAll('[data-blocked-site]').forEach(input => {
      input.checked = false;
    });
    showScreen('setup');
    setTimeout(() => candidateNameInput.focus(), 300);
  } catch (err) {
    console.error(err);
    toast('Failed to create session: ' + err.message, 'error');
    statusDot.className = 'status-dot';
    statusText.textContent = 'Not connected';
    if (demoMode) showDemoAccess('Could not create the interview: ' + err.message);
  } finally {
    creatingSession = false;
  }
}

// ─── Setup Screen ──────────────────────────────────────────────────────
$('cancelSetupBtn').addEventListener('click', async () => {
  const button = $('cancelSetupBtn');
  button.disabled = true;
  try {
    await window.truveil.cancelSession();
    currentSession = null;
    candidateReady = false;
    statusDot.className = 'status-dot';
    statusText.textContent = 'Idle';
    showScreen('idle');
  } catch (error) {
    toast('Could not cancel the invitation: ' + error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('startMonitoringBtn').addEventListener('click', startMonitoring);

async function startMonitoring() {
  if (startingSession) return;
  if (!candidateReady) {
    toast('Wait for the candidate to complete consent and microphone preflight.', 'error');
    return;
  }
  if (!recruiterConfirmationReady()) {
    toast('Confirm candidate notice, session policy, and human-review use before starting.', 'error');
    recruiterConfirmationInputs.find(input => !input.checked)?.focus();
    return;
  }
  const name = candidateNameInput.value.trim() || 'Candidate';
  const role = roleInput.value.trim() || 'Interview';

  startingSession = true;
  updateRecruiterGuide();
  startMonitoringBtn.disabled = true;
  $('cancelSetupBtn').disabled = true;
  try {
    currentSession = await window.truveil.updateSession({
      candidateName: name,
      role,
      policy: getAllowedPolicy(),
      technicalVocabulary: listFromTextarea(technicalVocabularyInput.value),
      policyPreset: policyPresetSelect.value
    });
  // Kick off session timer. Candidate audio/transcript arrives over Supabase Realtime.
  const started = await window.truveil.startSession();
  sessionStartTime = started.startedAt;
  startTimer();

  sessionIdEl.textContent = `SESSION: ${sessionPresentation.displayCode(currentSession.sessionId)}`;
  glassTitleEl.textContent = `${name} / ${role}`;

  statusDot.className = 'status-dot active';
  statusText.textContent = started.deliveryPending ? 'Interview active; awaiting candidate sync' : 'Interview active';
  showScreen('dashboard');
  } catch (err) {
    toast('Could not start the interview: ' + err.message, 'error');
  } finally {
    startingSession = false;
    updateRecruiterGuide();
    startMonitoringBtn.disabled = !candidateReady;
    $('cancelSetupBtn').disabled = false;
  }
}

function candidateInviteLink() {
  if (!currentSession) return '';
  const code = String(currentSession.sessionId || '');
  if (currentSession.demo) {
    if (!/^DEMO-[A-Z2-7]{16}$/.test(code) || typeof currentSession.relayUrl !== 'string' || !currentSession.relayUrl) return '';
    // Main issues this exact link; do not share a different room, relay or extra parameters.
    try {
      const link = sessionPresentation.invitation(code, currentSession.relayUrl);
      return currentSession.candidateLink === link ? link : '';
    } catch { return ''; }
  }
  if (!/^TRV-[A-Z0-9]{6}$/i.test(code)) return '';
  return currentSession.candidateLink || `https://truveil-secure.vercel.app/?code=${encodeURIComponent(code)}&open=1`;
}

$('copySessionCodeBtn')?.addEventListener('click', async () => {
  if (!candidateInviteLink()) {
    toast('Create a session first, then copy the candidate code.', 'error');
    return;
  }
  const code = sessionPresentation.displayCode(currentSession.sessionId);
  await window.truveil.copyLink(code);
  toast(`Copied ${code}. Candidate can paste it in Truveil Secure.`, 'success');
});

$('copyCandidateLinkBtn')?.addEventListener('click', async () => {
  const link = candidateInviteLink();
  if (!link) {
    toast('Create a session first, then copy the invite link.', 'error');
    return;
  }
  await window.truveil.copyLink(link);
  toast('Copied candidate invite link.', 'success');
});

function ensureInviteReady(actionLabel = 'use the invite') {
  const invite = buildCandidateInviteMessage();
  if (!invite.link) {
    toast(`Create a session first, then ${actionLabel}.`, 'error');
    return null;
  }
  refreshCandidateInvite();
  return invite;
}

$('copyInviteMessageBtn')?.addEventListener('click', async () => {
  const invite = ensureInviteReady('copy the invite message');
  if (!invite) return;
  try {
    await window.truveil.copyLink(invite.body);
    invitationCopied = true;
    updateRecruiterGuide();
    toast('Invitation copied. Send it to your candidate.', 'success');
  } catch {
    toast('Could not copy the invitation. Use Preview full candidate message to select it.', 'error');
  }
});

$('openCandidateLinkBtn')?.addEventListener('click', async () => {
  if (currentSession?.demo) return;
  const invite = ensureInviteReady('open the invite link');
  if (!invite) return;
  await window.truveil.openExternal(invite.link);
  toast('Opened candidate invite link.', 'success');
});

$('refreshInviteMessageBtn')?.addEventListener('click', () => {
  refreshCandidateInvite();
  toast('Invite message refreshed.', 'success');
});

$('emailCandidateLinkBtn')?.addEventListener('click', async () => {
  const invite = ensureInviteReady('email the invite');
  if (!invite) return;
  const email = candidateEmailInput.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    toast('Enter the candidate email first.', 'error');
    candidateEmailInput.focus();
    return;
  }
  const subject = encodeURIComponent(invite.subject);
  const body = encodeURIComponent(invite.body);
  await window.truveil.openExternal(`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`);
  toast('Opened your email app with the candidate invite.', 'success');
});

[candidateNameInput, roleInput].forEach(input => {
  input?.addEventListener('input', refreshCandidateInvite);
});

$('addCustomBlockedSiteBtn')?.addEventListener('click', () => addPolicyItem(customBlockedSitesInput, customBlockedSiteDraft, customBlockedSitesChips, 'site'));

[
  [customBlockedSiteDraft, customBlockedSitesInput, customBlockedSitesChips, 'site']
].forEach(([draft, textarea, container, type]) => {
  draft?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addPolicyItem(textarea, draft, container, type);
  });
});

[
  [customBlockedSitesChips, customBlockedSitesInput, 'site']
].forEach(([container, textarea, type]) => {
  container?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-policy-remove]');
    if (!chip) return;
    removePolicyItem(textarea, chip.getAttribute('data-policy-remove'), container, type);
  });
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
  renderPolicyControls();
});

// ─── Interim / final transcript ───────────────────────────────────────
function renderRestrictionState() {
  const enabled = $('restrictionsEnabledInput').checked === true;
  $('restrictionControls').hidden = !enabled;
  $('restrictionState').textContent = enabled ? 'Only selected destinations are restricted. All others remain allowed.' : 'All apps and websites allowed.';
}
$('restrictionsEnabledInput').addEventListener('change', renderRestrictionState);

let interimBubble = null;
const captionEntries = new Map();
let captionStream = { id: null, order: 0, epoch: 0, revision: 0, legacyTime: -1 };

function compareCaptionEntries(a, b) {
  if ((a.captionStreamId || null) === (b.captionStreamId || null)) {
    return (a.streamEpoch || 0) - (b.streamEpoch || 0)
      || (a.sequence != null && b.sequence != null ? a.sequence - b.sequence : 0)
      || (a.startedAt ?? a.timestamp ?? 0) - (b.startedAt ?? b.timestamp ?? 0)
      || (a.captionOrder || 0) - (b.captionOrder || 0);
  }
  return (a.captionStreamOrder || 0) - (b.captionStreamOrder || 0) || (a.captionOrder || 0) - (b.captionOrder || 0);
}

function renderRealtimeCaption(entry = {}) {
  if (!currentSession || (!sessionStartTime && !startingSession) || (entry.sessionId && entry.sessionId !== currentSession.sessionId)) return;
  const modern = Boolean(entry.captionStreamId);
  if (modern) {
    const order = entry.captionStreamOrder || 1;
    if (order > captionStream.order) {
      updateInterim('');
      captionStream = { id: entry.captionStreamId, order, epoch: 0, revision: 0, legacyTime: captionStream.legacyTime };
    }
    const current = captionStream.id === entry.captionStreamId;
    if (entry.interim && (!current || entry.streamEpoch < captionStream.epoch || entry.revision <= captionStream.revision)) return;
    if (current) {
      if (entry.captionCanClear !== false && entry.streamEpoch >= captionStream.epoch && entry.revision >= captionStream.revision) updateInterim('');
      captionStream.epoch = Math.max(captionStream.epoch, entry.streamEpoch || 0);
      captionStream.revision = Math.max(captionStream.revision, entry.revision || 0);
    }
  } else {
    const time = entry.timestamp || 0;
    if (entry.interim && (captionStream.id || time <= captionStream.legacyTime)) return;
    if (!captionStream.id && entry.captionCanClear !== false && time >= captionStream.legacyTime) updateInterim('');
    captionStream.legacyTime = Math.max(captionStream.legacyTime, time);
  }
  if (entry.interim) {
    updateInterim(entry.captionClear ? '' : entry.text || '');
    return;
  }
  if (!entry.text) return;
  const key = entry.captionKey || JSON.stringify([entry.source, entry.segmentId, entry.timestamp, entry.text]);
  if (captionEntries.has(key)) return captionEntries.get(key);
  if (!hasFirstTranscript) {
    transcriptList.innerHTML = '';
    hasFirstTranscript = true;
  }
  const element = document.createElement('div');
  element.className = 'transcript-entry';
  element.innerHTML = `
    <div class="entry-header">
      <span class="entry-time">${fmtTime(entry.timestamp || Date.now())}</span>
      <span class="entry-score pending">Pattern review pending</span>
    </div>
    <div class="entry-text"></div>
    <div class="entry-reasoning hidden"></div>`;
  element.querySelector('.entry-text').textContent = entry.text;
  // Both timestamps are local to this recruiter PC, not a cross-device latency claim.
  if (Number.isFinite(entry.captionReceivedAt)) element.dataset.captionRenderDelayMs = String(Math.max(0, Date.now() - entry.captionReceivedAt));
  element.captionSortEntry = entry;
  const before = Array.from(transcriptList.querySelectorAll('.transcript-entry:not(.interim)'))
    .find(existing => compareCaptionEntries(entry, existing.captionSortEntry || {}) > 0);
  transcriptList.insertBefore(element, before || null);
  const record = { element, entry, analyzed: false };
  captionEntries.set(key, record);
  totalResponses++;
  totalTranscriptSignals++;
  transcriptCount.textContent = totalResponses;
  statsResponses.textContent = totalResponses;
  if (audioCount) audioCount.textContent = totalTranscriptSignals;
  if (statsAudio) statsAudio.textContent = totalTranscriptSignals;
  return record;
}

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
  const { aiScore, reasoning, flags, error, displayLabel, aiSignals = [], humanSignals = [], topContributors = [], source, scorable, scoreWeight } = result;
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
    const signalChips = [
      ...aiSignals.slice(0, 3).map(label => ({ label, kind: 'ai' })),
      ...humanSignals.slice(0, 2).map(label => ({ label, kind: 'human' }))
    ];
    const contributorText = topContributors.length
      ? `<div class="entry-contributors">${topContributors.map(item => `${esc(item.kind)} ${esc(item.contribution)} ${esc(item.label)}`).join(' / ')}</div>`
      : '';
    reasoningEl.innerHTML = `
      <div>${esc(evidence)}. ${esc(sourceText)}.</div>
      ${signalChips.length ? `<div class="entry-signal-stack">${signalChips.map(item => `<span class="signal-chip ${item.kind}">${esc(item.label)}</span>`).join('')}</div>` : ''}
      ${contributorText}`;
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
  const controls = hasTarget && !demoMode ? `
    <div class="flag-actions">
      <button data-candidate-action="allow_target">Allow this site</button>
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
  if (!currentSession || (!sessionStartTime && !startingSession) || (result.sessionId && result.sessionId !== currentSession.sessionId)) return;
  const key = result.captionKey || JSON.stringify([result.source, result.segmentId, result.timestamp, result.text]);
  // An analysis update never touches the live draft or increments counters again.
  const record = captionEntries.get(key) || renderRealtimeCaption(result);
  if (!record || record.analyzed || result.analysisPending) return;
  record.analyzed = true;
  renderAnalysis(record.element, result);
}

function renderChunkReview(snapshot = {}) {
  if (!currentSession || snapshot.sessionId !== currentSession.sessionId) return;
  const list = $('chunkReviewList');
  const summary = snapshot.summary || {};
  const chunks = Array.isArray(snapshot.chunks) ? snapshot.chunks : [];
  $('chunkReviewCount').textContent = `${chunks.length} chunks`;
  $('chunkReviewSummary').textContent = summary.summaryText || 'Waiting for enough reliable speech.';
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  const rows = chunks.slice(-200).map((chunk, index) => {
    const row = document.createElement('div');
    row.className = 'chunk-review-entry';
    row.setAttribute('role', 'listitem');
    const header = document.createElement('div');
    header.className = 'chunk-review-header';
    const label = document.createElement('span');
    label.textContent = `Chunk ${Math.max(0, chunks.length - 200) + index + 1} · ${chunk.wordCount} words`;
    const badge = document.createElement('span');
    badge.className = 'chunk-review-score';
    const assessment = chunk.assessment || {};
    const scorable = assessment.scorable === true && Number.isFinite(assessment.score);
    badge.textContent = scorable ? `${Math.round(assessment.score)}/100 pattern score`
      : assessment.contextWords > 0 ? 'Collecting reliable context' : 'Not scored';
    badge.title = 'Nearby chunks can share the same longer-context score. This is not an AI-authorship probability.';
    if (scorable) badge.dataset.band = assessment.score >= 70 ? 'high' : assessment.score >= 40 ? 'medium' : 'low';
    header.append(label, badge);
    const text = document.createElement('p');
    text.className = 'chunk-review-text'; text.textContent = chunk.text;
    const detail = document.createElement('p');
    detail.className = 'chunk-review-detail';
    const signal = assessment.aiSignals?.[0] || 'No strong AI-style pattern';
    const counter = assessment.humanSignals?.[0];
    detail.textContent = scorable
      ? `${assessment.contextWords}-word context · ${signal}${counter ? ` · Counter-signal: ${counter}` : ''}`
      : assessment.reasoning || 'At least 35 reliable words are required. This is not a zero score.';
    detail.title = assessment.reasoning || '';
    row.append(header, text, detail);
    return row;
  });
  list.replaceChildren(...rows);
  if (atBottom) list.scrollTop = list.scrollHeight;
}

window.truveil.onChunkReview?.(renderChunkReview);

window.truveil.onRealtimeCaption?.((entry) => {
  statusDot.className = 'status-dot recording';
  statusText.textContent = entry?.interim ? 'Listening live' : 'Transcript live';
  telemetryState.transcription = 'healthy';
  renderRealtimeCaption(entry);
});

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
    renderRealtimeCaption({ ...entry, interim: true });
  });
}

window.truveil.onRealtimeFlag((flag) => {
  addFlag(flag.text, flag.timestamp, flag.severity || 'medium', false, flag);
  if (demoMode && ['browser_tab_created', 'browser_tab_navigated'].includes(flag.eventType)) toast(flag.text, 'info');
});

window.truveil.onRealtimeStatus((status) => {
  if (status?.text) statusText.textContent = sessionPresentation.message(status.text);
  if (status?.candidateReady) {
    candidateReady = true;
    // Current guidance can recover without erasing the session's evidence gap.
    guideConnectionLost = false;
    $('candidateReadyState').innerHTML = '<i></i> Candidate ready';
    startMonitoringBtn.disabled = false;
    startMonitoringBtn.textContent = 'Start interview';
    toast('Candidate completed consent and microphone preflight.', 'success');
  } else if (status?.candidateReady === false) {
    if (demoMode) { pendingDemoJoin = null; $('demoApproval').hidden = true; }
    candidateReady = false;
    guideConnectionLost = true;
    telemetryState.connected = false;
    startMonitoringBtn.disabled = true;
    startMonitoringBtn.textContent = 'Waiting for candidate preflight';
    $('candidateReadyState').textContent = status.text || 'Candidate disconnected';
  }
  updateRecruiterGuide();
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
  if (endingSession) return;
  endingSession = true;
  updateRecruiterGuide();
  $('endSessionBtn').disabled = true;
  clearInterval(timerInterval);
  statusDot.className = 'status-dot';
  statusText.textContent = 'Complete';

  const band = currentReviewBand();
  const verdict = liveVerdictEstimate();
  $('endedStats').innerHTML = `
    <div class="es-item"><span>${verdict.label}</span>Session verdict</div>
    <div class="es-item"><span>${band.label}</span>Review band</div>
    <div class="es-item"><span>${totalResponses}</span>Responses</div>
    <div class="es-item"><span>${totalTranscriptSignals}</span>Text Signals</div>
    <div class="es-item"><span>${totalFlags}</span>Flags</div>`;

  try {
    const result = await window.truveil.endSession();
    if (result?.reportPending) {
      reportNeedsRetry = true;
      statusText.textContent = 'Report not saved';
      $('endSessionBtn').textContent = 'Retry saving report';
      toast('The interview stopped, but its report needs a retry: ' + result.error, 'error');
      return;
    }
    if (result && result.reportPath) {
      reportSaved = true;
      reportNeedsRetry = false;
      $('endedSub').textContent = 'Your interview report has been saved. Find it in Reports.';
    } else {
      $('endedSub').textContent = 'Session ended. No report generated.';
    }
  } catch (err) {
    reportNeedsRetry = true;
    console.error(err);
    toast('Failed to generate report: ' + err.message, 'error');
    return;
  } finally {
    endingSession = false;
    updateRecruiterGuide();
    $('endSessionBtn').disabled = false;
  }
  currentSession = null;
  sessionStartTime = null;
  updateInterim('');
  candidateReady = false;
  showScreen('ended');
}

async function openReportsFolder() {
  try { await window.truveil.openReportsFolder(); }
  catch (error) { toast(error.message || 'Could not open the report folder', 'error'); }
}
$('openReportsFolderBtn').addEventListener('click', openReportsFolder);
$('browseReportsBtn').addEventListener('click', openReportsFolder);

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
document.querySelectorAll('[data-followup]').forEach(button => button.addEventListener('click', async () => {
  const question = button.dataset.followup;
  try {
    await window.truveil.copyLink(question);
    await addNote(false, `Suggested follow-up copied: ${question}`);
  } catch (error) { toast(error.message || 'Could not copy the follow-up', 'error'); }
}));

let reportsLoading = false;
const deletingReports = new Set();
async function loadReports() {
  if (reportsLoading || deletingReports.size) return;
  reportsLoading = true;
  const list = $('reportList');
  const refresh = $('refreshReportsBtn');
  refresh.disabled = true;
  list.innerHTML = '<div class="empty-state">Loading reports...</div>';
  try {
  const reports = await window.truveil.listReports();
  if (!Array.isArray(reports)) throw new Error('Reports could not be loaded. Please try again.');
  if (!reports.length) {
    list.innerHTML = '<div class="empty-state">No reports yet</div>';
    return;
  }
  list.innerHTML = reports.map(report => `
    <div class="report-row" data-report-id="${esc(report.id)}">
      <div><strong>${esc(report.summary?.candidateName || 'Interview report')}</strong><span>${esc(report.summary?.role || '')} / ${new Date(report.created_at).toLocaleString()}</span></div>
      <div class="review-band">${esc(String(report.review_band || 'incomplete_evidence').replaceAll('_', ' '))}</div>
      <div class="report-actions"><button class="btn sm" data-delete-report>Delete</button><button class="btn sm" data-cancel-delete hidden>Cancel</button></div>
    </div>`).join('');
  } catch (error) {
    list.innerHTML = `<div class="empty-state" role="status">${esc(error.message || 'Reports could not be loaded.')} Use Refresh reports to try again.</div>`;
  } finally {
    reportsLoading = false;
    refresh.disabled = false;
  }
}

$('reportList')?.addEventListener('click', async event => {
  const cancel = event.target.closest('[data-cancel-delete]');
  if (cancel) {
    const remove = cancel.parentElement.querySelector('[data-delete-report]');
    remove.removeAttribute('data-confirmed');
    remove.textContent = 'Delete';
    cancel.hidden = true;
    return;
  }
  const button = event.target.closest('[data-delete-report]');
  if (!button || button.disabled) return;
  const row = button.closest('.report-row');
  if (!button.hasAttribute('data-confirmed')) {
    button.setAttribute('data-confirmed', 'true');
    button.textContent = 'Confirm delete';
    row.querySelector('[data-cancel-delete]').hidden = false;
    return;
  }
  button.disabled = true;
  row.querySelector('[data-cancel-delete]').disabled = true;
  const reportId = row.dataset.reportId;
  deletingReports.add(reportId);
  $('refreshReportsBtn').disabled = true;
  try {
    await window.truveil.deleteReport(reportId);
    $('reportList').querySelectorAll('.report-row').forEach(item => {
      if (item.dataset.reportId === reportId) item.remove();
    });
    if (!$('reportList').querySelector('.report-row')) $('reportList').innerHTML = '<div class="empty-state">No reports yet</div>';
    toast('Report deleted', 'success');
  } catch (error) {
    toast(error.message || 'Could not delete the report', 'error');
    button.disabled = false;
    row.querySelector('[data-cancel-delete]').disabled = false;
  } finally {
    deletingReports.delete(reportId);
    $('refreshReportsBtn').disabled = reportsLoading || deletingReports.size > 0;
  }
});

$('navNewSession')?.addEventListener('click', () => signedIn && showScreen(currentSession ? sessionStartTime ? 'dashboard' : 'setup' : 'idle'));
$('navLiveSession')?.addEventListener('click', () => signedIn && currentSession && showScreen(sessionStartTime ? 'dashboard' : 'setup'));
function showReports() {
  if (!signedIn) return;
  showScreen('reports');
  loadReports();
}
$('navReports')?.addEventListener('click', showReports);
$('refreshReportsBtn')?.addEventListener('click', loadReports);

// ─── Reset ────────────────────────────────────────────────────────────
function resetState() {
  invitationCopied = false;
  reportNeedsRetry = false;
  reportSaved = false;
  guideConnectionLost = false;
  totalFlags = 0;
  totalResponses = 0;
  totalTranscriptSignals = 0;
  scoreSum = 0;
  scoreCount = 0;
  scoreWeightSum = 0;
  latestScore = null;
  flagEvidence = [];
  candidateReady = false;
  notesList.replaceChildren();
  $('noteInput').value = '';
  $('endSessionBtn').textContent = 'End interview';
  if (sessionServiceNotice) {
    sessionServiceNotice.hidden = true;
    sessionServiceNotice.textContent = '';
  }
  telemetryState = { connected: true, transcription: 'waiting', monitoring: 'waiting' };
  hasFirstTranscript = false;
  interimBubble = null;
  captionEntries.clear();
  resetSharedTabView();
  $('chunkReviewList').replaceChildren();
  $('chunkReviewCount').textContent = '0 chunks';
  $('chunkReviewSummary').textContent = 'Waiting for confirmed speech.';
  captionStream = { id: null, order: 0, epoch: 0, revision: 0, legacyTime: -1 };
  transcriptList.innerHTML = '<div class="empty-state"><span class="empty-cursor"></span>Waiting for the first reliable transcript segment</div>';
  flagsList.innerHTML = '<div class="empty-state">No session events yet</div>';
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
let settingsReturnFocus = null;
let settingsOpening = false;
function applyPreferences(settings = {}) {
  document.body.dataset.transcriptSize = settings.transcriptSize === 'large' ? 'large' : 'standard';
  document.body.dataset.reducedMotion = String(settings.reduceMotion === true);
}
function closeSettings() {
  settingsModal.classList.remove('active');
  settingsReturnFocus?.focus();
}
$('openSettingsBtn').addEventListener('click', openSettings);
$('closeSettingsBtn').addEventListener('click', closeSettings);
$('cancelSettingsBtn').addEventListener('click', closeSettings);
$('saveSettingsBtn').addEventListener('click', saveSettings);
settingsModal.addEventListener('click', event => { if (event.target === settingsModal) closeSettings(); });

async function openSettings() {
  if (settingsOpening || settingsModal.classList.contains('active')) return;
  settingsOpening = true;
  settingsReturnFocus = document.activeElement;
  try {
  const s = await window.truveil.getSettings();
  $('transcriptSizeSelect').value = s.transcriptSize === 'large' ? 'large' : 'standard';
  $('reduceMotionInput').checked = s.reduceMotion === true;
  $('settingsStatus').textContent = '';
  settingsModal.classList.add('active');
  $('transcriptSizeSelect').focus();
  } catch (error) { toast(error.message || 'Could not load settings', 'error'); }
  finally { settingsOpening = false; }
}

async function saveSettings() {
  const button = $('saveSettingsBtn');
  if (button.disabled) return;
  $('cancelSettingsBtn').focus();
  button.disabled = true;
  const patch = {
    transcriptSize: $('transcriptSizeSelect').value === 'large' ? 'large' : 'standard',
    reduceMotion: $('reduceMotionInput').checked === true
  };
  try {
  await window.truveil.saveSettings(patch);
  applyPreferences(patch);
  closeSettings();
  toast('Workspace preferences saved', 'success');
  } catch (error) {
    $('settingsStatus').textContent = error.message || 'Could not save preferences. Please try again.';
    $('settingsStatus').className = 'settings-status error';
  } finally { button.disabled = false; }
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (settingsModal.classList.contains('active')) closeSettings();
  }
  if (e.key === 'Tab' && settingsModal.classList.contains('active')) {
    const controls = [...settingsModal.querySelectorAll('button, select, input')].filter(control => !control.disabled);
    const first = controls[0], last = controls[controls.length - 1];
    if (!controls.includes(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault();
    openSettings();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────
(async () => {
  try {
    const demo = await window.truveil.getDemoConfig?.();
    demoMode = demo?.enabled === true;
    if (demoMode) {
      $('demoRelayInput').value = demo.relayUrl ? sessionPresentation.serverAddress(demo.relayUrl) : '';
      $('demoConnectionSettings').open = !demo.relayUrl;
      $('sharedTabsPanel').hidden = false;
      document.querySelectorAll('[data-blocked-site]').forEach(input => {
        input.closest('.check-tile').hidden = !isBrowserDestination(input.dataset.blockedSite);
      });
      customBlockedSiteDraft.placeholder = 'Add website domain, e.g. example.com';
      signOutBtn.hidden = true;
      showDemoAccess();
    } else await renderAuthState(await window.truveil.getAuth());
    const s = await window.truveil.getSettings();
    applyPreferences(s);
  } catch (e) {
    console.warn('Settings load failed', e);
  }
})();

window.truveil.onDemoJoinRequest?.(request => {
  pendingDemoJoin = request;
  $('demoJoinName').textContent = String(request.name || 'Candidate');
  $('demoApproval').hidden = false;
  updateRecruiterGuide();
  toast('A candidate is waiting for your approval.');
});
for (const [id, allow] of [['approveDemoBtn', true], ['declineDemoBtn', false]]) {
  $(id)?.addEventListener('click', async () => {
    if (!pendingDemoJoin) return;
    const request = pendingDemoJoin;
    $('approveDemoBtn').disabled = $('declineDemoBtn').disabled = true;
    try {
      await window.truveil.approveDemo({ requestId: request.requestId, allow });
      if (pendingDemoJoin === request) { pendingDemoJoin = null; $('demoApproval').hidden = true; }
    } catch (error) { toast(error.message, 'error'); }
    finally { $('approveDemoBtn').disabled = $('declineDemoBtn').disabled = false; updateRecruiterGuide(); }
  });
}
function sharedTabStatus(message) {
  const count = sharedTabRequests.size;
  $('tabCloseStatus').textContent = count
    ? `Closing ${count === 1 ? 'the selected tab' : `${count} selected tabs`}...` : message;
}

function revokeSharedTabCommands() {
  sharedTabGeneration++;
  sharedTabRequests.clear();
  for (const row of sharedTabRows.values()) row.pending = null;
}

function resetSharedTabView() {
  revokeSharedTabCommands();
  sharedBrowserView = { connected: false, closeConsent: false };
  renderSharedTabs(sharedBrowserView);
}

function updateSharedTabRow(row) {
  const tab = row.tab;
  row.pending = sharedTabRequests.get(tab.id) || null;
  const text = tab.hostname || 'New tab';
  if (row.label.textContent !== text) row.label.textContent = text;
  const detail = tab.protected ? 'Protected tab' : tab.active ? 'Active tab' : 'Shared tab';
  if (row.detail.textContent !== detail) row.detail.textContent = detail;
  row.element.classList.toggle('is-active', tab.active === true);
  row.element.classList.toggle('is-pending', Boolean(row.pending));
  const closed = row.closedRevision === tab.revision;
  const caption = tab.protected ? 'Protected' : row.pending ? 'Closing...' : closed ? 'Closed' : 'Close tab';
  if (row.button.textContent !== caption) row.button.textContent = caption;
  row.button.disabled = !sharedBrowserView.connected || !sharedBrowserView.closeConsent || tab.protected || Boolean(row.pending) || closed;
  row.button.setAttribute('aria-busy', row.pending ? 'true' : 'false');
  row.button.setAttribute('aria-label', tab.protected ? `${text}, protected tab` : `Close shared tab for ${text}`);
  row.button.title = tab.protected ? 'Meeting and protected tabs cannot be closed' : `Close ${text}`;
}

async function closeSharedTab(row) {
  if (!currentSession || !sharedBrowserView.connected || !sharedBrowserView.closeConsent
    || row.tab.protected || sharedTabRequests.has(row.tab.id) || row.closedRevision === row.tab.revision || sharedTabRows.get(row.tab.id) !== row) return;
  const tab = { ...row.tab };
  const ownerId = currentSession.sessionId;
  if (!window.confirm(`Close the shared tab for ${tab.hostname || 'New tab'}? Unsaved work in that tab may be lost.`)) return;
  const generation = sharedTabGeneration;
  const request = { generation, ownerId, id: tab.id, revision: tab.revision };
  row.pending = request;
  sharedTabRequests.set(tab.id, request);
  updateSharedTabRow(row);
  sharedTabStatus('');
  let message = 'The browser could not close that tab.';
  try {
    const result = await window.truveil.closeBrowserTab({ id: tab.id, revision: tab.revision });
    if (generation !== sharedTabGeneration || currentSession?.sessionId !== ownerId) return;
    const messages = { closed: 'The selected tab was closed.', stale: 'The tab changed. Review the latest list.', denied: 'Closing was not permitted.', unavailable: 'The browser or session is no longer connected.', failed: message };
    message = messages[result?.status] || messages.failed;
    if (result?.status === 'closed') {
      row.closedRevision = tab.revision;
      const visible = sharedTabRows.get(tab.id);
      if (visible?.tab.revision === tab.revision) visible.closedRevision = tab.revision;
    }
  } catch {
    message = 'The tab-close request could not be delivered. Check the connection.';
  } finally {
    if (sharedTabRequests.get(tab.id) === request) sharedTabRequests.delete(tab.id);
    if (generation === sharedTabGeneration && currentSession?.sessionId === ownerId) {
      const visible = sharedTabRows.get(tab.id);
      if (visible) updateSharedTabRow(visible);
      sharedTabStatus(message);
    }
  }
}

function renderSharedTabs(state = {}) {
  state = state && typeof state === 'object' ? state : {};
  if (state.sessionId && state.sessionId !== currentSession?.sessionId) return;
  const list = $('sharedTabList');
  const focused = document.activeElement;
  const retainFocus = Boolean(focused && list.contains(focused));
  const connected = state.connected === true;
  const closeConsent = connected && state.closeConsent === true;
  const newlyAvailable = connected && (!sharedBrowserView.connected || (closeConsent && !sharedBrowserView.closeConsent));
  if ((!connected && sharedBrowserView.connected) || (!closeConsent && sharedBrowserView.closeConsent)) revokeSharedTabCommands();
  sharedBrowserView = { connected, closeConsent };
  const seen = new Set();
  const tabs = connected && Array.isArray(state.tabs) ? state.tabs.slice(0, 128).filter(tab => {
    if (!tab || typeof tab.id !== 'string' || !tab.id || tab.id.length > 256 || seen.has(tab.id)
      || !Number.isSafeInteger(tab.revision) || tab.revision < 0 || typeof tab.hostname !== 'string' || tab.hostname.length > 253) return false;
    seen.add(tab.id); return true;
  }) : [];
  const ids = new Set(tabs.map(tab => tab.id));
  for (const [id, row] of sharedTabRows) {
    if (!ids.has(id)) { row.element.remove(); sharedTabRows.delete(id); }
  }
  const badge = $('sharedTabState');
  const stateText = connected ? `${tabs.length} ${tabs.length === 1 ? 'tab' : 'tabs'} · ${closeConsent ? 'Closing permitted' : 'View only'}` : 'Not shared';
  if (badge.textContent !== stateText) badge.textContent = stateText;
  badge.dataset.state = connected ? 'connected' : 'disconnected';
  if (!connected) sharedTabStatus('Candidate browser sharing is off.');
  else if (!closeConsent) sharedTabStatus('Tab closing is not permitted.');
  else if (newlyAvailable) sharedTabStatus('');
  if (!tabs.length) {
    sharedTabEmpty ||= document.createElement('div');
    sharedTabEmpty.className = 'shared-tab-empty';
    sharedTabEmpty.textContent = connected ? 'No shared tabs open.' : 'Browser not shared';
    if (!sharedTabEmpty.isConnected) list.append(sharedTabEmpty);
    return;
  }
  sharedTabEmpty?.remove();
  for (const [index, tab] of tabs.entries()) {
    let row = sharedTabRows.get(tab.id);
    if (!row) {
      const element = document.createElement('div');
      element.className = 'shared-tab-row'; element.dataset.tabId = tab.id;
      const icon = document.createElement('span');
      icon.className = 'shared-tab-icon'; icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z"/></svg>';
      const copy = document.createElement('div'); copy.className = 'shared-tab-copy';
      const label = document.createElement('span'); label.className = 'shared-tab-host';
      const detail = document.createElement('span'); detail.className = 'shared-tab-detail';
      copy.append(label, detail);
      const button = document.createElement('button'); button.className = 'btn sm shared-tab-close';
      row = { element, label, detail, button, pending: null, closedRevision: null };
      button.addEventListener('click', () => closeSharedTab(row));
      element.append(icon, copy, button);
      sharedTabRows.set(tab.id, row);
    }
    row.tab = { ...tab };
    updateSharedTabRow(row);
    const position = list.children[index];
    if (position !== row.element) list.insertBefore(row.element, position || null);
  }
  if (retainFocus && focused.isConnected && !focused.disabled && list.contains(focused) && document.activeElement !== focused) {
    focused.focus({ preventScroll: true });
  }
}

window.truveil.onBrowserTabs?.(renderSharedTabs);
