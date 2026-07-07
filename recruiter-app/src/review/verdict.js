// Session-end aggregate verdict.
// Combines confidence-weighted transcript-pattern scores with the behavioral
// review band into one advisory estimate. This layer never overrides the
// review band — it summarizes the same evidence for the recruiter.

const BAND_FLOORS = {
  high_priority_review: 80,
  review: 55
};

const LABELS = {
  likely_assisted: 'Likely AI-assisted',
  likely_unassisted: 'Likely unassisted',
  uncertain: 'Uncertain — needs review',
  insufficient: 'Insufficient evidence'
};

const ADVISORY_NOTE = 'This estimate combines transcript-pattern evidence and monitored session behavior. '
  + 'It is advisory input for human review, not a certified detection result.';

function normalizeScore(item) {
  if (typeof item === 'number') return { score: item, weight: item > 0 ? 1 : 0 };
  if (item && typeof item.score === 'number' && Number.isFinite(item.score) && item.scorable !== false) {
    const weight = typeof item.weight === 'number' ? item.weight
      : typeof item.scoreWeight === 'number' ? item.scoreWeight
        : 1;
    return { score: item.score, weight };
  }
  return null;
}

function weightedAverage(items = []) {
  const valid = items.map(normalizeScore).filter(item => item && item.weight > 0);
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  if (!valid.length || totalWeight <= 0) return { average: 0, count: 0 };
  return {
    average: valid.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight,
    count: valid.length
  };
}

function confidenceFor({ windowCount, behavioralFloor, reviewBand }) {
  if (reviewBand === 'incomplete_evidence' && !windowCount) return 'insufficient';
  if (behavioralFloor >= BAND_FLOORS.high_priority_review) {
    // OS-level restricted-destination / overlay evidence is high precision.
    return windowCount >= 3 ? 'high' : 'medium';
  }
  if (!windowCount) return behavioralFloor ? 'low' : 'insufficient';
  if (windowCount < 3) return 'low';
  if (windowCount < 6) return 'medium';
  return 'high';
}

function labelFor(score, confidence, windowCount) {
  if (confidence === 'insufficient') return LABELS.insufficient;
  if (score >= 70) return LABELS.likely_assisted;
  if (score <= 35 && windowCount >= 3) return LABELS.likely_unassisted;
  return LABELS.uncertain;
}

function computeSessionVerdict({ scores = [], review = {}, behavior = null } = {}) {
  const { average, count } = weightedAverage(scores);
  const reviewBand = review.reviewBand || 'incomplete_evidence';
  const behavioralFloor = BAND_FLOORS[reviewBand] || 0;
  const verdictScore = Math.round(Math.min(100, Math.max(average, behavioralFloor)));
  const verdictConfidence = confidenceFor({ windowCount: count, behavioralFloor, reviewBand });
  const verdictLabel = labelFor(verdictScore, verdictConfidence, count);

  return {
    verdictScore: verdictConfidence === 'insufficient' ? null : verdictScore,
    verdictConfidence,
    verdictLabel,
    advisoryNote: ADVISORY_NOTE,
    basis: {
      transcriptWindows: count,
      transcriptAverage: Math.round(average),
      behavioralFloor,
      reviewBand,
      behavioralDestinations: behavior?.destinations || []
    }
  };
}

module.exports = { computeSessionVerdict, weightedAverage, BAND_FLOORS, LABELS };
