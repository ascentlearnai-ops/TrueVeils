const transcriptHistory = [];
const audioHistory = [];

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
}

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function sentences(text) {
  return String(text || '')
    .split(/[.!?]+|\n+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function countMatches(text, patterns) {
  const lower = String(text || '').toLowerCase();
  return patterns.reduce((count, pattern) => count + (lower.match(pattern) || []).length, 0);
}

function ngramRepetition(tokens, size) {
  if (tokens.length < size * 3) return 0;
  const counts = new Map();
  for (let i = 0; i <= tokens.length - size; i++) {
    const key = tokens.slice(i, i + size).join(' ');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let repeated = 0;
  for (const count of counts.values()) {
    if (count > 1) repeated += count - 1;
  }
  return repeated / Math.max(1, tokens.length - size + 1);
}

function variance(values) {
  if (!values.length) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + Math.abs(value - avg), 0) / values.length;
}

function labelFor(score) {
  if (score >= 76) return 'high_ai_assistance_risk';
  if (score >= 52) return 'elevated_ai_assistance_risk';
  if (score >= 32) return 'uncertain';
  return 'likely_human';
}

function humanLabel(label) {
  return {
    high_ai_assistance_risk: 'High AI-assistance risk',
    elevated_ai_assistance_risk: 'Elevated AI-assistance risk',
    uncertain: 'Uncertain',
    likely_human: 'Likely human'
  }[label] || 'Uncertain';
}

function addSignal(list, condition, points, message) {
  if (condition) list.push({ points, message });
}

function analyzeTranscript(text, context = {}) {
  const tokens = words(text);
  const parts = sentences(text);
  const wordCount = tokens.length;
  if (wordCount < 4) {
    return {
      score: 0,
      label: 'uncertain',
      confidence: 'low',
      flags: [],
      reasoning: 'Transcript is too short for a meaningful local risk estimate.',
      aiSignals: [],
      humanSignals: []
    };
  }

  const fillerCount = countMatches(text, [
    /\bum+\b/g,
    /\buh+\b/g,
    /\ber+\b/g,
    /\blike\b/g,
    /\byou know\b/g,
    /\bi mean\b/g,
    /\bsort of\b/g,
    /\bkind of\b/g
  ]);
  const correctionCount = countMatches(text, [
    /\bactually\b/g,
    /\brather\b/g,
    /\blet me rephrase\b/g,
    /\bwhat i mean\b/g,
    /\bor rather\b/g,
    /\bi guess\b/g,
    /\bmaybe\b/g
  ]);
  const structuredCount = countMatches(text, [
    /\bfirst\b/g,
    /\bsecond\b/g,
    /\bthird\b/g,
    /\bfinally\b/g,
    /\bin conclusion\b/g,
    /\boverall\b/g,
    /\bto summarize\b/g,
    /\bthere are (?:three|several|a few) (?:key|main)\b/g
  ]);
  const cannedCount = countMatches(text, [
    /\bbest practices\b/g,
    /\bcross-functional\b/g,
    /\bstakeholders\b/g,
    /\bscalable\b/g,
    /\brobust\b/g,
    /\bseamless\b/g,
    /\bleverage\b/g,
    /\bdrive impact\b/g,
    /\balign(?:ed)? with business goals\b/g,
    /\bin today's (?:fast-paced|digital)\b/g,
    /\bit is important to\b/g
  ]);
  const concreteCount = countMatches(text, [
    /\bi\b/g,
    /\bmy\b/g,
    /\bwe\b/g,
    /\bour\b/g,
    /\b\d+(?:\.\d+)?\b/g,
    /\bapi\b/g,
    /\bdatabase\b/g,
    /\bdebug(?:ged|ging)?\b/g,
    /\bshipped\b/g,
    /\bdeployed\b/g,
    /\bcustomer\b/g,
    /\bteam\b/g,
    /\bproject\b/g
  ]);
  const hedgeCount = countMatches(text, [
    /\bi think\b/g,
    /\bi'd\b/g,
    /\bi would\b/g,
    /\bprobably\b/g,
    /\broughly\b/g,
    /\bfrom what i remember\b/g
  ]);

  const uniqueRatio = new Set(tokens).size / wordCount;
  const fillerDensity = fillerCount / wordCount;
  const concreteDensity = concreteCount / wordCount;
  const sentenceLengths = parts.map(part => words(part).length).filter(Boolean);
  const avgSentenceLength = sentenceLengths.length
    ? sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length
    : wordCount;
  const sentenceVariance = variance(sentenceLengths);
  const bigramRepeat = ngramRepetition(tokens, 2);
  const trigramRepeat = ngramRepetition(tokens, 3);
  const historyAvg = transcriptHistory.length
    ? transcriptHistory.reduce((sum, item) => sum + item.wordCount, 0) / transcriptHistory.length
    : 0;
  const lengthUniformity = transcriptHistory.length >= 3 && historyAvg > 0
    ? 1 - Math.min(1, Math.abs(wordCount - historyAvg) / historyAvg)
    : 0;

  let score = 22;
  const aiSignals = [];
  const humanSignals = [];

  addSignal(aiSignals, wordCount >= 35 && fillerDensity < 0.006, 16, 'Long answer with almost no spoken fillers');
  addSignal(aiSignals, correctionCount === 0 && wordCount >= 45, 10, 'No self-correction in a long spoken answer');
  addSignal(aiSignals, structuredCount >= 3, 15, 'Highly packaged answer structure');
  addSignal(aiSignals, cannedCount >= 2, 14, 'Generic interview or corporate phrasing');
  addSignal(aiSignals, uniqueRatio > 0.74 && wordCount >= 35, 7, 'Unusually polished vocabulary spread');
  addSignal(aiSignals, uniqueRatio < 0.46 && wordCount >= 45, 8, 'Repetitive vocabulary pattern');
  addSignal(aiSignals, bigramRepeat > 0.08 || trigramRepeat > 0.035, 9, 'Repeated phrase cadence');
  addSignal(aiSignals, sentenceVariance < 3.2 && sentenceLengths.length >= 4, 7, 'Sentence lengths are unusually even');
  addSignal(aiSignals, avgSentenceLength > 24 && fillerDensity < 0.012, 8, 'Long clean sentences in a spoken answer');
  addSignal(aiSignals, lengthUniformity > 0.82, 9, 'Response length is unusually uniform across the session');

  addSignal(humanSignals, fillerDensity > 0.025, -10, 'Natural fillers and pauses');
  addSignal(humanSignals, correctionCount >= 2, -9, 'Self-corrections and rephrasing');
  addSignal(humanSignals, concreteDensity > 0.09, -10, 'Concrete first-person or project detail');
  addSignal(humanSignals, hedgeCount >= 2, -5, 'Natural uncertainty markers');
  addSignal(humanSignals, sentenceVariance > 8 && sentenceLengths.length >= 3, -5, 'Uneven spoken sentence rhythm');

  if (context.durationMs && wordCount > 0) {
    const wordsPerMinute = wordCount / Math.max(context.durationMs / 60000, 0.1);
    addSignal(aiSignals, wordsPerMinute > 205 && wordCount >= 20, 9, 'Very fast delivery for the transcript length');
    addSignal(humanSignals, wordsPerMinute < 75 && wordCount >= 12, -5, 'Slow spoken delivery');
  }

  for (const signal of aiSignals) score += signal.points;
  for (const signal of humanSignals) score += signal.points;

  const finalScore = clamp(score);
  const label = labelFor(finalScore);
  const confidence = wordCount >= 55
    ? 'medium'
    : wordCount >= 22
      ? 'low-medium'
      : 'low';
  const topAiSignals = aiSignals.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 4);
  const topHumanSignals = humanSignals.sort((a, b) => Math.abs(a.points) - Math.abs(b.points)).slice(0, 3);
  const flags = topAiSignals.map(signal => signal.message);

  transcriptHistory.push({ wordCount, score: finalScore, uniqueRatio, fillerDensity });
  if (transcriptHistory.length > 12) transcriptHistory.shift();

  const signalText = topAiSignals[0]?.message || topHumanSignals[0]?.message || 'normal spoken variation';
  const counterText = topHumanSignals[0] ? ` Counter-signal: ${topHumanSignals[0].message.toLowerCase()}.` : '';

  return {
    score: finalScore,
    label,
    displayLabel: humanLabel(label),
    confidence,
    flags,
    aiSignals: topAiSignals.map(signal => signal.message),
    humanSignals: topHumanSignals.map(signal => signal.message),
    reasoning: `${humanLabel(label)}. Main signal: ${signalText.toLowerCase()}.${counterText}`
  };
}

function analyzeAudio(metadata = {}) {
  const durationMs = Number(metadata.durationMs || metadata.duration_ms || 0);
  const rms = Number(metadata.rms || 0);
  const peak = Number(metadata.peak || 0);
  const flags = [];
  let score = 8;

  if (durationMs > 0 && durationMs < 2500) flags.push('Short mic signal segment');
  if (rms < 0.006 || peak < 0.025) {
    flags.push('Very low speech energy');
    score += 6;
  } else if (rms > 0.05 && peak > 0.35) {
    score += 4;
  }

  audioHistory.push({ durationMs, rms, peak });
  if (audioHistory.length > 12) audioHistory.shift();

  return {
    score: clamp(score, 0, 35),
    label: labelFor(score),
    confidence: 'low',
    flags: flags.slice(0, 3),
    reasoning: flags[0]
      ? `Mic signal note: ${flags[0].toLowerCase()}.`
      : 'Mic signal is healthy; no strong audio-only risk signal.'
  };
}

function resetHistory() {
  transcriptHistory.length = 0;
  audioHistory.length = 0;
}

module.exports = { analyzeTranscript, analyzeAudio, resetHistory };
