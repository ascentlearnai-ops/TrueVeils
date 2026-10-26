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
  assert.match(html, /role="tablist"/i);
  assert.match(html, /Interactive product preview/i);
  assert.match(html, /download\.html/i);
  assert.doesNotMatch(html, /href="waitlist\.html"/i);
  assert.match(html, /assets\/brand\/tavi/i);
  assert.doesNotMatch(html, /admin-app-real\.png|candidate-app-real\.png/i);
  assert.doesNotMatch(html, /truveil-horizontal-transparent\.png/i);
});

test('packaged recruiter runtime config never contains provider secrets', () => {
  const writer = read('recruiter-app/scripts/write-runtime-config.js');
  assert.doesNotMatch(writer, /deepgramApiKey|groqApiKey/);
});

const clientRepo = process.env.TRUVEIL_CLIENT_DIR
  || ['C:/Truveil/Truveil-Client', 'D:/Truveil-Client', path.join(repo, '..', 'Truveil-Client')]
    .find(dir => fs.existsSync(path.join(dir, 'src/renderer/index.html')));

test('candidate-facing copy does not expose an AI score', { skip: !clientRepo }, () => {
  const html = fs.readFileSync(path.join(clientRepo, 'src/renderer/index.html'), 'utf8');
  assert.doesNotMatch(html, /AI-assistance risk|integrity percent|cheating score/i);
});

test('admin app separates authenticated interviews from the no-sign-in browser demo', () => {
  const html = read('recruiter-app/src/renderer/index.html');
  const renderer = read('recruiter-app/src/renderer/dashboard.js');
  const main = read('recruiter-app/main.js');
  assert.match(html, /Open the interactive product preview/);
  assert.match(html, /authPasswordInput/);
  assert.match(html, /candidate receives the TRV session code/i);
  assert.match(html, /Share this code with your candidate to join in Truveil Secure/i);
  assert.match(html, /Keep this separate from the candidate's interview code/i);
  assert.match(html, /sessionServiceNotice/);
  assert.match(renderer, /Candidate code created/);
  assert.doesNotMatch(renderer, /Manual code generated|Manual code mode is active|manualSessionMode/);
  assert.match(renderer, /truveil-recruiter\.vercel\.app\/demo\.html/);
  assert.match(main, /functions\.invoke\('create-session'/);
  assert.match(main, /auth\.getUser\(\)/);
  assert.doesNotMatch(main, /upsert\(buildSessionPayload/);
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
  const cleanup = read('supabase/paid_beta_backend_access_cleanup.sql');
  const repair = read('supabase/paid_beta_p0_repair.sql');
  assert.match(migration, /drop policy if exists "Truveil recent session-code access"/);
  assert.match(migration, /revoke all on public\.sessions, public\.audio_chunks from anon/);
  assert.match(migration, /private\.can_access_session\(s\.internal_id\)/);
  assert.match(migration, /revoke all on function public\.cleanup_expired_session_audio\(interval\)/);
  assert.match(cleanup, /drop policy if exists "Truveil sessions access"/);
  assert.match(cleanup, /drop policy if exists "session access events"/);
  assert.match(cleanup, /drop policy if exists "session access transcripts"/);
  assert.match(cleanup, /drop policy if exists "organization access reports"/);
  assert.match(repair, /create policy "session participants insert audio chunks"/);
  assert.match(repair, /private\.can_access_session\(s\.internal_id\)/);
  assert.match(repair, /s\.status in \('candidate_ready', 'active'\)/);
  assert.doesNotMatch(repair, /to anon/);
  assert.doesNotMatch(migration, /to anon/);
});

test('admin joins private realtime when secure session id exists', () => {
  const main = read('recruiter-app/main.js');
  assert.match(main, /privateChannel:\s*Boolean\(session\.internalId\)/);
  assert.match(main, /session\.internalId \|\| session\.sessionId/);
});

test('candidate join blocks duplicate candidate participants before setting session ready', () => {
  const source = read('supabase/functions/candidate-join/index.ts');
  const migration = read('supabase/migrations/20261024000100_session_readiness.sql');
  assert.match(source, /rpc\("claim_candidate_session"/);
  assert.match(migration, /session_one_candidate_idx/);
  assert.match(migration, /for update/);
  assert.match(migration, /This session is already linked to another candidate/);
  assert.ok(
    migration.indexOf('existing_candidate <> candidate_user') < migration.indexOf("set status = 'candidate_ready'"),
    'participant membership should be checked before candidate_ready update',
  );
  assert.doesNotMatch(source, /crypto\.randomUUID\(\)/);
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
