# Speech and Evidence Quality

October 24 changes. These are implementation and regression improvements,
not a measured speech-accuracy or AI-authorship benchmark. Guest candidate sign-in
is deferred at the user's request. The later attended microphone test is described
below; the original implementation checks used synthetic audio only.

## Latest Local Review

The latest user-approved report-summary publication is live on both correct
download sites. The default report shows actual score, why, and captured passages
with available session-relative timestamps. Full evidence remains expandable;
missing timing or context is never invented. Scores were not inflated or relabeled
as definite AI use. A genuine zero-score display bug was fixed.
765 automated tests, 16 source-and-installer groups, 11 packaged synthetic flows
and three report viewport checks passed; actual downloaded installer bytes matched.
Both packages now prefill the directly-honors-unlike-sets relay. No real microphone,
paid provider, hosting restart, backend deployment or Windows security change was
performed. Receipts: `.readiness/report-summary-release-20261025/` and
`.readiness/desktop-ui-publication.json`. Earlier figures below are historical.

Latest follow-up: review chunks now target 30 words (25-35 where possible), while
live captions continue independently. Short tails are retained rather than dropped;
numeric scoring still requires at least 35 reliable continuous words. Closed review
windows cover 120 words and final tail merges remain bounded. Actual model scores
are unchanged: no forced 80+/under-30 demonstration mapping was added.

Secure now lets the candidate select their microphone, explicitly requests echo
cancellation/noise suppression and no video/system audio, and locks selection
during joining/active sessions. Refreshing the list does not capture audio, and an
unavailable selected device is never silently replaced. Recruiter rejects explicit
non-candidate transcript roles. Headphones are still needed to prevent interviewer
audio from reaching the candidate microphone; this is not speaker diarization.

756 automated tests, 16 source-and-installer groups, 30 offline viewport checks and
11 actual packaged Windows workflow checks passed; independent review found no
blockers. User-approved publication is complete on both correct websites, with
the downloaded installer hashes verified and all 104 non-download files unchanged.
Both packages contain the current working relay default. No physical microphone,
paid speech/inference, hosting restart, backend deployment or Git commit/push was
used. Hardware echo cancellation and real-speech accuracy/latency remain unmeasured.
Evidence: `.readiness/desktop-ui-publication.json`,
`output/playwright/candidate-audio/results.json` and
`output/playwright/demo-release/results.json`. The earlier snapshots below are historical.

### Earlier 18-Word Review Snapshot

The user kept the extension-based tab workflow. No native/full-browser control
was retained. Recruiter rows now reconcile in place, retain pending commands even
when temporarily absent, preserve keyboard focus across reordering, and ignore
late results after consent/session revocation. All close operations still require
confirmation and exact-tab/removal checks. The current palette is preserved.

New review chunks target 18 words (16-20 where possible), but numeric scores use
at least 35 reliable continuous words of surrounding context. Missing/uncertain
recognition and stream/source/epoch/gap boundaries never bridge context. Larger
final windows feed a concise coverage report, with all chunks and captured text
available. Context-sharing badges do not double-count the original session score.
The snapshot scorer has isolated history; no training or external inference is
involved. /100 pattern scores are experimental, not authorship probabilities.

Final verification: 676 source tests and 14/14 source-only groups; 30 offline
viewports and actual disposable Chromium-extension closing/protection/revocation;
five native Windows source-app fake-audio checks, including final chunk scores and
report. Final local synthetic tab-to-sidebar was about 130 ms; injected-caption
paint opportunity about 97 ms; 100 identical inventories updated in 1.5 ms with
stable nodes and focus. These exclude real recognition and Internet/two-PC timing.
No new microphone/provider run, package build, publication or backend deployment
occurred. Published installers remain intentionally stale relative to local source.

The last attended run, `1d2ee4cb-0dfe-4309-a439-cab449ccdfcc`, completed at
15:40:01 UTC after the human pressed Start. It delivered 16 confirmed spans,
105 recognized words, one original checker window and all 75 updates to both
app DOMs, including 12 backgrounded updates; observed tracks stopped at the
90-second limit and no raw audio was saved. The user confirmed window switching
worked. Provider-estimated DOM lag: interim median 493 ms / p95 8,076 ms; confirmed
median 1,429 ms / p95 5,816 ms. Local controller-to-DOM median 83 ms / p95 100 ms.
This does not establish steady one-second latency, pixel/acoustic ground truth,
Teams/Meet-call compatibility, or two-PC validation. Reference reading was not
confirmed, so no valid full-passage WER is available. It predates this new review
UI and must not be used as accuracy evidence for later changes.

## Historical Publication Notes

Local background-operation changes after the release below are not yet packaged
or published. Both app windows now avoid background timer throttling; Secure
requests prevent-app-suspension only during the authorized active session, with
cleanup releasing it. The attended test requires explicit background consent and
no longer stops on minimize, but Stop/close/Escape and its 90-second limit remain.
641 source tests and 14/14 source-only groups pass. A native fake-audio check
verified both specific app windows minimized, a concurrent synthetic audio stream,
46 PCM packets over 2.2 seconds, both-app DOM delivery, built-in checker/report,
and local track/power cleanup. This is not actual Teams/Meet compatibility or a
real-speech latency/accuracy benchmark. Published manifests are intentionally
stale relative to these new local source changes.

The earlier attended public-relay run (`85a59714-7efe-4b0f-b056-a0d7d115e2bc`)
was stopped by the old test controller's minimize rule. Provider access succeeded;
18 confirmed words were insufficient for the checker. The recorded segment does
not contain the full reference, so the stored passage difference cannot establish
full-passage WER despite the user's report of reading it. No both-visible timing
sample was established; no raw audio was saved. The revised observer records
exact-identity DOM delivery separately from foreground geometry/frame evidence;
neither is ground-truth acoustic timing or verified pixel presentation. All 53
local test-tool regressions and the no-capture native controller smoke passed.

The user-approved October 25 demo release is published on both matching websites,
with exact downloaded installer hashes verified. It includes the account-free
room-authorized relay, fast captions, bearer handshake repair, client Truveil
spelling hints and built-in checker changes below. The temporary public TLS relay
runs on the user's PC and requires that PC to remain online and awake.

The latest follow-up passed 635 source tests and 16/16 source-and-installer groups.
Nine packaged-app flow checks passed with synthetic audio/provider input;
injected-result-to-both-paints was about 116 ms, excluding recognition and Internet
latency. Thirty rendered viewport checks and 35 actual extension-popup checks also
passed. The earlier 70 separate offline AI-review tests are historical evidence.
Six earlier public synthetic relay checks
verified transport and authorization without a microphone or speech-token request.
These are not measurements of real accuracy or a one-second speech guarantee.

No new microphone or paid inference run occurred during publication. Demo speech
failure offers Retry, not the production chunk-upload fallback. Attended two-PC
speech/browser evaluation remains required. Backend vocabulary/privacy changes
remain undeployed; transcribe-chunk v16 is unchanged. Fresh candidate sign-in is a
deferred gate for legacy Supabase mode, not a prerequisite for the separate demo.
See APP_CHALLENGE_READINESS.md, TWO_PC_DEMO.md and
`output/playwright/demo-release/results.json` for current release evidence.

## Caption Recovery Follow-Up

The user's unavailable-caption screenshot exposed local recovery defects, not a
proven provider-side cause. Synthetic regressions reproduced a 900 ms reconnect
colliding with the server's 10 second grant cooldown, a stale watchdog invalidating
a manual retry, ignored provider Error frames, and retries resetting on socket
open without useful recognition. These paths are repaired in the current apps.

- Fresh grants wait at least 10.25 seconds after settlement and respect the
  existing three-grants-per-minute limit. The live relay and its budgets did not
  change. Credentials are never reused across speech sockets.
- Requests are single-flight; retry attempts have fresh watchdog grace and bounded
  startup timers. Only useful new recognition resets the failed-recovery count.
- Safe failure descriptions and close codes remain visible, with a retry countdown.
  Late caption acknowledgements keep confirmed words without hiding the failure.
  Direct streaming never silently starts backup uploads or claims audio was sent
  when it was not. Fourteen new fake-only recovery/UI regressions cover these paths.
- The healthy path retains 50 ms PCM packets, 100 ms interim relay and independent
  checker scheduling with the 35 reliable-word gate. Recovery cooldown is not
  recognition latency; the local paint timing above excludes provider/network time.
- No new physical microphone, real-provider authorization check or paid inference
  occurred. Actual current provider access, accuracy and two-PC latency require the
  user's attended retest. The original provider-side failure is not established.

## Local Name and Evidence Follow-Up

These changes were first verified locally without microphone or paid inference.
Their desktop portions are now published as described above; backend portions
remain local and require separate review/approval before deployment.

- Direct streaming always hints `Truveil`, followed by valid interview vocabulary.
  Duplicate case variants, empty/non-string values, controls, and overlong terms
  are ignored. NFC normalization and conservative 30-term/320-UTF-8-byte limits
  keep names intact while bounding request size; this is not an exact tokenizer.
- Backend streaming and chunk requests use vocabulary from the already-authorized
  session read, with the same membership/lifecycle/expiry checks. No new database
  round trip is added. The Whisper backup gets at most 200 bytes of spelling
  context. The original provider output and measured confidence remain untouched,
  even if a provider still returns `TrueVale`. No automatic phonetic replacement
  or LLM rewrite is performed.
- Implementation follows [Deepgram keyterm prompting](https://developers.deepgram.com/docs/keyterm)
  and [Groq spelling-context guidance](https://console.groq.com/docs/speech-to-text).
  Proper-name recall improvement must still be measured with fresh consented audio.
- Built-in evidence matching recognizes `I'm` / `we're` without turning denials,
  explicit questions, or the apostrophe in `ma'am` into current-use claims.
  Explicit affirmative replies can survive omitted punctuation. This remains
  conservative English pattern matching, not general semantic understanding.
- Forty-eight focused speech regressions pass. They use fabricated examples,
  not training or fixtures copied from private interviews. An actual recruiter
  path test preserves original captions, waits for 35 reliable words, and
  distinguishes question/denial context from an explicit current-use admission.
- The 50 ms PCM frames, 100 ms trailing interim relay, and deferred checker are
  unchanged. Six offline caption viewport checks passed; injected result to both
  paints was about 97 ms in the final run, excluding recognition and network latency. The native
  oscillator startup check passed without requesting a physical microphone or
  provider token. These results do not establish real speech accuracy or a
  one-second speech-to-screen guarantee. Final suite receipt: `.readiness/latest.json`.
  The final observed shared checkout passed 465 tests and 13/13 source-only groups;
  that total includes other concurrent provider-review work. Independent review
  found no remaining actionable regression in this follow-up's scoped changes.

## Local Low-Latency Caption Update

The caption implementation was initially local only. Implementation verification used
no real audio or provider inference. The later user-approved attended microphone
test completed with a local relay; no deployment, website change, or installer
publication was performed. Real-microphone timing estimates are available, but
word-error rate and the two-computer cloud path remain unmeasured.

- Attended-test preparation verified credentials and performed no-audio WebSocket
  handshakes. Temporary JWTs failed with the old `token` protocol (401), but
  connected with `bearer`. The local candidate client now uses `bearer`, covered
  by a new actual-renderer regression and the existing static contract. All 410
  source tests pass. This repairs authentication, not recognition accuracy.
- The ignored `.readiness/mic-test` runner uses an explicit Start/Stop control,
  a 90-second limit, provider model-improvement opt-out, no saved raw audio,
  and no other-app monitoring. Its two app views use a local synthetic session
  and relay, not production sign-in or the cloud connection. Display probes
  match exact caption identity/revision and viewport visibility; failed and
  superseded observations are reported rather than silently omitted.
- The first attended attempt yielded no captions or timing observations and
  stopped when minimized. The user reports a live indicator, so no inference
  about provider connection should be made from the original request counter.
  It is an incomplete test, not a 100% word-error benchmark. The revised test
  records separate microphone, audio-packet, socket, and provider-message
  diagnostics. A generated oscillator replay verifies the local capture/worklet
  startup path only; real speech accuracy remains unmeasured.
- The user-started retry delivered 11 confirmed chunks to both app views and
  two checker windows (40 and 46 reliable words). All 49 tracked updates were
  observed on both views. Estimated interim delay was 388 ms median / 841 ms
  p95; confirmed-span delay was 975 ms median / 2218 ms p95. The estimate uses
  provider word timestamps and one PC, with synthetic session/auth/relay
  boundaries. It is not precise ground-truth timing or cloud/two-computer E2E.
  All observed mic tracks stopped on minimize. No raw audio was saved.
- The user spoke freely instead of reading the reference, so the fixed-passage
  comparison is invalid as an accuracy percentage. The brand was transcribed
  "TrueVale" instead of "Truveil". The private test receipt and readable review
  are under `.readiness/mic-test/results`; no transcript was added to Atlas.

- Deepgram Nova-3 remains the streaming provider. No new checker API is used;
  the recruiter still runs `LocalRisk` through `ResponseWindowAnalyzer`.
- PCM frames are 50 ms at 16 kHz mono. Fractional resampling is preserved for
  44.1/48 kHz inputs. Excess queued socket audio triggers reconnect instead of an
  unbounded stale backlog. This can lose audio during a network outage; no claim
  of lossless outage recovery is made.
- Interim text is revisable and display-only, with a trailing relay within
  100 ms. Every confirmed provider span is sent immediately with a stable ID,
  capture bounds and word-weighted confidence. Utterance ends clear draft tails,
  not flush a delayed checker queue. Reconnect never promotes an unfinished draft.
- The candidate has a live caption panel. Recruiter captions are displayed before
  deferred checker work and updated in place when analysis is available. Failed
  analysis abstains without removing recognized words. Failed final delivery has
  at most three attempts using the same identity; exhausted retries show a gap.
- A complete checker window still needs at least 35 reliable words. Interim,
  uncertain, replayed, or late out-of-order evidence is not promoted to a verdict.
  Window duration spans actual capture bounds, including pauses between packets.
- Captions retain short natural acknowledgements and one-letter words. There is
  no LLM rewrite or punctuation/filler cleanup before the checker. Existing
  silence/recognition-artifact safeguards still apply; accuracy must be measured.
- Speech energy is matched to capture bounds in a bounded two-minute numeric
  meter history, not the silence at recognition-result arrival. Missing meter
  history keeps speech visible but makes the checker abstain. No raw audio is
  retained by this meter history.
- All local Deepgram URLs opt out of model improvement. This parameter affects
  these future requests, not past data or existing production function bundles.

### Local Verification Versus Real Latency

Run `npm run readiness:check` in `recruiter-app` while current source matches the
approved published installers. After new local-only app edits, use `--source-only`
and explicitly record that the public manifests no longer match the changed source.
`node .readiness/live-caption-qa.cjs` from TrueVeils runs the saved offline replay
with both real browser renderers/preloads and the actual recruiter main/checker,
but synthetic candidate IPC and provider results. It forbids microphone and
network access. The result-to-render timing excludes recognition and the real
network, so it cannot establish one-second speech-to-caption latency.

For further authorized evaluation, measure first useful interim and stable-final delay
from the end of spoken words independently, with p50/p95 over quiet/noisy devices,
accents, technical vocabulary and network conditions. Evaluate word error rate,
missing/duplicate words, and correct abstentions against reference transcripts.
Use synchronized audio/visual measurement or account for cross-device clock skew;
do not subtract independent device clocks as if they were synchronized.

## Audio Pipeline

- PCM conversion preserves its fractional sample position across audio blocks,
  including 44.1 kHz and 48 kHz inputs. Tests use synthetic waveforms, not speech.
- Final transcript messages are assembled by provider time range. Repeated words
  at different times are retained; replayed final messages do not count twice.
  A fresh join gets a new identity namespace so relaunch/rejoin cannot overwrite
  earlier speech, while retries of the same segment keep a stable identity.
  The previous release flushed buffered finals at end markers; the local update
  above now sends them incrementally. Reconnect retains the finalized
  prefix without promoting an unfinished interim hypothesis.
- Word confidence is aggregated by word count, including zero-confidence words.
  Missing confidence remains unknown. Absolute capture timestamps survive retries.
- Fallback recording no longer adds a deliberate 250 ms gap between segments.
  MediaRecorder stop/start overhead and clipped boundary phonemes still require
  a real-device listening test; this is not a claim of gapless recording.
- The server's chunk path tries Whisper Large V3 when Nova-3 returns weak, empty,
  or unknown-confidence speech. It requests verbose segment metadata, filters
  likely silence artifacts, and retains reviewable primary text if recovery fails.
  Each provider has a 12-second deadline, including its JSON response body.
  Session access is rechecked before each upload. No new provider was introduced.
- Whisper likelihoods are not converted into a made-up confidence percentage.
  Whisper text remains visible, but transcript-based AI scoring abstains when
  recognition confidence is unavailable. Monitored behavioral evidence remains
  independent of transcript scoring.

## Detection Changes

`truveil-risk-v2.6.0` retains the existing scoring weights and review boundary.
Its new evidence/quality gates:

- Exclude unreliable speech from response windows, rather than averaging it away.
- Keep uncertain recognized speech visible with a review explanation.
- Separate quoted examples, reported questions, negated/hypothetical use, and past-use context from
  explicit current-answer AI use. This is conservative English pattern matching,
  not a complete language-understanding system.
- Require stronger assistant artifacts before text alone can raise high priority;
  ordinary markdown, answer labels, and polished wording are not sufficient.
- Give direct-use evidence priority in explanations instead of hiding it behind
  larger contributions from generic style patterns.
- Correlate observed events with speech capture time, not delayed delivery time.
  Capture bounds also survive the storage-backed fallback path.
  Title-only matches cannot become verified event correlations.
- Weight response confidence by words, reset across reconnects/long pauses, and
  do not interpret the gap between STT messages as interview-answer latency.
- Keep style-only confidence low. Scores are heuristic review priorities, not
  probabilities of cheating or a validated percentage of AI authorship.

## Regression and Release Checks

Run `npm run readiness:check` from `recruiter-app`; it includes the new waveform,
provider-handler, confidence-contract, transcript replay, and contextual-use tests.
Both website demo bundles are regenerated from the same updated scoring source.
Synthetic tests cannot establish real-world false-positive/false-negative rates.
After further unreleased app edits, use `--source-only` until a new rebuild is approved.
Independent review reproduced three additional bugs (join identity reuse,
reported-denial attribution, and fallback timing); all were repaired and rechecked
with targeted actual-path tests. No remaining actionable findings in that scope.

For actual accuracy evaluation, obtain consented recordings with independently
written reference transcripts. Include quiet and noisy microphones, technical
names, natural repetitions, pauses, accents, and network interruption. Measure
word error rate and missing/duplicate words separately from latency. Keep those
recordings out of source control. Use held-out labeled examples to assess review
false positives, missed events, and abstentions without tuning to the demo script.

The user separately approved the backend transcription handler deployment:
`transcribe-chunk` version 16 is active, with JWT verification retained and source
readback matching the reviewed bundle. No-audio deployment/access smoke checks
passed; no provider transcription calls or real-speech evaluation were performed.
The later user-authorized desktop UI release published rebuilt, source-verified
installers on both sites; their live hashes were verified. Existing production
website demo bytes were preserved, so the newer local recruiter demo bundle was
not published. Fresh installers must be rebuilt after further source changes;
public downloads are not updated by running tests. See APP_CHALLENGE_READINESS.md.

## Provider References

- [Deepgram final and endpoint semantics](https://developers.deepgram.com/docs/understand-endpointing-interim-results)
- [Deepgram streaming latency and packet sizing](https://developers.deepgram.com/docs/measuring-streaming-latency)
- [Deepgram model-improvement opt-out](https://developers.deepgram.com/trust-security/your-data)
- [Deepgram confidence semantics and calibration limits](https://developers.deepgram.com/docs/confidence)
- [Groq accuracy-first model guidance and segment metadata](https://console.groq.com/docs/speech-to-text)
