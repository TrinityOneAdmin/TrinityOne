// A WORKER IS NEVER TOLD "NOTHING WAS WRITTEN" OVER A CHECK-IN THAT LANDED.
// Run: node --test scripts/a-check-in-that-landed-is-not-called-a-failure.test.mjs
//
// Audit finding, 2026-09-14. `_publishAny` throws when NOBODY ANSWERED inside WEDGE_ACK_MS as well as when a
// relay REFUSED. `writeCheckin` and `releaseCheckin` flattened both to one answer, so on a slow relay the
// record landed and the worker's screen said "That did not save — see the desk. Nothing was written."
//
// She retries. `code` is deliberately NOT regenerated on a retry, so the parent's phone shows the child
// twice with two pickup codes — and at collection one of them fails the match: "That code does not match.
// The child was NOT checked out."
//
// ⚠ THE PARENT'S WRITER HAS ANSWERED THESE THREE WAYS SINCE DEVICE FINDING F1 (2026-09-11, measured on a
// Pixel — writeArrival reported {ok:false} TWICE over writes that had SUCCEEDED). The fix went into ONE of
// three sibling writers. This is the other two.
//
// ⚠ THE SHIPPED WRITERS ARE LIFTED OUT OF vendor/fellowship.js AND RUN, with `_publishAny` throwing the two
// ways it really throws. No relay, no port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Every writer that answers a worker, plus the parent's one as the reference implementation.
const WRITERS = [
  ['writeCheckin',   'async writeCheckin(churchNpub, rec) {'],
  ['releaseCheckin', 'async releaseCheckin(churchNpub, rec) {'],
];

function lift(open) {
  const thrown = { refused: null };
  const scope = {
    // The two ways _publishAny really fails. `err.refused` is set from _PUB_REFUSED when a relay answered no.
    _publishAny: async () => { const e = new Error(thrown.refused ? 'blocked: not a helper' : 'no relay acknowledged'); if (thrown.refused) e.refused = true; throw e; },
    relaysForChurch: () => ['wss://x/relay'],
    toPub: (x) => String(x || ''), sk: 'a'.repeat(64), pub: 'b'.repeat(64),
    _ckMemKeyGet: () => '11'.repeat(32),
    // The bundler renames these on the way in (nip44e→encrypt, nip44ck→getConversationKey,
    // finalizeEvent→finalizeEvent2), so stub BOTH spellings — the src name and the shipped one.
    encrypt: () => 'ct', getConversationKey: () => new Uint8Array(32),
    nip44e: () => 'ct', nip44ck: () => new Uint8Array(32),
    _unhex: (h) => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16))),
    checkinGuardianCopies: () => [], checkinGuardianPubs: () => [],
    finalizeEvent2: (t) => ({ ...t, id: 'e' }), finalizeEvent: (t) => ({ ...t, id: 'e' }), _todayISO: () => '2026-09-14',
    CHECKIN_D: 'checkin:', NET: 'trinityone',
    String, JSON, Date, Math, Number, Array, Object, Boolean, RegExp, console, Promise,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped writer needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', 'with (scope) { return ({ ' + fnBody(SHIP, open, open) + ' }); }')(proxy);
  return { fn: fn[Object.keys(fn)[0]], thrown };
}

for (const [name, open] of WRITERS) {
  test(`${name}: A SLOW RELAY IS "UNCONFIRMED", NOT "NOTHING WAS WRITTEN"`, async () => {
    const { fn, thrown } = lift(open);
    thrown.refused = false;                       // nobody answered in time — the record may well have landed
    const r = await fn('c'.repeat(64), { childName: 'Milo', session: 'svc-am', code: '1234', rel: 'ci-earlier' });
    assert.equal(r && r.ok, false, 're-anchor: it reported success over a throw');
    assert.equal(r.reason, 'unconfirmed',
      'A CHECK-IN THAT MAY HAVE LANDED IS REPORTED AS A FLAT FAILURE. The worker is told "Nothing was ' +
      'written", retries, and the parent ends up with the child listed twice under two pickup codes — one ' +
      'of which fails the match at collection. Got: ' + JSON.stringify(r));
  });

  test(`${name}: …and a relay that actually REFUSED still says so`, async () => {
    // The other half. A refusal is settled — telling her it "may have landed" would send a child into a
    // room the church never recorded.
    const { fn, thrown } = lift(open);
    thrown.refused = true;
    const r = await fn('c'.repeat(64), { childName: 'Milo', session: 'svc-am', code: '1234', rel: 'ci-earlier' });
    assert.equal(r.reason, 'refused',
      'A SETTLED REFUSAL IS BEING SOFTENED INTO "we could not confirm" — the opposite error, and it leaves ' +
      'a child recorded nowhere. Got: ' + JSON.stringify(r));
  });
}

test('the three answers are the SAME three the parent’s writer gives', async () => {
  // Re-anchor: the whole point is that one of three siblings had the fix. If writeArrival ever stops
  // answering this way, these two have drifted from their own reference implementation.
  const body = fnBody(SHIP, 'async writeArrival(churchNpub, rec) {', 'writeArrival');
  for (const word of ['refused', 'unconfirmed']) {
    assert.ok(body.includes(word),
      'writeArrival no longer answers "' + word + '" — the reference implementation these two were matched ' +
      'to has changed, and they are now the odd ones out again');
  }
});
