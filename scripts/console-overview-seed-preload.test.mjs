// Preload warming — Layer 1 (Overview) console seeds (2026-11-04).
// Run: node --test scripts/console-overview-seed-preload.test.mjs
//
// The steward console's Overview page is a composite of ~15 relay streams; several opened BLANK on first-ever
// open (no on-disk seed) until the relay answered over the tunnel. This file adds cache-first localStorage seeds
// to those streams, following the pattern proven for Care/DM (Layer 1). Each test LIFTS the REAL subscribe method
// out of the SHIPPED bundle (vendor/steward.js) and runs it against a fake pool, so a source-only change that was
// never built, or a regression that drops the seed, fails here.
//
// A synchronous setTimeout is injected so the methods' 120ms coalesced emit() runs deterministically in-test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function fakeLS() {
  const m = new Map();
  return { store: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
}
const SYNC_TIMEOUT = (fn) => { try { fn(); } catch (e) {} return 0; };

// Lift a shipped method and run it with the module-scoped names it closes over provided as locals.
function load(signature, name, opts = {}) {
  const body = fnBody(BUNDLE, signature);
  const subs = [];
  const pool = { subscribeMany: (relaysArg, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } };
  const ls = opts.localStorage || fakeLS();
  const ctx = {
    pool,
    relays: () => [],
    pub: ('pub' in opts) ? opts.pub : 'CHURCH_A',
    lsGet: (k) => ls.getItem(k),
    lsSet: (k, v) => ls.setItem(k, v),
    setTimeout: SYNC_TIMEOUT,
    clearTimeout: () => {},
    GROUP_D: 'trinityone/group:',
    GROUPKEY_D: 'trinityone/groupkey:',
    FUND_D: 'trinityone/fund:',
    NET: 'trinityone',
    npubEncode: (h) => 'npub-' + String(h).slice(0, 8),
    localStorage: ls,
  };
  const make = new Function(...Object.keys(ctx), 'function ' + body + '\n;return ' + name + ';');
  const fn = make(...Object.values(ctx));
  return { fn, subs, localStorage: ls };
}

// ───────────────────────── STATS (footprint counts) ─────────────────────────
const STATS_KEY = (cp) => 'trinityone.steward.stats.' + cp;

test('stats: paints last-known counts on first open (not 0/0)', () => {
  const ls = fakeLS();
  ls.setItem(STATS_KEY('CHURCH_A'), JSON.stringify({ events: 42, announcements: 7 }));
  const { fn } = load('subscribeStats(onStats)', 'subscribeStats', { localStorage: ls });
  const paints = [];
  fn((v) => paints.push(v));
  assert.ok(paints.length >= 1, 'subscribeStats never painted the cached counts');
  assert.deepEqual(paints[0], { events: 42, announcements: 7 }, 'first paint must be the cached counts');
});

test('stats: writes the seed on SETTLE (oneose), not per replay event', () => {
  const { fn, subs, localStorage } = load('subscribeStats(onStats)', 'subscribeStats');
  fn(() => {});
  subs[0].handlers.onevent({ id: 'e1', kind: 1, pubkey: 'CHURCH_A', tags: [] });
  assert.equal(localStorage.getItem(STATS_KEY('CHURCH_A')), null, 'the seed was written during the replay burst — must wait for EOSE');
  subs[0].handlers.oneose();
  const onDisk = JSON.parse(localStorage.getItem(STATS_KEY('CHURCH_A')) || 'null');
  assert.ok(onDisk && onDisk.events === 1 && onDisk.announcements === 1, 'the seed must be written on settle');
});

test('stats: a transient/offline empty EOSE does NOT clobber good counts with 0', () => {
  const ls = fakeLS();
  ls.setItem(STATS_KEY('CHURCH_A'), JSON.stringify({ events: 42, announcements: 7 }));
  const { fn, subs } = load('subscribeStats(onStats)', 'subscribeStats', { localStorage: ls });
  fn(() => {});
  subs[0].handlers.oneose();   // relay timed out — no events this run
  assert.deepEqual(JSON.parse(ls.getItem(STATS_KEY('CHURCH_A'))), { events: 42, announcements: 7 }, 'an empty EOSE wrote 0 over good counts');
});

// ───────────────────────── ACTIVITY (recent-events feed, BODY-FREE) ─────────────────────────
const ACT_KEY = (cp) => 'trinityone.steward.activity.' + cp;

test('activity: paints the last-known feed on first open (not empty)', () => {
  const ls = fakeLS();
  ls.setItem(ACT_KEY('CHURCH_A'), JSON.stringify([{ id: 'a1', ts: 100, ic: 'chat', tint: 'sage', text: 'Group “X” updated', gid: 'g1' }]));
  const { fn } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity', { localStorage: ls });
  const paints = [];
  fn((list) => paints.push(list));
  assert.ok(paints.length >= 1 && paints[0][0] && paints[0][0].id === 'a1', 'first paint must be the cached activity feed');
});

test('activity: the seed is BODY-FREE — a message event never puts content on disk', () => {
  const { fn, subs, localStorage } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity');
  fn(() => {});
  // an inbound kind-1 group message whose content is a secret — the feed must derive a fixed label, not the text
  subs[0].handlers.onevent({ id: 'm1', kind: 1, pubkey: 'memberhex', created_at: 200, content: 'SECRET-MESSAGE-BODY', tags: [['t', 'g1']] });
  subs[0].handlers.oneose();
  const onDisk = localStorage.getItem(ACT_KEY('CHURCH_A'));
  assert.ok(onDisk, 'nothing was seeded');
  assert.equal(onDisk.includes('SECRET-MESSAGE-BODY'), false, 'message content reached the activity seed');
  assert.ok(onDisk.includes('New message in a group'), 'the derived body-free label must be what is stored');
});

test('activity: writes on settle, not per replay event', () => {
  const { fn, subs, localStorage } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity');
  fn(() => {});
  subs[0].handlers.onevent({ id: 'm1', kind: 1, pubkey: 'memberhex', created_at: 200, content: 'x', tags: [['t', 'g1']] });
  assert.equal(localStorage.getItem(ACT_KEY('CHURCH_A')), null, 'wrote during the replay burst — must wait for EOSE');
  subs[0].handlers.oneose();
  assert.ok(localStorage.getItem(ACT_KEY('CHURCH_A')), 'nothing seeded on settle');
});

test('activity: a transient/offline empty EOSE does NOT clobber a non-empty seed', () => {
  const ls = fakeLS();
  ls.setItem(ACT_KEY('CHURCH_A'), JSON.stringify([{ id: 'a1', ts: 100, ic: 'chat', tint: 'sage', text: 'Group “X” updated', gid: 'g1' }]));
  const { fn, subs } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity', { localStorage: ls });
  fn(() => {});
  subs[0].handlers.oneose();   // relay down — no items seen this run
  const onDisk = JSON.parse(ls.getItem(ACT_KEY('CHURCH_A')));
  assert.ok(onDisk.length === 1 && onDisk[0].id === 'a1', 'an empty EOSE clobbered the good activity seed');
});

// ───────────────────────── church isolation (both) ─────────────────────────
test('church isolation: church B never paints or overwrites church A', () => {
  const ls = fakeLS();
  ls.setItem(STATS_KEY('CHURCH_A'), JSON.stringify({ events: 42, announcements: 7 }));
  ls.setItem(ACT_KEY('CHURCH_A'), JSON.stringify([{ id: 'a1', ts: 100, ic: 'chat', tint: 'sage', text: 'x', gid: 'g1' }]));
  const s = load('subscribeStats(onStats)', 'subscribeStats', { localStorage: ls, pub: 'CHURCH_B' });
  const paintsS = []; s.fn((v) => paintsS.push(v));
  assert.ok(!paintsS.some(v => v.events === 42), 'church B painted church A stats');
  s.subs[0].handlers.onevent({ id: 'e1', kind: 1, pubkey: 'CHURCH_B', tags: [] });
  s.subs[0].handlers.oneose();
  assert.deepEqual(JSON.parse(ls.getItem(STATS_KEY('CHURCH_A'))), { events: 42, announcements: 7 }, 'church A stats overwritten');
  assert.ok(ls.getItem(STATS_KEY('CHURCH_B')), 'church B stats must be under its own key');
});

// ───────────────────────── LEAKS: nothing that must not be on disk ─────────────────────────
test('LEAKS: no message/body content lands on disk from any overview seed', () => {
  const { fn, subs, localStorage } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity');
  fn(() => {});
  subs[0].handlers.onevent({ id: 'm1', kind: 1, pubkey: 'memberhex', created_at: 200, content: 'PRIVATE-PLEA-TEXT', tags: [['t', 'g1']] });
  subs[0].handlers.oneose();
  for (const [, v] of localStorage.store) assert.equal(String(v).includes('PRIVATE-PLEA-TEXT'), false, 'plaintext body content found on disk: ' + v);
});
