// BEING *A* CHURCH IS NOT BEING *THIS* CHURCH.
// Run: node --test scripts/relay-church-scope.test.mjs
//
// The seventh unscoped write rule. Before checking anyone's permissions the relay asked "is this key a
// church?" — a relay-wide yes/no — and if the answer was yes it skipped the permission check entirely:
//
//     isLeader = CHURCH_PUBS.has(e.pubkey) || …
//     … return isLeader || stewardCan(e.pubkey, namedChurch(e), 'content');
//
// Six rules of exactly this shape were scoped on 2026-07-30; this one sits one level up, in front of the
// capability system, and was missed. The network half of the same line had already been scoped — only the
// church half was global.
//
// FOUND BY SIMULATION, 2026-08-19, not by reading. Three delegated stewards — scoped to Finance, to Care and
// to Groups & rotas — each walked straight through their padlock: two created groups, one switched the care
// module on for the whole church. All three were registered churches, because their own console had
// registered their own key under the name of the church they were helping. So the capability feature built
// that morning was decoration at the relay while looking correct in the UI.
//
// Both halves are fixed. This file guards the relay half: a church key may only act for ITS OWN church.
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

const PORT = 8993;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const STEWARDS_D = 'trinityone/stewards:', GROUP_D = 'trinityone/group:', BLOCKED_D = 'trinityone/blocked:';
const MEALS_SETTINGS_D = 'trinityone/meals-settings', CARETEAM_D = 'trinityone/careteam:';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const alpha = K();     // St Aidan's — the church under test
const beta = K();      // a DIFFERENT church, also carried by this relay (a co-tenant)
const rota = K();      // a steward of alpha, scoped to 'content'
let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('relay never came up');
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2], why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});

let stamp = now();
// Derive the roster FROM the capability map. The first version hard-coded one pubkey while the caps named
// another, so the steward under test was never on the roster at all — and the test read that as "the
// capability does not work". A fixture that disagrees with itself produces a finding about nothing.
const roster = (caps) => finalizeEvent({ kind: 30078, created_at: ++stamp, tags: [['d', STEWARDS_D + alpha.pub], ['t', NET]],
  content: JSON.stringify({ pubkeys: Object.keys(caps), caps }) }, alpha.sk);
const group = (who, id, forChurch) => finalizeEvent({ kind: 30078, created_at: ++stamp,
  tags: [['d', GROUP_D + forChurch.slice(0, 16) + '-' + id], ['t', NET], ['church', forChurch]],
  content: JSON.stringify({ name: 'Group ' + id, kind: 'group' }) }, who.sk);
const blocklist = (who, forChurch) => finalizeEvent({ kind: 30078, created_at: ++stamp,
  tags: [['d', BLOCKED_D + forChurch], ['t', NET]], content: JSON.stringify({ pubkeys: [] }) }, who.sk);
const mealsSettings = (who, forChurch) => finalizeEvent({ kind: 30078, created_at: ++stamp,
  tags: [['d', MEALS_SETTINGS_D], ['t', NET], ['church', forChurch]],
  content: JSON.stringify({ enabled: true, visibility: 'all', openedBy: 'member' }) }, who.sk);
const careTeam = (who, forChurch) => finalizeEvent({ kind: 30078, created_at: ++stamp,
  tags: [['d', CARETEAM_D + forChurch], ['t', NET]], content: JSON.stringify({ pubs: [] }) }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'relay-church-scope.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-scope-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: [npubEncode(alpha.pub), npubEncode(beta.pub)].join(','), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  await waitReady();
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a church can still do everything in its OWN church', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, group(alpha, 'own', alpha.pub))).ok, true, 'a church cannot create its own group');
  assert.equal((await publish(ws, blocklist(alpha, alpha.pub))).ok, true, 'a church cannot write its own blocklist');
  assert.equal((await publish(ws, mealsSettings(alpha, alpha.pub))).ok, true, 'a church cannot configure its own care module');
  assert.equal((await publish(ws, careTeam(alpha, alpha.pub))).ok, true, 'a church cannot name its own care team');
  ws.close();
});

test('a DIFFERENT church on the same relay cannot touch it', async () => {
  const ws = await connect();
  const g = await publish(ws, group(beta, 'intruder', alpha.pub));
  assert.equal(g.ok, false,
    'a co-tenant church created a group inside another congregation, because the relay asked whether it was ' +
    'a church and never whether it was THIS church');
  assert.equal((await publish(ws, blocklist(beta, alpha.pub))).ok, false,
    "a co-tenant church wrote another church's blocklist — the list that decides who is banned");
  assert.equal((await publish(ws, mealsSettings(beta, alpha.pub))).ok, false,
    "a co-tenant church reconfigured another church's care module, which decides who may see a care need");
  assert.equal((await publish(ws, careTeam(beta, alpha.pub))).ok, false,
    "a co-tenant church rewrote another church's care team — the audience for every private request for help");
  ws.close();
});

test('THE CASE THE SIMULATION FOUND: a steward who is also a church of their own stays scoped', async () => {
  // Exactly the round of 2026-08-19. `beta` here stands for the delegate's own console-minted church: a real
  // registered church key that is ALSO on alpha's steward roster, scoped to one thing.
  const ws = await connect();
  assert.equal((await publish(ws, roster({ [beta.pub]: ['care'] }))).ok, true, 're-anchor: alpha cannot publish its roster');
  await new Promise(r => setTimeout(r, 150));

  const okCare = await publish(ws, careTeam(beta, alpha.pub));
  assert.equal(okCare.ok, true,
    'the capability the church actually granted does not work — scoping is now too tight, which is its own ' +
    'failure. The relay said: ' + okCare.why);
  const g = await publish(ws, group(beta, 'bypass', alpha.pub));
  assert.equal(g.ok, false,
    'a steward scoped to Care created a GROUP, because their own key is separately registered as a church. ' +
    'This is the exact bypass three simulated stewards walked through, and it made the whole capability ' +
    'feature decoration at the relay while the padlocks looked right on screen.');
  ws.close();
});

test('nothing asks the relay-wide question any more', () => {
  const raw = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
  // Two different questions, so two different sources: the CODE check must ignore comments (they discuss the
  // old name at length), while the comment check obviously must not. The first version stripped comments and
  // then asserted on one.
  const src = raw.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(src, /\bisLeader\b(?!Here)/,
    'a site still uses the relay-wide leader check. It fails OPEN — any church on the box gets that power ' +
    'over any other church — and no capability test would notice, because the document simply works.');
  assert.match(src, /const leaderOf = \(cp\) =>/, 're-anchor: the scoped check has been renamed');
  assert.match(raw, /never be used to decide whether someone may write another church/,
    'the breadth-only helper has lost the comment saying it must not be used for authority — which is the ' +
    'mistake this whole file exists to prevent repeating');
});
