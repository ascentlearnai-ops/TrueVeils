const test = require('node:test');
const assert = require('node:assert/strict');
const { ResponseWindowAnalyzer } = require('../src/ai/response-window');

test('holds short transcript fragments until enough reliable words exist', () => {
  const analyzer = new ResponseWindowAnalyzer({ minimumWords: 35 });
  let calls = 0;
  const result = analyzer.addSegment({
    text: 'Hello, I debugged the checkout issue yesterday.',
    segmentId: 's1'
  }, () => {
    calls++;
    return { score: 20, scorable: true };
  });

  assert.equal(calls, 0);
  assert.equal(result.scorable, false);
  assert.match(result.unscorableReason, /35 reliable words/i);
  assert.equal(result.responseWindowWordCount, 7);
});

test('analyzes a stable response window and carries segment identity', () => {
  const analyzer = new ResponseWindowAnalyzer({ minimumWords: 35 });
  analyzer.addSegment({
    text: 'I started by checking the logs and reproducing the bug locally because the failing request only happened after the cache warmed up.',
    segmentId: 's1',
    transcriptConfidence: 0.92,
    durationMs: 5000
  }, () => {
    throw new Error('should not analyze the first short segment');
  });

  const result = analyzer.addSegment({
    text: 'Then I added a database index, tested the migration against staging traffic, and shipped it after reviewing the rollback plan with my team.',
    segmentId: 's2',
    transcriptConfidence: 0.88,
    durationMs: 6000,
    streamEpoch: 2,
    utteranceId: 4
  }, (text, context) => ({
    score: 22,
    scorable: true,
    scoreWeight: 0.7,
    displayLabel: 'Low AI-assistance risk',
    reasoning: `Analyzed ${context.responseWindowWordCount} words`,
    context,
    text
  }));

  assert.equal(result.scorable, true);
  assert.equal(result.score, 22);
  assert.equal(result.analysisWindowId, 'rw-1');
  assert.deepEqual(result.segmentIds, ['s1', 's2']);
  assert.equal(result.context.streamEpoch, 2);
  assert.equal(result.context.utteranceId, 4);
  assert.ok(result.responseWindowWordCount >= 35);
});
