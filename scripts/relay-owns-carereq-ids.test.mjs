// A REQUEST ID BELONGS TO WHOEVER ASKED. Asked of a REAL relay, over a real socket.
// Run: node --test scripts/relay-owns-carereq-ids.test.mjs
//
// A reply in a care thread is sealed to the recipient list of the REQUEST, so that it reaches exactly whoever
// the request reached. That fix added a check — only trust the copy written by the asker — and an audit on
// 2026-08-28 found the check circular: `requesterPub` is read off the steward's triage list, and that list
// takes newest-wins across authors. So a member could publish a NEWER carereq: at somebody else's id, become
// "the asker" in every reader, and the check would then validate the forgery against itself.
//
// What a real person experiences: a steward opens what looks like a young person's request and replies. The
// reply seals to the forger. The child sees nothing, and their genuine request is masked in the queue.
//
// It cannot be fixed in the clients: whichever copy they trust to name the asker is the one an attacker
// controls. So the relay owns the id, exactly as it does for group: and roster: after AUDIT-2026-07-24 —
// first writer takes it, nobody else may ever write there.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8883;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', CAREREQ_D = 'trinityone/carereq:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();
const ellie  = K();      // asks for help
const mallory = K();     // an ordinary member of the same church
const cp = church.pub;
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d]], content: JSON.stringify(content) }, who.sk);
const memberDoc = who => doc(who, MEMBER_D + cp, { joined: now() });
const carereq = (who, id, at) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', CAREREQ_D + id], ['t', 'trinityone'], ['church', cp]], content: JSON.stringify({ keys: { [who.pub]: 'x' }, enc: 'y' }) }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'relay-owns-carereq-ids.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-carereqid-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [ellie, mallory]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'joined');
  await sleep(150);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the asker can open a request', async () => {
  const [ok, why] = await publish(pub, carereq(ellie, 'req1'));
  assert.equal(ok, true, `a member could not ask for help at all: ${why}`);
});

test('ANOTHER MEMBER CANNOT WRITE AT THAT SAME ID', async () => {
  await sleep(150);
  const [ok] = await publish(pub, carereq(mallory, 'req1'));
  assert.equal(ok, false,
    'a member published their own copy at somebody else\'s request id. Every reader takes newest-wins, so ' +
    'that copy becomes "the request" — the steward\'s reply seals to the forger and the asker gets nothing.');
});

test('…not even with an older timestamp, which would win an earliest-wins rule', async () => {
  const [ok] = await publish(pub, carereq(mallory, 'req1', now() - 86400));
  assert.equal(ok, false, 'back-dating let a second author claim an id that was already owned');
});

test('the asker may still update their OWN request', async () => {
  await sleep(150);
  const [ok, why] = await publish(pub, carereq(ellie, 'req1'));
  assert.equal(ok, true, `the asker can no longer revise or withdraw their own request: ${why}`);
});

// NOT COVERED HERE, and worth knowing: the `!CAREREQ_OWNER.has(rid)` guard in note() only changes anything
// for events ALREADY ON DISK when this fix ships. accept() runs before note(), so once the gate is live a
// second author's copy is refused and never stored — which means this test cannot manufacture the case. If a
// forgery were already stored from an older build, boot replays in created_at ASC and the earliest copy wins,
// which is why the guard is `!has` rather than an unconditional set. Pre-pilot there is no such data.
test('a fresh id is still free to whoever asks first', async () => {
  const [ok, why] = await publish(pub, carereq(mallory, 'req2'));
  assert.equal(ok, true, `ownership leaked across ids — nobody else can ask for help any more: ${why}`);
});

test('OWNERSHIP SURVIVES A RESTART — it is rebuilt from what is on disk', async () => {
  // CHILD_PHOTOS_OK shipped without this and was empty after every boot. note() replays kind 30078 at boot in
  // created_at order, so the map refills — but only a restart proves it, and only a restart would have caught
  // that one.
  pub.close();
  relay.kill('SIGKILL');
  await sleep(400);
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  const [ok] = await publish(pub, carereq(mallory, 'req1'));
  assert.equal(ok, false, 'after a restart the id was unowned again and the forgery was accepted');
});

// ── the ID ITSELF NAMES THE ASKER ──────────────────────────────────────────────────────────────────────────
// The map above only ever guarded accept(). /import and relay-to-relay sync call store.put() directly and
// never reach it, so a forged request could arrive by replication and sit beside the genuine one — every
// reader then picks newest-wins. A map is bookkeeping and bookkeeping has doors; an id that names its owner
// is a property of the event, true at every door, on every relay, after every restart. Same convention as
// `group:`/`roster:` (ID_OWNER_RE). Audit, 2026-08-28.
const selfNamed = (who, tail, at) => finalizeEvent({ kind: 30078, created_at: at || now(),
  tags: [['d', CAREREQ_D + who.pub.slice(0, 16) + '-' + tail], ['t', 'trinityone'], ['church', cp]],
  content: JSON.stringify({ keys: { [who.pub]: 'x' }, enc: 'y' }) }, who.sk);
// the same id, signed by somebody else — what a forger must produce
const forged = (who, ownerPub, tail) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', CAREREQ_D + ownerPub.slice(0, 16) + '-' + tail], ['t', 'trinityone'], ['church', cp]],
  content: JSON.stringify({ keys: { [who.pub]: 'x' }, enc: 'y' }) }, who.sk);

test('a request whose id names the asker is accepted', async () => {
  const [ok, why] = await publish(pub, selfNamed(ellie, 'aaaa1111'));
  assert.equal(ok, true, `a member could not ask for help with a self-naming id: ${why}`);
});

test('A FORGERY AT THAT ID IS REFUSED WITH NOTHING REMEMBERED', async () => {
  const [ok] = await publish(pub, forged(mallory, ellie.pub, 'aaaa1111'));
  assert.equal(ok, false,
    'a member published at an id that names somebody else. The steward\'s triage list takes newest-wins, so ' +
    'their reply would seal to the forger and the asker would get nothing.');
});

test('…and at an id that has never been seen, so no map could help', async () => {
  // This is the case the map cannot cover: nothing has claimed the id, so first-writer-wins would ACCEPT it.
  // Only the id naming its owner refuses it.
  const [ok] = await publish(pub, forged(mallory, ellie.pub, 'neverseen9'));
  assert.equal(ok, false,
    'a forger claimed an unused id belonging to another member — this is exactly the hole a replicated ' +
    'forgery walks through, because on a second relay the id has never been seen either');
});

test('back-dating does not help, because there is no ordering to win', async () => {
  const [ok] = await publish(pub, finalizeEvent({ kind: 30078, created_at: 1,
    tags: [['d', CAREREQ_D + ellie.pub.slice(0, 16) + '-bbbb2222'], ['t', 'trinityone'], ['church', cp]],
    content: 'x' }, mallory.sk));
  assert.equal(ok, false, 'a back-dated forgery was accepted');
});

test('a member whose app has NOT updated can still ask for help', async () => {
  // Old builds mint a bare random id with no owner prefix. Refusing those would refuse a request for help
  // because somebody had not updated their app, which is the worst thing on this screen to refuse.
  const [ok, why] = await publish(pub, carereq(mallory, 'legacyid00000000'));
  assert.equal(ok, true, `a prefix-less id from an older build was refused: ${why}`);
});
