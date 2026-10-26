const test = require('node:test');
const assert = require('node:assert/strict');
const LocalRisk = require('../src/ai/local-risk');
const { ChunkReview } = require('../src/ai/chunk-review');
const { MIN_RESPONSE_WORDS } = require('../src/ai/response-window');

const words = (count, prefix = 'word') => Array.from({ length: count }, (_, i) => `${prefix}${i},`).join(' ');
const span = (count, extra = {}) => ({
  text: words(count), transcriptConfidence: 0.95, source: 'synthetic',
  captionStreamId: 'stream-a', streamEpoch: 1, segmentId: 'span-a',
  startedAt: 100000, endedAt: 104000, ...extra
});
function fixture(options = {}) {
  const calls = [];
  const reviewer = new ChunkReview({ ...options, scorer(text, context) {
    calls.push({ text, context });
    return { score: 42, scorable: true, reasoning: 'Synthetic pattern review.',
      aiSignals: ['Synthetic signal'], humanSignals: ['Synthetic counter-signal'], probability: 0.42 };
  } });
  return { reviewer, calls };
}

test('30 words wait for 35 reliable words; 60 contextually scores both chunks', () => {
  assert.equal(MIN_RESPONSE_WORDS, 35);
  const { reviewer, calls } = fixture();
  const waiting = reviewer.build([span(30)]);
  assert.equal(waiting.chunks.length, 1);
  assert.equal(waiting.chunks[0].wordCount, 30);
  assert.equal(waiting.chunks[0].assessment.score, null);
  assert.equal(waiting.chunks[0].assessment.contextWords, 30);
  assert.match(waiting.chunks[0].assessment.reasoning, /35/);
  assert.equal(calls.length, 0);
  const ready = reviewer.build([span(60)]);
  assert.equal(ready.final, false);
  assert.equal(ready.chunks.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(ready.windows.length, 1);
  for (const chunk of ready.chunks) {
    assert.equal(chunk.complete, true);
    assert.deepEqual(Object.keys(chunk.assessment).sort(),
      ['score', 'scorable', 'contextWords', 'windowId', 'reasoning', 'aiSignals', 'humanSignals'].sort());
    assert.equal(chunk.assessment.score, 42);
    assert.equal(chunk.assessment.contextWords, 60);
    assert.equal(chunk.assessment.windowId, ready.windows[0].id);
  }
  assert.equal(ready.summary.reviewedWords, 60);
  assert.equal(ready.summary.reviewedChunks, 2);
  assert.equal(ready.modelVersion, LocalRisk.MODEL_VERSION);
  assert.ok(!JSON.stringify(ready).includes('"probability":'));
});

test('long provider spans become 30-word groups without losing punctuation or changing raw input', () => {
  const { reviewer } = fixture();
  const raw = Object.freeze(span(360, { text: words(360).replace('word29,', 'word29?!') }));
  const result = reviewer.build(Object.freeze([raw]));
  assert.equal(result.chunks.length, 12);
  assert.ok(result.chunks.every(chunk => chunk.wordCount === 30));
  assert.equal(result.chunks.map(chunk => chunk.text).join(' '), raw.text);
  assert.deepEqual(result.windows.map(window => window.wordCount), [120, 120, 120]);
  assert.equal(result.summary.totalWords, 360);
});

test('word counts near the target use 25-35 words where possible', () => {
  const { reviewer } = fixture();
  for (const count of [25, 26, 29, 30, 31, 34, 35, 50, 51, 59, 60, 61, 69, 70, 75, 89, 90, 119, 120]) {
    const result = reviewer.build([span(count)]);
    assert.equal(result.summary.totalWords, count);
    assert.ok(result.chunks.every(chunk => chunk.wordCount >= 25 && chunk.wordCount <= 35), `${count} words`);
  }
});

test('final small tails join preceding reliable context and are not counted twice', () => {
  const { reviewer } = fixture();
  const input = [span(245)];
  const live = reviewer.build(input);
  assert.equal(live.chunks.at(-1).wordCount, 5);
  assert.equal(live.chunks.at(-1).complete, false);
  assert.equal(live.chunks.at(-1).assessment.scorable, false);
  const final = reviewer.build(input, { final: true });
  assert.equal(final.chunks.at(-1).complete, true);
  assert.equal(final.chunks.at(-1).assessment.scorable, true);
  assert.deepEqual(final.windows.map(window => window.wordCount), [120, 125]);
  assert.equal(final.summary.reviewedWords, 245);
  assert.equal(final.summary.reviewedChunks, final.chunks.length);
  assert.ok(final.windows.every(window => window.wordCount <= 239));
});

test('a short final run still abstains, and final short tails cannot cross a quality boundary', () => {
  const { reviewer, calls } = fixture();
  const short = reviewer.build([span(18)], { final: true });
  assert.equal(short.summary.score, null);
  assert.equal(calls.length, 0);
  const result = reviewer.build([
    span(72), span(3, { segmentId: 'bad', transcriptConfidence: 0.2, startedAt: 104000, endedAt: 105000 }),
    span(5, { segmentId: 'tail', startedAt: 105000, endedAt: 106000 })
  ], { final: true });
  assert.equal(result.summary.totalWords, 80);
  assert.equal(result.summary.reviewedWords, 72);
  assert.equal(result.chunks.at(-1).assessment.scorable, false);
});

for (const [label, change] of [
  ['missing confidence', { transcriptConfidence: null }],
  ['low confidence', { transcriptConfidence: 0.2 }],
  ['uncertain words', { lowConfidenceWordRatio: 0.4 }],
  ['quality reason', { qualityReason: 'low-confidence' }],
  ['interim speech', { isFinal: false }]
]) {
  test(`${label} remains visible and breaks reliable context`, () => {
    const { reviewer, calls } = fixture();
    const result = reviewer.build([
      span(18), span(3, { ...change, segmentId: 'bad', startedAt: 104000, endedAt: 105000 }),
      span(18, { segmentId: 'next', startedAt: 105000, endedAt: 106000 })
    ], { final: true });
    assert.equal(result.summary.totalWords, 39);
    assert.equal(result.summary.reviewedWords, 0);
    assert.equal(result.chunks.length, 3);
    assert.equal(calls.length, 0);
    assert.ok(result.chunks.every(chunk => !chunk.assessment.scorable));
  });
}

for (const [label, change] of [
  ['long gap', { startedAt: 119001, endedAt: 122000 }],
  ['backwards capture', { startedAt: 102999, endedAt: 104000 }],
  ['stream reset', { captionStreamId: 'stream-b' }],
  ['epoch reset', { streamEpoch: 2 }],
  ['source reset', { source: 'synthetic-other' }],
  ['missing epoch', { streamEpoch: undefined }]
]) {
  test(`${label} never bridges context, including at final`, () => {
    const { reviewer, calls } = fixture();
    const result = reviewer.build([span(18), span(18, {
      segmentId: 'next', startedAt: 104000, endedAt: 108000, ...change
    })], { final: true });
    assert.equal(result.summary.totalWords, 36);
    assert.equal(result.summary.score, null);
    assert.equal(calls.length, 0);
  });
}

test('exact gap and backwards tolerances permit the same reliable run', () => {
  for (const startedAt of [119000, 103000]) {
    const { reviewer, calls } = fixture();
    assert.equal(reviewer.build([span(18), span(18, {
      segmentId: 'next', startedAt, endedAt: startedAt + 4000
    })]).summary.reviewedWords, 36);
    assert.equal(calls.length, 1);
  }
});

test('same text and provenance deduplicate, but reused raw IDs do not discard different speech', () => {
  const { reviewer } = fixture();
  const first = span(36);
  const snapshot = reviewer.build([first, { ...first }]);
  assert.equal(snapshot.summary.totalWords, 36);
  for (const change of [
    { captionStreamId: 'stream-b' }, { streamEpoch: 2 }, { source: 'other' },
    { text: words(36, 'different') }, { segmentId: 'span-b', startedAt: 104000, endedAt: 108000 }
  ]) {
    assert.equal(reviewer.build([first, { ...first, ...change }]).summary.totalWords, 72);
  }
  const noId = span(18, { segmentId: undefined });
  assert.equal(reviewer.build([noId, { ...noId }, { ...noId, startedAt: 104000, endedAt: 108000 }]).summary.totalWords, 36);
});

test('many tiny provider spans share contextual scoring instead of per-span scores', () => {
  const { reviewer, calls } = fixture();
  const input = Array.from({ length: 60 }, (_, i) => span(1, {
    text: `word${i}!`, segmentId: `tiny-${i}`, startedAt: 100000 + i * 100, endedAt: 100100 + i * 100
  }));
  const result = reviewer.build(input);
  assert.equal(result.chunks.length, 2);
  assert.equal(calls.length, 1);
  assert.ok(Math.abs(calls[0].context.transcriptConfidence - 0.95) < 1e-10);
});

test('cache reuses unchanged windows and invalidates changed vocabulary, quality and range context', () => {
  const { reviewer, calls } = fixture();
  const input = [span(120)];
  let eventCount = 0;
  const contextForRange = (start, end) => {
    assert.equal(start, 100000);
    assert.equal(end, 104000);
    return { behavioralAiEventCount: eventCount };
  };
  const options = { technicalVocabulary: ['Redis'], contextForRange };
  const initial = reviewer.build(input, options);
  initial.chunks[0].assessment.aiSignals.push('Do not retain output mutations');
  reviewer.build(input, options);
  assert.equal(calls.length, 1);
  const unchanged = reviewer.build([...input, span(1, { segmentId: 'tail', startedAt: 104000, endedAt: 105000 })], options);
  assert.equal(calls.length, 1);
  assert.equal(unchanged.chunks[0].assessment.aiSignals.length, 1);
  reviewer.build(input, { ...options, technicalVocabulary: ['Postgres'] });
  assert.equal(calls.length, 2);
  eventCount++;
  reviewer.build(input, options);
  assert.equal(calls.length, 3);
  reviewer.build([{ ...input[0], transcriptConfidence: 0.8 }], options);
  assert.equal(calls.length, 4);
});

test('scoring cache is bounded across changing snapshots', () => {
  const { reviewer, calls } = fixture({ cacheLimit: 4 });
  for (let i = 0; i < 20; i++) reviewer.build([span(36, { text: words(36, `snapshot${i}-`) })]);
  assert.ok(reviewer.cache.size <= 4);
  reviewer.build([span(36, { text: words(36, 'snapshot0-') })]);
  assert.equal(calls.length, 21);
});

test('synthetic length sweep preserves every word with bounded windows and no double-counting', () => {
  const { reviewer } = fixture();
  for (let count = 1; count <= 300; count++) {
    for (const final of [false, true]) {
      const input = span(count);
      const result = reviewer.build([input], { final });
      assert.equal(result.chunks.map(chunk => chunk.text).join(' '), input.text);
      assert.equal(result.summary.totalWords, count);
      assert.equal(result.windows.reduce((sum, window) => sum + window.wordCount, 0), count);
      assert.ok(result.windows.every(window => window.wordCount <= (final ? 239 : 120)));
      assert.ok(result.windows.every(window => !window.scorable || window.wordCount >= 35));
      assert.ok(result.chunks.every(chunk => chunk.wordCount <= 35));
      assert.ok(result.chunks.every(chunk => final || chunk.wordCount >= 25 || !chunk.complete));
      assert.equal(result.summary.reviewedWords,
        result.chunks.filter(chunk => chunk.assessment.scorable).reduce((sum, chunk) => sum + chunk.wordCount, 0));
      assert.equal(new Set(result.chunks.map(chunk => chunk.id)).size, result.chunks.length);
    }
  }
  assert.ok(reviewer.cache.size <= 128);
});

test('overlapping capture bounds cover the full context and cannot be overridden by event metadata', () => {
  const { reviewer, calls } = fixture();
  const input = [span(18, { endedAt: 110000 }), span(18, {
    segmentId: 'overlap', startedAt: 109000, endedAt: 109500
  })];
  const result = reviewer.build(input, { contextForRange: (start, end) => {
    assert.deepEqual([start, end], [100000, 110000]);
    return { behavioralAiEventCount: 1, transcriptConfidence: 0.01, source: 'wrong', durationMs: 1 };
  } });
  assert.equal(result.summary.reviewedWords, 36);
  assert.equal(calls[0].context.behavioralAiEventCount, 1);
  assert.equal(calls[0].context.durationMs, 10000);
  assert.equal(calls[0].context.source, 'synthetic');
  assert.ok(calls[0].context.transcriptConfidence > 0.9);
});

test('duplicate quality corrections invalidate prior scoring without duplicating raw words', () => {
  const { reviewer, calls } = fixture();
  const input = span(36);
  assert.equal(reviewer.build([input]).summary.reviewedWords, 36);
  const corrected = reviewer.build([input, { ...input, transcriptConfidence: 0.1 }]);
  assert.equal(corrected.summary.totalWords, 36);
  assert.equal(corrected.summary.score, null);
  assert.equal(calls.length, 1);
  assert.equal(reviewer.build([input, { ...input, transcriptConfidence: 0.8 }]).summary.reviewedWords, 36);
  assert.equal(calls.length, 2);
});

test('empty snapshots and range-context failures remain synchronous and fail closed', () => {
  const { reviewer, calls } = fixture();
  const empty = reviewer.build([null, {}, { text: '   ' }]);
  assert.deepEqual(empty.chunks, []);
  assert.deepEqual(empty.windows, []);
  assert.equal(empty.summary.totalWords, 0);
  const result = reviewer.build([span(36)], { contextForRange: () => { throw new Error('synthetic'); } });
  assert.equal(typeof result.then, 'undefined');
  assert.equal(result.summary.score, null);
  assert.equal(calls.length, 0);
});

test('final summary is concise, word-weighted and explicitly an experimental score, not probability', () => {
  let count = 0;
  const reviewer = new ChunkReview({ scorer: () => ({ score: ++count === 1 ? 20 : 80, scorable: true }) });
  const result = reviewer.build([span(180)], { final: true });
  assert.equal(result.summary.score, 40);
  assert.match(result.summary.summaryText, /experimental/i);
  assert.match(result.summary.summaryText, /\/100/);
  assert.match(result.summary.summaryText, /not.*probability/i);
  assert.ok(result.summary.summaryText.length < 400);
  assert.equal(result.summary.reviewedWords, 180);
  assert.equal(new ChunkReview().build([], { final: true }).summary.score, null);
});

test('scorer errors and non-finite scores fail closed without dropping transcript words', () => {
  for (const scorer of [() => { throw new Error('synthetic failure'); },
    () => ({ score: NaN, scorable: true }), () => Promise.resolve({ score: 80, scorable: true })]) {
    const result = new ChunkReview({ scorer }).build([span(36)]);
    assert.equal(result.summary.score, null);
    assert.equal(result.summary.totalWords, 36);
    assert.ok(result.chunks.every(chunk => !chunk.assessment.scorable));
  }
});

test('review preserves actual scorer outputs instead of forcing high or low demonstration scores', () => {
  for (const score of [0, 20, 30, 42, 67, 79, 80, 100]) {
    const result = new ChunkReview({ scorer: () => ({ score, scorable: true }) }).build([span(60)]);
    assert.ok(result.chunks.every(chunk => chunk.assessment.score === score));
    assert.equal(result.summary.score, score);
  }
});

const grounded = 'Last Tuesday I traced our Redis timeout to a connection pool leak. I added a bounded queue, measured the retries in Grafana, and deployed the fix to three workers after reviewing the production logs with my teammate.';
test('the default local scorer reviews real synthetic speech only with sufficient reliable context', () => {
  const reviewer = new ChunkReview();
  assert.equal(reviewer.build([span(18)]).summary.score, null);
  const result = reviewer.build([span(0, { text: grounded })], { final: true, technicalVocabulary: ['Redis'] });
  assert.equal(result.summary.reviewedWords, grounded.split(/\s+/).length);
  assert.equal(typeof result.summary.score, 'number');
  assert.ok(result.windows.every(window => window.scorable));
});

test('isolated transcript scoring neither reads nor mutates the global live baseline', () => {
  assert.equal(typeof LocalRisk.analyzeTranscriptIsolated, 'function');
  const context = { transcriptConfidence: 0.95 };
  LocalRisk.resetHistory();
  const pristine = LocalRisk.analyzeTranscriptIsolated(grounded, context);
  assert.equal(pristine.features.historySimilarity, 0);
  for (let i = 0; i < 4; i++) LocalRisk.analyzeTranscript(grounded, context);
  assert.deepEqual(LocalRisk.analyzeTranscriptIsolated(grounded, context), pristine);
  const expectedNextLive = LocalRisk.analyzeTranscript(grounded, context);
  LocalRisk.resetHistory();
  for (let i = 0; i < 4; i++) LocalRisk.analyzeTranscript(grounded, context);
  new ChunkReview().build([span(90, { text: `${grounded} ${grounded} ${grounded}` })], { final: true });
  assert.deepEqual(LocalRisk.analyzeTranscript(grounded, context), expectedNextLive);
  LocalRisk.resetHistory();
});
