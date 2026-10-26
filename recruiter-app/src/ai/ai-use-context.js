const TOOL = '(?:chatgpt|claude|gemini|copilot|perplexity|an? ai|an? llm)';
const SELF_USE = new RegExp(`\\b(?:i|we)\\s+(?:(?:am|are|have|just|have just)\\s+)?(?:use[ds]?|using|asked|prompted|copied|pasted|opened|checked|got help from)\\s+${TOOL}\\b`, 'i');
const TOOL_RESPONSE = new RegExp(`\\b${TOOL}\\s+(?:said|suggested|gave|generated|wrote|answered)\\b`, 'i');
const FED_TOOL = new RegExp(`\\b(?:i|we)\\s+(?:put|fed|typed)\\s+(?:it|the question|the prompt|my answer)\\s+(?:into|in)\\s+${TOOL}\\b`, 'i');
const CURRENT = /\b(?:this|my|the|system design|architecture) (?:answer|response|question)|\b(?:right now|just now|during (?:this|the) interview|currently|i am using|we are using)\b/i;
const PAST = /\b(?:last (?:year|month|week|quarter|role|job|project)|yesterday|previous(?:ly)?|used to|back then|years? ago|in 20\d\d)\b/i;
const HYPOTHETICAL = /\b(?:if|suppose|imagine|hypothetically|would|could|might)\b/i;
const REPORTED = /\b(?:the (?:bot|model|assistant|tool|tutorial|documentation|example|message) (?:said|says|read|reads|returned)|(?:quote|phrase|example))\b/i;
const REPORTED_QUESTION = /\b(?:whether|you (?:asked|ask|said|say)|(?:the )?interviewer (?:asked|asks))\b/i;
const SELF_QUESTION = /(?<![\w'])(?:did|do|have|are|am) (?:i|we)\b/i;

function aiUseContext(text) {
  // Quoted/documented model output is not an admission of present interview use.
  const unquoted = String(text || '').replace(/[\u2018\u2019]/g, "'")
    .replace(/["\u201c][^"\u201d\n]*["\u201d]/g, ' ')
    // Normalize spoken contractions only for evidence matching, never captions.
    .replace(/\bi'm\b/gi, 'I am').replace(/\bwe're\b/gi, 'we are');
  // Keep question punctuation, but separate an admission from a trailing question.
  const sentences = unquoted.match(/[^.!?;\n]+[.!?;\n]*/g) || [];
  const clauses = sentences.flatMap(sentence => sentence.includes('?')
    ? sentence.split(/,\s*(?=(?:is|are|should|can|could|may|does|do|would|will)\s+(?:i|we|you|it|that|this|there|they)\b)/i)
    : [sentence]).flatMap(clause => clause.split(/\b(?:but|however)\b/i));
  let directUseCount = 0;
  const artifactClauses = [];
  for (let clause of clauses) {
    const contextual = PAST.test(clause) || HYPOTHETICAL.test(clause) || REPORTED.test(clause) || REPORTED_QUESTION.test(clause);
    if (contextual) continue;
    if (SELF_QUESTION.test(clause)) {
      // Only a self-question may yield a spoken affirmative reply. Never detach
      // "yes I ..." from a reported example, hypothesis, or past-use explanation.
      const reply = /\byes[,\s]+((?:i|we)\b.*)$/i.exec(clause);
      if (!reply) continue;
      clause = reply[1];
    }
    if (clause.includes('?')) continue;
    artifactClauses.push(clause);
    if (!CURRENT.test(clause)) continue;
    if (SELF_USE.test(clause) || FED_TOOL.test(clause) || TOOL_RESPONSE.test(clause)) directUseCount++;
  }
  const artifactText = artifactClauses.join('. ');
  const strongArtifact = /\bas an ai (?:language model|assistant|model)\b/i.test(artifactText)
    || (/\b(?:suggested answer|polished (?:answer|response)|final answer)\b/i.test(artifactText)
      && /\b(?:the candidate should|copy|use this|i can help|interviewer)\b/i.test(artifactText));
  return { directUseCount, artifactText, strongArtifact };
}

module.exports = { aiUseContext };
