// A member's sealed name must not be downgraded because the relay hadn't authenticated us yet.
// Run: node --test scripts/sealed-name-gate.test.mjs
//
// AUDIT-2026-07-28 F12. A member's display name lives in a per-church document sealed under the congregation
// name key. A member awaiting approval has no such key BY DESIGN, so publishSealedName falls back to sealing
// to the CHURCH key — readable by the steward deciding whether to admit them, and by nobody else. Correct.
//
// The bug is which members reach that fallback. syncSealedNames decided "this church has no key for us" from
// `hub.eosed` alone. But the name key document is served only to an AUTHENTICATED reader, and the church docs
// hub routinely EOSEs before the NIP-42 round-trip lands — the comment on pool.automaticallyAuth says so in as
// many words. So "the relay answered and had no key" and "the relay would not tell us" are the same bytes,
// and an ADMITTED member republished their name sealed to the church key alone: Anonymous to their entire
// congregation, on every screen, until something happened to re-seal it.
//
// Reproduced by running the shipped function before the fix:
//     admitted member, key arrived (control)      publishes=1
//     no key yet, relay has NOT answered          publishes=0
//     no key, EOSE seen but NOT authenticated     publishes=1   <- the downgrade
//
// This is the same rule the same commit applied CORRECTLY to the clearance back-fill three functions away.
// The interesting half of this test is the last two cases: it would be easy to "fix" this by never taking the
// fallback, which silently re-creates the bug it replaced — a pending member showing as "Anon" on the one
// screen where their name is how a steward decides whether to let them in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const F = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CP = 'c'.repeat(64);

function grabMethod(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test');
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;   // keep `async`, or the body will not compile
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

// Run the SHIPPED syncSealedNames against a scope we control. `authedAt`/`eosedAt` are epoch millis, so the
// ordering between "the relay answered" and "we proved who we are" is the thing under test.
async function run({ ring = [], eosedAt = 0, authedAt = 0 }) {
  const calls = [];
  const scope = {
    _nameKeys: new Map(ring.length ? [[CP, ring]] : []),
    _docsHubs: new Map([[CP, { eosed: !!eosedAt, eosedAt }]]),
    _sealedMine: new Map(),
    _relayAuthedAt: authedAt,
    _ringId: (cp) => ((scope._nameKeys.get(cp) || []).length ? 'ring1' : ''),
    toPub: (x) => x,
    window: { Fellowship: { myProfile: { name: 'Maria' },
      publishSealedName: async (cp, nm) => { calls.push({ cp, nm }); return true; } } },
    Set, Map, String,
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, `return ({ ${grabMethod(F, 'async syncSealedNames(churchNpubs)')} }).syncSealedNames;`)(...args.map(k => scope[k]));
  await fn.call(null);
  return calls.length;
}

const T0 = 1_000_000;

test('CONTROL: an admitted member whose key has arrived still publishes', async () => {
  // If this ever goes quiet the fix has become "never seal anything", and every assertion below is vacuous.
  assert.equal(await run({ ring: ['K'], eosedAt: T0 + 100, authedAt: T0 }), 1,
    'nobody seals their name any more — the whole congregation goes Anonymous, which is worse than the bug');
});

test('nothing is published before the relay has answered at all', async () => {
  assert.equal(await run({ ring: [], eosedAt: 0, authedAt: T0 }), 0,
    'a name was sealed to the church key before the relay said anything');
});

test('an EOSE seen while UNAUTHENTICATED does not downgrade an admitted member', async () => {
  // The finding. The relay withheld the name key because we had not proved membership; that is not the same
  // as the church not having one.
  assert.equal(await run({ ring: [], eosedAt: T0 + 100, authedAt: 0 }), 0,
    'an admitted member republished their name sealed to the church key alone — Anonymous to their whole congregation');
});

test('a STALE pre-auth EOSE does not count once we later authenticate', async () => {
  // hub.eosed is set once and never reset, including across the post-auth refetch. A boolean gate would be
  // satisfied by this and downgrade anyway, which is why the check is on ordering rather than on flags.
  assert.equal(await run({ ring: [], eosedAt: T0, authedAt: T0 + 500 }), 0,
    'the pre-auth answer was treated as authoritative because we authenticated afterwards');
});

test('but a member genuinely awaiting approval STILL gets their name to the steward', async () => {
  // The regression this fix could easily cause. A pending member has no congregation key by design, and the
  // church-key fallback is the only way a steward sees a name on their join request. Reported on 2026-07-28:
  // a phone joined as "Testi Bob" and showed as "Anon".
  assert.equal(await run({ ring: [], eosedAt: T0 + 500, authedAt: T0 }), 1,
    'a member awaiting approval is nameless on the steward’s console — the one screen where their name is how you decide');
});

test('and something re-runs the seal once we have authenticated', async () => {
  // Requiring auth is only safe if a pending member gets a second chance. syncSealedNames is triggered by
  // setProfile and by a name key ARRIVING — neither happens for someone with no key, so without this the
  // fallback becomes unreachable and "Anon" comes straight back.
  const at = F.indexOf('function _armAuthRefetch');
  assert.notEqual(at, -1, '_armAuthRefetch is gone — re-anchor this test');
  const fn = F.slice(at, at + 1200);
  assert.match(fn, /syncSealedNames\(\)/,
    'nothing re-seals after authentication, so a member awaiting approval stays nameless to their steward');
  const refetch = fn.indexOf('refetchChurchDocs'), seal = fn.indexOf('syncSealedNames');
  assert.ok(refetch !== -1 && refetch < seal, 'the re-seal must come after the authenticated refetch, or it reads the same stale answer');
});

test('a new connection has proved nothing', async () => {
  const at = F.indexOf('function reconnectAll');
  assert.notEqual(at, -1, 'reconnectAll is gone — re-anchor this test');
  assert.match(fnBody(F, at), /_relayAuthedAt = 0/,
    'the authenticated-at stamp survives a reconnect, so a fresh unauthenticated socket inherits the old proof');
});
