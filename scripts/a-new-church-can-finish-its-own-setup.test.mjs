// A NEW CHURCH MUST BE ABLE TO FINISH ITS OWN SETUP — AND A RESTORED ONE MUST NOT BE RE-KEYED.
// Run: node --test scripts/a-new-church-can-finish-its-own-setup.test.mjs
//
// Measured 2026-09-07 while staging a church for sim round 4, before any agent ran. The wizard's
// "Your regular meetings" step could not succeed on a brand-new church, ever:
//
//   publishMeeting -> publishEvent -> _sealChurchDocReady(doc)
//   ring empty, poll 120ms up to NAME_KEY_WAIT_MS, still empty -> _sealChurchDoc returns null
//   -> "the church key never arrived: NOT saved, and never in the clear"
//
// The seal is right and is not what changed. What was missing is that a new church has no name key at
// all: every caller of ensureNameKeyForMembers is in the Members area, which setup never reaches. So the
// step failed, blamed the relay ("the relay didn't accept them") which was never asked, offered no way
// past — the primary button only reads "Skip for now" while every row is blank, and this step arrives
// PRE-FILLED — and the sole escape was reloading the page, which nothing on screen suggests.
//
// THE RISK THIS FILE EXISTS TO PIN. The same wizard is the RESTORE path. A restored church may already
// hold a name key; minting a second ring publishes it newest-wins and every sealed name, message and
// calendar entry in that congregation stops opening. src/steward.src.js carries a comment about exactly
// that happening once, via a delegated console holding an empty ring. So the mint is gated on
// `trinityone.steward.newchurch`, the positive marker seedNewChurch sets when THIS device minted THIS
// key — never on inference. Test 2 is the one that matters.
//
// Point of use (rule 1): these EXECUTE the real saveMeetings out of app/stew-dashboard.jsx, which the
// console ships unbundled, rather than matching text in it (rule 3 forbids that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STEW = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

function arrowBody(src, anchor) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, anchor + ' is missing — re-anchor this test rather than widening a window');
  const eq = src.indexOf('=', at);
  const asyncAt = src.indexOf('async', eq);
  const paren = src.indexOf('(', eq);
  const arrow = (asyncAt !== -1 && asyncAt < paren) ? asyncAt : paren;
  const open = src.indexOf('{', src.indexOf('=>', paren));
  let d = 0, i = open;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  const body = src.slice(arrow, i + 1);
  assert.ok(body.length > 300, anchor + ' sliced to a stub — re-anchor rather than widening');
  return body;
}
function run(anchor, scope) {
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/\d+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return (${arrowBody(STEW, anchor)}); }`)(proxy);
}

const ROWS = [{ id: 'm1', title: 'Sunday Service', day: 0, time: '10:00', recur: 'weekly' },
              { id: 'm2', title: 'Midweek', day: 3, time: '19:30', recur: 'weekly' }];

// `newchurch` null models the RESTORE path: the marker is only ever set by seedNewChurch.
function scopeFor({ newchurch, publishOk = true }) {
  const st = { advanced: 0, err: '', mintCalls: 0 };
  const scope = {
    meetings: ROWS,
    setBusy: () => {},
    setMeetingErr: (v) => { st.err = v; },
    next: () => { st.advanced++; },
    localStorage: { getItem: (k) => (k === 'trinityone.steward.newchurch' ? newchurch : null) },
    window: { Steward: {
      ensureNameKeyForMembers: async () => { st.mintCalls++; return { ok: 1 }; },
      publishMeeting: async () => (publishOk ? { id: 'x' } : null),
    } },
    setTimeout, Promise,
  };
  return { st, fn: run('const saveMeetings = async () => {', scope) };
}

test('a brand-new church mints its name key before sealing the first meeting against it', async () => {
  const g = scopeFor({ newchurch: '1' });
  await g.fn();
  assert.equal(g.st.mintCalls, 1,
    'setup did not mint the name key, so publishEvent will seal against an empty ring and return null — ' +
    'the step can never succeed on a new church');
  assert.equal(g.st.advanced, 1, 'the wizard did not advance after a successful save');
  assert.equal(g.st.err, '', 'a successful save reported an error');
});

test('THE ONE THAT MATTERS: a RESTORED church is never re-keyed by the wizard', async () => {
  const g = scopeFor({ newchurch: null });   // no marker -> restore, adopt, or any later visit
  await g.fn();
  assert.equal(g.st.mintCalls, 0,
    'the wizard minted a name key for a church this device did NOT create. If that church already had ' +
    'one, the new ring wins newest-wins and every sealed name, message and calendar entry in that ' +
    'congregation stops opening.');
  assert.equal(g.st.advanced, 1, 'a restored church must still get through the step');
});

test('a failed save does not blame the relay, and offers a way out', async () => {
  const g = scopeFor({ newchurch: '1', publishOk: false });
  await g.fn();
  assert.equal(g.st.advanced, 0, 'the wizard advanced over meetings that never saved');
  assert.ok(g.st.err, 'a total failure said nothing');
  assert.doesNotMatch(g.st.err, /relay didn.t accept|check you.re online/i,
    'the message blames the relay for a failure it was never asked about — the seal gives up before any ' +
    'write is attempted');
  assert.match(g.st.err, /still here/i, 'the steward is not told their typing survived');
});

// The escape is rendered, not merely described: the primary button reads "Skip for now" ONLY while every
// row is blank, and this step arrives pre-filled — so without this the failure state has no way forward.
test('the failure state renders a skip', () => {
  const at = STEW.indexOf('{meetingErr ? <div');
  assert.notEqual(at, -1, 'the meetingErr banner moved — re-anchor');
  const block = STEW.slice(at, at + 1400);
  assert.match(block, /Skip for now and finish setup/, 'the failure banner offers no way past the step');
  assert.match(block, /onClick=\{next\}/, 'the skip does not advance the wizard');
});
