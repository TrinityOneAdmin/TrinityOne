// AN UNDO PRESSED IN THE SAME SECOND MUST WIN — AND IT WAS A COIN TOSS.
// Run: node --test scripts/undo-beats-the-thing-it-undoes.test.mjs
//
// AUDIT 2026-09-04. pin/unpin and hide/unhide are PAIRS that write the same replaceable document, so "undo"
// is a second write to it. `created_at` is whole seconds, and NIP-01 breaks a tie by keeping the LOWEST
// event id — a hash, i.e. a coin toss. Measured before this fix: 200 same-second undos, 104 refused.
//
// What a leader sees is nothing at all: the relay ACCEPTS the undo and keeps the older copy, so the message
// stays removed or the pin stays put, with no error to explain it. The console has had `_monotonic` since it
// was written; the member app, where these four controls actually live, did not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

function liftMethod(name) {
  const i = BUNDLE.indexOf('async ' + name + '(');
  assert.ok(i > 0, name + ' is not in the bundle — re-anchor this test');
  let d = 0;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) return BUNDLE.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}

// The shipped _monotonicF, out of the bundle, with the real per-d-tag memory the four functions share.
function liftMonotonic() {
  const i = BUNDLE.indexOf('function _monotonicF(');
  assert.ok(i > 0, '_monotonicF is not in the bundle — the stamp was removed');
  let d = 0;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) return BUNDLE.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing _monotonicF');
}

// Both halves of a pair share the module's stamp memory, exactly as they do in the app.
function pair(a, b, frozenSecond) {
  const published = [];
  const src = '({ ' + liftMethod(a) + ', ' + liftMethod(b) + ' })';
  const names  = ['sk', 'window', 'toPub', 'NET', '_publishBounded', 'finalizeEvent2', '_monotonicF',
                  '_lastStampF', 'Date', 'JSON', 'Math', 'Number', 'String', 'console'];
  const FrozenDate = class extends Date { static now() { return frozenSecond * 1000; } };
  const values = ['sk', { Fellowship: { ready: Promise.resolve(), relays: ['wss://r/relay'] } },
                  (x) => String(x || 'cp'), 'trinityone',
                  async (_r, e) => { published.push(e); return true; },
                  (e) => ({ ...e, id: 'id-' + published.length }), null, new Map(),
                  FrozenDate, JSON, Math, Number, String, { warn() {} }];
  // _monotonicF must be the SHIPPED one, closing over the _lastStampF we hand in.
  const mono = new Function('_lastStampF', 'Date', 'Math', 'return ' + liftMonotonic().replace(/^function _monotonicF/, 'function'))(values[7], FrozenDate, Math);
  values[6] = mono;
  const obj = new Function(...names, 'return ' + src)(...values);
  return { fns: obj, published };
}

const NOW = 1756900000;

test('unpin in the same second outranks the pin it undoes', async () => {
  const { fns, published } = pair('pinPost', 'unpin', NOW);
  await fns.pinPost('npub1c', 'g1', { id: 'm1', text: 'hi' });
  await fns.unpin('npub1c', 'g1');
  assert.equal(published.length, 2, 'both writes must go out — re-anchor this test');
  assert.ok(published[1].created_at > published[0].created_at,
    'the undo carried the SAME created_at as the pin, so the relay kept whichever event id happened to be ' +
    'lower — the pin stays put about half the time, with nothing on screen to say why');
});

test('unhide in the same second outranks the hide it undoes', async () => {
  const { fns, published } = pair('hideMessage', 'unhideMessage', NOW);
  await fns.hideMessage('npub1c', 'g1', 'msg-1');
  await fns.unhideMessage('npub1c', 'g1', 'msg-1');
  assert.ok(published[1].created_at > published[0].created_at,
    'a removed message could not be brought back in the second it was removed');
});

test('the stamp is PER DOCUMENT — one room\'s pin does not push another\'s into the future', async () => {
  const { fns, published } = pair('pinPost', 'unpin', NOW);
  await fns.pinPost('npub1c', 'g1', { id: 'm1' });
  await fns.pinPost('npub1c', 'g1', { id: 'm2' });
  await fns.pinPost('npub1c', 'g2', { id: 'm3' });
  assert.equal(published[2].created_at, NOW,
    'a second room inherited the first room\'s bumped stamp, which drifts every document forward together');
  assert.equal(published[1].created_at, NOW + 1);
});

test('it never stamps past the relay\'s future clamp', async () => {
  // 700 writes in one second would run past +600s, which the relay refuses outright. Better a rare tie than
  // a document nothing will accept.
  const { fns, published } = pair('pinPost', 'unpin', NOW);
  for (let i = 0; i < 700; i++) await fns.pinPost('npub1c', 'g1', { id: 'm' + i });
  const worst = Math.max(...published.map(e => e.created_at));
  assert.ok(worst <= NOW + 600, 'stamped ' + (worst - NOW) + 's into the future; the relay clamp is 600s');
});

test('CONTROL: an ordinary write a second later keeps its own real time', async () => {
  const { fns, published } = pair('pinPost', 'unpin', NOW);
  await fns.pinPost('npub1c', 'g1', { id: 'm1' });
  const later = pair('pinPost', 'unpin', NOW + 5);
  await later.fns.pinPost('npub1c', 'g1', { id: 'm2' });
  assert.equal(later.published[0].created_at, NOW + 5,
    'the stamp is overriding real time — it must only ever break a tie');
});
