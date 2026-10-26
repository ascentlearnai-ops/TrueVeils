const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { loadMain } = require('./helpers/main-harness');

function demoHarness(env = {}) {
  const clients = [];
  class Relay extends EventEmitter {
    constructor(options) { super(); this.url = options.url; this.sent = []; clients.push(this); }
    async create(details, hostAccessCode) { this.details = details; this.hostAccessCode = hostAccessCode; return { roomId: 'test-room', code: 'DEMO-ABCDEFGH23456723', expiresAt: Date.now() + 60000 }; }
    async approve(requestId, allow) { this.approval = { requestId, allow }; return { ok: true }; }
    async update(details) { this.details = details; return { ok: true }; }
    async start() { this.started = true; return { ok: true }; }
    async send(message) { this.sent.push(message); return 'ok'; }
    async end() { this.ended = true; return { ok: true }; }
    close() { this.closed = true; }
  }
  const app = loadMain({ user: null, env: { TRUVEIL_APP_MODE: 'demo', ...env }, modules: { './src/demo/relay-client': {
    DemoRelayClient: Relay, normalizeRelayUrl: url => { if (!url) throw new Error('Configure the demo relay'); return url; }
  } } });
  const events = [];
  app.attachRenderer((name, payload) => events.push({ name, payload }));
  return { ...app, clients, events };
}

test('account-free demo creates a genuine relay room without calling cloud auth or database', async () => {
  const h = demoHarness();
  const config = await h.invoke('demo:config');
  assert.equal(config.enabled, true);
  const session = await h.invoke('demo:create', { relayUrl: 'ws://127.0.0.1:43180/demo' });
  assert.equal(session.demo, true);
  assert.match(session.sessionId, /^DEMO-/);
  assert.equal(h.inspect().sessionData.candidateReady, false);
  assert.equal(h.calls.some(call => call.function || call.table || call.channel), false);
  assert.equal(h.clients.length, 1);
  assert.deepEqual([...session.policy.blocked_sites], []);
  assert.equal(session.policy.blocking_mode, 'none');
});

test('explicit empty restrictions stay empty through normalization and updates', async () => {
  const h = demoHarness();
  await h.invoke('demo:create', { relayUrl: 'ws://127.0.0.1:43180/demo' });
  const policy = { allowed_apps: [], allowed_sites: [], blocked_sites: [], blocking_mode: 'none' };
  await h.invoke('session:update', { policy });
  assert.deepEqual([...h.inspect().activeSession.policy.blocked_sites], []);
  assert.deepEqual([...h.clients[0].details.policy.blocked_sites], []);
});

test('shared allowed browser activity remains informational, selected restrictions retain context', async () => {
  const h = demoHarness();
  await h.invoke('demo:create', { relayUrl: 'ws://127.0.0.1:43180/demo' });
  const client = h.clients[0], sessionId = h.inspect().activeSession.sessionId;
  client.emit('event', { event: 'candidate_event', payload: { type: 'candidate_ready', sessionId } });
  await h.invoke('session:start');
  const activity = (hostname, sequence) => client.emit('event', { event: 'candidate_event', payload: { sessionId, type: 'browser_tabs', state: {
    connected: true, closeConsent: false, tabs: [], events: [{ kind: 'navigated', hostname, sequence }]
  } } });
  activity('chatgpt.com', 1);
  assert.equal(h.inspect().sessionData.flags.at(-1).policyDecision, 'allowed');
  await h.invoke('session:update', { policy: { allowed_apps: [], allowed_sites: [], blocked_sites: ['chatgpt.com'], blocking_mode: 'observe' } });
  activity('sub.chatgpt.com', 2);
  assert.equal(h.inspect().sessionData.flags.at(-1).policyDecision, 'restricted');
  activity('notchatgpt.com', 3);
  assert.equal(h.inspect().sessionData.flags.at(-1).policyDecision, 'allowed');
  activity('chatgpt.com.attacker.example', 4);
  assert.equal(h.inspect().sessionData.flags.at(-1).policyDecision, 'allowed');
  await h.invoke('session:end');
});

test('demo creation never forwards an inherited server secret to a renderer-chosen relay', async () => {
  const h=demoHarness({TRUVEIL_DEMO_HOST_KEY:'inherited-server-only-secret'});
  await h.invoke('demo:create',{relayUrl:'wss://another-relay.example/demo'});
  assert.equal(h.clients[0].hostAccessCode,'');
  assert.equal(JSON.stringify(h.inspect().activeSession).includes('inherited-server-only-secret'),false);
  await h.invoke('session:cancel');
  await h.invoke('demo:create',{relayUrl:'wss://selected-relay.example/demo',hostAccessCode:'explicitly-entered-host-code'});
  assert.equal(h.clients[1].hostAccessCode,'explicitly-entered-host-code');
  assert.equal(JSON.stringify(h.inspect().activeSession).includes('explicitly-entered-host-code'),false);
});

test('demo requires explicit host approval, normal readiness, and uses local reports', async () => {
  const h = demoHarness();
  await h.invoke('demo:create', { relayUrl: 'ws://127.0.0.1:43180/demo' });
  const client = h.clients[0];
  client.emit('join-request', { requestId: 'request-1', name: 'Demo candidate' });
  assert.equal(h.events.at(-1).name, 'demo:join-request');
  await assert.rejects(h.invoke('session:start'), /candidate/i);
  await h.invoke('demo:approve', { requestId: 'request-1', allow: true });
  assert.deepEqual(client.approval, { requestId: 'request-1', allow: true });
  client.emit('event', { event: 'candidate_event', payload: { type: 'candidate_ready', sessionId: h.inspect().activeSession.sessionId } });
  assert.equal((await h.invoke('session:start')).started, true);
  assert.equal(client.started, true);
  await h.invoke('session:note', { note: 'A local demonstration note.' });
  assert.equal((await h.invoke('session:end')).ended, true);
  assert.equal(client.ended, true);
  assert.equal(h.calls.some(call => call.function || call.table || call.channel), false);
  assert.ok(h.calls.some(call => call.generatedReport));
});

test('demo disconnect clears tab capabilities and revokes readiness immediately', async () => {
  const h = demoHarness();
  await h.invoke('demo:create', { relayUrl: 'ws://127.0.0.1:43180/demo' });
  h.clients[0].emit('closed', { reason: 'Connection lost' });
  assert.equal(h.inspect().sessionData.candidateReady, false);
  assert.equal(h.inspect().sessionData.telemetry.connected, false);
  assert.ok(h.events.some(event => event.name === 'browser:tabs' && !event.payload.connected));
  await assert.rejects(h.invoke('browser:close-tab', { id: 'stale', revision: 1 }), /connect|active|unavailable|shared/i);
});

test('legacy generic tab close is rejected instead of dispatching a keyboard shortcut', async () => {
  const h = demoHarness();
  await h.invoke('demo:create', { relayUrl: 'ws://127.0.0.1:43180/demo' });
  await assert.rejects(h.invoke('candidate:action', { action: 'close_target', target: { processName: 'chrome' } }), /extension|shared|unsupported/i);
  assert.equal(h.clients[0].sent.length, 0);
});

test('demo cancellation clears a disconnected room and permits replacement', async () => {
  const h=demoHarness();
  await h.invoke('demo:create',{relayUrl:'ws://127.0.0.1:43180/demo'});
  h.clients[0].end=async()=>{throw new Error('Disconnected');};
  h.clients[0].emit('closed',{reason:'disconnected'});
  assert.equal((await h.invoke('session:cancel')).cancelled,true);
  assert.equal(h.inspect().activeSession,null);
  assert.equal((await h.invoke('demo:create',{relayUrl:'ws://127.0.0.1:43180/demo'})).demo,true);
});

test('explicit demo provider withdrawal revokes permission and notifies renderer', async () => {
  const h=demoHarness();
  await h.invoke('demo:create',{relayUrl:'ws://127.0.0.1:43180/demo'});
  const sessionId=h.inspect().activeSession.sessionId;
  const event=payload=>h.clients[0].emit('event',{event:'candidate_event',payload:{sessionId,...payload}});
  event({type:'candidate_ready',externalReviewConsent:{version:'external-review-v1',enabled:true}});
  assert.equal(h.inspect().sessionData.externalReviewConsent.enabled,true);
  event({type:'provider_review_consent_withdrawn'});
  assert.equal(h.inspect().sessionData.externalReviewConsent.enabled,false);
  assert.ok(h.events.some(e=>e.name==='provider-review:consent' && e.payload.enabled===false));
});
