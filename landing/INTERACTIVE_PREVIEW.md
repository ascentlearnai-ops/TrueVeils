# Interactive interview preview

The recruiter homepage bundles the existing `recruiter-app/src/ai/local-risk.js`
engine. It displays a heuristic signal out of 100, not the percentage of text
written by AI and not a calibrated authorship probability.

- Source: `recruiter-app/src/website/demo-model.js` and `interview-demo.js`.
- Build from `recruiter-app`: `npm run build:website-demo`.
- Verify from `recruiter-app`: `npm test`.
- Browser output: `landing/interview-demo.js`; do not edit this generated file.
- Layout: `landing/interview-demo.css` and the homepage interview panel.

Each text edit is evaluated independently. Animation speed, paste speed, and
earlier edits never become interview-history or timing evidence. Only the labeled
sample scenario injects a simulated restricted-tool event. Custom answers stay in
the page's memory and are neither transmitted nor persisted. The English-language
heuristics have false positives and false negatives and require human review.

Both websites use `motion.js` / `motion.css` to make the large hero Tavi turn in
place. A generated left-to-right turn film is sought to the pointer's horizontal
position. The scene is not translated and the normal cursor is unchanged. The
old floating mascot and its preference control have been removed. Gaze animation
respects the scene pause button, coarse pointers, reduced motion, Save Data and
page visibility. The existing HQ film remains the loading/error fallback.

The build also generates an audience-specific typing bundle and copies the
stylesheet to the sibling `Truveil-Client` checkout when present. The candidate panel animates sample and
practice transcripts, including a live word count and collection boundaries.
The candidate bundle excludes the recruiter risk engine and score renderer.
API keys are not part of either website or the browser bundle.

The gaze controller coalesces pointer events and seeks directly to the newest
encoded pose. It never restarts a pending seek or eases through a queue of old
positions. Selected Magic Hour turn intervals use short, all-keyframe clips
instead of repeating a few poses across six seconds. The candidate clip uses
60fps optical interpolation. The recruiter clip keeps its original 24fps poses
because interpolation produced visible eye artifacts. Each video declares its
frame rate so the controller avoids decoding the same pose redundantly.
Additional text reveals and finite mascot greetings are limited to visible
content and disabled for reduced motion or Save Data. Controls remain stable.

Recruiter DOM tests cover delayed decoding and dropped stale pointer events.
The three cross-repository candidate DOM checks explicitly skip in a standalone
recruiter checkout; candidate bundle privacy checks also run in its own suite.
