import { corsHeaders } from "../_shared/cors.ts";
import { verifySessionToken } from "../_shared/session-token.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_AUDIO_BYTES = 2_500_000;

const cleanTranscript = (value: unknown) =>
  String(value || "").replace(/\s+/g, " ").trim();
const knownHallucination = (text: string) =>
  /^(?:\[?(?:music|silence|blank audio|inaudible)\]?|thank you for watching|thanks for watching|please subscribe)[\s.!?]*$/i
    .test(text) ||
  /^(?:subtitles|captions) by\b/i.test(text) ||
  /\bamara\.org\b/i.test(text);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const token = request.headers.get("x-session-token") || "";
  const claims = await verifySessionToken(
    token,
    Deno.env.get("SESSION_TOKEN_SECRET")!,
  );
  if (!claims) {
    return Response.json({ error: "Unauthorized" }, {
      status: 401,
      headers: corsHeaders,
    });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio segment is too large." }, {
      status: 413,
      headers: corsHeaders,
    });
  }
  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: session } = await service.from("sessions").select("status")
    .eq("internal_id", claims.sessionId).maybeSingle();
  if (!session || session.status !== "active") {
    return Response.json({ error: "Transcription is only available during an active session." }, {
      status: 409,
      headers: corsHeaders,
    });
  }
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) {
    return Response.json({ error: "Audio was empty." }, {
      status: 400,
      headers: corsHeaders,
    });
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio segment is too large." }, {
      status: 413,
      headers: corsHeaders,
    });
  }

  const contentType = request.headers.get("content-type") || "audio/webm";
  try {
    const deepgram = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&punctuate=true&filler_words=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${Deno.env.get("DEEPGRAM_API_KEY")!}`,
          "content-type": contentType,
        },
        body: audio,
      },
    );
    if (deepgram.ok) {
      const body = await deepgram.json();
      const alternative = body.results?.channels?.[0]?.alternatives?.[0];
      const text = cleanTranscript(alternative?.transcript);
      const confidence = Number(alternative?.confidence || 0);
      return Response.json({
        text: confidence >= 0.52 && !knownHallucination(text) ? text : "",
        confidence,
        source: "deepgram-nova-3-chunk",
      }, { headers: corsHeaders });
    }
  } catch {}

  const form = new FormData();
  form.append("model", "whisper-large-v3-turbo");
  form.append("temperature", "0");
  form.append("language", "en");
  form.append("file", new Blob([audio], { type: contentType }), "segment.webm");
  const groq = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("GROQ_API_KEY")!}` },
      body: form,
    },
  );
  if (!groq.ok) {
    return Response.json(
      { error: "No transcription provider was available." },
      { status: 502, headers: corsHeaders },
    );
  }
  const body = await groq.json();
  const text = cleanTranscript(body.text);
  return Response.json({
    text: knownHallucination(text) ? "" : text,
    confidence: null,
    source: "groq-whisper-chunk",
  }, { headers: corsHeaders });
});
