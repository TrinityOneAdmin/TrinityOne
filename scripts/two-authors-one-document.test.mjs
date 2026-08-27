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
  // _reduceAll is imported only by the member app — the console does not filter by roster at all (see the
  // test at the bottom of this file), so the bundler drops it there. Lift what each bundle actually carries.
  const names = ['_pickWinner', '_reduceVersions', '_absorbById', '_forgetById', '_seedFromCache', '_reduceAll']
    .filter(n => bundle.includes('function ' + n + '('));
  const src = names.map(n => fnBody(bundle, 'function ' + n, n)).join('\n');
  const api = new Function(src + '\nreturn { ' + names.join(', ') + ' };')();
  const versions = new Map(), byId = new Map();
  return {
    byId,
    put: (by, ts, tag, id, trust) => api._absorbById(versions, byId, id || 'svc1', { id: id || 'svc1', _by: by, ts, tag }, trust),
    del: (by, ts, id, trust) => api._forgetById(versions, byId, id || 'svc1', by, ts, trust),
    revoke: (trust) => { if (!api._reduceAll) throw new Error('this bundle does not re-choose winners on a roster change'); api._reduceAll(versions, byId, trust); },
    seen: (id) => byId.get(id || 'svc1'),
    paint: (items) => api._seedFromCache(versions, byId, items),
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


// ── PAINTING FROM CACHE MUST SEED THE STORE, NOT JUST THE SCREEN ─────────────────────────────────────────
// Both readers paint last-known documents instantly so a page does not flash empty. Writing them straight
// into the display map was harmless while a delete was keyed on the id — and became a bug the moment a delete
// had to find the author's copy. I introduced it in the fix for the collision and caught it before it shipped.
test('a document deleted while you were away is removed, not left on screen for ever', () => {
  const m = store(V);
  m.paint([{ id: 'svc1', _by: CHURCH, ts: 100, tag: 'from cache' }]);
  assert.equal(m.seen().tag, 'from cache', 'setup: the cached copy is painted');
  m.del(CHURCH, 200);
  assert.equal(m.seen(), undefined,
    'a tombstone found nothing to withdraw, so a rota deleted while the app was closed stays on screen');
});

test('an OLD cache with no author recorded is still deletable by anyone', () => {
  // Caches written before this shipped carry no author. Refusing to honour a delete for them would strand
  // every existing install on stale documents; the old behaviour was that any delete cleared them.
  const m = store(V);
  m.paint([{ id: 'svc1', ts: 100, tag: 'legacy cache entry' }]);
  m.del(WARDEN, 200);
  assert.equal(m.seen(), undefined, 'upgrading strands people on documents their church has already deleted');
});

test('seeding from cache does not fabricate a conflict', () => {
  const m = store(V);
  m.paint([{ id: 'svc1', _by: CHURCH, ts: 100, tag: 'cached' }]);
  m.put(CHURCH, 200, 'live update');
  assert.equal(m.seen().tag, 'live update', 'the live copy did not replace its own cached self');
  assert.equal(m.seen()._alt, undefined,
    'one author’s cached copy and their own live copy were counted as two people publishing');
});

test('EVERY reader that paints from cache seeds the store — found by sweeping, not by naming', () => {
  // THE TEST THAT SHOULD HAVE CAUGHT THE LAST MISS, TWICE OVER. Its first version named the two call sites I
  // had fixed and was green while six readers still painted straight onto the screen. Its second version
  // swept, but matched glued-together literal text — an auditor restored the bug behind a one-line variable
  // extraction (`const raw = getItem(...); const cached = JSON.parse(raw)`) and all 34 tests stayed green.
  // That is not an evader's trick; it is the most innocent refactor there is.
  //
  // So: match on STRUCTURE. A reader reads a cache if it mentions the cache key or the cache helper at all,
  // and it paints if it writes into the display map by any name. Neither can be disguised by renaming a
  // variable or splitting a line.
  const problems = [], counted = [];
  for (const file of ['src/fellowship.src.js', 'src/steward.src.js']) {
    const text = stripComments(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
    const lines = text.split('\n');
    const starts = [];
    lines.forEach((l, i) => { const m = l.match(/^  (?:async )?([A-Za-z_]\w*)\(/); if (m) starts.push([i, m[1]]); });
    starts.forEach(([ln, name], idx) => {
      const end = idx + 1 < starts.length ? starts[idx + 1][0] : lines.length;
      const body = lines.slice(ln, end).join('\n');
      if (!/_(absorbById|forgetById)\(/.test(body)) return;              // not a store-backed reader
      counted.push(file + '→' + name);
      const readsCache = /CACHE_KEY|loadDocCache\(/.test(body);
      const paints = /\bbyId\.set\(/.test(body);                          // by ANY variable name
      if (readsCache && paints && !/_seedFromCache\(/.test(body))
        problems.push(file + ' → ' + name + ' paints a cache onto the screen without seeding the store');
      if (/\bbyId\.delete\(/.test(body))
        problems.push(file + ' → ' + name + ' still deletes by id, with no rule about whose copy it was');
    });
  }
  // A sweep that finds nothing passes everything. Pin the floor so a refactor that hides every reader from
  // the regex fails loudly instead of quietly reporting success.
  // THE FLOOR MUST TRACK REALITY. It said 11 while there were 14, so three whole readers could quietly stop
  // using the store before anything went red — and an auditor proved it by unmigrating care needs entirely
  // with every test green. Raise it when a reader is added; it is meant to be a ratchet, not a formality.
  assert.ok(counted.length >= 14,
    `the sweep only recognised ${counted.length} store-backed readers; there were 14, so readers have ` +
    'silently dropped out of the store and this test cannot be trusted to have checked them: ' + counted.join(', '));
  assert.deepEqual(problems, [],
    'a document deleted while the app was closed will stay on screen for ever in:\n  ' + problems.join('\n  '));
});

test('and every use of the store has a version map in scope', () => {
  // I twice left a call to _forgetById(versions, …) in a function that declares no `versions` — a crash on
  // every delete, not a bug, and I would have shipped it. Sweep for it rather than trusting I looked.
  const crashes = [];
  for (const f of ['src/fellowship.src.js', 'src/steward.src.js']) {
    const lines = stripComments(readFileSync(new URL('../' + f, import.meta.url), 'utf8')).split('\n');
    const starts = [];
    lines.forEach((l, i) => { const m = l.match(/^  ([A-Za-z_]\w*)\(/); if (m) starts.push([i, m[1]]); });
    starts.forEach(([ln, name], idx) => {
      const end = idx + 1 < starts.length ? starts[idx + 1][0] : lines.length;
      const body = lines.slice(ln, end).join('\n');
      if (/_(absorbById|forgetById|seedFromCache)\(versions/.test(body) && !/const versions = new Map\(\)/.test(body))
        crashes.push(f + ' → ' + name);
    });
  }
  assert.deepEqual(crashes, [], 'these call the store with no version map in scope — every delete throws:\n  ' + crashes.join('\n  '));
});

// ── AN UPGRADING CONSOLE: THE CACHE IT ALREADY HOLDS RECORDS NO AUTHOR ───────────────────────────────────
// The console never wrote an author into its calendar cache, so on the first boot after this ships every
// cached rota, service and roster is anonymous. The first attempt filed those under '' so they could be
// compared like anything else, and an audit measured what that did: the anonymous entry beat real copies on
// a tie, invented a competitor out of itself, and — worst — a delete from the real author was REFUSED
// whenever a second author's copy existed. An upgraded console would have shown a deleted rota for ever, in
// exactly the two-author case this whole store exists for.
test('an anonymous cached copy never competes with a real one', () => {
  const m = store(V);
  m.paint([{ id: 'svc1', ts: 100, tag: 'vicar rota, from an old cache' }]);
  m.put(WARDEN, 162, 'warden rota, live');
  assert.equal(m.seen().tag, 'warden rota, live', 'an anonymous cached copy is being ranked against real ones');
  assert.equal(m.seen()._alt, undefined,
    'the upgrade invented a competing author out of a cache entry — a banner would print it as a real person');
});

test('an anonymous cached copy never beats a real one on a tie', () => {
  const m = store(V);
  m.paint([{ id: 'svc1', ts: 500, tag: 'anonymous' }]);
  m.put(CHURCH, 500, 'real');
  assert.equal(m.seen().tag, 'real', 'the empty author name sorts lowest and wins ties it should never enter');
});

test('THE UPGRADE CASE: a delete from the real author is honoured, not refused', () => {
  const m = store(V);
  m.paint([{ id: 'svc1', ts: 100, tag: 'from an old cache' }]);
  m.put(WARDEN, 162, 'warden');
  assert.equal(m.del(WARDEN, 200), true,
    'on an upgraded console the author’s own delete was refused, so a withdrawn rota stayed on screen for ever');
  assert.equal(m.seen(), undefined);
});

test('…and an anonymous entry on its own is still cleared by anybody’s delete', () => {
  // Which is what the old code did with these entries. Refusing would strand every existing install.
  const m = store(V);
  m.paint([{ id: 'svc1', ts: 100, tag: 'legacy' }]);
  assert.equal(m.del(WARDEN, 200), true, 'upgrading strands people on documents their church already deleted');
  assert.equal(m.seen(), undefined);
});


test('a tie is broken toward the LOWER pubkey, and that direction is pinned', () => {
  // The direction is arbitrary — but it must never change, and a test that only checks "both phones agree"
  // cannot tell. Under the standing pilot rule (add, never change), a congregation running two app versions
  // side by side would otherwise pick DIFFERENT winners for tied writes: the precise disease this store
  // exists to cure, reintroduced by an upgrade. An auditor flipped the direction in both bundles and all 34
  // tests stayed green.
  const LOW = '1'.repeat(64), HIGH = 'f'.repeat(64);
  const m = store(V); m.put(HIGH, 500, 'higher pubkey'); m.put(LOW, 500, 'lower pubkey');
  assert.equal(m.seen().tag, 'lower pubkey',
    'the tie-break direction has flipped — two app versions in one church will now disagree about the rota');
  const c = store(S); c.put(HIGH, 500, 'higher pubkey'); c.put(LOW, 500, 'lower pubkey');
  assert.equal(c.seen().tag, 'lower pubkey', 'the console breaks ties the other way from the phones');
});


// ── REVOKING A STEWARD MUST NOT BLANK THE CHURCH'S OWN RECORDS ───────────────────────────────────────────
// Owner, 2026-08-27: "the church's key should be primary owner of documents like rotas. Having it tied to an
// individual user is a risk." The trust check used to run AFTER the winner was chosen, so a revoked steward's
// copy won and was then dropped — showing nothing, while the church's own copy sat unused in this store.
// Gordon steps down and every rota, room and service he last touched goes blank on every phone in the parish.
test('when a steward is revoked, the church’s own copy is shown — not a blank', () => {
  const trustAll = () => true;
  const churchOnly = (rec) => rec._by === CHURCH;
  const m = store(V);
  m.put(CHURCH, 100, 'the church’s rota', 'svc1', trustAll);
  m.put(WARDEN, 200, 'the warden’s newer edit', 'svc1', trustAll);
  assert.equal(m.seen().tag, 'the warden’s newer edit', 'setup: the warden’s edit is the one on show');
  m.revoke(churchOnly);                                     // the church removes him from its roster
  assert.ok(m.seen(), 'every document the departing steward last touched went blank across the parish');
  assert.equal(m.seen().tag, 'the church’s rota', 'the church’s own copy was not promoted');
});

test('…and re-rostering him brings his edit straight back', () => {
  const trustAll = () => true;
  const m = store(V);
  m.put(CHURCH, 100, 'church', 'svc1', trustAll);
  m.put(WARDEN, 200, 'warden', 'svc1', trustAll);
  m.revoke((rec) => rec._by === CHURCH);
  m.revoke(trustAll);
  assert.equal(m.seen().tag, 'warden', 'restoring a steward does not restore the work they had done');
});

test('a document ONLY the revoked steward wrote still disappears, and that is correct', () => {
  // There is no church copy to promote. It is not lost — it needs the church to republish it — but showing a
  // revoked person's document would defeat the point of revoking them.
  const m = store(V);
  m.put(WARDEN, 200, 'warden alone', 'svc1', () => true);
  m.revoke((rec) => rec._by === CHURCH);
  assert.equal(m.seen(), undefined, 'a revoked steward’s sole work is still being served to the congregation');
});

test('a delete from a revoked steward cannot remove the church’s copy', () => {
  const m = store(V);
  m.put(CHURCH, 100, 'church', 'svc1', () => true);
  m.put(WARDEN, 200, 'warden', 'svc1', () => true);
  const churchOnly = (rec) => rec._by === CHURCH;
  m.del(WARDEN, 300, 'svc1', churchOnly);
  assert.ok(m.seen() && m.seen().tag === 'church', 'a removed steward could still blank the church’s record');
});


test('KNOWN GAP: the console does not hide a revoked steward’s work, and the office cannot see what members lost', () => {
  // The member app chooses among copies whose author is still on the church's signed roster. The console
  // applies no such filter anywhere — so when a steward is revoked, every phone in the parish promotes the
  // church's copy while the console keeps showing the steward's. Before this change the phones went BLANK and
  // the console still looked perfect; the blanking is fixed, the disagreement is not.
  //
  // Recorded as a test rather than a comment so it cannot be quietly forgotten, and so the day somebody wires
  // roster trust into the console this fails and tells them to update it. Owner's decision, 2026-08-27, is
  // that the church key should be the primary owner of these documents — the writing-side half of that
  // (the church ADOPTING a steward's document by republishing it under its own key) is not built either.
  assert.ok(!S.includes('function _reduceAll('),
    'the console now carries the roster re-choose — wire it up properly and rewrite this test');
  assert.ok(V.includes('function _reduceAll('), 're-anchor: the member app lost its roster re-choose');
});


// ── GROUP EVENTS: THE LIKELIEST COLLISION IN THE PRODUCT, AND THE ONE THAT BEHAVED WORST ─────────────────
// A group event has more authors than anything else here: the church, any delegated steward, and empowered
// members of the group publishing from their own phones. Neither reader had any rule — no timestamp compared
// at all, so an OLDER copy replayed on a reconnect overwrote a newer one, and a delete keyed on the id alone
// blanked the meeting for everyone. Meanwhile the church calendar, store-backed since d6e9a5c, kept its copy:
// one screen said the Friday meeting was on and another said it was gone, in the same app.
test('a group event is judged by the same rule on both surfaces', () => {
  for (const [where, bundle] of [['the member app', V], ['the console', S]]) {
    const body = stripComments(fnBody(bundle, 'subscribeGroupEvents(', 'subscribeGroupEvents'));
    assert.ok(!/byId\.(set|delete)\(id/.test(body), where + ' still writes group events with no rule about who wins');
    assert.match(body, /_absorbById\(versions\d*, byId/, where + ' still lets the last copy to arrive win');
    assert.match(body, /_forgetById\(versions\d*, byId/, where + ' still blanks a group event by id alone');
    assert.match(body, /_by: e\.pubkey/,
      where + ' does not record WHO wrote a group event, so every author collapses into one slot and a ' +
      'delete can never find the copy it is meant to withdraw');
  }
});

test('an older group event replayed on a reconnect does not overwrite a newer one', () => {
  // There was no timestamp comparison here at all — the exact fault, reproduced.
  const m = store(V);
  m.put(WARDEN, 300, 'moved to 7pm');
  m.put(CHURCH, 100, 'the original 6pm, replayed from history');
  assert.equal(m.seen().tag, 'moved to 7pm',
    'a reconnect rolled the group’s meeting back to an old time, and nobody touched anything');
});

test('one person deleting their copy does not blank the group’s meeting', () => {
  const m = store(V);
  m.put(CHURCH, 100, 'the church’s copy');
  m.put(WARDEN, 200, 'a leader’s duplicate');
  m.del(WARDEN, 300);
  assert.ok(m.seen(), 'tidying a duplicate removed the meeting from the whole group');
  assert.equal(m.seen().tag, 'the church’s copy');
});


// ── THE READERS THE SWEEP CANNOT NAME FOR ITSELF ─────────────────────────────────────────────────────────
// An auditor unmigrated care needs COMPLETELY — raw last-arrival-wins, no trust, no roster re-choose — and
// all 58 tests stayed green, because the sweep's floor was set below the real count and care needs was the
// one migrated reader with no test of its own. Name the readers that must be store-backed, so removing one
// fails by name rather than by arithmetic.
test('the readers that must be store-backed are, by name', () => {
  const MUST = {
    'src/fellowship.src.js': ['subscribeChurchGroups', 'subscribeChurchCategories', 'subscribeChurchPlans',
      'subscribeChurchDevotionals', '_subChurchAddr', 'subscribeCareNeeds', 'subscribeGroupEvents'],
    'src/steward.src.js': ['subscribeGroups', 'subscribePlans', 'subscribeDevotionals', 'subscribeCategories',
      'subscribeFunds', '_subAddr', 'subscribeGroupEvents'],
  };
  const missing = [];
  for (const [file, names] of Object.entries(MUST)) {
    const text = stripComments(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
    const lines = text.split('\n');
    const starts = [];
    lines.forEach((l, i) => { const m = l.match(/^  (?:async )?([A-Za-z_]\w*)\(/); if (m) starts.push([i, m[1]]); });
    for (const want of names) {
      const idx = starts.findIndex(([, n]) => n === want);
      if (idx === -1) { missing.push(file + ' → ' + want + ' has gone (re-anchor this list)'); continue; }
      const end = idx + 1 < starts.length ? starts[idx + 1][0] : lines.length;
      const body = lines.slice(starts[idx][0], end).join('\n');
      if (!/_absorbById\(versions\d*, byId/.test(body)) missing.push(file + ' → ' + want + ' no longer decides who wins');
      if (/\bbyId\.(set|delete)\(id/.test(body)) missing.push(file + ' → ' + want + ' writes by id with no rule');
    }
  }
  assert.deepEqual(missing, [], 'these decide by arrival order again:\n  ' + missing.join('\n  '));
});

test('CARE NEEDS: the store trusts everyone the screen trusts', () => {
  // The regression an audit caught. The store was handed a predicate knowing only the church key and its
  // steward roster, while the screen's own filter knows three kinds of author — those, a care-team ADMIN, and
  // any member when the church opens needs to members. The store DELETES what it rejects, so a care-team
  // admin's meal train never reached a single phone, and their correction to a church-created need ("Thursday,
  // severe nut allergy") was discarded while every phone kept showing "Tuesday, no nuts".
  const body = stripComments(fnBody(readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8'),
    'subscribeCareNeeds(', 'subscribeCareNeeds'));
  assert.match(body, /_trust = \(rec\) => careTrusted\(/,
    'the care store judges authorship more narrowly than the care screen does, so needs it rejects are ' +
    'deleted before the screen can show them — a care-team admin’s meal train reaches nobody');
  assert.ok(!/_trust = \(rec\) => _churchVoice/.test(body),
    'the narrow predicate is back: only the church and its stewards would have their needs shown');
});

test('GROUP EVENTS: one predicate, judging each copy by its own group', () => {
  const body = stripComments(fnBody(readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8'),
    'subscribeGroupEvents(', 'subscribeGroupEvents'));
  assert.match(body, /_evTrust = \(rec\) => _groupEventTrusted\(cp, rec && rec\._gid/,
    'the predicate judges other copies by whichever event happened to arrive, so two phones can pick ' +
    'different winners — the one guarantee this store exists to give');
  assert.match(body, /onTrust = \(\) => \{ _reduceAll\(versions\d*, byId, _evTrust\); emit\(\); \}/,
    'a trust change only re-filters here, so revoking a steward blanks the group’s meeting instead of ' +
    'promoting the church’s copy — the bug the previous commit existed to fix');
});

test('every store-backed reader records a timestamp, or its rule is meaningless', () => {
  // The console recorded WHO wrote a group event but not WHEN, so every comparison was a tie at zero: the
  // lower pubkey won for ever and an older copy replayed on reconnect overwrote a newer one — verbatim the
  // defect that commit said it had fixed. Nothing checked for `ts`.
  // Brace-MATCH the record rather than regexing it: these objects contain nested `{}` (a dayMeals map, for
  // one), and a non-greedy match stops at the first inner brace and reports a false miss. My first version
  // did exactly that and accused a reader that was fine.
  const bad = [];
  for (const file of ['src/fellowship.src.js', 'src/steward.src.js']) {
    const text = stripComments(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
    for (const m of text.matchAll(/_absorbById\(versions\d*, byId, [^,]+, \{/g)) {
      const open = m.index + m[0].length - 1;
      let d = 0, close = -1;
      for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') d++;
        else if (ch === '}' && --d === 0) { close = i + 1; break; }
      }
      const rec = text.slice(open, close);
      if (!/\bts:/.test(rec)) bad.push(file + ': ' + rec.slice(0, 70).replace(/\s+/g, ' ') + '…');
    }
  }
  assert.deepEqual(bad, [], 'these record who wrote a document but not when, so every comparison is a tie:\n  ' + bad.join('\n  '));
});
