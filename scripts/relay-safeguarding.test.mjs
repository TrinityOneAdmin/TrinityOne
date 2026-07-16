// Relay child-safeguarding gate + positive roster read — black-box against a REAL, CHURCH-REGISTERED relay on
// an ISOLATED high port with a throwaway data dir (never a8, never the :8000 dev relay).
//   Run: node --test scripts/relay-safeguarding.test.mjs
//
// The highest-stakes invariant in a church app: a DM between a MINOR and a non-cleared adult must never reach
// anyone — including the two parties. The relay enforces this in DEPTH:
//   • WRITE side (accept): it refuses to even STORE such a DM.
//   • READ side (canRead): a DM stored BEFORE the minor was marked (or arriving via replication / a seized
//     relay's history) is withheld from everyone once the minors list names them.
// A cleared youth worker CAN reach a minor, and an ordinary member can still read their own church roster.
// Enforcing mode needs a registered church (CHURCH_NPUB) so the relay ingests the minors/approved/member docs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8838;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', MINORS_D = 'trinityone/minors:', APPROVED_D = 'trinityone/approved:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();      // the registered church (owner)
const M = K();           // a minor
const X = K();           // an adult NOT cleared for youth work
const Y = K();           // an adult cleared for youth work (on the approved list)
const A = K();           // an ordinary member (for the roster-read check)
const churchHex = church.pub;

let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); }
  throw new Error('relay did not become ready on :' + PORT);
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
// resolve to the OK result [accepted:boolean, reason]
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const memberDoc = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + churchHex]], content: JSON.stringify({ joined: now() }) }, who.sk);
const churchList = (dpfx, pubs) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', dpfx + churchHex]], content: JSON.stringify({ pubkeys: pubs }) }, church.sk);
const dm = (from, toPub, body) => finalizeEvent({ kind: 4, created_at: now(), tags: [['p', toPub]], content: body }, from.sk);

function reqCollect(ws, subId, filter, authSk, window = 700) {
  return new Promise((resolve) => {
    const events = []; let gotAuth = false;
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH') { gotAuth = true; if (authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); }
    };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve({ events, gotAuth }); }, window);
  });
}
const dms = r => r.events.filter(e => e.kind === 4);

let pub;   // a persistent publisher connection reused by the write-side tests
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-sg-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  await waitReady();
  pub = await connect();
  // everyone joins the (ungated) church → effective members
  for (const who of [M, X, Y, A]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'member joined');
  // church clears Y for youth work (X is deliberately left off)
  assert.equal((await publish(pub, churchList(APPROVED_D, [Y.pub])))[0], true, 'approved list stored');
  await sleep(120);
  // DMs are exchanged and stored WHILE M IS NOT YET MARKED A MINOR — so they land in the store legitimately
  assert.equal((await publish(pub, dm(M, X.pub, 'MINOR-to-NONCLEARED-secret')))[0], true, 'pre-existing M↔X dm stored');
  assert.equal((await publish(pub, dm(Y, M.pub, 'CLEAREDWORKER-to-MINOR-ok')))[0], true, 'Y↔M dm stored');
  // NOW the church marks M a minor → the stored M↔X DM retroactively becomes unsafe
  assert.equal((await publish(pub, churchList(MINORS_D, [M.pub])))[0], true, 'minors list stored');
  await sleep(150);   // let rebuildMinors settle
});

after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ---- READ side: a DM stored before marking is now withheld from everyone (defense-in-depth / seized-relay) ----
test('the pre-existing minor↔non-cleared DM is now withheld from the MINOR themselves', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'm', { kinds: [4] }, M.sk);
  assert.ok(!dms(r).some(e => e.content.includes('MINOR-to-NONCLEARED')), 'the minor cannot pull their own now-unsafe DM back');
  ws.close();
});

test('...and from the non-cleared adult', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'x', { kinds: [4] }, X.sk);
  assert.equal(dms(r).length, 0, 'the non-cleared adult gets nothing — both parties are denied');
  ws.close();
});

test('...and from an anonymous observer', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'anon', { kinds: [4] });
  assert.equal(dms(r).length, 0, 'no DM envelope leaks to anon');
  ws.close();
});

// ---- the safe conversation with a cleared worker is unaffected ----
test('a CLEARED youth worker still reads their DM with the minor', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'y', { kinds: [4] }, Y.sk);
  assert.ok(dms(r).some(e => e.content.includes('CLEAREDWORKER-to-MINOR')), 'cleared worker ↔ minor is served');
  assert.ok(!dms(r).some(e => e.content.includes('MINOR-to-NONCLEARED')), 'but not the unsafe one');
  ws.close();
});

test('the minor DOES receive the safe cleared-worker DM they are party to', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'm2', { kinds: [4] }, M.sk);
  assert.ok(dms(r).some(e => e.content.includes('CLEAREDWORKER-to-MINOR')), 'the minor still gets the SAFE conversation');
  ws.close();
});

// ---- WRITE side: once marked, a NEW unsafe DM can't even be stored ----
test('a NEW minor↔non-cleared DM is refused at write (never stored)', async () => {
  const [ok, reason] = await publish(pub, dm(M, X.pub, 'new-unsafe-attempt'));
  assert.equal(ok, false, 'the relay refuses to store it');
  assert.match(reason, /not a member or not permitted/);
});

test('a NEW cleared-worker↔minor DM IS accepted at write', async () => {
  const [ok] = await publish(pub, dm(Y, M.pub, 'new-safe-note'));
  assert.equal(ok, true, 'the cleared worker can still write to the minor');
});

// ---- positive roster read + anon still gated ----
test('an ordinary member CAN read the church roster once authenticated', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'ros', { kinds: [30078], '#d': [MEMBER_D + churchHex] }, A.sk);
  assert.ok(r.events.filter(e => e.kind === 30078).length >= 1, 'an authenticated effective member reads the member docs');
  ws.close();
});

test('...but an ANONYMOUS client still cannot read the roster', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'ra', { kinds: [30078], '#d': [MEMBER_D + churchHex] });
  assert.equal(r.events.filter(e => e.kind === 30078).length, 0, 'the roster stays gated from anon even with a church registered');
  assert.equal(r.gotAuth, true, 'relay challenged (docs present, withheld)');
  ws.close();
});
