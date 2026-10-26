import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { issueSessionToken, resolveSessionSecret } from "../_shared/session-token.ts";

Deno.serve(async (request) => {
  const headers = corsHeadersFor(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers });
  }
  try {
    const authorization = request.headers.get("authorization") || "";
    const bearer = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
    if (!bearer || bearer === Deno.env.get("SUPABASE_ANON_KEY")) {
      return Response.json({ error: "Candidate sign-in is required before joining." }, { status: 401, headers });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
    );
    // Anonymous Auth users are valid candidates; an API key alone is not a user.
    const { data: authData, error: authError } = await userClient.auth.getUser(bearer);
    const candidateUser = authData?.user;
    if (authError || !candidateUser?.id) {
      return Response.json({ error: "Candidate sign-in is required before joining." }, { status: 401, headers });
    }
    const body = await request.json().catch(() => null);
    const code = String(body?.joinCode || "").trim().toUpperCase();
    if (!/^TRV-[A-Z0-9]{6}$/.test(code)) {
      return Response.json({ error: "Invalid session code." }, { status: 400, headers });
    }
    const candidateName = String(body?.candidateName || "").slice(0, 120);
    const secret = resolveSessionSecret();
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: claim, error } = await client.rpc("claim_candidate_session", {
      target_code: code, candidate_user: candidateUser.id, display_name: candidateName,
    });
    if (error || !claim) throw new Error("Candidate claim failed.");
    if (claim.error) {
      return Response.json({ error: claim.error }, { status: claim.status_code, headers });
    }
    const exp = Math.floor(Date.parse(claim.expires_at) / 1000);
    if (!claim.session?.internal_id || !Number.isFinite(exp) || exp <= Date.now() / 1000) {
      throw new Error("Invalid candidate claim.");
    }
    const sessionToken = await issueSessionToken({
      sessionId: claim.session.internal_id, channelId: claim.session.id,
      joinCode: code, candidateName, userId: candidateUser.id, exp,
    }, secret);
    return Response.json({
      session: claim.session, sessionToken, expiresAt: new Date(exp * 1000).toISOString(),
    }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch {
    console.error("candidate-join failed");
    return Response.json({ error: "Could not join session." }, { status: 500, headers });
  }
});
