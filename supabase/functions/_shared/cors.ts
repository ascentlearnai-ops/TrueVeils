// CORS is defense-in-depth only: every function independently verifies a JWT or
// signed session token, so origin is never the security boundary. The Electron
// apps call these functions from their Node main process and are unaffected by
// CORS (Node fetch ignores these headers). This allowlist simply stops arbitrary
// browser pages from reading responses.
const ALLOWED_ORIGINS = new Set([
  "https://truveil-client.vercel.app",
  "https://trueveil.vercel.app",
  "https://truveil.com",
  "https://www.truveil.com",
  ...(Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);

const baseHeaders: Record<string, string> = {
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-session-token",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "vary": "Origin",
};

export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return { ...baseHeaders, "access-control-allow-origin": origin };
  }
  // No/unknown browser origin (includes Electron/Node callers, which send no
  // Origin): return base headers without ACAO. Non-browser clients ignore this;
  // unknown browser origins simply cannot read the response.
  return { ...baseHeaders };
}

// Backwards-compatible default used by functions that have not yet been updated
// to pass the request. Retains the permissive origin only as a transitional
// fallback; prefer corsHeadersFor(request).
export const corsHeaders: Record<string, string> = {
  ...baseHeaders,
  "access-control-allow-origin": "*",
};
