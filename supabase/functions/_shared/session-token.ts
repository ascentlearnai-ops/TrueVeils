const encoder = new TextEncoder();

// Resolve the HMAC secret used to sign/verify candidate session tokens.
// Fail-secure: never fall back to a hardcoded constant or to the publishable
// anon key (which ships inside the candidate app). SUPABASE_SERVICE_ROLE_KEY is
// always injected into the edge runtime and is never exposed to clients, so it
// is the only safe fallback if SESSION_TOKEN_SECRET is not set. Issuer and all
// verifiers import this, so they always agree on the secret.
export function resolveSessionSecret(): string {
  const secret = Deno.env.get("SESSION_TOKEN_SECRET") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) {
    throw new Error(
      "Session token secret is not configured (SESSION_TOKEN_SECRET missing).",
    );
  }
  return secret;
}

function base64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function signature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
    ),
  );
}

export async function issueSessionToken(
  claims: Record<string, unknown>,
  secret: string,
) {
  const payload = base64Url(JSON.stringify(claims));
  return `${payload}.${await signature(payload, secret)}`;
}

export async function verifySessionToken(token: string, secret: string) {
  const [payload, supplied] = String(token || "").split(".");
  if (!payload || !supplied || await signature(payload, secret) !== supplied) {
    return null;
  }
  try {
    const json = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
    const claims = JSON.parse(json);
    if (!claims.exp || Number(claims.exp) < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
