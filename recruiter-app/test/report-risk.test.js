const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionRiskSummary, buildHtml } = require('../src/report/generator');

test('chunk report includes concise coverage, exact text, contextual scores and limitations without authorship claims', () => {
  const { evaluateReview } = require('../src/review/evidence');
  const entry = {text:'Original <script>unsafe()</script> speech',scorable:false};
  const assessment = {score:27,scorable:true,contextWords:72,reasoning:'Synthetic <img src=x> evidence'};
  const html = buildHtml({session:{sessionId:'TRV-ABC123',candidateName:'Synthetic',role:'Test'},
    startMs:Date.now(),endMs:Date.now(),duration:'00:00:01',risk:sessionRiskSummary({scores:[],flags:[]}),
    review:evaluateReview({events:[],transcripts:[],telemetry:{}}),notes:[],transcripts:[entry],flags:[],audioChunks:[],totalResponses:1,
    chunkReview:{final:true,summary:{score:27,totalWords:80,reviewedWords:72,summaryText:'Review the evidence in context.'},
      chunks:[{text:entry.text,wordCount:18,assessment}],windows:[{...assessment,text:entry.text,wordCount:72,aiSignals:[],humanSignals:[]}]}});
  assert.match(html,/Concise Transcript Review/);
  assert.match(html,/27\/100 contextual pattern score/);
  assert.match(html,/Reviewed 72 of 80/);
  assert.match(html,/not AI-authorship probabilities/);
  assert.match(html,/not independent evidence/);
  assert.match(html,/Complete captured transcript/);
  assert.match(html,/&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>unsafe\(\)<\/script>/);
  assert.match(html,/&lt;img src=x&gt;/);
});

test('allowed shared tab activity never raises behavioral review priority', () => {
  const summary = sessionRiskSummary({ scores: [], flags: [
    { eventType: 'browser_tab_navigated', text: 'Shared tab navigated: chatgpt.com', severity: 'low', policyDecision: 'allowed' },
    { eventType: 'browser_tab_navigated', text: 'Shared tab navigated: cluely.com', severity: 'low', policyDecision: 'allowed' }
  ] });
  assert.equal(summary.behavior.aiToolHits, 0);
  assert.equal(summary.behavior.overlayHits, 0);
  assert.equal(summary.behavior.reviewScore, 0);
});

test('a restricted browser destination alone is not reported as a hidden overlay', () => {
  const summary = sessionRiskSummary({ scores: [], flags: [
    { eventType: 'browser_tab_navigated', text: 'Shared tab navigated: cluely.com', severity: 'low', policyDecision: 'restricted' }
  ] });
  assert.equal(summary.behavior.aiToolHits, 1);
  assert.equal(summary.behavior.overlayHits, 0);
});

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

test('external provider report context is escaped and does not alter the behavioral band', () => {
  const { evaluateReview } = require('../src/review/evidence');
  const review = evaluateReview({ events: [], transcripts: [], telemetry: {} });
  const html = buildHtml({ session: { sessionId: 'TRV-ABC123', candidateName: 'Synthetic', role: 'Test' },
    startMs: Date.now(), endMs: Date.now(), duration: '00:00:01', risk: sessionRiskSummary({ scores: [], flags: [] }),
    review, notes: [], transcripts: [], flags: [], audioChunks: [], totalResponses: 0,
    providerReviews: [{ status: 'review_suggested', textClassification: { assignedTextFractions: { ai: 1, assisted: 0, human: 0 } },
      reviewAssistant: { followUps: [{ text: '<script>bad()</script>' }] } }] });
  assert.match(html, /Optional Pangram \+ Sol Review/);
  assert.match(html, /Not a cheating probability/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
  assert.match(html, /does not affect the behavioral review band/);
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
