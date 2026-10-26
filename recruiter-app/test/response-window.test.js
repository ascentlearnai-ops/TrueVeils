const test = require('node:test');
const assert = require('node:assert/strict');
const { ResponseWindowAnalyzer } = require('../src/ai/response-window');

test('small finalized spans retain pauses in response duration instead of inventing fast delivery', () => {
  const analyzer = new ResponseWindowAnalyzer();
  let measured;
  const analyze = (_text, context) => { measured = context; return { score: 0, scorable: true }; };
  for (let i = 0; i < 5; i++) analyzer.addSegment({
    text: 'I used a queue for this work', transcriptConfidence: 0.9,
    segmentId: `span-${i}`, startedAt: 100000 + i * 4000,
    endedAt: 102000 + i * 4000, durationMs: 2000, timestamp: 102000 + i * 4000
  }, analyze);
  assert.equal(measured.responseWindowWordCount, 35);
  assert.equal(measured.durationMs, 18000);
});

test('holds short transcript fragments until enough reliable words exist', () => {
  const analyzer = new ResponseWindowAnalyzer({ minimumWords: 35 });
  let calls = 0;
  const result = analyzer.addSegment({
    text: 'Hello, I debugged the checkout issue yesterday.',
    segmentId: 's1',
    transcriptConfidence: 0.92
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

test('35-word finalized chunks preserve the original technical terms and abstention across splits', () => {
  const text = 'Um I traced the PostgreSQL WAL records through Redis and Kubernetes then used C++ to reproduce the race because our Node.js worker retried gRPC requests twice and TypeScript logs showed why the cache expired early';
  const words = text.split(' ');
  assert.equal(words.length, 35);
  for (const size of [1, 5, 7, 35]) {
    const analyzer = new ResponseWindowAnalyzer();
    const seen = [];
    for (let offset = 0; offset < words.length; offset += size) {
      const result = analyzer.addSegment({
        text: words.slice(offset, offset + size).join(' '), transcriptConfidence: 0.95,
        captionStreamId: 'join-one', streamEpoch: 1, segmentId: `s-${offset}`,
        startedAt: 1000 + offset * 100, endedAt: 1000 + (offset + size) * 100, durationMs: size * 100
      }, (transcript, context) => { seen.push({ transcript, context }); return { scorable: true, score: 12 }; });
      if (offset + size < 35) {
        assert.equal(result.scorable, false);
        assert.match(result.unscorableReason, /35 reliable words/);
      }
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0].transcript, text);
    assert.equal(seen[0].context.durationMs, 3500);
    assert.equal(seen[0].context.responseWindowWordCount, 35);
  }
});

test('a candidate rejoin resets unfinished response context without treating new final IDs as replays', () => {
  const analyzer = new ResponseWindowAnalyzer({ minimumWords: 8 });
  const segment = { text: 'Please repeat that question.', transcriptConfidence: 0.95, segmentId: 's1', streamEpoch: 1, timestamp: 1000 };
  analyzer.addSegment({ ...segment, captionStreamId: 'old-join' }, () => assert.fail());
  const result = analyzer.addSegment({ ...segment, captionStreamId: 'new-join', timestamp: 1200 }, () => assert.fail());
  assert.equal(result.responseWindowWordCount, 4);
  assert.equal(result.ready, false);
});

test('a rejoin after a complete response never inherits the previous candidate stream silence gap', () => {
  const analyzer = new ResponseWindowAnalyzer({ minimumWords: 4 });
  const segment = { text: 'Please repeat that question.', transcriptConfidence: 0.95, segmentId: 's1', streamEpoch: 1, startedAt: 1000, endedAt: 2000 };
  analyzer.addSegment({ ...segment, captionStreamId: 'old-join' }, () => ({ scorable: true, score: 12 }));
  let context;
  analyzer.addSegment({ ...segment, captionStreamId: 'new-join', startedAt: 3000, endedAt: 4000 }, (_, ctx) => { context = ctx; return { scorable: true, score: 12 }; });
  assert.equal(context.priorSilenceGapMs, null);
});
