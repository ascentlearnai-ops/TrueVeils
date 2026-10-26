import { corsHeadersFor } from "../_shared/cors.ts";
import { authorizeTranscription } from "../_shared/transcription-access.ts";
import { deepgramVocabularyUrl, spellingPrompt } from "../_shared/speech-vocabulary.ts";

const MAX_AUDIO_BYTES = 2_500_000;
const PROVIDER_TIMEOUT_MS = 12_000;
const MIN_CONFIDENCE = 0.58;

type Transcript = {
  text: string;
  confidence: number | null;
  confidenceKnown: boolean;
  source: string;
  qualityReason: string | null;
  lowConfidenceWordRatio: number | null;
};

const cleanTranscript = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const probability = (value: unknown): number | null => {
  const number = finiteNumber(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
};
const knownHallucination = (text: string) =>
  /^(?:\[?(?:music|silence|blank audio|inaudible)\]?|thank you for watching|thanks for watching|please subscribe)[\s.!?]*$/i
    .test(text) ||
  /^(?:subtitles|captions) by\b/i.test(text) ||
  /\bamara\.org\b/i.test(text);

async function providerJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Keep the deadline active through response.json(), not only receipt of headers.
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) {
          await response.body?.cancel();
          return null;
        }
        return await response.json();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Transcription provider timed out."));
        }, PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function deepgramTranscript(body: unknown): Transcript | null {
  const channels = record(record(body).results).channels;
  const alternatives = Array.isArray(channels) ? record(channels[0]).alternatives : null;
  const alternative = Array.isArray(alternatives) ? record(alternatives[0]) : {};
  if (typeof alternative.transcript !== "string") return null;
  const rawText = cleanTranscript(alternative.transcript);
  const hallucination = knownHallucination(rawText);
  const confidence = probability(alternative.confidence);
  const words = Array.isArray(alternative.words) ? alternative.words : [];
  const wordConfidences = words.map(word => probability(record(word).confidence));
  // Partial word metadata cannot establish a ratio for the whole transcript.
  const lowConfidenceWordRatio = words.length && wordConfidences.every(value => value !== null)
    ? wordConfidences.filter(value => value !== null && value < MIN_CONFIDENCE).length / words.length
    : null;
  return {
    text: hallucination ? "" : rawText,
    confidence,
    confidenceKnown: confidence !== null,
    source: "deepgram-nova-3-chunk",
    lowConfidenceWordRatio,
    qualityReason: hallucination ? "suspected-hallucination"
      : !rawText ? "no-speech"
      : confidence === null ? "confidence-unavailable"
      : confidence < MIN_CONFIDENCE ? "low-confidence"
      : lowConfidenceWordRatio !== null && lowConfidenceWordRatio > 0.25 ? "low-confidence-words"
      : null,
  };
}

function groqTranscript(body: unknown): Transcript | null {
  const result = record(body);
  if (typeof result.text !== "string") return null;
  let text = cleanTranscript(result.text);
  let qualityReason = "confidence-unavailable";
  const segments = Array.isArray(result.segments) ? result.segments : [];
  if (segments.length && segments.every(segment => typeof record(segment).text === "string")) {
    const retained: string[] = [];
    let filtered = false;
    for (const segment of segments) {
      const item = record(segment);
      const segmentText = cleanTranscript(item.text);
      const noSpeech = probability(item.no_speech_prob);
      const logprob = finiteNumber(item.avg_logprob);
      const compression = finiteNumber(item.compression_ratio);
      // Conservative Whisper silence rule: neither logprob nor silence alone is certainty.
      if (knownHallucination(segmentText) ||
        (noSpeech !== null && noSpeech > 0.6 && logprob !== null && logprob < -1)) {
        filtered = true;
        continue;
      }
      if (logprob !== null && logprob < -1) qualityReason = "low-confidence";
      if (compression !== null && compression > 2.4) qualityReason = "repetition-risk";
      retained.push(segmentText);
    }
    text = cleanTranscript(retained.join(" "));
    if (filtered) qualityReason = text ? "silence-filtered" : "no-speech";
  }
  if (knownHallucination(text)) {
    text = "";
    qualityReason = "suspected-hallucination";
  }
  if (!text && qualityReason !== "suspected-hallucination") qualityReason = "no-speech";
  return {
    text,
    // Whisper likelihoods are not calibrated word/transcript confidence scores.
    confidence: null,
    confidenceKnown: false,
    source: "groq-whisper-chunk",
    qualityReason,
    lowConfidenceWordRatio: null,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }
  const token = request.headers.get("x-session-token") || "";
  const access = await authorizeTranscription(token);
  if (!access.ok) {
    return Response.json({ error: access.error }, {
      status: access.status,
      headers: corsHeadersFor(request),
    });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio segment is too large." }, {
      status: 413,
      headers: corsHeadersFor(request),
    });
  }
  let audio: ArrayBuffer;
  try {
    audio = await request.arrayBuffer();
  } catch {
    return Response.json({ error: "Audio could not be read." }, {
      status: 400, headers: corsHeadersFor(request),
    });
  }
  if (!audio.byteLength) {
    return Response.json({ error: "Audio was empty." }, {
      status: 400,
      headers: corsHeadersFor(request),
    });
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio segment is too large." }, {
      status: 413,
      headers: corsHeadersFor(request),
    });
  }

  const contentType = request.headers.get("content-type") || "audio/webm";
  const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");
  let primary: Transcript | null = null;
  if (deepgramKey) {
    const currentAccess = await authorizeTranscription(token);
    if (!currentAccess.ok) {
      return Response.json({ error: currentAccess.error }, {
        status: currentAccess.status, headers: corsHeadersFor(request),
      });
    }
    const body = await providerJson(
      deepgramVocabularyUrl("https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&punctuate=true&filler_words=true&mip_opt_out=true", currentAccess.technicalVocabulary),
      {
        method: "POST",
        headers: {
          Authorization: `Token ${deepgramKey}`,
          "content-type": contentType,
        },
        body: audio,
      },
    );
    primary = deepgramTranscript(body);
    if (primary?.text && primary.qualityReason === null) {
      return Response.json(primary, { headers: corsHeadersFor(request) });
    }
  }

  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) {
    if (primary) return Response.json(primary, { headers: corsHeadersFor(request) });
    return Response.json(
      { error: "No transcription provider was available." },
      { status: 502, headers: corsHeadersFor(request) },
    );
  }

  const form = new FormData();
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("temperature", "0");
  form.append("language", "en");
  form.append("file", new Blob([audio], { type: contentType }), "segment.webm");
  // The first provider may have failed after cancellation or revocation.
  const fallbackAccess = await authorizeTranscription(token);
  if (!fallbackAccess.ok) {
    return Response.json({ error: fallbackAccess.error }, {
      status: fallbackAccess.status, headers: corsHeadersFor(request),
    });
  }
  form.append("prompt", spellingPrompt(fallbackAccess.technicalVocabulary));
  const body = await providerJson(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: form,
    },
  );
  const fallback = groqTranscript(body);
  // A failed/silent fallback must not erase valid, reviewable primary speech.
  const transcript = fallback?.text ? fallback : primary?.text ? primary : fallback ?? primary;
  if (!transcript) {
    return Response.json(
      { error: "No transcription provider was available." },
      { status: 502, headers: corsHeadersFor(request) },
    );
  }
  return Response.json(transcript, { headers: corsHeadersFor(request) });
});
