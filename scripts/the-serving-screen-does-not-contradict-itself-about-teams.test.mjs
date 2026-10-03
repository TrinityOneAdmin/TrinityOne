// "YOU'RE ON THE WELCOME TEAM" AND "NO TEAMS YET" ARE NOT BOTH TRUE.
// Run: node --test scripts/the-serving-screen-does-not-contradict-itself-about-teams.test.mjs
//
// Sim 2026-10-02, item 48. A member whose team roster lists them, with nothing scheduled yet, saw the big card
// say "You're on the Welcome team" and — a few lines below, on the same screen — a tile say "No teams yet —
// your leader adds you". It was a STATE inconsistency, not timing: the card reads ctx.myRosterTeams (rosters
// that list me) and the tile read svMyTeams(ctx) (only teams I have a request or a published slot for), and the
// two lists differ for exactly this member.
//
// MOUNTS the shipped ServingScreen and reads the screen (CLAUDE.md rules 1 and 3).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadServing, baseCtx, nodeText, slot } from './serving-screen-harness.mjs';

let h;
const screen = (ctx) => { h.r.reset(); const t = h.mod.ServingScreen({ open: true, onClose() {}, ctx, docked: false }); h.r.flush(); return nodeText(t); };
const WELCOME = { id: 't1', name: 'Welcome', icon: 'hand', accent: 'var(--clay)' };

before(() => { h = loadServing(); });

test('CONTROL: a member on no team and nothing scheduled sees "No teams yet" and no team claim', () => {
  const out = screen(baseCtx());
  assert.match(out, /No teams yet/, 'the fixture is wrong: the empty tile is not on screen, so the assertions below prove nothing');
  assert.doesNotMatch(out, /You’re on /);
  assert.match(out, /You’re not on a serving team yet/);
});

test('a member the roster puts on a team is NOT told "No teams yet"', () => {
  const out = screen(baseCtx({ myRosterTeams: [WELCOME] }));
  assert.match(out, /You’re on the Welcome team/, 'the card no longer says which team — re-anchor, the fixture proves nothing');
  assert.doesNotMatch(out, /No teams yet/, 'THE DEFECT: the same screen says "No teams yet" while saying "You’re on the Welcome team"');
  assert.match(out, /My teams/, 'the tile that replaces it does not name the member\'s teams');
  assert.match(out, /Welcome/);
});

test('svMyTeams lists a rostered team once even when a request for it also exists', () => {
  const teams = h.mod.svMyTeams(baseCtx({ myRosterTeams: [WELCOME], servPending: [slot()] }));
  assert.deepEqual(Array.from(teams, t => t.id), ['t1'], 'the team is listed twice, or not at all');
});

test('a team known only from a request (no roster listing) still counts, as before', () => {
  const teams = h.mod.svMyTeams(baseCtx({ servPending: [slot({ teamId: 't9', teamName: 'Kids' })] }));
  assert.deepEqual(Array.from(teams, t => t.name), ['Kids']);
});
