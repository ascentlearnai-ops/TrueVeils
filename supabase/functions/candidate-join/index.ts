import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { issueSessionToken } from "../_shared/session-token.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { joinCode, candidateName } = await request.json();
    const code = String(joinCode || "").trim().toUpperCase();
    if (!/^TRV-[A-Z0-9]{6}$/.test(code)) {
      throw new Error("Invalid session code.");
    }

    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: session, error } = await client
      .from("sessions")
      .select(
        "id,internal_id,join_code,status,allowed_apps,allowed_sites,blocked_sites,blocking_mode,expires_at",
      )
      .eq("join_code", code)
      .maybeSingle();
    if (error) throw error;
    if (!session) {
      return Response.json({ error: "Session not found." }, {
        status: 404,
        headers: corsHeaders,
      });
    }
    if (!["waiting", "active"].includes(session.status)) {
      return Response.json({ error: "This session has ended." }, {
        status: 409,
        headers: corsHeaders,
      });
    }
    if (session.expires_at && Date.parse(session.expires_at) < Date.now()) {
      return Response.json({ error: "This session code has expired." }, {
        status: 410,
        headers: corsHeaders,
      });
    }

    const exp = Math.floor(Date.now() / 1000) + 4 * 60 * 60;
    const sessionToken = await issueSessionToken({
      sessionId: session.internal_id,
      channelId: session.id,
      joinCode: code,
      candidateName: String(candidateName || "").slice(0, 120),
      exp,
    }, Deno.env.get("SESSION_TOKEN_SECRET")!);

    return Response.json({
      session: {
        id: session.id,
        internal_id: session.internal_id,
        join_code: session.join_code,
        status: session.status,
        allowed_apps: session.allowed_apps,
        allowed_sites: session.allowed_sites,
        blocked_sites: session.blocked_sites,
        blocking_mode: session.blocking_mode,
      },
      sessionToken,
      expiresAt: new Date(exp * 1000).toISOString(),
    }, { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Could not join session.";
    return Response.json({ error: message }, {
      status: 400,
      headers: corsHeaders,
    });
  }
});
