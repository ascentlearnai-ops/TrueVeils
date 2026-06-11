const encoder = new TextEncoder();

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
