const MIN_RESPONSE_WORDS = 35;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function wordCount(value) {
  const text = normalizeText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

class ResponseWindowAnalyzer {
  constructor({ minimumWords = MIN_RESPONSE_WORDS } = {}) {
    this.minimumWords = minimumWords;
    this.pending = [];
    this.windowIndex = 0;
  }

  reset() {
    this.pending = [];
    this.windowIndex = 0;
  }

  addSegment(segment = {}, analyzeFn, baseContext = {}) {
    const text = normalizeText(segment.text);
    if (!text) return this.unscorable('No transcript text was available for analysis.', segment);

    const words = wordCount(text);
    const confidence = Number(segment.transcriptConfidence ?? segment.confidence ?? 1);
    this.pending.push({
      ...segment,
      text,
      words,
      transcriptConfidence: Number.isFinite(confidence) ? confidence : 1,
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
    const transcriptConfidence = average(windowItems.map(item => item.transcriptConfidence));
    const durationMs = windowItems.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0);
    const context = {
      ...baseContext,
      durationMs: durationMs || segment.durationMs,
      sequence: segment.sequence,
      transcriptConfidence: transcriptConfidence ?? segment.transcriptConfidence,
      segmentIds: windowItems.map(item => item.segmentId).filter(Boolean),
      streamEpoch: segment.streamEpoch,
      utteranceId: segment.utteranceId,
      finalReason: segment.finalReason,
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
