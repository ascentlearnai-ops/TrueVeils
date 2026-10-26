const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { parseHTML } = require('linkedom');
const { loadMain } = require('./helpers/main-harness');

const words = 'I checked the logs and then reproduced the issue on my machine before changing the cache configuration because it was important to understand why the requests were failing for some users and not the others.';
const base = {
  sessionId: 'TRV-ABC234', captionStreamId: 'join-one', streamEpoch: 1,
  revision: 1, sequence: 1, segmentId: 'span-1', utteranceId: 1,
  text: words, transcriptConfidence: 0.95, lowConfidenceWordRatio: 0,
  source: 'deepgram-live', finalReason: 'segment_final', timestamp: 10000,
  startedAt: 1000, endedAt: 9000, durationMs: 8000, interim: false
};

async function setup(options = {}) {
  const app = loadMain({ deferCaptionAnalysis: true, ...options });
  const events = [];
  app.attachRenderer((channel, payload) => events.push({ channel, payload }));
  await app.invoke('session:create', { candidateName: 'Synthetic', role: 'Engineer' });
  const deliver = patch => app.broadcasts.get('candidate_transcript')({ payload: { ...base, ...patch } });
  const start = async () => { app.event({ type: 'candidate_ready' }); await app.invoke('session:start'); };
  return { app, events, deliver, start };
}

test('final caption is delivered and retained before any checker work, including one-letter speech', async () => {
  const order = [];
  const { app, deliver, start } = await setup({ analyzeTranscript: () => { order.push('analysis'); return { score: 12, scorable: true }; } });
  app.attachRenderer((event) => { if (event === 'realtime:caption') order.push('caption'); });
  await start();
  deliver();
  deliver({ text: 'I', segmentId: 'span-2', revision: 2, sequence: 2 });
  assert.deepEqual(order, ['caption', 'caption']);
  assert.equal(app.inspect().sessionData.transcripts.length, 2);
  assert.equal(app.inspect().sessionData.transcripts[0].analysisPending, true);
  app.flushCaptionAnalysis();
  assert.deepEqual(order, ['caption', 'caption', 'analysis']);
  assert.equal(app.inspect().sessionData.transcripts[1].scorable, false);
  await app.invoke('session:end');
});

test('caption boundary rejects wrong sessions, invalid or oversized metadata and pre-start speech', async () => {
  const { app, events, deliver, start } = await setup();
  deliver();
  assert.equal(events.filter(e => e.channel === 'realtime:caption').length, 0);
  await start();
  for (const patch of [
    { sessionId: 'TRV-WRONG1' }, { sessionId: undefined }, { captionStreamId: 'x'.repeat(201) },
    { revision: 0 }, { revision: 1.5 }, { revision: Infinity }, { streamEpoch: -1 },
    { segmentId: {} }, { text: {} }, { text: 'x'.repeat(16001) }, { startedAt: Infinity },
    { endedAt: -1 }, { sequence: Number.MAX_SAFE_INTEGER + 1 }, { interim: 'false' },
    { revision: 2147483648 }, { sequence: 2147483648 }
  ]) deliver(patch);
  assert.equal(events.filter(e => e.channel === 'realtime:caption').length, 0);
  deliver({ extraUntrustedField: { anything: 'not forwarded' } });
  const accepted = events.find(e => e.channel === 'realtime:caption').payload;
  assert.equal(accepted.extraUntrustedField, undefined);
  assert.equal(accepted.captionStreamId, 'join-one');
  assert.equal(accepted.revision, 1);
  assert.ok(Number.isFinite(accepted.captionReceivedAt));
  app.flushCaptionAnalysis();
  await app.invoke('session:end');
});

test('stale interim filtering is independent of out-of-order final deduplication', async () => {
  const { app, events, deliver, start } = await setup();
  await start();
  deliver({ text: 'new draft', interim: true, revision: 8, segmentId: 'draft' });
  deliver({ text: 'old draft', interim: true, revision: 7 });
  deliver({ text: 'second', revision: 6, sequence: 2, segmentId: 'span-2', startedAt: 2000 });
  deliver({ text: 'first', revision: 5, sequence: 1, segmentId: 'span-1', startedAt: 1000 });
  deliver({ text: 'first', revision: 9, sequence: 1, segmentId: 'span-1', startedAt: 1000 });
  deliver({ text: '', captionClear: true, interim: true, revision: 10 });
  deliver({ text: 'new draft', interim: true, revision: 8 });
  assert.equal(events.filter(e => e.channel === 'realtime:caption').length, 4);
  assert.deepEqual(Array.from(app.inspect().sessionData.transcripts, e => e.text), ['first', 'second']);
  app.flushCaptionAnalysis();
  assert.equal(app.inspect().sessionData.scores.length, 0);
  await app.invoke('session:end');
});

test('new joins namespace finals and retire old draft streams; reconnects cannot roll back epoch', async () => {
  const { app, events, deliver, start } = await setup();
  await start();
  deliver({ text: 'first' });
  deliver({ text: 'rejoined', captionStreamId: 'join-two' });
  deliver({ text: 'retired', captionStreamId: 'join-one', revision: 20, interim: true });
  deliver({ text: 'reconnected', captionStreamId: 'join-two', revision: 2, streamEpoch: 2, interim: true });
  deliver({ text: 'old connection', captionStreamId: 'join-two', revision: 3, streamEpoch: 1, interim: true });
  assert.deepEqual(events.filter(e => e.channel === 'realtime:caption').map(e => e.payload.text), ['first', 'rejoined', 'reconnected']);
  assert.equal(app.inspect().sessionData.transcripts.length, 2);
  app.flushCaptionAnalysis();
  await app.invoke('session:end');
});

test('queued analysis is cancelled on end and cannot affect the next session', async () => {
  let analyzed = 0;
  const { app, events, deliver, start } = await setup({ analyzeTranscript: () => { analyzed++; return { score: 40, scorable: true }; } });
  await start();
  deliver();
  const oldOwner = app.inspect().sessionData;
  await app.invoke('session:end');
  await app.invoke('session:create', { candidateName: 'New session', role: 'Engineer' });
  app.flushCaptionAnalysis();
  assert.equal(analyzed, 0);
  assert.equal(oldOwner.transcripts.length, 1);
  assert.equal(oldOwner.transcripts[0].analysisPending, false);
  assert.equal(oldOwner.transcripts[0].scorable, false);
  assert.match(oldOwner.transcripts[0].reasoning, /ended/i);
  assert.equal(app.inspect().sessionData.transcripts.length, 0);
  assert.equal(events.filter(e => e.channel === 'realtime:transcript').length, 0);
  await app.invoke('session:cancel');
});

test('checker exceptions preserve final captions as unscorable and do not stop subsequent captions', async () => {
  let analyzed = 0;
  const { app, deliver, start } = await setup({ analyzeTranscript: () => { if (++analyzed === 1) throw new Error('Synthetic failure'); return { score: 12, scorable: true }; } });
  await start();
  deliver();
  app.flushCaptionAnalysis();
  assert.equal(app.inspect().sessionData.transcripts[0].analysisPending, false);
  assert.equal(app.inspect().sessionData.transcripts[0].scorable, false);
  assert.match(app.inspect().sessionData.transcripts[0].reasoning, /unavailable/i);
  deliver({ revision: 2, segmentId: 'span-2', sequence: 2, startedAt: 9000, endedAt: 17000 });
  app.flushCaptionAnalysis();
  assert.equal(app.inspect().sessionData.transcripts[1].scorable, true);
  assert.equal(app.inspect().sessionData.scores.length, 1);
  await app.invoke('session:end');
});

test('incremental stable spans retain the 35 reliable-word gate and never score interims', async () => {
  const seen = [];
  const { app, deliver, start } = await setup({ analyzeTranscript: (text, context) => { seen.push({ text, context }); return { score: 12, scorable: true }; } });
  await start();
  deliver({ interim: true, text: words, revision: 1 });
  const parts = words.split(' ');
  parts.slice(0, 34).forEach((text, i) => deliver({ text, revision: i + 2, sequence: i + 1, segmentId: `short-${i}`, startedAt: 1000 + i * 100, endedAt: 1100 + i * 100, durationMs: 100 }));
  app.flushCaptionAnalysis();
  assert.equal(seen.length, 0);
  deliver({ text: parts[34], revision: 36, sequence: 35, segmentId: 'short-34', startedAt: 4400, endedAt: 4500, durationMs: 100 });
  app.flushCaptionAnalysis();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, parts.slice(0, 35).join(' '));
  assert.equal(seen[0].context.responseWindowWordCount, 35);
  deliver({ text: words, revision: 37, sequence: 36, segmentId: 'uncertain', transcriptConfidence: 0.2 });
  app.flushCaptionAnalysis();
  assert.equal(seen.length, 1);
  assert.equal(app.inspect().sessionData.transcripts.at(-1).scorable, false);
  await app.invoke('session:end');
});

async function setupUI(options = {}) {
  const root = path.resolve(__dirname, '..');
  const events = new EventEmitter();
  const app = loadMain({ deferCaptionAnalysis: true, ...options });
  const { window, document } = parseHTML(fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8'));
  for (const select of document.querySelectorAll('select')) Object.defineProperty(select, 'value', { value: select.querySelector('option')?.value || '', writable: true });
  app.attachRenderer((channel, payload) => events.emit(channel, {}, payload));
  vm.runInNewContext(fs.readFileSync(path.join(root, 'preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (name, api) => { window[name] = api; } }, ipcRenderer: { invoke: app.invoke, on: events.on.bind(events) } })
  });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/session/presentation.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/renderer/dashboard.js'), 'utf8'), {
    window, document, URL, console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
  });
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  await flush();
  document.getElementById('newSessionBtn').click(); await flush();
  app.event({ type: 'candidate_ready' });
  for (const id of ['noticeConfirmedInput', 'policyConfirmedInput', 'humanReviewConfirmedInput']) document.getElementById(id).checked = true;
  document.getElementById('startMonitoringBtn').click(); await flush();
  return {
    app, window, document, events, flush,
    deliver: patch => app.broadcasts.get('candidate_transcript')({ payload: { ...base, ...patch } }),
    finalTexts: () => Array.from(document.querySelectorAll('.transcript-entry:not(.interim) .entry-text'), e => e.textContent),
    draft: () => document.querySelector('.interim .entry-text')?.textContent,
    count: () => Number(document.getElementById('transcriptCount').textContent)
  };
}

test('actual main/preload/DOM paints pending text before slow checker invocation then updates it once', async () => {
  let ui;
  ui = await setupUI({ analyzeTranscript: () => {
    assert.deepEqual(ui.finalTexts(), [words]);
    assert.match(ui.document.querySelector('.entry-score').textContent, /pending/i);
    const until = performance.now() + 30;
    while (performance.now() < until) { /* Simulated synchronous checker work. */ }
    return { score: 20, scorable: true, scoreWeight: 1, reasoning: 'Synthetic review' };
  } });
  ui.deliver();
  assert.deepEqual(ui.finalTexts(), [words]);
  assert.equal(ui.count(), 1);
  ui.app.flushCaptionAnalysis();
  assert.equal(ui.count(), 1);
  assert.equal(ui.document.querySelectorAll('.transcript-entry').length, 1);
  assert.match(ui.document.querySelector('.entry-score').textContent, /Experimental/);
  assert.ok(Number(ui.document.querySelector('.transcript-entry').dataset.captionRenderDelayMs) < 1000);
  await ui.app.invoke('session:end');
});

test('30-word review chunks wait for reliable context without delaying raw captions or double-counting session scores', async () => {
  const ui = await setupUI();
  const text = words.split(' ');
  const first = text.concat(text).slice(0, 30).join(' ');
  const second = text.concat(text).slice(30, 60).join(' ');
  ui.deliver({text:first,segmentId:'review-a',startedAt:1000,endedAt:5000});
  assert.deepEqual(ui.finalTexts(), [first]);
  assert.equal(ui.document.querySelectorAll('.chunk-review-entry').length, 0);
  ui.app.flushCaptionAnalysis();
  assert.equal(ui.document.querySelectorAll('.chunk-review-entry').length, 1);
  assert.match(ui.document.querySelector('.chunk-review-score').textContent, /context|speech/i);
  assert.equal(ui.app.inspect().sessionData.scores.length, 0);
  ui.deliver({text:second,segmentId:'review-b',revision:2,sequence:2,startedAt:5000,endedAt:9000});
  ui.app.flushCaptionAnalysis();
  const snapshot = ui.app.inspect().sessionData.chunkReview;
  assert.equal(snapshot.summary.totalWords, 60);
  assert.equal(snapshot.chunks.length, 2);
  assert.ok(snapshot.chunks.every(chunk => chunk.wordCount === 30 && chunk.assessment.scorable));
  assert.equal(ui.document.querySelectorAll('.chunk-review-entry').length, 2);
  assert.match(ui.document.querySelector('.chunk-review-score').textContent, /\/100/);
  assert.match(ui.document.getElementById('chunkReviewBoundary').textContent, /not.*probabilit/i);
  assert.equal(ui.app.inspect().sessionData.scores.length, 1, 'Context badges must not create duplicate evidence windows');
  const owner = ui.app.inspect().sessionData;
  await ui.app.invoke('session:end');
  assert.equal(owner.chunkReview.final, true);
});

test('explicit non-candidate transcript roles never enter captions, checker or report inputs', async () => {
  const ui = await setupUI();
  for (const role of ['host', 'recruiter', 'interviewer', 'server']) {
    for (const field of ['senderRole', 'role']) {
      ui.deliver({ [field]: role, segmentId: `wrong-${field}-${role}`, text: words });
    }
  }
  ui.app.flushCaptionAnalysis();
  assert.equal(ui.app.inspect().sessionData.transcripts.length, 0);
  assert.equal(ui.app.inspect().sessionData.scores.length, 0);
  assert.deepEqual(ui.finalTexts(), []);
  ui.deliver({ senderRole: 'candidate', role: 'candidate', segmentId: 'candidate-only', text: words });
  ui.app.flushCaptionAnalysis();
  assert.deepEqual(ui.finalTexts(), [words]);
  assert.equal(ui.app.inspect().sessionData.transcripts.length, 1);
  await ui.app.invoke('session:end');
});

test('shared-tab updates retain row identity and pending close state instead of rebuilding the sidebar', async () => {
  const ui = await setupUI();
  ui.window.confirm = () => true;
  let resolve, requests = 0;
  ui.window.truveil.closeBrowserTab = () => { requests++; return new Promise(done => {resolve=done;}); };
  const tab = {id:'tab-one',hostname:'example.com',revision:1,active:true,protected:false};
  const publish = patch => ui.events.emit('browser:tabs', {}, {connected:true,closeConsent:true,tabs:[tab],...patch});
  publish();
  const list=ui.document.getElementById('sharedTabList');
  const row=list.firstElementChild, button=row.querySelector('button');
  button.click();
  assert.equal(requests,1);
  assert.equal(button.disabled,true);
  publish({tabs:[{...tab,active:false},{id:'tab-two',hostname:'meet.google.com',revision:1,active:true,protected:true}]});
  assert.equal(list.firstElementChild === row,true);
  assert.equal(row.querySelector('button') === button,true);
  assert.equal(button.disabled,true,'Background tab updates must not re-enable a pending command');
  button.click();
  assert.equal(requests,1,'Only one close command can target this pending row');
  assert.equal(list.children.length,2,'Rows remain until browser removal is confirmed');
  resolve({status:'closed'});await ui.flush();
  publish({tabs:[{id:'tab-two',hostname:'meet.google.com',revision:1,active:true,protected:true}]});
  assert.equal(list.children.length,1);
  assert.equal(list.firstElementChild.querySelector('button').disabled,true);
  await ui.app.invoke('session:end');
});

test('revoked tab-closing consent wins over a late close response and never re-enables controls', async () => {
  const ui=await setupUI();ui.window.confirm=()=>true;
  let resolve;ui.window.truveil.closeBrowserTab=()=>new Promise(done=>resolve=done);
  const tab={id:'tab-one',hostname:'example.com',revision:1,active:false,protected:false};
  const send=state=>ui.events.emit('browser:tabs',{},state);
  send({connected:true,closeConsent:true,tabs:[tab]});
  const row=ui.document.getElementById('sharedTabList').firstElementChild;
  row.querySelector('button').click();
  send({connected:true,closeConsent:false,tabs:[tab]});
  const button=ui.document.getElementById('sharedTabList').querySelector('button');
  resolve({status:'closed'});await ui.flush();
  assert.equal(button.disabled,true);
  assert.doesNotMatch(ui.document.getElementById('tabCloseStatus').textContent,/was closed/);
  send({connected:false,closeConsent:false,tabs:[]});
  assert.match(ui.document.getElementById('sharedTabList').textContent,/not shared|not connected/i);
  await ui.app.invoke('session:end');
});

test('unchanged large tab inventories do not replace nodes or reorder an already-stable list', async () => {
  const ui=await setupUI();
  const state={connected:true,closeConsent:true,tabs:Array.from({length:128},(_,i)=>({id:`tab-${i}`,hostname:`site${i}.example`,revision:1,active:i===0,protected:false}))};
  ui.events.emit('browser:tabs',{},state);
  const list=ui.document.getElementById('sharedTabList');
  const nodes=[...list.children];
  for(let i=0;i<20;i++)ui.events.emit('browser:tabs',{},state);
  assert.equal([...list.children].every((node,index)=>node===nodes[index]),true);
  await ui.app.invoke('session:end');
});

test('a returning tab retains its pending command even after its old row disappears', async () => {
  const ui=await setupUI();ui.window.confirm=()=>true;
  let resolve,calls=0;
  ui.window.truveil.closeBrowserTab=()=>{calls++;return new Promise(done=>resolve=done);};
  const tab={id:'returning-tab',hostname:'example.com',revision:1,active:false,protected:false};
  const send=tabs=>ui.events.emit('browser:tabs',{}, {connected:true,closeConsent:true,tabs});
  send([tab]);ui.document.getElementById('sharedTabList').querySelector('button').click();
  send([]);send([tab]);
  const returned=ui.document.getElementById('sharedTabList').querySelector('button');
  assert.equal(returned.disabled,true);
  returned.click();assert.equal(calls,1);
  resolve({status:'failed'});await ui.flush();
  assert.equal(returned.disabled,false);
  await ui.app.invoke('session:end');
});

test('opening captions survive a delayed Start broadcast acknowledgement', async () => {
  let acknowledge;
  const gate = new Promise(resolve => { acknowledge = resolve; });
  const ui = await setupUI({ send: message => message.event === 'session_started' ? gate : 'ok' });
  assert.ok(ui.app.inspect().sessionData.startedAt, 'main already started the interview');
  ui.deliver();
  ui.app.flushCaptionAnalysis();
  acknowledge('ok');
  await ui.flush();
  assert.equal(ui.document.getElementById('dashboard-screen').classList.contains('active'), true);
  assert.deepEqual(ui.finalTexts(), [words]);
  assert.equal(ui.count(), 1);
  await ui.app.invoke('session:end');
});

test('actual DOM keeps newer draft across late finals, clears by revision and orders final text', async () => {
  const ui = await setupUI();
  ui.deliver({ text: 'latest draft', interim: true, revision: 7 });
  ui.deliver({ text: 'second', revision: 5, segmentId: 'second', sequence: 2, startedAt: 2000 });
  ui.deliver({ text: 'first', revision: 4, segmentId: 'first', sequence: 1, startedAt: 1000 });
  assert.equal(ui.draft(), 'latest draft');
  assert.deepEqual(ui.finalTexts(), ['second', 'first']);
  ui.app.flushCaptionAnalysis();
  assert.equal(ui.draft(), 'latest draft');
  ui.deliver({ text: 'final draft', revision: 8, segmentId: 'different-final-id', sequence: 3, startedAt: 3000 });
  assert.equal(ui.draft(), undefined);
  ui.deliver({ text: 'late interim', interim: true, revision: 7 });
  assert.equal(ui.draft(), undefined);
  ui.deliver({ text: 'next draft', interim: true, revision: 9 });
  ui.deliver({ text: '', interim: true, captionClear: true, revision: 10 });
  assert.equal(ui.draft(), undefined);
  ui.app.flushCaptionAnalysis();
  assert.equal(ui.count(), 3);
  await ui.app.invoke('session:end');
});

test('legacy finals remain usable but unversioned drafts cannot replace a modern stream', async () => {
  const ui = await setupUI();
  const legacy = payload => ui.app.broadcasts.get('candidate_transcript')({ payload });
  legacy({ text: 'old client draft', interim: true, timestamp: 1000 });
  assert.equal(ui.draft(), 'old client draft');
  legacy({ text: 'old client final', timestamp: 2000, segmentId: 'legacy-final', transcriptConfidence: 0.9 });
  legacy({ text: 'late old client draft', interim: true, timestamp: 1000 });
  assert.equal(ui.draft(), undefined);
  ui.deliver({ text: 'modern draft', interim: true, revision: 2 });
  legacy({ text: 'unversioned stale draft', interim: true, timestamp: 3000 });
  assert.equal(ui.draft(), 'modern draft');
  ui.app.flushCaptionAnalysis();
  assert.equal(ui.draft(), 'modern draft');
  assert.equal(ui.count(), 1);
  await ui.app.invoke('session:end');
});

test('queue overload keeps every caption, bounds deferred work and abstains on overflow', async () => {
  const { app, deliver, start } = await setup();
  await start();
  for (let i = 1; i <= 260; i++) deliver({ text: 'a', revision: i, sequence: i, segmentId: `queued-${i}`, startedAt: i * 100, endedAt: i * 100 + 100, durationMs: 100 });
  assert.equal(app.inspect().sessionData.transcripts.length, 260);
  assert.equal(app.inspect().sessionData.captionAnalysisQueue.length, 256);
  assert.equal(app.inspect().sessionData.transcripts.at(-1).scorable, false);
  assert.match(app.inspect().sessionData.transcripts.at(-1).reasoning, /queue is full/);
  await app.invoke('session:end');
  app.flushCaptionAnalysis();
});

test('late finalized spans after analysis remain visible without being joined backwards into evidence', async () => {
  const { app, deliver, start } = await setup();
  await start();
  deliver({ text: 'recent words', sequence: 3, revision: 3, segmentId: 's3', startedAt: 3000 });
  app.flushCaptionAnalysis();
  deliver({ text: 'earlier words', sequence: 1, revision: 1, segmentId: 's1', startedAt: 1000 });
  app.flushCaptionAnalysis();
  assert.deepEqual(Array.from(app.inspect().sessionData.transcripts, e => e.text), ['earlier words', 'recent words']);
  assert.match(app.inspect().sessionData.transcripts[0].reasoning, /out of order/);
  assert.equal(app.inspect().sessionData.transcripts[0].scorable, false);
  await app.invoke('session:end');
});

test('actual DOM never executes caption HTML or counts duplicate analysis twice', async () => {
  const ui = await setupUI({ analyzeTranscript: () => ({ score: 12, scorable: true, scoreWeight: 1 }) });
  ui.deliver({ text: `<img src=x onerror=alert(1)> ${words}` });
  assert.equal(ui.document.querySelector('.transcript-entry img'), null);
  assert.ok(ui.finalTexts()[0].startsWith('<img'));
  ui.app.flushCaptionAnalysis();
  const entry = ui.app.inspect().sessionData.transcripts[0];
  ui.events.emit('realtime:transcript', {}, entry);
  ui.events.emit('realtime:transcript', {}, entry);
  assert.equal(ui.count(), 1);
  assert.equal(ui.document.querySelectorAll('.transcript-entry').length, 1);
  assert.equal(ui.app.inspect().sessionData.scores.length, 1);
  await ui.app.invoke('session:end');
});

test('retired stream bookkeeping and metadata are bounded', async () => {
  const { app, events, deliver, start } = await setup();
  await start();
  for (let i = 0; i < 40; i++) deliver({ text: 'draft', captionStreamId: `join-${i}`, interim: true });
  assert.equal(app.inspect().sessionData.captionState.retiredStreams.size, 32);
  app.broadcasts.get('candidate_transcript')({ payload: { text: 'x'.repeat(16000), timestamp: 20000 } });
  const last = events.filter(e => e.channel === 'realtime:caption').at(-1).payload;
  assert.ok(last.captionKey.length < 512);
  await app.invoke('session:end');
});
