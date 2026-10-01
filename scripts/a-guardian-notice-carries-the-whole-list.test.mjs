// EVERY GUARDIAN NOTICE THE CONSOLE SENDS CARRIES THE PARENT'S WHOLE LIST — COMPUTED AFTER THE CHANGE.
// Run: node --test scripts/a-guardian-notice-carries-the-whole-list.test.mjs
//
// Owner, 2026-10-01 (reference/DOMAIN.md): "every guardian notice from the church carries the parent's COMPLETE
// current list of linked children for that church (sealed), so the newest notice is the whole truth." The notice
// is one replaceable slot per parent, so a notice that named only its own child was overwritten by the next one
// and the parent's phone lost every earlier link — which is what drove the phone to re-publish its own requests,
// leaking which accounts are children. The legacy fields stay exactly as they were (add, never repurpose), so an
// older parent's app keeps working.
//
// What is driven here, all of it shipped:
//   · the console's notice functions, lifted from vendor/steward.js (scripts/family-harness.mjs), the sealed
//     content decrypted as the parent's phone decrypts it;
//   · every console path that changes the guardians map — linkParent, unlinkParent, approveGuardian and
//     toggleMinor sliced out of app/stew-dashboard.jsx and RUN with window.Steward as a recorder, and
//     reseatMember lifted from vendor/steward.js — each asserted to hand the notice the map AFTER its change.
// Decline does not change the map and sends no notice (unchanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { K, consoleBoot, decryptNotice, STEWARD } from './family-harness.mjs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const church = K(), P = K(), Q = K();
const C1 = K().pub, C2 = K().pub, C3 = K().pub;

// ── the notice functions ────────────────────────────────────────────────────────────────────────────────────
const sealed = async (fn) => {
  const con = consoleBoot(church, { relays: [] });   // no relay: publish returns false, the signed notice is recorded
  await fn(con.api);
  assert.equal(con.published.length, 1, 'expected exactly one notice');
  const e = con.published[0];
  assert.equal(e.tags.find(t => t[0] === 'd')[1], 'trinityone/guardnotice:' + P.pub, 're-anchor: the notice slot moved');
  return decryptNotice(P, e);
};
const MAP = { [C1]: [P.pub], [C2]: [Q.pub, P.pub], [C3]: [Q.pub] };

test('a link notice carries the child, its name, the church — and the parent’s whole list and closed requests', async () => {
  // closed pairs: C3 declined/removed for P; C1 closed once but linked again now; C2's pair is ANOTHER parent's
  const CLOSED = { [C3 + '|' + P.pub]: 1, [C1 + '|' + P.pub]: 1, [C2 + '|' + Q.pub]: 1 };
  const d = await sealed(api => api.notifyGuardian(P.pub, C1, 'Cleo', MAP, CLOSED));
  assert.equal(d.child, C1); assert.equal(d.name, 'Cleo'); assert.equal(d.church, church.pub);
  assert.deepEqual(d.children, [C1, C2].sort(), 'the notice does not carry the parent’s whole list (or carries another parent’s child)');
  assert.deepEqual(d.closed, [C3],
    'the notice does not name exactly this parent’s closed requests (minus any child linked now) — the phone keeps showing "Waiting"');
});

test('without a map a link notice is exactly the legacy shape — nothing repurposed', async () => {
  const d = await sealed(api => api.notifyGuardian(P.pub, C1, 'Cleo'));
  assert.deepEqual(Object.keys(d).sort(), ['child', 'church', 'name']);
});

test('a removal notice keeps `removed`, adds the whole list, and names every child taken at once in removedAll', async () => {
  const one = await sealed(api => api.notifyGuardianRemoved(P.pub, C1, { [C2]: [P.pub] }));
  assert.equal(one.removed, C1); assert.equal(one.church, church.pub);
  assert.deepEqual(one.children, [C2], 'the removal does not carry what the parent is still linked to');
  assert.equal(one.removedAll, undefined, 'a single removal grew a removedAll');
  const many = await sealed(api => api.notifyGuardianRemoved(P.pub, C1, {}, [C1, C2]));
  assert.equal(many.removed, C1, 'the builds that read only `removed` lost the first child');
  assert.deepEqual(many.removedAll, [C1, C2], 'the builds before 4f08ca4 read removedAll — it must name every child');
  assert.deepEqual(many.children, [], 'a parent unlinked from everything was not told their list is empty');
});

test('a list-only notice carries nothing an older phone would act on, and the whole list', async () => {
  const d = await sealed(api => api.notifyGuardianList(P.pub, MAP));
  assert.equal(d.child, undefined); assert.equal(d.removed, undefined);
  assert.deepEqual(d.children, [C1, C2].sort());
});

// ── every console path that changes the map hands the notice the map AFTER the change ─────────────────────────
function recorder() {
  const calls = { guardians: [], linked: [], removed: [], listed: [] };
  const Steward = {
    setGuardians: async (m) => { calls.guardians.push(m); return true; },
    setMinors: async () => true, setNoPhoto: async () => true, revokeCheckinPermission: async () => true,
    notifyGuardian: (...a) => { calls.linked.push(a); },
    notifyGuardianRemoved: (...a) => { calls.removed.push(a); },
    notifyGuardianList: (...a) => { calls.listed.push(a); },
  };
  return { calls, Steward };
}
// A name the closure needs and this file does not supply is a ReferenceError, never a silent undefined.
function run(anchor, what, scope) {
  const body = fnBody(DASH, anchor, what);
  const P_ = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError(what + ' needs ' + String(k)); },
  });
  return new Function('scope', 'with (scope) { ' + body + '\nreturn ' + what + '; }')(P_);
}
const baseScope = (guardians, Steward, extra = {}) => ({
  window: { Steward }, guardians, guardiansClosed: {}, sg: { minors: [], approved: [] },
  minorsSet: new Set(), setMinorNotice: () => {}, _reseal: () => {}, nameByPub: { [C1]: 'Cleo' }, Promise, Math, Date, Set, Object, Array,
  ...extra,
});

test('linkParent: the link notice carries the map it just wrote, and the closed pairs', async () => {
  const { calls, Steward } = recorder();
  const scope = baseScope({ [C2]: [P.pub] }, Steward, { guardiansClosed: { [C3 + '|' + P.pub]: 5 } });
  const fn = run('const linkParent = async (childPub, parentPub) => {', 'linkParent', scope);
  await fn(C1, P.pub);
  assert.equal(calls.linked.length, 1, 'linking sent no notice');
  assert.deepEqual(calls.linked[0][3], calls.guardians[0], 'THE LINK NOTICE WAS NOT GIVEN THE MAP AFTER THE CHANGE');
  assert.deepEqual(calls.linked[0][3][C1], [P.pub]);
  assert.deepEqual(calls.linked[0][4], { [C3 + '|' + P.pub]: 5 }, 'the link notice was not given the church’s closed pairs');
});

test('unlinkParent: the removal notice carries the map it just wrote', async () => {
  const { calls, Steward } = recorder();
  const fn = run('const unlinkParent = async (childPub, parentPub) => {', 'unlinkParent', baseScope({ [C1]: [P.pub, Q.pub], [C2]: [P.pub] }, Steward));
  await fn(C1, P.pub);
  assert.equal(calls.removed.length, 1, 'unlinking sent no notice');
  assert.deepEqual(calls.removed[0][2], calls.guardians[0], 'THE REMOVAL NOTICE WAS NOT GIVEN THE MAP AFTER THE CHANGE');
  assert.deepEqual(calls.removed[0][2][C1], [Q.pub], 'the map handed over still links the removed parent');
  assert.ok((calls.removed[0][4] || {})[C1 + '|' + P.pub], 'the removal notice was not given the closed pairs it just wrote');
});

test('declineGuardian: declining a request sends the parent their list with that request closed', async () => {
  const { calls, Steward } = recorder();
  const fn = run('const declineGuardian = async (r) => {', 'declineGuardian', baseScope({ [C2]: [P.pub] }, Steward));
  await fn({ child: C1, parent: P.pub });
  assert.equal(calls.listed.length, 1, 'DECLINING TOLD THE PARENT’S PHONE NOTHING — it reads "Waiting for steward to confirm" for ever');
  assert.equal(calls.listed[0][0], P.pub);
  assert.deepEqual(calls.listed[0][1], { [C2]: [P.pub] }, 'the list notice was not given the (unchanged) map');
  assert.ok((calls.listed[0][2] || {})[C1 + '|' + P.pub], 'the list notice was not given the closed pair just written');
});

test('approveGuardian: confirming a parent’s own request sends them their whole list', async () => {
  const { calls, Steward } = recorder();
  const fn = run('const approveGuardian = async (r) => {', 'approveGuardian', baseScope({}, Steward));
  await fn({ child: C1, parent: P.pub });
  assert.equal(calls.listed.length, 1, 'CONFIRMING A REQUEST TOLD THE PARENT’S PHONE NOTHING — the child reads "waiting" for ever');
  assert.equal(calls.listed[0][0], P.pub);
  assert.deepEqual(calls.listed[0][1], calls.guardians[0], 'the list notice was not given the map after the change');
});

test('toggleMinor: marking a parent as a child sends ONE notice naming every child, with the map after', async () => {
  const { calls, Steward } = recorder();
  const guardians = { [C1]: [P.pub], [C2]: [P.pub, Q.pub], [C3]: [Q.pub] };
  const fn = run('const toggleMinor = async (pk) => {', 'toggleMinor', baseScope(guardians, Steward, {
    approvedSet: new Set(), nophotoSet: new Set(), kidPhotosAllowed: true, parentSet: new Set([P.pub, Q.pub]),
    ckClearedSet: new Set(), CustomEvent: class {},
  }));
  await fn(P.pub);
  assert.equal(calls.removed.length, 1,
    'MARKING A PARENT AS A CHILD SENT ' + calls.removed.length + ' NOTICES — the slot is one per parent, so only the last survived');
  const [parent, first, map, all] = calls.removed[0];
  assert.equal(parent, P.pub);
  assert.deepEqual([...all].sort(), [C1, C2].sort(), 'the notice does not name every child they were unlinked from');
  assert.ok([C1, C2].includes(first));
  assert.deepEqual(map, calls.guardians[0], 'the notice was not given the map after the change');
  const closed = calls.removed[0][4] || {};
  assert.ok(closed[C1 + '|' + P.pub] && closed[C2 + '|' + P.pub], 'the notice was not given the closed pairs just written');
});

// ── reseatMember (vendor/steward.js) ─────────────────────────────────────────────────────────────────────────
const RESEAT = fnBody(STEWARD, '    async reseatMember(oldPub, newPub, o) {', 'reseatMember');
async function reseat(o, oldPub, newPub) {
  const listed = [];
  const Steward = new Proxy({}, { get: (t, k) => k in t ? t[k] : (async () => true) });
  Steward.notifyGuardianList = (...a) => { listed.push(a); return Promise.resolve(true); };
  let saved = null;
  Steward.setGuardians = async (links) => { saved = links; return true; };
  const engine = new Function('toPubHex', 'now', 'window', `return { ${RESEAT} };`)((p) => p, () => 1000, { Steward });
  await engine.reseatMember(oldPub, newPub, o);
  return { listed, saved };
}
test('reseatMember: a parent reconnected on a new key gets their whole list on it', async () => {
  const NEWP = K().pub;
  const r = await reseat({ guardians: { [C1]: [P.pub] }, minors: [C1] }, P.pub, NEWP);
  assert.ok(r.saved, 'CONTROL: the reconnect rewrote the guardians map');
  assert.deepEqual(r.listed.map(a => a[0]), [NEWP], 'the reconnected parent’s new key was not sent a list');
  assert.deepEqual(r.listed[0][1], r.saved, 'the list was not computed from the map just written');
  assert.ok(r.listed[0][2] && typeof r.listed[0][2] === 'object', 'the list notice was not given the closed pairs');
});
test('reseatMember: a child reconnected on a new key — every parent of theirs gets the new list', async () => {
  const NEWC = K().pub;
  const r = await reseat({ guardians: { [C1]: [P.pub, Q.pub] }, minors: [C1] }, C1, NEWC);
  assert.deepEqual(r.listed.map(a => a[0]).sort(), [P.pub, Q.pub].sort(), 'a parent of the reconnected child was not told');
});
