// Care-skip round trip — the RELAY half of the B3 seal, black-box against a REAL, CHURCH-REGISTERED
// relay on an ISOLATED high port with a throwaway data dir (never a8, never :8000).
//   Run: node --test scripts/relay-careskip.test.mjs
//
// scripts/care-seal.test.mjs proves the CLIENT seals a need correctly and mints a token the recipient alone
// can open. It never touches a relay, so the other half was unproven: does the gateway actually ACCEPT a
// genuine skip and REFUSE a forged one, now that it can no longer read `recipient` off the wire?
//
// The rule under test (gateway.mjs accept(), SKIP_D branch): a need carries an opaque ['skiphash', sha256(tok)]
// tag; to skip, present ['skiptok', tok]. The relay hashes and compares, learning nothing about who the
// recipient is. v1 needs (cleartext recipient) keep the old pubkey check so pre-seal needs still work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

// isolated high port — 8837 privacy, 8838 safeguarding, 8839 safety, 8840 tenancy, 8841 config.
// `npm test` globs these files and node --test runs them CONCURRENTLY, so a shared port makes every
// test in both files fail in ways that look like product bugs. Take the next free number.
const PORT = 8842;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', NEED_D = 'trinityone/care:', SKIP_D = 'trinityone/careskip:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

const church = K(), recipient = K(), otherMember = K(), outsider = K();
const cp = church.pub;
let relay, dataDir, ws;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); });

const memberDoc = who => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ joined: now() }) }, who.sk);

// a SEALED (v2) need: no `recipient` on the wire at all, just the opaque hash tag
const sealedNeed = (id, tok) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', NEED_D + id], ['p', cp], ['skiphash', sha(tok)]],
  content: JSON.stringify({ id, type: 'meals', dates: ['2026-08-01'], church: cp, sealed: 'nip44-ciphertext-stand-in' }),
}, church.sk);

// a LEGACY (v1) need: recipient pubkey in cleartext content, no skiphash
const v1Need = (id, recipPub) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', NEED_D + id], ['p', cp]],
  content: JSON.stringify({ id, type: 'meals', dates: ['2026-08-01'], church: cp, recipient: recipPub }),
}, church.sk);

const skip = (who, careId, iso, tok) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', `${SKIP_D}${careId}:${iso}`], ['p', cp], ...(tok ? [['skiptok', tok]] : [])],
  content: JSON.stringify({ skipped: true }),
}, who.sk);

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-skip-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  await waitReady();
  ws = await connect();
  // both are joined members of the church — so any rejection below is about the SKIP rule, not membership
  for (const who of [recipient, otherMember]) assert.equal((await publish(ws, memberDoc(who)))[0], true);
});

after(async () => { try { ws.close(); } catch {} try { relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a sealed need: the recipient presenting the token may skip', async () => {
  const tok = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  assert.equal((await publish(ws, sealedNeed('c-ok', tok)))[0], true, 'the church could not publish the need');
  const [ok, msg] = await publish(ws, skip(recipient, 'c-ok', '2026-08-01', tok));
  assert.equal(ok, true, `the genuine recipient was refused: ${msg}`);
});

test('a sealed need: the relay never learns who the recipient is', async () => {
  const tok = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const evt = sealedNeed('c-blind', tok);
  const wire = JSON.stringify(evt);
  assert.equal(wire.includes(recipient.pub), false, 'the recipient pubkey is on the wire');
  assert.equal(wire.includes(tok), false, 'the raw token is on the wire — anyone could replay it');
  assert.equal((await publish(ws, evt))[0], true);
});

test('a sealed need: another member with NO token cannot skip', async () => {
  const tok = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  assert.equal((await publish(ws, sealedNeed('c-notok', tok)))[0], true);
  const [ok] = await publish(ws, skip(otherMember, 'c-notok', '2026-08-01', null));
  assert.equal(ok, false, 'a member with no token skipped someone else’s care need');
});

test('a sealed need: a WRONG token is refused', async () => {
  const tok = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  assert.equal((await publish(ws, sealedNeed('c-wrong', tok)))[0], true);
  const [ok] = await publish(ws, skip(otherMember, 'c-wrong', '2026-08-01', hex(webcrypto.getRandomValues(new Uint8Array(32)))));
  assert.equal(ok, false, 'a forged token was accepted');
});

test('a sealed need: an outsider (not even a member) cannot skip', async () => {
  const tok = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  assert.equal((await publish(ws, sealedNeed('c-out', tok)))[0], true);
  const [ok] = await publish(ws, skip(outsider, 'c-out', '2026-08-01', null));
  assert.equal(ok, false, 'an outsider skipped a care need');
});

test('the token is per-need: one need’s token does not unlock another', async () => {
  const tokA = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const tokB = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  assert.equal((await publish(ws, sealedNeed('c-a', tokA)))[0], true);
  assert.equal((await publish(ws, sealedNeed('c-b', tokB)))[0], true);
  const [ok] = await publish(ws, skip(otherMember, 'c-b', '2026-08-01', tokA));
  assert.equal(ok, false, 'a token minted for one need skipped a different one');
});

test('v1 fallback: a pre-seal need still honours the cleartext recipient', async () => {
  assert.equal((await publish(ws, v1Need('c-v1', recipient.pub)))[0], true);
  const [ok, msg] = await publish(ws, skip(recipient, 'c-v1', '2026-08-01', null));
  assert.equal(ok, true, `the v1 fallback broke — an existing need lost its skip: ${msg}`);
  const [nope] = await publish(ws, skip(otherMember, 'c-v1', '2026-08-01', null));
  assert.equal(nope, false, 'v1 needs let any member skip');
});

test('the church itself can still block a date on a member’s behalf', async () => {
  const tok = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  assert.equal((await publish(ws, sealedNeed('c-steward', tok)))[0], true);
  const [ok] = await publish(ws, skip(church, 'c-steward', '2026-08-01', null));
  assert.equal(ok, true, 'the church lost the ability to skip for someone not on the app');
});
