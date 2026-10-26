import { corsHeadersFor } from "../_shared/cors.ts";
import { authorizeTranscription } from "../_shared/transcription-access.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }

  const sessionToken = request.headers.get("x-session-token") || "";
  const access = await authorizeTranscription(sessionToken);
  if (!access.ok) {
    return Response.json({ error: access.error }, {
      status: access.status,
      headers: corsHeadersFor(request),
    });
  }

  const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!deepgramKey) {
    return Response.json({ error: "Deepgram is not configured in Supabase Edge Function secrets." }, {
      status: 502,
      headers: corsHeadersFor(request),
    });
  }

  const ttlSeconds = Math.min(60, Math.floor((access.expiresAt - Date.now()) / 1000));
  if (ttlSeconds < 1) {
    return Response.json({ error: "Transcription access has expired." }, {
      status: 410, headers: corsHeadersFor(request),
    });
  }
  const grant = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  });

  const body = await grant.json().catch(() => ({}));
  const expiresIn = Number(body.expires_in);
  if (!grant.ok || !body.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > ttlSeconds) {
    return Response.json({
      error: "Deepgram temporary-token grant failed. Check that the Edge Function secret is a Deepgram Member or Admin API key.",
      providerStatus: grant.status,
    }, {
      status: 502,
      headers: corsHeadersFor(request),
    });
  }

  // Do not hand out a newly minted credential if access ended during the grant.
  const currentAccess = await authorizeTranscription(sessionToken);
  if (!currentAccess.ok) {
    return Response.json({ error: currentAccess.error }, {
      status: currentAccess.status, headers: corsHeadersFor(request),
    });
  }
  const remainingSeconds = Math.floor((currentAccess.expiresAt - Date.now()) / 1000);
  if (remainingSeconds < 1) {
    return Response.json({ error: "Transcription access has expired." }, {
      status: 410, headers: corsHeadersFor(request),
    });
  }

  return Response.json({
    accessToken: body.access_token,
    expiresIn: Math.min(expiresIn, remainingSeconds),
    sessionId: access.sessionId,
  }, {
    headers: {
      ...corsHeadersFor(request),
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
});
