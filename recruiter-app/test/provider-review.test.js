const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DesktopProviderReview, CONSENT_VERSION } = require('../src/ai/desktop-provider-review');
const engineModule = require('../src/ai/provider-review-engine.cjs');
const { loadMain } = require('./helpers/main-harness');

const text = ('During an invented incident I checked the queue and compared retries with completed jobs. ' +
  'I initially suspected the release but found that a dependency timeout was responsible. ').repeat(7);
const caption = (changes = {}) => ({ text, source: 'deepgram-nova-3-direct', transcriptConfidence: 0.98, ...changes });
async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'truveil-desktop-review-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const owner = { startedAt: Date.now(), endedAt: null, candidateReady: true, telemetry: { connected: true },
    transcripts: [], externalReviewConsent: { version: CONSENT_VERSION, enabled: true }, ...options.owner };
  let current = owner;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init });
    if (options.fetchImpl) return options.fetchImpl(url, init);
    if (url.includes('pangram') && url.endsWith('/models')) return Response.json({ models: ['pangram-4.1'] });
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'openai/gpt-6.1-sol',
      pricing: { prompt: '0.000002', completion: '0.00001' }, supported_parameters: ['structured_outputs'] }] });
    if (url.endsWith('/task')) return Response.json({ task_id: 'synthetic-task' });
    if (url.includes('/task/')) return Response.json({ stage: 'STAGE_SUCCESS', version: '4.1', text,
      prediction_short: 'AI', fraction_ai: 1, fraction_ai_assisted: 0, fraction_human: 0,
      windows: [{ text, start_index: 0, end_index: text.length, confidence: 'High', label: 'AI-Generated', ai_assistance_score: 1 }] });
    return Response.json({ model: 'openai/gpt-6.1-sol', usage: { cost: 0.002 }, choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ citations: [{ source_id: 'response', quote: 'dependency timeout' }], follow_up_codes: ['ask_specific_example'] }) } }] });
  };
  const service = new DesktopProviderReview({ getOwner: () => current, appPath: path.join(directory, 'app'), userDataPath: directory,
    environment: { PANGRAM_API_KEY: 'synthetic-pangram-key', OPENROUTER_API_KEY: 'synthetic-sol-key' }, engineModule, fetchImpl });
  return { directory, owner, service, calls, setOwner: value => { current = value; } };
}
const confirm = { singleAnswerConfirmed: true, providerPrivacyReviewed: true };

test('desktop review uses the bundled engine, both providers and a durable owner ledger', async t => {
  const { service, owner, calls, directory } = await setup(t);
  service.begin(); owner.transcripts.push(caption());
  assert.ok(service.finish().wordCount >= 150);
  const result = await service.review(confirm);
  assert.equal(result.status, 'review_suggested');
  assert.equal(result.reviewAssistant.status, 'available');
  assert.equal(owner.providerReviews.length, 1);
  assert.equal(service.status().stage, 'idle');
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
  assert.equal((await fs.stat(path.join(directory, 'provider-review-state/ledger.json'))).isFile(), true);
  assert.equal(result.accuracyValidated, false);
});

test('status only reveals configuration booleans, not credentials or ledger paths', async t => {
  const { service } = await setup(t);
  const status = JSON.stringify(service.status());
  assert.equal(status.includes('synthetic-pangram-key'), false);
  assert.equal(status.includes('synthetic-sol-key'), false);
  assert.equal(status.includes('provider-review-state'), false);
});

test('renderer settings neither disclose legacy keys nor permit changing the private key-file location', async () => {
  const app = loadMain();
  app.run("SettingsStore.getAll = () => ({ openrouterKey: 'synthetic-legacy-key', providerReviewEnvFile: 'private-owner-file', transcriptSize: 'large' }); SettingsStore.save = patch => { globalThis.savedPreferences = patch; };");
  const shown = await app.invoke('settings:get');
  assert.deepEqual(Object.keys(shown).sort(), ['reduceMotion', 'transcriptSize']);
  await app.invoke('settings:save', { reduceMotion: true, providerReviewEnvFile: 'renderer-selected-file', openrouterKey: 'renderer-key' });
  assert.deepEqual(Object.keys(app.run('savedPreferences')).sort(), ['reduceMotion', 'transcriptSize']);
});

test('installed app selecting the shared owner key file reuses the existing module ledger', async t => {
  const { directory } = await setup(t);
  const envDirectory = path.join(directory, 'environment');
  const systemDirectory = path.join(directory, 'ai-review-system');
  await fs.mkdir(envDirectory); await fs.mkdir(systemDirectory);
  await fs.writeFile(path.join(envDirectory, '.env'), 'PANGRAM_API_KEY=synthetic\nOPENROUTER_API_KEY=synthetic\n');
  await fs.writeFile(path.join(systemDirectory, 'package.json'), JSON.stringify({ name: 'truveil-ai-review-system' }));
  const service = new DesktopProviderReview({ getOwner: () => null, appPath: path.join(directory, 'installed/resources/app.asar'),
    userDataPath: path.join(directory, 'user-profile'), environment: {}, getEnvFile: () => path.join(envDirectory, '.env') });
  assert.equal(service.credentials().ledger, path.join(systemDirectory, '.state'));
});

test('connection checks only use free model catalogs and never submit transcript text', async t => {
  const { service, calls } = await setup(t);
  const result = await service.checkConnections();
  assert.equal(result.pangram.available, true);
  assert.equal(result.sol.available, true);
  assert.equal(result.creditsVerified, false);
  assert.ok(calls.every(call => call.method === 'GET' && call.body === undefined));
});

for (const [name, owner] of [
  ['candidate did not consent', { externalReviewConsent: null }],
  ['old consent version', { externalReviewConsent: { version: 'old', enabled: true } }],
  ['interview ended', { endedAt: Date.now() }],
  ['candidate disconnected', { candidateReady: false }],
  ['realtime disconnected', { telemetry: { connected: false } }],
  ['interview not started', { startedAt: null }]
]) test(`${name} blocks desktop external review`, async t => {
  const { service, calls } = await setup(t, { owner });
  assert.throws(() => service.begin());
  assert.equal(calls.length, 0);
});

test('answer boundaries exclude earlier responses and freeze the finalized selection', async t => {
  const { service, owner } = await setup(t);
  owner.transcripts.push(caption({ text: 'Previous answer.' }));
  service.begin();
  owner.transcripts.push(caption(), caption({ text: 'Interim draft.', interim: true }));
  const result = service.finish();
  owner.transcripts.push(caption({ text: 'Next answer.' }));
  assert.equal(result.preview, text);
  assert.equal(service.status().preview.includes('Next answer.'), false);
});

test('no final speech and missing explicit confirmations do not spend credits', async t => {
  const { service, owner, calls } = await setup(t);
  service.begin();
  assert.throws(() => service.finish(), /NO_FINAL_CAPTIONS_IN_ANSWER/);
  owner.transcripts.push(caption()); service.finish();
  await assert.rejects(() => service.review({ singleAnswerConfirmed: true }), /ANSWER_AND_PRIVACY_CONFIRMATION_REQUIRED/);
  assert.equal(calls.length, 0);
});

for (const [name, changes] of [
  ['short answer', { text: 'A few words.' }],
  ['unknown confidence', { transcriptConfidence: null }],
  ['low confidence', { transcriptConfidence: 0.7 }],
  ['recognition fallback', { source: 'local-whisper' }],
  ['quality gap', { qualityReason: 'low-confidence' }]
]) test(`${name} abstains through the actual desktop integration`, async t => {
  const { service, owner, calls } = await setup(t);
  service.begin(); owner.transcripts.push(caption(changes)); service.finish();
  assert.equal((await service.review(confirm)).status, 'insufficient_evidence');
  assert.equal(calls.length, 0);
});

test('permission withdrawn between selection and review blocks the request', async t => {
  const { service, owner, calls } = await setup(t);
  service.begin(); owner.transcripts.push(caption()); service.finish();
  owner.externalReviewConsent.enabled = false;
  await assert.rejects(() => service.review(confirm), /CANDIDATE_PROVIDER_CONSENT_REQUIRED/);
  assert.equal(calls.length, 0);
});

test('session replacement cannot reuse a captured private answer', async t => {
  const { service, owner, setOwner, calls } = await setup(t);
  service.begin(); owner.transcripts.push(caption()); service.finish();
  setOwner({ ...owner, transcripts: [] });
  await assert.rejects(() => service.review(confirm), /FINALIZE_AN_ANSWER_FIRST/);
  assert.equal(calls.length, 0);
});

test('cancellation aborts in-flight work and blocks a follow-up paid Sol request', async t => {
  let release;
  const { service, owner, calls } = await setup(t, { fetchImpl: async (url) => {
    if (url.endsWith('/models')) return Response.json({ models: ['pangram-4.1'] });
    if (url.endsWith('/task')) return Response.json({ task_id: 'pending-task' });
    return new Promise(resolve => { release = () => resolve(Response.json({ stage: 'STAGE_SUCCESS', version: '4.1', text,
      prediction_short: 'AI', fraction_ai: 1, fraction_ai_assisted: 0, fraction_human: 0,
      windows: [{ text, start_index: 0, end_index: text.length, confidence: 'High', label: 'AI-Generated', ai_assistance_score: 1 }] })); });
  } });
  service.begin(); owner.transcripts.push(caption()); service.finish();
  const review = service.review(confirm);
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(release);
  owner.endedAt = Date.now(); service.cancel(); release();
  await assert.rejects(() => review, /REVIEW_CANCELLED/);
  assert.equal(calls.some(call => call.url.includes('openrouter')), false);
  assert.equal(owner.providerReviews, undefined);
});

test('main/preload integration accepts only matching-session candidate review consent', async () => {
  const app = loadMain();
  await app.invoke('session:create', { candidateName: 'Synthetic', role: 'Tester' });
  app.event({ type: 'candidate_ready', sessionId: 'TRV-WRONG1', externalReviewConsent: { version: CONSENT_VERSION, enabled: true } });
  assert.equal(app.inspect().sessionData.externalReviewConsent, null);
  app.event({ type: 'candidate_ready', sessionId: 'TRV-ABC234', externalReviewConsent: { version: CONSENT_VERSION, enabled: true } });
  assert.equal((await app.invoke('provider-review:status')).candidateConsented, true);
  app.event({ type: 'candidate_review_consent', sessionId: 'TRV-ABC234', externalReviewConsent: { version: CONSENT_VERSION, enabled: false } });
  assert.equal((await app.invoke('provider-review:status')).candidateConsented, false);
  app.event({ type: 'candidate_ready', sessionId: 'TRV-ABC234', externalReviewConsent: { version: CONSENT_VERSION, enabled: true } });
  app.event({ type: 'candidate_ready', sessionId: 'TRV-ABC234' });
  assert.equal((await app.invoke('provider-review:status')).candidateConsented, false);
  await app.invoke('session:cancel');
});
