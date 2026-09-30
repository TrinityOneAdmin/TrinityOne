// A MEMBER'S CODE IS NOT A CHURCH, AND A RELAY THAT NEVER ANSWERED IS NOT "NOT FOUND".
// Run: node --test scripts/a-members-code-is-not-a-church.test.mjs
//
// Audit 2026-09-30, finding 4. checkChurch — the guard that stops the app publishing a membership document to a
// code that is not a church — asked for ANY kind-0 or kind-30078 authored by the code. Every member has both
// (their profile, and their own member:<church> doc), so a steward's personal code or a friend's code passed as
// a church: the exact case the guard was named after. Its tests stubbed pool.querySync and fed it `{kind: 0}`,
// which IS a member's profile, so nothing ever asked a real relay to tell the two apart.
// And querySync resolves empty for a relay that never answered, so a dead link said "not found".
//
// HOW IT ASSERTS. checkChurch and _askOneRelay are lifted from the SHIPPED bundle (vendor/fellowship.js) and run
// with a real nostr-tools SimplePool against a real gateway. The church and the member are made the way the apps
// make them: the church publishes its join policy, the member publishes a profile and joins. The only stubs are
// the relay LIST inputs (churchRelaysRaw, the gate's refresh) and the invite-pending store — the question
// "church or member" is answered by the relay's data, never by a stub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody } from './test-slice.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8735, DEAD = 8736, SILENT = 8737;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const URL_ = `ws://127.0.0.1:${PORT}/relay`, DEAD_URL = `ws://127.0.0.1:${DEAD}/relay`, SILENT_URL = `ws://127.0.0.1:${SILENT}/`;
const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), member = K(), stranger = K(), friend = K();   // friend: another member of the same church

function once(anchor) {
  const at = VENDOR.indexOf(anchor);
  assert.notEqual(at, -1, `${anchor} is missing from vendor/fellowship.js — re-anchor this test`);
  assert.equal(VENDOR.indexOf(anchor, at + 1), -1, `${anchor} appears twice in vendor/fellowship.js`);
  return fnBody(VENDOR, at, anchor);
}
const ASK = once('function _askOneRelay(url, filter, ms)');
const CHECK = once('async checkChurch(npubOrHex)');

// A phone's worth of world. `relays` is what churchRelaysRaw() would return; `proved` is what the gate would
// admit of it; `pending` is the invite-pending store.
function phone({ relays = [URL_], proved = null, pending = [], as = null } = {}) {
  // `as`: the phone is signed in as this key and answers the relay's NIP-42 challenge, as the member app does.
  const pool = new SimplePool({ verifyEvent, websocketImplementation: WebSocket,
    ...(as ? { automaticallyAuth: () => async (evt) => finalizeEvent(evt, as.sk) } : {}) });
  const seen = { refreshed: null };
  const world = {
    pool,
    toPub: (x) => (/^[0-9a-f]{64}$/.test(x) ? x : null),
    churchRelaysRaw: () => relays,
    _loadChurchBoxes: () => [],
    _gate: { refresh: async (list, cp) => { seen.refreshed = { list, cp }; return proved === null ? list : proved; } },
    _getInvitePending: () => pending,
  };
  const names = Object.keys(world);
  const api = new Function(...names, `${ASK}\nconst F = { ${CHECK} };\nreturn F;`)(...names.map(n => world[n]));
  // Warm the socket the way a running app has: one gated read makes the relay challenge, the pool signs in.
  const warm = async () => { await pool.querySync([URL_], { kinds: [30078], authors: [as.pub] }); await sleep(600); await pool.querySync([URL_], { kinds: [30078], authors: [as.pub] }); };
  return { check: (cp) => api.checkChurch(cp), warm, pool, seen, close: () => { try { pool.destroy(); } catch (e) {} } };
}

let relay, dir, silent;
const send = (ws, evt) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m[2]); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const connect = () => new Promise((res, rej) => { const s = new WebSocket(URL_); s.on('open', () => res(s)); s.on('error', rej); });

before(async () => {
  for (const p of [PORT, DEAD, SILENT]) await requireFreePort(p, 'a-members-code-is-not-a-church.test.mjs');
  dir = mkdtempSync(join(tmpdir(), 'trin-churchcheck-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dir, CHURCH_NPUB: npubEncode(church.pub), RELAY_SYNC: '0', RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(150); }
  // A relay that accepts the socket and never says a word — the case the library papers over with a fake EOSE.
  silent = new WebSocketServer({ port: SILENT });
  silent.on('connection', (s) => { s.on('message', () => {}); });

  const ws = await connect();
  // The church, as the setup wizard leaves it: a profile and a join policy.
  assert.equal(await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'St Test' }) }, church.sk)), true, 'church profile');
  assert.equal(await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/joinpolicy:' + church.pub]], content: JSON.stringify({ approval: false }) }, church.sk)), true, 'church join policy (an open church: no approval step, so members are members at once)');
  // The member, as the member app leaves them: joined (member:<church>, signed by the member) and a profile.
  assert.equal(await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub]], content: JSON.stringify({ joined: now() }) }, member.sk)), true, 'member joins');
  assert.equal(await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'A Member' }) }, member.sk)), true, 'member profile');
  assert.equal(await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub]], content: JSON.stringify({ joined: now() }) }, friend.sk)), true, 'friend joins');
  // …and the member cannot forge a join policy for their own key: the relay hosts no such church.
  const forged = await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/joinpolicy:' + member.pub]], content: JSON.stringify({ approval: false }) }, member.sk));
  assert.equal(forged, false, 'CONTROL: the relay must refuse a join policy for a key that is not a church it hosts');
  ws.close();
  await sleep(200);
});
after(async () => { try { relay && relay.kill('SIGKILL'); } catch {} try { silent && silent.close(); } catch {} await sleep(200); try { rmSync(dir, { recursive: true, force: true }); } catch {} });

test('CONTROL: a church code reads as a church', async () => {
  const p = phone();
  try { assert.equal(await p.check(church.pub), 'church'); } finally { p.close(); }
});

test("a MEMBER's code is not a church — they have a profile and a membership doc, and that is not enough", async () => {
  const p = phone();
  try { assert.equal(await p.check(member.pub), 'not-found', "a member's personal code was taken for a church"); } finally { p.close(); }
});

test("a member's code pasted by ANOTHER member of the same church, signed in — the case the guard is named for", async () => {
  const p = phone({ as: friend });
  try {
    await p.warm();
    // CONTROL: this phone can see the member's profile — exactly what fooled the first version of the guard.
    const prof = await p.pool.querySync([URL_], { kinds: [0], authors: [member.pub] });
    assert.ok(prof.length > 0, 'CONTROL: a signed-in fellow member should be able to read the member\'s profile');
    assert.equal(await p.check(member.pub), 'not-found', "a fellow member's personal code was taken for a church");
    assert.equal(await p.check(church.pub), 'church', 'CONTROL: the real church still reads as a church');
  } finally { p.close(); }
});

test('a code with nothing anywhere is not found', async () => {
  const p = phone();
  try { assert.equal(await p.check(stranger.pub), 'not-found'); } finally { p.close(); }
});

test('an unreachable relay is "unknown", never "not found"', async () => {
  const p = phone({ relays: [DEAD_URL] });
  try { assert.equal(await p.check(church.pub), 'unknown'); } finally { p.close(); }
});

test('one relay answered empty and one never answered — still "unknown", never "not found"', async () => {
  const p = phone({ relays: [URL_, SILENT_URL] });
  try { assert.equal(await p.check(stranger.pub), 'unknown', 'a relay that never replied was counted as having answered'); } finally { p.close(); }
});

test("the invite's own relay is still pending — \"unknown\", even though the shared relay answered empty", async () => {
  const p = phone({ pending: [{ cp: stranger.pub, url: 'wss://box.example/relay' }] });
  try { assert.equal(await p.check(stranger.pub), 'unknown'); } finally { p.close(); }
});

test('only relays the gate PROVED are asked (rule 10) — nothing proved is "unknown"', async () => {
  const p = phone({ proved: [] });
  try {
    assert.equal(await p.check(church.pub), 'unknown', 'an unproved relay was believed');
    assert.deepEqual(p.seen.refreshed && p.seen.refreshed.cp, church.pub, 'the gate was not asked about this church');
  } finally { p.close(); }
});
