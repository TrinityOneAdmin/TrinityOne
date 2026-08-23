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

test('every group id is namespaced to the church that creates it', () => {
  // RETARGETED 2026-08-21. This used to assert on seedNewChurch(), which published five starter groups on
  // registration. That seeder is gone — a church now gets only the rooms its steward ticked in the wizard
  // (round 9 measured nine groups where three were offered, because the seeder and the wizard both ran and
  // neither knew about the other). The INVARIANT it guarded is untouched and matters as much as it ever did:
  // group ids are a relay-GLOBAL namespace with first-writer ownership (gateway.mjs idOwnerOk,
  // AUDIT-2026-07-24 CRITICAL-1), so an unprefixed id means the first church on a shared relay owns it for
  // ever and every church after it silently loses that group.
  //
  // Asserting on publishGroup is STRONGER than asserting on the old seeder: it covers every route that makes
  // a group — the wizard, the Groups page, a serving team — not just the five that used to be seeded.
  const fn = stripComments(fnBody(SRC, 'publishGroup(group)'));
  const m = fn.match(/String\(pub \|\| ''\)\.slice\(0, (\d+)\)/);
  assert.ok(m, 'a generated group id must embed the church that owns it, or the first church on the relay ' +
    'claims it for ever');
  // 8 -> 16 on 2026-08-17. The prefix stopped being cosmetic: the relay now REFUSES a claim on an id whose
  // embedded owner is not the signer's church, so a grindable 32-bit prefix would have been an authorisation
  // check an attacker could satisfy by minting keys. "At least 16" so making it longer is not a failure.
  assert.ok(Number(m[1]) >= 16,
    `the namespace is ${m[1]} hex characters — under 16 it is grindable, and the relay now authorises id ` +
    'claims against it (gateway.mjs idNamesOwner)');
});

test('nothing publishes groups to a church behind the steward\'s back', () => {
  // The seeder's real defect was not the duplicates — it was that five rooms appeared with no UI and no
  // choice, and members read them as statements about themselves ("I'm on the list for Youth and for Men's
  // Life Group. I am a 73-year-old woman."). Guard the absence, so it cannot come back quietly.
  const root = stripComments(ROOT);
  assert.equal(/SK\.groups/.test(root), false,
    'steward-root.jsx seeds groups again — and from window.SK, the design mock-up object that also holds ' +
    '"Grace Chapel" and "Pastor John"');
  assert.equal(/publishGroup/.test(root), false,
    'steward-root.jsx publishes a group; group creation belongs to the wizard and the Groups page, where a ' +
    'steward can see it happening');
});

test('a refused registration reaches the steward, in the relay’s own words', () => {
  const fn = stripComments(fnBody(SRC, 'async selfRegister(name, opts)'));
  assert.match(fn, /accepted = true/, 'it has to know whether anybody took it');
  assert.match(fn, /refused\.push\(/, 'and keep why, so the message is the relay’s rather than a guess');
  assert.match(fn, /steward-write-blocked/,
    'the console already renders this banner — a silent refusal is how a steward ends up with a church that ' +
    'does not exist');
  // JUDGED ON THE CHURCH'S OWN RELAY. `bases` includes the CANONICAL_RELAYS, so a church set up against a
  // self-hosted or local relay can be refused THERE and still get an acceptance from a canonical one.
  // Measured 2026-08-17: selfRegister returned ok:true alongside a 403 from the relay the church was actually
  // pointed at, and seventeen setup writes were lost in silence.
  assert.match(fn, /const ownBase = window\.Steward\.configBase\(\)/,
    'the question is whether THIS church\'s relay took it, not whether anybody did');
  assert.match(fn, /if \(ownRefused\)/,
    'an acceptance from a canonical relay must not mask a refusal from the one the church will actually use');
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
