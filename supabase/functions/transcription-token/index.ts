import { corsHeadersFor } from "../_shared/cors.ts";
import { resolveSessionSecret, verifySessionToken } from "../_shared/session-token.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }

  const sessionToken = request.headers.get("x-session-token") || "";
  const claims = await verifySessionToken(
    sessionToken,
    resolveSessionSecret(),
  );
  if (!claims) {
    return Response.json({ error: "Unauthorized" }, {
      status: 401,
      headers: corsHeadersFor(request),
    });
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: session } = await service.from("sessions").select("status")
    .eq("internal_id", claims.sessionId).maybeSingle();
  if (!session || !["candidate_ready", "active"].includes(session.status)) {
    return Response.json({ error: "Transcription is only available after candidate check-in." }, {
      status: 409,
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

  const grant = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: 60 }),
  });

  const body = await grant.json().catch(() => ({}));
  if (!grant.ok || !body.access_token) {
    return Response.json({
      error: "Deepgram temporary-token grant failed. Check that the Edge Function secret is a Deepgram Member or Admin API key.",
      providerStatus: grant.status,
    }, {
      status: 502,
      headers: corsHeadersFor(request),
    });
  }

  return Response.json({
    accessToken: body.access_token,
    expiresIn: Number(body.expires_in) || 60,
    sessionId: claims.sessionId,
  }, {
    headers: {
      ...corsHeadersFor(request),
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
});
