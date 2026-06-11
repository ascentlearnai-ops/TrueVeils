import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function joinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `TRV-${
    [...bytes].map((value) => alphabet[value % alphabet.length]).join("")
  }`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
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
    return Response.json({ error: "Sign in required." }, {
      status: 401,
      headers: corsHeaders,
    });
  }

  try {
    const body = await request.json();
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        auth: { persistSession: false },
      },
    );
    let { data: member } = await service
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", authData.user.id)
      .limit(1)
      .maybeSingle();

    if (!member) {
      const name = `${
        authData.user.email?.split("@")[0] || "Truveil"
      } workspace`;
      const { data: organization, error: organizationError } = await service
        .from("organizations").insert({ name }).select("id").single();
      if (organizationError) throw organizationError;
      const { error: memberError } = await service.from("organization_members")
        .insert({
          organization_id: organization.id,
          user_id: authData.user.id,
          role: "owner",
        });
      if (memberError) throw memberError;
      member = { organization_id: organization.id };
    }

    const code = joinCode();
    const policy = body.policy || {};
    const candidateBaseUrl = String(
      body.candidateAppUrl || "https://truveil-client.vercel.app",
    ).replace(/\/+$/, "");
    const { data: session, error } = await service.from("sessions").insert({
      id: code,
      join_code: code,
      candidate_link: `${candidateBaseUrl}/?code=${
        encodeURIComponent(code)
      }#download`,
      status: "waiting",
      flags: [],
      transcript: [],
      recruiter_id: authData.user.id,
      organization_id: member.organization_id,
      allowed_apps: policy.allowed_apps || [],
      allowed_sites: policy.allowed_sites || [],
      blocked_sites: policy.blocked_sites || [],
      blocking_mode: "warn_refocus",
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      retention_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString(),
    }).select("*").single();
    if (error) throw error;
    return Response.json({ session }, {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Could not create session.";
    return Response.json({ error: message }, {
      status: 400,
      headers: corsHeaders,
    });
  }
});
