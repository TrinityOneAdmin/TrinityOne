// AN OWNER MUST BE ABLE TO SEE, AND MEAN, WHO HOLDS THEIR CHURCH.
// Run: node --test scripts/steward-access-visibility.test.mjs
//
// From the delegation round of 2026-08-19, in the owner's own words after handing three people the run of a
// church: "I've just given three people the run of the entire church including Care and Finance — safeguarding
// notes and money — because 'everything' was the only setting on offer. On a real Sunday my choice is three
// over-powered stewards or no help at all; I'd pick no help and stop using the feature."
//
// Three separate defects sat behind that sentence:
//   1. "Everything" was the IMPLICIT default, granted by one click with no confirmation of any kind.
//   2. Nothing recorded WHEN access was given — "nothing records what I did".
//   3. Members read "No members yet" while three people held the church, because a delegated steward is not
//      a member and no screen listed them together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

function lift(anchor, name, stubs) {
  const body = fnBody(VENDOR, anchor, name);
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/[0-9]+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('needs a stub for ' + String(k));
    },
  });
  const method = new RegExp('^' + name + '\\s*\\(').test(body.trim());
  return new Function('scope', method ? `with (scope) { return ({ ${body} }).${name}; }` : `with (scope) { return (${body}); }`)(scope);
}

const TOM = 'a'.repeat(64), GRACE = 'b'.repeat(64);
function loadSetStewards(caps, names, since, clock = 1787200000) {
  const published = [];
  const fn = lift('setStewards(pubkeys, caps, names) {', 'setStewards', {
    _requireTrustedView: () => {}, sk: new Uint8Array(32), pub: 'church'.padEnd(64, '0'),
    _stewardCaps: caps, _stewardNames: names, _stewardSince: since,
    now: () => clock, STEWARDS_D: 'trinityone/stewards:', NET: 'trinityone',
    finalizeEvent: (t) => t, publish: (e) => { published.push(e); return Promise.resolve(e); },
  });
  return { fn, published };
}
const docOf = (e) => JSON.parse(e.content);

test('a new steward is stamped with the day they were given access', async () => {
  const { fn, published } = loadSetStewards({}, {}, {}, 1787200000);
  await fn([TOM]);
  assert.deepEqual(docOf(published[0]).at, { [TOM]: 1787200000 },
    'the roster records who but never when, so an owner reviewing who holds their church has no idea how long ' +
    'any of them has held it');
});

test('and that day does not move when something else is edited', async () => {
  const { fn, published } = loadSetStewards({}, {}, { [TOM]: 1787000000 }, 1787200000);
  await fn([TOM, GRACE]);
  const at = docOf(published[0]).at;
  assert.equal(at[TOM], 1787000000, 'an existing steward\'s date was rewritten by an unrelated edit');
  assert.equal(at[GRACE], 1787200000, 'the newly added steward was not stamped');
});

test('adding someone grants EXACTLY what was ticked — never everything by omission', () => {
  const src = stripComments(DASH);
  const add = fnBody(src, 'const add = (pk, label, grants) => {', 'add');
  assert.match(add, /\[pk\]: Array\.isArray\(grants\) \? grants\.slice\(\) : \[\]/,
    'the add path leaves the new steward out of the capability map, which means UNSCOPED — every power the ' +
    'church has, granted by omission. That is the one-click "everything" this exists to remove.');
});

test('the add screen asks what they may do, before they are added', () => {
  const src = stripComments(DASH);
  assert.match(src, /WHAT MAY THEY DO\?/,
    'the owner is asked for a name and a code and nothing else, so the grant is invisible at the moment it ' +
    'is made');
  assert.match(src, /with no access yet/,
    'the button does not say what it is about to do. "Add" told an owner nothing about the fact that they ' +
    'were handing over Care and Finance.');
});

test('Members shows everyone who holds the church, not only members', () => {
  const src = stripComments(DASH);
  assert.match(src, /PEOPLE WHO HELP RUN THIS CHURCH/,
    'the Members screen still says "No members yet" while delegated stewards hold the church — the owner ' +
    'reported there was no single screen showing everyone with access');
  const i = src.indexOf('PEOPLE WHO HELP RUN THIS CHURCH');
  const block = src.slice(i, i + 1400);
  assert.match(block, /stewardCaps/, 'the list does not say what each of them may do, which is the half that matters');
});

test('a joining link that only works on this machine says so', () => {
  const fnb = stripComments(fnBody(VENDOR, 'joinLinkIsPrivate() {', 'joinLinkIsPrivate'));
  assert.match(fnb, /ownIsLoopback\(\)/, 're-anchor: the check no longer asks whether the relay is loopback');
  const src = stripComments(DASH);
  assert.match(src, /This link only works on this computer/,
    'the invite card hands out a link carrying ws://127.0.0.1 with nothing to say it is unreachable — on a ' +
    'member\'s phone that address means that member\'s phone. A steward printed exactly that from the poster.');
});

test('the wizard never creates a team with no roles', () => {
  const src = stripComments(DASH);
  const save = fnBody(src, 'const saveTeam = async () => {', 'saveTeam');
  assert.match(save, /publishRoster/,
    'the wizard publishes a team and no roles, so the steward reaches the Rota tab, finds their own Welcome ' +
    'Team empty, and cannot put anybody on a Sunday until they type the roles in themselves');
  const seed = fnBody(src, 'const seedRolesFor = (name) => {', 'seedRolesFor');
  assert.match(seed, /TEAM_PRESETS/, 'the roles are invented here rather than taken from the presets the full dialog offers');
  assert.match(seed, /\['Lead', 'Helper', 'Helper'\]/, 'an unrecognised team name still produces an empty team');
});

test('the add form is not crammed into the row with the code box', () => {
  // MEASURED BY AN OWNER, NOT BY A TEST: "the Add form renders squeezed into a sliver at the right edge
  // (name box 24px wide, the Add button clipped off-screen); I could only fill it in by reaching the fields
  // directly." The name field and the capability chooser had been inserted INSIDE the flex row that holds
  // the code box and its button, so four controls shared one horizontal line. A structural test cannot see
  // a layout, but it can see the containment that caused it.
  // Anchored on the CODE BOX and its enclosing row, not on the row's style string — the first version of
  // this test matched `gap: 8, marginBottom: 6` and broke the moment the row gained flexWrap, which is the
  // brittleness this file warns about elsewhere.
  const src = stripComments(DASH);
  const codeAt = src.indexOf('Paste their steward code');
  assert.ok(codeAt > 0, 're-anchor: the steward code box has moved');
  const rowStart = src.lastIndexOf("<div style={{ display: 'flex'", codeAt);
  assert.ok(rowStart > 0 && rowStart < codeAt, 're-anchor: the code box is no longer inside a flex row');
  const insideRow = src.slice(rowStart, codeAt);
  assert.doesNotMatch(insideRow, /Their name, as you know them/,
    'the name field is back inside the row that holds the code box and the Add button — which is what ' +
    'squeezed both into a sliver an owner could not use');
  assert.doesNotMatch(insideRow, /WHAT MAY THEY DO\?/, 'the capability chooser is inside that same row');
  const nameAt = src.indexOf('Their name, as you know them');
  assert.ok(nameAt > 0 && nameAt < rowStart, 'the name is asked for AFTER the code box, which reads backwards');
});
