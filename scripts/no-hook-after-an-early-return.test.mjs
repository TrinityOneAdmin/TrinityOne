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
const BASE = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useLayoutEffect'];
// ⚠ THE ALIASES ARE READ OUT OF EACH FILE, NOT LISTED HERE, AND THAT IS THE SECOND TIME THIS GUARD HAS BEEN
// BLIND TO THEM. First it had no alias handling at all. Then a `\w*` suffix was added — which only catches
// aliases that BEGIN with the real hook name (`useStateT`, `useEffectT`). An audit measured what that missed:
// 42 aliases are declared across app/*.jsx and 37 were invisible, including `useA`/`useAE`/`useAR` in
// app/app.jsx, which is 168 of that file's 175 hook calls. A hook planted after an early return using that
// file's own idiom was NOT caught; the same hook written longhand was.
//
// So the pattern is built PER FILE from its own `const { useState: useA, … } = React;` line. A new screen
// with a new abbreviation is covered the day it is written, and nobody has to remember a list.
//
// ⚠ THIS ALSO FIXES THE DERIVED FILE LIST. `FILES` is filtered with this same matcher, so four real screens
// (screens-church, screens-giving, screens-help-main, screens-help) were dropped from the scan ENTIRELY for
// using nothing but aliases.
function hookRe(src) {
  const alias = new Set();
  // `const { useState: useA, useEffect: useAE } = React;` — every renamed binding off React.
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*React\s*;/g)) {
    for (const pair of m[1].split(',')) {
      const [from, to] = pair.split(':').map(x => (x || '').trim());
      if (to && BASE.includes(from)) alias.add(to);
    }
  }
  // The bare forms stay: a file may use `React.useState` and an alias in the same breath, and the
  // project-specific `useStew*`/`useId*`/`useIx*` families are matched by prefix as before.
  const names = [...BASE.map(b => b + '\\w*'), ...[...alias].map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))];
  return new RegExp('\\b(?:React\\.)?(?:' + names.join('|') + ')\\s*\\(|\\buseStew\\w*\\s*\\(|\\buseId\\w*\\s*\\(|\\buseIx\\w*\\s*\\(');
}
// The file-independent form, used only to decide which files are worth scanning at all.
const HOOK = hookRe('const { useState: useA, useEffect: useAE, useRef: useAR } = React;');

const EARLY_RETURN = /^  if\s*\([^)]*\)\s*return\s+null;\s*$/;

// `srcOverride` exists so a test can drive this whole path — file selection, alias derivation and the scan —
// against a synthetic file. Without it the only way to exercise the scan was to edit a real screen, and a
// sabotage proved the wiring untested: swapping the per-file matcher for one shared pattern left every test
// green, because the shared one happens to carry app/app.jsx's aliases and no real file is violating today.
function componentsIn(file, srcOverride) {
  const src = srcOverride != null ? stripComments(srcOverride)
                                  : stripComments(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
  componentsIn.hook = hookRe(src);   // the matcher for THIS file's own aliases
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
  .filter(f => {
    const src = stripComments(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
    return hookRe(src).test(src);
  });

// The scan, lifted out of the test so it can be run over a synthetic file as well as the real ones.
function violationsIn(file, srcOverride) {
  const bad = [];
  for (const c of componentsIn(file, srcOverride)) {
    let returnedAt = 0;
    for (const l of c.lines) {
      if (!returnedAt && EARLY_RETURN.test(l.text)) { returnedAt = l.n; continue; }
      if (returnedAt && componentsIn.hook.test(l.text)) {
        bad.push(`${file}:${l.n} — ${c.name} calls a hook after its early return at :${returnedAt}`);
        break;
      }
    }
  }
  return bad;
}

test('THE SCAN USES EACH FILE\u2019S OWN ALIASES — driven end to end over a synthetic screen', () => {
  // ⚠ THIS COVERS THE WIRING, NOT JUST THE PATTERN BUILDER. Sabotage found the gap: swapping
  // `componentsIn.hook = hookRe(src)` for the one shared pattern left every other test green, because the
  // shared pattern happens to be seeded from app/app.jsx and no real screen is violating today.
  // `useZq` belongs to no real file, so only a per-file derivation can see it.
  const SYNTH = [
    'const { useState: useZq, useEffect: useZqE } = React;',
    'function Screen() {',
    '  const [a] = useZq(0);',
    '  if (!a) return null;',
    '  const [b] = useZq(1);',
    '  return b;',
    '}',
  ].join('\n');
  const bad = violationsIn('synthetic.jsx', SYNTH);
  assert.equal(bad.length, 1,
    'A HOOK AFTER AN EARLY RETURN WAS MISSED because the scan did not use this file\u2019s own alias. That ' +
    'is the whole defect: 37 of the 42 aliases declared across app/*.jsx begin with nothing the generic ' +
    'pattern matches. Found: ' + JSON.stringify(bad));
  assert.match(bad[0], /Screen calls a hook after its early return/);
  // …and the same file with the hook ABOVE the return is clean, so this is not a matcher that flags anything.
  assert.deepEqual(violationsIn('synthetic.jsx', SYNTH.replace('  const [b] = useZq(1);\n', '')), []);
});

test('no component calls a hook after an early return', () => {
  const bad = [];
  for (const f of FILES) {
    for (const c of componentsIn(f)) {
      let returnedAt = 0;
      for (const l of c.lines) {
        if (!returnedAt && EARLY_RETURN.test(l.text)) { returnedAt = l.n; continue; }
        if (returnedAt && componentsIn.hook.test(l.text)) {
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

  // (a0) THE ALIAS PATTERN IS BUILT FROM THE FILE'S OWN DECLARATIONS. Measured 2026-09-13: a `\w*` suffix
  //      catches only aliases that BEGIN with the hook name, and 37 of the 42 declared across app/*.jsx do
  //      not — `useA`, `useAE`, `useAR` in app/app.jsx alone are 168 of that file's 175 hook calls. That is
  //      68% visibility across the tree; per-file derivation is 100%.
  const APPJSX = stripComments(readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8'));
  assert.ok(hookRe(APPJSX).test('  const [a] = useA(0);'),
    'app/app.jsx\u2019s OWN hook idiom is invisible to this guard. It declares `useState: useA` and uses it ' +
    '175 times; a hook planted after an early return there would not be caught.');
  assert.ok(!hookRe('const { useState } = React;').test('  const x = useAnything(0);'),
    'the derived pattern matches an identifier that is not a hook in that file — a guard that cries wolf ' +
    'costs exactly what a missing one does');

  // (a1) EACH FILE IS SCANNED WITH ITS OWN ALIASES, NOT WITH ONE SHARED PATTERN. Sabotage found this gap:
  //      swapping the per-file matcher for the generic one left every test green, because the generic one
  //      happens to be seeded from app/app.jsx's aliases. Other screens use entirely different ones —
  //      screens-church says `useState: useCh`, screens-giving says `useState: useG` — and a single shared
  //      pattern is blind to whichever file it was not seeded from. This asserts the property directly.
  const CHURCHJSX = stripComments(readFileSync(new URL('../app/screens-church.jsx', import.meta.url), 'utf8'));
  assert.ok(hookRe(CHURCHJSX).test('  const [a] = useCh(0);'),
    'app/screens-church.jsx is not scanned with its own alias (`useCh`)');
  assert.ok(!hookRe(APPJSX).test('  const [a] = useCh(0);'),
    'one file\u2019s pattern matches another file\u2019s alias, so the per-file derivation is not actually ' +
    'per-file — and a single shared pattern is blind to whichever screen it was not seeded from');

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
  assert.ok(FILES.length >= 30,
    'the scanned list has collapsed to ' + FILES.length + ' files (35 at the last measurement). It is ' +
    'derived from app/*.jsx; a sudden drop means the derivation broke, not that the hooks went away — and ' +
    'the last time it broke, four real screens were dropped for using nothing but aliases.');
  for (const f of ['app/app.jsx', 'app/screens-church.jsx', 'app/screens-giving.jsx', 'app/screens-help.jsx']) {
    assert.ok(FILES.includes(f),
      f + ' is not scanned. It uses hooks only through aliases, which is exactly what the old pattern ' +
      'could not see — and why it was dropped from the list entirely.');
  }
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
