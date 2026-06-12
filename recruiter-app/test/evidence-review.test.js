const test = require('node:test');
const assert = require('node:assert/strict');
const { correlateEvidence, evaluateReview } = require('../src/review/evidence');

test('exact restricted host always produces high-priority review', () => {
  const result = evaluateReview({
    events: [{ eventType: 'blocking_warning', detectedHost: 'chatgpt.com', detectionSource: 'url', closedRestrictedTarget: true }],
    transcripts: [{ text: 'A long but ordinary response.', transcriptConfidence: 0.9 }],
    telemetry: { connected: true, transcription: 'healthy', monitoring: 'healthy' }
  });
  assert.equal(result.reviewBand, 'high_priority_review');
});

test('transcript analysis abstains until enough reliable context exists', () => {
  const result = evaluateReview({
    transcripts: [{ text: 'Short response.', transcriptConfidence: 0.9 }],
    transcriptAnalyses: [{ score: 99 }],
    telemetry: { connected: true, transcription: 'healthy', monitoring: 'healthy' }
  });
  assert.equal(result.reviewBand, 'clear');
  assert.equal(result.transcriptEligible, false);
});

test('missing telemetry returns incomplete evidence', () => {
  const result = evaluateReview({ telemetry: { connected: false, transcription: 'unavailable' } });
  assert.equal(result.reviewBand, 'incomplete_evidence');
});

test('correlates restricted destinations with the next response', () => {
  const result = correlateEvidence(
    [{ eventType: 'restricted_target_closed', detectedHost: 'chatgpt.com', occurredAt: 1000 }],
    [{ text: 'I would choose a queue for backpressure.', timestamp: 22000 }]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].target, 'chatgpt.com');
  assert.equal(result[0].secondsUntilResponse, 21);
});
