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

// THE REAL CLASSIFIER, LIFTED FROM THE SHIPPED BUNDLE — never a stub of it.
// An injected outcome cannot catch a dead classifier: hand these functions a hand-written `() => 'not-sent'`
// and they would report the right word with `_pubReason` deleted from the product. So run the one that ships.
const _pubReason = (function () {
  const i = BUNDLE.indexOf('function _pubReason(e) {');
  assert.ok(i > 0, '_pubReason is not in the bundle under that name — re-anchor this test');
  let d = 0;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) return new Function('return ' + BUNDLE.slice(i, k + 1) + '; return _pubReason;')(); }
  }
  throw new Error('unbalanced braces slicing _pubReason');
})();
// BASELINE for the instrument itself: a classifier that always answers the same word would make every
// reason row below meaningless, and it is one character away at all times.
test('CONTROL: the lifted _pubReason really does separate the three outcomes', () => {
  assert.equal(_pubReason({ unsent: true }), 'not-sent');
  assert.equal(_pubReason({ refused: true }), 'refused');
  assert.equal(_pubReason(new Error('nobody answered')), 'unconfirmed');
});

function runner(name, { publishFails, how }) {
  const src = '({ ' + liftMethod(name) + ' })';
  const calls = [];
  const finalizeEvent2 = (e) => ({ ...e, id: 'evt-id', sig: 'sig' });
  const _publishAny = async () => {
    calls.push('publish');
    if (publishFails) {
      // Shaped exactly as the real _publishAny shapes it: `.unsent` when nothing left the device, neither
      // flag when every relay simply went quiet. That is what _pubReason reads.
      const e = new Error(how === 'unconfirmed'
        ? 'no relay accepted this'
        : "NO_NETWORK_RELAY: none of this church's relays could be proved to be ours");
      if (how !== 'unconfirmed') e.unsent = true;
      throw e;
    }
    return true;
  };
  const churchRelays = () => ['wss://r.example/relay'];
  const window = { Fellowship: { churchPub: 'church-pub-hex', ready: Promise.resolve() } };
  // ⚠ A LIFTED FUNCTION HAS TWO CALLER LISTS: the code that calls it, and the tests that SLICE IT BY NAME
  // with a hand-written `names` array like this one. `_pubReason` was added to fillCareSlot and
  // clearCareSlot on 2026-09-16; without it here they throw ReferenceError and every row below fails for a
  // reason that has nothing to do with what it is testing. The REAL classifier is injected, never a stub —
  // an injected outcome cannot catch a dead classifier.
  const names  = ['finalizeEvent2', '_publishAny', 'churchRelays', 'window', 'sk', 'pub', 'NET', '_pubReason',
                  'CAREREQ_D', 'CAREREQSTATUS_D', 'CARESLOT_D', 'CARESKIP_D', 'Date', 'JSON', 'Math', 'console'];
  const values = [finalizeEvent2, _publishAny, churchRelays, window, 'sk-bytes', 'me-pub', 'trinityone', _pubReason,
                  'carereq:', 'carereqstatus:', 'careslot:', 'careskip:', Date, JSON, Math,
                  { warn() {} }];   // the real ones log; keep the test output clean
  const obj = new Function(...names, 'return ' + src)(...values);
  return { fn: obj[name], calls };
}

// STILL `evt | null`: these two report a failure and nothing more, which is all their callers ask of them.
const CASES = [
  ['cancelCareRequest',    ['req-1'],
   'the member is shown their request withdrawn while the care team still has it open'],
  ['setCareRequestStatus', ['req-1', 'asker-pub', { status: 'declined' }],
   'the asker is never told what happened, and waits'],
  ['clearCareSkip',        ['care-1', '2026-09-10'],
   'the day stays crossed out and nobody brings anything'],
];

// ⚠ THESE TWO CHANGED SHAPE ON 2026-09-16, to `{ ok, reason }` — the setEventRsvp shape.
// `null` collapsed three different outcomes into one, and the screen then said "you're NOT signed up" over
// a sign-up nobody had merely ACKNOWLEDGED, which is the opposite lie and sends a second volunteer to cook
// the same day. Their d-tag is fixed (`careslot:<careId>:<iso>`), so "tap it again" is safe and true.
const REASONED = [
  ['fillCareSlot',         ['care-1', '2026-09-10', 'lasagne'],
   'the volunteer believes they are bringing a meal and the slot still reads empty'],
  ['clearCareSlot',        ['care-1', '2026-09-10'],
   'the volunteer believes they stood down and is still the only name against that day'],
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

for (const [name, args, why] of REASONED) {
  test(`${name}: a publish that reached NO relay answers ok:false, and says nothing was sent`, async () => {
    const { fn, calls } = runner(name, { publishFails: true, how: 'not-sent' });
    const out = await fn(...args);
    assert.deepEqual(calls, ['publish'], `${name} did not attempt a publish at all — re-anchor this test`);
    assert.equal(out && out.ok, false,
      `${name} reported success after every relay refused it: ${why}`);
    assert.equal(out.reason, 'not-sent',
      `${name} softened "nothing left this phone" — the direction that leaves a family expecting a meal ` +
      'nobody ever promised');
  });

  test(`${name}: a publish NOBODY ANSWERED is reported as unconfirmed, not as a failure`, async () => {
    const { fn } = runner(name, { publishFails: true, how: 'unconfirmed' });
    const out = await fn(...args);
    assert.equal(out && out.ok, false, `${name} must not claim success when nothing was acknowledged`);
    assert.equal(out.reason, 'unconfirmed',
      `${name} is still calling an unanswered publish a settled failure. The event is signed and on the ` +
      'wire and usually lands a moment later; telling the member it did not is what sends them to do it twice.');
  });

  test(`CONTROL: ${name} still returns ok:true with the event when a relay DID accept it`, async () => {
    const { fn } = runner(name, { publishFails: false });
    const out = await fn(...args);
    assert.equal(out && out.ok, true, `${name} must report success when a relay accepted it`);
    assert.ok(out.evt && out.evt.id === 'evt-id',
      `${name} must still hand back the event — this control is what stops the fix becoming "always fail"`);
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
