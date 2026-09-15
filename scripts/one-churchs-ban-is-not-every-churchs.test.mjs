// A BAN IS THE BANNING CHURCH'S. IT MUST BITE THERE, AND IT MUST NOT REACH ANYWHERE ELSE.
//   Run: node --test scripts/one-churchs-ban-is-not-every-churchs.test.mjs
//
// The relay kept each church's blocklist separately in BLOCKED_BY and then merged them all into one
// relay-wide `BLOCKED` set, which eleven gates consulted. So a ban was not a church removing someone from
// its own rooms — it was an eviction from the whole box, handed to every church on it.
//
// MEASURED before the fix, 2026-09-15, on a clean two-church relay — the shape test 1 below now holds:
//     victim joins church B (and has never touched church A)      accepted
//     victim writes to church B                                   accepted
//     church A publishes a blocklist naming the victim            accepted
//     victim writes to church B                                   REFUSED "blocked: not a member…"
//     church A empties its blocklist                              accepted
//     victim writes to church B                                   accepted again
// Two churches with no relationship, one of them able to silence the other's member, and the only person
// who could see why was whoever could read the relay's rejected.log.
//
// This relay hosts many churches at once — relay/church.json carries nine on the dev box today — so this is
// the ordinary configuration and not a contrived one. The identical defect was found and fixed for MINORS
// on 2026-07-30 (AUDIT S3, see `minorOf`); blocks were simply never scoped alongside them.
//
// ⚠ AND THE OPPOSITE FAILURE WOULD BE WORSE, WHICH IS WHY TEST 2 EXISTS AND WHY NEITHER TEST IS OPTIONAL.
// The cheap way to make test 1 pass is to stop consulting blocklists at all, and that is a church unable to
// remove someone from its own rooms — the thing the feature is FOR. Test 2 fails on any such fix. Anyone
// touching blockedBy(), rebuildMembers() or accept()'s ban line must keep both green together.
//
// ── WHY THIS DRIVES A REAL RELAY ─────────────────────────────────────────────────────────────────────────
// The gates in question (accept(), rebuildMembers(), the REQ scan, NIP-42 AUTH) are module-private and read
// live maps that only exist in a running process, so a lifted-function test would be asserting about a
// fixture rather than about the relay. This spawns scripts/gateway.mjs with two configured churches in a
// fresh data directory and talks NIP-01 to it over a websocket, which is the same thing a phone does.
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

const PORT = 8978;
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const key = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const churchA = key();      // the church that does the banning, and which the victim never joins
const churchB = key();      // the victim's own church, with no relationship to A
const victim  = key();      // a member of B and of nobody else
const bystander = key();    // a member of B who is never named on any list — the control

let relay = null, dataDir = null, ws = null;

const doc = (who, d, content, tags = []) => finalizeEvent({
  kind: 30078, created_at: now(), content: JSON.stringify(content),
  tags: [['d', d], ['t', 'trinityone'], ...tags],
}, who.sk);

const conn = () => new Promise((res, rej) => {
  const w = new WebSocket(`ws://127.0.0.1:${PORT}/relay`, { headers: { Host: '127.0.0.1' } });
  w.on('open', () => res(w)); w.on('error', rej);
});

// Send one event and return the relay's own answer, so a refusal is reported in the relay's words.
const send = (ev) => new Promise((res) => {
  const on = (m) => {
    const a = JSON.parse(m);
    if (a[0] === 'OK' && a[1] === ev.id) { ws.off('message', on); res({ ok: a[2], why: a[3] || '' }); }
  };
  ws.on('message', on);
  ws.send(JSON.stringify(['EVENT', ev]));
  setTimeout(() => { ws.off('message', on); res({ ok: null, why: 'no answer in 8s' }); }, 8000);
});

// A member writing an ordinary document to their own church. `member:<churchpub>` is the simplest write a
// member makes and the one the ban gate refused in the measurement above.
//
// ⚠ SPACED BY A SECOND, FOR THE SAME REASON banlist() is — and this trap bit this file TWICE, so it is
// written down rather than left to be rediscovered. Every write here replaces the SAME document
// (`member:<churchpub>` is one per member per church), and the store refuses a replacement whose created_at
// is not strictly newer. Two writes inside one second therefore come back 'invalid: a newer version of this
// is already stored', which is indistinguishable from a ban refusal if you are only looking at ok=false.
// The first run of this file after the fix went red on exactly that and looked like a real defect.
const writeTo = async (who, church, n) => {
  await sleep(1100);
  return send(doc(who, D.MEMBER + church.pub, { joined: now(), n }));
};
// ⚠ WAIT A SECOND FIRST, LITERALLY. A blocklist is a REPLACEABLE document, and the store refuses a
// replacement whose created_at is not NEWER — same second counts as not newer, answered 'have-newer'. The
// first draft of this file banned and un-banned inside one second, so the un-ban was silently refused and
// the test reported "lifting the ban did not restore them" as though the relay had a bug. It did not.
const banlist = async (church, pubs) => {
  await sleep(1100);
  const r = await send(doc(church, D.BLOCKED + church.pub, { pubkeys: pubs }));
  assert.equal(r.ok, true, 'fixture: the blocklist write was refused (' + r.why + '), so the ban state is not what this test thinks');
  await sleep(400);
  return r;
};

before(async () => {
  await requireFreePort(PORT, 'one-churchs-ban-is-not-every-churchs.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-ban-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir,
           CHURCH_NPUB: `${npubEncode(churchA.pub)},${npubEncode(churchB.pub)}` },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  ws = await conn();
  // Both of B's people join B. NEITHER ever joins A — that is the whole point of the fixture.
  for (const who of [victim, bystander]) {
    const r = await send(doc(who, D.MEMBER + churchB.pub, { joined: now() }));   // different authors → different documents, no clash
    assert.equal(r.ok, true, 'fixture: the join was refused (' + r.why + '), so nothing below would mean anything');
  }
  await sleep(250);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  await sleep(200);
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('church A cannot silence a member of church B', async () => {
  const before_ = await writeTo(victim, churchB, 1);
  assert.equal(before_.ok, true,
    'fixture: a member of B could not write to B even before any ban (' + before_.why + ')');

  await banlist(churchA, [victim.pub]);

  const after_ = await writeTo(victim, churchB, 2);
  assert.equal(after_.ok, true,
    'CROSS-TENANT BAN: church A named this person on ITS blocklist and church B — which has no relationship ' +
    'with A and whose member this is — refused their write with "' + after_.why + '". A ban is one church ' +
    'removing someone from its own rooms, never an eviction from the box. See blockedBy(pub, cp).');

  // …and the bystander, who is on nobody's list, must be unaffected either way — a control against a fixture
  // that has simply stopped refusing anything.
  const by = await writeTo(bystander, churchB, 3);
  assert.equal(by.ok, true, 'fixture: an unnamed member of B was refused (' + by.why + ')');

  await banlist(churchA, []);   // leave the box clean for the next test
});

test('…but church B\'s own ban still bites, which is the whole point of banning', async () => {
  const before_ = await writeTo(victim, churchB, 4);
  assert.equal(before_.ok, true, 'fixture: the victim should start un-banned (' + before_.why + ')');

  await banlist(churchB, [victim.pub]);

  const after_ = await writeTo(victim, churchB, 5);
  assert.notEqual(after_.ok, true,
    'A BAN HAS STOPPED WORKING. Church B banned this person and the relay still took their write. This is ' +
    'the failure mode that scoping blocklists invites, and it is worse than the leak it replaces: a church ' +
    'that cannot remove someone from its own rooms has no way to protect the people in them.');

  // The bystander is the control: B's ban must not become "B refuses everybody".
  const by = await writeTo(bystander, churchB, 6);
  assert.equal(by.ok, true,
    'church B\'s ban on one person also refused a member who was never named (' + by.why + ')');

  await banlist(churchB, []);
  const restored = await writeTo(victim, churchB, 7);
  assert.equal(restored.ok, true,
    'lifting the ban did not restore them (' + restored.why + ') — a ban must be reversible by the church ' +
    'that made it, or a mistaken block is permanent.');
});
