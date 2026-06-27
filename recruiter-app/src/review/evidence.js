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
    .filter(event => AI_TARGET.test(eventText(event)) && event.policyDecision !== 'allowed' && event.reviewStatus !== 'allowed')
    .map(event => {
      const occurredAt = timestampOf(event);
      const nextTranscript = orderedTranscripts.find(item => item._timestamp > occurredAt);
      if (!occurredAt || !nextTranscript) return null;
      const secondsUntilResponse = Math.round((nextTranscript._timestamp - occurredAt) / 1000);
      if (secondsUntilResponse > 120) return null;
      return {
        eventType: event.eventType || 'restricted_target',
        target: targetLabel(event),
        occurredAt,
        nextTranscriptAt: nextTranscript._timestamp,
        secondsUntilResponse,
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
  const restrictedAiEvents = events.filter(event => (
    AI_TARGET.test(eventText(event))
    && event.policyDecision !== 'allowed'
    && event.reviewStatus !== 'allowed'
  ));
  const exactAiEvents = restrictedAiEvents.filter(event => (
    event.detectionSource === 'url' || event.closedRestrictedTarget || event.eventType === 'overlay_detected'
  ));
  const possibleAiEvents = restrictedAiEvents.filter(event => !exactAiEvents.includes(event));
  const overlayEvents = events.filter(event => OVERLAY_TARGET.test(eventText(event)));
  const unusualSwitches = events.filter(event => (
    event.eventType === 'focus_lost'
    || (event.eventType === 'foreground_changed' && event.policyDecision === 'unlisted')
  ));
  const healthMissing = telemetry.connected !== true
    || !['healthy', 'connected'].includes(telemetry.transcription)
    || !['healthy', 'connected'].includes(telemetry.monitoring);

  const words = transcriptWordCount(transcripts);
  const reliableResponses = transcripts.filter(item => Number(item.transcriptConfidence ?? item.confidence ?? 1) >= 0.58).length;
  const hasReliableTranscript = words >= 18 && reliableResponses >= 1;
  let reviewBand = healthMissing && !hasReliableTranscript ? 'incomplete_evidence' : 'clear';
  const evidence = [];
  const counterEvidence = [];

  if (restrictedAiEvents.length || overlayEvents.length) {
    reviewBand = 'high_priority_review';
    if (restrictedAiEvents.length) evidence.push(`${restrictedAiEvents.length} restricted AI-tool event${restrictedAiEvents.length === 1 ? '' : 's'}`);
    if (overlayEvents.length) evidence.push(`${overlayEvents.length} hidden-overlay event${overlayEvents.length === 1 ? '' : 's'}`);
  } else if (possibleAiEvents.length || unusualSwitches.length >= 4) {
    reviewBand = 'review';
    if (possibleAiEvents.length) evidence.push(`${possibleAiEvents.length} possible AI-tool title or process match${possibleAiEvents.length === 1 ? '' : 'es'}`);
    if (unusualSwitches.length >= 4) evidence.push(`${unusualSwitches.length} unusual foreground changes`);
  }

  const transcriptEligible = words >= 250 && reliableResponses >= 3;
  const strongTranscriptSignals = transcriptEligible
    ? transcriptAnalyses.filter(item => Number(item.aiScore ?? item.score) >= 70).length
    : 0;
  if (strongTranscriptSignals >= 2) {
    counterEvidence.push('Experimental transcript-pattern signals were recorded for research only and did not change the review band');
  }
  if (!transcriptEligible) {
    counterEvidence.push('Transcript-pattern analysis abstained until at least 250 reliable words across three responses');
  }
  if (!exactAiEvents.length && !possibleAiEvents.length && !overlayEvents.length) {
    counterEvidence.push('No restricted AI destination or hidden overlay was detected');
  }
  if (healthMissing && hasReliableTranscript) {
    counterEvidence.push('Telemetry reported waiting or degraded state, but reliable transcript evidence was present');
  }

  const summaries = {
    clear: 'No review signals were detected in the available evidence. Human review is still required.',
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
