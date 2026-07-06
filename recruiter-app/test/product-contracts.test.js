const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');

test('admin website uses a site-local installer and honest advisory language', () => {
  const html = read('landing/index.html');
  assert.match(html, /\/downloads\/TruveilRecruiter-Setup-1\.0\.0\.exe/);
  assert.doesNotMatch(html, /github\.com\/.*releases/i);
  assert.match(html, /Advisory evidence/i);
  assert.doesNotMatch(html, /img\/candidate\.png/i);
  assert.match(html, /workflow-cinema/i);
  assert.match(html, /cinema-panel/i);
  assert.doesNotMatch(html, /admin-app-real\.png|candidate-app-real\.png/i);
  assert.doesNotMatch(html, /truveil-horizontal-transparent\.png/i);
});

test('packaged recruiter runtime config never contains provider secrets', () => {
  const writer = read('recruiter-app/scripts/write-runtime-config.js');
  assert.doesNotMatch(writer, /deepgramApiKey|groqApiKey/);
});

test('candidate-facing copy does not expose an AI score', () => {
  const html = fs.readFileSync('D:/Truveil-Client/src/renderer/index.html', 'utf8');
  assert.doesNotMatch(html, /AI-assistance risk|integrity percent|cheating score/i);
});

test('admin app separates email sign-in codes from candidate TRV codes', () => {
  const html = read('recruiter-app/src/renderer/index.html');
  const renderer = read('recruiter-app/src/renderer/dashboard.js');
  const main = read('recruiter-app/main.js');
  assert.match(html, /Create interview code without email/);
  assert.match(html, /candidate receives the TRV session code/i);
  assert.match(html, /This is the candidate code/i);
  assert.match(html, /sessionServiceNotice/);
  assert.match(renderer, /manualSessionMode/);
  assert.match(renderer, /Candidate code created/);
  assert.match(renderer, /Manual code generated/);
  assert.match(renderer, /Open local dashboard/);
  assert.match(renderer, /Manual code mode is active/);
  assert.match(main, /functions\.invoke\('create-session'/);
  assert.doesNotMatch(main, /if \(authData\.session\?\.user\) \{\s*const result = await client\.functions\.invoke\('create-session'/);
});

test('admin app creates a shareable candidate invite link and message', () => {
  const html = read('recruiter-app/src/renderer/index.html');
  const renderer = read('recruiter-app/src/renderer/dashboard.js');
  assert.match(html, /Share interview invite/);
  assert.match(html, /candidateInviteMessage/);
  assert.match(html, /copyInviteMessageBtn/);
  assert.match(html, /openCandidateLinkBtn/);
  assert.match(renderer, /buildCandidateInviteMessage/);
  assert.match(renderer, /\?code=\$\{encodeURIComponent\(code\)\}&open=1/);
  assert.match(renderer, /Open Truveil Secure here/);
  assert.match(renderer, /mailto:/);
});

test('admin app requires recruiter notice and human-review confirmation', () => {
  const html = read('recruiter-app/src/renderer/index.html');
  const renderer = read('recruiter-app/src/renderer/dashboard.js');
  assert.match(html, /Recruiter confirmation/);
  assert.match(html, /noticeConfirmedInput/);
  assert.match(html, /policyConfirmedInput/);
  assert.match(html, /humanReviewConfirmedInput/);
  assert.match(html, /not be used as the sole hiring decision/i);
  assert.match(renderer, /recruiterConfirmationReady/);
  assert.match(renderer, /Confirm candidate notice, session policy, and human-review use/);
});

test('admin legal pages disclose advisory use and collection boundaries', () => {
  const privacy = read('landing/privacy.html');
  const terms = read('landing/terms.html');
  const legal = read('landing/legal.html');
  assert.match(privacy, /No camera video/i);
  assert.match(privacy, /No screen recording/i);
  assert.match(privacy, /No clipboard collection/i);
  assert.match(terms, /sole basis for an employment decision/i);
  assert.match(terms, /best-effort Windows desktop controls/i);
  assert.match(legal, /Clear/);
  assert.match(legal, /High-priority review/);
  assert.match(legal, /not legal advice/i);
});

test('production hardening removes legacy anonymous session and audio access', () => {
  const migration = read('supabase/final-access-hardening.sql');
  assert.match(migration, /drop policy if exists "Truveil recent session-code access"/);
  assert.match(migration, /revoke all on public\.sessions, public\.audio_chunks from anon/);
  assert.match(migration, /private\.can_access_session\(s\.internal_id\)/);
  assert.match(migration, /revoke all on function public\.cleanup_expired_session_audio\(interval\)/);
  assert.doesNotMatch(migration, /to anon/);
});

test('admin transcript scoring uses response windows and session vocabulary', () => {
  const main = read('recruiter-app/main.js');
  assert.match(main, /ResponseWindowAnalyzer/);
  assert.match(main, /analyzeResponseWindow/);
  assert.match(main, /technicalVocabulary/);
  assert.match(main, /streamEpoch/);
  assert.match(main, /utteranceId/);
  assert.match(main, /finalReason/);
  assert.match(main, /responseWindowWordCount/);
});
