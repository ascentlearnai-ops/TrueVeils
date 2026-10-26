const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./helpers/main-harness');

const details = { candidateName: 'Synthetic candidate', role: 'Test interview' };

test('a real invitation requires an authenticated non-anonymous recruiter', async () => {
  for (const user of [null, { id: 'anonymous', is_anonymous: true }]) {
    const app = loadMain({ user });
    await assert.rejects(app.invoke('session:create', details), /sign in/i);
    assert.equal(app.calls.some(call => call.function === 'create-session'), false);
    assert.equal(app.inspect().activeSession, null);
  }
});

test('failed cloud creation cannot return a fabricated join code or bypass the API', async () => {
  const app = loadMain({ createError: new Error('Service unavailable') });
  await assert.rejects(app.invoke('session:create', details), /unavailable/i);
  assert.equal(app.calls.some(call => call.method === 'upsert'), false);
  assert.equal(app.inspect().activeSession, null);
});

test('invitation creation waits for a private realtime connection and uses the live candidate site', async () => {
  const app = loadMain();
  const session = await app.invoke('session:create', details);
  assert.equal(session.sessionId, 'TRV-ABC234');
  assert.match(session.candidateLink, /^https:\/\/truveil-secure\.vercel\.app\//);
  assert.equal(app.calls.find(call => call.channel).config.config.private, true);
  assert.equal(app.inspect().sessionData.telemetry.connected, true);
  await app.invoke('session:cancel');
});

test('realtime subscription failures clean up instead of issuing unusable invitations', async () => {
  const app = loadMain({ channelStatus: 'CHANNEL_ERROR' });
  await assert.rejects(app.invoke('session:create', details), /realtime/i);
  assert.equal(app.inspect().activeSession, null);
  assert.equal(app.inspect().realtimeChannel, null);
});

test('a second creation cannot overwrite an unfinished session', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  await assert.rejects(app.invoke('session:create', details), /existing|current|finish/i);
  await app.invoke('session:cancel');
});

test('starting requires candidate readiness and a working database update', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  await assert.rejects(app.invoke('session:start'), /candidate.*preflight|candidate.*ready/i);
  app.event({ type: 'candidate_ready' });
  app.state.databaseError = new Error('Database offline');
  await assert.rejects(app.invoke('session:start'), /offline/i);
  assert.equal(app.inspect().sessionData.startedAt, null);
  app.state.databaseError = null;
  const started = await app.invoke('session:start');
  assert.equal(started.started, true);
  await app.invoke('session:end');
});

test('candidate interruption revokes readiness and connection health', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  app.event({ type: 'candidate_ready' });
  app.event({ type: 'candidate_interrupted' });
  await assert.rejects(app.invoke('session:start'), /candidate.*preflight|candidate.*ready/i);
  assert.equal(app.inspect().sessionData.telemetry.connected, false);
  await app.invoke('session:cancel');
});

test('cancelling setup closes the remote session and releases realtime state', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  assert.equal((await app.invoke('session:cancel')).cancelled, true);
  assert.ok(app.calls.some(call => call.method === 'update' && call.args[0].status === 'cancelled'));
  assert.ok(app.calls.some(call => call.message?.event === 'recruiter_end_session'));
  assert.equal(app.inspect().activeSession, null);
  assert.equal(app.inspect().realtimeChannel, null);
});

test('sign-out cannot abandon an active interview', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  await assert.rejects(app.invoke('auth:sign-out'), /end|finish|cancel/i);
  assert.equal(app.calls.some(call => call.signedOut), false);
  await app.invoke('session:cancel');
});

test('report generation failure retains evidence for a retry', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  app.event({ type: 'candidate_ready' });
  await app.invoke('session:start');
  app.state.reportError = new Error('Disk temporarily unavailable');
  const failed = await app.invoke('session:end');
  assert.equal(failed.reportPending, true);
  assert.ok(app.inspect().sessionData);
  app.state.reportError = null;
  assert.equal((await app.invoke('session:end')).reportPath, 'report.html');
  assert.equal(app.inspect().sessionData, null);
});

test('cloud report save failures retain evidence and retry with the same report identity', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  app.event({ type: 'candidate_ready' });
  await app.invoke('session:start');
  app.state.reportSaveError = new Error('Cloud temporarily unavailable');
  const failed = await app.invoke('session:end');
  assert.equal(failed.reportPending, true);
  assert.match(failed.error, /cloud report/i);
  const reportId = app.inspect().sessionData.reportId;
  assert.ok(reportId);
  app.state.reportSaveError = null;
  assert.equal((await app.invoke('session:end')).reportPath, 'report.html');
  const writes = app.calls.filter(call => call.table === 'reports' && call.method === 'upsert');
  assert.equal(writes.length, 2);
  assert.ok(writes.every(write => write.args[0].id === reportId && write.args[1].ignoreDuplicates));
  assert.equal(app.inspect().sessionData, null);
});

test('existing recruiter accounts can sign in with a password without email delivery', async () => {
  const app = loadMain();
  const result = await app.invoke('auth:sign-in-password', { email: 'Recruiter@example.test', password: 'synthetic-test-password' });
  assert.equal(result.signedIn, true);
  assert.equal(app.calls.find(call => call.passwordSignIn).passwordSignIn.email, 'recruiter@example.test');
});

test('email sign-in does not silently create recruiter accounts', async () => {
  const app = loadMain();
  await app.invoke('auth:send-link', 'recruiter@example.test');
  assert.equal(app.calls.find(call => call.otpOptions).otpOptions.options.shouldCreateUser, false);
});

test('a lost broadcast does not roll back a persisted start observed by the candidate', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  app.event({ type: 'candidate_ready' });
  app.state.sendResult = 'timed out';
  const result = await app.invoke('session:start');
  assert.equal(result.started, true);
  assert.equal(result.deliveryPending, true);
  assert.ok(app.inspect().sessionData.startedAt);
  assert.equal(app.calls.some(call => call.method === 'update' && call.args[0].status === 'candidate_ready'), false);
  app.state.sendResult = 'ok';
  await app.invoke('session:end');
});

test('pending Start cannot be cancelled or replaced by another session', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  app.event({ type: 'candidate_ready' });
  let release;
  app.state.sendGate = new Promise(resolve => { release = resolve; });
  const pending = app.invoke('session:start');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(app.invoke('session:cancel'), /start to finish/i);
  await assert.rejects(app.invoke('session:end'), /start to finish/i);
  await assert.rejects(app.invoke('session:create', details), /current interview/i);
  release('ok');
  await pending;
  app.state.sendGate = null;
  await app.invoke('session:end');
});

test('pending cancellation blocks Start, End, updates and repeated cancellation until cleanup finishes', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  app.event({ type: 'candidate_ready' });
  let release;
  app.state.sendGate = new Promise(resolve => { release = resolve; });
  const pending = app.invoke('session:cancel');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(app.invoke('session:start'), /action to finish/i);
  await assert.rejects(app.invoke('session:cancel'), /action to finish/i);
  await assert.rejects(app.invoke('session:update', details), /action to finish/i);
  await assert.rejects(app.invoke('session:end'), /already being saved/i);
  assert.equal(app.calls.some(call => call.method === 'update' && call.args[0].status === 'active'), false);
  release('ok');
  assert.equal((await pending).cancelled, true);
  app.state.sendGate = null;
  assert.equal(app.inspect().activeSession, null);
  await app.invoke('session:create', details);
  await app.invoke('session:cancel');
});

test('failed cancellation releases its guard and preserves the interview for retry', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  app.state.databaseError = new Error('Database unavailable');
  await assert.rejects(app.invoke('session:cancel'), /unavailable/i);
  assert.ok(app.inspect().activeSession);
  app.state.databaseError = null;
  assert.equal((await app.invoke('session:cancel')).cancelled, true);
});

test('late transcript events cannot change a report awaiting retry', async () => {
  const app = loadMain();
  await app.invoke('session:create', details);
  app.state.reportError = new Error('Disk offline');
  await app.invoke('session:end');
  const result = await app.invoke('analyze:transcript', { text: 'This is a late transcript after the interview has ended.', timestamp: Date.now() });
  assert.equal(result, null);
  assert.equal(app.inspect().sessionData.transcripts.length, 0);
  app.state.reportError = null;
  await app.invoke('session:end');
});
