// A DELETED ROOM MUST LEAVE THE PHONE THAT IS OPEN, NOT ONLY THE PHONE THAT RESTARTS.
// Run: node --test scripts/a-deleted-room-leaves-an-open-phone.test.mjs
//
// Sim 2026-10-02, item 38: a steward deleted an invite-only room. On a member's phone that was already open the
// room stayed in the list — a post into it showed as ciphertext and then "blocked" — until the app restarted.
// SIM-VERIFY called it "probably the known reconnect bug". It is not: it is deterministic and it is on the relay.
//
// WHY. Deleting a room is a TOMBSTONE: the church re-publishes the definition with a `deleted` tag and no
// content. The member app deletes the room when that arrives. But canRead()'s GROUP_GONE branch (R-7, "a deleted
// room is church and content-stewards only") refused EVERYTHING at that id to everyone else, the tombstone
// included — so the one event that says "this room is gone" was withheld from the people it had to reach. A fresh
// fetch could not help either: the tombstone had replaced the definition in the store, and is withheld the same.
//
// WHAT THIS DOES NOT TOUCH, and the controls below hold it: the deleted room's MESSAGES stay closed to former
// members (owner, 2026-09-30), and any other copy of the definition stays church/content-steward only.
//
// HOW THIS TEST IS BUILT (CLAUDE.md rules 1 and 3):
//   • THE RELAY is the real gateway on a throwaway data dir and an isolated port.
//   • THE READ is the filters the shipped _docsHubOpen opens (lifted from vendor/fellowship.js and run), held open
//     as a LIVE subscription before the delete — an open phone, not a fresh one.
//   • THE PHONE'S SIDE is the shipped subscribeChurchGroups, lifted and run: the events the relay actually delivered
//     are fed to its handler and the list it reports is read. If the relay delivers nothing, the room stays.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody } from './test-slice.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8706;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _t = Math.floor(Date.now() / 1000) - 300; const now = () => ++_t;   // strictly increasing, so no tie ever decides a result
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), steward = K(), member = K(), invited = K(), teamMember = K(), plainMember = K(), child = K();
const cp = church.pub;
const OPEN = cp.slice(0, 12) + '-open', INVITE = cp.slice(0, 12) + '-inv', TEAM = cp.slice(0, 12) + '-team';
const GROUP_D = 'trinityone/group:';
let relay, dataDir;

const connect = (who) => new Promise((res, rej) => {
  const w = new WebSocket(WS_URL);
  w.on('open', () => { w.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && who) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); }); res(w); });
  w.on('error', rej);
});
const publish = (w, evt) => new Promise((res) => { const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ['church', cp], ...extra], content: JSON.stringify(content) }, who.sk);
const tomb = (who, d) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ['church', cp], ['deleted', '1']], content: '' }, who.sk);
const msg = (who, gid) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['church', cp], ['t', gid]], content: 'hello' }, who.sk);
const dOf = (e) => (e.tags.find((t) => t[0] === 'd') || [])[1] || '';
const isTomb = (e) => e.tags.some((t) => t[0] === 'deleted') || !e.content;

// ── THE SHIPPED READER'S FILTERS ────────────────────────────────────────────────────────────────────────────────
function shippedHubFilters() {
  let captured = null;
  const scope = { _hubSince: () => 0, NET: 'trinityone', relaysForChurch: () => [],
    pool: { subscribeMany: (_r, filters) => { captured = filters; return { close() {} }; } }, Math, Date, JSON, console };
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('_docsHubOpen needs a stub for ' + String(k)); } });
  new Function('scope', 'with (scope) { return (' + fnBody(SHIP, 'function _docsHubOpen(hub)', '_docsHubOpen') + '); }')(proxy)({ cp, closer: null });
  assert.ok(Array.isArray(captured) && captured.length, 'the shipped hub opened no filters');
  return captured;
}

// ── THE SHIPPED PHONE: subscribeChurchGroups, fed what the relay delivered ──────────────────────────────────────
function phoneShowingRooms() {
  const reported = [];
  let handler = null;
  const scope = {
    GROUP_D, _needAuth: false, pub: null, Map, Set, Array, Object, JSON, Math, Date, String, console,
    toPub: (x) => x || null,
    loadDocCache: () => [], saveDocCache: () => {},
    _coalesce: (f) => f,                                   // report synchronously, so the list can be read straight after an event
    _churchVoice: (c, rec) => String((rec && rec._by) || '') === c,   // the church key's voice; this test has no roster
    _noteGroupLeaders: () => {},
    _onChurchDocs: (_cp, h) => { handler = h; return () => {}; },
  };
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('subscribeChurchGroups needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; } });
  // the real church-doc store functions, from the same bundle
  for (const [n, a] of [['_pickWinner', 'function _pickWinner('], ['_reduceVersions', 'function _reduceVersions('], ['_seedFromCache', 'function _seedFromCache('],
    ['_absorbById', 'function _absorbById('], ['_tombstoneTargets', 'function _tombstoneTargets('], ['_forgetById', 'function _forgetById('], ['_reduceAll', 'function _reduceAll(']]) {
    scope[n] = new Function('scope', 'with (scope) { return (' + fnBody(SHIP, a, n) + '); }')(proxy);
  }
  const subscribe = new Function('scope', 'with (scope) { return ({ ' + fnBody(SHIP, 'subscribeChurchGroups(churchNpub, onGroups)', 'subscribeChurchGroups') + ' }); }')(proxy).subscribeChurchGroups;
  subscribe(cp, (list) => reported.push(list.map((g) => g.id)));
  assert.ok(handler, 'the shipped subscribeChurchGroups registered no handler on the hub');
  return { feed: (e) => handler.onevent(e, dOf(e)), eose: () => handler.oneose(), shown: () => (reported.length ? reported[reported.length - 1] : []) };
}

before(async () => {
  await requireFreePort(PORT, 'a-deleted-room-leaves-an-open-phone.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-delroom-open-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const w = await connect(null);
  for (const who of [steward, member, invited, teamMember, plainMember, child]) {
    assert.equal((await publish(w, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['p', cp]], content: JSON.stringify({ joined: now() }) }, who.sk)))[0], true);
  }
  assert.equal((await publish(w, doc(church, 'trinityone/stewards:' + cp, { pubkeys: [steward.pub], caps: { [steward.pub]: ['content'] } })))[0], true, 'roster');
  assert.equal((await publish(w, doc(church, 'trinityone/minors:' + cp, { pubkeys: [child.pub] })))[0], true, 'minors');
  await sleep(200);
  w.close();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// A live, already-open subscription, the way an open phone holds one.
async function openPhone(who) {
  const w = await connect(who); const seen = []; const id = 'hub';
  w.on('message', (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) seen.push(m[2]); });
  w.send(JSON.stringify(['REQ', id, ...shippedHubFilters()]));
  await sleep(700);
  return { seen, close: () => w.close(), clear: () => { seen.length = 0; } };
}

test('an open phone is told an ordinary room is deleted, and drops it from its list', async () => {
  const cw = await connect(church);
  assert.equal((await publish(cw, doc(church, GROUP_D + OPEN, { name: 'Prayer' })))[0], true);
  await sleep(200);
  const phone = await openPhone(member); const ui = phoneShowingRooms();
  for (const e of phone.seen.filter((x) => dOf(x) === GROUP_D + OPEN)) ui.feed(e);
  ui.eose();   // the hub's EOSE — an open phone has had one; before it the list holds its last-known rooms rather than blank
  assert.deepEqual(ui.shown(), [OPEN], 'CONTROL: the room is on the phone before it is deleted');
  phone.clear();
  assert.equal((await publish(cw, tomb(church, GROUP_D + OPEN)))[0], true);
  await sleep(700);
  const live = phone.seen.filter((x) => dOf(x) === GROUP_D + OPEN);
  assert.equal(live.length, 1, 'THE DELETE NEVER REACHED THE OPEN PHONE: the relay withheld the tombstone from an ordinary member, so the room stays in the list until a restart.');
  assert.ok(isTomb(live[0]));
  for (const e of live) ui.feed(e);
  assert.deepEqual(ui.shown(), [], 'the shipped phone was handed the tombstone and still lists the room');
  phone.close(); cw.close();
});

test('an invite-only room: the invited member AND any other member hear it is gone (the definition was visible to them)', async () => {
  const cw = await connect(church);
  assert.equal((await publish(cw, doc(church, GROUP_D + INVITE, { name: 'Leaders', visibility: 'invite', members: [invited.pub] })))[0], true);
  await sleep(200);
  const phones = [await openPhone(invited), await openPhone(plainMember)];
  phones.forEach((p) => p.clear());
  assert.equal((await publish(cw, tomb(church, GROUP_D + INVITE)))[0], true);
  await sleep(700);
  for (const [i, p] of phones.entries()) {
    assert.equal(p.seen.filter((x) => dOf(x) === GROUP_D + INVITE && isTomb(x)).length, 1, `member #${i} was not told the invite-only room is gone`);
    p.close();
  }
  cw.close();
});

test('a team room: its roster hears it is gone; the rest of the congregation does not (silent absence)', async () => {
  const cw = await connect(church);
  assert.equal((await publish(cw, doc(church, GROUP_D + TEAM, { name: 'Welcome team', kind: 'team' })))[0], true);
  assert.equal((await publish(cw, doc(church, 'trinityone/roster:' + TEAM, { people: [{ pub: teamMember.pub, name: 'T' }] })))[0], true);
  await sleep(300);
  const onTeam = await openPhone(teamMember), offTeam = await openPhone(plainMember);
  onTeam.clear(); offTeam.clear();
  assert.equal((await publish(cw, tomb(church, GROUP_D + TEAM)))[0], true);
  await sleep(700);
  assert.equal(onTeam.seen.filter((x) => dOf(x) === GROUP_D + TEAM && isTomb(x)).length, 1, 'the team member was not told their team room is gone');
  assert.equal(offTeam.seen.filter((x) => dOf(x) === GROUP_D + TEAM).length, 0,
    'a member who was never on the team was told a team room existed and was deleted — the room list must not disclose it');
  onTeam.close(); offTeam.close(); cw.close();
});

test('CONTROL: a young person is not told an ADULTS-ONLY room was deleted (they never saw it)', async () => {
  const cw = await connect(church); const ID = cp.slice(0, 12) + '-adults';
  assert.equal((await publish(cw, doc(church, GROUP_D + ID, { name: 'Marriage counselling' })))[0], true);
  await sleep(200);
  const kid = await openPhone(child); kid.clear();
  assert.equal((await publish(cw, tomb(church, GROUP_D + ID)))[0], true);
  await sleep(700);
  assert.equal(kid.seen.filter((x) => dOf(x) === GROUP_D + ID).length, 0, 'a child was told about an adults-only room, by its deletion');
  kid.close(); cw.close();
});

test('CONTROL: the deleted room\'s MESSAGES stay closed to former members', async () => {
  const cw = await connect(church); const mw = await connect(member); const ID = cp.slice(0, 12) + '-hist';
  assert.equal((await publish(cw, doc(church, GROUP_D + ID, { name: 'Old room' })))[0], true);
  assert.equal((await publish(mw, msg(member, ID)))[0], true);
  assert.equal((await publish(cw, tomb(church, GROUP_D + ID)))[0], true);
  await sleep(300);
  const got = await new Promise((res) => { const out = []; const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === 'h') out.push(m[2]); if (m[0] === 'EOSE' && m[1] === 'h') { mw.off('message', on); res(out); } }; mw.on('message', on); mw.send(JSON.stringify(['REQ', 'h', { kinds: [1], '#t': [ID] }])); });
  assert.equal(got.length, 0, 'serving the tombstone must not have re-opened the room\'s history');
  cw.close(); mw.close();
});

test('CONTROL: a NON-tombstone copy of a deleted room\'s definition is still church/steward only', async () => {
  const cw = await connect(church), sw = await connect(steward); const ID = cp.slice(0, 12) + '-copy';
  assert.equal((await publish(sw, doc(steward, GROUP_D + ID, { name: 'Steward copy', visibility: 'invite', members: [invited.pub] })))[0], true, 'steward copy');
  assert.equal((await publish(cw, doc(church, GROUP_D + ID, { name: 'Church copy' })))[0], true);
  assert.equal((await publish(cw, tomb(church, GROUP_D + ID)))[0], true);
  await sleep(300);
  const ask = async (w) => new Promise((res) => { const out = []; const id = 'q' + Math.random().toString(36).slice(2, 6); const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) { w.off('message', on); res(out); } }; w.on('message', on); w.send(JSON.stringify(['REQ', id, { kinds: [30078], '#d': [GROUP_D + ID] }])); });
  const asMember = await connect(member);
  const m = await ask(asMember);
  assert.ok(!m.some((e) => !isTomb(e)), 'a live copy of a deleted room\'s definition (its name and members) was served to an ordinary member');
  const c = await ask(cw);
  assert.ok(c.some((e) => !isTomb(e)), 're-anchor: the steward\'s copy is not there for the church either, so this control proves nothing');
  cw.close(); sw.close(); asMember.close();
});
