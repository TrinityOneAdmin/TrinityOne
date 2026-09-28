// A MEMBER WHO HAS WRITTEN 500+ RECORDS CAN STILL UPDATE, AND THE CHURCH KEY IS EXEMPT.
//   Run: node --test scripts/a-member-past-500-records-can-still-rsvp.test.mjs
//
// Without the fix, the catch-all in accept() counted every kind-30078 document
// the author had ever written — including types with their own branch (event:,
// service:, etc.). The church key reached 500 through ordinary work and then
// could not reply to care requests. The screen said "check your connection".
//
// The fix: (1) exempt the church key, (2) count only the fall-through stems
// that can accumulate, (3) always allow updating an existing d-tag, and
// (4) give the refusal an honest reason the client does not treat as permanent.
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

const PORT = 8997;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';

const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const church = K(), member = K();
const cp = church.pub;
let relay, dataDir;
const baseTs = Math.floor(Date.now() / 1000) - 600;

before(async () => {
  await requireFreePort(PORT);
  dataDir = mkdtempSync(join(tmpdir(), 'doccap-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '50000', CHURCH_NPUB: npubEncode(cp) },
  });
  await sleep(800);
  const ws = await connect();
  await publish(ws, finalizeEvent({ kind: 30078, created_at: baseTs,
    tags: [['d', 'trinityone/member:' + cp], ['t', NET]],
    content: JSON.stringify({ joined: true }) }, member.sk));
  ws.close();
});

after(() => { try { relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true }); } catch {} });

const connect = () => new Promise((res, rej) => {
  const ws = new WebSocket(WS_URL);
  ws.on('open', () => res(ws)); ws.on('error', rej);
});

const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2], why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});

const publishAs = async (evt) => { const ws = await connect(); try { return await publish(ws, evt); } finally { try { ws.close(); } catch {} } };

function rsvp(who, id, ts) {
  return finalizeEvent({ kind: 30078, created_at: ts,
    tags: [['d', 'trinityone/rsvp:' + id], ['t', NET], ['church', cp]],
    content: JSON.stringify({ answer: 'yes' }) }, who.sk);
}

function careChat(who, reqId, msgId, ts) {
  return finalizeEvent({ kind: 30078, created_at: ts,
    tags: [['d', 'trinityone/carechat:' + reqId + ':' + msgId], ['t', NET], ['church', cp]],
    content: JSON.stringify({ text: 'hello' }) }, who.sk);
}

test('a member past 500 can update an existing record', async () => {
  const ws = await connect();
  for (let i = 0; i < 500; i++) {
    const r = await publish(ws, rsvp(member, 'evt-' + i, baseTs + i));
    if (!r.ok) { ws.close(); assert.fail('fill failed at ' + i + ': ' + r.why); }
  }
  ws.close();
  const r = await publishAs(rsvp(member, 'evt-0', baseTs + 510));
  assert.equal(r.ok, true, 'a member at 500 could not update their existing RSVP: ' + r.why);
});

test('a member past 500 is refused a NEW record with an honest reason', async () => {
  const r = await publishAs(rsvp(member, 'evt-brand-new-' + Date.now(), baseTs + 520));
  assert.equal(r.ok, false, 'a member past 500 was not refused a new RSVP — the cap is gone');
  assert.match(r.why, /rate-limited/, 'the refusal should say rate-limited, not blocked: ' + r.why);
  assert.doesNotMatch(r.why, /^blocked/, 'the refusal must not start with blocked — the client treats that as permanent');
});

test('the church key is exempt from the 500 limit', async () => {
  const ws = await connect();
  let refused = 0;
  for (let i = 0; i < 510; i++) {
    const r = await publish(ws, careChat(church, 'req1', 'msg-' + i, baseTs + i));
    if (!r.ok) refused++;
  }
  ws.close();
  assert.equal(refused, 0, 'the church key was refused — it should be exempt from the doc cap');
});

test('a flooding member is still refused', async () => {
  const flooder = K();
  const ws = await connect();
  await publish(ws, finalizeEvent({ kind: 30078, created_at: baseTs,
    tags: [['d', 'trinityone/member:' + cp], ['t', NET]],
    content: JSON.stringify({ joined: true }) }, flooder.sk));
  let refused = 0;
  for (let i = 0; i < 510; i++) {
    const r = await publish(ws, rsvp(flooder, 'flood-' + i, baseTs + i));
    if (!r.ok) refused++;
  }
  ws.close();
  assert.ok(refused > 0, 'a flooding member was never refused — the anti-flood cap is gone');
});
