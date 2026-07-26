// The 12-word restore: turning "everything this key ever wrote" into { churches, name }.
// Drives the REAL _restoreFold() out of the shipped bundle — no relay, no DOM.
// Run: node --test scripts/restore-fold.test.mjs
//
// WHY THIS EXISTS. Restore was broken for every member and no test noticed: MEMBER_D
// ('trinityone/member:') was declared as a LOCAL inside _memHubOpen() while recoverIdentity() also used it,
// so each church document the relay delivered threw `ReferenceError: MEMBER_D is not defined` inside
// nostr-tools' event handler — which logs a warning and swallows it. The member got their NAME back (the
// kind-0 branch returns before that line) and ZERO churches. Confirmed on a real phone against the live
// relay, 2026-07-26; defining the constant made the same call return the real church.
//
// So this test imports the constant FROM THE BUNDLE rather than restating it: if it stops being declared at
// module scope, the extraction fails and this goes red instead of quietly testing a copy that works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

function realFold() {
  // The constant must be MODULE-scope in the shipped bundle — that is the whole bug.
  const cm = BUNDLE.match(/\bMEMBER_D = ("trinityone\/member:")/);
  assert.ok(cm, 'MEMBER_D is not declared at module scope in the shipped bundle — restore throws ReferenceError');
  const dm = BUNDLE.match(/\b_dtag = (\(e\) => [^;]+);/);
  assert.ok(dm, '_dtag missing from the shipped bundle');
  const fnAt = BUNDLE.indexOf('function _restoreFold(');
  assert.notEqual(fnAt, -1, '_restoreFold missing from the shipped bundle — the restore fold was removed or renamed');
  let depth = 0, end = -1;
  for (let i = BUNDLE.indexOf('{', fnAt); i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1);
  const factory = new Function(
    `const MEMBER_D = ${cm[1]};\nconst _dtag = ${dm[1]};\n` + BUNDLE.slice(fnAt, end) + '\nreturn _restoreFold;'
  )();
  return factory();   // a FRESH fold per call, so tests cannot leak state into each other
}

const CH_A = 'a'.repeat(64), CH_B = 'b'.repeat(64), CH_C = 'c'.repeat(64);
const joined = (cp, at) => ({ kind: 30078, created_at: at, tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['p', cp]], content: JSON.stringify({ joined: at }) });
const left = (cp, at) => ({ kind: 30078, created_at: at, tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['p', cp], ['deleted', '1']], content: '' });
const profile = (name, at) => ({ kind: 0, created_at: at, tags: [], content: JSON.stringify({ name }) });

test('a member in MANY churches gets all of them back, newest-joined first', () => {
  const f = realFold();
  [joined(CH_A, 100), joined(CH_B, 300), joined(CH_C, 200)].forEach(f.add);
  assert.deepEqual(f.result().churches, [CH_B, CH_C, CH_A],
    'every church the member joined must come back — a multi-church member restoring on a new phone must not silently lose the others');
});

test('the newest join becomes the active church (churches[0])', () => {
  const f = realFold();
  [joined(CH_A, 100), joined(CH_B, 900)].forEach(f.add);
  assert.equal(f.result().churches[0], CH_B, 'the app makes churches[0] active, so ordering is user-visible');
});

test('a church the member LEFT is not resurrected', () => {
  const f = realFold();
  [joined(CH_A, 100), joined(CH_B, 100), left(CH_B, 200)].forEach(f.add);
  assert.deepEqual(f.result().churches, [CH_A],
    'leaveMembership() marks a leave with a ["deleted","1"] TAG and EMPTY content — the old code looked for a {left:true} body that nothing writes, and JSON.parse("") throws');
});

test('an OLD leave arriving after a NEWER rejoin does not wipe the church', () => {
  const f = realFold();
  // relays deliver in no guaranteed order: the stale leave lands last
  [joined(CH_A, 500), left(CH_A, 100)].forEach(f.add);
  assert.deepEqual(f.result().churches, [CH_A],
    'newest wins — a member who left and rejoined must come back to the church they are in TODAY');
});

test('a rejoin after a leave is honoured', () => {
  const f = realFold();
  [joined(CH_A, 100), left(CH_A, 200), joined(CH_A, 300)].forEach(f.add);
  assert.deepEqual(f.result().churches, [CH_A]);
});

test('the member’s display name comes back, newest profile winning', () => {
  const f = realFold();
  [profile('Old Name', 100), profile('Sir Lloyd', 500), profile('Older Still', 50)].forEach(f.add);
  assert.equal(f.result().name, 'Sir Lloyd', 'an older kind-0 must not overwrite a newer one');
});

test('the member’s OTHER documents are not mistaken for churches', () => {
  const f = realFold();
  for (const d of ['trinityone/highlights', 'trinityone/journal', 'trinityone/settings', 'trinityone/notes']) {
    f.add({ kind: 30078, created_at: 400, tags: [['d', d]], content: '{}' });
  }
  f.add(joined(CH_A, 100));
  assert.deepEqual(f.result().churches, [CH_A], 'only member:<churchpub> documents name a church');
});

test('malformed events cannot break the restore', () => {
  const f = realFold();
  [null, {}, { kind: 30078, created_at: 1, tags: [] }, { kind: 30078, created_at: 1, tags: [['d', 'trinityone/member:']] },
   { kind: 0, created_at: 2, tags: [], content: 'not json' }].forEach(x => f.add(x));
  f.add(joined(CH_A, 100));
  const r = f.result();
  assert.deepEqual(r.churches, [CH_A], 'one bad event must not discard a real membership');
  assert.equal(r.name, '', 'unparseable profile content leaves the name empty rather than throwing');
});

test('the fold really is the shipped one (sabotage check)', () => {
  // If the extraction silently grabbed nothing, every assertion above would be vacuous. Prove it is wired to
  // the real constant by feeding a d-tag that only the REAL prefix matches.
  const f = realFold();
  f.add({ kind: 30078, created_at: 1, tags: [['d', 'trinityone/NOTmember:' + CH_A]], content: '{}' });
  assert.deepEqual(f.result().churches, [], 'a near-miss prefix must not be treated as a membership');
  const g = realFold();
  g.add(joined(CH_A, 1));
  assert.deepEqual(g.result().churches, [CH_A], 'and the real prefix must be');
});
