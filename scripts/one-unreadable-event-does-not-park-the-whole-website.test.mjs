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
//      and reading the tree: the count, the reason, and how many are still published anyway are on the page,
//      and are absent when nothing is blocked. Deleting either line from the panel fails this file.
//
// AND THE THIRD ROUND (AUDIT-feeds-round3-2026-09-22 F1) — the withdrawal this file's R5 rows introduced was
// too wide, too fast, and blind to the state it mattered most in. Its rows are `F1a` (a whole-church event
// stays; a church's calendar never empties itself), `F1b` (the budget is wall clock, not a count of syncs
// that relay chatter can spend in ~15 s) and `F1c` (a key ring that has not ARRIVED is not a key that is
// GONE). The clock the engine reads is injected here, so nothing in this file proves elapsed time by
// calling _webSync in a loop.
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
// `ring` is the array the lifted code reads as _nameKeyRing and it is mutated IN PLACE by the rows below, so
// a test can start with an empty ring (the key has not arrived) and hand it over later. `tick(seconds)`
// moves the clock the engine reads through now(); nothing here advances by counting syncs, because after
// AUDIT-feeds-round3 F1 the engine does not either.
// `at` starts this watch's clock at a given second instead of the default, so a row can run SEVERAL watches
// over one storage and one moving wall clock — which is what a console whose relay flaps actually is.
function mirror({ events, copies, share, ring = [KEY_OURS], store = new Map(), at = 1790000000 }) {
  const src = STEWARD;
  const body = [
    stmt(src, 'var WEB_ID_OK = ', 'WEB_ID_OK'),
    stmt(src, 'var WEB_BLOCKED_AFTER_S = ', 'WEB_BLOCKED_AFTER_S'),
    stmt(src, 'var WEB_GIVE_UP_S = ', 'WEB_GIVE_UP_S'),
    stmt(src, 'var WEB_RETRY_MS = ', 'WEB_RETRY_MS'),
    stmt(src, 'var WEB_GROUP_MAX = ', 'WEB_GROUP_MAX'),
    fnBody(src, 'function _nameKeyReady', '_nameKeyReady'),
    fnBody(src, 'function _webGroupKey', '_webGroupKey'),
    fnBody(src, 'function _webGroupLoad', '_webGroupLoad'),
    fnBody(src, 'function _webGroupSeen', '_webGroupSeen'),
    fnBody(src, 'function _webStuckKey', '_webStuckKey'),
    fnBody(src, 'function _webStuckLoad', '_webStuckLoad'),
    fnBody(src, 'function _webStuckClock', '_webStuckClock'),
    stmt(src, 'var SEAL_B64 = ', 'SEAL_B64'),
    fnBody(src, 'function _sealIsWhole', '_sealIsWhole'),
    fnBody(src, 'function _webWhyStuck', '_webWhyStuck'),
    fnBody(src, 'function _openChurchDoc', '_openChurchDoc'),
    fnBody(src, 'function _webCopyBody', '_webCopyBody'),
    fnBody(src, 'function _webSnap', '_webSnap'),
    fnBody(src, 'function _webEmit', '_webEmit'),
    fnBody(src, 'function _webDesired', '_webDesired'),
    fnBody(src, 'async function _webSync', '_webSync'),
  ].join('\n');
  // …and the SHIPPED writers, as the object methods they are, so a row can drive the whole loop a steward
  // does: press the Settings control, then tick the event back on in its own editor, then sync. They are the
  // half AUDIT-feeds-round5-2026-09-22 F1 is about, and nothing here re-implements them.
  const writers = [
    stmt(src, 'var WEB_DEFAULT = ', 'WEB_DEFAULT'),
    stmt(src, 'var SHARE_D = ', 'SHARE_D'),
    stmt(src, 'var _webIds = ', '_webIds'),
    fnBody(src, 'function _webNormalise', '_webNormalise'),
    fnBody(src, 'function _webOneList', '_webOneList'),
  ].join('\n');
  const methods = [
    fnBody(src, 'async setWebsiteShare(patch) {', 'setWebsiteShare'),
    fnBody(src, 'setWebsiteHeld(eventId, held) {', 'setWebsiteHeld'),
    fnBody(src, 'setWebsiteHeldMany(eventIds) {', 'setWebsiteHeldMany'),
    fnBody(src, 'setWebsiteShown(eventId, shown) {', 'setWebsiteShown'),
    fnBody(src, 'isWebsiteHeld(eventId) {', 'isWebsiteHeld'),
    fnBody(src, 'isWebsiteShown(eventId) {', 'isWebsiteShown'),
  ].join(',\n');
  // GUARDS ON THE LIFT: an assertion below would pass over nothing at all if these stopped being here.
  assert.match(body, /for \(const \[id, body\] of want\)/, 'vendor/steward.js: _webSync no longer walks `want` — re-anchor this test');
  assert.match(body, /_openChurchDoc\(ev\.raw\)/, 'vendor/steward.js: _webDesired no longer opens the event document');
  assert.equal((fnBody(src, 'async function _webSync', '_webSync').match(/tombs\.push\(id\)/g) || []).length, 1,
    'vendor/steward.js: the tombstone push is not where this test thinks it is');
  assert.match(body, /_nameKeyReady\(\)/, 'vendor/steward.js: _webSync no longer asks whether the key ring has arrived — re-anchor (F1)');
  assert.match(body, /w\.groupSeen\.has\(id\)/, 'vendor/steward.js: the withdrawal no longer consults what this console knows is group-scoped — re-anchor (F1)');

  const published = [];
  const emitted = [];
  let clock = at;
  const w = {
    pub: 'CP', share, shareTs: 1, shareKnown: true,
    events: new Map(events.map(e => [e.id, e])), versions: new Map(), eventsKnown: true,
    copies: new Map(Object.entries(copies)), copyTs: new Map(), copiesKnown: true,
    subs: [], listeners: new Set([(snap) => emitted.push(snap)]), busy: false, again: false, timer: null,
    stuckSince: 0, keyedSince: 0, groupSeen: new Set(), stuckAt: new Map(), stuck: new Set(), stuckWhy: '', blocked: 0, held: 0, heldIds: [],
  };
  const scope = {
    _web: w, pub: 'CP', sk: 'SK', actingChurch: '',
    _nameKeyRing: ring,
    _unhex: unhex,
    lsGet: (k) => (store.has(k) ? store.get(k) : null), lsSet: (k, v) => store.set(k, v),
    NET: 'trinityone', PUBEVENT_D: 'trinityone/pubevent:',
    now: () => clock,
    feChurch: (tmpl) => tmpl,
    publish: async (evt) => { published.push(evt); return true; },
    _webQueueSync: () => { scope.queued++; },
    _webEnsure: () => w,
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
  const api = new Function(...names, `${body}\n${writers}\nreturn { _webSync, _webDesired, _webGroupLoad, _webStuckLoad, _webNormalise, w: _web, steward: { ${methods} } };`)(...names.map(n => scope[n]));
  w.groupSeen = api._webGroupLoad('CP');   // as _webEnsure does: what this console remembered before it restarted
  w.stuckAt = api._webStuckLoad('CP');     // …and how long it had already been shut when the last watch stopped
  return { ...api, published, emitted, scope, w, ring, store,
    tick: (seconds) => { clock += seconds; },
    // the share: document as it last reached the relay — what a SECOND console would read, not this one's copy
    shareDoc: () => { const e = [...published].reverse().find(x => String((x.tags.find(t => t[0] === 'd') || [])[1] || '').includes('share:')); return e ? JSON.parse(e.content) : null; },
    live: () => published.filter(e => !e.tags.some(t => t[0] === 'deleted')).map(e => (e.tags.find(t => t[0] === 'd') || [])[1]).filter(d => String(d).startsWith('trinityone/pubevent:')),
    dtags: () => published.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]),
    tombstoned: () => published.filter(e => e.tags.some(t => t[0] === 'deleted')).map(e => (e.tags.find(t => t[0] === 'd') || [])[1]) };
}
// Long enough to be past WEB_GIVE_UP_S whatever it is set to, without this file hard-coding the number.
const GIVE_UP_S = +(stmt(STEWARD, 'var WEB_GIVE_UP_S = ', 'WEB_GIVE_UP_S').match(/=\s*(\d+)/) || [])[1];
const BLOCKED_AFTER_S = +(stmt(STEWARD, 'var WEB_BLOCKED_AFTER_S = ', 'WEB_BLOCKED_AFTER_S').match(/=\s*(\d+)/) || [])[1];
// Two syncs with the clock moved between them. That is ALL it should ever take, and the row below that says
// so is the one that would fail if the budget went back to counting calls.
const spendBudget = async (m) => { await m._webSync(); m.tick(GIVE_UP_S + 1); await m._webSync(); };
const pastReporting = async (m) => { await m._webSync(); m.tick(BLOCKED_AFTER_S + 1); await m._webSync(); };
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
// The R5 pair: THE SAME EVENT, readable and then not. A `groupId` lives only in the sealed document, so the
// readable copy is the console's one and only chance to learn that this event belongs to a room.
const YOUTH = { title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', groupId: 'grpyouth' };
const GROUP_READABLE = { id: 'evtyouth', raw: sealed(YOUTH, KEY_OURS), ts: 16 };
// THE SAME VERSION, and that is the point: losing a name key does not rewrite the church's document. The
// created_at is the copy's identity (AUDIT-feeds-round4-2026-09-22 F4), so R5's "readable, then not" is one
// version that stopped opening — a DIFFERENT ts would be a different copy, which is F4's case, not this one.
const GROUP_LOST = { id: 'evtyouth', raw: sealed(YOUTH, KEY_LOST), ts: 16 };

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

test('the steward is told, with a reason, once it has been stuck a few seconds — and not before', async () => {
  const m = mirror({ events: [GOOD1, LOST], copies: {}, share: share() });
  await m._webSync();
  assert.equal(m.emitted.length, 0, 'the first sync already cried wolf — the name key is usually merely late');
  for (let i = 0; i < 40; i++) await m._webSync();
  assert.equal(m.emitted.length, 0, 'FORTY SYNCS IN NO TIME AT ALL CRIED WOLF — relay chatter, not elapsed time, is deciding when the page speaks');
  await pastReporting(m);
  const last = m.emitted[m.emitted.length - 1];
  assert.ok(last, 'THE STEWARD IS NEVER TOLD: the mirror is skipping an event and nothing is emitted');
  assert.equal(last.blocked, 1, 'the snapshot reports ' + (last && last.blocked) + ' blocked events, not 1');
  assert.equal(last.blockedWhy, 'key', 'a document sealed under a key we do not hold must be reported as a key problem');
  assert.equal(last.calendar, true, 're-anchor: the snapshot stopped carrying the switch');
});

test('a document that is not a document at all is reported as such', async () => {
  const m = mirror({ events: [GOOD1, JUNK], copies: {}, share: share() });
  await pastReporting(m);
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
    await pastReporting(m);
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
    await pastReporting(m);
    const last = m.emitted[m.emitted.length - 1];
    assert.equal(last.blocked, 2, 'two events should be blocked, not ' + last.blocked);
    assert.equal(last.blockedWhy, 'mixed',
      `TWO CAUSES, ONE NAMED: the page would say "${pair.map(p => p.id).join(' + ')}" are both "${last.blockedWhy}"`);
  }
  // CONTROL: two stuck events of the SAME cause still name that cause.
  const same = mirror({ events: [GOOD1, LOST, { ...LOST, id: 'evtlost2' }], copies: {}, share: share() });
  await pastReporting(same);
  assert.equal(same.emitted[same.emitted.length - 1].blockedWhy, 'key', 'two of one cause stopped naming it');
});

// ── F2: a TRUNCATED copy is damaged, and is not reported as a key the church already holds ───────────────
// AUDIT-feeds-round3-2026-09-22 F2. The R4 rows above use a 40-character fixture, which is below NIP-44's
// own 132-character minimum and so was caught by the length bound alone. A real truncation is not like that:
// it is hundreds of characters of valid base64, it looked whole, and it was reported as 'key'. Measured over
// every truncation length of a real 1,456-character sealed document, driving the shipped _webWhyStuck:
// 994 of 1,456 (68.3%) said 'key'. These rows sweep the same thing.
function whyStuck(atobImpl) {
  const body = [
    stmt(STEWARD, 'var SEAL_B64 = ', 'SEAL_B64'),
    fnBody(STEWARD, 'function _sealIsWhole', '_sealIsWhole'),
    fnBody(STEWARD, 'function _webWhyStuck', '_webWhyStuck'),
  ].join('\n');
  assert.match(body, /_sealIsWhole\(o\.e\)/, 'vendor/steward.js: _webWhyStuck no longer asks whether the payload is whole — re-anchor');
  const dec = (body.match(/(\w+)\(o\.e, _unhex\(k\)\)/) || [])[1];
  assert.ok(dec, 'vendor/steward.js: _webWhyStuck no longer decrypts the way this row reads it — re-anchor');
  const scope = { _nameKeyRing: [KEY_OURS], _unhex: unhex, [dec]: (ct, k) => require44().decrypt(ct, k), atob: atobImpl };
  const names = Object.keys(scope);
  return new Function(...names, `${body}\nreturn _webWhyStuck;`)(...names.map(n => scope[n]));
}
// A long blurb, so the payload is long enough for a truncation to be a realistic corruption rather than a
// stub. Sealed under the key this console does NOT hold, so 'key' is the answer the old code gave.
const LONG_SEALED = () => nip44e(JSON.stringify({ title: 'Harvest supper', date: '2026-10-03', time: '19:30', where: 'The hall', blurb: 'The Harvest supper is in the church hall. '.repeat(20) }), unhex(KEY_LOST));

test('F2: a truncated copy is DAMAGED, not a key the church is still holding', async () => {
  const why = whyStuck(globalThis.atob);
  const real = LONG_SEALED();
  assert.ok(real.length > 1000, 're-anchor: the fixture payload is too short for this sweep to mean anything');
  const tally = {};
  for (let n = 1; n < real.length; n++) {
    const r = why(JSON.stringify({ e: real.slice(0, n) }));
    tally[r] = (tally[r] || 0) + 1;
  }
  // What is left is arithmetic, not luck: a truncation is only indistinguishable from a whole payload when
  // its length is a multiple of 4 AND the bytes it decodes to land on 67 + a multiple of 32 — one length in
  // every 128. Anything much above that means the shape checks have stopped biting.
  const allowed = Math.ceil(real.length / 128) + 1;
  assert.ok((tally.key || 0) <= allowed,
    `${tally.key} OF ${real.length} TRUNCATION LENGTHS TELL THE CHURCH TO FIND A NAME KEY IT ALREADY HOLDS (at most ${allowed} are genuinely indistinguishable): ${JSON.stringify(tally)}`);
  // the two the audit names by hand
  assert.equal(why(JSON.stringify({ e: real.slice(0, 200) })), 'damaged', 'a 200-character truncation is still blamed on a key');
  assert.equal(why(JSON.stringify({ e: real.slice(0, 600) })), 'damaged', 'a 600-character truncation is still blamed on a key');
  // CONTROL: the whole payload, which really is a key problem, is still a key problem.
  assert.equal(why(JSON.stringify({ e: real })), 'key', 'a document sealed under a key we do not hold stopped being reported as a key problem');
});

test('F2 CONTROL: no REAL sealed document is ever called damaged — the way to get this fix wrong', async () => {
  // The over-correction this row exists to catch: tightening the shape check until a perfectly good document
  // sealed under a lost key reads as "damaged", which would tell a church its data is corrupt when it is not.
  const why = whyStuck(globalThis.atob);
  const bad = [];
  for (const len of [1, 2, 31, 32, 33, 64, 100, 255, 256, 257, 1000, 4095, 4096, 10000, 65535]) {
    const ct = nip44e('y'.repeat(len), unhex(KEY_LOST));
    if (why(JSON.stringify({ e: ct })) !== 'key') bad.push(len + ' -> ' + why(JSON.stringify({ e: ct })));
  }
  for (let len = 1; len <= 600; len++) {
    const ct = nip44e('z'.repeat(len), unhex(KEY_LOST));
    if (why(JSON.stringify({ e: ct })) !== 'key') bad.push(len + ' -> ' + why(JSON.stringify({ e: ct })));
  }
  assert.deepEqual(bad, [], 'A GENUINELY LOST KEY IS NOW REPORTED AS A DAMAGED COPY for these plaintext lengths: ' + bad.slice(0, 8).join(', '));
  // …and one this console CAN open is still read as its contents, not its shape
  assert.equal(why(JSON.stringify({ e: nip44e('not json at all', unhex(KEY_OURS)) })), 'contents', 're-anchor: a document that opens is no longer classified by what was inside');
});

test('F2: the VERSION BYTE is checked — a payload this console cannot read is not blamed on a key', async () => {
  // AUDIT-feeds-round4-2026-09-22 F6: of the three shape rules in _sealIsWhole this was the only one with no
  // row over it, and the audit's scoped sabotage removing it left this file 26 pass / 0 fail. Re-measured
  // here at 95ea16c, before this row existed: `if (raw.charCodeAt(0) !== 2)` neutered -> 41 pass / 0 fail,
  // silent. NIP-44 has exactly one version, 2, and '#' is its own marker for a version nobody reads. A
  // payload whose first byte says something else did not fail because of a key and must not be called one.
  const why = whyStuck(globalThis.atob);
  const real = LONG_SEALED();
  const bytes = Uint8Array.from(globalThis.atob(real), c => c.charCodeAt(0));
  // Only the version byte changes: the length, the charset and the 67+32n rule are all still satisfied, so
  // this row can only be answering on the version byte.
  const reversion = (v) => { const b = bytes.slice(); b[0] = v; return globalThis.btoa(String.fromCharCode(...b)); };
  assert.equal(why(JSON.stringify({ e: reversion(2) })), 'key', 're-anchor: rewriting the payload broke it before the version byte could be read');
  for (const v of [0, 1, 3, 255]) {
    assert.equal(why(JSON.stringify({ e: reversion(v) })), 'damaged',
      `A SEALED PAYLOAD MARKED VERSION ${v} IS REPORTED AS A MISSING CHURCH KEY — no key of any church would open it, and the church is sent looking for one`);
  }
  assert.equal(why(JSON.stringify({ e: real })), 'key', 're-anchor: an untouched payload sealed under a lost key stopped being a key problem');
});

test('F2: the answer does not depend on which base64 decoder the browser happens to have', async () => {
  // `atob` is WHATWG "forgiving-base64" in some engines (it accepts a length of 4n+2 and 4n+3) and strict in
  // others, and the console runs in whichever browser the church opened. Before this fix the same truncated
  // copy was classified 'damaged' in one and 'key' in another. THREE decoders, not two, because node's own
  // `atob` — which the rows above use and which 6c38421's table called "STRICT" — is itself the FORGIVING
  // one: measured, atob('QUJDRA') (length 4n+2) and atob('QUJDRAA') (4n+3) both decode rather than throw.
  // Driving 6c38421's BEFORE bundle over every truncation length of this fixture: node's atob 993 of 1,455
  // lengths said 'key' (68.2%), a genuinely strict decoder 331 (22.7%), Buffer.from 1,324 (90.9%). The
  // length/charset check is made in our own code now, so all three must agree.
  const real = LONG_SEALED();
  const forgiving = whyStuck(globalThis.atob);
  const lenient = whyStuck((s) => Buffer.from(s, 'base64').toString('binary'));
  const strict = whyStuck((s) => {
    if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw new Error('invalid base64');
    return globalThis.atob(s);
  });
  const diff = [];
  for (let n = 1; n < real.length; n++) {
    const raw = JSON.stringify({ e: real.slice(0, n) });
    const a = forgiving(raw), b = lenient(raw), c = strict(raw);
    if (a !== b || a !== c) diff.push(`${n}: ${a} vs ${b} vs ${c}`);
  }
  assert.deepEqual(diff, [], 'THE CHURCH IS TOLD A DIFFERENT STORY IN A DIFFERENT BROWSER, for ' + diff.length + ' truncation lengths, e.g. ' + diff.slice(0, 3).join(' | '));
});

// ── R5: F2's safeguarding default versus F3's "leave a stuck copy alone" ─────────────────────────────────
// AUDIT-feeds-round2-2026-09-22 R5, measured: an ADULTS-ONLY GROUP EVENT already on the public feed — put
// there by a console older than c878df1, when group events went on by default — whose sealed document later
// becomes unopenable is never withdrawn by the mirror, and the relay has no rule for it because it cannot see
// a groupId. It stays on the church's public website for ever. The two commits were written an hour apart.
//
// THE RULE, in the shape AUDIT-feeds-round3-2026-09-22 F1 narrowed it to. While the console is still within
// its budget nothing changes: the name key is usually merely LATE, and row 3 above is exactly that case.
// Once the budget is spent — TEN MINUTES OF WALL CLOCK with the key ring present and the document still shut
// — a copy comes off IF this console can tell it is a group's event, and not otherwise:
//
//   * group-scoped, in the only sense the console can know it: an id it has OPENED and found a `groupId` on,
//     remembered per church in localStorage. That is the migration case R5 is about — the console published
//     the copy, so it could read the document then.
//   * UNLESS the owner ticked it "On the website", the one positive statement a church has made about a
//     group event being public.
//   * anything else — a whole-church event, or an id this console has never been able to open at all —
//     STAYS, and the Settings page says how many are still out there. The first version withdrew those too,
//     and a church with an empty key ring lost its ENTIRE public calendar (F1a, five of five).
test('R5: a stuck copy of a GROUP event comes off the website once the console has stopped waiting', async () => {
  const live = JSON.stringify({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', recur: '', day: null });
  // THE WHOLE SEQUENCE, because only the first step can tell the console whose event this is. The owner
  // ticked the youth group's event onto the website, so the copy is there legitimately and the console has
  // opened the document and seen its groupId. Then the name key goes. Then the owner takes the tick off —
  // from a phone-installed console, or this one — and the console must still get it off a public website
  // even though it can no longer read a word of it.
  const m = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: live }, share: share({ optIn: ['evtyouth'] }) });
  await m._webSync();
  assert.deepEqual([...m.w.groupSeen.keys()], ['evtyouth'], 'the console did not remember whose event this is while it could still read it');
  assert.deepEqual(m.tombstoned(), [], 're-anchor: a ticked-on group event was withdrawn while it was perfectly readable');
  m.w.events.set('evtyouth', GROUP_LOST);        // …and now the name key is gone
  m.w.share.optIn = [];                          // …and the owner takes it off the website
  await m._webSync();
  assert.deepEqual(m.tombstoned(), [], 'THE FIRST SYNC ALREADY WITHDREW IT — the name key is usually merely late, and this is row 3\'s case');
  await spendBudget(m);
  assert.deepEqual(m.tombstoned(), ['trinityone/pubevent:evtyouth'],
    'AN ADULTS-ONLY GROUP EVENT STAYS ON THE CHURCH\'S PUBLIC WEBSITE for ever because this console cannot open it — nothing else withdraws it, the relay cannot see a groupId, and the owner may not know it is there');
  assert.deepEqual(m.dtags().filter(d => !m.tombstoned().includes(d)), ['trinityone/pubevent:evtsupper'], 'the readable event stopped being published');
});

test('R5: …but a stuck copy the owner DID tick "On the website" is left alone, however long it stays shut', async () => {
  const live = JSON.stringify({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', recur: '', day: null });
  const m = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: live }, share: share({ optIn: ['evtyouth'] }) });
  await m._webSync();
  m.w.events.set('evtyouth', GROUP_LOST);
  await spendBudget(m);
  assert.deepEqual(m.tombstoned(), [],
    'THE OWNER TICKED THIS EVENT ONTO THE WEBSITE and the console took it off anyway because it could not read it');
});

// ── F1: the three ways the withdrawal used to be wrong ───────────────────────────────────────────────────
// AUDIT-feeds-round3-2026-09-22 F1, all three measured against the shipped bundle before this fix.
test('F1a: a WHOLE-CHURCH event whose key is gone STAYS on the website — a church\'s calendar never empties itself', async () => {
  const ids = ['evta', 'evtb', 'evtc', 'evtd', 'evte'];
  const bodyOf = (id) => JSON.stringify({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '', recur: '', day: null });
  const evOf = (id) => ({ id, raw: sealed({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '' }, KEY_LOST), ts: 10 });
  const m = mirror({ events: ids.map(evOf), copies: Object.fromEntries(ids.map(i => [i, bodyOf(i)])), share: share() });
  await spendBudget(m);
  assert.deepEqual(m.tombstoned(), [],
    'THE CHURCH\'S ENTIRE PUBLIC CALENDAR EMPTIED ITSELF because one console cannot read it — five of five whole-church events withdrawn (F1a)');
  // …and it is SAID, not silently left: the church is told both halves.
  const last = m.emitted[m.emitted.length - 1];
  assert.equal(last.blocked, 5, 'the page does not say how many could not be published');
  assert.equal(last.held, 5, 'THE PAGE DOES NOT SAY THEY ARE STILL PUBLISHED — the console left five events on a public website and told nobody');
});

test('F1b: the budget is ELAPSED TIME, not a count of syncs — relay chatter cannot spend it', async () => {
  // _webQueueSync debounces at 250 ms and is called from all three subscriptions' onevent/oneose as well as
  // from setWebsiteShare/Held/Shown, so a budget of 60 CALLS could be spent by ordinary post-EOSE traffic in
  // about 15 seconds. This row drives 500 syncs with the clock standing still.
  const live = JSON.stringify({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', recur: '', day: null });
  const m = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: live }, share: share({ optIn: ['evtyouth'] }) });
  await m._webSync();
  m.w.events.set('evtyouth', GROUP_LOST);
  m.w.share.optIn = [];
  for (let i = 0; i < 500; i++) await m._webSync();
  assert.deepEqual(m.tombstoned(), [],
    'FIVE HUNDRED SYNCS IN NO TIME AT ALL SPENT THE BUDGET — a chatty relay, not a long wait, is deciding to withdraw a church\'s event');
  // the same watch, once the clock really moves
  m.tick(GIVE_UP_S + 1); await m._webSync();
  assert.deepEqual(m.tombstoned(), ['trinityone/pubevent:evtyouth'], 'CONTROL: the budget never expires at all now');
});

test('F1c: a key that has NOT ARRIVED is not a key that is gone — a late ring spends no budget and empties nothing', async () => {
  // _nameKeyRing starts empty on every boot and is filled by a separate subscription. Before this fix the two
  // states were indistinguishable to _webSync: measured, an empty ring took all three of a church's events
  // off its public website. Here the documents are sealed under the key this console is ABOUT to receive.
  const ids = ['evta', 'evtb', 'evtc'];
  const bodyOf = (id) => JSON.stringify({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '', recur: '', day: null });
  const evOf = (id) => ({ id, raw: sealed({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '' }, KEY_OURS), ts: 10 });
  const m = mirror({ events: ids.map(evOf), copies: Object.fromEntries(ids.map(i => [i, bodyOf(i)])), share: share(), ring: [] });
  await m._webSync();
  m.tick(GIVE_UP_S * 6); await m._webSync();                       // an hour of a console waiting on its key
  assert.deepEqual(m.tombstoned(), [],
    'A KEY THAT WAS MERELY LATE EMPTIED THE CHURCH\'S WEBSITE — "the envelope has not arrived" and "the key is gone" are the same state to the mirror (F1c)');
  assert.equal(m.w.keyedSince, 0, 'the give-up clock started while the key ring was still empty');
  // and when it does arrive, everything comes back
  m.ring.push(KEY_OURS);
  await m._webSync();
  assert.equal(m.w.stuck.size, 0, 'the events did not become readable when the key arrived');
  assert.deepEqual(m.tombstoned(), [], 'the key arriving withdrew something');
});

test('F1: a copy this console has NEVER been able to open is left alone and said, not withdrawn', async () => {
  // The honest limit of the fix, stated as a test: the migration case R5 is about is only knowable when this
  // console once read the document. An id it has never opened is UNKNOWN, not "whole-church" — and unknown
  // stays on the website. Deleting `w.groupSeen.has(id)` from the engine turns this row red.
  const live = JSON.stringify({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', recur: '', day: null });
  const m = mirror({ events: [GOOD1, LOST], copies: { evtlost: live }, share: share() });
  await spendBudget(m);
  assert.deepEqual(m.tombstoned(), [], 'a copy this console has never opened was withdrawn on a guess');
  assert.equal(m.emitted[m.emitted.length - 1].held, 1, 'the page does not say the unclassifiable copy is still out there');
});

test('F1: what this console knows about an event SURVIVES A RESTART — it is the restart that loses the key', async () => {
  const live = JSON.stringify({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', recur: '', day: null });
  const store = new Map();
  const first = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: live }, share: share({ optIn: ['evtyouth'] }), store });
  await first._webSync();
  assert.equal(store.get('trinityone.webgroup.CP'), '[["evtyouth",' + GROUP_READABLE.ts + ']]', 'nothing was written where the next boot would read it');
  // a NEW console object over the same storage, and this time the key never opens the document
  const next = mirror({ events: [GOOD1, GROUP_LOST], copies: { evtyouth: live }, share: share(), store });
  assert.deepEqual([...next.w.groupSeen.keys()], ['evtyouth'], 'the new watch did not read back what the last one learned');
  await spendBudget(next);
  assert.deepEqual(next.tombstoned(), ['trinityone/pubevent:evtyouth'], 'the remembered answer was not used after the restart');
});

test('F1: an event edited from a GROUP back to whole-church is forgotten, so a later key loss does not withdraw it', async () => {
  const live = JSON.stringify({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', recur: '', day: null });
  const m = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: live }, share: share({ optIn: ['evtyouth'] }) });
  await m._webSync();
  assert.deepEqual([...m.w.groupSeen.keys()], ['evtyouth'], 're-anchor: it was never remembered as a group\'s event');
  m.w.events.set('evtyouth', { id: 'evtyouth', raw: sealed({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '' }, KEY_OURS), ts: 20 });
  await m._webSync();
  assert.deepEqual([...m.w.groupSeen.keys()], [], 'a group event made whole-church is still remembered as a group\'s');
  m.w.events.set('evtyouth', GROUP_LOST);
  await spendBudget(m);
  assert.deepEqual(m.tombstoned(), [], 'a WHOLE-CHURCH event was withdrawn on a memory of what it used to be');
});

// ── F2: `held` is the number of copies that are STILL BEING SERVED, and nothing else ─────────────────────
// AUDIT-feeds-round4-2026-09-22 F2. This number is what the second Settings sentence counts — "N of them are
// still on your website" — and no row constrained it: a scoped sabotage that changed it left this file
// 26/26/0. It also understated in the state that matters most. A copy this console KNOWS is group-scoped is
// deliberately left up for the whole ten minutes, and it was counted into neither half, so the page said
// "1 event could not be published" and stayed silent about the adults-only copy that was still public —
// permanently so on a console whose relay flaps (F3 below).
const LIVE_YOUTH = JSON.stringify({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', recur: '', day: null });
test('F2: a group copy still up during the ten minutes is COUNTED as still on the website', async () => {
  const m = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }) });
  await m._webSync();                                     // read once: the only moment the scope can be learned
  m.w.events.set('evtyouth', GROUP_LOST);                 // …and now the name key is gone
  m.w.share.optIn = [];
  await pastReporting(m);
  const said = m.emitted[m.emitted.length - 1];
  assert.deepEqual(m.tombstoned(), [], 're-anchor: the copy came off before the ten minutes were up');
  assert.equal(said.blocked, 1, 're-anchor: the page does not say the event could not be published');
  assert.equal(said.held, 1,
    'THE PAGE SAYS ONE EVENT COULD NOT BE PUBLISHED AND NOTHING ABOUT THE COPY THAT IS STILL PUBLIC — held reads ' + said.held +
    ', so a church reading the screen is told an adults-only copy is gone when it is still being served');
  // …and once the ten minutes really are spent and the copy comes off, the number goes back to nought
  m.tick(GIVE_UP_S + 1); await m._webSync();
  assert.deepEqual(m.tombstoned(), ['trinityone/pubevent:evtyouth'], 're-anchor: the withdrawal stopped happening');
  assert.equal(m.emitted[m.emitted.length - 1].held, 0, 'the page claims a copy that was withdrawn is still on the website');
});

test('F2: a copy the owner ticked "Not on the website" is NOT counted as still on the website', async () => {
  // The relay drops an opted-out copy at serve time — scripts/gateway.mjs publicFeed filters the church's
  // copies by share.optOut before it builds anything — so a copy with the tick on is NOT on the website,
  // whatever the relay still holds. This is also the number the control beside the sentence acts on, so a
  // count that went on including the ids it had just taken off would leave the line claiming them for ever.
  const m = mirror({ events: [GOOD1, LOST], copies: { evtlost: LIVE_YOUTH }, share: share({ optOut: ['evtlost'] }) });
  await pastReporting(m);
  const said = m.emitted[m.emitted.length - 1];
  assert.equal(said.blocked, 1, 're-anchor: the page does not say the event could not be published');
  assert.equal(said.held, 0,
    'THE PAGE SAYS A COPY THE RELAY NO LONGER SERVES IS STILL ON THE WEBSITE — held reads ' + said.held);
  // CONTROL: the identical copy without the tick IS counted, so the row above is not passing on an accident
  const m2 = mirror({ events: [GOOD1, LOST], copies: { evtlost: LIVE_YOUTH }, share: share() });
  await pastReporting(m2);
  assert.equal(m2.emitted[m2.emitted.length - 1].held, 1, 'a stuck copy that IS being served stopped being counted');
});

// ── F4: a remembered scope cannot outlive the document it was read from ──────────────────────────────────
// AUDIT-feeds-round4-2026-09-22 F4, measured: an id this console once opened and found a `groupId` on, later
// edited to whole-church by ANOTHER console while this one could no longer read it, was withdrawn after ten
// minutes — an ordinary church event silently off the public website, taken off by the one console that had
// lost its key. What the console knows is the scope of a VERSION of the document, so that is what it
// remembers; a newer version it cannot open is UNKNOWN, and unknown has stayed on the website since round 3.
const WHOLE_NOW_LOST = (ts) => ({ id: 'evtyouth', raw: sealed({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '' }, KEY_LOST), ts });
test('F4: an event edited to whole-church while the key was gone is NOT withdrawn on the old memory', async () => {
  const m = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }) });
  await m._webSync();
  assert.equal(m.w.groupSeen.has('evtyouth'), true, 're-anchor: the console never learned this was a group\'s event');
  m.w.events.set('evtyouth', WHOLE_NOW_LOST(GROUP_READABLE.ts + 40));   // a NEWER version, and unopenable here
  m.w.share.optIn = [];
  await spendBudget(m);
  assert.deepEqual(m.tombstoned(), [],
    'A WHOLE-CHURCH EVENT WAS TAKEN OFF THE CHURCH\'S WEBSITE on a memory of a version of the document that no longer exists — by the one console that had lost its key');
  assert.equal(m.emitted[m.emitted.length - 1].held, 1, '…and the page does not say the copy is still out there either');
  // CONTROL: the SAME version, merely unopenable — which is what losing a key actually looks like, and the
  // whole point of R5 — still comes off.
  const same = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }) });
  await same._webSync();
  same.w.events.set('evtyouth', GROUP_LOST);
  same.w.share.optIn = [];
  await spendBudget(same);
  assert.deepEqual(same.tombstoned(), ['trinityone/pubevent:evtyouth'], 're-anchor: the R5 withdrawal stopped happening at all');
});

test('F4: the version travels with the memory across a restart', async () => {
  // The memory is on disk, so the staleness is too: a console that reads back "evtyouth was a group's" must
  // also read back WHICH copy of evtyouth that was true of, or the first boot after an edit acts on a guess.
  const store = new Map();
  const first = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }), store });
  await first._webSync();
  assert.equal(store.get('trinityone.webgroup.CP'), '[["evtyouth",' + GROUP_READABLE.ts + ']]',
    'what is written for the next boot does not say which version it was true of: ' + store.get('trinityone.webgroup.CP'));
  const next = mirror({ events: [GOOD1, WHOLE_NOW_LOST(GROUP_READABLE.ts + 40)], copies: { evtyouth: LIVE_YOUTH }, share: share(), store });
  await spendBudget(next);
  assert.deepEqual(next.tombstoned(), [], 'THE STALE MEMORY SURVIVED THE RESTART AND WITHDREW A WHOLE-CHURCH EVENT');
  // CONTROL: the same restart with the document untouched still withdraws (the R5 migration case).
  const store2 = new Map();
  const f2 = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }), store: store2 });
  await f2._webSync();
  const n2 = mirror({ events: [GOOD1, GROUP_LOST], copies: { evtyouth: LIVE_YOUTH }, share: share(), store: store2 });
  await spendBudget(n2);
  assert.deepEqual(n2.tombstoned(), ['trinityone/pubevent:evtyouth'], 're-anchor: nothing is withdrawn after a restart any more');
});

// ── F3: ten minutes of WALL CLOCK, not ten minutes of one uninterrupted session ──────────────────────────
// AUDIT-feeds-round4-2026-09-22 F3. The clock lived only in the watch, and the dashboard rebuilds the watch
// on every connection bump (`_maybeBumpConn`, a 90 s heartbeat plus focus/visibility/online). So a console
// on a thin pipe reset it every time: measured against e0ffd10's bundle, 0 tombstones over 108 simulated
// minutes on a nine-minute restart cycle. The commit that set the budget framed the restart-reset as a
// safety property; it is also the failure mode, and it lands on exactly the churches this product is aimed
// at — the ones whose stranded copy will live longest.
//
// Each session below is a SEPARATE watch over one storage and one moving wall clock, which is what a
// flapping console actually is.
const flap = async ({ sessions, minutes, ring, store, t0 = 1790000000, events = [GOOD1, GROUP_LOST] }) => {
  const hit = []; let t = t0;
  for (let n = 1; n <= sessions; n++) {
    const m = mirror({ events, copies: { evtyouth: LIVE_YOUTH }, share: share(), store, at: t, ...(ring ? { ring } : {}) });
    await m._webSync();
    m.tick(minutes * 60);
    await m._webSync();
    if (m.tombstoned().length) hit.push(n);
    t += minutes * 60;
  }
  return hit;
};
test('F3: a relay that flaps every nine minutes no longer prevents the withdrawal for ever', async () => {
  const store = new Map();
  // one session that could still read it — the only moment a console can learn whose event this is
  const first = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }), store });
  await first._webSync();
  assert.deepEqual([...first.w.groupSeen.keys()], ['evtyouth'], 're-anchor: the console never learned this was a group\'s event');
  const hit = await flap({ sessions: 12, minutes: 9, store });
  assert.ok(hit.length,
    'A FLAPPING RELAY PREVENTS THE WITHDRAWAL FOR EVER — twelve nine-minute sessions, 108 minutes of an adults-only room on a public website, and nothing was ever withdrawn');
  assert.equal(hit[0], 2, 'the withdrawal took ' + hit[0] + ' nine-minute sessions, not the 2 that ten minutes of wall clock needs');
});

test('F3 CONTROL: a key that has NOT ARRIVED still spends nothing, however many restarts', async () => {
  // AUDIT-feeds-round3 F1c, which a persisted clock must not undo. With an empty ring every event in the
  // church's calendar is "stuck" and the cause is that the envelope is in flight, not that anything is lost.
  // Nothing may be written down either — a clock started while the ring was empty would be spent by the time
  // the ring arrived, which is the same bug wearing a hat.
  const store = new Map();
  const first = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }), store });
  await first._webSync();
  const hit = await flap({ sessions: 12, minutes: 9, store, ring: [] });
  assert.deepEqual(hit, [],
    'A CONSOLE WAITING ON ITS NAME KEY WITHDREW AN EVENT ANYWAY — "the envelope has not arrived" and "the key is gone" are the same state again');
  assert.equal(store.get('trinityone.webstuck.CP') || '[]', '[]', 'the give-up clock was started and written down while the key ring was still empty');
  // CONTROL: the identical cycle WITH the ring does withdraw, so the row above is not passing on an accident
  const store2 = new Map();
  const f2 = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }), store: store2 });
  await f2._webSync();
  assert.ok((await flap({ sessions: 12, minutes: 9, store: store2 })).length, 're-anchor: the flap never withdraws anything at all now');
});

test('F3: a name-key envelope still in flight PAUSES a clock that is already running', async () => {
  // The bullet the first version of this fix claimed and did not have. Guarding only the CREATION of an
  // entry behind the ring left a clock ALREADY ON DISK accruing through the whole wait, so a console that
  // cold-booted onto a thin pipe with nine minutes already spent withdrew the copy seconds after its ring
  // landed — total observation with a ring in hand and the document shut: about seven seconds. MEASURED
  // against the bundle at 1e05677: 600 s with an empty ring, then 7 s with the key, tombstoned the copy.
  // _nameKeyRing starts EMPTY on every cold boot and is filled by a separate subscription, and the three
  // streams this watch reads can reach EOSE before that envelope lands — so this is the ordinary shape of a
  // slow start, not a corner. A ring that has not arrived must not only fail to start the clock; it must
  // stop the one that is running.
  const store = new Map();
  const first = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }), store });
  await first._webSync();
  const stuck = mirror({ events: [GOOD1, GROUP_LOST], copies: { evtyouth: LIVE_YOUTH }, share: share(), store, at: 1790001000 });
  await stuck._webSync(); stuck.tick(9 * 60); await stuck._webSync();          // nine minutes, written down
  assert.ok(String(store.get('trinityone.webstuck.CP') || '').includes('evtyouth'), 're-anchor: nothing was written down to carry over');
  // …and now a cold boot: the same console, the same storage, the name-key envelope still in flight
  const cold = mirror({ events: [GOOD1, GROUP_LOST], copies: { evtyouth: LIVE_YOUTH }, share: share(), store, ring: [], at: 1790001540 });
  await cold._webSync();
  assert.equal(store.get('trinityone.webstuck.CP'), '[]',
    'THE CLOCK WENT ON RUNNING WHILE THE KEY RING WAS EMPTY — the wait for the envelope is being counted as time the document was shut');
  cold.tick(GIVE_UP_S); await cold._webSync();
  assert.deepEqual(cold.tombstoned(), [], 're-anchor: waiting for the envelope withdrew something by itself');
  cold.ring.push(KEY_OURS);                                                    // the envelope lands; it still will not open
  cold.tick(BLOCKED_AFTER_S + 1); await cold._webSync();
  assert.deepEqual(cold.tombstoned(), [],
    'A CONSOLE WITHDREW THE COPY SECONDS AFTER ITS KEY RING LANDED, on a budget it spent waiting for that very ring');
  // …and the ten minutes then run from the moment the ring was in hand, as they are meant to
  cold.tick(GIVE_UP_S + 1); await cold._webSync();
  assert.deepEqual(cold.tombstoned(), ['trinityone/pubevent:evtyouth'], 're-anchor: the clock never starts again once it has been paused');
});

test('F3: the persisted clock is cleared the moment the document opens again', async () => {
  // Ten UNBROKEN minutes. A console that was stuck for nine minutes, read the document, and lost it again
  // must wait a fresh ten — not act on the nine it remembered from before the key came back.
  const store = new Map();
  const first = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }), store });
  await first._webSync();
  const stuck = mirror({ events: [GOOD1, GROUP_LOST], copies: { evtyouth: LIVE_YOUTH }, share: share(), store, at: 1790001000 });
  await stuck._webSync(); stuck.tick(9 * 60); await stuck._webSync();
  assert.deepEqual(stuck.tombstoned(), [], 're-anchor: nine minutes already withdrew it');
  assert.ok(String(store.get('trinityone.webstuck.CP') || '').includes('evtyouth'), 're-anchor: nothing was written down to clear');
  // the key comes back and the document opens
  const well = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }), store, at: 1790001540 });
  await well._webSync();
  assert.equal(store.get('trinityone.webstuck.CP'), '[]', 'THE CLOCK KEPT RUNNING THROUGH A PERIOD THE DOCUMENT WAS PERFECTLY READABLE');
  // …and now it goes again: a fresh nine minutes must still not be enough
  const again = await flap({ sessions: 1, minutes: 9, store, t0: 1790001600 });
  assert.deepEqual(again, [], 'A FRESH NINE MINUTES WITHDREW IT — the clock carried over the minutes before the key came back');
});

test('F3: a console that has just started LOOKS AGAIN before it acts on what it remembered', async () => {
  // The cost of a clock that survives a restart is that a watch can start with one already spent — a console
  // shut for a week, or one whose relay only now answered. It must re-observe for a few seconds first rather
  // than tombstoning on its very first sync from a memory of a state it has not yet seen this session.
  const store = new Map();
  const first = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: LIVE_YOUTH }, share: share({ optIn: ['evtyouth'] }), store });
  await first._webSync();
  const stuck = mirror({ events: [GOOD1, GROUP_LOST], copies: { evtyouth: LIVE_YOUTH }, share: share(), store, at: 1790001000 });
  await stuck._webSync();                                   // writes the clock
  const later = mirror({ events: [GOOD1, GROUP_LOST], copies: { evtyouth: LIVE_YOUTH }, share: share(), store, at: 1790001000 + 7 * 864e2 });
  await later._webSync();
  assert.deepEqual(later.tombstoned(), [],
    'A WATCH TOMBSTONED ON ITS FIRST SYNC from a clock it read off disk, without once seeing the state itself');
  later.tick(BLOCKED_AFTER_S + 1); await later._webSync();
  assert.deepEqual(later.tombstoned(), ['trinityone/pubevent:evtyouth'], 're-anchor: a spent clock never withdraws anything now');
});

test('F1: the engine NAMES the copies still out there, so a control can act without opening them', async () => {
  // AUDIT-feeds-round4-2026-09-22 F1. A count cannot be acted on. These ids are the whole reason the control
  // beside the sentence can work at all: they come from w.copies, never from a document this console opened.
  const ids = ['evta', 'evtb', 'evtc', 'evtd', 'evte'];
  const bodyOf = (id) => JSON.stringify({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '', recur: '', day: null });
  const evOf = (id) => ({ id, raw: sealed({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '' }, KEY_LOST), ts: 10 });
  const m = mirror({ events: ids.map(evOf), copies: Object.fromEntries(ids.map(i => [i, bodyOf(i)])), share: share() });
  await pastReporting(m);
  const last = m.emitted[m.emitted.length - 1];
  assert.equal(last.held, 5, 're-anchor: the page does not say five copies are still up');
  assert.deepEqual([...(last.heldIds || [])].sort(), ids,
    'THE PAGE IS GIVEN A COUNT AND NOTHING TO ACT ON — heldIds is ' + JSON.stringify(last.heldIds));
  // …and the ids go away with the copies, so the control never offers to act on something already off
  m.w.share.optOut = [...ids];
  await m._webSync();
  assert.deepEqual(m.emitted[m.emitted.length - 1].heldIds, [], 'the ids outlived the copies being taken off the website');
});

test('F1: a console that CAN read the event acts on the tick — the copy comes off, and goes back when it is lifted', async () => {
  // WHAT THE TICK MEANS ON A HEALTHY CONSOLE, which is the half the control's own console cannot show. The
  // copy is withdrawn from the relay as soon as a console that can open the event syncs — the same thing the
  // per-event "Not on the website" tick has always done. So "nothing is destroyed" is true of the console
  // that pressed the button and NOT of the church. The reversal is the load-bearing half: lift the tick and
  // the copy is republished, which is what makes the control safe to press.
  const live = JSON.stringify({ title: 'Harvest supper', date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '', recur: '', day: null });
  const m = mirror({ events: [GOOD1], copies: { evtsupper: live }, share: share({ optOut: ['evtsupper'] }) });
  await m._webSync();
  assert.deepEqual(m.tombstoned(), ['trinityone/pubevent:evtsupper'],
    're-anchor: a ticked-off event is no longer withdrawn by a console that can read it');
  m.w.share.optOut = [];                                  // the owner lifts the tick
  await m._webSync();
  assert.ok(m.dtags().filter((d, i) => !m.published[i].tags.some(t => t[0] === 'deleted')).includes('trinityone/pubevent:evtsupper'),
    'THE EVENT NEVER CAME BACK after the tick was lifted — the control is not reversible after all');
});

test('F1: setWebsiteHeldMany ticks every id off in ONE share: write, and keeps the earlier opt-outs', async () => {
  // The shipped API the control calls, lifted out of vendor/steward.js and driven (memory:
  // tests-must-drive-shipped-code). One write, not one per id: the share: document is rewritten whole, so a
  // write per id would be five chances for the relay to refuse halfway and leave the page half true.
  const body = fnBody(STEWARD, 'setWebsiteHeldMany(eventIds) {', 'setWebsiteHeldMany');
  assert.match(body, /_webEnsure\(\)/, 'vendor/steward.js: setWebsiteHeldMany no longer consults the watch — re-anchor');
  const patches = [];
  const w = { share: { optOut: ['evtold'], optIn: [] }, shareKnown: true };
  const lifted = [stmt(STEWARD, 'var WEB_ID_OK = ', 'WEB_ID_OK'), stmt(STEWARD, 'var _webIds = ', '_webIds'), fnBody(STEWARD, 'function _webOneList', '_webOneList')].join('\n');
  const scope = { _webEnsure: () => w, _patches: patches };
  const names = Object.keys(scope);
  const api = new Function(...names,
    `${lifted}\nreturn { ${body},\n  setWebsiteShare(p) { _patches.push(p); return Promise.resolve(true); } };`)(...names.map(n => scope[n]));
  assert.equal(await api.setWebsiteHeldMany(['evta', 'evtb', 'evta']), true, 'the control was refused on a known share: document');
  assert.equal(patches.length, 1, 'THE CONTROL WROTE THE SHARE DOCUMENT ' + patches.length + ' TIMES — one refusal halfway leaves the page half true');
  assert.deepEqual(patches[0].optOut.sort(), ['evta', 'evtb', 'evtold'], 'the control dropped an earlier opt-out, or an id: ' + JSON.stringify(patches[0]));
  // …and it refuses rather than writing a document built on defaults before the relay has answered
  patches.length = 0; w.shareKnown = false;
  assert.equal(await api.setWebsiteHeldMany(['evtc']), false, 'THE CONTROL WROTE share: BEFORE THE RELAY HAD ANSWERED — every earlier opt-out and the switch itself would be rewritten from the defaults');
  assert.deepEqual(patches, [], 'it wrote anyway');
  // …and junk never reaches the document
  w.shareKnown = true;
  assert.equal(await api.setWebsiteHeldMany(['../../etc', '']), false, 'an id that cannot be an event id reached the share document');
  assert.deepEqual(patches, [], 'it wrote anyway');
});

// ── ROUND 5 F1: THE CONTROL IS REVERSIBLE FROM THE EVENT ITSELF, FOR BOTH EVENT SCOPES ───────────────────
// AUDIT-feeds-round5-2026-09-22 F1, measured on the shipped engine five steps deep: after the Settings
// control was pressed, ticking "On the website" again in a GROUP event's own editor never brought the copy
// back. `setWebsiteShown` wrote `optIn` alone, `_webDesired` tests `optOut` first, so `optOut` won for ever
// and the steward was left looking at a ticked box on an event the website did not show. A WHOLE-CHURCH
// event came back, which is why two internal audits and two commit messages said the door swung both ways.
//
// THE INVARIANT THESE ROWS PIN: the control is reversible from the event itself, for BOTH scopes; and no id
// is ever in `optOut` and `optIn` at once, so no screen can contradict the website. The read order is
// deliberately unchanged — optOut-wins is the fail-safe precedence (round 2, M4).
const REVERSE_LIVE = JSON.stringify({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', recur: '', day: null });
const MEET = { title: 'Church meeting', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '' };
const MEET_LIVE = JSON.stringify({ ...MEET, recur: '', day: null });
// The five steps R5's migration case actually takes, up to the moment the editor is reachable again.
async function pressed(m, id) {
  await m._webSync();                                   // 1. healthy: the copy is published
  const wasLive = m.live().includes('trinityone/pubevent:' + id);
  m.w.events.set(id, m.lostVersion);                    // 2. the name key goes
  m.w.copies.set(id, m.liveBody);
  await pastReporting(m);
  const snap = m.emitted[m.emitted.length - 1] || {};
  const ok = await m.steward.setWebsiteHeldMany(snap.heldIds || []);   // 3. the steward presses the control
  await m._webSync();
  m.w.events.set(id, m.readableVersion);                // 4. the key comes back
  await m._webSync();
  return { wasLive, pressedOk: ok, heldIds: snap.heldIds || [] };
}

test('R5F1: the control is REVERSIBLE from the event itself — for a GROUP event as well as a whole-church one', async () => {
  // THE GROUP EVENT: the case that was a one-way door.
  const g = mirror({ events: [GROUP_READABLE], copies: {}, share: share({ optIn: ['evtyouth'] }) });
  Object.assign(g, { lostVersion: GROUP_LOST, readableVersion: GROUP_READABLE, liveBody: REVERSE_LIVE });
  const gp = await pressed(g, 'evtyouth');
  assert.equal(gp.wasLive, true, 're-anchor: a group event ticked "On the website" was never published in the first place');
  assert.deepEqual(gp.heldIds, ['evtyouth'], 're-anchor: the control was offered nothing to act on');
  assert.equal(gp.pressedOk, true, 'the control was refused');
  assert.ok(g.tombstoned().includes('trinityone/pubevent:evtyouth'), 're-anchor: the control did not take the copy off at all');
  // THE SCREEN'S HALF: the editor must not open a ticked box over an event the website no longer shows.
  assert.equal(g.steward.isWebsiteShown('evtyouth'), false,
    'THE EVENT EDITOR STILL SHOWS "On the website ✓" FOR AN EVENT THE CONTROL TOOK OFF — the two lists contradict each other and nothing on any screen says why');
  // …and the tick puts it back.
  const before = g.live().length;
  assert.equal(await g.steward.setWebsiteShown('evtyouth', true), true, 'the editor tick was refused');
  await g._webSync();
  assert.ok(g.live().slice(before).includes('trinityone/pubevent:evtyouth'),
    'A GROUP EVENT NEVER COMES BACK after the control is pressed — "putting it back is the same tick from the event itself" is false for a group\'s event, and the steward has no way to undo it but hand-editing the share: document');
  assert.deepEqual(g.shareDoc().optOut, [], 'the opt-out survived the tick, so the copy can never be served again');
  assert.deepEqual(g.shareDoc().optIn, ['evtyouth'], 'the tick was not recorded');

  // THE INVERSE, which round 5 measured as already working and which must stay working.
  const c = mirror({ events: [{ id: 'evtmeet', raw: sealed(MEET, KEY_OURS), ts: 10 }], copies: {}, share: share() });
  Object.assign(c, { lostVersion: { id: 'evtmeet', raw: sealed(MEET, KEY_LOST), ts: 10 }, readableVersion: { id: 'evtmeet', raw: sealed(MEET, KEY_OURS), ts: 10 }, liveBody: MEET_LIVE });
  const cp = await pressed(c, 'evtmeet');
  assert.equal(cp.wasLive, true, 're-anchor: a whole-church event was never published');
  assert.ok(c.tombstoned().includes('trinityone/pubevent:evtmeet'), 're-anchor: the control did not take the whole-church copy off');
  assert.equal(c.steward.isWebsiteHeld('evtmeet'), true, 're-anchor: the whole-church editor would not open with its tick set');
  const cbefore = c.live().length;
  assert.equal(await c.steward.setWebsiteHeld('evtmeet', false), true, 'the editor tick was refused');
  await c._webSync();
  assert.ok(c.live().slice(cbefore).includes('trinityone/pubevent:evtmeet'),
    'A WHOLE-CHURCH EVENT NO LONGER COMES BACK when its tick is lifted — this half used to work and the fix broke it');
});

test('R5F1: no id is ever in BOTH lists — the three writers that could put one in both', async () => {
  // The invariant, at every door into it. An id in `optOut` and `optIn` at once is not a state a church can
  // mean: `optOut` holds the whole-church events ticked OFF, `optIn` the group events ticked ON.
  const m = mirror({ events: [GROUP_READABLE], copies: {}, share: share({ optIn: ['evtyouth'], optOut: ['evtold'] }) });
  assert.equal(await m.steward.setWebsiteHeldMany(['evtyouth']), true, 'the control was refused');
  assert.deepEqual(m.shareDoc().optIn, [], 'THE CONTROL LEFT THE ID IN optIn — the editor will draw a tick over an event the website no longer shows');
  assert.deepEqual(m.shareDoc().optOut.sort(), ['evtold', 'evtyouth'], 'the control dropped an earlier opt-out, or its own id');
  // …the group tick, which must lift the opt-out the control just wrote
  assert.equal(await m.steward.setWebsiteShown('evtyouth', true), true, 'the tick was refused');
  assert.deepEqual(m.shareDoc().optOut, ['evtold'], 'THE GROUP TICK LEFT THE OPT-OUT STANDING — _webDesired reads optOut first, so the tick means nothing');
  assert.deepEqual(m.shareDoc().optIn, ['evtyouth'], 'the tick was not recorded');
  // …and the whole-church tick, reachable on the same id after an edit out of the group and back into it
  assert.equal(await m.steward.setWebsiteHeld('evtyouth', true), true, 'the opt-out tick was refused');
  assert.deepEqual(m.shareDoc().optIn, [], 'THE OPT-OUT TICK LEFT THE ID IN optIn — edit the event back into a group and its tick can never be honoured');
  assert.deepEqual(m.shareDoc().optOut.sort(), ['evtold', 'evtyouth'], 'the opt-out was not recorded');
});

test('R5F1 CONTROL: a tick that changes nothing still writes nothing', async () => {
  // The per-setter "nothing to change" shortcut moved into _webOneList. Losing it would rewrite share: on
  // every Save of every event — one more chance per save for the relay to refuse, and a `created_at` churn
  // that the copy-equality check exists to avoid.
  const m = mirror({ events: [GROUP_READABLE], copies: {}, share: share({ optIn: ['evtyouth'], optOut: ['evtold'] }) });
  assert.equal(await m.steward.setWebsiteShown('evtyouth', true), true, 'an already-ticked event was refused');
  assert.equal(await m.steward.setWebsiteHeld('evtold', true), true, 'an already-opted-out event was refused');
  assert.equal(await m.steward.setWebsiteHeldMany(['evtold']), true, 'an already-opted-out id was refused');
  assert.equal(m.shareDoc(), null, 'THE SHARE DOCUMENT WAS REWRITTEN for a tick that changed nothing: ' + JSON.stringify(m.published.map(e => (e.tags.find(t => t[0] === 'd') || [])[1])));
});

// ── ROUND 5 F1, AT THE POINT OF USE: the event's OWN EDITOR, executed (CLAUDE.md rule 1) ──────────────────
// The engine rows above would all still pass with the tick deleted from the Edit dialog, or with the dialog's
// Save no longer calling setWebsiteShown. So this row runs the REAL SchEventEdit out of app/stew-schedule.jsx
// over the REAL engine: press the Settings control, open the editor the steward would open, read the tick it
// draws, flip it, press Save changes, and read the church's public feed afterwards.
const SCHED = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');
const SCHED_JS = transformSync(SCHED, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
function editDialog(event, steward) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    // A REAL useRef, not a stub: shares the same per-render hook slot as useState above, and — like real
    // React — only ever takes the value passed on the FIRST call for that slot; every later render keeps the
    // SAME object and ignores the argument. Round 6's F1 test below depends on this: it captures what the
    // tick read when the dialog OPENED, and a stub returning a fresh `{ current: null }` on every call would
    // make that capture always "null", which can never equal a boolean — silently defeating the very check
    // the fix (F1) adds, and reporting the fix as broken when it is not.
    useRef(init) { const i = idx++; if (states.length <= i) states.push({ current: init }); return states[i]; },
    useEffect() {}, useMemo: (f) => f(), Fragment: 'Frag',
  };
  const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });
  const dispatched = [];
  const win = { Steward: steward, useStewardGroups: () => [], useStewardEvents: () => [],
    dispatchEvent: (e) => { dispatched.push(e); return true; }, confirm: () => true };
  const scope = { React, h, Frag: 'Frag', Icon: () => null, SchModal: (p) => h('modal', p), useStewDialog: () => ({ current: null }), todayISO: () => '2026-09-22',
    window: win, CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } } };
  const names = Object.keys(scope);
  const mod = new Function(...names, SCHED_JS + '\nreturn { SchEventEdit };')(...names.map(n => scope[n]));
  const walk = (n, out = []) => {
    if (!n || typeof n !== 'object') return out;
    if (Array.isArray(n)) { n.forEach(x => walk(x, out)); return out; }
    out.push(n);
    if (typeof n.type === 'function') { try { walk(n.type(n.props), out); } catch (e) {} return out; }
    walk(n.props && n.props.children, out); walk(n.props && n.props.footer, out); return out;
  };
  const nodes = () => { idx = 0; return walk(mod.SchEventEdit({ event, onClose() {} })); };
  return { nodes, dispatched,
    tick: (label) => nodes().find(n => n.type === 'input' && n.props && n.props['aria-label'] === label),
    save: () => nodes().find(n => n.type === 'button' && [].concat((n.props && n.props.children) || []).includes('Save changes')) };
}

test('R5F1 THE SCREEN: a group event the control took off goes back on the website from its own editor', async () => {
  const m = mirror({ events: [GROUP_READABLE], copies: {}, share: share({ optIn: ['evtyouth'] }) });
  Object.assign(m, { lostVersion: GROUP_LOST, readableVersion: GROUP_READABLE, liveBody: REVERSE_LIVE });
  await pressed(m, 'evtyouth');
  assert.ok(m.tombstoned().includes('trinityone/pubevent:evtyouth'), 're-anchor: the control took nothing off, so there is nothing to put back');

  // The steward opens the event that is back in the calendar grid now the key has returned.
  const console_ = { ...m.steward, isDelegated: () => false, publishEvent: async (ev) => ({ id: ev.id, ...ev }) };
  const d = editDialog({ id: 'evtyouth', title: 'Youth night', date: '2026-11-01', time: '19:30', groupId: 'grpyouth' }, console_);
  const tick = d.tick('On the website');
  assert.ok(tick, 'THE EDIT DIALOG DRAWS NO "On the website" TICK for a group event — there is nothing on the screen that could undo the control');
  assert.equal(tick.props.checked, false,
    'THE DIALOG OPENS WITH THE TICK SET over an event the website no longer shows — the screen contradicts the site and says nothing about it');
  tick.props.onChange({ target: { checked: true } });
  assert.equal(d.tick('On the website').props.checked, true, 're-anchor: the tick does not follow its own onChange');
  const before = m.live().length;
  const btn = d.save();
  assert.ok(btn && typeof btn.props.onClick === 'function', 're-anchor: the Edit dialog has no Save changes button');
  await btn.props.onClick();
  assert.deepEqual(d.dispatched.filter(e => e.type === 'steward-write-blocked'), [], 'the dialog reported the tick as refused: ' + JSON.stringify(d.dispatched.map(e => e.detail)));
  await m._webSync();
  assert.ok(m.live().slice(before).includes('trinityone/pubevent:evtyouth'),
    'TICKING THE EVENT BACK ON FROM ITS OWN EDITOR DID NOT PUT IT BACK ON THE CHURCH\'S WEBSITE — the control is a one-way door for a group\'s event');
});

test('R5F1 THE SCREEN CONTROL: the same dialog can take it off again — the door swings both ways', async () => {
  const m = mirror({ events: [GROUP_READABLE], copies: { evtyouth: REVERSE_LIVE }, share: share({ optIn: ['evtyouth'] }) });
  await m._webSync();
  const console_ = { ...m.steward, isDelegated: () => false, publishEvent: async (ev) => ({ id: ev.id, ...ev }) };
  const d = editDialog({ id: 'evtyouth', title: 'Youth night', date: '2026-11-01', time: '19:30', groupId: 'grpyouth' }, console_);
  assert.equal(d.tick('On the website').props.checked, true, 're-anchor: the dialog does not open ticked for an event that IS on the website');
  d.tick('On the website').props.onChange({ target: { checked: false } });
  await d.save().props.onClick();
  await m._webSync();
  assert.ok(m.tombstoned().includes('trinityone/pubevent:evtyouth'), 'UNTICKING THE EVENT LEFT IT ON THE WEBSITE');
  assert.deepEqual(m.shareDoc().optIn, [], 'the untick was not recorded');
  assert.deepEqual(m.shareDoc().optOut, [], 'UNTICKING A GROUP EVENT WROTE AN OPT-OUT — a group event is off by default, and an opt-out on the id would outlive an edit back to whole-church');
});

test('R5F1: a share: document from an OLDER console cannot make the editor contradict the website', async () => {
  // The audit of ba19fff, finding 1: the writers below keep the two lists apart, and `_webNormalise` read
  // them independently — so a console of an older build, which writes `optIn` alone, put an id straight back
  // into both and this console's editor drew a ticked box over an event the website does not show. Two apks
  // ship, so one church running a console of each is the ordinary rollout state.
  const fromAnOlderConsole = { calendar: true, sermons: false, plans: false, optOut: ['evtyouth', 'evtold'], optIn: ['evtyouth', 'evtkeep'], address: 'own' };
  // no copy on the relay to begin with, so the republish below is a WRITE and not a no-op equality check
  const m = mirror({ events: [GROUP_READABLE], copies: {}, share: share() });
  const loaded = m._webNormalise(fromAnOlderConsole);
  assert.deepEqual(loaded.optOut.sort(), ['evtold', 'evtyouth'], 'the read dropped an opt-out');
  assert.deepEqual(loaded.optIn, ['evtkeep'],
    'AN ID SAT IN optOut AND optIn AT ONCE AFTER THE READ — the website reads optOut and the editor reads optIn, so the screen says the opposite of the site: ' + JSON.stringify(loaded));

  // …and the SCREEN over that document, which is where it showed (CLAUDE.md rule 1)
  m.w.share = loaded;
  const console_ = { ...m.steward, isDelegated: () => false, publishEvent: async (ev) => ({ id: ev.id, ...ev }) };
  const d = editDialog({ id: 'evtyouth', title: 'Youth night', date: '2026-11-01', time: '19:30', groupId: 'grpyouth' }, console_);
  assert.equal(d.tick('On the website').props.checked, false,
    'THE EDITOR OPENED WITH THE TICK SET over an event this church has opted out of — the state the F1 fix exists to make impossible, arriving from another console');
  // …and one tick still puts it back, so the repair costs the church nothing
  const before = m.live().length;
  d.tick('On the website').props.onChange({ target: { checked: true } });
  await d.save().props.onClick();
  await m._webSync();
  assert.ok(m.live().slice(before).includes('trinityone/pubevent:evtyouth'), 'the tick no longer puts the event back after the document was repaired');
  assert.deepEqual(m.shareDoc().optIn.sort(), ['evtkeep', 'evtyouth'], 'the repair threw away an UNRELATED tick: ' + JSON.stringify(m.shareDoc()));
});

// ── ROUND 6 F1, AT THE POINT OF USE: an Edit dialog already open must not undo the control ────────────────
// AUDIT-feeds-round6-2026-09-23 F1. `SchEventEdit` reads the tick ONCE, in a lazy useState initialiser, and
// (before this fix) every Save wrote it back whether or not the steward had touched it. `setWebsiteShown`
// now clears the opt-out as well as setting optIn (ba19fff, correctly, for the case where the STEWARD
// ticks it) — so a dialog that opened before the id was taken off the website, and is Saved afterwards
// WITHOUT the steward looking at the tick again, republished the event: reachable with two consoles, one
// with the Edit dialog open and one pressing the Settings control.
test('R6F1: an Edit dialog already open does not undo "Take it off our website" pressed while it sat open', async () => {
  const m = mirror({ events: [GROUP_READABLE], copies: {}, share: share({ optIn: ['evtyouth'] }) });
  Object.assign(m, { lostVersion: GROUP_LOST, readableVersion: GROUP_READABLE, liveBody: REVERSE_LIVE });
  await m._webSync();
  assert.ok(m.live().includes('trinityone/pubevent:evtyouth'), 're-anchor: the event is not on the website to begin with');

  // The steward opens the Edit dialog WHILE the event is still on the website — the tick reads ON.
  const console_ = { ...m.steward, isDelegated: () => false, publishEvent: async (ev) => ({ id: ev.id, ...ev }) };
  const d = editDialog({ id: 'evtyouth', title: 'Youth night', date: '2026-11-01', time: '19:30', groupId: 'grpyouth' }, console_);
  assert.equal(d.tick('On the website').props.checked, true, 're-anchor: the dialog did not open ticked on');

  // The Settings control is pressed — by this console or another — WHILE the dialog sits open.
  await pressed(m, 'evtyouth');
  assert.ok(m.tombstoned().includes('trinityone/pubevent:evtyouth'), 're-anchor: the control took nothing off, so there is nothing this test protects');

  // The steward never looks at the tick again and presses Save changes.
  const before = m.live().length;
  await d.save().props.onClick();
  assert.deepEqual(d.dispatched.filter(e => e.type === 'steward-write-blocked'), [], 'the dialog reported the tick as refused: ' + JSON.stringify(d.dispatched.map(e => e.detail)));
  await m._webSync();
  assert.equal(m.live().slice(before).includes('trinityone/pubevent:evtyouth'), false,
    'AN EDIT DIALOG ALREADY OPEN UNDID "TAKE IT OFF OUR WEBSITE" — Save republished the event because the tick it read at OPEN was stale, not because the steward touched it');
  assert.deepEqual(m.shareDoc().optOut, ['evtyouth'], 'the opt-out this console\'s Settings control just wrote did not survive an untouched Save');
});

test('R6F1 CONTROL: the steward DOES look at the tick again and unticks it — the write must still happen', async () => {
  // The fix must not turn "Save" into a no-op for the tick generally — only when it was never touched.
  // A live copy on the relay to begin with (as "the door swings both ways" above), so there is something
  // for a genuine untick to tombstone.
  const m = mirror({ events: [GROUP_READABLE], copies: { evtyouth: REVERSE_LIVE }, share: share({ optIn: ['evtyouth'] }) });
  await m._webSync();
  const console_ = { ...m.steward, isDelegated: () => false, publishEvent: async (ev) => ({ id: ev.id, ...ev }) };
  const d = editDialog({ id: 'evtyouth', title: 'Youth night', date: '2026-11-01', time: '19:30', groupId: 'grpyouth' }, console_);
  assert.equal(d.tick('On the website').props.checked, true, 're-anchor');
  d.tick('On the website').props.onChange({ target: { checked: false } });
  await d.save().props.onClick();
  await m._webSync();
  assert.ok(m.tombstoned().includes('trinityone/pubevent:evtyouth'), 'A DELIBERATE UNTICK NO LONGER WRITES — the fix over-applied and silenced every Save');
  assert.deepEqual(m.shareDoc().optOut, [], 'unticking a GROUP event must never write an opt-out — see the door-swings-both-ways test above');
});

// ── ROUND 6 F5: THE DIRECTION of the cross-filter, pinned on its own ───────────────────────────────────────
// AUDIT-feeds-round6-2026-09-23 F5. The OLDER-console row above is the only place this repair was exercised,
// and it fails identically by NAME whether `_webNormalise` does no repair at all, or repairs BACKWARDS
// (optIn wins over optOut) — the auditor's own inverted sabotage tripped the very same test. Neither failure
// on its own tells a reader which direction is safe. This row asserts the direction directly, on the
// smallest input that can show it (one id, in both lists, nothing else to get lost in), and then proves the
// REAL stake: the wrong direction does not just mis-render a tick, it PUBLISHES an event a steward opted out
// of onto the church's public website.
test('R6F5: an id in BOTH lists loads into optOut, not optIn — and never reaches the public website', async () => {
  const m = mirror({ events: [GROUP_READABLE], copies: {}, share: share() });
  const conflicted = { calendar: true, sermons: false, plans: false, optOut: ['evtyouth'], optIn: ['evtyouth'], address: 'own' };
  const loaded = m._webNormalise(conflicted);
  assert.deepEqual(loaded.optOut, ['evtyouth'], 're-anchor: optOut lost the id on the way in — this is not the row under test');
  assert.deepEqual(loaded.optIn, [],
    'THE REPAIR RAN BACKWARDS — the id stayed in optIn, which is the direction round 2 (M4) rejected: optOut must win');
  m.w.share = loaded;
  await m._webSync();
  assert.equal(m.live().includes('trinityone/pubevent:evtyouth'), false,
    'AN ID THAT SAT IN BOTH LISTS REACHED THE PUBLIC WEBSITE — the repair kept the statement that publishes it, not the one that withholds it');
});

// ── F6 (round 5, LOW): the one line that stops the control acting on STALE ids ────────────────────────────
// Measured by the auditor: removing `idsShowing.join('\n') !== (w.heldIds || []).join('\n')` from the emit
// condition left 43/43 green. It is load-bearing — an id set that swaps at a CONSTANT COUNT otherwise never
// reaches the panel, and the button would then opt out an event that has since become readable and legitimate.
test('F6: the panel is told when the held ids SWAP at a constant count', async () => {
  const bodyOf = (id) => JSON.stringify({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '', recur: '', day: null });
  const evLost = (id) => ({ id, raw: sealed({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '' }, KEY_LOST), ts: 10 });
  const evOk = (id) => ({ id, raw: sealed({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '' }, KEY_OURS), ts: 10 });
  const m = mirror({ events: [evLost('evta'), evLost('evtb')], copies: { evta: bodyOf('evta'), evtb: bodyOf('evtb') }, share: share() });
  await pastReporting(m);
  assert.deepEqual([...(m.emitted[m.emitted.length - 1].heldIds || [])].sort(), ['evta', 'evtb'], 're-anchor: the engine named different ids to begin with');
  const seen = m.emitted.length;
  // A opens and C shuts in the same sync: two held before, two held after, and a DIFFERENT two.
  m.w.events.set('evta', evOk('evta'));
  m.w.events.set('evtc', evLost('evtc')); m.w.copies.set('evtc', bodyOf('evtc'));
  await m._webSync();
  const last = m.emitted[m.emitted.length - 1];
  assert.ok(m.emitted.length > seen,
    'THE PANEL WAS NEVER TOLD THE IDS CHANGED — the count is the same, so nothing emitted, and the button would take off an event that has since become readable and legitimate');
  assert.equal(last.held, 2, 're-anchor: the count did not stay constant, so this row is not testing what it names');
  assert.deepEqual([...last.heldIds].sort(), ['evtb', 'evtc'], 'the panel is holding the OLD ids: ' + JSON.stringify(last.heldIds));
});

test('R5 CONTROL: a readable event\'s copy is never withdrawn, however long another one stays stuck', async () => {
  const body = JSON.stringify({ title: 'Harvest supper', date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '', recur: '', day: null });
  const m = mirror({ events: [GOOD1, GOOD2, LOST], copies: { evtsupper: body }, share: share() });
  await spendBudget(m);
  assert.equal(m.tombstoned().includes('trinityone/pubevent:evtsupper'), false, 'a readable event was swept up with the stuck one');
  assert.equal(m.tombstoned().includes('trinityone/pubevent:evtfair'), false, 're-anchor: an event with no copy was tombstoned');
  assert.deepEqual(m.tombstoned(), [], 'nothing should have come off here: the only stuck event has no public copy');
});

test('R5: the key coming back puts the event straight back on the website', async () => {
  const live = JSON.stringify({ title: 'Youth night', date: '2026-11-01', time: '19:30', where: 'The vestry', blurb: '', recur: '', day: null });
  const m = mirror({ events: [GOOD1, GROUP_READABLE], copies: { evtyouth: live }, share: share({ optIn: ['evtyouth'] }) });
  await m._webSync();
  m.w.events.set('evtyouth', GROUP_LOST);
  m.w.copies.delete('evtyouth');                                   // …and its copy went while the key was gone
  await spendBudget(m);
  m.w.events.set('evtyouth', GROUP_READABLE);                      // the key comes back
  await m._webSync();
  assert.ok(m.dtags().includes('trinityone/pubevent:evtyouth'), 'THE EVENT NEVER CAME BACK after the key returned');
  assert.equal(m.w.stuckSince, 0, 'the stuck clock did not reset when everything became readable again');
});

test('CONTROL: with every event readable nothing is blocked and nothing is emitted', async () => {
  const m = mirror({ events: [GOOD1, GOOD2], copies: {}, share: share() });
  await pastReporting(m);
  assert.equal(m.w.blocked, 0);
  assert.deepEqual(m.emitted.map(e => e.blocked), [], 'a healthy mirror told the steward something was wrong');
});

// ── the screen: the real DashWebsitePanel ────────────────────────────────────────────────────────────────
// `sink` (optional) is how a row DRIVES the panel rather than only reading it: it collects the engine calls
// the panel makes, keeps the rendered nodes, and hands back a `render()` that re-runs the component over the
// same hook state — so a row can click a control and then read what the page says afterwards. `sink.ok`
// false makes the engine refuse, which is the case a control must not celebrate (memory:
// fix-the-control-not-the-label).
function panel(snapshot, sink) {
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
  const s = sink || {};
  s.calls = [];
  const win = { Steward: { subscribeWebsiteShare: (cb) => { cb(snapshot); return () => {}; }, websiteFeedUrl: () => 'https://church.example/public/npub1x/calendar.ics', setWebsiteShare: async () => true,
    setWebsiteHeldMany: async (ids) => { s.calls.push(ids); return s.ok !== false; } } };
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
  // `s.tree` is the element tree itself. `nodes()` above stops at a COMPONENT element (it calls the
  // component and walks what comes back, and the Panel stub returns a node whose children are empty), so a
  // row that needs a particular control — not just the words on the page — walks the tree with allNodes().
  const render = () => { idx = 0; s.tree = mod.DashWebsitePanel({ church: {} }); s.nodes = nodes(s.tree); return s.nodes.map(text).join(' | '); };
  render();
  s.render = render;
  s.text = text;
  return render();
}

test('THE SCREEN: Settings → Your website says how many events could not be published, and why', () => {
  const said = panel({ ...share(), known: true, blocked: 1, blockedWhy: 'key' });
  assert.match(said, /1 event could not be published/, 'THE PAGE SAYS NOTHING about the event the mirror skipped — the switch reads "On" and one event is silently missing from the church\'s website');
  assert.match(said, /no church key on this console opened it/, 'the page gives no reason');
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
  assert.match(said('key'), /no church key on this console opened it/);
  // F2: and it must not stop at the key — a byte flipped inside a whole payload fails the identical check
  assert.match(said('key'), /may be damaged instead/,
    'THE ONE CAUSE THIS CONSOLE CANNOT DIAGNOSE IS STATED AS IF IT COULD — a damaged copy fails the identical MAC check a lost key does, and the church is sent after a key it may well be holding');
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

test('THE SCREEN (F1): the page says which of them are STILL on the website', () => {
  // CLAUDE.md rule 1, for the half of F1 that is a decision rather than a bug. The engine now LEAVES a copy
  // it cannot classify on the public website rather than emptying a church's calendar. That is only
  // defensible if the church is told, and this sentence is the only place it is told. Delete the `held`
  // block from app/stew-dashboard.jsx and this row goes red.
  const one = panel({ ...share(), known: true, blocked: 1, blockedWhy: 'key', held: 1 });
  assert.match(one, /1 of them is still on your website/,
    'THE PAGE DOES NOT SAY THE EVENT IS STILL PUBLISHED — the console left an event it cannot read on a public website and the Settings page shows only "could not be published"');
  assert.match(one, /could not open it to check/, 'the page does not say why it was left there');
  const many = panel({ ...share(), known: true, blocked: 5, blockedWhy: 'key', held: 5 });
  assert.match(many, /5 of them are still on your website/, 'the count is not the engine\'s');
  assert.match(many, /could not open them to check/, 'the plural sentence is not plural');
  // CONTROL: blocked events that were all withdrawn say nothing of the kind.
  const none = panel({ ...share(), known: true, blocked: 2, blockedWhy: 'key', held: 0 });
  assert.match(none, /2 events could not be published/, 're-anchor: the blocked line stopped rendering');
  assert.doesNotMatch(none, /still on your website/, 'the page claims events are still published when the engine withdrew them');
});

// ── F1: a church can ACT on the sentence, without opening anything ───────────────────────────────────────
// AUDIT-feeds-round4-2026-09-22 F1. The page told a church "1 of them is still on your website" and offered
// nothing that would take it off. The intended escape — tick the event "Not on the website", which the relay
// honours at serve time — is unreachable for exactly these events: a locked event is absorbed with no date
// (`_subAddr`), the console calendar buckets by date, and `grep -c "_locked" app/stew-schedule.jsx` is 0, so
// the event is on no day of the grid and its editor cannot be opened. The only lever left was the master
// switch, which takes the whole calendar down. This control writes the same opt-out for the ids the engine
// has already named, so it needs no key and opens nothing.
const HELD_SNAP = (over = {}) => ({ ...share(), known: true, blocked: 1, blockedWhy: 'key', held: 1, heldIds: ['evtstuck'], ...over });
const allNodes = (n, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(x => allNodes(x, out)); return out; }
  out.push(n);
  allNodes(n.props && n.props.children, out);
  return out;
};
const btnIn = (sink, label) => allNodes(sink.tree).find(n => n && n.type === 'button' && n.props && n.props['aria-label'] === label);

test('THE SCREEN (F1): the held sentence carries a control that takes those copies off the website', async () => {
  const sink = {};
  const said = panel(HELD_SNAP(), sink);
  assert.match(said, /Take it off our website/,
    'THE PAGE TELLS A CHURCH A COPY IS STILL PUBLIC AND OFFERS NOTHING THAT WOULD TAKE IT OFF — the only lever is the master switch, which removes the whole calendar');
  const btn = btnIn(sink, 'Take off our website');
  assert.ok(btn && typeof btn.props.onClick === 'function', 'the control is not a button that does anything');
  await btn.props.onClick({ stopPropagation() {} });
  assert.deepEqual(sink.calls, [['evtstuck']],
    'THE CONTROL DID NOT TICK THE HELD IDS OFF THE WEBSITE — it called the engine with ' + JSON.stringify(sink.calls));
  assert.match(sink.render(), /your website no longer shows it/, 'the page does not say what just happened');
  // the plural reads as a plural, and carries every id the engine named
  const many = {};
  const saidMany = panel(HELD_SNAP({ blocked: 3, held: 3, heldIds: ['evta', 'evtb', 'evtc'] }), many);
  assert.match(saidMany, /Take them off our website/, 'the control is singular for three events');
  await btnIn(many, 'Take off our website').props.onClick({ stopPropagation() {} });
  assert.deepEqual(many.calls, [['evta', 'evtb', 'evtc']], 'the control took only some of the copies off');
});

test('THE SCREEN (F1): the control does not claim success over a write the relay refused', async () => {
  // memory: fix-the-control-not-the-label — six serving controls toasted success on the line after a call
  // that can refuse. A church that reads "taken off" and is still published is worse off than one that was
  // told nothing, because it will stop looking.
  const sink = { ok: false };
  panel(HELD_SNAP(), sink);
  await btnIn(sink, 'Take off our website').props.onClick({ stopPropagation() {} });
  const after = sink.render();
  assert.match(after, /Not saved/, 'A REFUSED WRITE IS REPORTED AS SUCCESS: ' + after.slice(0, 200));
  assert.doesNotMatch(after, /no longer shows it/, 'the page celebrated a write that never landed');
});

test('THE SCREEN (F1) CONTROL: nothing held, no control — and nothing to press when the engine named no ids', () => {
  const none = {};
  const said = panel({ ...share(), known: true, blocked: 2, blockedWhy: 'key', held: 0 }, none);
  assert.doesNotMatch(said, /off our website/, 'the page offers to take copies off when none are up');
  assert.equal(btnIn(none, 'Take off our website'), undefined, 're-anchor: the control renders with nothing held');
  // a snapshot from an older engine carries no ids: no control at all, rather than a dead one
  const stale = {};
  panel(HELD_SNAP({ heldIds: undefined }), stale);
  assert.equal(btnIn(stale, 'Take off our website'), undefined,
    'THE PAGE DRAWS A CONTROL WITH NOTHING TO ACT ON — a greyed-out button a steward cannot press and is never told why');
  // …and a snapshot the engine really did fill renders a control that can be PRESSED. Without this the whole
  // round passes over `disabled={true}` (measured: an always-disabled button left this file 33/33, green).
  const live = {};
  panel(HELD_SNAP(), live);
  const btn = btnIn(live, 'Take off our website');
  assert.ok(btn, 're-anchor: the control is gone');
  assert.equal(!!btn.props.disabled, false,
    'THE CONTROL IS GREYED OUT WHEN THERE IS SOMETHING TO ACT ON — a church is shown the answer to its problem and cannot press it');
  // the two reasons it IS allowed to be dead, both of which the engine sets
  const notyet = {}; panel(HELD_SNAP({ known: false }), notyet);
  const b2 = btnIn(notyet, 'Take off our website');
  assert.ok(!b2 || b2.props.disabled, 'the control is live before the relay has answered, when the write would rebuild share: from the defaults');
});

test('THE SCREEN (F1): the page a steward comes BACK to says it too', async () => {
  // MEASURED before this fix: DashWebsitePanel mounts and unmounts with navigation
  // (`{open === 'website' ? <DashWebsitePanel …/> : null}`) and re-subscribes with no restart, and
  // subscribeWebsiteShare's immediate call handed that listener the share document ALONE — no blocked, no
  // why, no held, no ids. _webEmit only fires when one of those CHANGES, so nothing ever repaired it: on
  // every visit after the first the page read a healthy "On" with no warning and no control, for the rest of
  // the session. This row drives the REAL subscribeWebsiteShare out of the bundle into the REAL panel.
  const ids = ['evta', 'evtb', 'evtc'];
  const bodyOf = (id) => JSON.stringify({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '', recur: '', day: null });
  const evOf = (id) => ({ id, raw: sealed({ title: 'Event ' + id, date: '2026-10-03', time: '19:30', where: 'The hall', blurb: '' }, KEY_LOST), ts: 10 });
  const m = mirror({ events: ids.map(evOf), copies: Object.fromEntries(ids.map(i => [i, bodyOf(i)])), share: share() });
  await pastReporting(m);
  assert.equal(m.emitted[m.emitted.length - 1].held, 3, 're-anchor: the engine is not reporting three copies still up');
  const sub = fnBody(STEWARD, 'subscribeWebsiteShare(onShare, opts) {', 'subscribeWebsiteShare');
  const lifted = [stmt(STEWARD, 'var WEB_DEFAULT = ', 'WEB_DEFAULT'), fnBody(STEWARD, 'function _webSnap', '_webSnap')].join('\n');
  const api = new Function('_webEnsure', `${lifted}\nreturn { ${sub} };`)(() => m.w);
  let snap = null;
  api.subscribeWebsiteShare((s) => { snap = s; });
  assert.ok(snap, 're-anchor: subscribeWebsiteShare no longer answers the moment a listener attaches');
  assert.equal(snap.held, 3,
    'A PANEL THAT MOUNTS A SECOND TIME IS HANDED A SNAPSHOT WITH NO WARNING IN IT — held reads ' + snap.held + ', and nothing ever emits again unless the number changes');
  assert.equal(snap.blocked, 3, 'the same snapshot says nothing could not be published either');
  assert.deepEqual([...(snap.heldIds || [])].sort(), ids, 'the snapshot names no ids, so the control has nothing to act on');
  // …and the page drawn from THAT snapshot is the whole page, sentences and control
  const sink = {};
  const said = panel(snap, sink);
  assert.match(said, /3 events could not be published/, 'THE PAGE IS SILENT ON EVERY VISIT AFTER THE FIRST');
  assert.match(said, /3 of them are still on your website/, 'the second visit does not say the copies are still public');
  assert.ok(btnIn(sink, 'Take off our website'), 'THE CONTROL IS GONE ON EVERY VISIT AFTER THE FIRST');
});

test('CONTROL: with nothing blocked the page says nothing of the kind', () => {
  const said = panel({ ...share(), known: true, blocked: 0, blockedWhy: '', held: 0 });
  assert.doesNotMatch(said, /could not be published/, 'the page cries wolf on a healthy church');
  assert.doesNotMatch(said, /still on your website/, 'the page cries wolf on a healthy church');
  assert.match(said, /Share our calendar on our website/, 're-anchor: the panel did not render at all');
});
