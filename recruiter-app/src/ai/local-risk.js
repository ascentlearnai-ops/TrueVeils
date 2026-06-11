const model = require('./risk-model.json');
const { extractFeatures, clamp } = require('./feature-extractor');

const transcriptHistory = [];
const MODEL_VERSION = model.version;

const SIGNALS = {
  assistantStyleDensity: ['Assistant-style spoken framing', 'AI'],
  genericDensity: ['Generic polished interview phrasing', 'AI'],
  structuredDensity: ['Highly packaged response structure', 'AI'],
  hypotheticalDensity: ['Hypothetical framing without lived detail', 'AI'],
  lowSpecificity: ['Limited concrete project detail', 'AI'],
  lowDisfluency: ['Long response with little natural disfluency', 'AI'],
  lowBurstiness: ['Unusually uniform spoken rhythm', 'AI'],
  lexicalUniformity: ['Unusually uniform vocabulary pattern', 'AI'],
  phraseRepetition: ['Repeated phrase cadence', 'AI'],
  historySimilarity: ['Response closely resembles earlier phrasing', 'AI'],
  lengthUniformity: ['Response lengths are unusually uniform', 'AI'],
  directAiMention: ['AI tool mentioned in the response', 'AI'],
  naturalDisfluency: ['Natural fillers and pauses', 'HUMAN'],
  selfCorrection: ['Self-corrections and rephrasing', 'HUMAN'],
  concreteDetail: ['Concrete project or first-person detail', 'HUMAN'],
  spokenBurstiness: ['Varied spoken rhythm', 'HUMAN'],
  conversationalFlow: ['Conversational connective language', 'HUMAN']
};

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function normalizedFeatures(features) {
  return {
    assistantStyleDensity: clamp(features.assistantStyleDensity * 24),
    genericDensity: clamp(features.genericDensity * 18),
    structuredDensity: clamp(features.structuredDensity * 18),
    hypotheticalDensity: clamp(features.hypotheticalDensity * 15),
    lowSpecificity: clamp((0.055 - features.specificityDensity) / 0.055),
    lowDisfluency: clamp((0.018 - features.fillerDensity - features.correctionDensity) / 0.018),
    lowBurstiness: features.sentenceCount >= 3 ? clamp((0.3 - features.sentenceCv) / 0.3) : 0,
    lexicalUniformity: clamp((features.uniqueRatio - 0.68) / 0.22) * clamp((features.lexicalEntropy - 0.82) / 0.18),
    phraseRepetition: clamp(features.phraseRepetition / 0.13),
    historySimilarity: clamp((features.historySimilarity - 0.55) / 0.35),
    lengthUniformity: clamp((features.lengthUniformity - 0.72) / 0.28),
    directAiMention: clamp(features.directAiDensity * 10),
    naturalDisfluency: clamp((features.fillerDensity - 0.012) / 0.05),
    selfCorrection: clamp(features.correctionDensity / 0.045),
    concreteDetail: clamp(features.specificityDensity / 0.12),
    spokenBurstiness: features.sentenceCount >= 3 ? clamp((features.sentenceCv - 0.32) / 0.7) : 0,
    conversationalFlow: clamp(features.discourseDensity / 0.16)
  };
}

function labelFor(probability) {
  if (probability >= model.thresholds.high) return 'high_ai_assistance_risk';
  if (probability >= model.thresholds.elevated) return 'elevated_ai_assistance_risk';
  return 'low_ai_assistance_risk';
}

function displayLabel(label) {
  return {
    high_ai_assistance_risk: 'High AI-assistance risk',
    elevated_ai_assistance_risk: 'Elevated AI-assistance risk',
    low_ai_assistance_risk: 'Low AI-assistance risk',
    unscorable: 'Insufficient evidence'
  }[label] || 'Insufficient evidence';
}

function unscorable(reason, features) {
  return {
    score: null,
    probability: null,
    label: 'unscorable',
    displayLabel: displayLabel('unscorable'),
    confidence: 0,
    confidenceLabel: 'insufficient',
    flags: [],
    reasoning: reason,
    aiSignals: [],
    humanSignals: [],
    evidence: [],
    counterSignal: null,
    features,
    scorable: false,
    scoreWeight: 0,
    modelVersion: MODEL_VERSION,
    unscorableReason: reason
  };
}

function analyzeTranscript(text, context = {}) {
  const features = extractFeatures(text, context, transcriptHistory);
  if (features.wordCount < model.minimums.words) {
    return unscorable(`Needs at least ${model.minimums.words} words before estimating AI-assistance risk.`, features);
  }
  if (features.transcriptConfidence < model.minimums.transcriptConfidence) {
    return unscorable('Transcript confidence is too low for a reliable estimate.', features);
  }
  if (features.quality < model.minimums.quality) {
    return unscorable('Transcript quality is too low for a reliable estimate.', features);
  }

  const normalized = normalizedFeatures(features);
  const contributions = Object.entries(model.weights).map(([key, weight]) => ({
    key,
    value: normalized[key] || 0,
    contribution: (normalized[key] || 0) * weight,
    message: SIGNALS[key]?.[0] || key,
    kind: SIGNALS[key]?.[1] || (weight >= 0 ? 'AI' : 'HUMAN')
  }));
  const logit = contributions.reduce((sum, item) => sum + item.contribution, model.intercept);
  const probability = clamp(sigmoid(logit));
  const score = Math.round(probability * 100);
  const label = labelFor(probability);
  const evidence = contributions.filter(item => item.kind === 'AI' && item.contribution > 0.12)
    .sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const counters = contributions.filter(item => item.kind === 'HUMAN' && item.contribution < -0.12)
    .sort((a, b) => a.contribution - b.contribution);
  const confidence = clamp(
    0.25
    + Math.min(features.wordCount, 100) / 180
    + features.transcriptConfidence * 0.24
    + (features.sentenceCount >= 2 ? 0.08 : 0)
  );
  const confidenceLabel = confidence >= 0.78 ? 'high' : confidence >= 0.58 ? 'medium' : 'low';
  const counterSignal = counters[0]?.message || null;
  const aiSignals = evidence.map(item => item.message);
  const humanSignals = counters.slice(0, 3).map(item => item.message);
  const reasoning = evidence.length
    ? `${displayLabel(label)}. Strongest evidence: ${aiSignals.join('; ')}.${counterSignal ? ` Counter-signal: ${counterSignal.toLowerCase()}.` : ''}`
    : `${displayLabel(label)}. No strong AI-style speech pattern was found.${counterSignal ? ` Strongest counter-signal: ${counterSignal.toLowerCase()}.` : ''}`;

  transcriptHistory.push({ tokens: features.tokens, wordCount: features.wordCount, score, modelVersion: MODEL_VERSION });
  if (transcriptHistory.length > 20) transcriptHistory.shift();

  return {
    score,
    probability,
    label,
    displayLabel: displayLabel(label),
    confidence,
    confidenceLabel,
    flags: aiSignals,
    reasoning,
    aiSignals,
    humanSignals,
    evidence: evidence.map(item => ({ signal: item.key, label: item.message, contribution: Number(item.contribution.toFixed(3)) })),
    counterSignal,
    features,
    scorable: true,
    scoreWeight: confidence,
    modelVersion: MODEL_VERSION,
    unscorableReason: null
  };
}

function analyzeAudio(metadata = {}) {
  const rms = Number(metadata.rms || 0);
  const peak = Number(metadata.peak || 0);
  const healthy = rms >= 0.006 && peak >= 0.025;
  return {
    score: null,
    probability: null,
    label: 'unscorable',
    displayLabel: 'Audio health only',
    confidence: 0,
    confidenceLabel: 'insufficient',
    flags: healthy ? [] : ['Very low speech energy'],
    reasoning: healthy ? 'Microphone signal is healthy.' : 'Microphone energy is too low for dependable transcription.',
    scorable: false,
    scoreWeight: 0,
    modelVersion: MODEL_VERSION
  };
}

function resetHistory() {
  transcriptHistory.length = 0;
}

module.exports = { analyzeTranscript, analyzeAudio, resetHistory, MODEL_VERSION };
