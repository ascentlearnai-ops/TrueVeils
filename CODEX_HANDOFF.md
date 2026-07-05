# TrueVeils Codex Handoff

Last updated: 2026-07-05

## Project Map

- Admin repo: `ascentlearnai-ops/TrueVeils`
- Admin local path used in this Codex thread: `D:\TrueVeils`
- Admin Electron app: `D:\TrueVeils\recruiter-app`
- Admin website: `D:\TrueVeils\landing`
- Client repo: `ascentlearnai-ops/Truveil-Client`
- Client Electron app + client website live in the separate repo.

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
