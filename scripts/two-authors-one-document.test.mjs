// WHEN TWO PEOPLE PUBLISH THE SAME CHURCH DOCUMENT, EVERY MEMBER MUST SEE THE SAME ONE.
// Run: node --test scripts/two-authors-one-document.test.mjs
//
// A church document keyed by id — a service, a rota, a roster, a run sheet, an event — may legitimately be
// written by more than one trusted author: the church key, and any steward it has empowered. These are
// addressable events, so the relay keeps one per AUTHOR; it cannot collapse two authors into one. The choice
// falls to the client, and the client was not making one: `byId.set(id, …)` on arrival meant whichever copy
// landed last won.
//
// SIMULATION ROUND 9. The vicar published a rota for one Sunday with ten real people on it, sealed. The
// churchwarden — who could not see hers, and had been told "build your first team" — published a parallel
// rota for the same service 62 seconds later. Both valid, both signed. The second silently replaced the first
// on every phone in the parish. Four people had already pressed "Yes, I can serve"; their acceptances were
// published correctly and their phones said "No dates scheduled for you yet", because the rota with their
// names in it no longer existed anywhere they could reach.
//
// This does not decide who OUGHT to win — the app cannot know, and both writes were authorised. It guarantees
// only that every member decides the same way, and that the losing author is remembered rather than erased.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const V = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const S = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Lift the whole store out of the SHIPPED bundle — the picker, the reducer, the absorber and the delete —
// because they only make sense together and a delete is judged by the same rule as a write.
function store(bundle) {
  const src = ['function _pickWinner', 'function _reduceVersions', 'function _absorbById', 'function _forgetById']
    .map(n => fnBody(bundle, n, n.split(' ')[1])).join('\n');
  const api = new Function(src + '\nreturn { _absorbById, _forgetById };')();
  const versions = new Map(), byId = new Map();
  return {
    byId,
    put: (by, ts, tag, id) => api._absorbById(versions, byId, id || 'svc1', { id: id || 'svc1', _by: by, ts, tag }),
    del: (by, ts, id) => api._forgetById(versions, byId, id || 'svc1', by, ts),
    seen: (id) => byId.get(id || 'svc1'),
  };
}
const CHURCH = 'a'.repeat(64), WARDEN = 'b'.repeat(64), THIRD = 'c'.repeat(64);

test('the newer write wins, whichever order it arrives in', () => {
  const a = store(V); a.put(CHURCH, 100, 'church'); a.put(WARDEN, 162, 'warden');
  const b = store(V); b.put(WARDEN, 162, 'warden'); b.put(CHURCH, 100, 'church');
  assert.equal(a.seen().tag, 'warden');
  assert.equal(b.seen().tag, 'warden',
    'arrival order still decides the winner — two members holding different rotas for one Sunday');
});

test('THE ACTUAL ROUND-9 SEQUENCE: an older church rota is not resurrected by arriving late', () => {
  const m = store(V);
  m.put(WARDEN, 1787776483, 'warden', 'svc1787775296550');
  m.put(CHURCH, 1787776421, 'church', 'svc1787775296550');
  assert.equal(m.seen('svc1787775296550').tag, 'warden',
    'a replay of older history overwrote the current rota — the screen changes under people on reconnect');
});

test('an exact tie is broken the same way on every phone', () => {
  const a = store(V); a.put(CHURCH, 500, 'church'); a.put(WARDEN, 500, 'warden');
  const b = store(V); b.put(WARDEN, 500, 'warden'); b.put(CHURCH, 500, 'church');
  assert.equal(a.seen().tag, b.seen().tag,
    'two members disagree about what this Sunday looks like, and neither can tell why');
});

test('the same author updating their own document always wins', () => {
  const m = store(V); m.put(CHURCH, 100, 'first draft'); m.put(CHURCH, 200, 'corrected');
  assert.equal(m.seen().tag, 'corrected', 'a steward can no longer correct their own rota');
});

// ── DELETING YOUR OWN DUPLICATE MUST NOT TAKE SOMEBODY ELSE'S ROTA WITH IT ───────────────────────────────
// The first version of this fix stored only the winner. An auditor found the hole one line above it: a
// delete was keyed purely on the id, so the obvious next thing anybody does after round 9 — the churchwarden
// tidying away his duplicate — would have wiped the vicar's ten-name rota off every phone a second time, and
// deterministically. Her copy was never deleted; it was still sitting on the relay.
test('THE CLEANUP: deleting the duplicate brings the real rota BACK, it does not blank the Sunday', () => {
  const m = store(V);
  m.put(CHURCH, 1787776421, 'ten real people');
  m.put(WARDEN, 1787776483, 'typed-in names');
  assert.equal(m.seen().tag, 'typed-in names', 'setup: the warden’s copy is the one on show');
  m.del(WARDEN, 1787776500);
  assert.ok(m.seen(), 'the Sunday went blank — the vicar’s rota was deleted by somebody who never wrote it');
  assert.equal(m.seen().tag, 'ten real people', 'the surviving rota was not put back on screen');
});

test('a delete binds only its own author’s copy', () => {
  const m = store(V);
  m.put(CHURCH, 100, 'church'); m.put(WARDEN, 200, 'warden');
  m.del(THIRD, 300);                                   // a third steward deletes something they never wrote
  assert.equal(m.seen().tag, 'warden', 'anyone’s delete removes anyone’s document');
  m.del(CHURCH, 300);                                  // the church withdraws its own, which is not on show
  assert.equal(m.seen().tag, 'warden', 'withdrawing a losing copy changed what everyone sees');
});

test('a stale tombstone cannot undo a newer edit', () => {
  // A delete replayed out of order after its author has since republished.
  const m = store(V);
  m.put(CHURCH, 100, 'old');
  m.put(CHURCH, 300, 'republished');
  m.del(CHURCH, 200);
  assert.ok(m.seen(), 'an old delete, replayed late, removed a document its author had already rewritten');
  assert.equal(m.seen().tag, 'republished');
});

test('deleting the last copy does clear it', () => {
  const m = store(V);
  m.put(CHURCH, 100, 'only one');
  m.del(CHURCH, 200);
  assert.equal(m.seen(), undefined, 'a genuinely deleted document lingers on every phone for ever');
});

// ── the competing author is DERIVED, never remembered ────────────────────────────────────────────────────
test('two authors are reported as two, and the winner’s own next edit does not hide the other', () => {
  const m = store(V);
  m.put(CHURCH, 100, 'church');
  m.put(WARDEN, 200, 'warden');
  assert.deepEqual(m.seen()._alt, [CHURCH], 'nothing can warn anyone that two people published this');
  m.put(WARDEN, 300, 'warden again');
  assert.deepEqual(m.seen()._alt, [CHURCH],
    'the winner’s own edit erased the record of the competing copy, which is still on the relay');
});

test('three authors are all remembered, not just the last loser', () => {
  const m = store(V);
  m.put(CHURCH, 100, 'church'); m.put(THIRD, 150, 'third'); m.put(WARDEN, 200, 'warden');
  assert.deepEqual([...m.seen()._alt].sort(), [CHURCH, THIRD].sort(),
    'a banner built on this would say "one other person" when three published');
});

test('a single author reports no competition at all', () => {
  const m = store(V);
  m.put(CHURCH, 100, 'church');
  assert.equal(m.seen()._alt, undefined, 'an ordinary rota would carry a misleading conflict marker');
});

// ── THE CONSOLE MUST DECIDE THE SAME WAY AS THE PHONES ───────────────────────────────────────────────────
// The first fix gave the rule to the congregation's phones and left the two people HOLDING THE PENS deciding
// by arrival order. So the phones agreed with each other while the vicar's console and the warden's console
// showed different rotas, and every correction flipped the winner church-wide.
test('the steward console reaches the identical verdict, from the same shared code', () => {
  const phone = store(V), console_ = store(S);
  for (const st of [phone, console_]) { st.put(CHURCH, 100, 'church'); st.put(WARDEN, 162, 'warden'); }
  assert.equal(console_.seen().tag, phone.seen().tag,
    'the console shows a different rota from the congregation — corrections will ping-pong');
  phone.del(WARDEN, 200); console_.del(WARDEN, 200);
  assert.equal(console_.seen() && console_.seen().tag, phone.seen() && phone.seen().tag,
    'the console and the phones disagree about what a delete did');
});

test('both bundles carry the SAME store, not two copies that can drift', () => {
  // Normalise away what the bundler chooses and cannot mean anything: whitespace, and the name it happened
  // to give the parameter (it renames `versions` to `versions2` in one bundle to avoid a collision). What
  // must not differ is the logic.
  const norm = (b) => ['function _pickWinner', 'function _reduceVersions', 'function _absorbById', 'function _forgetById']
    .map(n => stripComments(fnBody(b, n, n.split(' ')[1])).replace(/versions\d+/g, 'versions').replace(/\s+/g, ' ').trim()).join('\n');
  assert.equal(norm(S), norm(V),
    'the console and the member app hold different versions of this rule — they will drift, and the surface ' +
    'that edits a rota will stop agreeing with the surface that reads it');
});

test('EVERY multi-author church document goes through the store — not just the rota', () => {
  // The first fix did _subChurchAddr alone. An audit pointed out the same raw pattern sat in four siblings in
  // the same file, each written by the church AND by any steward who edits what somebody else created:
  // groups (which carry invite-only membership), categories, reading plans and devotionals. Fixing one and
  // leaving four is what "not paying attention to the wider code" looks like.
  const READERS = ['subscribeChurchGroups(churchNpub, onGroups)', 'subscribeChurchCategories(churchNpub, onCats)',
                   'subscribeChurchPlans(churchNpub, onPlans)', 'subscribeChurchDevotionals(churchNpub, onDevos)',
                   '_subChurchAddr(churchNpub, prefix, map, onItems)'];
  for (const sig of READERS) {
    const name = sig.slice(0, sig.indexOf('('));
    const body = stripComments(fnBody(V, sig, name));
    assert.ok(!/byId\.(set|delete)\(id/.test(body), name + ' still writes by id with no rule about who wins');
    // esbuild rewrites `new Map()` with a /* @__PURE__ */ annotation and may rename the binding, so match
    // the shape rather than the exact text — a hard-coded name here would fail on a rebuild, not on a bug.
    assert.match(body, /versions\d*\s*=\s*(\/\* @__PURE__ \*\/\s*)?new Map\(\)/, name + ' keeps only the winner, so a delete blanks it');
    assert.match(body, /_forgetById\(versions\d*, byId/, name + ' still honours a delete by id alone');
  }
  const con = stripComments(fnBody(S, '_subAddr(prefix, map, onItems)', '_subAddr'));
  assert.ok(!/byId\.delete\(/.test(con), 'the console still honours a delete by id, with no author check');
  assert.match(con, /_absorbById\(versions\d*, byId/, 'the console still decides by arrival order');
});
