// TAPPING "GOING" TWICE MUST NEVER MEAN "NOT GOING".
// Run: node --test scripts/an-rsvp-must-not-be-reversed-by-a-slow-relay.test.mjs
//
// Priyanka's complaint is already written into app/app.jsx: "It already said You're going. I tapped Going to
// confirm — and it wiped my answer." Pressing your current answer withdraws it, deliberately. This file is
// about the turn of the screw that makes that toggle lose an answer nobody chose to lose:
//
//   1. she taps Going. The event is signed and published;
//   2. a relay TAKES it, but nobody acknowledges inside WEDGE_ACK_MS, so `_publishAny` throws and the old
//      setEventRsvp returned a flat `null` — she is told the church has not been told;
//   3. the church HAS been told, so the subscription echoes the RSVP back and myRsvps[event] becomes 'going';
//   4. she taps Going again, exactly as the failure message invited her to — and `myRsvps[eventId] === verdict`
//      is now true, so the app computes a WITHDRAWAL and publishes 'none'.
//
// Two taps meaning yes, and she is marked not going. The engine is idempotent and honest about its d-tag; the
// bug lives entirely in the CALLER's toggle, which recomputes a meaning from state the failure desynced.
//
// ⚠ NOTHING HERE ADDS A RETRY, AND NOTHING SHOULD. An automatic retry of a toggle is not the same action
// twice — it recomputes, and can publish the opposite of what the member asked for. The fix is that the tap
// keeps its meaning and the sentence stops lying.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// ── THE ENGINE, lifted from the shipped bundle and run with _publishAny throwing the ways it really throws ──
function engine(mode) {
  const published = [];
  const scope = {
    sk: 'a'.repeat(64),
    window: { Fellowship: { ready: Promise.resolve(), relays: ['wss://x/relay'] } },
    toPub: (x) => (x ? 'c'.repeat(64) : null),
    NET: 'trinityone',
    finalizeEvent2: (t) => ({ ...t, id: 'evt-' + published.length, sig: 'sig' }),
    _publishAny: async (_r, e) => {
      published.push(e);
      if (mode === 'ok') return true;
      const err = new Error(mode === 'refused' ? 'blocked: not a member' : 'no relay acknowledged');
      if (mode === 'refused') err.refused = true;
      if (mode === 'not-sent') err.unsent = true;
      throw err;
    },
    _pubReason: new Function(fnBody(SHIP, 'function _pubReason(e)', '_pubReason') + '\nreturn _pubReason;')(),
    String, JSON, Date, Math, Number, Array, Object, Boolean, console, Promise,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped setEventRsvp needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(SHIP, 'async setEventRsvp(churchNpub, eventId, verdict)', 'setEventRsvp') + ' }); }')(proxy).setEventRsvp;
  return { run: (v) => fn('npub1church', 'ev-1', v), published };
}

test('the engine says WHY it could not confirm, instead of one flat failure', async () => {
  for (const [mode, reason] of [['unconfirmed', 'unconfirmed'], ['refused', 'refused'], ['not-sent', 'not-sent']]) {
    const e = engine(mode);
    const r = await e.run('going');
    assert.equal(r.ok, false, mode + ': a publish that did not come back confirmed was reported as delivered');
    assert.equal(r.reason, reason,
      mode + ': the caller cannot tell a slow relay from a refusal, so it must pick one sentence for both — ' +
      'and the one it picked ("the church hasn\'t been told") is false for the slow case. Got: ' + JSON.stringify(r));
  }
});

test('CONTROL: a delivered RSVP still reports delivery, and still carries its event', async () => {
  const e = engine('ok');
  const r = await e.run('going');
  assert.equal(r.ok, true, 're-anchor: a delivered RSVP no longer reports success — every test here would invert');
  assert.equal(r.evt.kind, 30078, 're-anchor: the event is no longer handed back');
  assert.equal(JSON.parse(e.published[0].content).v, 'going');
});

test('the engine is idempotent — one fixed d-tag per (member, event), so writing twice is a no-op', async () => {
  const e = engine('ok');
  await e.run('going'); await e.run('going');
  const ds = e.published.map(x => (x.tags.find(t => t[0] === 'd') || [])[1]);
  assert.deepEqual(ds, ['trinityone/rsvp:ev-1', 'trinityone/rsvp:ev-1'],
    'the RSVP no longer replaces itself, so re-sending the same answer would accumulate documents');
});

// ── THE POINT OF USE (CLAUDE.md rule 1 and rule 3): ctx.setRsvp LIFTED OUT OF app/app.jsx AND RUN. ────────
// Nothing below matches text in app/*.jsx. Those ship unbundled, so `false && ` in front of the guard would
// leave every word of it in place and a text assertion would stay green over the bug.
//
// `myRsvps` is mutated on the scope between taps, which is what the subscription does between renders.
// `rsvpUnsureRef` is the same object throughout, which is what a ref is.
function screen({ results }) {
  const toasts = [];
  const sent = [];
  let n = 0;
  const scope = {
    churches: [{ id: 'npub1church', npub: 'npub1church' }],
    activeChurch: 'npub1church',
    myRsvps: {},
    rsvpUnsureRef: { current: {} },
    setMyRsvps: (f) => { scope.myRsvps = f(scope.myRsvps); },
    toast: (m) => toasts.push(String(m)),
    window: { Fellowship: { setEventRsvp: async (_np, id, v) => { sent.push([id, v]); return results[Math.min(n++, results.length - 1)]; } } },
    String, JSON, Date, Math, Number, Array, Object, Boolean, console, Promise,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped setRsvp needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const fn = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(APP, 'setRsvp: async (eventId, verdict) =>', 'setRsvp') + ' }); }')(proxy).setRsvp;
  return { tap: (v) => fn('ev-1', v), toasts, sent, scope };
}

const UNCONFIRMED = { ok: false, reason: 'unconfirmed' };
const NOTSENT = { ok: false, reason: 'not-sent' };
const OK = { ok: true, evt: { kind: 30078 } };

test('THE WHOLE FILE: an unconfirmed "Going", echoed back by the relay, is not withdrawn by the next tap', async () => {
  const s = screen({ results: [UNCONFIRMED, OK] });
  await s.tap('going');
  // the church DID get it — the ack was merely late — so the subscription paints the answer she was told failed
  s.scope.myRsvps = { 'ev-1': 'going' };
  await s.tap('going');
  assert.deepEqual(s.sent, [['ev-1', 'going'], ['ev-1', 'going']],
    'SHE TAPPED GOING TWICE AND THE APP PUBLISHED A WITHDRAWAL. She was told her answer had not been sent, ' +
    'did the one thing the message invited her to do, and is now marked not going. Published: ' +
    JSON.stringify(s.sent));
  assert.ok(!s.toasts.some(t => /Answer withdrawn/i.test(t)),
    'the second tap announced a withdrawal she never asked for: ' + JSON.stringify(s.toasts));
});

test('…and the same holds when the failure was a REFUSAL of a withdrawal she really meant', async () => {
  // She is down as going, and taps Going to withdraw. The relay refuses. myRsvps still says 'going', so a
  // plain toggle would recompute 'none' — which is right here, and the hold must reproduce it, not invert it.
  const s = screen({ results: [{ ok: false, reason: 'refused' }, OK] });
  s.scope.myRsvps = { 'ev-1': 'going' };
  await s.tap('going');
  await s.tap('going');
  assert.deepEqual(s.sent, [['ev-1', 'none'], ['ev-1', 'none']],
    'a failed WITHDRAWAL was turned back into an attendance on the retry — the hold must repeat what the tap ' +
    'meant, not assume every repeat is a confirmation. Published: ' + JSON.stringify(s.sent));
});

test('a DIFFERENT button after a failed tap says something new, and toggles normally', async () => {
  const s = screen({ results: [UNCONFIRMED, OK] });
  await s.tap('going');
  s.scope.myRsvps = { 'ev-1': 'going' };
  await s.tap('maybe');
  assert.deepEqual(s.sent, [['ev-1', 'going'], ['ev-1', 'maybe']],
    'the hold swallowed a genuinely new answer: ' + JSON.stringify(s.sent));
});

test('CONTROL: with no failure behind it, pressing your current answer still withdraws it — and says so', async () => {
  const s = screen({ results: [OK] });
  s.scope.myRsvps = { 'ev-1': 'going' };
  await s.tap('going');
  assert.deepEqual(s.sent, [['ev-1', 'none']],
    'the deliberate toggle is gone: there is now no way to say "actually, ignore me"');
  assert.ok(s.toasts.some(t => /withdrawn/i.test(t)),
    'an answer was withdrawn with no word to the person who did it — round4-remaining exists for this');
});

test('a confirmed send releases the hold, so the toggle works again on the next tap', async () => {
  const s = screen({ results: [UNCONFIRMED, OK, OK] });
  await s.tap('going');
  s.scope.myRsvps = { 'ev-1': 'going' };
  await s.tap('going');          // repeats, lands
  await s.tap('going');          // …and now this is an ordinary press of the current answer
  assert.deepEqual(s.sent[2], ['ev-1', 'none'],
    'the hold is never released, so this member can never withdraw an answer again: ' + JSON.stringify(s.sent));
});

test('what she is TOLD: an unconfirmed answer does not claim the church has not been told', async () => {
  const s = screen({ results: [UNCONFIRMED] });
  await s.tap('going');
  assert.equal(s.toasts.length, 1, 'she was told nothing at all');
  assert.ok(!/hasn’t been told/.test(s.toasts[0]),
    'A MEMBER WHOSE RSVP REACHED HER CHURCH IS TOLD IT DID NOT. Shown: ' + s.toasts[0]);
  assert.match(s.toasts[0], /couldn’t confirm/i, 'nothing on screen says what actually happened: ' + s.toasts[0]);
  assert.ok(!/withdraw it/.test(s.toasts[0]) || /won’t withdraw it/.test(s.toasts[0]),
    'the message tells her to try again without saying what trying again will do: ' + s.toasts[0]);
});

test('…and an answer that never left the phone still says so, plainly', async () => {
  const s = screen({ results: [NOTSENT] });
  await s.tap('going');
  assert.match(s.toasts[0], /hasn’t been told/,
    'a settled failure was softened into "it may well have arrived" — nobody has this answer. Shown: ' + s.toasts[0]);
});

test('a failed answer is NOT recorded locally as given', async () => {
  const s = screen({ results: [UNCONFIRMED] });
  await s.tap('going');
  assert.deepEqual(s.scope.myRsvps, {},
    'the app recorded an answer the church never confirmed, so the screen shows her as going over nothing');
});

// ── THE CALLER, AND THE INVERSION THIS SHAPE EXISTS TO PREVENT ──────────────────────────────────────────
// CLAUDE.md rule 2. A text scan of app.jsx, which rule 3 forbids for asserting BEHAVIOUR — and this is not
// that. It enumerates the CALL SITES of setEventRsvp and checks none truth-tests the result, which is a
// property of the source text. A dead `false && setEventRsvp(...)` would still be counted, which is the safe
// direction: it would fail this test rather than pass it.
test('every caller of setEventRsvp reads .ok — truth-testing it would record an answer nobody confirmed', () => {
  const src = stripComments(APP);
  const sites = [...src.matchAll(/(\w+)\s*=\s*await window\.Fellowship\.setEventRsvp\(/g)].map(m => m[1]);
  assert.equal(sites.length, 1,
    'the number of setEventRsvp call sites changed (' + sites.length + '). Every one must read `.ok`; a new ' +
    'one that says `if (sent)` records an RSVP as delivered over a send that failed.');
  // ⚠ SCOPED TO setRsvp'S OWN BODY. `const sent = await …` is this file's house style and the serving-request
  // reply three lines above uses the SAME NAME — a file-wide scan for `if (sent)` matches THAT one and
  // reports a fault in code it never named. (CLAUDE.md: a mis-aimed slice reports what a blind test reports.)
  const body = stripComments(fnBody(APP, 'setRsvp: async (eventId, verdict) =>', 'setRsvp'));
  for (const v of sites) {
    assert.ok(!new RegExp('if\\s*\\(\\s*!?\\s*' + v + '\\s*\\)').test(body),
      'a caller truth-tests the setEventRsvp result (`if (' + v + ')`). It is an OBJECT and always truthy, so ' +
      'a failed send takes the success arm and she is shown as having answered.');
    assert.ok(new RegExp(v + '\\s*&&\\s*' + v + '\\.ok').test(body),
      'a caller does not check `' + v + '.ok` — it must, or delivery is never actually confirmed');
  }
});
