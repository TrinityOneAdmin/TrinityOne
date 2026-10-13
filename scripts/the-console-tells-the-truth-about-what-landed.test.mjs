// THE CONSOLE MUST NOT REPORT A FAILURE FOR AN ACTION THAT SUCCEEDED.
//   Run: node --test scripts/the-console-tells-the-truth-about-what-landed.test.mjs
//
// DEFECT 1. Revoke a co-steward while the app is backgrounded: the relay applies the roster, the OK is lost with
// the socket, publish() answers false, and the console said "STILL a steward and nothing was re-keyed". Now a false
// answer is checked against what the relays hold (Steward.stewardRemovalOutcome), and the re-key follows the truth.
// DEFECT 2. A co-steward's console raised "A relay refused 'people must be approved…'" while approval WAS on. Now a
// refused ensureJoinPolicy looks again, and stays quiet only if the copy that COUNTS already says approval is on.
//
// Rule 1/3: the engine functions are LIFTED FROM vendor/steward.js and run (the bundle drops dead code, so text
// cannot satisfy this); the panel is the REAL DashStewardsPanel with its real Revoke control pressed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { compiled, common, press, find, reads } from './dash-render-kit.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
function method(sig) {   // a method of the Steward object, with its `async`
  let at = STEWARD.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test');
  if (STEWARD.slice(at - 6, at) === 'async ') at -= 6;
  return fnBody(STEWARD, at, sig);
}
const beats = STEWARD.match(/var _beatsDoc = [\s\S]*?\n  };/)[0];
const newestByD = fnBody(STEWARD, 'function _newestByD(', '_newestByD');

const CHURCH = 'c'.repeat(64), STEW = 'd'.repeat(64), OTHER = 'e'.repeat(64), STRANGER = '5'.repeat(64);
const STEWARDS_D = 'trinityone/stewards:', JP = 'trinityone/joinpolicy:';

// a fake pool over named relays; each relay holds a list of events and answers a REQ from them, then EOSEs
function world(relayEvents) {
  const matches = (e, f) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey))
    && (!f['#d'] || f['#d'].includes((e.tags.find(t => t[0] === 'd') || [])[1]))
    && (!f['#church'] || f['#church'].includes((e.tags.find(t => t[0] === 'church') || [])[1]));
  return {
    relayEvents,
    pool: { subscribeMany(urls, filters, h) {
      let closed = false;
      setTimeout(() => { for (const u of urls) for (const e of (relayEvents[u] || [])) if (!closed && filters.some(f => matches(e, f))) h.onevent(e); if (!closed && h.oneose) h.oneose(); }, 0);
      return { close() { closed = true; } };
    } },
  };
}
const roster = (list, at, by = CHURCH) => ({ kind: 30078, pubkey: by, created_at: at, id: String(at).padStart(64, '0'), tags: [['d', STEWARDS_D + CHURCH]], content: JSON.stringify({ pubkeys: list }) });
const policy = (approval, at, by = CHURCH, tagged = false) => ({ kind: 30078, pubkey: by, created_at: at, id: String(at).padStart(64, '0'),
  tags: [['d', JP + CHURCH], ...(tagged ? [['church', CHURCH]] : [])], content: JSON.stringify({ approval }) });

function removalOutcome(w, urls) {
  const scope = { pub: CHURCH, relays: () => urls, STEWARDS_D, pool: w.pool, _authFuture: () => false, setTimeout, Promise, JSON };
  const names = Object.keys(scope);
  const api = new Function(...names, `${beats}\n${newestByD}\nreturn ({ ${method('async stewardRemovalOutcome(pk)')} });`)(...names.map(k => scope[k]));
  return api.stewardRemovalOutcome;
}

// ── DEFECT 1: the engine ─────────────────────────────────────────────────────────────────────────────────
test('the OK was lost but one relay holds the shorter roster: LANDED (the newest copy anywhere wins)', async () => {
  const w = world({ A: [roster([STEW, OTHER], 100)], B: [roster([OTHER], 200)] });
  assert.equal(await removalOutcome(w, ['A', 'B'])(STEW), 'landed');
});
test('every relay answered and every one still lists them: NOT-LANDED', async () => {
  const w = world({ A: [roster([STEW, OTHER], 100)], B: [roster([STEW, OTHER], 100)] });
  assert.equal(await removalOutcome(w, ['A', 'B'])(STEW), 'not-landed');
});
test('a relay that has nothing to say means we CANNOT TELL, never "not landed"', async () => {
  const w = world({ A: [roster([STEW, OTHER], 100)], B: [] });
  assert.equal(await removalOutcome(w, ['A', 'B'])(STEW), 'unknown');
});
test('a roster signed by anyone but the church is not evidence of anything', async () => {
  const w = world({ A: [roster([OTHER], 300, STRANGER)], B: [] });
  assert.equal(await removalOutcome(w, ['A', 'B'])(STEW), 'unknown');
});

// ── DEFECT 1: the screen ─────────────────────────────────────────────────────────────────────────────────
const M1 = 'a'.repeat(64);
async function revokeWhenOkIsLost(w, urls) {
  const calls = { care: [], setStewards: [] };
  const outcome = removalOutcome(w, urls);
  const steward = {
    pubkey: CHURCH, actingChurch: '', joinPolicyFresh: () => false, listIsFresh: () => true,
    // what publish() really answers when no relay acknowledged: false. The relay may or may not have applied it.
    setStewards: (l) => { calls.setStewards.push(l); return Promise.resolve(false); },
    stewardRemovalOutcome: outcome,
    rotateCareKey: (m, s) => { calls.care.push({ m, s }); return Promise.resolve(true); },
    rotateMediaKey: () => Promise.resolve(true), ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }),
    publishGroupKey: () => Promise.resolve({}), publishGroup: () => Promise.resolve(true),
    hasPinLock: () => false, verifyPin: () => Promise.resolve(true),
    stewardCaps: () => ({ [STEW]: ['care'], [OTHER]: ['content'] }), stewardCapNames: () => ['care', 'content'],
    stewardLabels: () => ({ [STEW]: 'Tom Ridley' }), stewardName: () => '', stewardSince: () => ({}),
    stewardCodeToPub: () => null, stewardInvitePayload: () => 'x', qrSVG: () => '',
  };
  const globals = { ...common(), StewQRScanner: () => null, window: { Steward: steward, Capacitor: null,
    usePendingStewards: () => [], useStewardMembers: () => [{ pubkey: M1, name: 'Ann', joined: 1690000000 }], useStewardStewards: () => [STEW, OTHER],
    useStewardGroups: () => [], useStewardBlocked: () => [], addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true } };
  const { C, draw } = await compiled('DashStewardsPanel', globals, ['rotateChurchKeys']);
  let tree = draw(C, { church: { name: 'St Aidan' } });
  await find(tree, n => n && n.type === 'button' && n.props.title === 'Revoke this steward')[0].props.onClick();
  tree = draw(C, { church: { name: 'St Aidan' } });
  await press(tree, /Confirm — revoke this steward/);
  tree = draw(C, { church: { name: 'St Aidan' } });
  return { calls, said: reads(tree) };
}
test('SCREEN: OK lost but the relay applied it -> no false failure, and the church IS re-keyed', async () => {
  const r = await revokeWhenOkIsLost(world({ A: [roster([OTHER], 200)], B: [roster([OTHER], 200)] }), ['A', 'B']);
  assert.doesNotMatch(r.said, /Couldn’t/, 'the console reports a failure for a removal the relays hold: ' + r.said.slice(0, 300));
  assert.match(r.said, /Tom Ridley is no longer a steward/);
  assert.equal(r.calls.care.length, 1, 'the removal landed, so keys must be rotated');
});
test('SCREEN: OK lost and every relay still lists them -> says so, rotates nothing', async () => {
  const r = await revokeWhenOkIsLost(world({ A: [roster([STEW, OTHER], 100)], B: [roster([STEW, OTHER], 100)] }), ['A', 'B']);
  assert.match(r.said, /Couldn’t remove Tom Ridley — every relay still lists them as a steward, and nothing was re-keyed/);
  assert.equal(r.calls.care.length, 0);
});
test('SCREEN: OK lost and a relay is silent -> says it cannot tell, rotates nothing, does not claim either way', async () => {
  const r = await revokeWhenOkIsLost(world({ A: [roster([STEW, OTHER], 100)], B: [] }), ['A', 'B']);
  assert.match(r.said, /Couldn’t confirm that Tom Ridley was removed — the relay didn’t answer, and nothing was re-keyed/);
  assert.doesNotMatch(r.said, /STILL a steward|still lists/);
  assert.equal(r.calls.care.length, 0);
});

// ── DEFECT 2 ─────────────────────────────────────────────────────────────────────────────────────────────
function ensure(w, { writeResult = false, onWrite = null, careRoster = [STEW] } = {}) {
  const blocked = [], writes = [];
  const window = { Steward: { setJoinPolicy: async (a, opts) => { writes.push({ a, opts }); if (onWrite) onWrite(); return writeResult; } },
    dispatchEvent: (e) => { blocked.push(e); } };
  const scope = { sk: new Uint8Array(32), pub: CHURCH, JOINPOLICY_D: JP, pool: w.pool, relays: () => ['A'], _authFuture: () => false,
    _careRoster: new Set(careRoster), window, CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; }, setTimeout, Promise, JSON };
  const names = Object.keys(scope);
  const api = new Function(...names, `return ({ ${method('async ensureJoinPolicy()')} });`)(...names.map(k => scope[k]));
  return { api, blocked, writes };
}
test('refused, but the church copy already says approval is ON -> no alarm', async () => {
  const w = world({ A: [] });
  const t = ensure(w, { onWrite: () => w.relayEvents.A.push(policy(true, 500)) });
  const r = await t.api.ensureJoinPolicy();
  assert.equal(r.ok, true); assert.equal(r.already, true);
  assert.equal(t.blocked.length, 0, 'a false alarm: approval is on at the relay');
});
test('refused, and a ROSTERED steward\'s tagged copy says ON -> no alarm', async () => {
  const w = world({ A: [] });
  const t = ensure(w, { onWrite: () => w.relayEvents.A.push(policy(true, 500, STEW, true)) });
  assert.equal((await t.api.ensureJoinPolicy()).ok, true);
  assert.equal(t.blocked.length, 0);
});
test('refused and the relay holds NOTHING -> the alarm stays, unchanged', async () => {
  const t = ensure(world({ A: [] }));
  const r = await t.api.ensureJoinPolicy();
  assert.equal(r.ok, false); assert.equal(r.reason, 'refused');
  assert.equal(t.blocked.length, 1);
  assert.match(t.blocked[0].detail.message, /A relay refused “people must be approved before they can join”, so anyone with your join link can join straight in\./);
});
test('refused, and the only "ON" copy is from a key that does not count -> alarm stays', async () => {
  const w = world({ A: [] });
  const t = ensure(w, { onWrite: () => w.relayEvents.A.push(policy(true, 500, STRANGER, true)) });
  assert.equal((await t.api.ensureJoinPolicy()).ok, false);
  assert.equal(t.blocked.length, 1, 'a copy from a key nobody honours silenced the alarm');
});
test('refused, an older counting copy says ON but the NEWEST counting copy says OFF -> alarm stays', async () => {
  const w = world({ A: [] });
  const t = ensure(w, { onWrite: () => w.relayEvents.A.push(policy(true, 400), policy(false, 500, STEW, true)) });
  assert.equal((await t.api.ensureJoinPolicy()).ok, false);
  assert.equal(t.blocked.length, 1, 'newest-wins was judged from the wrong copy: the church is open and nobody was told');
});
test('the background write is quiet: ensureJoinPolicy asks for background, and setJoinPolicy forwards it to publish', async () => {
  const t = ensure(world({ A: [] }));
  await t.api.ensureJoinPolicy();
  assert.deepEqual(t.writes[0].opts, { background: true });
  const seen = [];
  const names = ['publish', 'feChurch', 'sk', 'pub', 'JOINPOLICY_D', 'now', 'NET', '_monotonic'];
  const vals = [(e, o) => { seen.push(o); return Promise.resolve(e); }, (t0) => t0, new Uint8Array(32), CHURCH, JP, () => 1, 'trinityone', (x) => x];
  const api = new Function(...names, `return ({ ${method('setJoinPolicy(approval, opts)')} });`)(...vals);
  await api.setJoinPolicy(true, { background: true });
  await api.setJoinPolicy(true);
  assert.deepEqual(seen, [{ background: true }, undefined], 'setJoinPolicy did not forward its options to publish');
});
