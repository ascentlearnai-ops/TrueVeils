# Truveil Competition Rehearsal

Status: rehearsal guide, not a claim that the live app has passed every check.
See APP_CHALLENGE_READINESS.md for the current release gates.

## Account-Free Demo Rehearsal

The latest demo uses a separate relay, not Supabase anonymous sign-in. Do not
follow the older account-based steps below for this mode. The current public
installers include this feature and the approved temporary TLS relay address.
Read `TWO_PC_DEMO.md` for the download links and private host-code location.
Keep the relay PC powered, online and awake during the whole rehearsal.

1. In Truveil, enter the demo server address and private host access code, then
   Create a demo room. Keep the host code and all API keys out of the Loom video.
2. Send only the candidate invitation, containing room code and relay address.
   Truveil Secure needs neither an email/password nor the private host code.
3. In Secure, enter the invitation and a synthetic name. Read the notice and
   grant microphone consent only when ready for an attended speech test. Tab
   observation and manual closing are separate optional checkboxes. External
   Pangram/OpenRouter review is a separate opt-in and can spend credits.
4. The host approves the expected candidate, reviews policy/notice confirmations,
   and starts. Verify captions on both computers using actual spoken words.
   Simulated captions and local replay timing are not proof of real accuracy.
5. For browser sharing, use a dedicated Chrome/Edge profile/window with only demo
   tabs. Open the included extension folder from Secure, load it unpacked using
   Developer mode, and verify ID `dmemhcgadchjgfpleneioeenkcjepbhk`. Click Connect
   browser in Secure, then open the extension from that demo window, paste its
   private pairing code, and explicitly Share this window. Closing needs its own
   checkbox in the extension as well as in Secure. Never share the pairing code.
6. Open a synthetic tab and verify the hostname notification. From Truveil select
   that tab's Close button and confirm. Verify only that tab closes, even with
   another tab on the same site. Do not test on personal or unsaved documents.
   Meeting hosts must remain protected. A notification is activity, not AI proof.
7. Stop sharing in either Secure or the extension. Verify the recruiter loses tab
   controls. End the interview and verify capture stops. Reports save locally;
   this demo does not establish cloud report persistence.
8. Test wrong/expired invitation, declined join, consent withdrawal while waiting,
   network loss, and speech-service failure. A disconnected room must not resume
   silently. Cancel the old room and create a fresh one with new approval.

Automated verification uses no physical microphone, paid speech, or personal tabs.
The current public downloads match the source-verified builds in each app's
`dist/` directory; source/embedded archive checks and native packaged-app flows
passed. Actual extension action-popup messaging also passed in
disposable Chromium. The installer wizard/SmartScreen, installed Chrome/Edge toolbar,
actual speech accuracy/timing and two-PC different-network rehearsal remain human
validation gates. Six synthetic public TLS relay checks passed; they do not replace
an attended two-PC rehearsal or establish actual speech accuracy/latency.

## Legacy Cloud-Account Mode

## Before Recording

- Use two Windows computers or two separate Windows user environments: one for
  Truveil Recruiter and one for Truveil Secure. Use synthetic candidate details.
- The published apps default to the account-free demo. The following legacy cloud
  workflow is separate and remains blocked by the deferred authentication gate.
- A provisioned recruiter account with a known password is required. No permanent
  judge account has been created by this readiness work. Public email delivery is
  not configured; do not make email sign-up part of the recorded demonstration.
- The approved backend deployment and provisioned-account cloud test are complete.
  Fresh guest candidate sign-in is still disabled in Supabase; resolve that
  configuration gate and verify a new candidate installation before recording.
- Obtain the participant's permission before microphone or foreground-app tests.
  Close private documents, messages, and unrelated apps. Never record passwords,
  API keys, private interview data, or sign-in codes in the submission video.

## Successful Interview

1. Open Recruiter and sign in with the provisioned email and password.
2. Create an interview with a synthetic candidate name, role, and a clearly
   explained policy. Copy its invitation code or candidate link.
3. Open Secure on the candidate computer. Enter the code, read the disclosure,
   consent, and select Start Secure Session. Allow the microphone preflight.
4. Confirm the candidate is waiting for the interviewer and Recruiter shows
   readiness. Start the interview from Recruiter.
5. Speak an original, ordinary answer. Verify that its actual words arrive in
   Recruiter. Do not substitute sample transcripts if transcription fails.
6. With permission, switch to one allowed app and one policy-restricted target.
   Check that the event identifies what was observed and respects the policy.
   An event is evidence to review, not proof of cheating or a hiring decision.
7. Add an interviewer note. End Session from Recruiter. Verify Secure stops
   capture and monitoring, and the local report opens with transcript and note.
8. Open Reports and confirm the cloud report is present. A local report alone is
   not proof that cloud persistence worked.

## Failure Checks

- Deny the microphone: no interview should start; explain the permission issue.
- Cancel before Start: the invitation must stop working without starting capture.
- End from Secure: local capture must stop immediately, and Recruiter must show
  the interruption rather than treating missing evidence as a clean interview.
- Disconnect the candidate network: check the disconnected state and that local
  capture stops. Reconnect only with the interviewer's knowledge and consent.
- End remotely while the candidate connection is recovering: the ended session
  must not start again. Use a fresh invitation for another interview.
- Temporarily fail report saving in the test harness: retain evidence and retry
  without duplicate reports. Do not deliberately disrupt production storage.

Record each result as pass, fail, or not tested. Log the app build, date, Windows
version, and steps for any failure. Never mark a simulated device check as a real
microphone or Windows monitoring test.

## Explain the App Honestly

Truveil combines a consented interview transcript with observed session events
and interviewer notes. Its risk signals are advisory and can be wrong. They do
not establish a scientifically validated percentage of AI authorship.

Explain the student contributions you actually made and the technical decisions
you understand. Disclose AI help with implementation, debugging, tests, and visual
assets. Use the recording sequence and official rules linked in the readiness
document; the student must review and submit the final entry.
