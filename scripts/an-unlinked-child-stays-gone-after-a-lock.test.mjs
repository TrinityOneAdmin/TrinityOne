// A CHILD THE CHURCH UNLINKED FROM A PARENT MUST NOT COME BACK ON THE PARENT'S PHONE AFTER A PIN LOCK.
// Run: node --test scripts/an-unlinked-child-stays-gone-after-a-lock.test.mjs
//
// FIX-PLAN-2026-10-01 item 1(b), confirmed by running before the fix. The steward unlinks a parent from a
// child; the church's removal notice reaches the parent's app, which dropped the child from its family list
// and remembered the removal in `trinityone.family.removed`. Both live under `trinityone.family*`, which the
// locked-boot wipe takes. So after a lock the list AND the memory of the removal were gone, _rebuildFamily read
// the parent's own guardian-link request — still on the relay — and the child was back on the family screen.
//
// OWNER'S DECISION, 2026-10-01: the parent's app deletes its own request on the relay when told of the removal.
// Nothing about the removal is kept on the phone (a seized locked phone must not list children).
//
// THIS DRIVES THE SHIPPED CODE OVER A REAL RELAY: the removal notice is church-signed, sealed to the parent,
// stored by scripts/gateway.mjs and delivered over an authenticated websocket to the SHIPPED
// subscribeGuardianNotices; the lock is the SHIPPED clearCommunityCache; the rebuild is the SHIPPED
// _rebuildFamily, run in a FRESH module scope sharing only localStorage — a cold boot after the lock, with no
// in-memory state carried over; and what the family screen would show is the SHIPPED myChildren.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8981;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), parent = K();
const removedKid = K();   // the steward unlinks the parent from this one
const keptKid = K();      // CONTROL: still linked — the rebuild must find it, or it proves nothing
const legacyKid = K();    // unlinked under the OLD build, recorded only in trinityone.family.removed
let relay, dataDir;

const F = readFileSync(ROOT + 'vendor/fellowship.js', 'utf8');

// ── the relay ───────────────────────────────────────────────────────────────────────────────────────────────
function conn() { return new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); }); }
function send(w, e) {
  return new Promise(res => {
    const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', e]));
    setTimeout(() => res([false, '(no reply)']), 5000);
  });
}
// A subscription as `who`, the way the real pool does it: REQ at once, answer the relay's NIP-42 challenge
// when it comes (lazy auth — the relay challenges only when it withheld something, then replays it).
async function sub(who, id, filters, onEvent, onEose) {
  const w = await conn();
  w.on('message', d => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH' && typeof m[1] === 'string') {
      w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    }
    if (m[0] === 'EVENT' && m[1] === id) onEvent(m[2]);
    if (m[0] === 'EOSE' && m[1] === id && onEose) onEose();
  });
  w.send(JSON.stringify(['REQ', id, ...filters]));
  return w;
}
// The parent's guardian requests as the relay serves them — by default to the parent itself; `as` / `filter`
// ask the way the steward console does (authenticated as the church, `#p: [church]`).
async function parentsRequests(as = parent, filter = { kinds: [30078], authors: [parent.pub] }) {
  const got = [];
  let w;
  await new Promise(async res => {
    w = await sub(as, 'q', [filter], e => got.push(e), res);
    setTimeout(res, 6000);
  });
  w.close();
  const out = {};
  for (const e of got) {
    const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (d.startsWith('trinityone/guardreq:')) out[d.slice('trinityone/guardreq:'.length)] = e;
  }
  return out;
}
const isLive = (e) => !!e && !e.tags.some(t => t[0] === 'deleted') && !!e.content;

before(async () => {
  await requireFreePort(PORT, 'an-unlinked-child-stays-gone-after-a-lock.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-unlinked-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const w = await conn();
  let [ok, why] = await send(w, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['p', church.pub]], content: JSON.stringify({ joined: now() }) }, parent.sk));
  assert.equal(ok, true, 'fixture: the parent could not join: ' + why);
  // Exactly the request createChildAccount signs, for each child.
  for (const kid of [removedKid, keptKid, legacyKid]) {
    [ok, why] = await send(w, finalizeEvent({ kind: 30078, created_at: now() - 60, tags: [['d', 'trinityone/guardreq:' + kid.pub], ['t', 'trinityone'], ['p', church.pub], ['p', kid.pub]], content: JSON.stringify({ child: kid.pub, parent: parent.pub }) }, parent.sk));
    assert.equal(ok, true, 'fixture: the guardian request could not be stored: ' + why);
  }
  w.close();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── the shipped code, lifted out of vendor/fellowship.js ──────────────────────────────────────────────────────
function topLevel(name) {
  const re = new RegExp('\\n  (async )?function ' + name + '\\([\\s\\S]*?\\n  \\}');
  const m = re.exec(F);
  assert.ok(m, `could not lift ${name} from the bundle — re-anchor this test, do not delete it`);
  return m[0];
}
function topVar(name) {
  const m = new RegExp('\\n  var ' + name + ' = [^\\n]*;').exec(F);
  assert.ok(m, `could not lift var ${name} from the bundle — re-anchor this test`);
  return m[0];
}
function method(sig, name) {
  const body = fnBody(F, sig, name);
  return name + body.slice(body.indexOf('('));
}

// One "boot" of the member app: a fresh module scope (fresh in-memory sets) over the SHARED localStorage.
// `opts` swaps in a scripted pool / publish / timer for the cases a single real relay cannot stage (two relays
// disagreeing, a publish that fails once, a relay that never answers). Everything else is the shipped code.
function boot(storage, opts = {}) {
  const sockets = [];
  const ctx = {
    sk: parent.sk, pub: parent.pub, NET: 'trinityone', GUARDNOTICE_D: 'trinityone/guardnotice:',
    localStorage: storage,
    toPub: (x) => (/^[0-9a-f]{64}$/i.test(String(x || '')) ? String(x) : null),
    _dtag: (e) => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '',
    displayFor: () => ({ name: '' }),
    // esbuild's name for the signer in this bundle. JSON round trip: a template built inside the vm is another
    // realm's object, which nostr-tools' validator refuses.
    finalizeEvent2: (t, sk) => finalizeEvent(JSON.parse(JSON.stringify(t)), sk),
    decrypt: nip44.decrypt, getConversationKey: nip44.getConversationKey,
    publishSetFor: () => [WS_URL], relaysForChurch: () => [WS_URL], churchRelays: () => [WS_URL],
    async _publishAny(_relays, evt) {
      if (opts.publish) return opts.publish(evt);
      const w = await conn();
      const [ok, why] = await send(w, evt); w.close();
      if (!ok) throw new Error(why);
      return true;
    },
    pool: opts.pool || {
      subscribeMany(_r, filters, handlers) {
        let w = null, closed = false;
        const id = 's' + Math.random().toString(36).slice(2, 8);
        sub(parent, id, filters, (e) => handlers.onevent(e), () => handlers.oneose && handlers.oneose()).then(sock => {
          if (closed) { sock.close(); return; }
          w = sock; sockets.push(sock);
        }).catch(() => {});
        return { close() { closed = true; try { w && w.close(); } catch (e) {} } };
      },
    },
    profiles: {}, _k0Seen: new Set(), _needAuth: false,
    window: { Fellowship: { myProfile: null }, dispatchEvent() {} },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    console: { warn() {}, log() {} },
    setTimeout: opts.setTimeout || setTimeout, clearTimeout, Promise, JSON, Math, Date, Set, Map, Object, Array, String, Number, Error,
  };
  vm.createContext(ctx);
  vm.runInContext([
    topVar('FAMILY_KEY'), topVar('FAMILY_REMOVED_KEY'), topVar('_unlinkedNow'), topVar('_retractedNow'),
    topVar('_retractedAt'), topVar('_assertedNow'), topVar('_noticeSeen'), topVar('_isRetractedReq'),
    topLevel('_newerDoc'), topLevel('_loadChildren'), topLevel('_loadRemovedChildren'), topLevel('_saveChildLink'),
    topLevel('_removeChildLink'), topLevel('_retractGuardReq'), topLevel('_assertGuardReq'), topLevel('_rebuildFamily'),
    'globalThis.API = {',
    method('subscribeGuardianNotices() {', 'subscribeGuardianNotices') + ',',
    method('clearCommunityCache() {', 'clearCommunityCache') + ',',
    method('myChildren(churchNpub) {', 'myChildren') + ',',
    '_rebuildFamily };',
  ].join('\n'), ctx);
  return { api: ctx.API, close: () => sockets.forEach(s => { try { s.close(); } catch (e) {} }) };
}

function memStorage() {
  const m = new Map();
  return {
    get length() { return m.size; }, key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    _map: m,
  };
}
const shown = (api) => api.myChildren(church.pub).map(c => c.child);
async function until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; }

test('an unlinked child stays gone after a PIN lock — notice, lock wipe, cold-boot rebuild', async () => {
  const storage = memStorage();
  // The parent's phone before the unlink: both children on the family screen, as createChildAccount left them.
  storage.setItem('trinityone.family', JSON.stringify([
    { child: removedKid.pub, name: 'Ada', churchPub: church.pub, ts: now() - 60 },
    { child: keptKid.pub, name: 'Ben', churchPub: church.pub, ts: now() - 60 },
  ]));

  // The steward unlinks: the console's notifyGuardianRemoved, church-signed and sealed to the parent.
  const w = await conn();
  const sealed = nip44.encrypt(JSON.stringify({ removed: removedKid.pub, church: church.pub }), nip44.getConversationKey(church.sk, parent.pub));
  const [ok, why] = await send(w, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/guardnotice:' + parent.pub], ['t', 'trinityone'], ['p', parent.pub]], content: sealed }, church.sk));
  w.close();
  assert.equal(ok, true, 'fixture: the relay refused the church’s removal notice: ' + why);

  // BOOT 1: the app subscribes to its notices, as app.jsx does once the engine is ready.
  const b1 = boot(storage);
  const unsub = b1.api.subscribeGuardianNotices();
  assert.ok(await until(() => !shown(b1.api).includes(removedKid.pub)),
    'the removal notice never reached the shipped handler over the relay — the rig is wrong, not the fix');
  assert.deepEqual(shown(b1.api), [keptKid.pub], 'the notice dropped the wrong child');
  // …and wait for what the fix adds: the parent's own request retracted on the relay.
  await until(async () => !isLive((await parentsRequests())[removedKid.pub]));
  unsub(); b1.close();

  // THE LOCK. The shipped wipe takes every trinityone.family* key — the list and anything remembered beside it.
  b1.api.clearCommunityCache();
  assert.equal(storage.getItem('trinityone.family'), null, 'fixture: the lock wipe no longer takes the family list');
  const left = [...storage._map.keys()].filter(k => k.startsWith('trinityone.family'));
  assert.deepEqual(left, [], 'something about the family survived the lock wipe on the phone: ' + left.join(', '));

  // BOOT 2, after unlocking: a fresh module scope — nothing in memory — and the rebuild the hub runs.
  const b2 = boot(storage);
  await b2.api._rebuildFamily(church.pub);
  b2.close();
  const after = shown(b2.api);
  assert.ok(after.includes(keptKid.pub),
    'CONTROL: the rebuild did not bring back the child who is STILL linked — the rig cannot see the relay, so the ' +
    'next assertion would pass for the wrong reason');
  assert.ok(!after.includes(removedKid.pub),
    'THE UNLINKED CHILD CAME BACK AFTER A PIN LOCK. The church removed this parent’s link; the lock wiped the ' +
    'phone’s record of that; and the rebuild re-added the child from the parent’s own guardian request, which ' +
    'is still live on the relay. Family screen shows: ' + JSON.stringify(after));

  // And on the relay: the request is a retraction now, so the console's pending list drops it too.
  const reqs = await parentsRequests();
  assert.ok(reqs[removedKid.pub] && !isLive(reqs[removedKid.pub]),
    'the parent’s guardian request for the unlinked child is still live on the relay');
  assert.ok(isLive(reqs[keptKid.pub]), 'the retraction reached a child it was not about');
  // …and the console SEES the retraction: it subscribes `#p: [church]` (steward.src.js subscribeGuardianRequests),
  // so a retraction without the church's p tag would replace the request where the console cannot read it.
  // Audit of 4f08ca4, finding 4.
  const consoleView = await parentsRequests(church, { kinds: [30078], '#p': [church.pub] });
  assert.ok(consoleView[removedKid.pub] && !isLive(consoleView[removedKid.pub]),
    'THE STEWARD CONSOLE CANNOT SEE THE RETRACTION — the retraction is not p-tagged to the church, so a ' +
    '`#p: [church]` subscription never receives it');
});

test('a removal an OLDER build recorded on the phone is retracted on the relay, then forgotten', async () => {
  // A phone that took the removal under the previous build: the child is off the family list and named in the
  // legacy trinityone.family.removed, while its request is still live on the relay. Not yet locked.
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([]));
  storage.setItem('trinityone.family.removed', JSON.stringify([legacyKid.pub]));
  const b = boot(storage);
  await b.api._rebuildFamily(church.pub);
  assert.ok(!shown(b.api).includes(legacyKid.pub), 'the rebuild resurrected a child this phone had recorded as removed');
  assert.ok(await until(async () => !isLive((await parentsRequests())[legacyKid.pub])),
    'the legacy removal was never retracted on the relay — the next lock would bring the child back');
  assert.ok(await until(() => storage.getItem('trinityone.family.removed') === null),
    'the legacy list outlived the retraction it was waiting for — the owner ruled nothing about a removal stays on the phone');
  b.close();
  // and now a lock plus a cold-boot rebuild cannot bring it back either
  b.api.clearCommunityCache();
  const b2 = boot(storage);
  await b2.api._rebuildFamily(church.pub);
  b2.close();
  assert.ok(!shown(b2.api).includes(legacyKid.pub), 'the legacy-removed child came back after a lock');
});


// ── AUDIT OF 4f08ca4 ──────────────────────────────────────────────────────────────────────────────────────────
const sealToParent = (obj) => nip44.encrypt(JSON.stringify(obj), nip44.getConversationKey(church.sk, parent.pub));
// What the console's notifyGuardian / notifyGuardianRemoved publish: church-signed, one slot per parent.
const noticeEvt = (obj, created_at) => finalizeEvent({ kind: 30078, created_at,
  tags: [['d', 'trinityone/guardnotice:' + parent.pub], ['t', 'trinityone'], ['p', parent.pub]], content: sealToParent(obj) }, church.sk);
const reqEvt = (kid, created_at, live = true) => finalizeEvent({ kind: 30078, created_at,
  tags: [['d', 'trinityone/guardreq:' + kid.pub], ['t', 'trinityone'], ['p', church.pub], live ? ['p', kid.pub] : ['deleted', '1']],
  content: live ? JSON.stringify({ child: kid.pub, parent: parent.pub }) : '' }, parent.sk);
const memberEvt = () => finalizeEvent({ kind: 30078, created_at: 1000,
  tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['p', church.pub]], content: '{}' }, parent.sk);
const dOf = (e) => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '';
function isRetracted(e) { return e.tags.some(t => t[0] === 'deleted') || !e.content; }
const retractionsOf = (evts, kid) => evts.filter(e => dOf(e) === 'trinityone/guardreq:' + kid.pub && isRetracted(e));
const liveReqsOf = (evts, kid) => evts.filter(e => dOf(e) === 'trinityone/guardreq:' + kid.pub && !isRetracted(e));
// A pool that hands the shipped code exactly the deliveries a test scripts — two relays disagreeing, or one
// that never answers. Subscriptions are told apart by their filter: the notices ask for a `#d`.
function scriptedPool() {
  const subs = [];
  return {
    subscribeMany(_r, filters, handlers) { const s = { filters, handlers }; subs.push(s); return { close() {} }; },
    notices: () => subs.filter(s => s.filters.some(f => f['#d'])).at(-1),
    rebuild: () => subs.filter(s => !s.filters.some(f => f['#d'])).at(-1),
  };
}

// FINDING 1, the exact sequence, end to end on the real relay.
test('a child the church RE-LINKS survives a later notice about a sibling, and a lock', async () => {
  const C = K(), D = K();
  const storage = memStorage();
  const w = await conn();
  const [ok, why] = await send(w, reqEvt(C, now() - 30));   // the parent set C up: createChildAccount's request
  assert.equal(ok, true, 'fixture: ' + why);
  storage.setItem('trinityone.family', JSON.stringify([{ child: C.pub, name: 'Cara', churchPub: church.pub, ts: now() - 30 }]));

  const b1 = boot(storage);
  const unsub = b1.api.subscribeGuardianNotices();
  await sleep(1500);   // the notice stored by the tests above is delivered first; let it settle
  const base = now() + 5;   // later than every notice stored above — the slot is newest-wins
  const say = async (obj, ts) => { const [k, y] = await send(w, noticeEvt(obj, ts)); assert.equal(k, true, 'fixture: the relay refused a notice: ' + y); };

  // 1. the steward unlinks C
  await say({ removed: C.pub, church: church.pub }, base);
  assert.ok(await until(() => !shown(b1.api).includes(C.pub)), 'the removal of C never reached the phone');
  assert.ok(await until(async () => !isLive((await parentsRequests())[C.pub])), 'the removal did not retract C’s request on the relay');
  // 2. the steward re-links C
  await say({ child: C.pub, name: 'Cara', church: church.pub }, base + 1);
  assert.ok(await until(() => shown(b1.api).includes(C.pub)), 'the re-link of C never reached the phone');
  assert.ok(await until(async () => isLive((await parentsRequests())[C.pub])),
    'THE RE-LINK DID NOT PUT THE PARENT’S REQUEST FOR C BACK ON THE RELAY — the only record of C is now a notice ' +
    'the next link will overwrite');
  // 3. the steward links D to the same parent — the one-slot notice now names D only
  await say({ child: D.pub, name: 'Dan', church: church.pub }, base + 2);
  assert.ok(await until(() => shown(b1.api).includes(D.pub)), 'the link of D never reached the phone');
  unsub(); b1.close(); w.close();

  // 4. a lock, then a normal boot: notices + the rebuild, as the app runs them
  b1.api.clearCommunityCache();
  const b2 = boot(storage);
  const unsub2 = b2.api.subscribeGuardianNotices();
  await b2.api._rebuildFamily(church.pub);
  await until(() => shown(b2.api).includes(D.pub));
  unsub2(); b2.close();
  const after = shown(b2.api);
  assert.ok(after.includes(D.pub), 'CONTROL: D, named by the current notice, is missing — the rig is wrong');
  assert.ok(after.includes(C.pub),
    'A CHILD THE CHURCH RE-LINKED IS GONE AFTER A LOCK. The re-link notice was overwritten by a later link for ' +
    'a sibling, and the parent’s own request for C was still the retraction. Family screen: ' + JSON.stringify(after));
});

// FINDING 9: only the newest notice counts — an older one from a second relay must not undo a newer one.
test('an OLDER removal notice arriving after a newer re-link is ignored', async () => {
  const E = K();
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([]));
  const P = scriptedPool(), sent = [];
  const b = boot(storage, { pool: P, publish: async (evt) => { sent.push(evt); return true; } });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(noticeEvt({ child: E.pub, church: church.pub }, 2000));     // relay A: the re-link
  P.notices().handlers.onevent(noticeEvt({ removed: E.pub, church: church.pub }, 1000));   // relay B, late: the old removal
  await sleep(50);
  assert.ok(shown(b.api).includes(E.pub), 'AN OLDER REMOVAL NOTICE UNDID A NEWER RE-LINK on the family screen');
  assert.equal(retractionsOf(sent, E).length, 0,
    'AN OLDER REMOVAL NOTICE RETRACTED THE PARENT’S REQUEST ON THE RELAY after a newer re-link — durably');
  P.notices().handlers.onevent(noticeEvt({ removed: E.pub, church: church.pub }, 3000));
  await sleep(50);
  assert.ok(!shown(b.api).includes(E.pub), 'CONTROL: a genuinely NEWER removal was ignored');
});

// FINDING 2: the legacy list is deleted only on proof.
test('the legacy removal list survives a rebuild that proved nothing — no answer, or an answer from nowhere', async () => {
  const L = K();
  const fast = (fn, ms) => setTimeout(fn, Math.min(ms, 30));
  for (const [label, drive] of [
    ['a relay that never answered (the rebuild timed out)', () => {}],
    ['an EOSE that served none of this parent’s documents', (r) => r.handlers.oneose()],
  ]) {
    const storage = memStorage();
    storage.setItem('trinityone.family.removed', JSON.stringify([L.pub]));
    const P = scriptedPool();
    const b = boot(storage, { pool: P, setTimeout: fast, publish: async () => true });
    const done = b.api._rebuildFamily(church.pub);
    drive(P.rebuild());
    await done; await sleep(30);
    assert.notEqual(storage.getItem('trinityone.family.removed'), null,
      'THE LEGACY REMOVAL LIST WAS DELETED AFTER ' + label.toUpperCase() + ' — nothing was retracted, so the ' +
      'request may still be live and the next lock brings the child back');
  }
  // CONTROL: a relay that answered with this parent's documents and no live request for L — proof of absence.
  const storage = memStorage();
  storage.setItem('trinityone.family.removed', JSON.stringify([L.pub]));
  const P = scriptedPool();
  const b = boot(storage, { pool: P, publish: async () => true });
  const done = b.api._rebuildFamily(church.pub);
  P.rebuild().handlers.onevent(memberEvt()); P.rebuild().handlers.oneose();
  await done; await sleep(30);
  assert.equal(storage.getItem('trinityone.family.removed'), null, 'CONTROL: a relay that answered did not let the legacy list go');
});

// FINDING 3: two relays, one missed the retraction.
test('a stale live request on a relay that missed the retraction does not bring the child back', async () => {
  const G = K();
  for (const order of ['retraction first', 'stale copy first']) {
    const storage = memStorage();
    storage.setItem('trinityone.family', JSON.stringify([]));
    const P = scriptedPool(), sent = [];
    const b = boot(storage, { pool: P, publish: async (evt) => { sent.push(evt); return true; } });
    const done = b.api._rebuildFamily(church.pub);
    const retraction = reqEvt(G, 2000, false), stale = reqEvt(G, 1000, true);
    const r = P.rebuild().handlers;
    r.onevent(memberEvt());
    for (const e of (order === 'retraction first' ? [retraction, stale] : [stale, retraction])) r.onevent(e);
    r.oneose();
    await done;
    assert.ok(!shown(b.api).includes(G.pub),
      'A STALE LIVE REQUEST FROM A SECOND RELAY BROUGHT AN UNLINKED CHILD BACK (' + order + ')');
    assert.ok(sent.some(e => e.id === retraction.id),
      'the relay that missed the retraction was never sent it again (' + order + ') — it will serve the stale copy for ever');
  }
});

// FINDING 4, second line: a retraction that has not landed — the rebuild skips the child AND retries.
test('a retraction that failed is retried by the rebuild, and the child is not re-added meanwhile', async () => {
  const H = K();
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([{ child: H.pub, name: 'Hal', churchPub: church.pub, ts: 900 }]));
  const P = scriptedPool(), sent = [];
  let failures = 1;
  const b = boot(storage, { pool: P, publish: async (evt) => { sent.push(evt); if (failures-- > 0) throw new Error('offline'); return true; } });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(noticeEvt({ removed: H.pub, church: church.pub }, 5000));
  await sleep(30);
  assert.equal(retractionsOf(sent, H).length, 1, 'fixture: the notice did not attempt a retraction');
  const done = b.api._rebuildFamily(church.pub);
  const r = P.rebuild().handlers;
  r.onevent(memberEvt()); r.onevent(reqEvt(H, 900, true)); r.oneose();
  await done; await sleep(30);
  assert.ok(!shown(b.api).includes(H.pub), 'THE REBUILD RE-ADDED A CHILD UNLINKED THIS SESSION whose retraction had not landed');
  assert.equal(retractionsOf(sent, H).length, 2, 'the rebuild found the request still live and did not retry the retraction');
});

// FINDING 4, third line: a steward re-link in the same session clears "unlinked this session".
test('a re-link in the same session lets the rebuild find the child again', async () => {
  const J = K();
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([{ child: J.pub, name: 'Jo', churchPub: church.pub, ts: 900 }]));
  const P = scriptedPool(), sent = [];
  const b = boot(storage, { pool: P, publish: async (evt) => { sent.push(evt); return true; } });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(noticeEvt({ removed: J.pub, church: church.pub }, 6000));
  P.notices().handlers.onevent(noticeEvt({ child: J.pub, name: 'Jo', church: church.pub }, 6001));
  await sleep(30);
  const live = liveReqsOf(sent, J);
  assert.equal(live.length, 1, 'the re-link did not re-publish the parent’s request for J');
  // The re-link came in while the retraction's publish was still in flight (both handled back to back). The
  // re-published request must still post-date the retraction, or the two tie on created_at and the relay
  // keeps whichever id happens to sort lower — a coin toss over whether the child survives the next lock.
  assert.ok(live[0].created_at > retractionsOf(sent, J)[0].created_at,
    'the re-published request (' + live[0].created_at + ') does not post-date the retraction (' +
    retractionsOf(sent, J)[0].created_at + ') — a tie on created_at is settled by id order, i.e. by chance');
  b.api.clearCommunityCache();   // a mid-session lock: same process, same in-memory state
  const done = b.api._rebuildFamily(church.pub);
  const r = P.rebuild().handlers;
  r.onevent(memberEvt()); r.onevent(retractionsOf(sent, J)[0]); r.onevent(live[0]); r.oneose();
  await done; await sleep(30);
  assert.ok(shown(b.api).includes(J.pub),
    'A CHILD RE-LINKED THIS SESSION WAS SKIPPED BY THE REBUILD — the session still counts it as unlinked');
  assert.equal(retractionsOf(sent, J).length, 1, 'the rebuild retracted a request for a child the church had re-linked');
});
