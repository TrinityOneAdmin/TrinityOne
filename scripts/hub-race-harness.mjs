// Shared rig for the church-hub "a cancelled fetch is not an answer" tests (2026-11-18). NOT a test file.
//
// It runs the SHIPPED member-app hub: the docs hub, the members hub, the NIP-42 signer, the post-auth reconnect
// and the readers that act on the hub's answer (devotionals, plans, members, the safeguarding lists, the sealed
// name sync), lifted out of vendor/fellowship.js by the names esbuild gave them and run over a REAL nostr-tools
// SimplePool. Only their surroundings are supplied. A name the lifted code needs and this rig does not supply is
// recorded in `missing` and thrown as a ReferenceError naming it, never an undefined swallowed by one of the hub's
// many try/catch blocks (memory: lifted bundle functions need BUNDLE names).
//
// Used by:
//   scripts/a-cancelled-fetch-does-not-end-the-daily-full-sync.test.mjs   (real scripts/gateway.mjs)
//   scripts/a-cancelled-fetch-is-not-an-answer.test.mjs                   (scriptedRelay below)
//
// Plan: TrinityOne-internal/reference/PLAN-hub-cancelled-fetch-not-full-2026-11-18.md (+ its audit).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { npubEncode, decode } from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';
import { fnBody, stmt } from './test-slice.mjs';

export const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
export const nowS = () => Math.floor(Date.now() / 1000);
export const dOf = (e) => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '';
export async function until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(25); } return false; }
export const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _map: m }; };

// A real congregation name-key envelope for `member`, sealed by the church key, the shape _ingestNameKey opens.
export function nameKeyEnvelope(church, member, created_at) {
  const key = Buffer.from(generateSecretKey()).toString('hex');
  const content = JSON.stringify({ keys: { [member.pub]: nip44.encrypt(JSON.stringify([key]), nip44.getConversationKey(church.sk, member.pub)) } });
  return finalizeEvent({ kind: 30078, created_at, tags: [['d', 'trinityone/namekey:' + church.pub], ['t', 'trinityone']], content }, church.sk);
}

// ── lifting ───────────────────────────────────────────────────────────────────────────────────────────────────
const V = FELLOWSHIP;
const fn = (name) => fnBody(V, '\n  function ' + name + '(', name);
const vr = (name) => stmt(V, 'var ' + name + ' = ', name);
const method = (sig, name, prefix = '') => { const b = fnBody(V, sig, name); return prefix + name + b.slice(b.indexOf('(')); };
// Everything from the hub's constants to the end of its EOSE helper, as one slice: whatever the hub's own small
// helpers become, the rig runs all of them rather than a hand-picked list that could fall behind.
function hubCore() {
  const a = V.indexOf('\n  var SINCE_SLOP = ');
  const b = V.indexOf('\n  var RESEAT_D = ', a);
  assert.ok(a !== -1 && b > a, 'the hub constants block (SINCE_SLOP … RESEAT_D) moved in vendor/fellowship.js — re-anchor this rig');
  return V.slice(a, b);
}

// Is the 2026-11-19 refull helper in this bundle? (absent on the base the Step 0 tests are first run against)
export const HAS_REFULL = V.includes('\n  function _refullChurchHubs(');

function scopeOf(stubs, missing) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      missing.push(String(k));
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// ── the member app, one boot ──────────────────────────────────────────────────────────────────────────────────
// opts: { me, relays: string[] (mutable via app.setRelays), storage, locked (sk unset until unlock()),
//         holdAuth (sk set, but the signer waits on window.Fellowship.ready until releaseAuth()), clock: Date class,
//         announce (also lift the SHIPPED announceMembership + the join-sent stamp, for the open-church join tests),
//         publishAny (replace the transport stub below), realAdmitted (lift the SHIPPED _noteAdmitted instead of the
//         no-op stub), onReq(rec) (called as each REQ is recorded, to read hub state at that instant) }
// T-A and T-B pass none of the three new options, so they get exactly the rig they had.
export function memberApp(opts) {
  const { me } = opts;
  const missing = [], failures = [], published = [], reqs = [], authRefetch = [];
  let relays = [...(opts.relays || [])];
  const storage = opts.storage || memStorage();
  const pool = new SimplePool();
  // Record every REQ the hub sends (the filters as sent), then hand it to the real pool. The shipped empty-list
  // wrapper is lifted ON TOP of this, exactly as it wraps the real pool in the bundle.
  const realSubMany = pool.subscribeMany.bind(pool);
  pool.subscribeMany = (urls, filters, params) => {
    const rec = { at: Date.now(), urls: [...urls], filters: JSON.parse(JSON.stringify(filters)) };
    reqs.push(rec); if (opts.onReq) { try { opts.onReq(rec); } catch {} }
    return realSubMany(urls, filters, params);
  };
  let releaseReady;
  // holdAuth: the key is coming, and the signer parks on `ready` until releaseAuth(). locked: a PIN-locked boot —
  // init() has already resolved `ready` keyless, so the shipped signer throws 'no key' and that socket never auths.
  const ready = opts.holdAuth ? new Promise(r => { releaseReady = r; }) : Promise.resolve();
  const t = {
    sk: opts.locked ? null : (opts.holdAuth ? undefined : me.sk), pub: me.pub,
    pool, localStorage: storage,
    window: {
      Fellowship: {
        ready, myPubkey: me.pub, myProfile: { name: 'Ruth' }, relays: [...relays],
        publishSealedName: async (cp, nm) => { published.push({ cp, nm, ring: (t._nameKeys.get(cp) || []).length, at: Date.now() }); return true; },
      },
      dispatchEvent() { return true; },
    },
    CustomEvent: class { constructor(ty, o) { this.type = ty; this.detail = o && o.detail; } },
    // the signer's surroundings: a member who needs auth, on a relay the admission gate has proved
    _needAuth: true, _gate: { admits: () => true },
    _relayAuthedAt: 0, _relayAuthOkAt: 0, _relayAuth: new Map(), _authRefetchArmed: false, _authRefetchT: null,
    // The shipped 1.3 s post-auth timer is RECORDED, not run: the test calls refetchChurchDocs itself at the point
    // that timer would, so nothing here is a wall-clock race.
    _armAuthRefetch: () => { authRefetch.push(Date.now()); },
    normalizeURL2: normalizeURL, finalizeEvent2: finalizeEvent, decode, npubEncode,
    decrypt: nip44.decrypt, getConversationKey: nip44.getConversationKey,
    relaysForChurch: () => relays, churchRelays: () => relays,
    _docsHubs: new Map(), _memHubs: new Map(), _sharedSubs: new Map(), _churchRelays: new Map(), CANONICAL_RELAYS: [],
    _churchRoster: new Map(), _nameKeys: new Map(), _nameKeyTs: new Map(), _nameKeyListeners: new Set(),
    // hub-level absorbers that are not under test here
    _absorbRoster: () => false, _absorbVoice: () => false, _ingestGroupKey: () => {}, _ingestCareKey: () => {},
    // _widgetSeen (home-screen widget count clear) is native-only and returns at once without a Capacitor bridge,
    // which is exactly this rig; the hub saves call it before their localStorage write.
    _widgetSeen: () => {},
    _noteAdmitted: () => {}, _replayChurchCalendar: () => {}, _replayReseats: () => {}, _recoverOwnName: () => {},
    _openSealedName: () => false, _replaySealedNames: () => {}, _noteReseat: () => {}, _maybeRebuildFamily: () => {},
    _featureFailed: (where, d, err) => { failures.push(where + ' ' + d + ': ' + (err && err.message)); },
    loadDocCache: () => [], saveDocCache: () => {}, scheduleVisible: (a) => a, scheduleNextReveal: () => null,
    loadMembersCache: () => [], saveMembersCache: () => {}, _superseded: () => false, profiles: {}, saveProfiles: () => {},
    _noPhoto: new Set(), pubSet: (a) => new Set(a || []), _sgSelf: null,
    console: { error: (...a) => failures.push('console.error ' + a.map(String).join(' ')), warn() {}, log() {} },
    // announceMembership's surroundings (opts.announce). The TRANSPORT is a stub, but it is the shipped rule:
    // allSettled, and only a relay that actually said OK counts. nostr-tools RESOLVES an undialable relay with
    // "connection failure: …", so Promise.any would count a dead relay as an acceptance (plan audit F8).
    _publishAny: opts.publishAny || ((urls, evt) => Promise.allSettled(pool.publish(urls, evt)).then(rs => {
      if (!rs.some(r => r.status === 'fulfilled' && !/^connection failure/.test(String(r.value)))) throw new Error('no relay accepted');
    })),
    publishSetFor: () => relays, _announceBlocked: () => false, _leaveGen: {}, _queueJoinIntent: () => {},
    _outbox: [], _outboxSave: () => {}, _outboxDropJoins: () => false, _resendJoinToBoxesGainedInFlight: () => {},
  };
  if (opts.clock) t.Date = opts.clock;
  const scope = scopeOf(t, missing);
  const body = [
    vr('NET'), vr('MEMBER_D'), vr('GROUPKEY_D'), vr('NAMEKEY_D'), vr('CAREKEY_D'), vr('CARE_D'), vr('APPROVED_D'), vr('VOICE_D'), vr('ADMITTED_D'), vr('RESEAT_D'),
    vr('_mayCache'), vr('_sealedMine'), vr('_unhexF'),
    hubCore(),
    fn('toPub'), fn('_dkeyOf'), fn('_hubBufSet'), fn('_coalesce'), fn('_churchVoice'),
    fn('_pickWinner'), fn('_reduceVersions'), fn('_seedFromCache'), fn('_absorbById'), fn('_tombstoneTargets'), fn('_forgetById'), fn('_reduceAll'),
    fn('_ingestNameKey'), fn('_ringId'),
    fn('_docsHubSaveNow'), fn('_docsHubSaveSoon'), fn('_docsHub'), fn('_docsHubOpen'), fn('_onChurchDocs'), fn('refetchChurchDocs'),
    fn('_memHubSaveNow'), fn('_memHubSaveSoon'), fn('_memHub'), fn('_memHubOpen'), fn('_onChurchMembers'),
    fn('_noteAuthAccepted'), fn('reconnectAll'),
    // the shared "the relay now counts us" refull (2026-11-19) — lifted only if the bundle has it, so the Step 0
    // tests run against the bundle from before it existed
    ...(HAS_REFULL ? [fn('_refullChurchHubs')] : []),
    ...(opts.announce ? [vr('_lastStampF'), fn('_monotonicF'), vr('JOINSENT_KEY'), vr('_joinSent'), fn('_joinSentLoad'), fn('_joinSentSave'),
      fn('_markJoinSent'), fn('_joinSentFor'), '_joinSentLoad();'] : []),
    ...(opts.realAdmitted ? [vr('ADMITTED_OK_LS'), vr('_admittedDone'), fn('_noteAdmitted')] : []),
    stmt(V, 'var _poolSubMany = pool.subscribeMany.bind(pool);', '_poolSubMany'),
    stmt(V, 'pool.subscribeMany = (urls, filters, handlers) =>', 'the shipped empty-relay-list wrapper'),
    stmt(V, 'pool.automaticallyAuth = (url) =>', 'the shipped NIP-42 signer'),
    'return {',
    method('    subscribeChurchPlans(churchNpub, onPlans) {', 'subscribeChurchPlans') + ',',
    method('    subscribeChurchDevotionals(churchNpub, onDevos) {', 'subscribeChurchDevotionals') + ',',
    method('    subscribeChurchMembers(churchNpub, onMembers) {', 'subscribeChurchMembers') + ',',
    method('    subscribeChurchSafeguard(churchNpub, onLists) {', 'subscribeChurchSafeguard') + ',',
    method('    async syncSealedNames(churchNpubs) {', 'syncSealedNames', 'async ') + ',',
    ...(opts.announce ? [method('    async announceMembership(npubOrHex) {', 'announceMembership', 'async ') + ','] : []),
    ...(HAS_REFULL ? ['_refullChurchHubs,'] : []),
    '_docsHub, _memHub, _onChurchDocs, _onChurchMembers, refetchChurchDocs, reconnectAll };',
  ].join('\n');
  const api = new Function('scope', 'with (scope) {\n' + body + '\n}')(scope);
  t.window.Fellowship.syncSealedNames = (...a) => api.syncSealedNames(...a);
  if (opts.announce) t.window.Fellowship.announceMembership = (...a) => api.announceMembership(...a);
  return {
    api, t, reqs, published, missing, failures, authRefetch, storage, pool,
    setRelays: (r) => { relays = [...r]; t.window.Fellowship.relays = [...r]; },
    // the key arrives (holdAuth: the signer that is waiting on `ready` now signs)
    releaseAuth: () => { t.sk = me.sk; releaseReady(); },
    // a PIN-locked boot's unlock, in the shipped order (deriveFromIdentity): the key is derived, then reconnectAll
    unlock: () => { t.sk = me.sk; api.reconnectAll(); },
    docsHub: (cp) => t._docsHubs.get(cp),
    memHub: (cp) => t._memHubs.get(cp),
    lastReq: () => reqs[reqs.length - 1],
    hubReqs: (cp) => reqs.filter(r => r.filters.some(f => (f.authors && f.authors[0] === cp) || (f['#church'] && f['#church'][0] === cp))),
    memReqs: (cp) => reqs.filter(r => r.filters.some(f => f['#p'] && f['#p'][0] === cp && (f.kinds || []).includes(30078))),
    persisted: (key) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } },
    close: () => { try { pool.destroy(); } catch {} },
    clean: () => { assert.deepEqual([...new Set(missing)], [], 'the lifted code reached a name the rig does not supply'); assert.deepEqual(failures, [], 'a lifted handler threw'); },
  };
}
// Does this REQ ask for everything (no `since` on the docs filters)?
export const isFull = (req) => req.filters.filter(f => (f.kinds || []).includes(30078)).every(f => !f.since);

// ── a scripted relay ──────────────────────────────────────────────────────────────────────────────────────────
// A real websocket server the test steers, so nostr-tools' own deferred close and handleClose -> handleEose run
// for real. It models the gateway's lazy NIP-42: a gated doc is served only to an authenticated socket; a REQ that
// had something withheld draws an AUTH challenge; the EOSE is held until AUTH (then the withheld docs are replayed
// to every sub still open, and the held EOSE flushed) or until `graceMs` runs out.
//
// mode: 'gate'        — as above (the default)
//       'hold'        — EOSE only when the test calls eose()
//       'closed-auth' — answer every REQ with CLOSED auth-required:
export async function scriptedRelay(port) {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  await new Promise((res, rej) => { wss.once('listening', res); wss.once('error', rej); });
  const r = {
    url: `ws://127.0.0.1:${port}/`, mode: 'gate', graceMs: 2500, challengeEveryReq: false, replayDelayMs: 0, refuseAuth: false,
    docs: [],            // { evt, gated }
    log: [],             // { t, dir, msg }
    socks: new Set(),
    add(evt, gated) { r.docs.push({ evt, gated }); },
    eose(sid) { for (const s of r.socks) for (const [id] of s.subs) if (!sid || id === sid) { s.send(['EOSE', id]); s.held.delete(id); } },
    rawEose(sid) { for (const s of r.socks) s.send(['EOSE', sid]); },
    challenge() { for (const s of r.socks) s.send(['AUTH', s.challenge]); },
    subIds: () => r.log.filter(l => l.dir === 'in' && l.msg[0] === 'REQ').map(l => l.msg[1]),
    closes: () => r.log.filter(l => l.dir === 'in' && l.msg[0] === 'CLOSE').map(l => l.msg[1]),
    close: () => new Promise(res => { for (const s of r.socks) try { s.ws.terminate(); } catch {} wss.close(() => res()); }),
  };
  const match = (f, e) => {
    if (f.kinds && !f.kinds.includes(e.kind)) return false;
    if (f.authors && !f.authors.includes(e.pubkey)) return false;
    if (f.since && e.created_at < f.since) return false;
    for (const k of Object.keys(f)) if (k[0] === '#') { const n = k.slice(1); if (!e.tags.some(tg => tg[0] === n && f[k].includes(tg[1]))) return false; }
    return true;
  };
  wss.on('connection', (ws) => {
    const s = { ws, authed: null, challenge: 'c' + Math.random().toString(36).slice(2), subs: new Map(), held: new Map(), challenged: false,
      send: (m) => { r.log.push({ t: Date.now(), dir: 'out', msg: m }); try { ws.send(JSON.stringify(m)); } catch {} } };
    r.socks.add(s);
    ws.on('close', () => r.socks.delete(s));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      r.log.push({ t: Date.now(), dir: 'in', msg: m });
      if (m[0] === 'REQ') {
        // nostr-tools 2.23.5 subscribeMany sends the filter ARRAY as one element: ['REQ', id, [f1, f2]]. Flatten.
        const [, id, ...rest] = m; const filters = rest.flat();
        if (r.mode === 'closed-auth') { s.send(['CLOSED', id, 'auth-required: this relay serves members only']); return; }
        s.subs.set(id, filters);
        let withheld = false;
        const seen = new Set();
        for (const { evt, gated } of r.docs) {
          if (!filters.some(f => match(f, evt)) || seen.has(evt.id)) continue;
          seen.add(evt.id);
          if (gated && !s.authed) { withheld = true; continue; }
          s.send(['EVENT', id, evt]);
        }
        if ((withheld || r.challengeEveryReq) && !s.authed && !s.challenged) { s.challenged = true; s.send(['AUTH', s.challenge]); }
        if (r.mode === 'hold') return;
        if (withheld && !s.authed) {
          s.held.set(id, setTimeout(() => { if (s.subs.has(id) && s.held.has(id)) { s.held.delete(id); s.send(['EOSE', id]); } }, r.graceMs));
          return;
        }
        s.send(['EOSE', id]);
      } else if (m[0] === 'CLOSE') {
        s.subs.delete(m[1]);
      } else if (m[0] === 'AUTH') {
        const ev = m[1];
        const ok = !r.refuseAuth && ev && ev.kind === 22242 && verifyEvent(ev) && ev.tags.some(tg => tg[0] === 'challenge' && tg[1] === s.challenge);
        s.send(['OK', ev && ev.id, !!ok, ok ? '' : (r.refuseAuth ? 'restricted: auth refused (clock outside the window)' : 'auth-required: bad auth')]);
        if (!ok) return;
        s.authed = ev.pubkey;
        // replay the withheld docs to every sub still open on this socket, then flush the held EOSEs. `replayDelayMs`
        // puts the replay in a later packet than the OK, as it is on a real network.
        const replay = () => {
          for (const [id, filters] of s.subs) {
            for (const { evt, gated } of r.docs) if (gated && filters.some(f => match(f, evt))) s.send(['EVENT', id, evt]);
            if (s.held.has(id)) { clearTimeout(s.held.get(id)); s.held.delete(id); s.send(['EOSE', id]); }
          }
        };
        if (r.replayDelayMs) setTimeout(replay, r.replayDelayMs); else replay();
      }
    });
  });
  return r;
}
