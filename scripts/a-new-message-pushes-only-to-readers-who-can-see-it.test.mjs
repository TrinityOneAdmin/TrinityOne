// A NEW MESSAGE PUSHES (CONTENTLESSLY) ONLY TO MEMBERS WHO HOLD A TOKEN AND canRead IT — PHASE 2 of iOS APNs.
// Run: node --test scripts/a-new-message-pushes-only-to-readers-who-can-see-it.test.mjs
//
// Phase 2 is the relay-side INGEST PUSH HOOK. When a NEW message is stored at the single LIVE websocket EVENT
// site, maybePushNotify(evt) decides who gets a contentless "New message" wake and hands each chosen recipient to
// a SEAM (sendContentlessPush) that Phase 2 leaves a NO-OP and Phase 3 implements as the real APNs send.
//
// POINT OF USE (CLAUDE.md #1): the gateway is SPAWNED and driven over the wire, so every assertion rides the
// shipped hook and the shipped canRead — not a mirror. The seam is observed through TRINITY_PUSH_SPY_FILE, a
// test-only env the gateway reads at boot to install a spy sender (inert in the field; it SENDS nothing). It is
// the only way to watch a per-recipient hook across the process boundary.
//
// child-safety critical: canRead is the SOLE visibility gate, so nobody is woken for a message they cannot read —
// not a minor for an adults-only room, not a non-member of an invite-only room, not a third party to a DM.
//
// WHAT EACH CASE PINS, and each FAILS if its feature line is deleted (sabotage-verified 2026-11-26, scoped to
// maybePushNotify / note()):
//   1 DM           — the ['p'] recipient is pushed, the SENDER is not, an unrelated token-holder is not.
//                    SABOTAGE: drop `if (pub === e.pubkey) continue;`        -> case 1 red (sender pushed).
//   2 ROOM         — an in-room token-holder is pushed; a MINOR in the room (adults-only bar) and a church member
//                    NOT in the invite room are BOTH withheld; the sender is not.
//                    SABOTAGE: drop `if (!canRead(e, pub)) continue;`        -> case 2 red (minor + outsider pushed).
//   3 ALLOWLIST    — a live kind-7 reaction, a kind-5, and a kind-1 with NO group id push ZERO times.
//                    SABOTAGE: drop `if (!eligible) return;`                 -> case 3 red (reaction pushes).
//   4 LIVE-ONLY    — the SAME message arriving by /import (restore) or surviving a BOOT rehydrate pushes ZERO
//                    times; and note() itself NEVER calls the seam (lifted + run) — the push-storm guard.
//                    SABOTAGE: add `maybePushNotify(e)` into note()          -> case 4c red (note storms).
//   5 NO TOKEN     — a message whose only eligible reader holds no token pushes ZERO times (token-bounded).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8925;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const HOST = `127.0.0.1:${PORT}`;
const NET = 'trinityone';
const ROOT = new URL('../', import.meta.url).pathname;
const GW = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();               // the one configured church (also publishes the group + minors docs)
const A = K();                    // DM sender (adult member, token)
const B = K();                    // DM recipient + in-room reader (adult member, token)
const C = K();                    // room sender (adult member, token; unrelated to the A->B DM)
const M = K();                    // a MINOR member, IN the room, token — withheld by the adults-only bar
const E = K();                    // adult member, token, NOT in the invite room — withheld by visibility
const N = K();                    // adult member, NO token — DM recipient for the token-bounded case
const GID = 'room-' + Math.random().toString(16).slice(2, 10);   // no embedded owner -> church is first writer

let relay, dataDir, spyFile;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res(m); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => res(['(no reply)', e.id, null, '']), 5000);
});
async function publishAs(who, e) {
  const s = await conn();
  await new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); } }; s.on('message', on); setTimeout(() => res(false), 600); });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [1], limit: 1 }]));
  await sleep(120);
  const out = await send(s, e); s.close(); return out;
}
const nip98 = (who, path, extra = []) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: now(), tags: [['u', `http://${HOST}${path}`], ['method', 'POST'], ...extra], content: '',
}, who.sk))).toString('base64');
const importAs = async (who, events) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/import`, {
    method: 'POST',
    headers: { Authorization: nip98(who, '/import', [['church', church.pub]]), 'Content-Type': 'application/x-ndjson' },
    body: events.map(e => JSON.stringify(e)).join('\n') + '\n',
  });
  return [r.status, await r.json().catch(() => ({}))];
};

// the spy: one JSON line per seam call ({ to, id, kind, from }). reset before each action, read after.
const resetSpy = () => { try { writeFileSync(spyFile, ''); } catch {} };
const spyLines = () => { try { return readFileSync(spyFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const pushedTo = () => spyLines().map(x => x.to);

const member = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.MEMBER + church.pub], ['t', NET]], content: JSON.stringify({ joined: now() }) }, who.sk);
const token = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.PUSHTOKEN + who.pub], ['t', NET]], content: JSON.stringify({ token: 'apns-' + who.pub.slice(0, 6), platform: 'ios', env: 'prod', ts: now() }) }, who.sk);
const dm = (from, toPub, ts = now()) => finalizeEvent({ kind: 4, created_at: ts, tags: [['p', toPub], ['t', NET]], content: 'ciphertext' }, from.sk);
const roomMsg = (from, gid, ts = now()) => finalizeEvent({ kind: 1, created_at: ts, tags: [['t', gid], ['t', NET], ['p', church.pub]], content: 'hello room' }, from.sk);

function spawnRelay() {
  return spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent', TRINITY_PUSH_SPY_FILE: spyFile },
  });
}
async function waitReady() { const t0 = Date.now(); while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); } }
async function waitGone() { const t0 = Date.now(); while (Date.now() - t0 < 10000) { try { await fetch(`http://127.0.0.1:${PORT}/status`); } catch { return; } await sleep(100); } }

before(async () => {
  await requireFreePort(PORT, 'a-new-message-pushes-only-to-readers-who-can-see-it.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-pushnotify-'));
  spyFile = join(dataDir, 'push-spy.ndjson');
  relay = spawnRelay();
  await waitReady();
  // everyone self-joins the church…
  for (const who of [A, B, C, M, E, N]) assert.equal((await publishAs(who, member(who)))[2], true, 'fixture: a member could not join');
  // …everyone but N registers an iOS token (these are kind-30078 — allowlisted OUT of the hook, so they push nobody)…
  for (const who of [A, B, C, M, E]) assert.equal((await publishAs(who, token(who)))[2], true, 'fixture: a member could not register a token');
  // …the church defines an INVITE-ONLY room whose members are C (sender), B (reader) and M (minor); E is left out…
  assert.equal((await publishAs(church, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.GROUP + GID], ['t', NET]], content: JSON.stringify({ visibility: 'invite', members: [C.pub, B.pub, M.pub], name: 'Room' }) }, church.sk)))[2], true, 'fixture: the group def was refused');
  // …and marks M a minor of the church (so the adults-only-room bar applies to M).
  assert.equal((await publishAs(church, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.MINORS + church.pub], ['t', NET]], content: JSON.stringify({ pubkeys: [M.pub] }) }, church.sk)))[2], true, 'fixture: the minors doc was refused');
  await sleep(400);
  resetSpy();   // discard anything the fixture writes (nothing should — the lines above are all kind-30078)
  assert.equal(spyLines().length, 0, 'fixture publishes (all kind-30078) fired a push — the allowlist is not holding');
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── CASE 1: a DM wakes its ['p'] recipient alone — not the sender, not a bystander ──────────────────────────
test('a live kind-4 DM pushes the recipient, NOT the sender, NOT an unrelated token-holder', async () => {
  resetSpy();
  assert.equal((await publishAs(A, dm(A, B.pub)))[2], true, 'the DM was refused at the frame');
  await sleep(150);
  const to = pushedTo();
  assert.deepEqual(to, [B.pub], 'exactly B should be woken by A->B; got ' + JSON.stringify(to.map(p => p.slice(0, 6))));
  assert.ok(!to.includes(A.pub), 'the SENDER was pushed to their own phone');
  assert.ok(!to.includes(C.pub) && !to.includes(M.pub) && !to.includes(E.pub), 'a third party to the DM was pushed — canRead did not narrow it to the p-tag');
});

// ── CASE 2: a room message wakes a reader, and is WITHHELD from a minor (adults-only) and a non-member ──────
test('a live kind-1 room message pushes an in-room reader; withholds the minor and the outsider; skips the sender', async () => {
  resetSpy();
  assert.equal((await publishAs(C, roomMsg(C, GID)))[2], true, 'the room message was refused at the frame');
  await sleep(150);
  const to = pushedTo();
  assert.deepEqual(to, [B.pub], 'exactly B (in-room, adult, token) should be woken; got ' + JSON.stringify(to.map(p => p.slice(0, 6))));
  assert.ok(!to.includes(M.pub), 'SAFEGUARDING REGRESSION: a MINOR in a non-child-safe room was woken — canRead must bar this');
  assert.ok(!to.includes(E.pub), 'a church member who is NOT in the invite-only room was woken — canRead must bar this');
  assert.ok(!to.includes(C.pub), 'the SENDER of the room message was pushed');
});

// ── CASE 3: the KIND ALLOWLIST — reactions, deletions, and ungrouped kind-1 push nobody ─────────────────────
test('a live kind-7 reaction, a kind-5, and a kind-1 with NO group id push ZERO times', async () => {
  resetSpy();
  // a reaction, tagged into the room so it is stored and reaches the hook — the hook must still refuse it
  assert.equal((await publishAs(C, finalizeEvent({ kind: 7, created_at: now(), tags: [['t', GID], ['t', NET], ['e', 'a'.repeat(64)], ['p', church.pub]], content: '+' }, C.sk)))[2], true, 'the reaction was refused at the frame (cannot exercise the allowlist)');
  // a deletion
  assert.equal((await publishAs(C, finalizeEvent({ kind: 5, created_at: now(), tags: [['e', 'b'.repeat(64)]], content: '' }, C.sk)))[2], true, 'the kind-5 was refused at the frame');
  // a kind-1 with NO group tag (only the network tag, which gidOf excludes) -> no room id -> not a room message
  assert.equal((await publishAs(C, finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['p', church.pub]], content: 'ungrouped' }, C.sk)))[2], true, 'the ungrouped kind-1 was refused at the frame');
  await sleep(200);
  assert.equal(spyLines().length, 0, 'a non-message kind (7/5) or an ungrouped kind-1 fired a push: ' + JSON.stringify(spyLines()));
});

// ── CASE 5: a message whose only reader holds no token pushes nobody (token-bounded) ────────────────────────
test('a DM to a tokenless member pushes ZERO times (the hook is bounded to token-holders)', async () => {
  resetSpy();
  assert.equal((await publishAs(A, dm(A, N.pub)))[2], true, 'the DM to N was refused at the frame');
  await sleep(150);
  assert.equal(spyLines().length, 0, 'a push fired for A->N although N holds no token (did the hook iterate members, not tokens?): ' + JSON.stringify(spyLines()));
});

// ── CASE 4a: the SAME DM arriving by /import (a restore) pushes nobody — no storm on resync ─────────────────
test('LIVE-PATH-ONLY: a DM delivered via /import (not the live EVENT site) pushes ZERO times', async () => {
  resetSpy();
  // a brand-new, valid A->B DM the box has never seen, pushed in through the restore door
  const restored = dm(A, B.pub, now() - 3600);
  const [status, body] = await importAs(church, [restored]);
  assert.equal(status, 200, '/import refused the church key — the ingest door is not being exercised: ' + JSON.stringify(body));
  assert.equal(body.imported, 1, 'the DM was not actually stored by /import, so a zero-push result is vacuous: ' + JSON.stringify(body));
  await sleep(250);
  assert.equal(spyLines().length, 0, 'IMPORTING a message fired a push — the hook is on an ingest path, not the live site only: ' + JSON.stringify(spyLines()));
});

// ── CASE 4b: a BOOT rehydrate of the stored corpus pushes nobody ────────────────────────────────────────────
test('LIVE-PATH-ONLY: restarting the relay (boot rehydrate replays the store through note()) pushes ZERO times', async () => {
  resetSpy();
  try { relay.kill('SIGKILL'); } catch {}
  await waitGone();
  relay = spawnRelay();
  await waitReady();
  await sleep(600);   // let hydrateMaps() finish replaying the stored corpus through note()
  assert.equal(spyLines().length, 0, 'a RESTART replayed pushes — the hook ran during boot rehydrate: ' + JSON.stringify(spyLines()));
});

// ── CASE 4c: note() NEVER calls the seam — lifted from gateway.mjs and run (the "hook is not in note()" guard) ─
// note() is what EVERY replay path (sync pull, negentropy reconcile, /import, boot) runs per event. If the push
// hook is ever moved inside note(), a corpus resync fires one push per message — a storm. This lifts the SHIPPED
// note() and drives a kind-4 and a kind-1 through it with a SPY in the maybePushNotify slot; the seam must never
// fire. Production note() does not reference maybePushNotify, so the spy stays silent; a hook added to note()
// makes it ring. (note() returns at `if (e.kind !== 30078) return;` for these kinds, so only CHURCH_PUBS and the
// kind guard are exercised — exactly the region a storm-causing hook would sit in front of.)
test('note() itself fires the seam ZERO times for a DM and a room message (lifted + run)', () => {
  let rang = 0;
  const spyPush = () => { rang++; };
  const dtag = (e) => { const t = (e.tags || []).find(t => t[0] === 'd'); return t ? t[1] : ''; };
  const note = new Function(
    'CHURCH_PUBS', 'dtag', 'MEMBER_D', 'NETWORK_D', 'RELAYS_D', 'PUSHTOKEN_D', 'GROUP_D', 'notePushtoken', 'maybePushNotify',
    fnBody(GW, 'function note(e) {', 'note') + '\nreturn note;'
  )(new Set(['c'.repeat(64)]), dtag, D.MEMBER, D.NETWORK, 'trinityone/relays', D.PUSHTOKEN, D.GROUP, () => {}, spyPush);
  note({ kind: 4, pubkey: A.pub, tags: [['p', B.pub]], content: 'x' });
  note({ kind: 1, pubkey: C.pub, tags: [['t', GID], ['t', NET]], content: 'y' });
  assert.equal(rang, 0, 'note() invoked the push seam — the hook has been moved into note() and every resync will storm');
});
