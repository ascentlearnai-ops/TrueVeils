function confidenceValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value : null;
}

function qualityReason(value) {
  if (!value || value === 'ok') return null;
  if (value === 'missing-confidence' || value === 'confidence-unavailable') return 'Speech recognition confidence is unavailable; transcript retained for review.';
  if (value === 'low-confidence' || value === 'weak-single-word') return 'Transcript confidence is too low for a reliable estimate.';
  if (value === 'low-confidence-words') return 'Too many words have uncertain recognition; transcript retained for review.';
  return `Speech recognition needs review (${String(value).slice(0, 80)}).`;
}

function transcriptQuality(segment = {}) {
  const confidence = confidenceValue(segment.transcriptConfidence ?? segment.confidence);
  const lowConfidenceWordRatio = confidenceValue(segment.lowConfidenceWordRatio);
  const reason = qualityReason(segment.qualityReason)
    || (confidence == null ? 'Speech recognition confidence is unavailable; transcript retained for review.' : null)
    || (confidence < 0.58 ? 'Transcript confidence is too low for a reliable estimate.' : null)
    || (lowConfidenceWordRatio != null && lowConfidenceWordRatio > 0.25
      ? 'Too many words have uncertain recognition; transcript retained for review.' : null);
  return { confidence, lowConfidenceWordRatio, reason, reliable: !reason };
}

module.exports = { confidenceValue, qualityReason, transcriptQuality };
