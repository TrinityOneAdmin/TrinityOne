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
function memberSide() {
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
    const _reseatOld = new Map(), _reseatAt = new Map(), _churchRoster = new Map();
    ${grab('_noteReseat')}
    ${grab('_superseded')}
    return { note: _noteReseat, superseded: _superseded, roster: _churchRoster };
  `;
  return new Function(src)();
}

const reseatDoc = (author, pairs, at = 1000) => ({ pubkey: author, created_at: at, content: JSON.stringify({ pairs }) });

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
