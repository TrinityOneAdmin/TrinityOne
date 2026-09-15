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

function runner(name, { publishFails }) {
  const body = liftMethod(name);
  // `async foo() {}` is object-method syntax; wrap it in an object literal to make it callable.
  const src = '({ ' + body + ' })';
  const calls = [];
  const finalizeEvent2 = (e) => ({ ...e, id: 'evt-id', sig: 'sig' });
  const _publishAny = async () => {
    calls.push('publish');
    if (publishFails) throw new Error('NO_NETWORK_RELAY: none of this church\'s relays could be proved to be ours');
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
// acknowledged in time and that is not the same as a refusal. They answer `{ ok, evt, reason }` now;
// respondToServingRequest is untouched and still answers `evt | null`. The invariant this file exists for is
// unchanged and is what `falsy` below asserts: A SEND THAT LANDED NOWHERE MUST NOT COME BACK LOOKING LIKE ONE
// THAT DID. For the object shape that means `ok === false` — and an object being TRUTHY is exactly why every
// caller had to change in the same commit (see the per-writer notes in src/fellowship.src.js).
const CASES = [
  ['respondToServingRequest', ['npub1church', 'req-1', 'accept', ''], 'null',
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
