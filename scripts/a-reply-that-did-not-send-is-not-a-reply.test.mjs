// A SEND THAT LANDED NOWHERE MUST NOT COME BACK LOOKING LIKE ONE THAT DID.
// Run: node --test scripts/a-reply-that-did-not-send-is-not-a-reply.test.mjs
//
// AUDIT 2026-09-02 #6. Three member-facing sends shared one shape:
//
//     try { await _publishAny(window.Fellowship.relays, evt); } catch {}
//     return evt;
//
// `_publishAny` THROWS when no relay accepted it. So a total failure was swallowed and the event handed
// back anyway, and every caller read that as success:
//
//   · "Yes, I'll serve" / "I'm away"  — the member is thanked, the leader is never told, and the rota goes
//     on showing the slot unfilled. They do not turn up on Sunday. (This is the scenario
//     serving-response-honesty.test.mjs was named for, and the fix it was written to leave room for.)
//   · an RSVP                          — the same, for events.
//   · LEAVING A CHURCH                 — the worst of the three. The church was dropped from the device
//     whether or not the relay was told, so the member believes they have left while the church's records,
//     its rota and its directory still have them, and nothing on either side would ever correct it.
//
// This lifts the three shipped functions out of vendor/fellowship.js — not src — and runs them against a
// _publishAny that rejects the way the real one does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Slice one method out of the Fellowship object literal, balanced-brace, and run it with its collaborators
// injected. Nothing here is a paraphrase: the body is the shipped text.
function liftMethod(name) {
  const i = BUNDLE.indexOf('async ' + name + '(');
  assert.ok(i > 0, `${name} is not in the bundle — re-anchor this test`);
  let d = 0;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) return BUNDLE.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}

function runner(name, { publishFails, how }) {
  const body = liftMethod(name);
  // `async foo() {}` is object-method syntax; wrap it in an object literal to make it callable.
  const src = '({ ' + body + ' })';
  const calls = [];
  const finalizeEvent2 = (e) => ({ ...e, id: 'evt-id', sig: 'sig' });
  const _publishAny = async () => {
    calls.push('publish');
    if (publishFails) {
      // `how` shapes the error the way the real _publishAny shapes it — `.unsent` when nothing left the
      // device, NEITHER flag when every relay simply went quiet. That is what _pubReason reads, and the
      // difference is the whole of the 2026-09-16 change. (Omitting `how` keeps the pre-existing rows
      // exactly as they were: a bare Error, which the classifier reads as `unconfirmed`.)
      const e = new Error(how === 'unconfirmed'
        ? 'no relay accepted this'
        : 'NO_NETWORK_RELAY: none of this church\'s relays could be proved to be ours');
      if (how === 'not-sent') e.unsent = true;
      throw e;
    }
    return true;
  };
  const toPub = (x) => String(x || '').replace(/^npub/, '') || null;
  const window = { Fellowship: { relays: ['wss://r.example/relay'], ready: Promise.resolve() } };
  // 2026-09-06: leaveMembership now clears the "sent" stamp and any queued join intent after the tombstone
  // lands (fix/join-while-locked). Stubbed here so the happy-path control still reaches its return.
  // 2026-09-15: setEventRsvp and leaveMembership classify the failure through the SHIPPED `_pubReason`, so
  // that is lifted out of the bundle too rather than stubbed — a stub here would supply the very answer these
  // tests are named after.
  const _pubReason = new Function(fnBody(BUNDLE, 'function _pubReason(e)', '_pubReason') + '\nreturn _pubReason;')();
  const obj = new Function('finalizeEvent2', '_publishAny', 'toPub', 'window', 'sk', 'NET', 'Date', 'JSON', 'Math', '_clearJoinSent', '_dropJoinIntent', '_pubReason',
    'return ' + src)(finalizeEvent2, _publishAny, toPub, window, 'sk-bytes', 'trinityone', Date, JSON, Math, () => {}, () => {}, _pubReason);
  return { fn: obj[name], calls };
}

// 2026-09-15, chunk 2: two of these three grew a REASON, because `_publishAny` also throws when nobody
// acknowledged in time and that is not the same as a refusal. They answer `{ ok, evt, reason }` now.
// 2026-09-16: SO DOES THE THIRD. respondToServingRequest's `null` was reported to the member as "you're
// still shown as not having replied" for all three outcomes at once — so a member whose reply had very
// probably landed went and arranged cover for a Sunday she was already down for. That is the opposite lie
// and it costs somebody a wasted morning.
// The invariant this file exists for is unchanged and is what these rows assert: A SEND THAT LANDED NOWHERE
// MUST NOT COME BACK LOOKING LIKE ONE THAT DID. For the object shape that means `ok === false` — and an
// object being TRUTHY is exactly why every caller had to change in the same commit (see the per-writer notes
// in src/fellowship.src.js).
const CASES = [
  ['respondToServingRequest', ['npub1church', 'req-1', 'accept', ''], 'object',
   'a member taps "Yes, I\'ll serve", is thanked, and the leader is never told'],
  ['setEventRsvp', ['npub1church', 'ev-1', 'going'], 'object',
   'a member RSVPs, sees it recorded, and the church never receives it'],
  ['leaveMembership', ['npub1church'], 'object',
   'a member leaves, the church is removed from their phone, and the church still has them'],
];

for (const [name, args, shape, why] of CASES) {
  test(`${name}: a publish that reached NO relay does not report a send`, async () => {
    const { fn, calls } = runner(name, { publishFails: true });
    const out = await fn(...args);
    assert.deepEqual(calls, ['publish'], `${name} did not attempt a publish at all — re-anchor this test`);
    if (shape === 'null') {
      assert.equal(out, null,
        `${name} handed its event back after every relay refused it, so the caller reads it as sent: ${why}`);
    } else {
      assert.equal(out && out.ok, false,
        `${name} reported a send after every relay refused it, so the caller reads it as sent: ${why}. ` +
        `Got: ${JSON.stringify(out)}`);
      assert.equal(out.evt, undefined,
        `${name} still hands the event back on a failure — a caller that reaches for it reads a send that never happened`);
    }
  });

  test(`CONTROL: ${name} still returns the event when a relay DID accept it`, async () => {
    // Without this the fix could be "always fail", which would break every one of these controls.
    const { fn } = runner(name, { publishFails: false });
    const out = await fn(...args);
    const evt = shape === 'null' ? out : (out && out.ok ? out.evt : null);
    assert.ok(evt && evt.kind === 30078,
      `${name} no longer returns its event on the happy path — the control would report failure every time`);
  });
}

// ── AND THE OTHER DIRECTION, WHICH IS THE ONE NOBODY LOOKS FOR ────────────────────────────────────────────
//
// Every row above asks "does a failure come back looking like a send?". These ask the opposite: does a send
// nobody ANSWERED come back looking like a settled failure? For a month `respondToServingRequest` returned
// `null` for all three outcomes, and the screen said "you're still shown as not having replied" over a reply
// that had very probably landed. Believing the church never heard, a member arranges cover for a Sunday she
// is already down for — a wrong failure message costs somebody a wasted morning, which is why it is worse
// than no message.
//
// The classifier is the SHIPPED `_pubReason`, lifted out of the bundle inside runner() above and never a
// stub, because an injected outcome cannot catch a dead classifier. The rows below drive it for real, and
// each has its opposite twin so "always answer unconfirmed" cannot pass either.
const REASONED = ['respondToServingRequest', 'setEventRsvp', 'leaveMembership'];
const ARGS = {
  respondToServingRequest: ['npub1church', 'req-1', 'accept', ''],
  setEventRsvp: ['npub1church', 'ev-1', 'going'],
  leaveMembership: ['npub1church'],
};

for (const name of REASONED) {
  test(`${name}: nothing left the device -> reason 'not-sent'`, async () => {
    const { fn } = runner(name, { publishFails: true, how: 'not-sent' });
    const out = await fn(...ARGS[name]);
    assert.equal(out && out.ok, false, `${name} claimed a send when nothing left the phone`);
    assert.equal(out.reason, 'not-sent',
      `${name} softened a settled failure into "we couldn't confirm it". That is the direction that leaves ` +
      'a rota, a church or a family relying on something that was never sent.');
  });

  test(`${name}: nobody answered -> reason 'unconfirmed', NOT a settled failure`, async () => {
    const { fn } = runner(name, { publishFails: true, how: 'unconfirmed' });
    const out = await fn(...ARGS[name]);
    assert.equal(out && out.ok, false, `${name} must not claim success when nothing was acknowledged`);
    assert.equal(out.reason, 'unconfirmed',
      `${name} is still calling an unanswered publish a settled failure, so the screen can only say the ` +
      'sentence that sends somebody to redo work already done');
  });
}

// ── setUnavailable IS THE ODD ONE OUT: IT THROWS, AND THE REASON RIDES ON WHAT IT THROWS ──────────────────
//
// It has thrown since the audit of 2026-09-14 (a `catch {}` there let a member mark themselves away while
// still pending approval and be told it saved). But the reason was lost with it, so UnavailSheet could only
// say "That didn't reach your church, so nothing was saved" for all three outcomes — including the one where
// the document is signed, on the wire, and usually lands a moment later. `reason` is ATTACHED rather than
// returned so that every existing `catch` keeps working unchanged.
//
// ⚠ THIS EXISTS BECAUSE NOTHING ELSE COVERS IT. away-sundays-are-not-lost.test.mjs renders the sheet but
// stubs ctx.setUnavailableDates, so sabotaging `_pubReason` here was caught by NOTHING on 2026-09-16.
function unavailRunner({ how }) {
  const src = '({ ' + liftMethod('setUnavailable') + ' })';
  const _publishBounded = async () => {
    // _publishBounded races _publishAny against a timer that rejects with a BARE Error — no flags — which is
    // exactly the shape that must read as `unconfirmed`.
    const e = new Error(how === 'unconfirmed' ? 'timeout' : 'NO_NETWORK_RELAY: nothing could be proved ours');
    if (how === 'not-sent') e.unsent = true;
    if (how === 'refused') e.refused = true;
    throw e;
  };
  const _pubReason = new Function(fnBody(BUNDLE, 'function _pubReason(e)', '_pubReason') + '\nreturn _pubReason;')();
  const window = { Fellowship: { relays: ['wss://r.example/relay'], ready: Promise.resolve(), myPubkey: 'me-pub' } };
  return new Function('finalizeEvent2', '_publishBounded', 'toPub', 'window', 'sk', 'NET', 'UNAVAIL_MIRROR',
    'localStorage', '_pubReason', 'Date', 'JSON', 'Math', 'Array',
    'return ' + src)(
    (e) => ({ ...e, id: 'evt-id' }), _publishBounded, (x) => String(x || '') || null, window, 'sk-bytes',
    'trinityone', 'unavail:', { setItem() {}, getItem: () => null }, _pubReason, Date, JSON, Math, Array,
  ).setUnavailable;
}

for (const how of ['not-sent', 'refused', 'unconfirmed']) {
  test(`setUnavailable: a failure carries reason '${how}' on what it throws`, async () => {
    const fn = unavailRunner({ how });
    await assert.rejects(
      () => fn('npub1church', ['2026-09-20']),
      (e) => {
        assert.equal(e.reason, how,
          `setUnavailable lost the reason, so the away-Sundays sheet can only say "nothing was saved" — ` +
          'which over an unanswered save sends the member to tell their leader about dates the rota has. ' +
          `Got: ${JSON.stringify(e.reason)}`);
        return true;
      });
  });
}

test('CONTROL: setUnavailable still resolves with its event when the publish worked', async () => {
  // Without this, "always throw" would satisfy all three rows above.
  const src = '({ ' + liftMethod('setUnavailable') + ' })';
  const window = { Fellowship: { relays: ['wss://r.example/relay'], ready: Promise.resolve(), myPubkey: 'me-pub' } };
  const fn = new Function('finalizeEvent2', '_publishBounded', 'toPub', 'window', 'sk', 'NET', 'UNAVAIL_MIRROR',
    'localStorage', '_pubReason', 'Date', 'JSON', 'Math', 'Array',
    'return ' + src)(
    (e) => ({ ...e, id: 'evt-id' }), async () => true, (x) => String(x || '') || null, window, 'sk-bytes',
    'trinityone', 'unavail:', { setItem() {}, getItem: () => null }, () => 'unconfirmed', Date, JSON, Math, Array,
  ).setUnavailable;
  const out = await fn('npub1church', ['2026-09-20']);
  assert.ok(out && out.kind === 30078, 'setUnavailable no longer returns its event on the happy path');
});
