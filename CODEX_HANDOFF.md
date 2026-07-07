# TrueVeils Codex Handoff

Last updated: 2026-07-06

## Project Map

- Admin repo: `ascentlearnai-ops/TrueVeils`
- Admin local path (current laptop): `C:\Truveil\TrueVeils`
- Admin Electron app: `C:\Truveil\TrueVeils\recruiter-app`
- Admin website: `C:\Truveil\TrueVeils\landing`
- Client repo: `ascentlearnai-ops/Truveil-Client` at `C:\Truveil\Truveil-Client`
- Client Electron app + client website live in the separate repo.
- Knowledge graph of both repos: `C:\Truveil\graphify-out\` (graph.html, GRAPH_REPORT.md).

## 2026-07-06 Launch-Prep Changes (Claude Code)

Detection (risk model bumped to `truveil-risk-v2.4.0`):

- New `recruiter-app/src/review/verdict.js`: session-end aggregate verdict
  (`computeSessionVerdict`) combining confidence-weighted transcript scores with
  the behavioral review band. Labels are advisory only: "Likely AI-assisted" /
  "Likely unassisted" / "Uncertain — needs review" / "Insufficient evidence".
  Wired into `main.js` `session:end`, the report (Session Verdict panel), and the
  Supabase `reports.summary.verdict`.
- New feature `disfluencyCollapse` (weight 0.85): candidate's filler/correction
  density vs their own session baseline (needs 3+ scored windows of history).
- New feature `suspiciouslyInstantAnswer` (weight 0.55): long answers that start
  <900ms after the previous response window. `ResponseWindowAnalyzer` now emits
  `priorSilenceGapMs`.
- `analyzeTranscript` result now includes `topContributors` (top-3 signed signal
  contributions) for explainability.
- Report footer now states weights are expert-configured, not statistically
  calibrated (do not remove — credibility/legal guard).

Transcription:

- Client live path (direct Deepgram nova-3 websocket) now reports real utterance
  `durationMs` (summed from Deepgram result durations), so tempo features
  (`pasteLikeTempo`) work on the primary path. Previously hardcoded 0.
- Deleted dead stub files `src/audio/recorder.js`, `src/websocket/client.js` in
  the client repo (never loaded; contradicted real architecture).

UI:

- Replaced acid-green `#e4f222` accent with restrained `#4ade80` across both
  Electron apps and both landing sites.
- Dashboard score widget shows a live verdict chip (`verdictChip`/`verdictMeta`
  in `dashboard.js`, mirrors verdict.js semantics).
- Both landing sites: staggered reveals, scroll-aware nav (`.scrolled`),
  sequenced evidence-timeline animation, self-drawing workflow progress line
  (`--flow-progress`), transform-based parallax. All IntersectionObserver-based,
  no libraries, reduced-motion safe.

Tests: 58 passing in recruiter-app (was 49; 9 new in
`test/session-verdict.test.js`), 15 passing in Truveil-Client. The
`product-contracts.test.js` client-repo path is now portable
(`TRUVEIL_CLIENT_DIR` env var or sibling-directory detection).

## Current Product Direction

TrueVeils is an evidence-first technical interview integrity product. The admin app creates a TRV session code, configures allowed apps/sites and restricted AI destinations, receives live transcript text, records behavioral evidence, and generates an advisory report. The candidate app joins by TRV code, gets consent, keeps the session active, streams microphone transcript signals, and reports restricted destination events.

Important product rules:

- No camera, screen recording, file access, or clipboard collection.
- Known restricted AI tools can be closed/refocused on Windows.
- Other app/tab switches should be observed and reported, not aggressively blocked.
- Reports use review bands: `Clear`, `Review`, `High-priority review`, `Incomplete evidence`.
- Do not claim guaranteed cheating detection or perfect AI detection.
- Raw audio should not be retained; transcripts and evidence are the durable records.

## Recent Admin Work

Latest relevant commit:

- `2447cfa Improve transcript windows and evidence scoring`

Key changes:

- Added `recruiter-app/src/ai/response-window.js`.
- Admin no longer scores every tiny ASR fragment.
- Final transcript segments are accumulated into response windows with at least 35 reliable words before AI-assistance analysis.
- Session technical vocabulary is passed into live, fallback, and manual transcript analysis.
- Generic polished transcript-only answers are capped at advisory review unless there is direct AI artifact/use evidence.
- Reports now include:
  - Transcript Pattern Context
  - Behavioral Evidence
  - Correlated Moments
  - Counter-Evidence

Validation at time of handoff:

- `cd D:\TrueVeils\recruiter-app`
- `npm test`
- Result: 34 passing tests.

## Environment Needed

Admin Electron app needs Supabase public client config:

```env
SUPABASE_URL=https://kcsrqobajprwpsyjiram.supabase.co
SUPABASE_ANON_KEY=<Supabase publishable/anon key>
```

Provider secrets should not be embedded in packaged apps. Deepgram/Groq secrets belong in server-side Supabase/Vercel functions if used.

## Common Commands

```powershell
cd D:\TrueVeils\recruiter-app
npm install
npm test
npm run build:win
```

```powershell
cd D:\TrueVeils
git pull origin main
git status
```

## Next Codex Prompt

When opening this repo in a new Codex app, paste:

```text
Continue TrueVeils from CODEX_HANDOFF.md. Work on the admin repo at D:\TrueVeils and the client repo at D:\Truveil-Client. First read CODEX_HANDOFF.md in both repos, then inspect git status before making changes.
```
