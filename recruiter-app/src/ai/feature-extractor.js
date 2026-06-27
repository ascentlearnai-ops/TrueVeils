const PATTERNS = {
  fillers: [/\bum+\b/g, /\buh+\b/g, /\ber+\b/g, /\bah+\b/g, /\bhmm+\b/g, /\byou know\b/g, /\bi mean\b/g, /\bsort of\b/g, /\bkind of\b/g],
  corrections: [/\bactually\b/g, /\blet me rephrase\b/g, /\bwhat i mean\b/g, /\bor rather\b/g, /\bi guess\b/g, /\bwait\b/g, /\bno,?\s+i\b/g],
  structured: [/\bfirst(?:ly)?\b/g, /\bsecond(?:ly)?\b/g, /\bthird(?:ly)?\b/g, /\bfinally\b/g, /\bin conclusion\b/g, /\bto summarize\b/g, /\bthere are (?:three|several|a few) (?:key|main|important)\b/g],
  generic: [/\bbest practices\b/g, /\bcross-functional\b/g, /\bstakeholders\b/g, /\bscalable\b/g, /\brobust\b/g, /\bseamless\b/g, /\bleverage\b/g, /\bdrive impact\b/g, /\bfrom a high level\b/g, /\bholistic\b/g, /\bstreamline\b/g, /\bensure that\b/g],
  abstract: [/\balignment\b/g, /\bcollaboration\b/g, /\befficiency\b/g, /\bmaintainability\b/g, /\bimpact\b/g, /\bdelivery\b/g, /\bstrategy\b/g, /\bobjectives?\b/g, /\bconstraints?\b/g, /\brequirements?\b/g],
  ownership: [/\bi (?:built|debugged|shipped|owned|wrote|fixed|tested|deployed|led|worked|designed|implemented)\b/g, /\bmy (?:team|project|manager|customer|class|role|previous job)\b/g, /\bwe (?:built|debugged|shipped|owned|wrote|fixed|tested|deployed|chose|moved)\b/g],
  specificity: [/\b\d+(?:\.\d+)?%?\b/g, /\bapi\b/g, /\bdatabase\b/g, /\bsql\b/g, /\bbug\b/g, /\bdebug(?:ged|ging)?\b/g, /\bshipped\b/g, /\bdeployed\b/g, /\bproduction\b/g, /\bincident\b/g, /\btest(?:ed|ing)?\b/g, /\bmy (?:team|project|manager|customer|class)\b/g],
  hypotheticals: [/\bi would\b/g, /\bi'd start\b/g, /\bi'd make sure\b/g, /\btypically\b/g, /\bgenerally\b/g, /\bone approach would be\b/g],
  assistantStyle: [/\bi can help\b/g, /\bi'?d be happy to\b/g, /\bhere(?:'s| is) how\b/g, /\blet'?s break (?:it|this) down\b/g, /\bdoes that make sense\b/g],
  copiedArtifact: [/\bas an ai language model\b/g, /\bi (?:do not|don't) have personal experience\b/g, /\bi can't access (?:your|the) (?:resume|browser|files)\b/g, /\bregenerate response\b/g, /\buser:\s*/g, /\bassistant:\s*/g, /```/g, /\bhere(?:'s| is) a polished (?:answer|response)\b/g],
  directAi: [/\bchatgpt\b/g, /\bclaude\b/g, /\bgemini\b/g, /\bcopilot\b/g, /\bperplexity\b/g, /\bai tools?\b/g, /\bllm\b/g],
  directAiUse: [
    /\b(?:used|using|asked|prompted|copied|pasted|generated|opened|checked|looked up|got help from)\s+(?:chatgpt|claude|gemini|copilot|perplexity|an?\s+ai|an?\s+llm)\b/g,
    /\b(?:chatgpt|claude|gemini|copilot|perplexity)\s+(?:said|suggested|gave|generated|wrote|answered)\b/g,
    /\b(?:i|we)\s+(?:put|fed|typed)\s+(?:it|the question|the prompt|my answer)\s+(?:into|in)\s+(?:chatgpt|claude|gemini|copilot|perplexity)\b/g
  ],
  negatedAi: [
    /\b(?:did not|didn't|never|without|avoided|rejected|blocked|disabled|closed)\s+(?:using\s+)?(?:chatgpt|claude|gemini|copilot|perplexity|an?\s+ai|an?\s+llm)\b/g,
    /\b(?:chatgpt|claude|gemini|copilot|perplexity)\s+(?:was|is)\s+(?:blocked|disabled|closed|not allowed|rejected)\b/g,
    /\b(?:chatgpt|claude|gemini|copilot|perplexity)\b.{0,90}\b(?:rejected|blocked|disabled|closed|not allowed)\s+(?:it|that|the tool)?\b/g
  ],
  discourse: [/\bso\b/g, /\band\b/g, /\bbut\b/g, /\bbecause\b/g, /\bthen\b/g]
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stddev(values) {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function splitSentences(text) {
  return String(text || '').split(/[.!?]+|\n+/).map(value => value.trim()).filter(Boolean);
}

function countMatches(text, patterns) {
  const lower = String(text || '').toLowerCase();
  return patterns.reduce((count, pattern) => count + (lower.match(pattern) || []).length, 0);
}

function ngramRepetition(tokens, size) {
  if (tokens.length < size * 3) return 0;
  const counts = new Map();
  for (let index = 0; index <= tokens.length - size; index++) {
    const key = tokens.slice(index, index + size).join(' ');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const repeated = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return repeated / Math.max(1, tokens.length - size + 1);
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter(value => b.has(value)).length;
  return overlap / Math.max(1, a.size + b.size - overlap);
}

function cosineDistance(left = [], right = []) {
  const a = new Map();
  const b = new Map();
  left.forEach(token => a.set(token, (a.get(token) || 0) + 1));
  right.forEach(token => b.set(token, (b.get(token) || 0) + 1));
  const keys = new Set([...a.keys(), ...b.keys()]);
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;
  keys.forEach(key => {
    const x = a.get(key) || 0;
    const y = b.get(key) || 0;
    dot += x * y;
    leftMag += x * x;
    rightMag += y * y;
  });
  if (!leftMag || !rightMag) return 0;
  return clamp(1 - dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag)));
}

function lexicalEntropy(tokens) {
  if (tokens.length < 2) return 0;
  const counts = new Map();
  tokens.forEach(token => counts.set(token, (counts.get(token) || 0) + 1));
  const entropy = [...counts.values()].reduce((sum, count) => {
    const probability = count / tokens.length;
    return sum - probability * Math.log2(probability);
  }, 0);
  return entropy / Math.log2(Math.max(2, counts.size));
}

function extractFeatures(text, context = {}, history = []) {
  const tokens = tokenize(text);
  const sentences = splitSentences(text);
  const wordCount = tokens.length;
  const sentenceLengths = sentences.map(sentence => tokenize(sentence).length).filter(Boolean);
  const sentenceAverage = mean(sentenceLengths) || wordCount;
  const sentenceCv = sentenceAverage ? stddev(sentenceLengths) / sentenceAverage : 0;
  const uniqueRatio = wordCount ? new Set(tokens).size / wordCount : 0;
  const transcriptConfidence = clamp(context.transcriptConfidence ?? context.confidence ?? 1);
  const alphaTokens = tokens.filter(token => /[a-z]/.test(token)).length;
  const quality = wordCount ? clamp((alphaTokens / wordCount) * transcriptConfidence) : 0;
  const density = key => countMatches(text, PATTERNS[key]) / Math.max(1, wordCount);
  const vocabularyTerms = Array.isArray(context.technicalVocabulary)
    ? context.technicalVocabulary
    : String(context.technicalVocabulary || '').split(/[\n,]/);
  const technicalVocabularyMatches = vocabularyTerms
    .map(term => String(term || '').trim().toLowerCase())
    .filter(term => term.length >= 2)
    .reduce((count, term) => count + (String(text || '').toLowerCase().includes(term) ? 1 : 0), 0);
  const recent = history.slice(-6);
  const historySimilarity = recent.length ? Math.max(...recent.map(item => jaccard(tokens, item.tokens || []))) : 0;
  const baselineTokens = recent.flatMap(item => item.tokens || []);
  const styleDrift = recent.length >= 3 && baselineTokens.length >= 60 ? cosineDistance(tokens, baselineTokens) : 0;
  const historyLengths = recent.map(item => item.wordCount).filter(Boolean);
  const lengthAverage = mean(historyLengths);
  const lengthUniformity = historyLengths.length >= 3 && lengthAverage
    ? 1 - clamp(Math.abs(wordCount - lengthAverage) / lengthAverage)
    : 0;

  return {
    wordCount,
    sentenceCount: sentenceLengths.length,
    transcriptConfidence,
    quality,
    tokens,
    fillerDensity: density('fillers'),
    correctionDensity: density('corrections'),
    structuredDensity: density('structured'),
    genericDensity: density('generic'),
    abstractDensity: density('abstract'),
    ownershipDensity: density('ownership'),
    specificityDensity: density('specificity'),
    technicalVocabularyDensity: technicalVocabularyMatches / Math.max(1, wordCount),
    hypotheticalDensity: density('hypotheticals'),
    assistantStyleDensity: density('assistantStyle'),
    copiedArtifactDensity: density('copiedArtifact'),
    directAiDensity: density('directAi'),
    directAiMentionDensity: density('directAi'),
    directAiUseDensity: density('directAiUse'),
    negatedAiMentionDensity: density('negatedAi'),
    discourseDensity: density('discourse'),
    uniqueRatio,
    lexicalEntropy: lexicalEntropy(tokens),
    phraseRepetition: Math.max(ngramRepetition(tokens, 2), ngramRepetition(tokens, 3)),
    sentenceCv,
    historySimilarity,
    styleDrift,
    lengthUniformity,
    wordsPerMinute: context.durationMs
      ? wordCount / Math.max(Number(context.durationMs) / 60000, 0.1)
      : 0
  };
}

module.exports = { extractFeatures, tokenize, clamp };
