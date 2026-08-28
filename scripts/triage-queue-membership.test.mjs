// WHICH REQUESTS BELONG IN THE QUEUE YOU TRIAGE FOR OTHER PEOPLE.
// Run: node --test scripts/triage-queue-membership.test.mjs
//
// Two defects, one either side of the same filter:
//   - Leaving your OWN request in the queue ran it through fromChild(), which answers "yes" for anyone who is
//     not a care admin — so a cleared adult's ordinary request for himself appeared under "FROM A YOUNG
//     PERSON · CONFIDENTIAL", and row() suppresses onApprove for anything marked as a child, so he could not
//     action it either. Measured on the OPPO, 2026-08-27.
//   - Excluding EVERYTHING you wrote then hid the request a care admin files on behalf of somebody housebound
//     who is not on the app. That request is authored by the admin, and the triage screen is the only place it
//     can be approved into a need. In a single-admin church nobody could action it. Audit, 2026-08-28.
//
// The rule is "mine AND for me" — not "mine".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
const ME = 'mypub', OTHER = 'otherpub';

// Run the SHIPPED filter expression, rather than a retyped copy of it.
function keep(r) {
  const at = SRC.indexOf('subscribeCareRequests(list => setReqs(');
  assert.ok(at > 0, 're-anchor: the triage subscription has moved');
  const from = SRC.indexOf('.filter(', at);
  // Walk to the paren that closes .filter( rather than searching for a landmark after it — the first attempt
  // sliced to '), ctx.church' and swallowed that closing paren, so every case failed to parse and the whole
  // file looked broken rather than the test being wrong.
  const start = SRC.indexOf('r =>', from);
  let depth = 0, end = start;
  for (let i = start; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) { end = i; break; } depth--; }
  }
  const expr = SRC.slice(start, end);
  return new Function('myPub', 'r', `return (${expr})(r);`)(ME, r);
}

test('somebody else’s open request is triaged', () => {
  assert.equal(keep({ status: 'open', from: OTHER, forSelf: true }), true,
    'the queue is empty — nobody can triage anything');
});

test('my own request FOR MYSELF is not — it has its own row', () => {
  assert.equal(keep({ status: 'open', from: ME, forSelf: true }), false,
    'my own ask sits in the queue I triage for other people, where it is labelled "FROM A YOUNG PERSON" and ' +
    'cannot be approved');
});

test('BUT one I raised for somebody ELSE stays — it is the only place it can be actioned', () => {
  assert.equal(keep({ status: 'open', from: ME, forSelf: false }), true,
    'a care admin filed a request on behalf of a housebound member and it vanished from the only screen that ' +
    'can turn it into help. In a church with one admin, nobody can action it at all.');
});

test('an on-behalf request from someone else is unaffected', () => {
  assert.equal(keep({ status: 'open', from: OTHER, forSelf: false }), true);
});

test('closed requests never appear, whoever wrote them', () => {
  for (const st of ['approved', 'declined', 'handled']) {
    assert.equal(keep({ status: st, from: OTHER, forSelf: true }), false, `a ${st} request is still queued`);
    assert.equal(keep({ status: st, from: ME, forSelf: false }), false, `a ${st} on-behalf request is still queued`);
  }
});

test('a request with no forSelf field is treated as "for me"', () => {
  // Older requests predate the field. Defaulting them to on-behalf would put every member's own old request
  // back into their triage queue, which is the first defect again.
  assert.equal(keep({ status: 'open', from: ME }), false,
    'a request with no forSelf flag is treated as on-behalf, so my own old requests return to the queue');
});
