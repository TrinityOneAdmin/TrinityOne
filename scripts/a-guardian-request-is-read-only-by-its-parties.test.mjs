// A PARENT'S GUARDIAN-LINK REQUEST IS READ ONLY BY THE PEOPLE IT IS ABOUT.
//   Run: node --test scripts/a-guardian-request-is-read-only-by-its-parties.test.mjs
//
// Owner, 2026-10-10 (reference/DOMAIN.md): guardian-link REQUESTS follow the same rule as guardian notices —
// only the parent who wrote it, the child it names, and the church / its safeguarding stewards may read it.
// Other members must not be able to list parent/child pairs.
//
// MEASURED BEFORE THIS (system audit 2026-10-10): `trinityone/guardreq:<child>` had no branch in canRead and fell
// to the default member rule, so ANY admitted member was served every request — the d-tag names the child, the
// author is the parent, and `{child, parent}` is in the clear. A REQ for `#p: [<church>]` listed the pairs.
//
// Point of use is the RELAY: a real gateway on a free port, the request published exactly as createChildAccount
// (src/fellowship.src.js) builds it, and each reader asks with the filter shapes a real client or a nosy member
// would use.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const ROOT = new URL('../', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _t = Math.floor(Date.now() / 1000) - 300; const now = () => ++_t;
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });

// ── the cast ──────────────────────────────────────────────────────────────────────────────────────────────
const church = K();
const PARENT = K(), KID = K();
const M = K();                 // an ordinary admitted member — must see nothing
const SG = K();                // delegated steward WITH the safeguarding job
const SC = K();                // delegated steward with care + content, WITHOUT safeguarding
const cp = church.pub;
const REQ_D = 'trinityone/guardreq:' + KID.pub;

let PORT, WS_URL, relay, dataDir, pub;
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const ev = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content }, who.sk);
async function authed(who) {
  const ws = await connect();
  await new Promise((resolve) => {
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
      if (m[0] === 'OK' && m[2] === true) { ws.off('message', on); resolve(); } };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', 'kick', { kinds: [4], '#p': [who.pub], limit: 1 }]));
    setTimeout(resolve, 1500);
  });
  return ws;
}
function query(ws, filters, window = 900) {
  return new Promise((resolve) => {
    const id = 'q' + Math.random().toString(36).slice(2, 7); const evs = [];
    const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) evs.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) done(); };
    let fin = false;
    const done = () => { if (fin) return; fin = true; ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', id])); } catch {} resolve(evs); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', id, ...(Array.isArray(filters) ? filters : [filters])]));
    setTimeout(done, window);
  });
}
const dOf = e => (e.tags.find(t => t[0] === 'd') || [])[1];
// every way a client could ask for it: by d-tag, by its author, by the church p-tag (the console's own filter,
// subscribeGuardianRequests), by the child p-tag, and by the member's own p-tag
const SHAPES = () => [
  { kinds: [30078], '#d': [REQ_D] },
  { kinds: [30078], authors: [PARENT.pub] },
  { kinds: [30078], '#p': [cp] },
  { kinds: [30078], '#p': [KID.pub] },
];
async function served(who) {
  const ws = await authed(who);
  try { const all = (await query(ws, SHAPES())).filter(e => dOf(e) === REQ_D); return all; } finally { ws.close(); }
}

before(async () => {
  PORT = await freePort(); WS_URL = `ws://127.0.0.1:${PORT}/relay`;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-guardreq-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(150)) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} }
  pub = await connect();
  const ok = async (evt, what) => { const [o, why] = await publish(pub, evt); assert.equal(o, true, what + ' — ' + why); };
  for (const w of [PARENT, KID, M, SG, SC]) await ok(ev(w, 'trinityone/member:' + cp, JSON.stringify({ joined: now() })), 'member joined');
  await sleep(150);
  await ok(ev(church, 'trinityone/stewards:' + cp, JSON.stringify({ pubkeys: [SG.pub, SC.pub], caps: { [SG.pub]: ['safeguarding'], [SC.pub]: ['care', 'content'] } })), 'stewards');
  await ok(ev(church, 'trinityone/minors:' + cp, JSON.stringify({ pubkeys: [KID.pub] })), 'minors');
  await sleep(100);
  // exactly the event createChildAccount publishes (src/fellowship.src.js): d=guardreq:<child>, p church, p child
  await ok(ev(PARENT, REQ_D, JSON.stringify({ child: KID.pub, parent: PARENT.pub }), [['p', cp], ['p', KID.pub]]), 'the parent’s guardian-link request');
  await sleep(200);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('an ordinary member is served NO guardian-link request, by any filter', async () => {
  const got = await served(M);
  assert.equal(got.length, 0, 'an ordinary member was served the parent/child pair: ' + got.map(e => e.content).join(' | '));
});

test('a steward WITHOUT the safeguarding job is served no guardian-link request', async () => {
  const got = await served(SC);
  assert.equal(got.length, 0, 'a care/content steward was served the parent/child pair');
});

test('the parent who wrote it still reads it back (the member app’s _rebuildFamily asks by authors: [own key])', async () => {
  const ws = await authed(PARENT);
  try {
    const got = (await query(ws, { kinds: [30078], authors: [PARENT.pub] })).filter(e => dOf(e) === REQ_D);
    assert.equal(got.length, 1, 'the parent can no longer read their own request — _rebuildFamily would lose pending children');
  } finally { ws.close(); }
});

test('the child it names may read it', async () => {
  const got = await served(KID);
  assert.ok(got.length >= 1, 'the child named in the request was refused it');
});

test('the church key reads it (the console’s subscribeGuardianRequests asks by #p: [church])', async () => {
  const ws = await authed(church);
  try {
    const got = (await query(ws, { kinds: [30078], '#p': [cp] })).filter(e => dOf(e) === REQ_D);
    assert.equal(got.length, 1, 'the church’s own console no longer sees the request it must confirm');
  } finally { ws.close(); }
});

test('a steward WITH the safeguarding job reads it (delegated console, same #p: [church] filter)', async () => {
  const ws = await authed(SG);
  try {
    const got = (await query(ws, { kinds: [30078], '#p': [cp] })).filter(e => dOf(e) === REQ_D);
    assert.equal(got.length, 1, 'a safeguarding steward no longer sees the request');
  } finally { ws.close(); }
});

test('the named child, once the church BLOCKS them, is refused it like every other private read', async () => {
  // not a separate rule — canRead's single demotion at the top of the kind-30078 branch covers this branch too;
  // asserted so a future reorder that put the guardreq branch above the demotion is caught
  const ws = await connect();
  const ok = async (evt, what) => { const [o, why] = await publish(ws, evt); assert.equal(o, true, what + ' — ' + why); };
  await ok(ev(church, 'trinityone/blocked:' + cp, JSON.stringify({ pubkeys: [KID.pub] })), 'church blocks the child');
  ws.close();
  await sleep(200);
  const got = await served(KID);
  assert.equal(got.length, 0, 'a blocked reader was still served the request');
});
