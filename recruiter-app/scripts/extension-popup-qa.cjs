'use strict';

// Local-only native action-popup QA. No app sources or sender checks are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('C:/Users/kanag/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '../..');
const candidateRoot = path.resolve(root, '../Truveil-Client');
const { TabBridge, EXTENSION_ID } = require(path.join(candidateRoot, 'src/browser/tab-bridge'));
const WebSocket = require(path.join(candidateRoot, 'node_modules/ws'));
const extensionPath = path.join(candidateRoot, 'browser-extension');
const outputRoot = path.join(root, 'output/playwright/extension-popup');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'));
const profile = path.join(output, 'disposable-profile');
const headed = process.argv.includes('--headed');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = { checkedAt: new Date().toISOString(), passed: false, headed, checks: [], findings: [], targets: [],
  boundary: 'Fresh disposable Chromium profile, unchanged extension, actual loopback TabBridge. No microphone, providers, relay, app renderer, installer, deployment, or personal browser.',
  notVerified: ['Installed Google Chrome', 'Physical toolbar mouse click', 'Native Electron apps', 'Installer packaging', 'Cross-PC relay', 'Physical microphone'] };
const protectedFiles = [...fs.readdirSync(extensionPath).filter(name => /\.(js|json|html|css)$/.test(name)).map(name => path.join(extensionPath, name)), path.join(candidateRoot, 'src/browser/tab-bridge.js')];
const hashes = () => Object.fromEntries(protectedFiles.map(file => [path.relative(candidateRoot, file), crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
evidence.sourceHashesBefore = hashes();
function check(name, value = true) { assert.ok(value, name); evidence.checks.push(name); console.log(`PASS: ${name}`); }
async function until(predicate, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await predicate(); if (result) return result; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}

// A raw flattened CDP connection can attach to native popup targets that Playwright omits.
async function connectCDP(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(`${item.method}: ${message.error.message}`));
    else item.resolve(message.result);
  });
  socket.on('close', () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('CDP closed')); }
    pending.clear();
  });
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
        pending.set(id, { resolve, reject, timer, method });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { socket.close(); }
  };
}

(async () => {
  let child, cdp, worker, sessionId, workerSession;
  const updates = [];
  const bridge = new TabBridge({ onUpdate: state => updates.push(state) });
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Permissions-Policy': 'microphone=(), camera=()' });
    res.end('<!doctype html><title>Disposable popup QA</title><h1>Local synthetic tab</h1>');
  });
  try {
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const localUrl = `http://127.0.0.1:${fixture.address().port}`;
    fs.mkdirSync(profile, { recursive: true });
    child = spawn(chromium.executablePath(), [
        ...(headed ? [] : ['--headless=new']), `--user-data-dir=${profile}`,
        `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
        '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
        '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost;[::1]',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
        '--disable-quic', '--disable-background-networking', '--disable-component-update',
        '--disable-sync', '--disable-default-apps', '--disable-domain-reliability',
        '--disable-features=MediaRouter,OptimizationHints', '--password-store=basic',
        '--no-first-run', '--no-default-browser-check', '--window-size=1000,760', 'about:blank'
      ], { stdio: 'ignore', windowsHide: true });
    child.on('error', error => { evidence.launchError = error.message; });
    const portFile = path.join(profile, 'DevToolsActivePort');
    await until(() => fs.existsSync(portFile), 'owned browser CDP endpoint');
    const [port, endpoint] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    cdp = await connectCDP(`ws://127.0.0.1:${port}${endpoint}`);
    evidence.browser = await cdp.send('Browser.getVersion');
    console.log(`Owned browser ready: ${evidence.browser.product}`);
    await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied' });
    await cdp.send('Browser.setPermission', { permission: { name: 'camera' }, setting: 'denied' });
    const workerTarget = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(item => item.type === 'service_worker' && item.url === `chrome-extension://${EXTENSION_ID}/service-worker.js`), 'extension worker');
    workerSession = (await cdp.send('Target.attachToTarget', { targetId: workerTarget.targetId, flatten: true })).sessionId;
    await cdp.send('Runtime.enable', {}, workerSession);
    worker = { async evaluate(fn) {
      const result = await cdp.send('Runtime.evaluate', { expression: `(${fn.toString()})()`, returnByValue: true, awaitPromise: true }, workerSession);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    } };
    await until(() => worker.evaluate(() => Boolean(globalThis.chrome?.runtime?.onMessage)), 'extension runtime initialized');
    check('Expected unchanged extension service worker loaded', await worker.evaluate(() => chrome.runtime.id) === EXTENSION_ID);
    // Passive observation only: no response, no altered guard, and no pairing-code capture.
    await worker.evaluate(() => {
      globalThis.__popupQaSenders = [];
      chrome.runtime.onMessage.addListener((message, sender) => {
        __popupQaSenders.push({ type: message?.type, id: sender.id, url: sender.url, hasTab: Boolean(sender.tab) });
      });
    });
    const initialTabs = (await cdp.send('Target.getTargets')).targetInfos.filter(item => item.type === 'page');
    assert.equal(initialTabs.length, 1, 'fresh browser starts with one synthetic blank tab');
    const first = initialTabs[0];
    const firstSession = (await cdp.send('Target.attachToTarget', { targetId: first.targetId, flatten: true })).sessionId;
    await cdp.send('Page.navigate', { url: `${localUrl}/one?private=never-forward-this` }, firstSession);
    const second = await cdp.send('Target.createTarget', { url: `${localUrl}/two` });
    await until(async () => (await worker.evaluate(() => chrome.tabs.query({}))).filter(tab => tab.status === 'complete' && tab.url.startsWith('http://127.0.0.1:')).length === 2, 'two completed local fixture tabs');
    async function evaluate(expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description || ''));
      return result.result.value;
    }
    async function click(selector) {
      const point = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: e.disabled }; })()`);
      assert.equal(point.disabled, false, `${selector} must be enabled`);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId);
    }
    async function snapshot(name) {
      const state = await evaluate(`({status:document.querySelector('#status').textContent,error:document.querySelector('#error').textContent,codeEmpty:document.querySelector('#pairing-code').value==='',observe:document.querySelector('#observe').checked,close:document.querySelector('#close').checked,observeDisabled:document.querySelector('#observe').disabled,closeDisabled:document.querySelector('#close').disabled,shareDisabled:document.querySelector('#share').disabled,stopDisabled:document.querySelector('#stop').disabled,viewport:{width:innerWidth,height:innerHeight},scroll:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}})`);
      evidence[name] = state;
      if (!state.codeEmpty) {
        state.screenshotOmitted = 'Pairing-code draft is nonempty';
        return state;
      }
      try {
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
        fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
      } catch (error) { evidence.screenshotGap = error.message; }
      return state;
    }
    function checkConsent(name, state) {
      const authoritative = bridge.getState();
      check(`${name}: checked state matches actual bridge consent`, state.observe === authoritative.observeConsent && state.close === authoritative.closeConsent);
      check(`${name}: consent controls match active state`, state.observeDisabled === authoritative.observeConsent && state.closeDisabled === authoritative.observeConsent);
    }
    async function waitForPolls() {
      const count = await worker.evaluate(() => __popupQaSenders.filter(sender => sender.type === 'state').length);
      await until(async () => await worker.evaluate(() => __popupQaSenders.filter(sender => sender.type === 'state').length) >= count + 2, 'two actual interval state polls');
    }
    async function closePopup() {
      await evaluate('window.close()');
      await until(async () => !(await cdp.send('Target.getTargets')).targetInfos.some(item => item.url === `chrome-extension://${EXTENSION_ID}/popup.html`), 'native popup closed');
    }
    async function openPopup(label) {
      await worker.evaluate(async () => {
        const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        await chrome.windows.update(window.id, { focused: true });
        await chrome.action.openPopup({ windowId: window.id });
      });
      const target = await until(async () => {
        const { targetInfos } = await cdp.send('Target.getTargets');
        evidence.targets = targetInfos.map(({ targetId, type, url }) => ({ targetId, type, url }));
        return targetInfos.find(item => item.url === `chrome-extension://${EXTENSION_ID}/popup.html`);
      }, `${label}: native popup target`);
      evidence.popupTarget = target;
      const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      sessionId = attached.sessionId;
      await cdp.send('Runtime.enable', {}, sessionId);
      await until(() => evaluate("Boolean(document.querySelector('#share'))"), 'popup document');
      const identity = await evaluate(`(async () => ({href:location.href,currentTab:await chrome.tabs.getCurrent() || null,contexts:await chrome.runtime.getContexts({contextTypes:['POPUP']})}))()`);
      evidence.popupIdentity = identity;
      check(`${label}: native POPUP context, not extension tab`, identity.currentTab === null && identity.contexts.some(item => item.contextType === 'POPUP' && item.documentUrl === identity.href));
      evidence.popupTargetType = target.type;
      return target;
    }

    await openPopup('Initial open');
    await until(() => evaluate("document.querySelector('#status').textContent === 'Not sharing'"), 'initial real state message');
    await snapshot('initial');
    const pairing = await bridge.start({ sessionId: 'native-popup-local-qa', observeConsent: true, closeConsent: true });
    await click('#pairing-code');
    await cdp.send('Input.insertText', { text: pairing.pairingCode }, sessionId);
    await click('#observe');
    await click('#close');
    await waitForPolls();
    const draft = await snapshot('idle-draft');
    check('Idle checked drafts survive actual interval polling without opting in', draft.observe && draft.close && !draft.codeEmpty && !bridge.getState().connected);
    await click('#observe');
    await waitForPolls();
    const uncheckedDraft = await snapshot('idle-unchecked-draft');
    check('Idle unchecked observation stays unchecked across polling', !uncheckedDraft.observe && uncheckedDraft.close && !uncheckedDraft.codeEmpty && !bridge.getState().connected);
    check('Idle polling sends no share request', await worker.evaluate(() => __popupQaSenders.every(sender => sender.type === 'state')));
    await click('#observe');
    await click('#share');
    await until(() => bridge.getState().connected && bridge.getState().tabs.length === 2, 'actual TabBridge connection and inventory');
    await until(() => evaluate("document.querySelector('#status').textContent.includes('2 tabs. Closing permitted.')"), 'connected popup status');
    const connected = await snapshot('connected');
    checkConsent('Connected popup', connected);
    check('Real popup submit connected actual TabBridge with both explicit consents', bridge.getState().observeConsent && bridge.getState().closeConsent);
    check('Popup clears pairing code and disables sharing fields while connected', connected.codeEmpty && connected.shareDisabled && !connected.stopDisabled);
    check('Inventory contains only the two disposable loopback hostnames', bridge.getState().tabs.every(tab => tab.hostname === '127.0.0.1'));
    check('Bridge updates contain no full fixture path or query', !JSON.stringify(updates).includes('never-forward-this') && !JSON.stringify(updates).includes('/one'));
    await closePopup();
    await openPopup('Reopened');
    await until(() => evaluate("document.querySelector('#status').textContent.includes('2 tabs. Closing permitted.')"), 'reopened popup real state response');
    const reopened = await snapshot('reopened');
    checkConsent('Reopened popup', reopened);
    check('Native popup reopen restores live connected state from worker');

    bridge.setConsent({ observeConsent: true, closeConsent: false });
    await until(() => evaluate("document.querySelector('#status').textContent.includes('2 tabs. Observe only.')"), 'remote close-consent revocation reflected');
    checkConsent('Remote close revocation', await snapshot('remote-close-revoked'));
    await closePopup();
    await openPopup('Observe-only reopened');
    await until(() => evaluate("document.querySelector('#status').textContent.includes('2 tabs. Observe only.')"), 'observe-only reopen');
    checkConsent('Observe-only reopened popup', await snapshot('observe-only-reopened'));

    bridge.setConsent({ observeConsent: false, closeConsent: false });
    await until(() => evaluate("document.querySelector('#stop').disabled && !document.querySelector('#share').disabled"), 'remote full revocation reflected');
    checkConsent('Remote full revocation', await snapshot('remote-revoked'));
    check('Remote full revocation disconnects and clears inventory', !bridge.getState().connected && bridge.getState().tabs.length === 0);

    const observeOnlyPairing = await bridge.start({ sessionId: 'native-popup-observe-only', observeConsent: true, closeConsent: true });
    await click('#pairing-code');
    await cdp.send('Input.insertText', { text: observeOnlyPairing.pairingCode }, sessionId);
    await click('#observe');
    await waitForPolls();
    const nextDraft = await snapshot('post-revocation-idle-draft');
    check('New observe-only idle draft survives polling after revocation', nextDraft.observe && !nextDraft.close && !nextDraft.codeEmpty && !bridge.getState().connected);
    await click('#share');
    await until(() => bridge.getState().connected && bridge.getState().tabs.length === 2, 'explicit observe-only re-pair');
    await until(() => evaluate("document.querySelector('#status').textContent.includes('2 tabs. Observe only.')"), 'observe-only connected status');
    checkConsent('Explicit observe-only connection', await snapshot('observe-only-connected'));
    check('Unchecked idle closing consent is not granted by pairing or polling', !bridge.getState().closeConsent);
    await click('#stop');
    await until(() => !bridge.getState().connected && !bridge.getState().observeConsent && bridge.getState().tabs.length === 0, 'popup stop revokes bridge');
    await until(() => evaluate("document.querySelector('#status').textContent === 'Not sharing'"), 'stopped popup status');
    const stopped = await snapshot('stopped');
    checkConsent('Stopped popup', stopped);
    check('Real popup stop revokes actual TabBridge and clears inventory');
    check('Stop resets fields and controls', stopped.codeEmpty && !stopped.observe && !stopped.close && !stopped.shareDisabled && stopped.stopDisabled);
    evidence.senders = await worker.evaluate(() => globalThis.__popupQaSenders);
    for (const type of ['state', 'share', 'stop']) check(`Native ${type} message has expected sender URL/id and no sender.tab`, evidence.senders.some(sender => sender.type === type && sender.id === EXTENSION_ID && sender.url === `chrome-extension://${EXTENSION_ID}/popup.html` && !sender.hasTab));
    const remaining = (await cdp.send('Target.getTargets')).targetInfos.map(target => target.targetId);
    check('Fixture tabs remain open after popup stop', remaining.includes(first.targetId) && remaining.includes(second.targetId));
    evidence.bridgeUpdates = updates;
    evidence.messageDeliveryPassed = true;
    evidence.passed = true;
  } catch (error) {
    evidence.error = { message: error.message, stack: error.stack };
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    evidence.networkBoundary = 'All fixture content on loopback; external proxy points to closed loopback port 9; non-loopback DNS mapped to NOTFOUND; QUIC and background networking disabled. No packet-capture claim.';
    await bridge.stop();
    await cdp?.send('Browser.close').catch(() => {});
    cdp?.close();
    if (child && child.exitCode === null) {
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
      if (child.exitCode === null) child.kill();
    }
    await new Promise(resolve => fixture.close(resolve));
    evidence.sourceHashesAfter = hashes();
    evidence.productionSourcesUnchanged = JSON.stringify(evidence.sourceHashesBefore) === JSON.stringify(evidence.sourceHashesAfter);
    if (!evidence.productionSourcesUnchanged) { evidence.passed = false; process.exitCode = 1; }
    const resolvedProfile = path.resolve(profile);
    assert.ok(resolvedProfile.startsWith(path.resolve(outputRoot) + path.sep) && path.basename(resolvedProfile) === 'disposable-profile');
    try { fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
    catch (error) { evidence.cleanupError = error.message; evidence.passed = false; process.exitCode = 1; }
    evidence.disposableProfileRemoved = !fs.existsSync(resolvedProfile);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2));
    console.log(`${evidence.passed ? 'PASS' : 'INCOMPLETE'}: ${output}`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
