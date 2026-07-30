// Relay privacy gate — the life-and-death guards, black-box against a REAL relay on an ISOLATED high port
// with a throwaway data dir (never a8, never the :8000 dev relay).  Run: node --test scripts/relay-privacy.test.mjs
//
// Pins the arrest-list-grade properties proven by the deanon red-team (Finding 1) + audit-III roster gate:
//   • an ANONYMOUS client cannot harvest the DM social graph (kind-4 envelopes) or the roster (member: docs)
//   • a DM is delivered ONLY to a conversation endpoint that NIP-42-authenticates (author or recipient)
//   • an authenticated NON-party still cannot read someone else's DM
//   • public content is still served to anon (control — proves the gate isn't just refusing everything)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8837;                                   // isolated high port (memory: adversarial/local tests live at 8811+)
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;   // the relay ws endpoint is /relay (root gets socket.destroy())
const MEMBER_D = 'trinityone/member:';
const SLOT_D = 'trinityone/careslot:';   // a member's offer to help — care-participation metadata (who's caring for whom)
// The one document that is PUBLIC by design: a bare {approval:bool} with no PII, which a not-yet-joined member
// must read before they can join (gateway.mjs:1670). It is the honest anchor for the harness sanity control —
// see the CONTROL test for why an ungrouped kind-1 no longer is.
const JOINPOLICY_D = 'trinityone/joinpolicy:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// four independent identities: church, and members A / B / C
const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const aSk = generateSecretKey(), aPub = getPublicKey(aSk);
const bSk = generateSecretKey(), bPub = getPublicKey(bSk);
const cSk = generateSecretKey(), cPub = getPublicKey(cSk);

let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); }
  throw new Error('relay did not become ready on :' + PORT);
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m[2]); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });

// Run a REQ and collect EVENTs for `window` ms. If authSk is given, auto-answer the NIP-42 AUTH challenge
// (so we also capture the post-auth re-delivery). Returns { events, gotAuth }.
function reqCollect(ws, subId, filter, authSk, window = 700) {
  return new Promise((resolve) => {
    const events = []; let gotAuth = false;
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH') { gotAuth = true; if (authSk) { const a = finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk); ws.send(JSON.stringify(['AUTH', a])); } }
    };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve({ events, gotAuth }); }, window);
  });
}
const kinds = (r, k) => r.events.filter(e => e.kind === k);

before(async () => {
  await requireFreePort(PORT, 'relay-privacy.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-relay-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  await waitReady();
  // seed: a public note (control), a DM A→B (metadata-sensitive), and a church roster doc
  const pub = await connect();
  const publicNote = finalizeEvent({ kind: 1, created_at: now(), tags: [], content: 'public: service at 10am' }, aSk);
  const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', bPub]], content: 'nip04-ciphertext-of-a-secret' }, aSk);
  const roster = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + churchPub]], content: JSON.stringify({ members: [aPub, bPub] }) }, churchSk);
  // care-participation: member A offers to help on a need. Two variants — one correctly ['church']-tagged, and one
  // WITHOUT the church tag (the H1 fall-through case). BOTH must be withheld from anon (SECURITY-AUDIT-2026-07-18).
  const careSlotTagged = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', SLOT_D + 'need1:2026-07-20'], ['church', churchPub]], content: JSON.stringify({ careId: 'need1', note: 'I can bring dinner' }) }, aSk);
  const careSlotUntagged = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', SLOT_D + 'need2:2026-07-21']], content: JSON.stringify({ careId: 'need2', note: 'I can drive them' }) }, aSk);
  // AUDIT-2026-07-30 S5: the join policy is the genuinely-public seed. `publicNote` above is an UNGROUPED kind-1,
  // which used to be world-readable and is now author-only, so it can no longer stand in for "public content".
  const joinPolicy = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', JOINPOLICY_D + churchPub]], content: JSON.stringify({ approval: false }) }, churchSk);
  for (const e of [publicNote, dm, roster, careSlotTagged, careSlotUntagged, joinPolicy]) { const r = await publish(pub, e); assert.equal(r, true, 'seed event stored: kind ' + e.kind); }
  pub.close();
});

after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: anonymous client CAN read the join policy', async () => {
  // The purpose of this control is unchanged — prove the gate is not simply refusing everything, so that the
  // withholding tests below mean something. What changed is WHAT it reads.
  //
  // It used to read an ungrouped kind-1, and passing was the S5 defect: canRead()'s kind-1 tail let `!g` fall
  // into `return true`, so any chat message with no group tag was served to anyone, unauthenticated. This control
  // was quietly asserting that hole stayed open. It now reads the one document that is public BY DESIGN.
  const ws = await connect();
  const r = await reqCollect(ws, 'pub', { kinds: [30078], '#d': [JOINPOLICY_D + churchPub] });
  assert.equal(kinds(r, 30078).length, 1,
    'the join policy is not served to an anonymous client. It carries no PII and a not-yet-joined member must ' +
    'read it before they can join, so if this fails the harness is broken — or the read gate now refuses ' +
    'everything, which would make every test below pass for the wrong reason.');
  ws.close();
});

test('S5: an anonymous client CANNOT read an UNGROUPED chat message', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'ug1', { kinds: [1] });
  assert.equal(kinds(r, 1).length, 0,
    'a kind-1 with no group tag was served to an anonymous client. canRead()\'s tail was ' +
    '`if (!g || GROUP_VIS.get(g) !== "invite") return true`, and an ungrouped message has no `g` — so the ' +
    'church\'s relay stored and served world-readable content against its own retention budget.');
  ws.close();
});

test('…but its own author still can (the fix is a scope, not a delete)', async () => {
  // Over-tightening control. The chosen fix was "your own events stay yours", matching gateway.mjs:1667 — not
  // "ungrouped chat is refused". If this fails, a member has lost access to something they wrote.
  const ws = await connect();
  const r = await reqCollect(ws, 'ug2', { kinds: [1] }, aSk);
  assert.equal(kinds(r, 1).length, 1,
    'the author of an ungrouped message can no longer read it back. The fix scopes the read to the author; ' +
    'refusing them too would be a data-loss bug dressed as a privacy fix.');
  ws.close();
});

test('DM graph: anonymous client CANNOT harvest kind-4 envelopes (deanon Finding 1)', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'dm', { kinds: [4] });
  assert.equal(kinds(r, 4).length, 0, 'no DM envelope leaked to an unauthenticated observer');
  assert.equal(r.gotAuth, true, 'relay issued a NIP-42 challenge (proves the DM exists but was withheld, not just absent)');
  ws.close();
});

test('DM delivered to the AUTHOR once they authenticate', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'dm', { kinds: [4] }, aSk);
  assert.equal(kinds(r, 4).length, 1, 'author reads their own DM after NIP-42 auth');
  assert.match(kinds(r, 4)[0].content, /ciphertext/);
  ws.close();
});

test('DM delivered to the RECIPIENT once they authenticate', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'dm', { kinds: [4] }, bSk);
  assert.equal(kinds(r, 4).length, 1, 'recipient still receives their DM (members always-auth)');
  ws.close();
});

test('DM NOT delivered to an authenticated NON-party (party-only, not any-authed)', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'dm', { kinds: [4] }, cSk);
  assert.equal(r.gotAuth, true, 'C got the challenge and authenticated');
  assert.equal(kinds(r, 4).length, 0, 'a third party — even authenticated — cannot read A↔B');
  ws.close();
});

test('Roster: anonymous client CANNOT read a member: doc (audit-III arrest-list gate)', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'ros', { kinds: [30078], '#d': [MEMBER_D + churchPub] });
  assert.equal(kinds(r, 30078).length, 0, 'the membership list is not world-readable');
  assert.equal(r.gotAuth, true, 'relay challenged (roster doc present but withheld from anon)');
  ws.close();
});

test('Care: anonymous client CANNOT read a church-tagged careslot (who is caring for whom)', async () => {
  const ws = await connect();
  const r = await reqCollect(ws, 'cs1', { kinds: [30078], '#d': [SLOT_D + 'need1:2026-07-20'] });
  assert.equal(kinds(r, 30078).length, 0, 'care-participation metadata is not world-readable');
  ws.close();
});

test('Care: anonymous client CANNOT read an UNTAGGED careslot (SECURITY-AUDIT-2026-07-18 H1 fall-through)', async () => {
  const ws = await connect();
  // A careslot with no ['church'] tag resolved cp='' and fell through to world-readable `return true`. The fix
  // default-DENIES a private care doc whose owning church can't be resolved. This pins that regression shut.
  const r = await reqCollect(ws, 'cs2', { kinds: [30078], '#d': [SLOT_D + 'need2:2026-07-21'] });
  assert.equal(kinds(r, 30078).length, 0, 'an untagged careslot must not leak to an anonymous observer');
  ws.close();
});
