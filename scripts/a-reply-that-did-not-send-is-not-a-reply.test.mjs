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
  const obj = new Function('finalizeEvent2', '_publishAny', 'toPub', 'window', 'sk', 'NET', 'Date', 'JSON', 'Math',
    'return ' + src)(finalizeEvent2, _publishAny, toPub, window, 'sk-bytes', 'trinityone', Date, JSON, Math);
  return { fn: obj[name], calls };
}

const CASES = [
  ['respondToServingRequest', ['npub1church', 'req-1', 'accept', ''],
   'a member taps "Yes, I\'ll serve", is thanked, and the leader is never told'],
  ['setEventRsvp', ['npub1church', 'ev-1', 'going'],
   'a member RSVPs, sees it recorded, and the church never receives it'],
  ['leaveMembership', ['npub1church'],
   'a member leaves, the church is removed from their phone, and the church still has them'],
];

for (const [name, args, why] of CASES) {
  test(`${name}: a publish that reached NO relay returns null`, async () => {
    const { fn, calls } = runner(name, { publishFails: true });
    const out = await fn(...args);
    assert.deepEqual(calls, ['publish'], `${name} did not attempt a publish at all — re-anchor this test`);
    assert.equal(out, null,
      `${name} handed its event back after every relay refused it, so the caller reads it as sent: ${why}`);
  });

  test(`CONTROL: ${name} still returns the event when a relay DID accept it`, async () => {
    // Without this the fix could be "always return null", which would break every one of these controls.
    const { fn } = runner(name, { publishFails: false });
    const out = await fn(...args);
    assert.ok(out && out.kind === 30078,
      `${name} no longer returns its event on the happy path — the control would report failure every time`);
  });
}
