'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

const NOW = Date.parse('2026-10-24T12:00:00Z');
const EXPIRY = new Date(NOW + 60 * 60 * 1000).toISOString();
const USER = { id: 'recruiter-1', email: 'synthetic@example.test', is_anonymous: false };
const SESSION = { id: 'TRV-AAAAAA', internal_id: 'session-uuid', join_code: 'TRV-AAAAAA', status: 'candidate_ready' };

// Execute the actual TypeScript handlers and shared modules, replacing only
// Supabase I/O and Deno's runtime boundary. No real credentials or network.
async function harness(slug, options = {}) {
  let handler;
  let now = NOW;
  const calls = [];
  const timers = new Map();
  const pendingTimers = [];
  let timerId = 0;
  const schedule = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  const tick = async (milliseconds, wait = true) => {
    const target = now + milliseconds;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      const [id, timer] = next;
      now = Math.max(now, timer.at);
      timers.delete(id);
      const result = timer.callback();
      if (result?.then) pendingTimers.push(result);
      if (wait) await result;
    }
    now = target;
  };
  const env = {
    SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', SESSION_TOKEN_SECRET: 'synthetic-test-secret',
    ...options.env,
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  function query(table) {
    const call = { table, operation: 'select', filters: [] };
    const builder = {};
    for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'gt', 'limit']) {
      builder[method] = (...args) => {
        if (['insert', 'upsert', 'update', 'delete'].includes(method)) {
          call.operation = method; call.value = args[0];
        } else if (method === 'select') call.columns = args[0];
        else call.filters.push([method, ...args]);
        return builder;
      };
    }
    const finish = async () => {
      calls.push(call);
      const override = options.query?.(call);
      if (override !== undefined) return override;
      if (table === 'organization_members' && call.operation === 'select') {
        return { data: { organization_id: 'org-1', role: 'owner' }, error: null };
      }
      if (table === 'organizations') return { data: { id: 'new-org' }, error: null };
      if (table === 'sessions' && call.operation === 'insert') {
        return { data: { ...call.value, internal_id: 'session-uuid' }, error: null };
      }
      return { data: null, error: null };
    };
    builder.single = finish;
    builder.maybeSingle = finish;
    builder.then = (resolve, reject) => finish().then(resolve, reject);
    return builder;
  }
  const clientFactory = (_url, key) => {
    calls.push({ client: key });
    return {
      auth: { getUser: async token => {
        calls.push({ auth: token });
        if (options.authThrows) throw new Error('provider unavailable');
        return { data: { user: Object.hasOwn(options, 'user') ? options.user : USER }, error: options.authError || null };
      } },
      from: query,
      rpc: async (name, args) => {
        calls.push({ rpc: name, args });
        if (typeof options.rpc === 'function') return options.rpc(name, args);
        if (options.rpc) return options.rpc;
        if (name === 'transition_candidate_session') return { data: { ok: true, status: args.requested_state }, error: null };
        if (name === 'create_recruiter_session') {
          return { data: { session: { ...args.session_data, internal_id: 'session-uuid', recruiter_id: args.recruiter_user, organization_id: 'org-1' } }, error: null };
        }
        return { data: { session: SESSION, expires_at: EXPIRY }, error: null };
      },
    };
  };
  const candidate = {
    close: (code, reason) => calls.push({ candidateClose: code, reason }),
    send: data => calls.push({ candidateSend: data }),
  };
  const providers = [];
  class ProviderSocket {
    static OPEN = 1;
    readyState = 1;
    constructor(url) { providers.push(this); calls.push({ websocket: url }); }
    close(code) {
      // Deno's outbound WebSocket is a Web-standard client, unlike its upgraded server socket.
      if (code !== 1000 && !(code >= 3000 && code <= 4999)) throw new Error('InvalidAccessError: invalid client close code');
      calls.push({ providerClose: code });
    }
    send(data) { calls.push({ providerSend: data }); }
  }
  const context = vm.createContext({
    Request, Response, URL, TextEncoder, TextDecoder, Uint8Array, FormData, Blob, AbortController, btoa, atob, Date: Clock,
    WebSocket: ProviderSocket,
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    fetch: async (url, init) => {
      calls.push({ fetch: url, init });
      if (options.fetch) return options.fetch(url, init);
      if (url.endsWith('/auth/grant')) {
        return Response.json({ access_token: 'synthetic-provider-token', expires_in: JSON.parse(init.body).ttl_seconds });
      }
      if (url.includes('api.deepgram.com/v1/listen')) {
        return Response.json({ results: { channels: [{ alternatives: [{ transcript: 'Synthetic transcript', confidence: 0.9 }] }] } });
      }
      throw new Error('Unexpected provider call');
    },
    crypto: { subtle: webcrypto.subtle, getRandomValues: values => values.fill(0) },
    console: { error() {} },
    Deno: {
      serve: fn => { handler = fn; }, env: { get: key => env[key] },
      upgradeWebSocket: () => {
        calls.push({ upgrade: true });
        // Node Response does not support 101; only the Deno upgrade boundary is mocked.
        return { socket: candidate, response: new Response(null, { status: 200 }) };
      },
    },
  });
  const modules = new Map();
  async function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(filename, 'utf8')), {
      context, identifier: filename,
    });
    modules.set(filename, mod);
    await mod.link(async (specifier, importing) => {
      if (specifier === 'https://esm.sh/@supabase/supabase-js@2') {
        return new vm.SyntheticModule(['createClient'], function () {
          this.setExport('createClient', clientFactory);
        }, { context });
      }
      assert.ok(specifier.startsWith('.'), 'unexpected external import');
      return load(path.resolve(path.dirname(importing.identifier), specifier));
    });
    return mod;
  }
  const entry = await load(path.join(__dirname, '../functions', slug, 'index.ts'));
  await entry.evaluate();
  return {
    calls,
    handle: handler,
    advance: milliseconds => { now += milliseconds; },
    tick,
    settleTimers: () => Promise.all(pendingTimers),
    timerCount: () => timers.size,
    open: () => candidate.onopen(),
    audio: data => candidate.onmessage({ data }),
    clientEvent: type => candidate['on' + type]?.(),
    providerEvent: (type, data) => providers.at(-1)?.['on' + type]?.({ data }),
    token: async (claims = {}) => {
      const mod = await load(path.join(__dirname, '../functions/_shared/session-token.ts'));
      if (mod.status !== 'evaluated') await mod.evaluate();
      return mod.namespace.issueSessionToken({ sessionId: 'session-uuid', userId: 'candidate-1', exp: NOW / 1000 + 3600, ...claims }, env.SESSION_TOKEN_SECRET);
    },
    request: (body = {}, headers = {}, method = 'POST') => handler(new Request('https://synthetic.invalid/functions/v1/' + slug, {
      method, headers: { authorization: 'Bearer test-user-jwt', 'content-type': 'application/json', ...headers },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    })),
  };
}

test('creation refuses missing/malformed/API-key auth before creating any client', async () => {
  for (const authorization of ['', 'Basic credentials', 'Bearer test-anon-key', 'Bearer']) {
    const h = await harness('create-session');
    assert.equal((await h.request({}, { authorization })).status, 401);
    assert.deepEqual(h.calls, []);
  }
});

test('creation refuses invalid, anonymous, and non-email identities before privileged I/O', async () => {
  for (const options of [{ user: null }, { authError: { message: 'expired' } },
    { user: { ...USER, is_anonymous: true } }, { user: { id: 'candidate-1', is_anonymous: true } },
    { user: { id: 'missing-email' } }]) {
    const h = await harness('create-session', options);
    assert.equal((await h.request()).status, 401);
    assert.ok(!h.calls.some(c => c.client === 'test-service-key' || c.table));
  }
});

test('auth provider failure fails closed', async () => {
  const h = await harness('create-session', { authThrows: true });
  assert.equal((await h.request()).status, 500);
  assert.ok(!h.calls.some(c => c.client === 'test-service-key'));
});

test('signed-in recruiter creates owned session and canonical candidate invitation', async () => {
  for (const candidateAppUrl of [undefined, 'https://truveil-client.vercel.app', 'https://truveil-secure.vercel.app/login.html?stale=1']) {
    const h = await harness('create-session');
    const response = await h.request({ candidateAppUrl, candidateName: 'Synthetic Candidate' });
    assert.equal(response.status, 200);
    const { session } = await response.json();
    assert.equal(session.candidate_link, 'https://truveil-secure.vercel.app/?code=TRV-AAAAAA&open=1');
    assert.equal(session.recruiter_id, USER.id);
    assert.equal(session.organization_id, 'org-1');
    assert.equal(h.calls.find(c => c.auth).auth, 'test-user-jwt');
    const call = h.calls.find(c => c.rpc === 'create_recruiter_session');
    assert.equal(call.args.recruiter_user, USER.id);
    assert.equal(call.args.session_data.recruiter_id, undefined);
    assert.ok(!h.calls.some(c => c.table), 'creation must be one atomic RPC');
  }
});

test('workspace role and database errors fail closed', async () => {
  for (const [result, status] of [[{ data: { status_code: 403, error: 'Recruiter workspace access is required.' }, error: null }, 403],
    [{ data: null, error: { message: 'database detail' } }, 500]]) {
    const h = await harness('create-session', { rpc: result });
    assert.equal((await h.request()).status, status);
    assert.ok(!h.calls.some(c => c.operation === 'insert'));
  }
});

test('caller cannot choose another recruiter, organization, status or expiry', async () => {
  const h = await harness('create-session');
  assert.equal((await h.request({ recruiter_user: 'victim', recruiter_id: 'victim', organization_id: 'victim-org', status: 'active', expires_at: '2099-01-01' })).status, 200);
  const args = h.calls.find(c => c.rpc).args;
  assert.equal(args.recruiter_user, USER.id);
  for (const field of ['recruiter_id', 'organization_id', 'status', 'expires_at']) assert.equal(args.session_data[field], undefined);
});

test('bad payload, URL and policy do not create privileged clients or sessions', async () => {
  for (const body of ['{', 'null', [], { candidateAppUrl: 'javascript:alert(1)' },
    { candidateAppUrl: 'https://user:password@example.test' }, { policy: { allowed_apps: 'anything' } }]) {
    const h = await harness('create-session');
    assert.equal((await h.request(body)).status, 400);
    assert.ok(!h.calls.some(c => c.client === 'test-service-key'));
  }
});

test('creation never returns invitation on transaction or malformed-result errors', async () => {
  for (const rpc of [{ data: null, error: { message: 'private database detail' } }, { data: {}, error: null }]) {
    const h = await harness('create-session', { rpc });
    const response = await h.request();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Could not create session.' });
  }
});

test('candidate join requires a real Auth user but accepts anonymous candidate identity', async () => {
  const denied = await harness('candidate-join', { user: null });
  assert.equal((await denied.request({ joinCode: 'TRV-AAAAAA' })).status, 401);
  assert.ok(!denied.calls.some(c => c.rpc || c.client === 'test-service-key'));
  const h = await harness('candidate-join', { user: { id: 'candidate-1', is_anonymous: true } });
  const response = await h.request({ joinCode: ' trv-aaaaaa ', candidateName: 'Synthetic' });
  assert.equal(response.status, 200);
  const body = await response.json();
  const claims = JSON.parse(Buffer.from(body.sessionToken.split('.')[0], 'base64url'));
  assert.equal(claims.userId, 'candidate-1');
  assert.equal(claims.exp, Date.parse(EXPIRY) / 1000);
  assert.equal(body.expiresAt, EXPIRY);
  assert.equal(h.calls.find(c => c.rpc).args.target_code, 'TRV-AAAAAA');
});

test('candidate join propagates claim denials and fails closed on missing migration', async () => {
  for (const code of [404, 409, 410]) {
    const h = await harness('candidate-join', { rpc: { data: { status_code: code, error: 'Denied' }, error: null } });
    const response = await h.request({ joinCode: 'TRV-AAAAAA' });
    assert.equal(response.status, code);
    assert.equal((await response.json()).sessionToken, undefined);
  }
  const h = await harness('candidate-join', { rpc: { data: null, error: { message: 'missing RPC' } } });
  assert.equal((await h.request({ joinCode: 'TRV-AAAAAA' })).status, 500);
});

test('candidate-state rejects forged and expired tokens without database access', async () => {
  const h = await harness('candidate-state');
  for (const token of ['', 'bad.signature', await h.token({ exp: NOW / 1000 - 1 })]) {
    assert.equal((await h.request({ status: 'candidate_ready' }, { 'x-session-token': token })).status, 401);
  }
  assert.ok(!h.calls.some(c => c.table));
});

test('candidate state changes compare current lifecycle and expiry before writing', async () => {
  for (const current of ['waiting', 'candidate_ready', 'active', 'completed', 'cancelled', 'interrupted']) {
    for (const next of ['candidate_ready', 'interrupted']) {
      const h = await harness('candidate-state', { query: c => {
        if (c.table === 'session_participants') {
          const row = membership();
          row.session.status = current;
          return accessQuery(row)(c);
        }
        throw new Error('Candidate state must not issue a separate table update');
      }, rpc: (name, args) => {
        assert.equal(name, 'transition_candidate_session');
        assert.equal(args.target_session, 'session-uuid');
        assert.equal(args.candidate_user, 'candidate-1');
        assert.equal(args.requested_state, next);
        assert.equal(args.token_expiry, EXPIRY);
        const allowed = next === 'candidate_ready' ? ['waiting', 'candidate_ready'] : ['candidate_ready', 'active'];
        return { data: allowed.includes(current) ? { ok: true, status: next } : { status_code: 409, error: 'State changed' }, error: null };
      } });
      const response = await h.request({ status: next }, { 'x-session-token': await h.token() });
      const allowed = next === 'candidate_ready' ? ['waiting', 'candidate_ready'] : ['candidate_ready', 'active'];
      assert.equal(response.status, allowed.includes(current) ? 200 : 409, `${current} -> ${next}`);
    }
  }
});

test('method guards and production CORS origins', async () => {
  for (const slug of ['create-session', 'candidate-join', 'candidate-state']) {
    const h = await harness(slug);
    assert.equal((await h.request({}, {}, 'GET')).status, 405);
    for (const origin of ['https://truveil-secure.vercel.app', 'https://truveil-recruiter.vercel.app']) {
      assert.equal((await h.request({}, { origin }, 'OPTIONS')).headers.get('access-control-allow-origin'), origin);
    }
    assert.equal((await h.request({}, { origin: 'https://untrusted.invalid' }, 'OPTIONS')).headers.get('access-control-allow-origin'), null);
    assert.deepEqual(h.calls, []);
  }
});

test('candidate-state requires current matching candidate membership, not just a signed token', async () => {
  const rows = [null, { ...membership(), user_id: 'another-candidate' },
    { ...membership(), session_id: 'another-session' }, { ...membership(), participant_role: 'recruiter' },
    { ...membership(), participant_role: 'reviewer' }, { ...membership(), session: null },
    { ...membership(), session: { ...membership().session, internal_id: 'another-session' } }];
  for (const row of rows) {
    for (const status of ['candidate_ready', 'interrupted']) {
      const h = await harness('candidate-state', { query: accessQuery(row) });
      assert.equal((await h.request({ status }, { 'x-session-token': await h.token() })).status, 403);
      assert.ok(!h.calls.some(c => c.operation === 'update'));
    }
  }
});

test('candidate-state rejects expired/malformed membership and session deadlines before mutation', async () => {
  for (const field of ['membership', 'session']) {
    for (const expiry of [null, 'invalid', new Date(NOW).toISOString(), new Date(NOW - 1).toISOString()]) {
      const row = membership();
      (field === 'session' ? row.session : row).expires_at = expiry;
      const h = await harness('candidate-state', { query: accessQuery(row) });
      assert.equal((await h.request({ status: 'interrupted' }, { 'x-session-token': await h.token() })).status, 410);
      assert.ok(!h.calls.some(c => c.operation === 'update'));
    }
  }
});

test('candidate-state lookup errors and exceptions fail closed without mutation', async () => {
  for (const query of [() => ({ data: membership(), error: { message: 'private detail' } }),
    () => { throw new Error('private detail'); }]) {
    const h = await harness('candidate-state', { query });
    const response = await h.request({ status: 'interrupted' }, { 'x-session-token': await h.token() });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Could not verify candidate access.' });
    assert.ok(!h.calls.some(c => c.operation === 'update'));
  }
});

test('candidate-state retains lifecycle compare-and-set if recruiter cancels after the access read', async () => {
  const h = await harness('candidate-state', { query: call => {
    if (call.table === 'session_participants') return accessQuery(membership())(call);
    throw new Error('Direct state updates are forbidden');
  }, rpc: { data: { status_code: 409, error: 'Session ended' }, error: null } });
  assert.equal((await h.request({ status: 'interrupted' }, { 'x-session-token': await h.token() })).status, 409);
});

test('candidate-state honors atomic RPC denial when access changes after its initial lookup', async () => {
  for (const status_code of [403, 410]) {
    const h = await harness('candidate-state', { query: accessQuery(membership()),
      rpc: { data: { status_code, error: 'Access ended during request' }, error: null } });
    assert.equal((await h.request({ status: 'interrupted' }, { 'x-session-token': await h.token() })).status, status_code);
    assert.equal(h.calls.filter(c => c.rpc === 'transition_candidate_session').length, 1);
    assert.ok(!h.calls.some(c => c.operation === 'update'));
  }
});

test('candidate-state does not write when membership expires while reading the request body', async () => {
  const row = membership();
  row.expires_at = new Date(NOW + 1000).toISOString();
  const h = await harness('candidate-state', { query: accessQuery(row) });
  const response = await h.handle({ method: 'POST', headers: new Headers({ 'x-session-token': await h.token() }),
    json: async () => { h.advance(1000); return { status: 'interrupted' }; } });
  assert.equal(response.status, 410);
  assert.ok(!h.calls.some(c => c.operation === 'update'));
});

test('candidate-state verifies membership after request body consumption', async () => {
  let row = membership();
  const h = await harness('candidate-state', { query: call => accessQuery(row)(call) });
  const response = await h.handle({ method: 'POST', headers: new Headers({ 'x-session-token': await h.token() }),
    json: async () => { row = null; return { status: 'interrupted' }; } });
  assert.equal(response.status, 403);
  assert.ok(!h.calls.some(c => c.operation === 'update'));
});

const TRANSCRIPTION_ROUTES = ['transcribe-live', 'transcribe-chunk', 'transcription-token'];
const PROVIDER_ENV = { DEEPGRAM_API_KEY: 'synthetic-deepgram-key', GROQ_API_KEY: 'synthetic-groq-key' };
const membership = () => ({
  session_id: 'session-uuid', user_id: 'candidate-1', participant_role: 'candidate', expires_at: EXPIRY,
  session: { internal_id: 'session-uuid', status: 'active', expires_at: EXPIRY },
});
function accessQuery(row) {
  return call => {
    assert.equal(call.table, 'session_participants');
    assert.equal(call.operation, 'select');
    assert.equal(call.columns, 'session_id,user_id,participant_role,expires_at,session:sessions!inner(internal_id,status,expires_at,technical_vocabulary)');
    for (const [field, value] of [['session_id', 'session-uuid'], ['user_id', 'candidate-1'], ['participant_role', 'candidate']]) {
      assert.ok(call.filters.some(f => f[0] === 'eq' && f[1] === field && f[2] === value));
    }
    return { data: row, error: null };
  };
}
async function transcribe(h, slug, token) {
  return h.request('synthetic-audio', { 'x-session-token': token ?? await h.token(), upgrade: 'websocket' }, slug === 'transcribe-live' ? 'GET' : 'POST');
}
function noProvider(h) {
  assert.ok(!h.calls.some(c => c.fetch || c.websocket || c.upgrade || c.providerSend), 'denied access must not contact providers or upgrade');
}

for (const slug of ['transcribe-live', 'transcribe-chunk']) {
  test(`${slug} Deepgram speech request opts out of model improvement`, async () => {
    const h = await harness(slug, { env: PROVIDER_ENV, query: accessQuery(membership()) });
    try {
      assert.equal((await transcribe(h, slug)).status, 200);
      if (slug === 'transcribe-live') await h.open();
      const requests = h.calls.filter(call => call.websocket || call.fetch);
      assert.equal(requests.length, 1);
      const url = new URL(requests[0].websocket || requests[0].fetch);
      assert.equal(url.hostname, 'api.deepgram.com');
      assert.equal(url.protocol, slug === 'transcribe-live' ? 'wss:' : 'https:');
      assert.equal(url.pathname, '/v1/listen');
      assert.deepEqual(url.searchParams.getAll('keyterm'), ['Truveil']);
      assert.deepEqual(url.searchParams.getAll('mip_opt_out'), ['true']);
      assert.equal(url.searchParams.get('model'), 'nova-3');
      assert.equal(url.searchParams.get('language'), slug === 'transcribe-live' ? 'en-US' : 'en');
      for (const option of ['smart_format', 'punctuate', 'filler_words']) {
        assert.equal(url.searchParams.get(option), 'true', option);
      }
      assert.ok(!url.href.includes(PROVIDER_ENV.DEEPGRAM_API_KEY));
      if (slug === 'transcribe-live') {
        assert.equal(url.searchParams.get('interim_results'), 'true');
        assert.equal(url.searchParams.get('endpointing'), '300');
        assert.equal(url.searchParams.get('utterance_end_ms'), '1000');
        assert.equal(url.searchParams.get('vad_events'), 'true');
      } else {
        assert.equal(requests[0].init.method, 'POST');
        assert.equal(requests[0].init.headers.Authorization, `Token ${PROVIDER_ENV.DEEPGRAM_API_KEY}`);
      }
    } finally {
      if (slug === 'transcribe-live') h.clientEvent('close');
    }
  });
}

for (const slug of ['transcribe-live', 'transcribe-chunk']) {
  test(`${slug} uses bounded session vocabulary without changing recognized speech`, async () => {
    const row = membership();
    row.session.technical_vocabulary = [' TRUVEIL ', 'Asha Mehta', 'PostgreSQL', 'postgresql', null, {}, 42, '', 'x'.repeat(81)];
    const h = await harness(slug, { env: PROVIDER_ENV, query: accessQuery(row) });
    const response = await transcribe(h, slug);
    assert.equal(response.status, 200);
    if (slug === 'transcribe-live') await h.open();
    const request = h.calls.find(call => call.websocket || call.fetch);
    assert.deepEqual(new URL(request.websocket || request.fetch).searchParams.getAll('keyterm'), ['Truveil', 'Asha Mehta', 'PostgreSQL']);
    if (slug === 'transcribe-chunk') assert.equal((await response.json()).text, 'Synthetic transcript');
    else h.clientEvent('close');
  });
}

test('Whisper backup receives a short spelling glossary, not an invented transcript', async () => {
  const row = membership();
  row.session.technical_vocabulary = ['Asha Mehta', 'PostgreSQL', ...Array.from({ length: 100 }, (_, i) => 'LongName' + i)];
  const h = await harness('transcribe-chunk', {
    env: PROVIDER_ENV, query: accessQuery(row),
    fetch: async url => url.includes('deepgram') ? new Response(null, { status: 502 }) : Response.json({ text: 'Original words from speech.' })
  });
  const response = await transcribe(h, 'transcribe-chunk');
  const request = h.calls.find(call => call.fetch?.includes('api.groq.com'));
  const prompt = request.init.body.get('prompt');
  assert.match(prompt, /Truveil.*Asha Mehta.*PostgreSQL/);
  assert.ok(Buffer.byteLength(prompt, 'utf8') <= 200);
  const result = await response.json();
  assert.equal(result.text, 'Original words from speech.');
  assert.equal(result.confidence, null);
  assert.equal(result.confidenceKnown, false);
});

test('backend spelling hints bound Unicode bytes and cannot change provider options', async () => {
  for (const vocabulary of [null, 'Truveil', {}, ['C++', 'A&B?model=other', '\u0000bad'],
    Array.from({ length: 100 }, (_, i) => '\u65e5'.repeat(60) + i)]) {
    const row = membership();
    row.session.technical_vocabulary = vocabulary;
    const h = await harness('transcribe-chunk', {
      env: PROVIDER_ENV, query: accessQuery(row),
      fetch: async () => deepgramResult('TrueVale is what the provider returned.', 0.95)
    });
    const response = await transcribe(h, 'transcribe-chunk');
    assert.equal(response.status, 200);
    const url = new URL(h.calls.find(call => call.fetch).fetch);
    const terms = url.searchParams.getAll('keyterm');
    assert.equal(terms[0], 'Truveil');
    assert.deepEqual(url.searchParams.getAll('model'), ['nova-3']);
    assert.ok(terms.length <= 30);
    assert.ok(terms.reduce((n, term) => n + Buffer.byteLength(term, 'utf8') + 1, 0) <= 320);
    assert.ok(!terms.some(term => term.includes('\u0000')));
    assert.equal((await response.json()).text, 'TrueVale is what the provider returned.');
  }
});

test('every transcription route rejects malformed, forged, expired and incomplete claims before database I/O', async () => {
  for (const slug of TRANSCRIPTION_ROUTES) {
    const h = await harness(slug, { env: PROVIDER_ENV });
    for (const token of ['', 'forged.signature', await h.token({ exp: NOW / 1000 }),
      await h.token({ exp: NOW / 1000 - 1 }), await h.token({ exp: 'not-a-time' }),
      await h.token({ userId: null }), await h.token({ sessionId: null })]) {
      assert.equal((await transcribe(h, slug, token)).status, 401, slug);
    }
    assert.ok(!h.calls.some(c => c.table));
    noProvider(h);
  }
});

test('every transcription route denies non-live and terminal session states', async () => {
  for (const slug of TRANSCRIPTION_ROUTES) {
    for (const status of ['waiting', 'completed', 'ended', 'cancelled', 'interrupted', null, 'unknown']) {
      const row = membership();
      row.session.status = status;
      const h = await harness(slug, { env: PROVIDER_ENV, query: accessQuery(row) });
      assert.equal((await transcribe(h, slug)).status, 409, `${slug}: ${status}`);
      noProvider(h);
    }
  }
});

test('every transcription route requires matching candidate membership and joined session', async () => {
  const rows = [null, { ...membership(), user_id: 'another-candidate' },
    { ...membership(), session_id: 'another-session' }, { ...membership(), participant_role: 'recruiter' },
    { ...membership(), participant_role: 'reviewer' }, { ...membership(), session: null },
    { ...membership(), session: [] }, { ...membership(), session: { ...membership().session, internal_id: 'another-session' } }];
  for (const slug of TRANSCRIPTION_ROUTES) {
    for (const row of rows) {
      const h = await harness(slug, { env: PROVIDER_ENV, query: accessQuery(row) });
      assert.equal((await transcribe(h, slug)).status, 403, slug);
      noProvider(h);
    }
  }
});

test('every transcription route rejects expired, null, and malformed membership/session expiries', async () => {
  for (const slug of TRANSCRIPTION_ROUTES) {
    for (const field of ['membership', 'session']) {
      for (const value of [new Date(NOW - 1000).toISOString(), new Date(NOW).toISOString(), null, 'not-a-date']) {
        const row = membership();
        (field === 'session' ? row.session : row).expires_at = value;
        const h = await harness(slug, { env: PROVIDER_ENV, query: accessQuery(row) });
        assert.equal((await transcribe(h, slug)).status, 410, `${slug}: ${field}`);
        noProvider(h);
      }
    }
  }
});

test('every transcription route fails closed on lookup errors, transport exceptions, and missing signer config', async () => {
  for (const slug of TRANSCRIPTION_ROUTES) {
    for (const query of [() => ({ data: membership(), error: { message: 'private database detail' } }),
      () => { throw new Error('private connection detail'); }]) {
      const h = await harness(slug, { env: PROVIDER_ENV, query });
      const response = await transcribe(h, slug);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'Could not verify candidate access.' });
      noProvider(h);
    }
    const h = await harness(slug, { env: { ...PROVIDER_ENV, SESSION_TOKEN_SECRET: '', SUPABASE_SERVICE_ROLE_KEY: '' } });
    assert.equal((await transcribe(h, slug, 'unverifiable.token')).status, 503);
    noProvider(h);
  }
});

test('candidate_ready and active members can use all three transcription routes', async () => {
  for (const slug of TRANSCRIPTION_ROUTES) {
    for (const status of ['candidate_ready', 'active']) {
      const row = membership();
      row.session.status = status;
      const h = await harness(slug, { env: PROVIDER_ENV, query: accessQuery(row) });
      assert.equal((await transcribe(h, slug)).status, 200);
      if (slug === 'transcribe-live') {
        assert.equal(h.calls.filter(c => c.upgrade).length, 1);
        assert.ok(!h.calls.some(c => c.websocket));
        await h.open();
        assert.equal(h.calls.filter(c => c.websocket).length, 1);
        h.audio('synthetic-stream-audio');
        assert.equal(h.calls.find(c => c.providerSend).providerSend, 'synthetic-stream-audio');
      } else {
        assert.equal(h.calls.filter(c => c.fetch).length, 1);
      }
      assert.equal(h.calls.filter(c => c.table).length, 2, 'access rechecked at provider boundary');
    }
  }
});

test('chunk access is rechecked after reading audio, before the first provider upload', async () => {
  const row = membership();
  const h = await harness('transcribe-chunk', { env: PROVIDER_ENV, query: accessQuery(row) });
  const response = await h.handle({
    method: 'POST', headers: new Headers({ 'x-session-token': await h.token() }),
    arrayBuffer: async () => { row.session.status = 'cancelled'; return new ArrayBuffer(3); },
  });
  assert.equal(response.status, 409);
  noProvider(h);
});

test('chunk fallback does not upload to a second provider after cancellation, revocation or expiry', async () => {
  for (const revoke of [row => { row.session.status = 'cancelled'; },
    row => { row.participant_role = 'reviewer'; }, row => { row.expires_at = new Date(NOW).toISOString(); }]) {
    const row = membership();
    const h = await harness('transcribe-chunk', {
      env: PROVIDER_ENV, query: accessQuery(row),
      fetch: async () => { revoke(row); return new Response(null, { status: 502 }); },
    });
    assert.ok([403, 409, 410].includes((await transcribe(h, 'transcribe-chunk')).status));
    assert.equal(h.calls.filter(c => c.fetch).length, 1);
    assert.ok(!h.calls.some(c => c.fetch?.includes('groq.com')));
  }
});

test('chunk fallback remains available to a current candidate after provider failure', async () => {
  const h = await harness('transcribe-chunk', {
    env: PROVIDER_ENV, query: accessQuery(membership()),
    fetch: async url => url.includes('deepgram') ? new Response(null, { status: 502 }) : Response.json({ text: 'Synthetic fallback transcript' }),
  });
  const response = await transcribe(h, 'transcribe-chunk');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, 'groq-whisper-chunk');
  assert.equal(h.calls.filter(c => c.fetch).length, 2);
  assert.equal(h.calls.filter(c => c.table).length, 3);
});

function deepgramResult(transcript, confidence, words) {
  return Response.json({ results: { channels: [{ alternatives: [{ transcript, confidence, words }] }] } });
}

test('chunk keeps reliable primary speech and exposes only measured quality', async () => {
  const h = await harness('transcribe-chunk', {
    env: PROVIDER_ENV, query: accessQuery(membership()),
    fetch: async () => deepgramResult('  Clear primary speech.  ', 0.94, [{ confidence: 0.9 }, { confidence: 0.8 }]),
  });
  assert.deepEqual(await (await transcribe(h, 'transcribe-chunk')).json(), {
    text: 'Clear primary speech.', confidence: 0.94, confidenceKnown: true,
    source: 'deepgram-nova-3-chunk', qualityReason: null, lowConfidenceWordRatio: 0,
  });
  assert.equal(h.calls.filter(c => c.fetch).length, 1);
  assert.equal(h.timerCount(), 0);
});

test('chunk retries empty, hallucinated, low-confidence and unknown-confidence primary success', async () => {
  for (const [text, confidence] of [['', 0.9], ['[silence]', 0.9], ['Unclear primary speech.', 0.3], ['Unknown primary speech.', undefined]]) {
    const h = await harness('transcribe-chunk', {
      env: PROVIDER_ENV, query: accessQuery(membership()),
      fetch: async url => url.includes('deepgram') ? deepgramResult(text, confidence) : Response.json({
        text: 'Recovered useful speech.',
        segments: [{ text: 'Recovered useful speech.', avg_logprob: -0.05, no_speech_prob: 0.01, compression_ratio: 1.2 }],
      }),
    });
    const response = await transcribe(h, 'transcribe-chunk');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      text: 'Recovered useful speech.', confidence: null, confidenceKnown: false,
      source: 'groq-whisper-chunk', qualityReason: 'confidence-unavailable', lowConfidenceWordRatio: null,
    });
    const form = h.calls.find(c => c.fetch?.includes('groq.com')).init.body;
    assert.equal(form.get('model'), 'whisper-large-v3');
    assert.equal(form.get('response_format'), 'verbose_json');
    assert.equal(form.get('timestamp_granularities[]'), 'segment');
    assert.equal(form.get('temperature'), '0');
    assert.equal(form.get('language'), 'en');
    assert.equal(await form.get('file').text(), 'synthetic-audio');
    assert.equal(h.calls.filter(c => c.table).length, 3);
    assert.equal(h.timerCount(), 0);
  }
});

test('chunk preserves valid weak primary text if fallback fails, is silent, or is not configured', async () => {
  const failures = [
    () => { throw new Error('private provider details'); },
    () => new Response('private upstream error', { status: 503 }),
    () => new Response('{malformed'),
    () => Response.json(null),
    () => Response.json({ text: { invalid: 'shape' } }),
    () => Response.json({ text: '' }),
    () => Response.json({ text: 'Thank you for watching!' }),
    null,
  ];
  for (const failure of failures) {
    const h = await harness('transcribe-chunk', {
      env: { ...PROVIDER_ENV, ...(!failure ? { GROQ_API_KEY: undefined } : {}) }, query: accessQuery(membership()),
      fetch: async url => url.includes('deepgram') ? deepgramResult('Keep my uncertain words.', 0.3) : failure(),
    });
    const response = await transcribe(h, 'transcribe-chunk');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.text, 'Keep my uncertain words.');
    assert.equal(result.confidence, 0.3);
    assert.equal(result.qualityReason, 'low-confidence');
    assert.equal(result.source, 'deepgram-nova-3-chunk');
    assert.equal(h.timerCount(), 0);
  }
});

test('chunk never coerces missing, null, string, or invalid confidence into certainty', async () => {
  for (const confidence of [undefined, null, '0.99', '', {}, -0.1, 1.1]) {
    const h = await harness('transcribe-chunk', {
      env: { DEEPGRAM_API_KEY: 'synthetic' }, query: accessQuery(membership()),
      fetch: async () => deepgramResult('Reviewable speech.', confidence),
    });
    const result = await (await transcribe(h, 'transcribe-chunk')).json();
    assert.equal(result.text, 'Reviewable speech.');
    assert.equal(result.confidence, null);
    assert.equal(result.confidenceKnown, false);
    assert.equal(result.lowConfidenceWordRatio, null);
    assert.equal(result.qualityReason, 'confidence-unavailable');
  }
  const h = await harness('transcribe-chunk', {
    env: { DEEPGRAM_API_KEY: 'synthetic' }, query: accessQuery(membership()),
    fetch: async () => deepgramResult('Very uncertain speech.', 0),
  });
  const result = await (await transcribe(h, 'transcribe-chunk')).json();
  assert.equal(result.confidence, 0);
  assert.equal(result.confidenceKnown, true);
  assert.equal(result.qualityReason, 'low-confidence');
});

test('chunk word-confidence tail triggers fallback even with high overall confidence', async () => {
  const h = await harness('transcribe-chunk', {
    env: PROVIDER_ENV, query: accessQuery(membership()),
    fetch: async url => url.includes('deepgram')
      ? deepgramResult('One two three four.', 0.95, [0.1, 0.5, 0.9, 0.99].map(confidence => ({ confidence })))
      : new Response(null, { status: 503 }),
  });
  const result = await (await transcribe(h, 'transcribe-chunk')).json();
  assert.equal(result.text, 'One two three four.');
  assert.equal(result.lowConfidenceWordRatio, 0.5);
  assert.equal(result.qualityReason, 'low-confidence-words');
  assert.equal(h.calls.filter(c => c.fetch).length, 2);
});

test('chunk partial word confidence is unknown, never treated as a clean zero', async () => {
  for (const words of [[], [{ confidence: 0.9 }, {}], [{ confidence: '0.9' }], [null]]) {
    const h = await harness('transcribe-chunk', {
      env: PROVIDER_ENV, query: accessQuery(membership()),
      fetch: async () => deepgramResult('Useful primary words.', 0.9, words),
    });
    assert.equal((await (await transcribe(h, 'transcribe-chunk')).json()).lowConfidenceWordRatio, null);
  }
});

test('chunk fallback safely handles provider errors, malformed JSON and malformed envelopes', async () => {
  for (const failure of [() => { throw new Error('private network failure'); },
    () => new Response('private HTTP failure', { status: 429 }), () => new Response('{invalid'),
    () => Response.json(null), () => Response.json([]), () => Response.json('not an object'),
    () => Response.json({ results: { channels: 'bad' } }),
    () => Response.json({ text: 7, results: { channels: [{ alternatives: [{ transcript: {} }] }] } })]) {
    const h = await harness('transcribe-chunk', {
      env: PROVIDER_ENV, query: accessQuery(membership()), fetch: async () => failure(),
    });
    const response = await transcribe(h, 'transcribe-chunk');
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'No transcription provider was available.' });
    assert.equal(h.calls.filter(c => c.fetch).length, 2);
    assert.equal(h.timerCount(), 0);
  }
});

test('chunk removes silence hallucinations per segment while retaining surrounding speech', async () => {
  for (const includeSpeech of [true, false]) {
    const segments = [
      { text: 'Invented content.', avg_logprob: -1.4, no_speech_prob: 0.98 },
      { text: 'Thank you for watching!', avg_logprob: -0.1, no_speech_prob: 0.01 },
      ...(includeSpeech ? [{ text: 'Actual interview answer.', avg_logprob: -0.2, no_speech_prob: 0.01 }] : []),
    ];
    const h = await harness('transcribe-chunk', {
      env: { GROQ_API_KEY: 'synthetic' }, query: accessQuery(membership()),
      fetch: async () => Response.json({ text: segments.map(s => s.text).join(' '), segments }),
    });
    const result = await (await transcribe(h, 'transcribe-chunk')).json();
    assert.equal(result.text, includeSpeech ? 'Actual interview answer.' : '');
    assert.equal(result.qualityReason, includeSpeech ? 'silence-filtered' : 'no-speech');
    assert.equal(result.confidence, null);
    assert.equal(result.lowConfidenceWordRatio, null);
  }
});

test('chunk keeps uncertain/repetitive Whisper speech visible but uncalibrated', async () => {
  for (const [metadata, reason] of [
    [{ avg_logprob: -1.2, no_speech_prob: 0.1 }, 'low-confidence'],
    [{ avg_logprob: -0.1, no_speech_prob: 0.99 }, 'confidence-unavailable'],
    [{ compression_ratio: 3.2 }, 'repetition-risk'],
    [{ avg_logprob: '-0.1', no_speech_prob: null }, 'confidence-unavailable'],
  ]) {
    const h = await harness('transcribe-chunk', {
      env: { GROQ_API_KEY: 'synthetic' }, query: accessQuery(membership()),
      fetch: async () => Response.json({ text: 'Review these words.', segments: [{ text: 'Review these words.', ...metadata }] }),
    });
    const result = await (await transcribe(h, 'transcribe-chunk')).json();
    assert.equal(result.text, 'Review these words.');
    assert.equal(result.confidence, null);
    assert.equal(result.confidenceKnown, false);
    assert.equal(result.qualityReason, reason);
  }
});

test('chunk provider deadline bounds both fetch and JSON-body stalls and aborts the request', async () => {
  for (const provider of ['deepgram', 'groq']) {
    for (const stallAt of ['fetch', 'json']) {
      let started;
      const ready = new Promise(resolve => { started = resolve; });
      const stalled = new Promise(() => {});
      const h = await harness('transcribe-chunk', {
        env: PROVIDER_ENV, query: accessQuery(membership()),
        fetch: async url => {
          if (url.includes(provider)) {
            if (stallAt === 'fetch') { started(); return stalled; }
            return { ok: true, json: async () => { started(); return stalled; } };
          }
          return url.includes('deepgram') ? deepgramResult('Uncertain but useful.', 0.3) : Response.json({ text: 'Recovered after timeout.' });
        },
      });
      const responsePromise = transcribe(h, 'transcribe-chunk');
      await ready;
      const call = h.calls.find(c => c.fetch?.includes(provider));
      assert.equal(call.init.signal.aborted, false);
      await h.tick(12000);
      const response = await responsePromise;
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.text, provider === 'deepgram' ? 'Recovered after timeout.' : 'Uncertain but useful.');
      assert.equal(call.init.signal.aborted, true);
      assert.equal(h.timerCount(), 0);
    }
  }
});

test('chunk never retries weak primary success after end, revocation or expiry', async () => {
  for (const revoke of [row => { row.session.status = 'completed'; },
    row => { row.participant_role = 'reviewer'; }, row => { row.expires_at = new Date(NOW).toISOString(); }]) {
    const row = membership();
    const h = await harness('transcribe-chunk', {
      env: PROVIDER_ENV, query: accessQuery(row),
      fetch: async () => { revoke(row); return deepgramResult('Uncertain primary.', 0.3); },
    });
    const response = await transcribe(h, 'transcribe-chunk');
    assert.ok([403, 409, 410].includes(response.status));
    assert.equal((await response.json()).text, undefined);
    assert.equal(h.calls.filter(c => c.fetch).length, 1);
  }
});

test('chunk unreadable, empty or oversized audio never reaches a provider', async () => {
  for (const read of [async () => { throw new Error('disconnected'); },
    async () => new ArrayBuffer(0), async () => new ArrayBuffer(2_500_001)]) {
    const h = await harness('transcribe-chunk', { env: PROVIDER_ENV, query: accessQuery(membership()) });
    const response = await h.handle({ method: 'POST',
      headers: new Headers({ 'x-session-token': await h.token() }), arrayBuffer: read });
    assert.ok([400, 413].includes(response.status));
    noProvider(h);
  }
});

test('live relay rechecks cancellation/revocation before opening its provider socket', async () => {
  for (const revoke of [row => { row.session.status = 'cancelled'; },
    row => { row.expires_at = new Date(NOW).toISOString(); }, row => { row.participant_role = 'reviewer'; }]) {
    const row = membership();
    const h = await harness('transcribe-live', { env: PROVIDER_ENV, query: accessQuery(row) });
    assert.equal((await transcribe(h, 'transcribe-live')).status, 200);
    revoke(row);
    await h.open();
    assert.ok(!h.calls.some(c => c.websocket || c.fetch));
    assert.equal(h.calls.find(c => c.candidateClose).candidateClose, 1008);
  }
});

const PROVIDER_TRANSCRIPT = JSON.stringify({ channel: { alternatives: [{ transcript: 'Synthetic speech', confidence: 0.9 }] } });
function assertRelayClosed(h, code = 1008) {
  assert.equal(h.calls.filter(c => c.candidateClose === code).length, 1);
  const providerCode = code === 1008 ? 4008 : code === 1011 ? 4011 : code;
  assert.equal(h.calls.filter(c => c.providerClose === providerCode).length, 1);
  assert.equal(h.timerCount(), 0, 'closed relay must release every timer');
  const forwards = h.calls.filter(c => c.providerSend || c.candidateSend).length;
  h.audio('audio-after-close');
  h.providerEvent('message', PROVIDER_TRANSCRIPT);
  h.providerEvent('open');
  assert.equal(h.calls.filter(c => c.providerSend || c.candidateSend).length, forwards);
}

test('established relay closes both sockets after terminal state or membership revocation', async () => {
  for (const revoke of [() => null, row => ({ ...row, participant_role: 'reviewer' }),
    row => ({ ...row, user_id: 'another-candidate' }), row => ({ ...row, session: null }),
    ...['cancelled', 'completed', 'interrupted', 'ended', 'waiting'].map(status => row => ({ ...row, session: { ...row.session, status } }))]) {
    let row = membership();
    const h = await harness('transcribe-live', { env: PROVIDER_ENV, query: call => accessQuery(row)(call) });
    await transcribe(h, 'transcribe-live');
    await h.open();
    h.audio('authorized-audio');
    h.providerEvent('message', PROVIDER_TRANSCRIPT);
    assert.ok(h.calls.some(c => c.providerSend === 'authorized-audio'));
    assert.ok(h.calls.some(c => c.candidateSend?.includes('Synthetic speech')));
    row = revoke(row);
    await h.tick(5000);
    assertRelayClosed(h);
    const checks = h.calls.filter(c => c.table).length;
    await h.tick(60000);
    assert.equal(h.calls.filter(c => c.table).length, checks, 'no background checks after close');
  }
});

test('established relay enforces token, membership and session expiry deadlines without waiting for poll', async () => {
  for (const shortest of ['token', 'membership', 'session']) {
    const row = membership();
    if (shortest !== 'token') (shortest === 'session' ? row.session : row).expires_at = new Date(NOW + 2000).toISOString();
    const h = await harness('transcribe-live', { env: PROVIDER_ENV, query: accessQuery(row) });
    await transcribe(h, 'transcribe-live', await h.token(shortest === 'token' ? { exp: NOW / 1000 + 2 } : {}));
    await h.open();
    await h.tick(1999);
    h.audio('before-expiry');
    assert.ok(h.calls.some(c => c.providerSend === 'before-expiry'));
    await h.tick(1);
    assertRelayClosed(h);
    assert.equal(h.calls.filter(c => c.table).length, 2, 'expiry does not require another database read');
  }
});

test('relay checks frame deadlines even when timer delivery is delayed', async () => {
  for (const direction of ['client', 'provider']) {
    const h = await harness('transcribe-live', { env: PROVIDER_ENV, query: accessQuery(membership()) });
    await transcribe(h, 'transcribe-live', await h.token({ exp: NOW / 1000 + 2 }));
    await h.open();
    h.advance(2000);
    if (direction === 'client') h.audio('expired-audio');
    else h.providerEvent('message', PROVIDER_TRANSCRIPT);
    assertRelayClosed(h);
    assert.ok(!h.calls.some(c => c.providerSend || c.candidateSend));
  }
});

test('healthy relay revalidates repeatedly and honors a newly shortened membership deadline', async () => {
  const row = membership();
  const h = await harness('transcribe-live', { env: PROVIDER_ENV, query: accessQuery(row) });
  await transcribe(h, 'transcribe-live');
  await h.open();
  await h.tick(10000);
  assert.equal(h.calls.filter(c => c.table).length, 4);
  h.audio('still-authorized');
  assert.ok(h.calls.some(c => c.providerSend === 'still-authorized'));
  row.expires_at = new Date(NOW + 17000).toISOString();
  await h.tick(5000);
  assert.equal(h.timerCount(), 2, 'only one poll and one expiry deadline');
  await h.tick(2000);
  assertRelayClosed(h);
});

test('established relay fails closed on lookup errors and transport exceptions', async () => {
  for (const failure of [() => ({ data: null, error: { message: 'private failure' } }),
    () => { throw new Error('private failure'); }]) {
    let checks = 0;
    const h = await harness('transcribe-live', { env: PROVIDER_ENV,
      query: call => ++checks <= 2 ? accessQuery(membership())(call) : failure() });
    await transcribe(h, 'transcribe-live');
    await h.open();
    await h.tick(5000);
    assertRelayClosed(h);
  }
});

test('stalled established access check blocks both directions and times out without overlapping checks', async () => {
  let checks = 0;
  let finishLookup;
  let markLookupStarted;
  const started = new Promise(resolve => { markLookupStarted = resolve; });
  const pending = new Promise(resolve => { finishLookup = resolve; });
  const h = await harness('transcribe-live', { env: PROVIDER_ENV, query: call => {
    if (++checks <= 2) return accessQuery(membership())(call);
    markLookupStarted();
    return pending;
  } });
  await transcribe(h, 'transcribe-live');
  await h.open();
  await h.tick(5000, false);
  await started;
  h.audio('unverified-audio');
  h.providerEvent('message', PROVIDER_TRANSCRIPT);
  assert.ok(!h.calls.some(c => c.providerSend || c.candidateSend));
  await h.tick(2999, false);
  assert.ok(!h.calls.some(c => c.candidateClose));
  await h.tick(1, false);
  assertRelayClosed(h);
  finishLookup({ data: membership(), error: null });
  await h.settleTimers();
  assertRelayClosed(h);
  assert.equal(checks, 3);
});

test('relay resumes forwarding only after a successful pending revalidation', async () => {
  let checks = 0;
  let finishLookup;
  let markLookupStarted;
  const started = new Promise(resolve => { markLookupStarted = resolve; });
  const pending = new Promise(resolve => { finishLookup = resolve; });
  const h = await harness('transcribe-live', { env: PROVIDER_ENV, query: call => {
    if (++checks <= 2) return accessQuery(membership())(call);
    markLookupStarted();
    return pending;
  } });
  await transcribe(h, 'transcribe-live');
  await h.open();
  await h.tick(5000, false);
  await started;
  h.audio('must-be-dropped');
  finishLookup({ data: membership(), error: null });
  await h.settleTimers();
  h.audio('verified-again');
  assert.deepEqual(h.calls.filter(c => c.providerSend).map(c => c.providerSend), ['verified-again']);
  assert.equal(h.timerCount(), 2);
  h.clientEvent('close');
  assertRelayClosed(h, 1000);
});

test('disconnect during pending revalidation cannot restart timers or reopen the relay', async () => {
  let checks = 0;
  let finishLookup;
  let markLookupStarted;
  const started = new Promise(resolve => { markLookupStarted = resolve; });
  const pending = new Promise(resolve => { finishLookup = resolve; });
  const h = await harness('transcribe-live', { env: PROVIDER_ENV, query: call => {
    if (++checks <= 2) return accessQuery(membership())(call);
    markLookupStarted();
    return pending;
  } });
  await transcribe(h, 'transcribe-live');
  await h.open();
  await h.tick(5000, false);
  await started;
  h.clientEvent('close');
  assertRelayClosed(h, 1000);
  finishLookup({ data: membership(), error: null });
  await h.settleTimers();
  assertRelayClosed(h, 1000);
  await h.tick(60000);
  assert.equal(checks, 3);
});

test('relay disconnect/error paths close both sockets and release timers', async () => {
  for (const [side, event, code] of [['client', 'close', 1000], ['client', 'error', 1011],
    ['provider', 'close', 1011], ['provider', 'error', 1011]]) {
    const h = await harness('transcribe-live', { env: PROVIDER_ENV, query: accessQuery(membership()) });
    await transcribe(h, 'transcribe-live');
    await h.open();
    h[side + 'Event'](event);
    assertRelayClosed(h, code);
    await h.tick(60000);
    assert.equal(h.calls.filter(c => c.table).length, 2);
  }
});

test('provider credential TTL is capped by all three expiries', async () => {
  for (const shortest of ['token', 'session', 'membership']) {
    const row = membership();
    if (shortest !== 'token') (shortest === 'session' ? row.session : row).expires_at = new Date(NOW + 7000).toISOString();
    const h = await harness('transcription-token', { env: PROVIDER_ENV, query: accessQuery(row) });
    const token = await h.token(shortest === 'token' ? { exp: NOW / 1000 + 7 } : {});
    const response = await transcribe(h, 'transcription-token', token);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(h.calls.find(c => c.fetch).init.body).ttl_seconds, 7);
    assert.equal((await response.json()).expiresIn, 7);
  }
});

test('newly minted provider credential is withheld if access ends during issuance', async () => {
  const row = membership();
  const h = await harness('transcription-token', {
    env: PROVIDER_ENV, query: accessQuery(row),
    fetch: async () => {
      row.session.status = 'cancelled';
      return Response.json({ access_token: 'must-not-be-returned', expires_in: 60 });
    },
  });
  const response = await transcribe(h, 'transcription-token');
  assert.equal(response.status, 409);
  assert.equal((await response.json()).accessToken, undefined);
});

test('provider credentials exceeding requested TTL are never returned', async () => {
  const h = await harness('transcription-token', {
    env: PROVIDER_ENV, query: accessQuery(membership()),
    fetch: async () => Response.json({ access_token: 'must-not-be-returned', expires_in: 3600 }),
  });
  const response = await transcribe(h, 'transcription-token');
  assert.equal(response.status, 502);
  assert.equal((await response.json()).accessToken, undefined);
});

test('provider credential is withheld when expiry is reached during issuance', async () => {
  for (const elapsed of [6000, 6500, 7000]) {
    const h = await harness('transcription-token', {
      env: PROVIDER_ENV, query: accessQuery(membership()),
      fetch: async () => {
        h.advance(elapsed);
        return Response.json({ access_token: 'synthetic-provider-token', expires_in: 7 });
      },
    });
    const response = await transcribe(h, 'transcription-token', await h.token({ exp: NOW / 1000 + 7 }));
    assert.equal(response.status, elapsed === 6000 ? 200 : elapsed === 7000 ? 401 : 410);
    const body = await response.json();
    if (elapsed === 6000) assert.equal(body.expiresIn, 1);
    else assert.equal(body.accessToken, undefined);
  }
});

test('live provider connection fails closed if the second access lookup fails', async () => {
  let checks = 0;
  const h = await harness('transcribe-live', {
    env: PROVIDER_ENV,
    query: call => ++checks === 1 ? accessQuery(membership())(call) : { data: null, error: { message: 'lookup failed' } },
  });
  assert.equal((await transcribe(h, 'transcribe-live')).status, 200);
  await h.open();
  assert.ok(!h.calls.some(c => c.websocket || c.fetch));
  assert.equal(h.calls.find(c => c.candidateClose).candidateClose, 1008);
});

test('transcription preflight does not access data or providers', async () => {
  for (const slug of TRANSCRIPTION_ROUTES) {
    const h = await harness(slug);
    const response = await h.request({}, { origin: 'https://truveil-secure.vercel.app' }, 'OPTIONS');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://truveil-secure.vercel.app');
    assert.deepEqual(h.calls, []);
  }
});
