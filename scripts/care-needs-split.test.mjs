// WHO IS OFFERED WHICH NEED — by RUNNING the decision, not by reading it.
// Run: node --test scripts/care-needs-split.test.mjs
//
// The previous attempt at this was a single line gated on `amCareTeam`, which reads like "is on the care team"
// and actually means "can see everything". The result: on the DEFAULT setting the line never ran, so a member
// was still invited to help with her own request; and on the team-only setting it emptied the recipient's
// screen, taking away where they tick off days they are covered. The test asserted the line, so it passed.
//
// So this one lifts the real function out of the shipped file and runs it. Every case below is a person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
// fnBody, not a hand-rolled brace match: this function takes a DESTRUCTURED parameter, so the first `{` after
// its name is the parameter list, which opens and closes immediately. My first attempt lifted four characters
// of the signature and threw a syntax error — the exact trap fnBody carries a comment about.
const split = new Function('return (' + fnBody(SRC, 'function splitCareNeeds') + ')')();

const TODAY = '2026-08-24';
const ME = 'aaaa', OTHER = 'bbbb';
const needs = [
  { id: 'n1', recipient: ME,    endDate: '2026-08-30' },   // raised for me
  { id: 'n2', recipient: OTHER, endDate: '2026-08-30' },   // raised for someone else
];

test('default church-wide: I am not offered my own need, and I still see it', () => {
  // Verity's case, and the one the previous fix silently skipped entirely.
  const r = split({ needs, today: TODAY, visibility: 'all', onCareRoster: false, myPub: ME });
  assert.deepEqual(r.others.map(n => n.id), ['n2'], 'I am still invited to help with my own request');
  assert.deepEqual(r.mine.map(n => n.id), ['n1'], 'my own need vanished — that is where I mark days covered');
});

test('team-only, not on the roster: I see MY need and nothing else — never an empty screen', () => {
  // The previous fix left this person with nothing at all, while the Today banner told them to come here.
  const r = split({ needs, today: TODAY, visibility: 'team', onCareRoster: false, myPub: ME });
  assert.deepEqual(r.mine.map(n => n.id), ['n1'], 'the recipient lost their own need');
  assert.deepEqual(r.others.map(n => n.id), [], 'a team-only church showed someone else’s need to a non-member');
});

test('on the care team: everyone else’s to triage, my own kept separate', () => {
  const r = split({ needs, today: TODAY, visibility: 'team', onCareRoster: true, myPub: ME });
  assert.deepEqual(r.others.map(n => n.id), ['n2'], 'the care team cannot see the needs it has to triage');
  assert.deepEqual(r.mine.map(n => n.id), ['n1'], 'a care-team member who is themselves a recipient loses their need');
});

test('finished needs drop out, and a signed-out reader is offered nothing of their own', () => {
  const past = [{ id: 'old', recipient: OTHER, endDate: '2026-08-01' }, ...needs];
  const r = split({ needs: past, today: TODAY, visibility: 'all', onCareRoster: false, myPub: ME });
  assert.equal(r.others.some(n => n.id === 'old'), false, 'a need that ended weeks ago is still being offered');
  const anon = split({ needs, today: TODAY, visibility: 'all', onCareRoster: false, myPub: '' });
  assert.deepEqual(anon.mine, [], 'somebody with no key was handed a need as their own');
  assert.equal(anon.others.length, 2, 'a reader with no key should still see what the church needs');
});

// ── and that the answer actually REACHES THE SCREEN ────────────────────────────────────────────────
// The tests above prove the function. They do not prove the fix: an audit showed that deleting BOTH renders
// of the member's own-needs block left all of them green — which silently reproduces the original
// catastrophe, a recipient's screen emptied of the controls they need and a banner still pointing there.
//
// Two disciplines, or this fools itself the way its predecessors did:
//   · read the file through stripComments — this project has been beaten by an assertion that a COMMENT
//     satisfied, over a safeguarding bug, with 935 tests green
//   · count USES, not mentions: after deleting both renders the declaration `const mineBlock =` still
//     contains the word, so "the file mentions mineBlock" proves nothing at all
import { stripComments } from './test-slice.mjs';

test('the member’s own needs are rendered, in both variants of the screen', () => {
  const code = stripComments(SRC);
  assert.match(code, /const mineBlock = mineNeeds\.length \?/, 'the block is no longer built from the split');
  const uses = (code.match(/\{mineBlock\}/g) || []).length;
  assert.equal(uses, 2,
    `the own-needs block is rendered ${uses} time(s), expected 2 — the Care tab and the Today card. ` +
    'Deleting these is invisible to every other test and empties a recipient’s screen.');
  // …and the volunteering block must still be there beside it, or this fix has eaten the other half.
  assert.match(code, /\{live\.length \? needsBlock : null\}/, 'the volunteering list is gone from Today');
});
