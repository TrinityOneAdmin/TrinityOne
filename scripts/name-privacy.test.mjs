// A member's name must not be enumerable, and must not travel in a second field.
// Run: node --test scripts/name-privacy.test.mjs
//
// Stage 0 of encrypting names to the congregation (AUDIT-2026-07-27). Two channels would have quietly undone
// the encryption before it was written:
//   1. setProfile derived <name>@<relay-host> from the display name and stored it IN THE PROFILE, so the name
//      travelled twice. Encrypting one copy while publishing the other protects nothing.
//   2. /.well-known/nostr.json resolved a MEMBER's name to their identity. The bulk dump was closed in
//      2026-06-24 (L7); the scoped form is the same leak one guess at a time — "is there a maria here?" —
//      unauthenticated, from anywhere. A congregation whose safety depends on not being enumerable cannot
//      afford that. A CHURCH still resolves, because a public handle is the point of a church.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8899;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), maria = K();
let relay, dataDir;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-namepriv-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const w = new WebSocket(WS_URL); await new Promise((r, j) => { w.on('open', r); w.on('error', j); });
  const pub = (e) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res(m[2]); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', e])); });
  await pub(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone']], content: '{}' }, maria.sk));
  await pub(finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'Maria', nip05: 'maria@127.0.0.1' }) }, maria.sk));
  await pub(finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'St Marys', nip05: 'stmarys@127.0.0.1' }) }, church.sk));
  await sleep(400); w.close();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const lookup = async (name) => (await (await fetch(`http://127.0.0.1:${PORT}/.well-known/nostr.json?name=${name}`)).json()).names || {};

test('guessing a member’s name does not return their identity', async () => {
  assert.deepEqual(await lookup('maria'), {},
    'anyone could ask "is there a maria here?" and be handed her identity — a congregation must not be enumerable');
});

test('a church still resolves — a public handle is the point of a church', async () => {
  const got = await lookup('stmarys');
  assert.equal(got.stmarys, church.pub, 'churches must stay findable or invites and verification break');
});

test('an unknown name returns nothing rather than an error', async () => {
  assert.deepEqual(await lookup('nobodyhere'), {});
});

test('the member app no longer derives a handle from the display name', () => {
  const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
  const at = SRC.indexOf('async setProfile(meta)');
  const body = SRC.slice(at, at + 2400);
  assert.doesNotMatch(body, /p\.nip05 = handleLocal/, 'the name is being published a second time as a handle');
  assert.match(body, /if \(prev\.nip05\) p\.nip05 = prev\.nip05/, 'an existing handle must be carried, not silently stripped');
});

test('the shipped bundle agrees with the source', () => {
  const V = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  assert.doesNotMatch(V, /nip05 = handleLocal/, 'the built app still auto-claims a handle from the member’s name');
});

// ── the church key's own ceremony ───────────────────────────────────────────────────────────────────────────
// Not name privacy, but the same class of harm: something irreversible that a steward will click past unless
// the copy makes the consequence concrete. The ceremony (phrase hidden before the quiz, a different three on
// re-read) was already right; the message was abstract.

test('church setup states the concrete cost of losing the key, and asks for a second copy', () => {
  const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const at = DASH.indexOf('Your church’s recovery key');
  assert.notEqual(at, -1, 'the recovery-key step is gone');
  const body = DASH.slice(at, at + 3000);
  assert.match(body, /second copy/i, 'one paper copy in one place is how churches actually lose this');
  assert.match(body, /join it again/i, 'the consequence must be concrete — "cannot be recovered" reads as boilerplate');
  assert.match(body, /not by us, not from your relay, not from a backup file/i,
    'stewards assume a backup file or the relay can save them; say plainly that neither can');
});

test('the phrase is still hidden before the check — the ceremony must not regress', () => {
  const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  assert.match(DASH, /Phrase hidden — answer from the paper copy you just wrote/,
    'if the words stay on screen the check is a copy-paste and proves nothing');
});
