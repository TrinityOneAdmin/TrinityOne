// THE WEBSITE MIRROR ACTS ONLY ON A WHOLE ANSWER — a cut-off read never publishes or tombstones a public event.
//   Run: node --test scripts/the-website-mirror-acts-only-on-a-whole-answer.test.mjs
//
// Measured live 2026-11-11: the relay closes the steward console's sockets (1009 "too slow") every ~16 s, and
// nostr-tools 2.23.5 (abstract-pool handleClose -> handleEose) reports a dropped or timed-out read as complete.
// The mirror (_webEnsure / _webSync / _webDesired, src/steward.src.js) set its "known" flags on that, so one open
// console re-published `pubevent:` copies every few seconds, and an Opus audit found the worse case: a calendar,
// or a share document, cut off part-way made `desired` too small and TOMBSTONED events off the church's website.
//
// Rule 1: this drives the SHIPPED mirror lifted out of vendor/steward.js — _webEnsure with its three streams,
// _webRead, _webSync, _webDesired, and the key reads' own _keyReadOk — over a fake pool that can deliver part of
// a stream and then close the socket or let nostr-tools' timer fire. Nothing here matches text in app/*.jsx.
// The rows count what the mirror PUBLISHED, the only thing a church's website sees.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encrypt as nip44e } from 'nostr-tools/nip44';
import { fnBody, stmt } from './test-slice.mjs';
import { _absorbById, _forgetById, _tombstoneTargets } from '../src/church-doc-store.src.js';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
const KEY = 'a1'.repeat(32);
const CP = 'c'.repeat(64);
const sealed = (obj) => JSON.stringify({ e: nip44e(JSON.stringify(obj), unhex(KEY)) });
let _n44 = null;
before(async () => { _n44 = await import('nostr-tools/nip44'); });

// ── the mirror, lifted out of the bundle ─────────────────────────────────────────────────────────────────
function lift() {
  const src = STEWARD;
  const parts = [
    stmt(src, 'var NET = ', 'NET'), stmt(src, 'var EVENT_D = ', 'EVENT_D'), stmt(src, 'var SHARE_D = ', 'SHARE_D'), stmt(src, 'var PUBEVENT_D = ', 'PUBEVENT_D'),
    stmt(src, 'var WEB_HORIZON_OK = ', 'WEB_HORIZON_OK'), stmt(src, 'var WEB_DEFAULT = ', 'WEB_DEFAULT'),
    stmt(src, 'var WEB_ID_OK = ', 'WEB_ID_OK'), stmt(src, 'var WEB_BLOCKED_AFTER_S = ', 'WEB_BLOCKED_AFTER_S'),
    stmt(src, 'var WEB_GIVE_UP_S = ', 'WEB_GIVE_UP_S'), stmt(src, 'var WEB_RETRY_MS = ', 'WEB_RETRY_MS'),
    stmt(src, 'var WEB_GROUP_MAX = ', 'WEB_GROUP_MAX'), stmt(src, 'var WEB_IMG_MAX = ', 'WEB_IMG_MAX'), stmt(src, 'var EV_EXC_MAX = ', 'EV_EXC_MAX'),
    stmt(src, 'var SEAL_B64 = ', 'SEAL_B64'), stmt(src, 'var _KEY_READ_LONG_WAIT = ', '_KEY_READ_LONG_WAIT'),
    fnBody(src, 'function _keyReadAuthedOn', '_keyReadAuthedOn'), fnBody(src, 'function _keyReadOk', '_keyReadOk'),
    fnBody(src, 'function _keyReadAfterAuth', '_keyReadAfterAuth'), fnBody(src, 'function _keyReadConnected', '_keyReadConnected'),
    stmt(src, 'var _webIds = ', '_webIds'), fnBody(src, 'function _webNormalise', '_webNormalise'),
    fnBody(src, 'function _nameKeyReady', '_nameKeyReady'),
    fnBody(src, 'function _webGroupKey', '_webGroupKey'), fnBody(src, 'function _webGroupLoad', '_webGroupLoad'), fnBody(src, 'function _webGroupSeen', '_webGroupSeen'),
    fnBody(src, 'function _webStuckKey', '_webStuckKey'), fnBody(src, 'function _webStuckLoad', '_webStuckLoad'), fnBody(src, 'function _webStuckClock', '_webStuckClock'),
    fnBody(src, 'function _sealIsWhole', '_sealIsWhole'), fnBody(src, 'function _webWhyStuck', '_webWhyStuck'), fnBody(src, 'function _openChurchDoc', '_openChurchDoc'),
    fnBody(src, 'function _evImgPos', '_evImgPos'), fnBody(src, 'function _evImgZoom', '_evImgZoom'), fnBody(src, 'function _evExceptions', '_evExceptions'),
    fnBody(src, 'function _webImg', '_webImg'), fnBody(src, 'function _webCopyBody', '_webCopyBody'),
    fnBody(src, 'function _webStop', '_webStop'), fnBody(src, 'function _webSnap', '_webSnap'), fnBody(src, 'function _webEmit', '_webEmit'),
    fnBody(src, 'function _webQueueSync', '_webQueueSync'),
    fnBody(src, 'function _webLoginPending', '_webLoginPending'), fnBody(src, 'function _webRead', '_webRead'),
    fnBody(src, 'function _webEnsure', '_webEnsure'), fnBody(src, 'function _webDesired', '_webDesired'), fnBody(src, 'async function _webSync', '_webSync'),
  ];
  const body = parts.join('\n');
  // GUARDS ON THE LIFT: the rows below would pass over nothing if the streams stopped going through _webRead.
  assert.equal((fnBody(src, 'function _webEnsure', '_webEnsure').match(/w\.subs\.push\(_webRead\(/g) || []).length, 3,
    'vendor/steward.js: _webEnsure no longer opens its three streams through _webRead — re-anchor this test');
  const dec = (body.match(/return JSON\.parse\((\w+)\(ct,/) || [])[1];
  assert.ok(dec, 'vendor/steward.js: _openChurchDoc no longer decrypts the way this test reads it — re-anchor');
  return { body, dec };
}

// A console: one or more relays, a fake pool, a clock for nostr-tools' timer (Date.now) and one for created_at (now).
function consoleWith(urls = ['wss://a/']) {
  const { body, dec } = lift();
  const relaysMap = new Map(urls.map(u => [u, { connected: true, challenge: undefined }]));
  const subs = [];
  const published = [];
  const timers = [];
  let wall = 1_000_000, clock = 1790000000;
  const pool = {
    relays: relaysMap,
    subscribeMany(us, filters, h) {
      const s = { url: us[0], filters, h, closed: false };
      s.close = () => { if (s.closed) return; s.closed = true; try { h.oneose && h.oneose(); } catch {} try { h.onclose && h.onclose(['closed by caller']); } catch {} };
      subs.push(s);
      return { close: s.close };
    },
  };
  const scope = {
    pool, relays: () => urls.slice(), normalizeURL: (u) => u, _keyReadEpoch: 0, actingChurch: '', pub: CP, sk: 'SK',
    _authAccepted: new Map(), _keyReadAuthWaiters: new Set(), _web: null,
    _nameKeyRing: [KEY], _unhex: unhex,
    lsGet: () => null, lsSet: () => {},
    _authFuture: () => false, _consoleDisplay: () => true, _consoleChurchVoice: (rec) => rec && rec._by === CP,
    _absorbById, _forgetById, _tombstoneTargets,
    now: () => clock, Date: { now: () => wall },
    feChurch: (t) => t,
    publish: async (evt) => { published.push(evt); return true; },
    setTimeout: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
  };
  scope[dec] = (ct, k) => _n44.decrypt(ct, k);
  const names = Object.keys(scope);
  const api = new Function(...names, `${body}\nreturn { _webEnsure, _webSync, _webDesired, _webCopyBody, web: () => _web, bumpEpoch: () => { _keyReadEpoch++; } };`)(...names.map(n => scope[n]));
  // which stream a subscription is: s1 the share document, s2 the copies, s3 the calendar
  const kindOf = (s) => s.filters.length === 2 ? 'events' : (s.filters[0]['#d'] ? 'share' : 'copies');
  const live = (kind, url = urls[0]) => [...subs].reverse().find(s => !s.closed && s.url === url && kindOf(s) === kind);
  const c = {
    api, subs, published, scope, relaysMap,
    start: () => api._webEnsure(true),
    // deliver events on the current subscription of `kind`
    send(kind, events, url) { const s = live(kind, url); assert.ok(s, 'no live ' + kind + ' subscription'); for (const e of events) s.h.onevent(e); return s; },
    // a genuine EOSE: the relay said "that is everything", and the socket stays up
    eose(kind, url) { const s = live(kind, url); assert.ok(s, 'no live ' + kind + ' subscription'); s.h.oneose(); },
    // the relay closes the socket mid-stream: nostr-tools fires oneose, then onclose, in the same turn
    cut(kind, url) { const s = live(kind, url); assert.ok(s, 'no live ' + kind + ' subscription'); s.closed = true; relaysMap.get(s.url).connected = false; s.h.oneose(); s.h.onclose(['1009 too slow']); },
    // nostr-tools' own EOSE timer: the socket is still up, the read simply ran past `maxWait`
    timeout(kind, url) { const s = live(kind, url); assert.ok(s, 'no live ' + kind + ' subscription'); wall += 15000; s.h.oneose(); },
    reconnect() { for (const r of relaysMap.values()) r.connected = true; },
    eoseAll(url) { for (const k of ['share', 'copies', 'events']) c.eose(k, url); },
    // run the debounced syncs (≤ 250 ms) and let their publishes resolve; never the 2 s retries
    async settle() {
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setImmediate(r));
        const due = timers.filter(t => !t.done && t.ms <= 250);
        for (const t of due) { t.done = true; t.fn(); }
        if (!due.length && i > 3) break;
      }
    },
    tick: (s) => { clock += s; },
    writes: () => published.filter(e => !e.tags.some(t => t[0] === 'deleted')).map(e => e.tags.find(t => t[0] === 'd')[1]),
    tombs: () => published.filter(e => e.tags.some(t => t[0] === 'deleted')).map(e => e.tags.find(t => t[0] === 'd')[1]),
  };
  return c;
}

const SHARE_ON = (ts = 50) => ({ pubkey: CP, created_at: ts, tags: [['d', 'trinityone/share:' + CP], ['t', 'trinityone']], content: JSON.stringify({ calendar: true, optOut: [], optIn: [] }) });
const EV = (id, title, ts = 60) => ({ pubkey: CP, created_at: ts, tags: [['d', 'trinityone/event:' + id], ['t', 'trinityone']], content: sealed({ title, date: '2026-12-0' + (id.length % 9 + 1), time: '10:00', where: 'Hall', blurb: '' }) });
const COPY = (id, body, ts = 70) => ({ pubkey: CP, created_at: ts, tags: [['d', 'trinityone/pubevent:' + id], ['t', 'trinityone']], content: body });

// The bodies the mirror itself would write for these events — read from a first, whole sync, never hand-made.
async function bodiesFor(events) {
  const c = consoleWith();
  c.start();
  c.send('share', [SHARE_ON()]); c.send('events', events); c.eoseAll();
  await c.settle();
  const out = {};
  for (const e of c.published) out[e.tags.find(t => t[0] === 'd')[1].slice('trinityone/pubevent:'.length)] = e.content;
  return out;
}
const A = EV('evta', 'Harvest supper'), B = EV('evtbb', 'Carol service');

test('the instrument: a whole first read with no copies on the relay publishes both events (so a 0 below means something)', async () => {
  const c = consoleWith();
  c.start();
  c.send('share', [SHARE_ON()]); c.send('events', [A, B]); c.eoseAll();
  await c.settle();
  assert.deepEqual(c.writes().sort(), ['trinityone/pubevent:evta', 'trinityone/pubevent:evtbb']);
  assert.deepEqual(c.tombs(), []);
});

test('(a) two restarts over identical relay copies publish nothing', async () => {
  const bodies = await bodiesFor([A, B]);
  const c = consoleWith();
  for (let round = 0; round < 3; round++) {
    c.start();
    c.send('share', [SHARE_ON()]); c.send('events', [A, B]); c.send('copies', [COPY('evta', bodies.evta), COPY('evtbb', bodies.evtbb)]);
    c.eoseAll();
    await c.settle();
  }
  assert.deepEqual(c.published.map(e => e.tags.find(t => t[0] === 'd')[1]), [], 'a restart over the same copies re-published them');
});

test('(b) a copies read the relay cuts off part-way publishes nothing (first watch: nothing carried)', async () => {
  const bodies = await bodiesFor([A, B]);
  const c = consoleWith();
  c.start();
  c.send('share', [SHARE_ON()]); c.eose('share');
  c.send('events', [A, B]); c.eose('events');
  c.send('copies', [COPY('evta', bodies.evta)]);   // evtbb's copy is on the relay, but the socket closes first
  c.cut('copies');
  await c.settle();
  assert.deepEqual(c.writes(), [], 'HALF THE COPIES WERE TAKEN AS ALL OF THEM: the mirror re-published a copy the relay already holds');
  assert.deepEqual(c.tombs(), []);
});

test('(c) a calendar read the relay cuts off part-way tombstones nothing — and nor does nostr-tools\' own timer', async () => {
  const bodies = await bodiesFor([A, B]);
  for (const how of ['cut', 'timeout']) {
    const c = consoleWith();
    c.start();
    c.send('share', [SHARE_ON()]); c.eose('share');
    c.send('copies', [COPY('evta', bodies.evta), COPY('evtbb', bodies.evtbb)]); c.eose('copies');
    c.send('events', [A]);                          // evtbb is still in the calendar; the read ends before it arrives
    c[how]('events');
    await c.settle();
    assert.deepEqual(c.tombs(), [], `${how}: HALF A CALENDAR WAS TAKEN AS ALL OF IT — a live event came off the church's website`);
    assert.deepEqual(c.writes(), [], how);
  }
});

test('(d) a share read cut off before its document, on a first watch, tombstones nothing', async () => {
  const bodies = await bodiesFor([A, B]);
  const c = consoleWith();
  c.start();
  c.send('copies', [COPY('evta', bodies.evta), COPY('evtbb', bodies.evtbb)]); c.eose('copies');
  c.send('events', [A, B]); c.eose('events');
  c.cut('share');                                   // the switch is ON at the relay; the read ended before it said so
  await c.settle();
  assert.deepEqual(c.tombs(), [], 'THE DEFAULT (calendar off) WAS TAKEN FOR THE CHURCH\'S SWITCH — every public event came off its website');
});

test('(e) an older copy arriving after a write does not trigger a second write', async () => {
  const c = consoleWith();
  c.start();
  const OLD = COPY('evta', '{"title":"an older body"}', 100);
  c.send('share', [SHARE_ON()]); c.send('events', [A]); c.send('copies', [OLD]);
  c.eoseAll();
  await c.settle();
  assert.deepEqual(c.writes(), ['trinityone/pubevent:evta'], 'the instrument: the stale body is replaced once');
  c.send('copies', [OLD]);                          // the same old copy again: a second relay's answer, or a replay
  await c.settle();
  assert.deepEqual(c.writes(), ['trinityone/pubevent:evta'], 'AN OLDER ECHO PUT THE OLD BODY BACK and the mirror wrote the copy again');
});

test('(f) a restart carries what it knew: a copies read cut off after a restart still lets a NEW event reach the website', async () => {
  const bodies = await bodiesFor([A, B]);
  const C = EV('evtccc', 'New year walk', 80);
  const c = consoleWith();
  c.start();
  c.send('share', [SHARE_ON()]); c.send('events', [A, B]); c.send('copies', [COPY('evta', bodies.evta), COPY('evtbb', bodies.evtbb)]);
  c.eoseAll();
  await c.settle();
  assert.deepEqual(c.published, []);
  c.reconnect(); c.start();                         // a connection bump: the dashboard restarts the watch
  c.send('copies', [COPY('evta', bodies.evta)]); c.cut('copies');
  c.reconnect();
  c.send('events', [A, B, C]); c.eose('events');
  c.send('share', [SHARE_ON()]); c.eose('share');
  await c.settle();
  assert.deepEqual(c.writes(), ['trinityone/pubevent:evtccc'],
    'the restart forgot what it knew: the new event was not published (or a carried copy was re-published)');
  assert.deepEqual(c.tombs(), []);
});

test('nothing carries into another epoch (a lock, a reset, a church switch): a restart there decides nothing until it reads', async () => {
  const bodies = await bodiesFor([A, B]);
  const c = consoleWith();
  c.start();
  c.send('share', [SHARE_ON()]); c.send('events', [A, B]); c.send('copies', [COPY('evta', bodies.evta), COPY('evtbb', bodies.evtbb)]);
  c.eoseAll();
  await c.settle();
  assert.ok(c.api._webDesired(c.api.web()) instanceof Map, 'the instrument: the first watch decides');
  c.api.bumpEpoch();
  c.start();
  const w = c.api.web();
  assert.equal(w.shareKnown || w.copiesKnown || w.eventsKnown, false, 'a flag from the old epoch was carried into the new one');
  assert.equal(w.copies.size, 0, 'copies read in the old epoch were carried into the new one');
  assert.equal(c.api._webDesired(w), null, 'a watch that has read nothing in this epoch must decide nothing');
});

test('an answer on a socket whose login the relay asked for and has not accepted is not taken; after the login it is', async () => {
  const c = consoleWith();
  c.start();
  c.relaysMap.get('wss://a/').challenge = 'chal';    // the relay withheld something and asked us to log in
  c.send('share', [SHARE_ON()]); c.send('events', [A, B]); c.eoseAll();
  await c.settle();
  const w = c.api.web();
  assert.equal(w.shareKnown || w.copiesKnown || w.eventsKnown, false, 'a read the relay held back for a login was taken as complete');
  assert.deepEqual(c.published, []);
  // the login is accepted: the reads asked again on it (the key reads' waiter set), and their answers now count
  c.scope._authAccepted.set('wss://a/', c.relaysMap.get('wss://a/'));
  for (const again of [...c.scope._keyReadAuthWaiters]) { c.scope._keyReadAuthWaiters.delete(again); again(); }
  c.send('share', [SHARE_ON()]); c.send('events', [A, B]); c.eoseAll();
  await c.settle();
  assert.equal(w.shareKnown && w.copiesKnown && w.eventsKnown, true, 'the reads were not asked again after the login');
  assert.deepEqual(c.writes().sort(), ['trinityone/pubevent:evta', 'trinityone/pubevent:evtbb']);
});
