// Preload warming — Layer 1 console DM-conversation-LIST seed (2026-11-03).
// Run: node --test scripts/console-dmconvos-seed-preload.test.mjs
//
// The console's private-messages LIST (subscribeDMConvos) kept no on-disk copy, so it opened BLANK on
// first-ever open until the relay answered. The list is BODY-FREE — each row is { peer, npub, ts }, never any
// message text — so it is seeded unconditionally (like subscribeGroups). This lifts the REAL subscribeDMConvos
// out of the SHIPPED bundle (vendor/steward.js) and runs it against a fake pool, so a source-only change that
// was never built, or a regression that drops the seed, fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const KEY = (cp) => 'trinityone.steward.dmconvos.' + cp;

function fakeLS() {
  const m = new Map();
  return { store: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
}

// Lift the shipped method and run it with the module-scoped names it closes over provided as locals.
function loadDMConvos(opts = {}) {
  const body = fnBody(BUNDLE, 'subscribeDMConvos(onConvos)');
  assert.ok(body.includes('trinityone.steward.dmconvos.'),
    'the DM-convo seed is gone from vendor/steward.js — rebuild: bash scripts/build-steward.sh');
  const subs = [];
  const pool = { subscribeMany: (relaysArg, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } };
  const ctx = {
    pool,
    relays: () => [],
    npubEncode: (h) => 'npub-' + String(h).slice(0, 8),
    pub: opts.pub || 'PUBKEYCHURCH',
    actingChurch: ('actingChurch' in opts) ? opts.actingChurch : '',
    churchPub: ('churchPub' in opts) ? opts.churchPub : (opts.pub || 'PUBKEYCHURCH'),
    localStorage: opts.localStorage || fakeLS(),
  };
  const make = new Function(...Object.keys(ctx), 'function ' + body + '\n;return subscribeDMConvos;');
  const subscribeDMConvos = make(...Object.values(ctx));
  return { subscribeDMConvos, subs, localStorage: ctx.localStorage, ctx };
}

test('the DM list paints its warm seed on FIRST open (not blank)', () => {
  const ls = fakeLS();
  ls.setItem(KEY('CHURCH_A'), JSON.stringify([{ peer: 'peerhex1', npub: 'npub-peerhex1', ts: 100 }]));
  const { subscribeDMConvos } = loadDMConvos({ pub: 'CHURCH_A', churchPub: 'CHURCH_A', localStorage: ls });
  const paints = [];
  subscribeDMConvos((list) => paints.push(list));
  assert.ok(paints.length >= 1, 'subscribeDMConvos never painted — the cache-first read is missing');
  assert.equal(paints[0][0].peer, 'peerhex1', 'first paint must be the cached conversation, not the empty state');
});

test('a delivered DM updates the seed, and the seed is body-free (peer/npub/ts only)', () => {
  const { subscribeDMConvos, subs, localStorage } = loadDMConvos({ pub: 'CHURCH_A', churchPub: 'CHURCH_A' });
  subscribeDMConvos(() => {});
  // an inbound kind-4 from a member — note the ciphertext content is never read into the row
  subs[0].handlers.onevent({ kind: 4, pubkey: 'memberhex', tags: [['p', 'CHURCH_A']], created_at: 200, content: 'BASE64-CIPHERTEXT-SECRET' });
  subs[0].handlers.oneose();   // the stream settles — the seed is persisted on settle, not per replay event
  const onDisk = localStorage.getItem(KEY('CHURCH_A'));
  assert.ok(onDisk, 'nothing was seeded on delivery');
  assert.equal(onDisk.includes('BASE64-CIPHERTEXT-SECRET'), false, 'message ciphertext/content reached the DM-list seed');
  const row = JSON.parse(onDisk).find(r => r.peer === 'memberhex');
  assert.ok(row, 'the conversation must be in the seed');
  assert.deepEqual(Object.keys(row).sort(), ['npub', 'peer', 'ts'], 'the DM-list row must carry ONLY peer/npub/ts');
});

test('church isolation: the seed is keyed on actingChurch||churchPub, not bare pub', () => {
  const ls = fakeLS();
  // device church is A; acting as church B (delegated). pub is set to B here (delegated mode: pub == actingChurch)
  ls.setItem(KEY('CHURCH_A'), JSON.stringify([{ peer: 'apeer', npub: 'npub-apeer', ts: 9 }]));
  const { subscribeDMConvos, subs, localStorage } = loadDMConvos({ pub: 'CHURCH_B', churchPub: 'CHURCH_A', actingChurch: 'CHURCH_B', localStorage: ls });
  const paints = [];
  subscribeDMConvos((list) => paints.push(list));
  assert.ok(!paints.some(p => p.some(r => r.peer === 'apeer')), 'church B painted church A\'s DM list');
  subs[0].handlers.onevent({ kind: 4, pubkey: 'bpeer', tags: [['p', 'CHURCH_B']], created_at: 5, content: 'x' });
  subs[0].handlers.oneose();   // settle — seed persisted on settle, not per replay event
  assert.ok(localStorage.getItem(KEY('CHURCH_B')), 'the new conversation must be seeded under the ACTING church key');
  assert.equal(JSON.parse(localStorage.getItem(KEY('CHURCH_A')))[0].peer, 'apeer', 'church A\'s DM seed was overwritten');
});
