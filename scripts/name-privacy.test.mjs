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
import { requireFreePort } from './test-ports.mjs';

const PORT = 8899;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), maria = K();
let relay, dataDir;

before(async () => {
  await requireFreePort(PORT, 'name-privacy.test.mjs');
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

test('the member app publishes neither a name nor a handle in kind-0', () => {
  // Stage 1 sealed the name to the congregation and left the cleartext copy beside it, so the relay still held
  // a named roster and the gate was only about who could read it. Stage 2 removes the copy. The carried-forward
  // handle goes with it — a handle is <name>@<host>, so keeping one would publish the name in a second field
  // and make the whole exercise pointless. AUDIT-2026-07-27.
  const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
  const at = SRC.indexOf('async setProfile(meta)');
  let depth = 0, end = -1;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) { const c = SRC[i]; if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i + 1; break; } }
  const body = SRC.slice(at, end);
  assert.doesNotMatch(body, /p\.nip05 = handleLocal/, 'the name is being published a second time as a handle');
  assert.doesNotMatch(body, /if \(prev\.nip05\) p\.nip05 = prev\.nip05/, 'the handle is still carried forward, and a handle contains the name');
  assert.match(body, /const wire = \{ about: p\.about, picture: p\.picture \}/, 'the published profile is not built separately from the one we keep — the name will go out with it');
  const wireAt = body.indexOf('const wire =');
  assert.doesNotMatch(body.slice(wireAt, body.indexOf('finalizeEvent', wireAt)), /wire\.name/, 'the name is being put back on the wire copy');
});

test('the shipped app really publishes a nameless profile', () => {
  const V = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  const at = V.indexOf('const wire = { about:');
  assert.notEqual(at, -1, 'the built app no longer separates the published profile from the stored one');
  const near = V.slice(at, at + 400);
  assert.doesNotMatch(near, /name:/, 'the built app still puts a name in the kind-0 it publishes');
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
