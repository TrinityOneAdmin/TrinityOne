// "WHICH DAYS?" MUST SIT ABOVE THE FOLD IN START CARE (owner 2026-10-16).
//   Run: node --test scripts/start-care-day-picker-is-discoverable.test.mjs
//
// The day picker is the step a steward cannot skip — a need with no days reaches nobody to sign up. It used
// to render BELOW the optional "Link their account" block (a label, a member picker and a two-line
// explanation), so on the console it fell below the fold and stewards reported they "couldn't find how to
// pick days". Owner's fix: promote who/what/when above the optional link, i.e. the day picker now renders
// before "Link their account" and before "Notes".
//
// POINT OF USE (rules 1 and 3): this RENDERS the shipped MealsNeedModal from app/stew-meals.jsx through the
// console harness (the same shared-scope load the phone does) and reads the order of the labels in the drawn
// tree. It does not match source text — a reorder in the file that did not reach the render would not pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, texts } from './console-screens.mjs';

function render() {
  const { React, flush, fresh } = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward() });
  const { MealsNeedModal } = loadConsole({ React, window, expr: '{ MealsNeedModal }' });
  assert.equal(typeof MealsNeedModal, 'function', 're-anchor: MealsNeedModal is no longer a top-level console function');
  fresh();
  const tree = MealsNeedModal({ need: null, onClose() {}, onSaved() {}, onDeleted() {} });
  flush();
  return texts(tree);
}

test('the day picker renders above the optional "Link their account" and "Notes"', () => {
  const t = render();
  const iDays = t.indexOf('WHICH DAYS?');
  const iLink = t.indexOf('LINK THEIR ACCOUNT (OPTIONAL)');
  const iNotes = t.indexOf('NOTES (OPTIONAL)');
  assert.ok(iDays >= 0, 're-anchor: the "Which days?" label is gone from Start care');
  assert.ok(iLink >= 0, 're-anchor: the "Link their account" label is gone from Start care');
  assert.ok(iNotes >= 0, 're-anchor: the "Notes" label is gone from Start care');
  assert.ok(iDays < iLink,
    'the day picker still renders BELOW "Link their account", where stewards could not find it (owner 2026-10-16: move it up)');
  assert.ok(iDays < iNotes, 'the day picker renders below Notes');
});

test('who/what/when come first; the optional link is demoted below them', () => {
  const t = render();
  const order = ['WHO IS THIS FOR?', 'WHAT KIND OF CARE?', 'WHICH DAYS?', 'LINK THEIR ACCOUNT (OPTIONAL)']
    .map(lbl => [lbl, t.indexOf(lbl)]);
  for (const [lbl, i] of order) assert.ok(i >= 0, 're-anchor: "' + lbl + '" is gone');
  const idx = order.map(x => x[1]);
  assert.deepEqual(idx.slice().sort((a, b) => a - b), idx,
    'the Start-care fields are no longer in the order who -> what -> when -> (optional) link: ' + JSON.stringify(order));
});
