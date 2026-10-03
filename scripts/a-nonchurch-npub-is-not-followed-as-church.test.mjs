// A well-formed npub that is NOT a church must not be followed as "Church" — the member should see
// "not found" and no signed membership document should be published.
// Run: node --test scripts/a-nonchurch-npub-is-not-followed-as-church.test.mjs
//
// M-9. Owner decision 2026-09-03: if the code is valid but isn't a church, show "not found" — but
// NEVER say "not found" just because a relay didn't answer. This test drives the SHIPPED code
// (CLAUDE.md rules 1+3): it lifts checkChurch from vendor/fellowship.js and renders the real
// followChurch from app/app.jsx, so the test fails if the feature is deleted from either the engine
// or the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const APPJSX = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// ── ENGINE: checkChurch exists in the shipped bundle and returns the right verdicts ──────────────────
test('ENGINE: checkChurch is in the shipped bundle', () => {
  assert.match(BUNDLE, /async checkChurch\(/,
    'checkChurch is not in the shipped bundle — a valid npub that is not a church will be followed as "Church"');
});

// THREE ENGINE TESTS WERE REMOVED HERE on 2026-09-30 (audit 2026-09-30, finding 4). They stubbed
// pool.querySync — which checkChurch no longer calls — and the 'church' case fed it `{kind: 0}`, which is a
// MEMBER'S own profile: the stub supplied the very answer the test was named after. The engine is now tested
// against a real relay in scripts/a-members-code-is-not-a-church.test.mjs (member vs church, unreachable,
// silent, pending, unproved). The screen tests below stay: they prove followChurch consults the verdict.

// ── POINT OF USE: followChurch in app.jsx is lifted and EXECUTED (CLAUDE.md rule 3) ─────────────────
//
// The old tests 5-6 text-matched `app/app.jsx`, which violates rule 3: `false && ` in front of a condition
// leaves every word in place and the match still passes. These lift the real function, supply stubs for the
// closure variables it closes over, and RUN it — so the test fails if the feature is deleted from the screen.

// Build a callable followChurch from the app source. Closure variables are replaced with the stubs passed in.
function liftFollowChurch(appSrc) {
  const body = fnBody(appSrc, 'const followChurch = (raw) =>', 'followChurch');
  // followChurch is an arrow: `const followChurch = (raw) => { ... }` — the fnBody includes the full
  // declaration. We need to extract just the function body and wrap it so the closure variables are injectable.
  return body;
}

function makeFollowEnv(checkResult) {
  const calls = { checkChurch: 0, announceMembership: 0, toast: [], setChurches: [], setActiveChurch: [] };
  const churches = [];
  const setChurches = (fn) => { calls.setChurches.push(typeof fn === 'function' ? fn(churches) : fn); };
  const setActiveChurch = (fn) => { calls.setActiveChurch.push(typeof fn === 'function' ? fn(null) : fn); };
  const lsSet = () => {};
  const toast = (msg) => { calls.toast.push(msg); };
  // window.Fellowship with spies
  const Fellowship = {
    toPub: (npub) => npub.startsWith('npub1') ? 'a'.repeat(64) : null,
    addRelay: () => {},
    CANONICAL_RELAYS: [],
    adoptInviteRelays: () => {},
    checkChurch: async (npub) => { calls.checkChurch++; return checkResult; },
    announceMembership: (npub) => { calls.announceMembership++; },
    subscribeChurchProfile: () => () => {},
    subscribeChurchRelays: () => () => {},
  };
  // the React.useRef(new Set()) app.jsx declares just above followChurch (sim item 20)
  const unconfirmed = { current: new Set() };
  return { churches, setChurches, setActiveChurch, lsSet, toast, Fellowship, calls, unconfirmed };
}

test('POINT OF USE: followChurch calls checkChurch and announces membership only when "church" (executed)', async () => {
  const body = liftFollowChurch(APPJSX);
  const env = makeFollowEnv('church');
  // Build the callable. The arrow function closes over churches, setChurches, setActiveChurch, lsSet, toast,
  // and reads window.Fellowship. We inject them all.
  const fn = new Function('churches', 'setChurches', 'setActiveChurch', 'lsSet', 'toast', 'window', 'setTimeout', 'unconfirmedChurches',
    body + '\nreturn followChurch;'
  )(env.churches, env.setChurches, env.setActiveChurch, env.lsSet, env.toast,
    { Fellowship: env.Fellowship, addEventListener: () => {}, removeEventListener: () => {} }, setTimeout, env.unconfirmed);

  // A valid npub that checkChurch says IS a church → announceMembership must fire
  fn('npub1gxa6a0eaga9hy2mpjk6gxpxaxvywwvezrnsrgxennkfhwru7ngnsevqeyr');
  // Wait for the async _check call to complete
  await new Promise(r => setTimeout(r, 50));

  assert.equal(env.calls.checkChurch, 1,
    'followChurch did not call checkChurch — the M-9 guard is missing from the screen');
  assert.equal(env.calls.announceMembership, 1,
    'followChurch did not call announceMembership after checkChurch returned "church"');
});

test('POINT OF USE: followChurch does NOT announce membership when checkChurch returns "not-found" (executed)', async () => {
  const body = liftFollowChurch(APPJSX);
  const env = makeFollowEnv('not-found');
  const fn = new Function('churches', 'setChurches', 'setActiveChurch', 'lsSet', 'toast', 'window', 'setTimeout', 'unconfirmedChurches',
    body + '\nreturn followChurch;'
  )(env.churches, env.setChurches, env.setActiveChurch, env.lsSet, env.toast,
    { Fellowship: env.Fellowship, addEventListener: () => {}, removeEventListener: () => {} }, setTimeout, env.unconfirmed);

  fn('npub1gxa6a0eaga9hy2mpjk6gxpxaxvywwvezrnsrgxennkfhwru7ngnsevqeyr');
  await new Promise(r => setTimeout(r, 50));

  assert.equal(env.calls.checkChurch, 1,
    'followChurch did not call checkChurch — the M-9 guard is missing from the screen');
  assert.equal(env.calls.announceMembership, 0,
    'followChurch called announceMembership for a "not-found" npub — a non-church gets a signed ' +
    'membership document published, which is the exact bug M-9 found');
  assert.ok(env.calls.toast.some(m => /church/i.test(m) || /not.found/i.test(m)),
    'followChurch did not show a toast on "not-found" — the user gets no feedback');
});

test('POINT OF USE: followChurch removes the church entry on "not-found" (executed)', async () => {
  const body = liftFollowChurch(APPJSX);
  const env = makeFollowEnv('not-found');
  const fn = new Function('churches', 'setChurches', 'setActiveChurch', 'lsSet', 'toast', 'window', 'setTimeout', 'unconfirmedChurches',
    body + '\nreturn followChurch;'
  )(env.churches, env.setChurches, env.setActiveChurch, env.lsSet, env.toast,
    { Fellowship: env.Fellowship, addEventListener: () => {}, removeEventListener: () => {} }, setTimeout, env.unconfirmed);

  fn('npub1gxa6a0eaga9hy2mpjk6gxpxaxvywwvezrnsrgxennkfhwru7ngnsevqeyr');
  await new Promise(r => setTimeout(r, 50));

  // The "not-found" handler calls setChurches with a filter that removes the npub
  const filterCalls = env.calls.setChurches;
  // The second call to setChurches should be a filter removing the church (first was the add)
  assert.ok(filterCalls.length >= 2,
    'followChurch did not call setChurches a second time to remove the non-church entry');
  const filtered = filterCalls[filterCalls.length - 1];
  assert.ok(Array.isArray(filtered) && !filtered.some(c => c.id === 'npub1gxa6a0eaga9hy2mpjk6gxpxaxvywwvezrnsrgxennkfhwru7ngnsevqeyr'),
    'followChurch did not filter out the non-church entry — the "Church" placeholder stays on screen');
});

test('POINT OF USE: followChurch waits for the invite relay to be proved before it asks (executed)', async () => {
  // A self-hosted church's join policy may exist ONLY on its own box, which joins the relay list once
  // adoptInviteRelays has proved it. Asking first would read a real church as "not found".
  const body = liftFollowChurch(APPJSX);
  const env = makeFollowEnv('church');
  let adopted = false, resolveAdoption;
  env.Fellowship.adoptInviteRelays = () => new Promise(r => { resolveAdoption = () => { adopted = true; r({ added: ['wss://box'] }); }; });
  const seenAtCheck = [];
  env.Fellowship.checkChurch = async () => { seenAtCheck.push(adopted); env.calls.checkChurch++; return 'church'; };
  const fn = new Function('churches', 'setChurches', 'setActiveChurch', 'lsSet', 'toast', 'window', 'setTimeout', 'unconfirmedChurches',
    body + '\nreturn followChurch;'
  )(env.churches, env.setChurches, env.setActiveChurch, env.lsSet, env.toast,
    { Fellowship: env.Fellowship, addEventListener: () => {}, removeEventListener: () => {} }, setTimeout, env.unconfirmed);

  fn('npub1gxa6a0eaga9hy2mpjk6gxpxaxvywwvezrnsrgxennkfhwru7ngnsevqeyr?relay=wss://box');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(env.calls.checkChurch, 0, 'followChurch asked whether this is a church before the invite relay was proved');
  resolveAdoption();
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(seenAtCheck, [true], 'the church check did not run once, after the invite relay was proved');
  assert.equal(env.calls.announceMembership, 1);
});

// ── SIM ITEM 20 (2026-10-02): the membership HEARTBEAT must not announce to a code whose check is still out ──
//
// followChurch makes the church ACTIVE before checkChurch answers, and app.jsx's heartbeat effect is keyed on the
// active church, so it announced on the very render that followed. followChurch now records the code in
// `unconfirmedChurches` (a ref) BEFORE it sets the active church, and the heartbeat stays out of anything in it.
// These run the real followChurch and look at what is in that set at the moment the heartbeat would run.
// (The heartbeat itself is driven in a real browser by scripts/a-church-code-check-sends-nothing.test.mjs.)
const NPUB20 = 'npub1gxa6a0eaga9hy2mpjk6gxpxaxvywwvezrnsrgxennkfhwru7ngnsevqeyr';
function liftWithGate(checkResult, { setTimeoutImpl = setTimeout, followed = [] } = {}) {
  const body = liftFollowChurch(APPJSX);
  const env = makeFollowEnv(checkResult);
  followed.forEach(c => env.churches.push(c));
  const atActive = [];   // what the set held when setActiveChurch ran -- i.e. when the heartbeat effect would next run
  env.setActiveChurch = (fn) => { atActive.push(typeof fn === 'function' ? 'fn' : env.unconfirmed.current.has(fn)); };
  const fn = new Function('churches', 'setChurches', 'setActiveChurch', 'lsSet', 'toast', 'window', 'setTimeout', 'unconfirmedChurches',
    body + '\nreturn followChurch;'
  )(env.churches, env.setChurches, env.setActiveChurch, env.lsSet, env.toast,
    { Fellowship: env.Fellowship, addEventListener: () => {}, removeEventListener: () => {} }, setTimeoutImpl, env.unconfirmed);
  return { fn, env, atActive };
}
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

test('POINT OF USE (item 20): the code is held back from the heartbeat the moment it becomes active, and released with an announce only when it IS a church (executed)', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const { fn, env, atActive } = liftWithGate('church');
  env.Fellowship.checkChurch = async () => { env.calls.checkChurch++; await gate; return 'church'; };
  fn(NPUB20);
  await tick();
  assert.deepEqual(atActive, [true], 'the church was made active BEFORE it was marked unconfirmed -- the heartbeat would announce straight away');
  assert.equal(env.unconfirmed.current.has(NPUB20), true, 'the code is not held back while the check is still out');
  assert.equal(env.calls.announceMembership, 0, 'a membership was announced before checkChurch answered');
  release(); await tick();
  assert.equal(env.unconfirmed.current.has(NPUB20), false, 'a confirmed church is still held back from the heartbeat');
  assert.equal(env.calls.announceMembership, 1);
});

test('POINT OF USE (item 20): a code that is not a church is released with NO announce (executed)', async () => {
  const { fn, env } = liftWithGate('not-found');
  fn(NPUB20); await tick();
  assert.equal(env.unconfirmed.current.has(NPUB20), false, 'a dropped code is still in the held-back set');
  assert.equal(env.calls.announceMembership, 0);
});

test('POINT OF USE (item 20): a relay that never answers is not "not found" -- after the retries the join is sent, once (executed)', async () => {
  const { fn, env } = liftWithGate('unknown', { setTimeoutImpl: (f) => { Promise.resolve().then(f); } });
  fn(NPUB20); await tick(120);
  assert.equal(env.calls.checkChurch, 4, 'expected the first ask plus three retries');
  assert.equal(env.calls.announceMembership, 1, 'a real church on a thin link never got its join request');
  assert.equal(env.unconfirmed.current.has(NPUB20), false, 'the code is still held back after the retries ran out');
  assert.deepEqual(env.calls.toast, [], 'an unanswered relay must never say "not found"');
});

test('POINT OF USE (item 20): a church this phone already follows is never held back (executed)', async () => {
  const { fn, env, atActive } = liftWithGate('church', { followed: [{ id: NPUB20, npub: NPUB20 }] });
  fn(NPUB20); await tick();
  assert.deepEqual(atActive, [false], 'an already-followed church was marked unconfirmed -- its heartbeat would stop for no reason');
  assert.equal(env.calls.checkChurch, 0);
});
