// A SECOND WRITE TO THE SAME DOCUMENT INSIDE ONE SECOND MUST NOT COME BACK AS "COULDN'T SEND".
// Run: node --test scripts/a-second-write-in-the-same-second-is-not-a-failure.test.mjs
//
// Sim 2026-10-02, item 19: RSVPs and join requests said "couldn't send" over writes the relay held.
//
//   `created_at` is whole seconds. A member's RSVP, their join and the join's heartbeat are each ONE addressable
//   document at a fixed d-tag, so a second write in the same second is a second VERSION of it. NIP-01 breaks a
//   `created_at` tie by keeping the LOWEST event id — a hash, a coin toss — and the relay answers the loser with
//   "a newer version of this is already stored". `_publishAny` turns that refusal into a throw, and the caller
//   says the church was not told. Measured on the Pixel: single taps succeed, a second tap in the same second
//   fails about half the time.
//
//   The fix is the stamp the console and the four moderation writers already use, `_monotonicF`: a second write
//   to a d-tag gets `created_at` one past the last. It is a guard against OUR OWN repeat, which is the only kind
//   of tie we can cause.
//
// HOW THIS TEST IS BUILT (CLAUDE.md rules 1 and 3):
//   • setEventRsvp, announceMembership, leaveMembership and _monotonicF are LIFTED out of the shipped
//     vendor/fellowship.js and run. Nothing here matches text in app/*.jsx.
//   • The relay's decision is the REAL one — scripts/event-store.mjs `put()`, the function the gateway calls —
//     not a stub that answers the question the test is named after.
//   • THE INSTRUMENT IS VALIDATED IN THE TEST, not assumed: the same scenarios, run with the stamp replaced by
//     the identity, are refused in a good share of seconds. If that control ever stops failing, the assertions
//     below prove nothing and the test says so.
//   • The clock is a stub that is walked across 48 consecutive seconds. Whether the coin lands badly depends on
//     the second, so the test visits many of them rather than hoping for one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { openStore } from './event-store.mjs';
import { fnBody } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const SRC_FN = {
  monotonic: fnBody(SHIP, 'function _monotonicF(tmpl)', '_monotonicF'),
  rsvp: fnBody(SHIP, 'async setEventRsvp(churchNpub, eventId, verdict)', 'setEventRsvp'),
  announce: fnBody(SHIP, 'async announceMembership(npubOrHex)', 'announceMembership'),
  leave: fnBody(SHIP, 'async leaveMembership(npubOrHex)', 'leaveMembership'),
  pubReason: fnBody(SHIP, 'function _pubReason(e)', '_pubReason'),
  fill: fnBody(SHIP, 'async fillCareSlot(careId, iso, note, meal)', 'fillCareSlot'),
};

const CHURCH = getPublicKey(generateSecretKey());
const MEMBER_SK = generateSecretKey();
const SECONDS = 48;
const BASE = Math.floor(Date.now() / 1000) - 10_000;   // in the past, so the store's future-date guard is never involved

// One member phone, one relay, one clock. `stamp` is the real _monotonicF unless the control replaces it.
function phone(T, { stamp = 'real' } = {}) {
  const store = openStore(':memory:');
  const results = [];
  const kv = new Map();
  const lastStamp = new Map();
  let now = T * 1000;
  const FakeDate = { now: () => now };
  const scope = {
    sk: MEMBER_SK, pub: getPublicKey(MEMBER_SK),   // the queue helpers act on this identity's entries only
    NET: 'trinityone',
    Date: FakeDate,
    Math, JSON, Number, String, Array, Object, Promise, console, Boolean,
    toPub: (x) => (x ? CHURCH : null),
    window: { Fellowship: { ready: Promise.resolve(), churchPub: CHURCH } },
    _sgMine: () => null,   // fillCareSlot asks if this member is a marked child; a cold adult is null
    CARESLOT_D: 'careslot:',
    localStorage: { getItem: (k) => (kv.has(k) ? kv.get(k) : null), setItem: (k, v) => kv.set(k, String(v)), removeItem: (k) => kv.delete(k) },
    finalizeEvent2: (t, key) => finalizeEvent(t, key),
    _lastStampF: lastStamp,
    // announceMembership schedules a 500ms docs-hub reopen after a rejoin; with no hub open it is a no-op. Unstubbed, the
    // timer fires after the test ended, throws ReferenceError, and node --test reports a bare "test failed".
    _docsHubs: new Map(),
    // fix/stress-g2 (2026-10-27): announceMembership now asks the one leaving guard first and reads the leave
    // generation before signing; leaveMembership queues its tombstone. Neutral here (nobody is leaving).
    _announceBlocked: () => false, _leaveGen: {}, _outboxFailed: [], _flushing: false, _outboxFlush: async () => {},
    _leaveDelivered: () => {}, _resendJoinToBoxesGainedInFlight: () => {},   // the join-ack resend is its own test (a-member-adopts-*)
    isPermanentRefusal: (e) => /^(blocked|invalid|restricted)/i.test(String((e && e.message) || e || '')),
    _outbox: [], _outboxSave: () => {}, _markJoinSent: () => {}, _clearJoinSent: () => {}, _dropJoinIntent: () => {},
    _queueJoinIntent: () => {}, _forgetChurch: () => {}, _joinSent: {}, _joinIntents: [],
    publishSetFor: () => ['wss://relay.test/relay'],
    // THE RELAY'S ANSWER IS THE REAL ONE: event-store put(). A refusal throws what _publishAny throws.
    _publishAny: async (_relays, evt) => {
      const r = store.put(evt);
      results.push(r);
      if (r === 'stored' || r === 'duplicate') return true;
      const err = new Error('invalid: a newer version of this is already stored — reload and edit again');
      err.refused = true;
      throw err;
    },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('a shipped writer needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const lift = (body) => new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(proxy);
  scope._pubReason = new Function('return ' + SRC_FN.pubReason.replace(/^function _pubReason/, 'function'))();
  scope._monotonicF = stamp === 'real'
    ? new Function('scope', 'with (scope) { return (' + SRC_FN.monotonic.replace(/^function _monotonicF/, 'function') + '); }')(proxy)
    : (t) => t;   // CONTROL ONLY: the stamp removed
  // The SHIPPED queue helpers the Leave uses: it removes this church's queued join (a stub here once left the join
  // queued, and the Leave then waited behind it), and finds what else of the church's is still queued.
  for (const [k, anchor] of [['_outboxDropJoins', 'function _outboxDropJoins('], ['_itemChurch', 'function _itemChurch('], ['_mine', 'function _mine(']]) {
    scope[k] = new Function('scope', 'with (scope) { return (' + fnBody(SHIP, anchor, k) + '); }')(proxy);
  }
  const writers = { ...lift(SRC_FN.rsvp), ...lift(SRC_FN.announce), ...lift(SRC_FN.leave), ...lift(SRC_FN.fill) };
  return { writers, store, results, tick: () => {} };
}

// Run one scenario in each of SECONDS consecutive seconds; collect which seconds had a refused write.
async function sweep(stamp, scenario) {
  const refusedAt = [];
  for (let i = 0; i < SECONDS; i++) {
    const p = phone(BASE + i * 7, { stamp });
    const out = await scenario(p);
    if (p.results.some((r) => r === 'have-newer') || out.some((o) => o === 'refused')) refusedAt.push(i);
    if (stamp === 'real') await out.check?.(p);
  }
  return refusedAt;
}
const asOutcome = async (fn) => { try { const r = await fn(); return (r && r.ok === false) || r === null ? 'refused' : 'ok'; } catch (e) { return 'refused'; } };

// ── RSVP: "Going", then straight back to "Can't make it" ──────────────────────────────────────────────────────
const rsvpScenario = async (p) => {
  const a = await asOutcome(() => p.writers.setEventRsvp('npub1church', 'ev-1', 'going'));
  const b = await asOutcome(() => p.writers.setEventRsvp('npub1church', 'ev-1', 'none'));
  const out = [a, b];
  out.check = (pp) => {
    const held = pp.store.query({ kinds: [30078], authors: [getPublicKey(MEMBER_SK)] });
    assert.equal(held.length, 1, 'the RSVP is one document');
    assert.equal(JSON.parse(held[0].content).v, 'none', 'the SECOND tap must be the one the relay keeps');
  };
  return out;
};
// ── JOIN: the join and its heartbeat, written one after the other inside one second ─────────────────────────
const joinScenario = async (p) => {
  const a = await asOutcome(() => p.writers.announceMembership('npub1church'));   // the join
  const b = await asOutcome(() => p.writers.announceMembership('npub1church'));   // the heartbeat (joinedAt is now stored)
  const out = [a, b];
  out.check = (pp) => {
    const held = pp.store.query({ kinds: [30078], authors: [getPublicKey(MEMBER_SK)] });
    assert.equal(held.length, 1, 'the membership is one document');
    assert.equal(JSON.parse(held[0].content).hb, 1, 'the heartbeat is the second write and must be the one kept');
  };
  return out;
};
// ── LEAVE: joined, and changed their mind inside the second ─────────────────────────────────────────────────
const leaveScenario = async (p) => {
  const a = await asOutcome(() => p.writers.announceMembership('npub1church'));
  const b = await asOutcome(() => p.writers.leaveMembership('npub1church'));
  const out = [a, b];
  out.check = (pp) => {
    const held = pp.store.query({ kinds: [30078], authors: [getPublicKey(MEMBER_SK)] });
    assert.equal(held.length, 1);
    assert.ok(held[0].tags.some((t) => t[0] === 'deleted'), 'the leave must be the version the relay keeps');
  };
  return out;
};

// ── CARE: sign up for a meal, then save its "what are you bringing" note in the same second (owner 2026-10-16) ──
// fillCareSlot/clearCareSlot and the care skip/availability toggles were the documented gap in _monotonicF's
// coverage (the stamp's own comment named them). The note-save is a re-write of the same careslot d-tag, so a
// same-second save was refused and the member got "that note didn't reach your church" over a note that saved.
const careNoteScenario = async (p) => {
  const a = await asOutcome(() => p.writers.fillCareSlot('care-1', '2026-09-10', '', 'dinner'));        // I'll help
  const b = await asOutcome(() => p.writers.fillCareSlot('care-1', '2026-09-10', 'lasagne', 'dinner')); // the note, same second
  const out = [a, b];
  out.check = (pp) => {
    const held = pp.store.query({ kinds: [30078], authors: [getPublicKey(MEMBER_SK)] });
    assert.equal(held.length, 1, 'the care slot is one document');
    assert.equal(JSON.parse(held[0].content).note, 'lasagne', 'the note (the second write) must be the one the relay keeps');
  };
  return out;
};

for (const [name, scenario] of [['an RSVP changed within the second', rsvpScenario], ['a join and its heartbeat in the same second', joinScenario], ['a join and a leave in the same second', leaveScenario], ['a care sign-up then its meal note in the same second', careNoteScenario]]) {
  test(`CONTROL (validates the instrument): ${name} IS refused in some seconds when the stamp is removed`, async () => {
    const bad = await sweep('none', scenario);
    assert.ok(bad.length >= 5,
      `with no stamp, only ${bad.length}/${SECONDS} seconds produced a refusal. The relay's coin toss is not being reproduced, ` +
      'so a green result below would prove nothing. Fix the harness before trusting this file.');
  });
  test(`${name}: BOTH writes are accepted, in EVERY one of ${SECONDS} seconds, and the later one is kept`, async () => {
    const bad = await sweep('real', scenario);
    assert.deepEqual(bad, [],
      `a second write to the same document inside one second was refused in second(s) #${bad.join(', #')} — ` +
      'the app would say it could not send something the relay already holds.');
  });
}

test('the stamp is per document: writes to DIFFERENT d-tags in one second are untouched', async () => {
  const p = phone(BASE);
  await p.writers.setEventRsvp('npub1church', 'ev-1', 'going');
  await p.writers.setEventRsvp('npub1church', 'ev-2', 'going');
  const held = p.store.query({ kinds: [30078], authors: [getPublicKey(MEMBER_SK)] });
  assert.equal(held.length, 2);
  assert.deepEqual(held.map((e) => e.created_at), [BASE, BASE], 'an unrelated document must not be pushed forward');
});
