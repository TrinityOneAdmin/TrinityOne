// A HOME-SCREEN WIDGET IS HANDED ONLY RELAYS THIS CHURCH'S READ SET ADMITTED — NEVER THE UNGATED BOOTSTRAP LIST.
//   Run: node --test scripts/the-widget-gets-only-relays-the-church-admitted.test.mjs
//
// reference/PLAN-phone-widget-2026-11-16.html §4b; CLAUDE.md rule 10, reference/RELAY-ADMISSION.md. The widget
// fetches the church's public verse prompt with the app closed, from addresses the app gave it. The app gets
// them from Fellowship.widgetFeedBases, which must read relaysForChurch(cp) — the list AFTER the admission gate —
// and never churchRelaysRaw() (deliberately ungated: RELAY-ADMISSION trap 3).
//
// WHAT THIS PROVES AND WHAT IT DOES NOT. The method is lifted out of the SHIPPED bundle (vendor/fellowship.js,
// with the bundle's own names) and run with the two lists it could read standing in as distinct values. It
// proves the method reads the GATED one, keeps only wss:// entries and maps them to the https:// origin. It does
// NOT re-prove the gate — scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs and its siblings do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CP = 'c'.repeat(64);

function lift({ gated, raw }) {
  const body = fnBody(BUNDLE, 'widgetFeedBases(churchNpub) {', 'Fellowship.widgetFeedBases in vendor/fellowship.js');
  const reads = [];
  const scope = {
    toPub: (x) => (x === 'grace' ? CP : null),
    relaysForChurch: (cp) => { reads.push(['relaysForChurch', cp]); return gated; },
    churchRelaysRaw: () => { reads.push(['churchRelaysRaw']); return raw; },
    churchRelays: () => { reads.push(['churchRelays']); return raw; },
    npubEncode: (h) => 'npub-of-' + h.slice(0, 4),
  };
  const fn = new Function(...Object.keys(scope), 'return ({' + body + '}).widgetFeedBases;')(...Object.values(scope));
  return { fn, reads };
}

test('reads the GATED per-church list, and only that', () => {
  const t = lift({ gated: ['wss://box.example/relay', 'wss://a8.example/relay/'], raw: ['wss://unproved.example/relay'] });
  const out = t.fn('grace');
  assert.deepEqual(t.reads, [['relaysForChurch', CP]], 'widgetFeedBases read something other than relaysForChurch(cp) — CLAUDE.md rule 10');
  assert.deepEqual(out.bases, ['https://box.example', 'https://a8.example']);
  assert.equal(out.bases.some(b => b.includes('unproved')), false, 'an UNPROVED relay was handed to the widget');
  assert.equal(out.npub, 'npub-of-cccc');
});

test('drops anything that is not wss:// (no cleartext, nothing odd) and de-duplicates', () => {
  const t = lift({ gated: ['ws://lan.example/relay', 'wss://box.example/relay', 'wss://box.example/relay/', 'https://x.example', ''], raw: [] });
  assert.deepEqual(t.fn('grace').bases, ['https://box.example']);
});

test('no church, or nothing admitted yet, is an honest empty answer', () => {
  assert.equal(lift({ gated: [], raw: [] }).fn('nobody'), null);
  assert.deepEqual(lift({ gated: [], raw: ['wss://unproved.example/relay'] }).fn('grace').bases, []);
});
