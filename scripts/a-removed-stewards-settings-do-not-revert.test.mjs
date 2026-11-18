// WHEN THE CHURCH REMOVES A DELEGATED STEWARD, DO THE SETTINGS THAT STEWARD SAVED SURVIVE ON MEMBERS' PHONES?
//   Run: node --test scripts/a-removed-stewards-settings-do-not-revert.test.mjs
//
// THE PROBLEM (measured 2026-11-17 on a4d72505, before the fix). The member app trusts a church document only if it
// is signed by the church key or by a steward on the church's CURRENT signed roster. A delegated steward signs with
// their OWN key, so taking them off the roster reverted every setting they were the last to save: a group definition
// reverted on every phone; the photo list split between an open phone (kept B) and a fresh one (showed A) while the
// relay went on enforcing B until it restarted and then enforced A; the group key split two phones onto two keys.
//
// THE DECISION (owner, 2026-11-17; reference/DOMAIN.md "REMOVING A STEWARD KEEPS WHAT THEY SAVED"): every church
// setting a removed steward was the last to change stays exactly as they left it, re-saved under the church's own key.
// The build (reference/PLAN-removed-steward-keeps-settings-2026-11-17.html): before the roster write the owner's
// console carries each such document over to the church key; the removal then rotates the keys as before.
//
// ── HOW THIS MEASURES ─────────────────────────────────────────────────────────────────────────────────────────
// A REAL relay (`node scripts/gateway.mjs`, spawned from this tree, so never stale). The MEMBER PHONE is the whole
// shipped vendor/fellowship.js, run in a vm with a real 12-word identity; only the TRANSPORT is replaced
// (`pool.subscribeMany` -> the relay, answering NIP-42 as the member; scripts/family-harness.mjs realPool).
// THE REMOVAL IS PRESSED ON THE SCREEN: the real DashStewardsPanel out of app/stew-dashboard.jsx (dash-render-kit), its
// Revoke and confirm pressed, with window.Steward holding the SHIPPED engine functions lifted out of vendor/steward.js
// (scripts/steward-carry-rig.mjs): removeStewardKeeping -> the carry -> setStewards, then the panel's own
// rotateChurchKeys -> publishGroupKey. So the order is the real one — carry, roster write, revoke notice, rotation —
// and deleting the carry from the Remove path turns this file red. Stubbed, because they are not what this measures:
// the care, sermon and name key rotations (answer true) and the revoke notice (recorded).
//
// Three documents, each written twice at the same address: A by the church key, then a NEWER B by the steward.
//   1. a church content document — a group definition (subscribeChurchGroups, _churchVoice)
//   2. the photo-suppression list `nophoto:` (subscribeChurchSafeguard)
//   3. a group key envelope `groupkey:` (_ingestGroupKey) — never copied: the removal re-keys it (C) under the church
//
// THE FIRST BLOCK states what the owner decided, and is plain (it was `todo` until the fix). THE SECOND BLOCK records
// what was measured on this tree; the five that recorded the old reverting behaviour were replaced when it changed.
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
import { realPool } from './family-harness.mjs';
import { authedPool, consoleEngine } from './steward-carry-rig.mjs';
import { compiled, common, find, reads } from './dash-render-kit.mjs';

const PORT = 19621;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', STEWARDS_D = 'trinityone/stewards:';
const GROUP_D = 'trinityone/group:', GROUPKEY_D = 'trinityone/groupkey:';
const NOPHOTO_D = 'trinityone/nophoto:';
const FELLOWSHIP_SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

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

// what the relay serves under the CHURCH key at d (newest), as a screen asks
async function churchCopyAt(authSk, d) {
  const evs = (await askRelay(authSk, { kinds: [30078], authors: [cp], '#t': [NET] })).filter(e => dTag(e) === d);
  return evs.sort((a, b) => b.created_at - a.created_at)[0] || null;
}

// ── THE SHIPPED CONSOLE, lifted out of vendor/steward.js (scripts/steward-carry-rig.mjs) ─────────────────────────────
// `publishTo` stubs the TRANSPORT only: the real event goes to the real relay, on whichever socket is current.
const consoleFor = (signer, actingChurch) => consoleEngine({ signer, church: cp, actingChurch, relayUrl: WS_URL,
  pool: authedPool(signer, STEWARDS_D + cp), publishTo: (evt) => send(ws, evt) });

// ── THE OWNER'S SCREEN: the real DashStewardsPanel, rendered, over the shipped engine ─────────────────────────────────
// Recorded stand-ins for what this file does not measure: the care, sermon and name key rotations, and the revoke notice.
async function stewardsPanel(owner, { members, groups }) {
  const notes = { revoked: [], care: [] };
  Object.assign(owner.window.Steward, {
    pubkey: cp, actingChurch: '',
    publishGroupKey: (...a) => owner.publishGroupKey(...a), publishGroup: (...a) => owner.publishGroup(...a),
    publishStewardRevoke: (pk) => { notes.revoked.push(pk); return Promise.resolve(true); },
    stewardRemovalOutcome: () => Promise.resolve('unknown'),
    rotateCareKey: (m, s) => { notes.care.push({ m, s }); return Promise.resolve(true); },
    rotateMediaKey: () => Promise.resolve(true), ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }),
    joinPolicyFresh: () => false, listIsFresh: () => true,
    hasPinLock: () => false, verifyPin: () => Promise.resolve(true),
    stewardCaps: () => owner._stewardCaps, stewardCapNames: () => ['content', 'members', 'safeguarding', 'sealedrooms'],
    stewardLabels: () => ({ [dana.pub]: 'Dana' }), stewardName: () => '', stewardSince: () => ({}),
    stewardCodeToPub: () => null, stewardInvitePayload: () => 'x', qrSVG: () => '',
  });
  const globals = {
    ...common(), StewQRScanner: () => null,
    window: {
      Steward: owner.window.Steward, Capacitor: null,
      usePendingStewards: () => [], useStewardMembers: () => members, useStewardStewards: () => [...owner._careRoster],
      useStewardGroups: () => groups, useStewardBlocked: () => [],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  const { C, draw } = await compiled('DashStewardsPanel', globals, ['rotateChurchKeys']);
  return { notes, view: () => draw(C, { church: { name: 'St Mary’s' } }) };
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
function phoneRing(phone) {
  const ring = phone.ctx.__x__gkeys[cp + '|' + GID];
  return ring ? ring.map(k => Array.from(k).map(b => b.toString(16).padStart(2, '0')).join('')) : null;
}
// Open MY entry of an envelope the way the phone does: conversation key with the AUTHOR.
const keyIn = (evt, member) => nip44.decrypt(JSON.parse(evt.content).keys[member.pub], nip44.utils.getConversationKey(member.sk, evt.pubkey));

const A = { name: 'Prayer — church copy A' }, B = { name: 'Prayer — steward copy B' };
const KEY = {};   // 'A' | 'B' | 'C' -> the group key hex each envelope carries for mia (identical for noah)
const SEEN = {};  // what each phone showed at each step
let owner;

before(async () => {
  await requireFreePort(PORT, 'a-removed-stewards-settings-do-not-revert.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-steward-revert-'));
  await startGateway();
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk)))[0], true, 'church profile');
  for (const who of [dana, mia, noah, amy, ben]) assert.equal((await send(ws, doc(who, MEMBER_D + cp, { joined: now() })))[0], true, 'joined');

  owner = consoleFor(church, '');
  const steward = consoleFor(dana, cp);
  // (a) THE ROSTER names Dana, written by the shipped setStewards — and the owner console holds it, as subscribeStewards would
  assert.ok(await owner.setStewards([dana.pub], { [dana.pub]: ['content', 'members', 'safeguarding', 'sealedrooms'] }), 'roster: ' + owner.refused);
  owner._careRoster = new Set([dana.pub]); owner._stewardCaps = { [dana.pub]: ['content', 'members', 'safeguarding', 'sealedrooms'] }; owner._careRosterKnown = true;
  await sleep(250);
  // (a) THE CHURCH writes version A of all three…
  assert.ok(await owner.publishGroup({ id: GID, name: A.name, encrypted: true }), 'church group A: ' + owner.refused);
  const gkA = await owner.publishGroupKey(GID, [mia.pub, noah.pub]);
  assert.ok(gkA === true || (gkA && gkA.ok), 'church group key A: ' + JSON.stringify(gkA) + ' ' + owner.refused);
  assert.ok(await owner.setNoPhoto([amy.pub]), 'church nophoto A: ' + owner.refused);
  await sleep(1100);   // B must be strictly newer than A
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
  // the owner console receives Dana's envelope on its key subscription (the shipped stewIngestKey), so its ring holds B
  owner.stewIngestKey(envB);
  SEEN.ownerRingHasB = (owner._skeys[GID] || []).some(k => owner._hex(k) === KEY.B);

  // (b) PHONE 1 loads while Dana is on the roster.
  const p1 = bootPhone(mia);
  await openScreens(p1, mia);
  await until(() => groupName(p1) === B.name && nophoto(p1) && nophoto(p1).includes(ben.pub) && phoneKeyHex(p1) === KEY.B);
  SEEN.p1before = { group: groupName(p1), nophoto: nophoto(p1), key: phoneKeyHex(p1) };
  SEEN.relayBefore = { group: await asScreen(mia.sk, GROUP_D + GID), groupkey: await asScreen(mia.sk, GROUPKEY_D + GID), nophoto: await asScreen(mia.sk, NOPHOTO_D + cp) };

  // (c) THE OWNER REMOVES DANA ON THE SCREEN: Revoke, then the confirm, on the real DashStewardsPanel.
  const members = [mia, noah, amy, ben].map(m => ({ pubkey: m.pub, name: 'm', joined: 1690000000 }));
  const panel = await stewardsPanel(owner, { members, groups: [{ id: GID, name: B.name, encrypted: true, visibility: 'open' }] });
  let tree = panel.view();
  const x = find(tree, n => n && n.type === 'button' && n.props.title === 'Revoke this helper');
  assert.equal(x.length, 1, 're-anchor: expected one Revoke control (Dana’s row)');
  x[0].props.onClick();
  tree = panel.view();
  const confirm = find(tree, n => n && n.type === 'button' && /Confirm — revoke this helper/.test(String(n.props.title || '')));
  assert.equal(confirm.length, 1, 're-anchor: no confirm control');
  const sentBefore = owner.sent.length;
  confirm[0].props.onClick();
  // the removal is done when the church has re-keyed the room (the last step the panel takes)
  await until(() => owner.sent.slice(sentBefore).some(e => dTag(e) === GROUPKEY_D + GID), 30000);
  await sleep(300);
  SEEN.steps = owner.sent.slice(sentBefore).map(e => dTag(e));
  const firstOf = (d) => owner.sent.slice(sentBefore).find(e => dTag(e) === d);
  const wrong = (e) => !e || e.pubkey !== cp || e.tags.some(t => t[0] === 'church' && t[1] !== cp);
  SEEN.carriedTags = { group: wrong(firstOf(GROUP_D + GID)), nophoto: wrong(firstOf(NOPHOTO_D + cp)) };
  SEEN.revoked = panel.notes.revoked.slice();
  SEEN.screen = reads(panel.view());
  const envC = owner.sent.slice(sentBefore).filter(e => dTag(e) === GROUPKEY_D + GID).at(-1);
  KEY.C = envC ? keyIn(envC, mia) : null;
  SEEN.ringC = envC ? JSON.parse(nip44.decrypt(JSON.parse(envC.content).rings[mia.pub], nip44.utils.getConversationKey(mia.sk, envC.pubkey))) : null;

  // phone 1 is still open: wait until the new roster has reached it over its live subscription
  await until(() => { const r = p1.ctx.__x__churchRoster.get(cp); return r && !r.has(dana.pub); });
  SEEN.p1rosterUpdated = !p1.ctx.__x__churchRoster.get(cp).has(dana.pub);
  await until(() => phoneKeyHex(p1) === KEY.C, 6000);
  await sleep(1200);   // let any re-filter / re-ingest settle
  SEEN.p1after = { group: groupName(p1), nophoto: nophoto(p1), key: phoneKeyHex(p1) };

  // (d) A FRESH PHONE loads after the removal.
  const p2 = bootPhone(noah);
  await openScreens(p2, noah);
  await until(() => groupName(p2) !== null && nophoto(p2) !== null && phoneKeyHex(p2) !== null, 6000);
  await sleep(1200);
  SEEN.p2 = { group: groupName(p2), nophoto: nophoto(p2), key: phoneKeyHex(p2), ring: phoneRing(p2) };

  // (e) WHAT THE RELAY SERVES AND ENFORCES after the removal.
  SEEN.relayAfter = { group: await asScreen(noah.sk, GROUP_D + GID), groupkey: await asScreen(noah.sk, GROUPKEY_D + GID), nophoto: await asScreen(noah.sk, NOPHOTO_D + cp) };
  const cg = await churchCopyAt(noah.sk, GROUP_D + GID), cn = await churchCopyAt(noah.sk, NOPHOTO_D + cp);
  SEEN.churchContent = { group: cg && JSON.parse(cg.content).name, nophoto: cn && JSON.parse(cn.content).pubkeys };
  SEEN.photoBen = (await send(ws, photo(ben, 'https://example.invalid/ben.jpg')))[0];
  SEEN.photoAmy = (await send(ws, photo(amy, 'https://example.invalid/amy.jpg')))[0];
  // and can Dana still write? (the relay's door, not its read gate)
  SEEN.danaWriteAfter = (await send(ws, doc(dana, NOPHOTO_D + cp, { pubkeys: [] }, [['church', cp]])))[0];
  // …and AFTER THE RELAY RESTARTS. Its suppression map (NOPHOTO_BY) is built at ingest and rebuilt from the
  // stored history on every start, under the CURRENT roster — so a restart is a separate measurement.
  for (const p of phones) { try { p.rp.closeAll(); } catch {} }
  try { owner._pool.closeAll(); } catch {}
  try { ws.close(); } catch {}
  const old = relay; await new Promise(r => { old.once('exit', r); old.kill('SIGKILL'); });
  await startGateway();
  SEEN.restart = {
    nophoto: await asScreen(noah.sk, NOPHOTO_D + cp),
    nophotoContent: JSON.parse((await churchCopyAt(noah.sk, NOPHOTO_D + cp)).content).pubkeys,
    group: JSON.parse((await churchCopyAt(noah.sk, GROUP_D + GID)).content).name,
    photoBen: (await send(ws, photo(ben, 'https://example.invalid/ben2.jpg')))[0],
    photoAmy: (await send(ws, photo(amy, 'https://example.invalid/amy2.jpg')))[0],
  };
  const keyName = (h) => (h === KEY.A ? 'A' : h === KEY.B ? 'B' : h === KEY.C ? 'C' : h === null ? null : 'other');
  const who = (p) => p === amy.pub ? 'amy' : p === ben.pub ? 'ben' : p;
  console.log('# MEASURED ' + JSON.stringify({
    p1before: { ...SEEN.p1before, key: keyName(SEEN.p1before.key), nophoto: SEEN.p1before.nophoto.map(who) },
    p1after: { ...SEEN.p1after, key: keyName(SEEN.p1after.key), nophoto: (SEEN.p1after.nophoto || []).map(who) },
    p2: { ...SEEN.p2, key: keyName(SEEN.p2.key), ring: (SEEN.p2.ring || []).map(keyName), nophoto: (SEEN.p2.nophoto || []).map(who) },
    relayBefore: SEEN.relayBefore, relayAfter: SEEN.relayAfter, churchContent: { ...SEEN.churchContent, nophoto: (SEEN.churchContent.nophoto || []).map(who) },
    photoBen: SEEN.photoBen, photoAmy: SEEN.photoAmy, danaWriteAfter: SEEN.danaWriteAfter,
    restart: { ...SEEN.restart, nophotoContent: (SEEN.restart.nophotoContent || []).map(who) }, steps: SEEN.steps.map(d => d.split(':')[0].split('/')[1]),
  }));
});
after(async () => {
  for (const p of phones) { for (const off of p.offs) { try { off(); } catch {} } try { p.rp.closeAll(); } catch {} }
  try { owner && owner._pool.closeAll(); } catch {}
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

// ══ THE OWNER'S DECISION: removing the steward does not quietly undo what they saved (was `todo` before the fix) ═══
test('KEPT — group definition: the open phone keeps B after the steward is removed', () => {
  assert.equal(SEEN.p1after.group, B.name);
});
test('KEPT — group definition: a fresh phone shows B after the steward is removed', () => {
  assert.equal(SEEN.p2.group, B.name);
});
test('KEPT — photo suppression: the open phone keeps B after the steward is removed', () => {
  assert.deepEqual(SEEN.p1after.nophoto, [ben.pub]);
});
test('KEPT — photo suppression: a fresh phone shows B after the steward is removed', () => {
  assert.deepEqual(SEEN.p2.nophoto, [ben.pub]);
});
test('KEPT — photo suppression: what phones show is what the relay enforces, before AND after the relay restarts', () => {
  assert.equal(SEEN.p2.nophoto.includes(ben.pub), SEEN.photoBen === false, 'ben');
  assert.equal(SEEN.p2.nophoto.includes(amy.pub), SEEN.photoAmy === false, 'amy');
  assert.equal(SEEN.p2.nophoto.includes(ben.pub), SEEN.restart.photoBen === false, 'ben, after the restart');
  assert.equal(SEEN.p2.nophoto.includes(amy.pub), SEEN.restart.photoAmy === false, 'amy, after the restart');
});
test('KEPT — group key: the open phone and a fresh phone hold the SAME key, the church’s rotated C, and its ring still holds B', () => {
  assert.ok(KEY.C && KEY.C !== KEY.A && KEY.C !== KEY.B, 'the removal did not re-key the room under the church');
  assert.equal(SEEN.p1after.key, KEY.C, 'open phone');
  assert.equal(SEEN.p2.key, KEY.C, 'fresh phone');
  assert.ok((SEEN.p2.ring || []).includes(KEY.B), 'the fresh phone’s ring lost key B, so what was said under it no longer opens (T4)');
});
test('KEPT — the relay serves B’s CONTENT under the church key after the removal', () => {
  assert.equal(SEEN.churchContent.group, B.name, 'group definition');
  assert.deepEqual(SEEN.churchContent.nophoto, [ben.pub], 'photo-suppression list');
});

// ══ MEASURED ON THIS TREE (rule 4: this block is the record — it must change with the behaviour) ══════════════════
test('MEASURED — the removal reached the open phone over its live subscription', () => {
  assert.equal(SEEN.p1rosterUpdated, true);
});
test('MEASURED — the removal ran in the real order: carry (group, photo list), roster write, revoke notice, then the re-key', () => {
  const at = (p) => SEEN.steps.findIndex(d => d.startsWith(p));
  assert.ok(at(GROUP_D) !== -1 && at(NOPHOTO_D) !== -1, 'the group definition and photo list were not carried: ' + SEEN.steps.join(', '));
  assert.ok(at(GROUP_D) < at(STEWARDS_D) && at(NOPHOTO_D) < at(STEWARDS_D), 'the roster was written before the carry: ' + SEEN.steps.join(', '));
  assert.ok(at(STEWARDS_D) < at(GROUPKEY_D), 'the room was re-keyed before the roster write');
  assert.deepEqual(SEEN.revoked, [dana.pub], 'the removed steward was not sent the revoke notice');
});
test('MEASURED — the group key is never copied: the steward’s envelope B is not re-signed, the church re-keys', () => {
  assert.equal(SEEN.steps.filter(d => d.startsWith(GROUPKEY_D)).length, 1, 'more than the one rotation was published: ' + SEEN.steps.join(', '));
  assert.ok(SEEN.ownerRingHasB, 'FIXTURE: the owner console never held key B, so the ring check proves nothing');
  assert.ok(Array.isArray(SEEN.ringC) && SEEN.ringC[0] === KEY.C && SEEN.ringC.includes(KEY.B), 'the church’s rotated envelope does not carry B in its ring');
});
test('MEASURED — the carried copies are signed by the church key and name no other church', () => {
  assert.deepEqual(SEEN.carriedTags, { group: false, nophoto: false }, 'a carried copy is not the church’s, or names another church: ' + JSON.stringify(SEEN.carriedTags));
});
test('MEASURED — the screen says everything they set up was kept', () => {
  assert.match(SEEN.screen, /Everything they set up stays as they left it, now saved under the church\./, SEEN.screen.slice(0, 300));
});
test('MEASURED — after a RELAY RESTART the relay still holds and enforces B (Ben refused, Amy accepted) and the group stays B', () => {
  // Before the fix the restart flipped the relay to A. The church's copy is B now, so the rebuilt map is B.
  assert.deepEqual({ ...SEEN.restart, nophotoContent: SEEN.restart.nophotoContent }, { nophoto: { church: 1, steward: 0 }, nophotoContent: [ben.pub], group: B.name, photoBen: false, photoAmy: true }, JSON.stringify(SEEN.restart));
});
test('MEASURED — the relay stops SERVING the removed steward’s own copy of all three; the church’s copy is still served', () => {
  assert.deepEqual(SEEN.relayAfter, { group: { church: 1, steward: 0 }, groupkey: { church: 1, steward: 0 }, nophoto: { church: 1, steward: 0 } });
});
test('MEASURED — the removed steward can no longer write the list', () => {
  assert.equal(SEEN.danaWriteAfter, false);
});
