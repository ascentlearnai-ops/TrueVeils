import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";

function joinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `TRV-${
    [...bytes].map((value) => alphabet[value % alphabet.length]).join("")
  }`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, {
      status: 405,
      headers: { ...corsHeadersFor(request), allow: "POST, OPTIONS" },
    });
  }
  const authorization = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (!bearer || bearer === Deno.env.get("SUPABASE_ANON_KEY")) {
    return Response.json({ error: "Recruiter sign-in is required." }, {
      status: 401,
      headers: corsHeadersFor(request),
    });
  }

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      },
    );
    const { data: authData, error: authError } = await userClient.auth.getUser(bearer);
    const authUser = authData?.user;
    if (authError || !authUser?.id || authUser.is_anonymous || !authUser.email) {
      return Response.json({ error: "Recruiter sign-in is required." }, {
        status: 401,
        headers: corsHeadersFor(request),
      });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid session details." }, {
        status: 400, headers: corsHeadersFor(request),
      });
    }
    let candidateUrl: URL;
    try {
      const base = new URL(body.candidateAppUrl || "https://truveil-secure.vercel.app");
      if (base.protocol !== "https:" || base.username || base.password) throw new Error();
      // Older desktop builds still send the retired candidate hostname.
      if (base.hostname === "truveil-client.vercel.app") base.hostname = "truveil-secure.vercel.app";
      candidateUrl = new URL("/", base);
    } catch {
      return Response.json({ error: "Invalid candidate app URL." }, {
        status: 400, headers: corsHeadersFor(request),
      });
    }
    const policy = body.policy || {};
    if (typeof policy !== "object" || Array.isArray(policy) ||
      [policy.allowed_apps, policy.allowed_sites, policy.blocked_sites].some((items) =>
        items !== undefined && (!Array.isArray(items) || items.length > 100 ||
          items.some((item: unknown) => typeof item !== "string" || item.length > 2048))
      )) {
      return Response.json({ error: "Invalid session policy." }, {
        status: 400, headers: corsHeadersFor(request),
      });
    }
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        auth: { persistSession: false },
      },
    );
    const code = joinCode();
    candidateUrl.searchParams.set("code", code);
    candidateUrl.searchParams.set("open", "1");
    const sessionData = {
      id: code,
      candidate_link: candidateUrl.href,
      candidate_name: String(body.candidateName || "").slice(0, 120),
      role_title: String(body.role || "").slice(0, 160),
      technical_vocabulary: Array.isArray(body.technicalVocabulary)
        ? body.technicalVocabulary.map((item: unknown) => String(item).slice(0, 80)).slice(0, 40)
        : [],
      policy_preset: String(body.policyPreset || "standard_technical").slice(0, 40),
      allowed_apps: policy.allowed_apps || [],
      allowed_sites: policy.allowed_sites || [],
      blocked_sites: policy.blocked_sites || [],
    };
    const { data: result, error } = await service.rpc("create_recruiter_session", {
      recruiter_user: authUser.id,
      workspace_name: `${authUser.email.split("@")[0]} workspace`,
      session_data: sessionData,
    });
    if (error || !result) throw new Error("Session creation failed.");
    if (result.error) {
      return Response.json({ error: result.error }, {
        status: result.status_code, headers: corsHeadersFor(request),
      });
    }
    if (!result.session?.internal_id || result.session.recruiter_id !== authUser.id) {
      throw new Error("Invalid created session.");
    }
    return Response.json({ session: result.session }, {
      headers: { ...corsHeadersFor(request), "content-type": "application/json" },
    });
  } catch {
    console.error("create-session failed");
    return Response.json({ error: "Could not create session." }, {
      status: 500,
      headers: corsHeadersFor(request),
    });
  }
});
