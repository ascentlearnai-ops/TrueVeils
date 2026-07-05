const AI_TARGET = /\b(chatgpt(?:\.com)?|claude(?:\.ai)?|gemini(?:\.google\.com)?|copilot(?:\.microsoft\.com)?|perplexity(?:\.ai)?|poe(?:\.com)?|you\.com|phind(?:\.com)?|interviewcoder|interview coder|cluely|finalround|lockedin|parakeet|leetcode wizard|ultracode|interview copilot)\b/i;
const OVERLAY_TARGET = /\b(hidden overlay|overlay detected|exclude.?from.?capture|interviewcoder|interview coder|cluely|lockedin|finalround|parakeet)\b/i;
const DIRECT_TRANSCRIPT_SIGNAL = /\b(copied assistant or prompt artifact|markdown or code-block artifact|prompt or answer-label residue|direct ai-tool use context)\b/i;
const CORRELATED_TRANSCRIPT_SIGNAL = /\bresponse followed a restricted ai-tool event\b/i;

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

function analysisScore(item = {}) {
  const value = item.aiScore ?? item.score;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function analysisSignals(item = {}) {
  return [
    ...(Array.isArray(item.aiSignals) ? item.aiSignals : []),
    ...(Array.isArray(item.flags) ? item.flags : []),
    ...(Array.isArray(item.evidence) ? item.evidence.map(entry => entry?.label || entry?.signal) : [])
  ].filter(Boolean).join(' | ');
}

function isScorableAnalysis(item = {}) {
  return item.scorable !== false && analysisScore(item) != null;
}

function isDirectTranscriptArtifact(item = {}) {
  const score = analysisScore(item);
  if (score == null || score < 78 || item.scorable === false) return false;
  const confidence = Number(item.confidence ?? item.scoreWeight ?? 1);
  if (Number.isFinite(confidence) && confidence < 0.45) return false;
  return DIRECT_TRANSCRIPT_SIGNAL.test(analysisSignals(item));
}

function isCorrelatedTranscriptSignal(item = {}) {
  const score = analysisScore(item);
  if (score == null || score < 72 || item.scorable === false) return false;
  return CORRELATED_TRANSCRIPT_SIGNAL.test(analysisSignals(item));
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

  if (exactAiEvents.length || overlayEvents.length) {
    reviewBand = 'high_priority_review';
    if (exactAiEvents.length) evidence.push(`${exactAiEvents.length} restricted AI-tool event${exactAiEvents.length === 1 ? '' : 's'}`);
    if (overlayEvents.length) evidence.push(`${overlayEvents.length} hidden-overlay event${overlayEvents.length === 1 ? '' : 's'}`);
  } else if (possibleAiEvents.length || unusualSwitches.length >= 4) {
    reviewBand = 'review';
    if (possibleAiEvents.length) evidence.push(`${possibleAiEvents.length} possible AI-tool title or process match${possibleAiEvents.length === 1 ? '' : 'es'}`);
    if (unusualSwitches.length >= 4) evidence.push(`${unusualSwitches.length} unusual foreground changes`);
  }

  const directTranscriptFindings = transcriptAnalyses.filter(isDirectTranscriptArtifact);
  const correlatedTranscriptFindings = transcriptAnalyses.filter(isCorrelatedTranscriptSignal);
  const transcriptEligible = directTranscriptFindings.length > 0 || (words >= 250 && reliableResponses >= 3);
  const advisoryTranscriptSignals = transcriptEligible
    ? transcriptAnalyses.filter(item => {
      const score = analysisScore(item);
      return isScorableAnalysis(item)
        && score >= 70
        && !isDirectTranscriptArtifact(item)
        && !isCorrelatedTranscriptSignal(item);
    }).length
    : 0;

  if (!exactAiEvents.length && !overlayEvents.length && directTranscriptFindings.length) {
    reviewBand = 'high_priority_review';
    evidence.push(`${directTranscriptFindings.length} direct transcript AI-artifact signal${directTranscriptFindings.length === 1 ? '' : 's'}`);
  } else if (reviewBand === 'clear' && correlatedTranscriptFindings.length) {
    reviewBand = 'review';
    evidence.push(`${correlatedTranscriptFindings.length} transcript response${correlatedTranscriptFindings.length === 1 ? '' : 's'} followed restricted AI-tool activity`);
  }

  if (advisoryTranscriptSignals >= 2) {
    counterEvidence.push('Advisory transcript-pattern signals were recorded, but style-only transcript patterns did not change the review band');
  }
  if (!transcriptEligible && transcriptAnalyses.length) {
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
