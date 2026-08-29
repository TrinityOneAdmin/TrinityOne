// A DELEGATED STEWARD'S DELETE MUST ACTUALLY CLEAR THE THING.
// Run: node --test scripts/delegated-withdrawal-clears.test.mjs
//
// SWEEP DEFECT 3, reproduced against the shipped bundle before it was fixed. A church publishes a group (or a
// rota, a service, a room — every church document shares this store). A steward the church has empowered
// deletes it from the console. In delegated mode the steward's OWN key signs while `pub` is the church, so
// the tombstone is authored by the steward — and _forgetById withdraws "that author's copy", of which there
// is none. It returned false. The relay is untouched: it keeps one addressable event per author, so the
// church's copy is still sitting there, and every phone in the congregation kept showing the group for ever.
//
// The console filters by nothing, so the steward watched the row disappear and was told it worked. Silent,
// and visible only to somebody else — the worst shape a defect takes in this product.
//
// The fix is a `for` tag naming whose copy the tombstone means. The narrow grant is the point: a trusted
// author may withdraw the CHURCH'S copy and only the church's. Naming a colleague's copy is round 9 exactly
// — one steward tidying a duplicate taking another's rota with it — so that stays refused. These tests hold
// both halves down at once, because a fix for either one alone is easy and wrong.
//
// This does not read the source. It lifts the real functions out of vendor/ and runs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function lift(src, name, kind = 'function') {
  const re = kind === 'function'
    ? new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}')
    : new RegExp('\\n  (?:var|let|const) ' + name + ' = [\\s\\S]*?;');
  const m = re.exec(src);
  assert.ok(m, `could not lift ${name} — re-anchor this test, do not delete it`);
  return m[0];
}

const CHURCH = 'c'.repeat(64);
const GORDON = 'a'.repeat(64);   // a steward the church has empowered
const PRIYA  = 'b'.repeat(64);   // a second empowered steward
const STRANGER = 'f'.repeat(64); // on nobody's roster

// The member app's own rule: the church key, or a steward still on the church's signed roster.
const roster = new Set([CHURCH, GORDON, PRIYA]);
const trusted = (rec) => roster.has(String((rec && rec._by) || ''));

function store() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([
    lift(FELLOWSHIP, '_pickWinner'),
    lift(FELLOWSHIP, '_reduceVersions'),
    lift(FELLOWSHIP, '_absorbById'),
    lift(FELLOWSHIP, '_forgetById'),
    lift(FELLOWSHIP, '_tombstoneTargets'),
    'globalThis.API = { _absorbById, _forgetById, _tombstoneTargets };',
  ].join('\n'), ctx);
  const versions = new Map(), byId = new Map();
  const api = ctx.API;
  return {
    versions, byId, api,
    write: (id, by, ts, extra = {}) => api._absorbById(versions, byId, id, { id, name: 'Tuesday Prayer', ts, _by: by, ...extra }, trusted),
    // A tombstone as it actually arrives: a real event, with its tags read by the shipped extractor.
    del: (id, by, ts, forTags = []) => api._forgetById(versions, byId, id, by, ts, trusted, {
      churchPub: CHURCH,
      targets: api._tombstoneTargets({ tags: [['d', 'trinityone/group:' + id], ['deleted', '1'], ...forTags.map(f => ['for', f])] }),
    }),
    shown: (id) => byId.get(id) || null,
  };
}

test('the defect: a delegated steward deleting the church’s group used to change nothing', () => {
  const s = store();
  s.write('g1', CHURCH, 100);
  assert.ok(s.shown('g1'), 'the church’s group should be on screen to begin with');
  const cleared = s.del('g1', GORDON, 200, [CHURCH]);
  assert.equal(cleared, true, 'the steward’s tombstone was not honoured at all');
  assert.equal(s.shown('g1'), null,
    'the group is STILL on every member’s phone after the steward deleted it — defect 3, unfixed');
});

test('round 9 stays fixed: a steward cannot name a colleague’s copy', () => {
  const s = store();
  s.write('g1', PRIYA, 100);                       // Priya's rota — Gordon cannot even see it
  const cleared = s.del('g1', GORDON, 200, [PRIYA]);
  assert.equal(cleared, false, 'Gordon withdrew Priya’s copy by naming it — round 9, reintroduced');
  assert.ok(s.shown('g1'), 'Priya’s rota vanished for the people serving on it');
  assert.equal(s.shown('g1')._by, PRIYA);
});

test('naming the church does not sweep a colleague’s copy away with it', () => {
  const s = store();
  s.write('g1', CHURCH, 100);
  s.write('g1', PRIYA, 150);                        // two authorised copies; Priya's is newer, so it shows
  assert.equal(s.shown('g1')._by, PRIYA);
  s.del('g1', GORDON, 200, [CHURCH]);               // Gordon withdraws the CHURCH's copy only
  assert.ok(s.shown('g1'), 'Priya’s copy was taken by a tombstone that named the church');
  assert.equal(s.shown('g1')._by, PRIYA, 'the surviving copy must be Priya’s, untouched');
});

test('an old tombstone still means "my own copy", so upgrading changes nothing', () => {
  // Every tombstone written before 2026-08-28 carries no `for` tag. It must keep its old meaning exactly.
  const s = store();
  s.write('g1', CHURCH, 100);
  assert.equal(s.del('g1', GORDON, 200, []), false, 'an untargeted tombstone bound a copy it never wrote');
  assert.ok(s.shown('g1'), 'the church’s copy was withdrawn by a tombstone that did not name it');
});

test('a revoked or forged author cannot name the church’s copy', () => {
  const s = store();
  s.write('g1', CHURCH, 100);
  const cleared = s.del('g1', STRANGER, 200, [CHURCH]);
  assert.equal(cleared, false, 'someone off the roster deleted a church document by naming it');
  assert.ok(s.shown('g1'));
});

test('a stale tombstone must not undo a newer church edit', () => {
  const s = store();
  s.write('g1', CHURCH, 300);                       // the church renamed it at t=300
  const cleared = s.del('g1', GORDON, 200, [CHURCH]);   // a delete from t=200 arrives late
  assert.equal(cleared, false, 'a late tombstone undid an edit that came after it');
  assert.equal(s.shown('g1').ts, 300);
});

test('a steward’s own copy is still withdrawn without any tag', () => {
  const s = store();
  s.write('g1', GORDON, 100);
  assert.equal(s.del('g1', GORDON, 200, []), true);
  assert.equal(s.shown('g1'), null);
});

// ── the writing side: the console must actually put the tag on ───────────────────────────────────────────
// Lifted and RUN, because a test that greps for the tag passes against a stamp that never fires.
function signer({ acting }) {
  const body = lift(STEWARD, 'feChurch');
  // esbuild renumbers the nostr-tools import (finalizeEvent2 today). Bind whatever the body actually calls,
  // so a rebuild that renames it fails loudly here rather than silently testing nothing.
  const feName = (body.match(/\bfinalizeEvent\d*\b/) || [])[0];
  assert.ok(feName, 'feChurch no longer signs an event — re-anchor this test');
  const scope = {
    actingChurch: acting,
    sk: 'steward-key',
    _monotonic: (t) => t,
    [feName]: (t, s) => ({ ...t, _signedWith: s }),
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, body + '\nreturn feChurch;')(...args.map(k => scope[k]));
  return fn;
}
const tagsOf = (e, k) => (e.tags || []).filter(t => t[0] === k).map(t => t[1]);

test('a delegated console names the church on every tombstone it writes', () => {
  const fe = signer({ acting: CHURCH });
  const evt = fe({ kind: 30078, created_at: 1, tags: [['d', 'trinityone/group:g1'], ['t', 'trinityone'], ['deleted', '1']], content: '' });
  assert.deepEqual(tagsOf(evt, 'for'), [CHURCH],
    'the console published a delete that names nobody — members will never clear it');
});

test('it does NOT put the tag on ordinary writes', () => {
  const fe = signer({ acting: CHURCH });
  const evt = fe({ kind: 30078, created_at: 1, tags: [['d', 'trinityone/group:g1'], ['t', 'trinityone']], content: '{"name":"Tuesday Prayer"}' });
  assert.deepEqual(tagsOf(evt, 'for'), [], 'a normal edit was stamped as though it were a delete');
});

test('a church at its own console stamps nothing — there is no delegation to describe', () => {
  const fe = signer({ acting: '' });
  const evt = fe({ kind: 30078, created_at: 1, tags: [['d', 'trinityone/group:g1'], ['deleted', '1']], content: '' });
  assert.deepEqual(tagsOf(evt, 'for'), []);
  assert.deepEqual(tagsOf(evt, 'church'), []);
});

// ── AUDIT 2026-08-29: the three things this file could not see ───────────────────────────────────────────
// An independent auditor stripped `{ churchPub, targets }` from ALL THIRTEEN reader call sites, in src/ and
// in both bundles, and this file stayed green — because nothing here touched a reader. It also replaced the
// one line that makes the grant narrow (`named.some(t => t === cp)`) with `named.length > 0` and nothing
// noticed. And the fix itself was wrong in a way no store-level test asked about: a withdrawal was consumed
// rather than remembered, so the church's copy — which is NEVER retracted on the relay, because a delegated
// steward cannot sign as the church — came back on the next replay.

test('a withdrawal is remembered, so the document cannot walk back in', () => {
  const s = store();
  s.write('g1', CHURCH, 2000);
  assert.equal(s.del('g1', GORDON, 3000, [CHURCH]), true);
  assert.equal(s.shown('g1'), null);
  s.write('g1', CHURCH, 2000);            // a reconnect, a hub replay, or a second relay re-serving it
  assert.equal(s.shown('g1'), null,
    'the deleted rota came back on a replay — gone on Monday, back on Tuesday, and different on every phone');
});

test('…in whatever order the relay serves them', () => {
  // NIP-01's convention is newest-first, which is what every relay other than this project's gateway does,
  // so the tombstone routinely arrives BEFORE the document it withdraws.
  const s = store();
  assert.equal(s.del('g1', GORDON, 3000, [CHURCH]), false);   // nothing visible went — but it is remembered
  s.write('g1', CHURCH, 2000);
  assert.equal(s.shown('g1'), null, 'a tombstone that arrived first never took effect');
});

test('a genuine re-publish after a delete still comes back', () => {
  // Remembering must not become a permanent ban: the church re-creating the group is a NEWER write.
  const s = store();
  s.write('g1', CHURCH, 2000);
  s.del('g1', GORDON, 3000, [CHURCH]);
  s.write('g1', CHURCH, 4000);
  assert.ok(s.shown('g1'), 'the church could never re-create a group a steward had deleted');
  assert.equal(s.shown('g1').ts, 4000);
});

test('the for tag must name the CHURCH — any other pubkey grants nothing', () => {
  // `named.length > 0` in place of `named.some(t => t === cp)` left the whole suite green.
  const s = store();
  s.write('g1', CHURCH, 100);
  assert.equal(s.del('g1', GORDON, 200, [PRIYA]), false, 'naming a colleague withdrew the church’s copy');
  assert.equal(s.del('g1', GORDON, 200, ['f'.repeat(64)]), false, 'naming a stranger withdrew the church’s copy');
  assert.ok(s.shown('g1'));
});

test('with nobody judging authorship, the church-copy grant is refused outright', () => {
  // This is what every console reader used to do. `!trusted || trusted(...)` read a missing predicate as
  // "allow", so any author whose tombstone reached the reader could name the church's copy.
  const s = store();
  s.api._absorbById(s.versions, s.byId, 'g1', { id: 'g1', name: 'Rota', ts: 100, _by: CHURCH }, undefined);
  const cleared = s.api._forgetById(s.versions, s.byId, 'g1', STRANGER, 200, undefined,
    { churchPub: CHURCH, targets: [CHURCH] });
  assert.equal(cleared, false, 'a reader with no trust predicate handed out the church-copy withdrawal');
  assert.ok(s.byId.has('g1'));
});

// ── AT READER LEVEL, because the store being right is only half of it ────────────────────────────────────
// Everything above drives the store directly. That is exactly why stripping `{ churchPub, targets }` from
// all thirteen call sites changed nothing here. So drive a real reader: lift the console's
// subscribeGroupEvents out of the shipped bundle, hand it a pool that captures its handler, and feed it the
// events a relay would actually deliver.
function grabMethod(src, sig) {
  const at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, do not delete it');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

const EVENT_D = 'trinityone/event:';
// `roster` = the church's signed steward list as the console holds it; `caps` = what it narrowed them to.
function consoleReader({ roster = [GORDON], rosterKnown = true, caps = {} } = {}) {
  let handlers = null;
  const scope = {
    pool: { subscribeMany: (_r, _f, h) => { handlers = h; return { close() {} }; } },
    relays: () => [], pub: CHURCH, churchPub: GORDON,     // delegated: our own key signs, the church is `pub`
    EVENT_D,
    _careRoster: new Set(roster), _careRosterKnown: rosterKnown, _stewardCaps: caps,
    _nameKeyRing: [], decrypt3: () => { throw new Error('sealed'); }, _unhex: () => new Uint8Array(),
  };
  const body = [
    lift(STEWARD, '_pickWinner'), lift(STEWARD, '_reduceVersions'), lift(STEWARD, '_absorbById'),
    lift(STEWARD, '_forgetById'), lift(STEWARD, '_tombstoneTargets'),
    lift(STEWARD, '_openChurchDoc'), lift(STEWARD, '_consoleChurchVoice'),
  ].join('\n');
  const args = Object.keys(scope);
  const fn = new Function(...args, `${body}\nreturn ({ ${grabMethod(STEWARD, 'subscribeGroupEvents(groupId, onEvents)')} }).subscribeGroupEvents;`)
    (...args.map(k => scope[k]));
  let rows = [];
  fn('grp1', (list) => { rows = list; });
  assert.ok(handlers, 'the reader never opened a subscription');
  return {
    deliver: (e) => handlers.onevent(e),
    titles: () => rows.map(r => r.title).filter(Boolean),
  };
}
const evt = (by, tags, content) => ({ pubkey: by, created_at: tags._ts || 100, content, tags: tags.t });
const churchEvent = (ts) => evt(CHURCH, { t: [['d', EVENT_D + 'e1'], ['t', 'grp1']], _ts: ts }, JSON.stringify({ title: 'Carol Service', date: '2026-12-24' }));
// A steward's real tombstone carries ['church', cp] — feChurch stamps it on every delegated write, and the
// reader's own scope check requires it. Without it the event is dropped BEFORE the trust predicate runs,
// which made two of the tests below pass for entirely the wrong reason.
const tombstone = (by, ts, forWhom, extraTags = [['church', CHURCH]]) =>
  evt(by, { t: [['d', EVENT_D + 'e1'], ['t', 'grp1'], ['deleted', '1'], ...extraTags, ...forWhom.map(f => ['for', f])], _ts: ts }, '');

test('READER: a steward on the roster withdraws the church’s event', () => {
  const r = consoleReader();
  r.deliver(churchEvent(100));
  assert.deepEqual(r.titles(), ['Carol Service']);
  r.deliver(tombstone(GORDON, 200, [CHURCH]));
  assert.deepEqual(r.titles(), [], 'the steward’s delete did not reach the console reader');
});

test('READER: a group leader cannot delete the church’s event by p-tagging the church', () => {
  // This reader admits foreign authors — an event `p`-tagged to the church passes its scope check — so with
  // no trust predicate a leader could withdraw the church's copy here while it stayed on every phone.
  const r = consoleReader();
  r.deliver(churchEvent(100));
  r.deliver(tombstone(STRANGER, 200, [CHURCH], [['p', CHURCH]]));
  assert.deepEqual(r.titles(), ['Carol Service'],
    'someone off the roster deleted the church’s own event from the console');
});

test('READER: a steward narrowed to Finance cannot withdraw the church’s content', () => {
  const r = consoleReader({ roster: [GORDON], caps: { [GORDON]: ['finance'] } });
  r.deliver(churchEvent(100));
  r.deliver(tombstone(GORDON, 200, [CHURCH]));
  assert.deepEqual(r.titles(), ['Carol Service'], 'a finance-only steward withdrew a church document');
});

test('READER: before the roster arrives, no church-copy grant is given', () => {
  const r = consoleReader({ roster: [], rosterKnown: false });
  r.deliver(churchEvent(100));
  r.deliver(tombstone(PRIYA, 200, [CHURCH]));
  assert.deepEqual(r.titles(), ['Carol Service'], 'a grant was handed out before we knew who the stewards were');
});

test('READER: the church’s own delete still works, with no for tag at all', () => {
  const r = consoleReader();
  r.deliver(churchEvent(100));
  r.deliver(tombstone(CHURCH, 200, []));
  assert.deepEqual(r.titles(), [], 'the church could not delete its own event');
});
