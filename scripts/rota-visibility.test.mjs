// A CHURCH MAY KEEP ITS ROTA TO THE PEOPLE WHO SERVE — AND THE RELAY, NOT THE APP, IS WHAT DECIDES.
// Run: node --test scripts/rota-visibility.test.mjs
//
// The member app now shows the church's whole rota, which is what nine agents went looking for in the round
// of 2026-08-18. Some churches will not want every member reading who is on the door on Christmas morning, so
// a steward can narrow it: everyone / the serving teams / stewards only.
//
// WHY THE RELAY AND NOT THE CLIENT. The Care module's own team/whole-church toggle is honoured client-side
// only — the relay never reads `visibility` out of meals-settings, and care needs are served to any admitted
// member (their PII is protected by sealing, not by that setting). A rota setting built the same way would be
// a label on a screen, undone by any modified client. So this one is a real read gate, and these tests drive
// a REAL gateway to prove it: what is asserted is what the relay does or does not put on the wire.
//
// WHAT IT HONESTLY BUYS. rota:/runsheet: are sealed under the church name key and EVERY member holds that
// key, so the gate decides who may FETCH, never who could decrypt a copy they already hold — and the member
// app caches every rota it fetched. Narrowing protects from that moment on. The console copy says exactly
// that ("Applies from now on. Anyone whose phone already downloaded the rota keeps that copy.") and must
// keep saying it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8973;                       // unique across scripts/*.test.mjs and *.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const ROTA_D = 'trinityone/rota:';
const ROSTER_D = 'trinityone/roster:';
const SETTINGS_D = 'trinityone/rota-settings';
const SERVICE = 'svc-advent';

const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();      // the church key itself
const server = K();      // a member who IS on a serving team roster
const pewsat = K();      // an ordinary member, on no roster at all
let relay, dataDir;

const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });

// Publish, answering the NIP-42 challenge — members must auth before the relay will accept their join.
function publish(ws, evt, authSk) {
  return new Promise((res) => {
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH' && authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)]));
      if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(!!m[2]); }
    };
    ws.on('message', on);
    ws.send(JSON.stringify(['EVENT', evt]));
    setTimeout(() => res(false), 6000);
  });
}

// REQ + collect, auto-answering the auth challenge, so a document withheld at REQ time but replayed after
// AUTH still counts as READ. Getting this wrong would make the gate look stricter than it is.
function reqCollect(ws, subId, filter, authSk, window = 700) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)]));
    };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}

// Can this key fetch the rota right now? One fresh socket per read so nothing is answered from an earlier
// subscription's state.
async function canFetchRota(keys) {
  const ws = await connect();
  try {
    const evs = await reqCollect(ws, 'r' + Math.random().toString(36).slice(2), { kinds: [30078], '#d': [ROTA_D + SERVICE] }, keys.sk);
    return evs.some(e => (e.tags.find(t => t[0] === 'd') || [])[1] === ROTA_D + SERVICE);
  } finally { try { ws.close(); } catch {} }
}

// The church sets the rota's audience. Replaceable docs are newest-wins TO THE SECOND, so two settings
// publishes inside one second silently drop the later one — which would make a test pass for the wrong
// reason. Wait out the second, then confirm the relay accepted the write before asserting anything.
async function setVisibility(v) {
  const ws = await connect();
  try {
    await sleep(1100);
    const ok = await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', SETTINGS_D], ['t', NET]], content: JSON.stringify({ visibility: v, updated: now() }) }, church.sk));
    assert.equal(ok, true, `fixture: the relay refused the church's own rota-settings write (${v})`);
  } finally { try { ws.close(); } catch {} }
  await sleep(150);   // the write is accepted, then ingested into ROTA_VIS
}

before(async () => {
  await requireFreePort(PORT, 'rota-visibility.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-rotavis-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }

  // Both people join for real, so a refusal later is about the ROTA SETTING and not about membership.
  for (const who of [server, pewsat]) {
    const ws = await connect();
    const ok = await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub], ['t', NET], ['p', church.pub]], content: '{}' }, who.sk), who.sk);
    assert.equal(ok, true, 'fixture: a member could not join the church');
    try { ws.close(); } catch {}
  }

  // The church publishes a team roster naming `server` (this is the list the relay can actually see — the
  // rota's own assignments are sealed), and the rota itself.
  const ws = await connect();
  assert.equal(await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ROSTER_D + 'welcome'], ['t', NET]], content: JSON.stringify({ roles: [{ id: 'door', name: 'Door' }], people: [{ id: 'p1', name: 'On The Team', pub: server.pub }] }) }, church.sk)), true, 'fixture: the roster was refused');
  assert.equal(await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ROTA_D + SERVICE], ['t', NET]], content: JSON.stringify({ service: SERVICE, published: true, assign: {} }) }, church.sk)), true, 'fixture: the rota was refused');
  try { ws.close(); } catch {}
  await sleep(200);
});

after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('by default every member can fetch the rota — nothing changes for churches that never touch this', async () => {
  assert.equal(await canFetchRota(pewsat), true,
    'a church with no rota-settings document has lost its rota. This setting must be additive: every church ' +
    'that existed before it has no such document, and the open behaviour is the one they already have.');
  assert.equal(await canFetchRota(server), true, 'a member on the serving team cannot fetch the rota by default either');
});

test('"serving teams": a member on no roster is refused, one on a roster is served', async () => {
  await setVisibility('team');
  assert.equal(await canFetchRota(pewsat), false,
    'the church narrowed its rota to the serving teams and the relay still served it to a member who is on ' +
    'no roster — so the setting is decoration, exactly like the Care toggle it was nearly copied from');
  assert.equal(await canFetchRota(server), true,
    'a member ON a team roster can no longer fetch the rota they are named in — the narrow setting has ' +
    'locked out the very people it exists to serve');
});

test('"stewards only": no ordinary member can fetch it, roster or not', async () => {
  await setVisibility('stewards');
  assert.equal(await canFetchRota(pewsat), false, 'stewards-only still served the rota to an ordinary member');
  assert.equal(await canFetchRota(server), false,
    'stewards-only still served the rota to a member on a team roster — "stewards only" has to mean stewards');
});

test('the church itself is never locked out of its own rota', async () => {
  // The console reads through the church key. If the gate could shut that out, a steward could set
  // "stewards only" and lock the church out of the board it was editing.
  assert.equal(await canFetchRota(church), true,
    'the church key cannot read its own rota under the strictest setting — the console would go blank');
});

test('opening it back up restores the rota to everyone', async () => {
  // A gate you cannot reverse is a trap. This also proves the ingest handles REPLACEMENT of the settings
  // doc rather than only its first appearance.
  await setVisibility('church');
  assert.equal(await canFetchRota(pewsat), true,
    'the church set its rota back to "everyone" and the relay is still refusing ordinary members — the ' +
    'setting is a one-way door, and no steward could undo their own change');
});

test('an unknown visibility value falls back to OPEN, not to locked-out', async () => {
  // A value this relay has never heard of — a newer console, a corrupted write — must not silently blank a
  // screen that worked yesterday. Fail toward the status quo, and note that this is the one place in the
  // codebase where failing OPEN is right: the alternative is a church losing its rota with no way to see why.
  await setVisibility('whatever-comes-next');
  assert.equal(await canFetchRota(pewsat), true,
    'an unrecognised visibility value locked members out of the rota. A future setting name, or a garbled ' +
    'document, must not be able to hide a church\'s rota from it.');
});
