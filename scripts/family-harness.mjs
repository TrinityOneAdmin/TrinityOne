// Shared rig for the guardian-notice / family tests (2026-10-01). NOT a test file.
//
// It runs the SHIPPED code: the member app's family functions are lifted out of vendor/fellowship.js and the
// console's notice functions out of vendor/steward.js, by the names esbuild gave them, and evaluated in a vm
// with only their surroundings supplied — signing, sealing and the network. A name a lifted function needs and
// the rig does not supply is a ReferenceError, never a silent undefined.
//
// Used by:
//   scripts/an-unlinked-child-stays-gone-after-a-lock.test.mjs
//   scripts/a-removed-parent-never-sees-the-child-again.test.mjs
//   scripts/a-guardian-notice-carries-the-whole-list.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';
import { fnBody } from './test-slice.mjs';

export const ROOT = new URL('..', import.meta.url).pathname;
export const FELLOWSHIP = readFileSync(ROOT + 'vendor/fellowship.js', 'utf8');
export const STEWARD = readFileSync(ROOT + 'vendor/steward.js', 'utf8');
export const now = () => Math.floor(Date.now() / 1000);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
export const dOf = (e) => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '';
export const isRetracted = (e) => (e.tags || []).some(t => t[0] === 'deleted') || !e.content;
export async function until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; }

// ── lifting ───────────────────────────────────────────────────────────────────────────────────────────────────
function topLevel(SRC, name) {
  const re = new RegExp('\\n  (async )?function ' + name + '\\([\\s\\S]*?\\n  \\}');
  const m = re.exec(SRC);
  assert.ok(m, `could not lift ${name} from the bundle — re-anchor this rig, do not delete it`);
  return m[0];
}
function topVar(SRC, name) {
  const m = new RegExp('\\n  var ' + name + ' = [^\\n]*;').exec(SRC);
  assert.ok(m, `could not lift var ${name} from the bundle — re-anchor this rig`);
  return m[0];
}
function method(SRC, sig, name) {
  const body = fnBody(SRC, sig, name);
  return name + body.slice(body.indexOf('('));
}
// The shipped helpers the older rebuild tests used to re-type (re-audit, rule 4): lift them instead.
export function shippedFamilyHelpers() {
  return new Function([topLevel(FELLOWSHIP, '_newerDoc'), topVar(FELLOWSHIP, '_isRetractedReq'), topVar(FELLOWSHIP, '_hex64'),
    'return { _newerDoc, _isRetractedReq, _hex64 };'].join('\n'))();
}

// ── a relay ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function startRelay(port, churchPub) {
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-family-' + port + '-'));
  const proc = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(churchPub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) break; } catch {} await sleep(150); }
  const url = `ws://127.0.0.1:${port}/relay`;
  return { url, stop() { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
}
export function conn(url) { return new Promise((res, rej) => { const w = new WebSocket(url); w.on('open', () => res(w)); w.on('error', rej); }); }
export function send(w, e) {
  return new Promise(res => {
    const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', e]));
    setTimeout(() => res([false, '(no reply)']), 5000);
  });
}
export async function publishTo(url, e) { const w = await conn(url); try { return await send(w, e); } finally { w.close(); } }
// A subscription as `who`, the way the real pool does it: REQ at once, answer the relay's NIP-42 challenge when
// it comes (lazy auth — the relay challenges only when it withheld something, then replays it).
export async function sub(url, who, id, filters, onEvent, onEose) {
  const w = await conn(url);
  w.on('message', d => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH' && typeof m[1] === 'string' && who) {
      w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', url], ['challenge', m[1]]], content: '' }, who.sk)]));
    }
    if (m[0] === 'EVENT' && m[1] === id) onEvent(m[2]);
    if (m[0] === 'EOSE' && m[1] === id && onEose) onEose();
  });
  w.send(JSON.stringify(['REQ', id, ...filters]));
  return w;
}
// Everything `who` is served for `filter` on one relay, collected to EOSE (or a timeout).
export async function ask(url, who, filter, ms = 6000) {
  const got = []; let w;
  await new Promise(async res => { w = await sub(url, who, 'q' + Math.random().toString(36).slice(2, 7), [filter], e => got.push(e), res); setTimeout(res, ms); });
  try { w.close(); } catch {}
  return got;
}
// A pool over real relays: one socket per relay per subscription, EOSE when every relay has answered.
export function realPool(who) {
  const sockets = [];
  return {
    sockets,
    subscribeMany(relays, filters, handlers) {
      const id = 's' + Math.random().toString(36).slice(2, 8);
      let closed = false, pending = relays.length;
      const mine = [];
      for (const url of relays) {
        sub(url, who, id, filters, (e) => handlers.onevent(e), () => { if (--pending === 0 && handlers.oneose) handlers.oneose(); })
          .then(w => { if (closed) w.close(); else { mine.push(w); sockets.push(w); } })
          .catch(() => { if (--pending === 0 && handlers.oneose) handlers.oneose(); });
      }
      return { close() { closed = true; mine.forEach(w => { try { w.close(); } catch {} }); } };
    },
    // nostr-tools' shape (2.x): one promise per relay — resolved when that relay says OK true, REJECTED when it
    // refuses, and RESOLVED with "connection failure: …" when it cannot be reached (audit of b4ac50d, C2x)
    publish(urls, evt) {
      return urls.map(u => publishTo(u, evt).then(([ok, why]) => { if (!ok) throw new Error(why || 'refused'); return why; },
        () => 'connection failure: ' + u));
    },
    closeAll() { sockets.forEach(w => { try { w.close(); } catch {} }); },
  };
}
// A pool that hands the shipped code exactly the deliveries a test scripts. Subscriptions are told apart by
// their filter: the notices ask for a `#d`.
export function scriptedPool() {
  const subs = [];
  return {
    subscribeMany(_r, filters, handlers) { const s = { filters, handlers }; subs.push(s); return { close() {} }; },
    notices: () => subs.filter(s => s.filters.some(f => f['#d'])).at(-1),
    rebuild: () => subs.filter(s => !s.filters.some(f => f['#d'])).at(-1),
  };
}
export function memStorage() {
  const m = new Map();
  return {
    get length() { return m.size; }, key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    _map: m,
  };
}
// Publishing to real relays the way _publishAny does: to every relay, resolved when any accepted.
export function realPublish(relays) {
  return async (evt) => {
    const rs = await Promise.all(relays.map(u => publishTo(u, evt).catch(() => [false, 'unreachable'])));
    if (!rs.some(r => r[0])) throw new Error(rs.map(r => r[1]).join('; '));
    return true;
  };
}

// ── the member app, one "boot": a fresh module scope over a SHARED localStorage ────────────────────────────────
// opts: { relays, pool, publish, setTimeout, reseated: Map(cp -> Set(old keys)) }
export function memberBoot(parent, storage, opts = {}) {
  const relays = opts.relays || [];
  const pool = opts.pool || realPool(parent);
  const events = [];
  const ctx = {
    sk: parent.sk, pub: parent.pub, NET: 'trinityone', GUARDNOTICE_D: 'trinityone/guardnotice:',
    localStorage: storage,
    toPub: (x) => (/^[0-9a-f]{64}$/i.test(String(x || '')) ? String(x).toLowerCase() : null),
    _dtag: dOf,
    displayFor: () => ({ name: '' }),
    _openChurchDoc: () => null,   // only reached by _noteReseat for a sealed vouched name, which these tests do not use
    _reseatOld: opts.reseated || new Map(),
    // esbuild's name for the signer in this bundle. JSON round trip: a template built inside the vm is another
    // realm's object, which nostr-tools' validator refuses.
    finalizeEvent2: (t, sk) => finalizeEvent(JSON.parse(JSON.stringify(t)), sk),
    decrypt: nip44.decrypt, getConversationKey: nip44.getConversationKey,
    publishSetFor: () => relays, relaysForChurch: () => relays, churchRelays: () => relays,
    _publishAny: async (_r, evt) => (opts.publish || realPublish(relays))(evt),
    pool,
    profiles: {}, _k0Seen: new Set(), _needAuth: false,
    _docsHubs: new Map(), _hubSince: () => 0, _hubEosed: () => {}, _docsHubSaveSoon: () => {},
    _featureFailed: (...a) => { events.push({ type: 'feature-failed', detail: a }); },
    window: { Fellowship: { myProfile: null }, dispatchEvent(ev) { events.push(ev); return true; } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    console: { warn() {}, log() {} },
    setTimeout: opts.setTimeout || setTimeout, clearTimeout, Promise, JSON, Math, Date, Set, Map, Object, Array, String, Number, Error,
  };
  vm.createContext(ctx);
  vm.runInContext([
    topVar(FELLOWSHIP, 'FAMILY_KEY'), topVar(FELLOWSHIP, 'FAMILY_REMOVED_KEY'), topVar(FELLOWSHIP, '_unlinkedNow'),
    topVar(FELLOWSHIP, '_retractedNow'), topVar(FELLOWSHIP, '_ownReqAt'), topVar(FELLOWSHIP, '_noticeSeen'),
    topVar(FELLOWSHIP, 'NOTICE_SEEN_KEY'), topLevel(FELLOWSHIP, '_noticeSeenGet'), topLevel(FELLOWSHIP, '_noticeSeenSet'),
    topVar(FELLOWSHIP, '_noticeApplied'), topVar(FELLOWSHIP, '_heldReqs'), topVar(FELLOWSHIP, '_rebuildAnswered'),
    topLevel(FELLOWSHIP, '_forgetFamilySession'), topLevel(FELLOWSHIP, '_stampUnapplied'), topLevel(FELLOWSHIP, '_releaseHeld'),
    topLevel(FELLOWSHIP, '_maybeRebuildFamily'),
    // the church-docs hub, for the tests of when the rebuild runs: the SHIPPED _docsHubOpen and refetchChurchDocs.
    // Its EOSE path is what is driven; the names it only touches on that path are no-ops here.
    ...(opts.withHub ? [topLevel(FELLOWSHIP, '_docsHubOpen'), topLevel(FELLOWSHIP, 'refetchChurchDocs')] : []),
    topVar(FELLOWSHIP, '_familyAnswered'), topVar(FELLOWSHIP, '_isRetractedReq'), topVar(FELLOWSHIP, '_hex64'),
    topVar(FELLOWSHIP, '_ownRequestKnown'),
    topLevel(FELLOWSHIP, '_newerDoc'), topLevel(FELLOWSHIP, '_superseded'), topLevel(FELLOWSHIP, '_loadChildren'),
    topLevel(FELLOWSHIP, '_loadRemovedChildren'), topLevel(FELLOWSHIP, '_saveChildLink'), topLevel(FELLOWSHIP, '_removeChildLink'),
    topLevel(FELLOWSHIP, '_familyChanged'), topLevel(FELLOWSHIP, '_retractGuardReq'), topLevel(FELLOWSHIP, '_applyGuardianList'),
    topLevel(FELLOWSHIP, '_rebuildFamily'),
    // the re-seat document's arrival (sim item 30): _noteReseat fills the `_reseatOld` this rig is handed, and now also
    // purges the family list, so a test can deliver a re-seat to a parent's phone in either order with the notice
    topVar(FELLOWSHIP, 'RESEAT_D'), topVar(FELLOWSHIP, '_reseatAt'), topVar(FELLOWSHIP, '_churchRoster'), topVar(FELLOWSHIP, '_reseatNamed'),
    topLevel(FELLOWSHIP, '_dropSupersededChildren'), topLevel(FELLOWSHIP, '_noteReseat'),
    'globalThis.API = {',
    method(FELLOWSHIP, 'subscribeGuardianNotices() {', 'subscribeGuardianNotices') + ',',
    method(FELLOWSHIP, 'familyAnswered(churchNpub) {', 'familyAnswered') + ',',
    method(FELLOWSHIP, 'clearCommunityCache() {', 'clearCommunityCache') + ',',
    method(FELLOWSHIP, 'myChildren(churchNpub) {', 'myChildren') + ',',
    '_rebuildFamily, _noteReseat };',
  ].join('\n'), ctx);
  const api = ctx.API;
  return {
    api, events, ctx,
    shown: (church) => api.myChildren(church).map(c => c.child),
    entries: (church) => api.myChildren(church),
    close: () => { if (pool.closeAll) pool.closeAll(); },
  };
}

// ── the console's notice functions ────────────────────────────────────────────────────────────────────────────
// opts: { relays, pool, retryMs }. Publishes through the real relays (every one, with the shipped retries;
// `retryMs` stands in for GUARD_RETRY_MS so a test need not wait two minutes); `published` records every notice
// it signed, once.
export function consoleBoot(church, opts = {}) {
  let relays = opts.relays || [];
  const published = [];
  const events = [];
  const stamps = new Map();
  const base = opts.pool || realPool(church);
  const pool = {
    ...base,
    subscribeMany: (...a) => base.subscribeMany(...a),
    closeAll: () => { if (base.closeAll) base.closeAll(); },
    publish: (urls, evt) => { if (!published.some(e => e.id === evt.id)) published.push(evt); return base.publish(urls, evt); },
  };
  const ctx = {
    sk: church.sk, pub: church.pub, churchPub: church.pub, churchSk: church.sk, actingChurch: '',
    churchSkHeld: () => true,
    NET: 'trinityone', GUARDNOTICE_D: 'trinityone/guardnotice:', GUARDIANS_D: 'trinityone/guardians:', GUARDREQ_D: 'trinityone/guardreq:',
    decode: nip19decode,
    encrypt3: nip44.encrypt, getConversationKey: nip44.getConversationKey,
    finalizeEvent2: (t, sk) => finalizeEvent(JSON.parse(JSON.stringify(t)), sk),
    // _monotonic's contract (strictly increasing created_at per d-tag on this console), without its skew machinery
    _monotonic: (t) => { const d = dOf(t); const last = stamps.get(d) || 0; const at = Math.max(t.created_at, last + 1); stamps.set(d, at); return { ...t, created_at: at }; },
    // publish() is reached only when the church has no relay at all (its refusal path); record and refuse
    publish: async (evt) => { if (!published.some(e => e.id === evt.id)) published.push(evt); return false; },
    _waitForRegistration: async () => {},
    window: { dispatchEvent(ev) { events.push(ev); return true; } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    now, localStorage: opts.storage || memStorage(),
    pool, relays: () => relays,
    stewardedChurches: new Map(),
    _authFuture: () => false, _byChurch: (e) => e.pubkey === church.pub,
    console: { warn() {}, log() {} },
    Promise, JSON, Math, Date, Set, Map, Object, Array, String, Number, Error, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext([
    topLevel(STEWARD, 'toPubHex'), topLevel(STEWARD, '_childrenOfParent'), topLevel(STEWARD, '_closedChildrenOfParent'),
    topVar(STEWARD, '_guardScopes'), topLevel(STEWARD, '_guardScope'),
    topLevel(STEWARD, '_sendGuardNotice'), topVar(STEWARD, '_latestGuardNotice'), topLevel(STEWARD, '_guardTryOn'),
    topLevel(STEWARD, '_publishGuardNotice'),
    opts.retryMs ? 'var GUARD_RETRY_MS = ' + JSON.stringify(opts.retryMs) + ';' : topVar(STEWARD, 'GUARD_RETRY_MS'),
    'globalThis.API = {',
    method(STEWARD, 'notifyGuardian(parentPubIn, childPubIn, childName, links, closed, scope) {', 'notifyGuardian') + ',',
    method(STEWARD, 'notifyGuardianRemoved(parentPubIn, childPubIn, links, alsoRemoved, closed, scope) {', 'notifyGuardianRemoved') + ',',
    method(STEWARD, 'notifyGuardianList(parentPubIn, links, closed, scope) {', 'notifyGuardianList') + ',',
    method(STEWARD, 'subscribeGuardians(onData) {', 'subscribeGuardians') + ',',
    method(STEWARD, 'subscribeGuardianRequests(onReqs) {', 'subscribeGuardianRequests') + ',',
    method(STEWARD, 'guardNoticeScope() {', 'guardNoticeScope') + ',',
    '};',
  ].join('\n'), ctx);
  // switch the console to another identity in place, as setActiveIdentity does (key, church, relay set)
  const become = (who, newRelays) => { ctx.sk = who.sk; ctx.pub = who.pub; ctx.churchPub = who.pub; ctx.churchSk = who.sk; relays = newRelays || relays; };
  return { api: ctx.API, published, events, ctx, become, close: () => { if (ctx.pool.closeAll) ctx.pool.closeAll(); } };
}

// ── documents as the real writers sign them ───────────────────────────────────────────────────────────────────
// A notice exactly as the console's _sendGuardNotice signs one, for tests that stage what a relay holds.
export const noticeEvt = (church, parent, obj, created_at) => finalizeEvent({ kind: 30078, created_at,
  tags: [['d', 'trinityone/guardnotice:' + parent.pub], ['t', 'trinityone'], ['p', parent.pub]],
  content: nip44.encrypt(JSON.stringify(obj), nip44.getConversationKey(church.sk, parent.pub)) }, church.sk);
// A guardian request as createChildAccount signs one (live) or _retractGuardReq (retracted).
export const reqEvt = (church, parent, kid, created_at, live = true) => finalizeEvent({ kind: 30078, created_at,
  tags: [['d', 'trinityone/guardreq:' + kid.pub], ['t', 'trinityone'], ['p', church.pub], live ? ['p', kid.pub] : ['deleted', '1']],
  content: live ? JSON.stringify({ child: kid.pub, parent: parent.pub }) : '' }, parent.sk);
export const memberEvt = (church, who, created_at = now() - 120) => finalizeEvent({ kind: 30078, created_at,
  tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['p', church.pub]], content: JSON.stringify({ joined: created_at }) }, who.sk);
export const decryptNotice = (parent, e) => JSON.parse(nip44.decrypt(e.content, nip44.getConversationKey(parent.sk, e.pubkey)));
