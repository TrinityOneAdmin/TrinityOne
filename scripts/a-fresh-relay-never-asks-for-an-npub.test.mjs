// A FRESH RELAY NEVER ASKS A STEWARD TO PASTE A CHURCH ID — chunk 2b of
// reference/SCOPE-SUITE-AUTOREGISTER-2026-09-12.md.
// Run: node --test scripts/a-fresh-relay-never-asks-for-an-npub.test.mjs
//
// Owner, 2026-09-12: "I really want to make sure the 'adding a church' isn't something that a steward has
// to do manually."
//
// The wizard's church step used to read: "Paste your church's ID (its npub)… You'll find it in the steward
// console." ON A BRAND-NEW BOX THAT CANNOT BE DONE — there is no church yet, so there is nothing in the
// console to find — and the wizard's own gate (no relay handle AND no churches) fires it for exactly those
// people. Since `2cb1582` a church names itself onto its own box, so the fresh path shows what is about to
// happen instead of a field nobody can fill.
//
// ⚠ THE FUNCTIONS ARE LIFTED OUT OF relay-app/control.js AND RUN. That file ships UNBUNDLED, exactly like
// app/*.jsx, so `false && ` in front of the branch would leave every word of this markup in place and a
// text-matching assertion would still pass — CLAUDE.md rule 3, same hazard, different directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../relay-app/control.js', import.meta.url), 'utf8');
const card = (() => {
  const src = fnBody(SRC, 'function rswChurchAsksById(hasChurches, manual) {', 'rswChurchAsksById')
    + '\n' + fnBody(SRC, 'function rswChurchCard(askById, dots) {', 'rswChurchCard');
  const scope = { RSW_IC: { church: '<svg id="churchicon"></svg>' } };
  return new Function('scope', 'with (scope) {' + src + '\nreturn { rswChurchAsksById, rswChurchCard }; }')(scope);
})();

const render = (hasChurches, manual) =>
  card.rswChurchCard(card.rswChurchAsksById(hasChurches, manual), '<div class="rsw-dots"></div>');
const asksForNpub = (html) => /id="rswNpub"/.test(html);

test('A BRAND-NEW BOX IS NEVER ASKED TO PASTE AN NPUB IT CANNOT HAVE', () => {
  const html = render(false, false);
  assert.equal(asksForNpub(html), false,
    'THE FRESH-BOX PATH STILL DEMANDS A CHURCH ID. There is no church yet, so there is nothing in the ' +
    'console to copy — and this wizard fires only for boxes in exactly that state.');
  // ⚠ NOT a bare /paste/i — the fresh copy legitimately says "Nothing to copy or paste", and asserting on
  // the bare word failed the first time I ran this. What must be absent is the INSTRUCTION.
  assert.ok(!/paste your/i.test(html),
    'the copy still instructs a steward to paste their church ID. Read: ' + html.slice(0, 400));
  assert.match(html, /added to this relay automatically/i, 'it does not say what WILL happen instead');
});

test('…and it still offers a way out for a church that already exists elsewhere', () => {
  // Restored from its twelve words, or run from another machine. The manual route must not be deleted,
  // only demoted.
  const html = render(false, false);
  assert.match(html, /id="rswById"/, 'a steward with an existing church has no way to add it by ID');
  assert.match(render(false, true), /id="rswNpub"/, 'asking for the by-ID route did not produce the field');
});

test('A BOX THAT ALREADY CARRIES A CHURCH IS ASKED BY ID, because that is a second church', () => {
  const html = render(true, false);
  assert.equal(asksForNpub(html), true,
    'adding a SECOND church to an established box lost its only control — auto-registration only ever ' +
    'covers a church created in the console on this same box');
  assert.match(html, /Add your church/, 'the established-box card lost its heading');
});

test('the two cards are genuinely different screens, not one with a tweak', () => {
  // Re-anchor: if these ever collapsed to the same string, every assertion above would be vacuous.
  assert.notEqual(render(false, false), render(true, false), 'the fresh and established cards are identical');
});

test('every control the step wires up exists in the card it belongs to', () => {
  // renderRSW attaches handlers by id immediately after setting innerHTML. An id that is missing is a
  // silent dead button — "fix the control, not the label" in its purest form.
  for (const id of ['rswBack', 'rswById', 'rswSkip']) {
    assert.match(render(false, false), new RegExp('id="' + id + '"'), 'the fresh card has no #' + id);
  }
  for (const id of ['rswBack', 'rswSkip', 'rswAdd', 'rswNpub']) {
    assert.match(render(true, false), new RegExp('id="' + id + '"'), 'the by-ID card has no #' + id);
  }
  assert.ok(!/id="rswAdd"/.test(render(false, false)),
    'the fresh card renders an Add button whose handler is only wired on the by-ID path — a dead control');
});
