const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionRiskSummary, buildHtml } = require('../src/report/generator');

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

test('report separates transcript context, behavioral evidence, correlations, and counter-evidence', () => {
  const startedAt = Date.now() - 60000;
  const html = buildHtml({
    session: {
      sessionId: 'TRV-TEST',
      candidateName: 'Alex Chen',
      role: 'Frontend Engineer',
      createdAt: startedAt
    },
    startMs: startedAt,
    endMs: Date.now(),
    duration: '00:01:00',
    risk: sessionRiskSummary({ scores: [], flags: [] }),
    review: {
      reviewBand: 'clear',
      displayBand: 'Clear',
      summary: 'No review signals were detected in the available evidence.',
      evidence: [],
      counterEvidence: ['Transcript-pattern analysis abstained until at least 250 reliable words across three responses'],
      correlations: [],
      transcriptEligible: false
    },
    notes: [],
    transcripts: [{
      text: 'Hello hello.',
      timestamp: Date.now(),
      scorable: false,
      reasoning: 'Needs at least 35 reliable words before estimating AI-assistance risk.',
      responseWindowWordCount: 2
    }],
    flags: [],
    audioChunks: [],
    totalResponses: 1
  });

  assert.match(html, /Transcript Pattern Context/);
  assert.match(html, /Behavioral Evidence/);
  assert.match(html, /Correlated Moments/);
  assert.match(html, /Counter-Evidence/);
  assert.match(html, /Needs at least 35 reliable words/);
});
