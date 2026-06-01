const transcriptHistory = [];
const audioHistory = [];

const FILLERS = [
  /\bum+\b/g, /\buh+\b/g, /\ber+\b/g, /\bah+\b/g, /\bhmm+\b/g,
  /\blike\b/g, /\byou know\b/g, /\bi mean\b/g, /\bsort of\b/g, /\bkind of\b/g
];

const SELF_CORRECTIONS = [
  /\bactually\b/g, /\brather\b/g, /\blet me rephrase\b/g, /\bwhat i mean\b/g,
  /\bor rather\b/g, /\bi guess\b/g, /\bmaybe\b/g, /\bwait\b/g, /\bno\b/g
];

const AI_STRUCTURE = [
  /\bfirst(?:ly)?\b/g, /\bsecond(?:ly)?\b/g, /\bthird(?:ly)?\b/g, /\bfinally\b/g,
  /\bin conclusion\b/g, /\boverall\b/g, /\bto summarize\b/g, /\bin summary\b/g,
  /\bthere are (?:three|several|a few) (?:key|main|important)\b/g,
  /\bthe key (?:is|thing is|point is)\b/g
];

const GENERIC_PHRASES = [
  /\bbest practices\b/g, /\bcross-functional\b/g, /\bstakeholders\b/g,
  /\bscalable\b/g, /\brobust\b/g, /\bseamless\b/g, /\bleverage\b/g,
  /\bdrive impact\b/g, /\balign(?:ed)? with business goals\b/g,
  /\bin today's (?:fast-paced|digital)\b/g, /\bit is important to\b/g,
  /\bultimately\b/g, /\bfrom a high level\b/g, /\bholistic\b/g,
  /\boptimi[sz]e\b/g, /\bstreamline\b/g, /\bensure that\b/g
];

const SPECIFICITY = [
  /\b\d+(?:\.\d+)?\b/g, /\bapi\b/g, /\bdatabase\b/g, /\bsql\b/g, /\bbug\b/g,
  /\bdebug(?:ged|ging)?\b/g, /\bshipped\b/g, /\bdeployed\b/g,
  /\bcustomer\b/g, /\bteam\b/g, /\bproject\b/g, /\bdeadline\b/g,
  /\bproduction\b/g, /\bincident\b/g, /\btest(?:ed|ing)?\b/g
];

const HEDGES = [
  /\bi think\b/g, /\bi'd\b/g, /\bprobably\b/g, /\broughly\b/g,
  /\bfrom what i remember\b/g, /\bif i recall\b/g, /\bnot sure\b/g
];

const HYPOTHETICALS = [
  /\bi would\b/g, /\bi'd start\b/g, /\bi'd make sure\b/g, /\btypically\b/g,
  /\bgenerally\b/g, /\bone approach would be\b/g
];

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

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function mad(values) {
  if (!values.length) return 0;
  const avg = mean(values);
  return mean(values.map(value => Math.abs(value - avg)));
}

function stddev(values) {
  if (!values.length) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map(value => (value - avg) ** 2)));
}

function lexicalEntropy(tokens) {
  if (!tokens.length) return 0;
  const counts = new Map();
  tokens.forEach(token => counts.set(token, (counts.get(token) || 0) + 1));
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / tokens.length;
    entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(Math.max(2, counts.size));
}

function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap++;
  return overlap / (left.size + right.size - overlap);
}

function labelFor(score) {
  if (score >= 76) return 'high_ai_assistance_risk';
  if (score >= 54) return 'elevated_ai_assistance_risk';
  if (score >= 34) return 'uncertain';
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

function addSignal(list, condition, points, message, value) {
  if (condition) list.push({ points, message, value });
}

function rollingSimilarity(tokens) {
  if (!transcriptHistory.length) return 0;
  const latest = transcriptHistory.slice(-5);
  return Math.max(...latest.map(item => jaccard(tokens, item.tokens || [])));
}

function analyzeTranscript(text, context = {}) {
  const tokens = words(text);
  const parts = sentences(text);
  const wordCount = tokens.length;
  if (wordCount < 8) {
    return {
      score: 0,
      label: 'uncertain',
      displayLabel: humanLabel('uncertain'),
      confidence: 'low',
      flags: [],
      reasoning: 'Transcript is too short for a meaningful AI-assistance estimate.',
      aiSignals: [],
      humanSignals: []
    };
  }

  const fillerCount = countMatches(text, FILLERS);
  const correctionCount = countMatches(text, SELF_CORRECTIONS);
  const structuredCount = countMatches(text, AI_STRUCTURE);
  const cannedCount = countMatches(text, GENERIC_PHRASES);
  const concreteCount = countMatches(text, SPECIFICITY);
  const hedgeCount = countMatches(text, HEDGES);
  const hypotheticalCount = countMatches(text, HYPOTHETICALS);
  const uniqueRatio = new Set(tokens).size / wordCount;
  const fillerDensity = fillerCount / wordCount;
  const correctionDensity = correctionCount / wordCount;
  const concreteDensity = concreteCount / wordCount;
  const sentenceLengths = parts.map(part => words(part).length).filter(Boolean);
  const avgSentenceLength = sentenceLengths.length ? mean(sentenceLengths) : wordCount;
  const sentenceMad = mad(sentenceLengths);
  const sentenceStdDev = stddev(sentenceLengths);
  const burstiness = avgSentenceLength ? sentenceStdDev / avgSentenceLength : 0;
  const entropy = lexicalEntropy(tokens);
  const bigramRepeat = ngramRepetition(tokens, 2);
  const trigramRepeat = ngramRepetition(tokens, 3);
  const similarity = rollingSimilarity(tokens);
  const historyAvg = transcriptHistory.length ? mean(transcriptHistory.map(item => item.wordCount)) : 0;
  const lengthUniformity = transcriptHistory.length >= 3 && historyAvg > 0
    ? 1 - Math.min(1, Math.abs(wordCount - historyAvg) / historyAvg)
    : 0;

  let score = 24;
  const aiSignals = [];
  const humanSignals = [];

  addSignal(aiSignals, wordCount >= 35 && fillerDensity < 0.006, 16, 'Long answer with almost no spoken fillers', fillerDensity);
  addSignal(aiSignals, correctionCount === 0 && wordCount >= 45, 10, 'No self-correction in a long spoken answer', correctionCount);
  addSignal(aiSignals, structuredCount >= 3, 15, 'Highly packaged answer structure', structuredCount);
  addSignal(aiSignals, cannedCount >= 2, 15, 'Generic interview or corporate phrasing', cannedCount);
  addSignal(aiSignals, hypotheticalCount >= 2 && concreteDensity < 0.08, 12, 'Hypothetical answer with little lived detail', hypotheticalCount);
  addSignal(aiSignals, wordCount >= 28 && concreteDensity < 0.035, 10, 'Low concrete project detail for the answer length', concreteDensity);
  addSignal(aiSignals, uniqueRatio > 0.78 && wordCount >= 35, 8, 'Unusually polished vocabulary spread', uniqueRatio);
  addSignal(aiSignals, uniqueRatio < 0.42 && wordCount >= 45, 8, 'Repetitive vocabulary pattern', uniqueRatio);
  addSignal(aiSignals, entropy > 0.92 && fillerDensity < 0.01 && wordCount >= 45, 8, 'High lexical cleanliness without natural disfluency', entropy);
  addSignal(aiSignals, bigramRepeat > 0.08 || trigramRepeat > 0.035, 9, 'Repeated phrase cadence', Math.max(bigramRepeat, trigramRepeat));
  addSignal(aiSignals, sentenceMad < 3.1 && sentenceLengths.length >= 4, 8, 'Sentence lengths are unusually even', sentenceMad);
  addSignal(aiSignals, burstiness < 0.22 && sentenceLengths.length >= 4, 7, 'Low burstiness across sentences', burstiness);
  addSignal(aiSignals, avgSentenceLength > 24 && fillerDensity < 0.012, 8, 'Long clean sentences in a spoken answer', avgSentenceLength);
  addSignal(aiSignals, lengthUniformity > 0.82, 10, 'Response length is unusually uniform across the session', lengthUniformity);
  addSignal(aiSignals, similarity > 0.68 && wordCount >= 25, 9, 'Answer resembles earlier phrasing too closely', similarity);

  addSignal(humanSignals, fillerDensity > 0.025, -12, 'Natural fillers and pauses', fillerDensity);
  addSignal(humanSignals, correctionDensity > 0.018 || correctionCount >= 2, -10, 'Self-corrections and rephrasing', correctionCount);
  addSignal(humanSignals, concreteDensity > 0.09, -12, 'Concrete first-person or project detail', concreteDensity);
  addSignal(humanSignals, hedgeCount >= 2, -6, 'Natural uncertainty markers', hedgeCount);
  addSignal(humanSignals, sentenceMad > 8 && sentenceLengths.length >= 3, -6, 'Uneven spoken sentence rhythm', sentenceMad);
  addSignal(humanSignals, burstiness > 0.48 && sentenceLengths.length >= 3, -5, 'High spoken burstiness', burstiness);

  if (context.durationMs && wordCount > 0) {
    const wordsPerMinute = wordCount / Math.max(context.durationMs / 60000, 0.1);
    addSignal(aiSignals, wordsPerMinute > 205 && wordCount >= 20, 9, 'Very fast delivery for the transcript length', wordsPerMinute);
    addSignal(humanSignals, wordsPerMinute >= 85 && wordsPerMinute <= 175 && wordCount >= 18, -4, 'Natural speech rate', wordsPerMinute);
    addSignal(humanSignals, wordsPerMinute < 75 && wordCount >= 12, -5, 'Slow spoken delivery', wordsPerMinute);
  }

  for (const signal of aiSignals) score += signal.points;
  for (const signal of humanSignals) score += signal.points;

  const finalScore = clamp(score);
  const label = labelFor(finalScore);
  const confidence = wordCount >= 80
    ? 'medium-high'
    : wordCount >= 45
      ? 'medium'
      : wordCount >= 20
        ? 'low-medium'
        : 'low';
  const topAiSignals = aiSignals.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 5);
  const topHumanSignals = humanSignals.sort((a, b) => Math.abs(a.points) - Math.abs(b.points)).slice(0, 4);
  const flags = topAiSignals.map(signal => signal.message);

  transcriptHistory.push({
    tokens,
    wordCount,
    score: finalScore,
    uniqueRatio,
    fillerDensity,
    concreteDensity
  });
  if (transcriptHistory.length > 16) transcriptHistory.shift();

  const signalText = topAiSignals[0]?.message || 'no strong AI-style speech fingerprint';
  const counterText = topHumanSignals[0] ? ` Counter-signal: ${topHumanSignals[0].message.toLowerCase()}.` : '';
  const metricText = `Words: ${wordCount}; fillers: ${(fillerDensity * 100).toFixed(1)}%; specificity: ${(concreteDensity * 100).toFixed(1)}%; burstiness: ${burstiness.toFixed(2)}.`;

  return {
    score: finalScore,
    label,
    displayLabel: humanLabel(label),
    confidence,
    flags,
    aiSignals: topAiSignals.map(signal => signal.message),
    humanSignals: topHumanSignals.map(signal => signal.message),
    reasoning: `${humanLabel(label)}. Main signal: ${signalText.toLowerCase()}. ${metricText}${counterText}`
  };
}

function analyzeAudio(metadata = {}) {
  const durationMs = Number(metadata.durationMs || metadata.duration_ms || 0);
  const rms = Number(metadata.rms || 0);
  const peak = Number(metadata.peak || 0);
  const flags = [];
  let score = 6;

  if (durationMs > 0 && durationMs < 8000) {
    flags.push('Short mic signal segment');
    score += 5;
  }
  if (durationMs >= 10000 && durationMs <= 15000) {
    score -= 2;
  }
  if (rms < 0.006 || peak < 0.025) {
    flags.push('Very low speech energy');
    score += 8;
  } else if (rms > 0.05 && peak > 0.35) {
    score += 4;
  }

  audioHistory.push({ durationMs, rms, peak });
  if (audioHistory.length > 16) audioHistory.shift();

  const rmsValues = audioHistory.map(item => item.rms).filter(value => value > 0);
  if (rmsValues.length >= 5 && stddev(rmsValues) < 0.002) {
    flags.push('Mic energy is unusually uniform');
    score += 5;
  }

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
