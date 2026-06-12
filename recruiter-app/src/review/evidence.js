const AI_TARGET = /\b(chatgpt\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|perplexity\.ai|poe\.com|you\.com|phind\.com|interviewcoder|interview coder|cluely|finalround|lockedin|parakeet|leetcode wizard|ultracode|interview copilot)\b/i;
const OVERLAY_TARGET = /\b(hidden overlay|overlay detected|exclude.?from.?capture|interviewcoder|interview coder|cluely|lockedin|finalround|parakeet)\b/i;

const rank = {
  clear: 0,
  incomplete_evidence: 1,
  review: 2,
  high_priority_review: 3
};

function eventText(event = {}) {
  return [
    event.text,
    event.eventType,
    event.detectedHost,
    event.detectedUrl,
    event.matchedRule,
    event.processName,
    event.windowTitle
  ].filter(Boolean).join(' ');
}

function transcriptWordCount(transcripts = []) {
  return transcripts.reduce((total, item) => (
    total + String(item.text || '').trim().split(/\s+/).filter(Boolean).length
  ), 0);
}

function timestampOf(item = {}) {
  const value = item.occurredAt || item.timestamp || item.startedAt || item.createdAt;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function targetLabel(event = {}) {
  return event.detectedHost
    || event.detectedUrl
    || event.windowTitle
    || event.processName
    || event.matchedRule
    || 'restricted destination';
}

function correlateEvidence(events = [], transcripts = []) {
  const orderedTranscripts = transcripts
    .map(item => ({ ...item, _timestamp: timestampOf(item) }))
    .filter(item => item._timestamp)
    .sort((a, b) => a._timestamp - b._timestamp);

  return events
    .filter(event => AI_TARGET.test(eventText(event)))
    .map(event => {
      const occurredAt = timestampOf(event);
      const nextTranscript = orderedTranscripts.find(item => item._timestamp > occurredAt);
      if (!occurredAt || !nextTranscript) return null;
      return {
        eventType: event.eventType || 'restricted_target',
        target: targetLabel(event),
        occurredAt,
        nextTranscriptAt: nextTranscript._timestamp,
        secondsUntilResponse: Math.round((nextTranscript._timestamp - occurredAt) / 1000),
        transcriptPreview: String(nextTranscript.text || '').slice(0, 180)
      };
    })
    .filter(Boolean);
}

function evaluateReview({
  events = [],
  transcripts = [],
  telemetry = {},
  transcriptAnalyses = []
} = {}) {
  const exactAiEvents = events.filter(event => (
    AI_TARGET.test(eventText(event))
    && (event.detectionSource === 'url' || event.closedRestrictedTarget || event.eventType === 'overlay_detected')
  ));
  const possibleAiEvents = events.filter(event => (
    AI_TARGET.test(eventText(event)) && !exactAiEvents.includes(event)
  ));
  const overlayEvents = events.filter(event => OVERLAY_TARGET.test(eventText(event)));
  const unusualSwitches = events.filter(event => (
    event.eventType === 'focus_lost'
    || (event.eventType === 'foreground_changed' && event.policyDecision === 'unlisted')
  ));
  const healthMissing = telemetry.connected === false
    || telemetry.transcription === 'unavailable'
    || telemetry.monitoring === 'unavailable';

  let reviewBand = healthMissing ? 'incomplete_evidence' : 'clear';
  const evidence = [];
  const counterEvidence = [];

  if (exactAiEvents.length || overlayEvents.length) {
    reviewBand = 'high_priority_review';
    if (exactAiEvents.length) evidence.push(`${exactAiEvents.length} exact restricted AI-tool event${exactAiEvents.length === 1 ? '' : 's'}`);
    if (overlayEvents.length) evidence.push(`${overlayEvents.length} hidden-overlay event${overlayEvents.length === 1 ? '' : 's'}`);
  } else if (possibleAiEvents.length || unusualSwitches.length >= 4) {
    reviewBand = 'review';
    if (possibleAiEvents.length) evidence.push(`${possibleAiEvents.length} possible AI-tool title or process match${possibleAiEvents.length === 1 ? '' : 'es'}`);
    if (unusualSwitches.length >= 4) evidence.push(`${unusualSwitches.length} unusual foreground changes`);
  }

  const words = transcriptWordCount(transcripts);
  const reliableResponses = transcripts.filter(item => Number(item.transcriptConfidence ?? item.confidence ?? 1) >= 0.58).length;
  const transcriptEligible = words >= 250 && reliableResponses >= 3;
  const strongTranscriptSignals = transcriptEligible
    ? transcriptAnalyses.filter(item => Number(item.aiScore ?? item.score) >= 70).length
    : 0;
  if (strongTranscriptSignals >= 2 && rank[reviewBand] < rank.review) {
    reviewBand = 'review';
    evidence.push('Repeated experimental transcript-pattern signals');
  }
  if (!transcriptEligible) {
    counterEvidence.push('Transcript-pattern analysis abstained until at least 250 reliable words across three responses');
  }
  if (!exactAiEvents.length && !possibleAiEvents.length && !overlayEvents.length) {
    counterEvidence.push('No restricted AI destination or hidden overlay was detected');
  }

  const summaries = {
    clear: 'No meaningful integrity evidence was detected. Human review is still required.',
    review: 'One or more signals should be reviewed alongside the interview context.',
    high_priority_review: 'Strong behavioral evidence requires interviewer review before making a decision.',
    incomplete_evidence: 'Telemetry was incomplete, so this session cannot be confidently summarized.'
  };
  const correlations = correlateEvidence(events, transcripts);

  return {
    reviewBand,
    displayBand: {
      clear: 'Clear',
      review: 'Review',
      high_priority_review: 'High-priority review',
      incomplete_evidence: 'Incomplete evidence'
    }[reviewBand],
    summary: summaries[reviewBand],
    evidence,
    counterEvidence,
    correlations,
    telemetryHealth: telemetry,
    transcriptEligible,
    transcriptWordCount: words
  };
}

module.exports = { correlateEvidence, evaluateReview, eventText, targetLabel, transcriptWordCount };
