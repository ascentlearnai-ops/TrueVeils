import { corsHeaders } from "../_shared/cors.ts";
import { verifySessionToken } from "../_shared/session-token.ts";

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
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) {
    return Response.json({ error: "Audio was empty." }, {
      status: 400,
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
      return Response.json({
        text: String(alternative?.transcript || "").trim(),
        confidence: Number(alternative?.confidence || 0),
        source: "deepgram-nova-3-chunk",
      }, { headers: corsHeaders });
    }
  } catch {}

  const form = new FormData();
  form.append("model", "whisper-large-v3-turbo");
  form.append("temperature", "0");
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
  return Response.json({
    text: String(body.text || "").trim(),
    confidence: 0.72,
    source: "groq-whisper-chunk",
  }, { headers: corsHeaders });
});
