// THE CONSOLE'S "SET UP ACCOUNTS" ENGINE AND THE PARENT'S createChildAccount MUST ORDER THEIR WRITES.
// Run: node --test scripts/member-account-writes-in-one-second-both-land.test.mjs
//
// The bug: createMemberAccount / tombstoneMemberAccount (src/steward.src.js) and createChildAccount
// (src/fellowship.src.js) signed documents WITHOUT the _monotonic / _monotonicF tie-breaker. Two writes of the same
// addressable document in one second then TIE on created_at, the relay refuses the loser ("have-newer") and nobody
// is told. The cruel case is the REMOVE: tombstoning a member in the same second as the add that it undoes.
//
// POINT OF USE: the bodies below are lifted out of the SHIPPED bundles (vendor/steward.js, vendor/fellowship.js) and
// run, with the real _monotonic / _monotonicF, the real signing, and the relay's REAL store (scripts/event-store.mjs)
// as the judge. Nothing that decides the stamp is stubbed. Deleting a wrap from src and rebuilding turns these red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { privateKeyFromSeedWords, generateSeedWords } from 'nostr-tools/nip06';
import { npubEncode } from 'nostr-tools/nip19';
import { encrypt as nip44e, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import { openStore } from './event-store.mjs';
import { fnBody, stmt } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const FELL = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
const nameFor = (src, base) => (src.match(new RegExp('\\b' + base + '\\d*\\b')) || [])[0] || base;
const FIXED = Math.floor(Date.now() / 1000);          // ONE frozen second for every write below
const CHURCH_PUB = getPublicKey(generateSecretKey());

// ── STEWARD: the lifted engine ───────────────────────────────────────────────────────────────────────
function consoleEngine() {
  const sent = [];
  const create = fnBody(STEW, 'async createMemberAccount(name, opts) {', 'createMemberAccount');
  const tomb = fnBody(STEW, 'async tombstoneMemberAccount(mnemonic) {', 'tombstoneMemberAccount');
  const scope = {
    _lastStamp: new Map(), now: () => FIXED, actingChurch: CHURCH_PUB, pub: CHURCH_PUB,
    [nameFor(create, 'finalizeEvent')]: finalizeEvent, [nameFor(create, 'getPublicKey')]: getPublicKey,
    privateKeyFromSeedWords, npubEncode, encrypt2: nip44e, getConversationKey: nip44ck,
    _quietSend: async (evt) => { sent.push(evt); return { ok: true }; },
    measureRelaySkew: async () => 0, setTimeout,
    JSON, Math, Number, String, Object, Array, Set, Date, RegExp, Promise, Error,
  };
  const prelude = [
    stmt(STEW, 'var _CLOCK_SKEW = ', '_CLOCK_SKEW'), stmt(STEW, 'var SKEW_CAP_SEC = ', 'SKEW_CAP_SEC'),
    stmt(STEW, 'var STAMP_CAP_SEC = ', 'STAMP_CAP_SEC'), stmt(STEW, 'var SKEW_WAIT_MS = ', 'SKEW_WAIT_MS'),
    stmt(STEW, 'var _relaySkewSec = 0', '_relaySkewSec'), stmt(STEW, 'var _skewMeasuredAt = 0', '_skewMeasuredAt'),
    stmt(STEW, 'var _skewProven = false', '_skewProven'), stmt(STEW, 'var _skewSpreadSec = 0', '_skewSpreadSec'),
    stmt(STEW, 'var _skewWaited = false', '_skewWaited'),
    fnBody(STEW, 'function _skewShift', '_skewShift'), fnBody(STEW, 'function ensureSkew', 'ensureSkew'),
    fnBody(STEW, 'function _skewGate', '_skewGate'), fnBody(STEW, 'function _monotonic(tmpl)', '_monotonic'),
    stmt(STEW, 'var NET = ', 'NET'),
  ].join('\n');
  const api = new Function('scope', 'with (scope) {\n' + prelude + '\nreturn ({\n' + create + ',\n' + tomb + '\n}); }')(scope);
  return { api, sent };
}

test('1 STEWARD: removing a member in the SAME second as the add is stamped AFTER it, and the relay keeps the tombstones', async () => {
  const { api, sent } = consoleEngine();
  const mnemonic = generateSeedWords();
  const r = await api.createMemberAccount('Ruth', { mnemonic });
  assert.equal(r.ok, true, 'fixture: createMemberAccount did not complete: ' + JSON.stringify(r));
  const join = sent.find(e => dOf(e).startsWith('trinityone/member:'));
  const nameDoc = sent.find(e => dOf(e).startsWith('trinityone/name:'));
  assert.ok(join && nameDoc, 'fixture: expected a join and a name document');
  assert.equal(await api.tombstoneMemberAccount(mnemonic), true);
  const nameGone = sent.filter(e => dOf(e).startsWith('trinityone/name:')).pop();
  const memberGone = sent.filter(e => dOf(e).startsWith('trinityone/member:')).pop();
  assert.ok(nameGone !== nameDoc && memberGone !== join, 'fixture: no tombstone was produced');
  assert.ok(nameGone.tags.some(t => t[0] === 'deleted') && memberGone.tags.some(t => t[0] === 'deleted'));
  assert.ok(nameGone.created_at > nameDoc.created_at,
    'THE REMOVE TIES THE ADD: the name tombstone is stamped ' + nameGone.created_at + ' and the name it undoes ' + nameDoc.created_at + ' — tombstoneMemberAccount/createMemberAccount lost their _monotonic wrap');
  assert.ok(memberGone.created_at > join.created_at,
    'THE REMOVE TIES THE ADD: the member tombstone is stamped ' + memberGone.created_at + ' and the join it undoes ' + join.created_at);
  // the relay's REAL store, add then remove in order: the tombstones must be what is left
  const s = openStore(':memory:');
  for (const e of [join, nameDoc, nameGone, memberGone]) s.put(e, CHURCH_PUB);
  for (const g of [nameGone, memberGone]) {
    const held = s.query({ kinds: [30078], '#d': [dOf(g)] });
    assert.equal(held.length, 1);
    assert.equal(held[0].id, g.id, 'the relay kept the ADD, not the remove for ' + dOf(g) + ' — the remove was silently lost');
  }
  s.close();
});

// ── FELLOWSHIP: a same-second retry of createChildAccount ───────────────────────────────────────────
function mintChild(mnemonic, parentSk, events) {
  const body = fnBody(FELL, 'async createChildAccount(churchNpub, childName, opts) {', 'createChildAccount');
  const pubParent = getPublicKey(parentSk);
  const scope = {
    _sgMine: () => null, publishSetFor: () => ['wss://test.invalid'], sk: parentSk, pub: pubParent, toPub: () => CHURCH_PUB, NET: 'trinityone', _needAuth: false,
    _saveChildLink: () => {}, _pubReason: () => '', _publishAny: async (_r, e) => { events.push(e); },
    [nameFor(body, 'finalizeEvent')]: finalizeEvent, [nameFor(body, 'getPublicKey')]: getPublicKey, privateKeyFromSeedWords, npubEncode,
    [nameFor(body, 'encrypt')]: nip44e, [nameFor(body, 'getConversationKey')]: nip44ck,
    console: { warn() {} },
    window: { Fellowship: { relays: ['wss://test.invalid'], ready: Promise.resolve() }, TrinityIdentity: { makeInvite: () => ({ mnemonic, profile: {} }) } },
    // the FROZEN second; _monotonicF and createChildAccount both read Date.now()
    Date: { now: () => FIXED * 1000 },
    _lastStampF: new Map(),
  };
  const keys = Object.keys(scope);
  const lifted = fnBody(FELL, 'function _monotonicF(tmpl)', '_monotonicF');
  return new Function(...keys, lifted + '\nreturn ({ ' + body + ' }).createChildAccount;')(...keys.map(k => scope[k]));
}

test('2 FELLOWSHIP: a same-second retry of createChildAccount with the SAME child key — every document of the second attempt is stamped after the first and both land', async () => {
  const parentSk = generateSecretKey();
  const mnemonic = generateSeedWords();           // ONE child key across both calls: two children would never tie (vacuous)
  const events = [];
  const create = mintChild(mnemonic, parentSk, events);
  assert.equal((await create('npub1church', 'Ellie', { mnemonic })).ok, true);
  const n = events.length; assert.equal(n, 4, 'fixture: four documents per attempt');
  assert.equal((await create('npub1church', 'Ellie', { mnemonic })).ok, true);
  assert.equal(events.length, 2 * n);
  const first = events.slice(0, n), second = events.slice(n);
  assert.equal(first[0].pubkey === second[0].pubkey, true, 'fixture: the retry must reuse the child key');
  const keyOf = (e) => e.kind + ':' + e.pubkey + ':' + dOf(e);
  for (const a of first) {
    const b = second.find(e => keyOf(e) === keyOf(a));
    assert.ok(b, 'fixture: the retry produced no counterpart of ' + keyOf(a));
    assert.ok(b.created_at > a.created_at,
      'A RETRY TIES ITS FIRST ATTEMPT on ' + (dOf(a) || 'kind ' + a.kind) + ' (' + a.created_at + ' vs ' + b.created_at + ') — createChildAccount lost its _monotonicF wrap on this document');
  }
  const s = openStore(':memory:');
  for (const e of events) s.put(e, CHURCH_PUB);
  for (const b of second) {
    const held = s.query(b.kind === 0 ? { kinds: [0], authors: [b.pubkey] } : { kinds: [30078], authors: [b.pubkey], '#d': [dOf(b)] });
    assert.equal(held.length, 1);
    assert.equal(held[0].id, b.id, 'the relay kept the FIRST attempt of ' + (dOf(b) || 'kind 0') + ', not the retry');
  }
  s.close();
});

test('3 STEWARD: a same-second RE-RUN of createMemberAccount for the same member stamps every document (join, kind-0, name) after the first run', async () => {
  const { api, sent } = consoleEngine();
  const mnemonic = generateSeedWords();           // the SAME member key both times
  assert.equal((await api.createMemberAccount('Ruth', { mnemonic })).ok, true);
  const n = sent.length; assert.equal(n, 3, 'fixture: join, kind-0, name');
  assert.equal((await api.createMemberAccount('Ruth', { mnemonic })).ok, true);
  const first = sent.slice(0, n), second = sent.slice(n);
  const keyOf = (e) => e.kind + ':' + e.pubkey + ':' + dOf(e);
  for (const a of first) {
    const b = second.find(e => keyOf(e) === keyOf(a));
    assert.ok(b, 'fixture: no counterpart of ' + keyOf(a));
    assert.ok(b.created_at > a.created_at, 'A RE-RUN TIES ITS FIRST on ' + (dOf(a) || 'kind ' + a.kind) + ' — createMemberAccount lost its _monotonic wrap there');
  }
});
