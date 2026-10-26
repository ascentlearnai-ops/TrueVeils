// Local Windows package verification. Never stages downloads or invokes paid providers.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('C:/Users/kanag/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const WebSocket = require('ws');
const asar = require('@electron/asar');
const { createDemoRelay } = require('../../backend/demo/relay-server');
const root = path.resolve(__dirname, '../..');
const candidateRoot = path.resolve(root, '../Truveil-Client');
const releaseDist = process.argv.includes('--release-dist');
const output = path.join(root, releaseDist ? 'output/playwright/demo-release' : 'output/playwright/final-local');
const builds = path.join(root, '.readiness/final-local');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 20000;
  while (!await fn()) { assert.ok(Date.now() < deadline, `Timed out: ${label}`); await wait(40); }
}
async function launchPackage(pkg, profile, env) {
  let stderr = '';
  const child = spawn(pkg.executable, ['--inspect-brk=0', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-background-networking'],
  { cwd: profile, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', data => { stderr += data.toString(); });
  child.stdout.resume();
  let socket, browser, nextId = 0;
  const pending = new Map();
  const close = async () => {
    await browser?.close().catch(() => {});
    socket?.terminate();
    if (child.exitCode === null) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    }
  };
  try {
    await until(() => /Debugger listening on (ws:\/\/[^\s]+)/.test(stderr), `${pkg.kind} inspector startup`);
    socket = new WebSocket(stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)[1]);
    const request = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Inspector timed out: ${method}`)); }, 15000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
    let paused;
    socket.on('message', data => {
      const message = JSON.parse(data);
      if (message.method === 'Debugger.paused') paused = message.params;
      const item = pending.get(message.id);
      if (item) { pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
    });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await request('Debugger.enable');
    await request('Runtime.runIfWaitingForDebugger');
    await until(() => paused, `${pkg.kind} pre-main breakpoint`);
    const injected = await request('Debugger.evaluateOnCallFrame', { callFrameId: paused.callFrames[0].callFrameId,
      expression: `require(${JSON.stringify(path.join(__dirname, 'native-demo-bootstrap.cjs'))}); Boolean(globalThis.__qa)`, returnByValue: true });
    assert.ok(!injected.exceptionDetails && injected.result.value === true, 'Isolation must load before main code');
    await request('Debugger.resume');
    await until(() => /DevTools listening on (ws:\/\/[^\s]+)/.test(stderr), `${pkg.kind} renderer startup`);
    browser = await chromium.connectOverCDP(stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);
    await until(() => browser.contexts()[0]?.pages().length, `${pkg.kind} native window`);
    const page = browser.contexts()[0].pages()[0];
    const evaluate = async expression => {
      const result = await request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error('Native main-process evaluation failed');
      return result.result.value;
    };
    return { page, evaluate, close };
  } catch (error) { await close(); throw error; }
}
function files(dir, relative = '') {
  return fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'No symlink release inputs');
    const name = path.join(relative, entry.name);
    return entry.isDirectory() ? files(dir, name) : [name];
  });
}
function verifyPackage(kind, appRoot, product, installerName) {
  const dir = releaseDist ? path.join(appRoot, 'dist') : path.join(builds, kind);
  const resources = path.join(dir, 'win-unpacked/resources');
  const archive = path.join(resources, 'app.asar');
  const installer = path.join(dir, installerName);
  const inputs = ['main.js', 'preload.js', ...files(path.join(appRoot, 'src')).map(f => path.join('src', f)),
    ...files(path.join(appRoot, 'assets')).map(f => path.join('assets', f))];
  if (kind === 'candidate') inputs.push('browser-extension/protocol.js');
  for (const file of inputs) assert.deepEqual(asar.extractFile(archive, path.normalize(file)), fs.readFileSync(path.join(appRoot, file)), `Stale packaged input: ${file}`);
  const archiveHash = hash(fs.readFileSync(archive));
  require(path.join(appRoot, 'scripts/release-artifact')).verifyInstallerArchive(installer, archiveHash);
  if (kind === 'candidate') for (const file of files(path.join(appRoot, 'browser-extension'))) {
    const expected = fs.readFileSync(path.join(appRoot, 'browser-extension', file));
    assert.deepEqual(fs.readFileSync(path.join(resources, 'browser-extension', file)), expected);
    const embedded = execFileSync(require('7zip-bin').path7za, ['e', '-so', installer, `resources\\browser-extension\\${file}`],
      { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.deepEqual(embedded, expected, `Installer extension resource: ${file}`);
  }
  const archiveFiles = asar.listPackage(archive);
  assert.ok(!archiveFiles.some(file => /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|microphone-test\.env|auth-session\.json|provider-review\.env|native-demo-bootstrap\.cjs)$/.test(file)), 'Private state/test bootstrap excluded');
  const config = JSON.parse(asar.extractFile(archive, path.normalize('src/config/runtime-config.json')));
  if (releaseDist) {
    const expected = process.env.TRUVEIL_EXPECTED_RELAY_URL;
    assert.ok(expected?.startsWith('wss://'), 'Release QA requires the expected public TLS relay');
    assert.equal(config.demoRelayUrl, expected, 'Packaged demo relay must match the operator-approved address');
  }
  assert.ok(!Object.keys(config).some(key => /secret|deepgram|groq|openai|openrouter|pangram|hostkey/i.test(key)));
  assert.ok(config.supabaseAnonKey?.startsWith('sb_publishable_') || JSON.parse(Buffer.from(config.supabaseAnonKey.split('.')[1], 'base64url')).role === 'anon');
  const sourceHash = require(path.join(appRoot, 'scripts/release-artifact')).sourceHash();
  return { kind, sourceHash, installer, installerSha256: hash(fs.readFileSync(installer)), archiveSha256: archiveHash,
    verifiedSourceFiles: inputs.length, executable: path.join(dir, 'win-unpacked', `${product}.exe`) };
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const packages = [verifyPackage('recruiter', path.join(root, 'recruiter-app'), 'Truveil', 'TruveilRecruiter-Setup-1.0.0.exe'),
    verifyPackage('candidate', candidateRoot, 'TruveilSecure', 'TruveilSecure-Setup-1.0.0.exe')];
  console.log('PASS: both installer archives match current source, including the browser extension.');
  const hostKey = crypto.randomBytes(32).toString('base64url');
  const relay = createDemoRelay({ hostKey, tokenProvider: async () => ({ accessToken: 'synthetic-qa-token', expiresIn: 30 }) });
  const { port } = await relay.listen(0);
  const relayUrl = `ws://127.0.0.1:${port}/demo`;
  const applications = [], errors = [], checks = [];
  const record = name => { checks.push(name); console.log(`PASS: ${name}`); };
  try {
    for (const pkg of packages) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), `truveil-final-${pkg.kind}-`));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|USERPROFILE|LOCALAPPDATA|APPDATA|HOMEDRIVE|HOMEPATH|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
      Object.assign(env, { TRUVEIL_APP_MODE: 'demo', TRUVEIL_DEMO_RELAY_URL: relayUrl, TRUVEIL_QA_PROFILE: profile,
        TRUVEIL_REVIEW_ENV_FILE: path.join(profile, 'absent-private-config.env') });
      const application = await launchPackage(pkg, profile, env);
      applications.push(application);
      console.log(`Started isolated packaged ${pkg.kind}.`);
      const page = application.page;
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      assert.equal(await application.evaluate('__qaApp.isPackaged'), true);
      assert.equal(await application.evaluate('__qaApp.getPath("userData")'), profile);
      assert.ok(await application.evaluate('Boolean(globalThis.__qa)'), 'Isolation bootstrap loaded before app');
      pkg.profile = profile;
      pkg.page = page;
    }
    const [host, candidate] = packages.map(p => p.page);
    record('Both actual packaged Windows executables start in isolated profiles');
    await host.locator('#demoHostCodeInput').waitFor();
    await host.locator('#recruiterGuideBody').filter({ hasText: 'private access code' }).waitFor();
    assert.equal(await host.locator('#auth-screen').isVisible(), false);
    assert.equal(await host.locator('.workspace-nav').isVisible(), false);
    await host.screenshot({ path: path.join(output, 'recruiter-access.png'), animations: 'disabled' });
    await host.locator('#demoHostCodeInput').fill('synthetic-invalid-host-code-000000000000000');
    await host.locator('#continueDemoBtn').click();
    await host.locator('#newSessionBtn').click();
    await host.locator('#demoHostCodeInput').waitFor();
    assert.match(await host.locator('#demoAccessMessage').textContent(), /Host access denied/);
    assert.equal(await host.locator('#demoHostCodeInput').inputValue(), '');
    assert.equal(await host.evaluate(() => currentSession), null);
    record('Actual loopback relay rejects a wrong host code and the packaged UI permits a clean retry');
    await host.locator('#demoHostCodeInput').fill(hostKey);
    await host.locator('#continueDemoBtn').click();
    await host.locator('#newSessionBtn').waitFor();
    assert.match(await host.locator('#recruiterGuideBody').textContent(), /New interview/);
    assert.equal(await host.evaluate(() => currentSession), null);
    await host.screenshot({ path: path.join(output, 'recruiter-workspace.png'), animations: 'disabled' });
    record('Host-code entry opens the workspace without creating a room or calling cloud sign-in');
    assert.equal(await candidate.locator('#externalReviewConsentInput').isChecked(), false);
    await host.locator('#openSettingsBtn').click();
    await host.locator('#transcriptSizeSelect').selectOption('large');
    await host.locator('#reduceMotionInput').check();
    await host.locator('#saveSettingsBtn').click();
    await host.locator('#settingsModal').waitFor({ state: 'hidden' });
    const settings = await host.evaluate(() => window.truveil.getSettings());
    assert.equal(settings.transcriptSize, 'large'); assert.equal(settings.reduceMotion, true);
    record('Settings save through real IPC in the isolated profile');
    await host.locator('#newSessionBtn').click();
    await host.waitForFunction(() => currentSession && !creatingSession);
    assert.equal(await host.locator('#demoHostCodeInput').inputValue(), '');
    assert.equal(await host.locator('#sessionServiceNotice').isVisible(), false);
    const code = await host.evaluate(() => currentSession.sessionId);
    const visibleCode = await host.locator('#sessionCode').textContent();
    assert.match(await host.locator('#recruiterGuideBody').textContent(), /Copy invitation/);
    const invitation = await host.evaluate(() => buildCandidateInviteMessage());
    assert.ok(invitation.body.includes(invitation.link) && invitation.body.includes(visibleCode));
    assert.ok(!invitation.body.includes(hostKey), 'Private access code is not part of the invitation');
    await candidate.locator('#setupGuide').filter({ hasText: 'Add your name' }).waitFor();
    record('Packaged Tavi guidance and full app-link invitation match the streamlined onboarding');
    assert.equal(visibleCode, code.replace(/^DEMO-/, 'TRV-'));
    assert.doesNotMatch(await host.locator('#candidateInviteMessage').inputValue(), /\bdemo\b/i);
    assert.equal(await host.locator('#restrictionsEnabledInput').isChecked(), false);
    assert.equal(await host.locator('#restrictionControls').isVisible(), false);
    await candidate.evaluate(() => {
      window.__audioTracks = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.__audioConstraints = constraints;
        const stream = await original(constraints);
        window.__audioTracks.push(...stream.getTracks());
        return stream;
      };
      window.WebSocket = class {
        static OPEN = 1;
        constructor(url, protocols) {
          if (!url.startsWith('wss://api.deepgram.com/')) throw new Error('Unexpected synthetic provider URL');
          if (protocols[0] !== 'bearer' || protocols[1] !== 'synthetic-qa-token') throw new Error('Incorrect speech credential protocol');
          this.readyState = 0; this.packets = 0; this.bytes = 0; window.__provider = this;
          setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 20);
        }
        send(data) { if (typeof data !== 'string') { this.packets++; this.bytes += data.byteLength; } }
        close() { this.readyState = 3; }
      };
    });
    await candidate.locator('#sessionCodeInput').fill(visibleCode);
    await candidate.locator('#candidateNameInput').fill('Synthetic Final QA');
    await candidate.evaluate(() => refreshMicrophones());
    const chosenMicrophone = await candidate.locator('#microphoneInput option').evaluateAll(options => options.find(option => option.value)?.value);
    assert.ok(chosenMicrophone, 'Fake-device QA exposes a selectable microphone');
    await candidate.locator('#microphoneInput').selectOption(chosenMicrophone);
    assert.equal(await candidate.evaluate(() => window.__audioTracks.length), 0, 'Listing sources never captures audio');
    for (const id of ['sessionConsentInput', 'tabObserveConsentInput', 'tabCloseConsentInput']) await candidate.locator('#' + id).check();
    await candidate.locator('#startBtn').click();
    assert.equal(await candidate.locator('#microphoneInput').isDisabled(), true);
    const constraints = await candidate.evaluate(() => window.__audioConstraints);
    assert.equal(constraints.video, false);
    assert.equal(constraints.audio.deviceId.exact, chosenMicrophone);
    assert.equal(constraints.audio.echoCancellation, true);
    record('Packaged candidate source selection stays microphone-only and requests echo cancellation');
    await host.locator('#approveDemoBtn').waitFor();
    await host.locator('#approveDemoBtn').click();
    await candidate.locator('#active-screen.active').waitFor();
    assert.equal(await candidate.evaluate(() => Boolean(window.__provider)), false);
    for (const id of ['noticeConfirmedInput', 'policyConfirmedInput', 'humanReviewConfirmedInput']) await host.locator('#' + id).check();
    await host.locator('#startMonitoringBtn').click();
    assert.equal(await host.evaluate(() => currentSession.policy.blocking_mode), 'none');
    assert.deepEqual(await host.evaluate(() => currentSession.policy.blocked_sites), []);
    await candidate.waitForFunction(() => window.__provider?.packets >= 5);
    record('Account-free approval and host Start produce real PCM worklet packets from a fake device');
    const speech = 'I built Truveil with a queue so every caption can appear quickly on both screens. We keep the draft separate from confirmed words, and review uncertain results before reaching any conclusions about the interview or the person speaking.';
    const inject = async final => candidate.evaluate(({ speech, final }) => {
      const now = Date.now();
      liveAudioStartedAt = now - 10000;
      liveEnergySamples = Array.from({ length: 100 }, (_, i) => ({ at: liveAudioStartedAt + i * 120, rms: .1, peak: .3 }));
      window.__provider.onmessage({ data: JSON.stringify({ type: 'Results', start: 0, duration: 10, is_final: final, speech_final: false,
        channel: { alternatives: [{ transcript: speech, confidence: .97,
          words: speech.split(' ').map((word, i) => ({ word, start: i * .2, end: i * .2 + .18, confidence: .97 })) }] } }) });
    }, { speech, final });
    const started = performance.now();
    await inject(false);
    await host.locator('.transcript-entry.interim .entry-text').filter({ hasText: speech }).waitFor();
    await candidate.locator('#captionDraft').filter({ hasText: speech }).waitFor();
    for (const page of [host, candidate]) await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const captionMs = performance.now() - started;
    await inject(true);
    await host.waitForFunction(() => document.querySelectorAll('.transcript-entry:not(.interim)').length > 0);
    await host.locator('.chunk-review-entry').first().waitFor();
    assert.match(await host.locator('#chunkReviewList').textContent(), /100/);
    const chunkTexts = await host.locator('.chunk-review-entry .chunk-review-text').allTextContents();
    assert.ok(chunkTexts.length > 0);
    assert.equal(chunkTexts.join(' '), speech);
    assert.ok(chunkTexts.every(text => text.trim().split(/\s+/).length <= 35));
    record('Injected interim and final captions travel through real IPC and loopback relay to both apps');
    await host.locator('#noteInput').fill('Synthetic test note: review the original context.');
    await host.locator('#addNoteBtn').click();
    await candidate.locator('#pairBrowserBtn').click();
    await candidate.locator('#browserPairing').waitFor();
    assert.match(await candidate.locator('#browserPairingCode').inputValue(), /.+/);
    await candidate.locator('#stopBrowserBtn').click();
    await candidate.locator('#openExtensionBtn').click();
    const openedResources = await applications[1].evaluate('globalThis.__qa.opened');
    assert.ok(openedResources.includes(path.join(path.dirname(packages[1].executable), 'resources/browser-extension')),
      'Installed extension folder resolves to the packaged resources');
    record('Packaged browser bridge pairs and revokes without observing any personal tabs');
    for (const [name, page] of [['recruiter', host], ['candidate', candidate]]) {
      await page.screenshot({ path: path.join(output, `${name}-packaged-session.png`), fullPage: true });
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        missing: [...document.images].filter(i => i.getBoundingClientRect().width && (!i.complete || !i.naturalWidth)).length }));
      assert.ok(layout.scroll <= layout.width + 1); assert.equal(layout.missing, 0);
    }
    await host.locator('#endSessionBtn').click();
    await candidate.locator('#ended-screen.active').waitFor();
    await until(() => fs.existsSync(path.join(packages[0].profile, 'reports')), 'local report file');
    const reportFiles = files(path.join(packages[0].profile, 'reports')).filter(f => f.endsWith('.html'));
    assert.equal(reportFiles.length, 1);
    const report = fs.readFileSync(path.join(packages[0].profile, 'reports', reportFiles[0]), 'utf8');
    assert.ok(report.includes('Truveil') && report.includes('Synthetic test note: review the original context.'));
    assert.ok(report.includes(speech), 'The actual confirmed answer is in the saved report');
    assert.match(report, /Captured transcript|Complete transcript|Full captured transcript/i);
    assert.ok(report.includes('Pattern evidence recorded') && /Window words: [3-9][0-9]/.test(report),
      'The real built-in checker analyzed a reliable-word response window');
    assert.ok(!report.includes(hostKey) && !report.includes('synthetic-qa-token'));
    assert.ok(report.includes('human') || report.includes('Human'));
    assert.ok(await candidate.evaluate(() => window.__audioTracks.every(track => track.readyState === 'ended')));
    await host.locator('#ended-screen.active').waitFor();
    await host.locator('#navReports').click();
    const saved = await host.evaluate(() => window.truveil.listReports());
    assert.equal(saved.length, 1);
    await host.locator('[data-delete-report]').click();
    assert.equal((await host.evaluate(() => window.truveil.listReports())).length, 1, 'First delete click only asks for confirmation');
    await host.locator('[data-cancel-delete]').click();
    assert.equal((await host.evaluate(() => window.truveil.listReports())).length, 1);
    await host.locator('[data-delete-report]').click();
    await host.locator('[data-delete-report]').click();
    await host.locator('#reportList .empty-state').waitFor();
    assert.equal((await host.evaluate(() => window.truveil.listReports())).length, 0);
    record('Built-in checker evidence and notes reach the real report; report deletion requires confirmation');
    await host.locator('#navNewSession').click();
    await host.locator('#newSessionBtn').click();
    await host.locator('#demoHostCodeInput').fill(hostKey);
    await host.locator('#continueDemoBtn').click();
    await host.locator('#newSessionBtn').click();
    await host.waitForFunction(() => currentSession && !creatingSession);
    await relay.close();
    await until(() => relay.stats.peers === 0, 'relay shutdown revokes peers');
    await host.locator('#cancelSetupBtn').click();
    await host.locator('#idle-screen.active').waitFor();
    assert.equal(await host.evaluate(() => currentSession), null);
    record('Relay loss revokes the room and the recruiter can cancel back to a clean start');
    for (const application of applications) {
      const state = await application.evaluate('globalThis.__qa');
      assert.deepEqual(state.errors, []);
      assert.equal(state.blockedNetwork, 0, 'No attempted external requests');
      assert.equal(state.blockedProcesses, 0, 'No attempted foreground/process monitoring');
    }
    assert.deepEqual(errors, []);
    for (const pkg of packages) delete pkg.page;
    const receipt = { checkedAt: new Date().toISOString(), passed: true, checks, packages,
      injectedResultToBothPaintsMs: captionMs, recognitionAndInternetLatencyExcluded: true,
      physicalMicrophoneRequests: 0, paidProviderCalls: 0, cloudCalls: 0, publication: false,
      notVerified: ['Installer wizard/registry installation', 'Hosted TLS relay', 'Two PCs on different Wi-Fi', 'Real speech accuracy and latency', 'Human acceptance'] };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(receipt, null, 2));
    console.log(`PASS: packaged flow; injected caption paint ${Math.round(captionMs)}ms (not speech latency).`);
  } finally {
    for (const application of applications.reverse()) await application.close().catch(() => {});
    await relay.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
