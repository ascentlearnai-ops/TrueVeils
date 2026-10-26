import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSessionSecret, verifySessionToken } from "./session-token.ts";

type CandidateAccess =
  | { ok: true; sessionId: string; userId: string; expiresAt: number; technicalVocabulary: unknown }
  | { ok: false; status: number; error: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expiry(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : NaN;
}

// Check current membership and session in one joined read. A signed token is
// not sufficient after cancellation, membership revocation, or either expiry.
export async function authorizeCandidateAccess(
  token: string, allowedStates: readonly string[],
): Promise<CandidateAccess> {
  try {
    const claims = await verifySessionToken(token, resolveSessionSecret());
    if (!record(claims) || typeof claims.sessionId !== "string" || !claims.sessionId ||
      typeof claims.userId !== "string" || !claims.userId ||
      typeof claims.exp !== "number" || !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= Date.now()) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await service.from("session_participants")
      .select("session_id,user_id,participant_role,expires_at,session:sessions!inner(internal_id,status,expires_at,technical_vocabulary)")
      .eq("session_id", claims.sessionId)
      .eq("user_id", claims.userId)
      .eq("participant_role", "candidate")
      .maybeSingle();
    if (error) {
      return { ok: false, status: 503, error: "Could not verify candidate access." };
    }
    if (!record(data) || data.session_id !== claims.sessionId || data.user_id !== claims.userId ||
      data.participant_role !== "candidate" || !record(data.session) ||
      data.session.internal_id !== claims.sessionId) {
      return { ok: false, status: 403, error: "Current candidate membership is required." };
    }
    const session = data.session;
    if (typeof session.status !== "string" || !allowedStates.includes(session.status)) {
      return { ok: false, status: 409, error: "This session cannot accept this request." };
    }
    const expiresAt = Math.min(claims.exp * 1000, expiry(data.expires_at), expiry(session.expires_at));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return { ok: false, status: 410, error: "Candidate access has expired." };
    }
    return { ok: true, sessionId: claims.sessionId, userId: claims.userId, expiresAt, technicalVocabulary: session.technical_vocabulary };
  } catch {
    return { ok: false, status: 503, error: "Could not verify candidate access." };
  }
}
