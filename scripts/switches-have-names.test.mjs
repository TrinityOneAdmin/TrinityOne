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

// THE WHOLE OPENING TAG, not the line. This used to require `role="switch"` and `aria-label` on the SAME LINE,
// so the relay-sync switch (136df470), whose attributes sit one per line, was reported unnamed although it
// carries aria-label="Keep your relays in sync" three lines down. Walk back from `role="switch"` to the tag's
// `<Name`, forward to the `>` that closes it at brace depth 0 (a `>` inside `{…}`, such as an arrow function,
// does not end the tag; nor does one inside a string), and look for a non-empty name in that span.
//
// Rule 3 note: this still reads .jsx as TEXT. It checks that an attribute is present on the element, not a
// behaviour, so a `false &&` in front of a condition cannot fake it — but it is not a render. A rendered check
// would be stronger; it would need every switch's screen mounted, which is out of proportion for an attribute.
export function openingTag(src, at) {
  let s = at;
  while (s > 0 && !(src[s] === '<' && /[A-Za-z]/.test(src[s + 1]))) s--;
  let depth = 0, q = null;
  for (let i = s; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === q && src[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(s, i + 1);
  }
  return src.slice(s);
}
const NAMED = /\baria-label(?:ledby)?=(?:"[^"]+"|'[^']+'|\{[^}]+\})/;
export function unnamedSwitches(src) {
  const out = [];
  for (const m of src.matchAll(/role="switch"/g)) {
    if (!NAMED.test(openingTag(src, m.index))) out.push(src.slice(0, m.index).split('\n').length);
  }
  return out;
}

test('the scanner reads the whole opening tag — named across lines, unnamed across lines, and a neighbour\'s name is not borrowed', () => {
  assert.deepEqual(unnamedSwitches('<button role="switch" aria-checked={on} aria-label="Dark mode" />'), [], 'one-line named switch');
  assert.deepEqual(unnamedSwitches('<button\n  onClick={() => go(a > b)}\n  role="switch" aria-checked={on}\n  aria-label="Keep your relays in sync"\n  style={{ x: 1 }}>'), [],
    'a switch whose aria-label is on a LATER line of the same tag was reported unnamed');
  assert.deepEqual(unnamedSwitches('<button\n  role="switch"\n  aria-checked={on}\n  onClick={() => x > 1}>\n  <span aria-label="not mine" />'), [2],
    'an UNNAMED multi-line switch was passed — or it borrowed the name of the element after it');
  assert.deepEqual(unnamedSwitches('<button role="switch" aria-label="" />'), [1], 'an EMPTY aria-label is no name');
  assert.deepEqual(unnamedSwitches('<button role="switch" aria-labelledby={id} />'), [], 'aria-labelledby names it too');
});

test('no switch is announced without a name', () => {
  const unnamed = [];
  let seen = 0;
  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    seen += (src.match(/role="switch"/g) || []).length;
    for (const line of unnamedSwitches(src)) unnamed.push(`${rel.replace('../app/', '')}:${line}`);
  }
  assert.ok(seen >= 10, 're-anchor: only ' + seen + ' role="switch" found in the scanned files — this is measuring nothing');
  assert.deepEqual(unnamed, [],
    'these switches have role="switch" and aria-checked but no accessible name, so a screen reader ' +
    'announces them as an unnamed switch: ' + unnamed.join(', '));
});
