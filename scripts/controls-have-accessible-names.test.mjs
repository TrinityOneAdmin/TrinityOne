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
const SCHED = read('app/stew-schedule.jsx');
// Comments are stripped before any of the Groups/Rota assertions below: this repo has already shipped an
// assertion that was satisfied by the comment explaining the rule.
const stripC = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SCHED_CODE = stripC(SCHED), DASH_CODE = stripC(DASH);
const lineWith = (src, needle) => {
  const l = src.split('\n').find(x => x.includes(needle));
  assert.ok(l, 're-anchor this test: could not find ' + needle);
  return l;
};

// A button is "named" if it carries a NON-EMPTY aria-label or title. Merely CONTAINING the word aria-label is
// not enough: `aria-label=""` passed the first version of this test while a screen reader announced nothing
// but "button". An audit defeated it exactly that way, 2026-08-28.
const namedBy = (line, attr) => {
  const m = new RegExp(attr + '=(?:"([^"]*)"|\\{([^}]*)\\})').exec(line);
  if (!m) return false;
  const v = (m[1] !== undefined ? m[1] : m[2]) || '';
  const t = v.trim();
  // …and a label of nothing but quotes or whitespace is not a label. `aria-label={' '}` passed the first
  // hardening: non-empty by length, silent to a screen reader.
  return t.length > 0 && t !== '""' && t !== "''" && t !== "' '" && t !== '" "' && /[^\s'"{}]/.test(t);
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
  // Pinned to the exact expression on purpose. A looser check accepted `aria-checked={!giving}` and
  // `{giving && false}` — both mention the state and both announce the wrong one. This is a one-line control
  // that has no reason to change shape; if it does, read this and decide deliberately.
  assert.match(btn, /aria-checked=\{!!church\.giving\}/,
    'the giving toggle no longer announces the real setting — check it is not negated or ANDed to a constant');
});

test('the console’s care conversation is a real dialog, and Escape closes it', () => {
  const at = MEALS.indexOf("width: 440, maxWidth: '92%', height: '70vh'");
  assert.ok(at > 0, 're-anchor: the care conversation panel has moved');
  const panel = MEALS.slice(at - 300, at + 100);
  assert.match(panel, /role="dialog"/, 'the panel is an anonymous div to a screen reader');
  assert.match(panel, /aria-modal="true"/, 'nothing tells assistive tech the rest of the page is inert');
  // …and the handler must actually CLOSE it. `if (e.key === 'Escape') {}` satisfied the old assertion while
  // Escape did nothing at all — the audit's exact defeat.
  // Comments stripped first: this repo has shipped an assertion that was satisfied by the comment explaining
  // the rule, and the raw-source anchor would find the FIRST mention rather than the handler.
  const MEALS_CODE = MEALS.replace(/\/\/.*$/gm, '');
  const keyAt = MEALS_CODE.indexOf("e.key === 'Escape'");
  assert.ok(keyAt > 0,
    'Escape does not close the care conversation — a keyboard user’s only way out is a mouse click on the ' +
    'backdrop, which is not a way out at all');
  assert.match(MEALS_CODE.slice(keyAt, keyAt + 120), /onClose\(\)/,
    'the Escape handler exists but does not close anything');
});


// ── SWEEP DEFECT 4, 2026-08-28: the Groups and Rota tabs, measured on the console ─────────────────────────
// Four separate gaps, none of which the checks above could catch, because a `title` counted as a name and
// stew-schedule.jsx was never read at all:
//   · the empty rota slot announced itself as "DoorAssign" — the role name and the word Assign are sibling
//     divs inside one button, so they concatenate
//   · five roster buttons said "Remove this role" / "Remove this person" without ever saying WHICH, so a
//     list of six roles offered six identical controls
//   · the rota-visibility button announced "Everyone" — its VALUE, with nothing saying what it governs
//   · Child-safe? and Encrypt? are toggles that never reported whether they were on

test('an empty rota slot says what it will assign, instead of running the role into the word Assign', () => {
  const l = lineWith(SCHED_CODE, "aria-label={'Assign someone to ' + role.name}");
  assert.ok(l.includes('<button'), 'the label is no longer on the slot button itself');
  // The two sibling divs are still there — that is the layout. The point is that the button now overrides
  // the name they would otherwise concatenate into.
  assert.match(SCHED_CODE, /aria-label=\{'Assign someone to ' \+ role\.name\}/,
    'the empty rota slot is announced as "DoorAssign" again');
});

test('a filled rota slot names the role, the person and their reply', () => {
  const l = lineWith(SCHED_CODE, 'Change who’s on this slot" aria-label=');
  for (const part of ['role.name', 'a.name', 'vm.label']) {
    assert.ok(l.includes(part), `the filled slot no longer announces ${part}`);
  }
});

test('every roster remove button says WHICH role, person or pod it removes', () => {
  for (const [needle, ref] of [
    ["aria-label={'Remove the role '", 'r.name'],
    ["aria-label={'Remove ' + (pp.name", 'pp.name'],
    ["aria-label={'Remove the pod '", 'pod.name'],
  ]) {
    const l = lineWith(SCHED_CODE, needle);
    assert.ok(l.includes(ref),
      `a roster remove button does not name what it removes (${ref}) — six identical controls in a row`);
  }
});

test('the rota-visibility button announces what it governs, not only its current value', () => {
  const l = lineWith(SCHED_CODE, 'aria-haspopup="menu"');
  assert.match(l, /aria-label=\{'Who can see the rota: '/,
    'the visibility button is announced as "Everyone" — the value, with nothing saying what it sets');
  assert.match(l, /aria-expanded=\{!!visMenu\}/, 'the menu button does not report whether the menu is open');
});

// Pinned to the exact expressions, exactly as the giving toggle above is: `aria-pressed={false}` and
// `aria-pressed={!it.childsafe}` both mention the state and both announce the wrong one.
test('the Child-safe and Encrypt toggles report their REAL state and name their group', () => {
  const cs = lineWith(DASH_CODE, 'childsafe: !it.childsafe');
  assert.match(cs, /aria-pressed=\{!!it\.childsafe\}/,
    'Child-safe does not announce whether it is on — check it is not negated or pinned to a constant');
  assert.ok(cs.includes("(it.name || 'This group')"), 'Child-safe does not say which group it belongs to');

  const en = lineWith(DASH_CODE, 'onClick={() => toggleEncrypt(it)}');
  assert.match(en, /aria-pressed=\{!!it\.encrypted\}/,
    'Encrypt does not announce whether it is on — check it is not negated or pinned to a constant');
  assert.ok(en.includes("(it.name || 'This group')"), 'Encrypt does not say which group it belongs to');
});
