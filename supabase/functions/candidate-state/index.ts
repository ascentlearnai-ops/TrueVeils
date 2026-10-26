import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { authorizeCandidateAccess } from "../_shared/candidate-access.ts";

const allowedStates = new Set([
  "candidate_ready",
  "interrupted",
]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, {
      status: 405, headers: corsHeadersFor(request),
    });
  }

  const body = await request.json().catch(() => ({}));
  const sessionToken = request.headers.get("x-session-token") || "";
  const access = await authorizeCandidateAccess(sessionToken, ["waiting", "candidate_ready", "active"]);
  if (!access.ok) {
    return Response.json({ error: access.error }, {
      status: access.status,
      headers: corsHeadersFor(request),
    });
  }

  const status = String(body?.status || "");
  if (!allowedStates.has(status)) {
    return Response.json({ error: "Invalid session state." }, {
      status: 400,
      headers: corsHeadersFor(request),
    });
  }

  if (access.expiresAt <= Date.now()) {
    return Response.json({ error: "Candidate access has expired." }, {
      status: 410, headers: corsHeadersFor(request),
    });
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  // Repeat authorization inside the same transaction as the mutation. The
  // earlier read alone cannot protect against revocation while this request waits.
  const { data, error } = await service.rpc("transition_candidate_session", {
    target_session: access.sessionId,
    candidate_user: access.userId,
    requested_state: status,
    token_expiry: new Date(access.expiresAt).toISOString(),
  });
  if (error) {
    return Response.json({ error: "Could not update session state." }, {
      status: 500,
      headers: corsHeadersFor(request),
    });
  }
  if (!data?.ok) {
    return Response.json({ error: data?.error || "Could not update session state." }, {
      status: data?.status_code || 500, headers: corsHeadersFor(request),
    });
  }
  return Response.json({ ok: true, status }, { headers: corsHeadersFor(request) });
});
