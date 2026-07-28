// Editing an event must REPLACE it, not add a second one.
// Run: node --test scripts/event-edit.test.mjs
//
// The console could only create and remove events, so the Sunday Service / Midweek the setup wizard publishes
// could never be corrected — only deleted and rebuilt. The edit form republishes with the SAME id, which works
// only because kind-30078 is addressable: same (pubkey, kind, d) replaces. If an edit ever minted a fresh id
// the church would silently accumulate duplicate meetings, which is the exact damage the wizard race caused.
//
// Black-box against a real relay, because "replaces" is a relay guarantee, not a UI one.
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

const PORT = 8877;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const EVENT_D = 'trinityone/event:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const church = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const publish = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
// what the console publishes for an event: content carries date/time/recur/day, d-tag carries the id
const evtDoc = (id, body, at) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', EVENT_D + id], ['t', 'trinityone'], ['church', church.pub]], content: JSON.stringify(body) }, church.sk);

// Church docs are read-gated behind NIP-42, so the reader must answer the AUTH challenge — reading without it
// returns an empty set, which looks exactly like "the event isn't there" and would make this test lie.
function read(sock, id, ms = 1200) {
  return new Promise((resolve) => {
    const out = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === 'r1') out.push(m[2]);
      else if (m[0] === 'AUTH') sock.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, church.sk)]));
    };
    sock.on('message', on);
    sock.send(JSON.stringify(['REQ', 'r1', { kinds: [30078], '#d': [EVENT_D + id] }]));
    setTimeout(() => { sock.off('message', on); try { sock.send(JSON.stringify(['CLOSE', 'r1'])); } catch {} resolve(out); }, ms);
  });
}

before(async () => {
  await requireFreePort(PORT, 'event-edit.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-edit-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), RELAY_MAX_EVENTS: '5000' } });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }
  ws = await connect();
});
after(() => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('re-publishing with the same id replaces the event', async () => {
  const id = 'evtedit1';
  assert.equal((await publish(ws, evtDoc(id, { title: 'Sunday Service', time: '10:00', recur: 'weekly', day: 0, date: '2026-07-26' })))[0], true);
  await sleep(120);
  const edited = evtDoc(id, { title: 'Sunday Gathering', time: '10:30', recur: 'weekly', day: 0, date: '2026-07-26' }, now() + 2);
  assert.equal((await publish(ws, edited))[0], true, 'the edit is accepted');
  await sleep(150);
  const held = await read(ws, id);
  assert.equal(held.length, 1, `the church now holds ${held.length} copies of this event — an edit must replace, never duplicate`);
  const c = JSON.parse(held[0].content);
  assert.equal(c.title, 'Sunday Gathering', 'the edit did not take effect');
  assert.equal(c.time, '10:30');
});

test('an edit keeps the series intact (recur + day survive)', async () => {
  // Dropping either field collapses a weekly meeting into one dated entry, silently emptying the calendar
  // of every future occurrence — the fields must be carried through the edit, not re-derived.
  const id = 'evtedit2';
  await publish(ws, evtDoc(id, { title: 'Midweek', time: '19:30', recur: 'weekly', day: 3, date: '2026-07-26' }));
  await sleep(120);
  await publish(ws, evtDoc(id, { title: 'Midweek Prayer', time: '19:00', recur: 'fortnightly', day: 2, date: '2026-07-26' }, now() + 2));
  await sleep(150);
  const c = JSON.parse((await read(ws, id))[0].content);
  assert.equal(c.recur, 'fortnightly', 'the repeat rule must be editable and must persist');
  assert.equal(c.day, 2, 'the day-of-week must persist');
  assert.equal(c.date, '2026-07-26', 'the anchor date must NOT drift — occurrences are derived from it');
});

test('two different events stay two events', async () => {
  await publish(ws, evtDoc('evtA', { title: 'A', date: '2026-08-01' }));
  await publish(ws, evtDoc('evtB', { title: 'B', date: '2026-08-02' }));
  await sleep(150);
  assert.equal((await read(ws, 'evtA')).length, 1);
  assert.equal((await read(ws, 'evtB')).length, 1);
});
