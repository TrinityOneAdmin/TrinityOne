// A CARE TEAM OF NAMES IS AN AUDIENCE OF NOBODY.
// Run: node --test scripts/care-audience-counts-linked.test.mjs
//
// The console already refuses to publish a team-visibility need when the care team is empty — a good guard,
// because such a need reaches literally nobody. But it counted the ROWS on the roster, and a roster row is
// `{ id, name, pub }` where `pub` is empty for anyone the steward typed in by hand rather than linking to
// their app account. Sealing can only wrap a copy of a need for someone who HAS a key, so an unlinked row is
// inert everywhere that matters.
//
// Measured on a real church, 2026-08-18: the care team showed six tidy names and exactly ONE of them had an
// account. The guard saw six, said nothing, and every private "ask for help" in that parish reached one man.
// Repo-wide the same dataset held 43 roster entries with 37 unlinked.
//
// The two neighbouring warnings in this same file already got this right — they test `teamLinked.length`.
// This one tested the raw list, which is why the failure was silent in the one place it did damage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const MEALS = readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8');
const src = stripComments(MEALS);

// Pull the guard's own expression out and RUN it, rather than matching its text — a source-text assertion
// here would be satisfied by the comment explaining the rule (this repo has shipped that bug before).
const expr = (src.match(/const zeroAudience = ([^;]+);/) || [])[1];
const careTeamPeopleExpr = (src.match(/const careTeamPeople = ([^;]+);/) || [])[1];

test('re-anchor: the guard and its people list are still here', () => {
  assert.ok(expr, 'could not find the zeroAudience expression');
  assert.ok(careTeamPeopleExpr, 'could not find careTeamPeople');
});

const evalGuard = (people, visibility = 'team', adminGroupId = 'grp1') => {
  const mealsS = { visibility, adminGroupId };
  const careTeamPeople = people;
  return new Function('mealsS', 'careTeamPeople', 'return (' + expr + ');')(mealsS, careTeamPeople);
};

const linked   = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Linked ' + i, pub: 'ab'.repeat(16) + i }));
const unlinked = (n) => Array.from({ length: n }, (_, i) => ({ id: 'u' + i, name: 'Typed ' + i, pub: '' }));

test('an empty care team is still caught', () => {
  assert.equal(evalGuard([]), true, 're-anchor: the original zero-people guard has stopped firing');
});

test('SIX TYPED NAMES AND NO ACCOUNTS IS AN EMPTY AUDIENCE', () => {
  assert.equal(evalGuard(unlinked(6)), true,
    'six unlinked names satisfied the guard, so the console believed the need had an audience while it ' +
    'reached nobody — this is the exact dataset that left a parish with one reachable care-team member');
});

test('a partly-linked team is NOT treated as empty', () => {
  // one real account can still receive; that is a different (weaker) warning, not a publish-blocker
  assert.equal(evalGuard([...unlinked(5), ...linked(1)]), false,
    'a team with one reachable person is not a zero audience — blocking here would stop a real church working');
});

test('a fully linked team is fine', () => {
  assert.equal(evalGuard(linked(3)), false);
});

test('the guard only applies to team visibility', () => {
  assert.equal(evalGuard(unlinked(6), 'church'), false,
    'when the whole church sees needs, the care team roster is irrelevant');
});
