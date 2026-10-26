# Standalone Demo Relay

Local implementation only. This service is separate from `backend/server.js`,
Supabase, production authentication, and the risk checker. It uses the existing
`backend/node_modules/ws` and Node 20+ built-ins; no install or build is needed.

From `TrueVeils/backend`:

```powershell
node --test demo/relay-client.test.js demo/spend-guard.test.js
# Set TRUVEIL_DEMO_HOST_KEY privately in this relay process before running the CLI.
node demo/cli.js
# Optional private interface / reverse-proxy deployment, not performed here:
node demo/cli.js --host 127.0.0.1 --port 43180
```

The default endpoint is `ws://127.0.0.1:43180/demo`. Nothing starts on import.
The CLI always requires `TRUVEIL_DEMO_HOST_KEY`, including when transcription is
unconfigured. Generate it with a cryptographically secure random generator: at
least 32 characters, preferably 32 random bytes encoded as base64url (43 chars).
Accepted encoding is 32-256 ASCII letters, digits, `_` and `-` (hex also works).
Length/encoding validation cannot prove randomness; do not use a human password.
Keep this value in the relay's private environment and give it only to authorized
hosts as an access code. Never put it in a build, runtime config, invitation,
settings storage, command-line argument, log or candidate message. Hosts enter
it transiently when creating a room; candidates never need it. No accounts or
sign-in are introduced. Missing or invalid configuration fails before listening.
Set `TRUVEIL_DEMO_RELAY_URL` in the Electron main-process environment for the
parent app integration. For remote use, use `wss://your-relay.example/demo`.
Only the relay process may receive `DEEPGRAM_API_KEY`; never put it in a client,
renderer, runtime config, installer, URL, or build environment. Without it,
token requests fail honestly. Tests inject fake providers/fetch; no provider
network requests are made by the test suite.

## Client Contract

Both app `src/demo/relay-client.js` files are byte-identical CommonJS modules
exporting `{ DemoRelayClient, normalizeRelayUrl }`.

```js
const client = new DemoRelayClient({ url, WebSocketImpl, timeoutMs: 12000 });
client.on('event', ({ event, payload }) => { /* Deliver directly to UI. */ });
client.on('join-request', ({ requestId, name }) => { /* Ask the host. */ });
client.on('closed', ({ reason }) => { /* Stop capture and discard authority. */ });
```

- `create(details, hostAccessCode)` connects as host and returns `{roomId, code, details, expiresAt}`.
  The access code is sent only as a top-level field in the create request:
  `{id, op:'create', data:details, hostAccessCode}`. It is not part of `details`,
  retained on the client, or returned in metadata/events. Missing/wrong codes get
  the same `Host access denied.` response. Non-create envelopes reject the field.
  Main-process callers must pass the transient UI value as the second argument,
  not merge it into session details or save it with relay settings.
- `join({code,name,consentConfirmed,microphoneReady,externalReviewConsent,tabObserveConsent,tabCloseConsent})`
  waits up to 120 seconds for host approval and returns the same metadata.
- `approve(requestId, allow)`, `update(details)`, `start()`, `end()` return acknowledgments.
- `send({type:'broadcast',event,payload})` returns `'ok'` or throws.
- `token()` returns `{ok:true,accessToken,expiresIn}` or throws. No API key is returned.
- `close()` is terminal local cleanup. A fresh client, room, and approval are required
  after disconnect; there is no reconnect, resume, or silent reauthorization.

`start()` requires an approved, consenting candidate with microphone readiness
and emits `session_started` exactly once. Do not broadcast that event manually.
`update()` sends `session_policy` with sanitized `policy`, `technicalVocabulary`,
and `details`. Captions and audio-level events are delivered directly, without
waiting for any checker. Raw/audio-chunk upload fallback is explicitly unsupported.

Candidates may broadcast only `candidate_transcript`, `candidate_audio_level`,
and allowlisted `candidate_event` types. Hosts may broadcast only `recruiter_action`
with `{action:'close_tab',target:{id,revision},commandId}`. `commandId` must be a
UUID; it is preserved (lowercase), recorded once, and cannot be replayed. The
target must match the latest shared tab snapshot, be unprotected, and have both
observation and close consent. No window/application closing or reopening exists.
Results use `candidate_event` type `browser_tab_close_result` and the same
`commandId`; unsolicited, expired (30 seconds), and duplicate results are denied.
Approved `candidate_ready` and review-consent events are accepted before start;
the `external-review-v1` consent object and bounded `privacyVersion` are preserved.
Both `candidate_review_consent` and `provider_review_consent_withdrawn` are supported;
the latter always carries `externalReviewConsent.enabled: false`.

Browser state is `{connected,observeConsent,closeConsent,tabs,events}`. Tabs carry
only `{id,hostname,active,protected,revision}`; titles, full URLs, paths and queries
are never forwarded. Opaque tab IDs (up to 128 safe characters) and nonnegative
integer IDs are supported; revisions are nonnegative integers or bounded opaque
strings. Empty hostnames are always protected, as are common meeting hosts.
An initial unpaired bridge is not a consent revocation. Withdrawal of observation,
or close consent on a connected bridge, cannot be reversed in that room.

## Security and Hosting Limits

- Room codes contain 80 random bits: `DEMO-` plus 16 RFC4648 base32 characters.
  Codes are capabilities, not identity verification. Host approval is mandatory.
- Room creation also requires the operator-issued host access code, compared
  using constant-time SHA-256 digest comparison. A room code cannot substitute
  for host access. There is no remote configuration or environment/CLI test bypass.
- Socket-bound roles and monotonic request IDs prevent client role overrides,
  cross-room selectors, and request replay. The server stamps `sessionId` with
  the room code plus `senderRole`, role, timestamp, and candidate name.
- 30-minute room lifetime; 32 rooms; 2 peers per room; 128 connections total;
  8 connections per socket IP; 30 upgrade attempts and 1,800 requests per IP per
  minute; 4,096 tracked IP buckets; 64 KiB incoming messages; 128 KiB outgoing
  queue; 128 tabs / 64 events; 256 close commands per room. Limits are fixed for CLI.
- Unbound sockets expire in 10 seconds. Heartbeats detect silent transport loss
  within approximately 20 seconds; an observed disconnect ends the room immediately.
  Pending cancellation, decline, end, expiry, consent withdrawal, rate overflow,
  and backpressure purge room state and close every member.
- No transcript storage or session-content logging. Only ephemeral room metadata,
  current browser state, command IDs, and rate counters are retained. Room state
  is cleared on termination; disconnected-IP rate counters expire after one minute.
- Tokens require an active approved candidate and microphone consent: at most
  one in flight, one per 10 seconds, three per minute, ten per room, five-second
  timeout, 30-second token TTL. End aborts requests and discards late results.
  Additional budgets span all rooms: **6 attempts per candidate socket IP per
  rolling 60 seconds, 24 attempts server-wide per rolling 60 seconds, and 100
  attempts over the relay instance/process lifetime**. Budget reservations occur
  synchronously before provider IO; failed, timed-out, cancelled, and invalid
  provider responses still count. Rejections do not invoke the provider.
  Grant counters are independent of room state and request/connection IP buckets.
  Ending rooms, disconnecting, and IP bucket cleanup cannot reset them. Only
  elapsed rolling-window time releases minute quotas; the lifetime count never
  expires while this relay exists. Tracking uses monotonic time and bounded
  queues/maps. Lifetime exhaustion requires explicit operator intervention, not
  a client reconnect. Restarting the relay resets these in-memory budgets;
  provider-side spend limits remain required across restarts or multiple processes.
  The grant adapter follows [Deepgram temporary token authentication](https://developers.deepgram.com/guides/fundamentals/token-based-authentication).
- An issued bearer token cannot be recalled by this relay, and its 30-second
  authentication TTL does not end an established Deepgram connection. Main-process
  integration must stop microphone capture and close the upstream stream on
  `closed`/`session_ended`. Enforcing provider-side shutdown against a malicious
  client would require an audio proxy, which this demo deliberately does not provide.
- Internet hosting requires a TLS WebSocket reverse proxy, private upstream
  listener, host key, upgrade support, external connection/rate controls and provider spend
  limits. Preserve `Origin`: the relay refuses every browser Origin header.
  Electron main-process `ws` sends none. `X-Forwarded-For` is ignored; behind a
  proxy all users share its IP limits. No implicit trusted-proxy mode exists.
- Single-process, in-memory only: restarts end every room; no multi-instance
  sharing, durable auth, production account isolation, or adversarial endpoint
  attestation. This is a consent-based supervised demo, not proof against a
  modified candidate app. TLS deployment, actual speech, and installers are unverified.

`createDemoRelay({limits, tokenProvider, hostKey})` is exported for isolated tests.
Fake-provider tests must explicitly supply a valid synthetic `hostKey` and use
it with `create(details, hostAccessCode)`; merely injecting a provider does not
bypass authorization. Only explicitly disabling the provider with
`{tokenProvider:null, hostKey:''}` permits keyless tests, and those instances may
bind only exact `127.0.0.1` or `::1`. Any other listener host requires a key,
including wildcard addresses and DNS names. The CLI has no such override.
`listen(0)` selects a free loopback port and `close()` shuts everything down.
`stats` exposes only aggregate room/peer/IP counts, never room contents.
