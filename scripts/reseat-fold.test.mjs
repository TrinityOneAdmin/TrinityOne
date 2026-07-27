// A member who lost their 12 words and was re-seated must appear ONCE, not twice.
// Drives the SHIPPED bundles' re-seat parsing. Run: node --test scripts/reseat-fold.test.mjs
//
// The re-seat doc only says "the person who was <old> is now <new>". Nothing enforces that clients act on it,
// so without this the church keeps a ghost: the dead key still sits in the roster, in the member count, and in
// every steward picker — and the member appears to have two accounts, which is exactly the confusion the
// feature exists to prevent.
//
// Both clients parse the same doc separately (member app and console), so both are checked here, from the
// bundles that actually ship.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const CHURCH = 'c'.repeat(64), OLD = 'a'.repeat(64), NEW = 'b'.repeat(64), OTHER = 'd'.repeat(64), STEWARD_PUB = 'e'.repeat(64);

// Pull the member app's real _noteReseat/_superseded out of the shipped bundle, with a roster we control.
// `me` / `myName` set up the device this code is running on: whose key it is, and whether they already have a
// display name. Both matter to the name-adoption tests below.
function memberSide({ me = '', myName = '' } = {}) {
  assert.match(FELLOWSHIP, /RESEAT_D = "trinityone\/reseat:"/, 'RESEAT_D missing from the shipped member bundle');
  const grab = (name) => {
    const at = FELLOWSHIP.indexOf('function ' + name + '(');
    assert.notEqual(at, -1, name + ' missing from the shipped member bundle');
    let depth = 0, end = -1;
    for (let i = FELLOWSHIP.indexOf('{', at); i < FELLOWSHIP.length; i++) {
      const c = FELLOWSHIP[i];
      if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i + 1; break; }
    }
    return FELLOWSHIP.slice(at, end);
  };
  const src = `
    const RESEAT_D = "trinityone/reseat:";
    const _reseatOld = new Map(), _reseatAt = new Map(), _churchRoster = new Map(), _reseatNamed = new Set();
    const profiles = {};
    const published = [];
    let pub = ${JSON.stringify(me)};
    const window = { Fellowship: { myProfile: ${JSON.stringify(myName ? { name: myName } : null)}, setProfile(meta) { published.push(meta); return Promise.resolve(null); } } };
    ${grab('_noteReseat')}
    ${grab('_superseded')}
    return { note: _noteReseat, superseded: _superseded, roster: _churchRoster, published, window };
  `;
  return new Function(src)();
}
// _noteReseat defers the profile publish out of the relay's event handler (a throw in there is swallowed), so
// let the microtask/timer run before asserting.
const settle = () => new Promise(r => setTimeout(r, 5));

const reseatDoc = (author, pairs, at = 1000) => ({ pubkey: author, created_at: at, content: JSON.stringify({ pairs }) });
const ME = NEW;   // the tests below run ON the re-seated member's new phone

test('the member app folds away a re-seated member’s dead key', () => {
  const m = memberSide();
  m.note(CHURCH, reseatDoc(CHURCH, [{ old: OLD, new: NEW, at: 900 }]));
  assert.equal(m.superseded(CHURCH, OLD), true, 'the dead key must stop being shown');
  assert.equal(m.superseded(CHURCH, NEW), false, 'the key they use NOW must still be shown');
  assert.equal(m.superseded(CHURCH, OTHER), false, 'an unrelated member must be untouched');
});

test('a re-seat from a stranger is ignored', () => {
  const m = memberSide();
  m.note(CHURCH, reseatDoc(OTHER, [{ old: OLD, new: NEW, at: 900 }]));
  assert.equal(m.superseded(CHURCH, OLD), false,
    'anyone could otherwise erase any member from every roster by publishing one document');
});

test('a re-seat from a CURRENT roster steward is honoured', () => {
  const m = memberSide();
  m.roster.set(CHURCH, new Set([STEWARD_PUB]));
  m.note(CHURCH, reseatDoc(STEWARD_PUB, [{ old: OLD, new: NEW, at: 900 }]));
  assert.equal(m.superseded(CHURCH, OLD), true, 'a delegated steward does this in person — it must work');
});

test('an OLDER re-seat doc cannot undo a newer one', () => {
  const m = memberSide();
  m.note(CHURCH, reseatDoc(CHURCH, [{ old: OLD, new: NEW, at: 900 }], 2000));
  m.note(CHURCH, reseatDoc(CHURCH, [], 1000));   // a stale copy replayed by a relay
  assert.equal(m.superseded(CHURCH, OLD), true, 'newest wins — a replayed old copy must not resurrect the ghost');
});

test('a later re-seat doc CAN undo one (a steward correcting a mistake)', () => {
  const m = memberSide();
  m.note(CHURCH, reseatDoc(CHURCH, [{ old: OLD, new: NEW, at: 900 }], 1000));
  m.note(CHURCH, reseatDoc(CHURCH, [], 2000));
  assert.equal(m.superseded(CHURCH, OLD), false, 'a steward who re-seats the wrong person must be able to undo it');
});

test('a malformed re-seat doc hides nobody', () => {
  const m = memberSide();
  m.note(CHURCH, { pubkey: CHURCH, created_at: 1000, content: 'not json' });
  assert.equal(m.superseded(CHURCH, OLD), false);
  m.note(CHURCH, reseatDoc(CHURCH, [{ old: OLD, new: OLD, at: 1 }], 2000));   // old === new is meaningless
  assert.equal(m.superseded(CHURCH, OLD), false, 'a self-referential pair must not erase the member');
});

test('the member app filters the directory and the count by it', () => {
  assert.match(FELLOWSHIP, /!_superseded\(cp, m\.pubkey\)/, 'subscribeChurchMembers no longer folds re-seated members away');
  assert.match(FELLOWSHIP, /!_superseded\(cp, v\.pubkey\)/, 'subscribeChurchMemberCount would double-count a re-seated member');
});

test('the steward console folds them out of its roster too', () => {
  assert.match(STEWARD, /RESEAT_D = "trinityone\/reseat:"/, 'RESEAT_D missing from the shipped console bundle');
  assert.match(STEWARD, /filter\(\s*\(?m\)?\s*=>\s*!reseatOld\.has\(m\.pubkey\)\)/,
    'the console roster no longer filters re-seated members — the steward would see the same person twice');
  assert.ok(STEWARD.includes("d !== RESEAT_D + pub") || STEWARD.includes('d !== RESEAT_D + pub'),
    'the console does not subscribe to the re-seat doc, so its roster can never learn about one');
});

test('the console publishes the re-seat with the church stamp a delegated steward needs', () => {
  // feChurch adds ['church',<cp>]; plain finalizeEvent does not. Without it a delegated steward's re-seat is
  // stored and gated correctly but matches NO member subscription, so no member ever sees it.
  const at = STEWARD.indexOf('setReseats(');
  assert.notEqual(at, -1, 'setReseats missing from the shipped console bundle');
  const body = STEWARD.slice(at, at + 900);
  assert.match(body, /feChurch\(/, 'setReseats must publish via feChurch, or a delegated steward’s re-seat reaches nobody');
});

// ── the NAME comes back (AUDIT-2026-07-26 CRITICAL 3) ──────────────────────────────────────────────────────
// A member re-seated by their church arrives on a key with no kind-0 at all: the "I've lost my 12 words" route
// exists precisely for people who cannot get back in on their own, so they never pass through the name step.
// Roster names come from each key's own kind-0 and the old key is filtered out entirely — so "Maria" became
// "Anonymous …abc123" while three screens promised her name would come back. The fix is that her app adopts
// the name her church vouched for and publishes it as her OWN profile, which makes the promise true rather
// than papering over it.

test('a re-seated member adopts the name their church vouched for', async () => {
  const m = memberSide({ me: ME });
  m.note(CHURCH, reseatDoc(CHURCH, [{ old: OLD, new: NEW, name: 'Maria', at: 900 }]));
  await settle();
  assert.deepEqual(m.published, [{ name: 'Maria' }],
    'the new key published no profile — the member is back in their church as "Anonymous …" under a screen that promised them their name');
});

test('a name the member already chose is never overwritten', async () => {
  const m = memberSide({ me: ME, myName: 'Maria K' });
  m.note(CHURCH, reseatDoc(CHURCH, [{ old: OLD, new: NEW, name: 'Maria', at: 900 }]));
  await settle();
  assert.deepEqual(m.published, [], 'the vouched name is a bootstrap, not an override — the member’s own name must win');
});

test('only the pair naming THIS device is adopted', async () => {
  const m = memberSide({ me: ME });
  m.note(CHURCH, reseatDoc(CHURCH, [{ old: OTHER, new: OTHER.replace(/d/g, 'f'), name: 'Someone Else', at: 900 }]));
  await settle();
  assert.deepEqual(m.published, [], 'a phone adopted another member’s name from the church’s re-seat list');
});

test('a re-seat from a stranger cannot rename anybody', async () => {
  const m = memberSide({ me: ME });
  m.note(CHURCH, reseatDoc(OTHER, [{ old: OLD, new: NEW, name: 'Pastor', at: 900 }]));
  await settle();
  assert.deepEqual(m.published, [],
    'anyone who can publish would otherwise be able to rename any member — including to something that impersonates a leader');
});

test('a redelivered re-seat doc does not republish the profile', async () => {
  const m = memberSide({ me: ME });
  const doc = reseatDoc(CHURCH, [{ old: OLD, new: NEW, name: 'Maria', at: 900 }]);
  m.note(CHURCH, doc); m.note(CHURCH, doc); m.note(CHURCH, doc);
  await settle();
  assert.equal(m.published.length, 1, 'a relay re-serving the same doc must not turn into a profile broadcast');
});

test('a pair with no name changes nothing', async () => {
  const m = memberSide({ me: ME });
  m.note(CHURCH, reseatDoc(CHURCH, [{ old: OLD, new: NEW, at: 900 }]));
  await settle();
  assert.deepEqual(m.published, [], 'a church that vouched for no name must not publish an empty one');
  assert.equal(m.superseded(CHURCH, OLD), true, 'and the fold must still work — the name is an addition, not a condition');
});

// ── console side ───────────────────────────────────────────────────────────────────────────────────────────
// Shape assertions, and they are weaker than the behavioural tests above: subscribeMembers is a 60-line method
// inside a bundled object literal with a live relay pool in it, so it cannot be pulled out and run the way
// _noteReseat can. They catch a deletion, not a subtle break. The load-bearing guarantee is the member-side
// publish above — once that lands, the roster reads the name from the key's own kind-0 like everyone else's,
// and this fallback only covers the seconds in between.

test('the console vouches the member’s name into the re-seat doc', () => {
  const at = STEWARD.indexOf('setReseats(');
  const body = STEWARD.slice(at, at + 1400);
  assert.match(body, /name/, 'setReseats no longer carries the member’s name — a re-seated member goes back as Anonymous');
  assert.match(body, /slice\(0,\s*40\)/, 'the vouched name must be length-capped before it is published');
});

test('the console roster falls back to the vouched name', () => {
  assert.match(STEWARD, /reseatName/, 'the console roster no longer reads the vouched name, so a just-reconnected member shows as Anonymous');
});
