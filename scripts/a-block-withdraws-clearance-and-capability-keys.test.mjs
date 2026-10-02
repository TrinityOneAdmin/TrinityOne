// BLOCK WITHDRAWS YOUTH CLEARANCE AND THE CAPABILITY KEYS (sim finding 1, the console half).
//   Run: node --test scripts/a-block-withdraws-clearance-and-capability-keys.test.mjs
//
// Owner, 2026-10-02: "Block means NO private access of any kind: blocking someone also removes their youth clearance."
// The relay half (a blocked reader is served nothing private) is a-blocked-reader-gets-nothing-private.test.mjs. Two
// things on the console side were left:
//   · block() never took the person off `approved:` (the youth-cleared adults), so a blocked adult stayed on the list a
//     child's phone seals its plea for help to;
//   · a steward's capability keys (finance, check-in) were still wrapped to a blocked steward, because
//     ensureCapKeyFor / rotateCapKey, unlike rotateCareKey and rotateMediaKey, never left out whoever this console holds
//     as blocked.
//
// THE POINT OF USE (rule 1): the real DashMembers is rendered and Block pressed — what it writes to the cleared list, and
// that it re-keys the capability keys — and the SHIPPED ensureCapKeyFor / rotateCapKey are lifted out of
// vendor/steward.js and run with real nip44, opening the envelope each person would receive.
//
// Users of the shared code (rule 2): ensureCapKeyFor — the dashboard's key-in-step effect (stew-dashboard.jsx, every
// capability in `_capKinds`) and now block(); rotateCapKey — ensureCapKeyFor's own shrink branch, the finance wrappers
// (rotateFinanceKey) and the check-in rotation; setApproved — toggleApproved, toggleMinor, reseatMember and now block().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody } from './test-slice.mjs';
import { compiled, membersGlobals, press, reads } from './dash-render-kit.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// ── the DASHBOARD: Block presses ───────────────────────────────────────────────────────────────────────────────
const CHURCH = 'c'.repeat(64);
const ADULT = 'a'.repeat(64), OTHER = 'b'.repeat(64), TREASURER = 'e'.repeat(64);
const NOW = Math.floor(Date.now() / 1000);
const members = [
  { pubkey: ADULT, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 },
  { pubkey: OTHER, npub: 'npub1bb', name: 'Cleo Ashby', count: 1, lastTs: NOW - 3600, joined: NOW - 86400 },
];

function rig({ approved = [ADULT, OTHER], setApproved, setBlocked } = {}) {
  const calls = { approved: [], capKeys: [] };
  const steward = {
    actingChurch: '', pubkey: CHURCH,
    setBlocked: () => (setBlocked ? setBlocked() : Promise.resolve(true)),
    setApproved: (list, opts) => { calls.approved.push({ list, opts }); return setApproved ? setApproved() : Promise.resolve(true); },
    rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true),
    ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }), publishGroupKey: () => Promise.resolve({}), publishGroup: () => Promise.resolve(true),
    ensureCapKeyFor: (kind, stewards, caps) => { calls.capKeys.push({ kind, stewards, caps }); return Promise.resolve(true); },
    stewardCaps: () => ({ [TREASURER]: ['finance'] }),
  };
  const g = membersGlobals({ steward, members, stewards: [TREASURER], approved });
  return { calls, g };
}
async function blockBram(r) {
  const { C, draw } = await compiled('DashMembers', r.g, ['rotateChurchKeys', 'takeOffEveryTeam']);
  let tree = draw(C, {});
  await press(tree, /Remove \/ block this member/, { which: 0 });
  tree = draw(C, {});
  await press(tree, /Confirm — bans them/);
  return reads(draw(C, {}));
}

test('Block takes a cleared adult off the youth-cleared list — and only them', async () => {
  const r = rig();
  await blockBram(r);
  assert.equal(r.calls.approved.length, 1, 'THE BLOCKED ADULT IS STILL ON THE YOUTH-CLEARED LIST — a child’s phone seals its plea for help to that list');
  assert.deepEqual(r.calls.approved[0].list, [OTHER], 'the cleared list written back is wrong (someone else dropped, or the blocked adult kept)');
  assert.equal(r.calls.approved[0].opts && r.calls.approved[0].opts.listKnown, true, 'the cleared list was written without saying it had been read (the engine would refuse or mis-date it)');
});

test('Block of someone who was never cleared does not rewrite the cleared list', async () => {
  const r = rig({ approved: [OTHER] });
  await blockBram(r);
  assert.equal(r.calls.approved.length, 0, 'an uncleared person’s Block rewrote the list of cleared adults');
});

test('a clearance write that did not land is named on screen', async () => {
  const r = rig({ setApproved: () => Promise.resolve(false) });
  const said = await blockBram(r);
  assert.match(said, /They are blocked, but this console could not take them off their youth clearance/, 'a refused clearance write said nothing: ' + said.slice(0, 400));
});

test('a Block that may be only partly saved does not touch the cleared list', async () => {
  const r = rig({ setBlocked: () => Promise.resolve(false) });
  await blockBram(r);
  assert.equal(r.calls.approved.length, 0, 'the cleared list was edited for a Block that did not land');
});

test('Block re-keys the finance and check-in capability keys, naming the stewards and their capabilities', async () => {
  const r = rig();
  await blockBram(r);
  assert.deepEqual(r.calls.capKeys.map(c => c.kind).sort(), ['checkin', 'finance'], 'Block did not re-key the capability keys: ' + JSON.stringify(r.calls.capKeys.map(c => c.kind)));
  for (const c of r.calls.capKeys) {
    assert.deepEqual(c.stewards, [TREASURER], 'the capability key was asked about the wrong stewards');
    assert.deepEqual(c.caps, { [TREASURER]: ['finance'] }, 'the capability key was asked without the steward capabilities (everyone would count as unscoped)');
  }
});

// ── the ENGINE: the shipped capability-key writers leave a blocked steward out ───────────────────────────────────
const church = { sk: generateSecretKey() }; church.pub = getPublicKey(church.sk);
const keeper = { sk: generateSecretKey() }; keeper.pub = getPublicKey(keeper.sk);
const blocked = { sk: generateSecretKey() }; blocked.pub = getPublicKey(blocked.sk);
const hex = (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));
const SHIPPED_CAP_KEYS = { finance: { d: 'trinityone/financekey:', cap: 'finance', legacy: false, explicit: false } };
const SHIPPED_CAP_ALLOWS = () => () => true;   // everyone passes the capability test: what is under test is the block, not the ticks

function engine({ docKeys, ring, blockedSet }) {
  const published = [];
  const st = { ring: ring.slice(), docKeys, rev: 1, at: 0, checked: true };
  const stubs = {
    churchSkHeld: () => true, actingChurch: '', _isRelayAuthed: () => true,
    _capState: { finance: st }, CAP_KEYS: SHIPPED_CAP_KEYS,
    pub: church.pub, sk: church.sk, churchPub: church.pub, churchSk: church.sk,
    crypto: webcrypto, _hex: hex, _unhex: unhex,
    // the bundle renames its imports (encrypt3, getConversationKey2, …); the suffix is stripped on lookup below
    encrypt: (p, k) => nip44.encrypt(p, k), decrypt: (c, k) => nip44.decrypt(c, k), getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    nip44e: (p, k) => nip44.encrypt(p, k), nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    _legacyBookKeyHex: () => '',
    _sealEach: async (payload, want, seal) => { const o = {}; for (const w of want) o[w] = seal(payload, w); return o; },
    _warnUnsealed: () => {}, _sealEachFailed: [], _capAllows: SHIPPED_CAP_ALLOWS, _capRingChanged: () => {},
    feChurch: (t) => t, publish: async (e) => { published.push(e); return e; }, now: () => 1787280000, NET: 'trinityone',
    _localBlocked: blockedSet,
    window: { Steward: {} },
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b]; throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const lift = (anchor, name) => new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, anchor, name)} }).${name}; }`)(scope);
  const api = { ensureCapKeyFor: lift('async ensureCapKeyFor(kind, stewardPubs, caps) {', 'ensureCapKeyFor'), rotateCapKey: lift('async rotateCapKey(kind, stewardPubs, caps) {', 'rotateCapKey') };
  stubs.window.Steward = api;     // ensureCapKeyFor's shrink branch calls window.Steward.rotateCapKey
  return { api, published, st };
}
const opens = (env, who) => { const mine = env.keys[who.pub]; if (!mine) return null; return JSON.parse(nip44.decrypt(mine, nip44.utils.getConversationKey(who.sk, church.pub))); };

test('THE ENGINE: ensureCapKeyFor ROTATES the key to the stewards who remain when a blocked one was in the envelope', async () => {
  const OLD = 'ab'.repeat(32);
  const docKeys = { [church.pub]: 'x', [keeper.pub]: 'x', [blocked.pub]: 'x' };
  const e = engine({ docKeys, ring: [OLD], blockedSet: new Set([blocked.pub]) });
  await e.api.ensureCapKeyFor('finance', [keeper.pub, blocked.pub], {});
  assert.equal(e.published.length, 1, 'a blocked steward still in the envelope caused no re-key — they keep the books’ key (published: ' + e.published.length + ')');
  const env = JSON.parse(e.published[0].content);
  assert.deepEqual(Object.keys(env.keys).sort(), [church.pub, keeper.pub].sort(), 'the envelope still names the blocked steward, or lost the one who remains');
  const ringForKeeper = opens(env, keeper);
  assert.equal(ringForKeeper.length, 2, 'the key was not ROTATED (a fresh key in front of the old one); the blocked steward’s copy still opens everything written next');
  assert.equal(ringForKeeper[1], OLD, 'the old key was dropped from the ring, orphaning everything already sealed under it');
  assert.equal(opens(env, blocked), null, 'the blocked steward can still open the new key');
});

test('THE ENGINE: the first mint and a direct rotation also leave a blocked steward out', async () => {
  const minted = engine({ docKeys: null, ring: [], blockedSet: new Set([blocked.pub]) });
  await minted.api.ensureCapKeyFor('finance', [keeper.pub, blocked.pub], {});
  assert.deepEqual(Object.keys(JSON.parse(minted.published[0].content).keys).sort(), [church.pub, keeper.pub].sort(), 'a first mint wrapped the key to a blocked steward');
  const rot = engine({ docKeys: { [church.pub]: 'x' }, ring: ['cd'.repeat(32)], blockedSet: new Set([blocked.pub]) });
  await rot.api.rotateCapKey('finance', [keeper.pub, blocked.pub], {});
  assert.deepEqual(Object.keys(JSON.parse(rot.published[0].content).keys).sort(), [church.pub, keeper.pub].sort(), 'a rotation wrapped the new key to a blocked steward');
});

test('CONTROL: with nobody blocked, a steward is wrapped as before', async () => {
  const e = engine({ docKeys: null, ring: [], blockedSet: new Set() });
  await e.api.ensureCapKeyFor('finance', [keeper.pub, blocked.pub], {});
  assert.deepEqual(Object.keys(JSON.parse(e.published[0].content).keys).sort(), [church.pub, keeper.pub, blocked.pub].sort(), 'the block filter removed stewards who are NOT blocked');
});
