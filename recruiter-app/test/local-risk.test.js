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

test('caps heavily assistant-style generic answers at advisory review', () => {
  const result = Risk.analyzeTranscript(
    'I can help with that. First, there are several key best practices. Ultimately, I would leverage a robust and scalable approach to ensure that stakeholders align with business goals and that the process remains seamless.'
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'elevated_ai_assistance_risk');
  assert.ok(result.score < 70);
  assert.ok(result.aiSignals.length > 0);
});

test('flags copied assistant artifacts as high precision evidence', () => {
  const result = Risk.analyzeTranscript(
    'As an AI language model, I do not have personal experience, but here is a polished answer you could use. First, I would align stakeholders around a robust scalable solution and then summarize the key tradeoffs clearly.'
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'high_ai_assistance_risk');
  assert.ok(result.aiSignals.includes('Copied assistant or prompt artifact'));
});

test('role vocabulary and ownership lower false positives for technical answers', () => {
  const result = Risk.analyzeTranscript(
    'In my last project I implemented a Kubernetes rollout for our Postgres migration. We tested the TypeScript worker, fixed two queue retries, and shipped the API change after a staged deploy.',
    { technicalVocabulary: ['Kubernetes', 'Postgres', 'TypeScript', 'queue retries'] }
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'low_ai_assistance_risk');
  assert.ok(result.humanSignals.includes('Role-specific technical vocabulary'));
  assert.ok(result.humanSignals.includes('First-person ownership of work'));
});

test('behavior-correlated polished scaffolding scores higher than style alone', () => {
  const answer = 'There are three key considerations when designing scalable systems for enterprise stakeholders. First, robust architecture ensures seamless delivery across teams. Second, best practices around alignment streamline collaboration and efficiency. Finally, holistic strategy ensures that objectives and requirements drive impact over the long term.';

  Risk.resetHistory();
  const styleOnly = Risk.analyzeTranscript(answer, { transcriptConfidence: 0.95 });
  Risk.resetHistory();
  const correlated = Risk.analyzeTranscript(answer, {
    transcriptConfidence: 0.95,
    secondsSinceAiEvent: 15,
    behavioralAiEventCount: 1
  });

  assert.equal(styleOnly.scorable, true);
  assert.equal(correlated.scorable, true);
  assert.ok(styleOnly.score <= 68);
  assert.ok(correlated.score > styleOnly.score + 10);
  assert.ok(correlated.aiSignals.includes('Response followed a restricted AI-tool event'));
});

test('implementation mechanics and qualified reasoning act as counter-signals', () => {
  const result = Risk.analyzeTranscript(
    'I think it depends on the workload. In my last project I reproduced the timeout in staging, traced the slow Postgres query, added a canary rollout behind a feature flag, and my team rolled it back once before we shipped the fix.',
    { transcriptConfidence: 0.95, technicalVocabulary: ['Postgres', 'feature flag', 'staging'] }
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'low_ai_assistance_risk');
  assert.ok(result.score < 35);
  assert.ok(result.humanSignals.includes('First-person incident or project anchor'));
  assert.ok(result.humanSignals.includes('Concrete implementation mechanics'));
});

test('style drift from earlier answers adds review signal without overriding evidence rules', () => {
  [
    'Um, I usually start by checking the logs and then I test the API with my team after I find the failing request.',
    'I mean, the tricky part was the migration because we had to roll back one database change and patch the worker.',
    'Yeah, I fixed the checkout bug by adding a failing SQL test and then we shipped the rollback that afternoon.'
  ].forEach(text => Risk.analyzeTranscript(text));

  const result = Risk.analyzeTranscript(
    'The optimal approach is to establish alignment, evaluate constraints, synthesize stakeholder requirements, and implement a robust scalable solution that maximizes long-term maintainability and business impact.'
  );

  assert.equal(result.scorable, true);
  assert.ok(result.aiSignals.includes('Abrupt style shift from earlier answers'));
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
