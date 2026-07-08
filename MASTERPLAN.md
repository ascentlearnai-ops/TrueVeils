# TRUVEIL MASTER PLAN

> **The end goal: get into Y Combinator and have 100+ companies using Truveil.**
> Every session — human or AI — reads this file first and asks: *does today's work move one of those two numbers?*
>
> Last updated: 2026-07-08. Update the "Current State" and "Scoreboard" sections whenever reality changes.

---

## 1. North Star

| Goal | Target | Status |
|---|---|---|
| YC acceptance | Fall 2026 (**apply by July 27, 2026, 8pm PT**) or Winter 2027 (~Nov 2026) with traction | Not yet applied |
| Companies using Truveil | 100+ (any paid plan counts; a design partner counts) | 0 → count here |
| Interviews verified | Leading indicator — 10 interviews/week = real usage | 0 → count here |

**One-sentence pitch:** Truveil catches AI-assisted interview fraud in real time — a recruiter-side command center plus a consent-based candidate check-in app that streams live transcripts, flags restricted AI tools the moment they're used, and produces evidence-first review reports a hiring team can actually defend.

**Why now:** Interview Coder/Cluely-style invisible AI overlays have 100k+ users; Gartner projects 25% of candidates will be fake or AI-assisted by 2028; a bad hire costs ~$28k. Nobody else combines live speech-pattern analysis + OS-level restricted-tool detection + candidate consent in one product.

**Positioning sentence for all copy:** *"Advisory evidence, not accusations."* This is a legal/trust moat, not a hedge. Never let any session, model, or marketing draft add "guaranteed detection" language.

---

## 2. Current State (as of 2026-07-08)

**Product (shipped, working, verified):**
- Recruiter Command Center (Electron, Windows): session codes, policy presets, live transcript, evidence timeline, interviewer notes, review bands (Clear / Review / High-priority review / Incomplete evidence), session verdict estimate, HTML report.
- Truveil Secure candidate app (Electron, Windows): TRV-code join, explicit consent, live Deepgram nova-3 transcription (direct websocket, ~300ms endpointing), foreground monitoring, restricted-AI-site close+report.
- Detection engine v2.5.0: ~40-signal logistic model (linguistic + behavioral + tempo), response windows (35+ words), per-candidate disfluency baseline, session-end verdict aggregation. 60 tests.
- Backend: Supabase (hardened RLS, fail-secure session tokens, CORS allowlist, all six edge functions deployed and smoke-tested end-to-end). Deepgram + Groq keys server-side.
- Marketing sites (Vercel): trueveil.vercel.app (admin), truveil-client.vercel.app (candidate). Security headers + HSTS.
- Installers built + checksummed + release-checked. 75 total tests green. SECURITY.md runbook exists.

**Known gaps (be honest in YC interviews):**
- Windows-only. No macOS build (blocks ~half of startup recruiters).
- No billing — "paid beta" has no payment rail yet.
- No auto-update for installed apps.
- Unsigned installers (SmartScreen warning on download).
- Risk-model weights are expert-set, not statistically calibrated on labeled data (report discloses this — keep it disclosed).
- Zero real users as of this writing.

**Non-negotiable product rules (from CODEX_HANDOFF.md — never violate):**
1. Advisory language everywhere; no guaranteed-detection claims.
2. Candidate never sees AI scores or risk analysis.
3. No camera, screen recording, file access, or clipboard collection.
4. Raw audio never retained; transcripts + events are the record.
5. Provider secrets (Deepgram/Groq) live only in Supabase, never in shipped apps.
6. All 75 tests must pass before any commit ships; contract tests define the product's legal surface.

---

## 3. The Scoreboard (update weekly)

| Week of | Outreach sent | Demos booked | Sessions run | Active companies | Paying | MRR |
|---|---|---|---|---|---|---|
| 2026-07-06 | — | — | — | 0 | 0 | $0 |

Rule: if two consecutive weeks show zeros in "Sessions run," stop building features and do only distribution work until it moves.

---

## 4. Milestones

### M0 — Launch week (now → July 14)
- [ ] Push all commits, deploy sites, verify downloads work from a clean machine.
- [ ] One real two-machine end-to-end interview test (recruiter + candidate, real mic).
- [ ] Record a 2-minute demo video: create session → candidate joins → says an answer → ChatGPT opens and gets closed+flagged → verdict + report. This video is the #1 sales asset and the YC demo.
- [ ] Set up Stripe Payment Links ($9 Starter / $29 Growth) — crude is fine; a link in the app beats no billing.
- [ ] First 50 cold emails (see Marketing §6).

### M1 — First 10 real users (July → early August)
- [ ] 10 companies have run ≥1 real interview each.
- [ ] Collect 3 written quotes / mini case studies ("we caught X" or "we cleared a suspicion in Y").
- [ ] **Apply to YC Fall 2026 by July 27** — apply even with thin numbers; the application is free and the video + working product carry it. If rejected, reapply Winter 2027 with traction (rejection→acceptance on reapply is common and YC says so).
- [ ] Start the calibration dataset: label every real session (interviewer's judgment vs. verdict). This becomes the accuracy story.

### M2 — Design partners & retention (August → September)
- [ ] 25 companies, 5 paying. Weekly session count growing.
- [ ] macOS candidate app (biggest funnel unblock — candidates on Mac can't join today).
- [ ] Auto-update (electron-updater) so shipped bugs are fixable.
- [ ] Code-signing certs (Windows EV + Apple Developer) — kills the scariest onboarding moment.
- [ ] Publish first calibration numbers (precision/recall on labeled sessions) — even n=40 beats vibes.

### M3 — YC-ready traction (September → November)
- [ ] 100 companies target; 20+ paying; churn understood.
- [ ] Winter 2027 application (if not already in Fall batch): the story is "X companies, Y interviews verified, Z% caught-or-cleared rate, growing W%/week."
- [ ] One lighthouse customer (staffing agency or 50+ eng-hires/yr company) with a named case study.

### M4 — Scale (post-YC or post-100)
- ATS integrations, enterprise features, SOC 2 — see Roadmap §5 Horizon 3.

---

## 5. Product Roadmap (build in this order)

### Horizon 1 — Remove adoption blockers (next 4–6 weeks)
| Feature | Why | Size | Suggested model |
|---|---|---|---|
| Stripe billing (Payment Links → then in-app gating by plan) | Can't have 100 customers without a way to pay | S→M | Sonnet 5 |
| macOS candidate app (Electron is cross-platform; port scanner.js AppleScript path, entitlements for mic) | Unblocks ~50% of candidates | M | Opus 4.8 |
| Auto-update via electron-updater + GitHub Releases | Ship fixes without re-download emails | S | Sonnet 5 |
| Code signing (Windows EV cert ~$300/yr, Apple $99/yr) | SmartScreen warning kills conversions | S (mostly ops) | Human + Haiku for scripts |
| In-app onboarding checklist (first-run tour on both apps) | Self-serve activation without a call | S | Sonnet 5 |
| Session history search + report re-download in Command Center | Recruiters need yesterday's report | S | Sonnet 5 |

### Horizon 2 — Deepen the moat (weeks 6–14)
| Feature | Why | Size | Suggested model |
|---|---|---|---|
| Calibration pipeline: labeled-session store + weekly precision/recall report (extend scripts/calibrate-risk-model.py) | Turns "expert-set weights" into defensible accuracy claims; YC interview ammunition | M | Fable 5 (design) + Sonnet 5 (build) |
| Two-voice diarization on recruiter loopback (Deepgram diarize=true) | Separate interviewer vs candidate speech → cleaner response windows | M | Opus 4.8 |
| Question-aware latency: detect interviewer question end → measure true answer latency | Strengthens the timing signals (nearZeroLatency currently approximate) | M | Opus 4.8 |
| Team seats + org dashboard (Supabase orgs already exist in schema) | $29 Growth plan needs multi-recruiter | M | Sonnet 5 |
| ATS export (CSV per session/candidate) + Slack webhook notifications | Cheap "enterprise-ish" checkboxes that close deals | S | Sonnet 5 |
| Multilingual transcription (Deepgram nova-3 language param + UI picker) | International staffing agencies ask first | S | Sonnet 5 |
| Second-monitor / HDMI-capture heuristics (screen.isExtended reporting, honest best-effort framing) | Common cheat vector; report-only, never claim blocking | S | Sonnet 5 |

### Horizon 3 — Enterprise & category leadership (post-traction)
- Greenhouse/Lever integrations (webhook a session link into the interview stage).
- Zoom Marketplace app (session inside the meeting, no second app) — big lift, big distribution.
- Voice-clone / deepfake-audio detection (partner API first, e.g. audio liveness vendors — do NOT build from scratch).
- SSO/SAML, audit logs, SOC 2 Type I (start the paper trail early — SECURITY.md is the seed).
- Compliance positioning: NYC Local Law 144 / EU AI Act — "advisory, human-review" framing is already aligned; write the whitepaper.
- Public API + webhooks for HR-tech platforms embedding Truveil.

### Explicitly NOT doing (say no to protect the moat)
- Camera proctoring / eye tracking — destroys the consent-first positioning.
- Auto-reject or scoring-as-decision features — legal poison; contract tests forbid it.
- Candidate-facing risk scores — same.
- Building our own ASR — Deepgram/Groq are cheaper than our time.

---

## 6. Marketing Plan

**ICP (in order):** (1) Founders/eng-leads at 10–200-person startups hiring remote engineers; (2) technical recruiting/staffing agencies (they interview all day — highest session volume); (3) fractional/RPO recruiters on LinkedIn.

**Core message ladder:**
1. Hook: "Interview Coder has 100k+ users. Your last 'great interview, weak on the job' hire may not have been unlucky."
2. Differentiator: live detection + consent-based candidate app + OS-level restricted-tool evidence — not an async proctoring camera.
3. Trust close: advisory evidence, human decision, no camera, no stored audio. (Lead with what we DON'T collect — it's the objection-killer.)

**Channels, in priority order:**
1. **Founder-led cold outbound (highest ROI now):** 25 emails/day to CTOs/heads-of-talent at companies with open remote-engineer roles (scrape from job boards). Template: 2 sentences of problem + the 2-min demo video + "free pilot for your next 5 interviews." Track in the Scoreboard.
2. **LinkedIn content:** 3 posts/week — screenshots of (anonymized) evidence timelines, fraud stats, "how invisible AI overlays actually work" education. Recruiters share this stuff; it's their nightmare topic.
3. **Communities:** r/recruiting, r/ExperiencedDevs (carefully, as education not ads), HN Show HN post ("Show HN: I built a counter-tool to Interview Coder"), recruiting Slack/Discord groups.
4. **SEO comparison pages (cheap, compounding):** "Interview Coder detector", "Cluely detection", "HireVue alternative for live interviews", "how to detect AI-assisted interviews" — one landing page each, static, on the Vercel site. Haiku/Sonnet can draft these in bulk.
5. **Product Hunt launch** once macOS ships (needs both platforms to avoid the top comment being "Windows only?").
6. **Partnerships:** technical-interview platforms (CoderPad, CodeSignal) lack live-fraud detection — an integration or co-marketing convo is warm.

**Pricing (keep simple, revisit at 25 customers):** Starter $9/mo (10 interviews), Growth $29/mo (unlimited, 5 seats), Enterprise custom. Free pilot = 5 interviews, card required for continuation. Unit cost ≈ $0.50/interview → ~94% gross margin; say this number in the YC interview.

---

## 7. YC Application Playbook

**Timeline:** Fall 2026 deadline **July 27, 2026 8pm PT** (apply — it's 19 days away and the product works). Winter 2027 (~Nov 2026, confirm at ycombinator.com/apply) is the reapply-with-traction shot. Late applications are reviewed but on-time is materially better.

**The one-liner for the form:** "Truveil detects AI-assisted cheating in live job interviews. Recruiters get real-time transcripts and evidence when candidates use tools like Interview Coder or ChatGPT; candidates get a consent-based check-in app instead of camera proctoring."

**What makes this YC-shaped — say these plainly:**
- Adversarial, growing problem (fraud tools have 100k+ users and VC funding — Cluely raised from a16z; we're the antibody, and antibodies scale with the disease).
- Live product with real engineering depth (40-signal model, sub-second live transcription, OS-level detection) built and shipped by a solo founder fast.
- 94% gross margin SaaS, land-and-expand into staffing agencies.
- Honest-by-design moat: consent + advisory framing survives the regulation wave that will kill camera-proctoring competitors.

**Questions to have crisp answers for (rehearse):**
1. *"How accurate is it?"* → "Behavioral evidence (they opened ChatGPT) is deterministic. Speech-pattern analysis is advisory and disclosed as such; we're building a labeled calibration set from every real session and publish precision/recall. We never auto-reject." Never bluff a number.
2. *"Can't candidates cheat around it?"* → "It's an arms race by design — same as spam/fraud. Each evasion is detectable (second device = latency + disfluency collapse signals). Our wedge is that ANY detection beats today's zero."
3. *"Privacy/legal?"* → consent-first, no camera/audio retention, advisory reports, NYC LL144/EU-AI-Act-aligned framing. It's in the product contract tests.
4. *"Why you?"* → your story: built the full stack solo, obsessed with the integrity problem, shipped in weeks.
5. *"Market size?"* → every remote hire is a session; staffing agencies alone run millions of interviews/yr; comp: HireVue $50k/yr enterprise contracts vs our $29 self-serve.

**Application assets checklist:**
- [ ] 1-min founder video (unscripted, energetic, show the product for 20 seconds of it).
- [ ] 2-min product demo video (M0 item — same asset).
- [ ] Metrics line, even if small: "X companies, Y interviews, launched Z weeks ago."
- [ ] Clear ask: what YC money buys (code signing, macOS, first hire, calibration data at scale).

---

## 8. Model Delegation Playbook

> How to drive this project with any Claude model. Copy-paste the Session Preamble, then use the per-model guidance. **Any model, any task: the Non-Negotiables in §2 apply.**

### Session Preamble (paste at the start of EVERY build session, any model)
```
Read C:\Truveil\TrueVeils\MASTERPLAN.md and both CODEX_HANDOFF.md files
(C:\Truveil\TrueVeils and C:\Truveil\Truveil-Client) before changing anything.
Rules: (1) evidence-first advisory language only — never claim guaranteed
detection; (2) candidates never see scores; (3) provider keys stay in Supabase;
(4) run `npm test` in recruiter-app and Truveil-Client before and after your
changes — all tests must pass; (5) test/product-contracts.test.js files define
strings/classes that must keep matching; (6) commit with clear messages, never
push without me. PATH note: prefix PowerShell with
$env:PATH = "C:\Program Files\nodejs;$env:PATH". Node is at C:\Program Files\nodejs,
Python at C:\Users\kanag\AppData\Local\Programs\Python\Python312.
My goal for this session: [TASK].
```

### Which model for which job

**Fable 5 (frontier — spend it where judgment compounds):**
- Detection-algorithm changes (new signals, weights, verdict logic) — mistakes here are product-credibility mistakes.
- Security-sensitive work (edge functions, RLS, token logic).
- Architecture decisions (diarization design, calibration pipeline design, Zoom app feasibility).
- Anything touching the legal/advisory copy surface.
- Final pre-release review of a big multi-session feature.

**Opus 4.8 (deep worker — complex multi-file builds):**
- macOS candidate app port (platform APIs, entitlements, scanner rewrite).
- Diarization + question-aware latency (audio pipeline + model interplay).
- Auto-update integration, protocol-handling edge cases.
- Debugging gnarly cross-process Electron issues.
- Prompt pattern: give it the feature row from §5, the preamble, and "explore the relevant files first, propose a short plan, then implement and test."

**Sonnet 5 (default builder — 80% of roadmap items):**
- Billing/Stripe, team seats, session history, ATS export, Slack webhooks, onboarding tour, multilingual picker, SEO pages, marketing site edits.
- UI work inside the established design system (both apps' styles are self-consistent — tell it to match existing patterns).
- Test-writing, refactors with green tests as the guardrail.
- Prompt pattern: one feature per session, point at the exact files ("recruiter-app/src/renderer/dashboard.js + index.html + styles.css"), require tests before/after.

**Haiku 4.5 (fast + cheap — volume and glue):**
- Drafting cold-email variants, LinkedIn posts, SEO comparison-page copy (a human or bigger model reviews before publish — advisory-language rule applies to marketing too).
- One-file scripts, checksum/release chores, CSV wrangling, git housekeeping.
- First-pass research summaries ("list ATS webhook docs for Greenhouse").
- Do NOT let it touch: detection engine, edge functions, legal pages, contract-tested files.

**Escalation rule:** if a smaller model fails the same task twice or tests go red and it can't recover in one attempt, stop and rerun the task one model tier up with the failure transcript pasted in. Never let a model "fix" a failing contract test by editing the test — that's a product-rule change and needs Fable 5 + explicit human sign-off.

**Verification floor for every session, every model:**
1. `npm test` green in both repos (60 + 15).
2. If renderer/site changed: app launches (or site previews) clean, no console errors.
3. If edge functions changed: redeploy + curl smoke test (401 without token, happy path with one).
4. Update this file's Scoreboard/Current State if reality changed.

---

## 9. Risks & Honest Mitigations

| Risk | Mitigation |
|---|---|
| Fraud tools evade linguistic detection (better prompts, humanized output) | Behavioral evidence (foreground/URL) is evasion-resistant; keep shifting weight toward deterministic signals; calibration set tells us when linguistic signals decay |
| A false accusation harms a candidate → reputational/legal blowup | Advisory framing, review bands, human-decision requirement, counter-evidence in every report — this is why the non-negotiables exist |
| Zero-user cold start | §6 outbound is the job; the Scoreboard rule forces distribution over building |
| Solo-founder bus factor / YC preference for teams | Address head-on in application: shipping velocity as evidence; consider a cofounder only if genuinely additive |
| Deepgram dependency | Groq + local-whisper fallbacks already wired; provider-agnostic transcriber interface exists |
| Proctoring-software stigma | Never adopt camera features; lead marketing with what we don't collect |
| Platform risk (Windows-only today) | macOS is Horizon 1, top priority after billing |

---

## 10. File Map (for any session finding its way)

- `MASTERPLAN.md` ← you are here; the always-referred-to plan.
- `CODEX_HANDOFF.md` (both repos) — technical state + recent-changes log.
- `SECURITY.md` — trust boundaries, key-rotation runbook.
- `recruiter-app/src/ai/` — detection engine (local-risk.js, feature-extractor.js, response-window.js, risk-model.json).
- `recruiter-app/src/review/verdict.js` — session-end verdict aggregation.
- `supabase/functions/` — the six edge functions (deployed).
- `test/product-contracts.test.js` (both repos) — the legal/product surface as executable assertions.
- `C:\Truveil\graphify-out\` — knowledge graph of both repos (graph.html to explore).
