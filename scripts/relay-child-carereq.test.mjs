// WHO THE RELAY ACTUALLY HANDS A CHILD'S REQUEST FOR HELP TO — asked of a REAL relay, over a real socket.
//   Run: node --test scripts/relay-child-carereq.test.mjs
//
// THIS FILE EXISTS BECAUSE THE REGEX DIDN'T HOLD. The first version of this protection was guarded by two
// assertions that matched the shape of the SOURCE TEXT. An auditor broke the gate with a one-token change that
// left every matched token in place — `!safeguardAllows(...)` became `void safeguardAllows(...)` — and all
// seventeen tests stayed green while the relay served a child's disclosure to an uncleared care steward.
//
// AND THE REGEX WAS PINNING THE WRONG THING ANYWAY. The same audit ran the real relay and found the gate was
// a VETO in front of the ordinary care-team rule, not a grant: a reader had to be cleared AND hold a care
// role. So the very people the child's phone encrypts to — a cleared youth worker, the safeguarding steward —
// held a key to a message the relay would never hand them. The seal said one thing, the relay another, and
// the only reader the two agreed on was the church console. A young person who wrote "I don't want to go home
// tonight" would wait until somebody next opened it.
//
// Neither of those is visible from the source text. Both are obvious the moment you ask a running relay.
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

const PORT = 8860;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', CAREREQ_D = 'trinityone/carereq:', CARETEAM_D = 'trinityone/careteam:';
const CARESTATUS_D = 'trinityone/carereqstatus:', CARECHAT_D = 'trinityone/carechat:';
const MINORS_D = 'trinityone/minors:', APPROVED_D = 'trinityone/approved:', STEWARDS_D = 'trinityone/stewards:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// The cast, and every one of them is a real person a church would recognise.
const church = K();          // the console — the vicar's laptop
const ellie  = K();          // 15, marked as a child by her church
const grace  = K();          // a cleared youth worker. NOT on the care rota, NOT a steward.
const hannah = K();          // a steward given the Safeguarding job. Cleared.
const ray    = K();          // a steward given Care. Runs the meal trains. NOT cleared for youth.
const edith  = K();          // an ordinary adult member, asks for a lift to hospital
const cp = church.pub;
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ...tags], content: JSON.stringify(content) }, who.sk);
const memberDoc = who => doc(who, MEMBER_D + cp, { joined: now() });
const carereq = (who, id) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', CAREREQ_D + id], ['t', 'trinityone'], ['church', cp]], content: 'SEALED' }, who.sk);
const status = (by, id, asker, st) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', CARESTATUS_D + id], ['t', 'trinityone'], ['church', cp], ['p', asker.pub]], content: JSON.stringify({ status: st, by: by.pub, at: now() }) }, by.sk);
const chat = (by, reqId, mid, asker) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', CARECHAT_D + reqId + ':' + mid], ['t', 'trinityone'], ['church', cp], ['p', asker.pub]], content: 'SEALED' }, by.sk);

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
// Can this person fetch that document from the relay at all?
async function canFetch(who, d) {
  const ws = await connect();
  const evs = await reqCollect(ws, 'q' + Math.floor(now() % 100000), { kinds: [30078], '#d': [d] }, who && who.sk);
  ws.close();
  return evs.some(e => (e.tags.find(t => t[0] === 'd') || [])[1] === d);
}

before(async () => {
  await requireFreePort(PORT, 'relay-child-carereq.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-childcare-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [ellie, grace, hannah, ray, edith]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'joined');
  await sleep(120);
  // The church sets out its safeguarding: who is a child, who is cleared, and who holds which job.
  assert.equal((await publish(pub, doc(church, MINORS_D + cp, { pubkeys: [ellie.pub] })))[0], true, 'minors list');
  assert.equal((await publish(pub, doc(church, APPROVED_D + cp, { pubkeys: [grace.pub, hannah.pub] })))[0], true, 'cleared list');
  assert.equal((await publish(pub, doc(church, STEWARDS_D + cp, {
    pubkeys: [hannah.pub, ray.pub], caps: { [hannah.pub]: ['safeguarding'], [ray.pub]: ['care'] },
  })))[0], true, 'steward roster with capabilities');
  assert.equal((await publish(pub, doc(church, CARETEAM_D + cp, { pubs: [ray.pub, church.pub] })))[0], true, 'care team');
  await sleep(150);
  assert.equal((await publish(pub, carereq(ellie, 'kid1')))[0], true, 'the child could not open a request at all');
  assert.equal((await publish(pub, carereq(edith, 'adult1')))[0], true, 'an adult could not open a request');
  await sleep(120);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('THE CLEARED YOUTH WORKER CAN READ IT — she holds no care role, and that is the point', async () => {
  assert.equal(await canFetch(grace, CAREREQ_D + 'kid1'), true,
    'Grace is the person Ellie’s phone encrypted this for, and the relay will not hand it to her. Nobody comes.');
});

test('the safeguarding steward can read it', async () => {
  assert.equal(await canFetch(hannah, CAREREQ_D + 'kid1'), true,
    'the steward the church gave the safeguarding job to receives nothing');
});

test('the church’s own console can read it', async () => {
  assert.equal(await canFetch(church, CAREREQ_D + 'kid1'), true, 'the office is a child’s route of last resort');
});

test('the child reads her own request back', async () => {
  assert.equal(await canFetch(ellie, CAREREQ_D + 'kid1'), true, 'she cannot see her own message');
});

test('THE CARE STEWARD CANNOT — a meal-train rota is not a vetting check', async () => {
  assert.equal(await canFetch(ray, CAREREQ_D + 'kid1'), false,
    'Ray runs the meal trains and his church has not cleared him to be near children. Ellie’s disclosure is ' +
    'not his business, and the relay is handing it to him.');
});

test('…nor can an ordinary member, nor anyone at all unauthenticated', async () => {
  assert.equal(await canFetch(edith, CAREREQ_D + 'kid1'), false, 'any member of the church can read it');
  assert.equal(await canFetch(null, CAREREQ_D + 'kid1'), false, 'it is served to an anonymous observer');
});

test('the private reply thread follows the same rule', async () => {
  assert.equal((await publish(pub, chat(grace, 'kid1', 'm1', ellie)))[0], true, 'the cleared adult cannot even reply');
  assert.equal(await canFetch(grace, CARECHAT_D + 'kid1:m1'), true, 'she cannot read the thread she is having');
  assert.equal(await canFetch(ray, CARECHAT_D + 'kid1:m1'), false, 'the uncleared care steward reads the thread');
});

test('and so does the resolution, which names the child', async () => {
  assert.equal((await publish(pub, status(grace, 'kid1', ellie, 'handled')))[0], true, 'a cleared adult cannot resolve it');
  assert.equal(await canFetch(ray, CARESTATUS_D + 'kid1'), false,
    '"handled" on a child’s request tells an uncleared reader that that child asked for help');
  assert.equal(await canFetch(ellie, CARESTATUS_D + 'kid1'), true, 'the child cannot see her own request was answered');
});

test('an uncleared care steward cannot WRITE over a child’s resolution either', async () => {
  // He cannot read the request — but these documents replace in place, so without this he could publish
  // "declined" over it blind, and Ellie's own app would show her plea refused by somebody her church never
  // cleared to touch children's matters.
  assert.equal((await publish(pub, status(ray, 'kid1', ellie, 'declined')))[0], false,
    'the care steward overwrote the resolution of a child’s request');
});

test('NONE OF THIS TOUCHES AN ADULT’S REQUEST — the care team works exactly as before', async () => {
  assert.equal(await canFetch(ray, CAREREQ_D + 'adult1'), true,
    'ordinary care broke: the care steward can no longer see a grown-up asking for a lift');
  assert.equal((await publish(pub, status(ray, 'adult1', edith, 'handled')))[0], true,
    'the care steward can no longer resolve an ordinary request');
  assert.equal(await canFetch(grace, CAREREQ_D + 'adult1'), false,
    'being cleared for youth work now grants access to every adult’s private request as well');
});
