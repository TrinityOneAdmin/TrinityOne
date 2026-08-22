// TAPPING THE WORDS WORKS THE SWITCH.
// Run: node --test scripts/switch-rows-are-tappable.test.mjs
//
// The switch is a 46x28 button at the far right of a full-width row; the words that say what it does are a
// sibling div with no click handler of its own. So the obvious target — the label — does nothing, and you
// must hit the toggle itself. FOUR people across two rounds hit this, including the vicar on her own console:
//   Grace, round 9:   "I tapped it several times."
//   Halime, round 10: "my taps landed on the row but the switch never moved."
//   Colin, round 10:  "I tapped that row twice to turn it off and it stayed on; I suspect you have to hit the
//                      little switch itself rather than the words, which Margaret will not work out."
//   Rev Esther:       "Clicking the name of a setting in Settings -> Features did nothing; I had to click the
//                      little switch itself on the right."
// Colin is right about Margaret, who is 79 and the person this most affects. And one of these switches is
// "Show me in the directory" — a member who cannot work it stays in a list of named people.
//
// Both handlers must fire exactly once: the row toggles, and the button stops the event so a tap on the
// switch itself does not toggle twice and land back where it started — which is indistinguishable from
// "nothing happened", the very complaint being fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const EXTRAS = stripComments(readFileSync(new URL('../app/screens-extras.jsx', import.meta.url), 'utf8'));
const DASH   = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));
const IDENT  = stripComments(readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8'));

// Assert the exact row handlers rather than slicing by position. My first attempt windowed BACKWARDS from
// the switch, which captured the BUTTON's own onClick and passed against unchanged code; the second walked
// back to the nearest <div, which is the sub-label. Naming the handler is unambiguous and still fails if it
// is removed.

test('the member app: the whole row works the switch', () => {
  assert.match(EXTRAS, /<div onClick=\{\(\) => !disabled && onFlip\(\)\}/,
    'the row itself does not toggle, so tapping the words that name the setting does nothing');
});

test('the console: the whole feature row works the switch', () => {
  assert.match(DASH, /<div key=\{k\} onClick=\{\(\) => toggle\(k\)\}/,
    'the console feature row does not toggle — the vicar hit this on her own console');
});

test('tapping the switch itself does not toggle twice', () => {
  for (const [name, src, anchor] of [['member', EXTRAS, 'role="switch"'], ['console', DASH, "aria-label={'Toggle ' + label}"]]) {
    const i = src.indexOf(anchor);
    const btn = src.slice(Math.max(0, i - 300), i + 200);
    assert.match(btn, /stopPropagation/,
      `${name}: the button does not stop the event, so a tap on the switch fires the row handler too and ` +
      'toggles back — which looks exactly like nothing happening');
  }
});

test('the directory switch — the one four people could not work — has a tappable row', () => {
  // I fixed the OTHER two files and asserted only those, so this passed while the control that started the
  // whole thread stayed inert. Ronald was the fourth person to fail to operate it, AFTER I said it was fixed.
  assert.match(IDENT, /<div onClick=\{flip\}/,
    '"Show me in the directory" still requires hitting the small toggle itself — Grace, Halime, Colin and ' +
    'Ronald have each now failed to work it');
  assert.match(IDENT, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); flip\(\); \}\}/,
    'the switch must stop the event, or a tap on it fires the row handler too and toggles straight back');
});
