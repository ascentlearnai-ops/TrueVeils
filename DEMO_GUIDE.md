# Truveil Presentation Demo

## Open the demo

- Recruiter: https://truveil-recruiter.vercel.app/demo.html
- Candidate: https://truveil-secure.vercel.app/demo.html

These browser demos need JavaScript, but no account, email code, API key, or Windows installation. They use sample data, not private interviews. Once the page and scripts have loaded, text analysis does not need a server connection.

## Suggested walkthrough

1. Open the recruiter demo. Watch the sample answer type, or use **Show full sample** to stop the animation and inspect the complete answer.
2. Compare **Assistance signals** with **Grounded answer**. The restricted-tool event in the assisted example is explicitly simulated. A score is a heuristic signal strength, not the percentage written by AI or proof of misconduct.
3. Choose **Try your own**. Enter an English-language answer of at least 24 words. Analysis runs on-device using the same local risk engine as the recruiter app. Short answers receive no score. No app-activity evidence is invented for your text.
4. Open **The review** to see the answer and its evidence summary. A person must assess the context; Truveil does not make hiring decisions.
5. Use **Clear answer** to remove your typed answer and its review. Open the candidate demo to show the private transcript preview and the collection boundaries. The candidate preview does not display the recruiter's score.

## What this demonstrates

- Working sample playback, text analysis, evidence summaries, and candidate practice.
- The separation between transcript-only signals and simulated activity evidence.
- No microphone, camera, clipboard, or foreground-app access on these web pages.
- Typed demo answers are not sent to a server or stored by the application.

## What is separate

The Windows applications handle real sessions, consent, microphone transcription, foreground activity, and saved reports. Those require the deployed backend and an authorized session. The browser demo does not test those live services and must not be presented as live monitoring. Public recruiter email delivery remains unfinished and is not needed for this demonstration.

## Maintaining the demo

Run `npm run build:website-demo` from `recruiter-app` after editing the homepage preview or its source logic. This regenerates the bundles and dedicated `demo.html` pages for both neighboring repositories. Do not edit generated files by hand. Test with `npm test` in each app and `node --test landing/website-api.test.cjs` (recruiter) or `node --test website-api.test.cjs` (candidate).
