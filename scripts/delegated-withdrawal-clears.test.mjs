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
    versions, byId,
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
