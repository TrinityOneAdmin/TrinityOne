// THE SECOND CHURCH ON A RELAY MUST NOT FAIL SILENTLY.
// Run: node --test scripts/second-church-on-a-relay.test.mjs
//
// Both defects here were found by SETTING UP a simulation round with two churches on one relay — something
// nothing had ever done. Neither is a relay bug; the relay behaves correctly in both cases. They are the
// client failing to notice, and failing to say.
//
// 1. REGISTRATION. A private relay already carrying a church refuses a fresh key's self-registration
//    (gateway.mjs, RELAY-AUDIT-2026-07-20 H4) unless the operator adds it or turns on "Offer to host other
//    churches". Correct — it is what stops a stranger seeding themselves onto a church's relay. But
//    selfRegister() returned nothing and told nobody, so the steward completed the whole wizard — named the
//    church, wrote down the recovery phrase, seeded groups, added meetings — with all 17 writes refused, and
//    ended holding a church that looks set up and does not exist.
//
// 2. STARTER GROUPS. Group ids are a relay-GLOBAL namespace with first-writer ownership (idOwnerOk,
//    AUDIT-2026-07-24 CRITICAL-1) — also correct, since it stops one church rewriting another's group. But
//    seedNewChurch() used FIXED ids, so the first church claimed `announce`/`men`/`women`/`youth`/`prayer`
//    and every church after it got none. Measured: those four refused, the same seeds under prefixed ids
//    accepted immediately.
//
// Who this hits: every church joining a network relay, a diocese relay, or a shared pilot relay — exactly the
// multi-tenant case, and exactly what the church-network work depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const ROOT = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8');
const SRC = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

test('the starter groups are namespaced to the church that seeds them', () => {
  const seed = stripComments(fnBody(ROOT, 'function seedNewChurch()'));
  assert.match(seed, /window\.Steward\.pubkey \|\| ''\)\.slice\(0, 8\)/,
    'the seeded ids must be scoped to this church, or the first church on the relay owns them all for ever');
  assert.match(seed, /id: nsp \? \(nsp \+ '-' \+ g\.id\) : g\.id/,
    'every seeded group needs the prefix — one unprefixed id is one group the second church silently loses');
  assert.doesNotMatch(seed, /publishGroup\(\{ id: g\.id,/,
    'that is the fixed-id form that collides');
});

test('a refused registration reaches the steward, in the relay’s own words', () => {
  const fn = stripComments(fnBody(SRC, 'async selfRegister(name, opts)'));
  assert.match(fn, /accepted = true/, 'it has to know whether anybody took it');
  assert.match(fn, /refused\.push\(/, 'and keep why, so the message is the relay’s rather than a guess');
  assert.match(fn, /steward-write-blocked/,
    'the console already renders this banner — a silent refusal is how a steward ends up with a church that ' +
    'does not exist');
  assert.match(fn, /if \(!accepted && \(refused\.length \|\| unreachable\.length\)\)/,
    'only when NOBODY accepted: a church registered on one relay of several is fine and must not be alarmed');
  assert.match(fn, /return \{ ok: accepted/, 'callers should be able to act on it too');
});

test('an unreachable relay and a refusing one are told apart', () => {
  const fn = stripComments(fnBody(SRC, 'async selfRegister(name, opts)'));
  assert.match(fn, /unreachable\.push\(base\)/,
    '"the relay refused you" and "the relay did not answer" need different advice — one is policy, the other ' +
    'is a connection, and telling someone to retry a policy refusal is the mistake this replaces');
  assert.match(fn, /did not answer/, 'and the unreachable case needs its own sentence');
});

test('the shipped bundle carries it', () => {
  assert.match(BUNDLE, /has not accepted your church/,
    'vendor/steward.js is what the console loads — rebuild: bash scripts/build-steward.sh');
});
