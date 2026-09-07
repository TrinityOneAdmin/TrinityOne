// THE BACK-FILL RE-SEALS EVERY CHILD WHOSE SEALED GUARDIAN LIST STILL NAMES A CHILD — without a steward touching anything.
//   Run: node --test scripts/backfill-drops-child-guardians.test.mjs
//
// Sim round 3, D2 (reference/DOMAIN.md, owner's decision 2026-09-06: a child is never a guardian). The relay
// now ignores a child's guardian entry at decision time and the console strips it when it marks the child —
// but a child's PHONE reads its own sealed clearance, not the church map, and the member app's canDMPeer lets
// through anyone that clearance names as a parent. A clearance sealed before this fix, in a church whose map
// held the D2 shape, still says "this other child is your parent" until something re-seals it.
//
// That something is `_refreshClearancesNow`, which runs on every Members open and republishes any member
// whose stored clearance differs from what the lists say. The filter lives INSIDE `guardsFor` so the
// comparison and the write see the same list: a child whose stored record names a child now DIFFERS from
// `want`, and is written again — with the child gone from the list. Nobody has to press anything.
//
// LIFTED FROM THE SHIPPED BUNDLE (vendor/steward.js — bundled, so a `false &&` sabotage is tree-shaken away
// and cannot leave the words behind) and EXECUTED: the read-before-write step is told "no trusted read", so
// every member is written, and what reached publishClearance is what is asserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const KID_A = 'a'.repeat(64), KID_B = 'b'.repeat(64), PARENT = 'c'.repeat(64);

// Run the shipped method with the rest of the bundle stubbed, and record every clearance it seals.
async function backfill({ minors, guardians, roster }) {
  const src = fnBody(STEWARD, 'async _refreshClearancesNow(memberPubs, minors, approved, guardians)', '_refreshClearancesNow');
  const sealed = [];
  const stubs = {
    _viewingNetwork: () => false,
    pool: { relays: new Map(), maxWaitForConnection: 50 },
    _connectedRelays: () => [],
    _clearanceSent: new Map(),
    // "no trusted read" — so nothing is skipped and every member is written. The skip path has its own file
    // (console-publish-honesty.test.mjs); this one is about WHAT is written.
    _clearancesMatching: async () => null,
    window: {
      Steward: { publishClearance: (pub, status) => { sealed.push({ pub, status }); return Promise.resolve(true); } },
      dispatchEvent: () => true,
    },
  };
  // Claim app identifiers only: an unstubbed name the method reaches for fails loudly by name rather than
  // reading undefined, and real globals (Promise, Set, String…) pass through.
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined; throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  // eslint-disable-next-line no-new-func
  const fn = new Function('scope', `with (scope) { const o = { ${src} }; return o._refreshClearancesNow; }`)(scope);
  const result = await fn(roster, minors, [], guardians);
  return { sealed, result };
}

test('CONTROL: an adult guardian is sealed into the child’s clearance', async () => {
  const { sealed } = await backfill({ minors: [KID_B], guardians: { [KID_B]: [PARENT] }, roster: [KID_B, PARENT] });
  const b = sealed.find(s => s.pub === KID_B);
  assert.ok(b, 'the child was not re-sealed at all — the harness is wrong, fix it before reading anything below');
  assert.deepEqual(b.status.guardians, [PARENT], 'the child’s adult parent was dropped from their sealed clearance');
  assert.equal(b.status.minor, true);
});

test('A CHILD IN ANOTHER CHILD’S GUARDIAN LIST IS DROPPED FROM THE SEALED CLEARANCE', async () => {
  const { sealed } = await backfill({ minors: [KID_A, KID_B], guardians: { [KID_B]: [KID_A, PARENT] }, roster: [KID_A, KID_B, PARENT] });
  const b = sealed.find(s => s.pub === KID_B);
  assert.ok(b, 'the child was not re-sealed at all');
  assert.deepEqual(b.status.guardians, [PARENT],
    'the church sealed "' + KID_A.slice(0, 8) + '… is your parent" to a child, and that pubkey is on the church’s own ' +
    'minors list. canDMPeer on the child’s phone lets a sealed parent through unconditionally, so this is a ' +
    'private-message route between two children that the relay would now refuse but the app still offers');
});

test('…and the newly-marked child’s OWN clearance says minor, with their real parents untouched', async () => {
  // The filter must drop children from OTHER children's lists, not blank the lists of the child it just marked.
  const { sealed } = await backfill({ minors: [KID_A, KID_B], guardians: { [KID_A]: [PARENT], [KID_B]: [KID_A, PARENT] }, roster: [KID_A, KID_B] });
  const a = sealed.find(s => s.pub === KID_A);
  assert.ok(a, 'the newly-marked child was not sealed');
  assert.equal(a.status.minor, true);
  assert.deepEqual(a.status.guardians, [PARENT], 'the newly-marked child lost their own adult parent');
});

test('CONTROL: an unknown guardian map (null) still writes nothing — the filter did not turn "unknown" into "empty"', async () => {
  const { sealed, result } = await backfill({ minors: [KID_A, KID_B], guardians: null, roster: [KID_A, KID_B] });
  assert.equal(sealed.length, 0, 'a null guardian map was written as an empty one — every child just lost their parents');
  assert.equal(result.unverified, true);
});
