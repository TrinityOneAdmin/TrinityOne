// THE DESKTOP FINANCE PROGRAM RUNS UNDER THE SAME STRICT CSP AS THE HOSTED APP SHELLS — EVAL-FREE, NO INLINE SCRIPT.
// Run: node --test scripts/finance-desktop-csp-is-the-strict-csp.test.mjs
//
// T1Finance desktop plan §5 test 4. The Suite ships `csp: null` (relay-app/desktop/src-tauri/tauri.conf.json); the
// finance program must not. Its policy is the ONE the hosted finance.html is served with — STRICT_CSP in
// scripts/build-pages.sh — read by running that line in bash, not re-typed here, so the two cannot drift.
// scripts/finance-desktop-boots-at-its-packaged-origin.test.mjs serves the built bundle with this exact header and
// fails on any CSP violation, so this pin is the policy the boot test proved the program runs under.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const CONF = JSON.parse(readFileSync(ROOT + 'finance-app/desktop/src-tauri/tauri.conf.json', 'utf8'));
const STRICT = execFileSync('bash', ['-c', 'eval "$(grep -m1 "^STRICT_CSP=" scripts/build-pages.sh)"; printf %s "$STRICT_CSP"'], { cwd: ROOT, encoding: 'utf8' });
const directives = (csp) => Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));

test('re-anchor: STRICT_CSP is read out of scripts/build-pages.sh and is the eval-free policy', () => {
  assert.ok(STRICT.length > 100, 'STRICT_CSP not found in scripts/build-pages.sh: ' + JSON.stringify(STRICT));
  assert.deepEqual(directives(STRICT)['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
  // build-pages.sh applies that same variable to /finance.html (the hosted copy of this page)
  assert.match(readFileSync(ROOT + 'scripts/build-pages.sh', 'utf8'), /\/finance\.html[\s\S]{0,80}Content-Security-Policy: \$STRICT_CSP/);
});

test('tauri.conf.json app.security.csp === STRICT_CSP, byte for byte', () => {
  assert.equal(typeof CONF.app.security.csp, 'string', 'the program has no CSP (csp: null is the Suite\'s setting, not this one\'s)');
  assert.equal(CONF.app.security.csp, STRICT);
});

test('no unsafe-eval and no unsafe-inline for scripts, and nothing that switches Tauri\'s CSP handling off', () => {
  const d = directives(CONF.app.security.csp);
  for (const k of ['script-src', 'default-src']) {
    assert.ok(d[k], k + ' missing');
    assert.ok(!d[k].includes("'unsafe-eval'"), k + " allows 'unsafe-eval'");
    assert.ok(!d[k].includes("'unsafe-inline'"), k + " allows 'unsafe-inline'");
  }
  assert.ok(!('script-src-elem' in d) && !('script-src-attr' in d), 'a script-src-elem/attr override would bypass script-src');
  assert.equal(d['object-src'] && d['object-src'].join(' '), "'none'");
  assert.ok(!('dangerousDisableAssetCspModification' in CONF.app.security), 'Tauri\'s CSP injection is switched off');
  assert.ok(!('devCsp' in CONF.app.security), 'a separate dev CSP would be what a dev run tests');
  assert.ok(!('headers' in CONF.app.security), 'extra response headers could carry a second, looser policy');
});
