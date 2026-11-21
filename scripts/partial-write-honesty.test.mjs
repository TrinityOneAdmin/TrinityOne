// A write that landed on SOME relays must be described as what it is (sim 2026-11-20 D4 + the owner's
// N-of-M line, F7). Three real pieces are executed: Steward.writeSpread sliced from the SHIPPED
// vendor/steward.js, and approveGuardian + toggleMinor sliced from app/stew-dashboard.jsx — their
// externals injected, the functions themselves verbatim. Run: node --test scripts/partial-write-honesty.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// ── the engine surface, from the shipped bundle ─────────────────────────────────────────────────────────
function liftWriteSpread({ spread, raw }) {
  const body = fnBody(BUNDLE, 'writeSpread(which) {', 'writeSpread');
  const S = new Function('GUARDIANS_D', 'MINORS_D', 'pub', 'relaysRaw', '_spreadOf',
    'return ({ ' + body + ' });')(
    'trinityone/guardians:', 'trinityone/minors:', 'CP', () => raw, (d) => spread[d] || null);
  return S.writeSpread.bind(S);
}

test('writeSpread: the shipped engine reports landed/missed beside the CONFIGURED list', () => {
  const ws = liftWriteSpread({
    raw: ['r1', 'r2', 'r3'],
    spread: { 'trinityone/minors:CP': { landed: ['r1'], missed: [], at: 7 } },
  });
  assert.deepEqual(ws('minors'), { landed: ['r1'], missed: [], configured: ['r1', 'r2', 'r3'], at: 7 },
    'the configured list is the M the outage line needs — relays() would hide the down relay');
  assert.deepEqual(ws('guardians'), { landed: null, missed: null, configured: ['r1', 'r2', 'r3'], at: 0 },
    'a document never written this session must say so, not invent a spread');
  assert.equal(ws('something-else'), null);
});

// ── approveGuardian, verbatim from the dashboard ────────────────────────────────────────────────────────
// `write` is what setGuardians DOES: it returns the spread the engine would record for THIS write (stamped
// at the moment of the write, as _noteSpread does) plus `ok` (did EVERY relay take it), or null/throws for a
// write that never went out — in which case whatever `stale` spread an EARLIER write left behind is what
// writeSpread still answers with. `mark` is the same for setMinors (default: lands everywhere).
const ALL = (...r) => ({ ok: true, landed: r, missed: [], configured: r });
// `sg` / `links` / `closed` / `at` are what the two hooks hand the screen. The default is a WARM console: both
// lists known, and the screen's copy of the guardians document the one the engine holds (the cold-list rows
// at the foot of this file turn each of those off in turn).
function liftApprove({ write, stale, mark, minors = [], names = {}, sg, links = {}, closed, at = 0 }) {
  const notices = [], calls = { setMinors: [], setGuardians: [], reseal: [], notified: [] };
  const spreads = { guardians: stale || null, minors: null };
  const doWrite = (which, impl) => { const sp = impl(); if (!sp) return null; spreads[which] = { landed: sp.landed, missed: sp.missed, configured: sp.configured, at: Date.now() }; return sp.ok ? true : null; };
  const body = fnBody(DASH, 'const approveGuardian = async (r) => {', 'approveGuardian') + '; return approveGuardian;';
  const fn = new Function('window', 'minorsSet', 'nameByPub', 'guardians', 'guardiansClosed', 'guardiansAt', 'setMinorNotice', 'sg', '_reseal', body)(
    { Steward: {
      setGuardians: async (map, cl) => { calls.setGuardians.push([map, cl]); return doWrite('guardians', write); },
      setMinors: async (list) => { calls.setMinors.push(list); return doWrite('minors', mark || (() => ALL('r1', 'r2'))); },
      writeSpread: (which) => spreads[which] || null,
      notifyGuardianList: (parent, links) => { calls.notified.push([parent, links]); },
    } },
    new Set(minors), names, links, closed, at, (n) => notices.push(n),
    sg || { minors: minors.slice(), approved: [], minorsKnown: true, guardiansKnown: true, guardiansAt: at }, (mins, appr, who, guards) => calls.reseal.push({ mins, who, guards }));
  return { fn, notices, calls };
}
const CHILD = 'c'.repeat(64), PARENT = 'p'.repeat(64);
const ONE_OF_TWO = () => ({ ok: false, landed: ['r1'], missed: ['r2'], configured: ['r1', 'r2'] });
const NONE_OF_TWO = () => ({ ok: false, landed: [], missed: ['r1', 'r2'], configured: ['r1', 'r2'] });

test('a guardian link that landed on one relay of two is said to be PARTLY in force — never "nobody has been linked"', async () => {
  const { fn, notices } = liftApprove({ write: ONE_OF_TWO });
  await fn({ child: CHILD, parent: PARENT });
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /saved on 1 of your 2 relay machines/, 'the partial truth is not said');
  assert.doesNotMatch(notices[0].text, /nobody has been linked/, 'the sim’s false total failure is back');
});

// ── S1 (integration audit 2026-11-21): the spread must be THIS write's ──────────────────────────────────
// setGuardians can refuse WITHOUT writing (it throws for a view that may not write, answers null with no
// signing key). The engine's spread for the guardians document is then still the one an EARLIER save left.
test('a guardian write that NEVER WENT OUT is a total failure, even with an earlier write’s full spread still on record', async () => {
  const stale = { landed: ['r1', 'r2'], missed: [], configured: ['r1', 'r2'], at: Date.now() - 60000 };
  for (const refusal of [() => { throw new Error('This console may not change parent links.'); }, () => null]) {
    const { fn, notices } = liftApprove({ stale, write: refusal });
    await fn({ child: 'c'.repeat(64), parent: 'p'.repeat(64) });
    assert.equal(notices.length, 1);
    assert.doesNotMatch(notices[0].text, /saved on|partly in force/, 'a write that reached no relay was reported off a STALE spread');
    assert.match(notices[0].text, /no relay accepted it/);
    assert.match(notices[0].text, /still waiting/);
  }
});

test('…and the same stale record does not hide a GENUINE partial landing that follows it (control)', async () => {
  const stale = { landed: ['r1', 'r2'], missed: [], configured: ['r1', 'r2'], at: Date.now() - 60000 };
  const { fn, notices } = liftApprove({ stale, write: () => ({ ok: false, landed: ['r2'], missed: ['r1'], configured: ['r1', 'r2'] }) });
  await fn({ child: 'c'.repeat(64), parent: 'p'.repeat(64) });
  assert.match(notices[0].text, /saved on 1 of your 2 relay machines/);
  assert.match(notices[0].text, /partly in force/);
});

test('a guardian link NO relay accepted still says so plainly (control)', async () => {
  const { fn, notices } = liftApprove({ write: NONE_OF_TWO });
  await fn({ child: 'c'.repeat(64), parent: 'p'.repeat(64) });
  assert.match(notices[0].text, /no relay accepted it/);
  assert.match(notices[0].text, /nobody has been linked/);
});

test('a spread the engine cannot give falls back to the total-failure wording, never a crash', async () => {
  const notices = [];
  const body = fnBody(DASH, 'const approveGuardian = async (r) => {', 'approveGuardian') + '; return approveGuardian;';
  const fn = new Function('window', 'minorsSet', 'nameByPub', 'guardians', 'guardiansClosed', 'guardiansAt', 'sg', 'setMinorNotice', body)(
    { Steward: { setGuardians: async () => null, writeSpread: () => { throw new Error('old engine'); } } },
    new Set(), {}, {}, undefined, 0, { minors: [], minorsKnown: true, guardiansKnown: true, guardiansAt: 0 }, (n) => notices.push(n));
  await fn({ child: 'c'.repeat(64), parent: 'p'.repeat(64) });
  assert.match(notices[0].text, /nobody has been linked/);
});

// ── S2 (integration audit 2026-11-21): A LINK THAT PARTLY LANDED STILL MARKS THE CHILD ──────────────────
// approveGuardian returned on a partial link BEFORE setMinors, and told the steward to "Confirm again" —
// about a card that leaves the list once the console reads the link back. The child stayed linked and
// unmarked. reference/DOMAIN.md: a child linked to a guardian must become a minor.
test('S2: a guardian link that landed on one relay of two STILL marks the child, re-seals to them, and tells the parent', async () => {
  const { fn, notices, calls } = liftApprove({ write: ONE_OF_TWO, names: { [CHILD]: 'Little Ana' } });
  const r = await fn({ child: CHILD, parent: PARENT });
  assert.deepEqual(calls.setMinors, [[CHILD]], 'the child was left linked and UNMARKED — an adult to every relay');
  assert.equal(calls.reseal.length, 1, 'the child’s phone was never re-sealed');
  assert.deepEqual(calls.reseal[0].mins, [CHILD], 'the re-seal did not carry the child as a minor');
  assert.deepEqual(calls.reseal[0].guards, { [CHILD]: [PARENT] });
  assert.deepEqual(calls.notified, [[PARENT, { [CHILD]: [PARENT] }]], 'the parent’s app was left reading "waiting" with no card left to confirm');
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /saved on 1 of your 2 relay machines, so it is partly in force/);
  assert.match(notices[0].text, /Little Ana is marked as a child/);
  assert.doesNotMatch(notices[0].text, /Confirm again/, 'the notice still offers a retry from a card that is gone');
  assert.notEqual(r, true, 'a link that missed a machine is not reported as fully done');
});

test('S2: when the SAME relay refuses the mark too, the mark is still written where it can be, and both counts are said', async () => {
  const { fn, notices, calls } = liftApprove({ write: ONE_OF_TWO, mark: ONE_OF_TWO });
  await fn({ child: CHILD, parent: PARENT });
  assert.deepEqual(calls.setMinors, [[CHILD]]);
  assert.deepEqual(calls.reseal[0].mins, [CHILD]);
  assert.match(notices[0].text, /guardian link saved on 1 of your 2 relay machines/);
  assert.match(notices[0].text, /Marking them as a child reached 1 of your 2 relay machines/);
  assert.doesNotMatch(notices[0].text, /is marked as a child\./, 'a mark that missed a machine was reported as complete');
  assert.doesNotMatch(notices[0].text, /Confirm again/);
});

test('S2: a partial link whose mark NO relay took says the child is NOT yet a child, and names the step that exists', async () => {
  const { fn, notices, calls } = liftApprove({ write: ONE_OF_TWO, mark: NONE_OF_TWO });
  await fn({ child: CHILD, parent: PARENT });
  assert.deepEqual(calls.setMinors, [[CHILD]], 'control: the mark was attempted');
  assert.match(notices[0].text, /saved on 1 of your 2 relay machines/);
  assert.match(notices[0].text, /Marking them as a child was NOT saved/);
  assert.match(notices[0].text, /not yet treated as a child/);
  assert.match(notices[0].text, /from their own row in the members list/);
  assert.doesNotMatch(notices[0].text, /Confirm again|Try again/);
  assert.deepEqual(calls.reseal[0].mins, [], 'the re-seal claimed a mark no relay holds');
  assert.deepEqual(calls.notified, []);
});

test('S2: a partial link for a child ALREADY marked writes no second mark and still says where the link reached', async () => {
  const { fn, notices, calls } = liftApprove({ write: ONE_OF_TWO, minors: [CHILD] });
  await fn({ child: CHILD, parent: PARENT });
  assert.deepEqual(calls.setMinors, []);
  assert.equal(calls.reseal.length, 1);
  assert.match(notices[0].text, /partly in force/);
});

test('S2 CONTROL: a link NO relay took marks nobody; a link every relay took is silent success', async () => {
  const none = liftApprove({ write: NONE_OF_TWO });
  await none.fn({ child: CHILD, parent: PARENT });
  assert.deepEqual(none.calls.setMinors, [], 'someone was marked as a child for a link that does not exist');
  assert.deepEqual(none.calls.reseal, []);
  assert.deepEqual(none.calls.notified, []);
  const all = liftApprove({ write: () => ALL('r1', 'r2') });
  assert.equal(await all.fn({ child: CHILD, parent: PARENT }), true);
  assert.deepEqual(all.calls.setMinors, [[CHILD]]);
  assert.deepEqual(all.notices, [], 'a complete confirm grew a warning');
  assert.equal(all.calls.notified.length, 1);
});

test('a link EVERY relay took whose mark did not: partly marked is said with its count; not marked at all points at the member’s row', async () => {
  const part = liftApprove({ write: () => ALL('r1', 'r2'), mark: ONE_OF_TWO });
  assert.notEqual(await part.fn({ child: CHILD, parent: PARENT }), true);
  assert.match(part.notices[0].text, /^The guardian link was saved\. Marking them as a child reached 1 of your 2 relay machines\./);
  assert.deepEqual(part.calls.reseal[0].mins, [CHILD]);
  const none = liftApprove({ write: () => ALL('r1', 'r2'), mark: NONE_OF_TWO });
  await none.fn({ child: CHILD, parent: PARENT });
  assert.match(none.notices[0].text, /^The guardian link was saved\. Marking them as a child was NOT saved/);
  assert.match(none.notices[0].text, /from their own row in the members list/);
  assert.deepEqual(none.calls.reseal[0].mins, []);
  assert.deepEqual(none.calls.notified, [], 'the parent was told about a child who is linked but not protected');
});

// ── toggleMinor, verbatim from the dashboard ────────────────────────────────────────────────────────────
function liftToggle({ spread, setMinorsOk = true }) {
  const notices = []; const calls = [];
  const body = fnBody(DASH, 'const toggleMinor = async (pk) => {', 'toggleMinor') + '; return toggleMinor;';
  const fn = new Function('window', 'sg', 'minorsSet', 'parentSet', 'nophotoSet', 'ckClearedSet', 'guardians', 'guardiansClosed', 'kidPhotosAllowed', 'nameByPub', 'setMinorNotice', '_reseal', body)(
    { Steward: { setMinors: async (l) => { calls.push(['setMinors', l]); return setMinorsOk; }, setNoPhoto: async () => true, writeSpread: () => spread } },
    { minorsKnown: true, minors: [], approved: [], nophoto: [] },
    new Set(), new Set(), new Set(), new Set(), {}, undefined, true, {}, (n) => notices.push(n), () => {});
  return { fn, notices, calls };
}

test('marking a child while a configured relay is away says WHERE the protection reached (owner’s N-of-M line)', async () => {
  const { fn, notices, calls } = liftToggle({ spread: { landed: ['r1'], missed: [], configured: ['r1', 'r2'], at: 1 } });
  await fn('k'.repeat(64));
  assert.ok(calls.some(c => c[0] === 'setMinors'), 'the mark never reached the engine — rig broken');
  assert.equal(notices.length, 1, 'the mark stayed silent although a configured machine missed it');
  assert.match(notices[0].text, /reached 1 of your 2 relay machines/);
  assert.match(notices[0].text, /back and in sync/);
});

test('marking a child with every configured relay landed stays as quiet as before (control)', async () => {
  const { fn, notices } = liftToggle({ spread: { landed: ['r1', 'r2'], missed: [], configured: ['r1', 'r2'], at: 1 } });
  await fn('k'.repeat(64));
  assert.deepEqual(notices, [null], 'full coverage must not grow a warning');
});

// ── THE COLD-LIST WIPE (integration audit 2026-11-21) ───────────────────────────────────────────────────
// approveGuardian REPLACES two whole documents built from what the screen holds. On a console they have not
// reached, that is {} and [] -- one Confirm published a parent-link map of one link and a children list of
// one child. These drive the real function (sliced above, verbatim) and read what it handed the engine.
const KID1 = '1'.repeat(64), KID2 = '2'.repeat(64), MUM1 = 'a'.repeat(64);
const EVERYWHERE = () => ALL('r1', 'r2');
const refused = async (opts, why) => {
  const a = liftApprove({ write: EVERYWHERE, ...opts });
  const r = await a.fn({ child: CHILD, parent: PARENT });
  assert.deepEqual(a.calls.setGuardians, [], why + ': the parent-link map was REPLACED');
  assert.deepEqual(a.calls.setMinors, [], why + ': the children list was REPLACED');
  assert.deepEqual(a.calls.reseal, [], why + ': a child’s phone was re-sealed off lists nobody holds');
  assert.deepEqual(a.calls.notified, [], why + ': the parent was told of a link that was not made');
  assert.equal(r, null);
  assert.equal(a.notices.length, 1, why + ': the steward was told nothing');
  assert.equal(a.notices[0].tone, 'fail');
  assert.equal(a.notices[0].pk, CHILD);
  assert.match(a.notices[0].text, /^Nothing was changed/);
  assert.match(a.notices[0].text, /hasn’t received your church’s list of children and parent links yet/);
  assert.match(a.notices[0].text, /Try again in a moment/);
};

test('COLD: a Confirm pressed before either list has arrived writes NOTHING and says so', async () => {
  // exactly what the two hooks hand a screen on first paint (app/steward-root.jsx)
  await refused({ sg: { minors: [], approved: [], expiry: {}, minorsKnown: false, minorsDocSeen: false }, links: {}, closed: {} }, 'a cold console');
});

test('COLD, fail closed: a console with no safeguarding subscription at all (no flags) is refused', async () => {
  await refused({ sg: { minors: [] } }, 'a console whose engine says nothing about what is known');
});

test('the children list known but the parent-link map NOT: still refused — minorsKnown alone is not the gate', async () => {
  await refused({ minors: [KID1, KID2], sg: { minors: [KID1, KID2], approved: [], minorsKnown: true, guardiansKnown: false, guardiansAt: 0 } }, 'a console that holds the children list only');
});

test('…and the other way round — the parent-link map known and current, the children list NOT: still refused', async () => {
  // the guardians document can equally be the one that arrives first; the children list is then still []
  await refused({ links: { [KID1]: [MUM1] }, at: 900, sg: { minors: [], approved: [], minorsKnown: false, guardiansKnown: true, guardiansAt: 900 } }, 'a console that holds the parent links only');
});

test('both known, but the screen’s own copy of the map is OLDER than the one the engine holds: refused', async () => {
  // the screen reads the map from a second subscription; here that one has delivered nothing (at 0) or an old copy
  const known = { minors: [KID1], approved: [], minorsKnown: true, guardiansKnown: true, guardiansAt: 900 };
  await refused({ minors: [KID1], sg: known, links: {}, at: 0 }, 'a screen whose map has not arrived');
  await refused({ minors: [KID1], sg: known, links: { [KID1]: [MUM1] }, at: 899 }, 'a screen holding a stale map');
});

test('CONTROL, WARM: with both lists known the confirm goes through, and KEEPS every other child, link and closed pair', async () => {
  const closed = { [KID2 + '|' + MUM1]: 1700000000 };
  const a = liftApprove({ write: EVERYWHERE, minors: [KID1, KID2], links: { [KID1]: [MUM1] }, closed, at: 900,
    sg: { minors: [KID1, KID2], approved: [], minorsKnown: true, guardiansKnown: true, guardiansAt: 900 } });
  assert.equal(await a.fn({ child: CHILD, parent: PARENT }), true, 'a legitimate confirm on a warm console was refused');
  assert.deepEqual(a.calls.setGuardians, [[{ [KID1]: [MUM1], [CHILD]: [PARENT] }, closed]]);
  assert.deepEqual(a.calls.setMinors, [[KID1, KID2, CHILD]]);
  assert.deepEqual(a.notices, []);
});

test('CONTROL: the screen’s map NEWER than the engine’s copy is not a refusal, and neither is a church’s FIRST guardian', async () => {
  const newer = liftApprove({ write: EVERYWHERE, minors: [KID1], links: { [KID1]: [MUM1] }, at: 901,
    sg: { minors: [KID1], approved: [], minorsKnown: true, guardiansKnown: true, guardiansAt: 900 } });
  assert.equal(await newer.fn({ child: CHILD, parent: PARENT }), true);
  assert.deepEqual(newer.calls.setMinors, [[KID1, CHILD]]);
  // a church that has never marked a child or linked a parent: no document of either kind exists, `loaded` is
  // false for ever, and the relay's authenticated answer is the only evidence there will ever be
  const first = liftApprove({ write: EVERYWHERE, links: {}, at: 0,
    sg: { minors: [], approved: [], loaded: false, minorsDocSeen: false, minorsKnown: true, guardiansKnown: true, guardiansAt: 0 } });
  assert.equal(await first.fn({ child: CHILD, parent: PARENT }), true, 'a church cannot confirm its first guardian');
  assert.deepEqual(first.calls.setGuardians, [[{ [CHILD]: [PARENT] }, undefined]]);
  assert.deepEqual(first.calls.setMinors, [[CHILD]]);
});

// ── the engine half, from the SHIPPED bundle: subscribeGuardians says WHICH copy it delivered ────────────
test('subscribeGuardians (shipped): `at` is 0 until a document arrives, then that document’s created_at — newest wins', () => {
  const body = fnBody(BUNDLE, 'subscribeGuardians(onData) {', 'subscribeGuardians');
  let h = null; const out = [];
  const S = new Function('pool', 'relays', 'pub', 'GUARDIANS_D', 'NET', '_authFuture', '_byChurch', 'return ({ ' + body + ' });')(
    { subscribeMany: (u, f, handlers) => { h = handlers; return { close() {} }; } }, () => ['r1'], 'CP', 'trinityone/guardians:', 'trinityone', () => false, () => true);
  S.subscribeGuardians((d) => out.push(d));
  const doc = (ts, links) => ({ created_at: ts, tags: [['d', 'trinityone/guardians:CP']], content: JSON.stringify({ links }) });
  h.oneose();
  assert.deepEqual(out.pop(), { links: {}, closed: {}, at: 0 }, 'an answer with no document must read as "no copy held"');
  h.onevent(doc(900, { [KID1]: [MUM1] }));
  assert.deepEqual(out.pop(), { links: { [KID1]: [MUM1] }, closed: {}, at: 900 });
  h.onevent(doc(800, {}));
  assert.equal(out.length, 0, 'an OLDER copy was delivered over a newer one');
});
