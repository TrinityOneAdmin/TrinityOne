// EVERY SWITCH SAYS WHAT IT SWITCHES.
// Run: node --test scripts/switches-have-names.test.mjs
//
// A `role="switch"` with aria-checked but no accessible NAME is announced by a screen reader as, in effect,
// "switch, on" — with no indication of what it governs. The steward console labels all seven of its switches.
// The member app labelled neither of its two, and one of them is a PRIVACY control.
//
// Found sideways, which is the interesting part. Two privacy-conscious members, two rounds apart, reported the
// same thing and I twice wrote it off as the actors being unable to see a toggle's colour:
//   Grace, round 9:  "There's a switch called 'Show me in the directory' and I have no way to tell whether
//                     it's on, or what it changes. I tapped it several times."
//   Halime, round 10: "I tried to turn off 'Show me in the directory' several times; my taps landed on the
//                     row but the switch never moved... I'm still in a list of named people with no way I
//                     could find to step out of it."
// The mechanism is sound — setProfile({hidden:true}) publishes `"hidden": true` to the member's kind-0, and I
// verified that end to end on Halime's own app. What neither of them could do was OPERATE it: the button
// carries no text, and the label lives in a sibling div rather than a wrapping <label> or an aria-label. A
// text-driven actor cannot find it, and neither can a screen reader.
//
// Halime's stake in this is not hypothetical. Her family does not know she attends church, and this is the
// one control that takes her out of a list of named members.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = ['../app/identity.jsx', '../app/screens-extras.jsx', '../app/stew-dashboard.jsx'];

test('no switch is announced without a name', () => {
  const unnamed = [];
  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!/role="switch"/.test(line)) return;
      if (/aria-label/.test(line)) return;
      unnamed.push(`${rel.replace('../app/', '')}:${i + 1}`);
    });
  }
  assert.deepEqual(unnamed, [],
    'these switches have role="switch" and aria-checked but no accessible name, so a screen reader ' +
    'announces them as an unnamed switch: ' + unnamed.join(', '));
});
