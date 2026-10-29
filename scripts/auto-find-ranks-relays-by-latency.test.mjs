// AUTO-FIND'S VISIBLE LIST IS THE FASTEST PUBLIC RELAYS FIRST.
// Run: node --test scripts/auto-find-ranks-relays-by-latency.test.mjs
//
// Owner decision 2026-10-29: the Auto-find card defaults its VISIBLE list to the five fastest public relays,
// with a "Show all" control, while the AUTOMATIC pick (findRelays/autoPickRelays -> pickRelays) is left
// exactly as it was. The ranking is purely cosmetic and sits strictly DOWNSTREAM of admission: its input is
// discoverRelayOffers()'s already-gated output (admitRemoteRelay C5, then _probeRelayEnforces for a
// non-canonical box), so re-ordering it can never admit anything (RELAY-ADMISSION.md; CLAUDE.md rule 10).
//
// THIS is the pure point-of-use for the ORDER. It lifts the SHIPPED rankOffersByLatency out of
// src/steward.src.js and runs it — not a mirror written here (reference: tests-must-drive-shipped-code). The
// top-5 default and the "Show all" reveal live on the screen and are proved by rendering the real card in
// scripts/auto-find-shows-the-fastest-five.test.mjs. This file binds no port, spawns nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'src/steward.src.js'), 'utf8');

// Lift the real function and run it. It reads only Number/Infinity, so it needs no injected globals.
const rankOffersByLatency = new Function(fnBody(SRC, 'function rankOffersByLatency(') + '\nreturn rankOffersByLatency;')();

test('the ranked list is ordered by measured latency, fastest first', () => {
  const ranked = rankOffersByLatency([
    { url: 'wss://c/relay', ms: 300 },
    { url: 'wss://a/relay', ms: 40 },
    { url: 'wss://b/relay', ms: 120 },
  ]);
  assert.deepEqual(ranked.map(o => o.url), ['wss://a/relay', 'wss://b/relay', 'wss://c/relay'],
    'the display list is not sorted by ms ascending — the "fastest first" promise on the card is a lie');
  for (const o of ranked) assert.equal(typeof o.ms, 'number', 'an offer reached the display list without a numeric ms');
});

test('a relay that never answered its NIP-11 probe sinks to the bottom, never to the top', () => {
  // ms is null/absent when _relayInfo timed out. A missing measurement must not masquerade as 0ms and jump
  // the queue ahead of relays that actually answered quickly.
  const ranked = rankOffersByLatency([
    { url: 'wss://slow/relay', ms: 500 },
    { url: 'wss://untimed/relay', ms: null },
    { url: 'wss://fast/relay', ms: 25 },
  ]);
  assert.deepEqual(ranked.map(o => o.url), ['wss://fast/relay', 'wss://slow/relay', 'wss://untimed/relay'],
    'an un-timed relay did not sink to the bottom');
});

test('ranking is non-destructive and tolerates no input', () => {
  const input = [{ url: 'wss://x/relay', ms: 10 }];
  const out = rankOffersByLatency(input);
  assert.notEqual(out, input, 'rankOffersByLatency mutated/returned its argument — it must sort a copy');
  assert.deepEqual(rankOffersByLatency(null), [], 'rankOffersByLatency(null) should be the empty list, not a throw');
  assert.deepEqual(rankOffersByLatency(undefined), [], 'rankOffersByLatency(undefined) should be the empty list');
});
