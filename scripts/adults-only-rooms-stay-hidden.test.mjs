// A CHILD MUST NOT BE SHOWN THE NAMES OF ADULTS-ONLY ROOMS.
// Run: node --test scripts/adults-only-rooms-stay-hidden.test.mjs
//
// AUDIT 2026-08-29 (member-app round), verified end to end before acting on it:
//   · the relay serves the group DEFINITION to a minor — its child-safe rule guards a group's MESSAGES
//     (gateway.mjs, the `g` branch of canRead) and not the kind-30078 that carries the name;
//   · so screens-chat.jsx's own `.filter(g => !iAmMinor || g.childsafe)` is the only thing hiding them;
//   · and `isMinor` has no cache, defaults to FALSE, and waits on a 1.2s timer plus a relay round-trip,
//     while the group list paints from its own cache immediately.
// A returning child therefore had every adults-only room on screen, by name, before the app knew who was
// reading. Transient on a good link; on a thin one, or offline, it lasts the whole session.
//
// The fix must NOT be "assume minor until clearanceKnown". That flag is set only by a member's own sealed
// clearance, and a church that has never used safeguarding publishes none for anybody — so it never becomes
// true there, and gating on it would hide every adults-only room from every member of that church for ever.
// A silent blank screen is worse than the disclosure. Hence the second question, tested below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
function lift(name) {
  const m = new RegExp('\\n  async function ' + name + '\\([\\s\\S]*?\\n  \\}').exec(SRC)
         || new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}').exec(SRC);
  assert.ok(m, `could not lift ${name} — re-anchor this test, do not delete it`);
  return m[0];
}
const CP = 'c'.repeat(64);

// `audience`: null = could not ask; [] = this church clears nobody; [..] = safeguarding is in use.
function engine({ sgSelf = { cp: '', isMinor: false, known: false }, audience = [], cached = null } = {}) {
  const store = {};
  if (cached !== null) store['trinityone.sgassume.' + CP] = cached;
  const scope = {
    _sgSelf: sgSelf,
    SG_ASSUME_KEY: 'trinityone.sgassume.',
    _fetchChildCareAudience: async () => audience,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
  };
  const args = Object.keys(scope);
  return new Function(...args, lift('_assumeMinor') + '\nreturn _assumeMinor;')(...args.map(k => scope[k]));
}

test('a church that has told us outright is believed, either way', async () => {
  assert.equal(await engine({ sgSelf: { cp: CP, isMinor: true, known: true } })(CP), true);
  assert.equal(await engine({ sgSelf: { cp: CP, isMinor: false, known: true } })(CP), false);
});

test('a church that has never used safeguarding is NOT gated — this is the trap', async () => {
  // clearanceKnown is false here and will NEVER become true: no clearance document exists for anybody.
  // Gating on it would empty the room list for every member of this church, permanently, with no message.
  const f = engine({ sgSelf: { cp: '', isMinor: false, known: false }, audience: [] });
  assert.equal(await f(CP), false,
    'every member of a church that does not use safeguarding just lost their adults-only rooms, for ever');
});

test('a church that DOES use safeguarding gates until it has told us', async () => {
  const f = engine({ sgSelf: { cp: '', isMinor: false, known: false }, audience: ['someone-cleared'] });
  assert.equal(await f(CP), true,
    'a child is shown the names of adults-only rooms while their clearance is still in flight');
});

test('when we cannot ask at all, we assume rather than guess', async () => {
  const f = engine({ sgSelf: { cp: '', isMinor: false, known: false }, audience: null });
  assert.equal(await f(CP), true, 'an unanswerable relay was read as "not a child"');
});

test('a remembered answer is used, so a returning member is right immediately', async () => {
  // This is what actually closes the window: the disclosure needs CACHED groups to paint early, and cached
  // groups mean a previous session — which is exactly when a remembered answer exists.
  const adult = engine({ audience: ['someone-cleared'], cached: '0' });
  assert.equal(await adult(CP), false, 'a known adult is gated on every cold start for ever');
  const child = engine({ audience: [], cached: '1' });
  assert.equal(await child(CP), true, 'a known child is un-gated the moment the relay is slow');
});

test('the church’s own word outranks a stale remembered answer', async () => {
  const f = engine({ sgSelf: { cp: CP, isMinor: true, known: true }, cached: '0' });
  assert.equal(await f(CP), true, 'a member newly marked as a child keeps the adult view');
});

test('the answer is remembered as soon as the church tells us', async () => {
  // Executed, not grepped. The first version of this asserted the write with a regex over the bundle, and a
  // sabotage that made the write unreachable (`if (false)`) left the text in place and the test green — the
  // exact "a regex matches an expression inside dead code" failure this round keeps rediscovering.
  const store = {};
  const scope = {
    _sgSelf: { cp: CP, isMinor: true, known: true },
    SG_ASSUME_KEY: 'trinityone.sgassume.',
    _fetchChildCareAudience: async () => [],
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
  };
  const args = Object.keys(scope);
  const f = new Function(...args, lift('_assumeMinor') + '\nreturn _assumeMinor;')(...args.map(k => scope[k]));
  await f(CP);
  assert.equal(store['trinityone.sgassume.' + CP], '1',
    'nothing remembers the answer, so every cold start reopens the window this fix exists to close');

  const store2 = {};
  const scope2 = { ...scope, _sgSelf: { cp: CP, isMinor: false, known: true },
    localStorage: { getItem: (k) => (k in store2 ? store2[k] : null), setItem: (k, v) => { store2[k] = v; } } };
  const a2 = Object.keys(scope2);
  const g = new Function(...a2, lift('_assumeMinor') + '\nreturn _assumeMinor;')(...a2.map(k => scope2[k]));
  await g(CP);
  assert.equal(store2['trinityone.sgassume.' + CP], '0', 'an adult’s answer is not remembered');
});

test('the group list actually consults it', () => {
  const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
  assert.match(CHAT, /const iAmMinor = !!\(ctx\.safeguard && ctx\.safeguard\.isMinor\) \|\| assumeMinor;/,
    'the room filter is back to trusting isMinor alone, which is false before the church has answered');
  assert.match(CHAT, /window\.Fellowship\.assumeMinor\(np\)/, 'nothing asks the engine');
  assert.match(CHAT, /\.catch\(\(\) => \{ if \(live\) setAssumeMinor\(true\); \}\)/,
    'a failure to ask is treated as "not a child"');
});
