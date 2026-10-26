import { corsHeadersFor } from "../_shared/cors.ts";
import { authorizeTranscription } from "../_shared/transcription-access.ts";
import { deepgramVocabularyUrl } from "../_shared/speech-vocabulary.ts";

const deepgramUrl =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&punctuate=true&filler_words=true&interim_results=true&endpointing=300&utterance_end_ms=1000&vad_events=true&mip_opt_out=true";
const accessCheckIntervalMs = 5000;
const accessCheckTimeoutMs = 3000;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }
  const token = new URL(request.url).searchParams.get("token") ||
    request.headers.get("x-session-token") || "";
  const access = await authorizeTranscription(token);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status, headers: corsHeadersFor(request) });
  }
  const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!deepgramKey) {
    return Response.json({ error: "Live transcription is not configured." }, {
      status: 502, headers: corsHeadersFor(request),
    });
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket required", {
      status: 426,
      headers: corsHeadersFor(request),
    });
  }

  const { socket: candidate, response } = Deno.upgradeWebSocket(request);
  let deepgram: WebSocket | null = null;
  let closed = false;
  let checking = false;
  let expiresAt = access.expiresAt;
  let recheckAt = Date.now();
  let recheckTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let lookupTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (!canForward()) return;
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
    clearTimeout(recheckTimer);
    clearTimeout(expiryTimer);
    clearTimeout(lookupTimer);
    finalSegments = [];
    finalConfidences = [];
    try {
      candidate.close(code, reason);
    } catch {}
    try {
      // Outbound Web-standard sockets reject reserved 1008/1011 close codes.
      const providerCode = code === 1008 ? 4008 : code === 1011 ? 4011 : code;
      deepgram?.close(providerCode, reason);
    } catch {}
  };

  const armExpiry = () => {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => closeAll(1008, "transcription access expired"),
      Math.max(0, Math.min(expiresAt - Date.now(), 2147483647)));
  };
  const revalidate = async (): Promise<boolean> => {
    if (closed || checking) return false;
    checking = true;
    clearTimeout(recheckTimer);
    // Audio is not buffered or forwarded while access is uncertain. A stalled
    // database check closes both sockets rather than extending the last grant.
    lookupTimer = setTimeout(() => closeAll(1008, "transcription access check timed out"), accessCheckTimeoutMs);
    const current = await authorizeTranscription(token);
    clearTimeout(lookupTimer);
    if (closed) return false;
    checking = false;
    if (!current.ok) {
      closeAll(1008, "transcription access ended");
      return false;
    }
    expiresAt = Math.min(expiresAt, current.expiresAt);
    if (expiresAt <= Date.now()) {
      closeAll(1008, "transcription access expired");
      return false;
    }
    armExpiry();
    recheckAt = Date.now() + accessCheckIntervalMs;
    recheckTimer = setTimeout(revalidate, accessCheckIntervalMs);
    return true;
  };
  const canForward = () => {
    if (closed) return false;
    if (expiresAt <= Date.now()) {
      closeAll(1008, "transcription access expired");
      return false;
    }
    if (checking) return false;
    // Also enforce the deadline on frames if the runtime delays timer delivery.
    if (Date.now() >= recheckAt) {
      void revalidate();
      return false;
    }
    return true;
  };
  armExpiry();

  candidate.onopen = async () => {
    if (!await revalidate()) return;
    try {
      deepgram = new WebSocket(deepgramVocabularyUrl(deepgramUrl, access.technicalVocabulary), ["token", deepgramKey]);
    } catch {
      closeAll(1011, "transcription provider unavailable");
      return;
    }
    deepgram.onopen = () => {
      if (!canForward()) return;
      candidate.send(
        JSON.stringify({
          type: "status",
          state: "ready",
          source: "deepgram-nova-3-live",
        }),
      );
    };
    deepgram.onmessage = (event) => {
      if (!canForward()) return;
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
    deepgram.onerror = () => closeAll(1011, "transcription provider unavailable");
    deepgram.onclose = () => closeAll(1011, "transcription provider closed");
  };
  candidate.onmessage = (event) => {
    if (!canForward()) return;
    try {
      if (deepgram?.readyState === WebSocket.OPEN) deepgram.send(event.data);
    } catch {
      closeAll(1011, "transcription provider send failed");
    }
  };
  candidate.onerror = () => closeAll(1011, "candidate stream error");
  candidate.onclose = () => closeAll();
  return response;
});
