// EVERY CONTROL SAYS WHAT IT IS, AND EVERY SWITCH SAYS WHETHER IT IS ON.
// Run: node --test scripts/controls-have-accessible-names.test.mjs
//
// Found while driving the app and console over CDP, 2026-08-27. Three gaps, all measured by reading the live
// DOM rather than the source:
//   - the member app's DM and group-chat send buttons had aria-label null — the care conversation's had one,
//     so this was an inconsistency, not a house style
//   - "Toggle practical care" and "Toggle giving" had no aria-checked, while eight sibling toggles did: a
//     screen-reader user could not tell whether care or giving was switched on
//   - the console's care conversation was not a dialog at all (no role, no aria-modal) and Escape did nothing,
//     so a keyboard user's only way out was a mouse click on the backdrop
//
// These are small, and they are the difference between a church member being able to use this and not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const CHAT = read('app/screens-chat.jsx');
const MEALS = read('app/stew-meals.jsx');
const DASH = read('app/stew-dashboard.jsx');

// A button is "named" if it carries a NON-EMPTY aria-label or title. Merely CONTAINING the word aria-label is
// not enough: `aria-label=""` passed the first version of this test while a screen reader announced nothing
// but "button". An audit defeated it exactly that way, 2026-08-28.
const namedBy = (line, attr) => {
  const m = new RegExp(attr + '=(?:"([^"]*)"|\\{([^}]*)\\})').exec(line);
  if (!m) return false;
  const v = (m[1] !== undefined ? m[1] : m[2]) || '';
  return v.trim().length > 0 && v.trim() !== '""' && v.trim() !== "''";
};
function unnamedIconButtons(src, iconName) {
  const lines = src.split('\n');
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.includes('<button')) continue;
    if (namedBy(l, 'aria-label') || namedBy(l, 'title')) continue;
    if (!lines.slice(i, i + 4).join('\n').includes(`name="${iconName}"`)) continue;
    bad.push(i + 1);
  }
  return bad;
}

test('every send button in the member app has an accessible name', () => {
  const bad = unnamedIconButtons(CHAT, 'send');
  assert.deepEqual(bad, [],
    `send buttons with no accessible name at app/screens-chat.jsx:${bad.join(', ')} — a screen reader ` +
    'announces "button" and nothing else, so there is no way to know it sends the message');
});

test('the practical-care switch reports whether it is on', () => {
  const helper = MEALS.slice(MEALS.indexOf('const toggleBtn = '), MEALS.indexOf('const toggleBtn = ') + 700);
  assert.match(helper, /role="switch"/, 'the toggle is not announced as a switch');
  assert.match(helper, /aria-checked=\{!!active\}/,
    'the toggle does not report its state, so a screen-reader user cannot tell whether practical care is on');
});

test('the giving switch reports whether it is on', () => {
  const at = DASH.indexOf('aria-label="Toggle giving"');
  assert.ok(at > 0, 're-anchor: the giving toggle has moved');
  const btn = DASH.slice(at - 200, at + 200);
  assert.match(btn, /role="switch"/, 'the giving toggle is not announced as a switch');
  // …and reports the REAL state. `aria-checked={false}` satisfied the old assertion while announcing "off"
  // whatever the setting was — the audit's exact defeat.
  assert.doesNotMatch(btn, /aria-checked=\{\s*(true|false)\s*\}/,
    'the giving toggle announces a hard-coded state, so it is wrong half the time');
  assert.match(btn, /aria-checked=\{[^}]*giving[^}]*\}/,
    'the giving toggle does not report the actual setting');
});

test('the console’s care conversation is a real dialog, and Escape closes it', () => {
  const at = MEALS.indexOf("width: 440, maxWidth: '92%', height: '70vh'");
  assert.ok(at > 0, 're-anchor: the care conversation panel has moved');
  const panel = MEALS.slice(at - 300, at + 100);
  assert.match(panel, /role="dialog"/, 'the panel is an anonymous div to a screen reader');
  assert.match(panel, /aria-modal="true"/, 'nothing tells assistive tech the rest of the page is inert');
  // …and the handler must actually CLOSE it. `if (e.key === 'Escape') {}` satisfied the old assertion while
  // Escape did nothing at all — the audit's exact defeat.
  const keyAt = MEALS.indexOf("e.key === 'Escape'");
  assert.ok(keyAt > 0,
    'Escape does not close the care conversation — a keyboard user’s only way out is a mouse click on the ' +
    'backdrop, which is not a way out at all');
  assert.match(MEALS.slice(keyAt, keyAt + 120), /onClose\(\)/,
    'the Escape handler exists but does not close anything');
});
