// A CHILD IS NEVER ON THE CARE TEAM — WHATEVER THE ROSTER SAYS.
//   Run: node --test scripts/a-child-on-the-care-roster-gets-no-care-access.test.mjs
//
// Owner, 2026-10-10 (reference/DOMAIN.md): "A child is never on the care team (consistent with 'children do not
// volunteer for care', 2026-10-02): the relay must not grant care-team access to someone marked as a child,
// whatever the roster says."
//
// MEASURED BEFORE THIS (system audit 2026-10-10): careAdmin() in scripts/gateway.mjs asked only "is this person
// on the care team's roster?" — never "is this person a child here?" — so a child put on that roster (the
// generic member picker offers children, rightly, for teams like a youth band) was served adults' asks for
// help, the church's children list and parent links, and other members' clearances.
//
// TWO PARTS, each at the point the person meets it:
//   1. the RELAY, black-box on a real gateway: the same roster holds a child and an adult; the child is refused,
//      the adult (control) is served;
//   2. the CONSOLE, shipped code out of vendor/steward.js + vendor/steward-meals.js against that same relay: the
//      children list is READ FROM THE RELAY (readMinors), the care list written to the relay leaves the child off
//      (publishCareTeam), a child marked later is taken off it (refreshCareTeam), nothing is published while the
//      children list cannot be read, and a care reply is never sealed to a child carer (sendCareChat).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import * as nip44m from 'nostr-tools/nip44';
const nip44v2 = nip44m.v2;
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const MEALS = readFileSync(join(ROOT, 'vendor/steward-meals.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _t = Math.floor(Date.now() / 1000) - 300; const now = () => ++_t;
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });

// ── the cast ──────────────────────────────────────────────────────────────────────────────────────────────
const church = K();
const CH = K();     // a CHILD (in minors:) who has been put on the care-team roster
const AD = K();     // an ADULT on the same roster — the control
const M = K();      // an adult member who asks for help
const KID2 = K(), PARENT = K();
const cp = church.pub;
const TEAM = cp.slice(0, 16) + '-careteam1';
const rid = (who, tail) => who.pub.slice(0, 16) + '-' + tail;
const D = {
  req: 'trinityone/carereq:' + rid(M, 'r1'),
  minors: 'trinityone/minors:' + cp, guardians: 'trinityone/guardians:' + cp,
  clearance: 'trinityone/clearance:' + M.pub,
};

let PORT, WS_URL, relay, dataDir, pub;
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const ev = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content }, who.sk);
async function authed(who) {
  const ws = await connect();
  await new Promise((resolve) => {
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
      if (m[0] === 'OK' && m[2] === true) { ws.off('message', on); resolve(); } };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', 'kick', { kinds: [4], '#p': [who.pub], limit: 1 }]));
    setTimeout(resolve, 1500);
  });
  return ws;
}
function query(ws, filters, window = 900) {
  return new Promise((resolve) => {
    const id = 'q' + Math.random().toString(36).slice(2, 7); const evs = [];
    const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) evs.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) done(); };
    let fin = false;
    const done = () => { if (fin) return; fin = true; ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', id])); } catch {} resolve(evs); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', id, ...(Array.isArray(filters) ? filters : [filters])]));
    setTimeout(done, window);
  });
}
const readAs = async (who, filters) => { const ws = await authed(who); try { return await query(ws, filters); } finally { ws.close(); } };
const dOf = e => (e.tags.find(t => t[0] === 'd') || [])[1];
const ALL = { kinds: [30078], '#d': [D.req, D.minors, D.guardians, D.clearance] };

before(async () => {
  PORT = await freePort(); WS_URL = `ws://127.0.0.1:${PORT}/relay`;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-childcare-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(150)) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} }
  pub = await connect();
  const ok = async (evt, what) => { const [o, why] = await publish(pub, evt); assert.equal(o, true, what + ' — ' + why); };
  for (const w of [CH, AD, M, KID2, PARENT]) await ok(ev(w, 'trinityone/member:' + cp, JSON.stringify({ joined: now() })), 'member joined');
  await sleep(150);
  // the care team's roster, written by the CHURCH, naming both the child and the adult
  await ok(ev(church, 'trinityone/roster:' + TEAM, JSON.stringify({ pubs: [CH.pub, AD.pub], e: 'sealed-names' }), [['church', cp]]), 'care roster');
  await ok(ev(church, 'trinityone/meals-settings', JSON.stringify({ enabled: true, visibility: 'all', openedBy: 'steward', adminGroupId: TEAM })), 'meals settings');
  await ok(ev(church, D.minors, JSON.stringify({ pubkeys: [CH.pub, KID2.pub] })), 'minors');
  await ok(ev(church, D.guardians, JSON.stringify({ links: { [KID2.pub]: [PARENT.pub] } })), 'guardians');
  await ok(ev(church, D.clearance, 'SEALED-TO-M', [['church', cp], ['p', M.pub]]), 'M’s clearance');
  await sleep(150);
  await ok(ev(M, D.req, 'CIPHER-r1', [['church', cp]]), 'an adult asks for help');
  await sleep(200);
});
after(() => { try { pub && pub.close(); } catch {} try { churchWs && churchWs.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── 1. THE RELAY ──────────────────────────────────────────────────────────────────────────────────────────
test('control: the ADULT on the care roster is served the ask for help, the children list, parent links and a clearance', async () => {
  const got = (await readAs(AD, ALL)).map(dOf).sort();
  assert.deepEqual(got, [D.req, D.minors, D.guardians, D.clearance].sort(),
    'the adult care-team member lost a care grant — the setup proves nothing, or the fix narrowed too far');
});

test('a CHILD on the same care roster is refused an adult’s ask for help', async () => {
  const got = await readAs(CH, { kinds: [30078], '#d': [D.req] });
  assert.deepEqual(got.map(dOf), [], 'the relay serves an adult’s ask for help to a child because the roster names them');
});

test('a CHILD on the care roster is refused the children list, the parent links and another member’s clearance', async () => {
  const got = await readAs(CH, { kinds: [30078], '#d': [D.minors, D.guardians, D.clearance] });
  assert.deepEqual(got.map(dOf), [], 'the relay serves safeguarding lists to a child on the care roster: ' + got.map(dOf).join(', '));
});

test('the child is refused by the CHURCH-TAG filter too (how the care screens actually ask)', async () => {
  const got = await readAs(CH, { kinds: [30078], '#church': [cp] });
  assert.ok(!got.some(e => dOf(e) === D.req || dOf(e) === D.clearance), 'a #church REQ hands the child the ask or a clearance');
});

// ── 2. THE CONSOLE: the care list and care replies, with the children list READ FROM THIS RELAY ─────────────
// Audit of 8fb38d9: the first version stubbed the children list (`minorsHere`), so deleting the line that
// actually fed it left every test green. These run the SHIPPED readMinors (vendor/steward.js) against the live
// gateway above, through a minimal pool that is genuinely NIP-42-authenticated as the church key, and hand its
// answer to the SHIPPED publishCareTeam / refreshCareTeam / sendCareChat (vendor/steward-meals.js), whose writes
// go to the same relay. What is supplied, not shipped: the pool (one socket per relay URL, plus the two things
// nostr-tools does on its own — the EOSE timer at maxWait or 4400 ms, and onclose+oneose for a relay it could not
// reach), relays(), the device storage, and _keyReadAuthedOn (true for a URL only if THAT socket's NIP-42 login
// really got the relay's OK). readMinors' rules (_keyReadOk, _keyReadConnected, the device copy) are lifted from
// the bundle with it.
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
let churchWs = null;
// entries(): url -> { ws, ok, down, delay }. down: nothing listens there (not in pool.relays, fails at once).
// delay: the relay's frames reach us that many ms late (a slow but alive relay).
const mainEntries = () => ({ [WS_URL]: { ws: churchWs, ok: true } });
function shimPool(entries = mainEntries) {
  return {
    get relays() { const m = new Map(); for (const [u, e] of Object.entries(entries())) if (!e.down) m.set(u, { connected: true }); return m; },
    subscribeMany(urls, filters, h) {
      const ent = entries()[urls[0]];
      if (ent.down) { setTimeout(() => { h.onclose && h.onclose(['relay connection failed']); h.oneose && h.oneose(); }, 20); return { close() {} }; }
      const ws = ent.ws;
      const id = 's' + Math.random().toString(36).slice(2, 9); let closed = false, eosed = false;
      const on = (d) => { const go = () => { if (closed) return; const m = JSON.parse(d); if (m[1] !== id) return;
        if (m[0] === 'EVENT' && h.onevent) h.onevent(m[2]);
        if (m[0] === 'EOSE' && !eosed) { eosed = true; h.oneose && h.oneose(); } };
        ent.delay ? setTimeout(go, ent.delay) : go(); };
      ws.on('message', on);
      ws.send(JSON.stringify(['REQ', id, ...filters]));
      // nostr-tools' own timer: oneose at maxWait if given, else baseEoseTimeout (4400 ms), whatever the relay did
      const t = setTimeout(() => { if (!closed && !eosed) { eosed = true; h.oneose && h.oneose(); } }, h.maxWait || 4400);
      return { close() { if (closed) return; closed = true; clearTimeout(t); ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', id])); } catch {} } };
    },
  };
}
// THE DEVICE COPY, lifted from the bundle: sealed with the console's own key (audit of c17a640). `store` is a Map
// standing in for localStorage; `sk` is the console's unlocked key (churchSk), null when locked.
const fakeLS = (store) => ({ getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } });
function deviceHelpers() {
  const lsVar = (/\n {2}var MINORS_LAST_LS = [^\n]*;/.exec(STEWARD) || [''])[0];
  assert.ok(lsVar, 're-anchor: MINORS_LAST_LS is not in the bundle');
  const get = fnBody(STEWARD, 'function _minorsLastGet(cp) {', '_minorsLastGet'), set = fnBody(STEWARD, 'function _minorsLastSet(cp, list) {', '_minorsLastSet');
  // esbuild's names for nostr-tools' nip44 encrypt/decrypt in this bundle — a wrong name throws inside a try and
  // reads as "no device copy", so assert them
  assert.ok(get.includes('decrypt3(') && set.includes('encrypt2('), 're-anchor: the device copy no longer seals with encrypt2/decrypt3');
  return [lsVar, get, set, fnBody(STEWARD, 'function _minorsLastClear(keep) {', '_minorsLastClear')].join('\n');
}
const DEVICE_NAMES = ['churchSk', 'encrypt2', 'decrypt3', 'localStorage', 'lsGet', 'lsSet'];
const deviceVals = (store, sk) => { const ls = fakeLS(store); return [sk, nip44v2.encrypt, nip44v2.decrypt, ls, (k) => ls.getItem(k), (k, v) => ls.setItem(k, v)]; };
function liftDevice({ store = new Map(), sk = church.sk } = {}) {
  return new Function(...DEVICE_NAMES, deviceHelpers() + '\nreturn { get: _minorsLastGet, set: _minorsLastSet, clear: _minorsLastClear };')(...deviceVals(store, sk));
}
function liftReadMinors({ entries = mainEntries, actingChurch = '', pubK = cp, churchPubK = cp, store = new Map(), sk = church.sk } = {}) {
  const body = fnBody(STEWARD, 'readMinors() {', 'Steward.readMinors');
  const helpers = [fnBody(STEWARD, 'function _keyReadOk(tok) {', '_keyReadOk'), fnBody(STEWARD, 'function _keyReadConnected(url) {', '_keyReadConnected'), deviceHelpers()];
  // esbuild named nostr-tools' normalizeURL `normalizeURL2` in this bundle; a wrong name is a ReferenceError that
  // readMinors' own try/catch would swallow, silently treating every relay as not connected
  assert.ok(body.includes('normalizeURL2('), 're-anchor: readMinors no longer calls normalizeURL2 in the bundle');
  return new Function('actingChurch', 'pub', 'churchPub', 'pool', 'relays', '_authFuture', 'MINORS_D', '_keyReadEpoch', '_keyReadAuthedOn', 'normalizeURL2', '_KEY_READ_LONG_WAIT', '_stillOn', ...DEVICE_NAMES,
    helpers.join('\n') + '\nreturn function ' + body + ';')(
    actingChurch, pubK, churchPubK, shimPool(entries), () => Object.keys(entries()), () => false, 'trinityone/minors:', 1, (u) => !!(entries()[u] || {}).ok,
    (u) => u, 15000, () => true, ...deviceVals(store, sk));
}
function liftMeals(name, sig, extra = {}) {
  const body = fnBody(MEALS, sig, name);
  const names = ['S', 'now', 'CARETEAM_D', 'CAREREQ_D', 'CARECHAT_D', 'NET', '_careTeamWait', 'setTimeout', 'clearTimeout', '_monotonicM', 'publishCareTeam', 'dropPendingCareTeam', ...Object.keys(extra)];
  return (vals) => new Function(...names, 'return ' + body + ';')(...names.map(n => vals[n]));
}
const S0 = (over = {}) => {
  const pool = shimPool();   // the main relay, over the church's logged-in socket
  return {
    churchPub: cp, blockedHere: () => [],
    readMinors: liftReadMinors(),
    subscribeMany: (filters, h) => pool.subscribeMany([WS_URL], filters, h),
    publishSigned: async (tmpl) => { const [ok, why] = await publish(pub, finalizeEvent(tmpl, church.sk)); assert.equal(ok, true, 'relay refused the console write: ' + why); return true; },
    ...over,
  };
};
const relayCareTeam = async () => { const ws = await authed(AD); try { const evs = await query(ws, { kinds: [30078], '#d': ['trinityone/careteam:' + cp] }); evs.sort((a, b) => b.created_at - a.created_at); return evs[0] ? JSON.parse(evs[0].content).pubs : null; } finally { ws.close(); } };
const fakeTimers = () => { const t = []; const f = (fn) => { t.push(fn); return t.length; }; f.pending = t; return f; };

test('setup: the console is logged in to this relay as the church key', async () => {
  churchWs = await authed(church);
  const got = await query(churchWs, { kinds: [30078], '#d': [D.minors] });
  assert.equal(got.length, 1, 'the church key cannot read its own children list on this relay — nothing below would mean anything');
});

test('readMinors (shipped) reads the children list from the relay, as known', async () => {
  const m = await liftReadMinors()();
  assert.equal(m.known, true, 'a logged-in read that got the document did not count as known');
  assert.deepEqual(m.list.slice().sort(), [CH.pub, KID2.pub].sort(), 'readMinors did not return the church’s children');
});

test('publishCareTeam (shipped) with the REAL children read writes the care list to the relay WITHOUT the child', async () => {
  const S = S0(); let pc;
  pc = liftMeals('publishCareTeam', 'async function publishCareTeam(memberPubs) {')({ S: () => S, now, CARETEAM_D: 'trinityone/careteam:', NET: 'trinityone', _careTeamWait: { pubs: null, tries: 0, timer: 0 }, setTimeout: fakeTimers(), get publishCareTeam() { return pc; } });
  const r = await pc([CH.pub, AD.pub]);
  assert.equal(r, true, 'publishCareTeam did not publish');
  const pubs = await relayCareTeam();
  assert.ok(pubs && pubs.includes(AD.pub) && pubs.includes(cp), 'CONTROL: the adult or the church key is missing from the relay’s care list');
  assert.ok(!pubs.includes(CH.pub), 'the care list on the relay names the child — members will seal asks for help to them');
});

test('publishCareTeam: if the children list cannot be read it publishes NOTHING, says false, and schedules a retry', async () => {
  // a REAL socket that never logged in: the relay withholds the owner-only children list and answers EOSE
  const anon = await connect();
  const S = S0({ readMinors: liftReadMinors({ entries: () => ({ [WS_URL]: { ws: anon, ok: false } }) }) });
  const before = await relayCareTeam();
  const timers = fakeTimers(); let pc;
  pc = liftMeals('publishCareTeam', 'async function publishCareTeam(memberPubs) {')({ S: () => S, now, CARETEAM_D: 'trinityone/careteam:', NET: 'trinityone', _careTeamWait: { pubs: null, tries: 0, timer: 0 }, setTimeout: timers, get publishCareTeam() { return pc; } });
  const r = await pc([CH.pub, AD.pub, M.pub]);
  assert.equal(r, false, 'a care list published (or claimed) while the children list was unknown');
  await sleep(300);
  assert.deepEqual(await relayCareTeam(), before, 'the care list on the relay changed while the children list was unknown');
  assert.equal(timers.pending.length, 1, 'no retry was scheduled — the adults’ care list would wait for the next roster edit');
  anon.close();
});

test('refreshCareTeam (shipped): a child marked AFTER joining the care list is taken off it', async () => {
  // the relay's care list names the child, as one written before they were marked would
  const [ok] = await publish(pub, ev(church, 'trinityone/careteam:' + cp, JSON.stringify({ pubs: [cp, CH.pub, AD.pub], updated: now() })));
  assert.equal(ok, true);
  await sleep(150);
  assert.ok((await relayCareTeam()).includes(CH.pub), 'setup: the care list should name the child here');
  const S = S0(); let pc;
  const vals = { S: () => S, now, CARETEAM_D: 'trinityone/careteam:', NET: 'trinityone', _careTeamWait: { pubs: null, tries: 0, timer: 0 }, setTimeout: fakeTimers(), get publishCareTeam() { return pc; } };
  pc = liftMeals('publishCareTeam', 'async function publishCareTeam(memberPubs) {')(vals);
  const refresh = liftMeals('refreshCareTeam', 'async function refreshCareTeam() {')(vals);
  await refresh();
  const pubs = await relayCareTeam();
  assert.ok(pubs.includes(AD.pub), 'CONTROL: the adult was taken off too');
  assert.ok(!pubs.includes(CH.pub), 'the child is still on the care list after the refresh');
});

test('sendCareChat (shipped): a reply is never sealed to a child on the care team, but a child ASKER keeps their own thread', async () => {
  const r2 = rid(M, 'r2'), k1 = rid(KID2, 'k1');
  const okP = async (evt) => { const [o, why] = await publish(pub, evt); assert.equal(o, true, why); };
  await okP(ev(M, 'trinityone/carereq:' + r2, JSON.stringify({ keys: { [cp]: 'w', [M.pub]: 'w', [CH.pub]: 'w', [AD.pub]: 'w' }, enc: 'x' }), [['church', cp], ['aud', 'team']]));
  await okP(ev(KID2, 'trinityone/carereq:' + k1, JSON.stringify({ keys: { [cp]: 'w', [KID2.pub]: 'w', [AD.pub]: 'w' }, enc: 'x' }), [['church', cp]]));
  await sleep(150);
  const sealedTo = [];
  const S = S0({ sealToPubs: (pubs) => { sealedTo.push(pubs.slice()); return { keys: {}, enc: 'x' }; }, publishSigned: async () => true });
  const _last = new Map();
  const send = liftMeals('sendCareChat', 'async function sendCareChat(reqId, requesterPub, text, opts) {')({ S: () => S, now, CARETEAM_D: 'trinityone/careteam:', CAREREQ_D: 'trinityone/carereq:', CARECHAT_D: 'trinityone/carechat:', NET: 'trinityone', setTimeout, _monotonicM: (d) => { const n = now(); _last.set(d, n); return n; } });
  await send(r2, M.pub, 'we can help');
  await send(k1, KID2.pub, 'we hear you');
  assert.equal(sealedTo.length, 2, 'sendCareChat did not seal both replies');
  assert.ok(sealedTo[0].includes(AD.pub) && sealedTo[0].includes(M.pub), 'CONTROL: the adult carer or the asker lost the reply');
  assert.ok(!sealedTo[0].includes(CH.pub), 'a care reply was sealed to a child on the care team');
  assert.ok(sealedTo[1].includes(KID2.pub), 'a child asker was cut out of their own thread');
});

test('Steward.setMinors (shipped): marking a care-team member as a child takes them off the relay’s care list', async () => {
  const N2 = K();   // an adult on the care list who is about to be marked a child
  const [ok0] = await publish(pub, ev(church, 'trinityone/careteam:' + cp, JSON.stringify({ pubs: [cp, AD.pub, N2.pub], updated: now() })));
  assert.equal(ok0, true);
  await sleep(150);
  assert.ok((await relayCareTeam()).includes(N2.pub), 'setup: N2 should be on the care list');
  const S = S0(); let pc;
  const vals = { S: () => S, now, CARETEAM_D: 'trinityone/careteam:', NET: 'trinityone', _careTeamWait: { pubs: null, tries: 0, timer: 0 }, setTimeout: fakeTimers(), get publishCareTeam() { return pc; } };
  pc = liftMeals('publishCareTeam', 'async function publishCareTeam(memberPubs) {')(vals);
  const refreshCareTeam = liftMeals('refreshCareTeam', 'async function refreshCareTeam() {')(vals);
  let refreshed = null;
  const win = { StewardMeals: { refreshCareTeam: () => (refreshed = refreshCareTeam()) } };
  const body = fnBody(STEWARD, 'setMinors(pubkeys) {', 'Steward.setMinors');
  // the bundle's own names for the helpers setMinors calls (esbuild renamed finalizeEvent to finalizeEvent2)
  assert.ok(body.includes('finalizeEvent2('), 're-anchor: setMinors no longer calls finalizeEvent2 in the bundle');
  const deviceSaved = [];
  const setMinors = new Function('_requireTrustedView', 'sk', '_landed', '_skewGate', '_publishToRelays', 'finalizeEvent2', '_monotonic', 'now', 'MINORS_D', 'pub', 'NET', 'window', '_minorsLastSet', 'actingChurch', '_keyReadEpoch', '_stillOn',
    'return function ' + body + ';')(
    () => {}, church.sk, (_w, p) => Promise.resolve(p), (f) => f(),
    async (evt) => { const [o] = await publish(pub, evt); return o; },
    finalizeEvent, (t) => t, now, 'trinityone/minors:', cp, 'trinityone', win, (c, l) => deviceSaved.push([c, l]), '', 1, () => true);
  const r = await setMinors([CH.pub, KID2.pub, N2.pub]);
  assert.equal(r, true, 'the children list did not land');
  assert.ok(refreshed, 'setMinors did not ask the care module to refresh the care list');
  assert.deepEqual(deviceSaved.map(([c, l]) => [c, l.slice().sort()]), [[cp, [CH.pub, KID2.pub, N2.pub].sort()]], 'setMinors did not keep its landed list as this church’s device copy');
  await refreshed;
  const pubs = await relayCareTeam();
  assert.ok(pubs.includes(AD.pub), 'CONTROL: the adult was taken off too');
  assert.ok(!pubs.includes(N2.pub), 'a person just marked as a child is still on the care list');
});

// ── 3. RE-AUDIT OF 0eb3cf9: what counts as KNOWING the children list, and whose retry it is ──────────────────
async function authedAt(url, who) {
  const ws = await new Promise((res, rej) => { const w = new WebSocket(url); w.on('open', () => res(w)); w.on('error', rej); });
  await new Promise((resolve) => {
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', url], ['challenge', m[1]]], content: '' }, who.sk)]));
      if (m[0] === 'OK' && m[2] === true) { ws.off('message', on); resolve(); } };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', 'kick', { kinds: [4], '#p': [who.pub], limit: 1 }]));
    setTimeout(resolve, 1500);
  });
  return ws;
}

test('readMinors: an EOSE from nostr-tools’ own timer (a connected relay that said nothing until maxWait) is NOT “no children”', async () => {
  const port = await freePort();
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });   // accepts the REQ and never answers
  const url = `ws://127.0.0.1:${port}/relay`;
  const silent = await new Promise((res, rej) => { const w = new WebSocket(url); w.on('open', () => res(w)); w.on('error', rej); });
  try {
    const m = await liftReadMinors({ entries: () => ({ [url]: { ws: silent, ok: true } }) })();
    assert.equal(m.known, false, 'the library’s timer was taken as the relay saying “no children”');
  } finally { silent.close(); wss.close(); }
});

test('readMinors: with two relays, one logged in and one that withheld the list from an un-logged-in socket, the list is UNKNOWN — and publishCareTeam publishes nothing', async () => {
  // relay 2 is a fresh relay for the same church that never got the children list; the church IS logged in there.
  const port2 = await freePort(); const url2 = `ws://127.0.0.1:${port2}/relay`;
  const dir2 = mkdtempSync(join(tmpdir(), 'trin-childcare2-'));
  const relay2 = spawn(process.execPath, ['scripts/gateway.mjs', String(port2)], { cwd: ROOT, env: { ...process.env, TRINITY_DATA_DIR: dir2, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  let ws2 = null, anon = null;
  try {
    for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(150)) { try { const r = await fetch(`http://127.0.0.1:${port2}/status`); if (r.ok) break; } catch {} }
    ws2 = await authedAt(url2, church);
    anon = await connect();   // the main relay, which HOLDS the list, over a socket that never logged in
    const entries = () => ({ [url2]: { ws: ws2, ok: true }, [WS_URL]: { ws: anon, ok: false } });
    const m = await liftReadMinors({ entries })();
    assert.equal(m.known, false, 'one logged-in relay with no list vouched for another that withheld it — “no children”');
    const S = S0({ readMinors: liftReadMinors({ entries }) });
    const before = await relayCareTeam();
    const w = { pubs: null, cp: '', tries: 0, timer: 0 }; let pc;
    pc = liftMeals('publishCareTeam', 'async function publishCareTeam(memberPubs) {')({ S: () => S, now, CARETEAM_D: 'trinityone/careteam:', NET: 'trinityone', _careTeamWait: w, setTimeout: fakeTimers(), get publishCareTeam() { return pc; } });
    assert.equal(await pc([CH.pub, AD.pub]), false, 'the care list was published on a children list one relay withheld');
    await sleep(200);
    assert.deepEqual(await relayCareTeam(), before, 'the relay’s care list changed');
  } finally { try { ws2 && ws2.close(); } catch {} try { anon && anon.close(); } catch {} try { relay2.kill('SIGKILL'); } catch {} try { rmSync(dir2, { recursive: true, force: true }); } catch {} }
});

test('publishCareTeam: a retry asked for one church never publishes after the console moves to another (and dropPendingCareTeam clears it)', async () => {
  const OTHER = K();
  const sent = [];
  let known = false;
  const S = { churchPub: cp, actingChurch: '', blockedHere: () => [], readMinors: async () => (known ? { known: true, list: [] } : { known: false, list: [] }),
    publishSigned: async (t) => { sent.push(t); return true; } };
  const w = { pubs: null, cp: '', tries: 0, timer: 0 };
  const timers = fakeTimers(); let pc, drop;
  const vals = { S: () => S, now, CARETEAM_D: 'trinityone/careteam:', NET: 'trinityone', _careTeamWait: w, setTimeout: timers, clearTimeout: () => {}, get publishCareTeam() { return pc; }, get dropPendingCareTeam() { return drop; } };
  drop = liftMeals('dropPendingCareTeam', 'function dropPendingCareTeam() {')(vals);   // first: publishCareTeam's retry calls it
  pc = liftMeals('publishCareTeam', 'async function publishCareTeam(memberPubs) {')(vals);
  assert.equal(await pc([AD.pub, M.pub]), false, 'setup: an unknown children list must not publish');
  assert.equal(timers.pending.length, 1, 'setup: a retry should be waiting');
  // a key restore: the same console is now church OTHER, and its children list now reads fine
  S.churchPub = OTHER.pub; known = true;
  timers.pending[0]();
  await sleep(50);
  assert.deepEqual(sent.map(t => t.tags[0][1]), [], 'church A’s carers were published as church B’s care list: ' + sent.map(t => t.content).join(' | '));
  // CONTROL: on the SAME church the retry does publish
  S.churchPub = cp; known = false; w.timer = 0;
  await pc([AD.pub]);
  known = true; timers.pending[timers.pending.length - 1]();
  await sleep(50);
  assert.equal(sent.length, 1, 'CONTROL: a retry for the church we are still on did not publish');
  // and the church reset's hook empties the queue
  known = false; await pc([AD.pub]);
  drop();
  assert.equal(w.pubs, null, 'dropPendingCareTeam left a pending list');
});

test('a delegated steward WITHOUT safeguarding never reads the children list as known, and their care reply keeps the request’s own audience', async () => {
  const DEL = K();
  const okP = async (evt, what) => { const [o, why] = await publish(pub, evt); assert.equal(o, true, what + ' — ' + why); };
  await okP(ev(church, 'trinityone/stewards:' + cp, JSON.stringify({ pubkeys: [DEL.pub], caps: { [DEL.pub]: ['care'] } })), 'a care-only delegate');
  await sleep(150);
  const delWs = await authed(DEL);
  try {
    const got = await query(delWs, { kinds: [30078], '#d': [D.minors] });
    assert.equal(got.length, 0, 'setup: the relay served the children list to a care-only delegate');
    const entries = () => ({ [WS_URL]: { ws: delWs, ok: true } });
    const m = await liftReadMinors({ entries, actingChurch: cp, pubK: cp, churchPubK: DEL.pub })();
    assert.equal(m.known, false, 'a delegate’s withheld (empty) answer was taken as “no children”');
    // their reply on an ordinary adult request: only the request's own audience, never widened
    const r3 = rid(M, 'r3');
    await okP(ev(M, 'trinityone/carereq:' + r3, JSON.stringify({ keys: { [cp]: 'w', [M.pub]: 'w', [AD.pub]: 'w' }, enc: 'x' }), [['church', cp], ['aud', 'team']]), 'request r3');
    await sleep(150);
    const sealedTo = [];
    const pool = shimPool(entries);
    const S = { churchPub: DEL.pub, actingChurch: cp, blockedHere: () => [], readMinors: liftReadMinors({ entries, actingChurch: cp, pubK: cp, churchPubK: DEL.pub }),
      subscribeMany: (f, h) => pool.subscribeMany([WS_URL], f, h), sealToPubs: (p) => { sealedTo.push(p.slice()); return { keys: {}, enc: 'x' }; }, publishSigned: async () => true };
    const send = liftMeals('sendCareChat', 'async function sendCareChat(reqId, requesterPub, text, opts) {')({ S: () => S, now, CARETEAM_D: 'trinityone/careteam:', CAREREQ_D: 'trinityone/carereq:', CARECHAT_D: 'trinityone/carechat:', NET: 'trinityone', setTimeout, _monotonicM: () => now() });
    await send(r3, M.pub, 'on our way');
    assert.equal(sealedTo.length, 1, 'the delegate’s reply was not sealed');
    // (+ the sender: sendCareChat seals to S().churchPub, which on a delegate's console is the delegate's own key)
    assert.deepEqual(sealedTo[0].slice().sort(), [cp, M.pub, AD.pub, DEL.pub].sort(), 'the delegate’s reply went beyond the request’s own audience');
  } finally { delWs.close(); }
});

// ── 4. FINAL AUDIT OF 1cf269c (owner, option A): a relay that is DOWN does not freeze the care list ───────────
const DOWN = 'ws://127.0.0.1:1/relay';   // nothing listens: nostr-tools fails the connection and closes the REQ
const LAST = 'trinityone.steward.minorslast.' + cp;
function pcWith(readMinors) {
  const S = S0({ readMinors }); let pc;
  pc = liftMeals('publishCareTeam', 'async function publishCareTeam(memberPubs) {')({ S: () => S, now, CARETEAM_D: 'trinityone/careteam:', NET: 'trinityone', _careTeamWait: { pubs: null, cp: '', tries: 0, timer: 0 }, setTimeout: fakeTimers(), get publishCareTeam() { return pc; } });
  return pc;
}

test('(a) one church relay permanently DOWN + one healthy logged-in relay: the care list publishes, WITHOUT the child', async () => {
  const entries = () => ({ [DOWN]: { down: true }, [WS_URL]: { ws: churchWs, ok: true } });
  const r = await pcWith(liftReadMinors({ entries }))([CH.pub, AD.pub]);
  assert.equal(r, true, 'a relay that is down froze the care list');
  const pubs = await relayCareTeam();
  assert.ok(pubs.includes(AD.pub), 'CONTROL: the adult is missing');
  assert.ok(!pubs.includes(CH.pub), 'the child was published onto the care list');
});

test('(b) EVERY relay down, with this church’s children list on the device: publishes using the device copy', async () => {
  const store = new Map(); liftDevice({ store }).set(cp, [CH.pub]);
  const entries = () => ({ [DOWN]: { down: true } });
  const r = await pcWith(liftReadMinors({ entries, store }))([CH.pub, M.pub]);
  assert.equal(r, true, 'the device copy was not used when no relay could be reached');
  const pubs = await relayCareTeam();
  assert.ok(pubs.includes(M.pub), 'CONTROL: the adult is missing');
  assert.ok(!pubs.includes(CH.pub), 'the device copy’s child was published onto the care list');
});

test('(c) EVERY relay down and NO device copy: publishes nothing', async () => {
  const before = await relayCareTeam();
  const entries = () => ({ [DOWN]: { down: true } });
  const r = await pcWith(liftReadMinors({ entries, store: new Map() }))([CH.pub, AD.pub]);
  assert.equal(r, false, 'a care list was published with no children list at all');
  await sleep(200);
  assert.deepEqual(await relayCareTeam(), before, 'the relay’s care list changed');
});

test('(d) merge, never shrink: while a relay is left out, someone on the device copy stays excluded even if the reachable relay’s list lacks them', async () => {
  const Y = K();   // marked as a child on this device; the reachable relay's list does not name them
  const store = new Map(); liftDevice({ store }).set(cp, [Y.pub]);
  const floored = () => ({ [DOWN]: { down: true }, [WS_URL]: { ws: churchWs, ok: true } });
  assert.equal(await pcWith(liftReadMinors({ entries: floored, store }))([Y.pub, AD.pub]), true);
  assert.ok(!(await relayCareTeam()).includes(Y.pub), 'a relay that missed the newest marking put the child back on the care list');
  const kept = liftDevice({ store }).get(cp) || [];
  assert.ok(kept.includes(Y.pub) && kept.includes(CH.pub), 'the device copy did not become the union');
  // CONTROL: when EVERY relay answers genuinely, the relays' newest list replaces the device copy
  const all = await liftReadMinors({ entries: mainEntries, store })();
  assert.equal(all.known, true);
  assert.ok(!all.list.includes(Y.pub), 'CONTROL: a full genuine answer did not replace the device copy');
});

test('(e) a slow but alive relay (answers after 5 s) is read, not treated as unknown (maxWait)', async () => {
  const m = await liftReadMinors({ entries: () => ({ [WS_URL]: { ws: churchWs, ok: true, delay: 5000 } }) })();
  assert.equal(m.known, true, 'a relay that answered genuinely after 5 s was treated as unknown');
  assert.ok(m.list.includes(CH.pub), 'the slow relay’s children list was not used');
});

// ── 5. AUDIT OF c17a640: the device copy is SEALED at rest and does not outlive its church ─────────────────────
test('(seal a) the device copy holds no child’s key in the clear, opens again with the unlocked key, and an old plaintext copy is deleted unused', () => {
  const store = new Map();
  const dev = liftDevice({ store });
  dev.set(cp, [CH.pub, KID2.pub]);
  const raw = [...store.values()].join('\n');
  assert.ok(store.size === 1 && raw.length > 0, 'nothing was stored');
  assert.ok(!raw.includes(CH.pub) && !raw.includes(KID2.pub) && !raw.toLowerCase().includes(CH.pub.slice(0, 16)), 'a child’s key is readable in localStorage');
  assert.deepEqual(dev.get(cp).slice().sort(), [CH.pub, KID2.pub].sort(), 'the sealed copy does not open again with the same key');
  assert.equal(dev.get('e'.repeat(64)), null, 'a copy answered for a church it was not stored for');
  // the c17a640 shape — a bare plaintext array — is never used, and is removed
  store.set(LAST, JSON.stringify([CH.pub]));
  assert.equal(dev.get(cp), null, 'a plaintext copy was used');
  assert.equal(store.has(LAST), false, 'a plaintext copy was left on the device');
});

test('(seal b) with the key LOCKED the device copy is unusable: every relay down -> UNKNOWN, publish nothing (control: unlocked -> used)', async () => {
  const store = new Map(); liftDevice({ store }).set(cp, [CH.pub]);
  const entries = () => ({ [DOWN]: { down: true } });
  const locked = await liftReadMinors({ entries, store, sk: null })();
  assert.equal(locked.known, false, 'a locked console read its sealed children list');
  assert.equal(await pcWith(liftReadMinors({ entries, store, sk: null }))([CH.pub, AD.pub]), false, 'a locked console published a care list from the device copy');
  const open = await liftReadMinors({ entries, store })();
  assert.ok(open.known && open.list.includes(CH.pub), 'CONTROL: the unlocked console could not use its own sealed copy');
});

test('(seal c) Steward.removeKey (shipped) deletes every church’s device copy and nothing else', () => {
  const store = new Map();
  const dev = liftDevice({ store });
  dev.set(cp, [CH.pub]); dev.set('e'.repeat(64), [KID2.pub]);
  store.set('trinityone.steward.unrelated', 'keep');
  const body = fnBody(STEWARD, 'removeKey() {', 'Steward.removeKey');
  const win = { Steward: {}, dispatchEvent() {} };
  const removeKey = new Function(...DEVICE_NAMES, 'KEY_LS', 'window', 'encBlobRemove', 'sk', 'pub', 'currentMnemonic',
    deviceHelpers() + '\nreturn function ' + body + ';')(...deviceVals(store, church.sk), 'trinityone.steward.key', win, () => Promise.resolve(true), church.sk, cp, 'x');
  removeKey();
  assert.deepEqual([...store.keys()].filter(k => k.startsWith('trinityone.steward.minorslast.')), [], 'a children list survived removing the key');
  assert.equal(store.get('trinityone.steward.unrelated'), 'keep', 'CONTROL: removeKey deleted something it should not');
});

test('(seal d) Steward.setMinors (shipped): a church switch while the write is in flight does not overwrite the other church’s copy', async () => {
  const B = 'b'.repeat(64);
  const store = new Map();
  const dev = liftDevice({ store });
  dev.set(B, [M.pub]);                       // church B's own copy on this device
  const body = fnBody(STEWARD, 'setMinors(pubkeys) {', 'Steward.setMinors');
  const stillOn = fnBody(STEWARD, 'function _stillOn(cp0, ep0) {', '_stillOn');
  let release;
  const gate = new Promise((r) => { release = r; });
  const api = new Function(...DEVICE_NAMES, '_requireTrustedView', 'sk', '_landed', '_skewGate', '_publishToRelays', 'finalizeEvent2', '_monotonic', 'now', 'MINORS_D', 'pub', 'NET', 'window', 'actingChurch', '_keyReadEpoch',
    deviceHelpers() + '\n' + stillOn + '\nreturn { setMinors: function ' + body + ', switchTo(p) { pub = p; _keyReadEpoch++; } };')(
    ...deviceVals(store, church.sk), () => {}, church.sk, (_w, p) => Promise.resolve(p), (f) => f(), () => gate,
    (t) => t, (t) => t, now, 'trinityone/minors:', cp, 'trinityone', { StewardMeals: null }, '', 1);
  const p = api.setMinors([CH.pub, KID2.pub]);   // church A's (cp's) children
  api.switchTo(B);                                // the console moves to church B before the write lands
  release(true);
  assert.equal(await p, true);
  assert.deepEqual(dev.get(B), [M.pub], 'church A’s children were filed as church B’s device copy');
  assert.equal(dev.get(cp), null, 'a list was filed after the console had left the church');
});
