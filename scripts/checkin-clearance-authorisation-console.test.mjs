// THE CONSOLE HALF OF THE SAME QUESTION — RED TEAM 2026-09-10, F3.
//   Run: node --test scripts/checkin-clearance-authorisation-console.test.mjs
//
// F3's console behaviour is IMMEDIATE and needs no restart, so a relay-only fix leaves the safeguarding
// screen wrong: `subscribeCheckinPermissions` skipped every version whose author failed `mayAuthor`, so the
// moment a lead was re-scoped their WITHDRAWAL was dropped from the reduce and the church's older clearance
// won. Measured against this exact function before the fix: church clears Ada → 1 row; the lead withdraws →
// 0 rows; the lead is de-capped and the stream re-reduces on the very next event → **1 row again**. Nothing
// on screen to notice: CheckinClearances() in app/stew-dashboard.jsx renders this list, so the safeguarding
// panel said "cleared" about somebody a steward had withdrawn. The same list is the issuer's eligible set
// (CheckinSessionKeys()), so it also decided who got wrapped a session key for the next Sunday.
//
// THE FUNCTION UNDER TEST IS THE SHIPPED ONE, lifted out of `vendor/steward.js` and run — not
// re-implemented, and not asserted against by matching text (CLAUDE.md rule 3: `false && ` in front of a
// condition leaves every word of it in place). `_capsOf` is lifted out of the bundle too, so the console's
// OWN notion of "has this steward the tick" is what decides, rather than a copy of it in this file. A
// counter proves the harness entered the lifted code before any row below is believed.
//
// ⚠ `vendor/steward.js` IS BUILT FROM `src/steward.src.js` BY `bash scripts/build-steward.sh` AND NOTHING
// ELSE REBUILDS IT. A green run against a stale bundle proves nothing about the source, which is why
// scripts/vendor-freshness.test.mjs exists; this file deliberately reads the artefact that ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { readCheckinPermission, buildCheckinPermission } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CHURCH = 'aa'.repeat(32);
const SGLEAD = 'bb'.repeat(32);
const ADA    = 'cc'.repeat(32);
const BEN    = 'dd'.repeat(32);

// A fresh, isolated lift per test: `byPerson` is per-subscription state and a shared one would let one row
// carry another.
function lift(initialCaps) {
  let entered = 0;
  const state = { caps: { ...initialCaps } };
  const subs = [];
  const stubs = {
    pub: CHURCH,
    NET: 'trinityone',
    CHECKINPERM_D: D.CHECKINPERM,
    readCheckinPermission: (c) => { entered++; return readCheckinPermission(c); },
    _stewardCaps: {},
    relays: () => ['wss://relay.test/relay'],
    pool: { subscribeMany: (_r, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } },
  };
  const scope = new Proxy(stubs, {
    has: () => true,
    get: (o, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in o) return o[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in o) return o[base];
      if (k in globalThis) return globalThis[k];      // Map, JSON, Array, String…
      throw new ReferenceError('the lifted reader needs `' + String(k) + '` — add a stub');
    },
    set: (o, k, v) => { o[k] = v; return true; },
  });
  stubs._stewardCaps = new Proxy({}, { get: (_t, k) => state.caps[k] });
  const capsOfSrc = fnBody(VENDOR, 'function _capsOf(by) {', '_capsOf');
  stubs._capsOf = new Function('scope', `with (scope) { ${capsOfSrc} return _capsOf; }`)(scope);

  const body = fnBody(VENDOR, 'subscribeCheckinPermissions(cb) {', 'subscribeCheckinPermissions');
  assert.ok(body.length > 400, 'the slice is a stub, not the function: ' + body.length + ' chars');
  const fn = new Function('scope', `with (scope) { return ({ ${body} }).subscribeCheckinPermissions; }`)(scope);

  let last = null;
  fn((rows) => { last = rows; });
  assert.equal(subs.length, 1, 'the lifted function never opened a subscription');
  return {
    state,
    deliver: (e) => subs[0].handlers.onevent(e),
    rows: () => (last || []).map(r => r.person).sort(),
    entered: () => entered,
  };
}

const permBody = JSON.stringify(buildCheckinPermission({
  person: ADA, source: 'steward', lifetime: 'open', from: 1788400000, until: null }));
const permBodyBen = JSON.stringify(buildCheckinPermission({
  person: BEN, source: 'steward', lifetime: 'open', from: 1788400000, until: null }));
const ev = (by, person, content, at) => ({ pubkey: by, created_at: at, content,
  tags: [['d', D.CHECKINPERM + person], ['t', 'trinityone'], ['church', CHURCH],
    ...(content ? [['person', person]] : [['deleted', '1']])] });

test('F3 (console) — a WITHDRAWN clearance stays off the list when the withdrawing steward is de-capped', () => {
  const c = lift({ [SGLEAD]: ['safeguarding'] });

  c.deliver(ev(CHURCH, ADA, permBody, 1788500000));
  assert.ok(c.entered() > 0, 'THE HARNESS NEVER ENTERED THE LIFTED CODE — every row below would be vacuous');
  assert.deepEqual(c.rows(), [ADA], 'baseline: the church cleared Ada and the list does not show her');

  c.deliver(ev(SGLEAD, ADA, '', 1788500100));
  assert.deepEqual(c.rows(), [], 'the safeguarding lead withdrew the clearance and the list still shows it');

  // The church takes safeguarding off that lead. Nothing is re-delivered — the stream re-reduces on its next
  // event, which is what a reconnect, an EOSE or any other clearance produces.
  c.state.caps = { [SGLEAD]: ['members'] };
  c.deliver(ev(CHURCH, ADA, permBody, 1788500000));      // a replay of the church's own copy
  assert.deepEqual(c.rows(), [],
    'THE CLAIM: `mayAuthor` gated EVERY version, so re-scoping the lead dropped her WITHDRAWAL from the ' +
    'reduce and the church\'s older clearance won. The safeguarding screen lists a withdrawn volunteer as ' +
    'cleared, immediately, with no restart and nothing to notice. A clearance widens access to a children\'s ' +
    'register and must keep answering for its author; a withdrawal narrows and must not have to.');

  // …AND THE CASE THIS CONSOLE CANNOT CLOSE, asserted as it actually behaves rather than as one would like.
  //
  // Off the roster ALTOGETHER, `_capsOf` returns null and the withdrawal stops counting, so the row comes
  // back. That is not an oversight and it is not fixable here: from this console a removed lead and a
  // CO-TENANT CHURCH's key are the same thing — a pubkey the roster does not mention — and
  // checkin-helper-mint-is-the-shipped-one.test.mjs ("A CO-TENANT'S TOMBSTONE DOES NOT REMOVE SOMEBODY FROM
  // OUR CLEARED LIST") requires the co-tenant to be refused, for a reason written on it: a row vanishing
  // while the relay still enforces the clearance makes a steward believe a withdrawal worked when it did
  // nothing. Believing every tombstone would reverse that decision silently, and it did — one full suite run
  // caught it.
  //
  // THE RELAY CLOSES THIS ONE, which is where it belongs: note() keys a co-tenant's document to THEIR church
  // whoever it is tagged to, so the relay has information this console does not and needs no roster test on a
  // withdrawal at all. "F3 — …and when she is REMOVED FROM THE ROSTER ALTOGETHER" in
  // checkin-clearance-authorisation.test.mjs asserts it, across a restart. So the screen can be stale here
  // while the person is refused at the desk — a wrong list, never an admission.
  c.state.caps = {};
  c.deliver(ev(CHURCH, ADA, permBody, 1788500000));
  assert.deepEqual(c.rows(), [ADA],
    'this changed shape without the reasoning above being revisited. If a removed lead\'s withdrawal is now ' +
    'kept, check what it did to the co-tenant refusal — the two are indistinguishable from here.');
});

test('A CO-TENANT\'S TOMBSTONE IS STILL REFUSED — the decision this fix had to be shaped around', () => {
  // Guarded here as well as in checkin-helper-mint-is-the-shipped-one.test.mjs, because THIS file is where
  // somebody will come to widen `mayWithdraw`, and the reason not to is one file away.
  const COTENANT = 'ee'.repeat(32);
  const c = lift({ [SGLEAD]: ['safeguarding'] });
  c.deliver(ev(CHURCH, ADA, permBody, 1788500000));
  assert.deepEqual(c.rows(), [ADA], 'baseline: the church cleared Ada and the list does not show her');
  c.deliver(ev(COTENANT, ADA, '', 1788500100));
  assert.deepEqual(c.rows(), [ADA],
    'ANOTHER CONGREGATION ON THIS BOX TOOK A NAME OFF OUR CLEARED LIST. The relay keys their document to ' +
    'THEIR church and goes on enforcing our clearance, so the screen would say withdrawn about somebody the ' +
    'desk still admits — and a steward would believe their withdrawal worked when it did nothing.');
});

test('the author test STILL BITES ON A CLEARANCE — deleting it outright is not the fix', () => {
  // Without this row, "remove `mayAuthor` from the reduce" passes every assertion in the test above, and a
  // Finance-only steward — or an ordinary member, whom this stream's `{'#church':[pub]}` filter also
  // delivers — could put a name on the church's cleared list.
  const c = lift({ [SGLEAD]: ['safeguarding'] });
  c.deliver(ev(SGLEAD, BEN, permBodyBen, 1788500000));
  assert.deepEqual(c.rows(), [BEN], 'baseline: the safeguarding lead cleared Ben and the list does not show him');

  c.state.caps = { [SGLEAD]: ['finance'] };
  c.deliver(ev(SGLEAD, BEN, permBodyBen, 1788500000));
  assert.deepEqual(c.rows(), [],
    'a clearance authored by somebody who no longer holds the safeguarding tick is STILL LISTED. This is ' +
    'F4\'s console mirror and it is the reason the author test cannot simply be deleted: the relay refuses ' +
    'that volunteer at the desk while this screen says she is cleared.');
});

test('…AND A WITHDRAWAL IS NOT PERMANENT — a later clearance puts them back on the list', () => {
  // The positive control for both tests above. A remembered withdrawal that outranked everything would pass
  // them and make a person unclearable for ever, which is exactly the shape a mis-aimed fix takes — and it
  // would disagree with the relay, whose fold is a maximum over the versions with a withdrawal winning only
  // a TIE.
  const c = lift({ [SGLEAD]: ['safeguarding'] });
  c.deliver(ev(CHURCH, ADA, permBody, 1788500000));
  c.deliver(ev(SGLEAD, ADA, '', 1788500100));
  assert.deepEqual(c.rows(), [], 'fixture: the withdrawal did not take');
  c.deliver(ev(SGLEAD, ADA, permBody, 1788500200));
  assert.deepEqual(c.rows(), [ADA],
    'a person once withdrawn can never be shown as cleared again — the withdrawal is outranking a later ' +
    'decision instead of being ordered against it');
});

test('A TIE GOES TO THE WITHDRAWAL — fail closed, the same way the relay folds it', () => {
  // Two authors, one stamp. Nothing orders them, so the answer has to be chosen rather than discovered, and
  // for a children's register the direction to fail in is "refused".
  const c = lift({ [SGLEAD]: ['safeguarding'] });
  c.deliver(ev(CHURCH, ADA, permBody, 1788500000));
  c.deliver(ev(SGLEAD, ADA, '', 1788500000));
  assert.deepEqual(c.rows(), [], 'a clearance and a withdrawal at the SAME timestamp resolved to "cleared"');
});
