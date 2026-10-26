const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const { mountDownloads } = require('../../landing/download-platform');
const websites = [path.resolve(__dirname, '../../landing'), path.resolve(__dirname, '../../../Truveil-Client')];

function harness(website, fetch) {
  const { document } = parseHTML(fs.readFileSync(path.join(website, 'download.html'), 'utf8'));
  for (const input of document.querySelectorAll('input[type="radio"]')) input.checked = input.hasAttribute('checked');
  const controls = mountDownloads(document, fetch);
  return {
    document,
    get: id => document.getElementById(id),
    async choose(name, value) {
      for (const input of document.querySelectorAll('input[name="' + name + '"]')) input.checked = input.value === value;
      return controls.update();
    }
  };
}

function release(document, arch = 'arm64') {
  const { app, version } = document.getElementById('mac-download').dataset;
  const product = app === 'truveil-recruiter' ? 'TruveilRecruiter' : 'TruveilSecure';
  return { schema: 2, app, version, arch, platform: 'darwin', installer: product + '-' + version + '-mac-' + arch + '.dmg',
    sourceHash: 'a'.repeat(64), installerSha256: 'b'.repeat(64), installerBytes: 12345,
    validated: { archive: true, signature: true, gatekeeper: true, notarization: true } };
}

for (const website of websites) {
  const label = path.basename(website);
  test(label + ': missing Mac installer keeps the Windows download usable and exposes no broken link', async () => {
    const requests = [];
    const h = harness(website, async url => { requests.push(url); return { ok: false }; });
    assert.equal(requests.length, 0);
    assert.equal(h.get('windows-download').hidden, false);
    await h.choose('download-platform', 'darwin');
    assert.equal(h.get('mac-download').hidden, false);
    assert.equal(h.get('mac-download-link').hidden, true);
    assert.equal(h.get('mac-download-link').hasAttribute('href'), false);
    assert.match(h.get('mac-download-status').textContent, /not published/);
    await h.choose('download-platform', 'win32');
    assert.equal(h.get('windows-download').hidden, false);
    assert.equal(h.get('mac-download').hidden, true);
    assert.match(h.get('windows-download').querySelector('a').href, /-Setup-1\.0\.0\.exe$/);
  });

  test(label + ': verified native installers select the correct product and processor', async () => {
    let h;
    h = harness(website, async url => ({ ok: true, json: async () => release(h.document, url.includes('arm64') ? 'arm64' : 'x64') }));
    await h.choose('download-platform', 'darwin');
    assert.equal(h.get('mac-download-link').hidden, false);
    assert.match(h.get('mac-download-link').href, /-mac-arm64\.dmg$/);
    await h.choose('download-arch', 'x64');
    assert.match(h.get('mac-download-link').href, /-mac-x64\.dmg$/);
    assert.match(h.get('mac-download-link').textContent, /Intel/);
    assert.match(h.get('mac-checksum-link').href, /-mac-x64\.dmg\.sha256$/);
  });

  test(label + ': a late Apple Silicon response cannot replace the chosen Intel installer', async () => {
    let resolveFirst;
    let h;
    h = harness(website, url => url.includes('arm64')
      ? new Promise(resolve => { resolveFirst = resolve; })
      : Promise.resolve({ ok: true, json: async () => release(h.document, 'x64') }));
    const pending = h.choose('download-platform', 'darwin');
    await h.choose('download-arch', 'x64');
    resolveFirst({ ok: true, json: async () => release(h.document, 'arm64') });
    await pending;
    assert.match(h.get('mac-download-link').href, /-mac-x64\.dmg$/);
    await h.choose('download-platform', 'win32');
    assert.equal(h.get('mac-download-link').hidden, true);
    assert.equal(h.get('mac-download-link').hasAttribute('href'), false);
  });

  test(label + ': network failure and unverified manifests never advertise an installer', async () => {
    const h = harness(website, async () => { throw new Error('offline'); });
    await h.choose('download-platform', 'darwin');
    assert.equal(h.get('mac-download-link').hidden, true);
    const rejected = harness(website, async () => ({ ok: true, json: async () => ({ installer: 'https://elsewhere.invalid/file.dmg' }) }));
    await rejected.choose('download-platform', 'darwin');
    assert.equal(rejected.get('mac-download-link').hasAttribute('href'), false);
  });
}

test('both websites share the same platform selector implementation', () => {
  assert.deepEqual(fs.readFileSync(path.join(websites[0], 'download-platform.js')), fs.readFileSync(path.join(websites[1], 'download-platform.js')));
});
