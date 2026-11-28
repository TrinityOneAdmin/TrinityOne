// A REGISTERED iOS PUSH TOKEN IS REMEMBERED, REPLACED BY A NEWER ONE, AND FORGOTTEN WHEN WITHDRAWN.
// Run: node --test scripts/a-push-token-is-remembered-and-forgotten.test.mjs
//
// Phase 1 of contentless APNs, relay side. The relay records a member's token into the in-memory map
// TOKENS_BY_PUB, keyed by the AUTHOR's pubkey (never the d-suffix — defence in depth, though pushtokenIdOk has
// already proved them equal on any stored event). Nothing READS the map yet (the sender is a later phase), so
// its point of use is note(): this file drives the SHIPPED note() wiring and the SHIPPED notePushtoken recorder,
// lifted from scripts/gateway.mjs and run — not a mirror — and separately drives the whole path against the live
// gateway for the store-level guarantees note() inherits (newest-wins, kind:5 deletion) and the read scope.
//
// WHAT EACH PART PINS, and each FAILS if its line is deleted (sabotage-verified 2026-11-26):
//   · delete the `else if (d.startsWith(PUSHTOKEN_D)) notePushtoken(e, removed);` BRANCH in note()  -> part 1 red
//   · delete the `map.set(...)` in notePushtoken                                                     -> part 1 red
//   · delete the `if (removed) { map.delete(pub); return; }` in notePushtoken                        -> part 1 red (drop)
//   · delete the accept() pushtoken branch                                                           -> part 2 red (nothing stored)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';
import { D } from './trinity-doc-types.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const GW = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// ══════════════ PART 1: the SHIPPED note() wiring + notePushtoken recorder, lifted and run ══════════════════
// note() is one unbroken else-if chain; a pushtoken event reaches the fourth branch and returns, so only these
// globals are ever evaluated. dtag is trivial infrastructure (one line in gateway.mjs); the recorder and the
// note() branch — the code under test — are the REAL source.
function liftRelay(map) {
  const notePushtoken = new Function('TOKENS_BY_PUB',
    fnBody(GW, 'function notePushtoken(e, removed, map = TOKENS_BY_PUB) {', 'notePushtoken') + '\nreturn notePushtoken;')(map);
  const dtag = (e) => { const t = (e.tags || []).find(t => t[0] === 'd'); return t ? t[1] : ''; };
  const note = new Function('CHURCH_PUBS', 'dtag', 'MEMBER_D', 'NETWORK_D', 'RELAYS_D', 'PUSHTOKEN_D', 'notePushtoken',
    fnBody(GW, 'function note(e) {', 'note') + '\nreturn note;')(
      new Set(['c'.repeat(64)]), dtag, 'trinityone/member:', 'trinityone/network:', 'trinityone/relays', D.PUSHTOKEN, notePushtoken);
  return { note, notePushtoken };
}
const me = 'e'.repeat(64);
const tokEvent = (content, tags = []) => ({ kind: 30078, pubkey: me, content: typeof content === 'string' ? content : JSON.stringify(content), tags: [['d', D.PUSHTOKEN + me], ...tags] });

test('note() records a stored pushtoken into TOKENS_BY_PUB, keyed by the AUTHOR', () => {
  const map = new Map();
  const { note } = liftRelay(map);
  note(tokEvent({ token: 'apns-abc', platform: 'ios', env: 'prod', ts: 111 }));
  assert.deepEqual(map.get(me), { token: 'apns-abc', platform: 'ios', env: 'prod', ts: 111 },
    'a stored pushtoken did not populate TOKENS_BY_PUB[author] — the note() branch or the recorder is not wired');
  assert.equal(map.size, 1, 'something other than the author key was written');
});

test('an EMPTY-content republish DROPS the token from TOKENS_BY_PUB (the deregister shape)', () => {
  const map = new Map();
  const { note } = liftRelay(map);
  note(tokEvent({ token: 'apns-abc', platform: 'ios', env: 'prod', ts: 111 }));
  assert.ok(map.has(me), 're-anchor: it was never recorded, so the drop below is vacuous');
  note(tokEvent(''));   // empty content -> note()'s `removed` is true
  assert.equal(map.has(me), false, 'an empty-content pushtoken did not drop the entry');
});

test('a ["deleted"] tombstone also DROPS it; garbage content never stores a half-record', () => {
  const map = new Map();
  const { note } = liftRelay(map);
  note(tokEvent({ token: 'apns-abc', platform: 'ios', env: 'prod', ts: 111 }));
  note(tokEvent('still here', [['deleted', '1']]));   // a deleted tag -> removed true, even with content
  assert.equal(map.has(me), false, 'a ["deleted"] tombstone did not drop the entry');
  note(tokEvent('not json'));
  assert.equal(map.has(me), false, 'unparseable content stored a half-record instead of dropping');
});

test('the recorder keys on the AUTHOR, not the d-suffix (defence in depth)', () => {
  const map = new Map();
  const { notePushtoken } = liftRelay(map);
  // an event whose d-suffix is someone ELSE (this never passes the door, but the recorder must not trust the tag)
  notePushtoken({ kind: 30078, pubkey: me, content: JSON.stringify({ token: 't', platform: 'ios', env: 'prod', ts: 1 }), tags: [['d', D.PUSHTOKEN + 'f'.repeat(64)]] }, false);
  assert.ok(map.has(me) && !map.has('f'.repeat(64)), 'the recorder keyed on the d-suffix instead of the author');
});

// ══════════════ PART 2: the live gateway — newest-wins, read scope, and kind:5 deletion ════════════════════
const PORT = 8923;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const church = K(), mia = K(), bea = K();
let relay, dataDir;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res(m); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => res(['(no reply)', e.id, null, '']), 5000);
});
async function publishAs(who, e) {
  const s = await conn();
  await new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); } }; s.on('message', on); setTimeout(() => res(false), 600); });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await sleep(120);
  const out = await send(s, e); s.close(); return out;
}
function reqRaw(s, sub, f, sk, ms = 700) {
  return new Promise(res => { const out = []; const on = d => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]); else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)])); }; s.on('message', on); s.send(JSON.stringify(['REQ', sub, f])); setTimeout(() => { s.off('message', on); res(out); }, ms); });
}
async function asks(who, filter) {
  const s = await conn();
  await reqRaw(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 300);
  const got = await reqRaw(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close(); return got;
}
const tok = (who, ts, content) => finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', D.PUSHTOKEN + who.pub], ['t', NET]], content: content === undefined ? JSON.stringify({ token: 'apns-' + ts, platform: 'ios', env: 'prod', ts }) : content }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'a-push-token-is-remembered-and-forgotten.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-pushtok2-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const w = await conn();
  for (const m of [mia, bea]) assert.equal((await send(w, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.MEMBER + church.pub], ['t', NET]], content: JSON.stringify({ joined: now() }) }, m.sk)))[2], true, 'fixture: a member could not join');
  w.close();
  await sleep(300);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a stored token is served to its author alone (read: subject)', async () => {
  assert.equal((await publishAs(mia, tok(mia, 1000)))[2], true, 'mia could not register her own token');
  assert.equal((await asks(mia, { kinds: [30078], authors: [mia.pub], '#d': [D.PUSHTOKEN + mia.pub] })).length, 1, 'the author could not read her own token back');
  assert.equal((await asks(bea, { kinds: [30078], authors: [mia.pub], '#d': [D.PUSHTOKEN + mia.pub] })).length, 0,
    'another member was served mia\'s push token — read is meant to be the subject alone');
});

test('a NEWER ts replaces an older; an OLDER republish is refused', async () => {
  const base = 2000;
  assert.equal((await publishAs(mia, tok(mia, base)))[2], true);
  assert.equal((await publishAs(mia, tok(mia, base + 100)))[2], true, 'the newer token was refused');
  let got = await asks(mia, { kinds: [30078], authors: [mia.pub], '#d': [D.PUSHTOKEN + mia.pub] });
  assert.equal(got.length, 1, 'more than one copy stored for one address');
  assert.equal(JSON.parse(got[0].content).ts, base + 100, 'the newer ts did not replace the older');
  const older = await publishAs(mia, tok(mia, base + 50));   // created_at below the stored newest
  assert.equal(older[2], false, 'an OLDER token was accepted over a newer one');
  got = await asks(mia, { kinds: [30078], authors: [mia.pub], '#d': [D.PUSHTOKEN + mia.pub] });
  assert.equal(JSON.parse(got[0].content).ts, base + 100, 'an older republish overwrote the newer token');
});

test('an empty-content republish clears the token value; a kind:5 removes it entirely', async () => {
  assert.equal((await publishAs(bea, tok(bea, 3000)))[2], true, 'bea could not register');
  assert.equal((await asks(bea, { kinds: [30078], authors: [bea.pub], '#d': [D.PUSHTOKEN + bea.pub] })).length, 1);
  // deregister route 1: empty content, newer created_at — replaces the record with an empty one
  assert.equal((await publishAs(bea, tok(bea, 3100, '')))[2], true, 'an empty-content deregister was refused');
  const after = await asks(bea, { kinds: [30078], authors: [bea.pub], '#d': [D.PUSHTOKEN + bea.pub] });
  assert.ok(after.length === 0 || after[0].content === '', 'the token value survived an empty-content deregister: ' + JSON.stringify(after.map(e => e.content)));
  // deregister route 2: a kind:5 delete of whatever is at that address
  const latest = (await asks(bea, { kinds: [30078], authors: [bea.pub], '#d': [D.PUSHTOKEN + bea.pub] }))[0];
  if (latest) {
    const del = finalizeEvent({ kind: 5, created_at: now(), tags: [['e', latest.id]], content: '' }, bea.sk);
    assert.equal((await publishAs(bea, del))[2], true, 'the kind:5 delete was refused');
    await sleep(200);
    assert.equal((await asks(bea, { kinds: [30078], authors: [bea.pub], '#d': [D.PUSHTOKEN + bea.pub] })).length, 0,
      'a kind:5 did not remove the pushtoken from the store');
  }
});
