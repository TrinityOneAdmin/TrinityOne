// A photo a steward has switched off must not be drawn by the steward's own console.
// Run: node --test scripts/console-photo-suppression.test.mjs
//
// AUDIT-2026-07-28 F6. `nophoto:<churchpub>` is the church-signed list of members whose uploaded photo a
// steward has suppressed. Every member's phone has honoured it since the feature shipped — fellowship.src.js
// keeps a `_noPhoto` set and consults it inside displayFor(), so every member-app surface inherits it. The
// CONSOLE consulted it nowhere. Reproduced by running the shipped SkBadge:
//
//     photo SWITCHED OFF by a steward    -> PHOTO IS DRAWN   center/cover no-repeat url(data:image/webp;…
//     photo allowed (control)            -> PHOTO IS DRAWN   center/cover no-repeat url(data:image/webp;…
//
// Identical. That is the members list — the one screen where a steward would be moderating an image of a
// child — and the button beside it reads "your church sees their symbol/initial". The product promised the
// opposite of what it did, on a safeguarding control.
//
// This runs the real component (transpiled with the same esbuild the build uses) rather than reading it, and
// separately proves the suppression set is actually fed by a real nophoto: document off a real relay. A test
// that only checked the component would pass with the plumbing disconnected, which is the same shape as
// "openMemberName had no callers".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8975;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), hidden = K(), shown = K();
const PHOTO = 'data:image/webp;base64,AAAABBBBCCCC';
const av = { kind: 'photo', color: '#C2913A', photo: PHOTO };
let relay, dataDir;

// ── the real component ───────────────────────────────────────────────────────────────────────────────────
const DATA = readFileSync(join(ROOT, 'app/stew-data.jsx'), 'utf8');
async function loadBadge(suppressedSet) {
  const snippet = DATA.slice(DATA.indexOf('const _avPhoto ='), DATA.indexOf('// ── labelled field'));
  const tmp = join(tmpdir(), 'f6-badge-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  writeFileSync(tmp, snippet + '\nexport { SkBadge };\n');
  let js;
  try { js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' }); }
  finally { rmSync(tmp, { force: true }); }
  globalThis.__R = { createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }) };
  globalThis.__S = { photoSuppressed: (pk) => suppressedSet.has(String(pk || '').toLowerCase()) };
  // A getter, not a snapshot: identical data: URLs are cached by the ES module loader, so a second call
  // returns the FIRST module — which had captured the first (empty) suppression set, and every later test
  // silently ran against it. Test 2 failed for that reason and not because the fix was wrong.
  const b64 = Buffer.from('const React = globalThis.__R;\nconst window = { get Steward() { return globalThis.__S; } };\n' + js).toString('base64');
  return (await import('data:text/javascript;base64,' + b64)).SkBadge;
}
const drawsPhoto = (el) => String(el.props.style.background).includes(PHOTO);

test('CONTROL: the badge draws a photo when nothing is suppressed', async () => {
  // If this fails the harness is broken, and every "suppressed correctly" below would be meaningless.
  const SkBadge = await loadBadge(new Set());
  assert.equal(drawsPhoto(SkBadge({ initials: 'TB', av, pubkey: shown.pub, size: 36 })), true,
    'the badge draws no photo even with nothing suppressed — the TEST is broken, not the console');
});

test('a photo a steward switched off is not drawn', async () => {
  const SkBadge = await loadBadge(new Set([hidden.pub]));
  const el = SkBadge({ initials: 'TB', av, pubkey: hidden.pub, size: 36 });
  assert.equal(drawsPhoto(el), false,
    'the console drew a photo a steward suppressed — on the screen where a steward moderates an image of a child');
  assert.match(String(el.props.style.background), /linear-gradient/, 'it must fall back to their symbol/colour, not to nothing');
});

test('and everyone else still has theirs', async () => {
  const SkBadge = await loadBadge(new Set([hidden.pub]));
  assert.equal(drawsPhoto(SkBadge({ initials: 'AB', av, pubkey: shown.pub, size: 36 })), true,
    'suppression leaked to a member it was never applied to');
});

test('a badge with no pubkey is unaffected (church logos, mocks)', async () => {
  const SkBadge = await loadBadge(new Set([hidden.pub]));
  assert.equal(drawsPhoto(SkBadge({ initials: 'GC', av, size: 36 })), true,
    'suppression now applies to badges that are not members at all');
});

// ── the plumbing: the set must actually come from the church's signed document ───────────────────────────
before(async () => {
  await requireFreePort(PORT, 'console-photo-suppression.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-nophoto-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the suppression set is fed by the church’s real nophoto document', async () => {
  // Publish the real doc, then read it back the way the console subscribes, and assert the shipped
  // subscribeSafeguard hands the list to the shipped _applyNoPhotoList. Without this the component test above
  // would pass with the two halves wired to nothing.
  const w = await new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
  const doc = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/nophoto:' + church.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [hidden.pub] }) }, church.sk);
  const [ok] = await new Promise(res => {
    const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === doc.id) { w.off('message', on); res([m[2], m[3]]); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', doc]));
    setTimeout(() => res(['(no reply)']), 4000);
  });
  assert.equal(ok, true, 'the relay refused the church’s own photo-suppression list — fixture problem');
  // nophoto: is NOT world-readable — canRead is default-deny and serves it to the church/its stewards over a
  // NIP-42 authenticated socket only. Reading it unauthenticated returns nothing and would "prove" the
  // opposite of what this test is for, so answer the challenge as the church, exactly as the console does.
  const got = await new Promise(res => {
    let ev = null;
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, church.sk)]));
      if (m[0] === 'EVENT' && m[1] === 'np') ev = m[2];
      if (m[0] === 'EOSE' && m[1] === 'np') { w.off('message', on); res(ev); }
    };
    w.on('message', on); w.send(JSON.stringify(['REQ', 'np', { kinds: [30078], '#d': ['trinityone/nophoto:' + church.pub] }]));
    setTimeout(() => res(ev), 6000);
  });
  w.close();
  assert.ok(got, 'the nophoto document is not readable by the console');
  assert.deepEqual(JSON.parse(got.content).pubkeys, [hidden.pub]);

  // and the shipped console wires that list into the lookup the badge calls
  const S = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
  const at = S.indexOf('NOPHOTO_D + pub');
  assert.notEqual(at, -1, 'the console no longer reads the nophoto document');
  assert.match(S.slice(at, at + 400), /_applyNoPhotoList\(/,
    'subscribeSafeguard reads the list and never feeds it to the suppression set — the badge will consult an empty set for ever');
  assert.match(S, /photoSuppressed\(memberPub\)/, 'window.Steward.photoSuppressed is gone, so the badge cannot ask');
});

test('suppression does not survive an identity switch', () => {
  // It is per church. Carrying it across would leak one church's moderation decisions onto another's screen.
  const S = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
  const at = S.search(/_nameKeyRing = \[\];\s*_nameKeyDocKeys = null/);
  assert.notEqual(at, -1, 're-anchor: the per-identity reset block has moved');
  assert.match(S.slice(at, at + 700), /_applyNoPhotoList\(\[\]\)/,
    'the photo-suppression list survives an identity switch');
});

// ── the anti-rot property ────────────────────────────────────────────────────────────────────────────────
test('every console badge that draws a MEMBER passes their pubkey', () => {
  // The bug was not that one screen forgot — it is that the badge could not know who it was drawing. A call
  // site that passes `av` is rendering a person; without `pubkey` it cannot be suppressed, silently.
  const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
  const bad = [...DASH.matchAll(/<SkBadge[^>]*\bav=\{[^}]*\}[^>]*\/>/g)]
    .map(m => m[0]).filter(t => !/\bpubkey=\{/.test(t));
  assert.deepEqual(bad, [],
    'these draw a member’s avatar without telling the badge who it is, so a suppressed photo will be shown');
});
