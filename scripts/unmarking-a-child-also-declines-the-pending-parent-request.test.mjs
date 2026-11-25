// UNMARKING A CHILD ALSO DECLINES A PENDING PARENT REQUEST, SO THE RELAY STOPS TREATING THEM AS A MINOR (integration audit 2026-11-23, A2).
//   Run: node --test scripts/unmarking-a-child-also-declines-the-pending-parent-request.test.mjs
//
// THE RELAY'S RULE (gateway.mjs rebuildEffectiveMinors): a child is a minor while ANY parent vouches for them and the pair is not `closed` —
// and a vouch is EITHER a `guardians:` link OR a valid-ack guardreq still sitting in PENDING_REQ_BY. The D7 unmark closed only the linked
// pairs, so a child whose parent's request was never confirmed stayed relay-gated after the unmark, and the request came straight back as a
// Confirm card. The fix closes the pending pair with the SAME operation the Decline card performs: the same setGuardians closed-pair write,
// and the same notifyGuardianList so the parent's app withdraws its own request.
//
// POINT OF USE. The real DashMembers panel is rendered (esbuild + the repo's miniReact, as unmarking-a-linked-child-… does), the REAL
// "Unmark as a child" button is pressed, and window.Steward's setMinors / setGuardians publish the church-signed documents to a REAL booted
// gateway — seeded with a REAL parent-authored guardreq carrying the child's own signed ack — which is then asked what the child may read.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts, find } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const NOW = Math.floor(Date.now() / 1000), NET = 'trinityone', PORT = 9094, WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), kid = K(), dad = K(), mum = K();
const NAMES = { [kid.pub]: 'Tom Okafor', [dad.pub]: 'Ruth Okafor', [mum.pub]: 'Kay Okafor' };
const ROOM_ADULTS = church.pub.slice(0, 16) + '-adults', ROOM_KIDS = church.pub.slice(0, 16) + '-kids';
let relay, dataDir, _t = 0; const tick = () => NOW - 2000 + (++_t);
const churchDoc = (d, content, tags = []) => finalizeEvent({ kind: 30078, created_at: tick(), tags: [['d', d], ['t', NET], ...tags], content: JSON.stringify(content) }, church.sk);
const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
// a parent's guardian-link request with the child's own signed ack — the exact shape a-pending-child-is-a-minor-… proved PENDING_REQ_BY folds
const ackEvt = (child, parentPub) => finalizeEvent({ kind: 30078, created_at: tick(), tags: [['d', 'trinityone/guardreq:ack:' + church.pub], ['p', parentPub], ['t', NET]], content: JSON.stringify({ parent: parentPub, church: church.pub }) }, child.sk);
const guardreq = (parent, child) => finalizeEvent({ kind: 30078, created_at: tick(), tags: [['d', 'trinityone/guardreq:' + child.pub], ['t', NET], ['p', church.pub], ['p', child.pub]], content: JSON.stringify({ child: child.pub, parent: parent.pub, ack: ackEvt(child, parent.pub) }) }, parent.sk);

const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = async (evt) => { const ws = await connect(); try { return await new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); }); } finally { ws.close(); } };
const readAs = (sk, filter) => new Promise(async (res, rej) => {
  let ws; try { ws = await connect(); } catch (e) { return rej(e); }
  const seen = []; let authId = '', asked = 0; const done = () => { try { ws.close(); } catch {} res(seen); }; const t = setTimeout(done, 8000);
  const ask = () => { asked++; ws.send(JSON.stringify(['REQ', 'r' + asked, filter])); };
  ws.on('message', d => { const m = JSON.parse(d);
    if (m[0] === 'AUTH') { const evt = finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk); authId = evt.id; ws.send(JSON.stringify(['AUTH', evt])); return; }
    if (m[0] === 'OK' && m[1] === authId) { if (m[2] !== true) { clearTimeout(t); return done(); } ask(); return; }
    if (m[0] === 'EVENT' && String(m[1]).startsWith('r')) seen.push(m[2]);
    if (m[0] === 'EOSE' && String(m[1]).startsWith('r') && authId) { clearTimeout(t); done(); } });
  ask();
});
const roomsAs = async (who) => (await readAs(who.sk, { kinds: [30078], '#d': ['trinityone/group:' + ROOM_ADULTS, 'trinityone/group:' + ROOM_KIDS] })).map(e => dOf(e).replace('trinityone/group:', '')).sort();
const BOTH = [ROOM_ADULTS, ROOM_KIDS].sort();

// the state the church is in: Tom is a MARKED child with a PENDING (valid-ack) request from Ruth, and optionally a CONFIRMED link to Kay
async function seedRelay({ links = null, reqs = [] } = {}) {
  const mem = (w) => finalizeEvent({ kind: 30078, created_at: NOW - 3000, tags: [['d', 'trinityone/member:' + church.pub], ['t', NET], ['p', church.pub]], content: JSON.stringify({ joined: 1 }) }, w.sk);
  for (const w of [kid, dad, mum]) assert.equal((await publish(mem(w)))[0], true, 'fixture: member doc');
  assert.equal((await publish(churchDoc('trinityone/group:' + ROOM_ADULTS, { name: 'Notices', kind: 'open' }, [['church', church.pub]])))[0], true);
  assert.equal((await publish(churchDoc('trinityone/group:' + ROOM_KIDS, { name: 'Prayer', kind: 'open', childsafe: true }, [['church', church.pub]])))[0], true);
  assert.equal((await publish(churchDoc('trinityone/minors:' + church.pub, { pubkeys: [kid.pub] })))[0], true);
  assert.equal((await publish(churchDoc('trinityone/guardians:' + church.pub, { links: links || {} })))[0], true);
  for (const [parent, child] of reqs) assert.equal((await publish(guardreq(parent, child)))[0], true, 'fixture: guardreq');
  await sleep(300);
}
before(async () => {
  await requireFreePort(PORT, 'unmarking-a-child-also-declines-the-pending-parent-request.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-a2-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) }, stdio: 'ignore' });
  const t0 = Date.now(); for (;;) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} if (Date.now() - t0 > 15000) throw new Error('relay never came up'); await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── the rendered Members panel, whose Steward writes go to the real relay (same rig as unmarking-a-linked-child-…) ──
async function loadSlices(anchors, exportNames, globals) {
  const src = anchors.map(([anchor, what]) => fnBody(STEW, anchor, what)).join('\n') + '\n' + ['stewKeyRecipients', 'stewKeyRecipientsOrAdmitted', 'useStewKeyRecipients'].map(n => fnBody(STEW, 'function ' + n + '(', n)).join('\n') + '\n' + STEW.match(/^const STEW_KEYS_LOADING = .*;$/m)[0] + '\n' + (STEW.match(/^const _blockingInFlight = .*;$/m) || [''])[0];
  const tmp = join(tmpdir(), 'a2-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx'); let js;
  try { writeFileSync(tmp, src + `\nexport { ${exportNames.join(', ')} };\n`); js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' }); } finally { rmSync(tmp, { force: true }); }
  const key = '__a2_' + Math.random().toString(36).slice(2); globalThis[key] = globals;
  return await import('data:text/javascript;base64,' + Buffer.from(Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n') + '\n' + js).toString('base64'));
}
const furniture = () => ({
  CustomEvent, setTimeout, clearTimeout, Promise, Date, Math, JSON, Set, Object, String, Array, Number,
  location: { search: '', hostname: 'x' },
  document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
  SK_TINT: { gold: { fg: '#000' }, sage: { fg: '#000' }, clay: { fg: '#000' }, ink: { fg: '#000' } },
  nameHandle: () => '', shortNpub: (n) => String(n || '').slice(0, 12) + '…', ago: () => 'a while ago',
  Panel: (p) => (p && p.children) || null, Icon: () => null, SkPill: (p) => (p && p.children) || null,
  SkBadge: () => null, SkConfirm: () => null, DismissibleNote: (p) => (p && p.children) || null, StewHelpLink: (p) => (p && p.label) || null,
  useStewNarrow: () => false, clearanceExpiryCounts: () => ({ expiring: 0, expired: 0 }),
  useStewDialog: () => ({ current: null }), todayISO: () => '2026-09-07', stewCapState: () => ({ allowed: true }),
});
async function membersPanel({ minors, links, pending = [], closed = {}, refuseGuardians = false }) {
  const { React, draw } = miniReact();
  const calls = { minors: [], guardians: [], removed: [], listed: [] };
  const members = () => Object.keys(NAMES).map(pk => ({ pubkey: pk, npub: 'npub1' + pk.slice(0, 8), name: NAMES[pk], count: 2, lastTs: NOW - 60, joined: NOW - 9000 }));
  const g = { React, ...furniture(), window: { Steward: {
    setBlocked: () => Promise.resolve(true), setAdmitted: () => Promise.resolve(true),
    // the console's transport: the church-signed documents, to the REAL relay
    setMinors: async (l) => { calls.minors.push(l); const [ok] = await publish(churchDoc('trinityone/minors:' + church.pub, { pubkeys: l })); return ok; },
    setGuardians: async (m, c) => { calls.guardians.push([m, c]); if (refuseGuardians) return null; const [ok] = await publish(churchDoc('trinityone/guardians:' + church.pub, { links: m, ...(c && Object.keys(c).length ? { closed: c } : {}) })); return ok; },
    notifyGuardianRemoved: (...a) => { calls.removed.push(a); return Promise.resolve(null); },
    notifyGuardianList: (...a) => { calls.listed.push(a); return Promise.resolve(null); },   // what Decline sends the parent's app
    setApproved: () => Promise.resolve(true), setNoPhoto: () => Promise.resolve(true), revokeCheckinPermission: () => Promise.resolve({ id: 'x' }),
  },
    useStewardCheckinPermissions: () => [], useStewardGroups: () => [], useStewardStewards: () => [], useStewardChurch: () => ({}), useStewardBlocked: () => [],
    useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, guardiansKnown: true, guardiansAt: 0, clearedKnown: true, cleared: {}, minors, approved: [], nophoto: [], guardians: links }),
    useStewardGuardians: () => ({ links, closed, at: 0 }), useStewardGuardianRequests: () => pending,
    useStewardJoinPolicy: () => false, useStewardAdmitted: () => [], useStewardMembers: members,
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true } };
  const mod = await loadSlices([['function DashMembers(', 'DashMembers']], ['DashMembers'], g);
  let tree = draw(mod.DashMembers, {});
  const btn = (re) => find(tree, n => n.type === 'button' && n.props && re.test(String(n.props['aria-label'] || '') + ' ' + texts(n).join(' ')));
  return { calls, btn, words: () => { tree = draw(mod.DashMembers, {}); return texts(tree).join(' '); } };
}
const press = async (p, re) => { const b = p.btn(re); assert.ok(b.length >= 1, 're-anchor: no control matching ' + re); await b[0].props.onClick(); await sleep(400); };

test('1 POINT OF USE: pressing "Unmark as a child" on a child with a PENDING parent request closes the pair, and the real relay then serves them the adults-only room', async () => {
  await seedRelay({ reqs: [[dad, kid]] });
  assert.deepEqual(await roomsAs(kid), [ROOM_KIDS], 'CONTROL: the marked child with a pending vouch must start child-safe-only');
  const p = await membersPanel({ minors: [kid.pub], links: {}, pending: [{ child: kid.pub, parent: dad.pub, ts: NOW - 600 }] });
  await press(p, /^Unmark as a child: Tom/);
  assert.deepEqual(p.calls.minors, [[]], 'the unmark did not write an empty children list: ' + JSON.stringify(p.calls.minors));
  assert.equal(p.calls.guardians.length, 1, 'THE UNMARK LEFT THE PENDING REQUEST OPEN — PENDING_REQ_BY re-pends the child and the relay keeps treating them as a minor');
  const [map, closed] = p.calls.guardians[0];
  assert.deepEqual(map, {}, 'the link map should be untouched (the request was never confirmed): ' + JSON.stringify(map));
  assert.ok(closed[kid.pub + '|' + dad.pub] > 0, 'no closed pair was written for the pending request: ' + JSON.stringify(closed));
  assert.equal(p.calls.listed.length, 1, 'the parent\'s app was not told, so it would show "Waiting for steward to confirm" for ever');
  assert.equal(p.calls.listed[0][0], dad.pub, 'the decline notice went to the wrong account');
  assert.deepEqual(await roomsAs(kid), BOTH, 'AFTER THE UNMARK THE RELAY STILL TREATS THE CHILD AS A MINOR — the pending guardreq vouch was left standing');
});

test('2 MIXED: a confirmed link AND a pending request are both closed in the ONE write; another family\'s link is left alone', async () => {
  await seedRelay({ links: { [kid.pub]: [mum.pub] }, reqs: [[dad, kid]] });
  const other = K(), otherKid = K();
  const p = await membersPanel({ minors: [kid.pub], links: { [kid.pub]: [mum.pub], [otherKid.pub]: [other.pub] }, pending: [{ child: kid.pub, parent: dad.pub, ts: NOW - 600 }] });
  await press(p, /^Unmark as a child: Tom/);
  assert.equal(p.calls.guardians.length, 1, 'expected ONE guardians write covering both pairs');
  const [map, closed] = p.calls.guardians[0];
  assert.deepEqual(map, { [otherKid.pub]: [other.pub] }, 'another family\'s link was disturbed: ' + JSON.stringify(map));
  assert.ok(closed[kid.pub + '|' + mum.pub] && closed[kid.pub + '|' + dad.pub], 'a pair was not closed: ' + JSON.stringify(closed));
  assert.equal(p.calls.removed.length, 1, 'the LINKED parent should get the removal notice'); assert.equal(p.calls.removed[0][0], mum.pub);
  assert.equal(p.calls.listed.length, 1, 'the PENDING requester should get the list notice, as Decline sends'); assert.equal(p.calls.listed[0][0], dad.pub);
  assert.deepEqual(await roomsAs(kid), BOTH);
});

test('3 FAIL CLOSED: a refused close is reported ("still stands") and the relay keeps the child gated', async () => {
  await seedRelay({ reqs: [[dad, kid]] });
  const p = await membersPanel({ minors: [kid.pub], links: {}, pending: [{ child: kid.pub, parent: dad.pub, ts: NOW - 600 }], refuseGuardians: true });
  await press(p, /^Unmark as a child: Tom/);
  assert.deepEqual(await roomsAs(kid), [ROOM_KIDS], 'a child whose pending-request close was REFUSED was served the adults-only room');
  assert.equal(p.calls.listed.length, 0, 'a parent was told their request was declined although the relay refused the close');
  assert.match(p.words(), /request from Ruth Okafor still stands/, 'THE REFUSED CLOSE WAS NOT REPORTED — the steward would believe the child is now an adult');
});

test('4 COUNTER: a STILL-MARKED child is untouched, another child\'s pending request is never closed, and an already-closed pair is not re-written', async () => {
  await seedRelay({ reqs: [[dad, kid]] });
  // marking someone (the protective direction) must not touch the map or anyone's pending request
  const mk = await membersPanel({ minors: [], links: {}, pending: [{ child: kid.pub, parent: dad.pub, ts: NOW - 600 }] });
  await press(mk, /^Mark as a child: Kay/);
  assert.deepEqual(mk.calls.guardians, [], 'marking a child wrote the parent-link map');
  assert.deepEqual(await roomsAs(kid), [ROOM_KIDS], 'the OTHER child\'s pending vouch must still gate them');
  // unmarking Tom while the pending request belongs to a DIFFERENT child writes nothing
  const un = await membersPanel({ minors: [kid.pub, mum.pub], links: {}, pending: [{ child: mum.pub, parent: dad.pub, ts: NOW - 600 }] });
  await press(un, /^Unmark as a child: Tom/);
  assert.deepEqual(un.calls.guardians, [], 'unmarking Tom closed a pair belonging to a different child');
  // a pair the church already declined is not written again
  const re = await membersPanel({ minors: [kid.pub], links: {}, pending: [{ child: kid.pub, parent: dad.pub, ts: NOW - 600 }], closed: { [kid.pub + '|' + dad.pub]: NOW - 300 } });
  await press(re, /^Unmark as a child: Tom/);
  assert.deepEqual(re.calls.guardians, [], 'an already-closed pair was re-written on unmark');
});
