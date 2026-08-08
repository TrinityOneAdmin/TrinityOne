// A SAFETY-CHECK REPLY MUST NOT QUIETLY REACH FEWER PEOPLE THAN IT PROMISED.
// Run: node --test scripts/safety-audience-narrowing.test.mjs
//
// THE DEFECT (pre-merge audit 2026-08-07, finding 9). markSafe seals a reply to an audience the steward
// chose — the care team, or the stewards. Resolving that audience was wrapped in `try { … } catch (e) {}`,
// so a failure produced a reply sealed to the church key and the check's initiator, sent successfully, and
// reported to the member as delivered.
//
// The stewards branch did not even need to throw: `const st = _churchRoster.get(cp); if (st) …` is simply
// undefined until the stewards document arrives, so an early reply narrows with no exception anywhere. Same
// "an unknown roster is not an empty roster" mistake the codebase already documents at steward.src.js:1452.
//
// MY FIRST PROPOSED FIX WAS DEAD CODE, and this test exists partly to stop it coming back. I suggested
// "surface it when the audience resolves to nobody" — but `readers` is seeded with the church key before the
// lookup and the initiator is pushed after, so the count is never zero and that guard could never fire. The
// real question is not "did we get anybody" but "did we get the GROUP the check asked for".
//
// SEVERITY, honestly: the church key is always a recipient and the console reads with the church key, so the
// steward still sees the reply. This is "the care team's own phones are cut out of a disclosure that was
// addressed to them", not "the reply is lost". That is still the wrong direction for a feature whose entire
// purpose is reaching people, and the member was told it had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = readFileSync(ROOT + 'src/fellowship.src.js', 'utf8');
const VENDOR = readFileSync(ROOT + 'vendor/fellowship.js', 'utf8');

function lift() {
  const at = SRC.indexOf('function _safeReaders(');
  assert.notEqual(at, -1,
    '_safeReaders() does not exist in src/fellowship.src.js.\n\n' +
    '  If this is the first run, that IS the defect: markSafe resolves the audience inline inside a\n' +
    '  swallowing try/catch, so "we could not read the care team" and "this church has no care team"\n' +
    '  produce the same silent, narrower send — reported to the member as delivered.');
  let depth = 0, q = '';
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    const c = SRC[i], prev = SRC[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) {
      return new Function(SRC.slice(at, i + 1) + '\nreturn _safeReaders;')();
    }
  }
  assert.fail('could not find the end of _safeReaders');
}

const CHURCH = 'c'.repeat(64);
const STARTER = '5'.repeat(64);
const TEAM_A = 'a'.repeat(64);
const TEAM_B = 'b'.repeat(64);

test('an audience we could NOT resolve is reported as narrowed', () => {
  const r = lift()(CHURCH, STARTER, null);
  assert.equal(r.narrowed, true,
    'THE BUG: the care-team lookup failed, the reply was sealed to the church key and the initiator only, ' +
    'and nothing said so — the member was told their "I need help" had reached the care team');
  assert.deepEqual(r.readers, [CHURCH, STARTER],
    'the reply must still go — the church key always reads it, so a failed lookup degrades the reach ' +
    'rather than losing the disclosure');
});

test('a church that genuinely HAS no care team is not a failure', () => {
  const r = lift()(CHURCH, STARTER, []);
  assert.equal(r.narrowed, false,
    'an empty array is the church having answered "we have nobody on that team". Reporting that as a ' +
    'failure would put a warning in front of every church that has not set one up');
  assert.deepEqual(r.readers, [CHURCH, STARTER]);
});

test('a resolved audience reaches all of it, and is not flagged', () => {
  const r = lift()(CHURCH, STARTER, [TEAM_A, TEAM_B]);
  assert.equal(r.narrowed, false);
  assert.deepEqual(r.readers.sort(), [CHURCH, STARTER, TEAM_A, TEAM_B].sort(),
    'somebody the steward chose cannot open the reply that was addressed to them');
});

test('the church key is unconditional — a reply must survive the phone it was sent from', () => {
  const r = lift()(CHURCH, null, [TEAM_A]);
  assert.ok(r.readers.includes(CHURCH),
    'a reply only one volunteer phone can open is a reply that disappears with that phone, and this is the ' +
    'feature where that phone is most likely to be lost');
});

test('rubbish in the roster cannot break the send or smuggle in a reader', () => {
  const r = lift()(CHURCH, STARTER, [TEAM_A, '', null, 'nothex', TEAM_A]);
  assert.deepEqual(r.readers.sort(), [CHURCH, STARTER, TEAM_A].sort(),
    'a malformed entry in the care-team document either crashed the send or was sealed to as if it were a ' +
    'pubkey — duplicates and junk must both be dropped');
});

test('the shipped bundle carries the guard', () => {
  assert.match(VENDOR, /_safeReaders/,
    'vendor/fellowship.js predates this fix, so the app still narrows silently however green src/ looks — ' +
    'run npm run build:bundles');
});

// _safeReaders can only be right if what it is HANDED is right. _fetchCareTeam used to answer [] for both
// "this church has nobody on that team" and "I could not read the roster", which is the conflation the whole
// fix rests on undoing — and the sabotage runner caught that nothing was watching it.
function liftFetch({ throws = false, events = [] } = {}) {
  const at = SRC.indexOf('async function _fetchCareTeam(');
  assert.notEqual(at, -1, '_fetchCareTeam is gone — re-anchor this test');
  let depth = 0, q = '', body;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    const c = SRC[i], prev = SRC[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) { body = SRC.slice(at, i + 1); break; }
  }
  assert.ok(body, 'could not find the end of _fetchCareTeam');
  const scope = {
    pool: { async querySync() { if (throws) throw new Error('relay unreachable'); return events; } },
    churchRelays: () => ['wss://example.invalid'],
    CARETEAM_D: 'trinityone/careteam:',
  };
  const names = Object.keys(scope);
  return new Function(...names, body + '\nreturn _fetchCareTeam;')(...names.map(n => scope[n]));
}

test('a care roster we could not read answers "unknown", not "empty"', async () => {
  const f = liftFetch({ throws: true });
  assert.equal(await f(CHURCH), null,
    'THE CONFLATION: the relay was unreachable and this reported an empty care team, so the reply seals to ' +
    'the church key alone and the member is told it reached the team');
});

test('a church that has published no care team answers "none", and that is a real answer', async () => {
  const f = liftFetch({ events: [] });
  assert.deepEqual(await f(CHURCH), [],
    'a church that has simply not named a care team would be treated as a failed read, putting a warning in ' +
    'front of every church that has not set one up');
});

test('a published roster is returned, newest document winning', async () => {
  const f = liftFetch({ events: [
    { created_at: 10, content: JSON.stringify({ pubs: [TEAM_A] }) },
    { created_at: 99, content: JSON.stringify({ pubs: [TEAM_A, TEAM_B] }) },
  ] });
  assert.deepEqual((await f(CHURCH)).sort(), [TEAM_A, TEAM_B].sort(),
    'a stale care-team document won, so someone removed from the team can still read disclosures — or ' +
    'someone added to it cannot');
});

test('an unparseable roster is "unknown" rather than silently empty', async () => {
  const f = liftFetch({ events: [{ created_at: 1, content: 'not json' }] });
  assert.equal(await f(CHURCH), null,
    'a corrupt care-team document was read as "this church has nobody", which is the same silent narrowing ' +
    'by another route');
});
