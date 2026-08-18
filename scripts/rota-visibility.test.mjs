// A CHURCH MAY KEEP ITS ROTA TO THE PEOPLE WHO SERVE — AND THE RELAY, NOT THE APP, IS WHAT DECIDES.
// Run: node --test scripts/rota-visibility.test.mjs
//
// The member app now shows the church's whole rota, which is what nine agents went looking for in the round
// of 2026-08-18. Some churches will not want every member reading who is on the door on Christmas morning, so
// a steward can narrow it. The console offers two settings — everyone / the serving teams. The relay also
// honours 'stewards', which the console no longer offers: a member's own serving slots come out of the same
// document, so refusing it to every member silently stops telling volunteers they are rostered.
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
const RUNSHEET_D = 'trinityone/runsheet:';
const SERVICE = 'svc-advent';
const SERVICE_S = 'svc-steward-authored';   // a service whose rota + run sheet a DELEGATED STEWARD wrote

const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();      // the church key itself
const steward = K();     // a DELEGATED steward — the ordinary console case, and the one the audit broke
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
async function canFetch(keys, dtag) {
  const ws = await connect();
  try {
    const evs = await reqCollect(ws, 'r' + Math.random().toString(36).slice(2), { kinds: [30078], '#d': [dtag] }, keys.sk);
    return evs.some(e => (e.tags.find(t => t[0] === 'd') || [])[1] === dtag);
  } finally { try { ws.close(); } catch {} }
}
const canFetchRota = (keys) => canFetch(keys, ROTA_D + SERVICE);

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

function bootRelay() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  return (async () => {
    while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
    throw new Error('relay did not become ready on :' + PORT);
  })();
}

// Restart onto the SAME data directory — i.e. rebuild every in-memory map from the stored corpus, which is
// what the relay does on every self-update. This is the only way to catch an ingest that depends on replay
// ORDER, and it is where two settings were being silently thrown away.
async function restartRelay() {
  try { relay.kill('SIGKILL'); } catch {}
  await sleep(400);
  await bootRelay();
  await sleep(300);
}

// publish as any key, on its own socket
async function publishAs(keys, evt) {
  const ws = await connect();
  try { return await publish(ws, evt, keys.sk); } finally { try { ws.close(); } catch {} }
}
const rotaDoc = (svc, signer, tags = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ROTA_D + svc], ['t', NET], ...tags], content: JSON.stringify({ service: svc, published: true, assign: {} }) }, signer.sk);

before(async () => {
  await requireFreePort(PORT, 'rota-visibility.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-rotavis-'));
  await bootRelay();

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

// ── the delegated-steward path: what the console actually does ────────────────────────────────────────────
// Everything above is signed by the church key. A church running a delegated console signs with a STEWARD
// key and names the church in a ['church', cp] tag — and an audit showed that a gate resolving the audience
// from the AUTHOR instead of the document's church passed all six tests above while leaking every rota a
// steward wrote. So the fixtures below are steward-authored on purpose.
test('a rota written by a DELEGATED STEWARD is gated too, not just the church\'s own', async () => {
  assert.equal(await publishAs(church, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/stewards:' + church.pub], ['t', NET]], content: JSON.stringify({ pubkeys: [steward.pub] }) }, church.sk)), true, 'fixture: the steward roster was refused');
  await sleep(200);
  assert.equal(await publishAs(steward, rotaDoc(SERVICE_S, steward, [['church', church.pub]])), true, 'fixture: the steward could not publish a rota');
  // Republish the serving-team roster AS THE STEWARD: that is what a delegated console does, and it is the
  // ingest whose replay ordering broke the people who serve.
  await sleep(1100);
  assert.equal(await publishAs(steward, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ROSTER_D + 'welcome'], ['t', NET], ['church', church.pub]], content: JSON.stringify({ roles: [{ id: 'door', name: 'Door' }], people: [{ id: 'p1', name: 'On The Team', pub: server.pub }] }) }, steward.sk)), true, 'fixture: the steward could not publish the team roster');
  await sleep(200);
  assert.equal(await publishAs(steward, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', RUNSHEET_D + SERVICE_S], ['t', NET], ['church', church.pub]], content: JSON.stringify({ items: [{ what: 'Welcome', who: 'The vicar' }] }) }, steward.sk)), true, 'fixture: the steward could not publish a run sheet');
  await setVisibility('team');

  assert.equal(await canFetch(pewsat, ROTA_D + SERVICE_S), false,
    'the rota is narrowed to the serving teams, but a rota AUTHORED BY A STEWARD is still served to a member ' +
    'on no roster. A gate that resolves the audience from the author rather than the document\'s church ' +
    'leaks every rota a delegated console ever wrote — which is most of them in a real church.');
  assert.equal(await canFetch(server, ROTA_D + SERVICE_S), true, 'a roster member cannot read the steward-authored rota');
});

test('the RUN SHEET is gated alongside the rota', async () => {
  // The order of service names the minister against each item — it was sealed in this same round precisely
  // because of that. Dropping RUNSHEET_D from the gate changes nothing that any other test can see.
  assert.equal(await canFetch(pewsat, RUNSHEET_D + SERVICE_S), false,
    'the run sheet is still served to a member outside the audience while the rota beside it is refused');
  assert.equal(await canFetch(server, RUNSHEET_D + SERVICE_S), true, 'a roster member cannot read the run sheet');
});

// ── survives a restart ────────────────────────────────────────────────────────────────────────────────────
// The relay self-updates and restarts, rebuilding every map by replaying the stored corpus in created_at
// order. Documents whose acceptance asks "is this author a steward?" replay BEFORE the (newer) steward roster
// they depend on, so they were dropped — silently, with the document still on disk. Measured: a church that
// narrowed its rota via a delegated steward, then edited its steward roster, served the rota to everyone
// again after the next restart, console still showing "Serving teams".
test('a steward-set restriction SURVIVES a relay restart, even after the steward roster is edited', async () => {
  // The CHURCH's own setting is left OPEN here, deliberately. An addressable doc is keyed by (kind, author,
  // d-tag), so a church-authored rota-settings and a steward-authored one are two documents that both live on
  // disk while resolving to the same church. A church doc that also said 'team' would keep the restriction up
  // by itself and hide the steward's being dropped — which is exactly how the first version of this test
  // passed against the very bug it was written for.
  await setVisibility('church');
  await sleep(1100);
  assert.equal(await publishAs(steward, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', SETTINGS_D], ['t', NET], ['church', church.pub]], content: JSON.stringify({ visibility: 'team', updated: now() }) }, steward.sk)), true, 'fixture: a delegated steward could not set rota visibility');
  await sleep(200);
  assert.equal(await canFetch(pewsat, ROTA_D + SERVICE_S), false, 'fixture: the steward-set restriction did not take effect even before a restart');

  // the church edits its steward roster — now the ONLY stewards doc on disk is NEWER than the settings doc
  await sleep(1100);
  assert.equal(await publishAs(church, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/stewards:' + church.pub], ['t', NET]], content: JSON.stringify({ pubkeys: [steward.pub, K().pub] }) }, church.sk)), true, 'fixture: the steward roster edit was refused');
  await restartRelay();

  assert.equal(await canFetch(pewsat, ROTA_D + SERVICE_S), false,
    'after a restart the church\'s rota is served to everyone again, with the visibility document still on ' +
    'disk and the console still showing "Serving teams". The church did not change its mind — the relay ' +
    'replayed the settings doc before the steward roster it is authorised by, and dropped it.');
});

test('…and so does the roster that decides WHO is on a team', async () => {
  // The mirror failure, and the worse one: if the roster ingest is dropped on replay, onAnyRoster() goes
  // false and the people who actually serve lose the rota, their own serving slots and their reminders.
  assert.equal(await canFetch(server, ROTA_D + SERVICE_S), true,
    'after a restart, a member ON the serving team can no longer fetch the rota. Their own "you\'re serving ' +
    'on Sunday" card is derived from this same document, so it goes blank too, with nothing to explain it — ' +
    'for exactly the people the setting exists to keep serving.');
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
