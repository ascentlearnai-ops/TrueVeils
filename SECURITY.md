# Truveil Security Overview

This document describes the security posture of Truveil and the runbook for
rotating credentials and responding to incidents. Truveil handles interview
transcripts and behavioral evidence, so treat all session data as sensitive.

## Architecture trust boundaries

- **Recruiter app (Electron)** and **Candidate app (Electron)** run on end-user
  machines. They talk to Supabase Edge Functions over HTTPS/WSS. They never hold
  provider secrets (Deepgram/Groq); those live only in Supabase.
- **Supabase Edge Functions** are the only components with the service-role key.
  Every function independently verifies either a Supabase JWT (recruiter actions)
  or a signed candidate session token (candidate actions).
- **Candidate session tokens** are HMAC-SHA256 signed with `SESSION_TOKEN_SECRET`
  and expire after 4 hours. The signing/verification secret is resolved
  fail-secure (see `supabase/functions/_shared/session-token.ts`): it uses
  `SESSION_TOKEN_SECRET`, falls back only to the server-only service-role key,
  and throws if neither is set. It never falls back to the publishable anon key
  or a hardcoded constant.
- **Database** enforces row-level security. Anonymous clients have no direct
  table grants on `sessions` or `audio_chunks`; audio access is restricted to the
  authenticated session participant via `private.can_access_session`.

## Hardening applied

- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
  (both apps), `setWindowOpenHandler` denies renderer-spawned windows,
  `will-navigate`/`will-redirect` block navigation off the local renderer,
  webview attachment denied. Candidate app grants only audio media permission.
- Renderers ship a strict Content-Security-Policy (`default-src 'none'`,
  `script-src 'self'`, no `unsafe-eval`). Candidate renderer additionally allows
  `connect-src wss://api.deepgram.com` for the live transcription socket.
- Landing sites (Vercel) send CSP, HSTS (2-year, preload), `X-Frame-Options:
  DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` denying camera/mic/geolocation, and COOP `same-origin`.
- Edge function CORS is restricted to an origin allowlist (`_shared/cors.ts`).
  This is defense-in-depth only; auth is always enforced regardless of origin.
- `shell:open-external` in the recruiter app is allow-listed to `mailto:` and the
  client Vercel origin.
- Dependencies: both Electron apps report 0 npm vulnerabilities. The legacy
  `backend/` Express relay (not in the production Supabase path) has one
  non-applicable `uuid` advisory affecting only v3/v5/v6-with-buffer; the backend
  uses `uuidv4()` exclusively.

## Credential rotation runbook

All secrets live in **Supabase → Project Settings → Edge Functions → Secrets**
(or via `supabase secrets set`). To rotate:

1. **Deepgram key**: create a new Member-role key in console.deepgram.com, then
   `supabase secrets set DEEPGRAM_API_KEY=<new>`. No redeploy needed. Revoke the
   old key after confirming live transcription still mints tokens.
2. **Groq key**: `supabase secrets set GROQ_API_KEY=<new>` in console.groq.com.
3. **Session token secret**: `supabase secrets set SESSION_TOKEN_SECRET=<new 32+
   byte hex>`. Rotating this invalidates all in-flight candidate tokens (max 4h
   impact); do it between interviews.
4. **Supabase anon/service keys**: rotate in Supabase dashboard → API. The anon
   (publishable) key is embedded in the shipped apps via
   `src/config/runtime-config.json`, so rotating it requires rebuilding and
   redistributing both installers.
5. **Supabase access/personal token** used for CI or admin CLI: revoke at
   supabase.com/dashboard/account/tokens; these are never needed at runtime.

## If a key is exposed

1. Rotate the affected secret immediately (above). Provider keys (Deepgram/Groq)
   are server-only, so rotating in Supabase fully cuts off the leaked value.
2. If the **anon key** or **service-role key** leaked: rotate in Supabase, then
   rebuild/redistribute the apps (anon) — the service-role key is never shipped,
   so a leak there implies the Supabase project itself was compromised; rotate
   and review the audit log.
3. If `SESSION_TOKEN_SECRET` leaked: rotate it; all existing candidate tokens
   become invalid, forcing re-join.
4. Review recent `reports`/`session_events` rows for anomalous access.

## Reporting

Security issues: email security@truveil.com (or the founder directly for the
beta). Do not open public GitHub issues for vulnerabilities.
