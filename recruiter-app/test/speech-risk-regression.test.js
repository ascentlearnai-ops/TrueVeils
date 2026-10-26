const test = require('node:test');
const assert = require('node:assert/strict');
const Risk = require('../src/ai/local-risk');
const { aiUseContext } = require('../src/ai/ai-use-context');
const { ResponseWindowAnalyzer } = require('../src/ai/response-window');
const { loadMain } = require('./helpers/main-harness');
const path = require('node:path');
const { assessTranscript } = require(path.join(process.env.TRUVEIL_CLIENT_DIR || path.resolve(__dirname, '../../../Truveil-Client'), 'src/transcription/quality'));

const polished = 'First, there are several key best practices. I would leverage a robust and scalable approach, align stakeholders around clear objectives, and ensure that the process remains seamless. Ultimately this enables long term maintainability and business impact.';
test.beforeEach(() => Risk.resetHistory());

for (const text of [
  'I did not use ChatGPT for this answer.',
  "I didn't ask Claude for this question.",
  'I never used ChatGPT for my response.',
  'Last year I used ChatGPT to structure the architecture answer.',
  'I used ChatGPT at my previous job for this answer.',
  'If I used ChatGPT for this answer, I would disclose it.',
  'My teammate used ChatGPT for this answer.',
  'You asked whether I used ChatGPT for this answer. I did not.',
  'The interviewer asked if I used ChatGPT for my response.',
  'Did I use ChatGPT for this answer? No.',
  'Am I using ChatGPT for this answer? No.',
  'Am I using ChatGPT for this answer no I am not',
  "I'm using ChatGPT for this answer? No.",
  "We're using Claude for this response? No.",
  "I'm not using ChatGPT for this answer.",
  "We're not using Claude for this response.",
  "If I'm using ChatGPT for this answer I would disclose it.",
  'The example says "I used ChatGPT for this answer."',
  'The example answer is yes I used ChatGPT for this response.',
  'The example asks am I using ChatGPT for this answer yes I am using ChatGPT right now.',
  'I used ChatGPT for this answer, could be an example of what someone might disclose.',
  'We discussed the phrase "as an AI language model" in the tutorial.'
]) {
  test(`does not treat contextual AI discussion as current use: ${text}`, () => {
    const context = aiUseContext(text);
    assert.equal(context.directUseCount, 0);
    assert.equal(context.strongArtifact, false);
    const result = Risk.analyzeTranscript(`${text} ${polished}`, { transcriptConfidence: 0.95 });
    assert.ok(result.score < 70);
    assert.ok(!result.aiSignals.includes('Direct AI-tool use context'));
  });
}

for (const text of [
  'I used ChatGPT to generate this answer.',
  'I am using Claude right now for this question.',
  'I put the question into ChatGPT during this interview.',
  'ChatGPT suggested this answer just now.',
  "I'm using ChatGPT for this answer right now.",
  "I\u2019m using Claude for this answer right now.",
  "We're using Gemini for this response.",
  'Am I using ChatGPT for this answer? No. But I am using Claude right now.',
  "Yes ma'am I used ChatGPT for this answer.",
  "Yes ma\u2019am I am using ChatGPT for this answer right now.",
  'Am I using ChatGPT for this answer yes I am using ChatGPT right now',
  'I used ChatGPT for this answer, is that allowed?',
  'I am using ChatGPT right now, should I close it?'
]) {
  test(`retains current-use evidence: ${text}`, () => {
    assert.equal(aiUseContext(text).directUseCount, 1);
    const result = Risk.analyzeTranscript(`${text} ${polished}`, { transcriptConfidence: 0.95 });
    assert.ok(result.score >= 70);
    assert.ok(result.aiSignals.includes('Direct AI-tool use context'));
  });
}

test('ordinary markdown, answer labels and lack of personal experience are not strong artifacts', () => {
  for (const prefix of ['I do not have personal experience with that product.', 'My final answer: add a database index.', 'I write documentation in markdown.']) {
    Risk.resetHistory();
    const result = Risk.analyzeTranscript(`${prefix} ${polished}`, { transcriptConfidence: 0.95 });
    assert.ok(result.score < 70);
    assert.equal(result.confidenceLabel, 'low');
  }
});

test('fragmented speech preserves question versus admission context without rewriting captions', async () => {
  for (const [prefix, expectedAdmission] of [
    ['Am I using ChatGPT for this answer? No.', false],
    ["I'm using ChatGPT for this answer right now.", true]
  ]) {
    Risk.resetHistory();
    const app = loadMain({ deferCaptionAnalysis: true });
    const captions = [];
    app.attachRenderer((channel, value) => { if (channel === 'realtime:caption') captions.push(value); });
    await app.invoke('session:create', { candidateName: 'Synthetic', role: 'Engineer' });
    app.event({ type: 'candidate_ready' });
    await app.invoke('session:start');
    const send = (text, index) => app.broadcasts.get('candidate_transcript')({ payload: {
      sessionId: 'TRV-ABC234', text, segmentId: `spoken-${index}`, captionStreamId: 'synthetic',
      streamEpoch: 1, revision: index + 1, sequence: index, isFinal: true,
      transcriptConfidence: 0.95, source: 'synthetic-speech', timestamp: 10000 + index * 10000,
      startedAt: 1000 + index * 10000, endedAt: 10000 + index * 10000
    } });
    send(prefix, 0);
    app.flushCaptionAnalysis();
    assert.equal(app.inspect().sessionData.scores.length, 0, 'a short admission cannot bypass the word gate');
    send(polished, 1);
    assert.equal(captions.length, 2, 'captions are published before deferred scoring');
    assert.equal(captions[0].text, prefix);
    app.flushCaptionAnalysis();
    const transcript = app.inspect().sessionData.transcripts.at(-1);
    assert.equal(app.inspect().sessionData.scores.length, 1);
    assert.equal(transcript.aiSignals.includes('Direct AI-tool use context'), expectedAdmission);
    await app.invoke('session:end');
  }
});

test('missing, invalid and low confidence speech cannot produce an AI score', () => {
  for (const confidence of [undefined, null, NaN, Infinity, '0.95', 0, -1, 1.2, 0.3]) {
    const result = Risk.analyzeTranscript(polished, { source: 'deepgram-live', transcriptConfidence: confidence });
    assert.equal(result.scorable, false);
    assert.equal(result.score, null);
  }
});

test('a high median confidence cannot hide many uncertain words', () => {
  const result = Risk.analyzeTranscript(polished, { transcriptConfidence: 0.94, lowConfidenceWordRatio: 0.4 });
  assert.equal(result.scorable, false);
  assert.match(result.unscorableReason, /uncertain recognition/);
});

test('stream chunk gaps are not evidence of an instant answer', () => {
  const ordinary = Risk.analyzeTranscript(polished, { transcriptConfidence: 0.94 });
  Risk.resetHistory();
  const tinyChunkGap = Risk.analyzeTranscript(polished, { transcriptConfidence: 0.94, priorSilenceGapMs: 1 });
  assert.equal(tinyChunkGap.rawScore, ordinary.rawScore);
});

test('response windows weight confidence by words, not fragment count', () => {
  const analyzer = new ResponseWindowAnalyzer({ minimumWords: 35 });
  analyzer.addSegment({ text: 'Yes.', transcriptConfidence: 1, segmentId: 'first' }, () => assert.fail());
  const result = analyzer.addSegment({ text: polished, transcriptConfidence: 0.6, segmentId: 'second' }, (text, context) => ({ scorable: true, context }));
  assert.ok(result.context.transcriptConfidence < 0.62);
});

test('uncertain speech cannot be hidden inside a mostly good response window', () => {
  const analyzer = new ResponseWindowAnalyzer();
  analyzer.addSegment({ text: 'Here is the first short part.', transcriptConfidence: 0.95 }, () => assert.fail());
  const result = analyzer.addSegment({ text: polished, transcriptConfidence: 0.2 }, () => assert.fail());
  assert.equal(result.scorable, false);
  assert.equal(analyzer.pending.length, 0);
});

test('replayed segments do not count twice, but repeated speech with new identity does', () => {
  const analyzer = new ResponseWindowAnalyzer({ minimumWords: 8 });
  const segment = { text: 'Please repeat that question.', transcriptConfidence: 0.95, segmentId: 's1', streamEpoch: 1 };
  analyzer.addSegment(segment, () => assert.fail());
  analyzer.addSegment(segment, () => assert.fail());
  const result = analyzer.addSegment({ ...segment, segmentId: 's2' }, () => ({ scorable: true }));
  assert.equal(result.ready, true);
  assert.equal(result.segmentCount, 2);
});

test('long pauses and reconnections do not join unrelated short answers', () => {
  for (const next of [{ timestamp: 40000, streamEpoch: 1 }, { timestamp: 2000, streamEpoch: 2 }]) {
    const analyzer = new ResponseWindowAnalyzer({ minimumWords: 8 });
    const segment = { text: 'Please repeat that question.', transcriptConfidence: 0.95, timestamp: 1000, streamEpoch: 1 };
    analyzer.addSegment(segment, () => assert.fail());
    const result = analyzer.addSegment({ ...segment, ...next }, () => assert.fail());
    assert.equal(result.ready, false);
    assert.equal(result.responseWindowWordCount, 4);
  }
});

test('actual recruiter path keeps repeated and uncertain speech without repeated scoring', async () => {
  const app = loadMain({ deferCaptionAnalysis: true });
  await app.invoke('session:create', { candidateName: 'Synthetic Candidate', jobTitle: 'Engineer' });
  app.event({ type: 'candidate_ready' });
  await app.invoke('session:start');
  const deliver = payload => app.broadcasts.get('candidate_transcript')({ payload: { isFinal: true, text: polished, timestamp: Date.now(), ...payload } });
  deliver({ segmentId: 's1', transcriptConfidence: 0.95 });
  deliver({ segmentId: 's1', transcriptConfidence: 0.95 });
  deliver({ segmentId: 's2', transcriptConfidence: 0.95 });
  deliver({ segmentId: 's3', transcriptConfidence: null });
  deliver({ segmentId: 's4', transcriptConfidence: 0.2 });
  app.flushCaptionAnalysis();
  assert.equal(app.inspect().sessionData.transcripts.length, 4);
  assert.equal(app.inspect().sessionData.scores.length, 2);
  assert.equal(app.inspect().sessionData.transcripts[2].transcriptConfidence, null);
  assert.equal(app.inspect().sessionData.transcripts[3].scorable, false);
  await app.invoke('session:end');
});

test('actual event fusion uses speech time and verified events, including ISO timestamps', async () => {
  const now = Date.now();
  async function score(event) {
    const app = loadMain({ deferCaptionAnalysis: true });
    await app.invoke('session:create', { candidateName: 'Synthetic Candidate', jobTitle: 'Engineer' });
    app.event({ type: 'candidate_ready' });
    await app.invoke('session:start');
    if (event) app.inspect().sessionData.flags.push(event);
    app.broadcasts.get('candidate_transcript')({ payload: {
      isFinal: true, text: polished, timestamp: now, startedAt: now - 20000, endedAt: now - 1000,
      segmentId: 's1', transcriptConfidence: 0.95
    } });
    app.flushCaptionAnalysis();
    const result = app.inspect().sessionData.transcripts[0];
    await app.invoke('session:end');
    return result;
  }
  const isolated = await score();
  const restricted = { detectedHost: 'chatgpt.com', detectionSource: 'url', policyDecision: 'restricted' };
  const verified = await score({ ...restricted, timestamp: new Date(now - 25000).toISOString() });
  const afterSpeech = await score({ ...restricted, timestamp: now - 15000 });
  const allowed = await score({ ...restricted, timestamp: now - 25000, policyDecision: 'allowed' });
  const titleOnly = await score({ windowTitle: 'Article about ChatGPT', detectionSource: 'title', timestamp: now - 25000 });
  assert.ok(verified.aiScore > isolated.aiScore);
  assert.equal(afterSpeech.aiScore, isolated.aiScore);
  assert.equal(allowed.aiScore, isolated.aiScore);
  assert.equal(titleOnly.aiScore, isolated.aiScore);
});

test('candidate quality decisions reach recruiter scoring without marking healthy speech unsafe', async () => {
  const app = loadMain({ deferCaptionAnalysis: true });
  await app.invoke('session:create', { candidateName: 'Synthetic Candidate', jobTitle: 'Engineer' });
  app.event({ type: 'candidate_ready' });
  await app.invoke('session:start');
  for (const confidence of [0.95, 0.31, undefined]) {
    const assessed = assessTranscript({ text: polished, confidence, rms: 0.02, peak: 0.2 });
    assert.equal(assessed.accepted, true);
    app.broadcasts.get('candidate_transcript')({ payload: {
      text: assessed.text, transcriptConfidence: assessed.confidence, qualityReason: assessed.qualityReason,
      segmentId: `quality-${confidence}`, timestamp: Date.now()
    } });
  }
  app.flushCaptionAnalysis();
  const entries = app.inspect().sessionData.transcripts;
  assert.equal(entries.length, 3);
  assert.equal(entries[0].scorable, true);
  assert.equal(entries[1].scorable, false);
  assert.equal(entries[2].scorable, false);
  assert.equal(Risk.analyzeTranscript(polished, { transcriptConfidence: 0.95, qualityReason: 'ok' }).scorable, true);
  await app.invoke('session:end');
});

test('storage fallback carries capture bounds through reception and analysis', async () => {
  const fs = require('node:fs');
  const app = loadMain({
    fs: { ...fs, mkdirSync() {}, writeFileSync() {} },
    storage: { from: () => ({ download: async () => ({ data: Buffer.alloc(256) }), remove: async () => ({}) }) }
  });
  await app.invoke('session:create', { candidateName: 'Synthetic Candidate', jobTitle: 'Engineer' });
  app.run(`transcribeAudioEntry = async () => (${JSON.stringify({ text: polished, confidence: 0.95, source: 'test-speech' })})`);
  const now = Date.now();
  app.inspect().sessionData.flags.push({ detectedHost: 'chatgpt.com', detectionSource: 'url', timestamp: now - 10000 });
  await app.run(`handleCandidateAudioChunk(${JSON.stringify({
    chunkId: 'synthetic-audio', storagePath: 'TRV-ABC234/test.webm', sequence: 1,
    timestamp: now, startedAt: now - 20000, endedAt: now, durationMs: 20000, rms: 0.1, peak: 0.2
  })})`);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.inspect().sessionData.audioChunks[0].startedAt, now - 20000);
  assert.equal(app.inspect().sessionData.audioChunks[0].endedAt, now);
  const transcript = app.inspect().sessionData.transcripts[0];
  assert.ok(transcript);
  assert.ok(transcript.aiScore <= 68);
  assert.equal(transcript.transcriptConfidence, 0.95);
  await app.invoke('session:cancel');
});
