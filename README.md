# Truveil Recruiter

This repository contains the code for the **Truveil recruiter website and desktop app**. Truveil helps interviewers follow remote interviews with live captions and evidence they can review afterward.

## What's in this repo

- **`landing/`** — the recruiter website, download page, guides, and interactive product preview.
- **`recruiter-app/`** — the Electron desktop app used to set up and run interviews.
- **`backend/` and `supabase/`** — supporting services for sessions, transcription, and reports.

## How the app works

1. The recruiter creates a new interview, adds candidate details, and chooses the session settings.
2. The candidate joins through Truveil Secure using an invitation code and reviews what will be shared.
3. The recruiter approves the candidate and follows the live transcript and available session evidence.
4. After the interview, the recruiter can review a report with the transcript and advisory signals.

Scores are experimental review signals. A person reviews the evidence and makes the decision.

**Candidate website and app:** [Truveil-Client](https://github.com/ascentlearnai-ops/Truveil-Client)
