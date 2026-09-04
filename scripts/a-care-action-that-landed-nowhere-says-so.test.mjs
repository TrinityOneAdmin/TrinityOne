// FIVE MORE CARE ACTIONS THAT REPORTED SUCCESS WHATEVER HAPPENED.
// Run: node --test scripts/a-care-action-that-landed-nowhere-says-so.test.mjs
//
// The 2026-09-04 sweep, after the pre-merge audit found `setCareAvail` doing this. Same shape as the
// serving reply, the RSVP and leaving a church (a-reply-that-did-not-send-is-not-a-reply.test.mjs):
//
//     try { await _publishAny(churchRelays(), evt); } catch {}
//     return evt;
//
// `_publishAny` THROWS when no relay accepted. Swallowing that and handing the event back means every
// caller reads a total failure as a success. What each one costs a person:
//
//   · cancelCareRequest    — a member withdraws their ask for help, is shown it gone, and the care team
//                            still has it open. They neither expect help nor ask again.
//   · setCareRequestStatus — the care team closes or approves a request. The asker reads this document to
//                            learn what happened to them: if it never lands they wait on "your care team
//                            will be in touch" indefinitely, and the team may work the request twice.
//   · fillCareSlot         — "I'll bring Tuesday's meal." The slot still reads empty to everyone else, so
//                            either nobody comes or two people do, and the volunteer never finds out.
//   · clearCareSlot        — standing down from a day. They believe they withdrew; they are still the only
//                            name against it.
//   · clearCareSkip        — a recipient undoing "not Thursday". The day stays crossed out and nobody
//                            brings anything.
//
// This lifts the SHIPPED functions out of vendor/fellowship.js — not src — and runs them against a
// _publishAny that rejects exactly the way the real one does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

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
  const src = '({ ' + liftMethod(name) + ' })';
  const calls = [];
  const finalizeEvent2 = (e) => ({ ...e, id: 'evt-id', sig: 'sig' });
  const _publishAny = async () => {
    calls.push('publish');
    if (publishFails) throw new Error("NO_NETWORK_RELAY: none of this church's relays could be proved to be ours");
    return true;
  };
  const churchRelays = () => ['wss://r.example/relay'];
  const window = { Fellowship: { churchPub: 'church-pub-hex', ready: Promise.resolve() } };
  const names  = ['finalizeEvent2', '_publishAny', 'churchRelays', 'window', 'sk', 'pub', 'NET',
                  'CAREREQ_D', 'CAREREQSTATUS_D', 'CARESLOT_D', 'CARESKIP_D', 'Date', 'JSON', 'Math', 'console'];
  const values = [finalizeEvent2, _publishAny, churchRelays, window, 'sk-bytes', 'me-pub', 'trinityone',
                  'carereq:', 'carereqstatus:', 'careslot:', 'careskip:', Date, JSON, Math,
                  { warn() {} }];   // the real ones log; keep the test output clean
  const obj = new Function(...names, 'return ' + src)(...values);
  return { fn: obj[name], calls };
}

const CASES = [
  ['cancelCareRequest',    ['req-1'],
   'the member is shown their request withdrawn while the care team still has it open'],
  ['setCareRequestStatus', ['req-1', 'asker-pub', { status: 'declined' }],
   'the asker is never told what happened, and waits'],
  ['fillCareSlot',         ['care-1', '2026-09-10', 'lasagne'],
   'the volunteer believes they are bringing a meal and the slot still reads empty'],
  ['clearCareSlot',        ['care-1', '2026-09-10'],
   'the volunteer believes they stood down and is still the only name against that day'],
  ['clearCareSkip',        ['care-1', '2026-09-10'],
   'the day stays crossed out and nobody brings anything'],
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
    // Without this, "always return null" would pass every test above.
    const { fn } = runner(name, { publishFails: false });
    const out = await fn(...args);
    assert.ok(out && out.id === 'evt-id', `${name} must return the event on success — this control is what stops the fix becoming "always fail"`);
  });
}

// The two-publish case, RUN rather than read: approveCareRequest publishes the NEED, then marks the request
// approved. The second can fail on its own, and that is neither success nor failure — help IS set up, and
// the request is still sitting open on the care team's screen.
test('approveCareRequest reports the half that did not land', async () => {
  const src = '({ ' + liftMethod('approveCareRequest') + ' })';
  const statusResults = [];
  const mk = (statusLands) => {
    const window = { Fellowship: {
      churchPub: 'church-pub-hex', ready: Promise.resolve(),
      // the real setCareRequestStatus now returns null when no relay accepted — that is the whole point
      async setCareRequestStatus() { statusResults.push(statusLands); return statusLands ? { id: 'status-evt' } : null; },
    } };
    const names  = ['window', 'sk', '_carekeys', 'profiles', '_careSeal', '_hex', 'crypto', 'finalizeEvent2',
                    '_publishAny', 'churchRelays', 'CARE_D', 'NET', 'Date', 'JSON', 'Math', 'String', 'Array', 'Set', 'console'];
    const values = [window, 'sk-bytes', { 'church-pub-hex': 'k' }, {}, () => 'sealed-blob', () => 'abc123',
                    { getRandomValues: (a) => a }, (e) => ({ ...e, id: 'evt-id' }), async () => true,
                    () => ['wss://r.example/relay'], 'care:', 'trinityone', Date, JSON, Math, String, Array, Set,
                    { warn() {} }];
    return new Function(...names, 'return ' + src)(...values).approveCareRequest;
  };

  const bothLanded = await mk(true)({ id: 'req-1', from: 'asker', forSelf: true, type: 'meals' }, { dates: ['2026-09-10'] });
  assert.ok(bothLanded && bothLanded.id, 'the need must still come back when everything worked');
  assert.equal(bothLanded.stillOpen, false,
    'CONTROL: with both publishes accepted the request is NOT still open — without this the fix could be "always warn"');

  const halfLanded = await mk(false)({ id: 'req-1', from: 'asker', forSelf: true, type: 'meals' }, { dates: ['2026-09-10'] });
  assert.ok(halfLanded && halfLanded.id,
    'the NEED was published and accepted, so approve must not report total failure — help really is set up');
  assert.equal(halfLanded.stillOpen, true,
    'the request was never marked approved and approveCareRequest did not say so: the steward is told "opened as a need", the asker is still reading "your care team will be in touch", and the request sits open to be worked twice');
  assert.deepEqual(statusResults, [true, false], 'approveCareRequest stopped calling setCareRequestStatus — re-anchor this test');
});
