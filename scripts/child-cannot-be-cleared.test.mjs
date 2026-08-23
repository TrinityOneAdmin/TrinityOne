// A CHILD CANNOT BE CLEARED TO WORK WITH CHILDREN.
// Run: node --test scripts/child-cannot-be-cleared.test.mjs
//
// Rev. Miriam, doing safeguarding on her own console for the first time (long sim, session 2):
//   "every member's button says exactly the same words — 'Clear for youth' — with nothing on it saying whose
//    row it is. My press went to the wrong row and CLEARED IVY, THE SIX-YEAR-OLD, FOR YOUTH WORK. It happened
//    instantly. No 'are you sure?', no name in a confirmation, and not a word of objection that I was
//    clearing a child I had marked as a child two minutes earlier."
//
// Measured on the relay afterwards — both documents hold her:
//   trinityone/minors:<cp>    {"pubkeys":["04c43921…"]}
//   trinityone/approved:<cp>  {"pubkeys":["04c43921…", "933c92f0…"]}
//
// I FIRST ASSUMED THIS WAS A LIVE BYPASS and the test disproved it: the kind-4 gate checks BOTH directions,
// so a child who was cleared still cannot reach another child — the SENDER being a minor stops it whatever
// their clearance says. The relay is sound on that point and the assertion below locks it in.
//
// The real danger is the UNMARK. The moment a steward corrects the child mark and takes Ivy off the minors
// list, the stale clearance is all that is left — and she becomes, to the relay, an adult cleared to work
// with children. Fixing one mistake activates the other. That is the case this file exists for.
//
// The church that most needs this to hold is the one where a steward is tired, the rows look identical, and
// nobody is watching.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8998;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const kidASk = generateSecretKey(), kidAPub = getPublicKey(kidASk);   // marked a child, AND cleared by mistake
const kidBSk = generateSecretKey(), kidBPub = getPublicKey(kidBSk);   // another child
const strangerSk = generateSecretKey(), strangerPub = getPublicKey(strangerSk);   // an ordinary adult
let relay, dataDir, clearAttempt;

const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2] === true, why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
  setTimeout(() => { ws.off('message', on); res({ ok: false, why: 'timeout' }); }, 2500);
});
const D = (d, content, sk) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET]], content: JSON.stringify(content) }, sk);
// a private message from `sk` to `toPub`
const dm = (sk, toPub) => finalizeEvent({ kind: 4, created_at: now(), tags: [['p', toPub]], content: 'ciphertext' }, sk);

before(async () => {
  await requireFreePort(PORT, 'child-cannot-be-cleared.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-sg-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(150); }
  const token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  await fetch(`http://127.0.0.1:${PORT}/config`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ addChurch: { npub: npubEncode(churchPub), name: 'Test church' } }) });

  const ws = await connect();
  for (const [sk, who] of [[kidASk, 'kidA'], [kidBSk, 'kidB'], [strangerSk, 'stranger']]) {
    await publish(ws, D('trinityone/member:' + churchPub, { name: who }, sk));
  }
  // BOTH children marked as children — and kidA ALSO cleared for youth work, which is the mis-tap.
  await publish(ws, D('trinityone/minors:' + churchPub, { pubkeys: [kidAPub, kidBPub] }, churchSk));
  // WAIT FOR THE MARK TO BE INGESTED before attempting the clearance. The write gate below can only refuse a
  // clearance for someone it already knows is a child, so publishing both back to back races it — which is a
  // real limitation of that gate, not only a test artefact, and the reason the read-side rule
  // (minor status beats clearance in approvedIn) is the one that has to hold.
  await sleep(1200);
  clearAttempt = await publish(ws, D('trinityone/approved:' + churchPub, { pubkeys: [kidAPub] }, churchSk));
  ws.close();
  await sleep(400);
});

after(() => { try { relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the relay REFUSES to clear someone who is marked as a child', async () => {
  // The mis-tap that started this: one press on an unnamed button cleared a six-year-old for youth work.
  // The two lists are now never allowed to disagree, so the contradiction cannot be stored at all.
  assert.equal(clearAttempt.ok, false,
    'a church key was allowed to publish a cleared-worker list naming a child. Every other protection here ' +
    'depends on those two lists never contradicting each other.');
});

test('an ordinary adult still cannot privately message a child', async () => {
  const ws = await connect();
  const r = await publish(ws, dm(strangerSk, kidBPub)); ws.close();
  assert.equal(r.ok, false,
    'the baseline protection is gone: an uncleared adult reached a child. Nothing else in this file means ' +
    'anything if this fails.');
});

test('a CHILD who was cleared by mistake cannot reach another child', async () => {
  const ws = await connect();
  const r = await publish(ws, dm(kidASk, kidBPub)); ws.close();
  assert.equal(r.ok, false,
    'a six-year-old, marked as a child AND cleared for youth work by a mis-tap, can privately message ' +
    'another child. Being on the minors list must beat being on the cleared list — a child is never a ' +
    'cleared worker, whatever a tired steward tapped.');
});

test('after unmarking, there is no stale clearance left to activate', async () => {
  // THIS IS WHAT THE FIX IS FOR, and it is asserted on the stored documents rather than on whether a message
  // gets through. My first three attempts measured message delivery and were flaky — the refusals I was
  // reading came from the MEMBERSHIP gate ("not a member"), not from safeguarding, so the test was racing
  // member-doc ingestion and telling me nothing about the rule. Twice it passed for the wrong reason.
  //
  // Before the fix: the clearance was stored, the steward corrected the child mark, and the leftover
  // clearance made a six-year-old an adult this relay treats as cleared to message children. Now the
  // clearance is refused at write time, so unmarking cannot activate anything.
  const ws = await connect();
  const un = await publish(ws, D('trinityone/minors:' + churchPub, { pubkeys: [kidBPub] }, churchSk));
  assert.equal(un.ok, true, 'the unmark itself was refused: ' + un.why);
  const stored = await new Promise((resolve) => {
    const evts = [];
    const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === 'apchk') evts.push(m[2]); };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', 'apchk', { kinds: [30078], '#d': ['trinityone/approved:' + churchPub] }]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', 'apchk'])); } catch {} resolve(evts); }, 700);
  });
  ws.close();
  const cleared = stored.flatMap(ev => { try { return JSON.parse(ev.content).pubkeys || []; } catch { return []; } });
  assert.equal(cleared.includes(kidAPub), false,
    'the six-year-old is still on the church\'s cleared-worker list after being unmarked as a child — the ' +
    'correction has activated the mis-tap');
});
