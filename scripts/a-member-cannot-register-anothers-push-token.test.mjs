// A MEMBER MAY REGISTER AN iOS PUSH TOKEN ONLY UNDER THEIR OWN KEY — SCREEN-FREE RELAY RULE (phase 1 of
// contentless APNs). Run: node --test scripts/a-member-cannot-register-anothers-push-token.test.mjs
//
// THE DOC TYPE: kind 30078, replaceable, d=trinityone/pushtoken:<memberpubhex> where the suffix is the AUTHOR's
// OWN pubkey; content = cleartext JSON {token, platform, env, ts}. It is member-writable, so without a
// self-binding rule the generic kind-30078 member catch-all (memberDocTypeOk) would admit d=pushtoken:<B> signed
// by A — member A registering a push token under member B's key — which a future APNs sender would turn into
// "wake A's phone for B", or let A silence B by overwriting B's token (an addressable write REPLACES).
//
// THE RULE, and this file drives it END TO END against the shipped gateway on a fresh data dir (no app screen in
// phase 1, so the relay IS the point of use):
//   accept()                 — a dedicated branch BEFORE the member catch-all: pushtokenIdOk(e,d) (suffix ===
//                              signer, a stateless mirror of arrivalIdOk) AND MEMBERS.has(signer).
//   /import, syncChurchFromPeer, reconcileChurchWithPeer — the SAME stateless pushtokenIdOk at all three ingest
//                              doors that bypass accept(), so a forgery cannot arrive by restore or peer sync and
//                              sit beside the honest token (addressable, newest-wins). The import door is driven
//                              below; the two relay-to-relay doors share the identical one line.
//
// FOUR CASES, each FAILS if its feature line is deleted (sabotage-verified 2026-11-26, scoped to the branch —
// drop `pushtokenIdOk(e,d) &&` and case 2 goes green-to-red; drop `&& MEMBERS.has(e.pubkey)` and case 3 does;
// remove the /import guard and case 4 does).
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
import { D } from './trinity-doc-types.mjs';

const PORT = 8922;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const HOST = `127.0.0.1:${PORT}`;
const NET = 'trinityone';
const ROOT = new URL('../', import.meta.url).pathname;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();     // the one configured church
const mia = K();        // an ORDINARY MEMBER (self-joined)
const mallory = K();    // another member — tries to register under mia's key
const victim = K();     // a member whose token-slot an attacker targets
const stranger = K();   // never joined — not a member of anything on the box

let relay, dataDir;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res(m); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => res(['(no reply)', e.id, null, '']), 5000);
});
async function publishAs(who, e) {
  const s = await conn();
  await new Promise(res => {
    const on = d => { const m = JSON.parse(d); if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); } };
    s.on('message', on); setTimeout(() => res(false), 600);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await sleep(120);
  const out = await send(s, e); s.close(); return out;
}
function reqRaw(s, sub, f, sk, ms = 700) {
  return new Promise(res => {
    const out = [];
    const on = d => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]); else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)])); };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms);
  });
}
async function asks(who, filter) {
  const s = await conn();
  await reqRaw(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 300);
  const got = await reqRaw(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close(); return got;
}
const token = (who, suffixPub, extra = {}) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', D.PUSHTOKEN + suffixPub], ['t', NET]],
  content: JSON.stringify({ token: 'apns-' + suffixPub.slice(0, 6), platform: 'ios', env: 'prod', ts: now(), ...extra }),
}, who.sk);
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

before(async () => {
  await requireFreePort(PORT, 'a-member-cannot-register-anothers-push-token.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-pushtok-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent' },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const w = await conn();
  for (const m of [mia, mallory, victim]) assert.equal((await send(w, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.MEMBER + church.pub], ['t', NET]], content: JSON.stringify({ joined: now() }) }, m.sk)))[2], true, 'fixture: a member could not join');
  w.close();
  await sleep(300);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── CASE 1: a member registering their OWN token is ADMITTED, and it lands ───────────────────────────────
test('a member registering their OWN push token (suffix == author) is admitted and stored', async () => {
  const frame = await publishAs(mia, token(mia, mia.pub));
  assert.equal(frame[2], true, 'a member was refused her OWN push token: ' + JSON.stringify(frame));
  const got = await asks(mia, { kinds: [30078], authors: [mia.pub], '#d': [D.PUSHTOKEN + mia.pub] });
  assert.equal(got.length, 1, 'admitted at the frame but not stored (or not served to its author)');
});

// ── CASE 2: a member registering under ANOTHER member's key is REFUSED — THE CORE SAFETY PROPERTY ────────
test('a member registering a token under ANOTHER member\'s pubkey (suffix != author) is refused and not stored', async () => {
  const frame = await publishAs(mallory, token(mallory, victim.pub));
  assert.equal(frame[2], false,
    'CORE HOLE: a member registered an iOS push token under another member\'s key — a future sender would wake ' +
    'the wrong phone, or this overwrites the victim\'s token. Frame: ' + JSON.stringify(frame));
  // not on disk either — read the victim\'s own address back as the victim (an author always reads their own)
  assert.equal((await asks(victim, { kinds: [30078], authors: [mallory.pub], '#d': [D.PUSHTOKEN + victim.pub] })).length, 0,
    'refused at the frame and stored anyway');
});

// ── CASE 3: a NON-MEMBER is refused even for their own key ───────────────────────────────────────────────
test('a non-member registering their own push token is refused (MEMBERS.has gate)', async () => {
  const frame = await publishAs(stranger, token(stranger, stranger.pub));
  assert.equal(frame[2], false, 'a non-member registered a push token: ' + JSON.stringify(frame));
  assert.equal((await asks(stranger, { kinds: [30078], authors: [stranger.pub], '#d': [D.PUSHTOKEN + stranger.pub] })).length, 0,
    'refused at the frame and stored anyway');
});

// ── CASE 4: the suffix binding also holds on an INGEST door that bypasses accept() (/import) ─────────────
test('on /import (which bypasses accept()) a token under another member\'s key is dropped; the author\'s own is kept', async () => {
  const forged = token(mallory, victim.pub);   // mallory signs the victim\'s address
  const own = token(mallory, mallory.pub);     // mallory signs her own address
  const [status, body] = await importAs(church, [forged, own]);
  assert.equal(status, 200, '/import refused the church key — the ingest door is not being exercised: ' + JSON.stringify(body));
  assert.equal(body.imported, 1,
    'THE INGEST DOOR DID NOT APPLY THE SUFFIX BINDING: expected only the author\'s own token to land. ' +
    'imported=' + body.imported + ' invalid=' + body.invalid);
  await sleep(300);
  assert.equal((await asks(victim, { kinds: [30078], authors: [mallory.pub], '#d': [D.PUSHTOKEN + victim.pub] })).length, 0,
    'the forged token arrived by import and sits at the victim\'s address');
  assert.equal((await asks(mallory, { kinds: [30078], authors: [mallory.pub], '#d': [D.PUSHTOKEN + mallory.pub] })).length, 1,
    'the author\'s OWN imported token was dropped — the guard is refusing everything, not just the forgery');
});
