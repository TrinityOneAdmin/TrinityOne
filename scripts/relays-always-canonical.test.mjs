// THE CONSOLE MUST PUBLISH TO THE SAME PUBLIC RELAYS MEMBERS READ FROM — ALWAYS, NOT ONLY WHEN IT HAPPENS
// TO SIT ON ONE OF THEM.
// Run: node --test scripts/relays-always-canonical.test.mjs
//
// Owner's model, 2026-08-18: nobody picks relays. The console and every member use the same default public
// TrinityOne set (CANONICAL_RELAYS), and the church's rules are published to all of it so each relay enforces
// from its own copy.
//
// THE DEFECT. relays() — the console's publish target — fanned out to the canonical set only when
// `own === CANONICAL_RELAY`. So a console whose own relay was NOT exactly the canonical one (a self-hoster, a
// dev box, the tailscale funnel) published the church's governing documents to that ONE relay, while members
// still read from the canonical set. Measured 2026-08-18: a member banned from a funnel-based console read the
// adult group from two canonical relays that never received the block, because the block never went there.
//
// This is not about a member choosing a relay — members already read the canonical set and always did. It is
// that the CONSOLE has to write to the same set unconditionally, or the rules and the traffic land on
// different relays.
//
// The test drives the real relays() lifted from source with ownRelay/extraRelays stubbed, and asserts the
// canonical set is present for EVERY value of `own` — not that some particular line exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const CANON = ['wss://app.trinityone.church/relay', 'wss://trinityone-master-01.tailbeaac0.ts.net/relay'];

// lift relays() and run it against controllable own/extra
function makeRelays(own, extra) {
  const body = fnBody(SRC, 'function relays()');
  const fn = new Function('ownRelay', 'extraRelays', 'CANONICAL_RELAY', 'CANONICAL_RELAYS',
    body + '\n; return relays;')(
    () => own, () => (extra || []), CANON[0], CANON);
  return fn();   // invoke it — the array of relays, not the function
}

test('the canonical public set is a publish target whatever relay the console sits on', () => {
  for (const own of [
    'wss://app.trinityone.church/relay',                    // production default — always worked
    'ws://127.0.0.1:8000/relay',                            // dev box / funnel — the case that diverged
    'wss://a-parish.example/relay',                         // a self-hoster
  ]) {
    const out = makeRelays(own, []);
    for (const c of CANON) {
      assert.ok(out.includes(c),
        `console on ${own} does not publish to ${c} — a member reading there never gets this church's rules, ` +
        'which is exactly how a banned member read from a relay that never received the block');
    }
    assert.ok(out.includes(own), 'the console must still publish to its own relay too');
  }
});

test('an extra relay a church added is still included', () => {
  const out = makeRelays('ws://127.0.0.1:8000/relay', ['wss://diocese.example/relay']);
  assert.ok(out.includes('wss://diocese.example/relay'), 'a deliberately-added relay must not be dropped');
  for (const c of CANON) assert.ok(out.includes(c), 'and canonical is still there alongside it');
});

test('no duplicates when own IS canonical', () => {
  const out = makeRelays(CANON[0], []);
  assert.equal(out.filter(r => r === CANON[0]).length, 1, 'the primary canonical relay must appear once, not twice');
});
