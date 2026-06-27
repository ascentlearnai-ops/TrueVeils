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
    'I evaluated ChatGPT for our support team, but actually we rejected it because the API latency caused two production incidents. My team shipped a smaller database search fix instead.'
  );
  assert.equal(result.scorable, true);
  assert.ok(result.score < 78);
  assert.ok(result.humanSignals.includes('Concrete project or first-person detail'));
});

test('raises risk more for direct AI-tool use than a negated mention', () => {
  const direct = Risk.analyzeTranscript(
    'I used ChatGPT to structure the system design answer, then copied the outline into my response and adjusted a few details before explaining it. The tool suggested the main tradeoffs.'
  );
  Risk.resetHistory();
  const rejected = Risk.analyzeTranscript(
    'I evaluated ChatGPT for our support team, but actually we rejected it because the API latency caused two production incidents. My team shipped a smaller database search fix instead.'
  );

  assert.equal(direct.scorable, true);
  assert.equal(rejected.scorable, true);
  assert.ok(direct.score > rejected.score + 15);
  assert.ok(direct.aiSignals.includes('Direct AI-tool use context'));
  assert.ok(rejected.humanSignals.includes('AI-tool mention was rejected or negated'));
});

test('keeps a specific self-correcting human answer low risk', () => {
  const result = Risk.analyzeTranscript(
    'Um, I mean, during the production migration I debugged a SQL timeout in our payments API. I rolled back the bad deploy, tested the database fix with my team, and shipped it after the incident review.'
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'low_ai_assistance_risk');
  assert.ok(result.score < 60);
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

test('returns a high band for heavily assistant-style generic answers', () => {
  const result = Risk.analyzeTranscript(
    'I can help with that. First, there are several key best practices. Ultimately, I would leverage a robust and scalable approach to ensure that stakeholders align with business goals and that the process remains seamless.'
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'high_ai_assistance_risk');
  assert.ok(result.aiSignals.length > 0);
});

test('abstains on short single-sentence answers even when above the minimum word count', () => {
  const result = Risk.analyzeTranscript(
    'I debugged the payment API timeout with my team and shipped the tested database fix after the rollback review yesterday.'
  );

  assert.equal(result.scorable, false);
  assert.match(result.unscorableReason, /two sentences|24 reliable words/i);
});

test('abstains when transcript confidence is low', () => {
  const result = Risk.analyzeTranscript(
    'I debugged the production incident with my team and shipped three fixes after testing the database migration, then I reviewed the rollout with our customer support manager.',
    { transcriptConfidence: 0.31 }
  );
  assert.equal(result.scorable, false);
  assert.match(result.unscorableReason, /confidence/i);
});
