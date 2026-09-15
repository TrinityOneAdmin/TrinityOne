// A WORKER IS NEVER TOLD "NOTHING WAS WRITTEN" OVER A CHECK-IN THAT LANDED.
// Run: node --test scripts/a-check-in-that-landed-is-not-called-a-failure.test.mjs
//
// Audit finding, 2026-09-14. `_publishAny` throws when NOBODY ANSWERED inside WEDGE_ACK_MS as well as when a
// relay REFUSED. `writeCheckin` and `releaseCheckin` flattened both to one answer, so on a slow relay the
// record landed and the worker's screen said "That did not save — see the desk. Nothing was written."
//
// She retries, which mints a fresh record id, and the parent's phone then shows the child TWICE.
// ⚠ CORRECTED 2026-09-14 by the audit of this fix. The first telling said "two pickup codes, one of which
// fails the match at collection". The code says otherwise: `code` is NOT regenerated on a retry, so both
// rows carry the SAME code and either one matches. The real harm runs the other way — collect one row and
// the OTHER still shows the child as present, on the parent's card and the worker's register, for the rest
// of the window, with nothing prompting anyone to notice.
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

const REC = { childName: 'Milo', session: 'svc-am', code: '1234', rel: 'ci-earlier' };
const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
// The shipped four-way classifier, lifted and run. scripts/a-relay-that-says-no-is-not-a-relay-that-is-slow
// .test.mjs is what proves `refused` and `unsent` are SET correctly, against a real relay; this file proves
// the writers ROUTE them correctly.
const _pubReason = new Function(fnBody(SHIP, 'function _pubReason(e) {', '_pubReason') + '\nreturn _pubReason;')();

// Every writer that answers a worker, plus the parent's one as the reference implementation.
const WRITERS = [
  ['writeCheckin',   'async writeCheckin(churchNpub, rec) {'],
  ['releaseCheckin', 'async releaseCheckin(churchNpub, rec) {'],
  // THE THIRD SIBLING, RUN RATHER THAN CITED. This file used to "re-anchor" on writeArrival by matching two
  // words in its body — which broke the moment all three were routed through one classifier, and would have
  // said nothing about whether they AGREE. They are all three driven through the same cases now.
  ['writeArrival',   'async writeArrival(churchNpub, rec) {'],
];

function lift(open) {
  const thrown = { refused: null, unsent: false };
  const scope = {
    // The two ways _publishAny really fails. `err.refused` is set from _PUB_REFUSED when a relay answered no.
    _publishAny: async () => { const e = new Error(thrown.refused ? 'blocked: not a helper' : 'no relay acknowledged'); if (thrown.refused) e.refused = true; if (thrown.unsent) e.unsent = true; throw e; },
    // LIFTED, NOT STUBBED. This is the function that decides which of the four things the worker is told,
    // so a stub here would supply the very answer these tests are named after — the trap that let an earlier
    // version of this file pass with refusal detection deleted outright.
    _pubReason,
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
    CHECKIN_D: 'checkin:', CHECKINARRIVAL_D: 'checkinarrival:', NET: 'trinityone',
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
    const r = await fn('c'.repeat(64), REC);
    assert.equal(r && r.ok, false, 're-anchor: it reported success over a throw');
    assert.equal(r.reason, 'unconfirmed',
      'A CHECK-IN THAT MAY HAVE LANDED IS REPORTED AS A FLAT FAILURE. The worker is told "Nothing was ' +
      'written", retries, and the parent ends up with the child listed twice; collect one row and the ' +
      'other still shows the child in the room. Got: ' + JSON.stringify(r));
  });

  test(`${name}: …and a relay that actually REFUSED still says so`, async () => {
    // The other half. A refusal is settled — telling her it "may have landed" would send a child into a
    // room the church never recorded.
    const { fn, thrown } = lift(open);
    thrown.refused = true;
    const r = await fn('c'.repeat(64), REC);
    assert.equal(r.reason, 'refused',
      'A SETTLED REFUSAL IS BEING SOFTENED INTO "we could not confirm" — the opposite error, and it leaves ' +
      'a child recorded nowhere. Got: ' + JSON.stringify(r));
  });
}

test('all three writers answer the SAME way to the SAME failure — no sibling left behind', async () => {
  // The defect this whole file exists for happened twice: once because a fix reached one of three siblings,
  // and once because the one it reached was wrong. Agreement is the property, so agreement is the assertion.
  for (const [kind, set] of [['unconfirmed', {}], ['refused', { refused: true }], ['not-sent', { unsent: true }]]) {
    const answers = {};
    for (const [name, open] of WRITERS) {
      const { fn, thrown } = lift(open);
      Object.assign(thrown, set);
      const r = await fn('c'.repeat(64), REC);
      answers[name] = r && r.reason;
    }
    const distinct = [...new Set(Object.values(answers))];
    assert.deepEqual(distinct, [kind],
      'THE THREE SIBLING WRITERS DISAGREE about a ' + kind + ' publish, which is how this defect got in ' +
      'both times. ' + JSON.stringify(answers));
  }
});
