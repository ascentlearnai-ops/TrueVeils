const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionRiskSummary } = require('../src/report/generator');

test('raises review priority while keeping transcript risk separate', () => {
  const summary = sessionRiskSummary({
    scores: [{ score: 28, weight: 1 }, { score: 32, weight: 1 }],
    flags: [
      { text: 'Candidate opened chatgpt.com', severity: 'critical' },
      { text: 'Potential hidden overlay detected', severity: 'critical' }
    ]
  });
  assert.equal(summary.transcriptAvg, 30);
  assert.ok(summary.reviewScore >= 60);
  assert.equal(summary.behavior.aiToolHits, 1);
  assert.match(summary.reviewSummary, /restricted AI-assistance destination/i);
});

test('returns inconclusive numeric baseline when no transcript is scorable', () => {
  const summary = sessionRiskSummary({ scores: [], flags: [] });
  assert.equal(summary.avg, 0);
  assert.equal(summary.scorableCount, 0);
});

test('repeated AI-tool visits produce a high-priority interview summary', () => {
  const summary = sessionRiskSummary({
    scores: [{ score: 18, weight: 1 }],
    flags: [
      { text: 'Candidate opened chatgpt.com in Chrome', severity: 'critical' },
      { text: 'Candidate opened chatgpt.com in Chrome', severity: 'critical' },
      { text: 'Candidate opened claude.ai in Chrome', severity: 'critical' }
    ]
  });
  assert.ok(summary.reviewScore >= 80);
  assert.equal(summary.transcriptAvg, 18);
  assert.equal(summary.behavior.aiToolHits, 3);
  assert.match(summary.reviewSummary, /Repeated AI-tool access/i);
});

test('detects AI-tool evidence from structured monitoring fields', () => {
  const summary = sessionRiskSummary({
    scores: [{ score: 12, weight: 1 }],
    flags: [{
      text: 'Candidate changed foreground window',
      severity: 'critical',
      processName: 'chrome.exe',
      windowTitle: 'New tab',
      detectedHost: 'chatgpt.com',
      matchedRule: 'chatgpt.com'
    }]
  });
  assert.equal(summary.transcriptAvg, 12);
  assert.equal(summary.behavior.aiToolHits, 1);
  assert.ok(summary.reviewScore >= 50);
  assert.match(summary.reviewSummary, /restricted AI-assistance destination/i);
});
