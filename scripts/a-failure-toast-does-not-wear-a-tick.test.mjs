// A FAILURE TOAST DOES NOT WEAR A GREEN TICK. Sim round 2026-10-02, finding #52.
// Run: node --test scripts/a-failure-toast-does-not-wear-a-tick.test.mjs
//
// The audit of 2026-09-02 (#12) added an opt-in `{ error: true }` so a failure could drop its tick, and only
// the sites written afterwards used it: ~120 plain-string callers still drew a green check over "Couldn't send
// to Sam - nothing was sent". The icon is read before the sentence is. Toast now classifies a plain string that
// reads as a failure, and app.jsx's toast() asks the same question to give it the longer dwell.
//
// Users of the changed code (CLAUDE.md rule 2): Toast has ONE render site (app/app.jsx `<Toast msg={toastMsg}/>`);
// toastMsg is written only by toast() in app.jsx, whose callers are every `ctx.toast(...)`/`toast(...)` in
// app/*.jsx plus window.trinityToast (screens-audio.jsx). Every string passed today that matches the failure
// words was read through by hand when this was written: all of them are failures.
//
// HOW IT ASSERTS (rule 3): ui.jsx is compiled and the REAL Toast is rendered; the icon it chose is read off the
// tree. Nothing matches text in app/*.jsx. Not proven here: the 6-second dwell in app.jsx toast() - that lives
// inside the App component, which cannot be rendered in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const { React, draw } = miniReact();
const Icon = function Icon() { return null; };
const ui = loadScreen('app/ui.jsx', ['Toast', 'toastKind'], {
  React, window: {}, Icon, document: { addEventListener() {}, removeEventListener() {} },
  PhoneFrame: Stub('PhoneFrame'), localStorage: { getItem: () => null, setItem() {} },
  setTimeout, clearTimeout, navigator: {},
});
// the Icon the toast chose — Toast renders <Icon name=... /> as a child element; find it by its type
const iconOf = (msg) => {
  const tree = draw(ui.Toast, { msg });
  const hit = find(tree, n => n.type === Icon);
  assert.equal(hit.length, 1, 'the toast drew no icon at all - re-anchor this test');
  return hit[0].props.name;
};

test('a plain string that reads as a failure is not given the success tick', () => {
  for (const s of [
    'Couldn’t send to Sam — nothing was sent. Please try again.',
    'Backup failed: disk full',
    'Not shared — Leaders is encrypted and your key hasn’t arrived yet.',
    'Chat isn’t available',
    'No church found for that code.',
    'This sermon is unavailable',
  ]) assert.notEqual(iconOf(s), 'check', `a failure wears the success tick: ${s}`);
});

test('a plain success string keeps its tick', () => {
  for (const s of ['Copied — paste it anywhere', 'Removed', 'Thank you — you’re signed up', 'Sent to Sam', 'Opening journal'])
    assert.equal(iconOf(s), 'check', `a success lost its tick: ${s}`);
});

test('an explicit kind still wins in both directions', () => {
  assert.notEqual(iconOf({ text: 'All fine', kind: 'error' }), 'check');
  assert.equal(iconOf({ text: 'Couldn’t, but we say it is fine', kind: 'ok' }), 'check');
});

test('toastKind agrees with what Toast draws, so the dwell time and the icon cannot disagree', () => {
  assert.equal(ui.toastKind('Couldn’t save'), 'error');
  assert.equal(ui.toastKind('Saved'), 'ok');
  assert.equal(ui.toastKind({ text: 'x', kind: 'error' }), 'error');
});
