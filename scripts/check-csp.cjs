'use strict';
// No dependencies. After editing index.html's script:
//   node scripts/check-csp.cjs --update
// Before committing/deploying:
//   node scripts/check-csp.cjs
// Browser regression (requires the test environment's Playwright + Chromium):
//   node test/csp-browser.cjs
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

try {
  assert(process.argv.length <= 3 && (!process.argv[2] || process.argv[2] === '--update'), 'Usage: node scripts/check-csp.cjs [--update]');
  const file = path.join(__dirname, '..', 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert(scripts.length === 1 && scripts[0][1].trim() === '', 'Expected exactly one inline application script');
  assert(!/\son[a-z]+\s*=\s*["']/i.test(html), 'Move inline event attributes into the trusted application script');
  const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/gi)];
  assert(metas.length === 1, 'Expected exactly one CSP meta tag');
  assert(metas[0].index < html.indexOf('<link') && metas[0].index < html.indexOf('<style>') && metas[0].index < scripts[0].index, 'CSP must precede resource loads');
  const hash = createHash('sha256').update(scripts[0][2].replace(/\r\n?/g, '\n'), 'utf8').digest('base64');
  // Styles remain inline for the existing UI and pointer animations. Scripts do not permit unsafe-inline/eval.
  // Videos may be local media or approved youtube-nocookie frames; new remote resources require explicit review.
  const expected = `default-src 'none'; script-src 'sha256-${hash}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src https://redeem.gamepayhub.shop; frame-src https://www.youtube-nocookie.com; media-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'`;
  if (process.argv[2] === '--update') {
    const updated = metas[0][1].replace(/script-src 'sha256-[A-Za-z0-9+/=]+'(?=;)/, `script-src 'sha256-${hash}'`);
    assert.equal(updated, expected, 'Unexpected policy change; review resource permissions instead of weakening CSP');
    if (updated !== metas[0][1]) {
      html = html.replace(metas[0][0], `<meta http-equiv="Content-Security-Policy" content="${updated}">`);
      fs.writeFileSync(file, html);
    }
    console.log('PASS: CSP application-script hash updated; resource permissions preserved.');
  } else {
    assert.equal(metas[0][1], expected, 'CSP policy/hash mismatch. For an intentional script edit, run node scripts/check-csp.cjs --update');
    console.log('PASS: CSP script hash, resource permissions, placement and event-attribute checks.');
  }
} catch (error) {
  console.error('FAIL: ' + error.message);
  process.exitCode = 1;
}
