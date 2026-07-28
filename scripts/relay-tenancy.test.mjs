// Relay multi-tenancy + default-deny read gate — SECURITY-AUDIT-2026-07-20 C1/C2/C3/C4.
// Black-box against a REAL relay on an ISOLATED high port with a throwaway data dir.
// Run: node --test scripts/relay-tenancy.test.mjs
//
// WHY THIS FILE EXISTS. Every pre-existing relay suite spawns the gateway with an EMPTY data dir and no
// CHURCH_NPUB, so CHURCH_PUBS.size === 0 — accept() returns true unconditionally and note() records nothing.
// Those suites' privacy assertions therefore pass over empty maps rather than over the real policy, which is
// exactly why four criticals lived undetected in code they never reached. This fixture configures TWO real
// churches so the tenancy and read-gate rules are actually executed.
//
// Pins:
//   C1 — kind-30078 is DEFAULT-DENY. Group/roster/serving docs, and a member's own MyData docs, are never
//        served to an anonymous client. (The 07-13 fix listed only the d-prefixes that audit named, so these
//        four leaked; a denylist cannot hold, and this proves the polarity is now inverted.)
//   C3 — a configured church key may not read ANOTHER church's private docs (cross-tenant read).
//   C4 — a network key declared by church B has no authority over church A (it was a process-global set).
//   + controls: legitimate members and the owning church CAN still read, and joinpolicy stays public — so we
//     know the gate is scoping access, not merely refusing everything.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8840;                                 // isolated high port — 8837 privacy, 8838 safeguarding, 8839 safety
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const D = {
  member: 'trinityone/member:', group: 'trinityone/group:', roster: 'trinityone/roster:',
  request: 'trinityone/request:', rota: 'trinityone/rota:', network: 'trinityone/network:',
  minors: 'trinityone/minors:', joinpolicy: 'trinityone/joinpolicy:', highlights: 'trinityone/highlights',
};
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// two churches on ONE relay (the documented shared/community deployment), plus their people
const aSk = generateSecretKey(), aPub = getPublicKey(aSk);         // church A
const bSk = generateSecretKey(), bPub = getPublicKey(bSk);         // church B (the other tenant)
const aliceSk = generateSecretKey(), alicePub = getPublicKey(aliceSk);   // member of church A
const netSk = generateSecretKey(), netPub = getPublicKey(netSk);         // a network church B declares
const malSk = generateSecretKey(), malPub = getPublicKey(malSk);         // an outsider (never joins anything)
const friendSk = generateSecretKey(), friendPub = getPublicKey(friendSk); // a second member of church A

let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); }
  throw new Error('relay did not become ready on :' + PORT);
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m[2]); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });

// REQ + collect for `window` ms, auto-answering the NIP-42 challenge when authSk is supplied (so post-auth
// re-delivery is captured too — a doc withheld at REQ time but replayed after AUTH still counts as read).
function reqCollect(ws, subId, filter, authSk, window = 700) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) { const a = finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk); ws.send(JSON.stringify(['AUTH', a])); }
    };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}
const hasD = (events, d) => events.some(e => (e.tags.find(t => t[0] === 'd') || [])[1] === d);

before(async () => {
  await requireFreePort(PORT, 'relay-tenancy.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-tenancy-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    // THE POINT OF THIS FIXTURE: two REAL configured churches, so the write policy and read gate execute.
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: `${aPub},${bPub}` },
    stdio: 'ignore',
  });
  await waitReady();
  const ws = await connect();

  // Alice joins church A (membership is self-asserted — she signs her own member: doc)
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.member + aPub]], content: JSON.stringify({ name: 'Alice' }) }, aliceSk));
  // Church A's private life: an invite-only group (its allowlist is IN THE CLEARTEXT CONTENT), a team roster
  // binding REAL NAMES to pubkeys, a serving request, and a rota. All four fell through to world-readable.
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.group + 'g1']], content: JSON.stringify({ name: 'Persecuted house group', visibility: 'invite', members: [alicePub] }) }, aSk));
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.roster + 'g1']], content: JSON.stringify({ people: [{ pub: alicePub, name: 'Alice Brown' }] }) }, aSk));
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.request + 'r1']], content: JSON.stringify({ teamName: 'Welcome', role: 'Door', date: '2026-08-01' }) }, aSk));
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.rota + 'rt1']], content: JSON.stringify({ assignments: [{ pub: alicePub, role: 'Door' }] }) }, aSk));
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.minors + aPub]], content: JSON.stringify({ pubkeys: [] }) }, aSk));
  // public control: a join policy any prospective member must read BEFORE joining
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.joinpolicy + aPub]], content: JSON.stringify({ approval: false }) }, aSk));
  // Alice's personal MyData doc. accept() requires isMember to write one, so the AUTHORS of these docs are by
  // construction the congregation — anonymously readable, they were a roster in disguise.
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.highlights]], content: JSON.stringify({ v: [{ ref: 'John 3:16' }] }) }, aliceSk));
  // Church B declares a network. Before C4 this key became a leader for EVERY church on the relay.
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.network + netPub]], content: JSON.stringify({ name: 'Some Network' }) }, bSk));
  ws.close();
  await sleep(200);
});

after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── C1: default-deny ──────────────────────────────────────────────────────────────────────────────
test('C1: an ANONYMOUS client cannot read group / roster / request / rota docs', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 's1', { kinds: [30078] }, null);
  ws.close();
  assert.equal(hasD(got, D.group + 'g1'), false, 'invite-group doc (carries its member allowlist) leaked to anon');
  assert.equal(hasD(got, D.roster + 'g1'), false, 'team roster (real names ↔ pubkeys) leaked to anon');
  assert.equal(hasD(got, D.request + 'r1'), false, 'serving request leaked to anon');
  assert.equal(hasD(got, D.rota + 'rt1'), false, 'rota (who serves when) leaked to anon');
});

test('C1: an ANONYMOUS client cannot enumerate the congregation via MyData docs', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 's2', { kinds: [30078], '#d': [D.highlights] }, null);
  ws.close();
  assert.equal(got.length, 0, 'trinityone/highlights served to anon — its authors ARE the church roster');
});

test('C1 control: joinpolicy stays PUBLIC (a not-yet-joined member must read it)', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 's3', { kinds: [30078], '#d': [D.joinpolicy + aPub] }, null);
  ws.close();
  assert.equal(hasD(got, D.joinpolicy + aPub), true, 'joinpolicy must remain readable pre-membership');
});

test('C1 control: an authenticated MEMBER can still read her church’s group + roster', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 's4', { kinds: [30078] }, aliceSk, 1200);
  ws.close();
  assert.equal(hasD(got, D.group + 'g1'), true, 'member was denied her own group — gate is over-refusing');
  assert.equal(hasD(got, D.roster + 'g1'), true, 'member was denied her own team roster');
});

test('C1 control: an author can always read her OWN MyData doc back', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 's5', { kinds: [30078], '#d': [D.highlights] }, aliceSk, 1200);
  ws.close();
  assert.equal(got.length > 0, true, 'author cannot read her own highlights — MyData sync would break');
});

// ── C3: cross-tenant ──────────────────────────────────────────────────────────────────────────────
test('C3: church B cannot read church A’s roster, minors list or groups', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 's6', { kinds: [30078] }, bSk, 1200);
  ws.close();
  assert.equal(hasD(got, D.minors + aPub), false, 'church B read church A’s SAFEGUARDING list');
  assert.equal(hasD(got, D.roster + 'g1'), false, 'church B read church A’s team roster');
  assert.equal(hasD(got, D.group + 'g1'), false, 'church B read church A’s invite-only group');
  assert.equal(hasD(got, D.member + aPub), false, 'church B read church A’s membership roster');
});

test('C3 control: church A CAN read its own private docs', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 's7', { kinds: [30078] }, aSk, 1200);
  ws.close();
  assert.equal(hasD(got, D.minors + aPub), true, 'church A denied its own safeguarding list');
  assert.equal(hasD(got, D.roster + 'g1'), true, 'church A denied its own roster');
});

// ── C4: network scoping ───────────────────────────────────────────────────────────────────────────
test('C4: a network declared by church B has NO authority over church A', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 's8', { kinds: [30078] }, netSk, 1200);
  ws.close();
  assert.equal(hasD(got, D.minors + aPub), false, 'B’s network key read church A’s safeguarding list');
  assert.equal(hasD(got, D.roster + 'g1'), false, 'B’s network key read church A’s roster');
  assert.equal(hasD(got, D.member + aPub), false, 'B’s network key enumerated church A’s members');
});

// ── B1: member-authored, church-tagged docs ───────────────────────────────────────────────────────
// The revoked-steward roster check applies to docs carrying ['church',cp]. Members church-TAG their own
// care participation, and a member is neither the church key nor a rostered steward — so a naive check
// hid every meal-train sign-up and the whole "I'm here to help" register from the church that owns them.
// Silent: the steward just saw an empty rota. This pins it.
test('B1: a member’s care sign-up is readable by the CHURCH and its stewards, not just its author', async () => {
  const ws = await connect();
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/careslot:c1:2026-08-01'], ['t', 'trinityone'], ['church', aPub]], content: JSON.stringify({ careId: 'c1', note: 'I can bring Tuesday dinner' }) }, aliceSk));
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/careavail:' + aPub], ['t', 'trinityone'], ['church', aPub]], content: JSON.stringify({ tags: ['meals'] }) }, aliceSk));
  ws.close(); await sleep(150);

  const wsC = await connect();
  const asChurch = await reqCollect(wsC, 'b1a', { kinds: [30078] }, aSk, 1200);
  wsC.close();
  assert.equal(hasD(asChurch, 'trinityone/careslot:c1:2026-08-01'), true, 'the church cannot see who signed up for its own meal train');
  assert.equal(hasD(asChurch, 'trinityone/careavail:' + aPub), true, 'the church cannot see its own "here to help" register');

  const wsA = await connect();
  const asAuthor = await reqCollect(wsA, 'b1b', { kinds: [30078] }, aliceSk, 1200);
  wsA.close();
  assert.equal(hasD(asAuthor, 'trinityone/careslot:c1:2026-08-01'), true, 'the author cannot read her own sign-up back');

  const wsM = await connect();
  const asOutsider = await reqCollect(wsM, 'b1c', { kinds: [30078] }, malSk, 1200);
  wsM.close();
  assert.equal(hasD(asOutsider, 'trinityone/careslot:c1:2026-08-01'), false, 'an outsider read a care sign-up');
});

// ── B4: a hostile tenant must not be able to govern someone who never joined it ────────────────────
// Church B lists a member of church A in its OWN minors doc. B never had them as a member, so B must have
// no say: it can neither clear an adult for them nor (via the church-authority escape) sever their DMs.
test('B4: a church cannot claim safeguarding authority over someone who never joined it', async () => {
  const ws = await connect();
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.minors + bPub]], content: JSON.stringify({ pubkeys: [alicePub] }) }, bSk));
  // a fellow member of Alice's ACTUAL church DMs her — must still be delivered. Uses a dedicated identity:
  // the outsider key must stay unaffiliated for the test below it (one relay is shared across this file).
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.member + aPub]], content: JSON.stringify({ name: 'Friend' }) }, friendSk));
  await sleep(120);
  const ok = await publish(ws, finalizeEvent({ kind: 4, created_at: now(), tags: [['p', alicePub]], content: 'nip44-ciphertext' }, friendSk));
  ws.close();
  assert.equal(ok, true, 'a hostile church listing someone as a minor severed their DMs — denial-of-contact');
});

// ── B-2: the network scoping must not be bypassable by OMITTING the church tag ─────────────────────
// kind-1 scopes by GROUP, not by d-tag, so the "every church-scoped rule keys off the d-tag suffix"
// reasoning that justified allowing an untagged network event did not hold: dropping the ['church'] tag
// walked straight into another congregation's announcement channel.
test('B-2: an untagged post from B’s network key cannot enter church A’s broadcast channel', async () => {
  const ws = await connect();
  await publish(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.group + 'bc1']], content: JSON.stringify({ name: 'Announcements', kind: 'broadcast' }) }, aSk));
  await sleep(150);
  const untagged = await publish(ws, finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'bc1'], ['t', 'trinityone'], ['p', aPub]], content: 'FORGED ANNOUNCEMENT' }, netSk));
  const tagged = await publish(ws, finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'bc1'], ['t', 'trinityone'], ['p', aPub], ['church', aPub]], content: 'FORGED ANNOUNCEMENT 2' }, netSk));
  const owner = await publish(ws, finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'bc1'], ['t', 'trinityone'], ['p', aPub]], content: 'a real announcement' }, aSk));
  ws.close();
  assert.equal(untagged, false, 'B’s network key posted into church A’s broadcast channel by omitting the church tag');
  assert.equal(tagged, false, 'B’s network key posted into church A’s broadcast channel');
  assert.equal(owner, true, 'the owning church can no longer post to its own broadcast channel — over-corrected');
});

test('an unaffiliated outsider who authenticates reads none of it', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 's9', { kinds: [30078] }, malSk, 1200);
  ws.close();
  assert.equal(hasD(got, D.roster + 'g1'), false, 'a stranger read a church roster by merely authenticating');
  assert.equal(hasD(got, D.group + 'g1'), false, 'a stranger read an invite-only group');
  assert.equal(hasD(got, D.highlights), false, 'a stranger read another member’s MyData');
});
