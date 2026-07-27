// A member's display name belongs to their congregation, not to whoever holds the disk.
// Run: node --test scripts/congregation-names.test.mjs
//
// Stage 1 (AUDIT-2026-07-27). A name is what turns an identifier into a person. Published in the clear it gave
// the relay — and any mirror holding a copy of that church — a named roster, which is the single most
// dangerous artefact in the product for the congregations it is built for. The church now mints a key, wraps a
// copy for each member (same shape as the care and media keys), and each member seals their OWN name under it.
//
// It carries a RING for the same reason the group key does: rotating when someone is removed must not hide the
// names already published. That lesson cost a day.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';

const PORT = 8900;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NAMEKEY_D = 'trinityone/namekey:', NAME_D = 'trinityone/name:', MEMBER_D = 'trinityone/member:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));
const church = K(), maria = K(), sam = K(), outsider = K();
const K1 = hex(crypto.getRandomValues(new Uint8Array(32)));
const K2 = hex(crypto.getRandomValues(new Uint8Array(32)));
let relay, dataDir, w;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const publish = (s, e) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } }; s.on('message', on); s.send(JSON.stringify(['EVENT', e])); });
const doc = (who, d, c) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(c) }, who.sk);
// the envelope the console publishes: the ring, wrapped to each recipient
const envelope = (ring, recips) => {
  const keys = {};
  for (const pk of recips) keys[pk] = nip44.encrypt(JSON.stringify(ring), nip44.utils.getConversationKey(church.sk, pk));
  return finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', NAMEKEY_D + church.pub], ['t', 'trinityone']], content: JSON.stringify({ rev: ring.length, keys }) }, church.sk);
};
// a member sealing their own name under the current key
const sealedName = (who, key, name) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', NAME_D + church.pub], ['t', 'trinityone'], ['church', church.pub]],
  content: nip44.encrypt(JSON.stringify({ name }), unhex(key)) }, who.sk);
function req(s, sub, f, sk, ms = 900) {
  return new Promise(res => { const out = [];
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)])); };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms); });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-names-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  w = await conn();
  for (const who of [maria, sam]) await publish(w, doc(who, MEMBER_D + church.pub, { joined: now() }));
  await sleep(250);
});
after(() => { try { w && w.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the church can publish a name key, and a member can seal their own name', async () => {
  assert.equal((await publish(w, envelope([K1], [church.pub, maria.pub, sam.pub])))[0], true, 'the church must be able to publish the key envelope');
  assert.equal((await publish(w, sealedName(maria, K1, 'Maria Alvarez')))[0], true, 'a member must be able to seal their own name');
  await sleep(250);
});

test('a member reads another member’s name; an outsider gets ciphertext', async () => {
  const a = await conn();
  const got = await req(a, 'n1', { kinds: [30078], '#d': [NAME_D + church.pub] }, sam.sk);
  a.close();
  assert.equal(got.length, 1, 'a fellow member must receive the sealed name');
  assert.doesNotMatch(got[0].content, /Maria/, 'the name must be ciphertext on the wire — this is the whole point');
  const opened = JSON.parse(nip44.decrypt(got[0].content, unhex(K1)));
  assert.equal(opened.name, 'Maria Alvarez', 'and it must open with the congregation key');
});

test('someone outside the church cannot even fetch it', async () => {
  const a = await conn();
  const got = await req(a, 'n2', { kinds: [30078], '#d': [NAME_D + church.pub] }, outsider.sk);
  a.close();
  assert.deepEqual(got, [], 'a stranger with a keypair received the congregation’s sealed names');
});

test('nobody can put words in another member’s mouth', async () => {
  const [ok] = await publish(w, finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', NAME_D + church.pub], ['t', 'trinityone'], ['church', church.pub]],
    content: nip44.encrypt(JSON.stringify({ name: 'Pastor' }), unhex(K1)) }, outsider.sk));
  assert.equal(ok, false, 'a non-member wrote a name doc — anyone could then claim to be anyone');
});

test('a name published BEFORE a rotation still opens afterwards', async () => {
  // Sam is removed, so the church rotates. Maria's name was sealed under the old key and must survive:
  // this is exactly the failure that erased encrypted group history before the ring existed.
  assert.equal((await publish(w, envelope([K2, K1], [church.pub, maria.pub])))[0], true);
  await sleep(250);
  const a = await conn();
  const got = await req(a, 'n3', { kinds: [30078], '#d': [NAMEKEY_D + church.pub] }, maria.sk);
  a.close();
  assert.equal(got.length, 1, 'a member must receive the key envelope');
  const ring = JSON.parse(nip44.decrypt(JSON.parse(got[0].content).keys[maria.pub], nip44.utils.getConversationKey(maria.sk, church.pub)));
  assert.equal(ring[0], K2, 'the current key must come first');
  assert.ok(ring.includes(K1), 'the superseded key must still be carried, or every earlier name is orphaned');
});

test('a removed member stops getting the key', async () => {
  const a = await conn();
  const got = await req(a, 'n4', { kinds: [30078], '#d': [NAMEKEY_D + church.pub] }, sam.sk);
  a.close();
  const env = got.length ? JSON.parse(got[0].content) : { keys: {} };
  assert.equal(env.keys[sam.pub], undefined, 'the removed member still has a copy of the key wrapped to them');
});

test('the relay no longer puts a member’s name in a push notification', () => {
  const GW = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(GW, /const who = displayName\(evt\.pubkey\)/,
    'the relay is reading a name into a payload handed to an outside push service in the clear');
  assert.doesNotMatch(GW, /const name = displayName\(evt\.pubkey\);\s*\/\/ best-effort/,
    'the join notification still names the joiner');
});

test('both apps ship the ring, not a single key', () => {
  const F = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  const S = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  assert.match(F, /_nameKeys/, 'the member app has no congregation name key');
  assert.match(S, /_nameKeyRing/, 'the console has no congregation name key');
  assert.match(S, /\[_hex\(crypto\.getRandomValues\(new Uint8Array\(32\)\)\), \.\.\.ring\]/,
    'rotation must prepend to the ring, never replace it');
});

// ── one name, many churches ─────────────────────────────────────────────────────────────────────────────────
// A member belongs to one or more churches. The name is THEIRS, so it must not become a different name per
// church that they have to keep in step by hand. The wire still carries a separate sealed copy per church —
// deliberately, so two churches or two mirror operators cannot match the same person up by comparing name
// ciphertext — but the app keeps them identical.

test('the same name seals separately for two churches, and the two copies are not comparable', async () => {
  const churchB = K(), same = 'Maria Alvarez';
  const kB = hex(crypto.getRandomValues(new Uint8Array(32)));
  const a = nip44.encrypt(JSON.stringify({ name: same }), unhex(K1));
  const b = nip44.encrypt(JSON.stringify({ name: same }), unhex(kB));
  assert.notEqual(a, b, 'the same name under two church keys must not produce the same ciphertext');
  assert.equal(JSON.parse(nip44.decrypt(a, unhex(K1))).name, same);
  assert.equal(JSON.parse(nip44.decrypt(b, unhex(kB))).name, same, 'and each church opens its own copy to the same name');
  // and one church's key must not open the other's copy
  let leaked = false;
  try { JSON.parse(nip44.decrypt(b, unhex(K1))); leaked = true; } catch (e) {}
  assert.equal(leaked, false, 'church A opened church B’s copy — the two churches could then match the member up');
  assert.ok(churchB.pub);
});

test('the member app fans one name out rather than making the caller remember every church', () => {
  const F = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  assert.match(F, /syncSealedNames/, 'there is no fan-out — a member joining a second church would drift into two names');
  const at = F.indexOf('async syncSealedNames');
  const body = F.slice(at, at + 900);
  assert.match(body, /myProfile \|\| \{\}\)\.name/, 'the fan-out must use the member’s ONE name, not a per-church one');
  assert.match(body, /_sealedMine\.get\(cp\) === nm/, 'it must be idempotent, or every reconnect republishes to every church');
});

test('changing your name re-seals it everywhere, and a late-arriving key seals on arrival', () => {
  const F = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  // `myProfile = p` appears at more than one site in the bundle, so anchoring on the FIRST one tested the
  // wrong function and failed while the code was correct. Require that SOME assignment is followed by the
  // re-seal, rather than guessing which.
  const reseals = [...F.matchAll(/myProfile = p;/g)].some(m => /syncSealedNames/.test(F.slice(m.index, m.index + 220)));
  assert.ok(reseals, 'renaming yourself would update the public profile and leave every sealed copy stale');
  // Anchor on the CALL, not on a string literal — esbuild re-quotes literals, so `'trinityone/namekey:'`
  // simply is not in the bundle and indexOf returned -1, which then sliced from the end of the file.
  const seals = [...F.matchAll(/_ingestNameKey\(cp, e\)/g)].some(m => /syncSealedNames/.test(F.slice(m.index, m.index + 320)));
  assert.ok(seals, 'a church that publishes its key after you joined would leave you nameless there for ever');
});

// ── is it actually switched on? ─────────────────────────────────────────────────────────────────────────────
// Everything above passed while NOTHING in the console ever minted a key — so the member app's key list stayed
// empty, every seal silently no-opped, and names went out in the clear exactly as before. A complete, tested,
// dormant mechanism. These are the checks that would have caught that, and they are deliberately about the
// CALL SITES rather than the protocol, because the protocol was never the part that was missing.

test('the console mints and maintains the name key', () => {
  const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  assert.match(DASH, /subscribeNameKey/, 'the console never loads the envelope, so it cannot re-key anyone');
  const at = DASH.indexOf('ensureCareKeyForMembers(memberPubs, stewardRoster)');
  assert.notEqual(at, -1, 'the key-distributor loop moved — re-anchor this test');
  assert.match(DASH.slice(at, at + 700), /ensureNameKeyForMembers\(memberPubs\)/,
    'nothing mints a name key, so every seal in the member app silently does nothing');
});

test('blocking a member rotates the name key too', () => {
  const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const at = DASH.indexOf('const block = (pk)');
  const body = DASH.slice(at, at + 3000);
  assert.match(body, /ensureNameKeyForMembers\([^)]*\{\s*rotate:\s*true\s*\}/,
    'a blocked member keeps the key and can still read the congregation’s names — the one thing this stops');
});

test('the console bundle really exports what the UI calls', () => {
  // The UI calling a method the bundle does not export is the same dormancy wearing a different hat.
  const S = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  for (const fn of ['ensureNameKeyForMembers', 'subscribeNameKey', 'openMemberName']) {
    assert.match(S, new RegExp(fn), `${fn} is missing from the shipped console bundle`);
  }
});
