// EDITING A SERMON'S TITLE MUST NOT CHANGE THE DATE MEMBERS SEE, OR MOVE IT UP THE LIST.
//   Run: node --test scripts/editing-a-sermons-title-does-not-re-date-it.test.mjs
//
// ── WHAT WAS MEASURED, BEFORE ANY OF THIS WAS WRITTEN ────────────────────────────────────────────────────
// Option A (2026-09-25) taught both sermon readers to file a sermon in the shared church-doc store, whose
// ordering key is the field `ts`. Those readers already had a `ts`: the one the CONSOLE writes into a
// sermon's own content, meaning "when this was preached". One field, two jobs — so the readers overrode the
// document's date with the EVENT's `created_at` and the note they left called it a cosmetic side effect.
//
// Driving the shipped bundles against a real relay (scripts/gateway.mjs) said otherwise. A sermon published
// 31 Jul and retitled 25 Sep:
//   · read back as 25 Sep in a member's Watch & Listen row, in the video player header, and as the episode
//     date in the Listen tab — printed straight beside the real pubDates of the church's podcast episodes;
//   · jumped above a sermon preached SEVEN WEEKS LATER;
//   · and the document's own 31 Jul survived the first edit and was destroyed by the SECOND. The console
//     saves an edit as `publishSermon({ ...editing, ...fields })`, and by the second edit the row it is
//     spreading carries edit 1's clock. There is one addressable document per sermon, so once that is
//     written the original date is recoverable from nowhere.
//
// THE FIX IS A SECOND FIELD, NOT A REVERT. `ts` must go on carrying the event time: `_pickWinner`,
// `_absorbById` and `_forgetById` (src/church-doc-store.src.js) compare it to choose between the church's
// copy and a content steward's, and to decide whether a tombstone is newer than the edit it withdraws.
// `contentTs` is the sermon's own recorded date, falling back to the event time when the document has none.
//
// ── HOW THIS ASSERTS (CLAUDE.md rules 1 and 3) ──────────────────────────────────────────────────────────
// Three layers, and the middle one is the one rule 1 asks for:
//   ENGINE        — the REAL `_openSermons`, lifted out of the shipped vendor/fellowship.js, through a stub
//                   hub so this file decides exactly which events arrive and when.
//   POINT OF USE  — the REAL `WatchView` (app/screens-watch.jsx) and the REAL `ListenScreen`
//                   (app/screens-extras.jsx), mounted, wired to that same lifted engine, with the date read
//                   OUT OF THE RENDERED TREE. Nothing here matches text in a .jsx file (rule 3): put `ts`
//                   back in front of either screen's date expression and these go red.
//   CONSOLE+RELAY — the REAL `publishSermon`/`subscribeSermons` out of vendor/steward.js, over a real
//                   websocket to a real relay, doing what the Edit dialog does: spread the row it is
//                   showing and save it. This is the half that destroyed the date on disk.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts, loadScreen } from './render-jsx-screen.mjs';

const PORT = 19929;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const SERMON_D = 'trinityone/sermon:', PINSERMON_D = 'trinityone/pinsermon:';
const STEWARD_VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELLOWSHIP_VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Two real dates, eight weeks apart, so a wrong one is unmistakable in a failure message.
const PREACHED = Math.floor(Date.UTC(2026, 6, 31, 10, 30) / 1000);   // Fri 31 Jul 2026
const EDITED   = Math.floor(Date.UTC(2026, 8, 25, 14, 0) / 1000);    // Fri 25 Sep 2026
const LATER_SERMON = Math.floor(Date.UTC(2026, 7, 23, 10, 30) / 1000);   // Sun 23 Aug 2026 — AFTER the one that gets edited

// BOTH screens format with `toLocaleDateString(undefined, …)` — deliberately the device's own locale
// (nationality-agnostic, see the note on fmtDate in app/screens-watch.jsx) — so the test process's locale
// decides whether that reads "31 Jul 2026" or "Jul 31, 2026". These match either order without
// re-implementing the formatter, because the claim here is WHICH INSTANT is shown, never how it is spelled.
const SHOWS_JUL_31 = /(31[^0-9]{0,4}Jul|Jul[^0-9]{0,4}31)[^0-9]{0,4}2026/;
const SHOWS_SEP_25 = /(25[^0-9]{0,4}Sep|Sep[^0-9]{0,4}25)[^0-9]{0,4}2026/;

const FCP = 'c'.repeat(64);   // the church's pubkey — the only trusted author on the member side
const settle = () => new Promise(r => setTimeout(r, 0));

// A sermon document as the relay delivers it: `at` is the EVENT's created_at, `ts` is inside the content.
const sermonDoc = (id, { title, ts, at }) => ({
  id: 'x' + Math.random(), pubkey: FCP, created_at: at,
  content: JSON.stringify({ id, title, sha256: 'aa' + id, hosts: ['https://h.example'], mime: 'audio/mpeg', size: 4 * 1048576, ...(ts === null ? {} : { ts }) }),
  tags: [['d', SERMON_D + id]],
});

// ══════════════════════════════════ LAYER 1: THE ENGINE, LIFTED ═══════════════════════════════════════════
function liftedEngine() {
  let handler = null;
  const stubs = {
    toPub: () => FCP,
    _churchRoster: new Map([[FCP, new Set()]]),   // roster known and empty: only the church key is trusted
    _onChurchDocs: (_cp, h) => { handler = h; return () => {}; },
    console,
  };
  const DECLARED = new Set(['handler', '_churchVoice', '_coalesce', '_pickWinner', '_reduceVersions',
    '_absorbById', '_forgetById', '_reduceAll', '_tombstoneTargets', 'SERMON_D']);
  const scope = new Proxy(stubs, {
    has: (t, k) => !DECLARED.has(String(k)) && ((k in t) || !(String(k) in globalThis)),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it in liftedEngine()'); },
  });
  const parts = [
    fnBody(FELLOWSHIP_VENDOR, 'function _churchVoice(cp, doc) {', '_churchVoice'),
    fnBody(FELLOWSHIP_VENDOR, 'function _coalesce(fn) {', '_coalesce'),
    fnBody(FELLOWSHIP_VENDOR, 'function _pickWinner(', '_pickWinner'),
    fnBody(FELLOWSHIP_VENDOR, 'function _reduceVersions(', '_reduceVersions'),
    fnBody(FELLOWSHIP_VENDOR, 'function _absorbById(', '_absorbById'),
    fnBody(FELLOWSHIP_VENDOR, 'function _forgetById(', '_forgetById'),
    fnBody(FELLOWSHIP_VENDOR, 'function _reduceAll(', '_reduceAll'),
    fnBody(FELLOWSHIP_VENDOR, 'function _tombstoneTargets(e) {', '_tombstoneTargets'),
  ].join('\n');
  const osBody = fnBody(FELLOWSHIP_VENDOR, '_openSermons(churchNpub, onSermons) {', '_openSermons');
  const names = Object.keys(stubs);
  const built = new Function(...names, 'scope', `
    ${parts}
    let SERMON_D = ${JSON.stringify(SERMON_D)};
    with (scope) { return ({ ${osBody} })._openSermons; }
  `)(...names.map(k => stubs[k]), scope);
  return {
    open: (cb) => built('npub1c', cb),
    fire: (e) => handler.onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1]),
    eose: () => handler.oneose(),
    opened: () => !!handler,
  };
}

test('ENGINE: the sermon’s own date survives an edit, while `ts` stays the EVENT time for the store', async () => {
  const eng = liftedEngine();
  let last = null;
  eng.open(l => { last = l; });
  // published on the day it was preached, then retitled eight weeks later — one addressable document
  eng.fire(sermonDoc('s1', { title: 'The Good Shepherd', ts: PREACHED, at: PREACHED }));
  eng.eose();
  await settle();
  eng.fire(sermonDoc('s1', { title: 'The Good Shepherd (John 10)', ts: PREACHED, at: EDITED }));
  await settle();
  assert.equal(last.length, 1, 'the edit did not replace the sermon: ' + JSON.stringify(last.map(s => s.title)));
  assert.equal(last[0].title, 'The Good Shepherd (John 10)', 'fixture: the edit should be the version held');
  assert.equal(last[0].contentTs, PREACHED,
    'THE SERMON LOST ITS OWN DATE. `contentTs` must be the `ts` the document carries — what the screens show. ' +
    'Got ' + new Date((last[0].contentTs || 0) * 1000).toISOString() + ', wanted ' + new Date(PREACHED * 1000).toISOString());
  assert.equal(last[0].ts, EDITED,
    '`ts` is no longer the EVENT time. It is the church-doc store’s ordering key — _pickWinner, _absorbById ' +
    'and _forgetById compare it to choose between two authors’ copies and to rank a tombstone against the ' +
    'edit it withdraws. Back-dating it lets a forward-dated copy beat the church’s own, and lets a stale ' +
    'tombstone un-delete a sermon. Got ' + new Date((last[0].ts || 0) * 1000).toISOString());
});

test('ENGINE: …so retitling a sermon does not move it up the list', async () => {
  const eng = liftedEngine();
  let last = null;
  eng.open(l => { last = l; });
  eng.fire(sermonDoc('s1', { title: 'July', ts: PREACHED, at: PREACHED }));
  eng.fire(sermonDoc('s2', { title: 'August', ts: LATER_SERMON, at: LATER_SERMON }));
  eng.eose();
  await settle();
  assert.deepEqual(last.map(s => s.title), ['August', 'July'], 'fixture: newest preached first');
  eng.fire(sermonDoc('s1', { title: 'July (corrected)', ts: PREACHED, at: EDITED }));
  await settle();
  assert.deepEqual(last.map(s => s.title), ['August', 'July (corrected)'],
    'FIXING A TYPO IN JULY’S TITLE PUSHED IT ABOVE A SERMON PREACHED IN AUGUST. Members read this list as ' +
    '"most recent sermon first". Order: ' + JSON.stringify(last.map(s => s.title)));
});

test('ENGINE: a sermon document with no date of its own falls back to the event time', async () => {
  // An old document, a foreign one, or anything whose `ts` did not survive — it must still show A date
  // rather than none, which is exactly what these readers did before `contentTs` existed.
  const eng = liftedEngine();
  let last = null;
  eng.open(l => { last = l; });
  eng.fire(sermonDoc('s1', { title: 'Undated', ts: null, at: PREACHED }));
  eng.eose();
  await settle();
  assert.equal(last[0].contentTs, PREACHED,
    'a sermon with no `ts` in its content got no date at all, so its row, its player header and its Listen ' +
    'entry would each silently drop the date. Got ' + JSON.stringify(last[0].contentTs));
});

// ══════════════════════════════════ LAYER 2: THE SCREENS, RENDERED ════════════════════════════════════════
// The REAL components, mounted, with the date read out of the tree. `SermonRow` and `fmtDate` live in
// screens-watch.jsx beside `WatchView`, so a `function` declaration in the compiled file supplies them —
// this harness stubs neither, or the assertion below would be reading a stub's output.
async function watchTab(events) {
  const { React, draw } = miniReact();
  const eng = liftedEngine();
  const opened = [];
  const win = {
    Fellowship: { subscribeSermons: (_npub, cb) => eng.open(cb), gatewayBase: () => '' },
    Bible: { getVideos: async () => ({ channel: null, videos: [] }) },
    TrinityAudio: { play() {} },
  };
  const globals = {
    React, window: win,
    Icon: () => null, SectionLabel: ({ children }) => children,
    setTimeout, clearTimeout, fetch: async () => { throw new Error('the screen must not fetch a feed with no channel set'); },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
  };
  const mod = loadScreen('app/screens-watch.jsx', ['WatchView', 'SermonRow'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s', channel: '' }, toast() {}, openVideo: (v) => opened.push(v) };
  const render = () => draw(mod.WatchView, { ctx });
  render();
  await settle();
  assert.ok(eng.opened(), 'the screen never subscribed to sermons at all — re-anchor this test');
  for (const e of events) eng.fire(e);
  eng.eose();
  await settle();
  const tree = render();
  return { tree, said: texts(tree).join(' · '), opened, ctx };
}

test('POINT OF USE — Watch & Listen: the row shows the PREACHING date after an edit, not the edit date', async () => {
  const p = await watchTab([
    sermonDoc('s1', { title: 'The Good Shepherd', ts: PREACHED, at: PREACHED }),
    sermonDoc('s1', { title: 'The Good Shepherd (John 10)', ts: PREACHED, at: EDITED }),
  ]);
  assert.match(p.said, /The Good Shepherd \(John 10\)/, 'the edited sermon is not on the screen at all. Screen read: ' + p.said);
  assert.match(p.said, SHOWS_JUL_31,
    'THE ROW IS SHOWING THE WRONG DATE — this is the bug, at the screen a member actually looks at. It must ' +
    'read the sermon’s own date (31 Jul 2026), not the moment a steward last retitled it. Screen read: ' + p.said);
  assert.doesNotMatch(p.said, SHOWS_SEP_25,
    'the row is dated by the EDIT. Screen read: ' + p.said);
});

test('POINT OF USE — Watch & Listen: the video player is handed the preaching date too', async () => {
  // A video sermon goes to ctx.openVideo, whose `published` is what VideoPlayer prints under the title.
  const vid = (title, at) => {
    const e = sermonDoc('v1', { title, ts: PREACHED, at });
    const c = JSON.parse(e.content); c.mime = 'video/mp4'; e.content = JSON.stringify(c);
    return e;
  };
  const p = await watchTab([vid('Carols', PREACHED), vid('Carols (HD)', EDITED)]);
  const row = find(p.tree, n => n.type === 'button' && texts(n).join(' ').includes('Carols (HD)'))[0];
  assert.ok(row && typeof row.props.onClick === 'function', 'no tappable row for the video sermon — re-anchor this test');
  row.props.onClick();
  assert.equal(p.opened.length, 1, 'tapping the row did not open the video player: ' + JSON.stringify(p.opened));
  assert.equal(p.opened[0].published.slice(0, 10), '2026-07-31',
    'THE PLAYER HEADER IS DATED BY THE EDIT. VideoPlayer prints `published` under the title. Got: ' + p.opened[0].published);
});

// The Listen tab. `audioFeed` is '' so the screen takes its own "no podcast feed" branch and never fetches —
// the self-hosted sermons are then the whole episode list, which is the pilot church this date is shown to.
async function listenTab(events) {
  const { React, draw } = miniReact();
  const eng = liftedEngine();
  const win = {
    Fellowship: { subscribeSermons: (_npub, cb) => eng.open(cb), gatewayBase: () => '' },
    TrinityAudio: { play() {} },
  };
  const globals = {
    React, window: win,
    Icon: () => null, IconBtn: () => null, useTrinityAudio: () => ({ track: null, playing: false, t: 0, d: 0 }),
    Sheet: ({ children }) => children, Screen: ({ children }) => children, Overlay: ({ children }) => children,
    setTimeout, clearTimeout, fetch: async () => { throw new Error('the screen must not fetch a feed with no feed url set'); },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp, localStorage: { getItem: () => null, setItem() {} },
  };
  const mod = loadScreen('app/screens-extras.jsx', ['ListenScreen'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s', audioFeed: '' }, toast() {} };
  const render = () => draw(mod.ListenScreen, { open: true, onClose() {}, ctx });
  render();
  await settle();
  assert.ok(eng.opened(), 'the Listen screen never subscribed to sermons — re-anchor this test');
  for (const e of events) eng.fire(e);
  eng.eose();
  await settle();
  const tree = render();
  return { tree, said: texts(tree).join(' · ') };
}

test('POINT OF USE — Listen tab: the episode date is the preaching date, not the edit date', async () => {
  const p = await listenTab([
    sermonDoc('s1', { title: 'The Good Shepherd', ts: PREACHED, at: PREACHED }),
    sermonDoc('s1', { title: 'The Good Shepherd (John 10)', ts: PREACHED, at: EDITED }),
  ]);
  assert.match(p.said, /The Good Shepherd \(John 10\)/, 'the sermon is not listed as an episode at all. Screen read: ' + p.said);
  assert.match(p.said, SHOWS_JUL_31,
    'THE LISTEN TAB IS DATING THE SERMON BY ITS LAST EDIT. This date sits in the same list, in the same ' +
    'format, as the real pubDates of the church’s podcast episodes, so a wrong one is read as fact. ' +
    'Screen read: ' + p.said);
  assert.doesNotMatch(p.said, SHOWS_SEP_25, 'the episode is dated by the edit. Screen read: ' + p.said);
});

// ══════════════════════════════════ LAYER 3: THE CONSOLE, AGAINST A REAL RELAY ════════════════════════════
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(); const cp = church.pub;
let relay, dataDir, ws, CLOCK = PREACHED;
const now = () => CLOCK;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });

before(async () => {
  await requireFreePort(PORT, 'editing-a-sermons-title-does-not-re-date-it.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-sermon-date-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(200); }
  ws = await connect();
  assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk)))[0], true, 'church profile');
  await sleep(200);
});
after(async () => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// The shipped console, lifted out of vendor/steward.js, on a real SimplePool against the real relay.
function consoleApi() {
  const pool = new SimplePool();
  pool.automaticallyAuth = (_url) => async (authEvent) => finalizeEvent(authEvent, church.sk);
  const scope = {
    sk: church.sk, pub: cp, actingChurch: '',
    pool, relays: () => [WS_URL], NET, SERMON_D, PINSERMON_D,
    _stewardCaps: {}, _careRoster: new Set(), _careRosterKnown: true, _careRosterSeen: true,
    _monotonic: (t) => t, now, sent: [],
    publish: async (evt) => { scope.sent.push(evt); const [ok] = await send(ws, evt); return ok; },
  };
  const feBody = fnBody(STEWARD_VENDOR, 'function feChurch(tmpl, signer) {', 'feChurch');
  const signerName = (/return\s+(finalizeEvent\w*)\s*\(/.exec(feBody) || [])[1];
  assert.ok(signerName, 'feChurch no longer ends by calling finalizeEvent — re-anchor this fixture');
  scope[signerName] = finalizeEvent;
  const parts = [
    feBody,
    fnBody(STEWARD_VENDOR, 'function _capsOf(by) {', '_capsOf'),
    fnBody(STEWARD_VENDOR, 'function _consoleDisplay(rec) {', '_consoleDisplay'),
    fnBody(STEWARD_VENDOR, 'function _consoleChurchVoice(rec) {', '_consoleChurchVoice'),
    fnBody(STEWARD_VENDOR, 'function _pickWinner(', '_pickWinner'),
    fnBody(STEWARD_VENDOR, 'function _reduceVersions(', '_reduceVersions'),
    fnBody(STEWARD_VENDOR, 'function _absorbById(', '_absorbById'),
    fnBody(STEWARD_VENDOR, 'function _forgetById(', '_forgetById'),
    fnBody(STEWARD_VENDOR, 'function _tombstoneTargets(e) {', '_tombstoneTargets'),
  ].join('\n');
  const ps = fnBody(STEWARD_VENDOR, 'publishSermon(s) {', 'publishSermon');
  const ss = fnBody(STEWARD_VENDOR, 'subscribeSermons(onSermons) {', 'subscribeSermons');
  Object.assign(scope, new Function('scope', `with (scope) { ${parts}\n return ({ ${ps},\n ${ss} }); }`)(scope));
  return scope;
}
const settleSub = (sub, ms = 1200) => new Promise((resolve) => { let last; const un = sub(m => { last = m; }); setTimeout(() => { un(); resolve(last); }, ms); });
const contentOf = (scope) => JSON.parse(scope.sent[scope.sent.length - 1].content);

test('CONSOLE: a brand-new sermon is dated NOW — doUpload passes no date and must still get one', async () => {
  CLOCK = PREACHED;
  const c = consoleApi();
  // exactly the fields app/stew-dashboard.jsx's doUpload passes
  const out = await c.publishSermon({ title: 'The Good Shepherd', sha256: 'aa1', host: 'https://h.example', hosts: ['https://h.example'], mime: 'audio/mpeg', size: 4, enc: false });
  assert.ok(out && out.id, 'the relay refused the sermon: ' + JSON.stringify(out));
  assert.equal(contentOf(c).ts, PREACHED,
    'a NEW sermon was published with no date, or the wrong one. Nothing else records when it was preached, ' +
    'so it would show up undated on every phone. Got: ' + JSON.stringify(contentOf(c).ts));
  await sleep(300);
});

test('CONSOLE: TWO edits, the way the Edit dialog does them, and the original date survives both', async () => {
  // This is the half that wrote the wrong date to disk. app/stew-dashboard.jsx saves an edit as
  // `publishSermon({ ...editing, ...fields })`, where `editing` is a row out of subscribeSermons — so the
  // row's own fields decide what is persisted, and the row's `ts` is the EVENT's created_at.
  const c = consoleApi();
  const before1 = await settleSub(c.subscribeSermons);
  const row = (before1 || []).find(s => s.title === 'The Good Shepherd');
  assert.ok(row, 'the console cannot see the sermon it just published: ' + JSON.stringify(before1));
  assert.equal(row.contentTs, PREACHED, 'the console row lost the sermon’s own date: ' + JSON.stringify(row.contentTs));

  CLOCK = EDITED;
  await c.publishSermon({ ...row, title: 'The Good Shepherd (John 10)' });
  assert.equal(contentOf(c).ts, PREACHED, 'edit 1 re-dated the document: ' + new Date(contentOf(c).ts * 1000).toISOString());
  await sleep(300);

  CLOCK = EDITED + 60;
  const before2 = await settleSub(c.subscribeSermons);
  const row2 = (before2 || []).find(s => s.title === 'The Good Shepherd (John 10)');
  assert.ok(row2, 'the console cannot see its own edit: ' + JSON.stringify(before2));
  await c.publishSermon({ ...row2, title: 'The Good Shepherd (John 10) — corrected' });
  assert.equal(contentOf(c).ts, PREACHED,
    'THE SECOND EDIT DESTROYED THE PREACHING DATE. This is the measured data loss: `publishSermon` took the ' +
    'row’s `ts` (which is edit 1’s clock) as the sermon’s date, and there is one addressable document per ' +
    'sermon, so 31 Jul is then recoverable from nowhere. Persisted: ' + new Date(contentOf(c).ts * 1000).toISOString());
  await sleep(300);

  // …and what the relay actually holds, read back on a fresh subscription, agrees.
  const c2 = consoleApi();
  const after = await settleSub(c2.subscribeSermons);
  const held = (after || []).find(s => s.title === 'The Good Shepherd (John 10) — corrected');
  assert.ok(held, 'the twice-edited sermon is not on the relay: ' + JSON.stringify(after));
  assert.equal(held.contentTs, PREACHED,
    'the relay’s copy of the sermon is dated by an edit. Held: ' + new Date((held.contentTs || 0) * 1000).toISOString());
  try { c2.pool.close([WS_URL]); } catch {}
  try { c.pool.close([WS_URL]); } catch {}
});

test('CONSOLE: the steward’s own list does not re-order when a title is fixed', async () => {
  CLOCK = LATER_SERMON;
  const c = consoleApi();
  await c.publishSermon({ title: 'August', sha256: 'bb1', host: 'https://h.example', mime: 'audio/mpeg', size: 4 });
  await sleep(300);
  const list = await settleSub(c.subscribeSermons);
  const titles = (list || []).map(s => s.title);
  assert.deepEqual(titles.slice(0, 2), ['August', 'The Good Shepherd (John 10) — corrected'],
    'THE CONSOLE LIST IS ORDERED BY EDIT TIME. A steward fixing a July typo finds it sitting above every ' +
    'sermon since, which is also the order the duplicate check reads. Order: ' + JSON.stringify(titles));
  try { c.pool.close([WS_URL]); } catch {}
});
