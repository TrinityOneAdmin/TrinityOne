// EVERY READ SUBSCRIPTION GOES THROUGH THE RELAY GATE.
// Run: node --test scripts/reads-only-reach-admitted-relays.test.mjs
//
// The 12 pool.subscribeMany calls in src/fellowship.src.js used to pass window.Fellowship.relays straight to
// the pool. That bypassed the C4 gate, so a fake box answering at a shipped address received every member's
// pubkey, DM inbox filter, room ids, church profile, and a signed AUTH tying the key to the IP. Every one now
// goes through _netRelays(), and pool.automaticallyAuth refuses to sign for a relay the gate has not admitted.
//
// This test verifies BOTH from the shipped bundle:
//   1. STRUCTURAL: every subscription function's body contains _netRelays( — a text assertion that works on
//      vendor/*.js because esbuild removes dead code (CLAUDE.md rule 3). Removing the wrapper and rebuilding
//      makes the text disappear and the test fail.
//   2. BEHAVIOURAL: pool.automaticallyAuth refuses a non-admitted URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const SUBSCRIPTIONS = [
  'subscribeDMs',
  'subscribeGroups',
  'subscribeReactions',
  'subscribeGroup',
  'subscribeGroupPin',
  'subscribeHidden',
  'subscribeGroupEvents',
  'subscribeNetworkAnnouncements',
  'subscribeMyServingRequests',
  'subscribeMyReqReplies',
  'subscribeMyRsvps',
  'subscribeChurchProfile',
];

for (const name of SUBSCRIPTIONS) {
  test(`${name} goes through the relay gate`, () => {
    const body = fnBody(FELLOW, name + '(', name);
    assert.match(body, /_netRelays\(/,
      `vendor/fellowship.js: ${name} subscribes over raw window.Fellowship.relays — ` +
      'a fake box at a shipped address receives this member\'s traffic');
    assert.doesNotMatch(body, /pool\.subscribeMany\(window\.Fellowship\.relays\b/,
      `vendor/fellowship.js: ${name} still has a raw pool.subscribeMany(window.Fellowship.relays) call`);
  });
}

test('pool.automaticallyAuth refuses a non-admitted relay', () => {
  const at = FELLOW.indexOf('pool.automaticallyAuth = (url) =>');
  assert.notEqual(at, -1, 'pool.automaticallyAuth assignment is missing from vendor/fellowship.js');
  const region = FELLOW.slice(at, at + 500);
  assert.match(region, /_gate\.admits\(url\)/,
    'vendor/fellowship.js: automaticallyAuth does not check the gate — a non-admitted relay receives a ' +
    'signed AUTH tying the member\'s key to their IP');
});
