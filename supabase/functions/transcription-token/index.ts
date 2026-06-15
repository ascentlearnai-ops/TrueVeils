import { corsHeaders } from "../_shared/cors.ts";
import { verifySessionToken } from "../_shared/session-token.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const sessionToken = request.headers.get("x-session-token") || "";
  const claims = await verifySessionToken(
    sessionToken,
    Deno.env.get("SESSION_TOKEN_SECRET")!,
  );
  if (!claims) {
    return Response.json({ error: "Unauthorized" }, {
      status: 401,
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

  const grant = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${Deno.env.get("DEEPGRAM_API_KEY")!}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: 60 }),
  });

  const body = await grant.json().catch(() => ({}));
  if (!grant.ok || !body.access_token) {
    return Response.json({ error: "Live transcription token unavailable." }, {
      status: 502,
      headers: corsHeaders,
    });
  }

  return Response.json({
    accessToken: body.access_token,
    expiresIn: Number(body.expires_in) || 60,
    sessionId: claims.sessionId,
  }, {
    headers: {
      ...corsHeaders,
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
});
