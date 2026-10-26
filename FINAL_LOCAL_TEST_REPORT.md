# Truveil Final Local Test Report

Date: October 25, 2026 UTC

Result: local checks passed; not a live Internet or submission-readiness sign-off.

Historical snapshot of the local-only test task before the later approved release.
Its unpublished status, installer paths and outstanding hosting approval below
describe that earlier task. The later publication and current test evidence are
in `APP_CHALLENGE_READINESS.md` and `output/playwright/demo-release/results.json`;
use `TWO_PC_DEMO.md` for the current rehearsal setup.

## Verified

| Scope | Result |
| --- | --- |
| Recruiter, Secure, relay, backend and website API regressions | 566 tests; 14/14 source-only groups; no skipped tests |
| Optional AI-review engine | 70 tests with fake providers; no paid inference |
| Rendered demo screens | 18 state/viewport checks; no missing visible images or horizontal overflow |
| Disposable browser tabs | Notifications, exact selected same-host tab close, protected meeting tab and revocation passed |
| Real extension action popup | 35 checks; actual popup identity and unchanged worker sender guard |
| Windows builds | Both unsigned x64 NSIS installers built locally; embedded app sources verified |
| Packaged executable flow | Real Electron main/preload/renderer IPC and loopback WebSocket room passed |
| Audio-to-caption plumbing | Chromium fake device, actual PCM worklet, synthetic speech-provider responses, captions on both apps |
| Built-in checker | Reliable-word window analyzed and saved with the actual confirmed answer in the report |
| Notes and reports | Real HTML report, notes, report listing, cancel-delete and confirm-delete passed |
| Settings and recovery | Saved preferences, bridge revocation and cancel after relay shutdown passed |
| Auxiliary checks | JavaScript syntax, Python calibration-script compilation and Git whitespace checks passed |

The latest full native run and installer hashes are recorded in
`output/playwright/final-local/results.json`. Injected-result-to-paint times are
local plumbing measurements, excluding recognition and Internet delay. They are
not evidence of a one-second real-speech guarantee or improved recognition accuracy.
Checker results remain advisory, not AI-authorship probabilities.

## Repair

Reopening the browser popup previously showed unchecked permission boxes while
sharing remained active. The display now mirrors active permissions, clears on
revocation and preserves the user's not-yet-submitted choices while idle. Six new
regression tests cover this. Neither server authority nor sender checks changed.

The rendered test also minted its two-minute pairing code too early during a slow
Chromium startup. It now starts the disposable browser before requesting pairing;
the real expiry was not extended or bypassed.

## Local Installers

- Recruiter: `.readiness/final-local/recruiter/TruveilRecruiter-Setup-1.0.0.exe`
- Secure: `.readiness/final-local/candidate/TruveilSecure-Setup-1.0.0.exe`

The packaged apps were tested with isolated profiles. Test guards were injected
before app startup to block external requests, process monitoring, protocol
registration and external report opening. Reports were actually generated and
checked on disk; their automatic browser launch was intercepted. The initial
startup-runner diagnostic ignored the usual require hook and briefly registered
the QA recruiter executable; its protocol handler was restored to the verified
existing installed Truveil executable. Subsequent runs used a pre-main debugger
hook with isolation confirmed before any app code executed.

The installer wizard itself was not run. These are unsigned Windows x64 beta
builds, not verified across all Windows versions, hardware, ARM64 or 32-bit PCs.
Nothing was copied to website downloads, deployed, committed or pushed.

## Evidence

- `.readiness/latest.json`: source regression results.
- `output/playwright/demo-rooms/results.json`: screen/layout and tab-close results.
- `output/playwright/extension-popup/QA-SUMMARY.md`: popup evidence and repair tests.
- `output/playwright/final-local/results.json`: packaged flow, source hashes and installer checksums.
- `output/playwright/final-local/*-packaged-session.png`: actual packaged-app screens.

## Outstanding at This Snapshot

- Approve and configure the hosted TLS relay and speech service, then approve publication.
- Run an attended two-PC test on different Wi-Fi networks with explicit microphone consent.
- Measure actual speech accuracy and real end-to-end caption delay using a known spoken reference.
- Verify installed Chrome/Edge toolbar interaction and the installer/SmartScreen experience.
- Complete human acceptance, the demo video and accurate student AI-use/contribution disclosure.

Legacy Supabase anonymous candidate sign-in is separately deferred. No cloud test
accounts were recreated and no prior deployment was repeated. Tests here do not
substitute for those legacy cloud gates.
