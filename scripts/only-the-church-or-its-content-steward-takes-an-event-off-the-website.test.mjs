// ONLY THE CHURCH, OR A STEWARD IT TRUSTS WITH CONTENT, TAKES AN EVENT OFF THE CHURCH'S WEBSITE.
//   Run: node --test scripts/only-the-church-or-its-content-steward-takes-an-event-off-the-website.test.mjs
//
// Audit of feat/church-website-feeds (AUDIT-feeds-phase1-2026-09-22, F1). 02b6cf3 made a cancelled event
// leave the public feed from its own `event:` tombstone, decided from the tombstone's self-declared ['church']
// tag and the author alone. But accept() admits an event: tombstone from the leader of ANY group — or, under a
// group whose eventPolicy is 'everyone', from any member of it — on the strength of a ['t', <group>] tag,
// without checking that the id being tombstoned belongs to that group. So the youth leader could take the
// harvest supper off the church's website, silently, and it stayed gone after a restart; the owner console
// never repaired it because the church's own pubevent: copy was still on disk with an unchanged body.
//
// The rule now: the feed drops an event on the tombstone of the church key itself, or of a steward the church
// has given the CONTENT capability (stewardCan — the same predicate the console's own _consoleChurchVoice
// applies before it withdraws the church's copy, so the relay and the console never disagree about a cancel).
// Never on a group tag. A group leader's cancel of a group event that a steward put on the feed is reconciled
// by the next owner console instead — rare by construction (F2: group events are off the feed by default).
//
// A real scripts/gateway.mjs on its own port and data directory; a second, FRESH relay for the /import row
// (memory: ingest-rules-cannot-consult-hydrated-maps — the rule reads STEWARDS_BY, which /import cannot know
// until hydrateMaps() reads the archive; hydrateMaps loads the steward roster in its first pass before the
// full replay, and this file measures that on a relay that has never seen the church).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { readFileSync } from 'node:fs';
import { requireFreePort } from './test-ports.mjs';
import { fnBody, stmt } from './test-slice.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8851, PORT_B = 8852;   // unique across scripts/*.test.mjs (8850-8855 were free on 2026-09-22; 8850 is the sibling file's)
const NET = 'trinityone';
const MEMBER_D = D.MEMBER, EVENT_D = D.EVENT, SHARE_D = D.SHARE, PUBEVENT_D = D.PUBEVENT, GROUP_D = D.GROUP, STEWARDS_D = D.STEWARDS;
const now = () => Math.floor(Date.now() / 1000);
let _tick = now();
const next = () => (_tick = Math.max(_tick + 1, now()));   // strictly increasing: an addressable doc rewritten in the same second is "not newer"
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K();     // the church
const ann = K();       // a member, and the leader of the youth group
const bob = K();       // a member of the walking group, whose eventPolicy is 'everyone'
const dee = K();       // a delegated steward with the content capability
const fin = K();       // a delegated steward narrowed to finance
const ap = grace.pub, NPUB = npubEncode(ap);
const G_YOUTH = 'grpyouth', G_WALK = 'grpwalk';
const EV_SUPPER = 'evtsupper', EV_FAIR = 'evtfair', EV_PICNIC = 'evtpicnic';
const COPY = {
  [EV_SUPPER]: { title: 'Harvest supper, all welcome', date: '2026-10-03', time: '19:30', where: 'The church hall', blurb: 'Bring a dish.' },
  [EV_FAIR]:   { title: 'Christmas fair',              date: '2026-12-05', time: '',      where: 'The green',       blurb: '' },
  [EV_PICNIC]: { title: 'Parish picnic',               date: '2026-08-15', time: '12:00', where: 'The meadow',      blurb: '' },
};

const relays = {};   // port -> { proc, dataDir }
async function waitReady(port, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${port}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay ' + port + ' not ready'); }
function startRelay(port, withChurch) {
  const r = relays[port] || (relays[port] = { dataDir: mkdtempSync(join(tmpdir(), 'trin-webtomb-')) });
  r.proc = spawn(process.execPath, ['scripts/gateway.mjs', String(port)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: r.dataDir, ...(withChurch ? { CHURCH_NPUB: NPUB } : {}), RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' },
      stdio: 'ignore' });
  return waitReady(port);
}
const connect = (port = PORT) => new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = []) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', d], ['t', NET], ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const tomb = (who, d, tags = []) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', d], ['t', NET], ['deleted', '1'], ...tags], content: '' }, who.sk);
const get = (port, path) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
function uids(text) { return [...text.replace(/\r\n[ \t]/g, '').matchAll(/^UID:trinityone-([A-Za-z0-9_-]+)@/gm)].map(m => m[1]).sort(); }
async function feed(port = PORT) { const r = await get(port, `/public/${NPUB}/calendar.ics`); return { status: r.status, ids: r.status === 200 ? uids(await r.text()) : [] }; }
const nip98 = (who, port, path) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: now(), tags: [['u', `http://127.0.0.1:${port}${path}`], ['method', 'POST'], ['church', ap]], content: '' }, who.sk))).toString('base64');

let pub;
const archive = [];   // every event this file publishes, in order — the archive the /import row replays on a fresh relay
async function put(evt, expectOk, why) { archive.push(evt); const [ok, reason] = await publish(pub, evt); if (expectOk !== undefined) assert.equal(ok, expectOk, why + ' (' + reason + ')'); return ok; }

before(async () => {
  await requireFreePort(PORT, 'only-the-church-or-its-content-steward-takes-an-event-off-the-website.test.mjs');
  await requireFreePort(PORT_B, 'only-the-church-or-its-content-steward-takes-an-event-off-the-website.test.mjs (fresh relay)');
  await startRelay(PORT, true);
  pub = await connect();
  await put(finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'Grace Church' }) }, grace.sk), true, 'church profile');
  await put(doc(grace, STEWARDS_D + ap, { pubkeys: [dee.pub, fin.pub], caps: { [fin.pub]: ['finance'] } }), true, 'the steward roster');
  for (const m of [ann, bob, dee, fin]) await put(doc(m, MEMBER_D + ap, { joined: now() }), true, 'a member joins');
  await put(doc(grace, GROUP_D + G_YOUTH, { name: 'Youth', leaders: [ann.pub] }), true, 'the youth group, led by Ann');
  await put(doc(grace, GROUP_D + G_WALK, { name: 'Walkers', eventPolicy: 'everyone' }), true, 'the walking group, events by everyone');
  for (const id of Object.keys(COPY)) {
    await put(doc(grace, EVENT_D + id, { e: 'AtWvI3sealed' + id }), true, 'sealed whole-church event ' + id);   // ciphertext, as the console writes it; no group tag
    await put(doc(grace, PUBEVENT_D + id, COPY[id]), true, 'public copy ' + id);
  }
  await put(doc(grace, SHARE_D + ap, { calendar: true, optOut: [], address: 'own' }), true, 'the switch');
  await sleep(250);
});
after(async () => {
  try { pub && pub.close(); } catch {}
  for (const r of Object.values(relays)) { try { r.proc && r.proc.kill('SIGKILL'); } catch {} }
  await sleep(200);
  for (const r of Object.values(relays)) { try { rmSync(r.dataDir, { recursive: true, force: true }); } catch {} }
});

test('CONTROL: the three whole-church events are on the feed', async () => {
  assert.deepEqual(await feed(), { status: 200, ids: [EV_FAIR, EV_PICNIC, EV_SUPPER] });
});

test('a GROUP LEADER\'s tombstone of a whole-church event — admitted at the door on the strength of its group tag — leaves the feed untouched', async () => {
  // Audit F1 row B. The door rule is pre-existing and not under test; what is under test is that the feed's
  // drop no longer takes the tombstone's word for which church's copy it may remove.
  const ok = await put(tomb(ann, EVENT_D + EV_SUPPER, [['church', ap], ['t', G_YOUTH]]));
  await sleep(250);
  assert.deepEqual(await feed(), { status: 200, ids: [EV_FAIR, EV_PICNIC, EV_SUPPER] },
    `THE YOUTH LEADER TOOK THE HARVEST SUPPER OFF THE CHURCH'S WEBSITE (her tombstone was ${ok ? 'admitted' : 'refused'} at the door)`);
  assert.equal((await get(PORT, `/public/${NPUB}/e/${EV_SUPPER}.ics`)).status, 200, 'the per-event address went too');
});

test('a plain member\'s tombstone under an \'everyone\' group leaves the feed untouched', async () => {
  const ok = await put(tomb(bob, EVENT_D + EV_FAIR, [['church', ap], ['t', G_WALK]]));   // audit F1 row C
  await sleep(250);
  assert.deepEqual(await feed(), { status: 200, ids: [EV_FAIR, EV_PICNIC, EV_SUPPER] },
    `A MEMBER OF THE WALKING GROUP TOOK THE CHRISTMAS FAIR OFF THE WEBSITE (tombstone ${ok ? 'admitted' : 'refused'} at the door)`);
});

test('a steward narrowed to FINANCE cannot; a steward trusted with CONTENT can — her tombstone (as the console writes it: church + for) drops the copy at once', async () => {
  // The finance steward's forgery names the SUPPER, which nothing legitimate cancels in this file: the door
  // refuses it (accept() asks for content), but the /import row below replays it on a relay with no door, and
  // there the supper must still be served — note() must be exactly as narrow as accept() about WHICH capability.
  const finOk = await put(tomb(fin, EVENT_D + EV_SUPPER, [['church', ap], ['for', ap]]));
  await sleep(200);
  assert.deepEqual(await feed(), { status: 200, ids: [EV_FAIR, EV_PICNIC, EV_SUPPER] }, `the finance steward took an event off the website (tombstone ${finOk ? 'admitted' : 'refused'} at the door)`);
  await put(tomb(dee, EVENT_D + EV_FAIR, [['church', ap], ['for', ap]]), true, 'the content steward\'s cancel was refused at the door');
  await sleep(250);
  assert.deepEqual(await feed(), { status: 200, ids: [EV_PICNIC, EV_SUPPER] }, 'the content steward cancelled the fair and it is still on the website');
  assert.equal((await get(PORT, `/public/${NPUB}/e/${EV_FAIR}.ics`)).status, 404);
});

test('the church\'s own tombstone drops the copy at once', async () => {
  await put(tomb(grace, EVENT_D + EV_PICNIC), true, 'the church\'s own cancel was refused');
  await sleep(250);
  assert.deepEqual(await feed(), { status: 200, ids: [EV_SUPPER] }, 'the church cancelled the picnic and it is still on the website');
});

test('after a restart the same three answers hold — the forged tombstones are on disk, newer than the copies, and still count for nothing', async () => {
  try { pub.close(); } catch {}
  relays[PORT].proc.kill('SIGKILL'); await sleep(400);
  await startRelay(PORT, true);
  pub = await connect();
  assert.deepEqual(await feed(), { status: 200, ids: [EV_SUPPER] },
    'after a restart the feed is wrong: the supper must be back on (audit F1 row E: hydrate replays created_at ASC and the forged tombstones are newer than the copies), the fair and the picnic must stay off');
});

test('/import onto a FRESH relay reaches the same answers — the steward roster inside the archive decides, read before the tombstones replay', async () => {
  // The archive is everything this file published, in order, including the two forged tombstones and the two
  // legitimate ones. Relay B has never heard of the church: no CHURCH_NPUB, no roster, no maps. If the drop
  // consulted STEWARDS_BY before hydrateMaps() had read the roster, the content steward's cancel would be
  // judged a member's and the fair would come back on every restore.
  await startRelay(PORT_B, false);
  const r = await fetch(`http://127.0.0.1:${PORT_B}/import`, { method: 'POST',
    headers: { Authorization: nip98(grace, PORT_B, '/import'), 'Content-Type': 'application/x-ndjson' },
    body: archive.map(e => JSON.stringify(e)).join('\n') + '\n' });
  const body = await r.json().catch(() => ({}));
  assert.equal(r.status, 200, 'the import was refused: ' + JSON.stringify(body));
  assert.equal(body.imported, archive.length, 'not every line of the archive was stored: ' + JSON.stringify(body));
  await sleep(800);   // hydrateMaps() runs on setImmediate after the response
  assert.deepEqual(await feed(PORT_B), { status: 200, ids: [EV_SUPPER] },
    'on the restored relay the feed is wrong: exactly the supper must be served — the fair (content steward\'s cancel) and the picnic (church\'s cancel) off, the supper on despite the leader\'s forged tombstone');
  relays[PORT_B].proc.kill('SIGKILL'); await sleep(400);
  await startRelay(PORT_B, false);
  assert.deepEqual(await feed(PORT_B), { status: 200, ids: [EV_SUPPER] }, 'the restored relay changed its answer on its first restart');
});

// ── AND NOTHING ELSE HONOURS THE LEADER'S CANCEL EITHER ──────────────────────────────────────────────────
// a0c5476's first commit message said "the next owner console reconciles it", and that a network key's cancel
// was "likewise left to the console". AUDIT-feeds-round2-2026-09-22 R1 measured both false; that message was
// rewritten (CLAUDE.md rule 4) and these are the rows that hold the corrected version to its word. The
// BEHAVIOUR is unchanged and right: a group leader cannot withdraw a church-authored event ANYWHERE in this
// product — not from the console, not from a member's phone, since _forgetById is shared — so what this
// branch changed is that the feed now AGREES with the app instead of diverging from it, which was the
// finding. The owner unticks "On the website" to take such an event off.

test('THE OWNER CONSOLE does not reconcile a group leader\'s cancel — the church\'s event stays and the mirror publishes nothing', async () => {
  // The real chain out of the shipped bundle: _tombstoneTargets -> _forgetById (with the console's own
  // _consoleDisplay / _consoleChurchVoice) -> _webDesired -> _webSync. No copy of the logic.
  const S = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const n44 = await import('nostr-tools/nip44');
  const unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
  const KEY = 'a1'.repeat(32);
  const body = [
    stmt(S, 'var WEB_DEFAULT = ', 'WEB_DEFAULT'),
    stmt(S, 'var WEB_ID_OK = ', 'WEB_ID_OK'),
    stmt(S, 'var WEB_BLOCKED_AFTER_S = ', 'WEB_BLOCKED_AFTER_S'),
    stmt(S, 'var WEB_GIVE_UP_S = ', 'WEB_GIVE_UP_S'),
    stmt(S, 'var WEB_RETRY_MS = ', 'WEB_RETRY_MS'),
    stmt(S, 'var WEB_GROUP_MAX = ', 'WEB_GROUP_MAX'),
    fnBody(S, 'function _nameKeyReady', '_nameKeyReady'),
    fnBody(S, 'function _webGroupKey', '_webGroupKey'),
    fnBody(S, 'function _webGroupLoad', '_webGroupLoad'),
    fnBody(S, 'function _webGroupSeen', '_webGroupSeen'),
    fnBody(S, 'function _pickWinner', '_pickWinner'),
    fnBody(S, 'function _reduceVersions', '_reduceVersions'),
    fnBody(S, 'function _absorbById', '_absorbById'),
    fnBody(S, 'function _tombstoneTargets', '_tombstoneTargets'),
    fnBody(S, 'function _forgetById', '_forgetById'),
    fnBody(S, 'function _openChurchDoc', '_openChurchDoc'),
    fnBody(S, 'function _consoleDisplay', '_consoleDisplay'),
    fnBody(S, 'function _capsOf', '_capsOf'),
    fnBody(S, 'function _consoleChurchVoice', '_consoleChurchVoice'),
    fnBody(S, 'function _sealIsWhole', '_sealIsWhole'),
    fnBody(S, 'function _webCopyBody', '_webCopyBody'),
    fnBody(S, 'function _webWhyStuck', '_webWhyStuck'),
    fnBody(S, 'function _webEmit', '_webEmit'),
    fnBody(S, 'function _webDesired', '_webDesired'),
    fnBody(S, 'async function _webSync', '_webSync'),
  ].join('\n');
  // GUARDS ON THE LIFT: without these an assertion below could pass over nothing at all.
  assert.match(body, /mayName/, 'vendor/steward.js: _forgetById no longer has a mayName grant — re-anchor');
  assert.match(body, /tombs\.push\(id\)/, 'vendor/steward.js: _webSync no longer tombstones — re-anchor');
  const dec = (body.match(/return JSON\.parse\((\w+)\(ct,/) || [])[1];
  assert.ok(dec, 'vendor/steward.js: _openChurchDoc no longer decrypts the way this row reads it');

  const CP = 'c'.repeat(64), LEADER = '1'.repeat(64), CONTENT = '2'.repeat(64);
  const sealedDoc = (o) => JSON.stringify({ e: n44.encrypt(JSON.stringify(o), unhex(KEY)) });
  const run = async (by, tags) => {
    const published = [];
    const w = {
      pub: CP, share: { calendar: true, sermons: false, plans: false, optOut: [], optIn: ['evtyouth'], address: 'own' },
      shareTs: 1, shareKnown: true, events: new Map(), versions: new Map(), eventsKnown: true,
      copies: new Map([['evtyouth', JSON.stringify({ title: 'Youth night', date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '', recur: '', day: null })]]),
      copyTs: new Map(), copiesKnown: true, subs: [], listeners: new Set(), busy: false, again: false, timer: null,
      stuckSince: 0, keyedSince: 0, groupSeen: new Set(), stuck: new Set(), stuckWhy: '', blocked: 0, held: 0,
    };
    const scope = {
      _web: w, pub: CP, sk: 'SK', actingChurch: '', _nameKeyRing: [KEY], _unhex: unhex, [dec]: n44.decrypt,
      _careRosterKnown: true, _careRoster: new Set([CONTENT]), _stewardCaps: { [CONTENT]: ['content'] },
      NET, PUBEVENT_D, now: () => 1790000000, feChurch: (t) => t,
      publish: async (e) => { published.push(e); return true; },
      _webQueueSync: () => {}, setTimeout: () => 0, lsGet: () => null, lsSet: () => {},
    };
    const names = Object.keys(scope);
    const api = new Function(...names, `${body}\nreturn { _webSync, _forgetById, _tombstoneTargets, _absorbById, _consoleDisplay, _consoleChurchVoice };`)(...names.map(n => scope[n]));
    // the church's own GROUP event, as the console holds it, already ticked onto the website
    api._absorbById(w.versions, w.events, 'evtyouth',
      { id: 'evtyouth', raw: sealedDoc({ title: 'Youth night', date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '', groupId: 'grpyouth' }), ts: 10, _by: CP },
      api._consoleDisplay);
    assert.equal(w.events.has('evtyouth'), true, 're-anchor: the console never held the event to begin with');
    const t = { pubkey: by, created_at: 20, tags: [['d', EVENT_D + 'evtyouth'], ['t', NET], ['deleted', '1'], ...tags] };
    api._forgetById(w.versions, w.events, 'evtyouth', t.pubkey, t.created_at, api._consoleDisplay,
      { churchPub: CP, targets: api._tombstoneTargets(t), mayName: api._consoleChurchVoice });
    await api._webSync();
    return { stillHeld: w.events.has('evtyouth'), tombstoned: published.filter(e => e.tags.some(x => x[0] === 'deleted')).map(e => (e.tags.find(x => x[0] === 'd') || [])[1]) };
  };

  const leader = await run(LEADER, [['t', G_YOUTH]]);
  assert.equal(leader.stillHeld, true, 're-anchor: the console dropped the church\'s event on a leader\'s tombstone');
  assert.deepEqual(leader.tombstoned, [],
    'A GROUP LEADER\'S CANCEL IS RECONCILED BY THE CONSOLE after all — a0c5476\'s corrected message says it is not');
  // …and the STRONGER forgery, which is the one the authority check actually decides: a leader whose
  // tombstone NAMES the church's copy with a `for` tag, exactly as a delegated steward's console writes one.
  // Without this row the case above proves only that a tombstone with no `for` tag binds nothing, and
  // _consoleChurchVoice could be replaced by `() => true` with every assertion still green (measured).
  const forging = await run(LEADER, [['t', G_YOUTH], ['for', CP]]);
  assert.equal(forging.stillHeld, true,
    'A GROUP LEADER WHO NAMES THE CHURCH\'S COPY WITHDRAWS IT FROM THE CONSOLE — mayName is not being consulted');
  assert.deepEqual(forging.tombstoned, [], 'a group leader\'s `for`-tagged cancel took the event off the church\'s website');
  // CONTROLS: the two authorities that DO withdraw the church's copy still do.
  const content = await run(CONTENT, [['for', CP]]);
  assert.equal(content.stillHeld, false, 'a content steward\'s cancel no longer reaches the church\'s copy');
  assert.deepEqual(content.tombstoned, ['trinityone/pubevent:evtyouth'], 'a content steward\'s cancel no longer takes the copy off the website');
  const church = await run(CP, []);
  assert.equal(church.stillHeld, false, 'the church\'s own cancel no longer reaches its copy');
  assert.deepEqual(church.tombstoned, ['trinityone/pubevent:evtyouth'], 'the church\'s own cancel no longer takes the copy off the website');
});

test('A NETWORK KEY\'s cancel is not honoured by the relay either — the event stays on the feed in every tag shape', async () => {
  // The other half of the sentence a0c5476 withdrew. NOT asserted here: whether the relay STORES the
  // tombstone. An unauthenticated REQ on this relay returns nothing for the church's OWN documents either
  // (measured), so that instrument cannot tell a refused write from a withheld read, and a claim built on it
  // would be exactly the kind this commit series exists to remove.
  const netk = K();
  assert.equal((await publish(pub, doc(grace, D.NETWORK + netk.pub, { joined: now() })))[0], true, 'the church could not join a network');
  await sleep(200);
  assert.deepEqual(await feed(), { status: 200, ids: [EV_SUPPER] }, 're-anchor: the feed is not where this row expects it');
  for (const tags of [[['church', ap]], [['church', ap], ['t', G_YOUTH]], [['church', ap], ['for', ap]]]) {
    const [ok] = await publish(pub, tomb(netk, EVENT_D + EV_SUPPER, tags));
    await sleep(250);
    assert.deepEqual(await feed(), { status: 200, ids: [EV_SUPPER] },
      `A NETWORK KEY TOOK THE SUPPER OFF THE CHURCH'S WEBSITE with tags ${JSON.stringify(tags.map(t => t[0]))} (tombstone ${ok ? 'admitted' : 'refused'} at the door)`);
  }
});
