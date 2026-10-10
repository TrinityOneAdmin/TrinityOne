// A CHILD IS NEVER ON THE CARE TEAM — WHATEVER THE ROSTER SAYS.
//   Run: node --test scripts/a-child-on-the-care-roster-gets-no-care-access.test.mjs
//
// Owner, 2026-10-10 (reference/DOMAIN.md): "A child is never on the care team (consistent with 'children do not
// volunteer for care', 2026-10-02): the relay must not grant care-team access to someone marked as a child,
// whatever the roster says."
//
// MEASURED BEFORE THIS (system audit 2026-10-10): careAdmin() in scripts/gateway.mjs asked only "is this person
// on the care team's roster?" — never "is this person a child here?" — so a child put on that roster (the
// generic member picker offers children, rightly, for teams like a youth band) was served adults' asks for
// help, the church's children list and parent links, and other members' clearances.
//
// TWO PARTS, each at the point the person meets it:
//   1. the RELAY, black-box on a real gateway: the same roster holds a child and an adult; the child is refused,
//      the adult (control) is served;
//   2. the console's PUBLISH POINT for the care list (publishCareTeam), out of the SHIPPED bundle
//      vendor/steward-meals.js and called: a person this console holds as a child is not written onto the list
//      every member's phone seals a new ask for help to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const MEALS = readFileSync(join(ROOT, 'vendor/steward-meals.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _t = Math.floor(Date.now() / 1000) - 300; const now = () => ++_t;
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });

// ── the cast ──────────────────────────────────────────────────────────────────────────────────────────────
const church = K();
const CH = K();     // a CHILD (in minors:) who has been put on the care-team roster
const AD = K();     // an ADULT on the same roster — the control
const M = K();      // an adult member who asks for help
const KID2 = K(), PARENT = K();
const cp = church.pub;
const TEAM = cp.slice(0, 16) + '-careteam1';
const rid = (who, tail) => who.pub.slice(0, 16) + '-' + tail;
const D = {
  req: 'trinityone/carereq:' + rid(M, 'r1'),
  minors: 'trinityone/minors:' + cp, guardians: 'trinityone/guardians:' + cp,
  clearance: 'trinityone/clearance:' + M.pub,
};

let PORT, WS_URL, relay, dataDir, pub;
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const ev = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content }, who.sk);
async function authed(who) {
  const ws = await connect();
  await new Promise((resolve) => {
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
      if (m[0] === 'OK' && m[2] === true) { ws.off('message', on); resolve(); } };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', 'kick', { kinds: [4], '#p': [who.pub], limit: 1 }]));
    setTimeout(resolve, 1500);
  });
  return ws;
}
function query(ws, filters, window = 900) {
  return new Promise((resolve) => {
    const id = 'q' + Math.random().toString(36).slice(2, 7); const evs = [];
    const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) evs.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) done(); };
    let fin = false;
    const done = () => { if (fin) return; fin = true; ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', id])); } catch {} resolve(evs); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', id, ...(Array.isArray(filters) ? filters : [filters])]));
    setTimeout(done, window);
  });
}
const readAs = async (who, filters) => { const ws = await authed(who); try { return await query(ws, filters); } finally { ws.close(); } };
const dOf = e => (e.tags.find(t => t[0] === 'd') || [])[1];
const ALL = { kinds: [30078], '#d': [D.req, D.minors, D.guardians, D.clearance] };

before(async () => {
  PORT = await freePort(); WS_URL = `ws://127.0.0.1:${PORT}/relay`;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-childcare-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(150)) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} }
  pub = await connect();
  const ok = async (evt, what) => { const [o, why] = await publish(pub, evt); assert.equal(o, true, what + ' — ' + why); };
  for (const w of [CH, AD, M, KID2, PARENT]) await ok(ev(w, 'trinityone/member:' + cp, JSON.stringify({ joined: now() })), 'member joined');
  await sleep(150);
  // the care team's roster, written by the CHURCH, naming both the child and the adult
  await ok(ev(church, 'trinityone/roster:' + TEAM, JSON.stringify({ pubs: [CH.pub, AD.pub], e: 'sealed-names' }), [['church', cp]]), 'care roster');
  await ok(ev(church, 'trinityone/meals-settings', JSON.stringify({ enabled: true, visibility: 'all', openedBy: 'steward', adminGroupId: TEAM })), 'meals settings');
  await ok(ev(church, D.minors, JSON.stringify({ pubkeys: [CH.pub, KID2.pub] })), 'minors');
  await ok(ev(church, D.guardians, JSON.stringify({ links: { [KID2.pub]: [PARENT.pub] } })), 'guardians');
  await ok(ev(church, D.clearance, 'SEALED-TO-M', [['church', cp], ['p', M.pub]]), 'M’s clearance');
  await sleep(150);
  await ok(ev(M, D.req, 'CIPHER-r1', [['church', cp]]), 'an adult asks for help');
  await sleep(200);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── 1. THE RELAY ──────────────────────────────────────────────────────────────────────────────────────────
test('control: the ADULT on the care roster is served the ask for help, the children list, parent links and a clearance', async () => {
  const got = (await readAs(AD, ALL)).map(dOf).sort();
  assert.deepEqual(got, [D.req, D.minors, D.guardians, D.clearance].sort(),
    'the adult care-team member lost a care grant — the setup proves nothing, or the fix narrowed too far');
});

test('a CHILD on the same care roster is refused an adult’s ask for help', async () => {
  const got = await readAs(CH, { kinds: [30078], '#d': [D.req] });
  assert.deepEqual(got.map(dOf), [], 'the relay serves an adult’s ask for help to a child because the roster names them');
});

test('a CHILD on the care roster is refused the children list, the parent links and another member’s clearance', async () => {
  const got = await readAs(CH, { kinds: [30078], '#d': [D.minors, D.guardians, D.clearance] });
  assert.deepEqual(got.map(dOf), [], 'the relay serves safeguarding lists to a child on the care roster: ' + got.map(dOf).join(', '));
});

test('the child is refused by the CHURCH-TAG filter too (how the care screens actually ask)', async () => {
  const got = await readAs(CH, { kinds: [30078], '#church': [cp] });
  assert.ok(!got.some(e => dOf(e) === D.req || dOf(e) === D.clearance), 'a #church REQ hands the child the ask or a clearance');
});

// ── 2. THE CARE-LIST PUBLISH POINT ────────────────────────────────────────────────────────────────────────
test('publishCareTeam (shipped bundle) never writes a person this console holds as a child onto the care list', async () => {
  const body = fnBody(MEALS, 'function publishCareTeam(memberPubs) {', 'publishCareTeam');
  const sent = [];
  const S0 = { churchPub: cp, blockedHere: () => [], minorsHere: () => [CH.pub], publishSigned: (e) => { sent.push(e); return Promise.resolve(true); } };
  const fn = new Function('S', 'now', 'CARETEAM_D', 'NET', body + '\nreturn publishCareTeam;')(() => S0, () => 1, 'trinityone/careteam:', 'trinityone');
  await fn([CH.pub, AD.pub]);
  assert.equal(sent.length, 1, 'publishCareTeam published nothing');
  const pubs = JSON.parse(sent[0].content).pubs;
  assert.ok(pubs.includes(AD.pub) && pubs.includes(cp), 'CONTROL: the adult care member or the church key is missing');
  assert.ok(!pubs.includes(CH.pub), 'publishCareTeam put a child on the list members seal asks for help to');
  // case: rosters carry lower-case hex, but a hand-edited or upper-case key must not slip through
  sent.length = 0;
  await fn([CH.pub.toUpperCase(), AD.pub]);
  assert.ok(!JSON.parse(sent[0].content).pubs.includes(CH.pub), 'an upper-case child key slipped onto the care list');
});

test('Steward.minorsHere (shipped bundle) answers only for the church the console is looking at', () => {
  const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
  const body = fnBody(STEWARD, 'minorsHere() {', 'Steward.minorsHere');
  const mk = (actingChurch, pub, held) => new Function('actingChurch', 'pub', '_minorsHere', 'return function ' + body + ';')(actingChurch, pub, held)();
  assert.deepEqual(mk('', cp, { cp, list: [CH.pub] }), [CH.pub], 'the owner console does not report its own church’s children');
  assert.deepEqual(mk('', cp, { cp: 'e'.repeat(64), list: [CH.pub] }), [], 'another church’s children list leaked across a church switch');
  assert.deepEqual(mk('', cp, { cp: '', list: [] }), [], 'nothing loaded must read as nobody');
});
