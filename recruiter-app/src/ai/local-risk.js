const model = require('./risk-model.json');
const { extractFeatures, clamp } = require('./feature-extractor');

const transcriptHistory = [];
const MODEL_VERSION = model.version;

const SIGNALS = {
  assistantStyleDensity: ['Assistant-style spoken framing', 'AI'],
  copiedArtifactDensity: ['Copied assistant or prompt artifact', 'AI'],
  markdownArtifactDensity: ['Markdown or code-block artifact', 'AI'],
  promptResidueDensity: ['Prompt or answer-label residue', 'AI'],
  aiArtifactCluster: ['Cluster of assistant or prompt artifacts', 'AI'],
  genericDensity: ['Generic polished interview phrasing', 'AI'],
  abstractGenericity: ['Abstract claims without enough concrete grounding', 'AI'],
  unsupportedAbstraction: ['Abstract confident claims without implementation detail', 'AI'],
  structuredDensity: ['Highly packaged response structure', 'AI'],
  polishedScaffold: ['Polished list-like answer scaffold', 'AI'],
  templateClosureDensity: ['Template-like interview conclusion', 'AI'],
  hypotheticalDensity: ['Hypothetical framing without lived detail', 'AI'],
  lowSpecificity: ['Limited concrete project detail', 'AI'],
  lowDisfluency: ['Long response with little natural disfluency', 'AI'],
  lowBurstiness: ['Unusually uniform spoken rhythm', 'AI'],
  lexicalUniformity: ['Unusually uniform vocabulary pattern', 'AI'],
  phraseRepetition: ['Repeated phrase cadence', 'AI'],
  historySimilarity: ['Response closely resembles earlier phrasing', 'AI'],
  styleDrift: ['Abrupt style shift from earlier answers', 'AI'],
  lengthUniformity: ['Response lengths are unusually uniform', 'AI'],
  directAiMention: ['AI tool mentioned in the response', 'AI'],
  directAiUse: ['Direct AI-tool use context', 'AI'],
  pasteLikeTempo: ['Unusually fast long-form response cadence', 'AI'],
  nearZeroLatency: ['Very short delay before complex answer', 'AI'],
  postAiEventProximity: ['Response followed a restricted AI-tool event', 'AI'],
  behavioralTranscriptFusion: ['Restricted AI-tool event aligned with transcript pattern signals', 'AI'],
  disfluencyCollapse: ['Disfluency dropped sharply against the candidate’s own baseline', 'AI'],
  suspiciouslyInstantAnswer: ['Long complete answer started with almost no thinking pause', 'AI'],
  naturalDisfluency: ['Natural fillers and pauses', 'HUMAN'],
  selfCorrection: ['Self-corrections and rephrasing', 'HUMAN'],
  concreteDetail: ['Concrete project or first-person detail', 'HUMAN'],
  experienceAnchor: ['First-person incident or project anchor', 'HUMAN'],
  firstPersonOwnership: ['First-person ownership of work', 'HUMAN'],
  technicalVocabulary: ['Role-specific technical vocabulary', 'HUMAN'],
  namedTechnology: ['Specific tools or technologies named', 'HUMAN'],
  situatedTechnicalDepth: ['Concrete implementation mechanics', 'HUMAN'],
  timelineDetail: ['Concrete timeline or incident context', 'HUMAN'],
  qualifiedReasoning: ['Qualified reasoning tied to concrete detail', 'HUMAN'],
  spokenBurstiness: ['Varied spoken rhythm', 'HUMAN'],
  conversationalFlow: ['Conversational connective language', 'HUMAN'],
  negatedAiMention: ['AI-tool mention was rejected or negated', 'HUMAN']
};

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function normalizedFeatures(features) {
  const enoughSpeechForDisfluency = features.wordCount >= 45 || features.sentenceCount >= 3;
  const lowLexicalDiversity = clamp((0.52 - features.uniqueRatio) / 0.24);
  const lowLexicalEntropy = clamp((0.76 - features.lexicalEntropy) / 0.28);
  const groundedDetail = features.specificityDensity
    + features.ownershipDensity
    + features.technicalVocabularyDensity
    + features.namedTechnologyDensity
    + features.timelineDensity
    + features.mechanicsDensity;
  const longEnoughForTempo = features.wordCount >= 35;
  const normalized = {
    assistantStyleDensity: clamp(features.assistantStyleDensity * 24),
    copiedArtifactDensity: clamp(features.copiedArtifactDensity * 28),
    markdownArtifactDensity: clamp(features.markdownArtifactDensity * 24),
    promptResidueDensity: clamp(features.promptResidueDensity * 20),
    genericDensity: clamp(features.genericDensity * 18),
    abstractGenericity: clamp((features.abstractDensity + features.genericDensity) * 12) * clamp((0.075 - groundedDetail) / 0.075),
    unsupportedAbstraction: clamp((features.abstractDensity + features.genericDensity + features.certaintyDensity) * 10) * clamp((0.085 - groundedDetail) / 0.085),
    structuredDensity: clamp(features.structuredDensity * 18),
    templateClosureDensity: clamp(features.templateClosureDensity * 16),
    hypotheticalDensity: clamp(features.hypotheticalDensity * 15),
    lowSpecificity: clamp((0.055 - features.specificityDensity) / 0.055),
    lowDisfluency: enoughSpeechForDisfluency
      ? clamp((0.016 - features.fillerDensity - features.correctionDensity) / 0.016)
      : 0,
    lowBurstiness: features.sentenceCount >= 3 ? clamp((0.3 - features.sentenceCv) / 0.3) : 0,
    lexicalUniformity: lowLexicalDiversity * 0.65 + lowLexicalEntropy * 0.35,
    phraseRepetition: clamp(features.phraseRepetition / 0.13),
    historySimilarity: clamp((features.historySimilarity - 0.55) / 0.35),
    styleDrift: features.wordCount >= 24 ? clamp((features.styleDrift - 0.46) / 0.28) : 0,
    lengthUniformity: clamp((features.lengthUniformity - 0.72) / 0.28),
    directAiMention: clamp((features.directAiMentionDensity ?? features.directAiDensity) * 5),
    directAiUse: clamp(features.directAiUseDensity * 18),
    pasteLikeTempo: longEnoughForTempo && features.wordsPerMinute ? clamp((features.wordsPerMinute - 210) / 170) : 0,
    nearZeroLatency: longEnoughForTempo && features.responseLatencyMs > 0 ? clamp((18000 - features.responseLatencyMs) / 18000) : 0,
    postAiEventProximity: clamp(features.postAiEventProximity) * clamp(features.behavioralAiEventCount),
    disfluencyCollapse: features.disfluencyBaselineCount >= 3 && enoughSpeechForDisfluency
      ? clamp((features.baselineDisfluency - (features.fillerDensity + features.correctionDensity) - 0.01) / 0.02)
      : 0,
    suspiciouslyInstantAnswer: longEnoughForTempo && Number.isFinite(features.priorSilenceGapMs) && features.priorSilenceGapMs >= 0
      ? clamp((900 - features.priorSilenceGapMs) / 900)
      : 0,
    naturalDisfluency: clamp((features.fillerDensity - 0.012) / 0.05),
    selfCorrection: clamp(features.correctionDensity / 0.045),
    concreteDetail: clamp(features.specificityDensity / 0.12),
    experienceAnchor: clamp((features.ownershipDensity + features.timelineDensity + features.mechanicsDensity) / 0.11),
    firstPersonOwnership: clamp(features.ownershipDensity / 0.08),
    technicalVocabulary: clamp(features.technicalVocabularyDensity / 0.06),
    namedTechnology: clamp(features.namedTechnologyDensity / 0.055),
    situatedTechnicalDepth: clamp((features.specificityDensity + features.namedTechnologyDensity + features.mechanicsDensity + features.technicalVocabularyDensity) / 0.16),
    timelineDetail: clamp(features.timelineDensity / 0.04),
    qualifiedReasoning: clamp((features.uncertaintyDensity + features.correctionDensity + features.discourseDensity) / 0.13)
      * clamp((features.specificityDensity + features.ownershipDensity + features.mechanicsDensity) / 0.12),
    spokenBurstiness: features.sentenceCount >= 3 ? clamp((features.sentenceCv - 0.32) / 0.7) : 0,
    conversationalFlow: clamp(features.discourseDensity / 0.16),
    negatedAiMention: clamp(features.negatedAiMentionDensity * 18)
  };
  const connectorPolish = clamp(features.polishedConnectorDensity * 22);
  const scaffoldSignals = normalized.structuredDensity * 0.35
    + normalized.genericDensity * 0.28
    + normalized.templateClosureDensity * 0.18
    + normalized.assistantStyleDensity * 0.14
    + connectorPolish * 0.2;
  const thinGrounding = clamp((0.095 - groundedDetail) / 0.095);
  const tooCleanSpeech = (normalized.lowDisfluency + normalized.lowBurstiness + normalized.lexicalUniformity) / 3;
  normalized.polishedScaffold = clamp(scaffoldSignals * 0.7 + tooCleanSpeech * thinGrounding * 0.55);
  normalized.aiArtifactCluster = clamp(Math.max(
    normalized.copiedArtifactDensity,
    normalized.markdownArtifactDensity,
    normalized.promptResidueDensity,
    normalized.directAiUse
  ) + normalized.assistantStyleDensity * 0.25);
  normalized.behavioralTranscriptFusion = normalized.postAiEventProximity * Math.max(
    normalized.aiArtifactCluster,
    normalized.polishedScaffold,
    normalized.assistantStyleDensity
  );
  return normalized;
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

function rememberTranscript(features, score = null) {
  if (!features || features.wordCount < 8 || features.transcriptConfidence < model.minimums.transcriptConfidence || features.quality < model.minimums.quality) return;
  transcriptHistory.push({
    tokens: features.tokens,
    wordCount: features.wordCount,
    fillerDensity: features.fillerDensity,
    correctionDensity: features.correctionDensity,
    score,
    modelVersion: MODEL_VERSION
  });
  if (transcriptHistory.length > 20) transcriptHistory.shift();
}

function analyzeTranscript(text, context = {}) {
  const features = extractFeatures(text, context, transcriptHistory);
  if (features.wordCount < model.minimums.words) {
    rememberTranscript(features);
    return unscorable(`Needs at least ${model.minimums.words} words before estimating AI-assistance risk.`, features);
  }
  if (features.sentenceCount < 2 && features.wordCount < 24) {
    rememberTranscript(features);
    return unscorable('Needs at least two sentences or 24 reliable words before estimating AI-assistance risk.', features);
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
  const rawScore = Math.round(probability * 100);
  const directArtifactStrength = Math.max(
    normalized.copiedArtifactDensity,
    normalized.markdownArtifactDensity,
    normalized.promptResidueDensity,
    normalized.directAiUse
  );
  const hasHighPrecisionTranscriptEvidence = directArtifactStrength > 0.12;
  const hasBehavioralCorrelation = normalized.postAiEventProximity > 0.3 || normalized.behavioralTranscriptFusion > 0.18;
  const hasStrongGrounding = normalized.concreteDetail > 0.45
    || normalized.firstPersonOwnership > 0.42
    || normalized.experienceAnchor > 0.42
    || normalized.technicalVocabulary > 0.35
    || normalized.situatedTechnicalDepth > 0.35
    || (normalized.namedTechnology > 0.35 && normalized.timelineDetail > 0.2);
  let score = rawScore;
  if (!hasHighPrecisionTranscriptEvidence && !hasBehavioralCorrelation) {
    score = Math.min(score, 68);
  }
  if (hasBehavioralCorrelation && rawScore >= 72 && !hasHighPrecisionTranscriptEvidence) {
    score = Math.min(Math.max(score, 72), 84);
  }
  if (hasStrongGrounding && !hasHighPrecisionTranscriptEvidence && !hasBehavioralCorrelation) {
    score = Math.min(score, 58);
  }
  const cappedProbability = score / 100;
  const label = labelFor(cappedProbability);
  const evidence = contributions.filter(item => item.kind === 'AI' && item.contribution > 0.18)
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
  const topContributors = [...contributions]
    .filter(item => Math.abs(item.contribution) > 0.05)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3)
    .map(item => ({
      signal: item.key,
      label: item.message,
      kind: item.kind,
      contribution: Number(item.contribution.toFixed(3))
    }));
  const aiSignals = evidence.map(item => item.message);
  const humanSignals = counters.slice(0, 6).map(item => item.message);
  const reasoning = evidence.length
    ? `${displayLabel(label)}. Main signals: ${aiSignals.join('; ')}.${humanSignals.length ? ` Human counter-signals: ${humanSignals.join('; ').toLowerCase()}.` : ''}`
    : `${displayLabel(label)}. No strong AI-style speech pattern was found.${humanSignals.length ? ` Human counter-signals: ${humanSignals.join('; ').toLowerCase()}.` : ''}`;

  rememberTranscript(features, score);

  return {
    score,
    probability: cappedProbability,
    rawProbability: probability,
    rawScore,
    label,
    displayLabel: displayLabel(label),
    confidence,
    confidenceLabel,
    flags: aiSignals,
    reasoning,
    aiSignals,
    humanSignals,
    evidence: evidence.map(item => ({ signal: item.key, label: item.message, contribution: Number(item.contribution.toFixed(3)) })),
    topContributors,
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
