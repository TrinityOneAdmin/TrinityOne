// ONLY THE PEOPLE A CHURCH CHOSE FOR SAFEGUARDING MAY PRIVATELY MESSAGE A CHILD.
// Run: node --test scripts/child-dm-needs-safeguarding-cap.test.mjs
//
// Found during the steward-identity design pass, 2026-08-26, and verified in the shipped relay: the gate that
// decides who may exchange private messages with a young person accepted ANY delegated steward holding ANY
// capability at all — `stewardCan(other, cp, 'any')`. A treasurer given nothing but Finance could privately
// message every child in the congregation, and so could a rota co-ordinator. Nobody had to be checked, cleared
// or linked to a parent; holding one unrelated tickbox was enough.
//
// Nothing in the app would have shown a parent this. The console's own message composer has no client-side
// check at all, so it would simply have worked. And there was no test in either direction — not one asserting
// a cleared adult CAN, nor one asserting an unrelated steward CANNOT.
//
// The capabilities exist precisely so a church can hand out one job without handing out the others. Applying
// them everywhere except the protection of children is the wrong place to make an exception. What stays
// permitted is deliberate: the church's own key (a child's guaranteed route to the office of last resort),
// a linked guardian, an adult on the cleared-worker list, and a steward the church gave the SAFEGUARDING
// role to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const GW = stripComments(readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8'));

// DRIVE THE GATE, DO NOT GREP IT. The first version of this file asserted the TEXT of safeguardAllows and was
// fully vacuous: an audit beat all four of its assertions with one change in a different function — making
// `stewardCan` return true unconditionally. Every test stayed green while a Finance-only treasurer could
// message every child in the congregation again. The repo owns a brace-matching lifter for exactly this
// (fnBody), and this file did not use it. Now it lifts the real function and calls it with real inputs, so an
// assertion can only pass because the BEHAVIOUR is right.
const lift = (name, stubs, anchor) => {
  // fnBody returns the WHOLE function — keyword, signature and body — so it is declared and returned as-is.
  // Wrapping it in another `function` header produces `function f(...) function f(...)`, which fails loudly;
  // that is two signature mistakes in a row on this helper, both caught by running it rather than reading it.
  const src = fnBody(GW, anchor || ('function ' + name), name);
  const scope = new Proxy(stubs, {
    has: () => true,
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  // eslint-disable-next-line no-new-func
  return new Function('scope', `with (scope) { ${src}; return ${name}; }`)(scope);
};

const CHURCH = 'c'.repeat(64), CHILD = 'k'.repeat(64);
const make = ({ approved = [], guardians = [], caps = {} } = {}) => lift('safeguardAllows', {
  minorGoverningChurches: () => [CHURCH],
  approvedIn: (who) => approved.includes(who),
  guardianLinkedIn: (minor, who) => guardians.includes(who),
  networkOf: () => false,
  stewardCan: (who, cp, cap) => {
    const held = caps[who];
    if (!held) return false;
    return cap === 'any' ? held.length > 0 : held.includes(cap);
  },
});

test('a steward scoped to Finance alone cannot message a child', () => {
  // The exact hole: one unrelated tickbox used to be enough. This is the assertion the grep version could not
  // make, and the one that would have caught the defect.
  const gate = make({ caps: { treasurer: ['finance'] } });
  assert.equal(gate(CHILD, 'treasurer'), false,
    'a treasurer with no safeguarding role can privately message a child');
});

test('a steward the church gave the safeguarding role CAN', () => {
  const gate = make({ caps: { hannah: ['safeguarding'] } });
  assert.equal(gate(CHILD, 'hannah'), true, 'the safeguarding lead is locked out of their own job');
});

test('the routes a church relies on stay open', () => {
  // A gate that is too tight is its own harm — it pushes a worried child onto channels the church cannot see.
  assert.equal(make({ approved: ['clearedWorker'] })(CHILD, 'clearedWorker'), true, 'a cleared worker is locked out');
  assert.equal(make({ guardians: ['dad'] })(CHILD, 'dad'), true, 'a linked parent cannot reach their own child');
  assert.equal(make({})(CHILD, CHURCH), true, 'the church itself cannot reach a child — their route of last resort');
});

test('an ordinary member is refused', () => {
  assert.equal(make({})(CHILD, 'stranger'), false, 'anyone at all can message a child');
});

test('a child governed by two churches needs clearance from BOTH', () => {
  // One church's lax list must never open a child governed by another's.
  const twoChurches = lift('safeguardAllows', {
    minorGoverningChurches: () => [CHURCH, 'other'],
    approvedIn: (who, cp) => who === 'half' && cp === CHURCH,   // cleared by one church only
    guardianLinkedIn: () => false, networkOf: () => false, stewardCan: () => false,
  });
  assert.equal(twoChurches(CHILD, 'half'), false,
    'clearance from one church opened a child governed by two');
});

// ── the function every capability check in the relay leans on ────────────────────────────────────────────
// THE STUB BOUNDARY, STATED HONESTLY. The tests above lift safeguardAllows and stub stewardCan, so they prove
// safeguardAllows asks for the RIGHT capability — and are blind to whether stewardCan answers correctly. An
// audit made that concrete: replacing stewardCan's body with `return true` left all five green while every
// steward regained access to every child. A stub can only ever test the caller's half of a contract, so the
// other half needs its own test, and until now it had none anywhere in the suite — despite deciding every
// capability question the relay asks.
test('stewardCan answers the capability question it was asked', () => {
  // stewardCan is a const arrow, not a function declaration, so it needs its own anchor.
  const fn = lift('stewardCan', {
    STEWARDS_BY: new Map([[CHURCH, new Set(['scoped', 'unscoped', 'empty'])]]),
    STEWARD_CAPS: new Map([[CHURCH, new Map([['scoped', new Set(['finance'])], ['empty', new Set()]])]]),
  }, 'const stewardCan =');
  assert.equal(fn('scoped', CHURCH, 'finance'), true, 'a granted capability is refused');
  assert.equal(fn('scoped', CHURCH, 'safeguarding'), false,
    'a capability the church never granted is honoured — this is the hole the child gate had');
  assert.equal(fn('scoped', CHURCH, 'any'), true, "'any' should be satisfied by holding something");
  assert.equal(fn('stranger', CHURCH, 'finance'), false, 'someone not on the roster passes a capability check');
  assert.equal(fn('empty', CHURCH, 'any'), false, 'a steward scoped to NOTHING passes an "any" check');
  // The migration-compat default, pinned so it is a decision rather than a surprise: a steward with no
  // capabilities RECORDED is treated as holding all of them, so churches predating capabilities kept working.
  // The owner has confirmed no real church predates it, so this is a candidate for deletion — but it should go
  // deliberately, with this assertion removed alongside, not by accident.
  assert.equal(fn('unscoped', CHURCH, 'safeguarding'), true,
    'the no-capabilities-recorded compat default has changed — if that was intended, update this assertion');
});
