// WHEN THE CHURCH REMOVES A DELEGATED STEWARD, DO THE SETTINGS THAT STEWARD SAVED SURVIVE ON MEMBERS' PHONES?
//   Run: node --test scripts/a-removed-stewards-settings-do-not-revert.test.mjs
//
// THE SUSPICION (2026-11-17, from reading). The member app trusts a church document only if it is signed by the
// church key or by a steward on the church's CURRENT signed roster (_churchVoice, _ingestGroupKey,
// subscribeChurchSafeguard, …). A delegated steward signs with their OWN key. So when the owner takes them off
// the roster, every setting they were the last to save reverts on members' phones to the church key's older
// copy, or disappears, with nothing said — and a phone that already took the steward's copy may not agree with
// a phone that loads afterwards.
//
// ── HOW THIS MEASURES ─────────────────────────────────────────────────────────────────────────────────────────
// A REAL relay (`node scripts/gateway.mjs`, spawned from this tree, so never stale). The MEMBER PHONE is the whole
// shipped vendor/fellowship.js, run in a vm with a real 12-word identity; the only thing replaced is the
// TRANSPORT — `pool.subscribeMany` is pointed at that relay over a real websocket that answers the relay's
// NIP-42 challenge as the member (scripts/family-harness.mjs realPool). The CONSOLE writes are the shipped
// functions lifted out of vendor/steward.js — publishGroup, publishGroupKey, setNoPhoto, and setStewards, which
// is the roster write DashStewardsPanel.remove (app/stew-dashboard.jsx) calls to take a steward off.
//
// Three documents, each written twice at the same address: A by the church key, then a NEWER B by the steward.
//   1. a church content document — a group definition (subscribeChurchGroups, _churchVoice)
//   2. the photo-suppression list `nophoto:` (subscribeChurchSafeguard)
//   3. a group key envelope `groupkey:` (_ingestGroupKey)
//
// TWO BLOCKS. The `todo` tests state the DESIRED behaviour — a phone keeps showing B after the steward goes —
// and report without failing the suite. The plain tests record what was MEASURED on this tree today, so a change
// in either direction turns something red and has to be explained.
//
// WHAT THIS DOES NOT COVER: the rest of DashStewardsPanel.remove. After the roster write lands it ALSO
// publishes stewardrevoke:<pk> and runs rotateChurchKeys, which re-issues group keys signed by the CHURCH. That
// re-key would replace the group-key result below with a third, newer, church-signed key. It is not driven here;
// only the roster write is.
//
// ⚠ NOT A CODE FAILURE IF YOU SEE IT: this file binds a fixed port. If it is held, requireFreePort names the
// holding PID — kill THAT pid, never `pkill -f`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody, stmt } from './test-slice.mjs';
import { realPool } from './family-harness.mjs';

const PORT = 19621;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', STEWARDS_D = 'trinityone/stewards:';
const GROUP_D = 'trinityone/group:', GROUPKEY_D = 'trinityone/groupkey:';
const JOINPOLICY_D = 'trinityone/joinpolicy:', NOPHOTO_D = 'trinityone/nophoto:';
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELLOWSHIP_SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const _landedShipped = new Function('return ' + fnBody(STEWARD, 'function _landed(what, p) {', '_landed'))();
const EVENT_POLICIES = new Function(stmt(STEWARD, 'var EVENT_POLICIES = ', 'EVENT_POLICIES') + '\nreturn EVENT_POLICIES;')();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const M = () => { const words = generateSeedWords(); const sk = privateKeyFromSeedWords(words); return { words, sk, pub: getPublicKey(sk) }; };

const church = K();   // the owner's console — holds the church key
const dana   = K();   // a DELEGATED steward: her own key signs, the church tag names the church
const mia    = M();   // member phone 1 — loads while Dana is a steward, stays open through her removal
const noah   = M();   // member phone 2 — a FRESH phone, first loads after the removal
const amy    = K();   // suppressed by the CHURCH's list (A)
const ben    = K();   // suppressed by the STEWARD's list (B)
const cp = church.pub;
const GID = cp.slice(0, 16) + '-prayer';   // namespaced the way publishGroup mints ids

let _t = Math.floor(Date.now() / 1000) - 300; const now = () => ++_t;
let relay, dataDir, ws;
async function startGateway() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(200); }
  ws = await connect();
}
const phones = [];

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
let _pt = Math.floor(Date.now() / 1000);
const photo = (who, url) => finalizeEvent({ kind: 0, created_at: (_pt = Math.max(_pt + 1, Math.floor(Date.now() / 1000))), tags: [['t', NET], ['church', cp]], content: JSON.stringify({ name: 'somebody', picture: url }) }, who.sk);
const dTag = e => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
async function until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; }

// Ask the relay the way a screen does, on its own socket, after a real NIP-42 auth (see
// a-delegated-stewards-church-writes-are-visible.test.mjs for why one socket per question).
const askRelay = (authSk, filter) => new Promise((res, rej) => {
  const id = 'q' + Math.random().toString(36).slice(2, 8), out = [];
  const sock = new WebSocket(WS_URL);
  sock.on('error', rej);
  sock.on('open', () => sock.send(JSON.stringify(['REQ', id, filter])));
  sock.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && authSk) sock.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)]));
    else if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]);
    else if (m[0] === 'EOSE' && m[1] === id) { sock.send(JSON.stringify(['CLOSE', id])); sock.close(); res(out); } });
});
async function asScreen(authSk, d) {
  const byAuthor = (await askRelay(authSk, { kinds: [30078], authors: [cp], '#t': [NET] })).filter(e => dTag(e) === d);
  const byTag = (await askRelay(authSk, { kinds: [30078], '#church': [cp], '#t': [NET] })).filter(e => dTag(e) === d);
  return { church: byAuthor.length, steward: byTag.filter(e => e.pubkey === dana.pub).length };
}

// ── THE SHIPPED CONSOLE, lifted out of vendor/steward.js ─────────────────────────────────────────────────────
// `publish` / `_publishToRelays` stub the TRANSPORT only: the real event goes to the real relay.
function consoleApi({ signer, actingChurch }) {
  const scope = {
    sk: signer.sk, pub: cp, actingChurch, churchSk: signer.sk, churchPub: signer.pub,
    NET, GROUP_D, GROUPKEY_D, JOINPOLICY_D, NOPHOTO_D, STEWARDS_D, GROUP_RING_MAX: 12, EVENT_POLICIES,
    _skeys: {}, _srev: {}, _senvTs: {}, _senvRecips: {}, _senvMine: {}, _noteEnvelopeDrops: () => {}, _gkChain: new Map(), _gkWaiting: new Map(), _localBlocked: new Set(),
    _isRelayAuthed: () => true, _requireTrustedView: () => {}, _landed: _landedShipped,
    _monotonic: (t) => t, _skewGate: (fn) => Promise.resolve(fn()), ensureSkew: () => null, SKEW_WAIT_MS: 6000,
    // setStewards' carried state: an owner who passes caps explicitly, has typed no labels and holds none sealed
    _stewardCaps: {}, _stewardNames: {}, _stewardSince: {}, _stewardNamesCt: null, _sealChurchDoc: () => null,
    _hex: (u) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join(''),
    toPubHex: (p) => (/^[0-9a-f]{64}$/i.test(p) ? String(p).toLowerCase() : null),
    now, sent: [],
    publish: async (evt) => { scope.sent.push(evt); const [ok, why] = await send(ws, evt); if (!ok) scope.refused = why; return ok; },
    _publishToRelays: async (evt) => { scope.sent.push(evt); const [ok, why] = await send(ws, evt); if (!ok) scope.refused = why; return ok ? evt : null; },
  };
  const feBody = fnBody(STEWARD, 'function feChurch(tmpl, signer) {', 'feChurch');
  const signerName = (/return\s+(finalizeEvent\w*)\s*\(/.exec(feBody) || [])[1];
  assert.ok(signerName, 'feChurch no longer ends by calling finalizeEvent — re-anchor this fixture');
  scope[signerName] = finalizeEvent;
  const gkBody = fnBody(STEWARD, 'async publishGroupKey(', 'publishGroupKey');
  const seal = /const ck = (\w+)\(churchSk, pk\);\s*keys\[pk\] = (\w+)\(/.exec(gkBody);
  assert.ok(seal, 'publishGroupKey no longer seals in the shape this fixture reads — re-anchor it');
  scope[seal[1]] = nip44.utils.getConversationKey;
  scope[seal[2]] = nip44.encrypt;
  const ssBody = fnBody(STEWARD, 'setStewards(pubkeys, caps, names) {', 'setStewards');
  const ssSigner = (/publish\((finalizeEvent\w*)\(/.exec(ssBody) || [])[1];
  assert.ok(ssSigner, 'setStewards no longer publishes finalizeEvent(...) — re-anchor this fixture');
  scope[ssSigner] = finalizeEvent;
  const parts = [gkBody, fnBody(STEWARD, 'setNoPhoto(pubkeys) {', 'setNoPhoto'), fnBody(STEWARD, 'publishGroup(group) {', 'publishGroup'), ssBody];
  Object.assign(scope, new Function('scope', `with (scope) { ${feBody}\n return ({ ${parts.join(',\n')} }); }`)(scope));
  return scope;
}

// ── A MEMBER PHONE: the whole shipped vendor/fellowship.js ─────────────────────────────────────────────────────
// Modelled on scripts/fellowship-vm.mjs, plus a TrinityIdentity holding the member's 12 words (init() derives the
// signing key from it, exactly as on a phone) and module variables exposed by splicing after their declaration.
const EXPOSE = ['pool', '_gkeys', '_churchRoster'];
function bootPhone(member) {
  let src = FELLOWSHIP_SRC;
  for (const name of EXPOSE) {
    const re = new RegExp('^( {2}var ' + name + ' = [^\\n]*;)$', 'gm');
    const hits = src.match(re) || [];
    assert.equal(hits.length, 1, `expected exactly one declaration of ${name} in vendor/fellowship.js`);
    src = src.replace(re, `$1 window.__x_${name} = ${name};`);
  }
  const store = {};
  const ctx = vm.createContext({
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    location: { search: '', href: 'http://localhost/', hostname: 'localhost', protocol: 'http:', origin: 'http://localhost' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: { onLine: true }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    setTimeout: (f, ms, ...a) => { const t = setTimeout(f, ms, ...a); if (t && t.unref) t.unref(); return t; }, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    console: { log() {}, warn() {}, info() {}, debug() {}, error() {} },
    crypto: globalThis.crypto, TextEncoder, TextDecoder, URL, Uint8Array, Date, Math, JSON, queueMicrotask, atob, btoa, AbortController, Promise,
    fetch: async () => { throw new Error('no fetch in this rig — relay traffic goes through pool.subscribeMany'); },
    WebSocket: class { constructor() { setTimeout(() => { try { this.onerror && this.onerror({}); this.onclose && this.onclose({}); } catch (e) {} }, 0); } close() {} send() {} },
    document: { addEventListener() {}, visibilityState: 'visible' },
    TrinityIdentity: { ready: Promise.resolve(), exportMnemonic: async () => member.words },
  });
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.runInContext(src, ctx);
  const rp = realPool(member);
  ctx.__x_pool.subscribeMany = (_relays, filters, h) => rp.subscribeMany([WS_URL], filters, h);
  const phone = { F: ctx.Fellowship, ctx, rp, groups: null, sg: null, offs: [] };
  phones.push(phone);
  return phone;
}
async function openScreens(phone, member) {
  await phone.F.ready;
  assert.equal(phone.F.myPubkey, member.pub,
    'the phone did not derive the member key from its 12 words — the rig is not running init()');
  const npub = npubEncode(cp);
  phone.offs.push(phone.F.subscribeChurchGroups(npub, (v) => { phone.groups = v; }));
  phone.offs.push(phone.F.subscribeChurchSafeguard(npub, (o) => { phone.sg = o; }));
}
const groupName = (phone) => { const g = (phone.groups || []).find(x => x.id === GID); return g ? g.name : null; };
const nophoto = (phone) => (phone.sg ? [...phone.sg.nophoto] : null);
function phoneKeyHex(phone) {
  const ring = phone.ctx.__x__gkeys[cp + '|' + GID];
  return ring && ring.length ? Array.from(ring[0]).map(b => b.toString(16).padStart(2, '0')).join('') : null;
}
// Open MY entry of an envelope the way the phone does: conversation key with the AUTHOR.
const keyIn = (evt, member) => nip44.decrypt(JSON.parse(evt.content).keys[member.pub], nip44.utils.getConversationKey(member.sk, evt.pubkey));

const A = { name: 'Prayer — church copy A' }, B = { name: 'Prayer — steward copy B' };
const KEY = {};   // 'A' | 'B' -> the group key hex each envelope carries for mia (identical for noah)
const SEEN = {};  // what each phone showed at each step

before(async () => {
  await requireFreePort(PORT, 'a-removed-stewards-settings-do-not-revert.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-steward-revert-'));
  await startGateway();
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk)))[0], true, 'church profile');
  for (const who of [dana, mia, noah, amy, ben]) assert.equal((await send(ws, doc(who, MEMBER_D + cp, { joined: now() })))[0], true, 'joined');

  const owner = consoleApi({ signer: church, actingChurch: '' });
  const steward = consoleApi({ signer: dana, actingChurch: cp });
  // (a) THE ROSTER names Dana, written by the shipped setStewards.
  assert.equal(await owner.setStewards([dana.pub], { [dana.pub]: ['content', 'members', 'safeguarding', 'sealedrooms'] }), true, 'roster: ' + owner.refused);
  await sleep(250);
  // (a) THE CHURCH writes version A of all three…
  assert.ok(await owner.publishGroup({ id: GID, name: A.name, encrypted: true }), 'church group A: ' + owner.refused);
  const gkA = await owner.publishGroupKey(GID, [mia.pub, noah.pub]);
  assert.ok(gkA === true || (gkA && gkA.ok), 'church group key A: ' + JSON.stringify(gkA) + ' ' + owner.refused);
  assert.ok(await owner.setNoPhoto([amy.pub]), 'church nophoto A: ' + owner.refused);
  await sleep(250);
  // …then STEWARD Dana writes a newer version B of each, at the same addresses.
  assert.ok(await steward.publishGroup({ id: GID, name: B.name, encrypted: true }), 'steward group B: ' + steward.refused);
  const gkB = await steward.publishGroupKey(GID, [mia.pub, noah.pub]);
  assert.ok(gkB === true || (gkB && gkB.ok), 'steward group key B: ' + JSON.stringify(gkB) + ' ' + steward.refused);
  assert.ok(await steward.setNoPhoto([ben.pub]), 'steward nophoto B: ' + steward.refused);
  await sleep(300);
  const envA = owner.sent.filter(e => dTag(e) === GROUPKEY_D + GID).at(-1);
  const envB = steward.sent.filter(e => dTag(e) === GROUPKEY_D + GID).at(-1);
  KEY.A = keyIn(envA, mia); KEY.B = keyIn(envB, mia);
  assert.notEqual(KEY.A, KEY.B, 'the two envelopes carry the same key — nothing below could tell them apart');
  assert.ok(envB.created_at > envA.created_at, 'B is not newer than A');

  // (b) PHONE 1 loads while Dana is on the roster.
  const p1 = bootPhone(mia);
  await openScreens(p1, mia);
  await until(() => groupName(p1) === B.name && nophoto(p1) && nophoto(p1).includes(ben.pub) && phoneKeyHex(p1) === KEY.B);
  SEEN.p1before = { group: groupName(p1), nophoto: nophoto(p1), key: phoneKeyHex(p1) };
  SEEN.relayBefore = { group: await asScreen(mia.sk, GROUP_D + GID), groupkey: await asScreen(mia.sk, GROUPKEY_D + GID), nophoto: await asScreen(mia.sk, NOPHOTO_D + cp) };

  // (c) THE CHURCH REMOVES DANA — the shipped setStewards, called the way DashStewardsPanel.remove calls it:
  // the remaining stewards (none), capabilities carried forward.
  assert.equal(await owner.setStewards([], {}), true, 'the removal did not land: ' + owner.refused);
  // phone 1 is still open: wait until the new roster has reached it over its live subscription
  await until(() => { const r = p1.ctx.__x__churchRoster.get(cp); return r && !r.has(dana.pub); });
  SEEN.p1rosterUpdated = !p1.ctx.__x__churchRoster.get(cp).has(dana.pub);
  await sleep(1200);   // let any re-filter / re-ingest settle
  SEEN.p1after = { group: groupName(p1), nophoto: nophoto(p1), key: phoneKeyHex(p1) };

  // (d) A FRESH PHONE loads after the removal.
  const p2 = bootPhone(noah);
  await openScreens(p2, noah);
  await until(() => groupName(p2) !== null && nophoto(p2) !== null && phoneKeyHex(p2) !== null, 6000);
  await sleep(1200);
  SEEN.p2 = { group: groupName(p2), nophoto: nophoto(p2), key: phoneKeyHex(p2) };

  // (e) WHAT THE RELAY SERVES AND ENFORCES after the removal.
  SEEN.relayAfter = { group: await asScreen(noah.sk, GROUP_D + GID), groupkey: await asScreen(noah.sk, GROUPKEY_D + GID), nophoto: await asScreen(noah.sk, NOPHOTO_D + cp) };
  SEEN.photoBen = (await send(ws, photo(ben, 'https://example.invalid/ben.jpg')))[0];
  SEEN.photoAmy = (await send(ws, photo(amy, 'https://example.invalid/amy.jpg')))[0];
  // and can Dana still write? (the relay's door, not its read gate)
  SEEN.danaWriteAfter = (await send(ws, doc(dana, NOPHOTO_D + cp, { pubkeys: [] }, [['church', cp]])))[0];
  // …and AFTER THE RELAY RESTARTS. Its suppression map (NOPHOTO_BY) is built at ingest and rebuilt from the
  // stored history on every start, under the CURRENT roster — so a restart is a separate measurement.
  for (const p of phones) { try { p.rp.closeAll(); } catch {} }
  try { ws.close(); } catch {}
  const old = relay; await new Promise(r => { old.once('exit', r); old.kill('SIGKILL'); });
  await startGateway();
  SEEN.restart = {
    nophoto: await asScreen(noah.sk, NOPHOTO_D + cp),
    photoBen: (await send(ws, photo(ben, 'https://example.invalid/ben2.jpg')))[0],
    photoAmy: (await send(ws, photo(amy, 'https://example.invalid/amy2.jpg')))[0],
  };
  const keyName = (h) => (h === KEY.A ? 'A' : h === KEY.B ? 'B' : h === null ? null : 'other');
  console.log('# MEASURED ' + JSON.stringify({
    p1before: { ...SEEN.p1before, key: keyName(SEEN.p1before.key), nophoto: SEEN.p1before.nophoto.map(p => p === amy.pub ? 'amy' : p === ben.pub ? 'ben' : p) },
    p1after: { ...SEEN.p1after, key: keyName(SEEN.p1after.key), nophoto: (SEEN.p1after.nophoto || []).map(p => p === amy.pub ? 'amy' : p === ben.pub ? 'ben' : p) },
    p2: { ...SEEN.p2, key: keyName(SEEN.p2.key), nophoto: (SEEN.p2.nophoto || []).map(p => p === amy.pub ? 'amy' : p === ben.pub ? 'ben' : p) },
    relayBefore: SEEN.relayBefore, relayAfter: SEEN.relayAfter,
    photoBen: SEEN.photoBen, photoAmy: SEEN.photoAmy, danaWriteAfter: SEEN.danaWriteAfter, restart: SEEN.restart,
  }));
});
after(async () => {
  for (const p of phones) { for (const off of p.offs) { try { off(); } catch {} } try { p.rp.closeAll(); } catch {} }
  try { ws && ws.close(); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  await sleep(200);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// ══ THE PRECONDITION: while Dana is a steward, a phone shows her newer copy of all three ═══════════════════════
test('(b) while the steward is on the roster, a member phone shows the steward’s newer copy B of all three', () => {
  assert.equal(SEEN.p1before.group, B.name, 'group definition');
  assert.deepEqual(SEEN.p1before.nophoto, [ben.pub], 'photo-suppression list');
  assert.equal(SEEN.p1before.key, KEY.B, 'group key');
  assert.deepEqual(SEEN.relayBefore, { group: { church: 1, steward: 1 }, groupkey: { church: 1, steward: 1 }, nophoto: { church: 1, steward: 1 } },
    'the relay should serve BOTH copies of each document to a member before the removal');
});

// ══ DESIRED: removing the steward does not quietly undo what they saved ═════════════════════════════════════════
const TODO = { todo: 'general B fix' };
test('DESIRED — group definition: the open phone keeps B after the steward is removed', TODO, () => {
  assert.equal(SEEN.p1after.group, B.name);
});
test('DESIRED — group definition: a fresh phone shows B after the steward is removed', TODO, () => {
  assert.equal(SEEN.p2.group, B.name);
});
test('DESIRED — photo suppression: the open phone keeps B after the steward is removed', TODO, () => {
  assert.deepEqual(SEEN.p1after.nophoto, [ben.pub]);
});
test('DESIRED — photo suppression: a fresh phone shows B after the steward is removed', TODO, () => {
  assert.deepEqual(SEEN.p2.nophoto, [ben.pub]);
});
test('DESIRED — photo suppression: what phones show is what the relay enforces', TODO, () => {
  assert.equal(SEEN.p2.nophoto.includes(ben.pub), SEEN.photoBen === false, 'ben');
  assert.equal(SEEN.p2.nophoto.includes(amy.pub), SEEN.photoAmy === false, 'amy');
});
test('DESIRED — group key: the open phone and a fresh phone hold the SAME key after the removal', TODO, () => {
  assert.equal(SEEN.p2.key, SEEN.p1after.key);
});
test('DESIRED — the relay still serves the steward’s copy of each after the removal', TODO, () => {
  assert.equal(SEEN.relayAfter.group.steward, 1, 'group');
  assert.equal(SEEN.relayAfter.groupkey.steward, 1, 'groupkey');
  assert.equal(SEEN.relayAfter.nophoto.steward, 1, 'nophoto');
});

// ══ MEASURED TODAY (rule 4: this block is the record — it must change with the behaviour) ══════════════════════
test('MEASURED — the removal reached the open phone over its live subscription', () => {
  assert.equal(SEEN.p1rosterUpdated, true);
});
test('MEASURED — group definition REVERTS to the church’s copy A, on the open phone AND on a fresh one', () => {
  assert.equal(SEEN.p1after.group, A.name, 'open phone (no restart)');
  assert.equal(SEEN.p2.group, A.name, 'fresh phone');
});
test('MEASURED — photo suppression: the open phone KEEPS B, a fresh phone shows A — phones disagree', () => {
  assert.deepEqual(SEEN.p1after.nophoto, [ben.pub], 'open phone (no restart)');
  assert.deepEqual(SEEN.p2.nophoto, [amy.pub], 'fresh phone');
});
test('MEASURED — photo suppression: the RELAY goes on enforcing B (Ben refused, Amy accepted) while a fresh phone shows A', () => {
  assert.equal(SEEN.photoBen, false, 'Ben’s new photo');
  assert.equal(SEEN.photoAmy, true, 'Amy’s new photo');
});
test('MEASURED — photo suppression after a RELAY RESTART flips the relay to A: Ben’s photo now ACCEPTED, Amy’s refused', () => {
  // Before the restart the relay enforced B while fresh phones showed A; after it, the relay enforces A. So the
  // suppression the steward applied is silently lifted at whatever moment the box next restarts.
  assert.deepEqual(SEEN.restart, { nophoto: { church: 1, steward: 0 }, photoBen: true, photoAmy: false }, JSON.stringify(SEEN.restart));
});
test('MEASURED — group key: the open phone KEEPS key B, a fresh phone is given key A — phones disagree', () => {
  assert.equal(SEEN.p1after.key, KEY.B, 'open phone (no restart)');
  assert.equal(SEEN.p2.key, KEY.A, 'fresh phone');
});
test('MEASURED — the relay stops SERVING the removed steward’s copy of all three; the church’s copy is still served', () => {
  assert.deepEqual(SEEN.relayAfter, { group: { church: 1, steward: 0 }, groupkey: { church: 1, steward: 0 }, nophoto: { church: 1, steward: 0 } });
});
test('MEASURED — the removed steward can no longer write the list', () => {
  assert.equal(SEEN.danaWriteAfter, false);
});
