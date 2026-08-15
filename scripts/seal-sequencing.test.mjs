// Sealing a group must be key FIRST, flag SECOND, with every result honoured — or the room dies silently.
// Run: node --test scripts/seal-sequencing.test.mjs
//
// AUDIT-2026-08-10 item A. doSeal used to fire publishGroup({encrypted:true}) and publishGroupKey side by
// side and read neither result. Any failure of the key publish — relay refused the envelope, console not
// relay-authed, no church key — left the room FLAGGED encrypted with no envelope anywhere: every member's
// send is refused ("try again in a moment", for ever), nothing decrypts, and the steward saw success.
//
// These tests EXECUTE Steward.sealGroup lifted from the SHIPPED bundle (vendor/steward.js — the console
// loads vendor, not src), with its collaborators stubbed to record call order and return scripted results.
// The stated residual: they test the helper, so a doSeal that stops calling it is invisible here — that is
// what the stitch checks at the bottom and sabotage case A-s3 exist for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// Lift the real sealGroup out of the shipped bundle and run it against recording stubs.
// `key`/`flag` script what publishGroupKey/publishGroup resolve (a function to throw).
function rig({ authed = true, key, flag } = {}) {
  const calls = [];
  const stubs = {
    publishGroupKey: async (gid, recips) => {
      calls.push(['key', gid, recips]);
      if (typeof key === 'function') return key();
      return key;
    },
    publishGroup: async (g) => {
      calls.push(['flag', g]);
      if (typeof flag === 'function') return flag();
      return flag;
    },
  };
  const method = fnBody(STEWARD, 'async sealGroup(', 'sealGroup in the shipped console bundle');
  const fn = new Function('window', 'churchSk', '_isRelayAuthed',
    'const api = { ' + method + ' }; return api.sealGroup;')(
    { Steward: stubs }, new Uint8Array(32).fill(7), () => authed);
  return { fn, calls };
}
const GROUP = { id: 'g1', name: 'Prayer', kind: 'group' };

test('a refused key publish never flips the flag — the room stays honestly cleartext', async () => {
  const { fn, calls } = rig({ key: false });
  const r = await fn(GROUP, ['aa', 'bb']);
  assert.equal(r.sealed, false);
  assert.equal(r.reason, 'relay-refused');
  // the load-bearing assertion: the flag publish is ABSENT, not merely later
  assert.deepEqual(calls.filter(c => c[0] === 'flag'), [],
    'the group doc was published after the relay refused the key — that is the dead room, verbatim');
});

test('a null from publishGroupKey (no key material / unsafe to mint) never flips the flag either', async () => {
  const { fn, calls } = rig({ key: null });
  const r = await fn(GROUP, ['aa']);
  assert.equal(r.sealed, false);
  assert.equal(r.reason, 'cannot-key');
  assert.deepEqual(calls.filter(c => c[0] === 'flag'), []);
});

test('a THROW from the key publish is a refusal, not a flag flip', async () => {
  const { fn, calls } = rig({ key: () => { throw new Error('socket died'); } });
  const r = await fn(GROUP, ['aa']);
  assert.equal(r.sealed, false);
  assert.deepEqual(calls.filter(c => c[0] === 'flag'), [],
    'an exception between the two publishes recreated the dead room');
});

test('not relay-authed refuses up front, before any bytes are spent', async () => {
  const { fn, calls } = rig({ authed: false, key: true, flag: { id: 'g1', ts: 1234 } });
  const r = await fn(GROUP, ['aa']);
  assert.equal(r.sealed, false);
  assert.equal(r.reason, 'not-authed');
  assert.equal(calls.length, 0, 'nothing may be published from an unauthed console — minting there is the orphan bug');
});

test('the success path publishes key strictly BEFORE flag, and hands the skips through', async () => {
  const { fn, calls } = rig({ key: { ok: true, skipped: ['deadbeef'] }, flag: { id: 'g1', ts: 1234 } });
  const r = await fn(GROUP, ['aa', 'bb']);
  assert.equal(r.sealed, true, 'the mutant that never publishes anything passes the refusal tests — this catches it');
  assert.deepEqual(r.skipped, ['deadbeef'], 'the members that could not be sealed to must reach the caller');
  // recorded order, not source order
  assert.deepEqual(calls.map(c => c[0]), ['key', 'flag']);
  assert.equal(calls[1][1].encrypted, true, 'the flag publish must carry encrypted:true');
});

test('a refused FLAG publish is reported, not swallowed', async () => {
  // publishGroup resolves an OBJECT even when every relay refused — ts:false is how the truth arrives.
  const { fn } = rig({ key: true, flag: { id: 'g1', ts: false } });
  const r = await fn(GROUP, ['aa']);
  assert.equal(r.sealed, false);
  assert.equal(r.reason, 'flag-failed');
  assert.equal(r.keyPublished, true, 'the caller must know an envelope now sits on the relay (benign, reused on retry)');
});

// ── the stitch: doSeal and the Encrypt-all sweep actually go THROUGH sealGroup ────────────────────────────
// Admittedly grep-shaped (the executed tests above cannot see a doSeal that stops calling the helper — the
// mirror-test trap). stripComments so prose cannot satisfy them; sabotage case A-s3 reverts doSeal to the
// fire-and-forget pair and requires this to go red.
test('doSeal seals through Steward.sealGroup, not by firing the flag alongside the key', () => {
  const fn = stripComments(fnBody(DASH, 'const doSeal', 'doSeal'));
  assert.match(fn, /Steward\.sealGroup\(/, 'doSeal no longer goes through the sequenced seal');
  assert.doesNotMatch(fn, /publishGroup\(\{\s*\.\.\.s\.g,\s*encrypted:\s*s\.on\s*\}\)/,
    'the fire-and-forget flag publish is back — a failed key publish makes a dead room again');
});

test('the Encrypt-all sweep seals per group through Steward.sealGroup too', () => {
  const fn = stripComments(fnBody(DASH, 'const doEncryptAll', 'doEncryptAll'));
  assert.match(fn, /await window\.Steward\.sealGroup\(/, 'the sweep must await each seal — a Pi relay cannot take N envelopes at once');
  assert.doesNotMatch(fn, /publishGroup\(\{\s*\.\.\.g,\s*encrypted:\s*true\s*\}\)/,
    'the sweep is flag-first again — a failing subset becomes dead rooms en masse');
  assert.match(fn, /if \(!failed\.length\) window\.Steward\.publishProfile\(/,
    'encryptComms must not flip on unless every group actually sealed');
});
