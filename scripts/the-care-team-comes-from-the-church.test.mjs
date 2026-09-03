// WHO A CRY FOR HELP IS SEALED TO MUST BE DECIDED BY THE CHURCH, NOT BY WHOEVER WROTE LAST.
// Run: node --test scripts/the-care-team-comes-from-the-church.test.mjs
//
// AUDIT 2026-09-02 #19 — the backlog's own HIGH S1, still open at 50e196c. `_fetchCareTeam` took the NEWEST
// `careteam:` document from ANY author. That list is the set a member's private request for help is sealed
// to, so a newer document from a stranger key decided who can read it.
//
// WHY A RELAY-LEVEL TEST CANNOT PROVE THIS, and why this one is worth having anyway: the relay refuses a
// stranger's write, so against a healthy TrinityOne relay the bad document never exists and everything
// looks fine. But this is a CLIENT-SIDE read over whatever a relay hands back, and the entire closed-network
// work exists because a relay may not be one of ours. The client has to apply the rule itself.
//
// The rule mirrors the relay's: the church key, or a steward the church has given `care` to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CHURCH = 'cc'.repeat(32);
const CARE_STEWARD = 'aa'.repeat(32);
const PLAIN_STEWARD = 'bb'.repeat(32);
const STRANGER = 'ff'.repeat(32);

// _fetchCareTeam is module-private. Slice it and its helper out of the shipped bundle and run them with
// pool.querySync injected — the lift recipe from `tests-must-drive-shipped-code`.
function lift(name) {
  const i = BUNDLE.indexOf('async function ' + name + '(');
  assert.ok(i > 0, `${name} is not in the shipped bundle — re-anchor this test`);
  let d = 0;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) return BUNDLE.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}

function run({ docs, caps = null, stewards = [CARE_STEWARD, PLAIN_STEWARD] }) {
  // Lift ONLY _fetchCareTeam, and INJECT its helper. The old version does not reference the helper at all,
  // so this same harness runs against both — which is what makes "fails first" mean the BEHAVIOUR changed
  // rather than a name being missing. (Slicing the helper too made the old bundle fail on the lift, which
  // proves nothing.)
  const body = lift('_fetchCareTeam');
  const querySync = async (_relays, filters) => {
    const d = (filters[0]['#d'] || [])[0] || '';
    if (d.startsWith('trinityone/stewards:')) {
      return [{ pubkey: CHURCH, created_at: 10, tags: [['d', d]],
                content: JSON.stringify({ pubkeys: stewards, ...(caps ? { caps } : {}) }) }];
    }
    return docs;
  };
  const helper = async (cp, cap) => {
    const want = String(cap || '').toLowerCase();
    return stewards.filter(pk => {
      if (!caps) return true;
      const c = caps[pk];
      if (!Array.isArray(c)) return true;
      return c.some(x => String(x || '').toLowerCase() === want);
    }).map(x => String(x).toLowerCase());
  };
  const fn = new Function('pool', 'churchRelays', 'CARETEAM_D', '_relayAuthedAt', '_fetchStewardsWithCap',
    'JSON', 'Set', 'Array', 'String',
    body + '\nreturn _fetchCareTeam;')(
    { querySync }, () => ['wss://r/relay'], 'trinityone/careteam:', 1, helper, JSON, Set, Array, String);
  return fn(CHURCH);
}

const doc = (pubkey, at, pubs) => ({ pubkey, created_at: at, tags: [['d', 'trinityone/careteam:' + CHURCH]],
                                     content: JSON.stringify({ pubs }) });

test('a NEWER care-team list from a stranger does not decide who reads a cry for help', async () => {
  const team = await run({ docs: [doc(CHURCH, 100, ['real-1']), doc(STRANGER, 999, ['stranger-1'])] });
  assert.deepEqual(team, ['real-1'],
    'the care team was taken from whoever wrote LAST. That list is who a member\'s private request for help ' +
    'is sealed to, so a stranger\'s document decided who can read it');
});

test('CONTROL: the church\'s own list is still used', async () => {
  const team = await run({ docs: [doc(CHURCH, 100, ['real-1', 'real-2'])] });
  assert.deepEqual(team, ['real-1', 'real-2'], 'the church\'s own care team stopped being read at all');
});

test('a steward the church gave `care` to may set the list', async () => {
  const team = await run({
    docs: [doc(CHURCH, 100, ['old']), doc(CARE_STEWARD, 200, ['newer-from-care-steward'])],
    caps: { [CARE_STEWARD]: ['care'], [PLAIN_STEWARD]: ['finance'] },
  });
  assert.deepEqual(team, ['newer-from-care-steward'],
    'a steward the church explicitly gave the care capability to cannot maintain the care team — the ' +
    'delegation the church set up does not work');
});

test('…but a steward WITHOUT that capability may not', async () => {
  const team = await run({
    docs: [doc(CHURCH, 100, ['from-church']), doc(PLAIN_STEWARD, 200, ['from-finance-steward'])],
    caps: { [CARE_STEWARD]: ['care'], [PLAIN_STEWARD]: ['finance'] },
  });
  assert.deepEqual(team, ['from-church'],
    'a steward given only Finance rewrote the care team. Capability keys exist so that granting one does ' +
    'not hand over the others');
});

test('A CHURCH WHOSE ROSTER PREDATES CAPABILITIES STILL WORKS', async () => {
  // The risk the plan named: mirror the relay's own rule (`stewardCan`: no caps recorded = full steward),
  // or every such church's care requests would suddenly seal to nobody.
  const team = await run({
    docs: [doc(CHURCH, 100, ['old']), doc(CARE_STEWARD, 200, ['from-steward-no-caps'])],
    caps: null,
  });
  assert.deepEqual(team, ['from-steward-no-caps'],
    'a church whose steward roster has no capabilities recorded lost its care team. The relay treats a ' +
    'capability-less entry as a full steward and the client must agree, or the two disagree about who helps');
});
