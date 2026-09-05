// A CHURCH'S GATHERINGS ARE NEVER WRITTEN IN THE CLEAR — NOT EVEN IN THE SECONDS BEFORE ITS KEY ARRIVES.
// Run: node --test scripts/a-late-church-key-never-writes-a-gathering-in-the-clear.test.mjs
//
// THE DEFECT (measured 2026-09-05 by reading relay/relay.sqlite, not by looking at a screen).
//
//   25 of 25 calendar documents on the dev relay were in the clear — 15 event:, 5 rota:, 5 service:.
//   First written 22:58:17; the church's namekey: envelope was not published until 23:06:29, eight
//   minutes later. One rota held {"name":"Josh Adeyemi","pub":"415640527d0d…"} — a real name bound to a
//   real key, on disk, permanently, because nothing ever goes back and re-seals them.
//
// `_sealChurchDoc` returned the PLAIN JSON when the name-key ring was empty. That window is not an edge
// case: it is every church's first minutes, every console boot on a thin pipe, and the whole life of a
// delegated steward's console until the owner's next runs.
//
// WHY FIVE AUDITS WALKED PAST IT, which is the part worth keeping:
//   1. Nothing fails. The calendar saves, publishes and displays. The only difference is on the relay's disk.
//   2. Once the key lands, everything after it seals correctly — so any later check looks right.
//   3. The promised warning was `console.warn`, and `nameKeyReady()` had never been called by any screen.
//   4. THE TEST SUITE PINNED IT AS INTENDED. church-calendar-sealed.test.mjs asserted "with no key yet the
//      console writes cleartext rather than refusing", and church-docs-are-sealed.test.mjs proves sealing by
//      matching the SOURCE TEXT for a call to _sealChurchDoc( — it never runs it, so it passes whether that
//      function returns ciphertext or hands back the plaintext.
//
// So this file RUNS the real code. Every assertion below fails if the fallback comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { fnBody, stripComments } from './test-slice.mjs';

const STEW   = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const unhex = (h) => Uint8Array.from(h.match(/.{2}/g).map(x => parseInt(x, 16)));
const KEY = 'ab'.repeat(32);

// The real rota a steward would publish, with a real person in it — the same shape found in the clear on
// the relay. If any assertion here can pass while "Josh Adeyemi" is legible on the wire, it is worthless.
const ROTA = {
  service: 'svc1788389897556',
  published: true,
  assign: { 'e7362c8b08652fcf-mtkp05s5::ri20or': { name: 'Josh Adeyemi', pub: '415640527d0daa5b33d9b8bc95f23182333adcdb7e1efbf6762f9042b779b66a' } },
};

// Drive the REAL publisher: the real seal pair, the real wait, the real publishRota body. `publish` is the
// only stub, and it is a SPY rather than a stand-in for the decision — the thing under test is whether it is
// called at all, so stubbing it cannot answer the question for us.
function rig({ ring = [], waitMs = 250, keyArrivesAfterMs = 0 } = {}) {
  const sent = [];
  const scope = {
    sk: new Uint8Array(32),
    _nameKeyRing: ring.slice(),
    _unhex: unhex,
    nip44e: (plain, k) => nip44v2.encrypt(plain, k),
    nip44d: (ct, k) => nip44v2.decrypt(ct, k),
    NAME_KEY_WAIT_MS: waitMs,          // the shipped value is asserted separately below
    ROTA_D: 'trinityone/rota:',
    NET: 'trinityone',
    now: () => 1788573385,
    feChurch: (e) => e,
    publish: (e) => { sent.push(e); return Promise.resolve(true); },
  };
  if (keyArrivesAfterMs) setTimeout(() => { scope._nameKeyRing.push(KEY); }, keyArrivesAfterMs);
  // fnBody returns the whole declaration, signature included. The two helpers drop straight in; publishRota
  // is an object-method shorthand, which is not a valid standalone expression, so its signature is rewritten
  // into a function expression and nothing else about it is touched.
  const rota = stripComments(fnBody(STEW, 'async publishRota(rota)', 'publishRota'));
  assert.ok(rota.startsWith('async publishRota(rota)'), 'publishRota slice drifted — re-anchor rather than widening');
  const body = stripComments(fnBody(STEW, 'function _sealChurchDoc(obj)', '_sealChurchDoc'))
    + '\n' + stripComments(fnBody(STEW, 'function _sealChurchDocReady(obj)', '_sealChurchDocReady'))
    + '\nconst publishRota = ' + rota.replace('async publishRota(rota)', 'async function (rota)') + ';';
  const names = Object.keys(scope);
  const fns = new Function(...names, body + '\nreturn { publishRota };')(...names.map(n => scope[n]));
  return { ...fns, sent, scope };
}

test('with a key, a rota is published and no name is legible on the wire', async () => {
  const r = rig({ ring: [KEY] });
  const out = await r.publishRota(ROTA);
  assert.ok(out, 'a rota with a key present must still publish — the fix must not break the normal path');
  assert.equal(r.sent.length, 1, 'the rota did not reach publish()');
  const wire = r.sent[0].content;
  assert.doesNotMatch(wire, /Josh Adeyemi/, 'the rota carried a real name in the clear');
  assert.doesNotMatch(wire, /415640527d0d/, 'the rota carried a real pubkey beside a name in the clear');
  assert.ok(JSON.parse(wire).e, 'the wire is not a sealed envelope');
});

test('with NO key that never arrives, nothing is published at all', async () => {
  const r = rig({ ring: [], waitMs: 200 });
  const out = await r.publishRota(ROTA);
  assert.equal(out, null, 'the publisher reported success over a rota it did not save');
  assert.equal(r.sent.length, 0,
    'THE DEFECT: with no church key the console published the rota anyway. Every name in it is now on the ' +
    'relay\'s disk in the clear, permanently, and nothing re-seals it.');
});

test('a key that is merely LATE is waited for, and the rota is then sealed', async () => {
  // This is the half the old fail-open was protecting, and it is why the fix waits instead of refusing
  // outright: on a thin pipe the key arrives a moment after the console authenticates, and a steward typing
  // in Sunday's rota during those seconds must not be turned away.
  const r = rig({ ring: [], waitMs: 3000, keyArrivesAfterMs: 300 });
  const out = await r.publishRota(ROTA);
  assert.ok(out, 'a late key was treated as no key — the calendar is refused during every console boot');
  assert.equal(r.sent.length, 1, 'the rota was not published once the key arrived');
  assert.doesNotMatch(r.sent[0].content, /Josh Adeyemi/, 'it published in the clear while waiting');
});

test('the shipped console carries the refusal, not the fallback', () => {
  // vendor/*.js is the file the console actually loads, and esbuild removes dead code there — so unlike
  // app/*.jsx a text assertion against it means something (CLAUDE.md rule 3).
  assert.doesNotMatch(VENDOR, /writing this document in cleartext/,
    'the shipped bundle still carries the cleartext fallback — rebuild with scripts/build-steward.sh');
  assert.match(VENDOR, /_sealChurchDocReady/, 'the shipped bundle predates the fix');
  const m = stripComments(STEW).match(/const NAME_KEY_WAIT_MS = (\d+);/);
  assert.ok(m, 'NAME_KEY_WAIT_MS is gone — re-anchor rather than deleting this guard');
  const ms = Number(m[1]);
  assert.ok(ms >= 1000 && ms <= 15000,
    `NAME_KEY_WAIT_MS is ${ms}ms. Below a second it refuses during a normal console boot; above fifteen it ` +
    'parks a steward on a screen that looks hung.');
});

test('every calendar publisher refuses, not just the one driven above', () => {
  // The five siblings share a shape, and a fix applied to one of near-identical siblings is this codebase's
  // most repeated defect. Each must both await the ready-sealer AND bail on null.
  for (const sig of ['async publishService(svc)', 'async publishRunsheet(serviceId, items)',
    'async publishRoom(room)', 'async publishBooking(b)', 'async publishRota(rota)', 'async publishEvent(ev, asPub)']) {
    const body = stripComments(fnBody(STEW, sig, sig));
    assert.match(body, /await _sealChurchDocReady\(/, `${sig} does not seal through the ready-sealer`);
    assert.match(body, /if \(content == null\) return null;/,
      `${sig} seals but does not bail when the key never arrived — it will publish content=null`);
  }
});
