// THE CONSOLE'S "AM I ON A LOCAL BOX?" GATE MUST ADMIT EXACTLY WHAT THE SERVER ADMITS.
// Run: node --test scripts/two-loopback-gates-agree.test.mjs
//
// Audit item 20, 2026-09-14. There were two of these gates, in two shipped surfaces:
//   · relay-app/home.js — decided whether a relay box's launcher could redirect to the first-run wizard
//   · src/steward.src.js `_originIsLoopback` — decides whether the console may ask for the admin token
// `0ac3ee6` removed `0.0.0.0` from the first and not the second, and recorded exactly why: the gateway's
// `/local-token` route accepts only 127.0.0.1, localhost and ::1, so a page at 0.0.0.0 passed the client
// gate, asked, and was refused — and the caller could not tell "not a local box" from "a local box that
// said no". In the relay app that stranded a box on the panel at every launch with no way to the wizard.
//
// ADMITTING AN ADDRESS THE SERVER REFUSES IS STRICTLY WORSE THAN NOT ADMITTING IT.
//
// 2026-09-22: THE LAUNCHER'S GATE IS GONE, with the redirect it guarded (relay-app/home.js — a first launch
// stays on the launcher; owner, from his own first run of the real AppImage). home.js no longer decides
// anything about the address it is served from, so there is nothing there to keep in step. The console's gate
// remains and is still pinned here to the server's list; the "the two agree" test went with the second gate
// (rule 8: 4 → 3 in this file). If a second loopback gate ever appears in a shipped file, add it back here.
//
// ⚠ Lifted from the SHIPPED artefact and RUN: src/steward.src.js via vendor/steward.js (the bundler removes
// dead code, so matching it would be sound — running it is better).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const STEW = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const HOME = stripComments(readFileSync(new URL('../relay-app/home.js', import.meta.url), 'utf8'));

const consoleGate = (hostname) => new Function('location',
  fnBody(STEW, 'function _originIsLoopback()', '_originIsLoopback') + '\nreturn _originIsLoopback;')({ hostname })();

const ADMIT = ['localhost', '127.0.0.1', '::1', '[::1]', 'LOCALHOST'];
// `0.0.0.0` is the one this item is about; the rest are ordinary non-local addresses.
const REFUSE = ['0.0.0.0', 'app.trinityone.church', '192.168.1.10', 'example.com', '', 'localhost.evil.com',
                '127.0.0.1.evil.com', 'notlocalhost'];

test('the console gate admits exactly the addresses the gateway’s /local-token route accepts', () => {
  for (const h of ADMIT) assert.equal(consoleGate(h), true, 'the console gate refuses a genuine local address: ' + h);
  // …and the launcher has no gate to keep in step, because it no longer redirects anywhere.
  assert.equal(/location\.hostname/.test(HOME), false,
    'relay-app/home.js reads location.hostname again — a second loopback gate has appeared; pin it here beside the console’s');
});

test('and it does NOT admit 0.0.0.0, which the server refuses', () => {
  assert.equal(consoleGate('0.0.0.0'), false,
    'THE CONSOLE STILL TREATS 0.0.0.0 AS A LOCAL BOX. It will ask /local-token, be refused, and hand its ' +
    'caller an empty token that is indistinguishable from "this is not a local box at all" — the exact ' +
    'confusion that stranded a relay box on its panel with no way back to the wizard.');
});

test('it is not fooled by an address that merely CONTAINS a local one', () => {
  for (const h of REFUSE) assert.equal(consoleGate(h), false, 'the console gate admits ' + JSON.stringify(h));
});
