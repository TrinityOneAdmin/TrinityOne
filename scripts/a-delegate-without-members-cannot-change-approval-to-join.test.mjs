// A DELEGATE WITHOUT THE MEMBERS POWER CANNOT CHANGE "APPROVAL TO JOIN" — THE RELAY SAYS SO, AND THE SCREEN AGREES (sim 4).
//   Run: node --test scripts/a-delegate-without-members-cannot-change-approval-to-join.test.mjs
//
// FINDING 4 AS FILED was "a delegate can switch off approval to join". Investigated, the relay already refuses it:
// accept() (scripts/gateway.mjs, the <cp>-keyed membership admin loop) answers `leaderOf(cp) || stewardCan(pub, cp,
// 'members')` for `joinpolicy:<church>`. The sim's delegate had Members ticked, which is exactly the owner's rule of
// 2026-10-02: "a delegated steward WITH the Members power may change it; delegates without Members must not." What was
// missing was proof for the second half — the one existing relay test (a-delegated-stewards-church-writes-are-visible)
// uses a steward who HAS Members, so nothing failed if the gate were deleted. This is that proof, on a real relay, plus
// the screen: a delegate without Members no longer meets a switch that is then refused.
//
// Users of the shared code (rule 2): nothing in gateway.mjs changes. setJoinPolicy (steward.src.js) is called by
// toggleApproval in DashFeaturesPanel and by the wizard; this commit changes only toggleApproval's guard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';
import { compiled, common, press, reads } from './dash-render-kit.mjs';

const PORT = 8745;
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const key = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = key(), financeSteward = key(), membersSteward = key(), contentSteward = key(), unscoped = key(), member = key();

let relay = null, dataDir = null, w = null;
const doc = (who, d, content, tags = []) => finalizeEvent({ kind: 30078, created_at: now(), content: JSON.stringify(content), tags: [['d', d], ['t', 'trinityone'], ...tags] }, who.sk);
const conn = () => new Promise((res, rej) => { const s = new WebSocket(`ws://127.0.0.1:${PORT}/relay`, { headers: { Host: `127.0.0.1:${PORT}` } }); s.on('open', () => res(s)); s.on('error', rej); });
const send = (ev) => new Promise((res) => {
  const on = (m) => { const a = JSON.parse(m); if (a[0] === 'OK' && a[1] === ev.id) { w.off('message', on); res({ ok: a[2], why: a[3] || '' }); } };
  w.on('message', on); w.send(JSON.stringify(['EVENT', ev]));
  setTimeout(() => { w.off('message', on); res({ ok: null, why: 'no answer in 8s' }); }, 8000);
});
const setPolicy = async (who, approval) => { await sleep(1100); return send(doc(who, D.JOINPOLICY + church.pub, { approval }, [['church', church.pub]])); };

before(async () => {
  await requireFreePort(PORT, 'a-delegate-without-members-cannot-change-approval-to-join.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-jp-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  w = await conn();
  const r = await send(doc(church, D.STEWARDS + church.pub, {
    pubkeys: [financeSteward.pub, membersSteward.pub, contentSteward.pub, unscoped.pub],
    caps: { [financeSteward.pub]: ['finance'], [membersSteward.pub]: ['members'], [contentSteward.pub]: ['content'] },   // `unscoped` has no entry: every power (the pre-capabilities meaning)
  }));
  assert.equal(r.ok, true, 'fixture: the steward roster was refused (' + r.why + ')');
  await sleep(400);
});
after(async () => {
  try { w && w.close(); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  await sleep(200);
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('a steward ticked for Finance only, or for Groups & rotas only, is REFUSED when they switch approval to join', async () => {
  const f = await setPolicy(financeSteward, false);
  assert.equal(f.ok, false, 'A FINANCE-ONLY DELEGATE CHANGED APPROVAL TO JOIN (' + f.why + ')');
  const c = await setPolicy(contentSteward, true);
  assert.equal(c.ok, false, 'A GROUPS-AND-ROTAS-ONLY DELEGATE CHANGED APPROVAL TO JOIN (' + c.why + ')');
});

test('an ordinary member is refused too', async () => {
  const r = await setPolicy(member, false);
  assert.equal(r.ok, false, 'a member changed the join policy');
});

test('CONTROL: the church, a steward WITH Members, and an unscoped (everything) steward are accepted', async () => {
  assert.equal((await setPolicy(church, true)).ok, true, 'the church could not set its own join policy — the refusals above prove nothing');
  const m = await setPolicy(membersSteward, false);
  assert.equal(m.ok, true, 'a delegate WITH Members was refused — the owner’s rule is that they may (' + m.why + ')');
  const u = await setPolicy(unscoped, true);
  assert.equal(u.ok, true, 'an unscoped steward was refused — upgrading would strip a working delegate (' + u.why + ')');
});

// ── THE SCREEN: the real DashFeaturesPanel ───────────────────────────────────────────────────────────────────────
function panel({ caps }) {
  const calls = { policy: [], admitted: [] };
  const steward = {
    actingChurch: caps ? 'c'.repeat(64) : '', myStewardCaps: () => caps,
    setJoinPolicy: (v) => { calls.policy.push(v); return Promise.resolve(true); },
    setAdmitted: (l) => { calls.admitted.push(l); return Promise.resolve(true); },
    publishProfile: () => Promise.resolve(true), sealGroup: () => Promise.resolve(true),
  };
  const g = {
    ...common(), SkConfirm: () => null, DashGivingPanel: () => null, DashMealsPanel: () => null,
    STEW_CAP_LABEL: { members: 'Members', content: 'Groups & rotas', finance: 'Finance' },
    window: { Steward: steward, useStewardJoinPolicy: () => false, useStewardAdmitted: () => [], useStewardMembers: () => [{ pubkey: 'a'.repeat(64) }],
      useStewardGroups: () => [], useStewardChurch: () => ({ name: 'St Aidan', features: {}, rules: {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true },
  };
  return { calls, g };
}
async function flip(caps) {
  const p = panel({ caps });
  const { C, draw } = await compiled('DashFeaturesPanel', p.g, ['stewCapState']);
  const props = { church: { name: 'St Aidan', features: {}, rules: {} } };
  let tree = draw(C, props);
  await press(tree, /Toggle approval to join/);
  return { calls: p.calls, said: reads(draw(C, props)) };
}

test('THE SCREEN: a delegate without Members flips nothing and is told why; with Members, or as the owner, the switch works', async () => {
  const fin = await flip(['finance']);
  assert.deepEqual(fin.calls.policy, [], 'A FINANCE-ONLY DELEGATE’S SWITCH WENT TO THE RELAY (to be refused there, behind a banner)');
  assert.deepEqual(fin.calls.admitted, [], 'the approved-members list was rewritten for a change the delegate may not make');
  assert.match(fin.said, /Your church hasn’t given you Members/, 'the delegate is not told why the switch does nothing: ' + fin.said.slice(0, 300));
  const mem = await flip(['members']);
  assert.deepEqual(mem.calls.policy, [true], 'CONTROL: a delegate WITH Members could not switch approval on (the owner’s rule says they may)');
  const owner = await flip(null);
  assert.deepEqual(owner.calls.policy, [true], 'CONTROL: the owner’s own switch stopped working');
});
