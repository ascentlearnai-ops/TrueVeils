const {
  analyzeTranscript,
  resetHistory,
  MODEL_VERSION,
} = require("../ai/local-risk");

const { samples, MAX_LENGTH } = require("./demo-samples");

function assess(text, sampleEvent = false) {
  // Each edit is the same answer, not a new historical response or a timing event.
  resetHistory();
  const result = analyzeTranscript(
    String(text || "").slice(0, MAX_LENGTH),
    sampleEvent ? { behavioralAiEventCount: 1, secondsSinceAiEvent: 5 } : {},
  );
  resetHistory();
  return result;
}

module.exports = { assess, samples, MAX_LENGTH, MODEL_VERSION };
