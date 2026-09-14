// THE TWO "AM I ON A LOCAL BOX?" GATES MUST ADMIT THE SAME ADDRESSES.
// Run: node --test scripts/two-loopback-gates-agree.test.mjs
//
// Audit item 20, 2026-09-14. There are two of these, in two shipped surfaces:
//   · relay-app/home.js — decides whether a relay box's launcher may redirect to the first-run wizard
//   · src/steward.src.js `_originIsLoopback` — decides whether the console may ask for the admin token
// `0ac3ee6` removed `0.0.0.0` from the first and not the second, and recorded exactly why: the gateway's
// `/local-token` route accepts only 127.0.0.1, localhost and ::1, so a page at 0.0.0.0 passed the client
// gate, asked, and was refused — and the caller could not tell "not a local box" from "a local box that
// said no". In the relay app that stranded a box on the panel at every launch with no way to the wizard.
//
// ADMITTING AN ADDRESS THE SERVER REFUSES IS STRICTLY WORSE THAN NOT ADMITTING IT. This pins both gates to
// the same answer, so the next one to change takes its sibling with it.
//
// ⚠ Both are lifted from SHIPPED artefacts and RUN: src/steward.src.js via vendor/steward.js (the bundler
// removes dead code, so matching it would be sound — running it is better), and relay-app/home.js, which
// ships UNBUNDLED and therefore may not be asserted by text at all (CLAUDE.md rule 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEW = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const HOME = readFileSync(new URL('../relay-app/home.js', import.meta.url), 'utf8');

const consoleGate = (hostname) => new Function('location',
  fnBody(STEW, 'function _originIsLoopback()', '_originIsLoopback') + '\nreturn _originIsLoopback;')({ hostname })();

// home.js inlines its test rather than naming a function, so lift the expression it actually uses.
const HOME_RE = (() => {
  const m = HOME.match(/if \(!\/\^\((.+?)\)\$\/i\.test\(h\)\) return;/);
  assert.ok(m, 'the relay launcher’s loopback test has changed shape — re-anchor this test rather than guessing');
  return new RegExp('^(' + m[1] + ')$', 'i');
})();
const launcherGate = (hostname) => HOME_RE.test(String(hostname || '').replace(/^\[|\]$/g, ''));

const ADMIT = ['localhost', '127.0.0.1', '::1', '[::1]', 'LOCALHOST'];
// `0.0.0.0` is the one this item is about; the rest are ordinary non-local addresses.
const REFUSE = ['0.0.0.0', 'app.trinityone.church', '192.168.1.10', 'example.com', '', 'localhost.evil.com',
                '127.0.0.1.evil.com', 'notlocalhost'];

test('both gates admit exactly the addresses the gateway’s /local-token route accepts', () => {
  for (const h of ADMIT) {
    assert.equal(consoleGate(h), true, 'the console gate refuses a genuine local address: ' + h);
    assert.equal(launcherGate(h), true, 'the relay launcher refuses a genuine local address: ' + h);
  }
});

test('and NEITHER admits 0.0.0.0, which the server refuses', () => {
  assert.equal(consoleGate('0.0.0.0'), false,
    'THE CONSOLE STILL TREATS 0.0.0.0 AS A LOCAL BOX. It will ask /local-token, be refused, and hand its ' +
    'caller an empty token that is indistinguishable from "this is not a local box at all" — the exact ' +
    'confusion that stranded a relay box on its panel with no way back to the wizard.');
  assert.equal(launcherGate('0.0.0.0'), false, 'the relay launcher has re-admitted 0.0.0.0 (0ac3ee6 reverted?)');
});

test('neither is fooled by an address that merely CONTAINS a local one', () => {
  for (const h of REFUSE) {
    assert.equal(consoleGate(h), false, 'the console gate admits ' + JSON.stringify(h));
    assert.equal(launcherGate(h), false, 'the relay launcher admits ' + JSON.stringify(h));
  }
});

test('the two gates agree on every address tested, which is the property', () => {
  for (const h of [...ADMIT, ...REFUSE]) {
    assert.equal(consoleGate(h), launcherGate(h),
      'THE TWO LOOPBACK GATES DISAGREE ABOUT ' + JSON.stringify(h) + '. They answer the same question about ' +
      'the same server; one of them is wrong, and which one is not obvious from either file.');
  }
});
