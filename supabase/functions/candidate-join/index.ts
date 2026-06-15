import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { issueSessionToken } from "../_shared/session-token.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authorization = request.headers.get("authorization") || "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      },
    );
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return Response.json({ error: "Anonymous candidate sign-in required." }, {
        status: 401,
        headers: corsHeaders,
      });
    }

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
    if (!["waiting", "candidate_ready"].includes(session.status)) {
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
    const { count: existingCandidates } = await client.from("session_participants")
      .select("user_id", { count: "exact", head: true })
      .eq("session_id", session.internal_id)
      .eq("participant_role", "candidate")
      .neq("user_id", authData.user.id);
    if ((existingCandidates || 0) > 0) {
      return Response.json({ error: "This session already has a candidate." }, {
        status: 409,
        headers: corsHeaders,
      });
    }

    const { error: participantError } = await client.from(
      "session_participants",
    ).upsert({
      session_id: session.internal_id,
      user_id: authData.user.id,
      participant_role: "candidate",
      candidate_name: String(candidateName || "").slice(0, 120),
      expires_at: new Date(exp * 1000).toISOString(),
    });
    if (participantError) throw participantError;

    const { data: sessionDetails } = await client.from("sessions").select(
      "technical_vocabulary,candidate_name,role_title,policy_preset",
    ).eq("internal_id", session.internal_id).maybeSingle();

    const sessionToken = await issueSessionToken({
      sessionId: session.internal_id,
      channelId: session.id,
      joinCode: code,
      candidateName: String(candidateName || "").slice(0, 120),
      userId: authData.user.id,
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
        technical_vocabulary: sessionDetails?.technical_vocabulary || [],
        role_title: sessionDetails?.role_title || "",
        policy_preset: sessionDetails?.policy_preset || "standard_technical",
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
