const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.TRUVEIL_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const client = path.resolve(root, '../../Truveil-Client');
const output = path.resolve(root, '../output/playwright/brand-sync');
const surfaces = [
  { name: 'recruiter-website', root: path.resolve(root, '../landing'), page: '/download.html', header: '.site-nav', logo: '.site-nav .brand img' },
  { name: 'secure-website', root: client, page: '/download.html', header: '.site-nav', logo: '.site-nav .brand img' },
  { name: 'recruiter-app', root, page: '/src/renderer/index.html', header: '.titlebar', logo: '.app-brand img' },
  { name: 'secure-app', root: client, page: '/src/renderer/index.html', header: '.titlebar', logo: '.app-brand img' }
];
const types = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.mp4': 'video/mp4' };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  try {
    for (const surface of surfaces) {
      for (const width of [1440, 800]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== 'http://truveil.test') return route.abort();
          // Branding only: no app actions, API bridges or website services run.
          if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'application/javascript', body: '' });
          const file = path.resolve(surface.root, '.' + decodeURIComponent(url.pathname));
          if (!file.startsWith(surface.root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return route.fulfill({ status: 404, body: '' });
          }
          return route.fulfill({ path: file, contentType: types[path.extname(file)] || 'application/octet-stream' });
        });
        const page = await context.newPage();
        await page.goto('http://truveil.test' + surface.page);
        await page.locator(surface.logo).waitFor();
        await page.waitForFunction(selector => {
          const image = document.querySelector(selector);
          return image.complete && image.naturalWidth > 0;
        }, surface.logo);
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.locator(surface.logo).evaluate(image => ({
          source: new URL(image.src).pathname,
          width: image.naturalWidth, height: image.naturalHeight,
          filter: getComputedStyle(image).filter,
          opacity: getComputedStyle(image).opacity,
          font: getComputedStyle(image.parentElement).fontFamily
        }));
        assert.match(metrics.source, /\/mark\.png$/);
        assert.equal(metrics.width, 180);
        assert.equal(metrics.height, 180);
        assert.equal(metrics.filter, 'none');
        assert.equal(metrics.opacity, '1');
        assert.match(metrics.font, /Manrope/i);
        const screenshot = surface.name + '-' + width + '.png';
        await page.locator(surface.header).screenshot({ path: path.join(output, screenshot) });
        checks.push({ surface: surface.name, width, metrics, screenshot, passed: true });
        await context.close();
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, checks,
    boundaries: 'Real local HTML/CSS/assets rendered in an isolated browser. Application scripts/services disabled. No microphone, personal tabs, installed apps, paid API, publication or native Mac runtime was used.'
  }, null, 2) + '\n');
  console.log('Eight branding viewport checks passed across both websites and both app headers.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
