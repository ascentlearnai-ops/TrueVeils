import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { resolveSessionSecret, verifySessionToken } from "../_shared/session-token.ts";

const allowedStates = new Set([
  "candidate_ready",
  "interrupted",
]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }

  const sessionToken = request.headers.get("x-session-token") || "";
  const claims = await verifySessionToken(sessionToken, resolveSessionSecret());
  if (!claims) {
    return Response.json({ error: "Unauthorized" }, {
      status: 401,
      headers: corsHeadersFor(request),
    });
  }

  const body = await request.json().catch(() => ({}));
  const status = String(body.status || "");
  if (!allowedStates.has(status)) {
    return Response.json({ error: "Invalid session state." }, {
      status: 400,
      headers: corsHeadersFor(request),
    });
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const patch: Record<string, unknown> = { status };
  if (status === "interrupted") {
    patch.ended_at = new Date().toISOString();
  }
  const { error } = await service.from("sessions").update(patch).eq(
    "internal_id",
    claims.sessionId,
  );
  if (error) {
    return Response.json({ error: error.message }, {
      status: 400,
      headers: corsHeadersFor(request),
    });
  }
  return Response.json({ ok: true, status }, { headers: corsHeadersFor(request) });
});
