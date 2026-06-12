import { corsHeaders } from "../_shared/cors.ts";
import { verifySessionToken } from "../_shared/session-token.ts";

const deepgramUrl =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&punctuate=true&filler_words=true&interim_results=true&endpointing=300&utterance_end_ms=1000&vad_events=true";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const token = new URL(request.url).searchParams.get("token") ||
    request.headers.get("x-session-token") || "";
  const claims = await verifySessionToken(
    token,
    Deno.env.get("SESSION_TOKEN_SECRET")!,
  );
  if (!claims) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket required", {
      status: 426,
      headers: corsHeaders,
    });
  }

  const { socket: candidate, response } = Deno.upgradeWebSocket(request);
  let deepgram: WebSocket | null = null;
  let closed = false;
  let finalSegments: string[] = [];
  let finalConfidences: number[] = [];
  let sequence = 0;

  const clean = (value: unknown) =>
    String(value || "").replace(/\s+/g, " ").trim();
  const combinedText = (tail = "") =>
    [...finalSegments, clean(tail)].filter(Boolean).join(" ").replace(
      /\s+/g,
      " ",
    ).trim();
  const averageConfidence = () =>
    finalConfidences.length
      ? finalConfidences.reduce((sum, value) => sum + value, 0) /
        finalConfidences.length
      : 0;
  const flushFinal = () => {
    const text = combinedText();
    if (!text) return;
    candidate.send(JSON.stringify({
      type: "transcript",
      text,
      interim: false,
      confidence: averageConfidence(),
      sequence: sequence++,
      source: "deepgram-nova-3-live",
      timestamp: Date.now(),
    }));
    finalSegments = [];
    finalConfidences = [];
  };

  const closeAll = (code = 1000, reason = "closed") => {
    if (closed) return;
    closed = true;
    try {
      candidate.close(code, reason);
    } catch {}
    try {
      deepgram?.close(code, reason);
    } catch {}
  };

  candidate.onopen = () => {
    deepgram = new WebSocket(deepgramUrl, [
      "token",
      Deno.env.get("DEEPGRAM_API_KEY")!,
    ]);
    deepgram.onopen = () =>
      candidate.send(
        JSON.stringify({
          type: "status",
          state: "ready",
          source: "deepgram-nova-3-live",
        }),
      );
    deepgram.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.type === "UtteranceEnd") {
          flushFinal();
          return;
        }
        const alternative = payload.channel?.alternatives?.[0];
        const text = clean(alternative?.transcript);
        if (!text) return;
        const confidence = Number(alternative?.confidence || 0);
        if (payload.is_final) {
          if (finalSegments.at(-1) !== text) finalSegments.push(text);
          if (confidence > 0) finalConfidences.push(confidence);
        }
        if (payload.speech_final) {
          flushFinal();
          return;
        }
        const interimText = payload.is_final
          ? combinedText()
          : combinedText(text);
        if (!interimText) return;
        candidate.send(JSON.stringify({
          type: "transcript",
          text: interimText,
          interim: true,
          confidence,
          sequence,
          source: "deepgram-nova-3-live",
          timestamp: Date.now(),
        }));
      } catch {}
    };
    deepgram.onerror = () =>
      candidate.send(
        JSON.stringify({
          type: "status",
          state: "degraded",
          message: "Live transcription provider unavailable.",
        }),
      );
    deepgram.onclose = () => closeAll(1011, "transcription provider closed");
  };
  candidate.onmessage = (event) => {
    if (deepgram?.readyState === WebSocket.OPEN) deepgram.send(event.data);
  };
  candidate.onerror = () => closeAll(1011, "candidate stream error");
  candidate.onclose = () => closeAll();
  return response;
});
