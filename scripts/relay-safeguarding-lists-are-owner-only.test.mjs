// ONLY A CHURCH MAY WRITE ITS OWN SAFEGUARDING LISTS — INCLUDING AGAINST THE CHURCH NEXT DOOR.
//   Run: node --test scripts/relay-safeguarding-lists-are-owner-only.test.mjs
//
// Three documents decide everything this app does about children:
//   · `minors:<churchpub>`    — who is a child
//   · `approved:<churchpub>`  — which adults this church has cleared to work with young people
//   · `guardians:<churchpub>` — which adult is which child's parent
// They are OWNER-ONLY at the relay: the church key, and not even one of its own delegated stewards. The
// clause that makes that true is one line in gateway.mjs's write gate, and it has two halves:
//
//     if (!(CHURCH_PUBS.has(e.pubkey) && d.slice(pfx.length) === e.pubkey)) return false;
//        ╰─ are you a church this relay hosts?  ╰─ AND is this list YOUR OWN?
//
// Drop the second half and any co-tenant church on the box may rewrite another congregation's safeguarding.
// A relay carries several churches by design, and what that buys an attacker is not subtle:
//   · publish `approved:<Grace>` naming yourself, and the relay will let you privately message Grace's
//     children — the cleared-adults list IS the DBS list as far as this software is concerned;
//   · publish `minors:<Grace>` naming Grace's safeguarding lead, and they lose the adults-only rooms,
//     the volunteer register and the ability to open a care need, silently;
//   · publish `guardians:<Grace>` naming yourself as a child's parent, and the parent exemption in
//     canDMPeer and in the relay's own kind-4 gate opens that conversation to you.
// Nothing on any screen in Grace would say a word. Starting a second church on a shared relay costs one key.
//
// WHY THE EXISTING TEST CANNOT SEE THIS. scripts/relay-offer-probe.test.mjs asserts that a STRANGER key is
// refused `minors:<ghost>` for a church this relay does not host — which is what the console's relay probe
// depends on, and a good test. But a stranger is not in CHURCH_PUBS, so the first half of the clause refuses
// them on its own: that test stays green with the second half deleted. The co-tenant is the case the second
// half exists for, and measured on 2026-09-01 nothing anywhere covered it.
//
// MEASURED RED/GREEN, 2026-09-01, replacing that clause with `if (!CHURCH_PUBS.has(e.pubkey)) return false;`
// — the anchor asserted to occur exactly once in gateway.mjs first, and the file restored byte-identical:
//   · the shipped relay             this file 6 pass / 0 fail, relay-offer-probe 3 pass / 0 fail
//   · the second half deleted       this file 5 pass / 1 fail, relay-offer-probe 3 pass / 0 fail
//
// A REAL scripts/gateway.mjs hosting TWO churches, on its own port and data directory, real WebSockets, real
// NIP-42 auth, and the answers read off the relay's own OK/false. The model is
// scripts/one-church-cannot-call-anothers-member-a-child.test.mjs, which closed the READ half of the same
// shape; this is the WRITE half.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8819;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', STEWARDS_D = 'trinityone/stewards:';
const MINORS_D = 'trinityone/minors:', APPROVED_D = 'trinityone/approved:', GUARDIANS_D = 'trinityone/guardians:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace   = K();   // church A — the church being attacked
const stmarks = K();   // church B — an ordinary co-tenant on the same relay. One key is all it costs to be one.
const ap = grace.pub, bp = stmarks.pub;

const mia  = K();   // a child of church A
const ann  = K();   // an adult member of church A — its safeguarding lead
const sam  = K();   // a DELEGATED steward of church A, holding every capability
const eve  = K();   // a stranger: no church, no membership

let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = [], at = 0) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', d], ['t', NET], ...tags], content: JSON.stringify(content) }, who.sk);

// The three lists, exactly as the console shapes them (src/steward.src.js setMinors / setApproved / setGuardians).
const LISTS = [
  ['minors',    MINORS_D,    () => ({ pubkeys: [mia.pub] })],
  ['approved',  APPROVED_D,  () => ({ pubkeys: [ann.pub] })],
  ['guardians', GUARDIANS_D, () => ({ [mia.pub]: [ann.pub] })],
];
// Every write below is a list keyed to CHURCH A. Who signs it is what changes.
const listFor = (who, pfx, body, at = 0) => doc(who, pfx + ap, body, [], at);

before(async () => {
  await requireFreePort(PORT, 'relay-safeguarding-lists-are-owner-only.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-sgowner-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir,
             CHURCH_NPUB: npubEncode(ap) + ',' + npubEncode(bp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [mia, ann, sam]) assert.equal((await publish(pub, doc(who, MEMBER_D + ap, { joined: now() })))[0], true, 'joined church A');
  // Sam is given EVERY capability church A can delegate. Safeguarding is still not one of them.
  assert.equal((await publish(pub, doc(grace, STEWARDS_D + ap, { pubkeys: [sam.pub], caps: { [sam.pub]: ['members', 'content', 'care', 'finance', 'safeguarding'] } })))[0], true, 'steward roster');
  await sleep(200);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── the premise ────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: church A writes all three of its own safeguarding lists', async () => {
  // Without this, every refusal below would pass just as well on a relay that refuses these documents to
  // everybody — which would be a church that cannot do safeguarding at all.
  for (const [name, pfx, body] of LISTS) {
    const [ok, why] = await publish(pub, listFor(grace, pfx, body()));
    assert.equal(ok, true, `re-anchor: church A could not write its OWN ${name}: list — ${JSON.stringify(why)}`);
  }
  await sleep(200);
});

test('…and church B writes its own, so B really is a provisioned church on this relay', async () => {
  // The whole point is that B is legitimate. If B were unknown to the relay, the first half of the clause
  // would refuse it and the test below would prove nothing about the second half.
  const [ok, why] = await publish(pub, doc(stmarks, MINORS_D + bp, { pubkeys: [] }));
  assert.equal(ok, true, 're-anchor: church B is not hosted here at all — ' + JSON.stringify(why));
});

// ── the gap ────────────────────────────────────────────────────────────────────────────────────────────────
test('A CO-TENANT CHURCH CANNOT WRITE ANOTHER CHURCH’S SAFEGUARDING LISTS', async () => {
  const damage = {
    minors: 'church B can now call any member of church A a child — the safeguarding lead loses the ' +
      'adults-only rooms, the volunteer register and the ability to open a care need, in silence',
    approved: 'church B has put a key of its own choosing on church A’s CLEARED-ADULTS list. That list is ' +
      'the DBS list as far as this software is concerned, and it is what lets an adult privately message a child',
    guardians: 'church B has named itself a child of church A’s parent. The parent exemption in canDMPeer ' +
      'and in the relay’s own kind-4 gate then opens that conversation',
  };
  for (const [name, pfx, body] of LISTS) {
    const [ok] = await publish(pub, listFor(stmarks, pfx, body(), now() + 1));
    assert.equal(ok, false, `a co-tenant church wrote church A’s ${name}: list — ` + damage[name]);
  }
});

test('…and a DELEGATED STEWARD of the church itself cannot write them either', async () => {
  // Owner-only means the church key. Sam holds every capability church A can grant, including one named
  // "safeguarding" — which governs photo suppression, not these three lists. A console that hides the
  // buttons is not a boundary; this is.
  for (const [name, pfx, body] of LISTS) {
    const [ok] = await publish(pub, listFor(sam, pfx, body(), now() + 2));
    assert.equal(ok, false, `a delegated steward wrote church A’s ${name}: list — these are the church key’s alone`);
  }
});

test('…and a stranger cannot, which is what the console’s relay probe rests on', async () => {
  // Kept as its own claim because scripts/relay-offer-probe.test.mjs depends on this answer, and because it
  // is the half of the clause that survives the sabotage the tests above exist for.
  for (const [name, pfx, body] of LISTS) {
    const [ok] = await publish(pub, listFor(eve, pfx, body(), now() + 3));
    assert.equal(ok, false, `a key belonging to nobody wrote church A’s ${name}: list`);
  }
});

test('church A can still CORRECT its own lists afterwards — the gate refuses others, not the owner', async () => {
  // The common case, and the one a fix here is most likely to break: safeguarding is edited constantly.
  for (const [name, pfx] of LISTS) {
    const body = name === 'guardians' ? {} : { pubkeys: [] };
    const [ok, why] = await publish(pub, listFor(grace, pfx, body, now() + 4));
    assert.equal(ok, true, `church A could no longer clear its own ${name}: list — ${JSON.stringify(why)}`);
  }
});
