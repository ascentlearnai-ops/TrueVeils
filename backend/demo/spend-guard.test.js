'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const { createDemoRelay, DEFAULT_LIMITS } = require('./relay-server');
const { DemoRelayClient } = require('../../recruiter-app/src/demo/relay-client');
const { createTokenBudget } = require('./token-budget');

const HOST_KEY = randomBytes(32).toString('base64url');
const consent = { name: 'Synthetic candidate', consentConfirmed: true, microphoneReady: true };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setup(t, options = {}) {
  const relay = createDemoRelay({ tokenProvider: null, hostKey: HOST_KEY, ...options });
  t.after(() => relay.close());
  const { port } = await relay.listen(0);
  const outbound = [], inbound = [];
  class RecordedSocket extends WebSocket {
    constructor(url) {
      super(url);
      this.on('message', bytes => inbound.push(JSON.parse(bytes.toString())));
    }
    send(bytes, ...args) { outbound.push(JSON.parse(bytes)); return super.send(bytes, ...args); }
  }
  const client = () => {
    const value = new DemoRelayClient({ url: `ws://127.0.0.1:${port}/demo`, WebSocketImpl: RecordedSocket, timeoutMs: 1500 });
    t.after(() => value.close());
    return value;
  };
  async function paired() {
    const host = client(), candidate = client();
    const room = await host.create({ role: 'Synthetic interview' }, HOST_KEY);
    const requested = once(host, 'join-request');
    const joining = candidate.join({ code: room.code, ...consent });
    const [request] = await requested;
    await host.approve(request.requestId, true);
    const metadata = await joining;
    await host.start();
    return { host, candidate, room, metadata };
  }
  async function finish(pair) {
    const hostSocket = pair.host.socket, candidateSocket = pair.candidate.socket;
    const closed = [once(hostSocket, 'close'), once(candidateSocket, 'close')];
    await pair.host.end();
    await Promise.all(closed);
  }
  return { relay, client, paired, finish, outbound, inbound };
}

test('host capability is required, exact, and never taken from room details', async t => {
  let calls = 0;
  const env = await setup(t, { tokenProvider: async () => { calls++; throw new Error('Unexpected provider'); } });
  const host = env.client();
  for (const code of [undefined, '', 'wrong', randomBytes(32).toString('base64url')]) {
    await assert.rejects(host.create({ hostAccessCode: HOST_KEY, hostKey: HOST_KEY }, code), /host access denied/i);
  }
  assert.equal(env.relay.stats.rooms, 0);
  assert.equal(calls, 0);
  const room = await host.create({ role: 'Permitted' }, HOST_KEY);
  assert.equal(room.details.role, 'Permitted');
  assert.equal(env.relay.stats.rooms, 1);
});

test('capability occurs only in the create envelope, never client state or returned room/events', async t => {
  const env = await setup(t);
  const pair = await env.paired();
  const policy = new Promise(resolve => pair.candidate.on('event', value => { if (value.event === 'session_policy') resolve(value); }));
  await pair.host.update({ role: 'Updated' });
  await policy;
  await pair.candidate.send({ type: 'broadcast', event: 'candidate_transcript', payload: { text: 'Synthetic text' } });
  const creates = env.outbound.filter(message => message.op === 'create');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].hostAccessCode, HOST_KEY);
  assert.equal(JSON.stringify(creates[0].data).includes(HOST_KEY), false);
  assert.equal(JSON.stringify(env.outbound.filter(message => message.op !== 'create')).includes(HOST_KEY), false);
  assert.equal(JSON.stringify(env.inbound).includes(HOST_KEY), false);
  assert.equal(JSON.stringify([pair.room, pair.metadata, env.relay.stats]).includes(HOST_KEY), false);
  assert.equal(Object.values(pair.host).includes(HOST_KEY), false);
  assert.equal(Object.values(pair.candidate).includes(HOST_KEY), false);
  await env.finish(pair);
  assert.equal(JSON.stringify(env.inbound).includes(HOST_KEY), false);
});

test('provider-enabled construction fails closed without a valid host key', () => {
  for (const hostKey of ['', 'short', ' '.repeat(32), 'a'.repeat(257), null, 12]) {
    assert.throws(() => createDemoRelay({ hostKey, tokenProvider: async () => assert.fail('provider called') }), /host key|HOST_KEY/i);
  }
  assert.throws(() => createDemoRelay({ hostKey: '' }), /host key|HOST_KEY/i);
});

test('only explicitly provider-disabled loopback listeners can omit the key', async t => {
  const relay = createDemoRelay({ hostKey: '', tokenProvider: null });
  t.after(() => relay.close());
  for (const host of ['0.0.0.0', '::', 'localhost', '192.0.2.1']) await assert.rejects(relay.listen(0, host), /host key|HOST_KEY/i);
  const { port } = await relay.listen(0, '127.0.0.1');
  const client = new DemoRelayClient({ url: `ws://127.0.0.1:${port}/demo` });
  t.after(() => client.close());
  assert.match((await client.create()).code, /^DEMO-/);
});

test('CLI cannot bypass the host key through absent provider, fake test flags, or public binding', () => {
  for (const [providerKey, args] of [['', []], ['not-a-real-provider-key', []], ['', ['--host', '0.0.0.0']]]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), ...args], {
      windowsHide: true, timeout: 2000, encoding: 'utf8',
      env: { ...process.env, DEEPGRAM_API_KEY: providerKey, TRUVEIL_DEMO_HOST_KEY: '', NODE_ENV: 'test', TRUVEIL_DEMO_TRUSTED_TEST: 'true' }
    });
    assert.equal(result.status, 1, result.error?.message);
    assert.doesNotMatch(result.stdout, /listening/i);
    assert.match(result.stderr, /host key|HOST_KEY/i);
    assert.equal(result.stderr.includes(providerKey || 'never-present'), false);
  }
});

test('default per-IP grant budget survives room churn and never calls the provider above its limit', async t => {
  let calls = 0;
  const env = await setup(t, { tokenProvider: async () => ({ accessToken: `synthetic-${++calls}`, expiresIn: 30 }) });
  for (let i = 0; i < DEFAULT_LIMITS.maxTokensPerIpWindow + 1; i++) {
    const pair = await env.paired();
    if (i < DEFAULT_LIMITS.maxTokensPerIpWindow) assert.equal((await pair.candidate.token()).ok, true);
    else await assert.rejects(pair.candidate.token(), /budget|limit|throttled/i);
    await env.finish(pair);
  }
  assert.equal(calls, DEFAULT_LIMITS.maxTokensPerIpWindow);
});

test('IP request bucket cleanup cannot reset the separate grant budget', async t => {
  let calls = 0;
  const env = await setup(t, { limits: { rateWindowMs: 30, heartbeatMs: 100, maxTokensPerIpWindow: 1 },
    tokenProvider: async () => ({ accessToken: `synthetic-${++calls}`, expiresIn: 30 }) });
  const first = await env.paired();
  await first.candidate.token();
  await env.finish(first);
  const deadline = Date.now() + 1000;
  while (env.relay.stats.trackedIps && Date.now() < deadline) await delay(10);
  assert.equal(env.relay.stats.trackedIps, 0);
  const second = await env.paired();
  await assert.rejects(second.candidate.token(), /budget|limit|throttled/i);
  assert.equal(calls, 1);
});

test('server-wide and lifetime grant caps are enforced before provider invocation', async t => {
  for (const limit of ['maxTokensPerServerWindow', 'maxTokensLifetime']) {
    let calls = 0;
    const env = await setup(t, { limits: { [limit]: 2, maxTokensPerIpWindow: 10 },
      tokenProvider: async () => ({ accessToken: `synthetic-${++calls}`, expiresIn: 30 }) });
    for (let i = 0; i < 3; i++) {
      const pair = await env.paired();
      if (i < 2) await pair.candidate.token();
      else await assert.rejects(pair.candidate.token(), /budget|limit|throttled/i);
      await env.finish(pair);
    }
    assert.equal(calls, 2);
  }
});

test('failed provider attempts still consume cross-room grant budget', async t => {
  let calls = 0;
  const env = await setup(t, { limits: { maxTokensLifetime: 1 }, tokenProvider: async () => { calls++; throw new Error('Synthetic failure'); } });
  const first = await env.paired();
  await assert.rejects(first.candidate.token(), /unavailable/i);
  await env.finish(first);
  const second = await env.paired();
  await assert.rejects(second.candidate.token(), /budget|limit|throttled/i);
  assert.equal(calls, 1);
});

test('rolling budgets combine different IPs and lifetime survives window expiry and IP eviction', () => {
  let now = 0;
  const budget = createTokenBudget({ ...DEFAULT_LIMITS, maxTokensPerIpWindow: 1, maxTokensPerServerWindow: 2, maxTokensLifetime: 3 }, () => now);
  budget.consume('192.0.2.1');
  assert.throws(() => budget.consume('192.0.2.1'), /IP token budget/i);
  now = 10000;
  budget.consume('192.0.2.2');
  assert.throws(() => budget.consume('192.0.2.3'), /Relay token budget/i);
  now = 59999;
  assert.throws(() => budget.consume('192.0.2.1'), /Relay token budget/i);
  now = 60000;
  budget.consume('192.0.2.1');
  now = 180000;
  assert.throws(() => budget.consume('192.0.2.4'), /lifetime/i);
  assert.throws(() => budget.consume('192.0.2.1'), /lifetime/i);
});

test('cross-room concurrent and cancelled grants cannot overdraw or refund lifetime budget', async t => {
  let calls = 0, signal;
  const env = await setup(t, { limits: { maxTokensLifetime: 1 }, tokenProvider: options => {
    calls++; signal = options.signal; return new Promise(() => {});
  } });
  const first = await env.paired(), second = await env.paired();
  const pending = assert.rejects(first.candidate.token(), /closed|ended|cancel/i);
  while (!signal) await delay(2);
  await assert.rejects(second.candidate.token(), /lifetime/i);
  await env.finish(first);
  await pending;
  assert.equal(signal.aborted, true);
  await assert.rejects(second.candidate.token(), /lifetime/i);
  assert.equal(calls, 1);
});

test('host capability on a non-create envelope is rejected without echo', async t => {
  const env = await setup(t);
  const pair = await env.paired();
  const closed = once(pair.host, 'closed');
  pair.host.socket.send(JSON.stringify({ id: 999, op: 'token', data: {}, hostAccessCode: HOST_KEY }));
  await closed;
  assert.equal(JSON.stringify(env.inbound).includes(HOST_KEY), false);
});
