// THE CONSOLE AND THE WORKER'S PHONE MUST AGREE ABOUT WHO IS STILL IN THE ROOM.
//   Run: node --test scripts/the-console-register-folds-a-workers-release.test.mjs
//
// Measured on the Oppo, 2026-09-11, with slice C on the phone: a cleared worker collected a child from her
// own phone, her screen read "0 checked in · 1 collected" — and the safeguarding lead's console still listed
// that child as CHECKED IN, with a "Check out" button, after she had gone home. The release DID reach the
// relay; the console simply ignored it.
//
// A worker's checkout is a SEPARATE `checkin:<newId>` document carrying a cleartext ['rel', <checkinId>] tag
// (F-B refuses a helper writing over the church's own record). The member reader folded it from the start;
// this file pins the console half, against the SHIPPED bundle rather than a copy of the rule.
//
// Rule 3: nothing here matches text in a .jsx. The reader is lifted out of vendor/steward.js and run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Run the SHIPPED subscribeCheckins over a stubbed encSubscribe, so what is under test is the fold itself.
function reader(rows) {
  const out = [];
  const scope = {
    window: { Steward: { encSubscribe: (prefix, cb, kind) => { scope._seen = { prefix, kind }; cb(rows); return () => {}; } } },
    String, Map, Number, Boolean, Object, Array, JSON, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the console register reader needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' + fnBody(VENDOR, 'subscribeCheckins(cb) {', 'subscribeCheckins') + ' }); }')(proxy);
  api.subscribeCheckins((r) => out.push(r));
  assert.equal(scope._seen.prefix, 'trinityone/checkin:', 're-anchor: the console no longer reads the check-in prefix');
  assert.equal(scope._seen.kind, 'checkin', 're-anchor: the console no longer opens these with the check-in ring');
  assert.equal(out.length, 1, 'the reader emitted ' + out.length + ' times for one delivery');
  return out[0];
}

const SID = 'svc-am', OTHER = 'svc-pm';
const child = (id, name, over = {}) => ({ id, childName: name, code: '8400', date: '2026-09-11', in: 1000, out: null, _sid: SID, _rel: '', ts: 1000, ...over });
const release = (id, relId, over = {}) => ({ id, out: 2000, manual: false, _sid: SID, _rel: relId, ts: 2000, ...over });

test('a worker’s release marks the child collected on the console, and is never a row of its own', () => {
  const rows = reader([child('ci-1', 'Ada Fenn'), child('ci-2', 'Bem Okafor'), release('rel-1', 'ci-1')]);
  assert.equal(rows.length, 2,
    'THE RELEASE IS RENDERED AS ITS OWN ROW — a nameless phantom child on the safeguarding register: ' + JSON.stringify(rows.map(r => r.id)));
  const ada = rows.find(r => r.id === 'ci-1'), bem = rows.find(r => r.id === 'ci-2');
  assert.equal(ada.out, 2000,
    'THE CONSOLE STILL SHOWS A COLLECTED CHILD AS PRESENT. Her worker’s phone says she went home; this ' +
    'register says she is in the room, with a Check out button. out=' + JSON.stringify(ada.out));
  assert.equal(ada.childName, 'Ada Fenn', 'the collected child lost her row — the register must stay a record of who was here');
  assert.equal(bem.out, null, 'a child nobody collected was marked as collected');
});

test('a release from ANOTHER session cannot collect a child — the F1 shape, one level up', () => {
  const rows = reader([child('ci-1', 'Ada Fenn'), release('rel-x', 'ci-1', { _sid: OTHER })]);
  assert.equal(rows.length, 1, 'the foreign release was rendered as a row');
  assert.equal(rows[0].out, null,
    'A RELEASE SCOPED TO ANOTHER SESSION COLLECTED THIS CHILD. Both tags are cleartext and relay-enforced; ' +
    'the match must be on session AND check-in id.');
});

test('by-hand release is carried through as manual, and the newest release wins', () => {
  const rows = reader([child('ci-1', 'Ada Fenn'),
    release('rel-1', 'ci-1', { ts: 2000, out: 2000 }),
    release('rel-2', 'ci-1', { ts: 3000, out: 3000, manual: true, _by: 'worker-pub' })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].out, 3000, 'an older release outranked a newer one');
  assert.equal(rows[0].manual, true, 'a by-hand release is not recorded as manual — §7 requires it leave a different trace');
  assert.equal(rows[0].releasedBy, 'worker-pub', 'who released the child by hand was dropped');
});

test('a register with no releases is passed through untouched', () => {
  const rows = reader([child('ci-1', 'Ada Fenn'), child('ci-2', 'Bem Okafor')]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.out), [null, null], 'the fold invented a collection nobody recorded');
});
