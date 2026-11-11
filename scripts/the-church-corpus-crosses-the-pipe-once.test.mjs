// THE CHURCH CORPUS CROSSES THE PIPE ONCE — one feed, many screens.
//   Run: node --test scripts/the-church-corpus-crosses-the-pipe-once.test.mjs
//
// Measured 2026-11-11 on the slow-link rig (scripts/the-console-fits-a-real-church-on-a-slow-link.test.mjs): the
// console pulled ~12 MB per connect for a ~1 MB church because a dozen screens each asked every relay for the same two
// filters (everything the church signed, everything tagged for it). _corpusSub (src/steward.src.js) serves them from
// ONE feed per (church, view, epoch, relay set).
//
// Rule 1: everything here is LIFTED OUT OF THE SHIPPED BUNDLE (vendor/steward.js) — the feed, the per-relay reader it
// rides on (_webRead and the key reads' _keyReadOk), and two real screens' readers (subscribeFunds, subscribeSermons)
// — and driven over a fake pool that can answer, cut a socket, send a CLOSED, or let nostr-tools' timer fire.
// Nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchFilters } from 'nostr-tools/filter';
import { fnBody, stmt } from './test-slice.mjs';
import { _absorbById, _forgetById, _tombstoneTargets } from '../src/church-doc-store.src.js';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const A = 'a'.repeat(64), B = 'b'.repeat(64), NETK = 'e'.repeat(64);
const NET = 'trinityone';

function lift() {
  const src = STEWARD;
  const feedFns = ['_feedChurch', '_feedKey', '_feedCovers', '_feedDeliver', '_feedEose', '_feedDrop', '_feedStart', '_feedCheck',
    '_feedEvent', '_feedSettle', '_feedSubscribe', '_corpusSub', '_feedRenew'];
  const parts = [
    stmt(src, 'var NET = ', 'NET'), stmt(src, 'var FUND_D = ', 'FUND_D'), stmt(src, 'var SERMON_D = ', 'SERMON_D'),
    stmt(src, 'var _NO_EOSE_TIMER = ', '_NO_EOSE_TIMER'), stmt(src, 'var WEB_READ_IDLE_MS = ', 'WEB_READ_IDLE_MS'),
    stmt(src, 'var WEB_RESUME_MARGIN_S = ', 'WEB_RESUME_MARGIN_S'), stmt(src, 'var _viewingNetwork = ', '_viewingNetwork'),
    fnBody(src, 'function _keyReadAuthedOn', '_keyReadAuthedOn'), fnBody(src, 'function _keyReadOk', '_keyReadOk'),
    fnBody(src, 'function _keyReadAfterAuth', '_keyReadAfterAuth'), fnBody(src, 'function _keyReadConnected', '_keyReadConnected'),
    fnBody(src, 'function _webLoginPending', '_webLoginPending'), fnBody(src, 'function _webRead', '_webRead'),
    stmt(src, 'var FEED_IDLE_MS = ', 'FEED_IDLE_MS'), stmt(src, 'var _feed = ', '_feed'), stmt(src, 'var _corpusFilters = ', '_corpusFilters'),
    stmt(src, 'var _feedHead = ', '_feedHead'),
    ...feedFns.map(n => fnBody(src, 'function ' + n + '(', n)),
  ];
  const body = parts.join('\n');
  const methods = ['subscribeFunds(onFunds)', 'subscribeSermons(onSermons)'].map(sig => fnBody(src, sig + ' {', sig));
  // GUARD ON THE LIFT: the two screens must still read through the feed, or every row below proves nothing about them
  for (const m of methods) assert.match(m, /_corpusSub\(\[/, 'a lifted screen reader no longer calls _corpusSub — re-anchor this test');
  return { body, methods };
}

// A console over `urls`, every relay connected and signed in unless a row says otherwise.
function consoleWith(urls = ['wss://r1/']) {
  const { body, methods } = lift();
  const relaysMap = new Map(urls.map(u => [u, { connected: true, challenge: undefined }]));
  const subs = [], timers = [];
  let wall = 1_000_000;
  const pool = {
    relays: relaysMap,
    subscribeMany(us, filters, h) {
      const s = { urls: us.slice(), url: us[0], filters, h, closed: false, eosed: false, opened: wall, timerAt: wall + (h.maxWait || 4400) };
      s.eose = () => { if (s.eosed) return; s.eosed = true; h.oneose && h.oneose(); };
      s.close = () => { if (s.closed) return; s.closed = true; try { s.eose(); } catch {} try { h.onclose && h.onclose(['closed by caller']); } catch {} };
      subs.push(s);
      return { close: s.close };
    },
  };
  const st = { pub: A, actingChurch: '', churchPub: A, epoch: 0, urls: urls.slice() };
  const authAccepted = new Map([...relaysMap].map(([k, v]) => [k, v]));
  const scope = {
    pool, normalizeURL: (u) => u, _authAccepted: authAccepted, _keyReadAuthWaiters: new Set(),
    _absorbById, _forgetById, _tombstoneTargets, _consoleDisplay: () => true, _consoleChurchVoice: () => true,
    now: () => 1790000000, Date: { now: () => wall },
    setTimeout: (fn, ms) => { const t = { fn, ms, due: wall + ms, done: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
  };
  for (const n of new Set(body.match(/\bnormalizeURL\d*(?=\()/g) || [])) scope[n] = (u) => u;
  for (const n of new Set(body.match(/\bmatchFilters\d*(?=\()/g) || [])) scope[n] = matchFilters;
  const names = Object.keys(scope);
  // pub / actingChurch / churchPub / _keyReadEpoch / relays() are the console's own state, so they are getters here
  const api = new Function('ST', ...names, `
    let pub, actingChurch, churchPub, _keyReadEpoch;
    const relays = () => ST.urls.slice();
    const sync = () => { pub = ST.pub; actingChurch = ST.actingChurch; churchPub = ST.churchPub; _keyReadEpoch = ST.epoch; };
    sync();
    ${body}
    const R = ({ ${methods.join(',\n')} });
    return { sync, _corpusSub, _feedRenew, _feedCheck: () => _feedCheck(_feed), feed: () => _feed, subscribeFunds: R.subscribeFunds, subscribeSermons: R.subscribeSermons };
  `)(st, ...names.map(n => scope[n]));
  const corpusReqs = () => subs.filter(s => s.filters.length === 2 && s.filters[0].authors && s.filters[1]['#church']);
  const live = (url) => corpusReqs().filter(s => !s.closed && s.url === url).pop();
  const c = {
    api, subs, st, relaysMap, corpusReqs, live,
    set(changes) { Object.assign(st, changes); api.sync(); },
    send(url, events) { const s = live(url); assert.ok(s, 'no live corpus read on ' + url); for (const e of events) s.h.onevent(e); },
    eose(url) { const s = live(url); assert.ok(s, 'no live corpus read on ' + url); s.eose(); },
    // the relay closes the socket mid-stream: nostr-tools fires oneose then onclose in the same turn
    cut(url) { const s = live(url); s.closed = true; relaysMap.get(url).connected = false; s.eose(); s.h.onclose(['1009 too slow']); },
    // the relay sends CLOSED for the subscription and keeps the socket up
    closed(url) { const s = live(url); s.closed = true; s.eose(); s.h.onclose(['rate-limited']); },
    advance(ms) { wall += ms; for (const s of subs) if (!s.closed && !s.eosed && s.timerAt <= wall) s.eose(); for (const t of timers.slice()) if (!t.done && t.due <= wall) { t.done = true; t.fn(); } },
  };
  return c;
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
let n = 0;
const doc = (author, d, content, church) => ({ id: 'ev' + (++n), kind: 30078, pubkey: author, created_at: 1790000000 + n,
  tags: [['d', d], ['t', NET], ...(church ? [['church', church]] : [])], content: JSON.stringify(content) });
const reader = (filters = [{ kinds: [30078], authors: [A], '#t': [NET] }, { kinds: [30078], '#church': [A], '#t': [NET] }]) => {
  const r = { events: [], eoses: 0 };
  r.handlers = { onevent: (e) => r.events.push(e.id), oneose: () => { r.eoses++; } };
  r.filters = filters;
  return r;
};

test('two real screens (funds, sermons) open ONE corpus read per relay, and each gets its own documents', async () => {
  const c = consoleWith(['wss://r1/', 'wss://r2/']);
  let funds = [], sermons = [];
  c.api.subscribeFunds((l) => { funds = l; });
  c.api.subscribeSermons((l) => { sermons = l; });
  assert.equal(c.corpusReqs().length, 2, 'expected one corpus read per relay (2), got ' + c.corpusReqs().length);
  assert.deepEqual(c.corpusReqs().map(s => s.urls.length), [1, 1], 'each corpus read must be asked of ONE relay, so its end can be judged on its own');
  const f = doc(A, 'trinityone/fund:f1', { name: 'Roof' }), s = doc(A, 'trinityone/sermon:s1', { title: 'Grace', sha256: 'x' });
  c.send('wss://r1/', [f, s]); c.send('wss://r2/', [f, s]);
  await flush();
  assert.deepEqual(funds.map(x => x.name), ['Roof']);
  assert.deepEqual(sermons.map(x => x.title), ['Grace']);
  // a third screen later: no new request, its documents replayed from the store
  let funds2 = [];
  c.api.subscribeFunds((l) => { funds2 = l; });
  assert.equal(c.corpusReqs().length, 2, 'a later screen opened its own corpus read');
  await flush();
  assert.deepEqual(funds2.map(x => x.name), ['Roof'], 'a later screen was not handed what the feed already holds');
});

test('a reader hears oneose only once EVERY connected relay has genuinely ended; a later joiner gets it after its replay, asynchronously', async () => {
  const c = consoleWith(['wss://r1/', 'wss://r2/']);
  const r1 = reader();
  c.api._corpusSub(r1.filters, r1.handlers);
  c.send('wss://r1/', [doc(A, 'trinityone/fund:x', {})]);
  c.eose('wss://r1/');
  await flush();
  assert.equal(r1.eoses, 0, 'oneose before the second relay answered');
  c.eose('wss://r2/');
  await flush();
  assert.equal(r1.eoses, 1);
  // late joiner: nothing synchronously (its handlers may name its own sub), then the replay, then oneose
  const r2 = reader();
  let sub = null, sawSub = false;
  r2.handlers.onevent = (e) => { sawSub = sawSub || !!sub; r2.events.push(e.id); };
  sub = c.api._corpusSub(r2.filters, r2.handlers);
  assert.equal(r2.events.length, 0, 'the replay ran synchronously, before the caller had its subscription');
  await flush();
  assert.equal(r2.events.length, 1); assert.ok(sawSub, 'the handler ran before `sub` was assigned');
  assert.equal(r2.eoses, 1, 'a reader joining a settled feed never heard oneose');
});

test('a cut-off, a CLOSED or the library timer is not an end: no oneose while the relay is still owed', async () => {
  // one relay, the socket cut part-way
  {
    const c = consoleWith(['wss://r1/']);
    const r = reader(); c.api._corpusSub(r.filters, r.handlers);
    c.send('wss://r1/', [doc(A, 'trinityone/fund:x', {})]);
    c.cut('wss://r1/');
    await flush();
    assert.equal(r.eoses, 0, 'a socket cut part-way was taken as the end of the church');
  }
  // two relays: one answers, the other sends CLOSED and keeps its socket up — it is asked again, and only its answer ends it
  {
    const c = consoleWith(['wss://r1/', 'wss://r2/']);
    const r = reader(); c.api._corpusSub(r.filters, r.handlers);
    c.eose('wss://r1/');
    c.closed('wss://r2/');
    await flush();
    assert.equal(r.eoses, 0, 'a CLOSED from a connected relay was taken as its answer');
    c.advance(2000);   // the key reads' backoff: r2 is asked again
    await flush();
    assert.equal(c.corpusReqs().filter(s => s.url === 'wss://r2/').length, 2, 'the relay that sent CLOSED was not asked again');
    c.eose('wss://r2/');
    await flush();
    assert.equal(r.eoses, 1);
  }
  // a relay not yet connected when asked keeps the library's timer — and that timer is not an answer
  {
    const c = consoleWith(['wss://r1/']);
    c.relaysMap.get('wss://r1/').connected = false;
    const r = reader(); c.api._corpusSub(r.filters, r.handlers);
    c.advance(4400);
    await flush();
    assert.equal(r.eoses, 0, 'nostr-tools\' EOSE timer was taken as an answer');
  }
});

test('a relay that is DOWN does not hold every screen back for ever (the everyRelay hang), once another relay answered', async () => {
  const c = consoleWith(['wss://r1/', 'wss://down/']);
  const r = reader(); c.api._corpusSub(r.filters, r.handlers);
  c.cut('wss://down/');
  c.eose('wss://r1/');
  await flush();
  assert.equal(r.eoses, 1);
});

test('a church switch drops the feed: nothing read for church A reaches anyone afterwards, and church B is read afresh', async () => {
  const c = consoleWith(['wss://r1/']);
  const ra = reader(); c.api._corpusSub(ra.filters, ra.handlers);
  const oldReq = c.live('wss://r1/');
  c.set({ pub: B, actingChurch: B, epoch: 1 });   // setActiveIdentity: delegated into B, a new epoch
  c.api._feedCheck();
  assert.ok(oldReq.closed, 'church A\'s corpus read was left open after the switch');
  oldReq.h.onevent(doc(A, 'trinityone/fund:late', {}));   // anything still in flight from A's read
  await flush();
  assert.equal(ra.events.length, 0, 'church A\'s reader was handed something after the switch');
  const rb = reader([{ kinds: [30078], authors: [B], '#t': [NET] }]);
  c.api._corpusSub(rb.filters, rb.handlers);
  const bReq = c.live('wss://r1/');
  assert.ok(bReq && bReq !== oldReq && bReq.filters[0].authors[0] === B, 'church B was not read afresh');
  c.send('wss://r1/', [doc(B, 'trinityone/fund:b', {})]);
  await flush();
  assert.equal(rb.events.length, 1);
  assert.equal(ra.events.length, 0, 'church B\'s document reached church A\'s reader');
  // church A's reader filters cannot be served by B's feed either
  const ra2 = reader(); c.api._corpusSub(ra2.filters, ra2.handlers);
  await flush();
  assert.equal(ra2.events.length, 0, 'B\'s store was replayed to a reader asking for church A');
});

test('the network view is its own church; a reader for the console\'s own church is not covered there and reads on its own', async () => {
  const c = consoleWith(['wss://r1/']);
  c.set({ pub: NETK, actingChurch: '', churchPub: A });   // viewing an owned network
  const before = c.subs.length;
  const care = reader();   // the Care module asks for actingChurch || churchPub = A
  c.api._corpusSub(care.filters, care.handlers);
  assert.equal(c.subs.length, before + 1);
  const own = c.subs[c.subs.length - 1];
  assert.deepEqual(own.urls, ['wss://r1/'], 'an uncovered reader must go to the pool over relays(), as before');
  assert.equal(c.api.feed(), null, 'a feed was opened for a reader the feed does not cover');
});

test('a change of the relay set or the epoch alone is a NEW generation for the same readers; a shrunk set is not read', async () => {
  const c = consoleWith(['wss://r1/', 'wss://r2/']);
  const r = reader(); c.api._corpusSub(r.filters, r.handlers);
  c.eose('wss://r1/'); c.eose('wss://r2/');
  await flush();
  const r2old = c.live('wss://r2/');
  c.set({ urls: ['wss://r1/'] });          // r2 is removed from the set
  c.api._feedCheck();
  assert.ok(r2old.closed, 'the feed stayed open over a relay that was removed');
  r2old.h.onevent(doc(A, 'trinityone/fund:from-removed', {}));
  await flush();
  assert.ok(!r.events.length, 'a removed relay\'s event reached a reader');
  c.send('wss://r1/', [doc(A, 'trinityone/fund:y', {})]);
  c.eose('wss://r1/');
  await flush();
  assert.equal(r.events.length, 1, 'the reader was not carried to the new generation');
  assert.equal(r.eoses, 2, 'the new generation did not settle for the reader');
  c.set({ epoch: 5 });                     // a reset for the same church
  c.api._feedCheck();
  assert.equal(c.corpusReqs().filter(s => !s.closed).length, 1, 'a new epoch did not re-read the church');
});

test('feedRenew (a reconnect) asks every relay again into an EMPTY store; no `since`', async () => {
  const c = consoleWith(['wss://r1/']);
  const r = reader(); c.api._corpusSub(r.filters, r.handlers);
  c.send('wss://r1/', [doc(A, 'trinityone/fund:old', {})]); c.eose('wss://r1/');
  await flush();
  const before = c.live('wss://r1/');
  c.api._feedRenew();
  const after = c.live('wss://r1/');
  assert.ok(before.closed && after && after !== before, 'feedRenew did not open a fresh read');
  assert.ok(!after.filters.some(f => f.since), 'a reconnect resumed with `since` (owner decision: a fresh generation)');
  const late = reader(); c.api._corpusSub(late.filters, late.handlers);
  await flush();
  assert.equal(late.events.length, 0, 'the old generation\'s store was replayed after a reconnect');
  assert.equal(late.eoses, 0, 'a reader heard oneose from the new generation before any relay answered');
});

test('close is final and ref-counted; the last reader leaving lets the feed go after FEED_IDLE_MS', async () => {
  const c = consoleWith(['wss://r1/']);
  const r1 = reader(), r2 = reader();
  const s1 = c.api._corpusSub(r1.filters, r1.handlers);
  const s2 = c.api._corpusSub(r2.filters, r2.handlers);
  await flush();
  s1.close();
  c.send('wss://r1/', [doc(A, 'trinityone/fund:z', {})]); c.eose('wss://r1/');
  await flush();
  assert.equal(r1.events.length + r1.eoses, 0, 'a closed reader was handed something');
  assert.equal(r2.events.length, 1);
  const req = c.live('wss://r1/');
  s2.close();
  c.advance(1000);
  assert.ok(!req.closed, 'the feed closed the moment its last reader left (a screen change would download the church again)');
  const r3 = reader(); const s3 = c.api._corpusSub(r3.filters, r3.handlers);
  await flush();
  assert.equal(r3.events.length, 1, 'a reader arriving within the idle window did not re-use the feed');
  s3.close();
  c.advance(60000);
  assert.ok(req.closed, 'the feed outlived its readers past FEED_IDLE_MS');
});

test('only filters inside the corpus are served; a limit, another kind or no #t goes to the pool unchanged', async () => {
  const c = consoleWith(['wss://r1/']);
  const covered = [
    [{ kinds: [30078], '#church': [A], '#t': [NET] }],
    [{ kinds: [30078], authors: [A], '#t': [NET], '#d': ['trinityone/fund:x'] }],
  ];
  const uncovered = [
    [{ kinds: [30078], authors: [A], '#t': [NET], limit: 5 }],
    [{ kinds: [1, 30078], authors: [A], '#t': [NET] }],
    [{ kinds: [30078], authors: [A] }],
    [{ kinds: [30078], '#p': [A], '#t': [NET] }],
    [{ kinds: [30078], authors: [A, B], '#t': [NET] }],
  ];
  for (const f of covered) { const k = c.subs.length; c.api._corpusSub(f, {}); assert.ok(c.subs.length - k <= 1); }
  const feedReqs = c.subs.length;
  for (const f of uncovered) { const k = c.subs.length; c.api._corpusSub(f, {}); assert.equal(c.subs.length, k + 1, 'not passed to the pool: ' + JSON.stringify(f)); assert.deepEqual(c.subs[k].filters, f); }
  assert.equal(c.corpusReqs().length, 1, 'expected exactly one corpus read for the covered readers');
  assert.ok(feedReqs >= 1);
  // a '#church'-only reader sees only what its filter matches, never the church's own unrelated documents
  const tagged = reader([{ kinds: [30078], '#church': [A], '#t': [NET] }]);
  c.api._corpusSub(tagged.filters, tagged.handlers);
  c.send('wss://r1/', [doc(A, 'trinityone/fund:own', {}), doc('f'.repeat(64), 'trinityone/slot:n:2026-01-01', {}, A)]);
  await flush();
  assert.equal(tagged.events.length, 1, 'a reader was handed a document its own filters do not match');
});
