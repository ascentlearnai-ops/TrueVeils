const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { parseHTML } = require('linkedom');
const { loadMain } = require('./helpers/main-harness');
const presentation = require('../src/session/presentation');

const demoCode = 'DEMO-ABCDEFGHIJ234567';
const demoRelayUrl = 'wss://relay.example.test/demo';
const demoLink = presentation.invitation(demoCode, demoRelayUrl);

async function setup(options = {}, rendererOverrides = {}) {
  const root = path.resolve(__dirname, '..');
  const app = loadMain(options);
  const { window, document } = parseHTML(fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8'));
  for (const select of document.querySelectorAll('select')) Object.defineProperty(select, 'value', { value: select.querySelector('option')?.value || '', writable: true });
  const events = new EventEmitter();
  app.attachRenderer((channel, payload) => events.emit(channel, {}, payload));
  vm.runInNewContext(fs.readFileSync(path.join(root, 'preload.js'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (name, api) => { window[name] = api; } },
      ipcRenderer: { invoke: app.invoke, on: events.on.bind(events) }
    })
  });
  Object.assign(window.truveil, rendererOverrides);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/session/presentation.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/renderer/dashboard.js'), 'utf8'), {
    window, document, URL, console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
  });
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  const click = async id => { document.getElementById(id).click(); await flush(); };
  await flush();
  return { app, document, click, flush, events, element: id => document.getElementById(id) };
}

async function enterDemoWorkspace(ui, code = 'synthetic-private-host-code') {
  ui.element('demoHostCodeInput').value = code;
  ui.element('demoAccessForm').dispatchEvent(new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await ui.flush();
}

test('new interviews allow every app/site by default and restrictions require an explicit opt-in', async () => {
  let submitted;
  const ui = await setup({}, {
    updateSession: async data => { submitted = data; return { sessionId: 'TRV-ABC123' }; }
  });
  await ui.click('newSessionBtn');
  assert.equal(ui.element('restrictionsEnabledInput').checked, false);
  assert.equal(ui.element('restrictionControls').hidden, true);
  assert.equal(ui.element('allowedAppsChips'), null);
  assert.equal(ui.element('allowedSitesChips'), null);
  ui.app.event({ type: 'candidate_ready' });
  for (const id of ['noticeConfirmedInput', 'policyConfirmedInput', 'humanReviewConfirmedInput']) ui.element(id).checked = true;
  await ui.click('startMonitoringBtn');
  assert.deepEqual({ ...submitted.policy, allowed_apps: [...submitted.policy.allowed_apps], allowed_sites: [...submitted.policy.allowed_sites], blocked_sites: [...submitted.policy.blocked_sites] }, {
    allowed_apps: [], allowed_sites: [], blocked_sites: [], blocking_mode: 'none'
  });
  await ui.click('endSessionBtn');
});

test('optional restrictions send only selected rules and switching off removes all rules', async () => {
  const ui = await setup();
  await ui.click('newSessionBtn');
  const optIn = ui.element('restrictionsEnabledInput');
  optIn.checked = true;
  optIn.dispatchEvent(new ui.document.defaultView.Event('change'));
  assert.equal(ui.element('restrictionControls').hidden, false);
  optIn.checked = false;
  optIn.dispatchEvent(new ui.document.defaultView.Event('change'));
  assert.equal(ui.element('restrictionControls').hidden, true);
  optIn.checked = true;
  optIn.dispatchEvent(new ui.document.defaultView.Event('change'));
  const rule = ui.document.querySelector('[data-blocked-site="chatgpt.com"]');
  rule.checked = true;
  ui.element('customBlockedSiteDraft').value = 'example.org';
  await ui.click('addCustomBlockedSiteBtn');
  // Inspect the same policy builder used by Start without bypassing confirmation gates.
  ui.app.event({ type: 'candidate_ready' });
  for (const id of ['noticeConfirmedInput', 'policyConfirmedInput', 'humanReviewConfirmedInput']) ui.element(id).checked = true;
  await ui.click('startMonitoringBtn');
  assert.deepEqual([...ui.app.inspect().activeSession.policy.blocked_sites], ['chatgpt.com', 'example.org']);
  await ui.click('endSessionBtn');
  await ui.click('newSessionBtn2');
  assert.equal(optIn.checked, false);
  assert.equal(ui.element('restrictionControls').hidden, true);
  await ui.click('cancelSetupBtn');
});

test('demo opens at host-code entry, then workspace, then creates through the explicit demo API', async () => {
  let created = null;
  const ui = await setup({ user: null }, {
    getDemoConfig: async () => ({ enabled: true, relayUrl: 'ws://127.0.0.1:43180/demo' }),
    getAuth: async () => { throw new Error('Demo must not request authentication'); },
    createDemo: async data => {
      created = data;
      return { demo: true, sessionId: demoCode, relayUrl: data.relayUrl,
        candidateLink: presentation.invitation(demoCode, data.relayUrl) };
    }
  });
  assert.equal(ui.document.body.dataset.screen, 'access');
  assert.equal(ui.element('auth-screen').classList.contains('active'), false);
  assert.equal(ui.element('navReports').disabled, true);
  await enterDemoWorkspace(ui);
  assert.equal(ui.document.body.dataset.screen, 'idle');
  assert.equal(created, null, 'Entering the workspace must not create a room or claim server authorization');
  assert.equal(ui.element('navReports').disabled, false);
  assert.equal(ui.element('newSessionBtn').textContent.trim(), 'New interview');
  await ui.click('newSessionBtn');
  assert.equal(created.hostAccessCode, 'synthetic-private-host-code');
  assert.equal(ui.element('demoHostCodeInput').value, '');
  assert.doesNotMatch(ui.element('candidateInviteMessage').value, /synthetic-private-host-code/);
  assert.equal(created.relayUrl, 'ws://127.0.0.1:43180');
  assert.equal(ui.document.body.dataset.screen, 'setup');
  assert.ok(ui.element('candidateInviteMessage').value.includes(presentation.displayCode(demoCode)));
  assert.doesNotMatch(ui.element('candidateInviteMessage').value, /demo/i);
  assert.match(ui.element('candidateInviteMessage').value, /127.0.0.1/);
  assert.equal(ui.element('sessionServiceNotice').hidden, true);
  assert.equal(ui.element('sessionServiceNotice').textContent, '');
  assert.equal(ui.element('startMonitoringBtn').disabled, true, 'Removing the note must not bypass candidate preflight');
});

test('blank host code cannot enter the workspace or create a room', async () => {
  let created = 0;
  const ui = await setup({ user: null }, {
    getDemoConfig: async () => ({ enabled: true, relayUrl: demoRelayUrl }),
    createDemo: async () => { created++; }
  });
  await enterDemoWorkspace(ui, '   ');
  assert.equal(ui.document.body.dataset.screen, 'access');
  assert.match(ui.element('demoAccessMessage').textContent, /Enter your host access code/);
  await ui.click('newSessionBtn');
  assert.equal(created, 0);
  assert.equal(ui.document.body.dataset.screen, 'access');
});

test('missing relay address is recoverable on the access screen without creating a room', async () => {
  const ui = await setup({ user: null }, {
    getDemoConfig: async () => ({ enabled: true, relayUrl: '' }),
    createDemo: async () => { throw new Error('Must not create'); }
  });
  await enterDemoWorkspace(ui);
  assert.equal(ui.document.body.dataset.screen, 'access');
  assert.equal(ui.element('demoConnectionSettings').open, true);
  assert.match(ui.element('demoAccessMessage').textContent, /server address/);
  ui.element('demoRelayInput').value = demoRelayUrl;
  await enterDemoWorkspace(ui);
  assert.equal(ui.document.body.dataset.screen, 'idle');
});

test('relay rejection clears the host code, returns to access and supports a retry', async () => {
  let attempts = 0;
  const ui = await setup({ user: null }, {
    getDemoConfig: async () => ({ enabled: true, relayUrl: demoRelayUrl }),
    createDemo: async () => {
      if (++attempts === 1) throw new Error('Host access denied');
      return { demo: true, sessionId: demoCode, relayUrl: demoRelayUrl, candidateLink: demoLink };
    }
  });
  await enterDemoWorkspace(ui);
  await ui.click('newSessionBtn');
  assert.equal(ui.document.body.dataset.screen, 'access');
  assert.equal(ui.element('demoHostCodeInput').value, '');
  assert.match(ui.element('demoAccessMessage').textContent, /Host access denied/);
  assert.equal(ui.element('navReports').disabled, true);
  await enterDemoWorkspace(ui);
  await ui.click('newSessionBtn');
  assert.equal(ui.document.body.dataset.screen, 'setup');
  assert.equal(attempts, 2);
});

test('actual demo invitation controls copy the main-issued code, link and full message', async t => {
  const copied = [];
  let receivedHostCode;
  class Relay extends EventEmitter {
    async create(details, hostAccessCode) {
      receivedHostCode = hostAccessCode;
      return { roomId: 'test-room', code: demoCode, expiresAt: Date.now() + 60000 };
    }
    async end() { return { ok: true }; }
    close() {}
  }
  const ui = await setup({ user: null,
    env: { TRUVEIL_APP_MODE: 'demo', TRUVEIL_DEMO_RELAY_URL: demoRelayUrl,
      TRUVEIL_DEMO_HOST_KEY: 'synthetic-server-only-secret' },
    modules: { './src/demo/relay-client': {
      DemoRelayClient: Relay, normalizeRelayUrl: require('../src/demo/relay-client').normalizeRelayUrl
    } }
  }, { copyLink: async value => { copied.push(value); } });
  await enterDemoWorkspace(ui);
  await ui.click('newSessionBtn');
  const session = ui.app.inspect().activeSession;
  assert.equal(session.demo, true);
  assert.match(session.sessionId, /^DEMO-[A-Z2-7]{16}$/);
  assert.equal(session.candidateLink, demoLink);
  assert.equal(receivedHostCode, 'synthetic-private-host-code');
  assert.equal(ui.element('demoHostCodeInput').value, '');
  assert.equal(ui.element('openCandidateLinkBtn').disabled, true);
  assert.equal(ui.element('inviteLinkPreview').textContent, session.candidateLink);
  const expectedMessage = `Hi,\n\nJoin your interview in Truveil Secure:\n${session.candidateLink}\n\n1. Open the link and enter your name.\n2. Review permissions, then choose Join interview.\n3. Wait for your interviewer to approve and start.\n\nIf the link will not open, enter these in Truveil Secure:\nRoom code: ${presentation.displayCode(session.sessionId)}\nSession server: ${presentation.serverAddress(session.relayUrl)}\n\nUse your usual calling app and keep Truveil Secure open. No account is needed. Browser sharing is optional. Interview reports stay on the interviewer's computer.`;
  assert.equal(ui.element('candidateInviteMessage').value, expectedMessage);
  assert.doesNotMatch(JSON.stringify(session) + expectedMessage, /synthetic-private-host-code|synthetic-server-only-secret/);
  // Visible text is not the authority for any copied invitation field.
  ui.element('sessionCode').textContent = 'TRV-STALE1';
  for (const [id, expected] of [
    ['copySessionCodeBtn', presentation.displayCode(session.sessionId)],
    ['copyCandidateLinkBtn', session.candidateLink],
    ['copyInviteMessageBtn', expectedMessage]
  ]) await t.test(id, async () => {
    copied.length = 0;
    await ui.click(id);
    assert.deepEqual(copied, [expected]);
    assert.match(ui.element('toast').className, /success/);
    assert.doesNotMatch(copied.join('\n'), /synthetic-private-host-code|synthetic-server-only-secret/);
  });
  await t.test('demo Open link remains unavailable', async () => {
    await ui.click('openCandidateLinkBtn');
    assert.equal(ui.app.calls.some(call => call.openedUrl), false);
    await assert.rejects(ui.app.invoke('shell:open-external', session.candidateLink), /Unsupported external link/);
  });
  assert.equal(ui.app.calls.some(call => call.function || call.table || call.channel), false);
  await ui.click('cancelSetupBtn');
  assert.equal(ui.document.body.dataset.screen, 'idle');
  await ui.click('newSessionBtn');
  assert.equal(ui.document.body.dataset.screen, 'access', 'A consumed host code must not be silently reused');
  assert.equal(ui.app.inspect().activeSession, null);
  assert.equal(ui.element('demoHostCodeInput').value, '');
  await enterDemoWorkspace(ui);
  await ui.click('newSessionBtn');
  assert.equal(ui.document.body.dataset.screen, 'setup');
  await ui.click('cancelSetupBtn');
});

test('demo copy controls reject invalid rooms and inconsistent main-issued links', async t => {
  const valid = { demo: true, sessionId: demoCode, relayUrl: demoRelayUrl, candidateLink: demoLink };
  const cases = [
    ['missing code', { sessionId: '' }],
    ['short code', { sessionId: demoCode.slice(0, -1) }],
    ['long code', { sessionId: demoCode + 'A' }],
    ['noncanonical lowercase code', { sessionId: demoCode.toLowerCase() }],
    ...['0', '1', '8', '9'].map(character => [`non-base32 digit ${character}`, { sessionId: demoCode.slice(0, -1) + character }]),
    ['cloud code in demo session', { sessionId: 'TRV-ABC234' }],
    ['demo code without demo session', { demo: false }],
    ['missing link', { candidateLink: '' }],
    ['missing relay', { relayUrl: '' }],
    ['different room in link', { candidateLink: demoLink.replace(presentation.displayCode(demoCode), 'TRV-KLMNOPQRST234567') }],
    ['different relay in link', { relayUrl: 'wss://other.example.test/demo' }],
    ['extra credential in link', { candidateLink: demoLink + '&hostAccessCode=synthetic-private-host-code' }],
    ['cloud link for demo room', { candidateLink: `https://truveil-secure.vercel.app/?code=${demoCode}&open=1` }]
  ];
  for (const [name, patch] of cases) await t.test(name, async () => {
    const copied = [];
    const session = { ...valid, ...patch };
    if (Object.hasOwn(patch, 'sessionId')) {
      session.candidateLink = `truveil://session?code=${encodeURIComponent(presentation.displayCode(session.sessionId))}&relay=${encodeURIComponent(presentation.serverAddress(session.relayUrl))}`;
    }
    const ui = await setup({ user: null }, {
      getDemoConfig: async () => ({ enabled: true, relayUrl: demoRelayUrl }),
      createDemo: async () => session,
      copyLink: async value => { copied.push(value); }
    });
    await enterDemoWorkspace(ui);
    await ui.click('newSessionBtn');
    for (const id of ['copySessionCodeBtn', 'copyCandidateLinkBtn', 'copyInviteMessageBtn']) {
      await ui.click(id);
      assert.deepEqual(copied, []);
      assert.match(ui.element('toast').textContent, /Create a session first/);
    }
    assert.equal(ui.element('candidateInviteMessage').value, 'Create a session to generate the candidate invite message.');
  });
});

test('legacy cloud invitation controls still copy and open the main-issued invitation', async () => {
  const copied = [];
  const ui = await setup({}, { copyLink: async value => { copied.push(value); } });
  await ui.click('newSessionBtn');
  const session = ui.app.inspect().activeSession;
  const message = ui.element('candidateInviteMessage').value;
  for (const id of ['copySessionCodeBtn', 'copyCandidateLinkBtn', 'copyInviteMessageBtn']) await ui.click(id);
  assert.deepEqual(copied, [session.sessionId, session.candidateLink, message]);
  assert.ok(message.includes(session.sessionId));
  assert.ok(message.includes(session.candidateLink));
  assert.equal(ui.element('openCandidateLinkBtn').disabled, false);
  await ui.click('openCandidateLinkBtn');
  assert.equal(ui.app.calls.find(call => call.openedUrl)?.openedUrl, session.candidateLink);
  await ui.click('cancelSetupBtn');
});

test('legacy cloud validation and fallback links retain the six-character case-insensitive contract', async t => {
  for (const code of ['TRV-ABC089', 'trv-abc089', 'TRV-ABCDE', 'TRV-ABCDEFG', 'TRV-ABC_23', demoCode]) {
    await t.test(code, async () => {
      const copied = [];
      const ui = await setup({}, {
        createSession: async () => ({ sessionId: code }),
        copyLink: async value => { copied.push(value); }
      });
      await ui.click('newSessionBtn');
      for (const id of ['copySessionCodeBtn', 'copyCandidateLinkBtn', 'copyInviteMessageBtn']) await ui.click(id);
      if (code === 'TRV-ABC089' || code === 'trv-abc089') {
        assert.deepEqual(copied, [code, `https://truveil-secure.vercel.app/?code=${code}&open=1`, ui.element('candidateInviteMessage').value]);
      } else {
        assert.deepEqual(copied, []);
        assert.match(ui.element('toast').textContent, /Create a session first/);
      }
    });
  }
});

test('invitation controls reject no session and a cancelled session despite stale DOM values', async () => {
  const copied = [];
  const ui = await setup({}, { copyLink: async value => { copied.push(value); } });
  for (const cancelled of [false, true]) {
    if (cancelled) {
      await ui.click('newSessionBtn');
      await ui.click('cancelSetupBtn');
    }
    ui.element('sessionCode').textContent = 'TRV-ABC234';
    ui.element('inviteLinkPreview').textContent = demoLink;
    ui.element('candidateInviteMessage').value = 'Stale invitation';
    for (const id of ['copySessionCodeBtn', 'copyCandidateLinkBtn', 'copyInviteMessageBtn', 'openCandidateLinkBtn']) {
      await ui.click(id);
      assert.deepEqual(copied, []);
      assert.match(ui.element('toast').textContent, /Create a session first/);
    }
    assert.equal(ui.app.calls.some(call => call.openedUrl), false);
  }
});

test('demo tab list is text-only and only exposes close for current permitted unprotected targets', async () => {
  const ui = await setup({}, { getDemoConfig: async () => ({ enabled: true }) });
  ui.events.emit('browser:tabs', {}, { connected: true, closeConsent: true, tabs: [
    { id: 'safe-id', revision: 1, hostname: '<img src=x>', protected: false },
    { id: 'meeting', revision: 2, hostname: 'meet.google.com', protected: true }
  ] });
  assert.equal(ui.element('sharedTabList').querySelectorAll('img').length, 0);
  assert.equal(ui.element('sharedTabList').querySelectorAll('button:not([disabled])').length, 1);
  ui.events.emit('browser:tabs', {}, { connected: false, closeConsent: false, tabs: [] });
  assert.equal(ui.element('sharedTabList').querySelectorAll('button').length, 0);
});

test('actual renderer/preload/main create, cancel and recreate a backed invitation', async () => {
  const ui = await setup();
  await ui.click('newSessionBtn');
  assert.equal(ui.element('setup-screen').classList.contains('active'), true);
  assert.equal(ui.element('sessionCode').textContent, 'TRV-ABC234');
  assert.equal(ui.element('startMonitoringBtn').disabled, true);
  await ui.click('cancelSetupBtn');
  assert.equal(ui.app.inspect().activeSession, null);
  assert.equal(ui.element('idle-screen').classList.contains('active'), true);
  await ui.click('newSessionBtn');
  assert.ok(ui.app.inspect().activeSession);
  await ui.click('cancelSetupBtn');
});

test('actual renderer does not enter the dashboard after a failed start', async () => {
  const ui = await setup();
  await ui.click('newSessionBtn');
  ui.app.event({ type: 'candidate_ready' });
  for (const id of ['noticeConfirmedInput', 'policyConfirmedInput', 'humanReviewConfirmedInput']) ui.element(id).checked = true;
  ui.app.state.databaseError = new Error('Synthetic network outage');
  await ui.click('startMonitoringBtn');
  assert.equal(ui.element('setup-screen').classList.contains('active'), true);
  assert.equal(ui.app.inspect().sessionData.startedAt, null);
  ui.app.state.databaseError = null;
  await ui.click('startMonitoringBtn');
  assert.equal(ui.element('dashboard-screen').classList.contains('active'), true);
  await ui.click('endSessionBtn');
  assert.equal(ui.element('ended-screen').classList.contains('active'), true);
  assert.equal(ui.element('navLiveSession').disabled, true);
  await ui.click('navNewSession');
  assert.equal(ui.element('idle-screen').classList.contains('active'), true);
});

test('password form clears secrets and uses the existing account sign-in handler', async () => {
  const ui = await setup({ user: null });
  ui.element('authEmailInput').value = 'recruiter@example.test';
  ui.element('authPasswordInput').value = 'synthetic-test-password';
  ui.app.state.user = { id: 'recruiter', email: 'recruiter@example.test' };
  await ui.click('signInPasswordBtn');
  assert.equal(ui.element('authPasswordInput').value, '');
  assert.equal(ui.element('idle-screen').classList.contains('active'), true);
  assert.ok(ui.app.calls.some(call => call.passwordSignIn));
});

test('a lost candidate connection disables Start in the actual renderer', async () => {
  const ui = await setup();
  await ui.click('newSessionBtn');
  ui.app.event({ type: 'candidate_ready' });
  assert.equal(ui.element('startMonitoringBtn').disabled, false);
  ui.app.event({ type: 'candidate_interrupted' });
  assert.equal(ui.element('startMonitoringBtn').disabled, true);
  await ui.click('cancelSetupBtn');
});

test('workspace navigation preserves setup and an ongoing interview', async () => {
  const ui = await setup({}, { listReports: async () => [] });
  await ui.click('newSessionBtn');
  await ui.click('navReports');
  await ui.click('navLiveSession');
  assert.equal(ui.document.body.dataset.screen, 'setup');
  ui.app.event({ type: 'candidate_ready' });
  for (const id of ['noticeConfirmedInput', 'policyConfirmedInput', 'humanReviewConfirmedInput']) ui.element(id).checked = true;
  await ui.click('startMonitoringBtn');
  await ui.click('navReports');
  await ui.click('navNewSession');
  assert.equal(ui.document.body.dataset.screen, 'dashboard');
  assert.equal(ui.document.querySelector('.skip-link').getAttribute('href'), '#dashboard-screen');
  await ui.click('endSessionBtn');
});

test('preferences persist only UI options and remain retryable after a write failure', async () => {
  let fail = true, saved;
  const ui = await setup({}, {
    getSettings: async () => ({ transcriptSize: 'large', reduceMotion: true }),
    saveSettings: async patch => { if (fail) throw new Error('Disk unavailable'); saved = patch; }
  });
  assert.equal(ui.document.body.dataset.transcriptSize, 'large');
  await ui.click('openSettingsBtn');
  ui.element('transcriptSizeSelect').value = 'standard';
  ui.element('reduceMotionInput').checked = false;
  await ui.click('saveSettingsBtn');
  assert.match(ui.element('settingsStatus').textContent, /Disk unavailable/);
  assert.equal(ui.element('settingsModal').classList.contains('active'), true);
  assert.equal(ui.element('saveSettingsBtn').disabled, false);
  assert.equal(ui.document.body.dataset.transcriptSize, 'large');
  fail = false;
  await ui.click('saveSettingsBtn');
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), { transcriptSize: 'standard', reduceMotion: false });
  assert.equal(ui.document.body.dataset.transcriptSize, 'standard');
  assert.equal(ui.element('settingsModal').classList.contains('active'), false);
});

test('reports recover from network failures and require confirmation before deletion', async () => {
  let loadFails = true, deleteFails = true, deletions = 0;
  const ui = await setup({}, {
    listReports: async () => { if (loadFails) throw new Error('Offline'); return [{ id: 'sample', created_at: '2026-10-24', summary: { candidateName: '<Sample>' } }]; },
    deleteReport: async id => { assert.equal(id, 'sample'); deletions++; if (deleteFails) throw new Error('Try again'); }
  });
  await ui.click('navReports');
  assert.match(ui.element('reportList').textContent, /Offline.*Refresh/);
  assert.equal(ui.element('refreshReportsBtn').disabled, false);
  loadFails = false;
  await ui.click('refreshReportsBtn');
  const remove = ui.document.querySelector('[data-delete-report]');
  remove.click(); await ui.flush();
  assert.equal(deletions, 0);
  const cancel = ui.document.querySelector('[data-cancel-delete]');
  cancel.click(); await ui.flush();
  assert.equal(remove.textContent, 'Delete');
  remove.click(); remove.click(); await ui.flush();
  assert.equal(deletions, 1);
  assert.equal(remove.disabled, false);
  assert.ok(ui.document.querySelector('.report-row'));
  deleteFails = false;
  remove.click(); await ui.flush();
  assert.match(ui.element('reportList').textContent, /No reports/);
});

test('failed follow-up copy does not create a misleading note', async () => {
  let notes = 0;
  const ui = await setup({}, {
    copyLink: async () => { throw new Error('Clipboard unavailable'); },
    addSessionNote: async () => { notes++; }
  });
  ui.document.querySelector('[data-followup]').click(); await ui.flush();
  assert.equal(notes, 0);
  assert.match(ui.element('toast').textContent, /Clipboard unavailable/);
});

test('report refresh waits for a pending deletion and cannot resurrect its row', async () => {
  let resolveDelete, loads = 0;
  const ui = await setup({}, {
    listReports: async () => { loads++; return [{ id: 'sample', created_at: '2026-10-24' }]; },
    deleteReport: () => new Promise(resolve => { resolveDelete = resolve; })
  });
  await ui.click('navReports');
  const button = ui.document.querySelector('[data-delete-report]');
  button.click(); button.click(); await ui.flush();
  assert.equal(ui.element('refreshReportsBtn').disabled, true);
  await ui.click('navNewSession');
  await ui.click('navReports');
  assert.equal(loads, 1);
  resolveDelete(); await ui.flush();
  assert.equal(ui.element('refreshReportsBtn').disabled, false);
  assert.equal(ui.document.querySelector('.report-row'), null);
  assert.match(ui.element('reportList').textContent, /No reports/);
});
