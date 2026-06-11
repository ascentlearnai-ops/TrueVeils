const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionRiskSummary } = require('../src/report/generator');

test('keeps behavioral events separate from transcript risk', () => {
  const summary = sessionRiskSummary({
    scores: [{ score: 28, weight: 1 }, { score: 32, weight: 1 }],
    flags: [
      { text: 'Candidate opened chatgpt.com', severity: 'critical' },
      { text: 'Potential hidden overlay detected', severity: 'critical' }
    ]
  });
  assert.equal(summary.avg, 30);
  assert.equal(summary.behaviorBoost, 0);
  assert.equal(summary.behavior.aiToolHits, 1);
});

test('returns inconclusive numeric baseline when no transcript is scorable', () => {
  const summary = sessionRiskSummary({ scores: [], flags: [] });
  assert.equal(summary.avg, 0);
  assert.equal(summary.scorableCount, 0);
});
