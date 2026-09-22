// A CHURCH'S PUBLIC CALENDAR IS SERVED ONLY WHEN THE CHURCH ASKED, AND ONLY THE EVENTS IT DID NOT WITHHOLD.
//   Run: node --test scripts/a-churchs-public-calendar-is-served-only-when-asked.test.mjs
//
// reference/DESIGN-embeddable-church-info.md, phase 1. A church wants its calendar on the website it already
// has. The relay now answers `GET /public/<npub>/calendar.ics` (and `/e/<id>.ics` for one event) with an
// iCalendar file — with no authentication, which is the first time this relay serves anything about a church
// to a stranger beyond its name and its relay list. So the whole of this file is about the NO: nothing is served
// unless the church's own `share:` document says calendar:true, nothing opted out is served anywhere, no other
// document type is reachable through the route, and the WebSocket read gate is untouched by all of it.
//
// THE HINGE THE DESIGN GOT WRONG, checked here rather than assumed: `event:` documents are SEALED under the
// church name key (src/steward.src.js publishEvent → _sealChurchDocReady), so this relay cannot read them and
// cannot build a feed from them. The console therefore writes a PLAINTEXT `pubevent:<id>` copy carrying only
// the noticeboard fields, and that copy is what the route serves. An `event:` with no copy is never served —
// the "secret" event below proves it.
//
// A real scripts/gateway.mjs on its own port and data directory, real WebSockets, real NIP-42 auth, a real
// HTTP fetch of the feed and a real (small) iCalendar parser. No mirror of any rule.
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
import { D, ALL_PREFIXES } from './trinity-doc-types.mjs';

const PORT = 8850;   // unique across scripts/*.test.mjs and scripts/*.probe.mjs (8850-8855 were free on 2026-09-22)
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = D.MEMBER, EVENT_D = D.EVENT, SHARE_D = D.SHARE, PUBEVENT_D = D.PUBEVENT;
const now = () => Math.floor(Date.now() / 1000);
// Strictly increasing, as the console's _monotonic() guarantees: an addressable document keeps ONE copy per
// (author, d) and a rewrite in the same second is not newer, so a test that rewrites share: twice in 200ms
// would be refused for a reason that is nothing to do with the rule under test.
let _tick = now();
const next = () => (_tick = Math.max(_tick + 1, now()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K();     // the church whose calendar this is
const stmarks = K();   // a co-tenant church on the same relay
const ann = K();       // an ordinary member of Grace
const nobody = K();    // a key that has joined nothing
const ap = grace.pub, bp = stmarks.pub;
const NPUB = npubEncode(ap), NPUB_B = npubEncode(bp), NPUB_UNKNOWN = npubEncode(K().pub);

// Three events, as the console would copy them: a timed one-off, an all-day one-off, and a weekly meeting.
// EV_HELD is the one the church ticks "Not on the website". EV_SECRET has an event: document and NO copy.
const EV_SUPPER = 'evtsupper', EV_HELD = 'evtheld', EV_FAIR = 'evtfair', EV_SUNDAY = 'evtsunday', EV_SECRET = 'evtsecret';
const COPY = {
  [EV_SUPPER]: { title: 'Harvest supper, all welcome', date: '2026-10-03', time: '19:30', where: 'The church hall', blurb: 'Bring a dish; drinks provided.' },
  [EV_HELD]:   { title: 'Safeguarding review',        date: '2026-10-05', time: '10:00', where: 'The vestry',      blurb: '' },
  [EV_FAIR]:   { title: 'Christmas fair',              date: '2026-12-05', time: '',      where: 'The green',       blurb: 'Stalls, mulled wine, carols at 4' },
  [EV_SUNDAY]: { title: 'Sunday service',              date: '2026-09-06', time: '10:30', where: 'The church',      blurb: '', recur: 'weekly', day: 0 },
};

let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${HTTP}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
function startRelay() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: NPUB + ',' + NPUB_B, RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' },
      stdio: 'ignore' });
  return waitReady();
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = [], at = 0) => finalizeEvent({ kind: 30078, created_at: at || next(), tags: [['d', d], ['t', NET], ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const tomb = (who, d) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', d], ['t', NET], ['deleted', '1']], content: '' }, who.sk);
const shareDoc = (who, cp, body) => doc(who, SHARE_D + cp, body);
const copyDoc = (who, id, body) => doc(who, PUBEVENT_D + id, body);

// The relay's REQ, with or without NIP-42 auth, reduced to the events it handed back.
let _sub = 0;
function reqCollect(ws, filter, authSk, window = 700) {
  const subId = 'q' + (++_sub);
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}
async function readAs(who, filter) { const ws = await connect(); const evs = await reqCollect(ws, filter, who && who.sk); ws.close(); return evs; }

// ── a tiny iCalendar reader: unfold, split into VEVENT blocks, read each property ─────────────────────────
function parseIcs(text) {
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'), 'not an iCalendar file: ' + JSON.stringify(text.slice(0, 40)));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'), 'the file does not end with END:VCALENDAR');
  const lines = text.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);   // RFC 5545 §3.1 unfolding
  const cal = { props: {}, events: [] };
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { cal.events.push(cur); cur = null; continue; }
    const i = line.indexOf(':'); assert.ok(i > 0, 'a content line with no ":" — ' + line);
    const name = line.slice(0, i).split(';')[0], value = line.slice(i + 1);
    (cur || cal.props)[name] = value;
  }
  assert.equal(cur, null, 'a VEVENT was never closed');
  return cal;
}
const unescape = (s) => String(s).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

const get = (path) => fetch(HTTP + path, { redirect: 'manual' });

before(async () => {
  await requireFreePort(PORT, 'a-churchs-public-calendar-is-served-only-when-asked.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-pubcal-'));
  await startRelay();
  pub = await connect();
  assert.equal((await publish(pub, doc(ann, MEMBER_D + ap, { joined: now() })))[0], true, 'Ann joins Grace');
  // the church's name, as the console publishes it — the feed is named after the church
  assert.equal((await publish(pub, finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'Grace Church, Milltown' }) }, grace.sk)))[0], true, 'church profile');
  // the SEALED event documents, as the console writes them: ciphertext the relay cannot read
  for (const id of [EV_SUPPER, EV_HELD, EV_FAIR, EV_SUNDAY, EV_SECRET]) {
    assert.equal((await publish(pub, doc(grace, EVENT_D + id, { e: 'AtWvI3sealed' + id })))[0], true, 'sealed event ' + id);
  }
  await sleep(200);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: with no share: document the feed is a 404, and so is every malformed or unknown address', async () => {
  assert.equal((await get(`/public/${NPUB}/calendar.ics`)).status, 404, 'a church that never switched sharing on has a feed');
  assert.equal((await get(`/public/${NPUB}/e/${EV_SUPPER}.ics`)).status, 404);
  assert.equal((await get(`/public/${NPUB_UNKNOWN}/calendar.ics`)).status, 404, 'a church this relay does not hold has a feed');
  assert.equal((await get(`/public/${ap}/calendar.ics`)).status, 404, 'a hex pubkey is not an address; only the npub form is');
  assert.equal((await get(`/public/`)).status, 404);
  assert.equal((await get(`/public`)).status, 404);
  assert.equal((await get(`/public/${NPUB}`)).status, 404);
  assert.equal((await get(`/public/${NPUB}/calendar.ics/..%2F..%2Fstatus`)).status, 404);
});

test('nobody but the church key may write share: for that church, and nobody but a church may write a public copy', async () => {
  const rows = [
    ['a member of the church',        () => shareDoc(ann, ap, { calendar: true })],
    ['a key that joined nothing',     () => shareDoc(nobody, ap, { calendar: true })],
    ['a co-tenant church, for Grace', () => shareDoc(stmarks, ap, { calendar: true })],
    ['the church itself, for someone else\'s d-tag', () => shareDoc(grace, bp, { calendar: true })],
    ['a member writing a public copy', () => copyDoc(ann, EV_SUPPER, COPY[EV_SUPPER])],
    ['a stranger writing a public copy', () => copyDoc(nobody, EV_SUPPER, COPY[EV_SUPPER])],
  ];
  for (const [who, mk] of rows) {
    const [ok, why] = await publish(pub, mk());
    assert.equal(ok, false, `${who} was allowed to write it (${why})`);
  }
  // …and the co-tenant church CAN write its own copies and its own switches — keyed by author, so they can
  // never appear on Grace's feed. Proved at the end of the file, once Grace's feed is on.
  assert.equal((await publish(pub, shareDoc(stmarks, bp, { calendar: true })))[0], true, 'St Mark\'s own switch');
  assert.equal((await publish(pub, copyDoc(stmarks, 'evtbazaar', { title: 'St Mark\'s bazaar', date: '2026-11-01', time: '14:00', where: 'St Mark\'s hall', blurb: '' })))[0], true, 'St Mark\'s own copy');
  await sleep(150);
  assert.equal((await get(`/public/${NPUB}/calendar.ics`)).status, 404, 'a forged or co-tenant document switched Grace\'s feed on');
});

test('the church writes its public copies and switches the calendar on — the feed appears, without the held event', async () => {
  for (const id of Object.keys(COPY)) assert.equal((await publish(pub, copyDoc(grace, id, COPY[id])))[0], true, 'copy ' + id);
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, sermons: false, plans: false, optOut: [EV_HELD], address: 'own' })))[0], true, 'the switch');
  await sleep(200);
  const r = await get(`/public/${NPUB}/calendar.ics`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/, 'no strict CSP on the served file');
  assert.equal(r.headers.get('set-cookie'), null, 'a cookie was set on a public feed');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const text = await r.text();
  const cal = parseIcs(text);
  assert.equal(cal.props['VERSION'], '2.0');
  assert.equal(unescape(cal.props['X-WR-CALNAME']), 'Grace Church, Milltown', 'the feed is not named after the church');
  const byUid = new Map(cal.events.map(e => [e.UID, e]));
  assert.deepEqual([...byUid.keys()].sort(), [EV_SUNDAY, EV_SUPPER, EV_FAIR].map(id => `trinityone-${id}@${NPUB}`).sort(),
    'the feed does not hold exactly the three public events. The held one must be absent and the secret one — which has an event: document but no public copy — must be absent');
  const supper = byUid.get(`trinityone-${EV_SUPPER}@${NPUB}`);
  assert.equal(unescape(supper.SUMMARY), 'Harvest supper, all welcome');
  assert.equal(supper.DTSTART, '20261003T193000', 'a timed event is a floating local date-time');
  assert.equal(unescape(supper.LOCATION), 'The church hall');
  assert.equal(unescape(supper.DESCRIPTION), 'Bring a dish; drinks provided.');
  assert.match(supper.DTSTAMP, /^\d{8}T\d{6}Z$/);
  const fair = byUid.get(`trinityone-${EV_FAIR}@${NPUB}`);
  assert.equal(fair.DTSTART, '20261205', 'an event with no time is an all-day event');
  const sunday = byUid.get(`trinityone-${EV_SUNDAY}@${NPUB}`);
  assert.equal(sunday.DTSTART, '20260906T103000', 'a weekly meeting starts on its anchor date');
  assert.equal(sunday.RRULE, 'FREQ=WEEKLY;BYDAY=SU', 'a weekly meeting carries its repeat rule');
  // the whole file, byte by byte: nothing that could name a machine or a person
  assert.equal(/\b(https?|wss?):\/\//.test(text), false, 'the feed carries a URL: ' + (text.match(/\b(https?|wss?):\/\/\S+/) || [])[0]);
  assert.equal(text.includes('127.0.0.1') || text.includes(String(PORT)), false, 'the feed names the relay');
  assert.equal(text.includes('ATTENDEE') || text.includes('ORGANIZER'), false, 'the feed names a person');
  // The church's OWN npub is in every UID (trinityone-<id>@<npub>) — it is the address just dialled, so it
  // reveals nothing new. What must never appear is a member's key, or the church's key in any other form.
  assert.equal(text.includes(ann.pub) || text.includes(ap), false, 'the feed carries a hex pubkey');
  assert.equal(text.includes('Safeguarding review') || text.includes('vestry'), false, 'THE HELD EVENT LEAKED into the feed');
  assert.equal(text.includes(EV_SECRET), false, 'an event with no public copy reached the feed');
});

test('each public event has its own address; the held one and the uncopied one do not', async () => {
  const r = await get(`/public/${NPUB}/e/${EV_SUPPER}.ics`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/calendar; charset=utf-8');
  const cal = parseIcs(await r.text());
  assert.equal(cal.events.length, 1, 'the per-event file holds more than one event');
  assert.equal(cal.events[0].UID, `trinityone-${EV_SUPPER}@${NPUB}`);
  assert.equal(unescape(cal.props['X-WR-CALNAME']), 'Grace Church, Milltown');
  assert.equal((await get(`/public/${NPUB}/e/${EV_HELD}.ics`)).status, 404, 'THE HELD EVENT IS SERVED at its own address');
  assert.equal((await get(`/public/${NPUB}/e/${EV_SECRET}.ics`)).status, 404, 'an event: with no public copy is served at its own address');
  assert.equal((await get(`/public/${NPUB}/e/evtnever.ics`)).status, 404);
  assert.equal((await get(`/public/${NPUB}/e/${EV_SUPPER}`)).status, 404, 'only the .ics form is an address');
  const head = await fetch(`${HTTP}/public/${NPUB}/calendar.ics`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-type'), 'text/calendar; charset=utf-8');
  const post = await fetch(`${HTTP}/public/${NPUB}/calendar.ics`, { method: 'POST', body: 'x' });
  assert.equal(post.status, 405, 'a POST to the feed was not refused');
});

test('opting an event out AFTER it is public removes it from the feed and from its own address; opting it back in restores both', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, optOut: [EV_HELD, EV_SUPPER], address: 'own' })))[0], true);
  await sleep(200);
  let cal = parseIcs(await (await get(`/public/${NPUB}/calendar.ics`)).text());
  assert.deepEqual(cal.events.map(e => e.UID).sort(), [EV_SUNDAY, EV_FAIR].map(id => `trinityone-${id}@${NPUB}`).sort(), 'the newly held event is still in the feed');
  assert.equal((await get(`/public/${NPUB}/e/${EV_SUPPER}.ics`)).status, 404, 'the newly held event is still at its own address');
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, optOut: [EV_HELD], address: 'own' })))[0], true);
  await sleep(200);
  cal = parseIcs(await (await get(`/public/${NPUB}/calendar.ics`)).text());
  assert.equal(cal.events.length, 3, 'the event opted back in did not return');
  assert.equal((await get(`/public/${NPUB}/e/${EV_SUPPER}.ics`)).status, 200);
});

test('a tombstoned public copy leaves the feed at once — the console tombstones on delete', async () => {
  assert.equal((await publish(pub, tomb(grace, PUBEVENT_D + EV_FAIR)))[0], true);
  await sleep(200);
  const cal = parseIcs(await (await get(`/public/${NPUB}/calendar.ics`)).text());
  assert.deepEqual(cal.events.map(e => e.UID).sort(), [EV_SUNDAY, EV_SUPPER].map(id => `trinityone-${id}@${NPUB}`).sort());
  assert.equal((await get(`/public/${NPUB}/e/${EV_FAIR}.ics`)).status, 404);
});

test('cancelling the EVENT itself takes its copy off the feed at once — the relay does not wait for a console to tombstone the copy', async () => {
  // Audit of a8d69f8, finding 3: a delegate's delete, or an owner console closed before its reconciler fired,
  // left the event on the church's website until an owner console next opened. Now the event's own tombstone
  // drops the copy on ingest — the CHURCH's, or a content steward's. A member's tombstone with no group tag is
  // refused at the door (this row); one carrying a group tag is ADMITTED by the pre-existing leader/'everyone'
  // rule and must still count for nothing on the feed — that is
  // only-the-church-or-its-content-steward-takes-an-event-off-the-website.test.mjs (audit of 02b6cf3, F1).
  assert.equal((await publish(pub, copyDoc(grace, EV_FAIR, COPY[EV_FAIR])))[0], true, 're-anchor: the fair\'s copy could not be put back');
  await sleep(150);
  assert.equal((await get(`/public/${NPUB}/e/${EV_FAIR}.ics`)).status, 200, 're-anchor: the fair is not on the feed to begin with');
  assert.equal((await publish(pub, tomb(ann, EVENT_D + EV_FAIR)))[0], false, 'a MEMBER\'s tombstone of the event was accepted');
  assert.equal((await get(`/public/${NPUB}/e/${EV_FAIR}.ics`)).status, 200, 'a member\'s forged tombstone took the event off the website');
  assert.equal((await publish(pub, tomb(grace, EVENT_D + EV_FAIR)))[0], true, 'the church\'s own tombstone of the event was refused');
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/e/${EV_FAIR}.ics`)).status, 404, 'THE EVENT IS CANCELLED AND ITS COPY IS STILL SERVED at its own address');
  const cal = parseIcs(await (await get(`/public/${NPUB}/calendar.ics`)).text());
  assert.equal(cal.events.some(e => e.UID === `trinityone-${EV_FAIR}@${NPUB}`), false, 'the cancelled event is still in the feed');
});

test('a co-tenant church\'s copies never appear on Grace\'s feed, and Grace\'s never on theirs', async () => {
  const a = await (await get(`/public/${NPUB}/calendar.ics`)).text();
  assert.equal(a.includes('bazaar'), false, 'St Mark\'s event is on Grace\'s feed');
  const b = await (await get(`/public/${NPUB_B}/calendar.ics`)).text();
  assert.equal(b.includes('bazaar'), true, 're-anchor: St Mark\'s own feed does not carry its own event');
  assert.equal(b.includes('Harvest') || b.includes('Sunday service'), false, 'Grace\'s events are on St Mark\'s feed');
});

test('THE WEBSOCKET READ GATE IS UNCHANGED: an anonymous REQ for event:, share: or pubevent: gets nothing; a member still reads the church\'s documents', async () => {
  // MEASURED at 3a8c980 (before this branch) with the same probe: an anonymous REQ for event: returned 0 and a
  // member's returned every event. share:/pubevent: did not exist, so 0 for anyone is "unchanged".
  const ids = [EV_SUPPER, EV_HELD, EV_SUNDAY];
  const anon = {
    event: await readAs(null, { kinds: [30078], '#d': ids.map(i => EVENT_D + i) }),
    share: await readAs(null, { kinds: [30078], '#d': [SHARE_D + ap] }),
    pubevent: await readAs(null, { kinds: [30078], '#d': ids.map(i => PUBEVENT_D + i) }),
  };
  assert.deepEqual({ event: anon.event.length, share: anon.share.length, pubevent: anon.pubevent.length }, { event: 0, share: 0, pubevent: 0 },
    'an anonymous WebSocket client was served a church document. The HTTP feed is the ONLY public read, and only while switched on');
  const stranger = {
    share: await readAs(nobody, { kinds: [30078], '#d': [SHARE_D + ap] }),
    pubevent: await readAs(nobody, { kinds: [30078], '#d': ids.map(i => PUBEVENT_D + i) }),
  };
  assert.deepEqual({ share: stranger.share.length, pubevent: stranger.pubevent.length }, { share: 0, pubevent: 0 }, 'an authenticated non-member was served a church document');
  const member = await readAs(ann, { kinds: [30078], '#d': ids.map(i => EVENT_D + i) });
  assert.equal(member.length, 3, 're-anchor: a member no longer reads the church\'s sealed events — the ordinary calendar is broken');
});

test('every other document type is a 404 on the public route, switches on', async () => {
  // The route can only ever serve what the pubevent: map holds, but the claim is worth measuring as the design
  // asks: every declared prefix, spelt as a per-event id and as a file, with the calendar switched on.
  assert.ok(ALL_PREFIXES.length > 60, 're-anchor: the registry shrank to ' + ALL_PREFIXES.length);
  for (const p of ALL_PREFIXES) {
    const bare = p.replace(/^trinityone\//, '').replace(/:$/, '');
    for (const path of [`/public/${NPUB}/${bare}.ics`, `/public/${NPUB}/e/${bare}.ics`, `/public/${NPUB}/${encodeURIComponent(p)}${ap}`, `/public/${NPUB}/e/${bare}${ap}.ics`]) {
      assert.equal((await get(path)).status, 404, path + ' was served');
    }
  }
  // the one that matters most: an event: document is never served by its own id unless a public copy exists
  assert.equal((await get(`/public/${NPUB}/e/${EV_SECRET}.ics`)).status, 404);
});

test('the switches survive a restart — the relay rebuilds them from its store, under the same author-only rule', async () => {
  try { pub.close(); } catch {}
  relay.kill('SIGKILL'); await sleep(400);
  await startRelay();
  pub = await connect();
  const r = await get(`/public/${NPUB}/calendar.ics`);
  assert.equal(r.status, 200, 'after a restart the feed is gone — hydrateMaps() does not rebuild SHARE_BY/PUBEVENTS');
  const cal = parseIcs(await r.text());
  assert.deepEqual(cal.events.map(e => e.UID).sort(), [EV_SUNDAY, EV_SUPPER].map(id => `trinityone-${id}@${NPUB}`).sort());
  assert.equal((await get(`/public/${NPUB}/e/${EV_HELD}.ics`)).status, 404, 'the opt-out did not survive the restart');
});

test('switching the calendar off is a 404 everywhere, at once; so is deleting the share: document', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: false, optOut: [EV_HELD], address: 'own' })))[0], true);
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/calendar.ics`)).status, 404, 'THE SWITCH IS OFF AND THE FEED IS STILL SERVED');
  assert.equal((await get(`/public/${NPUB}/e/${EV_SUPPER}.ics`)).status, 404, 'the switch is off and a per-event address is still served');
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/calendar.ics`)).status, 200, 're-anchor: switching back on did not restore the feed');
  assert.equal((await publish(pub, tomb(grace, SHARE_D + ap)))[0], true);
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/calendar.ics`)).status, 404, 'the share: document is gone and the feed is still served');
});
