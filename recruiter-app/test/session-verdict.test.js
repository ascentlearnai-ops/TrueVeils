const test = require('node:test');
const assert = require('node:assert/strict');

const { computeSessionVerdict } = require('../src/review/verdict');
const { evaluateReview } = require('../src/review/evidence');
const { analyzeTranscript, resetHistory } = require('../src/ai/local-risk');
const { ResponseWindowAnalyzer } = require('../src/ai/response-window');

test('verdict says likely unassisted for consistent low scores with no behavioral evidence', () => {
  const review = { reviewBand: 'clear' };
  const verdict = computeSessionVerdict({
    scores: [{ score: 18, weight: 0.8 }, { score: 24, weight: 0.7 }, { score: 20, weight: 0.9 }, { score: 15, weight: 0.8 }],
    review
  });
  assert.equal(verdict.verdictLabel, 'Likely unassisted');
  assert.ok(verdict.verdictScore <= 35);
  assert.ok(['medium', 'high'].includes(verdict.verdictConfidence));
});

test('high-priority behavioral band floors the verdict at 80 even with unscorable transcripts', () => {
  const review = { reviewBand: 'high_priority_review' };
  const verdict = computeSessionVerdict({ scores: [], review });
  assert.ok(verdict.verdictScore >= 80);
  assert.equal(verdict.verdictLabel, 'Likely AI-assisted');
  assert.notEqual(verdict.verdictConfidence, 'insufficient');
});

test('fewer than three scored windows caps confidence at low without behavioral evidence', () => {
  const review = { reviewBand: 'clear' };
  const verdict = computeSessionVerdict({ scores: [{ score: 74, weight: 0.9 }], review });
  assert.equal(verdict.verdictConfidence, 'low');
  assert.equal(verdict.verdictLabel, 'Likely AI-assisted');
});

test('no evidence at all yields an insufficient verdict with null score', () => {
  const verdict = computeSessionVerdict({ scores: [], review: { reviewBand: 'incomplete_evidence' } });
  assert.equal(verdict.verdictConfidence, 'insufficient');
  assert.equal(verdict.verdictScore, null);
  assert.equal(verdict.verdictLabel, 'Insufficient evidence');
});

test('verdict language stays advisory — never claims confirmed detection', () => {
  const verdict = computeSessionVerdict({ scores: [{ score: 95, weight: 1 }], review: { reviewBand: 'high_priority_review' } });
  assert.doesNotMatch(verdict.verdictLabel, /confirmed|detected|guaranteed|proof/i);
  assert.match(verdict.advisoryNote, /advisory/i);
  assert.match(verdict.advisoryNote, /human review/i);
});

test('tab-switch to ChatGPT followed by a fluent answer produces a high-priority band and assisted verdict', () => {
  const now = Date.now();
  const events = [{
    eventType: 'foreground_changed',
    detectedUrl: 'https://chatgpt.com/',
    detectionSource: 'url',
    policyDecision: 'restricted',
    timestamp: now
  }];
  const transcripts = [{
    text: 'The optimal approach here is to leverage a hash map for constant time lookups while iterating once across the input array to accumulate results.',
    timestamp: now + 20000,
    transcriptConfidence: 0.92,
    score: 30,
    scorable: true
  }];
  const review = evaluateReview({ events, transcripts, transcriptAnalyses: transcripts, telemetry: { connected: true, transcription: 'healthy', monitoring: 'healthy' } });
  assert.equal(review.reviewBand, 'high_priority_review');
  const verdict = computeSessionVerdict({ scores: [{ score: 30, weight: 0.8 }], review });
  assert.ok(verdict.verdictScore >= 80);
  assert.equal(verdict.verdictLabel, 'Likely AI-assisted');
});

test('disfluency collapse against the candidate baseline raises the score of a polished answer', () => {
  const disfluent = 'So um I think uh what happened was we had this bug in production and um I mean I basically debugged the api logs and uh you know I found the cache was stale so we shipped a fix after we tested it last week during the incident.';
  const polished = 'There are three key considerations when designing scalable systems for enterprise stakeholders. First, robust architecture ensures seamless delivery across teams. Second, best practices around alignment streamline collaboration and efficiency. Finally, holistic strategy ensures that objectives and requirements drive impact over the long term.';

  resetHistory();
  const coldResult = analyzeTranscript(polished, { transcriptConfidence: 0.95 });

  resetHistory();
  for (let i = 0; i < 3; i++) analyzeTranscript(`${disfluent} ${i}`, { transcriptConfidence: 0.95 });
  const baselineResult = analyzeTranscript(polished, { transcriptConfidence: 0.95 });
  resetHistory();

  assert.ok(baselineResult.scorable);
  assert.ok(
    baselineResult.rawScore >= coldResult.rawScore,
    `expected baseline-aware raw score (${baselineResult.rawScore}) >= cold raw score (${coldResult.rawScore})`
  );
});

test('a near-instant long answer scores higher than the same answer after a natural pause', () => {
  const answer = 'I would start by clarifying the traffic pattern and the failure mode. Then I would add caching around the slow read path, measure the database load, and roll it out gradually so the team could compare error rates before and after the change.';
  resetHistory();
  const instant = analyzeTranscript(answer, { transcriptConfidence: 0.95, priorSilenceGapMs: 150 });
  resetHistory();
  const paused = analyzeTranscript(answer, { transcriptConfidence: 0.95, priorSilenceGapMs: 9000 });
  resetHistory();
  assert.ok(instant.scorable && paused.scorable);
  assert.ok(
    instant.rawScore > paused.rawScore,
    `expected instant raw score (${instant.rawScore}) > paused raw score (${paused.rawScore})`
  );
});

test('response window analyzer passes the silence gap between windows into analysis context', () => {
  const analyzer = new ResponseWindowAnalyzer({ minimumWords: 5 });
  const contexts = [];
  const analyzeFn = (text, context) => {
    contexts.push(context);
    return { score: 10, scorable: true };
  };
  const start = Date.now();
  analyzer.addSegment({ text: 'one two three four five six', timestamp: start, durationMs: 3000 }, analyzeFn);
  analyzer.addSegment({ text: 'seven eight nine ten eleven twelve', timestamp: start + 10000, durationMs: 3000 }, analyzeFn);
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].priorSilenceGapMs, null);
  assert.equal(contexts[1].priorSilenceGapMs, 7000);
});
