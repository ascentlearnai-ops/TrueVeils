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
});

test('packaged recruiter runtime config never contains provider secrets', () => {
  const writer = read('recruiter-app/scripts/write-runtime-config.js');
  assert.doesNotMatch(writer, /deepgramApiKey|groqApiKey/);
});

test('candidate-facing copy does not expose an AI score', () => {
  const html = fs.readFileSync('D:/Truveil-Client/src/renderer/index.html', 'utf8');
  assert.doesNotMatch(html, /AI-assistance risk|integrity percent|cheating score/i);
});
