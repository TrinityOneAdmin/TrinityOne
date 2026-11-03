// AUTO-FIND SHOWS EACH RELAY'S CLAIMED NAME, AND BADGES A BOX THIS CHURCH ALREADY SIGNED.
// Run: node --test scripts/auto-find-shows-the-claimed-name.test.mjs
//
// SPEC-relay-self-healing-2026-11-03 §4b (owner, clarity only — NOT a safety gate). The Auto-find list used
// to show every candidate under its generic NIP-11 name ("TrinityOne relay"), because discoverRelayOffers
// kept only `.url` from the /relay-names/offers directory record and threw its `handle` away. The directory
// record carries the box's claimed handle (verified live: w-relay-starter-005 etc.), so the row SHOULD show
// it. And a row whose handle matches a box this church has already signed is badged "One of yours", so the
// steward can tell their own boxes from the shared pilot pool at a glance. Peer boxes are never suppressed or
// re-ordered — sharing relays is part of the pilot.
//
// POINT OF USE (CLAUDE.md rule 1 / rule 3): part 1 lifts the REAL discoverRelayOffers + listRelayOffers from
// src/steward.src.js and RUNS them; part 2 compiles and RENDERS the REAL DashAddRelayCard and reads the tree
// (no text-match on the unbundled jsx). Binds no port, spawns nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { compileScreen, miniReact, find, texts, reads } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'src/steward.src.js'), 'utf8');

const DIR_BOX = 'wss://triangle-homeland-interests.trycloudflare.com/relay';
const SEED_BOX = 'wss://seeded-no-handle.example/relay';
const HANDLE = 'w-relay-starter-005';

// ── 1. THE ENGINE: the claimed handle becomes the row's name; a signed box is flagged `mine` ─────────────

function liftOffers() {
  const scope = {
    _dirBases: () => ['https://dir.example'],
    fetch: async (u) => ({ ok: true, json: async () => ({ relays: [{ handle: HANDLE, url: DIR_BOX }] }) }),
    normRelay: new Function(fnBody(SRC, 'function normRelay(', 'normRelay') + '\nreturn normRelay;')(),
    _discoverySeed: [SEED_BOX],
    CANONICAL_RELAYS: [],
    extraRelays: () => [],
    // NIP-11 reports a GENERIC name for every box; the handle must win for the directory box.
    _relayInfo: async () => ({ enforces: true, open: true, full: false, operator: '', region: '', churches: 0, name: 'TrinityOne relay', ms: 20 }),
    admitRemoteRelay: async () => true,
    _probeRelayEnforces: async () => ({ ok: true }),
  };
  const names = Object.keys(scope);
  return new Function(...names, fnBody(SRC, 'async function discoverRelayOffers(', 'discoverRelayOffers') + '\nreturn discoverRelayOffers;')(...names.map(n => scope[n]));
}

test('discoverRelayOffers labels the directory box with its claimed HANDLE, not the generic NIP-11 name', async () => {
  const discover = liftOffers();
  const offers = await discover(null, null);
  const row = offers.find(o => o.url === DIR_BOX);
  assert.ok(row, 'the directory box was dropped from the offers list');
  assert.equal(row.name, HANDLE, 'the row still shows the generic NIP-11 name — the claimed handle was discarded again');
  assert.equal(row.handle, HANDLE, 'the handle was not carried on the offer for the "one of yours" match');
});

test('a seeded candidate with no claimed handle keeps the generic NIP-11 name as a fallback', async () => {
  const discover = liftOffers();
  const offers = await discover(null, null);
  const row = offers.find(o => o.url === SEED_BOX);
  assert.ok(row, 'the seeded candidate was dropped');
  assert.equal(row.name, 'TrinityOne relay', 'a handle was invented for a box the directory does not name');
  assert.equal(row.handle, '', 'a box with no directory handle reported one');
});

test('listRelayOffers badges `mine` for a handle this church signed, and nothing else', async () => {
  const offers = [
    { url: DIR_BOX, name: HANDLE, handle: HANDLE, ms: 20 },
    { url: SEED_BOX, name: 'TrinityOne relay', handle: '', ms: 40 },
    { url: 'wss://peer.example/relay', name: 'someone-elses-box', handle: 'someone-elses-box', ms: 60 },
  ];
  const scope = {
    discoverRelayOffers: async () => offers,
    relays: () => [],
    rankOffersByLatency: new Function(fnBody(SRC, 'function rankOffersByLatency(', 'rankOffersByLatency') + '\nreturn rankOffersByLatency;')(),
    relayNetEntries: async () => [{ pubkey: 'a'.repeat(64), url: DIR_BOX, name: HANDLE }],   // this church signed w-relay-starter-005
    pub: 'f'.repeat(64),
  };
  const names = Object.keys(scope);
  const listRelayOffers = new Function(...names, 'async function ' + fnBody(SRC, 'listRelayOffers(region) {', 'listRelayOffers') + '\nreturn listRelayOffers;')(...names.map(n => scope[n]));
  const ranked = await listRelayOffers(null);
  assert.equal(ranked.find(o => o.url === DIR_BOX).mine, true, 'the church\'s own signed box is not badged "one of yours"');
  assert.equal(ranked.find(o => o.url === 'wss://peer.example/relay').mine, undefined, 'a peer box was wrongly badged as one of yours');
  assert.equal(ranked.length, 3, 'a peer box was suppressed — sharing relays is intended in the pilot');
});

// ── 2. THE SCREEN: the handle and the badge are rendered by the real card ───────────────────────────────

function card(offers) {
  const DASH = compileScreen('app/stew-dashboard.jsx');
  const { React, draw } = miniReact();
  const listeners = new Map();
  const steward = {
    useStewardChurch: () => ({ name: 'Grace Church' }),
    listRelayOffers: async () => offers.slice(),
    isSharedRelaySpelling: () => false,
    isOwnRelaySpelling: () => false,
    addRelay: () => '', knownRelay: () => '', rememberRelayName: () => {},
    publishRelayList: async () => null, signRelay: async () => '',
    connectFoundRelays: async (p) => p,
  };
  const win = {
    useStewardChurch: steward.useStewardChurch,
    addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(f); },
    removeEventListener(t, f) { const a = listeners.get(t) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatchEvent(e) { (listeners.get(e && e.type) || []).slice().forEach(f => f(e)); return true; },
    Steward: steward,
  };
  const globals = {
    React, window: win,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' },
    navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; },
    SkPill: function SkPill() { return null; },
    SkBadge: function SkBadge() { return null; },
    useStewDialog: () => ({ current: null }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, DASH + '\nreturn { DashAddRelayCard };')(...names.map(k => globals[k]));
  return { draw: () => draw(mod.DashAddRelayCard, {}) };
}
const settle = () => new Promise(r => setImmediate(r));
async function search(c) {
  let tree = c.draw();
  const btn = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Auto-find relays for me'));
  assert.equal(btn.length, 1, 'the Auto-find button is gone — re-anchor this test');
  btn[0].props.onClick();
  await settle(); await settle();
  return c.draw();
}

test('the card renders the claimed handle on the row and a "One of yours" badge on a signed box', async () => {
  const offers = [
    { url: DIR_BOX, name: HANDLE, handle: HANDLE, ms: 20, mine: true },
    { url: 'wss://peer.example/relay', name: 'someone-elses-box', handle: 'someone-elses-box', ms: 60 },
  ];
  const tree = await search(card(offers));
  const screen = reads(tree);
  assert.ok(screen.includes(HANDLE), 'the claimed handle is not shown on the Auto-find row — it still reads as a raw/generic name');
  assert.ok(screen.includes('someone-elses-box'), 'a peer box\'s claimed name is not shown');
  assert.ok(screen.includes('One of yours'), 'the "One of yours" badge is not rendered for a box this church signed');
  // exactly one badge: the peer box must NOT be badged
  assert.equal((screen.match(/One of yours/g) || []).length, 1, 'the badge is shown on a box this church did not sign');
});
