// Local-only integration: actual app code, synthetic media/provider, disposable Chromium tabs.
const { chromium } = require('C:/Users/kanag/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const candidateRoot = path.resolve(root, '../Truveil-Client');
const { loadMain } = require('../test/helpers/main-harness');
const { mainHarness } = require(path.join(candidateRoot, 'test/helpers/main-harness'));
const { createDemoRelay } = require('../../backend/demo/relay-server');
const { TabBridge, EXTENSION_ID } = require(path.join(candidateRoot, 'src/browser/tab-bridge'));
const guidedFlow = process.argv.includes('--guided-flow');
const outputName = process.argv.includes('--candidate-audio') ? 'candidate-audio' : guidedFlow ? 'guided-flow' : process.argv.includes('--ui-polish') ? 'sidebar-polish'
  : process.argv.includes('--session-policy') ? 'session-policy' : 'demo-rooms';
const output = path.join(root, 'output/playwright', outputName);
fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) {
  const deadline = Date.now() + 7000;
  while (!await check()) { if (Date.now() > deadline) throw new Error(`Timed out: ${description}`); await delay(20); }
}
async function bind(page, preload, invoke) {
  await page.exposeFunction('__invoke', invoke);
  await page.addInitScript({ content: `
    window.__events = {};
    window.require = () => ({ contextBridge: { exposeInMainWorld: (key, api) => window[key] = api },
      ipcRenderer: { invoke: (...args) => window.__invoke(...args), on: (name, callback) => (window.__events[name] ||= []).push(callback) } });
    ${fs.readFileSync(preload, 'utf8')}
    window.__syntheticMicrophones = 0;
    navigator.mediaDevices.enumerateDevices = async () => [
      {kind:'audioinput',deviceId:'synthetic-headset',label:'Synthetic candidate headset'},
      {kind:'videoinput',deviceId:'synthetic-camera',label:'Synthetic camera'}
    ];
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__syntheticAudioConstraints = constraints;
      window.__syntheticMicrophones++;
      const track = {readyState:'live', stop(){this.readyState='ended';},addEventListener(){}};
      return {getTracks:()=>[track],getAudioTracks:()=>[track]};
    };
    window.WebSocket = class { static OPEN=1; constructor(url) {this.url=url;this.readyState=1;window.__provider=this;} close(){this.readyState=3;} send(){throw new Error('Audio transmission forbidden in local QA');} };
  ` });
}

(async () => {
  const hostAccessCode = require('node:crypto').randomBytes(32).toString('base64url');
  const relay = createDemoRelay({ hostKey: hostAccessCode, tokenProvider: async () => ({ accessToken: 'synthetic-no-provider', expiresIn: 30 }) });
  const { port } = await relay.listen(0);
  const url = `ws://127.0.0.1:${port}/demo`;
  let browser, extension, host, candidate;
  const pending = new Set(), errors = [], results = [];
  let forbiddenRequests = 0;
  const emit = (page, channel, data) => {
    const work = page.evaluate(({channel,data}) => window.__events[channel]?.forEach(callback => callback({},data)), {channel,data});
    pending.add(work);
    work.then(() => pending.delete(work), error => { pending.delete(work); errors.push(error.message); });
  };
  const flush = async () => { while(pending.size) await Promise.all([...pending]); };
  async function screen(page, name) {
    for (const width of [1280, 1024, 800]) {
      await page.setViewportSize({width,height:800});
      await page.evaluate(() => { window.scrollTo(0,0); document.querySelector('.screen.active')?.scrollTo(0,0); });
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth,
        missingImages: [...document.images].filter(i => i.getBoundingClientRect().width && (!i.complete || !i.naturalWidth)).length }));
      assert.ok(layout.width <= width, `${name} overflow at ${width}`);
      assert.equal(layout.missingImages, 0);
      if (guidedFlow) {
        const guides = page.locator('.screen.active .tavi-guide, .screen.active .tavi-guidance');
        const count = await guides.count();
        assert.equal(count, name.startsWith('recruiter-') || ['candidate-setup','candidate-ended'].includes(name) ? 1 : 2, `${name} has contextual guidance`);
        for (const guide of await guides.all()) {
          const bounds = await guide.boundingBox();
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `${name} guide fits`);
          assert.ok((await guide.innerText()).length > 20, `${name} has useful guidance`);
        }
      }
      assert.doesNotMatch(await page.locator('body').innerText(), /\bdemo\b/i, `${name} visible wording`);
      await page.screenshot({path:path.join(output,`${name}-${width}.png`),fullPage:true,animations:'disabled'});
      results.push({screen:name,width,passed:true});
    }
  }
  try {
    browser = await chromium.launch({headless:true});
    const context = await browser.newContext();
    context.setDefaultTimeout(10000);
    await context.route(/^https?:/, route => { forbiddenRequests++; return route.abort(); });
    const recruiterPage = await context.newPage(), candidatePage = await context.newPage();
    for (const page of [recruiterPage,candidatePage]) page.on('pageerror', error => errors.push(error.message));
    host = loadMain({user:null,env:{TRUVEIL_APP_MODE:'demo',TRUVEIL_DEMO_RELAY_URL:url}});
    host.attachRenderer((channel,data) => emit(recruiterPage,channel,data));
    candidate = mainHarness({onEvent:(channel,data) => emit(candidatePage,channel,data), modules:{
      './src/demo/relay-client':require(path.join(candidateRoot,'src/demo/relay-client')), './src/browser/tab-bridge':{TabBridge}
    }});
    await bind(recruiterPage,path.join(root,'recruiter-app/preload.js'),(name,data)=>host.invoke(name,data));
    await bind(candidatePage,path.join(candidateRoot,'preload.js'),(name,data)=>candidate.handlers.get(name)({},data));
    await recruiterPage.goto(pathToFileURL(path.join(root,'recruiter-app/src/renderer/index.html')).href);
    await candidatePage.goto(pathToFileURL(path.join(candidateRoot,'src/renderer/index.html')).href);
    await recruiterPage.locator('#demoHostCodeInput').waitFor();
    assert.equal(await recruiterPage.locator('#auth-screen').isVisible(),false);
    assert.equal(await recruiterPage.locator('.workspace-nav').isVisible(),false);
    await screen(recruiterPage,'recruiter-access');
    await recruiterPage.locator('#demoHostCodeInput').fill(hostAccessCode);
    await recruiterPage.locator('#demoHostCodeInput').press('Enter');
    await recruiterPage.locator('#newSessionBtn').waitFor();
    assert.equal(host.inspect().activeSession,null);
    await screen(recruiterPage,'recruiter-idle');
    await candidatePage.evaluate(() => refreshMicrophones());
    await candidatePage.locator('#microphoneInput').selectOption('synthetic-headset');
    assert.equal(await candidatePage.locator('#microphoneInput option').count(),2);
    assert.equal(await candidatePage.evaluate(() => window.__syntheticMicrophones),0);
    await screen(candidatePage,'candidate-setup');
    await recruiterPage.locator('#newSessionBtn').click();
    await recruiterPage.waitForFunction(()=>currentSession && !creatingSession);
    assert.equal(await recruiterPage.locator('#demoHostCodeInput').inputValue(),'');
    assert.equal(await recruiterPage.locator('#sessionServiceNotice').isVisible(),false);
    const code=host.inspect().activeSession.sessionId;
    const displayCode=await recruiterPage.locator('#sessionCode').textContent();
    assert.equal(displayCode,code.replace(/^DEMO-/, 'TRV-'));
    assert.equal(await recruiterPage.locator('#restrictionsEnabledInput').isChecked(),false);
    assert.equal(await recruiterPage.locator('#restrictionControls').isVisible(),false);
    await screen(recruiterPage,'recruiter-open-policy');
    if (guidedFlow) {
      await recruiterPage.locator('#copyInviteMessageBtn').click();
      assert.match(await recruiterPage.locator('#recruiterGuideBody').innerText(), /Send the invitation you copied/);
      const invite = await recruiterPage.evaluate(() => buildCandidateInviteMessage());
      assert.ok(invite.body.includes(invite.link));
      assert.ok(!invite.body.includes(hostAccessCode));
      assert.equal(new URL(invite.link).searchParams.get('code'), displayCode);
      for (const id of ['noticeConfirmedInput','policyConfirmedInput','humanReviewConfirmedInput']) {
        assert.equal(await recruiterPage.locator('#'+id).isChecked(), false);
      }
    }
    await recruiterPage.locator('#restrictionsEnabledInput').check();
    await recruiterPage.locator('[data-blocked-site="chatgpt.com"]').check();
    await screen(recruiterPage,'recruiter-optional-restrictions');
    await recruiterPage.locator('#restrictionsEnabledInput').uncheck();
    await candidatePage.locator('#sessionCodeInput').fill(displayCode);
    await candidatePage.locator('#demoRelayInput').fill(url.replace(/\/demo$/, ''));
    await candidatePage.locator('#candidateNameInput').fill('Synthetic Interview Candidate');
    for(const id of ['sessionConsentInput','tabObserveConsentInput','tabCloseConsentInput']) await candidatePage.locator('#'+id).check();
    await candidatePage.evaluate(()=>{ startPcmStream=async()=>{}; startTranscriptStreaming=()=>startLiveTranscription(); });
    await candidatePage.locator('#startBtn').click();
    assert.deepEqual(await candidatePage.evaluate(() => window.__syntheticAudioConstraints), {
      video:false, audio:{deviceId:{exact:'synthetic-headset'},echoCancellation:true,noiseSuppression:true,
        autoGainControl:true,channelCount:{ideal:1}}
    });
    assert.equal(await candidatePage.locator('#microphoneInput').isDisabled(),true);
    await recruiterPage.locator('#approveDemoBtn').waitFor();
    assert.equal(candidate.run('monitoring'),false);
    await screen(recruiterPage,'recruiter-approve');
    await recruiterPage.locator('#approveDemoBtn').click();
    await candidatePage.locator('#active-screen.active').waitFor();
    await screen(candidatePage,'candidate-waiting');
    for(const id of ['noticeConfirmedInput','policyConfirmedInput','humanReviewConfirmedInput']) await recruiterPage.locator('#'+id).check();
    await recruiterPage.locator('#startMonitoringBtn').click();
    assert.equal(host.inspect().activeSession.policy.blocking_mode,'none');
    assert.deepEqual([...host.inspect().activeSession.policy.blocked_sites],[]);
    await candidatePage.waitForFunction(()=>window.__provider);
    await candidatePage.evaluate(()=>window.__provider.onopen());
    await candidatePage.evaluate(()=>{liveAudioStartedAt=Date.now();liveEnergySamples=Array.from({length:100},(_,i)=>({at:liveAudioStartedAt+i*120,rms:.1,peak:.3}));});
    const text='I built Truveil with a queue so each speech update can appear quickly on both screens. We keep the draft separate from the final words and review uncertain results before drawing conclusions about an interview or the person speaking.';
    const start=performance.now();
    const inject=async final=>candidatePage.evaluate(({text,final})=>window.__provider.onmessage({data:JSON.stringify({type:'Results',start:0,duration:10,is_final:final,speech_final:false,channel:{alternatives:[{transcript:text,confidence:.97,words:text.split(' ').map((word,i)=>({word,start:i*.2,end:i*.2+.18,confidence:.97}))}]}})}),{text,final});
    await inject(false);
    await recruiterPage.locator('.transcript-entry.interim .entry-text').filter({hasText:text}).waitFor();
    await candidatePage.locator('#captionDraft').filter({hasText:text}).waitFor();
    for(const page of [recruiterPage,candidatePage]) await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const captionLag=performance.now()-start;
    assert.ok(captionLag<1000,`Injected result took ${captionLag}ms`);
    await inject(true);
    await until(()=>host.inspect().sessionData.transcripts.length>0,'built-in checker input');
    await until(()=>host.inspect().sessionData.chunkReview?.summary.reviewedWords>=35,'chunk review in reliable context');
    await recruiterPage.locator('.chunk-review-entry').first().waitFor();
    const extensionPath=path.join(candidateRoot,'browser-extension');
    extension=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
    extension.setDefaultTimeout(10000);
    await extension.route(/^https?:/,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic demo tab</title><h1>Disposable local test page</h1>'}));
    const sample=await extension.newPage(); await sample.goto('https://example.test/one?private=not-forwarded');
    const other=await extension.newPage(); await other.goto('https://example.test/two');
    const meeting=await extension.newPage(); await meeting.goto('https://meet.google.com/synthetic');
    const worker=extension.serviceWorkers()[0] || await extension.waitForEvent('serviceworker');
    // Mint the short-lived pairing only after the disposable browser is ready.
    await candidatePage.locator('#pairBrowserBtn').click();
    await candidatePage.locator('#browserPairing').waitFor();
    const pairing=await candidatePage.locator('#browserPairingCode').inputValue();
    // Chromium action popups are not Playwright pages. Exercise the unchanged worker
    // entry point against real disposable tabs, with explicit synthetic consent.
    await worker.evaluate(async pairingCode=>{
      const window=await chrome.windows.getLastFocused();
      await sharing.share({pairingCode,windowId:window.id,observeConsent:true,closeConsent:true});
    },pairing);
    await until(()=>candidate.run('tabBridge.getState().connected'),'real extension pairing');
    await until(()=>host.run('browserTabs.tabs.filter(t=>t.hostname==="example.test").length===2'),'real browser inventory');
    await flush();
    assert.equal(JSON.stringify(host.run('browserTabs')).includes('not-forwarded'),false);
    const rows=recruiterPage.locator('.shared-tab-row');
    const meetingRow=rows.filter({hasText:'meet.google.com'});
    assert.equal(await meetingRow.locator('button').isDisabled(),true);
    const sidebarStability = await recruiterPage.evaluate(state => {
      const list = document.getElementById('sharedTabList');
      const originals = [...list.children];
      const focused = originals.find(row=>!row.querySelector('button').disabled).querySelector('button');
      focused.focus();
      const start = performance.now();
      for(let i=0;i<100;i++)renderSharedTabs(state);
      const elapsedMs=performance.now()-start;
      const retainedRows=[...list.children].every((row,index)=>row===originals[index]);
      const retainedFocus=document.activeElement===focused;
      renderSharedTabs({...state,tabs:[...state.tabs].reverse()});
      const reorderedFocus=document.activeElement===focused;
      renderSharedTabs(state);
      return { updateCount:100, elapsedMs,retainedRows,retainedFocus,reorderedFocus,
        restoredOrderFocus:document.activeElement===focused };
    },host.run('browserTabs'));
    assert.equal(sidebarStability.retainedRows,true);
    assert.equal(sidebarStability.retainedFocus,true);
    assert.equal(sidebarStability.reorderedFocus,true);
    assert.equal(sidebarStability.restoredOrderFocus,true);
    await recruiterPage.locator('#sharedTabsPanel').scrollIntoViewIfNeeded();
    const tabStart=performance.now();
    const latencyTab=await extension.newPage();await latencyTab.goto('https://latency.example.test/synthetic');
    await recruiterPage.locator('.shared-tab-host').filter({hasText:'latency.example.test'}).waitFor();
    await recruiterPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const tabOpenedToSidebarMs=performance.now()-tabStart;
    assert.ok(tabOpenedToSidebarMs<1500,`Synthetic local tab delivery took ${tabOpenedToSidebarMs}ms`);
    await recruiterPage.setViewportSize({width:1280,height:800});
    await recruiterPage.locator('#sharedTabsPanel').scrollIntoViewIfNeeded();
    await recruiterPage.locator('#sharedTabsPanel').screenshot({path:path.join(output,'shared-tab-sidebar.png'),animations:'disabled'});
    await screen(recruiterPage,'recruiter-session');
    await screen(candidatePage,'candidate-session');
    recruiterPage.on('dialog',dialog=>dialog.accept());
    const before=extension.pages().filter(page=>page.url().startsWith('https://example.test/'));
    await rows.filter({hasText:'example.test'}).first().locator('button').click();
    await recruiterPage.locator('#tabCloseStatus').filter({hasText:'The selected tab was closed.'}).waitFor();
    assert.equal(before.filter(page=>page.isClosed()).length,1,'only the exact chosen same-host tab closes');
    assert.equal(meeting.isClosed(),false);
    await worker.evaluate(()=>sharing.stop());
    await until(()=>!host.run('browserTabs.connected'),'revocation on both apps');
    await flush();
    assert.equal(await recruiterPage.locator('.shared-tab-row button').count(),0);
    await candidatePage.evaluate(()=>failLiveTranscription('WS_CLOSED',{closeCode:1006}));
    assert.match(await candidatePage.locator('#audioState').textContent(), /speech connection closed \(1006\)/);
    assert.equal(await candidatePage.locator('#retrySpeechBtn').isDisabled(),true);
    await screen(candidatePage,'candidate-caption-recovery');
    assert.equal(await candidatePage.locator('#captionState').textContent(),'Live captions unavailable');
    await recruiterPage.locator('#endSessionBtn').click();
    await candidatePage.locator('#ended-screen.active').waitFor();
    if (guidedFlow) {
      await screen(recruiterPage,'recruiter-ended');
      await screen(candidatePage,'candidate-ended');
      await recruiterPage.locator('#navReports').click();
      await screen(recruiterPage,'recruiter-reports');
    }
    await flush();
    assert.equal(candidate.run('monitoring'),false);
    assert.equal(forbiddenRequests,0);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:true,
      mode:'Local loopback relay, actual app main/preload/renderers, disposable real Chromium extension. Synthetic media/provider, no physical microphone or external provider.',
      results, injectedResultToBothPaintsMs:captionLag,tabOpenedToSidebarMs,sidebarStability,
      chunkReview:true,exactSameHostTabClose:true,protectedMeetingTab:true,consentRevocation:true,guidedFlow,
      physicalMicrophoneRequests:0,providerCalls:0,cloudCalls:0,notVerified:['Hosted TLS relay','Different Wi-Fi PCs','Actual speech accuracy','New installer packaging','Native extension action-popup delivery; worker entry tested directly']},null,2));
    console.log(`PASS: ${results.length} rendered viewport checks, real disposable extension close/revoke, captions ${Math.round(captionLag)}ms (recognition/network excluded).`);
  } finally {
    await candidate?.run('cleanupSession({failedJoin:true})');
    await host?.run('closeRealtimeSession()');
    await flush().catch(()=>{});
    await extension?.close(); await browser?.close(); await relay.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
