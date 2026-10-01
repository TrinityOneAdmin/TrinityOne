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
import { K, sleep, consoleBoot, decryptNotice, STEWARD } from './family-harness.mjs';

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
  // closed pairs: C3 declined/removed for P; C1 closed once but linked again now; C2's pair is ANOTHER parent's;
  // and C4's pair is another parent's for a child P is NOT linked to — so only the parent check can exclude it
  // (audit of b4ac50d, C3x: without C4 nothing caught that check being removed)
  const C4 = K().pub;
  const CLOSED = { [C3 + '|' + P.pub]: 1, [C1 + '|' + P.pub]: 1, [C2 + '|' + Q.pub]: 1, [C4 + '|' + Q.pub]: 1 };
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

// ── how a guardian notice is published (audit of b4ac50d, items 4 and 5) ────────────────────────────────────────
// A pool in nostr-tools' own shape: an unreachable relay RESOLVES "connection failure: …"; a refusal REJECTS.
function shapedPool(state) {
  const calls = [];
  return {
    calls,
    subscribeMany() { return { close() {} }; },
    publish(urls, evt) {
      return urls.map(u => { calls.push({ url: u, id: evt.id });
        if (state.refuse) return Promise.reject(new Error(state.refuse));
        if (!state.up.has(u)) return Promise.resolve('connection failure: ' + u + ' unreachable');
        return Promise.resolve(''); });
    },
  };
}
test('a retry sends the parent’s LATEST notice — never an older one the relay would then keep', async () => {
  const state = { up: new Set(['wss://a']) };
  const pool = shapedPool(state);
  const con = consoleBoot(church, { relays: ['wss://a', 'wss://r'], pool, retryMs: [40, 80, 160] });
  const first = await con.api.notifyGuardian(P.pub, C1, 'Cleo', { [C1]: [P.pub] }, {});
  const second = await con.api.notifyGuardian(P.pub, C2, 'Cy', { [C1]: [P.pub], [C2]: [P.pub] }, {});
  assert.ok(first && second && first.id !== second.id, 'fixture: two notices for one parent');
  state.up.add('wss://r');   // relay R comes back
  await sleep(400);
  const toR = pool.calls.filter(c => c.url === 'wss://r');
  const afterSecond = toR.slice(toR.findIndex(c => c.id === second.id));
  assert.ok(afterSecond.length > 1, 'fixture: nothing was retried to the relay that was down');
  assert.deepEqual([...new Set(afterSecond.map(c => c.id))], [second.id],
    'A RETRY SENT AN OLDER NOTICE after a newer one for the same parent — a relay up briefly keeps the older one');
});
test('an unreachable relay ("connection failure", resolved) counts as missed and is retried', async () => {
  const state = { up: new Set(['wss://a']) };
  const pool = shapedPool(state);
  const con = consoleBoot(church, { relays: ['wss://a', 'wss://r'], pool, retryMs: [40, 80, 160] });
  const evt = await con.api.notifyGuardian(P.pub, C1, 'Cleo', { [C1]: [P.pub] }, {});
  assert.ok(evt, 'the notice was reported refused though one relay took it');
  await sleep(300);
  assert.ok(pool.calls.filter(c => c.url === 'wss://r').length > 1,
    'A RELAY THAT ANSWERED "connection failure" WAS COUNTED AS HOLDING THE NOTICE and never retried');
});
test('when every relay refuses a notice, the console is told the relay’s own words — and says the right thing', async () => {
  const state = { up: new Set(['wss://a', 'wss://b']), refuse: 'blocked: not a member of this church' };
  const con = consoleBoot(church, { relays: ['wss://a', 'wss://b'], pool: shapedPool(state), retryMs: [5000] });
  const r = await con.api.notifyGuardian(P.pub, C1, 'Cleo', { [C1]: [P.pub] }, {});
  assert.equal(r, false, 'a notice every relay refused was reported sent');
  const err = con.events.find(e => e.type === 'steward-publish-error');
  assert.ok(err, 'no publish error was raised');
  assert.match(String(err.detail.reason), /not a member/, 'THE REFUSAL WAS REPLACED BY A FIXED STRING: ' + JSON.stringify(err.detail.reason));
  // …and the console's banner (the SHIPPED publishErrorMessage) reads it as the relay-rejection it is
  const pem = new Function('window', fnBody(DASH, 'function publishErrorMessage(reason, evt, opts) {', 'publishErrorMessage') + '\nreturn publishErrorMessage;')({ Steward: {} });
  const msg = pem(err.detail.reason, err.detail.evt, {});
  assert.equal(msg.wrongChurch, true, 'the banner said "check the connection" for a relay that refused this church: ' + msg.msg);
});


// ── WHOLE-BRANCH AUDIT, 2026-10-01 ────────────────────────────────────────────────────────────────────────────
// Item 3: two churches on one console both send a notice to the same parent (the same d-tag). The latest-notice
// memory was keyed by d-tag alone, so church A's retry sent church B's notice and A's never reached the relay.
test('two churches, one parent, a relay down: each church’s retry sends ITS OWN latest notice', async () => {
  const other = K();
  const state = { up: new Set(['wss://a']) };
  const pool = shapedPool(state);
  const con = consoleBoot(church, { relays: ['wss://a', 'wss://r'], pool, retryMs: [40, 80, 160] });
  const fromA = await con.api.notifyGuardian(P.pub, C1, 'Cleo', { [C1]: [P.pub] }, {});
  con.become(other, ['wss://a', 'wss://r']);   // the console switches church; B also notifies P
  const fromB = await con.api.notifyGuardian(P.pub, C2, 'Cy', { [C2]: [P.pub] }, {});
  assert.ok(fromA && fromB && fromA.pubkey === church.pub && fromB.pubkey === other.pub, 'fixture: one notice from each church');
  state.up.add('wss://r');
  await sleep(400);
  const toR = new Set(pool.calls.filter(c => c.url === 'wss://r').slice(2).map(c => c.id));   // after each first attempt
  assert.ok(toR.has(fromA.id), 'CHURCH A’S NOTICE NEVER REACHED THE RELAY THAT WAS DOWN — A’s retry sent church B’s instead');
  assert.ok(toR.has(fromB.id), 'church B’s notice never reached the relay that was down');
});

// …and both per-church resets forget the pending notices — run as shipped, every name they touch stubbed.
function runReset(src, name, call) {
  const latest = new Map([['x|trinityone/guardnotice:y', { id: 'e' }]]);
  const any = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : any), apply: () => undefined, construct: () => any });
  const scope = new Proxy({ _latestGuardNotice: latest, Object, Set, Map, JSON, String, Array, Math, Date, churchPub: 'cp', churchSk: 'sk' }, {
    has: () => true,
    get: (t, k) => (k === Symbol.unscopables ? undefined : (k in t ? t[k] : any)),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  new Function('scope', 'with (scope) { ' + src + '\n' + call + ' }')(scope);
  return latest.size;
}
test('both per-church resets forget the pending guardian notices', () => {
  const reset = fnBody(STEWARD, '  function _resetChurchScopedState() {', '_resetChurchScopedState');
  assert.equal(runReset(reset, '_resetChurchScopedState', '_resetChurchScopedState();'), 0,
    '_resetChurchScopedState left another church’s pending guardian notice in place');
  const sai = fnBody(STEWARD, '    setActiveIdentity(targetPub) {', 'setActiveIdentity');
  assert.equal(runReset('const o = { ' + sai + ' };', 'setActiveIdentity', "o.setActiveIdentity('cp');"), 0,
    'setActiveIdentity left the previous church’s pending guardian notice in place');
});

// Item 4: a church switch during the await before a notice. The notice goes out AS THE CHURCH CAPTURED BEFORE
// THE AWAIT — signed with its key, naming it, to its relays — never as whatever is active afterwards.
test('a notice sent with a scope captured before a church switch goes out as that church, to its relays', async () => {
  const other = K();
  const state = { up: new Set(['wss://a', 'wss://b']) };
  const pool = shapedPool(state);
  const con = consoleBoot(church, { relays: ['wss://a'], pool, retryMs: [5000] });
  const scope = con.api.guardNoticeScope();
  assert.ok(scope && !('sk' in scope), 'the scope handle exposes the key to the page');
  con.become(other, ['wss://b']);              // the switch, during the steward's await
  const evt = await con.api.notifyGuardian(P.pub, C1, 'Cleo', { [C1]: [P.pub] }, {}, scope);
  assert.ok(evt, 'the scoped notice was not sent');
  assert.equal(evt.pubkey, church.pub, 'A CHURCH-A NOTICE WAS SIGNED WITH CHURCH B’S KEY after a switch');
  assert.equal(decryptNotice(P, evt).church, church.pub, 'the scoped notice names the church switched to');
  assert.deepEqual(pool.calls.filter(c => c.id === evt.id).map(c => c.url), ['wss://a'], 'the scoped notice went to the other church’s relays');
});
test('every console path captures the church BEFORE its first await and hands that scope to the notice', async () => {
  for (const [anchor, name, call, scopeExtra] of [
    ['const linkParent = async (childPub, parentPub) => {', 'linkParent', (fn) => fn(C1, P.pub), {}],
    ['const unlinkParent = async (childPub, parentPub) => {', 'unlinkParent', (fn) => fn(C1, P.pub), {}],
    ['const approveGuardian = async (r) => {', 'approveGuardian', (fn) => fn({ child: C1, parent: P.pub }), {}],
    ['const declineGuardian = async (r) => {', 'declineGuardian', (fn) => fn({ child: C1, parent: P.pub }), {}],
    ['const toggleMinor = async (pk) => {', 'toggleMinor', (fn) => fn(P.pub), { approvedSet: new Set(), nophotoSet: new Set(), kidPhotosAllowed: true, parentSet: new Set([P.pub]), ckClearedSet: new Set(), CustomEvent: class {} }],
  ]) {
    const { calls, Steward } = recorder();
    let active = 'A';
    Steward.guardNoticeScope = () => Object.freeze({ church: active });
    const save = Steward.setGuardians;
    Steward.setGuardians = async (...a) => { active = 'B'; await sleep(5); return save(...a); };   // switched mid-await
    Steward.setMinors = async () => { active = 'B'; return true; };
    const fn = run(anchor, name, baseScope({ [C1]: [P.pub] }, Steward, scopeExtra));
    await call(fn);
    const sent = [...calls.linked, ...calls.removed, ...calls.listed];
    assert.equal(sent.length, 1, name + ': expected exactly one notice');
    const scope = sent[0][sent[0].length - 1];
    assert.ok(scope && scope.church === 'A', name + ': THE NOTICE WAS NOT GIVEN THE CHURCH CAPTURED BEFORE THE AWAIT: ' + JSON.stringify(scope));
  }
});

// Item 5a: every relay already holding a NEWER notice for this parent is not "your change wasn't saved".
test('a notice every relay answers with "a newer version is already stored" raises no error banner', async () => {
  const state = { up: new Set(['wss://a', 'wss://b']), refuse: 'invalid: a newer version of this is already stored — reload and edit again' };
  const con = consoleBoot(church, { relays: ['wss://a', 'wss://b'], pool: shapedPool(state), retryMs: [5000] });
  await con.api.notifyGuardian(P.pub, C1, 'Cleo', { [C1]: [P.pub] }, {});
  assert.equal(con.events.filter(e => e.type === 'steward-publish-error').length, 0,
    'A NEWER NOTICE ALREADY STORED RAISED "YOUR CHANGE WASN’T SAVED" — the guardian link itself was saved');
});
