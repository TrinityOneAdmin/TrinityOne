// BLOCK MEANS NO PRIVATE ACCESS OF ANY KIND.
//   Run: node --test scripts/a-blocked-person-gets-no-private-access.test.mjs
//
// Owner, 2026-10-02 (reference/DOMAIN.md): blocking someone removes them from every team and the care list
// (unblocking does not put them back), removes their youth clearance, and the RELAY refuses every church grant to
// a blocked person — care team, children list, parent links, clearances, steward reads, help requests.
//
// WHAT WAS MEASURED BEFORE THIS (sim round 2026-10-02 + the independent check, verify-six), on a real relay:
//   · a blocked CARE-TEAM member was still served every ask for help — including ones written after the block —
//     and minors:/guardians:, because careAdmin() read the roster and never the blocklist, and Block never
//     edited the roster;
//   · members' phones went on SEALING new asks to them, because careteam: still named them;
//   · a blocked YOUTH-CLEARED adult was served a child's new request, and the child's phone wrapped them a key,
//     because approved: still held them and nothing filtered the block;
//   · a blocked DELEGATED STEWARD still read the children list and a child's request.
//
// FIVE PARTS, each at the point the person meets it:
//   1. the RELAY, black-box on a real gateway: blocked care member / cleared adult / steward are served nothing
//      private; their unblocked counterparts still are (and a roster WRITTEN by a since-blocked steward still
//      grants — the reader-side rule must not revoke grants);
//   2. the MEMBER'S PHONE, the shipped sealing code out of vendor/fellowship.js against that relay, with the
//      old console's lists still naming the blocked people: no key is wrapped to them;
//   3. the CONSOLE'S Block button, DashMembers compiled and rendered (rule 3): rosters, the care list and the
//      cleared list are rewritten without them — only after the block LANDED and the name key turned;
//   4. the two console PUBLISH POINTS (publishRoster, publishCareTeam) out of the shipped bundles: a stale copy
//      cannot put a blocked person back;
//   5. the rota PICKERS (AssignModal, RosterModal) compiled and rendered: a blocked person is never offered.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createHash, webcrypto } from 'node:crypto';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import * as nip44m from 'nostr-tools/nip44';
import { fnBody, liftSgMine, liftWithoutBlocked } from './test-slice.mjs';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const nip44 = nip44m.v2;
const FELLOWSHIP = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const MEALS = readFileSync(join(ROOT, 'vendor/steward-meals.js'), 'utf8');
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let _t = Math.floor(Date.now() / 1000) - 300; const now = () => ++_t;   // strictly increasing: no same-second ties
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });

// ── the cast ──────────────────────────────────────────────────────────────────────────────────────────────
const church = K();
const C = K(), C2 = K();      // care-team members: C will be blocked, C2 is the control
const A = K(), A2 = K();      // youth-cleared adults: A blocked, A2 control
const S = K(), S2 = K();      // delegated stewards with safeguarding + care: S blocked, S2 control
const KID = K(), PARENT = K(), M = K(), N = K();
const cp = church.pub;
const TEAM = cp.slice(0, 16) + '-careteam1';
const rid = (who, tail) => who.pub.slice(0, 16) + '-' + tail;

let PORT, WS_URL, relay, dataDir, pub;
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const ev = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content }, who.sk);
// an authenticated socket for `who` (NIP-42), then a query that waits for EOSE
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
const has = (evs, d) => evs.some(e => dOf(e) === d);

// NIP-98 for a blob GET, and the kind-24242 upload proof — both as the gateway expects them
const memberAuth = (who, method, url) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags: [['u', url], ['method', method]] }, who.sk))).toString('base64');
const blobAuth = (who, action, sha, tags = []) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 24242, created_at: Math.floor(Date.now() / 1000), content: action, tags: [['t', action], ['x', sha], ['expiration', String(Math.floor(Date.now() / 1000) + 600)], ...tags] }, who.sk))).toString('base64');
const BODY = Buffer.from('a members-only recording for the block test');
const BODY_SHA = createHash('sha256').update(BODY).digest('hex');

const D = {
  r0: 'trinityone/carereq:' + rid(M, 'r0'),
  r1: 'trinityone/carereq:' + rid(M, 'r1'), r2: 'trinityone/carereq:' + rid(M, 'r2'),
  k1: 'trinityone/carereq:' + rid(KID, 'k1'), k2: 'trinityone/carereq:' + rid(KID, 'k2'),
  minors: 'trinityone/minors:' + cp, guardians: 'trinityone/guardians:' + cp,
};
const before_ = {};   // what each person could read BEFORE the block — the controls that make "nothing after" mean something
let dmFromA = null, dmFromA2 = null;

before(async () => {
  PORT = await freePort(); WS_URL = `ws://127.0.0.1:${PORT}/relay`;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-noaccess-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(150)) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} }
  pub = await connect();
  for (const w of [C, C2, A, A2, S, S2, KID, PARENT, M, N]) assert.equal((await publish(pub, ev(w, 'trinityone/member:' + cp, JSON.stringify({ joined: now() }))))[0], true, 'member joined');
  await sleep(150);
  const ok = async (evt, what) => { const [o, why] = await publish(pub, evt); assert.equal(o, true, what + ' — ' + why); };
  await ok(ev(church, 'trinityone/stewards:' + cp, JSON.stringify({ pubkeys: [S.pub, S2.pub], caps: { [S.pub]: ['safeguarding', 'care', 'content'], [S2.pub]: ['safeguarding', 'care', 'content'] } })), 'stewards');
  await sleep(100);
  // THE CARE ROSTER IS WRITTEN BY STEWARD S, who is blocked below — so C2 keeping the grant proves the reader-side
  // rule did not revoke grants a since-blocked steward wrote (grantorOk asks stewardCan of the WRITER).
  await ok(ev(S, 'trinityone/roster:' + TEAM, JSON.stringify({ pubs: [C.pub, C2.pub], e: 'sealed-names' }), [['church', cp]]), 'care roster by steward S');
  await ok(ev(church, 'trinityone/meals-settings', JSON.stringify({ enabled: true, visibility: 'all', openedBy: 'steward', adminGroupId: TEAM })), 'meals settings');
  await ok(ev(church, 'trinityone/careteam:' + cp, JSON.stringify({ pubs: [C.pub, C2.pub], updated: now() })), 'careteam');
  await ok(ev(church, D.minors, JSON.stringify({ pubkeys: [KID.pub] })), 'minors');
  await ok(ev(church, 'trinityone/approved:' + cp, JSON.stringify({ pubkeys: [A.pub, A2.pub] })), 'approved');
  await ok(ev(church, D.guardians, JSON.stringify({ links: { [KID.pub]: [PARENT.pub] } })), 'guardians');
  await sleep(150);
  // private messages from both cleared adults to the child, stored while A was still cleared
  dmFromA = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', KID.pub]], content: 'x?iv=y' }, A.sk);
  dmFromA2 = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', KID.pub]], content: 'x?iv=y' }, A2.sk);
  await ok(dmFromA, 'cleared A may message the child');
  await ok(dmFromA2, 'cleared A2 may message the child');
  await ok(ev(M, D.r1, 'CIPHER-r1', [['church', cp]]), 'M asks for help (r1)');
  // a request whose ENVELOPE names the care team as it stood — C included — as a real one sealed before the block
  // would: a reply in its thread reuses these recipients, so this is what a thread reply must not hand to C.
  await ok(ev(M, D.r0, JSON.stringify({ keys: { [cp]: 'w', [M.pub]: 'w', [C.pub]: 'w', [C2.pub]: 'w' }, enc: 'x' }), [['church', cp]]), 'M asked for help before the block (r0)');
  await ok(ev(KID, D.k1, 'CIPHER-k1', [['church', cp]]), 'KID asks for help (k1)');
  const up = await fetch(`http://127.0.0.1:${PORT}/blob`, { method: 'PUT', headers: { Authorization: blobAuth(church, 'upload', BODY_SHA), 'Content-Type': 'audio/mpeg' }, body: BODY });
  assert.equal(up.status, 201, 'church uploaded a blob: ' + (await up.text()));
  await sleep(200);
  // ── BEFORE: the grants are really there ──
  before_.C = await readAs(C, { kinds: [30078], '#d': [D.r1, D.minors, D.guardians] });
  before_.A = await readAs(A, { kinds: [30078], '#d': [D.k1] });
  before_.S = await readAs(S, { kinds: [30078], '#d': [D.minors, D.k1] });
  before_.kidDMs = await readAs(KID, { kinds: [4], authors: [A.pub, A2.pub] });
  const url = `http://127.0.0.1:${PORT}/blob/${BODY_SHA}`;
  before_.sBlob = (await fetch(url, { headers: { Authorization: memberAuth(S, 'GET', url) } })).status;
  // ── THE BLOCK — exactly the document Steward.setBlocked writes ──
  await ok(ev(church, 'trinityone/blocked:' + cp, JSON.stringify({ pubkeys: [C.pub, A.pub, S.pub] })), 'church blocks C, A and S');
  await sleep(200);
  await ok(ev(M, D.r2, 'CIPHER-r2', [['church', cp]]), 'M asks again AFTER the block (r2)');
  await ok(ev(KID, D.k2, 'CIPHER-k2', [['church', cp]]), 'KID asks again AFTER the block (k2)');
  await sleep(200);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── 1. THE RELAY ──────────────────────────────────────────────────────────────────────────────────────────
test('control: before the block, each of them really held the grant this file takes away', () => {
  assert.ok(has(before_.C, D.r1) && has(before_.C, D.minors) && has(before_.C, D.guardians), 'care member C was not served the ask / children list before the block — the setup proves nothing');
  assert.ok(has(before_.A, D.k1), 'cleared adult A was not served the child’s request before the block');
  assert.ok(has(before_.S, D.minors) && has(before_.S, D.k1), 'steward S was not served the children list / child request before the block');
  assert.equal(before_.kidDMs.length, 2, 'the child could not read both cleared adults’ messages before the block');
  assert.equal(before_.sBlob, 200, 'steward S could not fetch the members-only recording before the block');
});

test('a BLOCKED care-team member is served no ask for help (old or new) and not the children list or parent links', async () => {
  const got = await readAs(C, { kinds: [30078], '#d': [D.r1, D.r2, D.minors, D.guardians] });
  assert.deepEqual(got.map(dOf), [], 'the relay still serves the blocked care-team member: ' + got.map(dOf).join(', '));
  const ctl = await readAs(C2, { kinds: [30078], '#d': [D.r2] });
  assert.ok(has(ctl, D.r2), 'CONTROL: the unblocked care member C2 lost the new request — and C2 is on a roster WRITTEN BY the now-blocked steward S, so a reader-side rule that revoked grants written by a since-blocked steward would show up exactly here');
});

test('a BLOCKED youth-cleared adult is served no child’s request, and their private messages with the child stop', async () => {
  const got = await readAs(A, { kinds: [30078], '#d': [D.k1, D.k2] });
  assert.deepEqual(got.map(dOf), [], 'the blocked cleared adult is still served a child’s request for help');
  const ctl = await readAs(A2, { kinds: [30078], '#d': [D.k2] });
  assert.ok(has(ctl, D.k2), 'CONTROL: the unblocked cleared adult A2 lost the child’s new request');
  // (held by the kind-4 gate's own rule — a sender who is not an effective member is not served — which predates
  // this file; asserted so the two together say what "no private access" means for a child)
  const dms = await readAs(KID, { kinds: [4], authors: [A.pub, A2.pub] });
  assert.deepEqual(dms.map(e => e.pubkey === A.pub ? 'A' : 'A2'), ['A2'],
    'the child is still served the blocked adult’s private message (approvedIn still clears them), or lost the cleared one');
});

test('a BLOCKED delegated steward reads no children list, no child’s request, and no members-only recording', async () => {
  const got = await readAs(S, { kinds: [30078], '#d': [D.minors, D.k1, D.k2] });
  assert.deepEqual(got.map(dOf), [], 'the blocked steward is still served: ' + got.map(dOf).join(', '));
  const ctl = await readAs(S2, { kinds: [30078], '#d': [D.minors, D.k2] });
  assert.ok(has(ctl, D.minors) && has(ctl, D.k2), 'CONTROL: the unblocked steward S2 lost the children list or the child’s request');
  const url = `http://127.0.0.1:${PORT}/blob/${BODY_SHA}`;
  const s = await fetch(url, { headers: { Authorization: memberAuth(S, 'GET', url) } }); await s.arrayBuffer();
  assert.notEqual(s.status, 200, 'the blocked steward still downloads the church’s members-only media');
  const s2 = await fetch(url, { headers: { Authorization: memberAuth(S2, 'GET', url) } }); await s2.arrayBuffer();
  assert.equal(s2.status, 200, 'CONTROL: the unblocked steward S2 can no longer fetch it');
  const other = Buffer.from('a blocked steward tries to upload'), sha = createHash('sha256').update(other).digest('hex');
  const upS = await fetch(`http://127.0.0.1:${PORT}/blob`, { method: 'PUT', headers: { Authorization: blobAuth(S, 'upload', sha, [['church', cp]]), 'Content-Type': 'audio/mpeg' }, body: other });
  await upS.text();
  assert.notEqual(upS.status, 201, 'the blocked steward can still upload into the church’s media store');
});

// ── 2. THE MEMBER'S PHONE: the shipped sealing code, against the relay above ─────────────────────────────────
// careteam: and approved: STILL NAME C and A here — what an older console, or a failed rewrite, leaves behind.
async function liftedMember(asker, sgSelf, method, anchor) {
  const ws = await authed(asker);
  const published = [];
  const careTeam = /\n  async function _fetchStewardsWithCap\(cp, cap\) \{[\s\S]*?\n  \}\n  async function _fetchCareTeam\(cp\) \{[\s\S]*?\n  \}/.exec(FELLOWSHIP);
  const child = /\n  async function _fetchChildCareAudience\(cp\) \{[\s\S]*?\n  \}/.exec(FELLOWSHIP);
  assert.ok(careTeam && child, 're-anchor: could not lift the care audience functions from vendor/fellowship.js');
  const body = fnBody(FELLOWSHIP, anchor, method);
  const pubReason = fnBody(FELLOWSHIP, 'function _pubReason(e) {', '_pubReason');
  const sealTo = fnBody(FELLOWSHIP, 'function _sealToPubs(recips, bodyObj) {', '_sealToPubs');
  const threadAud = /\n  async function _fetchCareThreadAudience\(cp, reqId, requesterPub\) \{[\s\S]*?\n  \}/.exec(FELLOWSHIP);
  assert.ok(threadAud, 're-anchor: _fetchCareThreadAudience');
  const stubs = {
    window: { Fellowship: { churchPub: cp, ready: Promise.resolve() } },
    sk: asker.sk, pub: asker.pub, _sgSelf: sgSelf,
    pool: { querySync: async (_r, filters) => query(ws, filters) },
    _relayAuthedAt: Date.now(), _churchRoster: new Map(), crypto: webcrypto,
    nip44e: (p, k) => nip44.encrypt(p, k), nip44d: (c, k) => nip44.decrypt(c, k), nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    // the bundle's own names for the same three (esbuild renames the imports)
    encrypt: (p, k) => nip44.encrypt(p, k), decrypt: (c, k) => nip44.decrypt(c, k), getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    _hex: (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''), finalizeEvent,
    _publishAny: async (_r, evt) => { const [okk, msg] = await publish(ws, evt); published.push(evt); if (!okk) throw new Error(msg); return true; },
    churchRelays: () => [WS_URL], publishSetFor: () => [WS_URL],
    NET: 'trinityone', CAREREQ_D: 'trinityone/carereq:', CARETEAM_D: 'trinityone/careteam:', CLEARANCE_D: 'trinityone/clearance:', APPROVED_D: 'trinityone/approved:',
    CARECHAT_D: 'trinityone/carechat:', toPub: (x) => x,
    console,
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('lifted publishCareRequest needs `' + String(k) + '`'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const fn = new Function('scope', `with (scope) { ${liftSgMine(FELLOWSHIP)} ${careTeam[0]} ${child[0]} ${liftWithoutBlocked(FELLOWSHIP)} ${threadAud[0]} ${pubReason} ${sealTo} return ({ ${body} })[${JSON.stringify(method)}]; }`)(scope);
  return { fn, published, close: () => ws.close() };
}
async function shippedPublishCareRequest(asker, sgSelf) {
  const L = await liftedMember(asker, sgSelf, 'publishCareRequest', 'async publishCareRequest(fields) {');
  try {
    const res = await L.fn({ type: 'meals', forSelf: true, when: 'this week', urgency: 'soon', note: '14 Elm Road, back door' });
    return { res, evt: L.published[0] || null };
  } finally { L.close(); }
}
const wrappedTo = (evt) => Object.keys((JSON.parse(evt.content || '{}').keys) || {});

test('PHONE: a member asking for help after the block never wraps a key to the blocked care-team member', async () => {
  const { res, evt } = await shippedPublishCareRequest(M, { cp, me: M.pub, isMinor: false, known: true });
  assert.ok(evt, 'the request was not published at all: ' + JSON.stringify(res));
  const to = wrappedTo(evt);
  assert.ok(to.includes(C2.pub), 'CONTROL: the unblocked care member C2 was not given a key');
  assert.ok(!to.includes(C.pub), 'the shipped sealing code still wraps the new ask to the BLOCKED care member — careteam: names them');
});

test('PHONE: a child asking for help after the block never wraps a key to the blocked cleared adult', async () => {
  const { res, evt } = await shippedPublishCareRequest(KID, { cp, me: KID.pub, isMinor: true, known: true });
  assert.ok(evt, 'the child’s request was not published at all: ' + JSON.stringify(res));
  const to = wrappedTo(evt);
  assert.ok(to.includes(A2.pub), 'CONTROL: the unblocked cleared adult A2 was not given a key');
  assert.ok(!to.includes(A.pub), 'the child’s phone still wraps a key to the BLOCKED youth-cleared adult');
});

test('PHONE: a reply in a care thread sealed BEFORE the block is not wrapped to the blocked care member', async () => {
  const L = await liftedMember(M, { cp, me: M.pub, isMinor: false, known: true }, 'sendCareChat', 'async sendCareChat(reqId, requesterPub, text) {');
  try {
    const r = await L.fn(rid(M, 'r0'), M.pub, 'We are vegetarian, no meat or fish please');
    assert.ok(r && L.published[0], 'the reply was not sent at all');
    const to = wrappedTo(L.published[0]);
    assert.ok(to.includes(C2.pub), 'CONTROL: the unblocked care member C2 was not given the reply');
    assert.ok(!to.includes(C.pub), 'the thread reply still wraps a key to the BLOCKED care member, from the request’s old envelope');
  } finally { L.close(); }
});

test('PHONE: the “ask for help” screen does not count a blocked cleared adult as someone a child can reach', async () => {
  const L = await liftedMember(KID, { cp, me: KID.pub, isMinor: true, known: true }, 'childCareAudience', 'async childCareAudience(churchNpub) {');
  try {
    const aud = await L.fn(cp);
    assert.ok(Array.isArray(aud) && aud.includes(A2.pub), 'CONTROL: the unblocked cleared adult is missing: ' + JSON.stringify(aud));
    assert.ok(!aud.includes(A.pub), 'the screen still offers the child a route to the BLOCKED cleared adult');
  } finally { L.close(); }
});

test('CONSOLE: a steward’s reply in a care thread is not wrapped to someone this console holds as blocked', async () => {
  const body = fnBody(MEALS, 'async function sendCareChat(reqId, requesterPub, text) {', 'sendCareChat');
  const reqEvt = { pubkey: M.pub, created_at: 1, tags: [['d', D.r0]], content: JSON.stringify({ keys: { [cp]: 'w', [M.pub]: 'w', [C.pub]: 'w', [C2.pub]: 'w' }, enc: 'x' }) };
  let sealedTo = null;
  const S0 = {
    churchPub: cp, blockedHere: () => [C.pub],
    subscribeMany: (_f, h) => { setTimeout(() => { h.onevent(reqEvt); h.oneose(); }, 0); return { close() {} }; },
    sealToPubs: (list) => { sealedTo = list; return { keys: {}, enc: 'x' }; },
    publishSigned: () => Promise.resolve(true),
  };
  const fn = new Function('S', 'now', 'CAREREQ_D', 'CARETEAM_D', 'CARECHAT_D', 'NET', body + '\nreturn sendCareChat;')(() => S0, () => 1, 'trinityone/carereq:', 'trinityone/careteam:', 'trinityone/carechat:', 'trinityone');
  await fn(rid(M, 'r0'), M.pub, 'Thank you — Tuesday is sorted');
  assert.ok(Array.isArray(sealedTo) && sealedTo.includes(C2.pub), 'CONTROL: the console reply lost the unblocked care member: ' + JSON.stringify(sealedTo));
  assert.ok(!sealedTo.includes(C.pub), 'the console reply is still sealed to the BLOCKED care member');
});

test('PHONE: only the CHURCH’S OWN blocked: document is believed — not another of its documents, not a stranger’s', async () => {
  const run = async (docs) => {
    const fn = new Function('pool', 'churchRelays', 'pub', `${liftWithoutBlocked(FELLOWSHIP)}\nreturn _withoutBlocked;`)(
      { querySync: async () => docs }, () => ['wss://x'], M.pub);
    return fn(cp, [A.pub, A2.pub, cp, M.pub]);
  };
  const tagged = (author, d, pubkeys) => ({ pubkey: author, created_at: 5, tags: [['d', d]], content: JSON.stringify({ pubkeys }) });
  // a relay that ignores its filter and hands back the church's CLEARED list: those people must not be dropped
  assert.deepEqual(await run([tagged(cp, 'trinityone/approved:' + cp, [A.pub, A2.pub])]), [A.pub, A2.pub, cp, M.pub],
    'another church document’s `pubkeys` was read as a blocklist — a cleared adult was dropped from a child’s request');
  assert.deepEqual(await run([tagged(N.pub, 'trinityone/blocked:' + cp, [A2.pub])]), [A.pub, A2.pub, cp, M.pub],
    'a blocklist written by somebody other than the church was believed');
  assert.deepEqual(await run([tagged(cp, 'trinityone/blocked:' + cp, [A.pub, cp, M.pub])]), [A2.pub, cp, M.pub],
    'the church’s own blocklist was not applied — or it removed the church key or the sender');
});

// ── 3. THE CONSOLE'S BLOCK BUTTON ─────────────────────────────────────────────────────────────────────────────
// DashMembers + blockOffTeamsAndCare, compiled the way the packaged build compiles them and rendered.
async function compiledMembers(globals) {
  const { React, draw } = miniReact();
  const src = fnBody(DASH, 'async function blockOffTeamsAndCare(', 'blockOffTeamsAndCare') + '\n' + fnBody(DASH, 'function DashMembers(', 'DashMembers');
  const tmp = join(tmpdir(), 'blk-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashMembers };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const g = { React, ...globals };
  const key = '__blk_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  delete globalThis[key];
  return { C: mod.DashMembers, draw };
}
const deferred = () => { let resolve; const p = new Promise(r => { resolve = r; }); return { p, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const T = 'a'.repeat(64), B = 'b'.repeat(64), CC = 'c'.repeat(64), AA = 'e'.repeat(64);
function membersScene({ blockedResult = true } = {}) {
  const calls = { roster: [], careteam: [], approved: [], reseal: [] };
  const landed = deferred(), nameKey = deferred();
  const NOW = Math.floor(Date.now() / 1000);
  const steward = {
    actingChurch: '', churchPub: 'f'.repeat(64), relayAuthed: () => false,   // keeps the clearance back-fill effect asleep; Block does not read it
    setBlocked: () => landed.p,
    rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true),
    ensureNameKeyForMembers: () => nameKey.p,
    publishRoster: (team, r) => { calls.roster.push({ team, pubs: (r.people || []).map(p => p.pub) }); return Promise.resolve({ id: team }); },
    setApproved: (list) => { calls.approved.push(list); return Promise.resolve(true); },
    refreshClearances: (who) => { calls.reseal.push(who); return Promise.resolve(); },
  };
  const meals = { publishCareTeam: (pubs) => { calls.careteam.push(pubs); return Promise.resolve(true); } };
  const globals = {
    CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    setTimeout: () => 0, clearTimeout: () => {}, Promise, Date, Math, JSON, Set, Map, Object, String, Array, Boolean, Number, RegExp,
    Panel: (p) => (p && p.children) || null, SkPill: (p) => (p && p.children) || null, SkBadge: () => null,
    SK_TINT: { clay: { bg: 'x', fg: 'x' }, gold: { bg: 'x', fg: 'x' }, sage: { bg: 'x', fg: 'x' }, ink: { bg: 'x', fg: 'x' } },
    DismissibleNote: (p) => (p && p.children) || null, StewHelpLink: (p) => (p && p.label) || null,
    useStewNarrow: () => false, Icon: () => null, copyText: () => {},
    location: { search: '', hostname: 'x' },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console,
    nameHandle: () => '', shortNpub: (np) => String(np || '').slice(0, 12), ago: () => '2 days ago',
    Avatar: () => null, StewMemberSheet: () => null, ReseatModal: () => null, GuardianLinkModal: () => null, BulkInviteModal: () => null,
    stewCapState: () => ({ allowed: true }),
    window: {
      Steward: steward, StewardMeals: meals,
      useStewardGroups: () => [], useStewardStewards: () => [], useStewardChurch: () => ({ name: 'St Aidan', features: {} }),
      useStewardBlocked: () => [],
      useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors: [], approved: [T, AA], nophoto: [] }),
      useStewardGuardians: () => ({ links: {}, closed: {} }), useStewardJoinPolicy: () => false, useStewardAdmitted: () => [],
      useStewardRosters: () => [
        { team: 'welcome', roles: [{ id: 'r', name: 'Welcomer' }], people: [{ id: 'p1', name: 'Tess Target', pub: T }, { id: 'p2', name: 'Bob', pub: B }], pods: [] },
        { team: 'care', roles: [], people: [{ id: 'p3', name: 'Tess Target', pub: T }, { id: 'p4', name: 'Cass', pub: CC }], pods: [] },
        { team: 'other', roles: [], people: [{ id: 'p5', name: 'Bob', pub: B }], pods: [] },
        { team: 'sealed', _locked: true },
      ],
      useMealsSettings: () => ({ enabled: true, adminGroupId: 'care' }),
      stewardStreamLoaded: () => true, useStewardIdv: () => 0,
      useStewardMembers: () => [
        { pubkey: T, npub: 'npub1tt', name: 'Tess Target', count: 1, lastTs: NOW - 3600, joined: NOW - 86400 },
        { pubkey: B, npub: 'npub1bb', name: 'Bob', count: 1, lastTs: NOW - 3600, joined: NOW - 86400 },
      ],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  return { globals, calls, landed, nameKey };
}
// the smallest part of the page that holds this member's name and exactly one block shield — their row
function rowOf(tree, name) {
  const shield = (n) => n && n.type === 'button' && n.props && n.props.title === 'Remove / block this member';
  const rows = find(tree, n => n && typeof n === 'object' && reads(n).includes(name) && find(n, shield).length === 1);
  return rows.sort((a, b) => reads(a).length - reads(b).length)[0];
}
async function pressBlock(draw, Cmp, name) {
  let tree = draw(Cmp, {});
  const row = rowOf(tree, name);
  assert.ok(row, 're-anchor: no row for ' + name);
  find(row, n => n && n.type === 'button' && n.props && n.props.title === 'Remove / block this member')[0].props.onClick();
  tree = draw(Cmp, {});
  const confirm = find(tree, n => n && n.type === 'button' && n.props && /^Confirm — bans them/.test(n.props.title || ''));
  assert.equal(confirm.length, 1, 're-anchor: the Block confirmation did not appear');
  confirm[0].props.onClick();
}

test('CONSOLE: the real Block takes them off every team, the care list and the cleared list — after the block lands and the name key turns', async () => {
  const sc = membersScene();
  const { C: Cmp, draw } = await compiledMembers(sc.globals);
  await pressBlock(draw, Cmp, 'Tess Target');
  await flush();
  assert.deepEqual([sc.calls.roster.length, sc.calls.careteam.length, sc.calls.approved.length], [0, 0, 0],
    'rosters, the care list or the cleared list were written BEFORE the blocklist itself landed');
  sc.landed.resolve(true); await flush();
  assert.equal(sc.calls.roster.length, 0, 'a roster was published before the NAME KEY turned — its names would be sealed under the key the blocked person still holds');
  sc.nameKey.resolve({ rotated: true }); await flush();
  const teams = sc.calls.roster.map(r => r.team).sort();
  assert.deepEqual(teams, ['care', 'welcome'], 'Block must rewrite exactly the rosters that name them (and never the one it cannot open): ' + JSON.stringify(sc.calls.roster));
  for (const r of sc.calls.roster) assert.ok(!r.pubs.includes(T), 'roster ' + r.team + ' was written WITH the blocked person still on it');
  assert.ok(sc.calls.roster.find(r => r.team === 'welcome').pubs.includes(B), 'the rest of the team went missing from the Welcome roster');
  assert.deepEqual(sc.calls.careteam, [[CC]], 'the care list (what phones seal asks to) was not republished without them');
  assert.deepEqual(sc.calls.approved, [[AA]], 'their youth clearance was not removed');
  assert.deepEqual(sc.calls.reseal, [[T]], 'their phone’s sealed clearance was not re-written after the cleared list changed');
  const said = reads(draw(Cmp, {}));
  assert.match(said, /couldn’t change a team this console can’t open/, 'the roster this console cannot open was not reported to the steward: ' + said.slice(0, 300));
});

test('CONSOLE: a Block that did not land changes no team, care list or clearance', async () => {
  const sc = membersScene();
  const { C: Cmp, draw } = await compiledMembers(sc.globals);
  await pressBlock(draw, Cmp, 'Tess Target');
  sc.landed.resolve(false); sc.nameKey.resolve({ rotated: true }); await flush();
  assert.deepEqual([sc.calls.roster.length, sc.calls.careteam.length, sc.calls.approved.length], [0, 0, 0],
    'a refused blocklist still went on to rewrite rosters / the care list / the cleared list');
});

// ── 4. THE PUBLISH POINTS: a stale roster cannot put them back ─────────────────────────────────────────────
test('ENGINE: publishCareTeam never lists someone this console holds as blocked (the Care panel republishes from stale rosters)', async () => {
  const body = fnBody(MEALS, 'function publishCareTeam(memberPubs) {', 'publishCareTeam');
  const sent = [];
  const S0 = { churchPub: 'f'.repeat(64), blockedHere: () => [T], publishSigned: (e) => { sent.push(e); return Promise.resolve(true); } };
  const fn = new Function('S', 'now', 'CARETEAM_D', 'NET', body + '\nreturn publishCareTeam;')(() => S0, () => 1, 'trinityone/careteam:', 'trinityone');
  await fn([T, CC]);
  const pubs = JSON.parse(sent[0].content).pubs;
  assert.ok(pubs.includes(CC), 'CONTROL: the unblocked care member is missing');
  assert.ok(!pubs.includes(T), 'publishCareTeam put a blocked person back on the care list');
});

test('ENGINE: publishRoster never writes someone this console holds as blocked onto a team', async () => {
  const body = fnBody(STEWARD, 'async publishRoster(teamId, roster) {', 'publishRoster');
  const sent = [];
  const deps = {
    sk: 'k', _localBlocked: new Set([T]), now: () => 1, NET: 'trinityone', ROSTER_D: 'trinityone/roster:',
    _sealChurchDocReady: async (doc) => JSON.stringify({ e: JSON.stringify(doc) }),
    feChurch: (e) => e, publish: (e) => { sent.push(e); return Promise.resolve(true); },
  };
  const names = Object.keys(deps);
  const obj = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => deps[n]));
  const r = await obj.publishRoster('welcome', { roles: [], people: [{ id: 'p1', name: 'Tess', pub: T }, { id: 'p2', name: 'Bob', pub: B }], pods: [] });
  const c = JSON.parse(sent[0].content);
  assert.deepEqual(c.pubs, [B], 'the relay-facing pubkeys still carry the blocked person: ' + JSON.stringify(c.pubs));
  assert.deepEqual(r.people.map(p => p.pub), [B], 'the saved roster still names the blocked person');
});

// ── 5. THE PICKERS ─────────────────────────────────────────────────────────────────────────────────────────
function scheduleScreens(blocked) {
  const { React, draw } = miniReact();
  const win = {
    useStewardBlocked: () => blocked, useMealsSettings: () => ({ adminGroupId: '' }),
    Steward: {}, StewardMeals: {},
  };
  const mod = loadScreen('app/stew-schedule.jsx', ['AssignModal', 'RosterModal'], {
    React, window: win, Icon: () => null, useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-02',
    document: { addEventListener() {}, removeEventListener() {} },
  });
  return { ...mod, draw };
}
test('PICKERS: the Assign picker and the roster’s “link a member” list never offer a blocked person', () => {
  const { AssignModal, RosterModal, draw } = scheduleScreens([T]);
  const roster = { roles: [{ id: 'r', name: 'Welcomer' }], people: [{ id: 'p1', name: 'Tess Target', pub: T }, { id: 'p2', name: 'Bob Free', pub: B }], pods: [] };
  const slot = { key: 'welcome::r', service: { date: '2026-10-11', time: '10:30' }, team: { id: 'welcome', name: 'Welcome' }, role: { id: 'r', name: 'Welcomer' } };
  const assign = reads(draw(AssignModal, { slot, roster, assign: {}, unavail: {}, onAssign() {}, onClear() {}, onClose() {} }));
  assert.match(assign, /Bob Free/, 'CONTROL: the free teammate is missing from the Assign picker');
  assert.doesNotMatch(assign, /Tess Target/, 'the Assign picker still offers the blocked person');
  const tree = draw(RosterModal, { team: { id: 'welcome', name: 'Welcome' }, roster: { roles: [], people: [], pods: [] }, members: [{ pubkey: T, name: 'Tess Target' }, { pubkey: B, name: 'Bob Free' }], onClose() {} });
  const opts = find(tree, n => n && n.type === 'option').map(n => reads(n));
  assert.ok(opts.includes('Bob Free'), 'CONTROL: the member list in the roster editor is missing an ordinary member');
  assert.ok(!opts.includes('Tess Target'), 'the roster editor still offers the blocked person to link onto a team');
});
