// ONE EVENT THIS CONSOLE CANNOT OPEN MUST NOT TAKE THE WHOLE WEBSITE DOWN WITH IT — AND MUST BE SAID.
//   Run: node --test scripts/one-unreadable-event-does-not-park-the-whole-website.test.mjs
//
// AUDIT-feeds-phase1-2026-09-22 F3. _webDesired answered `null` — "decide nothing" — the moment ANY event
// failed to open, and _webSync then retried 60 × 2 s and stopped. So a single unreadable event parked the
// mirror for the whole session: no event ever reached the church's website again, while Settings → Your
// website went on reading "On" and nothing anywhere said why. A church that re-minted its name key with the
// old one lost is in exactly that state (the 2026-08-04 restore incident), and so is any console holding a
// document it cannot read for any other reason.
//
// Two halves, both measured rather than argued:
//   1. THE ENGINE, out of the shipped vendor/steward.js (memory: tests-must-drive-shipped-code — this file
//      lifts _webSync and _webDesired themselves, never a copy of their logic): one unreadable event among
//      two good ones leaves the two published, does NOT tombstone the unreadable one's existing copy — that
//      would take a perfectly good event off the church's website because this console lost a key — and
//      reports one blocked event, with why, once the retries are spent.
//   2. THE SCREEN (CLAUDE.md rule 1), by executing the real DashWebsitePanel out of app/stew-dashboard.jsx
//      and reading the tree: the count and the reason are on the page, and are absent when nothing is
//      blocked. Deleting the line from the panel fails this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { encrypt as nip44e } from 'nostr-tools/nip44';
import { fnBody, stmt } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
const KEY_OURS = 'a1'.repeat(32), KEY_LOST = 'b2'.repeat(32);
const sealed = (obj, key) => JSON.stringify({ e: nip44e(JSON.stringify(obj), unhex(key)) });

// ── the mirror, lifted out of the bundle ─────────────────────────────────────────────────────────────────
function mirror({ events, copies, share }) {
  const src = STEWARD;
  const body = [
    stmt(src, 'var WEB_ID_OK = ', 'WEB_ID_OK'),
    stmt(src, 'var WEB_BLOCKED_AFTER = ', 'WEB_BLOCKED_AFTER'),
    fnBody(src, 'function _sealIsWhole', '_sealIsWhole'),
    fnBody(src, 'function _webWhyStuck', '_webWhyStuck'),
    fnBody(src, 'function _openChurchDoc', '_openChurchDoc'),
    fnBody(src, 'function _webCopyBody', '_webCopyBody'),
    fnBody(src, 'function _webEmit', '_webEmit'),
    fnBody(src, 'function _webDesired', '_webDesired'),
    fnBody(src, 'async function _webSync', '_webSync'),
  ].join('\n');
  // GUARDS ON THE LIFT: an assertion below would pass over nothing at all if these stopped being here.
  assert.match(body, /for \(const \[id, body\] of want\)/, 'vendor/steward.js: _webSync no longer walks `want` — re-anchor this test');
  assert.match(body, /_openChurchDoc\(ev\.raw\)/, 'vendor/steward.js: _webDesired no longer opens the event document');
  assert.equal((fnBody(src, 'async function _webSync', '_webSync').match(/tombs\.push\(id\)/g) || []).length, 1,
    'vendor/steward.js: the tombstone push is not where this test thinks it is');

  const published = [];
  const emitted = [];
  const w = {
    pub: 'CP', share, shareTs: 1, shareKnown: true,
    events: new Map(events.map(e => [e.id, e])), versions: new Map(), eventsKnown: true,
    copies: new Map(Object.entries(copies)), copyTs: new Map(), copiesKnown: true,
    subs: [], listeners: new Set([(snap) => emitted.push(snap)]), busy: false, again: false, timer: null,
    lockedTries: 0, stuck: new Set(), stuckWhy: '', blocked: 0,
  };
  const scope = {
    _web: w, pub: 'CP', sk: 'SK', actingChurch: '',
    _nameKeyRing: [KEY_OURS],
    _unhex: unhex,
    NET: 'trinityone', PUBEVENT_D: 'trinityone/pubevent:',
    now: () => 1790000000,
    feChurch: (tmpl) => tmpl,
    publish: async (evt) => { published.push(evt); return true; },
    _webQueueSync: () => { scope.queued++; },
    queued: 0,
    setTimeout: (fn, ms) => { scope.timers.push(ms); return 0; },
    timers: [],
  };
  // esbuild RENAMES the nip44 import inside the bundle (`decrypt3` at the time of writing), so the decrypt
  // this console actually uses is read out of the lifted code rather than guessed — a hard-coded name would
  // silently make every event unreadable on the next rebuild, which is precisely the state under test.
  const dec = (body.match(/return JSON\.parse\((\w+)\(ct,/) || [])[1];
  assert.ok(dec, 'vendor/steward.js: _openChurchDoc no longer decrypts the way this test reads it — re-anchor');
  scope[dec] = (ct, k) => require44().decrypt(ct, k);
  const names = Object.keys(scope);
  const api = new Function(...names, `${body}\nreturn { _webSync, _webDesired, w: _web };`)(...names.map(n => scope[n]));
  return { ...api, published, emitted, scope, w,
    dtags: () => published.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]),
    tombstoned: () => published.filter(e => e.tags.some(t => t[0] === 'deleted')).map(e => (e.tags.find(t => t[0] === 'd') || [])[1]) };
}
// nostr-tools/nip44 is ESM; the lifted code calls nip44d synchronously, so hand it the real decrypt.
let _n44 = null;
function require44() { return _n44; }
const share = (over = {}) => ({ calendar: true, sermons: false, plans: false, optOut: [], optIn: [], address: 'own', ...over });

const GOOD1 = { id: 'evtsupper', raw: sealed({ title: 'Harvest supper', date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '' }, KEY_OURS), ts: 10 };
const GOOD2 = { id: 'evtfair', raw: sealed({ title: 'Christmas fair', date: '2026-12-05', time: '', where: 'The green', blurb: '' }, KEY_OURS), ts: 11 };
const LOST = { id: 'evtlost', raw: sealed({ title: 'Old meeting', date: '2026-11-01', time: '10:00', where: 'The vestry', blurb: '' }, KEY_LOST), ts: 12 };
const JUNK = { id: 'evtjunk', raw: 'not a document at all', ts: 13 };
// R4's other two causes. DAMAGED: the key is fine and the stored text is not a whole payload (truncated).
// CONTENTS: it unseals with the key we hold and what comes out is not an event.
const DAMAGED = { id: 'evtdamaged', raw: JSON.stringify({ e: JSON.parse(GOOD1.raw).e.slice(0, 40) }), ts: 14 };
const CONTENTS = { id: 'evtcontents', raw: JSON.stringify({ e: nip44e('this is not json at all', unhex(KEY_OURS)) }), ts: 15 };

test('before all: the real nip44', async () => { _n44 = await import('nostr-tools/nip44'); assert.ok(_n44.decrypt); });

test('one event sealed under a key this console no longer holds: the other two are still published', async () => {
  const m = mirror({ events: [GOOD1, LOST, GOOD2], copies: {}, share: share() });
  await m._webSync();
  assert.deepEqual(m.dtags().sort(), ['trinityone/pubevent:evtfair', 'trinityone/pubevent:evtsupper'],
    'THE WHOLE MIRROR PARKED ON ONE UNREADABLE EVENT — it published ' + JSON.stringify(m.dtags()));
  assert.deepEqual(m.tombstoned(), [], 'nothing should have been tombstoned here');
  assert.deepEqual([...m.w.stuck], ['evtlost']);
});

test('its existing public copy is LEFT ALONE — losing a key must not take a live event off the website', async () => {
  const live = JSON.stringify({ title: 'Old meeting', date: '2026-11-01', time: '10:00', where: 'The vestry', blurb: '', recur: '', day: null });
  const m = mirror({ events: [GOOD1, LOST], copies: { evtlost: live }, share: share() });
  await m._webSync();
  assert.deepEqual(m.tombstoned(), [], 'THE UNREADABLE EVENT\'S LIVE COPY WAS TOMBSTONED — the church\'s website lost an event because this console lost a key');
  assert.deepEqual(m.dtags(), ['trinityone/pubevent:evtsupper'], 'the readable event was not published beside it');
});

test('a copy that genuinely should not exist is still tombstoned — the skip is for the stuck id alone', async () => {
  const m = mirror({ events: [GOOD1], copies: { evtgone: JSON.stringify({ title: 'Cancelled', date: '2026-10-09' }) }, share: share() });
  await m._webSync();
  assert.deepEqual(m.tombstoned(), ['trinityone/pubevent:evtgone'], 'a copy with no event behind it is no longer withdrawn');
});

test('the steward is told, with a reason, once the retries are spent — and not before', async () => {
  const m = mirror({ events: [GOOD1, LOST], copies: {}, share: share() });
  await m._webSync();
  assert.equal(m.emitted.length, 0, 'the first sync already cried wolf — the name key is usually merely late');
  for (let i = 0; i < 5; i++) await m._webSync();
  const last = m.emitted[m.emitted.length - 1];
  assert.ok(last, 'THE STEWARD IS NEVER TOLD: the mirror is skipping an event and nothing is emitted');
  assert.equal(last.blocked, 1, 'the snapshot reports ' + (last && last.blocked) + ' blocked events, not 1');
  assert.equal(last.blockedWhy, 'key', 'a document sealed under a key we do not hold must be reported as a key problem');
  assert.equal(last.calendar, true, 're-anchor: the snapshot stopped carrying the switch');
});

test('a document that is not a document at all is reported as such', async () => {
  const m = mirror({ events: [GOOD1, JUNK], copies: {}, share: share() });
  for (let i = 0; i < 6; i++) await m._webSync();
  const last = m.emitted[m.emitted.length - 1];
  assert.equal(last.blockedWhy, 'shape', 'an unparseable document was reported as a missing key');
  assert.deepEqual(m.dtags(), ['trinityone/pubevent:evtsupper'], 'the good event was not published alongside it');
});

// ── R4: each cause is named, and only the one that happened ──────────────────────────────────────────────
// AUDIT-feeds-round2-2026-09-22. _webWhyStuck asked only whether the document HAD a string `.e` field, so
// 'key' meant "it looked sealed and we could not open it" and the page turned that into "it is sealed with a
// church key this console does not have" — measured false for a damaged copy and for a document that
// unsealed perfectly and held no event. A church chasing a name key it already holds is the cost.
test('R4: each of the four causes is reported as itself, not all as a missing key', async () => {
  const causes = [[LOST, 'key'], [DAMAGED, 'damaged'], [CONTENTS, 'contents'], [JUNK, 'shape']];
  for (const [ev, why] of causes) {
    const m = mirror({ events: [GOOD1, ev], copies: {}, share: share() });
    for (let i = 0; i < 6; i++) await m._webSync();
    const last = m.emitted[m.emitted.length - 1];
    assert.ok(last, ev.id + ': the steward is never told at all');
    assert.equal(last.blocked, 1, ev.id + ': ' + last.blocked + ' blocked, not 1');
    assert.equal(last.blockedWhy, why, `${ev.id} IS REPORTED AS "${last.blockedWhy}" WHEN WHAT HAPPENED IS "${why}"`);
    assert.deepEqual(m.dtags(), ['trinityone/pubevent:evtsupper'], ev.id + ': the readable event was not published beside it');
  }
  // CONTROL, and the point of the whole round: 'damaged' and 'contents' used to be 'key'.
  assert.notEqual(causes[1][1], 'key'); assert.notEqual(causes[2][1], 'key');
});

test('R4: two stuck events of DIFFERENT causes do not have one of them named for both', async () => {
  for (const pair of [[LOST, JUNK], [JUNK, LOST], [DAMAGED, CONTENTS]]) {
    const m = mirror({ events: [GOOD1, ...pair], copies: {}, share: share() });
    for (let i = 0; i < 6; i++) await m._webSync();
    const last = m.emitted[m.emitted.length - 1];
    assert.equal(last.blocked, 2, 'two events should be blocked, not ' + last.blocked);
    assert.equal(last.blockedWhy, 'mixed',
      `TWO CAUSES, ONE NAMED: the page would say "${pair.map(p => p.id).join(' + ')}" are both "${last.blockedWhy}"`);
  }
  // CONTROL: two stuck events of the SAME cause still name that cause.
  const same = mirror({ events: [GOOD1, LOST, { ...LOST, id: 'evtlost2' }], copies: {}, share: share() });
  for (let i = 0; i < 6; i++) await same._webSync();
  assert.equal(same.emitted[same.emitted.length - 1].blockedWhy, 'key', 'two of one cause stopped naming it');
});

test('CONTROL: with every event readable nothing is blocked and nothing is emitted', async () => {
  const m = mirror({ events: [GOOD1, GOOD2], copies: {}, share: share() });
  for (let i = 0; i < 6; i++) await m._webSync();
  assert.equal(m.w.blocked, 0);
  assert.deepEqual(m.emitted.map(e => e.blocked), [], 'a healthy mirror told the steward something was wrong');
});

// ── the screen: the real DashWebsitePanel ────────────────────────────────────────────────────────────────
function panel(snapshot) {
  // The slice starts at the WHY TABLE, not at the component: the sentences live in a module-level const
  // beside it and a slice that began at `function DashWebsitePanel` would render into a ReferenceError.
  const from = DASH.indexOf('const WEB_BLOCKED_WHY = {');
  assert.notEqual(from, -1, 'app/stew-dashboard.jsx: WEB_BLOCKED_WHY is gone — re-anchor this lift');
  assert.ok(from < DASH.indexOf('function DashWebsitePanel({ church }) {'), 're-anchor: the why table moved below the panel');
  const JS = transformSync(DASH.slice(from, DASH.indexOf('window.DashWebsitePanel = DashWebsitePanel;')),
    { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect(fn) { try { fn(); } catch (e) {} }, useRef: () => ({ current: null }), useMemo: (f) => f(),
    Fragment: 'Frag',
  };
  const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });
  const win = { Steward: { subscribeWebsiteShare: (cb) => { cb(snapshot); return () => {}; }, websiteFeedUrl: () => 'https://church.example/public/npub1x/calendar.ics', setWebsiteShare: async () => true } };
  const scope = { React, h, Frag: 'Frag', Icon: () => null, Panel: (p) => h('panel', p), copyText: () => true, window: win };
  const names = Object.keys(scope);
  const mod = new Function(...names, JS + '\nreturn { DashWebsitePanel };')(...names.map(n => scope[n]));
  const nodes = (n, out = []) => {
    if (!n || typeof n !== 'object') return out;
    if (Array.isArray(n)) { n.forEach(x => nodes(x, out)); return out; }
    out.push(n);
    if (typeof n.type === 'function') { try { nodes(n.type(n.props), out); } catch (e) {} return out; }
    nodes(n.props && n.props.children, out); return out;
  };
  const text = (n) => (typeof n === 'string' || typeof n === 'number') ? String(n)
    : (n && n.props ? [].concat(n.props.children || []).map(text).join('') : '');
  // TWO PASSES, like the real thing: the panel starts with `share` null and learns it from the engine in an
  // effect. One pass would only ever read the "still loading" tree, which says nothing about anything.
  idx = 0; mod.DashWebsitePanel({ church: {} });
  idx = 0;
  return nodes(mod.DashWebsitePanel({ church: {} })).map(text).join(' | ');
}

test('THE SCREEN: Settings → Your website says how many events could not be published, and why', () => {
  const said = panel({ ...share(), known: true, blocked: 1, blockedWhy: 'key' });
  assert.match(said, /1 event could not be published/, 'THE PAGE SAYS NOTHING about the event the mirror skipped — the switch reads "On" and one event is silently missing from the church\'s website');
  assert.match(said, /no church key on this console will open it/, 'the page gives no reason');
  const two = panel({ ...share(), known: true, blocked: 2, blockedWhy: 'shape' });
  assert.match(two, /2 events could not be published/, 'the count is not the engine\'s');
  assert.match(two, /details could not be read/, 'the reason is not the engine\'s');
});

test('THE SCREEN (R4): every cause gets its own line, and none of them sends a church after a key it holds', () => {
  // Rule 1, the point of use: these sentences are the ONLY place a church learns what happened. The four
  // causes must read as four different things, and the three that are not about a key must not mention one.
  const said = (why, n = 1) => panel({ ...share(), known: true, blocked: n, blockedWhy: why });
  assert.match(said('damaged'), /its saved copy is damaged/, 'a DAMAGED copy is not named as damaged');
  assert.match(said('contents'), /it opened, but there was no event inside/, 'a document that OPENED is not said to have opened');
  assert.match(said('shape'), /its details could not be read/);
  assert.match(said('key'), /no church key on this console will open it/);
  for (const why of ['damaged', 'contents', 'shape']) {
    assert.doesNotMatch(said(why), /church key/,
      `"${why}" STILL SENDS THE CHURCH LOOKING FOR A NAME KEY — the key is fine and the console said it was not`);
  }
  // it is also not allowed to CLAIM the key is missing when it cannot know that (a wrong key and a flipped
  // byte inside a whole payload fail the identical check)
  assert.doesNotMatch(said('key'), /does not have|missing/, 'the "key" line asserts a cause it cannot distinguish');
  // and the four lines are four different sentences, singular and plural
  for (const n of [1, 2]) {
    const lines = ['key', 'damaged', 'contents', 'shape'].map(w => said(w, n).match(/could not be published — ([^|]*?)(?:Served from|$)/)[1].trim());
    assert.equal(new Set(lines).size, 4, 'two causes draw the same sentence at n=' + n + ': ' + JSON.stringify(lines));
  }
  assert.match(said('mixed', 2), /more than one reason/, 'two different causes are reported as one of them');
  // an unknown cause from a newer engine still says something rather than "undefined"
  assert.match(said('something-new'), /its details could not be read/, 'an unrecognised cause renders as undefined');
});

test('CONTROL: with nothing blocked the page says nothing of the kind', () => {
  const said = panel({ ...share(), known: true, blocked: 0, blockedWhy: '' });
  assert.doesNotMatch(said, /could not be published/, 'the page cries wolf on a healthy church');
  assert.match(said, /Share our calendar on our website/, 're-anchor: the panel did not render at all');
});
