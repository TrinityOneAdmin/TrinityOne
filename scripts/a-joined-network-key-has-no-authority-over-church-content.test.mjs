// A JOINED NETWORK KEY HAS NO AUTHORITY OVER A CHURCH'S OWN CONTENT (Networks MVP, N1, 2026-10-21).
// Run: node --test scripts/a-joined-network-key-has-no-authority-over-church-content.test.mjs
//
// Phase 2 walled the network key off children / care / check-in / child-DM / feed. N1 removes the rest:
// groups, plans, devotionals, rotas, rosters, services, requests, rooms, bookings, run-sheets, categories,
// sermons, finance and the sealed-room key envelope. A church JOINS a network by publishing
// `trinityone/network:<networkpub>` ({joined}) from its own key; after that the network key must read and write
// NONE of the church's own documents. (Network announcements / events / feed get their OWN gate later.)
//
// NON-VACUITY (CLAUDE.md rule 1/7). A refusal only means something if the same key WOULD have been served. Two
// anchors: (1) CONTROL below — the joined network key is ACCEPTED a catch-all document a stranger is refused,
// so the link is live; (2) the sabotage record in the N1 commit: re-adding `networkOf` at leaderOf() / churchReader()
// makes the write and read matrices below fail. For each document the church AND a steward must still read+write.
//
// THE RELAY is the real gateway on a throwaway data dir; spawned AFTER this file is read, so it is newer than
// scripts/gateway.mjs (RELAY-ADMISSION rule 10) — asserted explicitly below.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8874;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const P = 'trinityone/';
const church = K(), networkKey = K(), steward = K(), finSteward = K(), member = K();
const CH = [['church', church.pub]];
let relay, dataDir, spawnedAt;
let seq = 0;

const spawnRelay = () => spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
  env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), RELAY_MAX_EVENTS: '5000' },
});
async function waitUp() { for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); } throw new Error('relay did not come up'); }
const connect = (who) => new Promise((res, rej) => {
  const w = new WebSocket(WS_URL);
  w.on('open', () => { w.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && who) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); }); res(w); });
  w.on('error', rej);
});
const publish = (w, evt) => new Promise((res) => { const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); });
const read = (w, filters) => new Promise((res) => {
  const out = []; const id = 'r' + Math.random().toString(36).slice(2, 7);
  const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) setTimeout(() => { w.off('message', on); res(out); }, 200); };
  w.on('message', on); w.send(JSON.stringify(['REQ', id, ...filters])); setTimeout(() => { w.off('message', on); res(out); }, 4000);
});
const doc = (k, d, body, extra = []) => finalizeEvent({ kind: 30078, created_at: now() + (seq++), tags: [['d', d], ['t', 'trinityone'], ...extra], content: JSON.stringify(body) }, k.sk);
async function served(who, evtId) {
  const w = await connect(who); await sleep(200);
  const got = await read(w, [{ ids: [evtId], kinds: [30078] }]); w.close();
  return got.some((e) => e.id === evtId);
}
async function writes(who, evt) { const w = await connect(who); await sleep(200); const [ok] = await publish(w, evt); w.close(); return ok; }

// label, d, body, which steward may author it
const DOCS = [
  ['group',        P + 'group:g1',       { name: 'Hosts', vis: 'public' },     'content'],
  ['plan',         P + 'plan:p1',        { title: 'Harvest', draft: false },    'content'],
  ['devotional',   P + 'devotional:d1',  { title: 'Morning', draft: false },    'content'],
  ['rota',         P + 'rota:r1',        { title: 'Sunday' },                   'content'],
  ['roster',       P + 'roster:t1',      { pubs: [] },                         'content'],
  ['service',      P + 'service:s1',     { title: 'Sunday 10am' },              'content'],
  ['request',      P + 'request:q1',     { title: 'Pray' },                     'content'],
  ['room',         P + 'room:rm1',       { name: 'Hall' },                     'content'],
  ['booking',      P + 'booking:b1',     { room: 'rm1' },                      'content'],
  ['runsheet',     P + 'runsheet:s1',    { items: [] },                        'content'],
  ['category',     P + 'category:c1',    { name: 'Youth' },                    'content'],
  ['sermon',       P + 'sermon:sm1',     { title: 'Grace' },                   'content'],
  ['finance',      'finance/account:bank', { x: 1 },                           'finance'],
];
const stored = {};   // label -> church-authored event id

before(async () => {
  await requireFreePort(PORT, 'a-joined-network-key-has-no-authority-over-church-content.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-n1-'));
  relay = spawnRelay(); spawnedAt = Date.now(); await waitUp();
  const w = await connect(null), cw = await connect(church);
  const ok = async (c, e, why) => { const [k, m] = await publish(c, e); assert.equal(k, true, why + ' (' + m + ')'); return e; };
  await ok(cw, doc(church, P + 'network:' + networkKey.pub, { joined: now() }), 'church could not join the network');
  await ok(cw, doc(church, P + 'stewards:' + church.pub, { pubkeys: [steward.pub, finSteward.pub], caps: { [steward.pub]: ['content'], [finSteward.pub]: ['finance'] } }), 'steward roster refused');
  await ok(w, doc(member, P + 'member:' + church.pub, { joined: now() }, [['p', church.pub]]), 'member join refused');
  await sleep(400);
  for (const [label, d, body] of DOCS) stored[label] = (await ok(cw, doc(church, d, body, CH), 'church could not write ' + label)).id;
  w.close(); cw.close();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('FRESHNESS (rule 10): the relay under test was spawned AFTER scripts/gateway.mjs was last written', () => {
  const gw = statSync(new URL('./gateway.mjs', import.meta.url).pathname).mtimeMs;
  assert.ok(spawnedAt > gw, 'a relay older than gateway.mjs would enforce old gates against the new bundle');
});

test('CONTROL: the join really took -- the church\'s own network:<key> declaration is stored and served back to the church', async () => {
  // WALL (2026-11-18): after the isMember narrowing a declared network key can do NOTHING a stranger cannot (that is the point), so
  // there is no longer an observable write/read DIFFERENCE to anchor liveness on. What can still be shown is that the declaration the
  // church published is stored and readable, so the fixture is a real joined network. That the refusals below are not vacuous is
  // proved by SABOTAGE, one per door (re-add networkOf at the door and the matching test below fails) -- see the commit message.
  const d = P + 'network:' + networkKey.pub;
  const w = await connect(church); await sleep(200);
  const got = await read(w, [{ kinds: [30078], authors: [church.pub], '#d': [d] }]); w.close();
  assert.equal(got.length, 1, 'the church\'s join declaration was not stored -- the network link never formed, so every refusal below proves nothing');
});

for (const [label, d, body, cap] of DOCS) {
  const stw = cap === 'finance' ? finSteward : steward;
  test(`READ ${label}: the network key is REFUSED; the church and its steward are served`, async () => {
    assert.equal(await served(networkKey, stored[label]), false, `the network key READ the church's ${label}`);
    assert.equal(await served(church, stored[label]), true, `the church cannot read its own ${label} — the door is broken`);
    // the steward authors its own copy so it has something to read; reading the CHURCH'S copy is the real claim
    assert.equal(await served(stw, stored[label]), true, `a ${cap} steward cannot read the church's ${label} — the strip over-reached`);
  });
  test(`WRITE ${label}: the network key is REFUSED; the church and its steward are accepted`, async () => {
    assert.equal(await writes(networkKey, doc(networkKey, d, { ...body, forged: 1 }, CH)), false, `the network key WROTE a church ${label}`);
    assert.equal(await writes(church, doc(church, d, { ...body, again: 1 }, CH)), true, `the church can no longer write ${label} — the door is broken`);
    assert.equal(await writes(stw, doc(stw, d, { ...body, again: 2 }, CH)), true, `a ${cap} steward can no longer write ${label} — the strip over-reached`);
  });
}

test('READ: an ordinary member still reads a church plan (member access is untouched by N1)', async () => {
  // the WRITE tests above replaced the church's plan (addressable), so look the current one up
  const cw = await connect(church); await sleep(200);
  const cur = (await read(cw, [{ kinds: [30078], authors: [church.pub], '#d': [P + 'plan:p1'] }]))[0]; cw.close();
  assert.ok(cur, 'the church plan is gone');
  assert.equal(await served(member, cur.id), true, 'an ordinary member lost the plan');
});

test('WRITE: the network key cannot put a key envelope on a church room (sealed-room door)', async () => {
  const env = (k) => doc(k, P + 'groupkey:g1', { env: 'x' }, CH);
  assert.equal(await writes(networkKey, env(networkKey)), false, 'the network key published a sealed-room key envelope for a church room');
  assert.equal(await writes(church, env(church)), true, 're-anchor: the church cannot publish its own room key envelope — the door is broken');
});

test('WRITE: the network key cannot take a church group id by claiming an unowned id the church later uses (idOwnerOk)', async () => {
  // a group id that NAMES the church (ID_OWNER_RE) — only that church / a steward of it may claim it
  const gid = church.pub + '-room9';
  assert.equal(await writes(networkKey, doc(networkKey, P + 'group:' + gid, { name: 'mine' }, CH)), false, 'the network key claimed a church-named group id');
  assert.equal(await writes(church, doc(church, P + 'group:' + gid, { name: 'ours' }, CH)), true, 're-anchor: the church cannot claim its own group id');
});

// ── churchReader()'s OTHER callers: group chat, profiles, reactions, the name-key envelope ───────────────────
// churchReader()/churchWriter() are shared. The doc matrix above does not reach them: they gate kind-1 group
// chat, kind-0 member profiles, kind-5/7 reactions in a group and the sealed-names envelope. Each is asserted
// with the same three principals so deleting `networkOf`'s removal from churchReader() fails here.
const kindEvt = (k, kind, tags, content = 'hi') => finalizeEvent({ kind, created_at: now() + (seq++), tags, content }, k.sk);
async function servedAny(who, filter, id) {
  const w = await connect(who); await sleep(200);
  const got = await read(w, [filter]); w.close();
  return got.some((e) => e.id === id);
}

test('READ+WRITE group chat (kind 1): the network key is REFUSED both ways; a member and the church are not', async () => {
  // g1 was defined by the church (group: doc above). A member posts; the church posts; the network key tries.
  const mk = (k) => kindEvt(k, 1, [['t', 'g1'], ['church', church.pub]], 'hello room');
  assert.equal(await writes(networkKey, mk(networkKey)), false, 'the network key POSTED into a church room (churchWriter)');
  const m = mk(member), c = mk(church);
  assert.equal(await writes(member, m), true, 're-anchor: a member cannot post into the room — churchWriter is broken');
  assert.equal(await writes(church, c), true, 're-anchor: the church cannot post into its room');
  assert.equal(await servedAny(networkKey, { ids: [m.id] }, m.id), false, 'the network key READ a church room message (churchReader)');
  assert.equal(await servedAny(member, { ids: [m.id] }, m.id), true, 're-anchor: a member cannot read the room message — churchReader is broken');
  assert.equal(await servedAny(church, { ids: [m.id] }, m.id), true, 're-anchor: the church cannot read its room message');
});

test('READ a member profile (kind 0): the network key is REFUSED; the church and the member are served', async () => {
  const p = kindEvt(member, 0, [], JSON.stringify({ name: 'Member One' }));
  assert.equal(await writes(member, p), true, 'member could not publish a profile');
  assert.equal(await servedAny(networkKey, { ids: [p.id] }, p.id), false, 'the network key READ a church member profile (churchReader via kind-0)');
  assert.equal(await servedAny(church, { ids: [p.id] }, p.id), true, 're-anchor: the church cannot read its member profile');
  assert.equal(await servedAny(member, { ids: [p.id] }, p.id), true, 're-anchor: the member cannot read own profile');
});

test('READ the sealed-names key envelope (namekey:): the network key is REFUSED; the church is served', async () => {
  const e = doc(church, P + 'namekey:' + church.pub, { env: 'x' }, CH);
  assert.equal(await writes(church, e), true, 'church could not publish the namekey envelope');
  assert.equal(await served(networkKey, e.id), false, 'the network key READ the name-key envelope (churchReader via NAMEKEY_D)');
  assert.equal(await served(church, e.id), true, 're-anchor: the church cannot read its envelope');
});

// ── POSTING INTO A CHURCH'S RESTRICTED GROUPS, AND EVENT / PIN / HIDE (N1 audit follow-up, 2026-10-21) ────────
// The doc matrix and the open-group test above do not reach three kind-1 gates that each carried their own
// `networkOf` clause (broadcast / invite-only / team posting), nor the owner tier for event / pin / hide. A broadcast
// reaches the WHOLE congregation under the author's name, so that one is the sensitive door. For each: the
// network key is REFUSED; the church and a content steward are ACCEPTED (and a member where the gate allows one).
const groupDef = (gid, body) => doc(church, P + 'group:' + gid, body, CH);
const chatTo = (k, gid, text = 'hello') => kindEvt(k, 1, [['t', gid], ['church', church.pub]], text);
async function postingMatrix(gid, memberMayPost) {
  const net = chatTo(networkKey, gid, 'net posts');
  assert.equal(await writes(networkKey, net), false, `the network key POSTED into the church's ${gid} group`);
  assert.equal(await writes(church, chatTo(church, gid, 'church posts')), true, `re-anchor: the church cannot post into its own ${gid} group`);
  assert.equal(await writes(steward, chatTo(steward, gid, 'steward posts')), true, `re-anchor: a content steward cannot post into the ${gid} group`);
  assert.equal(await writes(member, chatTo(member, gid, 'member posts')), memberMayPost, `re-anchor: member posting into ${gid} should be ${memberMayPost}`);
}

test('WRITE a BROADCAST group (the congregation-wide voice): the network key is REFUSED; church and content steward accepted; a member is not', async () => {
  assert.equal(await writes(church, groupDef('bc1', { name: 'Announcements', kind: 'broadcast' })), true, 'church could not define the broadcast group');
  await sleep(300);
  await postingMatrix('bc1', false);
});

test('WRITE an INVITE-ONLY group: the network key is REFUSED; church, content steward and a listed member accepted', async () => {
  assert.equal(await writes(church, groupDef('inv1', { name: 'Leaders', visibility: 'invite', members: [member.pub] })), true, 'church could not define the invite-only group');
  await sleep(300);
  await postingMatrix('inv1', true);
});

test('WRITE a TEAM group: the network key is REFUSED; church, content steward and a rostered member accepted', async () => {
  assert.equal(await writes(church, groupDef('tm1', { name: 'Welcome team', kind: 'team' })), true, 'church could not define the team group');
  // a team's allowlist is the ROSTER, not the group doc: the member is listed; the network key is not, so only the
  // gate's own network clause could have let it in.
  assert.equal(await writes(church, doc(church, P + 'roster:tm1', { pubs: [member.pub] }, CH)), true, 'church could not write the team roster');
  await sleep(400);
  await postingMatrix('tm1', true);
});

test('WRITE an EVENT, a PIN and a HIDE into a church group (owner tier): the network key is REFUSED; church and content steward accepted', async () => {
  assert.equal(await writes(church, groupDef('ow1', { name: 'Open room', kind: 'group' })), true, 'church could not define the group');
  await sleep(300);
  const kinds = [
    ['event', P + 'event:evn1', { title: 'Social' }],
    ['pin', P + 'pin:ow1', { id: 'm1' }],
    ['hide', P + 'hidden:msgx1', { id: 'msgx1' }],
  ];
  for (const [label, d, body] of kinds) {
    const tags = [['t', 'ow1'], ['church', church.pub]];
    assert.equal(await writes(networkKey, doc(networkKey, d, body, tags)), false, `the network key wrote a ${label} into the church's group`);
    assert.equal(await writes(church, doc(church, d, body, tags)), true, `re-anchor: the church cannot write a ${label} into its own group`);
    assert.equal(await writes(steward, doc(steward, d, body, tags)), true, `re-anchor: a content steward cannot write a ${label} into the group`);
  }
});

// POINT OF USE (2026-11-18): a declared network key is not a member for church-tagged chat. Before the isMember narrowing it was
// ACCEPTED a kind-1 line carrying the church tag and no group, and a kind-7 reaction; a stranger was refused both.
test('a declared network key is REFUSED a church-tagged kind-1 line (no group) and a kind-7 reaction; a real member is ACCEPTED both', async () => {
  const line = (k) => kindEvt(k, 1, [['church', church.pub]], 'hi ' + Math.random());
  const react = (k) => kindEvt(k, 7, [['church', church.pub], ['e', 'a'.repeat(64)]], '+');
  const stranger = K();
  assert.equal(await writes(member, line(member)), true, 're-anchor: a real member cannot post a church-tagged line -- the door is broken');
  assert.equal(await writes(member, react(member)), true, 're-anchor: a real member cannot react -- the door is broken');
  assert.equal(await writes(networkKey, line(networkKey)), false, 'THE DECLARED NETWORK KEY POSTED A CHURCH-TAGGED CHAT LINE');
  assert.equal(await writes(networkKey, react(networkKey)), false, 'THE DECLARED NETWORK KEY SENT A REACTION');
  assert.equal(await writes(stranger, line(stranger)), false, 'a stranger posted a church-tagged line');
});

// LAST ON PURPOSE: it makes the network key a MEMBER of the church, which would change every read above it.
test('the narrowing did not close the human-admission doors: a declared network key can still join (member:) and request stewardship (stewardreq:) like any other key', async () => {
  // c5406d72 is NOT ported (it patches the N5a _pureNet guard, which this branch does not have). This is the proof that nothing
  // was taken from those two doors: the same writes by a stranger and by the declared key both land.
  const stranger = K();
  for (const k of [stranger, networkKey]) {
    assert.equal(await writes(k, doc(k, P + 'member:' + church.pub, { joined: now() }, [['p', church.pub]])), true, 'member: join refused for ' + (k === networkKey ? 'the network key' : 'a stranger'));
    assert.equal(await writes(k, doc(k, P + 'stewardreq:' + k.pub, { note: 'x' }, CH)), true, 'stewardreq: refused for ' + (k === networkKey ? 'the network key' : 'a stranger'));
  }
});
