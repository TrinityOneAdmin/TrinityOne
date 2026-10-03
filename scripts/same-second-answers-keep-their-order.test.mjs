// TWO ANSWERS IN ONE SECOND MUST LAND IN THE ORDER THEY WERE GIVEN.
// Run: node --test scripts/same-second-answers-keep-their-order.test.mjs
//
// Owner, 2026-10-02: "RSVP fix now — same-second writes should use monotonic timestamps."
//
// An RSVP, a serving reply and the away list are each ONE addressable document at a fixed d-tag, and
// `created_at` is whole seconds. Two writes inside the same second therefore carry the SAME created_at, and
// NIP-01 resolves the tie by keeping the LOWEST event id — a hash, i.e. a coin toss. The relay ACCEPTS both and
// keeps one at random, so "Going" then "Not going" inside a second could leave the church holding "Going", with
// nothing on screen to say so. (Measured for the moderation writers, 2026-09-04: 200 same-second undos, 104
// refused — scripts/undo-beats-the-thing-it-undoes.test.mjs. These three writers did not have the guard.)
//
// The three shipped writers are LIFTED out of vendor/fellowship.js and run with the SHIPPED _monotonicF, never a
// stub for it (an injected stamp cannot catch a writer that stopped calling it — CLAUDE.md rule 3 and the
// "stub answers the question" rule).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const NOW = 1_800_000_000;
const FrozenDate = class extends Date { static now() { return FrozenDate.at * 1000; } };
FrozenDate.at = NOW;

function writers() {
  const published = [];
  const _monotonicF = new Function('_lastStampF', 'Date', 'Math', fnBody(BUNDLE, 'function _monotonicF(', '_monotonicF') + '\nreturn _monotonicF;')(new Map(), FrozenDate, Math);
  const scope = {
    sk: 'sk-bytes', NET: 'trinityone', UNAVAIL_MIRROR: 'unavail:',
    window: { Fellowship: { ready: Promise.resolve(), relays: ['wss://r/relay'], myPubkey: 'me-pub' } },
    localStorage: { setItem() {}, getItem: () => null },
    toPub: (x) => (x ? 'c'.repeat(64) : null),
    finalizeEvent2: (t) => ({ ...t, id: 'id-' + published.length }),
    _publishAny: async (_r, e) => { published.push(e); return true; },
    _publishBounded: async (_r, e) => { published.push(e); return true; },
    publishSetFor: () => ['wss://r/relay'],
    _pubReason: () => 'unconfirmed',
    _sealChurchDocMember: new Function('_nameKeys', fnBody(BUNDLE, 'function _sealChurchDocMember(', '_sealChurchDocMember') + '\nreturn _sealChurchDocMember;')(new Map()),
    _monotonicF, Date: FrozenDate, JSON, Math, Number, String, Array, Object, Boolean, console, Promise,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('the shipped writer needs a stub for ' + String(k)); },
  });
  const lift = (anchor, name) => new Function('scope', 'with (scope) { return ({ ' + fnBody(BUNDLE, anchor, name) + ' }); }')(proxy)[name];
  return {
    published,
    setEventRsvp: lift('async setEventRsvp(churchNpub, eventId, verdict)', 'setEventRsvp'),
    respondToServingRequest: lift('async respondToServingRequest(churchNpub, requestId, verdict, swapTo)', 'respondToServingRequest'),
    setUnavailable: lift('async setUnavailable(churchNpub, dates)', 'setUnavailable'),
  };
}

const CASES = [
  ['setEventRsvp (an RSVP to an event)', (w, v) => w.setEventRsvp('npub1church', 'ev-1', v), ['going', 'none']],
  ['respondToServingRequest (I\'ll serve / Can\'t make it)', (w, v) => w.respondToServingRequest('npub1church', 'req-1', v, ''), ['accept', 'decline']],
  ['setUnavailable (the away list)', (w, v) => w.setUnavailable('npub1church', [v]), ['2099-10-04', '2099-10-04x']],
];

for (const [label, write, [first, second]] of CASES) {
  test(`${label}: a second write inside the same second is stamped AFTER the first`, async () => {
    FrozenDate.at = NOW;
    const w = writers();
    await write(w, first); await write(w, second);
    assert.equal(w.published.length, 2, 'both writes must go out — re-anchor this test');
    const [a, b] = w.published;
    assert.equal(a.tags.find(t => t[0] === 'd')[1], b.tags.find(t => t[0] === 'd')[1], 'the two writes are not to one document — this proves nothing');
    assert.ok(b.created_at > a.created_at,
      'THE DEFECT: both writes carry created_at ' + a.created_at + '. The relay keeps the LOWER event id of a tie — a coin toss — ' +
      'so the member\'s second answer is lost about half the time and the relay still says OK.');
  });

  test(`${label}: CONTROL — a write a second later keeps its own real time`, async () => {
    FrozenDate.at = NOW;
    const w = writers();
    await write(w, first);
    FrozenDate.at = NOW + 5;
    await write(w, second);
    assert.equal(w.published[1].created_at, NOW + 5, 'the stamp overrode real time — it may only ever break a tie');
    FrozenDate.at = NOW;
  });
}

test('the stamp is PER DOCUMENT: an RSVP to one event does not push an RSVP to another into the future', async () => {
  FrozenDate.at = NOW;
  const w = writers();
  await w.setEventRsvp('npub1church', 'ev-1', 'going');
  await w.setEventRsvp('npub1church', 'ev-1', 'none');
  await w.setEventRsvp('npub1church', 'ev-2', 'going');
  assert.equal(w.published[2].created_at, NOW, 'a different event inherited the first one\'s bumped stamp');
});
