// A STEWARD WHO ONLY POSTS IS NOT A MEMBER (sim finding 29).
//   Run: node --test scripts/a-steward-who-only-posts-is-not-a-member.test.mjs
//
// THE DEFECT. The relay lets a steward post chat without a `member:` document, and subscribeMembers turned ANY
// kind-1 addressed to the church into a member row. A delegate's own posts therefore listed them as a joiner,
// offered them under "waiting to be let in", let Approve-all admit them, and had the key-enrolment effect wrap
// every church key to them as if they were a congregation member.
//
// THE FIX (engine, one place). subscribeMembers hides a row that has no `member:` document (`joined`) when its key
// is a current steward OR a remembered ex-steward (removing a delegate must not bring the row back — the
// enrolment effect would re-wrap the keys that the removal just rotated away). The steward roster re-filters the
// open list when it arrives.
//
// This RUNS the shipped subscribeMembers / subscribeStewards lifted out of vendor/steward.js, with
// only the relay pool and storage faked. Consumers: useStewardMembers (steward-root.jsx, 23 call sites) and
// JoinNotifier (stew-dashboard.jsx) both read this one stream.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, liftKeyRead } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const CH = 'churchpub';
const GHOST = 'delegate1';      // a delegated steward who only posts
const REAL = 'member1';         // a real member: has a member: document AND posts
const OTHER = 'chatter1';       // posts only, not a steward — NOT touched by this change (owner decision)

function liftGhostHelpers() {
  const m = /\n  var _exStewardsKey = [\s\S]*?\n  function _stewardRosterChanged\(before, after\) \{[\s\S]*?\n  \}/.exec(STEWARD);
  assert.ok(m, 'could not lift the ghost-filter helpers from the bundle — re-anchor this test, do not delete it');
  return m[0];
}

function harness() {
  const storage = {};
  const handlers = [];            // every subscribeMany handler, in open order
  const scope = {
    pool: { subscribeMany: (_u, filters, h) => { handlers.push({ filters, h }); return { close() {} }; } },
    relays: () => ['wss://r'],
    pub: CH, actingChurch: '',
    NET: 'trinityone', STEWARDS_D: 'trinityone/stewards:', NAME_D: 'trinityone/name:', RESEAT_D: 'trinityone/reseat:',
    JSON, Math, Date, console, String, Number, Map, Set, Array, Infinity, Object, Promise,
    setTimeout, clearTimeout,
    npubEncode: (x) => x,
    _careRoster: new Set(), _careRosterKnown: false, _careRosterSeen: false,
    _stewardCaps: {}, _stewardNames: {}, _stewardNamesCt: '', _stewardSince: {},
    _authFuture: () => false, _byChurch: () => true, _byChurchOrSteward: () => true,
    _isRelayAuthed: () => true,
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = v; }, removeItem: (k) => { delete storage[k]; } },
    window: { Steward: { openMemberName: () => '' } },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (String(k) in globalThis) return globalThis[String(k)]; return undefined; },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const members = fnBody(STEWARD, 'subscribeMembers(onMembers', 'subscribeMembers');
  const stewards = fnBody(STEWARD, 'subscribeStewards(onList', 'subscribeStewards');
  const api = new Function('scope', `with (scope) { ${liftKeyRead(STEWARD)}\n ${liftGhostHelpers()}\n return ({ ${members},\n ${stewards} }); }`)(proxy);
  return { api, scope, storage, handlers };
}

const kind1 = (pk, t = 1700000000) => ({ kind: 1, id: 'm' + pk + t, pubkey: pk, created_at: t, tags: [['p', CH]], content: 'hi' });
const memberDoc = (pk) => ({ kind: 30078, id: 'd' + pk, pubkey: pk, created_at: 1690000000, tags: [['d', 'trinityone/member:' + CH], ['t', 'trinityone'], ['p', CH]], content: JSON.stringify({ joined: 1690000000 }) });
const rosterDoc = (pks, t) => ({ kind: 30078, id: 'r' + t, pubkey: CH, created_at: t, tags: [['d', 'trinityone/stewards:' + CH], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: pks }) });
const settle = () => new Promise(r => setTimeout(r, 260));

// open the Members stream and the steward stream, as the console does
function open(h, { cachedRows } = {}) {
  if (cachedRows) h.storage['trinityone.steward.members.' + CH] = JSON.stringify(cachedRows);
  const lists = [];
  const offM = h.api.subscribeMembers((l) => lists.push(l.slice()));
  const memberHandler = h.handlers[h.handlers.length - 2].h;   // the roster sub opens before the re-seat sub
  const offS = h.api.subscribeStewards(() => {});
  const stewardHandler = h.handlers[h.handlers.length - 1].h;
  return { lists, memberHandler, stewardHandler, offM, offS, last: () => lists[lists.length - 1] || [] };
}
const pubs = (l) => l.map(m => m.pubkey).sort();

test('a steward on the roster who only posts is not listed as a member; a real member and a plain chatter are', async () => {
  const h = harness();
  const o = open(h);
  o.stewardHandler.onevent(rosterDoc([GHOST], 1700000001));
  o.memberHandler.onevent(kind1(GHOST));
  o.memberHandler.onevent(memberDoc(REAL)); o.memberHandler.onevent(kind1(REAL));
  o.memberHandler.onevent(kind1(OTHER));
  await settle();
  assert.deepEqual(pubs(o.last()), [OTHER, REAL].sort(),
    'THE DELEGATE IS LISTED AS A MEMBER — a steward who only posts reaches "waiting to be let in" and the key-enrolment list');
});

test('a ghost painted BEFORE the steward roster arrives is removed when it does (the re-emit)', async () => {
  const h = harness();
  const o = open(h);
  o.memberHandler.onevent(kind1(GHOST));
  o.memberHandler.onevent(memberDoc(REAL));
  await settle();
  assert.ok(pubs(o.last()).includes(GHOST), 'CONTROL: before any roster is known the row is painted (nothing to filter on yet)');
  o.stewardHandler.onevent(rosterDoc([GHOST], 1700000001));   // NO member event follows — only the roster arrives
  await settle();
  assert.deepEqual(pubs(o.last()), [REAL],
    'THE ROSTER ARRIVED AND THE GHOST STAYED — the list is only re-filtered on the next member event, which may be never');
});

test('a steward who ALSO joined (has a member: document) is a real person and stays listed', async () => {
  const h = harness();
  const o = open(h);
  o.stewardHandler.onevent(rosterDoc([GHOST], 1700000001));
  o.memberHandler.onevent(memberDoc(GHOST)); o.memberHandler.onevent(kind1(GHOST));
  await settle();
  assert.deepEqual(pubs(o.last()), [GHOST], 'a steward who joined as a member was hidden');
});

test('removing the steward does NOT bring the ghost back (ex-stewards are remembered)', async () => {
  const h = harness();
  const o = open(h);
  o.stewardHandler.onevent(rosterDoc([GHOST], 1700000001));
  o.memberHandler.onevent(kind1(GHOST)); o.memberHandler.onevent(memberDoc(REAL));
  await settle();
  assert.deepEqual(pubs(o.last()), [REAL], 'CONTROL: hidden while a steward');
  o.stewardHandler.onevent(rosterDoc([], 1700000002));        // the owner removes the delegate
  await settle();
  assert.deepEqual(pubs(o.last()), [REAL],
    'THE REMOVED DELEGATE RE-APPEARED AS A MEMBER — the enrolment effect would re-wrap every key to them, undoing the rotation done on removal');
  // and it survives a reload: a NEW subscription, with the roster already empty, still hides them
  o.offM(); o.offS();
  const o2 = (() => { const lists = []; const a = h.api.subscribeMembers((l) => lists.push(l.slice())); return { lists, a, mh: h.handlers[h.handlers.length - 2].h }; })();
  h.scope._careRoster = new Set();
  o2.mh.onevent(kind1(GHOST)); o2.mh.onevent(memberDoc(REAL));
  await settle();
  assert.deepEqual(pubs(o2.lists[o2.lists.length - 1]), [REAL], 'the ex-steward came back after a reload');
});

test('the cached first paint does not show a ghost either', async () => {
  const h = harness();
  h.scope._careRoster = new Set([GHOST]);
  const rows = [{ pubkey: GHOST, count: 3, joined: 0 }, { pubkey: REAL, count: 1, joined: 1690000000 }];
  const o = open(h, { cachedRows: rows });
  assert.deepEqual(pubs(o.lists[0] || []), [REAL], 'the Members list flashes the delegate as a member before the relay answers');
});
