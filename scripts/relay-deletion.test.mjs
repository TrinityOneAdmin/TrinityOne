// Deletion must STAY deleted — NIP-09 tombstones, black-box against a real church-registered relay.
//   Run: node --test scripts/relay-deletion.test.mjs
//
// AUDIT-2026-07-24 found deleted content resurrecting. `store.del()` was a bare DELETE that left no trace, so
// anything that re-fed the relay the same event put it back: a peer resync, a restore-from-export, a client
// replaying its outbox. Three distinct holes, each with a test here:
//
//   1. RESURRECTION — re-publishing a deleted event stored it again as if nothing had happened.
//   2. MIGRATION — a kind-5 already on disk from a pre-tombstone build comes back from put() as 'duplicate', so
//      its tombstone would never be written and anything it had failed to delete would stay resurrected. Healed
//      by a boot backfill. (The related early-return on 'duplicate' in the live path is fixed too, but tombstones
//      subsume it, so it has no independent test — sabotaging it alone leaves this file green.)
//   3. OUT-OF-ORDER — negentropy imports in id order, so a kind-5 that arrived BEFORE its target found nothing
//      to delete, and the target landed a moment later and stayed forever.
//
// Plus the authorship rule that must survive all of it: a kind-5 deletes only its OWN author's events.
// And separately, the honest-ACK fix: a replaceable write that lost the newest-wins race is no longer ACKed true.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8871;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const DB_FILE = 'relay.sqlite';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), M = K(), N = K();
const cp = church.pub;
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const memberDoc = who => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ joined: now() }) }, who.sk);
// a plain church message (kind 1) — the thing a member retracts
const msg = (who, text) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['church', cp]], content: text }, who.sk);
// NIP-09 retraction of one event id
const del = (who, targetId) => finalizeEvent({ kind: 5, created_at: now(), tags: [['e', targetId]], content: '' }, who.sk);
// an addressable doc used for the newest-wins ACK test
const doc = (who, d, body, at) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', d], ['t', 'trinityone'], ['church', cp]], content: JSON.stringify(body) }, who.sk);

function reqCollect(ws, subId, filter, authSk, window = 700) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}
const holds = async (id, authSk) => { const ws = await connect(); const r = await reqCollect(ws, 'q' + id.slice(0, 6), { ids: [id] }, authSk); ws.close(); return r.some(e => e.id === id); };

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-del-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [M, N]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'member joined');
  await sleep(120);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a deleted message does not come back when the same event is re-published (resurrection)', async () => {
  const m = msg(M, 'something I regret');
  assert.equal((await publish(pub, m))[0], true, 'message stored');
  assert.ok(await holds(m.id, M.sk), 'relay holds it before the delete');

  assert.equal((await publish(pub, del(M, m.id)))[0], true, 'the retraction is accepted');
  await sleep(120);
  assert.equal(await holds(m.id, M.sk), false, 'the message is gone after the delete');

  // THE BUG: a resync / restore / outbox replay re-offers the identical event. Without a tombstone it stored again.
  const [ok, reason] = await publish(pub, m);
  await sleep(120);
  assert.equal(ok, false, 're-publishing a deleted event is refused');
  assert.match(reason, /delet/i, 'and the relay says why');
  assert.equal(await holds(m.id, M.sk), false, 'the deleted message STAYS deleted');
});

test('a relay upgraded from a pre-tombstone build re-applies its stored deletions at boot (migration)', async () => {
  // The hazard this covers is specific and real for the live box: tombstones are NEW, so every kind-5 already on
  // disk has no deletions row — and a kind-5 the relay already holds returns 'duplicate' from put(), so it would
  // never be recorded on any later delivery either. Anything that resurrected before the fix would stay
  // resurrected forever. Simulated exactly: delete the tombstone rows and put the message back by hand (which is
  // the state an old build leaves behind), restart, and require the relay to heal itself.
  const m = msg(M, 'resurrected under the old build');
  await publish(pub, m);
  assert.equal((await publish(pub, del(M, m.id)))[0], true, 'retraction accepted');
  await sleep(150);
  assert.equal(await holds(m.id, M.sk), false, 'deleted while running');

  pub.close();
  relay.kill('SIGKILL');
  await sleep(400);

  // rewind the DB to pre-tombstone state: kind-5 still stored, no deletions row, target present again
  const db = new DatabaseSync(join(dataDir, DB_FILE));
  db.exec('DELETE FROM deletions');
  db.prepare('INSERT OR REPLACE INTO events (id,pubkey,kind,created_at,dtag,church,repl,structured,raw) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(m.id, m.pubkey, m.kind, m.created_at, '', cp, null, 0, JSON.stringify(m));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events WHERE id = ?').get(m.id).n, 1, 'the message is back on disk (old-build state)');
  db.close();

  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();

  assert.equal(await holds(m.id, M.sk), false, 'the boot backfill re-applied the stored kind-5 and the message is gone again');
  assert.equal((await publish(pub, m))[0], false, 'and the tombstone now exists, so it cannot be re-published');
});

test('a deletion that arrives BEFORE its target still takes effect (out-of-order sync)', async () => {
  // negentropy imports in id order, so this ordering is routine, not exotic.
  const m = msg(M, 'arrives after its own retraction');
  assert.equal((await publish(pub, del(M, m.id)))[0], true, 'retraction lands first, target unknown');
  await sleep(120);
  const [ok] = await publish(pub, m);
  await sleep(120);
  assert.equal(ok, false, 'the target is refused when it finally arrives');
  assert.equal(await holds(m.id, M.sk), false, 'and never becomes visible');
});

test("a kind-5 still cannot delete someone else's event", async () => {
  const mine = msg(N, "N's message, not M's to delete");
  assert.equal((await publish(pub, mine))[0], true, 'stored');
  assert.equal((await publish(pub, del(M, mine.id)))[0], true, 'the kind-5 itself is accepted (it is a valid event)');
  await sleep(150);
  assert.ok(await holds(mine.id, N.sk), "but N's message is untouched");
  // and the bogus tombstone must not block N from re-publishing their own event either
  const [ok] = await publish(pub, mine);
  assert.equal(ok, true, "a forged tombstone does not lock N's own event out");
});

test('a MIRRORED tombstone cannot undo someone else\u2019s deletion', async () => {
  // AUDIT 2026-07-25, CRITICAL. The deletions table is keyed (target_id, pubkey), so MANY pubkeys can tombstone
  // the same id — but isDeleted() fetched ONE row and compared it. SQLite serves that from the autoindex, i.e.
  // the lexicographically lowest pubkey. kind-5 is world-readable and broadcast, so any member could watch for
  // deletions, echo the same e-tag under their own key, and — whenever their key sorted lower than the author's
  // — permanently disable that deletion. "You can never unsend anything on this relay."
  const m = msg(M, 'M retracts this, N tries to force it back');
  await publish(pub, m);
  assert.equal((await publish(pub, del(M, m.id)))[0], true, 'M deletes their own message');
  await sleep(150);
  assert.equal(await holds(m.id, M.sk), false, 'gone');

  // N mirrors the deletion it just saw on the public kind-5 stream, under N's own key.
  assert.equal((await publish(pub, del(N, m.id)))[0], true, 'the mirrored kind-5 is itself a valid event');
  await sleep(150);

  const [ok] = await publish(pub, m);
  await sleep(150);
  assert.equal(ok, false, 'M\u2019s deletion still stands — a second pubkey\u2019s tombstone must not overrule it');
  assert.equal(await holds(m.id, M.sk), false, 'the message must STAY deleted');
});

test('a forged tombstone for an event the relay has not seen cannot block its author', async () => {
  // The mirror above needs the author's own tombstone present. This is the other ordering: a hostile tombstone
  // planted for an id the relay does not hold yet. It must never stop the real author publishing.
  const m = msg(N, 'N publishes this after M pre-emptively tombstoned it');
  assert.equal((await publish(pub, del(M, m.id)))[0], true, 'M forges a tombstone for an id nobody holds');
  await sleep(150);
  const [ok] = await publish(pub, m);
  await sleep(150);
  assert.equal(ok, true, 'N\u2019s own event must still store — a stranger cannot pre-block it');
  assert.ok(await holds(m.id, N.sk), 'and it is readable');
});

test('a replaceable write that lost the newest-wins race is NOT ACKed as success', async () => {
  const t = now();
  const newer = doc(M, 'trinityone/deltest:' + t, { v: 2 }, t + 5);
  const older = doc(M, 'trinityone/deltest:' + t, { v: 1 }, t);
  assert.equal((await publish(pub, newer))[0], true, 'the newer version stores');
  const [ok, reason] = await publish(pub, older);
  assert.equal(ok, false, 'the older version is rejected, not silently ACKed true');
  assert.match(reason, /newer/i, 'and the client is told a newer version exists');
});
