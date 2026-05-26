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

function countMatches(text, patterns) {
  const lower = String(text || '').toLowerCase();
  return patterns.reduce((count, pattern) => count + (lower.match(pattern) || []).length, 0);
}

function analyzeTranscript(text, context = {}) {
  const tokens = words(text);
  const wordCount = tokens.length;
  if (wordCount < 4) {
    return {
      score: 0,
      confidence: 'low',
      flags: [],
      reasoning: 'Transcript is too short for a meaningful local risk estimate.'
    };
  }

  const fillerCount = countMatches(text, [
    /\bum+\b/g,
    /\buh+\b/g,
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
    /\bor rather\b/g
  ]);
  const structureCount = countMatches(text, [
    /\bfirst\b/g,
    /\bsecond\b/g,
    /\bthird\b/g,
    /\bin conclusion\b/g,
    /\boverall\b/g,
    /\bto summarize\b/g
  ]);
  const genericCount = countMatches(text, [
    /\bbest practices\b/g,
    /\bcross-functional\b/g,
    /\bstakeholders\b/g,
    /\bscalable solution\b/g,
    /\bdrive impact\b/g,
    /\balign(ed)? with business goals\b/g
  ]);

  const uniqueRatio = new Set(tokens).size / wordCount;
  const fillerDensity = fillerCount / wordCount;
  const avgHistoryLength = transcriptHistory.length
    ? transcriptHistory.reduce((sum, item) => sum + item.wordCount, 0) / transcriptHistory.length
    : 0;
  const uniformLength = transcriptHistory.length >= 3 && avgHistoryLength > 0
    ? Math.abs(wordCount - avgHistoryLength) / avgHistoryLength < 0.18
    : false;

  let score = 18;
  const flags = [];

  if (wordCount >= 35 && fillerDensity < 0.01) {
    score += 18;
    flags.push('Long answer with almost no fillers');
  } else if (fillerDensity > 0.035) {
    score -= 8;
  }

  if (correctionCount === 0 && wordCount >= 45) {
    score += 10;
    flags.push('No self-correction in a long spoken answer');
  }

  if (structureCount >= 3) {
    score += 14;
    flags.push('Highly structured spoken response');
  }

  if (genericCount >= 2) {
    score += 12;
    flags.push('Generic interview phrasing');
  }

  if (uniqueRatio < 0.48 && wordCount >= 45) {
    score += 8;
    flags.push('Repetitive vocabulary pattern');
  } else if (uniqueRatio > 0.72 && wordCount >= 30) {
    score += 6;
  }

  if (uniformLength) {
    score += 10;
    flags.push('Response length is unusually uniform');
  }

  if (context.durationMs && wordCount > 0) {
    const wordsPerMinute = wordCount / Math.max(context.durationMs / 60000, 0.1);
    if (wordsPerMinute > 190) {
      score += 9;
      flags.push('Very fast delivery for the transcript length');
    } else if (wordsPerMinute < 65) {
      score -= 5;
    }
  }

  transcriptHistory.push({ wordCount, score: clamp(score) });
  if (transcriptHistory.length > 10) transcriptHistory.shift();

  const finalScore = clamp(score);
  return {
    score: finalScore,
    confidence: wordCount >= 45 ? 'medium' : 'low',
    flags: flags.slice(0, 4),
    reasoning: flags[0]
      ? `Local heuristic signal: ${flags[0].toLowerCase()}.`
      : 'Local heuristic signal is low; spoken answer contains normal human variation.'
  };
}

function analyzeAudio(metadata = {}) {
  const durationMs = Number(metadata.durationMs || metadata.duration_ms || 0);
  const rms = Number(metadata.rms || 0);
  const peak = Number(metadata.peak || 0);
  const flags = [];
  let score = 8;

  if (durationMs > 0 && durationMs < 2500) {
    flags.push('Short audio segment');
  }

  if (rms < 0.006 || peak < 0.025) {
    flags.push('Very low speech energy');
    score += 6;
  } else if (rms > 0.05 && peak > 0.35) {
    score += 4;
  }

  audioHistory.push({ durationMs, rms, peak });
  if (audioHistory.length > 12) audioHistory.shift();

  if (audioHistory.length >= 5) {
    const rmsAvg = audioHistory.reduce((sum, item) => sum + item.rms, 0) / audioHistory.length;
    const rmsVariance = audioHistory.reduce((sum, item) => sum + Math.abs(item.rms - rmsAvg), 0) / audioHistory.length;
    const durationAvg = audioHistory.reduce((sum, item) => sum + item.durationMs, 0) / audioHistory.length;
    const durationVariance = audioHistory.reduce((sum, item) => sum + Math.abs(item.durationMs - durationAvg), 0) / audioHistory.length;

    if (rmsAvg > 0.01 && rmsVariance < 0.004 && durationVariance < 750) {
      score += 12;
      flags.push('Unusually steady cadence across chunks');
    }
  }

  return {
    score: clamp(score, 0, 45),
    confidence: 'low',
    flags: flags.slice(0, 3),
    reasoning: flags[0]
      ? `Audio-only local signal: ${flags[0].toLowerCase()}.`
      : 'Audio relay is healthy; no strong audio-only risk signal.'
  };
}

function resetHistory() {
  transcriptHistory.length = 0;
  audioHistory.length = 0;
}

module.exports = { analyzeTranscript, analyzeAudio, resetHistory };
