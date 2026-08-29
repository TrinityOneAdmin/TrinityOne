// "NOTHING FOUND" IS ONLY AN ANSWER IF WE WERE ACTUALLY CONNECTED.
// Run: node --test scripts/child-audience-knows-it-cannot-ask.test.mjs
//
// AUDIT 2026-08-29 (test-integrity round). _fetchChildCareAudience is the second question every safeguarding
// decision in this app leans on — publishCareRequest, _careNeedRefusal, _assumeMinor all ask it, and all
// three treat its three answers differently:
//     null  we could not ask        -> refuse / assume
//     []    this church clears nobody -> there is no child audience to get wrong
//     [..]  safeguarding is in use    -> do not guess about this member
//
// Every one of those callers is covered by a test. NOT ONE of those tests drives the real function — they
// all stub it. So the single line that separates "nobody is cleared" from "we never got an answer" had never
// been executed by the suite, and deleting it left the whole suite green:
//
//     -  if (approved === null && roster === null && !_relayAuthedAt) return null;
//
// What that costs: querySync resolves EMPTY on a relay that is unreachable, still connecting, or has not
// answered the auth challenge. Without the guard a cold or unauthenticated start returns [] instead of null,
// a member with known:false is read as an adult, and a child's request is sealed to the whole care rota —
// the exact disclosure the care-request file exists to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const m = /\n  async function _fetchChildCareAudience\(cp\)[\s\S]*?\n  \}/.exec(SRC);
assert.ok(m, 'could not lift _fetchChildCareAudience — re-anchor this test, do not delete it');
const BODY = m[0];

const CP = 'c'.repeat(64), CLEARED = 'a'.repeat(64), SAFEGUARD_STEWARD = 'b'.repeat(64), FINANCE_STEWARD = 'd'.repeat(64);
const doc = (d, content, pubkey = CP, created_at = 100) => ({ pubkey, created_at, content: JSON.stringify(content), tags: [['d', d]] });

// `authedAt` is the relay-auth timestamp: 0 means we never got a challenge answered.
function ask({ events = [], authedAt = 1, throws = false } = {}) {
  const scope = {
    pool: { querySync: async () => { if (throws) throw new Error('no relay'); return events; } },
    churchRelays: () => ['wss://test.invalid'],
    APPROVED_D: 'trinityone/approved:',
    _relayAuthedAt: authedAt,
  };
  const args = Object.keys(scope);
  return new Function(...args, BODY + '\nreturn _fetchChildCareAudience;')(...args.map(k => scope[k]));
}

test('an empty answer from a relay we never authenticated to is NOT "nobody is cleared"', async () => {
  const f = ask({ events: [], authedAt: 0 });
  assert.equal(await f(CP), null,
    'a cold or unauthenticated start reads as "this church clears nobody", so a child is treated as an adult');
});

test('…but an empty answer from a relay we DID reach means exactly that', async () => {
  const f = ask({ events: [], authedAt: 1 });
  assert.deepEqual(await f(CP), [],
    'a church that has cleared nobody is reported as unanswerable, which blocks every ordinary adult');
});

test('a relay that throws is unanswerable, never an empty list', async () => {
  assert.equal(await ask({ throws: true })(CP), null);
});

test('the cleared-adults list is returned', async () => {
  const f = ask({ events: [doc('trinityone/approved:' + CP, { pubkeys: [CLEARED] })] });
  assert.deepEqual(await f(CP), [CLEARED]);
});

test('a steward counts only with the safeguarding capability — the relay reads it the same way', async () => {
  const f = ask({ events: [doc('trinityone/stewards:' + CP, {
    pubkeys: [SAFEGUARD_STEWARD, FINANCE_STEWARD],
    caps: { [SAFEGUARD_STEWARD]: ['safeguarding'], [FINANCE_STEWARD]: ['finance'] },
  })] });
  assert.deepEqual(await f(CP), [SAFEGUARD_STEWARD],
    'a finance-only steward was sealed a child’s disclosure');
});

test('a roster written before capabilities existed means every steward is a full steward', async () => {
  // stewardCan does `if (!caps) return true`; diverging here would under-seal to someone the relay serves.
  const f = ask({ events: [doc('trinityone/stewards:' + CP, { pubkeys: [SAFEGUARD_STEWARD, FINANCE_STEWARD] })] });
  assert.deepEqual((await f(CP)).sort(), [SAFEGUARD_STEWARD, FINANCE_STEWARD].sort());
});

test('a document not signed by the church itself is ignored', async () => {
  // Both are OWNER-ONLY. A forged approved-list would otherwise widen a child's audience to whoever it named.
  const f = ask({ events: [doc('trinityone/approved:' + CP, { pubkeys: [CLEARED] }, 'f'.repeat(64))] });
  assert.deepEqual(await f(CP), [], 'a forged cleared-adults list was believed');
});

test('the newest copy of each list wins', async () => {
  const f = ask({ events: [
    doc('trinityone/approved:' + CP, { pubkeys: [CLEARED] }, CP, 100),
    doc('trinityone/approved:' + CP, { pubkeys: [] }, CP, 200),   // the church cleared them again
  ] });
  assert.deepEqual(await f(CP), [], 'a stale copy reinstated somebody the church had removed');
});
