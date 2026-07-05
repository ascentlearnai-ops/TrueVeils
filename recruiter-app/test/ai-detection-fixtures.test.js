const test = require('node:test');
const assert = require('node:assert/strict');
const Risk = require('../src/ai/local-risk');

test.beforeEach(() => Risk.resetHistory());

test('fixtures classify copied AI artifacts as high risk', () => {
  const result = Risk.analyzeTranscript(
    'As an AI language model, I cannot claim personal experience. Here is a polished interview answer you can copy: firstly, I would leverage a robust scalable architecture, align stakeholders, and synthesize requirements into clear tradeoffs. In conclusion, this demonstrates leadership and technical excellence.'
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'high_ai_assistance_risk');
  assert.ok(result.score >= 78);
  assert.ok(result.aiSignals.includes('Copied assistant or prompt artifact'));
});

test('fixtures score direct AI use higher than a negated AI mention', () => {
  const direct = Risk.analyzeTranscript(
    'I used ChatGPT during the interview to generate this architecture answer, then copied the suggested outline into my response and adjusted the wording. The AI tool proposed the database tradeoffs and helped me structure the final explanation.'
  );
  Risk.resetHistory();
  const negated = Risk.analyzeTranscript(
    'I evaluated ChatGPT for our support team, but we rejected it after latency caused two production incidents. My team built a smaller ticket-search workflow instead, and I owned the rollout after testing the database indexes.'
  );

  assert.equal(direct.scorable, true);
  assert.equal(negated.scorable, true);
  assert.ok(direct.score > negated.score + 15);
  assert.ok(direct.aiSignals.includes('Direct AI-tool use context'));
  assert.ok(negated.humanSignals.includes('AI-tool mention was rejected or negated'));
});

test('fixtures keep polished generic advice below high-priority risk', () => {
  const result = Risk.analyzeTranscript(
    'Firstly, there are several key best practices. It is important to establish alignment, identify constraints, leverage a robust and scalable approach, and ensure stakeholders are informed throughout the process. Ultimately, this enables better outcomes and long-term business impact.'
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'elevated_ai_assistance_risk');
  assert.ok(result.score < 78);
  assert.ok(result.aiSignals.includes('Generic polished interview phrasing'));
});

test('fixtures keep concrete first-person technical answers low risk', () => {
  const result = Risk.analyzeTranscript(
    'In my last role, I owned the TypeScript worker that retried failed Stripe webhooks. I found a bad Postgres index during a checkout incident, wrote the failing test myself, and shipped the fix behind a staged rollout with our support team watching the metrics.',
    { technicalVocabulary: ['TypeScript', 'Stripe', 'Postgres', 'webhooks', 'staged rollout'] }
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'low_ai_assistance_risk');
  assert.ok(result.score < 60);
  assert.ok(result.humanSignals.includes('Concrete project or first-person detail'));
  assert.ok(result.humanSignals.includes('Role-specific technical vocabulary'));
});

test('fixtures classify code-like markdown assistant artifacts as high risk', () => {
  const result = Risk.analyzeTranscript(
    '```markdown\n# Suggested Answer\n- Leverage a robust scalable architecture\n- Align stakeholders and business goals\n- Summarize key tradeoffs clearly\n```\nI can help with that. As an AI assistant, I would present the answer in a concise polished format for the interviewer.'
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'high_ai_assistance_risk');
  assert.ok(result.score >= 78);
  assert.ok(result.aiSignals.includes('Copied assistant or prompt artifact'));
});

test('fixtures treat prompt residue as high precision transcript evidence', () => {
  const result = Risk.analyzeTranscript(
    'Suggested Answer: The candidate should say that the optimal approach is to align stakeholders, evaluate constraints, and present a robust scalable architecture. Final answer: emphasize maintainability, tradeoffs, and business impact in a concise polished response.'
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'high_ai_assistance_risk');
  assert.ok(result.aiSignals.includes('Prompt or answer-label residue'));
});

test('fixtures raise risk when a polished answer follows a restricted AI event', () => {
  const text =
    'The optimal approach is to establish alignment, evaluate constraints, synthesize stakeholder requirements, and implement a robust scalable solution that maximizes maintainability. I would communicate tradeoffs clearly, ensure the architecture supports future growth, and summarize the decision in terms of business impact.';

  const isolated = Risk.analyzeTranscript(text);
  Risk.resetHistory();
  const correlated = Risk.analyzeTranscript(text, {
    secondsSinceAiEvent: 18,
    behavioralAiEventCount: 1
  });

  assert.equal(isolated.scorable, true);
  assert.equal(correlated.scorable, true);
  assert.ok(correlated.score > isolated.score);
  assert.ok(correlated.aiSignals.includes('Response followed a restricted AI-tool event'));
});

test('fixtures reward named technology and timeline detail as counter evidence', () => {
  const result = Risk.analyzeTranscript(
    'Last quarter I migrated our Node webhook worker from a single Redis queue to two queues after a Stripe retry incident. I wrote the Postgres migration, tested it in staging with our support team, and rolled back one bad deploy before shipping the fix.',
    { technicalVocabulary: ['Node', 'Redis', 'Stripe', 'Postgres', 'staging'] }
  );

  assert.equal(result.scorable, true);
  assert.equal(result.label, 'low_ai_assistance_risk');
  assert.ok(result.score < 55);
  assert.ok(result.humanSignals.some(signal => /technology|timeline|technical|project/i.test(signal)));
});

test('fixtures require a baseline before style drift is signaled', () => {
  const shiftedAnswer =
    'The optimal approach is to establish alignment, evaluate constraints, synthesize stakeholder requirements, and implement a robust scalable solution that maximizes long-term maintainability and business impact.';

  const withoutBaseline = Risk.analyzeTranscript(shiftedAnswer);
  assert.equal(withoutBaseline.scorable, true);
  assert.ok(!withoutBaseline.aiSignals.includes('Abrupt style shift from earlier answers'));

  Risk.resetHistory();
  [
    'Um, I usually start by checking the logs and then I test the API with my team after I find the failing request.',
    'I mean, the tricky part was the migration because we had to roll back one database change and patch the worker.',
    'Yeah, I fixed the checkout bug by adding a failing SQL test and then we shipped the rollback that afternoon.'
  ].forEach(text => Risk.analyzeTranscript(text));

  const withBaseline = Risk.analyzeTranscript(shiftedAnswer);
  assert.equal(withBaseline.scorable, true);
  assert.ok(withBaseline.aiSignals.includes('Abrupt style shift from earlier answers'));
});

test('fixtures abstain on short answers as unscorable', () => {
  const result = Risk.analyzeTranscript(
    'I debugged the checkout incident and shipped the database fix.'
  );

  assert.equal(result.scorable, false);
  assert.equal(result.label, 'unscorable');
  assert.equal(result.score, null);
  assert.match(result.unscorableReason, /at least|two sentences|24 reliable words/i);
});
