const OpenAI = require('openai');

const DEFAULT_KEY = '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';

let cachedClient = null;
let cachedKey = null;

function getClient(apiKey) {
  const key = apiKey || DEFAULT_KEY;
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedKey = key;
  cachedClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: key,
    defaultHeaders: {
      'HTTP-Referer': 'https://truveil.com',
      'X-Title': 'Truveil Command Center'
    }
  });
  return cachedClient;
}

const SYSTEM_PROMPT = `You are a forensic linguist specialized in detecting AI-assisted speech during job interviews. A recruiter captured the candidate's spoken response via live transcription — analyze it and return ONLY a JSON object.

Signals of AI-assisted speech:
1. ZERO filler words ("um", "uh", "like", "you know", "sort of")
2. Suspiciously complete sentences — no self-correction, no half-thoughts
3. Textbook structure: intro + 2-3 points + conclusion, every time
4. Formal written vocabulary in a spoken context
5. Generic, non-specific anecdotes — nothing only this candidate would say
6. No hesitation, no thinking-aloud pauses
7. Immediately answers without processing the question
8. Technical terms applied with textbook precision (real experts hedge)
9. Answer length is uniformly "just right"
10. Robotic rhythm / reading cadence

Return ONLY this JSON, no markdown, no prose outside the JSON:
{
  "score": <0-100 integer, 0=clearly human, 100=clearly AI>,
  "confidence": "low" | "medium" | "high",
  "flags": [<up to 4 short specific signals you saw, e.g. "No filler words", "Textbook answer structure">],
  "reasoning": "<one crisp sentence explaining the main signal>"
}`;

const history = [];

async function analyze(transcript, apiKey) {
  history.push(transcript);
  if (history.length > 8) history.shift();

  const client = getClient(apiKey);
  const response = await client.chat.completions.create({
    model: 'google/gemini-2.0-flash-001',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Response to analyze:\n"${transcript}"\n\nContext (recent responses this session): ${history.slice(0, -1).join(' | ') || 'none'}`
      }
    ]
  });

  const raw = response.choices[0].message.content
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(raw);
    return {
      score: Math.max(0, Math.min(100, parseInt(parsed.score) || 0)),
      confidence: parsed.confidence || 'low',
      flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 4) : [],
      reasoning: parsed.reasoning || ''
    };
  } catch (err) {
    return { score: 0, confidence: 'low', flags: [], reasoning: 'Could not parse AI response' };
  }
}

function resetHistory() {
  history.length = 0;
}

module.exports = { analyze, resetHistory };
