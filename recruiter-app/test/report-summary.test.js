const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { buildHtml, sessionRiskSummary } = require('../src/report/generator');

const start = 1700000000000;
const statement = 'I would identify bottlenecks, align the team around clear priorities, and measure the results before changing the plan.';
function entry(score = 62, extra = {}) {
  return { text: statement, aiScore: score, scorable: true,
    responseWindowWordCount: 40, analysisWindowId: 'window-a',
    startedAt: start + 23000, endedAt: start + 31000,
    reasoning: 'Structured generic wording; review the full answer before drawing conclusions.', ...extra };
}
function fixture(extra = {}) {
  return { session: { sessionId: 'TRV-TEST', candidateName: 'Synthetic participant', role: 'Test interview' },
    startMs: start, endMs: start + 120000, duration: '00:02:00',
    risk: sessionRiskSummary({ scores: [{ score: 62, weight: 1 }], flags: [] }),
    review: { reviewBand: 'clear', displayBand: 'Clear', summary: 'No restricted destination was recorded.',
      evidence: [], counterEvidence: [], correlations: [], transcriptEligible: false },
    transcripts: [entry()], flags: [], audioChunks: [], notes: [], totalResponses: 1, ...extra };
}
function render(ctx) {
  return parseHTML(buildHtml(ctx)).document;
}

test('default report shows only concise score, why and moments before closed full evidence', () => {
  const document = render(fixture());
  const summary = document.getElementById('conciseSummary');
  assert.ok(summary);
  assert.deepEqual([...summary.querySelectorAll('h2')].map(node => node.textContent), ['Score', 'Why', 'Key moments']);
  assert.match(summary.querySelector('[data-summary-score]').textContent, /62\/100/);
  const full = document.getElementById('fullReportDetails');
  assert.ok(full && !full.hasAttribute('open'));
  assert.match(full.textContent, /Behavioral Evidence/);
  assert.match(full.textContent, /Counter-Evidence/);
  assert.match(summary.textContent, /not.*authorship probability/i);
});

test('real scores are never remapped for a demonstration, including zero', () => {
  for (const score of [0, 29, 60, 62, 79, 85, 100]) {
    const document = render(fixture({
      risk: sessionRiskSummary({ scores: [{ score, weight: 1 }], flags: [] }), transcripts: [entry(score)]
    }));
    const summary = document.getElementById('conciseSummary');
    assert.match(summary.querySelector('[data-summary-score]').textContent, new RegExp(`^${score}/100`));
    assert.doesNotMatch(summary.textContent, /definite|confirmed AI use|proof of cheating/i);
  }
});

test('key moments contain exact captured words and real session-relative segment bounds', () => {
  const document = render(fixture());
  const moment = document.querySelector('#conciseSummary .summary-moment');
  assert.ok(moment);
  assert.equal(moment.querySelector('blockquote').textContent, statement);
  assert.match(moment.querySelector('time').textContent, /00:00:23.*00:00:31/);
  assert.match(moment.textContent, /62\/100/);
  assert.match(moment.textContent, /40-word context/);
  assert.match(moment.textContent, /Structured generic wording/);
});

test('missing or invalid timing is explicit, never synthesized from report-generation time', () => {
  for (const extra of [{ startedAt: undefined, endedAt: undefined },
    { startedAt: null, endedAt: null }, { startedAt: start + 31000, endedAt: start + 23000 },
    { startedAt: start - 1000, endedAt: start + 1000 }, { startedAt: start + 123000, endedAt: start + 124000 }]) {
    const summary = render(fixture({ transcripts: [entry(62, extra)] })).getElementById('conciseSummary');
    assert.match(summary.querySelector('time').textContent, /Speech timing unavailable/);
    assert.doesNotMatch(summary.textContent, /Invalid Date/);
  }
});

test('unscorable fragments and short contexts never become scored key moments', () => {
  const summary = render(fixture({ transcripts: [entry(99, { scorable: false }),
    entry(99, { analysisWindowId: 'short', responseWindowWordCount: 12 })],
    risk: sessionRiskSummary({ scores: [], flags: [] }) })).getElementById('conciseSummary');
  assert.equal(summary.querySelectorAll('.summary-moment').length, 0);
  assert.match(summary.querySelector('[data-summary-score]').textContent, /Insufficient evidence/);
  assert.doesNotMatch(summary.textContent, /0\/100|99\/100/);
});

test('concise report never promotes behavioral priority to a numeric transcript score', () => {
  const flags = [{ text: 'Candidate opened chatgpt.com', severity: 'critical' }];
  const summary = render(fixture({ flags, transcripts: [],
    risk: sessionRiskSummary({ scores: [], flags }),
    review: { reviewBand: 'high_priority_review', displayBand: 'High priority review',
      summary: 'A restricted destination was recorded; review the event.', evidence: [], correlations: [] }
  })).getElementById('conciseSummary');
  assert.match(summary.querySelector('[data-summary-score]').textContent, /Insufficient evidence/);
  assert.match(summary.textContent, /restricted destination/);
});

test('quotes and explanations cannot inject HTML into the summary', () => {
  const summary = render(fixture({ transcripts: [entry(62, { text: '<script>bad()</script>',
    reasoning: '<img src=x onerror=bad()>' })] })).getElementById('conciseSummary');
  assert.equal(summary.querySelectorAll('script,img').length, 0);
  assert.match(summary.textContent, /<script>bad\(\)<\/script>/);
  assert.match(summary.textContent, /<img src=x onerror=bad\(\)>/);
});

test('highlights are bounded and deduplicated, retain a lower-scoring counterexample, and do not mutate input', () => {
  const transcripts = Array.from({ length: 9 }, (_, index) => entry(index ? 60 + index : 20, {
    text: `Captured passage ${index}`, analysisWindowId: `window-${index}`,
    startedAt: start + index * 10000, endedAt: start + index * 10000 + 5000
  }));
  transcripts.push({ ...transcripts.at(-1) });
  const ctx = fixture({ transcripts });
  const before = JSON.stringify(ctx);
  const summary = render(ctx).getElementById('conciseSummary');
  assert.equal(summary.querySelectorAll('.summary-moment').length, 4);
  assert.match(summary.textContent, /Captured passage 0/);
  assert.equal([...summary.querySelectorAll('blockquote')].filter(node => node.textContent === 'Captured passage 8').length, 1);
  assert.equal(JSON.stringify(ctx), before);
});

test('incomplete evidence remains prominent rather than being concealed in full details', () => {
  const ctx = fixture();
  ctx.review.reviewBand = 'incomplete_evidence';
  ctx.review.summary = 'The connection was lost; later speech could not be reviewed.';
  const summary = render(ctx).getElementById('conciseSummary');
  assert.match(summary.textContent, /connection was lost/);
});
