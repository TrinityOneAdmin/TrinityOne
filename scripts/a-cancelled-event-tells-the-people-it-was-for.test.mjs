// WHEN A CHURCH CANCELS AN EVENT, THE PEOPLE IT WAS FOR ARE TOLD — AND THE LOCK SCREEN IS TOLD NOTHING ELSE.
// Run: node --test scripts/a-cancelled-event-tells-the-people-it-was-for.test.mjs
//
// Drives a REAL scripts/gateway.mjs on a temp port with a temp data dir, over WebSockets, with REAL web-push
// subscriptions pointed at a local HTTP server, and decrypts what actually arrives. Nothing here is a mirror
// of the relay's logic: if maybePushCancel is removed from the live ingest path, the first test goes red.
//
// The four things that are easy to get wrong and are each tested by name:
//
//   1. FIRE ON LIVE INGEST ONLY. The relay replays its whole corpus through note() on every restart, and it
//      restarts by itself when it self-updates. A cancellation notice on the replay path would re-notify the
//      congregation about every event cancelled since the church was founded, once per restart, for ever.
//   2. ONCE PER EVENT. A retry, a republished tombstone, an edit — one notification, or none.
//   3. NOTHING IDENTIFYING ON THE LOCK SCREEN. "Sunday service cancelled — St Aidan's, Barnwell Green" tells
//      whoever is holding that phone which church its owner attends. The serving push already gets this
//      right ("Can you serve? / Serving · Welcome team · Sunday"); this follows it.
//   4. SAFEGUARDING. A young person is not pushed about a room their church has not marked child-safe —
//      the same rule maybePushMessage got in AUDIT 2026-08-29, on the neighbouring path.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createECDH, randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import ece from 'http_ece';

const PORT = 9412, PUSH_PORT = 9413;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', MINORS_D = 'trinityone/minors:';
const EVENT_D = 'trinityone/event:';
const ADULTS_G = 'grp-marriage-counselling', KIDS_G = 'grp-youth';
const CHURCH_NAME = "St Aidan's, Barnwell Green";
const EVENT_TITLE = 'Marriage counselling supper';

const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), adultA = K(), adultB = K(), minorC = K(), plainMember = K();
let relay, dataDir, pub, pushSrv, tlsFiles = [];

// every POST web-push makes, decrypted, keyed by the label in the endpoint path
const delivered = [];
const subKeys = {};   // label -> { ecdh, auth }

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); }
  throw new Error('relay not ready');
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
const doc = (who, d, content, at) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(content) }, who.sk);
// an event exactly as the console publishes one: the group in a 't' tag, everything else in the content.
const evtDoc = (who, id, gid, at) => finalizeEvent({
  kind: 30078, created_at: at || (now() - 20),
  tags: gid ? [['d', EVENT_D + id], ['t', 'trinityone'], ['t', gid]] : [['d', EVENT_D + id], ['t', 'trinityone']],
  content: JSON.stringify({ title: EVENT_TITLE, date: '2026-09-20', time: '19:00', where: 'The church hall', groupId: gid || '' }),
}, who.sk);
// …and a cancellation exactly as steward.src.js removeEvent() publishes one: NO group tag, no content.
// That absence is the point of the whole design: the audience has to come from what the relay recorded
// when the event arrived, because the tombstone says nothing about who it was for.
const tombstone = (who, id, at) => finalizeEvent({
  kind: 30078, created_at: at || now(), tags: [['d', EVENT_D + id], ['t', 'trinityone'], ['deleted', '1']], content: '',
}, who.sk);

// Register a genuine web-push subscription for `who`, pointed at our own HTTP server. The relay demands a
// signed proof bound to the endpoint, so this exercises the real subscribe route too.
async function subscribe(who, label) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  subKeys[label] = { ecdh, auth };
  const endpoint = `https://127.0.0.1:${PUSH_PORT}/push/${label}`;
  const sub = { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const proof = finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', endpoint]], content: '' }, who.sk);
  const r = await fetch(`http://127.0.0.1:${PORT}/push/subscribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub, auth: proof }),
  });
  assert.equal(r.status, 200, 'the relay refused a push subscription, so this test can observe nothing');
}

// what arrived since the marker, as decrypted payloads
const since = () => delivered.length;
const sent = (mark) => delivered.slice(mark);
const to = (mark, label) => sent(mark).filter(p => p.label === label);

before(async () => {
  await requireFreePort(PORT, 'a-cancelled-event-tells-the-people-it-was-for.test.mjs (relay)');
  await requireFreePort(PUSH_PORT, 'a-cancelled-event-tells-the-people-it-was-for.test.mjs (push endpoint)');
  // web-push speaks HTTPS and nothing else (it requires('https') outright), so the stand-in push service has
  // to be a TLS server. A throwaway self-signed certificate, generated here rather than committed, and the
  // relay is told to accept it — that flag reaches ONLY this spawned test relay, never the shipped one.
  const keyPath = join(tmpdir(), 'trin-push-' + process.pid + '.key'), certPath = join(tmpdir(), 'trin-push-' + process.pid + '.crt');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
      '-days', '3650', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  } catch (err) {
    throw new Error('openssl is needed to stand up the stand-in push service for this test and is not available: ' + (err && err.message));
  }
  tlsFiles = [keyPath, certPath];
  pushSrv = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => {
    const label = String(req.url || '').split('/').pop();
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      let payload = null;
      try {
        const k = subKeys[label];
        payload = JSON.parse(ece.decrypt(body, { version: 'aes128gcm', privateKey: k.ecdh, authSecret: k.auth.toString('base64url') }).toString());
      } catch (err) { payload = { _undecryptable: String(err && err.message) }; }
      delivered.push({ label, ...payload });
      res.writeHead(201).end();
    });
  });
  await new Promise(r => pushSrv.listen(PUSH_PORT, '127.0.0.1', r));

  dataDir = mkdtempSync(join(tmpdir(), 'trin-evtcancel-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub), NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    stdio: 'ignore',
  });
  await waitReady();
  pub = await connect();

  // the church names itself, so we can prove the notification does not
  assert.equal((await publish(pub, finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: CHURCH_NAME }) }, church.sk)))[0], true);
  for (const who of [adultA, adultB, minorC, plainMember]) assert.equal((await publish(pub, doc(who, MEMBER_D + church.pub, { joined: now() })))[0], true);
  assert.equal((await publish(pub, doc(church, GROUP_D + ADULTS_G, { name: 'Marriage counselling', kind: 'open' })))[0], true);   // no childsafe flag → adults only
  assert.equal((await publish(pub, doc(church, GROUP_D + KIDS_G, { name: 'Youth', kind: 'open', childsafe: true })))[0], true);
  assert.equal((await publish(pub, doc(church, MINORS_D + church.pub, { pubkeys: [minorC.pub] })))[0], true);
  await sleep(250);

  for (const [who, label] of [[adultA, 'adultA'], [adultB, 'adultB'], [minorC, 'minorC'], [plainMember, 'plain'], [church, 'church']]) await subscribe(who, label);
});

after(() => {
  try { pub && pub.close(); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { pushSrv && pushSrv.close(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  for (const f of tlsFiles) { try { rmSync(f, { force: true }); } catch {} }
});

test('cancelling a group event notifies that group — and NOT the young person the church has not marked that room safe for', async () => {
  const id = 'evt-adults-1';
  assert.equal((await publish(pub, evtDoc(church, id, ADULTS_G)))[0], true, 'the relay refused the event itself');
  await sleep(200);
  const m = since();
  assert.equal((await publish(pub, tombstone(church, id)))[0], true, 'the relay refused the cancellation');
  await sleep(900);

  assert.equal(to(m, 'adultA').length, 1, 'nobody was told the event was cancelled — they will turn up to a locked hall');
  assert.equal(to(m, 'adultB').length, 1, 'only some of the room was told');
  assert.deepEqual(to(m, 'minorC'), [],
    'a young person was pushed about a room their church has not marked child-safe — the same disclosure ' +
    'the read gate withholds, on the one path no client filter can reach');
  assert.deepEqual(to(m, 'church'), [], 'the church notified itself about its own cancellation');
});

test('the lock screen learns neither which church nor which event', async () => {
  const id = 'evt-adults-2';
  await publish(pub, evtDoc(church, id, ADULTS_G));
  await sleep(200);
  const m = since();
  await publish(pub, tombstone(church, id));
  await sleep(900);

  const [p] = to(m, 'adultA');
  assert.ok(p, 'no notification to inspect');
  const words = String(p.title || '') + ' ' + String(p.body || '') + ' ' + String(p.url || '') + ' ' + String(p.tag || '');
  assert.doesNotMatch(words, /Aidan|Barnwell/i, 'the church was named on a locked screen — that is the disclosure, not the bug we were fixing');
  assert.doesNotMatch(words, /Marriage|counselling|supper/i, 'the event (and with it the room) was named on a locked screen');
  assert.doesNotMatch(words, /church hall/i, 'the place was named on a locked screen');
  assert.doesNotMatch(words, /[0-9a-f]{16}/, 'a pubkey leaked into a push payload');
  // …and it still says enough to be worth opening.
  assert.match(String(p.title || ''), /cancel/i, 'the notification does not say what happened, so nobody will open it');
});

test('a church-wide cancellation reaches everyone, young people included (the gate is not a blanket block)', async () => {
  const id = 'evt-wholechurch-1';
  await publish(pub, evtDoc(church, id, ''));    // no group: the whole church's calendar
  await sleep(200);
  const m = since();
  await publish(pub, tombstone(church, id));
  await sleep(900);

  assert.equal(to(m, 'adultA').length, 1);
  assert.equal(to(m, 'minorC').length, 1,
    'a church-wide cancellation names no room and no church, and the relay serves that event to a young ' +
    'person — withholding it would silently drop them from their own church calendar');
});

test('a room the church HAS marked child-safe still reaches the young people it is for', async () => {
  const id = 'evt-youth-1';
  await publish(pub, evtDoc(church, id, KIDS_G));
  await sleep(200);
  const m = since();
  await publish(pub, tombstone(church, id));
  await sleep(900);
  assert.equal(to(m, 'minorC').length, 1, 'the youth group was cancelled and the youth group was not told');
});

test('editing an event notifies nobody', async () => {
  const id = 'evt-edit-1';
  await publish(pub, evtDoc(church, id, ADULTS_G, now() - 30));
  await sleep(200);
  const m = since();
  // a steward fixes a typo, twice
  await publish(pub, evtDoc(church, id, ADULTS_G, now() - 10));
  await publish(pub, evtDoc(church, id, ADULTS_G, now() - 5));
  await sleep(700);
  assert.deepEqual(sent(m), [], 'correcting an event pushed the congregation as though it had been cancelled');
});

test('cancelling twice notifies once', async () => {
  const id = 'evt-twice-1';
  await publish(pub, evtDoc(church, id, ADULTS_G, now() - 30));
  await sleep(200);
  const m = since();
  assert.equal((await publish(pub, tombstone(church, id, now() - 5)))[0], true);
  await sleep(700);
  assert.equal(to(m, 'adultA').length, 1, 'the first cancellation did not notify at all');
  // a retry from an outbox, a second press, a republish from another device — a NEW event id each time
  await publish(pub, tombstone(church, id, now() - 3));
  await publish(pub, tombstone(church, id, now()));
  await sleep(900);
  assert.equal(to(m, 'adultA').length, 1, 'a republished tombstone notified the congregation a second time');
});

test('an ordinary member cannot make the congregation’s phones buzz', async () => {
  const id = 'evt-forge-1';
  await publish(pub, evtDoc(church, id, ADULTS_G, now() - 30));
  await sleep(200);
  const m = since();
  await publish(pub, tombstone(plainMember, id, now()));
  await sleep(900);
  assert.deepEqual(sent(m), [], 'a member who did not write the event cancelled it for the whole church');
});

test('A RELAY RESTART DOES NOT RE-NOTIFY ANYBODY', async () => {
  // The relay replays its entire corpus through note() on every boot, and it reboots by itself when it
  // self-updates. Without the live-only rule this fires again for every event ever cancelled, every time.
  // Nothing is republished here: the corpus on disk already holds every tombstone the tests above made.
  const m = since();
  relay.kill('SIGKILL');
  await sleep(400);
  try { pub.close(); } catch {}
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub), NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    stdio: 'ignore',
  });
  await waitReady();
  await sleep(1200);
  assert.deepEqual(sent(m), [],
    'a restart re-notified the congregation about events cancelled days ago — and this relay restarts on ' +
    'its own schedule, so that is every member, every update, for ever');

  // …and the tombstones are still there to be re-delivered by a resyncing peer or a retrying client.
  pub = await connect();
  const m2 = since();
  await publish(pub, tombstone(church, 'evt-adults-1', now()));
  await sleep(900);
  assert.deepEqual(sent(m2), [],
    'a tombstone re-published after a restart notified again — the once-per-event guard did not survive the ' +
    'reboot, which is exactly when it is needed');
});
