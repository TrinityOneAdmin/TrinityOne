// A CHURCH'S WITHDRAWAL MUST STICK, WHATEVER ORDER THE EVENTS ARRIVE IN.
//   Run: node --test scripts/a-church-withdrawal-sticks-whatever-order-it-arrives-in.test.mjs
//
// PLAN-REMAINING-DELEGATE-FIXES-2026-09-25, issue 3. `a845108` gave the church's own tombstone `['for','*']`
// so it could withdraw a delegated steward's copy of a document, and its commit message claimed `*` was
// chosen precisely to handle the arrival-order race. THAT CLAIM WAS FALSE. The branch that honoured it sat
// AFTER the "nothing received yet" early return and named only `vers.keys()` — the authors this device had
// already received — so it worked for exactly one arrival order and silently did nothing for the others.
//
// Measured against the SHIPPED bundles before the fix, both of them, sermons and the featured-sermon pin
// alike (AUDIT-delegated-publishing-2026-09-25 M1 is the pin half):
//     church copy → steward edit → church delete   = cleared     ← the one order that worked
//     church delete FIRST → steward edit           = BACK on screen
//     church copy → church delete → steward edit   = BACK on screen
// In the two failing orders the steward's copy is OLDER than the tombstone, so it is not a legitimate
// re-publication — it is the withdrawn copy walking back in, and the blob DELETE has already run, so what
// comes back is a sermon that can never play, under a sheet that promised "the stored file is deleted".
//
// WHY THOSE ORDERS ARE ORDINARY, not an edge case. Three routes, all in the shipped member app:
//   - `_docsHubOpen` hands LIVE events straight to every handler in whatever order they arrive
//     (`for (const h of hub.handlers) h.onevent(e, d)`), off a MULTI-relay `pool.subscribeMany`. Two relays
//     with different latency is all it takes, and a delegated console's relay set is not the owner's, so one
//     relay routinely holds the tombstone and another the copy.
//   - `_replayChurchCalendar` walks `hub.buf.values()` in raw Map insertion order, with no sort at all.
//   - A cold start has received nothing, so "the deletion arrives first" is simply what a fresh phone sees.
//
// THE FIX: the withdrawal is STICKY. `_forgetById` files a church `for: '*'` tombstone as a version under
// the reserved key `'*'` (no real author can collide — every other key is a 64-hex pubkey, or '' for an old
// cache with no author recorded), decided BEFORE the "nothing received yet" branch; `_absorbById` then
// refuses to admit any author's copy at or older than it, including an author it has never seen. Same shape
// as the named tombs that were already there.
//
// TWO PROPERTIES THIS FILE EXISTS TO HOLD DOWN, because a fix for the orderings alone is easy and wrong:
//   1. A genuinely NEWER re-publication must still appear — steward's and church's alike.
//   2. ROUND 9 MUST STAY SHUT: only a tombstone signed by the CHURCH KEY may reach another author's copy.
//
// This does not read the source. It lifts the real functions out of vendor/ and runs them, and the last
// block drives the shipped `_openSermons` / `subscribePinnedSermon` readers at the point of use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fnBody } from './test-slice.mjs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function lift(src, name) {
  const re = new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}');
  const m = re.exec(src);
  assert.ok(m, `could not lift ${name} — re-anchor this test, do not delete it`);
  return m[0];
}

const CHURCH = 'c'.repeat(64);
const DANA   = 'd'.repeat(64);   // a delegated CONTENT steward — her own key signs
const PRIYA  = 'b'.repeat(64);   // a second empowered steward
const STRANGER = 'f'.repeat(64); // on nobody's roster

const roster = new Set([CHURCH, DANA, PRIYA]);
const trusted = (rec) => roster.has(String((rec && rec._by) || ''));

// The shipped store, lifted whole out of one bundle. `which` names the bundle so a failure says which
// surface broke — the member app and the console build separately and MUST agree (src/church-doc-store.src.js).
function store(SRC) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([
    lift(SRC, '_pickWinner'), lift(SRC, '_reduceVersions'), lift(SRC, '_absorbById'),
    lift(SRC, '_forgetById'), lift(SRC, '_tombstoneTargets'),
    'globalThis.API = { _absorbById, _forgetById, _tombstoneTargets };',
  ].join('\n'), ctx);
  const versions = new Map(), byId = new Map(), api = ctx.API;
  return {
    versions, byId, api,
    write: (id, by, ts, title) =>
      api._absorbById(versions, byId, id, { id, title: title || 'Sunday', ts, _by: by }, trusted),
    // A tombstone as it actually arrives: a real event, with its tags read by the shipped extractor.
    del: (id, by, ts, forTags = []) => api._forgetById(versions, byId, id, by, ts, trusted, {
      churchPub: CHURCH,
      targets: api._tombstoneTargets({ tags: [['d', 'trinityone/sermon:' + id], ['deleted', '1'], ...forTags.map(f => ['for', f])] }),
    }),
    shown: (id) => byId.get(id) || null,
  };
}

const BUNDLES = [['vendor/fellowship.js', FELLOWSHIP], ['vendor/steward.js', STEWARD]];

for (const [which, SRC] of BUNDLES) {
  test(`${which}: ORDERING A — copy, steward edit, then the church deletes (the order that already worked)`, () => {
    const s = store(SRC);
    s.write('s1', CHURCH, 1000);
    s.write('s1', DANA, 2000, 'Sunday (corrected)');
    assert.equal(s.shown('s1')._by, DANA, 'fixture: the steward’s edit should be the copy on show');
    s.del('s1', CHURCH, 3000, ['*']);
    assert.equal(s.shown('s1'), null,
      'the steward’s edit survived the church deleting the sermon — its blob is already gone, so what is ' +
      'still listed can never play');
  });

  test(`${which}: ORDERING B — the church's deletion arrives BEFORE any copy, then an older edit lands`, () => {
    const s = store(SRC);
    s.del('s1', CHURCH, 3000, ['*']);            // nothing received yet: the "if (!vers)" branch
    s.write('s1', DANA, 2000, 'Sunday (corrected)');
    assert.equal(s.shown('s1'), null,
      'A WITHDRAWN SERMON WALKED BACK IN. The church deleted it at t=3000; a copy written at t=2000 — ' +
      'older, so part of what was deleted — arrived afterwards and was rendered. Shown: ' +
      JSON.stringify(s.shown('s1')));
  });

  test(`${which}: ORDERING C — copy, the church deletes, THEN the older steward edit lands`, () => {
    const s = store(SRC);
    s.write('s1', CHURCH, 1000);
    s.del('s1', CHURCH, 3000, ['*']);
    s.write('s1', DANA, 2000, 'Sunday (corrected)');
    assert.equal(s.shown('s1'), null,
      'A WITHDRAWN SERMON WALKED BACK IN on a second relay’s slower copy. Shown: ' + JSON.stringify(s.shown('s1')));
  });

  // ── property 1: a genuinely newer re-publication must still appear ──────────────────────────────────────
  test(`${which}: a steward's genuinely NEWER re-publication still comes back after a church withdrawal`, () => {
    const s = store(SRC);
    s.write('s1', CHURCH, 1000);
    s.del('s1', CHURCH, 3000, ['*']);
    s.write('s1', DANA, 4000, 'Brand new recording');
    assert.ok(s.shown('s1'),
      'THE STICKY WITHDRAWAL BECAME PERMANENT. A steward deleted and re-uploaded the same sermon id after ' +
      'the church’s removal and it never appeared — the withdrawal must bind copies OLDER than it, not the id');
    assert.equal(s.shown('s1').title, 'Brand new recording');
    assert.equal(s.shown('s1')._by, DANA);
  });

  test(`${which}: the CHURCH's own re-publication after its own withdrawal still comes back`, () => {
    const s = store(SRC);
    s.write('s1', CHURCH, 1000);
    s.del('s1', CHURCH, 3000, ['*']);
    s.write('s1', CHURCH, 4000, 'Re-published');
    assert.ok(s.shown('s1'), 'the church could not re-publish a document it had withdrawn');
    assert.equal(s.shown('s1').title, 'Re-published');
  });

  test(`${which}: a copy at the SAME second as the withdrawal stays withdrawn`, () => {
    // Deliberately at-or-older-than, matching the named-tomb rule a few lines above it in the store: a
    // delete published in the same second as the edit it removes is ordinary.
    const s = store(SRC);
    s.del('s1', CHURCH, 3000, ['*']);
    s.write('s1', DANA, 3000, 'Same second');
    assert.equal(s.shown('s1'), null, 'a copy stamped the same second as the withdrawal came back');
  });

  // ── property 2: round 9 stays shut ──────────────────────────────────────────────────────────────────────
  test(`${which}: ROUND 9 — a STEWARD's 'for: *' cannot take a colleague's copy it already holds`, () => {
    const s = store(SRC);
    s.write('s1', CHURCH, 1000);
    s.write('s1', PRIYA, 1500);
    const cleared = s.del('s1', DANA, 3000, ['*']);
    assert.equal(cleared, false, 'Dana withdrew copies she has no authority over — round 9, reintroduced');
    assert.ok(s.shown('s1'), 'a colleague’s sermon vanished for the whole congregation');
    assert.equal(s.shown('s1')._by, PRIYA);
  });

  test(`${which}: ROUND 9, STICKY — a STEWARD's 'for: *' cannot suppress a copy that arrives LATER either`, () => {
    // The half a sticky tomb could have got wrong: remembering a wildcard for an author nobody authorised
    // to name would let one steward pre-emptively suppress a colleague's rota before it was even delivered.
    const s = store(SRC);
    s.del('s1', DANA, 3000, ['*']);
    s.write('s1', PRIYA, 1500);
    assert.ok(s.shown('s1'),
      'A STEWARD SUPPRESSED A COLLEAGUE’S COPY by getting a wildcard tombstone in first. Round 9 reopened ' +
      'through the sticky path.');
    assert.equal(s.shown('s1')._by, PRIYA);
  });

  test(`${which}: a stranger's 'for: *' cannot suppress a copy that arrives later`, () => {
    const s = store(SRC);
    s.del('s1', STRANGER, 3000, ['*']);
    s.write('s1', CHURCH, 1500);
    assert.ok(s.shown('s1'), 'somebody off the roster suppressed the church’s own sermon with a wildcard');
    assert.equal(s.shown('s1')._by, CHURCH);
  });

  test(`${which}: an old tombstone with no 'for' tag still means "my own copy", sticky or not`, () => {
    // Every tombstone written before 2026-08-28 carries no `for` tag. Upgrading must change nothing for it.
    const s = store(SRC);
    s.del('s1', CHURCH, 3000, []);
    s.write('s1', DANA, 2000, 'Steward’s copy');
    assert.ok(s.shown('s1'),
      'an untargeted tombstone bound an author it never named — the pre-2026-08-28 meaning changed');
    assert.equal(s.shown('s1')._by, DANA);
  });

  test(`${which}: a wildcard tomb is never shown and never counted as a rival copy`, () => {
    // The reserved '*' key lives in the same per-author map as real copies. If _pickWinner or
    // _reduceVersions ever treated it as a document, a deleted sermon would render as a blank row and the
    // "two people published this" list (_alt) would name a tombstone as an author.
    const s = store(SRC);
    s.del('s1', CHURCH, 1000, ['*']);
    s.write('s1', DANA, 2000, 'After the withdrawal');
    const rec = s.shown('s1');
    assert.ok(rec, 'fixture: a newer copy should be on screen');
    assert.equal(rec.title, 'After the withdrawal');
    assert.ok(!rec._alt, 'the wildcard tomb was counted as a rival author in _alt: ' + JSON.stringify(rec._alt));
    assert.ok(!rec._tomb, 'a tombstone was rendered as a document');
  });
}

// ══════════════════ POINT OF USE: the shipped member-app readers, not the engine ═══════════════════════════
// Rule 1. Everything above would still pass if no reader ever consulted the store. These drive
// `_openSermons` and `subscribePinnedSermon` out of vendor/fellowship.js through the real docs-hub handler
// shape, and fail if the sermon is on the member's screen.
const FCP = CHURCH, STEW = DANA;
const SERMON_D = 'trinityone/sermon:', PINSERMON_D = 'trinityone/pinsermon:';
const tick = () => new Promise(r => setTimeout(r, 0));

const sermonDoc = (author, id, content, at, tags = []) =>
  ({ id: 'x' + Math.random(), pubkey: author, created_at: at, content: content === null ? '' : JSON.stringify(content),
     tags: [['d', SERMON_D + id], ...(content === null ? [['deleted', '1']] : []), ...tags] });
const pinDoc = (author, content, at, tags = []) =>
  ({ id: 'x' + Math.random(), pubkey: author, created_at: at, content: content === null ? '' : JSON.stringify(content),
     tags: [['d', PINSERMON_D + FCP], ...(content === null ? [['deleted', '1']] : []), ...tags] });

// Same harness shape as scripts/a-delegated-stewards-sermons-reach-a-member-phone.test.mjs: the shipped
// readers, with `_onChurchDocs` stubbed so this file can choose the arrival order on purpose rather than
// racing a relay for it — which is the whole subject here.
function memberApp() {
  let handler = null;
  const stubs = {
    toPub: () => FCP,
    _churchRoster: new Map(),
    _onChurchDocs: (_cp, h) => { handler = h; return () => {}; },
    console,
  };
  const DECLARED = new Set(['handler', '_churchVoice', '_coalesce', '_pickWinner', '_reduceVersions',
    '_absorbById', '_forgetById', '_reduceAll', '_tombstoneTargets', 'SERMON_D', 'PINSERMON_D']);
  const scope = new Proxy(stubs, {
    has: (t, k) => !DECLARED.has(String(k)) && ((k in t) || !(String(k) in globalThis)),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it in memberApp()'); },
  });
  const B = (sig, n) => fnBody(FELLOWSHIP, sig, n);
  const names = Object.keys(stubs);
  const built = new Function(...names, 'scope', `
    ${B('function _churchVoice(cp, doc) {', '_churchVoice')}
    ${B('function _coalesce(fn) {', '_coalesce')}
    ${B('function _pickWinner(', '_pickWinner')}
    ${B('function _reduceVersions(', '_reduceVersions')}
    ${B('function _absorbById(', '_absorbById')}
    ${B('function _forgetById(', '_forgetById')}
    ${B('function _reduceAll(', '_reduceAll')}
    ${B('function _tombstoneTargets(e) {', '_tombstoneTargets')}
    let SERMON_D = ${JSON.stringify(SERMON_D)}, PINSERMON_D = ${JSON.stringify(PINSERMON_D)};
    with (scope) {
      return ({ _openSermons: ({ ${B('_openSermons(churchNpub, onSermons) {', '_openSermons')} })._openSermons,
                subscribePinnedSermon: ({ ${B('subscribePinnedSermon(churchNpub, onPinned) {', 'subscribePinnedSermon')} }).subscribePinnedSermon }); }
  `)(...names.map(k => stubs[k]), scope);
  return {
    openSermons: (cb) => built._openSermons('npub1c', cb),
    openPinned: (cb) => built.subscribePinnedSermon('npub1c', cb),
    fire: (e) => { const d = (e.tags.find(t => t[0] === 'd') || [])[1]; handler.onevent(e, d); },
    eose: () => { handler.oneose && handler.oneose(); },
    setRoster: (pubs) => { stubs._churchRoster.set(FCP, new Set(pubs)); },
  };
}

// ── Watch & Listen ──────────────────────────────────────────────────────────────────────────────────────
test('MEMBER PHONE, ORDERING B: the church’s removal arrives first and the steward’s older edit never lists', async () => {
  const app = memberApp();
  const seen = [];
  app.openSermons(l => seen.push(l.map(x => x.title)));
  app.setRoster([STEW]);
  app.fire(sermonDoc(FCP, 's1', null, 3000, [['church', FCP], ['for', '*']]));
  app.eose();
  await tick();
  app.fire(sermonDoc(STEW, 's1', { id: 's1', title: 'Sunday (corrected)', sha256: 'aa' }, 2000, [['church', FCP]]));
  await tick();
  assert.deepEqual(seen[seen.length - 1], [],
    'A REMOVED SERMON IS LISTED ON A MEMBER’S Watch & Listen TAB. Its blob was deleted when the church ' +
    'pressed Remove, so tapping it can only fail. Shown: ' + JSON.stringify(seen[seen.length - 1]));
});

test('MEMBER PHONE, ORDERING C: the steward’s older edit arrives after the removal and never lists', async () => {
  const app = memberApp();
  const seen = [];
  app.openSermons(l => seen.push(l.map(x => x.title)));
  app.setRoster([STEW]);
  app.fire(sermonDoc(FCP, 's1', { id: 's1', title: 'Sunday', sha256: 'aa' }, 1000, [['church', FCP]]));
  app.eose();
  await tick();
  assert.deepEqual(seen[seen.length - 1], ['Sunday'], 'fixture: the church’s sermon should be listed first');
  app.fire(sermonDoc(FCP, 's1', null, 3000, [['church', FCP], ['for', '*']]));
  await tick();
  app.fire(sermonDoc(STEW, 's1', { id: 's1', title: 'Sunday (corrected)', sha256: 'aa' }, 2000, [['church', FCP]]));
  await tick();
  assert.deepEqual(seen[seen.length - 1], [],
    'A REMOVED SERMON CAME BACK on a second relay’s slower copy: ' + JSON.stringify(seen[seen.length - 1]));
});

test('MEMBER PHONE: …and a genuinely NEWER steward upload after the removal DOES list', async () => {
  const app = memberApp();
  const seen = [];
  app.openSermons(l => seen.push(l.map(x => x.title)));
  app.setRoster([STEW]);
  app.fire(sermonDoc(FCP, 's1', { id: 's1', title: 'Sunday', sha256: 'aa' }, 1000, [['church', FCP]]));
  app.eose();
  await tick();
  app.fire(sermonDoc(FCP, 's1', null, 3000, [['church', FCP], ['for', '*']]));
  await tick();
  app.fire(sermonDoc(STEW, 's1', { id: 's1', title: 'Brand new recording', sha256: 'bb' }, 4000, [['church', FCP]]));
  await tick();
  assert.deepEqual(seen[seen.length - 1], ['Brand new recording'],
    'THE WITHDRAWAL BECAME PERMANENT FOR THE ID. A steward re-uploaded this sermon after the removal and ' +
    'a member can never see it. Shown: ' + JSON.stringify(seen[seen.length - 1]));
});

test('MEMBER PHONE, ROUND 9: a steward’s own `for: *` still cannot remove a sermon that arrives later', async () => {
  const app = memberApp();
  const seen = [];
  app.openSermons(l => seen.push(l.map(x => x.title)));
  app.setRoster([STEW]);
  app.fire(sermonDoc(STEW, 's1', null, 3000, [['church', FCP], ['for', '*']]));
  app.eose();
  await tick();
  app.fire(sermonDoc(FCP, 's1', { id: 's1', title: 'Sunday', sha256: 'aa' }, 1000, [['church', FCP]]));
  await tick();
  assert.deepEqual(seen[seen.length - 1], ['Sunday'],
    'A STEWARD SUPPRESSED THE CHURCH’S OWN SERMON by getting a wildcard tombstone in before it. ' +
    'Shown: ' + JSON.stringify(seen[seen.length - 1]));
});

// ── the featured sermon (AUDIT-delegated-publishing-2026-09-25 M1) ──────────────────────────────────────
test('MEMBER PHONE, PIN, ORDERING B: an unpin that arrives first is not undone by the steward’s older pin', async () => {
  const app = memberApp();
  const seen = [];
  app.openPinned(v => seen.push(v ? v.title : null));
  app.setRoster([STEW]);
  app.fire(pinDoc(FCP, null, 3000, [['church', FCP], ['for', '*']]));
  app.eose();
  await tick();
  app.fire(pinDoc(STEW, { id: 'p1', title: 'Pinned (steward)', sha256: 'aa' }, 2000, [['church', FCP]]));
  await tick();
  assert.equal(seen[seen.length - 1], null,
    'AN UNPINNED SERMON IS STILL FEATURED on a member’s Today card. Shown: ' + JSON.stringify(seen[seen.length - 1]));
});

test('MEMBER PHONE, PIN, ORDERING C: the steward’s older pin arrives after the unpin and does not re-feature', async () => {
  const app = memberApp();
  const seen = [];
  app.openPinned(v => seen.push(v ? v.title : null));
  app.setRoster([STEW]);
  app.fire(pinDoc(FCP, { id: 'p1', title: 'Pinned', sha256: 'aa' }, 1000, [['church', FCP]]));
  app.eose();
  await tick();
  assert.equal(seen[seen.length - 1], 'Pinned', 'fixture: the church’s pin should be featured first');
  app.fire(pinDoc(FCP, null, 3000, [['church', FCP], ['for', '*']]));
  await tick();
  app.fire(pinDoc(STEW, { id: 'p1', title: 'Pinned (steward)', sha256: 'aa' }, 2000, [['church', FCP]]));
  await tick();
  assert.equal(seen[seen.length - 1], null,
    'AN UNPINNED SERMON CAME BACK to the Today card: ' + JSON.stringify(seen[seen.length - 1]));
});

test('MEMBER PHONE, PIN: …and a genuinely NEWER pin after the unpin IS featured', async () => {
  const app = memberApp();
  const seen = [];
  app.openPinned(v => seen.push(v ? v.title : null));
  app.setRoster([STEW]);
  app.fire(pinDoc(FCP, { id: 'p1', title: 'Pinned', sha256: 'aa' }, 1000, [['church', FCP]]));
  app.eose();
  await tick();
  app.fire(pinDoc(FCP, null, 3000, [['church', FCP], ['for', '*']]));
  await tick();
  app.fire(pinDoc(STEW, { id: 'p2', title: 'This week’s sermon', sha256: 'bb' }, 4000, [['church', FCP]]));
  await tick();
  assert.equal(seen[seen.length - 1], 'This week’s sermon',
    'THE UNPIN BECAME PERMANENT. A steward featured a new sermon afterwards and no member can see it. ' +
    'Shown: ' + JSON.stringify(seen[seen.length - 1]));
});
