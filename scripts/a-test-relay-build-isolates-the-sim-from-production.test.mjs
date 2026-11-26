// A TEST-RELAY BUILD POINTS THE WHOLE SHARED POOL AT THE TEST RELAY, NOT app.trinityone.church (live-sim "option B").
// Run: node --test scripts/a-test-relay-build-isolates-the-sim-from-production.test.mjs
//
// For the live-sim end-to-end push test the owner wants the sim isolated from production. A build made with
// TRINITY_TEST_RELAY=wss://<tunnel>/relay (esbuild --define:__TEST_RELAY__, scripts/build-fellowship.sh) makes the
// CANONICAL_RELAYS const itself that one relay. Because CANONICAL_RELAYS is the value EXPORTED as
// window.Fellowship.CANONICAL_RELAYS (and read by the follow path app/app.jsx, which addRelay()s each of it),
// EVERY consumer routes to the test relay — not just churchRelaysRaw. A normal/Release build (__TEST_RELAY__ = "")
// is byte-for-byte the old production value.
//
// WHY THE FIRST CUT FAILED (regression guard): the override first lived only in churchRelaysRaw, so the EXPORTED
// CANONICAL_RELAYS stayed production and the follow path added app.trinityone.church to the member's relay set —
// the sim's writes went THERE (refused) and never reached the test rig. Covering the const fixes it at the source.
//
// ADMISSION IS NOT TOUCHED: CANONICAL_RELAYS's single quoted literal ('wss://app.trinityone.church/relay') stays,
// so the is-this-relay-one-of-ours pin guardian is unaffected and the test relay is admitted the ordinary
// proof-of-key way, never as a pinned canonical. _netRelays/churchRelays()/the pin list are unchanged.
//
// POINT OF USE (rule 1): the REAL CANONICAL_RELAYS statements are lifted from src and executed; and churchRelaysRaw
// (reverted to its original one-liner) is lifted to prove it unions that pool with the member's own relays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const PROD = 'wss://app.trinityone.church/relay';
const MINE = 'wss://mychurch.example/relay';

const OVR = SRC.match(/const _TEST_RELAY_OVERRIDE = [^;]+;/)[0];
const CANON = SRC.match(/const CANONICAL_RELAYS = [^;]+;/)[0];
// Evaluate the real override + CANONICAL_RELAYS statements. Omit the `bind` arg to leave __TEST_RELAY__ undefined
// (exactly a normal build with no --define), exercising the `typeof … !== 'undefined'` guard.
function canonicalRelays(testRelay, bind = true) {
  const names = bind ? ['__TEST_RELAY__'] : [];
  const vals = bind ? [testRelay] : [];
  return new Function(...names, OVR + '\n' + CANON + '\nreturn CANONICAL_RELAYS;')(...vals);
}

test('a normal build (no override bound) keeps the production canonical pool', () => {
  assert.deepEqual(canonicalRelays(undefined, false), [PROD], 'with no --define, CANONICAL_RELAYS is production');
});

test('a TEST-RELAY build makes CANONICAL_RELAYS the test relay, and NOT app.trinityone.church', () => {
  assert.deepEqual(canonicalRelays('wss://test.example/relay'), ['wss://test.example/relay'],
    'the whole shared pool becomes the test relay — this is what the EXPORT + follow path then use');
  assert.ok(!canonicalRelays('wss://test.example/relay').includes(PROD), 'production must be OUT of the pool');
});

test('a non-wss override is ignored (no cleartext ws://, no junk) → production', () => {
  for (const bad of ['', 'http://nope.example', 'ws://cleartext.example/relay', 'app.trinityone.church'])
    assert.deepEqual(canonicalRelays(bad), [PROD], `a non-wss override (${JSON.stringify(bad)}) falls back to production`);
});

test('churchRelaysRaw unions the member\'s own relays with that (override-aware) pool', () => {
  const body = fnBody(SRC, 'function churchRelaysRaw', 'churchRelaysRaw');
  const run = (CANONICAL_RELAYS) => new Function('window', 'CANONICAL_RELAYS', body + '\nreturn churchRelaysRaw;')(
    { Fellowship: { relays: [MINE] } }, CANONICAL_RELAYS)();
  // prod pool → member + production; test pool → member + test relay, never production
  assert.deepEqual(run([PROD]).sort(), [MINE, PROD].sort());
  const iso = run(['wss://test.example/relay']);
  assert.ok(iso.includes(MINE) && iso.includes('wss://test.example/relay') && !iso.includes(PROD));
});

test('CANONICAL_RELAYS is the value exported on window.Fellowship (so the fix reaches the follow path)', () => {
  // The leak was that the follow path reads window.Fellowship.CANONICAL_RELAYS. Assert the module exports the
  // same const we just proved is override-aware (not a separate production literal).
  assert.match(SRC, /window\.Fellowship = \{[\s\S]*?\n {2}CANONICAL_RELAYS,/,
    'window.Fellowship must export the CANONICAL_RELAYS const (shorthand), not a re-declared production value');
});

test('build-fellowship.sh wires the --define from TRINITY_TEST_RELAY, empty by default', () => {
  const sh = readFileSync(new URL('../scripts/build-fellowship.sh', import.meta.url), 'utf8');
  assert.match(sh, /TEST_RELAY="\$\{TRINITY_TEST_RELAY:-\}"/, 'the override comes from TRINITY_TEST_RELAY, empty by default');
  assert.match(sh, /--define:__TEST_RELAY__="\\"\$\{TEST_RELAY\}\\""/, 'esbuild must bake __TEST_RELAY__ as a JSON string');
});
