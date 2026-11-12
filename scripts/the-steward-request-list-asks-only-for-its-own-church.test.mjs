// THE STEWARD-REQUEST LIST ASKS ONLY FOR ITS OWN CHURCH'S TWO DOCUMENTS.
//   Run: node --test scripts/the-steward-request-list-asks-only-for-its-own-church.test.mjs
//
// subscribeStewardRequests used to ask the relay for `{kinds:[30078], '#t':['trinityone']}` — every church's
// whole public corpus, filtered afterwards in the browser. On a big relay that is megabytes per connect (Living
// Word: ~17 MB over 17 such subscriptions; the relay closes the socket at 16 MB). It now asks for exactly
// A's stewardreq:<A> and stewards:<A> d-tags.
//
// POINT OF USE (CLAUDE.md rule 1): the real gateway, the real console in headless chromium, church A made the
// real way; church B on the same relay with 50 unrelated documents and its own helper's request. The REAL bundled
// Steward.subscribeStewardRequests is called as A and the frames that crossed the socket are read.
//
// WHAT EACH ASSERTION GUARDS. (1) the REQ has a '#d' on every filter naming exactly A's two d-tags, and (2) at most
// 3 EVENT frames came back — these two FAIL with the old filter. (3) the emitted list is exactly [Y] — this
// PASSES with the old filter too (the handler always ignored other churches' rows); it only proves the narrowing
// did not lose A's own request nor the roster that hides an already-approved helper (Z).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openRig, otherChurchPile, doc, CHROME, probe, sleep } from './narrow-reads-rig.mjs';
import { H } from './narrow-reads-rig.mjs';

const STEWARDREQ_D = 'trinityone/stewardreq:', STEWARDS_D = 'trinityone/stewards:';
let A = null; const Y = H.key(), Z = H.key(), X = H.key();

before(async () => {
  if (!CHROME) return;
  A = await openRig('stewreq');
  const reqBody = JSON.stringify({ name: 'Helper' });
  await A.put([
    doc(Y, STEWARDREQ_D + A.church.pub, reqBody, [['p', A.church.pub]]),                 // Y asks A
    doc(Z, STEWARDREQ_D + A.church.pub, reqBody, [['p', A.church.pub]]),                 // Z asks A, and is already on A's roster
    doc(A.church, STEWARDS_D + A.church.pub, { pubkeys: [Z.pub] }),
    doc(X, STEWARDREQ_D + A.other.pub, reqBody, [['p', A.other.pub]]),                   // X asks B, not A
    doc(A.other, STEWARDS_D + A.other.pub, { pubkeys: [X.pub] }),
    ...otherChurchPile(A, 50),
  ]);
});
after(() => { try { A && A.close(); } catch {} });

let probed = null;
const get = () => (probed ||= probe(A, `window.Steward.subscribeStewardRequests(l => window.__probe.out.push(l.map(x => x.pubkey)))`));
const T = { skip: !CHROME, timeout: 240000 };

test('(1) every filter of the request list carries a #d naming exactly A\'s two documents', T, async () => {
  const r = await get();
  const want = [STEWARDREQ_D + A.church.pub, STEWARDS_D + A.church.pub].sort();
  assert.ok(r.filters.length >= 1, 'no filters in the REQ');
  for (const f of r.filters) assert.ok(Array.isArray(f['#d']), 'a filter in the request list has NO #d — it pulls the whole church corpus: ' + JSON.stringify(f));
  assert.deepEqual([...new Set(r.filters.flatMap(f => f['#d']))].sort(), want, 'the request list asked for the wrong d-tags');
});

test('(2) the relay sends at most 3 events on the request subscription, with 50 of church B\'s documents on it', T, async () => {
  const r = await get();
  assert.ok(r.events.length <= 3, 'the relay sent ' + r.events.length + ' events on the request subscription — it is reading other churches\' documents');
});

test('(3) the emitted list is exactly [Y] (also true with the old filter: guards only that nothing was lost)', T, async () => {
  const r = await get();
  assert.deepEqual(r.out[r.out.length - 1], [Y.pub], 'the emitted request list is not exactly [Y]: ' + JSON.stringify(r.out));
});
