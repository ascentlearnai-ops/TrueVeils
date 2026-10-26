const MIN_RESPONSE_WORDS = 35;
const { transcriptQuality } = require('./transcript-quality');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function wordCount(value) {
  const text = normalizeText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

class ResponseWindowAnalyzer {
  constructor({ minimumWords = MIN_RESPONSE_WORDS } = {}) {
    this.minimumWords = minimumWords;
    this.pending = [];
    this.windowIndex = 0;
    this.lastWindowEndedAt = null;
    this.lastSegment = null;
    this.seenSegments = new Set();
  }

  reset() {
    this.pending = [];
    this.windowIndex = 0;
    this.lastWindowEndedAt = null;
    this.lastSegment = null;
    this.seenSegments.clear();
  }

  addSegment(segment = {}, analyzeFn, baseContext = {}) {
    const text = normalizeText(segment.text);
    if (!text) return this.unscorable('No transcript text was available for analysis.', segment);
    if (segment.isFinal === false) return this.unscorable('Waiting for finalized speech.', segment);

    const identity = segment.segmentId ? JSON.stringify([segment.captionStreamId ?? null, segment.streamEpoch ?? null, segment.segmentId]) : null;
    if (identity && this.seenSegments.has(identity)) return this.unscorable('This speech segment was already analyzed.', segment);
    if (identity) {
      this.seenSegments.add(identity);
      if (this.seenSegments.size > 2000) this.seenSegments.delete(this.seenSegments.values().next().value);
    }
    const quality = transcriptQuality(segment);
    if (!quality.reliable) {
      this.pending = [];
      this.lastWindowEndedAt = null;
      this.lastSegment = null;
      return this.unscorable(quality.reason, segment);
    }

    const previous = this.pending.at(-1) || this.lastSegment;
    const startedAt = Number(segment.startedAt || segment.timestamp) || Date.now();
    const previousEnd = Number(previous?.endedAt || previous?.timestamp) || 0;
    const epochChanged = previous && previous.streamEpoch != null && segment.streamEpoch != null
      && previous.streamEpoch !== segment.streamEpoch;
    const streamChanged = previous && previous.captionStreamId !== segment.captionStreamId;
    const gap = previousEnd ? startedAt - previousEnd : 0;
    const contextChanged = epochChanged || streamChanged || (previous?.source && segment.source && previous.source !== segment.source);
    if (contextChanged || gap > 15000 || gap < -1000) this.pending = [];
    if (contextChanged || gap < -1000) this.lastWindowEndedAt = null;
    this.lastSegment = {
      captionStreamId: segment.captionStreamId, streamEpoch: segment.streamEpoch,
      source: segment.source, endedAt: segment.endedAt, timestamp: segment.timestamp
    };

    const words = wordCount(text);
    this.pending.push({
      ...segment,
      text,
      words,
      transcriptConfidence: quality.confidence,
      timestamp: segment.timestamp || Date.now()
    });

    const pendingText = normalizeText(this.pending.map(item => item.text).join(' '));
    const pendingWords = wordCount(pendingText);
    if (pendingWords < this.minimumWords) {
      return this.unscorable(
        `Needs at least ${this.minimumWords} reliable words before estimating AI-assistance risk.`,
        segment,
        pendingText,
        pendingWords
      );
    }

    const windowItems = this.pending.splice(0);
    const combinedText = normalizeText(windowItems.map(item => item.text).join(' '));
    const analysisWindowId = `rw-${++this.windowIndex}`;
    const transcriptConfidence = windowItems.reduce((sum, item) => sum + item.transcriptConfidence * item.words, 0) / pendingWords;
    const completeCaptureBounds = windowItems.every(item => Number.isFinite(item.startedAt) && item.startedAt > 0
      && Number.isFinite(item.endedAt) && item.endedAt >= item.startedAt);
    // Span boundaries are provider packaging, not pauses removed from the answer.
    const durationMs = completeCaptureBounds
      ? Math.max(...windowItems.map(item => item.endedAt)) - Math.min(...windowItems.map(item => item.startedAt))
      : windowItems.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0);
    const windowStartedAt = Number(windowItems[0]?.startedAt || windowItems[0]?.timestamp) || null;
    const priorSilenceGapMs = this.lastWindowEndedAt && windowStartedAt && windowStartedAt > this.lastWindowEndedAt
      ? windowStartedAt - this.lastWindowEndedAt
      : null;
    const lastItem = windowItems[windowItems.length - 1];
    this.lastWindowEndedAt = Number(lastItem?.endedAt) || Number(lastItem?.timestamp) || Date.now();
    const context = {
      ...baseContext,
      durationMs: durationMs || segment.durationMs,
      startedAt: windowStartedAt,
      endedAt: this.lastWindowEndedAt,
      sequence: segment.sequence,
      transcriptConfidence: transcriptConfidence ?? segment.transcriptConfidence,
      source: segment.source || 'speech-response-window',
      lowConfidenceWordRatio: windowItems.reduce((sum, item) => sum + (Number(item.lowConfidenceWordRatio) || 0) * item.words, 0) / pendingWords,
      segmentIds: windowItems.map(item => item.segmentId).filter(Boolean),
      streamEpoch: segment.streamEpoch,
      captionStreamId: segment.captionStreamId,
      utteranceId: segment.utteranceId,
      finalReason: segment.finalReason,
      priorSilenceGapMs,
      responseWindow: true,
      responseWindowWordCount: wordCount(combinedText)
    };
    const analysis = analyzeFn(combinedText, context);
    return {
      ...analysis,
      ready: true,
      analysisWindowId,
      responseWindowText: combinedText,
      responseWindowWordCount: context.responseWindowWordCount,
      segmentIds: context.segmentIds,
      segmentCount: windowItems.length
    };
  }

  unscorable(reason, segment = {}, responseWindowText = '', responseWindowWordCount = 0) {
    return {
      score: null,
      probability: null,
      label: 'unscorable',
      displayLabel: 'Insufficient evidence',
      confidence: 0,
      confidenceLabel: 'insufficient',
      flags: [],
      reasoning: reason,
      aiSignals: [],
      humanSignals: [],
      evidence: [],
      counterSignal: null,
      scorable: false,
      scoreWeight: 0,
      modelVersion: null,
      unscorableReason: reason,
      ready: false,
      analysisWindowId: null,
      responseWindowText,
      responseWindowWordCount,
      segmentIds: segment.segmentId ? [segment.segmentId] : []
    };
  }
}

module.exports = { ResponseWindowAnalyzer, MIN_RESPONSE_WORDS, wordCount };
