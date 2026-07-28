// /stats — the console's dashboard aggregates. Black-box against a REAL, CHURCH-REGISTERED relay on an
// ISOLATED high port with a throwaway data dir (never a8, never :8000).
//   Run: node --test scripts/relay-stats.test.mjs
//
// /status is public and deliberately coarse. /stats is NOT: it breaks activity down BY CHURCH, and a
// per-church publishing rhythm ("this congregation went quiet in March") is precisely what an observer
// holding a seized relay would want. So the first thing proved here is that it is default-DENY.
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

// isolated high port — 8837 privacy, 8838 safeguarding, 8839 safety, 8840 tenancy, 8841 config,
// 8842 careskip. `npm test` runs these files CONCURRENTLY, so a shared port fails both.
const PORT = 8843;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), member = K();
const cp = church.pub;
let relay, dataDir, ws, token;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res(m[2]); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); });
const note = (who, text) => finalizeEvent({ kind: 1, created_at: now(), tags: [['church', cp]], content: text }, who.sk);
const memberDoc = who => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp]], content: '{}' }, who.sk);
const getStats = (auth, qs = '') => fetch(`http://127.0.0.1:${PORT}/stats${qs}`, { headers: auth ? { Authorization: 'Bearer ' + token } : {} });

before(async () => {
  await requireFreePort(PORT, 'relay-stats.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-stats-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  await waitReady();
  token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  ws = await connect();
  assert.equal(await publish(ws, memberDoc(member)), true);
  for (let i = 0; i < 5; i++) assert.equal(await publish(ws, note(church, 'hello ' + i)), true);
});

after(async () => { try { ws.close(); } catch {} try { relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('an anonymous caller gets nothing — default deny', async () => {
  const r = await getStats(false);
  assert.equal(r.status, 401, '/stats answered an unauthenticated caller');
  const body = await r.text();
  assert.equal(body.includes(cp), false, 'the church pubkey leaked in the refusal');
});

test('a wrong token gets nothing', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/stats`, { headers: { Authorization: 'Bearer not-the-token' } });
  assert.equal(r.status, 401);
});

test('the public /status still does NOT carry per-church activity', async () => {
  const s = await (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
  assert.equal(s.ok, true);
  assert.equal(JSON.stringify(s).includes('"daily"'), false, 'per-day activity leaked onto the public endpoint');
  assert.equal(JSON.stringify(s.counts || {}).includes(cp), false, 'a church pubkey leaked onto the public endpoint');
});

test('the admin gets the aggregates', async () => {
  const s = await (await getStats(true)).json();
  assert.equal(s.ok, true);
  assert.ok(Array.isArray(s.daily) && s.daily.length === 30, 'expected 30 dense day buckets');
  assert.equal(s.daily.every(d => typeof d.n === 'number' && typeof d.day === 'number'), true);
  const total = s.daily.reduce((a, d) => a + d.n, 0);
  assert.ok(total >= 5, `the 5 notes just published are missing from the daily series (got ${total})`);
  const k1 = (s.kinds || []).find(k => k.kind === 1);
  assert.ok(k1 && k1.n >= 5, 'the kind breakdown lost the notes');
});

test('the day series is DENSE — a quiet day is 0, not a gap', async () => {
  const s = await (await getStats(true, '?days=14')).json();
  assert.equal(s.daily.length, 14);
  // strictly ascending, exactly one day apart: a missing bucket would silently rescale the chart
  for (let i = 1; i < s.daily.length; i++) {
    assert.equal(s.daily[i].day - s.daily[i - 1].day, 86400, `bucket ${i} is not one day after its predecessor`);
  }
  assert.equal(s.daily.some(d => d.n === 0), true, 'expected at least one quiet day to be reported as 0');
});

test('days is clamped — a hostile value cannot ask for an unbounded scan', async () => {
  assert.equal((await (await getStats(true, '?days=99999')).json()).daily.length, 365);
  assert.equal((await (await getStats(true, '?days=0')).json()).daily.length, 30);
  assert.equal((await (await getStats(true, '?days=-5')).json()).daily.length, 30);
  assert.equal((await (await getStats(true, '?days=abc')).json()).daily.length, 30);
});

test('per-church rows carry the operator’s name, not just a pubkey', async () => {
  const s = await (await getStats(true)).json();
  const row = (s.churches || []).find(c => c.church === cp);
  assert.ok(row, 'the church with all the activity is missing from the per-church breakdown');
  assert.ok(row.n >= 5);
  assert.equal('name' in row, true, 'the console would have to render a raw npub');
});
