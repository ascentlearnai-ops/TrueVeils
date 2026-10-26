'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { createDemoRelay } = require('./relay-server');
const { DemoRelayClient, normalizeRelayUrl } = require('../../recruiter-app/src/demo/relay-client');
const { createDeepgramTokenProvider } = require('./token-provider');
const TEST_HOST_KEY = require('node:crypto').randomBytes(32).toString('base64url');

const details = { candidateName: 'Candidate', role: 'Engineer', technicalVocabulary: ['WebSocket'], policy: { allowed_apps: ['Chrome'], allowed_sites: ['example.com'], blocked_sites: [], blocking_mode: 'warn_refocus' } };
const consent = { name: 'Ada', consentConfirmed: true, microphoneReady: true, externalReviewConsent: false, tabObserveConsent: true, tabCloseConsent: true };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setup(t, options = {}) {
  const hostKey = options.tokenProvider ? TEST_HOST_KEY : '';
  const relay = createDemoRelay({ tokenProvider: null, hostKey, ...options });
  const { port } = await relay.listen(0);
  const url = `ws://127.0.0.1:${port}/demo`;
  t.after(() => relay.close());
  const client = () => {
    const c = new DemoRelayClient({ url, WebSocketImpl: WebSocket, timeoutMs: 1500 });
    t.after(() => c.close());
    return c;
  };
  return { relay, url, client, hostKey };
}

async function paired(t, options) {
  const env = await setup(t, options);
  const host = env.client();
  const candidate = env.client();
  const room = await host.create(details, env.hostKey);
  const request = once(host, 'join-request');
  const joining = candidate.join({ code: room.code, ...consent });
  const [join] = await request;
  await host.approve(join.requestId, true);
  const metadata = await joining;
  return { ...env, host, candidate, room, metadata, join };
}

function event(client, name) {
  return new Promise(resolve => {
    const onEvent = value => {
      if (value.event === name) { client.off('event', onEvent); resolve(value.payload); }
    };
    client.on('event', onEvent);
  });
}

async function raw(t, url, options) {
  const ws = new WebSocket(url, options);
  await once(ws, 'open');
  t.after(() => ws.terminate());
  let sequence = 0;
  const request = (op, data = {}, id = ++sequence) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMessage); reject(new Error('raw timeout')); }, 1500);
    function onMessage(bytes) {
      const value = JSON.parse(bytes);
      if (value.id === id) { clearTimeout(timer); ws.off('message', onMessage); resolve(value); }
    }
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, op, data }));
  });
  return { ws, request };
}

test('URL validation and exact app mirror', () => {
  assert.equal(normalizeRelayUrl('wss://relay.example.org'), 'wss://relay.example.org/demo');
  assert.equal(normalizeRelayUrl('ws://127.0.0.1:43180/'), 'ws://127.0.0.1:43180/demo');
  for (const url of ['ws://example.org', 'ws://localhost:43180', 'https://example.org', 'wss://user:pass@example.org', 'wss://example.org?x=1', 'wss://example.org#x', 'wss://example.org/?', 'wss://example.org/#', 'ws://127.1:43180', 'ws://2130706433:43180']) {
    assert.throws(() => normalizeRelayUrl(url), /relay URL/i);
  }
  const a = fs.readFileSync(path.join(__dirname, '../../recruiter-app/src/demo/relay-client.js'));
  const b = fs.readFileSync(path.join(__dirname, '../../../Truveil-Client/src/demo/relay-client.js'));
  assert.deepEqual(a, b);
});

test('explicit approval, authoritative start, policy and streamed captions without checker', async t => {
  const { host, candidate, room, metadata } = await paired(t);
  assert.match(room.code, /^DEMO-[A-Z2-7]{16}$/);
  assert.equal(metadata.code, room.code);
  assert.deepEqual(metadata.details, details);
  assert.ok(room.expiresAt > Date.now());
  let starts = 0;
  candidate.on('event', value => { if (value.event === 'session_started') starts++; });
  const started = event(candidate, 'session_started');
  await host.start();
  assert.equal((await started).sessionId, room.code);
  await host.start();
  assert.equal(starts, 1);
  const policy = event(candidate, 'session_policy');
  await host.update({ technicalVocabulary: ['TypeScript'] });
  assert.deepEqual((await policy).technicalVocabulary, ['TypeScript']);
  for (const interim of [true, false]) {
    const caption = event(host, 'candidate_transcript');
    assert.equal(await candidate.send({ type: 'broadcast', event: 'candidate_transcript', payload: { text: 'Live speech', interim, revision: interim ? 1 : 2, segmentId: 'segment-1', sessionId: 'forged', role: 'host', candidateName: 'Fake' } }), 'ok');
    const value = await caption;
    assert.equal(value.text, 'Live speech');
    assert.equal(value.interim, interim);
    assert.equal(value.sessionId, room.code);
    assert.equal(value.senderRole, 'candidate');
    assert.equal(value.candidateName, 'Ada');
    assert.notEqual(value.role, 'host');
  }
  await assert.rejects(candidate.send({ type: 'broadcast', event: 'candidate_audio_chunk', payload: {} }), /unsupported/i);
});

test('pending approval cannot start or obtain tokens; decline cancels waiting join', async t => {
  let calls = 0;
  const { client, hostKey } = await setup(t, { tokenProvider: async () => { calls++; } });
  const host = client(); const candidate = client();
  const room = await host.create(details, hostKey);
  const req = once(host, 'join-request');
  const joining = assert.rejects(candidate.join({ code: room.code, ...consent }), /declined|closed/i);
  const [join] = await req;
  await assert.rejects(host.start(), /approved/i);
  await assert.rejects(candidate.token(), /approved|active|authorized/i);
  await host.approve(join.requestId, false);
  await joining;
  assert.equal(calls, 0);
});

test('missing consent denies join and never calls provider', async t => {
  const { client, relay, hostKey } = await setup(t, { tokenProvider: () => assert.fail('provider called') });
  const host = client(); const candidate = client();
  const room = await host.create(details, hostKey);
  await assert.rejects(candidate.join({ code: room.code, ...consent, microphoneReady: false }), /consent|microphone/i);
  assert.equal(relay.stats.rooms, 1);
});

test('role denial, cross-room authorization and approval replay', async t => {
  const { host, candidate, client, join } = await paired(t);
  const other = client(); await other.create(details);
  await assert.rejects(other.approve(join.requestId, true), /request|authorized/i);
  await assert.rejects(host.approve(join.requestId, true), /request|approved/i);
  for (const fn of [() => candidate.start(), () => candidate.update({ role: 'Admin' }), () => candidate.approve(join.requestId, true), () => host.token()]) await assert.rejects(fn(), /host|candidate|authorized/i);
  await host.start();
  for (const name of ['candidate_event', 'candidate_transcript', 'candidate_audio_level']) await assert.rejects(host.send({ type: 'broadcast', event: name, payload: {} }), /authorized/i);
  for (const name of ['session_started', 'session_policy', 'recruiter_action', 'session_ended']) await assert.rejects(candidate.send({ type: 'broadcast', event: name, payload: {} }), /authorized/i);
});

test('raw wire replay, forged envelope and cross-room token selectors are denied', async t => {
  const { url } = await setup(t);
  const { request } = await raw(t, url);
  assert.equal((await request('create', details, 1)).ok, true);
  assert.match((await request('create', details, 1)).error, /replay/i);
  assert.equal((await request('token', { roomId: 'other', role: 'candidate' }, 2)).ok, false);
  assert.equal((await request('join', { code: 'DEMO-AAAAAAAAAAAAAAAA', ...consent }, 3)).ok, false);
});

test('end/disconnect purge room and revoke code; client never reconnects', async t => {
  const { host, candidate, client, relay, room } = await paired(t);
  const closed = once(candidate, 'closed');
  const ended = event(candidate, 'session_ended');
  await host.end();
  assert.equal((await ended).sessionId, room.code);
  await closed;
  assert.equal(relay.stats.rooms, 0);
  await assert.rejects(client().join({ code: room.code, ...consent }), /unavailable/i);
  await assert.rejects(candidate.token(), /closed/i);
});

test('candidate disconnect and pending-approval cancellation terminate the host', async t => {
  for (const approved of [true, false]) {
    const { client, relay } = await setup(t);
    const host = client(); const candidate = client();
    const room = await host.create(details);
    const request = once(host, 'join-request');
    const joining = candidate.join({ code: room.code, ...consent });
    const rejected = approved ? null : assert.rejects(joining, /closed/i);
    const [join] = await request;
    if (approved) { await host.approve(join.requestId, true); await joining; }
    const closed = once(host, 'closed');
    candidate.close();
    await closed;
    if (rejected) await rejected;
    assert.equal(relay.stats.rooms, 0);
  }
});

test('expiry aborts pending approval and purges metadata', async t => {
  const { client, relay } = await setup(t, { limits: { ttlMs: 150 } });
  const host = client(); const candidate = client();
  const room = await host.create(details);
  const closed = once(host, 'closed');
  await assert.rejects(candidate.join({ code: room.code, ...consent }), /expired|closed/i);
  assert.equal((await closed)[0].reason, 'expired');
  assert.equal(relay.stats.rooms, 0);
});

test('Origin rejected, socket IP used despite forged XFF, room/peer/body limits', async t => {
  const { url, client, relay } = await setup(t, { limits: { maxRooms: 1, maxMessageBytes: 2048, maxConnectionsPerIp: 4 } });
  const browser = new WebSocket(url, { origin: 'https://evil.example' });
  const [error] = await once(browser, 'error');
  assert.match(error.message, /403/);
  const host = client(); const room = await host.create(details);
  await assert.rejects(client().create(details), /capacity|limit/i);
  const candidate = client();
  const request = once(host, 'join-request');
  const pending = assert.rejects(candidate.join({ code: room.code, ...consent }), /closed/i);
  await request;
  const stranger = await raw(t, url, { headers: { 'X-Forwarded-For': '8.8.8.8' } });
  assert.equal((await stranger.request('join', { code: room.code, ...consent })).ok, false);
  const extra = new WebSocket(url, { headers: { 'X-Forwarded-For': '1.1.1.1' } });
  assert.match((await once(extra, 'error'))[0].message, /429/);
  const closed = once(stranger.ws, 'close');
  stranger.ws.send('x'.repeat(4096));
  assert.equal((await closed)[0], 1009);
  const hostClosed = once(host, 'closed');
  candidate.close(); await pending; await hostClosed;
  assert.equal(relay.stats.rooms, 0);
});

test('IP message rate and outbound backpressure terminate the room', async t => {
  const env = await setup(t, { limits: { maxRequestsPerIp: 2 } });
  const host = env.client(); await host.create(details);
  await host.update({ role: 'A' });
  const closed = once(host, 'closed');
  await assert.rejects(host.update({ role: 'B' }), /rate|closed/i);
  await closed;
  assert.equal(env.relay.stats.rooms, 0);
  const small = await setup(t, { limits: { maxBufferedBytes: 32 } });
  await assert.rejects(small.client().create(details), /closed|backpressure/i);
  assert.equal(small.relay.stats.rooms, 0);
});

test('hostname-only tabs, consent revocation and close command replay protection', async t => {
  const { host, candidate, room } = await paired(t);
  await host.start();
  const state = { connected: true, observeConsent: true, closeConsent: true, tabs: [{ id: 7, hostname: 'example.com', active: true, protected: false, revision: 3 }], events: [{ kind: 'opened', hostname: 'example.com' }] };
  const sendState = value => candidate.send({ type: 'broadcast', event: 'candidate_event', payload: { type: 'browser_tabs', state: value } });
  const observed = event(host, 'candidate_event');
  await sendState({ ...state, tabs: [{ ...state.tabs[0], url: 'https://example.com/private?q=secret', title: 'Secret' }] });
  const received = await observed;
  assert.equal(received.state.tabs[0].url, undefined);
  assert.equal(received.state.tabs[0].title, undefined);
  await assert.rejects(sendState({ ...state, tabs: [{ ...state.tabs[0], hostname: 'https://example.com/private' }] }), /hostname/i);
  const command = { action: 'close_tab', target: { id: 7, revision: 3 }, commandId: 'e22936b9-ea5c-43a2-983e-814380c7771a' };
  const action = event(candidate, 'recruiter_action');
  await host.send({ type: 'broadcast', event: 'recruiter_action', payload: command });
  assert.equal((await action).sessionId, room.code);
  await assert.rejects(host.send({ type: 'broadcast', event: 'recruiter_action', payload: command }), /duplicate|replay/i);
  await assert.rejects(host.send({ type: 'broadcast', event: 'recruiter_action', payload: { ...command, commandId: '8e2ff45d-4c53-46fc-85ab-04acdd86bfbb', action: 'close_window' } }), /unsupported/i);
  await assert.rejects(candidate.send({ type: 'broadcast', event: 'candidate_event', payload: { type: 'browser_tab_close_result', commandId: 'unknown', result: { status: 'closed' } } }), /command/i);
  await candidate.send({ type: 'broadcast', event: 'candidate_event', payload: { type: 'browser_tab_close_result', commandId: command.commandId, result: { status: 'closed' } } });
  await assert.rejects(candidate.send({ type: 'broadcast', event: 'candidate_event', payload: { type: 'browser_tab_close_result', commandId: command.commandId, result: { status: 'closed' } } }), /command|duplicate/i);
  await sendState({ ...state, closeConsent: false });
  await assert.rejects(host.send({ type: 'broadcast', event: 'recruiter_action', payload: { ...command, commandId: '6ad73ead-583b-4310-bbe1-24eb8085a111' } }), /consent/i);
});

test('token authorization, throttling, missing provider, abort and late result suppression', async t => {
  const absent = await paired(t);
  await absent.host.start();
  await assert.rejects(absent.candidate.token(), /not configured|unavailable/i);
  let calls = 0;
  const env = await paired(t, { tokenProvider: async () => { calls++; return { accessToken: 'temporary-test-token', expiresIn: 30 }; } });
  await assert.rejects(env.candidate.token(), /active/i);
  await env.host.start();
  assert.deepEqual(await env.candidate.token(), { ok: true, accessToken: 'temporary-test-token', expiresIn: 30 });
  await assert.rejects(env.candidate.token(), /throttled|limit/i);
  assert.equal(calls, 1);
  let complete; let signal;
  const slow = await paired(t, { tokenProvider: options => { signal = options.signal; return new Promise(resolve => { complete = resolve; }); } });
  await slow.host.start();
  const pending = assert.rejects(slow.candidate.token(), /closed|ended/i);
  while (!complete) await delay(5);
  await slow.host.end();
  assert.equal(signal.aborted, true);
  complete({ accessToken: 'must-not-arrive', expiresIn: 30 });
  await pending;
  assert.equal(slow.relay.stats.rooms, 0);
});

test('provider adapter uses bounded temporary grant, aborts and hides provider errors', async () => {
  let request;
  const provider = createDeepgramTokenProvider({ apiKey: 'server-only-test-key', fetchImpl: async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ access_token: 'temporary', expires_in: 30 })); } });
  assert.deepEqual(await provider({ signal: new AbortController().signal }), { accessToken: 'temporary', expiresIn: 30 });
  assert.equal(request.url, 'https://api.deepgram.com/v1/auth/grant');
  assert.equal(request.options.headers.Authorization, 'Token server-only-test-key');
  assert.deepEqual(JSON.parse(request.options.body), { ttl_seconds: 30 });
  const failure = createDeepgramTokenProvider({ apiKey: 'secret', fetchImpl: async () => new Response('secret provider error', { status: 403 }) });
  await assert.rejects(failure({}), error => !error.message.includes('secret') && /provider/i.test(error.message));
  let aborted = false;
  const timeout = createDeepgramTokenProvider({ apiKey: 'test', timeoutMs: 20, fetchImpl: (_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(options.signal.reason); })) });
  await assert.rejects(timeout({}), /timeout|provider/i);
  assert.equal(aborted, true);
});

test('failed connection and approval timeout cleanly reject without unhandled error events', async t => {
  const { url, relay } = await setup(t);
  await relay.close();
  const dead = new DemoRelayClient({ url, WebSocketImpl: WebSocket, timeoutMs: 100 });
  await assert.rejects(dead.create(details), /connect|closed|ECONNREFUSED/i);
  dead.close();
  const env = await setup(t, { limits: { approvalTimeoutMs: 100 } });
  const host = env.client(); const candidate = env.client();
  const room = await host.create(details);
  await assert.rejects(candidate.join({ code: room.code, ...consent }), /approval|closed/i);
  assert.equal(env.relay.stats.rooms, 0);
});

test('host disconnect cancels pending approval, candidate consent revocation ends both peers', async t => {
  const pending = await setup(t);
  const host = pending.client(); const candidate = pending.client();
  const room = await host.create(details);
  const request = once(host, 'join-request');
  const joining = assert.rejects(candidate.join({ code: room.code, ...consent }), /closed/i);
  await request;
  host.close();
  await joining;
  assert.equal(pending.relay.stats.rooms, 0);
  const active = await paired(t);
  await active.host.start();
  const closed = once(active.host, 'closed');
  assert.equal(await active.candidate.send({ type: 'broadcast', event: 'candidate_event', payload: { type: 'candidate_ready', microphoneReady: false } }), 'ok');
  assert.equal((await closed)[0].reason, 'consent_revoked');
  assert.equal(active.relay.stats.rooms, 0);
});

test('no cross-room caption delivery; an unapproved socket cannot publish', async t => {
  const { host, candidate, client, url, room } = await paired(t);
  const otherHost = client(); await otherHost.create(details);
  let foreignEvents = 0;
  otherHost.on('event', value => { if (value.event === 'candidate_transcript') foreignEvents++; });
  await host.start();
  const caption = event(host, 'candidate_transcript');
  await candidate.send({ type: 'broadcast', event: 'candidate_transcript', payload: { text: 'Confined', sessionId: 'other-room' } });
  assert.equal((await caption).sessionId, room.code);
  await delay(10);
  assert.equal(foreignEvents, 0);
  const unbound = await raw(t, url);
  const result = await unbound.request('broadcast', { type: 'broadcast', event: 'candidate_event', payload: { type: 'candidate_ready', role: 'candidate' } });
  assert.equal(result.ok, false);
});

test('protected, stale and unconsented tab targets cannot be closed; no reconsent by replay', async t => {
  const { host, candidate } = await paired(t);
  await host.start();
  const state = { connected: true, observeConsent: true, closeConsent: true, tabs: [{ id: 4, hostname: 'meet.google.com', active: true, protected: true, revision: 'v2' }], events: [] };
  const publish = state => candidate.send({ type: 'broadcast', event: 'candidate_event', payload: { type: 'browser_tabs', state } });
  const command = { action: 'close_tab', target: { id: 4, revision: 'v1' }, commandId: '3122fb18-c8b4-4ef0-9d88-31a42cd0240d' };
  const close = () => host.send({ type: 'broadcast', event: 'recruiter_action', payload: command });
  await assert.rejects(close(), /consent/i);
  await publish(state);
  await assert.rejects(close(), /protected|stale/i);
  await publish({ ...state, tabs: [{ ...state.tabs[0], protected: false }] });
  await assert.rejects(close(), /stale/i);
  await publish({ ...state, closeConsent: false });
  await assert.rejects(publish(state), /consent/i);
});

test('invalid metadata, unknown events, binary and forged wire authority fail closed', async t => {
  const { client, url } = await setup(t);
  await assert.rejects(client().create({ technicalVocabulary: Array(101).fill('word') }), /metadata/i);
  const host = client(); await host.create({ ...details, apiKey: 'do-not-retain', policy: { ...details.policy, unsafe: 'discard' } });
  for (const data of ['null', '[]', '{broken', JSON.stringify({ id: 1, op: 'token', role: 'candidate', data: {} })]) {
    const { ws } = await raw(t, url);
    const closed = once(ws, 'close');
    ws.send(data);
    await closed;
  }
  const binary = await raw(t, url);
  const closed = once(binary.ws, 'close');
  binary.ws.send(Buffer.from('binary audio'));
  await closed;
});

test('server token timeout releases stalled fake provider and blocks concurrent grants', async t => {
  let signal; let calls = 0;
  const { host, candidate } = await paired(t, { limits: { tokenTimeoutMs: 40 }, tokenProvider: options => { calls++; signal = options.signal; return new Promise(() => {}); } });
  await host.start();
  const first = assert.rejects(candidate.token(), /provider|cancel/i);
  while (!signal) await delay(2);
  await assert.rejects(candidate.token(), /throttled/i);
  await first;
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('unbound idle and silent TCP peers are bounded by heartbeat', async t => {
  const { url, relay } = await setup(t, { limits: { idleTimeoutMs: 40, heartbeatMs: 20 } });
  const idle = await raw(t, url);
  await once(idle.ws, 'close');
  assert.equal(relay.stats.rooms, 0);
  const silent = new WebSocket(url, { autoPong: false });
  await once(silent, 'open');
  t.after(() => silent.terminate());
  silent.send(JSON.stringify({ id: 1, op: 'create', data: details }));
  await once(silent, 'close');
  assert.equal(relay.stats.rooms, 0);
});

test('browser bridge opaque ids, empty protected hosts, and initial pairing state are compatible', async t => {
  const { host, candidate } = await paired(t);
  await host.start();
  const publish = state => candidate.send({ type: 'broadcast', event: 'candidate_event', payload: { type: 'browser_tabs', state } });
  await publish({ connected: false, observeConsent: true, closeConsent: false, tabs: [], events: [] });
  const id = 'fb44b99e-7ffa-4dd3-8d6a-a9943aca1952';
  const protectedId = 'ff44b99e-7ffa-4dd3-8d6a-a9943aca1952';
  const snapshot = event(host, 'candidate_event');
  await publish({ connected: true, observeConsent: true, closeConsent: true,
    tabs: [{ id, hostname: 'example.com', active: true, protected: false, revision: 1 },
      { id: protectedId, hostname: '', active: false, protected: true, revision: 1 }],
    events: [{ kind: 'created', id, hostname: 'example.com', revision: 1, sequence: 1 }] });
  assert.equal((await snapshot).state.tabs[0].id, id);
  const commandId = '667960fb-b920-41d8-a2d0-d287969e4e52';
  const action = event(candidate, 'recruiter_action');
  await host.send({ type: 'broadcast', event: 'recruiter_action', payload: { action: 'close_tab', target: { id, revision: 1 }, commandId } });
  assert.equal((await action).target.id, id);
  await candidate.send({ type: 'broadcast', event: 'candidate_event', payload: { type: 'browser_tab_close_result', commandId, result: { status: 'closed', id, revision: 1 } } });
});

test('explicit standalone CLI requires host capability even without provider credentials', { timeout: 10000 }, async t => {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, 'cli.js'), '--port', String(port)], {
    env: { ...process.env, DEEPGRAM_API_KEY: '', TRUVEIL_DEMO_HOST_KEY: TEST_HOST_KEY }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  const exited = once(child, 'exit');
  t.after(async () => { child.kill(); await exited; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI startup timeout')), 3000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('Demo relay listening')) { clearTimeout(timer); resolve(); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('CLI exited before startup')); });
  });
  const host = new DemoRelayClient({ url: `ws://127.0.0.1:${port}`, WebSocketImpl: WebSocket });
  t.after(() => host.close());
  await assert.rejects(host.create(details), /host access denied/i);
  const room = await host.create(details, TEST_HOST_KEY);
  assert.match(room.code, /^DEMO-[A-Z2-7]{16}$/);
  await host.end();
});

test('audio meter delivery and ready/review consent metadata use candidate authority', async t => {
  const { host, candidate, room } = await paired(t);
  const ready = event(host, 'candidate_event');
  await candidate.send({ type: 'broadcast', event: 'candidate_event', payload: {
    type: 'candidate_ready', externalReviewConsent: { version: 'external-review-v1', enabled: false }, severity: 'low'
  } });
  assert.equal((await ready).externalReviewConsent.enabled, false);
  await host.start();
  const meter = event(host, 'candidate_audio_level');
  await candidate.send({ type: 'broadcast', event: 'candidate_audio_level', payload: { rms: 0.4, peak: 0.8, sessionId: 'forged' } });
  assert.equal((await meter).sessionId, room.code);
  await assert.rejects(candidate.send({ type: 'broadcast', event: 'candidate_audio_level', payload: { rms: 7, peak: 0.8 } }), /metadata/i);
  await assert.rejects(candidate.send({ type: 'broadcast', event: 'candidate_event', payload: { type: 'candidate_review_consent', externalReviewConsent: { version: 'fake', enabled: true } } }), /consent/i);
});

test('provider rejects oversized/invalid responses and never returns extra credentials', async () => {
  for (const payload of [{ access_token: 'temporary', expires_in: 3600 }, { access_token: 'x'.repeat(17000), expires_in: 30 }, { api_key: 'must-not-use', expires_in: 30 }]) {
    const provider = createDeepgramTokenProvider({ apiKey: 'server-key', fetchImpl: async () => new Response(JSON.stringify(payload)) });
    await assert.rejects(provider({}), /provider/i);
  }
  const provider = createDeepgramTokenProvider({ apiKey: 'server-key', fetchImpl: async () => new Response(JSON.stringify({ access_token: 'temporary', expires_in: 30, api_key: 'must-not-forward' })) });
  assert.deepEqual(await provider({}), { accessToken: 'temporary', expiresIn: 30 });
});

test('ready privacy metadata and explicit provider-review withdrawal forward before start', async t => {
  const { host, candidate, room } = await paired(t);
  const ready = event(host, 'candidate_event');
  await candidate.send({ type: 'broadcast', event: 'candidate_event', payload: {
    type: 'candidate_ready', privacyVersion: 'demo-privacy-v1',
    externalReviewConsent: { version: 'external-review-v1', enabled: false }
  } });
  const value = await ready;
  assert.equal(value.sessionId, room.code);
  assert.equal(value.privacyVersion, 'demo-privacy-v1');
  const withdrawn = event(host, 'candidate_event');
  await candidate.send({ type: 'broadcast', event: 'candidate_event', payload: {
    type: 'provider_review_consent_withdrawn', externalReviewConsent: { version: 'external-review-v1', enabled: true }
  } });
  assert.equal((await withdrawn).externalReviewConsent.enabled, false);
  await host.start();
});
