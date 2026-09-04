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

const HOOK = /\b(?:React\.)?(?:useState|useEffect|useRef|useMemo|useCallback|useLayoutEffect)\s*\(|\buseStew\w*\s*\(|\buseId\w*\s*\(|\buseIx\w*\s*\(/;
const EARLY_RETURN = /^\s*if\s*\([^)]*\)\s*return\s+null;\s*$/;

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

const FILES = ['app/stew-dashboard.jsx', 'app/identity.jsx', 'app/identity-extras.jsx',
               'app/stew-meals.jsx', 'app/stew-finance.jsx', 'app/screens-chat.jsx'];

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
