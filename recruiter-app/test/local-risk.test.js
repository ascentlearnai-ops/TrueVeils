const test = require('node:test');
const assert = require('node:assert/strict');
const Risk = require('../src/ai/local-risk');

test.beforeEach(() => Risk.resetHistory());

test('abstains on short transcript fragments', () => {
  const result = Risk.analyzeTranscript('Hello hello hello.');
  assert.equal(result.scorable, false);
  assert.equal(result.label, 'unscorable');
  assert.equal(result.score, null);
});

test('does not treat a ChatGPT mention as proof of assistance', () => {
  const result = Risk.analyzeTranscript(
    'I evaluated ChatGPT for our support team, but actually we rejected it because the API latency caused two production incidents.'
  );
  assert.equal(result.scorable, true);
  assert.ok(result.score < 78);
  assert.ok(result.humanSignals.includes('Concrete project or first-person detail'));
});

test('returns evidence and a model version for a scorable answer', () => {
  const result = Risk.analyzeTranscript(
    'Firstly, there are several key best practices. Ultimately, I would leverage a robust and scalable approach to ensure that stakeholders align with business goals.'
  );
  assert.equal(result.scorable, true);
  assert.match(result.modelVersion, /^truveil-risk-v2/);
  assert.ok(Array.isArray(result.evidence));
  assert.ok(result.evidence.length > 0);
});

test('abstains when transcript confidence is low', () => {
  const result = Risk.analyzeTranscript(
    'I debugged the production incident with my team and shipped three fixes after testing the database migration, then I reviewed the rollout with our customer support manager.',
    { transcriptConfidence: 0.31 }
  );
  assert.equal(result.scorable, false);
  assert.match(result.unscorableReason, /confidence/i);
});
