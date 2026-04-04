const OpenAI = require('openai');

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "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",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Truveil",
  }
});

const conversationHistory = [];

async function analyze(transcript) {
  conversationHistory.push(transcript);
  if (conversationHistory.length > 10) conversationHistory.shift();

  const systemPrompt = `You are an expert forensic linguist specializing in detecting AI-assisted speech in job interviews.
Your job is to analyze interview responses and return a precise JSON assessment.

Key signals of AI assistance:
1. ZERO filler words (no "um", "uh", "like", "you know", "sort of", "kind of")
2. Unnaturally complete answers — no half-sentences, no self-correction, no "actually wait"
3. Perfect structure: every answer has intro, 2-3 points, conclusion — too structured for off-the-cuff speech
4. Suspiciously consistent answer length — not too short, not too long, just right
5. Formal vocabulary that wouldn't match casual speech
6. No personal anecdotes or specific details — answers are generic and could apply to anyone
7. Reading cadence — very even pacing, no natural pauses for genuine thinking
8. No questions asked back to the interviewer
9. Answers start immediately — no "That's a great question, let me think about that"
10. Technical terms used correctly but without the slight imprecision real experts have

Return ONLY this JSON — no markdown, no explanation outside the JSON:
{
  "score": <0-100 integer, 0=definitely human, 100=definitely AI>,
  "confidence": <"low"|"medium"|"high">,
  "flags": [<array of specific signals detected, max 4 items, be specific>],
  "reasoning": "<one crisp sentence explaining the main signal>"
}`;

  const response = await client.chat.completions.create({
    model: 'google/gemini-2.0-flash-001',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Interview response to analyze:\n\n"${transcript}"\n\nConversation context (last ${conversationHistory.length} responses): ${conversationHistory.slice(0, -1).join(' | ')}`
      }
    ]
  });

  const raw = response.choices[0].message.content.trim().replace(/```json/g, '').replace(/```/g, '');

  try {
    return JSON.parse(raw);
  } catch {
    return { score: 0, confidence: 'low', flags: [], reasoning: 'Analysis failed' };
  }
}

module.exports = { analyze };
