const { createHash } = require('node:crypto');
const LocalRisk = require('./local-risk');
const { MIN_RESPONSE_WORDS } = require('./response-window');
const { transcriptQuality } = require('./transcript-quality');

const TARGET_WORDS = 30;
const MIN_CHUNK_WORDS = 25;
const MAX_CHUNK_WORDS = 35;
const MAX_WINDOW_CHUNKS = 4;
const MAX_FINAL_WORDS = TARGET_WORDS * MAX_WINDOW_CHUNKS * 2 - 1;
const MAX_CACHE_ENTRIES = 128;
const WAITING = `Needs at least ${MIN_RESPONSE_WORDS} reliable words of continuous context before review.`;

function stableKey(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

function id(prefix, value) {
  return `${prefix}-${createHash('sha256').update(stableKey(value)).digest('hex').slice(0, 24)}`;
}

function time(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function provenance(entry) {
  return [entry.captionStreamId ?? null, entry.streamEpoch ?? null, entry.source ?? null];
}

function discontinuity(previous, next) {
  if (stableKey(provenance(previous)) !== stableKey(provenance(next))) return true;
  const start = time(next.startedAt) ?? time(next.timestamp);
  const end = time(previous.endedAt) ?? time(previous.timestamp);
  return start != null && end != null && (start - end > 15000 || start - end < -1000);
}

function runsFor(transcripts) {
  const entries = new Map();
  for (const entry of transcripts || []) {
    if (!entry || typeof entry.text !== 'string') continue;
    const words = entry.text.match(/\S+/g) || [];
    if (!words.length) continue;
    const rawId = entry.segmentId ?? entry.id ?? entry.captionKey ?? entry.sequence;
    const identity = rawId == null
      ? [entry.startedAt ?? null, entry.endedAt ?? null, entry.timestamp ?? null] : rawId;
    const key = id('span', [provenance(entry), identity, words]);
    // A repeated delivery may carry corrected quality metadata; retain its original position.
    const quality = transcriptQuality(entry);
    if (entry.isFinal === false || entry.interim === true) {
      quality.reliable = false;
      quality.reason = 'Waiting for finalized speech; transcript retained for review.';
    }
    entries.set(key, { entry, key, words, quality });
  }
  const runs = [];
  let previous = null;
  for (const item of entries.values()) {
    if (!previous || !item.quality.reliable || !previous.quality.reliable
      || discontinuity(previous.entry, item.entry)) {
      runs.push({ items: [], reliable: item.quality.reliable, reason: item.quality.reason });
    }
    runs.at(-1).items.push(item);
    previous = item;
  }
  return runs;
}

function chunkSizes(wordCount) {
  const sizes = [];
  let remaining = wordCount;
  // Closed 120-word windows stay stable as more provider spans arrive.
  while (remaining >= TARGET_WORDS * MAX_WINDOW_CHUNKS) {
    sizes.push(...Array(MAX_WINDOW_CHUNKS).fill(TARGET_WORDS));
    remaining -= TARGET_WORDS * MAX_WINDOW_CHUNKS;
  }
  const count = Math.ceil(remaining / MAX_CHUNK_WORDS);
  if (count && remaining >= count * MIN_CHUNK_WORDS) {
    const base = Math.floor(remaining / count);
    const extra = remaining % count;
    sizes.push(...Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0)));
    return sizes;
  }
  // Preserve an unfinished short tail when there is not enough speech to balance it.
  while (remaining > MAX_CHUNK_WORDS) {
    sizes.push(TARGET_WORDS);
    remaining -= TARGET_WORDS;
  }
  if (remaining) sizes.push(remaining);
  return sizes;
}

function chunksFor(run, final) {
  const tokens = run.items.flatMap(item => item.words.map((word, offset) => ({ word, offset, item })));
  let offset = 0;
  return chunkSizes(tokens.length).map(size => {
    const slice = tokens.slice(offset, offset += size);
    return {
      id: id('cr', slice.map(token => [token.item.key, token.offset, token.word])),
      text: slice.map(token => token.word).join(' '), wordCount: size,
      complete: final || size >= MIN_CHUNK_WORDS, tokens: slice
    };
  });
}

function groupsFor(chunks, final, reliable) {
  const groups = [];
  for (let i = 0; i < chunks.length; i += MAX_WINDOW_CHUNKS) groups.push(chunks.slice(i, i + MAX_WINDOW_CHUNKS));
  const wordCount = group => group.reduce((sum, chunk) => sum + chunk.wordCount, 0);
  if (final && reliable && groups.length > 1 && wordCount(groups.at(-1)) < MIN_RESPONSE_WORDS
    && wordCount(groups.at(-2)) + wordCount(groups.at(-1)) <= MAX_FINAL_WORDS) {
    const tail = groups.pop();
    groups.at(-1).push(...tail);
  }
  return groups;
}

function contextFor(chunks, technicalVocabulary) {
  const tokens = chunks.flatMap(chunk => chunk.tokens);
  const items = [...new Set(tokens.map(token => token.item))];
  const first = items[0].entry;
  const starts = items.map(({ entry }) => time(entry.startedAt) ?? time(entry.timestamp)).filter(value => value != null);
  const ends = items.map(({ entry }) => time(entry.endedAt) ?? time(entry.timestamp)).filter(value => value != null);
  const startedAt = starts.length === items.length ? Math.min(...starts) : null;
  const endedAt = ends.length === items.length ? Math.max(...ends) : null;
  const completeBounds = items.every(({ entry }) => time(entry.startedAt) != null
    && time(entry.endedAt) != null && entry.endedAt >= entry.startedAt);
  return {
    technicalVocabulary, startedAt, endedAt,
    durationMs: completeBounds
      ? Math.max(...items.map(item => item.entry.endedAt)) - Math.min(...items.map(item => item.entry.startedAt)) : null,
    transcriptConfidence: tokens.reduce((sum, token) => sum + token.item.quality.confidence, 0) / tokens.length,
    lowConfidenceWordRatio: tokens.reduce((sum, token) => sum + (token.item.quality.lowConfidenceWordRatio || 0), 0) / tokens.length,
    source: first.source || 'speech-chunk-review', captionStreamId: first.captionStreamId,
    streamEpoch: first.streamEpoch, responseWindow: true, responseWindowWordCount: tokens.length
  };
}

function assessment(result = {}, fallback = 'Pattern review is unavailable; transcript retained for review.') {
  const scorable = result?.scorable === true && Number.isFinite(result.score) && result.score >= 0 && result.score <= 100;
  return {
    score: scorable ? result.score : null, scorable,
    reasoning: typeof result?.reasoning === 'string' && result.reasoning ? result.reasoning : fallback,
    aiSignals: Array.isArray(result?.aiSignals) ? result.aiSignals.filter(item => typeof item === 'string') : [],
    humanSignals: Array.isArray(result?.humanSignals) ? result.humanSignals.filter(item => typeof item === 'string') : []
  };
}

class ChunkReview {
  constructor({ scorer = LocalRisk.analyzeTranscriptIsolated, cacheLimit = MAX_CACHE_ENTRIES } = {}) {
    this.scorer = scorer;
    this.cacheLimit = Number.isFinite(cacheLimit) ? Math.max(1, Math.min(MAX_CACHE_ENTRIES, Math.floor(cacheLimit))) : MAX_CACHE_ENTRIES;
    this.cache = new Map();
  }

  score(text, context) {
    const key = id('cache', [LocalRisk.MODEL_VERSION, text, context]);
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, cached);
      return assessment(cached);
    }
    let result;
    try {
      const raw = this.scorer(text, context);
      if (raw && typeof raw.then === 'function') {
        Promise.resolve(raw).catch(() => {});
        result = assessment();
      } else result = assessment(raw);
    } catch {
      result = assessment();
    }
    this.cache.set(key, result);
    if (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
    return assessment(result);
  }

  // contextForRange(startedAt, endedAt) supplies read-only event context in capture milliseconds.
  build(transcripts, { final = false, technicalVocabulary = [], contextForRange } = {}) {
    const chunks = [];
    const windows = [];
    for (const run of runsFor(transcripts)) {
      const runChunks = chunksFor(run, Boolean(final));
      for (const group of groupsFor(runChunks, final, run.reliable)) {
        const text = group.map(chunk => chunk.text).join(' ');
        const wordCount = group.reduce((sum, chunk) => sum + chunk.wordCount, 0);
        const windowId = id('cw', group.map(chunk => chunk.id));
        let result = assessment({}, run.reason || WAITING);
        if (run.reliable && wordCount >= MIN_RESPONSE_WORDS) {
          const context = contextFor(group, technicalVocabulary);
          try {
            const rangeContext = contextForRange ? contextForRange(context.startedAt, context.endedAt) : {};
            result = this.score(text, { ...rangeContext, ...context });
          } catch {
            result = assessment();
          }
        }
        windows.push({ id: windowId, text, wordCount, ...assessment(result) });
        for (const chunk of group) {
          const { tokens, ...display } = chunk;
          chunks.push({ ...display, assessment: {
            ...assessment(result), contextWords: run.reliable ? wordCount : 0, windowId
          } });
        }
      }
    }
    const reviewed = chunks.filter(chunk => chunk.assessment.scorable);
    const totalWords = chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0);
    const reviewedWords = reviewed.reduce((sum, chunk) => sum + chunk.wordCount, 0);
    const score = reviewedWords
      ? Math.round(reviewed.reduce((sum, chunk) => sum + chunk.assessment.score * chunk.wordCount, 0) / reviewedWords) : null;
    const summaryText = score == null
      ? `No scorable continuous speech context yet. ${totalWords} words retained for review; at least ${MIN_RESPONSE_WORDS} reliable words are required.`
      : `Experimental pattern score: ${score}/100, not an authorship probability. Reviewed ${reviewedWords} of ${totalWords} words across ${reviewed.length} chunks. Human review is required${reviewedWords < totalWords ? '; remaining speech is unscored' : ''}.`;
    return {
      final: Boolean(final), chunks, windows,
      summary: { score, totalWords, reviewedWords, reviewedChunks: reviewed.length, summaryText },
      modelVersion: LocalRisk.MODEL_VERSION
    };
  }
}

module.exports = { ChunkReview };
