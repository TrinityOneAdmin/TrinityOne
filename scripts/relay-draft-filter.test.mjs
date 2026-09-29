// R-6: Drafts and scheduled items must NOT reach a member's phone.
// The console says "Hidden from members", but the relay served them to any subscriber.
// After this fix, the relay withholds plan/devotional docs with draft:true or a future
// publishAt from ordinary members, while stewards and the church still see them.
//   Run: node --test scripts/relay-draft-filter.test.mjs
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

const PORT = 8703;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const STEWARDS_D = 'trinityone/stewards:';
const PLAN_D = 'trinityone/plan:';
const DEVO_D = 'trinityone/devotional:';
const NET = 'trinityone';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _t = Math.floor(Date.now() / 1000) - 200; const now = () => ++_t;
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), steward = K(), member = K();
const cp = church.pub;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ['church', cp], ...extra], content: JSON.stringify(content) }, who.sk);

function reqCollect(ws, subId, filter, authSk, window = 800) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}

before(async () => {
  await requireFreePort(PORT, 'relay-draft-filter.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-draft-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(150); }
  ws = await connect();
  // register member and steward
  assert.equal((await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ joined: now() }) }, member.sk)))[0], true, 'member joined');
  assert.equal((await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ joined: now() }) }, steward.sk)))[0], true, 'steward joined');
  // set steward roster
  assert.equal((await send(ws, doc(church, STEWARDS_D + cp, { pubkeys: [steward.pub], caps: { [steward.pub]: ['content'] } })))[0], true, 'roster');
  await sleep(300);

  // publish plans: one live, one draft, one future-scheduled
  assert.equal((await send(ws, doc(church, PLAN_D + 'live1', { title: 'Live Plan', days: ['a','b','c'] })))[0], true, 'live plan');
  assert.equal((await send(ws, doc(church, PLAN_D + 'draft1', { title: 'Draft Plan', days: ['x'], draft: true })))[0], true, 'draft plan');
  assert.equal((await send(ws, doc(church, PLAN_D + 'future1', { title: 'Scheduled Plan', days: ['y'], publishAt: Math.floor(Date.now() / 1000) + 86400 })))[0], true, 'future plan');

  // publish devotionals: one live, one draft
  assert.equal((await send(ws, doc(church, DEVO_D + 'liveD', { title: 'Live Devo', body: 'hello' })))[0], true, 'live devo');
  assert.equal((await send(ws, doc(church, DEVO_D + 'draftD', { title: 'Draft Devo', body: 'not ready', draft: true })))[0], true, 'draft devo');
  await sleep(200);
});
after(() => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a member receives ONLY the live plan — not drafts or future-scheduled', async () => {
  const mws = await connect();
  const plans = await reqCollect(mws, 'mp', { kinds: [30078], '#d': [PLAN_D + 'live1', PLAN_D + 'draft1', PLAN_D + 'future1'] }, member.sk);
  mws.close();
  const ids = plans.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]);
  assert.ok(ids.includes(PLAN_D + 'live1'), 'member must see the live plan');
  assert.ok(!ids.includes(PLAN_D + 'draft1'),
    'DEFECT (pre-fix): member received a draft plan the console says is "Hidden from members"');
  assert.ok(!ids.includes(PLAN_D + 'future1'),
    'DEFECT (pre-fix): member received a future-scheduled plan before its publish time');
});

test('a member receives ONLY the live devotional — not the draft', async () => {
  const mws = await connect();
  const devos = await reqCollect(mws, 'md', { kinds: [30078], '#d': [DEVO_D + 'liveD', DEVO_D + 'draftD'] }, member.sk);
  mws.close();
  const ids = devos.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]);
  assert.ok(ids.includes(DEVO_D + 'liveD'), 'member must see the live devotional');
  assert.ok(!ids.includes(DEVO_D + 'draftD'),
    'DEFECT (pre-fix): member received a draft devotional');
});

test('CONTROL: the church key still sees all plans including drafts', async () => {
  const cws = await connect();
  const plans = await reqCollect(cws, 'cp', { kinds: [30078], '#d': [PLAN_D + 'live1', PLAN_D + 'draft1', PLAN_D + 'future1'] }, church.sk);
  cws.close();
  const ids = plans.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]);
  assert.ok(ids.includes(PLAN_D + 'live1'), 'church must see live plan');
  assert.ok(ids.includes(PLAN_D + 'draft1'), 'church must see draft plan');
  assert.ok(ids.includes(PLAN_D + 'future1'), 'church must see future plan');
});

test('CONTROL: a content steward still sees all plans including drafts', async () => {
  const sws = await connect();
  const plans = await reqCollect(sws, 'sp', { kinds: [30078], '#d': [PLAN_D + 'live1', PLAN_D + 'draft1', PLAN_D + 'future1'] }, steward.sk);
  sws.close();
  const ids = plans.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]);
  assert.ok(ids.includes(PLAN_D + 'live1'), 'steward must see live plan');
  assert.ok(ids.includes(PLAN_D + 'draft1'), 'steward must see draft plan');
  assert.ok(ids.includes(PLAN_D + 'future1'), 'steward must see future plan');
});

test('publishing a draft (removing the draft flag) makes it visible to members', async () => {
  // re-publish the draft plan without the draft flag
  assert.equal((await send(ws, doc(church, PLAN_D + 'draft1', { title: 'Now Published Plan', days: ['x'] })))[0], true, 'publish');
  await sleep(200);

  const mws = await connect();
  const plans = await reqCollect(mws, 'up', { kinds: [30078], '#d': [PLAN_D + 'draft1'] }, member.sk);
  mws.close();
  assert.equal(plans.length, 1, 'member must now see the formerly-draft plan');
  const body = JSON.parse(plans[0].content);
  assert.equal(body.title, 'Now Published Plan');
});
