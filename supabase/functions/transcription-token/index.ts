import { corsHeaders } from "../_shared/cors.ts";
import { verifySessionToken } from "../_shared/session-token.ts";

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

