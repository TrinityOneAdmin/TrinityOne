// A RELAY THAT CANNOT EVALUATE A SAFEGUARDING RULE MUST REFUSE, NOT SHRUG.
// Run: node --test scripts/relay-divergent-safeguarding.test.mjs
//
// THE DEFECT. A member's app publishes to EVERY relay it is configured with. The church's console publishes
// the documents those relays need in order to police that traffic — `minors:`, `approved:`, and the group
// definitions carrying `childsafe` — through `publish()`, which is `Promise.any`: it resolves the moment ONE
// relay accepts. So the rules land on one relay and the traffic lands on all of them.
//
// On a relay that received the traffic but not the rules, the minor gate reads (gateway.mjs, accept()):
//
//     if (g && !GROUP_CHILDSAFE.has(g)) {
//       const gcp = GROUP_CHURCH.get(g);       // undefined — this relay never saw the group definition
//       const m = gcp && MINORS_BY.get(gcp);   // undefined
//       if (m && m.has(e.pubkey)) return false;  // never fires
//     }
//
// …and the read gate has the same shape, with the minor-withhold nested inside `if (gcp) { … }`. So a child
// posts in, and reads, an adults-only room. Measured in a live simulation on 2026-08-17: a 12-year-old's
// message was refused by the relay holding the church's minors list, and delivered anyway — because another
// relay in her app's list accepted it.
//
// The church's own promise to parents is "It is enforced by the server, not just hidden in the app." That is
// true of A server. It is not true of the set of servers a member's phone happens to be talking to.
//
// WHY THIS TEST BOOTS A REAL RELAY. accept() and canRead() are closures over module state that only exists in
// a running gateway; lifting them would test a copy. So: seed a store DIRECTLY with a deliberately INCOMPLETE
// corpus — the church configured, the child a member, the minors list present, the group definition ABSENT —
// then boot a gateway on it and ask it the one question that matters.
//
// THIS FILE MUST FAIL AGAINST THE CODE AS IT STANDS. A version of it that passes today is asserting nothing,
// which is the fixture trap this repo has been caught by before.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { openStore } from './event-store.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8940;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();          // St Aidan's — configured on this relay
const other = K();           // a co-tenant church, also configured (a shared / self-registration relay)
const child = K();           // on the church's minors list
const adult = K();           // an ordinary adult member
// The room under test: NOT child-safe, and deliberately NOT defined on this relay. Namespaced to the church
// the way the client emits ids, which is what lets a relay missing the definition still work out whose room
// it is. LEGACY_GROUP is the same situation for an id from before namespacing — kept because those ids exist
// in the field and their exposure is real and must not be papered over.
const ADULT_GROUP = '';             // filled in below, once `church` exists
const LEGACY_GROUP = 'mensgroup1';

let relay, dataDir;
let ADULT = '';   // `church.pub.slice(0,16) + '-mens'` — assigned in before()

const waitReady = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); };
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});

// a member's own join document — this is what makes them an EFFECTIVE member on a relay, and it is fanned to
// every relay by the member's app, which is precisely why a relay can know the person and not the rules
const memberDoc = (who, cp) => finalizeEvent({ kind: 30078, created_at: now() - 900,
  tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp]], content: JSON.stringify({ joined: true }) }, who.sk);
// the church's minors list — OWNER-ONLY, authored by the church key, and self-identifying by d-tag
const minorsDoc = (cp, sk, pubs) => finalizeEvent({ kind: 30078, created_at: now() - 800,
  tags: [['d', 'trinityone/minors:' + cp], ['t', NET]], content: JSON.stringify({ pubkeys: pubs }) }, sk);
const groupPost = (who, gid, text) => finalizeEvent({ kind: 1, created_at: now(),
  tags: [['t', NET], ['t', gid]], content: text }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'relay-divergent-safeguarding.test.mjs');
  ADULT = church.pub.slice(0, 16) + '-mens';
  dataDir = mkdtempSync(join(tmpdir(), 'trin-divergent-'));

  // THE DIVERGENT CORPUS. Everything a member's app fans out is here; nothing the console publishes single-accept
  // is. That is not a contrived state — it is what the two publish paths produce whenever the console's ACK
  // comes from a different relay than the one a member is also writing to.
  const store = openStore(join(dataDir, 'relay.sqlite'), { maxEvents: 5000 });
  store.put(memberDoc(child, church.pub));    // the child IS a known member here
  store.put(memberDoc(adult, church.pub));    // so is an adult, for the control
  store.put(minorsDoc(church.pub, church.sk, [child.pub]));   // the relay DOES know they are a child…
  // …and does NOT have `group:mensgroup1`, so it cannot know the room is adults-only.
  store.close();

  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000',
      CHURCH_NPUB: `${npubEncode(church.pub)},${npubEncode(other.pub)}` },
    stdio: 'ignore',
  });
  await waitReady();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a child may not post to a group this relay cannot prove is child-safe', async () => {
  const ws = await connect();
  try {
    const [ok, msg] = await publish(ws, groupPost(child, ADULT, 'am i allowed in here'));
    assert.equal(ok, false,
      'a member on this relay\'s own minors list posted into a group the relay holds no definition for, and it ' +
      'was ACCEPTED (' + msg + '). The gate resolves the governing church from GROUP_CHURCH, which is empty ' +
      'here, so the minor check never runs — the rule silently does not apply. An unknown group must be ' +
      'treated as adults-only until this relay can prove otherwise: a child is blocked until shown to be ' +
      'welcome, not welcomed until shown to be a child.');
  } finally { ws.close(); }
});

test('…while an adult member posting to the same group is still accepted', async () => {
  // The control. Without it, the test above would pass just as well against a relay that refused everything,
  // and would be proving nothing about safeguarding at all.
  const ws = await connect();
  try {
    const [ok, msg] = await publish(ws, groupPost(adult, ADULT, 'chippy tea on saturday'));
    assert.equal(ok, true,
      'an ordinary adult member was refused (' + msg + ') — so the rule above is not safeguarding, it is an ' +
      'outage. A relay missing a group definition must still carry the congregation\'s ordinary conversation.');
  } finally { ws.close(); }
});

test('a co-tenant church cannot claim a group id it does not own', async () => {
  // THE ID SQUAT. `idOwnerOk` returns true for an id this relay has never seen, so on a relay that missed the
  // real definition another configured church can publish it and BECOME its owner — then mark it child-safe,
  // flip invite-only to open, or install itself as care-admin. This does not merely fail to block; it hands
  // control of a room to somebody else's church.
  //
  // The id carries its owner: the client namespaces group ids with the church's own pubkey prefix. Nothing on
  // the relay has ever checked that the prefix matches the signer.
  const claimed = church.pub.slice(0, 16) + '-mens';
  const ws = await connect();
  try {
    const [ok, msg] = await publish(ws, finalizeEvent({ kind: 30078, created_at: now(),
      tags: [['d', 'trinityone/group:' + claimed], ['t', NET]],
      content: JSON.stringify({ name: 'Men (hijacked)', kind: 'group', childsafe: true }) }, other.sk));
    assert.equal(ok, false,
      'a DIFFERENT church published a group definition whose id is namespaced to St Aidan\'s (' + claimed +
      ') and it was ACCEPTED (' + msg + '). That church now owns the id on this relay and has marked the room ' +
      'child-safe. An id that names its owner must only be claimable BY that owner.');
  } finally { ws.close(); }
});

// Read the room as a given identity, completing the NIP-42 challenge. AUTHENTICATED, deliberately: an
// unauthenticated REQ for a grouped kind-1 is refused by an earlier gate (`if (!authed) return false`), so an
// anonymous probe would pass this test while proving nothing whatever about the minor rule. That is exactly
// the vacuous-fixture trap, and the first draft of this file walked into it.
const readGroupAs = (who, gid) => new Promise(async (res, rej) => {
  let ws;
  try { ws = await connect(); } catch (e) { return rej(e); }
  const seen = [];
  let authId = '', asked = 0;
  const done = () => { try { ws.close(); } catch {} res(seen); };
  const t = setTimeout(done, 8000);
  const ask = () => { asked++; ws.send(JSON.stringify(['REQ', 'r' + asked, { kinds: [1], '#t': [gid], limit: 20 }])); };
  ws.on('message', d => {
    const m = JSON.parse(d);
    // THE RELAY'S CHALLENGE IS LAZY — it is issued in response to a request that needs auth, not on connect.
    // So the order is: ask, get challenged, authenticate, ask AGAIN. Waiting for a challenge before asking
    // hangs until the timeout and returns zero events, which reads exactly like a safeguarding refusal. The
    // control in the caller caught precisely that.
    if (m[0] === 'AUTH') {
      const evt = finalizeEvent({ kind: 22242, created_at: now(),
        tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk);
      authId = evt.id;
      ws.send(JSON.stringify(['AUTH', evt]));
      return;
    }
    if (m[0] === 'OK' && m[1] === authId) {
      if (m[2] !== true) { clearTimeout(t); return done(); }
      ask();                       // re-ask now that we are somebody
      return;
    }
    if (m[0] === 'EVENT' && String(m[1]).startsWith('r')) seen.push(m[2]);
    if (m[0] === 'EOSE' && String(m[1]).startsWith('r') && authId) { clearTimeout(t); done(); }
  });
  ask();                           // provoke the challenge
});

test('a child may not READ a group this relay cannot prove is child-safe', async () => {
  // The read side has the same shape: the minor-withhold is nested inside `if (gcp) { … }`, so a missing group
  // definition skips it entirely. A child reading an adults-only room is as serious as posting in one.
  const ws = await connect();
  try { await publish(ws, groupPost(adult, ADULT, 'adults only, please')); await sleep(400); } finally { ws.close(); }

  const asAdult = await readGroupAs(adult, ADULT);
  assert.ok(asAdult.length > 0,
    'the CONTROL failed: an authenticated adult member could not read the room either, so the assertion below ' +
    'would pass for the wrong reason. Fix the harness before reading anything into the child result.');

  const asChild = await readGroupAs(child, ADULT);
  assert.equal(asChild.length, 0,
    'the adults-only room was served (' + asChild.length + ' messages) to a member on this relay\'s own minors ' +
    'list. canRead nests the minor-withhold inside `if (gcp)`, and gcp is undefined here because the relay ' +
    'holds no definition for this group — so the rule silently does not apply, exactly as on the write side.');
});

test('KNOWN RESIDUAL: an id from before namespacing is still exposed', async () => {
  // Honest limit of the id-ownership fix. `mensgroup1` carries no owner, so a relay missing its definition has
  // nothing to resolve and the minor rule still cannot run. Ids like this exist in the field.
  //
  // P0 HAS LANDED (setMinors / setApproved / setGuardians / publishGroup now use the all-must-accept path), so
  // a relay the church actually publishes to will HAVE these documents and will not need to infer anything.
  // What remains is the case P0 cannot reach: a relay the church never published to at all, carrying a member's
  // fanned-out traffic. For a legacy unprefixed id there is still nothing to resolve there. Closing that is
  // P1 — scoping a church's private traffic to the church's own relays.
  const ws = await connect();
  try {
    const [ok] = await publish(ws, groupPost(child, LEGACY_GROUP, 'legacy room, no owner in the id'));
    assert.equal(ok, true,
      'this now REFUSES an unprefixed id — which is better than it was. Flip this assertion to false, and ' +
      'retire the note above: the residual gap this documents has been closed.');
  } finally { ws.close(); }
});
