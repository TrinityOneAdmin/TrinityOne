// WHAT THE WORKER IS ACTUALLY TOLD WHEN A CHECK-IN OR A COLLECTION DOES NOT COME BACK CLEAN.
// Run: node --test scripts/the-worker-screen-tells-her-which-of-three-happened.test.mjs
//
// The POINT OF USE for the engine change proved in a-check-in-that-landed-is-not-called-a-failure.test.mjs
// and, for how `refused` / `not-sent` are DECIDED on the wire, a-relay-that-says-no-is-not-a-relay-that-is-slow.
// (CLAUDE.md rule 1). That test proves writeCheckin/releaseCheckin now answer three ways. This one proves the
// SCREEN acts on the third one — delete the branch from screens-serving.jsx and the engine test stays green.
//
// THE HARM THIS GUARDS, in order:
//   • "Nothing was written" over a check-in that LANDED → she checks the child in again, which mints a
//     second record, and the parent's phone shows the child TWICE. Both rows carry the SAME code (it is not
//     regenerated on a retry), so either matches at collection — but collecting one leaves the OTHER showing
//     the child as still in the room for the rest of the window, on the parent's card and on the register,
//     with nothing prompting anyone to notice. ⚠ An earlier telling of this said "two pickup codes, one of
//     which fails the match"; the audit of 2026-09-14 checked it against the code and it is wrong.
//   • the same over a COLLECTION that landed → she releases the child a second time, or sends a family to
//     the desk over a child already signed out.
//   • and the reverse, which is worse: softening a REAL failure into "it may well have saved" would leave a
//     child in a room with no record anywhere that they are there.
//
// ⚠ RULE 3: `app/*.jsx` ships UNBUNDLED, so `false && ` in front of a condition leaves every word of it on
// disk and any text-matching assertion still passes. Both handlers are LIFTED OUT OF THE SHIPPED FILE AND
// RUN here — no assertion in this file matches source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SERV = readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8');

const NOTHING = /nothing was written/i;     // the claim that was false half the time

function run(anchor, what, extra, call) {
  // Both handlers OPEN by clearing what is on screen — setErr(''), setMsg(null). That reset is not an
  // answer, so only what they say AFTERWARDS is collected.
  const seen = { err: [], msg: [], code: [], cleared: 0 };
  const scope = {
    busy: false, setBusy: () => {},
    setErr: (t) => { if (t) seen.err.push(String(t)); },
    setMsg: (m) => { if (m) seen.msg.push(m); },
    setMode: () => { seen.cleared++; }, setEntry: () => {},
    setPending: () => {}, setName: () => {}, setPicked: () => {}, setScanned: () => {},
    setCode: (c) => seen.code.push(c), svNewCode: () => 'NEW1',
    code: '1234', session: 'svc-am', scanned: [], queue: [],
    rec: { id: 'ci1', session: 'svc-am', code: '1234', guardians: [] },
    String, JSON, Date, Math, Number, Array, Object, Boolean, RegExp, console, Promise,
    ...extra,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped handler needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', 'with (scope) { ' + fnBody(SERV, anchor, what) + '\nreturn ' + what + '; }')(proxy);
  return call(fn).then(() => seen);
}

// ctx.checkinAdd / ctx.checkinRelease answer exactly what the engine answers.
const answering = (key, res) => ({ ctx: { [key]: async () => res } });

const CHECKIN  = ['const write = async (childName, guardian) => {', 'write'];
const RELEASE  = ['const release = async (manual) => {', 'release'];

test('CHECK-IN: an UNCONFIRMED write must not be reported as "nothing was written"', async () => {
  const s = await run(...CHECKIN, answering('checkinAdd', { ok: false, reason: 'unconfirmed' }),
    f => f('Milo', ''));
  assert.equal(s.msg.length, 1, 're-anchor: the handler said nothing at all');
  assert.equal(s.msg[0].ok, false, 're-anchor: an unconfirmed write was painted as a success');
  assert.doesNotMatch(s.msg[0].text, NOTHING,
    'THE SCREEN STILL CLAIMS "Nothing was written" OVER A CHECK-IN THAT MAY HAVE LANDED. She checks the ' +
    'child in again and the parent ends up with two rows for one child; collecting one leaves the other ' +
    'showing the child still in the room. Shown: ' + s.msg[0].text);
});

test('CHECK-IN: a REAL failure is still flatly a failure — no softening', async () => {
  // `not-sent` is the admission gate (rule 10) or an empty relay list — nothing left the phone at all.
  for (const reason of ['refused', 'not-sent', 'no-key', 'threw', 'unavailable']) {
    const s = await run(...CHECKIN, answering('checkinAdd', { ok: false, reason }), f => f('Milo', ''));
    assert.match(s.msg[0].text, NOTHING,
      'A SETTLED FAILURE (' + reason + ') is being softened into "it may well have saved". A child is in a ' +
      'room and the church has no record of it. Shown: ' + s.msg[0].text);
  }
});

test('CHECK-IN: neither failure clears the form or burns the code — she can try again', async () => {
  for (const reason of ['unconfirmed', 'refused', 'not-sent']) {
    const s = await run(...CHECKIN, answering('checkinAdd', { ok: false, reason }), f => f('Milo', ''));
    assert.equal(s.code.length, 0,
      'the pickup code was regenerated over a FAILED check-in (' + reason + '), so the code on screen no ' +
      'longer matches the one the parent was given');
  }
});

test('CHECK-IN: and a write that landed says so, and moves on to the next child', async () => {
  const s = await run(...CHECKIN, answering('checkinAdd', { ok: true, id: 'ci1' }), f => f('Milo', ''));
  assert.equal(s.msg[0].ok, true, 're-anchor: a successful check-in no longer reports success');
  assert.deepEqual(s.code, ['NEW1'], 'a fresh pickup code must be drawn for the next child');
});

test('COLLECTION: an UNCONFIRMED release must not be reported as "nothing was written"', async () => {
  const s = await run(...RELEASE, answering('checkinRelease', { ok: false, reason: 'unconfirmed' }),
    f => f(false));
  assert.equal(s.err.length, 1, 're-anchor: the handler said nothing at all');
  assert.doesNotMatch(s.err[0], NOTHING,
    'THE SCREEN STILL CLAIMS "Nothing was written" OVER A COLLECTION THAT MAY HAVE LANDED — so she releases ' +
    'the child a second time, or sends a family to the desk over a child already signed out. Shown: ' + s.err[0]);
});

test('COLLECTION: a REAL failure is still flatly a failure', async () => {
  for (const reason of ['refused', 'not-sent', 'no-key', 'no-rel']) {
    const s = await run(...RELEASE, answering('checkinRelease', { ok: false, reason }), f => f(false));
    assert.match(s.err[0], NOTHING,
      'A SETTLED failure (' + reason + ') on a COLLECTION is being softened into "it may well have saved" — ' +
      'the register will show the child still in the room. Shown: ' + s.err[0]);
  }
});

test('COLLECTION: an UNCONFIRMED release does NOT close the code box — the row has not folded', async () => {
  // Closing it would say, in layout, that the child is collected. Only `ok` may do that.
  const s = await run(...RELEASE, answering('checkinRelease', { ok: false, reason: 'unconfirmed' }), f => f(false));
  assert.equal(s.cleared, 0, 'the collection box closed over a release nobody confirmed');
  const good = await run(...RELEASE, answering('checkinRelease', { ok: true, id: 'cr1' }), f => f(false));
  assert.equal(good.cleared, 1, 're-anchor: a confirmed collection no longer folds the row');
  assert.equal(good.err.length, 0, 're-anchor: a confirmed collection now shows an error');
});

test('a handler with NO engine behind it fails flatly, never hopefully', async () => {
  // ctx missing entirely — the `{ ok:false }` / `{ ok:false, reason:'unavailable' }` fallbacks. Nothing was
  // sent, so "it may well have saved" would be a straight falsehood.
  const s = await run(...CHECKIN, { ctx: {} }, f => f('Milo', ''));
  assert.match(s.msg[0].text, NOTHING, 'a check-in that never reached an engine was reported as possibly saved');
  const r = await run(...RELEASE, { ctx: {} }, f => f(false));
  assert.match(r.err[0], NOTHING, 'a release that never reached an engine was reported as possibly saved');
});
