const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.TRUVEIL_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/macos-downloads');
const websites = [
  { name: 'recruiter', root: path.join(root, 'landing'), app: 'truveil-recruiter', product: 'TruveilRecruiter' },
  { name: 'secure', root: path.resolve(root, '../Truveil-Client'), app: 'truveil-secure', product: 'TruveilSecure' }
];
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.mp4': 'video/mp4' };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  try {
    for (const site of websites) {
      for (const width of [1440, 1024, 390]) {
        let approved = false;
        const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== 'http://truveil.test') return route.abort();
          const manifest = url.pathname.match(/^\/downloads\/release-manifest-mac-(arm64|x64)\.json$/);
          if (manifest) {
            if (!approved) return route.fulfill({ status: 404, body: 'Not published' });
            const arch = manifest[1];
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
              schema: 2, app: site.app, version: '1.0.0', platform: 'darwin', arch,
              installer: site.product + '-1.0.0-mac-' + arch + '.dmg', installerBytes: 12345,
              installerSha256: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
              validated: { archive: true, signature: true, gatekeeper: true, notarization: true }
            }) });
          }
          const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'download.html';
          const file = path.resolve(site.root, relative);
          if (!file.startsWith(site.root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return route.fulfill({ status: 404, body: '' });
          }
          return route.fulfill({ path: file, contentType: types[path.extname(file)] || 'application/octet-stream' });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://truveil.test/download.html');
        await page.getByRole('radio', { name: 'Windows', exact: true }).waitFor();
        assert.equal(await page.locator('#windows-download').isVisible(), true);
        await page.screenshot({ path: path.join(output, site.name + '-' + width + '-windows.png'), fullPage: true });
        await page.getByRole('radio', { name: 'macOS', exact: true }).check();
        await page.getByRole('status').filter({ hasText: 'Mac installer not published yet' }).waitFor();
        assert.equal(await page.locator('#mac-download-link').isVisible(), false);
        assert.equal(await page.locator('#mac-download-link').getAttribute('href'), null);
        await page.screenshot({ path: path.join(output, site.name + '-' + width + '-mac-pending.png'), fullPage: true });
        approved = true;
        await page.getByRole('radio', { name: 'Intel', exact: true }).check();
        await page.locator('#mac-download-link').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#mac-download-link').getAttribute('href'), '/downloads/' + site.product + '-1.0.0-mac-x64.dmg');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.screenshot({ path: path.join(output, site.name + '-' + width + '-mac-synthetic-release.png'), fullPage: true });
        await page.getByRole('radio', { name: 'Windows', exact: true }).check();
        assert.equal(await page.locator('#windows-download').isVisible(), true);
        assert.deepEqual(errors, []);
        checks.push({ site: site.name, width, windows: true, missingMacIsHonest: true, syntheticMacSelection: true, noOverflow: true, pageErrors: 0 });
        await context.close();
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), passed: true, checks,
    boundaries: 'Offline routed website test on Windows. Mac manifests were synthetic. No real installers, Mac runtime, microphone, provider, publication or personal browser profiles were used.'
  }, null, 2) + '\n');
  console.log('Both download pages passed at three widths with Windows, unavailable Mac, and synthetic verified Mac states.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
