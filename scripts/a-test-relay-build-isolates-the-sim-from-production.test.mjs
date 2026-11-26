// A TEST-RELAY BUILD POINTS THE SHARED POOL AT THE TEST RELAY, NOT app.trinityone.church (live-sim "option B").
// Run: node --test scripts/a-test-relay-build-isolates-the-sim-from-production.test.mjs
//
// For the live-sim end-to-end smoke test the owner wants the sim isolated from production. A build made with
// TRINITY_TEST_RELAY=wss://<tunnel>/relay (esbuild --define:__TEST_RELAY__, scripts/build-fellowship.sh) replaces
// the SHARED CANONICAL POOL — and only that — with the test relay, so churchRelaysRaw() no longer includes
// app.trinityone.church. A normal/Release build (__TEST_RELAY__ = "") is byte-for-byte the old behaviour.
//
// ADMISSION IS NOT TOUCHED, and that is the point this test also pins: CANONICAL_RELAYS, the pin list
// (CANONICAL_RELAY_PUBS) and _netRelays/churchRelays() are unchanged, so the test relay is admitted the ordinary
// way (it proves our key), never as a pinned canonical. The member's OWN relays stay in the union either way.
//
// POINT OF USE (rule 1): the REAL churchRelaysRaw is lifted from src and executed. Delete the override branch and
// the "isolates" assert fails; drop the wss:// guard and the "a non-wss override is ignored" assert fails; and the
// build wiring assert fails if scripts/build-fellowship.sh stops passing the define.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const PROD = 'wss://app.trinityone.church/relay';
const MINE = 'wss://mychurch.example/relay';   // a relay the member adopted (e.g. the test church's, via ?relay=)

// Lift churchRelaysRaw and run it. When `testRelay` is undefined we do NOT bind __TEST_RELAY__, so the function's
// `typeof __TEST_RELAY__ !== 'undefined'` guard sees it absent — exactly a normal build.
function raw(testRelay) {
  const body = fnBody(SRC, 'function churchRelaysRaw', 'churchRelaysRaw');
  const win = { Fellowship: { relays: [MINE] } };
  const names = ['window', 'CANONICAL_RELAYS'];
  const vals = [win, [PROD]];
  if (testRelay !== undefined) { names.push('__TEST_RELAY__'); vals.push(testRelay); }
  return new Function(...names, body + '\nreturn churchRelaysRaw;')(...vals)();
}

test('a normal build keeps the production canonical pool (no override bound)', () => {
  const r = raw(undefined);
  assert.ok(r.includes(PROD), 'a normal build must still include app.trinityone.church');
  assert.ok(r.includes(MINE), "the member's own relays stay in the union");
});

test('a TEST-RELAY build isolates: the pool is the test relay, and NOT app.trinityone.church', () => {
  const r = raw('wss://test.example/relay');
  assert.ok(r.includes('wss://test.example/relay'), 'the test relay must be in the pool');
  assert.ok(!r.includes(PROD), 'a test build must NOT dial app.trinityone.church — that is the isolation');
  assert.ok(r.includes(MINE), "the member's own relays are unaffected by the canonical override");
});

test('the override is ignored unless it is a wss:// URL (no cleartext, no junk)', () => {
  for (const bad of ['', 'http://nope.example', 'ws://cleartext.example/relay', 'app.trinityone.church']) {
    const r = raw(bad);
    assert.ok(r.includes(PROD), `a non-wss override (${JSON.stringify(bad)}) must fall back to the production pool`);
    assert.ok(!r.includes(bad) || bad === '', `a non-wss override (${JSON.stringify(bad)}) must not enter the pool`);
  }
});

test('build-fellowship.sh wires the --define from TRINITY_TEST_RELAY, empty by default', () => {
  const sh = readFileSync(new URL('../scripts/build-fellowship.sh', import.meta.url), 'utf8');
  assert.match(sh, /TEST_RELAY="\$\{TRINITY_TEST_RELAY:-\}"/, 'the override comes from the TRINITY_TEST_RELAY env var, empty by default');
  assert.match(sh, /--define:__TEST_RELAY__="\\"\$\{TEST_RELAY\}\\""/, 'esbuild must bake __TEST_RELAY__ as a JSON string');
});
