// Who may say "this new key is that member"? Only the church or a current steward.
// Run: node --test scripts/relay-reseat.test.mjs
//
// The re-seat doc (d=trinityone/reseat:<churchpub>) exists because a member who loses their 12 words cannot
// get their old key back — nobody has it — so the church vouches that a NEW key is the same person and moves
// their seat (name, place on the roster) across.
//
// That makes it one of the most dangerous documents in the system: whoever can write it can hand ANY member's
// identity to ANY key. An unlisted d-tag falls through to the generic member rule in accept(), which is how
// the photo-suppression list once became member-writable — so the gate is asserted here, not assumed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8884;   /* unique across scripts/*.test.mjs — the suite runs files in parallel and every relay test binds a FIXED port, so a duplicate deadlocks both and reports false failures */
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', RESEAT_D = 'trinityone/reseat:', STEWARDS_D = 'trinityone/stewards:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// church, one steward it appoints, an ordinary member, the member who lost their words, and their new key
const church = K(), steward = K(), member = K(), lost = K(), fresh = K();
let relay, dataDir, ws;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const publish = (sock, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } };
  sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt]));
  setTimeout(() => { sock.off('message', on); res([null, 'timeout']); }, 4000);
});
const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(content) }, who.sk);
const authEvt = (who, challenge) => finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', challenge]], content: '' }, who.sk);
const pair = (o, n) => ({ pairs: [{ old: o.pub, new: n.pub, at: now() }] });

function read(sock, subId, filter, { authAs = null, window = 3500 } = {}) {
  return new Promise((resolve) => {
    const events = []; let gotAuth = false;
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH') { gotAuth = true; if (authAs) sock.send(JSON.stringify(['AUTH', authEvt(authAs, m[1])])); }
    };
    sock.on('message', on); sock.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { sock.off('message', on); try { sock.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve({ events, gotAuth }); }, window);
  });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-reseat-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
    stdio: 'ignore',
  });
  await waitReady();
  ws = await connect();
  // everyone involved is a real member of this church, so no test passes merely because someone was a stranger
  for (const who of [member, lost, steward]) assert.equal((await publish(ws, doc(who, MEMBER_D + church.pub, { joined: now() })))[0], true);
  assert.equal((await publish(ws, doc(church, STEWARDS_D + church.pub, { pubkeys: [steward.pub] })))[0], true, 'steward appointed');
  await sleep(200);
});
after(() => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('an ORDINARY MEMBER cannot re-seat anyone', async () => {
  const [ok] = await publish(ws, doc(member, RESEAT_D + church.pub, pair(lost, fresh)));
  assert.notEqual(ok, true, 'a member wrote the re-seat map — they could hand any member’s identity to any key');
});

test('a member cannot re-seat THEMSELVES onto another member’s seat', async () => {
  // Wait past the previous test's second first. Without this the relay refuses this write as a STALE
  // replaceable doc and the assertion passes without the authorisation gate doing anything — verified by
  // deleting the gate and watching this test stay green while its siblings went red.
  await sleep(1100);
  const [ok] = await publish(ws, doc(member, RESEAT_D + church.pub, { pairs: [{ old: lost.pub, new: member.pub, at: now() }] }));
  assert.notEqual(ok, true, 'a member claimed another member’s seat');
});

test('the CHURCH may re-seat a member', async () => {
  const [ok] = await publish(ws, doc(church, RESEAT_D + church.pub, pair(lost, fresh)));
  assert.equal(ok, true, 'the church must be able to vouch — this is the whole feature');
});

test('a CURRENT steward may re-seat a member', async () => {
  const [ok] = await publish(ws, doc(steward, RESEAT_D + church.pub, pair(lost, fresh)));
  assert.equal(ok, true, 'a delegated steward runs the church day to day and must be able to do this in person');
});

test('a REVOKED steward may no longer re-seat', async () => {
  // A replaceable doc is newest-wins to the SECOND, and the roster was appointed in setup moments ago —
  // so wait past that second or the revocation is refused as stale and this test would pass for a false reason.
  await sleep(1100);
  assert.equal((await publish(ws, doc(church, STEWARDS_D + church.pub, { pubkeys: [] })))[0], true, 'steward revoked');
  await sleep(200);
  const [ok] = await publish(ws, doc(steward, RESEAT_D + church.pub, pair(lost, fresh)));
  assert.notEqual(ok, true, 'revoking a steward must remove this power, or revocation is cosmetic');
  // re-appoint for the tests that follow. A replaceable doc is newest-wins, so this needs a LATER created_at
  // than the revocation — same-second republishes are refused, which is correct and not what we are testing.
  await sleep(1100);
  assert.equal((await publish(ws, doc(church, STEWARDS_D + church.pub, { pubkeys: [steward.pub] })))[0], true, 're-appointed');
  await sleep(200);
});

test('nobody may re-seat inside ANOTHER church', async () => {
  const other = K();
  const [ok] = await publish(ws, doc(steward, RESEAT_D + other.pub, pair(lost, fresh)));
  assert.notEqual(ok, true, 'a steward of one church must not re-seat members of another');
});

test('the re-seat map is not readable by an anonymous connection', async () => {
  const anon = await connect();
  const r = await read(anon, 'r1', { kinds: [30078], '#d': [RESEAT_D + church.pub] }, { authAs: null });
  anon.close();
  assert.equal(r.events.length, 0, 'it maps members’ old keys to new ones — that is roster metadata, not public');
  assert.equal(r.gotAuth, true, 'and the relay must challenge so a real member can read it');
});

test('an authenticated member CAN read it (they need it to see one person, not two)', async () => {
  const sock = await connect();
  const r = await read(sock, 'r2', { kinds: [30078], '#d': [RESEAT_D + church.pub] }, { authAs: member });
  sock.close();
  assert.ok(r.events.length >= 1, 'a member could not read the re-seat map, so their roster would show duplicates');
  const c = JSON.parse(r.events[r.events.length - 1].content);
  assert.equal(c.pairs[0].old, lost.pub);
  assert.equal(c.pairs[0].new, fresh.pub);
});
