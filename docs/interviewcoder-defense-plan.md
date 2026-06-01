# Interview Assistant Defense Plan

TrueVeils should treat Interview Coder-style tools as a combined evidence problem, not a single detector problem. These tools usually rely on a hidden overlay, screen-capture exclusion, live transcription, prompt reading, and fast generated answers.

## Current v1 Controls

- Watch restricted AI sites and assistant app names by default: ChatGPT, Claude, Gemini, Copilot, Perplexity, Poe, Phind, You.com, Interview Coder, Cluely, Final Round, LockedIn, Parakeet, LeetCode Wizard, Ultracode, and Interview Copilot.
- Detect foreground app, browser title, and browser URL when Windows UI Automation exposes it.
- Warn and refocus the candidate instead of killing processes.
- Scan for screen-capture-excluded overlay windows and report them as critical evidence.
- Score transcripts as AI-assistance risk, while treating short fragments as inconclusive.
- Combine transcript risk with behavioral evidence in the final session score.

## Interview Design Rules

- Ask candidates to explain decisions while coding, not just produce a final answer.
- Interrupt with follow-up questions tied to their previous sentence.
- Ask for an alternative implementation or trade-off after the first solution.
- Include one company-specific constraint that generic AI answers are unlikely to anticipate.
- Use short live debugging tasks where the candidate must reason from a failing test.
- Treat repeated restricted-site or overlay evidence as grounds for manual review, not automatic guilt.

## Future Stronger Controls

- Browser extension for exact tab URL and page-title capture.
- Optional screen-share attestation for coding interviews.
- Keystroke/paste cadence analysis in a first-party code editor.
- Network/proxy mode for organizations that can require managed devices.
- Signed challenge prompts that change mid-interview to make precomputed AI output stale.
