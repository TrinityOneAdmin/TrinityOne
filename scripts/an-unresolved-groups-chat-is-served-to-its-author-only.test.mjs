// A GROUP THE RELAY CANNOT TIE TO A CHURCH IS NOT SERVED TO EVERYONE ON THE BOX (SIGNUP-SAFEGUARDING-GAPS gap 2).
//   Run: node --test scripts/an-unresolved-groups-chat-is-served-to-its-author-only.test.mjs
//
// THE DEFECT (scripts/gateway.mjs, canRead, kind-1 `g` branch). The church that owns a group is resolved as
// `GROUP_CHURCH.get(g) || idNamesOwner(g)`. When NEITHER answers — a LEGACY id from before namespacing
// (`mensgroup1`), or an id that names a church this box does not register — the only refusal was to a total
// stranger. The read then fell to `GROUP_VIS.get(g) !== 'invite'`, which is true for a group with no entry, so
// every member of EVERY church on the box read that room's chat and the child-safe check never ran.
//
// REAL GATEWAY, REAL CANREAD. This boots scripts/gateway.mjs on a seeded store, as the neighbouring
// relay-divergent-safeguarding.test.mjs does; nothing about the gate is stubbed.
//
// WHY THE IDS ARE LEGACY / UNREGISTERED. A modern id that names a REGISTERED church resolves through
// idNamesOwner, so an outsider is ALREADY refused by the `churchReader` check at gcp — a test built with such an id
// passes before and after the fix and proves nothing. Test 0 below is exactly that control: it pins that the
// fixture's modern id is refused either way, so the tests that follow are known to be biting on the id shape.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { openStore } from './event-store.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 9081;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const churchA = K(), churchB = K();     // two configured churches on one box
const authorA = K();                    // an adult member of A: writes the messages
const peerA = K();                      // another adult member of A
const childA = K();                     // a child of A (on A's minors list)
const memberB = K();                    // a member of the OTHER church
const LEGACY = 'mensgroup1';            // no owner in the id, no definition on this relay
const UNREG = 'f'.repeat(16) + '-room'; // names a church this relay does not carry
let MODERN = '';                        // names church A (registered): resolves, so already gated
let relay, dataDir;

const waitReady = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay never came up'); };
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
const memberDoc = (who, cp) => finalizeEvent({ kind: 30078, created_at: now() - 900, tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp]], content: JSON.stringify({ joined: true }) }, who.sk);
const minorsDoc = (cp, sk, pubs) => finalizeEvent({ kind: 30078, created_at: now() - 800, tags: [['d', 'trinityone/minors:' + cp], ['t', NET]], content: JSON.stringify({ pubkeys: pubs }) }, sk);
// A chat line as the shipped member app writes it: both `t` tags, and `['p', churchpub]` (src/fellowship.src.js:6366).
const chat = (who, gid, text, cp) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['t', gid], ...(cp ? [['p', cp]] : [])], content: text }, who.sk);
// Read as an AUTHENTICATED identity (an anonymous read is refused by an earlier gate and would prove nothing).
const readAs = (who, gid) => new Promise(async (res, rej) => {
  let ws; try { ws = await connect(); } catch (e) { return rej(e); }
  const seen = []; let authId = '', asked = 0;
  const done = () => { try { ws.close(); } catch {} res(seen); };
  const t = setTimeout(done, 8000);
  const ask = () => { asked++; ws.send(JSON.stringify(['REQ', 'r' + asked, { kinds: [1], '#t': [gid], limit: 20 }])); };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH') { const evt = finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk); authId = evt.id; ws.send(JSON.stringify(['AUTH', evt])); return; }
    if (m[0] === 'OK' && m[1] === authId) { if (m[2] !== true) { clearTimeout(t); return done(); } ask(); return; }
    if (m[0] === 'EVENT' && String(m[1]).startsWith('r')) seen.push(m[2]);
    if (m[0] === 'EOSE' && String(m[1]).startsWith('r') && authId) { clearTimeout(t); done(); }
  });
  ask();
});
const post = async (evt) => { const ws = await connect(); try { return await publish(ws, evt); } finally { ws.close(); } };

before(async () => {
  await requireFreePort(PORT, 'an-unresolved-groups-chat-is-served-to-its-author-only.test.mjs');
  MODERN = churchA.pub.slice(0, 16) + '-mens';
  dataDir = mkdtempSync(join(tmpdir(), 'trin-unresolved-'));
  const store = openStore(join(dataDir, 'relay.sqlite'), { maxEvents: 5000 });
  for (const m of [authorA, peerA, childA]) store.put(memberDoc(m, churchA.pub));
  store.put(memberDoc(memberB, churchB.pub));
  store.put(minorsDoc(churchA.pub, churchA.sk, [childA.pub]));
  store.close();
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: `${npubEncode(churchA.pub)},${npubEncode(churchB.pub)}` },
    stdio: 'ignore',
  });
  await waitReady();
  // The fixture: author A writes into each room. The write side deliberately accepts an unresolved group.
  for (const [gid, withTag, text] of [[MODERN, true, 'modern'], [LEGACY, true, 'legacy tagged'], [UNREG, true, 'unreg tagged'], ['mensgroup2', false, 'legacy untagged']]) {
    const [ok, msg] = await post(chat(authorA, gid, text, withTag ? churchA.pub : ''));
    assert.equal(ok, true, 'fixture: the author could not post into ' + gid + ' (' + msg + ')');
  }
  await sleep(300);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const bodies = (evs) => evs.map(e => e.content).sort();

test('0 CONTROL: a registered church\'s modern id is refused to an outsider either way (so this file\'s other ids are the ones that bite)', async () => {
  assert.deepEqual(bodies(await readAs(memberB, MODERN)), [], 'a member of another church read a registered church\'s room');
  assert.deepEqual(bodies(await readAs(peerA, MODERN)), ['modern'], 'CONTROL: the church\'s own member could not read its room, so the refusal above proves nothing');
});

test('1 a LEGACY-id room with no definition is not served to a member of a DIFFERENT church (the fail-open)', async () => {
  assert.deepEqual(bodies(await readAs(memberB, LEGACY)), [],
    'A MEMBER OF ANOTHER CHURCH READ CHAT IN A GROUP THIS RELAY CANNOT TIE TO ANY CHURCH (the unresolved-group read fell through to "open")');
});

test('1b an id naming an UNREGISTERED church is not served to a member of a different church either', async () => {
  assert.deepEqual(bodies(await readAs(memberB, UNREG)), [], 'a member of another church read an unresolved-group room (unregistered owner prefix)');
});

test('2 the same room IS served to its own church (the message names it with ["p", churchpub]), and to its author', async () => {
  assert.deepEqual(bodies(await readAs(peerA, LEGACY)), ['legacy tagged'], 'CONTROL: the church the message names could not read it — the fix would be an outage');
  assert.deepEqual(bodies(await readAs(authorA, LEGACY)), ['legacy tagged'], 'CONTROL: an author could not read their own message');
  assert.deepEqual(bodies(await readAs(peerA, UNREG)), ['unreg tagged']);
});

test('3 a message with NO church clue in an unresolved group is served to its AUTHOR ONLY — not even the author\'s own church', async () => {
  assert.deepEqual(bodies(await readAs(authorA, 'mensgroup2')), ['legacy untagged'], 'CONTROL: the author could not read their own line');
  assert.deepEqual(bodies(await readAs(peerA, 'mensgroup2')), [], 'a peer read a message nothing ties to a church (fail CLOSED means author-only)');
  assert.deepEqual(bodies(await readAs(memberB, 'mensgroup2')), [], 'another church read it');
});

test('4 a CHILD of the named church is refused an unresolved group (an unknown room is NOT child-safe)', async () => {
  assert.deepEqual(bodies(await readAs(childA, LEGACY)), [], 'A MARKED CHILD READ CHAT IN A ROOM THE RELAY COULD NOT PROVE CHILD-SAFE');
  assert.deepEqual(bodies(await readAs(peerA, LEGACY)), ['legacy tagged'], 'CONTROL: an adult of the same church is served, so the refusal is the minor rule and not an outage');
});

test('5 once the church publishes the room\'s definition the ordinary arm serves it (the outage heals), including the untagged line', async () => {
  const def = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/group:mensgroup2'], ['t', NET], ['church', churchA.pub]], content: JSON.stringify({ name: 'Men', kind: 'group' }) }, churchA.sk);
  const [ok, msg] = await post(def);
  assert.equal(ok, true, 'fixture: the church could not publish the definition (' + msg + ')');
  await sleep(300);
  assert.deepEqual(bodies(await readAs(peerA, 'mensgroup2')), ['legacy untagged'], 'with the definition present the church\'s member is served');
  assert.deepEqual(bodies(await readAs(memberB, 'mensgroup2')), [], 'another church must still be refused once the room is defined');
});
