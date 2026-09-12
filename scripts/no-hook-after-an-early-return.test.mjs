// A HOOK BELOW AN EARLY RETURN IS A COMPONENT THAT CRASHES THE FIRST TIME IT OPENS.
// Run: node --test scripts/no-hook-after-an-early-return.test.mjs
//
// FOUND BY THE PRE-MERGE AUDIT, 2026-09-04, and it was mine. The a11y batch added
// `useStewDialog(onClose, open)` to NewGroupModal AFTER its `if (!open) return null;`. These modals are
// always MOUNTED with `open` toggling, so opening one changed the number of hooks React had seen: React
// threw #310 and rendered nothing. **No steward could create a group on that build.**
//
// WHY THE TESTS I WROTE MISSED IT, which is the reason this file exists:
//   · the a11y test matched SOURCE TEXT for role="dialog" — present either way;
//   · the device check rendered the modal ALREADY OPEN, the one transition that does not throw;
//   · miniReact cannot catch it either — its hook store is indexed by call order and silently misaligns
//     instead of throwing, so a rendering test would have gone green too.
// The rule is structural, so the check is structural: no hook call may appear after an early return.
// The sibling modal in the same file has carried the comment "before the early return so hook order is
// stable" all along — the codebase knew, and the change ignored it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

// ⚠ THE `\w*` AFTER THE BASE NAMES IS NOT COSMETIC. Screens alias these at the top of the file —
// app/screens-today.jsx:2 is `const { useState: useStateT, useEffect: useEffectT } = React;` — and without
// it the pattern matches `useState` and then wants `\s*\(` where the `T` stands, so EVERY hook in that file
// is invisible to this guard. Audit of 23f7200: a `useStateT` placed after an early return was not caught.
// The `useStew*` / `useId*` / `useIx*` alternatives below are the same problem, found one file at a time.
const HOOK = /\b(?:React\.)?(?:useState|useEffect|useRef|useMemo|useCallback|useLayoutEffect)\w*\s*\(|\buseStew\w*\s*\(|\buseId\w*\s*\(|\buseIx\w*\s*\(/;
// ⚠ EXACTLY TWO SPACES, NOT `^\s*`, AND THAT IS THE NESTING FIX. `^\s*` matched a `return null` at ANY
// depth, so a guard clause inside a nested closure was read as the COMPONENT'S own early return — and every
// hook below it in the real component was then reported as broken. Measured across all of app/*.jsx: one
// false positive, `App` in app/app.jsx, from a `return null` inside a URL-parsing closure. `componentsIn`
// splits on top-level `function` lines and cannot see nesting, so the indentation IS the depth signal in
// this codebase's style: a component's own statements sit at two spaces, anything nested sits deeper.
// A test that cries wolf costs exactly what a missing one does — the comment above `componentsIn` already
// says so, about the previous version of this same mistake.
const EARLY_RETURN = /^  if\s*\([^)]*\)\s*return\s+null;\s*$/;

function componentsIn(file) {
  const src = stripComments(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
  const lines = src.split('\n');
  const out = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    // ANY top-level function ends the previous one — including a lowercase custom hook. Splitting only on
    // capitalised names attributed `useStewNarrow`'s hooks to the component ABOVE it and reported a clean
    // component as broken. A test that cries wolf costs exactly what a missing one does.
    const m = /^function (\w+)\s*\(/.exec(lines[i]);
    if (m) { if (cur) out.push(cur); cur = { name: m[1], start: i + 1, lines: [] }; continue; }
    if (cur) cur.lines.push({ n: i + 1, text: lines[i] });
  }
  if (cur) out.push(cur);
  return out;
}

// ⚠ THE LIST IS NO LONGER HAND-MAINTAINED, AND THAT IS THE FIX. It was seven files, and two things proved
// that unsafe: app/screens-today.jsx was ABSENT while two of its components carried a comment naming this
// test as their guard (audit of 23f7200) — and when it was added, a later sabotage showed that REMOVING IT
// AGAIN left this file 2/2 GREEN. A guard whose own configuration can be reverted without a test failing is
// not holding anything in place.
//
// So it is derived: every app/*.jsx that uses a hook at all. Measured today, that is 31 files — where the
// hand-written list had 7, so 24 were never looked at. The sweep flags none of them, which is why this can
// be turned on without a cleanup first.
//
// ⚠ IT COULD NOT HAVE BEEN TURNED ON BEFORE THE NESTING FIX ABOVE. With `^\s*` the sweep reported one false
// positive (`App` in app/app.jsx, from a `return null` inside a nested closure), and a guard that cries wolf
// on day one gets disabled by the next person in a hurry.
//
// EXEMPTIONS GO HERE, NAMED AND WITH A REASON. Empty today; if a file ever has to come out, say which and
// why, so the exemption is a decision rather than a silent gap.
const EXEMPT = new Set([]);
const FILES = readdirSync(new URL('../app/', import.meta.url))
  .filter(f => f.endsWith('.jsx') && !EXEMPT.has('app/' + f))
  .map(f => 'app/' + f)
  .filter(f => HOOK.test(stripComments(readFileSync(new URL('../' + f, import.meta.url), 'utf8'))));

test('no component calls a hook after an early return', () => {
  const bad = [];
  for (const f of FILES) {
    for (const c of componentsIn(f)) {
      let returnedAt = 0;
      for (const l of c.lines) {
        if (!returnedAt && EARLY_RETURN.test(l.text)) { returnedAt = l.n; continue; }
        if (returnedAt && HOOK.test(l.text)) {
          bad.push(`${f}:${l.n} — ${c.name} calls a hook after its early return at :${returnedAt}`);
          break;
        }
      }
    }
  }
  assert.deepEqual(bad, [],
    'these components call a hook below an early return. A modal that is always mounted with `open` ' +
    'toggling then changes its hook count the moment it opens, React throws #310, and the screen renders ' +
    'NOTHING — with no error anywhere a steward can see:\n  ' + bad.join('\n  '));
});

test('CONTROL: the check can actually see a hook after a return', () => {
  // A structural test that cannot fail is worth nothing. Prove the matcher fires on the shape it hunts.
  const sample = ['function Thing({ open }) {', '  if (!open) return null;', '  const r = useStewDialog(x);', '  return null;', '}'].join('\n');
  const lines = sample.split('\n');
  let returnedAt = 0, found = false;
  for (let i = 0; i < lines.length; i++) {
    if (!returnedAt && EARLY_RETURN.test(lines[i])) { returnedAt = i + 1; continue; }
    if (returnedAt && HOOK.test(lines[i])) { found = true; break; }
  }
  assert.ok(found, 'the matcher no longer recognises a hook after an early return — it would pass over the bug');
});

test('THE GUARD\u2019S OWN CONFIGURATION IS HELD IN PLACE — it was not, and both halves could be reverted', () => {
  // Measured 2026-09-12: reverting the `\\w*` on the hook names, OR dropping a file from the list, left this
  // file 2/2 GREEN. The existing CONTROL exercises `useStewDialog(`, which matched before that change too,
  // so it could not see either revert. These two do.

  // (a) THE ALIAS. app/screens-today.jsx opens with
  //     `const { useState: useStateT, useEffect: useEffectT } = React;`
  //     and without the `\\w*` the pattern matches `useState` then wants `(` where the `T` stands. Every
  //     hook in that file — on the Today screen of every member of every church — was invisible.
  const ALIASED = 'function Card() {\n  const [a] = useStateT(0);\n  if (!a) return null;\n  const [b] = useStateT(1);\n  return b;\n}';
  const lines = ALIASED.split('\n');
  let returnedAt = 0, caught = false;
  for (let i = 0; i < lines.length; i++) {
    if (!returnedAt && EARLY_RETURN.test(lines[i])) { returnedAt = i + 1; continue; }
    if (returnedAt && HOOK.test(lines[i])) { caught = true; break; }
  }
  assert.equal(caught, true,
    'AN ALIASED HOOK AFTER AN EARLY RETURN IS INVISIBLE TO THIS GUARD. That is the exact defect the `\\w*` ' +
    'was added for, and nothing was holding it in place.');

  // (b) THE LIST. Derived, not typed — so a file cannot be quietly dropped, and a new screen is covered the
  //     day it is written rather than the day somebody remembers.
  assert.ok(FILES.includes('app/screens-today.jsx'),
    'app/screens-today.jsx is not being scanned. Two of its components name this test as their guard.');
  assert.ok(FILES.length >= 20,
    'the scanned list has collapsed to ' + FILES.length + ' files. It is derived from app/*.jsx; a sudden ' +
    'drop means the derivation broke, not that the hooks went away.');
  for (const f of ['app/stew-dashboard.jsx', 'app/identity.jsx', 'app/screens-chat.jsx']) {
    assert.ok(FILES.includes(f), f + ' fell out of the derived list');
  }
});

test('\u2026and the nesting fix is held in place too', () => {
  // `^\\s*` matched a `return null` at ANY depth, so a guard clause inside a nested closure was read as the
  // component's own early return. Measured: one false positive across app/*.jsx (`App` in app/app.jsx).
  const NESTED = 'function Screen() {\n  const [a] = React.useState(0);\n  const f = () => {\n    if (!a) return null;\n  };\n  const [b] = React.useState(1);\n  return b;\n}';
  const lines = NESTED.split('\n');
  let returnedAt = 0, flagged = false;
  for (let i = 0; i < lines.length; i++) {
    if (!returnedAt && EARLY_RETURN.test(lines[i])) { returnedAt = i + 1; continue; }
    if (returnedAt && HOOK.test(lines[i])) { flagged = true; break; }
  }
  assert.equal(flagged, false,
    'A `return null` INSIDE A NESTED CLOSURE WAS READ AS THE COMPONENT\u2019S EARLY RETURN, so every hook ' +
    'below it is reported as broken. A test that cries wolf costs exactly what a missing one does.');
});
