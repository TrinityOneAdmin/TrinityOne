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
// at the moment of the write, as _noteSpread does), or null/throws for a write that never went out — in
// which case whatever `stale` spread an EARLIER write left behind is what writeSpread still answers with.
function liftApprove({ write, stale }) {
  const notices = [];
  let current = stale || null;
  const body = fnBody(DASH, 'const approveGuardian = async (r) => {', 'approveGuardian') + '; return approveGuardian;';
  const fn = new Function('window', 'minorsSet', 'nameByPub', 'guardians', 'guardiansClosed', 'setMinorNotice', body)(
    { Steward: {
      setGuardians: async () => { const sp = write(); if (sp) current = { ...sp, at: Date.now() }; return null; },
      writeSpread: (which) => (which === 'guardians' ? current : null),
    } },
    new Set(), {}, {}, undefined, (n) => notices.push(n));
  return { fn, notices };
}

test('a guardian link that landed on one relay of two is said to be PARTLY in force — never "nobody has been linked"', async () => {
  const { fn, notices } = liftApprove({ write: () => ({ landed: ['r1'], missed: ['r2'], configured: ['r1', 'r2'] }) });
  await fn({ child: 'c'.repeat(64), parent: 'p'.repeat(64) });
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
  const { fn, notices } = liftApprove({ stale, write: () => ({ landed: ['r2'], missed: ['r1'], configured: ['r1', 'r2'] }) });
  await fn({ child: 'c'.repeat(64), parent: 'p'.repeat(64) });
  assert.match(notices[0].text, /saved on 1 of your 2 relay machines/);
  assert.match(notices[0].text, /partly in force/);
});

test('a guardian link NO relay accepted still says so plainly (control)', async () => {
  const { fn, notices } = liftApprove({ write: () => ({ landed: [], missed: ['r1', 'r2'], configured: ['r1', 'r2'] }) });
  await fn({ child: 'c'.repeat(64), parent: 'p'.repeat(64) });
  assert.match(notices[0].text, /no relay accepted it/);
  assert.match(notices[0].text, /nobody has been linked/);
});

test('a spread the engine cannot give falls back to the total-failure wording, never a crash', async () => {
  const notices = [];
  const body = fnBody(DASH, 'const approveGuardian = async (r) => {', 'approveGuardian') + '; return approveGuardian;';
  const fn = new Function('window', 'minorsSet', 'nameByPub', 'guardians', 'guardiansClosed', 'setMinorNotice', body)(
    { Steward: { setGuardians: async () => null, writeSpread: () => { throw new Error('old engine'); } } },
    new Set(), {}, {}, undefined, (n) => notices.push(n));
  await fn({ child: 'c'.repeat(64), parent: 'p'.repeat(64) });
  assert.match(notices[0].text, /nobody has been linked/);
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
