// LEAVING A CHURCH CLEARS ITS DATA FROM THE PHONE.
//   Run: node --test scripts/leaving-a-church-clears-its-data-from-the-phone.test.mjs
//
// THE DEFECT. `leaveMembership` published the tombstone but did nothing about the church's cached data
// — member roster, sealed documents, group list, and everything else in localStorage keyed by that
// church's hex or npub. On a phone with no PIN the data sat there until a reinstall.
//
// THE FIX. `leaveMembership` calls `_forgetChurch(cp)` after the successful tombstone publish. That
// function closes per-church hubs, drops in-memory maps, and removes localStorage keys whose name
// contains the church's hex or npub — keeping `bringkids`, `mykidnames` and `arrivedat` (the parent's
// own writing, per the owner's decision of 2026-09-14).
//
// Callers: leaveMembership ← leaveChurch in app/app.jsx ← LeaveButton in screens-church.jsx.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CHURCH = 'aa'.repeat(32);
const CHURCH_NPUB = 'npub1' + CHURCH.slice(0, 40);
const FORGETBODY = fnBody(FELLOWSHIP, 'function _forgetChurch(cp) {', '_forgetChurch');

function makeStorage(cp) {
  const data = {
    'trinityone.followedChurches': JSON.stringify([{ id: cp }]),
    'trinityone.activeChurch': cp,
    'trinityone.joinsent': JSON.stringify({ [cp]: { id: 'e1', at: 1000, pub: 'pk' } }),
    ['trinityone.members.' + cp]: JSON.stringify([{ pubkey: 'p1' }]),
    ['trinityone.docshub.' + cp]: JSON.stringify({ buf: [] }),
    ['trinityone.memhub.' + cp]: JSON.stringify({ byPub: {} }),
    ['trinityone.groups.' + cp]: JSON.stringify([{ id: 'prayer' }]),
    ['trinityone.membercount.' + cp]: '5',
    ['trinityone.hb:' + CHURCH_NPUB]: String(Date.now()),
    ['trinityone.chatSeen.' + CHURCH_NPUB]: JSON.stringify({}),
    ['trinityone.bringkids.' + CHURCH_NPUB]: JSON.stringify(['Tom']),
    ['trinityone.mykidnames.' + CHURCH_NPUB]: JSON.stringify(['Tom']),
    ['trinityone.arrivedat.' + CHURCH_NPUB]: String(Date.now()),
    'trinityone.outbox': JSON.stringify([]),
  };
  const keys = Object.keys(data);
  return {
    getItem: (k) => data[k] || null,
    setItem: (k, v) => { data[k] = v; keys.push(k); },
    removeItem: (k) => { delete data[k]; const i = keys.indexOf(k); if (i >= 0) keys.splice(i, 1); },
    get length() { return keys.length; },
    key: (i) => keys[i],
    _data: data,
  };
}

test('leaveMembership clears per-church localStorage keys but keeps the parent\'s children\'s names', async () => {
  const events = [];
  const storage = makeStorage(CHURCH);
  const scope = {
    toPub: (x) => x,
    sk: 'deadbeef',
    finalizeEvent: (tmpl, _sk) => { events.push(tmpl); return { ...tmpl, id: 'e1', sig: 'sig', pubkey: 'pk' }; },
    // setEventRsvp / announceMembership / leaveMembership stamp through _monotonicF (sim item 19). These tests are about
    // something else, so the stamp is the identity here; its own behaviour is a-second-write-in-the-same-second-is-not-a-failure.test.mjs.
    _monotonicF: (t) => t,
    finalizeEvent2: (tmpl, _sk) => { events.push(tmpl); return { ...tmpl, id: 'e1', sig: 'sig', pubkey: 'pk' }; },
    _publishAny: async () => true,
    _pubReason: () => 'test',
    publishSetFor: () => ['wss://r'],
    _clearJoinSent: () => {},
    _dropJoinIntent: () => {},
    _joinSent: {},
    _joinIntents: [],
    NET: 'trinityone',
    window: { Fellowship: { relays: ['wss://r'], ready: Promise.resolve() } },
    Math, Date, JSON, console, Number, String,
    localStorage: storage,
    npubEncode: () => CHURCH_NPUB,
    clearTimeout,
    _docsHubs: new Map(), _memHubs: new Map(),
    _nameKeys: new Map(), _nameKeyTs: new Map(),
    _churchRoster: new Map(), _churchRelays: new Map(), _churchList: new Map(),
    _applying: new Set(), _relayNetCache: new Map(),
    _reseatOld: new Map(), _reseatAt: new Map(), _ckMemberKeys: new Map(),
    _churchVoices: new Map(),
    _carekeys: {}, _carekeyRev: {}, _carekeyTs: {},
    _sealedNames: new Map(), _sealedMine: new Map(),
    _gkeys: {}, _gkeyTs: {},
    _dropChurchBoxes: () => {},
    Object,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (String(k) in globalThis) return globalThis[String(k)];
      return undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  scope._forgetChurch = new Function('scope', `with (scope) { return (function _forgetChurch(cp) ${FORGETBODY.slice(FORGETBODY.indexOf('{'))}); }`)(proxy);

  const body = fnBody(FELLOWSHIP, 'async leaveMembership(npubOrHex) {', 'leaveMembership');
  const fn = new Function('scope', `with (scope) { return (async function leaveMembership(npubOrHex) ${body.slice(body.indexOf('{'))}); }`)(proxy);

  const r = await fn(CHURCH);
  assert.ok(r && r.ok, 'leaveMembership should succeed');

  assert.equal(storage.getItem('trinityone.members.' + CHURCH), null,
    'MEMBERS CACHE SURVIVED LEAVING — a phone that left a church still holds its member roster');
  assert.equal(storage.getItem('trinityone.docshub.' + CHURCH), null,
    'DOCS HUB CACHE SURVIVED LEAVING — sealed church documents sit on the phone after leaving');
  assert.equal(storage.getItem('trinityone.memhub.' + CHURCH), null,
    'MEMBER HUB CACHE SURVIVED LEAVING');
  assert.equal(storage.getItem('trinityone.groups.' + CHURCH), null,
    'GROUP LIST SURVIVED LEAVING — the church\'s room names are on the phone after leaving');
  assert.equal(storage.getItem('trinityone.hb:' + CHURCH_NPUB), null,
    'HEARTBEAT MARKER SURVIVED LEAVING');

  assert.ok(storage.getItem('trinityone.bringkids.' + CHURCH_NPUB),
    'bringkids should be KEPT — it is the parent\'s own writing, not the church\'s');
  assert.ok(storage.getItem('trinityone.mykidnames.' + CHURCH_NPUB),
    'mykidnames should be KEPT — a parent typed their own children\'s names');
  assert.ok(storage.getItem('trinityone.arrivedat.' + CHURCH_NPUB),
    'arrivedat should be KEPT — it is useless without the names beside it');

  assert.ok(storage.getItem('trinityone.outbox'),
    'outbox should be KEPT — losing it is data loss');
  assert.ok(storage.getItem('trinityone.followedChurches'),
    'followedChurches should be KEPT — nothing rebuilds it');
});

test('CONTROL: a second church\'s data is not affected by leaving the first', async () => {
  const CHURCH_B = 'bb'.repeat(32);
  const storage = makeStorage(CHURCH);
  storage.setItem('trinityone.members.' + CHURCH_B, JSON.stringify([{ pubkey: 'p2' }]));
  storage.setItem('trinityone.groups.' + CHURCH_B, JSON.stringify([{ id: 'youth' }]));

  const scope = {
    toPub: (x) => x,
    sk: 'deadbeef',
    finalizeEvent: (tmpl, _sk) => ({ ...tmpl, id: 'e1', sig: 'sig', pubkey: 'pk' }),
    // setEventRsvp / announceMembership / leaveMembership stamp through _monotonicF (sim item 19). These tests are about
    // something else, so the stamp is the identity here; its own behaviour is a-second-write-in-the-same-second-is-not-a-failure.test.mjs.
    _monotonicF: (t) => t,
    finalizeEvent2: (tmpl, _sk) => ({ ...tmpl, id: 'e1', sig: 'sig', pubkey: 'pk' }),
    _publishAny: async () => true,
    _pubReason: () => 'test',
    publishSetFor: () => ['wss://r'],
    _clearJoinSent: () => {},
    _dropJoinIntent: () => {},
    _joinSent: {},
    _joinIntents: [],
    NET: 'trinityone',
    window: { Fellowship: { relays: ['wss://r'], ready: Promise.resolve() } },
    Math, Date, JSON, console, Number, String,
    localStorage: storage,
    npubEncode: () => CHURCH_NPUB,
    clearTimeout,
    _docsHubs: new Map(), _memHubs: new Map(),
    _nameKeys: new Map(), _nameKeyTs: new Map(),
    _churchRoster: new Map(), _churchRelays: new Map(), _churchList: new Map(),
    _applying: new Set(), _relayNetCache: new Map(),
    _reseatOld: new Map(), _reseatAt: new Map(), _ckMemberKeys: new Map(),
    _churchVoices: new Map(),
    _carekeys: {}, _carekeyRev: {}, _carekeyTs: {},
    _sealedNames: new Map(), _sealedMine: new Map(),
    _gkeys: {}, _gkeyTs: {},
    _dropChurchBoxes: () => {},
    Object,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (String(k) in globalThis) return globalThis[String(k)];
      return undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  scope._forgetChurch = new Function('scope', `with (scope) { return (function _forgetChurch(cp) ${FORGETBODY.slice(FORGETBODY.indexOf('{'))}); }`)(proxy);

  const body = fnBody(FELLOWSHIP, 'async leaveMembership(npubOrHex) {', 'leaveMembership');
  const fn = new Function('scope', `with (scope) { return (async function leaveMembership(npubOrHex) ${body.slice(body.indexOf('{'))}); }`)(proxy);

  await fn(CHURCH);

  assert.ok(storage.getItem('trinityone.members.' + CHURCH_B),
    'THE SECOND CHURCH\'S MEMBERS WERE WIPED — leaving one church destroyed another\'s data');
  assert.ok(storage.getItem('trinityone.groups.' + CHURCH_B),
    'THE SECOND CHURCH\'S GROUPS WERE WIPED');
});
