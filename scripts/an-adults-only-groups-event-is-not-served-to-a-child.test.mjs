// AN ADULTS-ONLY GROUP'S EVENT IS NOT SERVED TO A CHILD.
//   Run: node --test scripts/an-adults-only-groups-event-is-not-served-to-a-child.test.mjs
//
// What a young person experiences without this. Mia, 15, opens the app. Her Today card and her calendar
// carry "Marriage counselling supper — Thursday 7:30pm, The vicarage". THE TITLE AND THE PLACE ARE THE
// DISCLOSURE, and they are strictly worse than the room name the sibling gate closed on 2026-08-31: a room
// name says a subject exists in her church, an event says it is happening on Thursday and names the house.
//
// MEASURED AGAINST A REAL GATEWAY on this branch, 2026-09-01: an event document tagged to a group with
// `childsafe` absent was served to a MINOR member of the church with its content readable —
// {"title":"Marriage counselling supper","where":"The vicarage"} — byte-identical to what the adult member
// received. canRead carries nine minorOf/GROUP_CHILDSAFE checks and had none for EVENT_D, so an event fell
// straight through to the ordinary effective-member rule.
//
// THE SIBLING IS FIFTEEN LINES ABOVE THE GAP. canRead's GROUP_D branch withholds an adults-only room's
// DEFINITION from a minor (3bbfc23). The calendar never got the same treatment, and events are the second
// half of the same disclosure: hiding the room while putting its evening on her calendar moves the leak.
//
// HOW AN EVENT NAMES ITS GROUP, because the gate stands or falls on it: the non-NET `t` tag — what
// eventGroup() reads, and what both writers set (src/steward.src.js publishEvent pushes ['t', groupId] when
// the console scopes an event to a group; src/fellowship.src.js publishGroupEvent does the same for a leader
// posting from the member app). The sealed content ALSO carries `groupId`, but that is under the church name
// key and the relay cannot read it. The TOMBSTONE that cancels an event carries no `t` tag at all — which is
// exactly why the notification work that landed yesterday had to record EVENT_AUDIENCE at ingest — so a
// tombstone reaching this gate has no group and is deliberately not gated: it is an empty document saying
// only "the thing at this id is gone", which every reader needs in order to drop a stale card.
//
// AND WHAT MUST NOT BREAK, which is most of this file:
//   · a WHOLE-CHURCH event — Sunday service, the carol service — must still reach her. It carries no group
//     tag at all, and over-gating would take the church's own calendar off every young person's phone;
//   · a CHILD-SAFE group's event must still reach her. The youth-group bowling night is the entire point of
//     a group calendar for a young person, and a church may deliberately run no children's rooms at all
//     (reference/DOMAIN.md), so an empty calendar for the wrong reason is a silent blank screen;
//   · every ordinary ADULT member must still see everything. This gate sits on the path that draws the whole
//     congregation's calendar;
//   · the church and its stewards must still see everything, or the console cannot explain what she sees;
//   · a CO-TENANT church that names her a child must not be able to blank her own church's calendar.
//     `minors:<churchpub>` is owner-written with no membership test, so a church may name any pubkey on the
//     box (see scripts/one-church-cannot-call-anothers-member-a-child.test.mjs, which found exactly this
//     shape untested on the room gate).
//
// Two churches, five people, a real scripts/gateway.mjs on its own port and data directory, real
// WebSockets, real NIP-42 auth. No stubs, and no mirror of the rule. The model for the setup and the helpers
// is scripts/an-adults-only-rooms-name-is-not-served-to-a-child.test.mjs.
//
// Content is published as plain JSON rather than sealed. The relay serves bytes and never reads them, and in
// the field every member holds the church name key, so "sealed" is not a boundary between members — reading
// the title here is exactly what a member's app does after decrypting.
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

const PORT = 8817;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', EVENT_D = 'trinityone/event:';
const MINORS_D = 'trinityone/minors:', STEWARDS_D = 'trinityone/stewards:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace   = K();   // church A — Mia's, Ann's and Sam's church
const stmarks = K();   // church B — a co-tenant on the same relay. Nobody here has joined it.
const ap = grace.pub, bp = stmarks.pub;

const mia = K();   // 15. Church A marks her a child.
const ann = K();   // an ordinary ADULT member of church A. The common case; must not break.
const sam = K();   // a steward of church A holding the content capability.
const ben = K();   // an adult member of church B only — proof B really is provisioned.

// Group ids in the field are `<churchpub first 16 hex>-<base36 tail>` (src/steward.src.js), and that prefix
// is what idNamesOwner() reads. Mint them the same way so the fallback chain is exercised on the real format.
const gid = (cp, tail) => cp.slice(0, 16) + '-' + tail;
const A_MARRIAGE = gid(ap, 'marriage');   // church A, adults-only (childsafe absent — the default)
const A_YOUTH    = gid(ap, 'youth');      // church A, child-safe
// A group this relay holds NO definition for, whose id names nobody. GROUP_CHURCH is populated only from a
// stored group definition, so nothing but the event doc's own owning church can say who governs it.
const A_ORPHAN   = 'homegroupthursday';

const EV_ADULT = 'evtmarriage', EV_SAFE = 'evtyouth', EV_CHURCH = 'evtcarols', EV_ORPHAN = 'evthome';
const EV_GONE = 'evtcancelled';

let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = [], at = 0) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', d], ['t', NET], ...tags], content: JSON.stringify(content) }, who.sk);
const memberDoc = (who, cp) => doc(who, MEMBER_D + cp, { joined: now() });
// Exactly the shape src/steward.src.js publishes: `childsafe: true` when the church has marked the room, and
// the key ABSENT otherwise — absent is what adults-only looks like on the wire, and it is the default.
const groupDoc = (church, id, name, extra = {}) => doc(church, GROUP_D + id, { name, kind: extra.kind || 'open', ...extra });
// An event exactly as publishEvent shapes it: the id in the d-tag, and ['t', groupId] only when the console
// scoped it to a group. No group tag = the whole church's event.
const eventDoc = (church, id, body, groupId, at = 0) => doc(church, EVENT_D + id, body, groupId ? [['t', groupId]] : [], at);
// removeEvent(): a tombstone over the same d-tag, carrying no group tag and no content.
const tombstone = (church, id) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', EVENT_D + id], ['t', NET], ['deleted', '1']], content: '' }, church.sk);

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

// WHAT IS ON THIS PERSON'S CALENDAR? Asked the way subscribeChurchEvents asks it — a REQ over the event
// d-tags — and reduced to the TITLES the relay hands back, because the title and the place are the
// disclosure. Returns a Map(title -> where) so a test can say what was actually readable, not merely that
// something arrived.
let _sub = 0;
const ALL_EVENTS = [EV_ADULT, EV_SAFE, EV_CHURCH, EV_ORPHAN];
async function calendarOf(who, ids = ALL_EVENTS) {
  const ws = await connect();
  const evs = await reqCollect(ws, 'ev' + (++_sub), { kinds: [30078], '#d': ids.map(i => EVENT_D + i) }, who && who.sk);
  ws.close();
  const out = new Map();
  for (const e of evs) { try { const c = JSON.parse(e.content || '{}'); if (c.title) out.set(c.title, c.where || ''); } catch {} }
  return out;
}

before(async () => {
  await requireFreePort(PORT, 'an-adults-only-groups-event-is-not-served-to-a-child.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-evtsafe-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir,
             CHURCH_NPUB: npubEncode(ap) + ',' + npubEncode(bp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [mia, ann, sam]) assert.equal((await publish(pub, memberDoc(who, ap)))[0], true, 'joined church A');
  assert.equal((await publish(pub, memberDoc(ben, bp)))[0], true, 'Ben joins church B');
  assert.equal((await publish(pub, doc(grace, STEWARDS_D + ap, { pubkeys: [sam.pub], caps: { [sam.pub]: ['content'] } })))[0], true, 'steward roster');
  await sleep(150);
  assert.equal((await publish(pub, groupDoc(grace, A_MARRIAGE, 'Marriage counselling')))[0], true, 'adults-only room');
  assert.equal((await publish(pub, groupDoc(grace, A_YOUTH, 'Youth group', { childsafe: true })))[0], true, 'child-safe room');
  await sleep(200);
  assert.equal((await publish(pub, eventDoc(grace, EV_ADULT, { date: '2026-09-10', time: '19:30', title: 'Marriage counselling supper', where: 'The vicarage' }, A_MARRIAGE)))[0], true, 'adults-only event');
  assert.equal((await publish(pub, eventDoc(grace, EV_SAFE, { date: '2026-09-12', time: '18:00', title: 'Youth group bowling', where: 'Rollerworld' }, A_YOUTH)))[0], true, 'child-safe event');
  assert.equal((await publish(pub, eventDoc(grace, EV_CHURCH, { date: '2026-12-24', time: '18:00', title: 'Carol service', where: 'The church' })))[0], true, 'whole-church event');
  assert.equal((await publish(pub, eventDoc(grace, EV_ORPHAN, { date: '2026-09-11', time: '20:00', title: 'Thursday home group', where: '14 Mill Lane' }, A_ORPHAN)))[0], true, 'event in a group this relay has no definition for');
  await sleep(200);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: before anyone marks her, Mia is served every event — the premise, not the fix', async () => {
  const cal = await calendarOf(mia);
  assert.equal(cal.get('Marriage counselling supper'), 'The vicarage',
    're-anchor: she was not being served the adults-only event anyway, so nothing below is a real test');
  assert.equal(cal.has('Youth group bowling'), true, 're-anchor: the ordinary group calendar is not working at all');
  assert.equal(cal.has('Carol service'), true, 're-anchor: the whole-church calendar is not working at all');
  assert.equal(cal.has('Thursday home group'), true, 're-anchor: the unknown-group event was not being served anyway');
});

test('the church marks Mia as a child; a CO-TENANT church marks Ann as one', async () => {
  assert.equal((await publish(pub, doc(grace, MINORS_D + ap, { pubkeys: [mia.pub] })))[0], true, 'A’s minors list');
  // Church B has never met Ann. `minors:<churchpub>` has no membership test, so B may name her — and B's
  // judgement about a member of A must reach nothing.
  assert.equal((await publish(pub, doc(stmarks, MINORS_D + bp, { pubkeys: [ann.pub] })))[0], true, 'B’s minors list');
  await sleep(300);
});

test('A YOUNG PERSON IS NOT SERVED AN ADULTS-ONLY GROUP’S EVENT', async () => {
  const cal = await calendarOf(mia);
  assert.equal(cal.has('Marriage counselling supper'), false,
    'an adults-only group’s event was served to a child — title and place, on her calendar');
  // THE PAIR, measured in one place: the same document, withheld from her and served to the adult beside
  // her. Without this the line above would also pass on a relay that had simply lost the event.
  assert.equal((await calendarOf(ann)).get('Marriage counselling supper'), 'The vicarage',
    're-anchor: the event reached nobody, so the withholding above proves nothing');
});

test('…and the whole-church event still reaches her: no group tag means the whole church, children included', async () => {
  const cal = await calendarOf(mia);
  assert.equal(cal.get('Carol service'), 'The church',
    'the church’s own calendar was taken off a young person’s phone — over-gated, and a silent blank screen');
});

test('…and a CHILD-SAFE group’s event still reaches her, which is the point of her having a calendar', async () => {
  const cal = await calendarOf(mia);
  assert.equal(cal.get('Youth group bowling'), 'Rollerworld',
    'the child-safe group’s event stopped being served — the gate is backwards, which is worse than the leak');
});

// THE FALLBACK CHAIN, and the reason it is not just GROUP_CHURCH. GROUP_CHURCH is populated only from a
// stored group DEFINITION; this relay holds the event but no definition for its group, and the id names no
// church either, so `GROUP_CHURCH.get(gid) || idNamesOwner(gid)` both come back empty. Only `|| cp` — the
// event document's own owning church, already resolved above the gate — can say who governs it. An unknown
// group is never marked child-safe, so the safe answer is to withhold it; maybePushCancel resolves the same
// question about the same document with the same three steps.
test('an event in a group this relay holds no definition for is withheld too — the fallback, not luck', async () => {
  const cal = await calendarOf(mia);
  assert.equal(cal.has('Thursday home group'), false,
    'an event whose group this relay cannot resolve was served to a child on the strength of not knowing');
  assert.equal((await calendarOf(ann)).get('Thursday home group'), '14 Mill Lane',
    're-anchor: the event is missing for everyone, so the line above proves nothing');
});

test('AN ORDINARY ADULT MEMBER STILL SEES EVERY EVENT — the common case, and most of the traffic', async () => {
  const cal = await calendarOf(ann);
  for (const t of ['Marriage counselling supper', 'Youth group bowling', 'Carol service', 'Thursday home group'])
    assert.equal(cal.has(t), true, `an adult lost "${t}"`);
});

// THE CO-TENANT CLAIM, which is the half that stayed untested on the room gate for a day (61a019d). Ann is
// an adult of church A and has never joined church B; B has published a minors: list naming her. If the gate
// asked the relay-wide MINORS union instead of minorOf(authed, thisGroupsChurch), her own church's calendar
// would empty and nothing would tell her or her church.
test('a CO-TENANT church calling her a child cannot blank her own church’s calendar', async () => {
  const cal = await calendarOf(ann);
  assert.equal(cal.get('Marriage counselling supper'), 'The vicarage',
    'a church Ann has never joined blanked her own church’s adults-only event by calling her a child');
  assert.equal(cal.get('Thursday home group'), '14 Mill Lane',
    'the co-tenant’s judgement reached the unresolvable-group path too');
});

test('the church and its steward still see every event, so the console can explain what she sees', async () => {
  for (const [who, label] of [[grace, 'the church key'], [sam, 'a steward']]) {
    const cal = await calendarOf(who);
    for (const t of ['Marriage counselling supper', 'Youth group bowling', 'Carol service', 'Thursday home group'])
      assert.equal(cal.has(t), true, `${label} lost "${t}"`);
  }
});

// A TOMBSTONE CARRIES NO GROUP TAG — that is why EVENT_AUDIENCE had to be recorded at ingest for the cancel
// notification. So it cannot be gated by group and deliberately is not: it is an empty document saying only
// "the thing at this id is gone", and a young person whose app is holding a stale card needs it in order to
// drop the card. Asserted so that changing it has to be deliberate.
test('the tombstone that cancels an event still reaches a young person, so her stale card disappears', async () => {
  // Dated a minute back on purpose. kind-30078 is replaceable and the relay compares created_at in WHOLE
  // SECONDS, so a tombstone published in the same second as its event is refused as "a newer version of this
  // is already stored" — measured here. removeEvent() in the field is a human pressing Remove, never that fast.
  assert.equal((await publish(pub, eventDoc(grace, EV_GONE, { date: '2026-09-20', time: '10:00', title: 'Parish walk', where: 'The green' }, A_MARRIAGE, now() - 60)))[0], true, 'an event to cancel');
  await sleep(200);
  const _t = await publish(pub, tombstone(grace, EV_GONE)); assert.equal(_t[0], true, 'the cancellation was refused, so this test never reaches its point: ' + JSON.stringify(_t));
  await sleep(250);
  const ws = await connect();
  const evs = await reqCollect(ws, 'tomb', { kinds: [30078], '#d': [EVENT_D + EV_GONE] }, mia.sk);
  ws.close();
  assert.equal(evs.length >= 1, true, 'the cancellation never reached the child — her calendar keeps a card for an event that is not happening');
  assert.equal(evs.every(e => !e.content), true, 'the cancellation carried content, so this asserts nothing about a tombstone');
});

test('a member of the OTHER church is served none of church A’s calendar — the per-church gate is alive', async () => {
  const cal = await calendarOf(ben);
  assert.equal(cal.size, 0, 'a member of a church that published none of these events was served them');
});

test('an anonymous reader is served no event at all — unchanged, and worth keeping true', async () => {
  const cal = await calendarOf(null);
  assert.equal(cal.size, 0, 'a stranger was handed the congregation’s calendar');
});
