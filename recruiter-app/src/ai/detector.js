function requireKey(apiKey) {
  const key = apiKey || '';
  if (!key) throw new Error('OpenRouter key is not configured. Local risk scoring does not require one.');
  return key;
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
11. Assistant or prompt residue, markdown artifacts, or "here is a polished answer" framing
12. Multiple weak signals appearing together: polished scaffold + low disfluency + little concrete grounding

False-positive guardrails:
- Do not treat a single ChatGPT/Claude/Gemini mention as proof of assistance.
- Lower the score when the candidate gives first-person incident detail, self-corrects, names concrete tools, or explains implementation mechanics.
- Generic polished speech alone should usually be review context, not high confidence.

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

  const key = requireKey(apiKey);
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://truveil.com',
      'X-Title': 'Truveil Command Center'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-001',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Response to analyze:\n"${transcript}"\n\nContext (recent responses this session): ${history.slice(0, -1).join(' | ') || 'none'}`
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenRouter analysis failed (${response.status}).`);
  const result = await response.json();

  const raw = result.choices[0].message.content
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
