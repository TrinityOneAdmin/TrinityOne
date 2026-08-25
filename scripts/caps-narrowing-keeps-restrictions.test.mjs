// NARROWING A STEWARD MUST NOT UNLOCK WHAT THEY ALREADY BUILT.
// Run: node --test scripts/caps-narrowing-keeps-restrictions.test.mjs
//
// PRE-PUSH AUDIT 2026-08-25, the finding that stopped a release. A church gives a steward a narrower role —
// Finance and Care, but not "Groups & rotas". Nothing appears to break. Then the relay rehydrates, which it
// does on every self-update AND on any church-list save, and:
//
//   · invite-only rooms and team rooms become readable AND POSTABLE by the whole congregation
//   · a church that required approval to join silently reverts to open-join
//   · a rota narrowed to "serving teams only" is served to everyone again
//   · a delegated treasurer's entries stop raising the journal's sequence counter, re-opening historical
//     sequence numbers in an append-only book
//
// Nobody is told. Nothing on screen changes. It is the opposite of "the app lost my church": the church has
// been quietly opened.
//
// WHY IT HAPPENED, and why this file tests what it tests. The READ path was deliberately made tolerant so
// that narrowing a delegate does not hide the content they authored — gateway.mjs `canRead` asks
// stewardCan(..., 'any'). The INGEST path, note(), re-validated HISTORICAL documents against the author's
// CURRENT capability, so when the author no longer held that specific one the branch was skipped and
// GROUP_VIS / GROUP_MEMBERS / REQUIRE_APPROVAL / ROTA_VIS / FINANCE_SEQ were never populated. The event was
// still served; its restrictions were never derived. An invite-only room then collapses to the
// `GROUP_VIS !== 'invite' -> return true` default. The read path was hardened for exactly this scenario;
// the ingest path was its missed sibling, and only the tolerant one was ever tested.
//
// The 1622-test suite was green over all of it. rota-visibility.test.mjs DOES restart the relay after a
// roster edit — but it rewrites the roster with no caps at all, so the steward keeps full power and the
// narrowing case is never driven. That is the hole this file fills.
//
// THREE THINGS THIS FILE INSISTS ON, each of which a narrower test would have missed:
//   1. BOTH DIRECTIONS. The fail-OPEN cases (a private room opening) are the alarming ones, but the
//      fail-CLOSED twin is just as real: drop a steward-authored `admitted:` list while the church's own
//      approval policy survives, and the ENTIRE CONGREGATION stops being effective members. A fix verified
//      only against fail-open can regress fail-closed unnoticed.
//   2. REHYDRATE, NOT RESTART. hydrateMaps() re-runs live whenever the church list is rewritten. A fix
//      shaped around a boot flag would pass a restart-only test while the live path stayed broken, so one
//      case here drives the rehydrate WITHOUT killing the process.
//   3. LOOSENING MUST NOT LOOSEN FORGERY. The fix widens these gates to 'any'. The guard that must survive
//      is that a NON-steward's signed document still derives nothing — that is the load-bearing defence on
//      the peer-resync path, where note()'s author check is one of only two gates.
//
// Safe to widen at all only because note() is strictly downstream of accept(): the live EVENT handler calls
// accept(evt) first and rejects there, and accept() independently enforces every one of these capabilities.
// So a narrowed steward still cannot PUBLISH a new group, roster, join policy or admitted list. Verified
// before the change was made — the opposite mistake (re-running a write gate over history) is what once
// deleted an entire finance journal.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8999;                       // unique across scripts/*.test.mjs and *.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const STEWARDS_D = 'trinityone/stewards:', GROUP_D = 'trinityone/group:', MEMBER_D = 'trinityone/member:';
const JOINPOLICY_D = 'trinityone/joinpolicy:', ADMITTED_D = 'trinityone/admitted:';
const ROTA_SETTINGS_D = 'trinityone/rota-settings', PLAN_D = 'trinityone/plan:';

const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// deborah is the DELEGATED steward whose role gets narrowed. alice is in the private room; mallory is an
// ordinary member who must never see it. stranger self-joins a church that requires approval.
const church = K(), deborah = K(), alice = K(), mallory = K(), stranger = K(), forger = K();
const cp = church.pub;
let relay, dataDir, ts = now();

function bootRelay() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(cp) },
  });
  const t0 = Date.now();
  return (async () => {
    while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
    throw new Error('relay did not become ready on :' + PORT);
  })();
}

// Restart onto the SAME data directory — every in-memory map rebuilt from the stored corpus, which is what
// the relay does on every self-update. The bug lives entirely in that replay.
async function rehydrateByRestart() {
  try { relay.kill('SIGKILL'); } catch {}
  await sleep(400);
  await bootRelay();
  await sleep(400);
}

const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });

const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2], why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
const publishAs = async (evt) => { const ws = await connect(); try { return await publish(ws, evt); } finally { try { ws.close(); } catch {} } };

// One fresh socket per read, authenticating as `who`, so nothing is answered from an earlier subscription's
// cache and the relay's own NIP-42 gate is exercised rather than bypassed.
function readAs(who, filter, window = 800) {
  return new Promise(async (resolve) => {
    const ws = await connect(); const subId = 's' + Math.random().toString(36).slice(2, 8); const events = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { try { ws.close(); } catch {} resolve(events); }, window);
  });
}

// ── documents ────────────────────────────────────────────────────────────────────────────────────────────
const roster = (caps) => finalizeEvent({ kind: 30078, created_at: ++ts, tags: [['d', STEWARDS_D + cp], ['t', NET]],
  content: JSON.stringify({ pubkeys: [deborah.pub], caps }) }, church.sk);
const joinDoc = (who) => finalizeEvent({ kind: 30078, created_at: ++ts, tags: [['d', MEMBER_D + cp], ['t', NET]], content: JSON.stringify({ joined: true }) }, who.sk);
// the group id embeds the AUTHOR's prefix — exactly what the console does when a delegate creates a group
const gid = deborah.pub.slice(0, 16) + '-eldr1';
const groupDoc = (signer = deborah) => finalizeEvent({ kind: 30078, created_at: ++ts, tags: [['d', GROUP_D + gid], ['t', NET], ['church', cp]],
  content: JSON.stringify({ name: 'Elders', kind: 'group', visibility: 'invite', members: [alice.pub] }) }, signer.sk);
const msg = (who, text) => finalizeEvent({ kind: 1, created_at: ++ts, tags: [['t', gid]], content: text }, who.sk);
const joinPolicy = (signer) => finalizeEvent({ kind: 30078, created_at: ++ts, tags: [['d', JOINPOLICY_D + cp], ['t', NET]],
  content: JSON.stringify({ approval: true }) }, signer.sk);
const admitted = (signer, pubs) => finalizeEvent({ kind: 30078, created_at: ++ts, tags: [['d', ADMITTED_D + cp], ['t', NET]],
  content: JSON.stringify({ pubkeys: pubs }) }, signer.sk);
const churchPlan = () => finalizeEvent({ kind: 30078, created_at: ++ts, tags: [['d', PLAN_D + cp.slice(0, 16) + '-p1'], ['t', NET], ['church', cp]],
  content: JSON.stringify({ title: 'Autumn teaching plan' }) }, church.sk);
const rotaSettings = (signer, visibility) => finalizeEvent({ kind: 30078, created_at: ++ts, tags: [['d', ROTA_SETTINGS_D], ['t', NET], ['church', cp]],
  content: JSON.stringify({ visibility, updated: ++ts }) }, signer.sk);

before(async () => {
  await requireFreePort(PORT);
  dataDir = mkdtempSync(join(tmpdir(), 'trin-caps-'));
  await bootRelay();
  // Deborah starts with the full content role and builds the church's rooms, as a real delegate would.
  assert.equal((await publishAs(roster({ [deborah.pub]: ['content', 'members'] }))).ok, true, 'roster must publish');
  for (const who of [alice, mallory]) assert.equal((await publishAs(joinDoc(who))).ok, true);
  assert.equal((await publishAs(groupDoc())).ok, true, 'delegate must be able to create the group');
  assert.equal((await publishAs(msg(alice, 'private eldership matter'))).ok, true);
});

after(async () => { try { relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── 1. FAIL-OPEN: the private room ───────────────────────────────────────────────────────────────────────
test('an invite-only room stays shut after its author is narrowed and the relay rehydrates', async () => {
  const before = await readAs(mallory, { kinds: [1], '#t': [gid] });
  assert.equal(before.length, 0, 'PRECONDITION: a member outside the group must not read it to begin with');

  assert.equal((await publishAs(roster({ [deborah.pub]: ['members'] }))).ok, true, 'narrowing must be allowed');
  await rehydrateByRestart();

  const after = await readAs(mallory, { kinds: [1], '#t': [gid] });
  assert.equal(after.length, 0,
    'a member outside the room read it after the author was narrowed — the room was silently opened to the church');
});

test('...and cannot be posted into either', async () => {
  // Reading is the alarming half; posting is the half that makes it permanent. Both hang off GROUP_VIS.
  const res = await publishAs(msg(mallory, 'I should not be able to say this here'));
  assert.equal(res.ok, false, 'an outsider posted into an invite-only room after the author was narrowed');
});

// ── 2. FAIL-OPEN: the church's front door ────────────────────────────────────────────────────────────────
test('a church that requires approval does not revert to open-join when a steward is narrowed', async () => {
  assert.equal((await publishAs(roster({ [deborah.pub]: ['members'] }))).ok, true);
  assert.equal((await publishAs(joinPolicy(deborah))).ok, true, 'steward with members may set the policy');
  assert.equal((await publishAs(churchPlan())).ok, true);
  assert.equal((await publishAs(joinDoc(stranger))).ok, true, 'self-join is allowed; being ADMITTED is not');

  const before = await readAs(stranger, { kinds: [30078], '#d': [PLAN_D + cp.slice(0, 16) + '-p1'] });
  assert.equal(before.length, 0, 'PRECONDITION: an unadmitted stranger must not read members-only content');

  assert.equal((await publishAs(roster({ [deborah.pub]: ['finance'] }))).ok, true, 'narrow away from members');
  await rehydrateByRestart();

  const after = await readAs(stranger, { kinds: [30078], '#d': [PLAN_D + cp.slice(0, 16) + '-p1'] });
  assert.equal(after.length, 0,
    'an unadmitted stranger read members-only content after a steward was narrowed — the approval gate was dropped');
});

// ── 3. FAIL-CLOSED twin: the congregation must not evaporate ─────────────────────────────────────────────
test('a steward-authored admitted list survives narrowing — the congregation stays members', async () => {
  // The mirror image of the case above, and the one a fail-open-only test would miss entirely: if the
  // church's approval policy survives rehydrate while the steward-authored allowlist is dropped, every
  // admitted member silently stops being one. That is the silent-blank-app shape, church-wide.
  assert.equal((await publishAs(roster({ [deborah.pub]: ['members'] }))).ok, true);
  assert.equal((await publishAs(admitted(deborah, [alice.pub, mallory.pub]))).ok, true);
  await sleep(150);

  const before = await readAs(alice, { kinds: [30078], '#d': [PLAN_D + cp.slice(0, 16) + '-p1'] });
  assert.equal(before.length, 1, 'PRECONDITION: an admitted member reads members-only content');

  assert.equal((await publishAs(roster({ [deborah.pub]: ['care'] }))).ok, true, 'narrow away from members');
  await rehydrateByRestart();

  const after = await readAs(alice, { kinds: [30078], '#d': [PLAN_D + cp.slice(0, 16) + '-p1'] });
  assert.equal(after.length, 1,
    'an admitted member LOST access after a steward was narrowed — the allowlist was dropped and the church closed on its own people');
});

// ── 4. REHYDRATE WITHOUT A RESTART ───────────────────────────────────────────────────────────────────────
test('the same holds when the maps rebuild live, with no restart at all', async () => {
  // hydrateMaps() re-runs whenever the church list is rewritten — a co-tenant registering, a rename, an
  // import. A fix shaped around a boot flag would pass every test above and still leave this broken.
  assert.equal((await publishAs(roster({ [deborah.pub]: ['content'] }))).ok, true);
  assert.equal((await publishAs(groupDoc())).ok, true);
  assert.equal((await publishAs(msg(alice, 'second eldership matter'))).ok, true);
  assert.equal((await publishAs(roster({ [deborah.pub]: ['finance'] }))).ok, true);

  // Provoke a REAL rehydrate rather than killing the process: saving the church list calls hydrateMaps()
  // over the whole corpus (gateway.mjs, writeChurches). A /status poll does NOT — the first draft of this
  // test used one, passed, and was measuring nothing. If the token or the save is ever refused this test
  // must fail loudly rather than quietly go back to measuring nothing.
  const token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  const saved = await fetch(`http://127.0.0.1:${PORT}/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ churches: [{ npub: npubEncode(cp), name: "St Chad's" }] }),
  });
  assert.ok(saved.ok, 'the church-list save must succeed, or this test is not driving a rehydrate at all');
  await sleep(900);

  const after = await readAs(mallory, { kinds: [1], '#t': [gid] });
  assert.equal(after.length, 0, 'the room opened after a LIVE rehydrate, without any restart');
});

// ── 5. The guard that must survive the fix ───────────────────────────────────────────────────────────────
test('a NON-steward cannot have their group definition honoured, however tolerant the gate becomes', async () => {
  // The fix widens these gates to 'any'. This is what 'any' must still refuse. It matters most on the
  // peer-resync path, where accept() never runs and note()'s author check is one of only two defences.
  const forgedGid = forger.pub.slice(0, 16) + '-fake1';
  const forged = finalizeEvent({ kind: 30078, created_at: ++ts, tags: [['d', GROUP_D + forgedGid], ['t', NET], ['church', cp]],
    content: JSON.stringify({ name: 'Not a real room', kind: 'group', visibility: 'open', members: [] }) }, forger.sk);
  const res = await publishAs(forged);
  assert.equal(res.ok, false, 'a non-steward had a group definition accepted for a church they do not steward');
});
