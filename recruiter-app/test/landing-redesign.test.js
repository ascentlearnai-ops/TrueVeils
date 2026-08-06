const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landing = path.join(__dirname, '..', '..', 'landing');
const read = file => fs.readFileSync(path.join(landing, file), 'utf8');

test('recruiter landing presents evidence without an automated verdict', () => {
  const html = read('index.html');
  assert.match(html, /Evidence, not accusations/i);
  assert.match(html, /Human review required/i);
  assert.match(html, /0[^<]*<\/strong><span>Video stored/i);
  assert.doesNotMatch(html, /cheating score/i);
});

test('recruiter landing includes accessible finish and FAQ controls', () => {
  const html = read('index.html');
  const script = read('site.js');
  assert.match(html, /role="radiogroup" aria-label="Command Center finish"/);
  assert.match(html, /data-finish="bone"/);
  assert.match(html, /<details><summary>/);
  assert.match(script, /selectFinish/);
  assert.match(script, /prefers-reduced-motion/);
});
