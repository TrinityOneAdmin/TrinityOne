// "YOU'RE ON THE CARE TEAM", NOT "THE CARE TEAM TEAM".
// Run: node --test scripts/the-serving-card-does-not-say-team-twice.test.mjs
//
// Device finding 2026-10-12. The Serving screen's big card built its sentence as 'the ' + name + ' team', so a
// team whose own name already ends in "team" (the console's default care group is literally "Care team") read
// "You're on the Care team team".
//
// MOUNTS the shipped ServingScreen and reads the screen (CLAUDE.md rules 1 and 3).
// Callers of the shared code (rule 2): svTheTeam is new and has one caller, the Serving card in ServingScreen.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadServing, baseCtx, nodeText } from './serving-screen-harness.mjs';

let h;
const screen = (ctx) => { h.r.reset(); const t = h.mod.ServingScreen({ open: true, onClose() {}, ctx, docked: false }); h.r.flush(); return nodeText(t); };
const team = (name) => ({ id: 't1', name, icon: 'hand', accent: 'var(--clay)' });

before(() => { h = loadServing(); });

test('CONTROL: a team named "Welcome" is "the Welcome team"', () => {
  assert.match(screen(baseCtx({ myRosterTeams: [team('Welcome')] })), /You’re on the Welcome team/);
});

test('a team named "Care team" is "the Care team" - the word is not said twice', () => {
  const out = screen(baseCtx({ myRosterTeams: [team('Care team')] }));
  assert.match(out, /You’re on the Care team(?! team)/, 'the card does not name the team - re-anchor');
  assert.doesNotMatch(out, /team team/i, 'THE DEFECT: "team team" is on the Serving screen');
});

test('any capitalisation of a trailing "team" is recognised', () => {
  assert.doesNotMatch(screen(baseCtx({ myRosterTeams: [team('Worship TEAM')] })), /team team/i);
});
