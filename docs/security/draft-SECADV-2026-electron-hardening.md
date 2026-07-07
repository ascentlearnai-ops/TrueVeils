---
title: "Security Hardening 2026-07-07: Electron Sandbox + CSP, Fail-Secure Session Tokens, Locked-Down CORS and DB Grants"
severity: medium
ghsa_tag: v2026.07.07-hardened
patch_shas:
  - eb9cffa
  - 998089b
cwe_ids:
  - CWE-693
  - CWE-287
  - CWE-319
  - CWE-1004
  - CWE-284
state: draft
review_required: true
---

> **Note on `ghsa_tag`:** the value above is the *planned* release tag.
> The local git tag is created at push time; until
> `v2026.07.07-hardened` is tagged on `origin/main`, `git tag -l`
> will not show it. Draft is therefore committed before the tag exists.

# Security Hardening 2026-07-07: Electron Sandbox + CSP, Fail-Secure Session Tokens, Locked-Down CORS and DB Grants

**Repo:** `ascentlearnai-ops/TrueVeils`
**Release tag:** `v2026.07.07-hardened`
**Status:** Draft — do **not** Publish without operator review.

## Summary

A coordinated defense-in-depth release across the Truveil platform covering
the Electron desktop apps, Supabase edge functions, the Vercel landing
site, and the Postgres database. No single change closes a demonstrated
production exploit — together they remove the most likely paths to lateral
movement if any other link in the chain breaks.

## What's in this release

### 1. Electron renderer hardening
`BrowserWindow.webPreferences` now sets `sandbox: true` and
`contextIsolation: true`; `nodeIntegration` is disabled.
`app.on("web-contents-created")` blocks in-app navigation
(`will-navigate`) and unauthorized `window.open()` via
`setWindowOpenHandler`. Strict per-renderer CSP:

- `default-src 'none'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'` (kept narrow — UI requires it)
- `connect-src 'self' https://*.supabase.co`
- `img-src 'self' data:`
- `object-src 'none'`, `frame-ancestors 'none'`

### 2. Fail-secure session-token secret fallback
`_shared/session-token.ts` resolves the secret in order:

1. `SESSION_TOKEN_SECRET` (preferred)
2. `SUPABASE_SERVICE_ROLE_KEY` (fail-secure fallback)
3. **throw** if neither is set.

Previously the code silently fell back to `SUPABASE_ANON_KEY` or a
hard-coded constant — both would let a forged token pass HMAC
verification. `candidate-state` and `transcribe-live` now share a single
`sessionSecret` helper, so token-issuing and token-verifying logic
cannot drift apart. HMAC-SHA256 over a stable JSON payload with
**constant-time compare**.

### 3. Edge-function CORS restricted to an allowlist
`_shared/cors.ts` returns `Access-Control-Allow-Origin` only for an
explicit allowlist. An empty or missing `Origin` header no longer
gets a blanket allow.

### 4. Database ACLs tightened
- `anon` grants revoked on `audio_chunks` and `sessions`.
- Permissive storage policies that trusted JWT claims alone were
  dropped.

### 5. Vercel landing hardening headers
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Cross-Origin-Opener-Policy: same-origin`
- `Referrer-Policy: strict-origin-when-cross-origin`

### 6. Documentation
New top-level `SECURITY.md` documents the trust boundary, credential
rotation playbook, and incident response runbook.

## Severity

**Medium.** Defense-in-depth; no demonstrated in-the-wild exploit.
Removes latent paths to lateral movement across the renderer / edge /
DB boundary. CVSS v3.1 vector:
`CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:C/C:H/I:H/A:L` (score ~6.4).

CWEs:

- **CWE-693** — Protection Mechanism Failure (Electron sandbox off)
- **CWE-287** — Improper Authentication (anon-key token fallback)
- **CWE-319** — Cleartext Transmission (HSTS gap on landing)
- **CWE-1004** — Sensitive Cookie Without HttpOnly (renderer cookies)
- **CWE-284** — Improper Access Control (anon SQL grants)

## Affected versions

All builds shipped against `main` before the two commits below land.

## Patches

| SHA | Subject |
|-----|---------|
| `eb9cffa` | Align session-token secret fallback across edge functions |
| `998089b` | Security hardening: Electron sandbox/CSP, fail-secure token, locked CORS |

## Operator runbook

1. Pull `main` after `v2026.07.07-hardened` is tagged.
2. **Rotate `SESSION_TOKEN_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`** in
   the Supabase project env.
3. Re-build + re-sign the Electron installers.
4. Audit `supabase functions logs` for any prior `"Failed secret lookup"`
   entries; these indicate the insecure fallback was used in practice.
5. **Lock out the `SUPABASE_ANON_KEY` token-resolution fallback at the
   env layer.** Remove any env-derived helper that resolves a session
   secret via the anon key (search for `SUPABASE_ANON_KEY` references in
   `_shared/`). Re-deploy edge functions so the anon-key route is
   provably gone from the code path, not just underdocumented.

## Workarounds (if you cannot redeploy immediately)

The Electron sandbox and CSP gaps have no upstream workaround —
they require shipping the new build.

For the session-token failure mode alone:

- Force-set `SESSION_TOKEN_SECRET` to a 32-byte random value in your
  Supabase project env now.
- Audit `supabase functions logs` for `"Failed secret lookup"` errors
  in the last 90 days.

## Credits

Reported and fixed internally as part of the standing Truveil security
program. Implementation by CodeX.

## References

- `SECURITY.md` (added in 998089b) — trust boundary + incident runbook.
- OWASP Desktop App Security Top 10: M1 (Code Injection),
  M8 (Code Signing Failures).
- OWASP ASVS v4.0: V5 (Validation), V14 (Configuration).

---

> This file is tracked on branch `feat/advisory-drafts` in
> `C:\Truveil\TrueVeils\docs\security\`. To make it the canonical live
> advisory, press **Publish** on the GitHub Security Advisory draft at
> `https://github.com/ascentlearnai-ops/TrueVeils/security/advisories?state=draft`.
