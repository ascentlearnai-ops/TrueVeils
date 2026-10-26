const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

async function setup() {
  const root = path.resolve(__dirname, '..');
  const { window, document } = parseHTML(fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8'));
  let state = { configured: { pangram: true, sol: true }, candidateConsented: true, activeConnected: true, stage: 'idle' };
  const calls = [];
  const callbacks = {};
  window.truveil = {
    async getProviderReviewStatus() { return state; },
    async beginProviderAnswer() { calls.push('begin'); state = { ...state, stage: 'capturing' }; return state; },
    async finishProviderAnswer() { state = { ...state, stage: 'finalized', wordCount: 180, preview: '<script>unsafe</script>' }; return state; },
    async discardProviderAnswer() { state = { ...state, stage: 'idle' }; },
    async reviewProviderAnswer(confirm) { calls.push(confirm); state = { ...state, stage: 'idle' }; return { status: 'review_suggested', reviewAssistant: { status: 'available', followUps: [{ text: '<img src=x onerror=bad()>' }] } }; },
    async checkProviderConnections() { return { pangram: { available: true }, sol: { available: false, reason: 'MISSING_PROVIDER_KEY' } }; },
    async connectProviderKeyFile() { calls.push('connect'); },
    onProviderReviewConsent(cb) { callbacks.consent = cb; }, onRealtimeStatus(cb) { callbacks.status = cb; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/renderer/provider-review.js'), 'utf8'), { window, document });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  const el = id => document.getElementById(id);
  const click = async id => { el(id).click(); await flush(); };
  await flush();
  return { window, document, el, click, calls, callbacks, flush, setState: next => { state = { ...state, ...next }; } };
}
test('actual review panel sends only confirmations, never renderer-supplied answer text', async () => {
  const ui = await setup();
  await ui.click('startProviderAnswerBtn');
  await ui.click('finishProviderAnswerBtn');
  assert.equal(ui.el('runProviderReviewBtn').disabled, true);
  assert.equal(ui.el('providerAnswerPreview').textContent, '<script>unsafe</script>');
  assert.equal(ui.el('providerAnswerPreview').querySelector('script'), null);
  for (const id of ['providerSingleAnswerInput', 'providerPrivacyInput']) {
    ui.el(id).checked = true; ui.el(id).dispatchEvent(new ui.window.Event('change'));
  }
  await ui.click('runProviderReviewBtn');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls[1])), { singleAnswerConfirmed: true, providerPrivacyReviewed: true });
  assert.equal(ui.el('providerReviewResult').querySelector('img'), null);
  assert.match(ui.el('providerReviewResult').textContent, /Human review suggested/);
});
test('review UI disables capture when candidate consent is absent', async () => {
  const ui = await setup();
  ui.setState({ candidateConsented: false }); ui.callbacks.consent(); await ui.flush();
  assert.equal(ui.el('startProviderAnswerBtn').disabled, true);
  assert.match(ui.el('providerAnswerStatus').textContent, /permission/);
});
test('connection UI reports model access separately from balances', async () => {
  const ui = await setup();
  await ui.click('checkProviderConnectionsBtn');
  assert.match(ui.el('providerReviewResult').textContent, /Credit balances are not checked/);
  assert.match(ui.el('providerReviewResult').textContent, /provider key is missing/);
});
