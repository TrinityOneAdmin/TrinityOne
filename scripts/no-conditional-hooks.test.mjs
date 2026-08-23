// THE FINANCE GATE MAY NOT SIT BETWEEN HOOKS.
// Run: node --test scripts/no-conditional-hooks.test.mjs
//
// Found by adversarial audit, 2026-08-20, in the commit that opened Finance to delegated stewards. The gate
// deciding whether a treasurer sees the books was written as an early `return` in the middle of DashFinance —
// after two hooks and before nine more:
//
//     const [finKey, setFinKey] = React.useState(...);      // hook 1
//     React.useEffect(...);                                 // hook 2
//     if (S.actingChurch && !finKey) return <Waiting/>;      // <- here
//     const bookRef = React.useRef(null);                    // hooks 3..11
//
// React counts hooks per render. The moment the key envelope arrived and `finKey` flipped, the component
// rendered eleven hooks where it had rendered two: React error #310, "Rendered more hooks than during the
// previous render". This console has exactly one error boundary and it wraps the whole of StewardRoot — so
// the FIRST TIME a church granted Finance to a treasurer, the entire console dropped to the crash card.
// Revoking the capability threw the mirror error.
//
// Every structural test in the suite passed, because they could read the gate and see the right words in it.
// What they could not see was that the gate was in the wrong PLACE.
//
// WHY THIS FILE IS NARROW. The first version tried to scan every component in app/ by walking braces. It
// cannot be done honestly without a real parser: JSX text carries bare apostrophes ("STRONG'S") that a
// hand-rolled scanner reads as a string literal, and even after transpiling the JSX away the function-boundary
// walk overran and attributed one component's code to another. It reported violations in components that have
// none — a test that cries wolf about 25 files is worse than no test, and this repo has already shipped one
// assertion satisfied by a comment. So: pin the case that actually broke, precisely, and say plainly that the
// general rule is not mechanically enforced here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { stripComments } from './test-slice.mjs';

const SRC = stripComments(transformSync(
  readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8'), { loader: 'jsx' }).code);

// The body of one top-level function, from its declaration to the start of the next one. Crude but adequate
// here, because we only ask which of two named functions a given phrase falls inside.
function bodyOf(name) {
  const decls = [...SRC.matchAll(/\bfunction\s+([A-Z]\w*)\s*\(/g)];
  const i = decls.findIndex(d => d[1] === name);
  assert.ok(i >= 0, `re-anchor: ${name} is gone from stew-finance.jsx`);
  return SRC.slice(decls[i].index, i + 1 < decls.length ? decls[i + 1].index : SRC.length);
}

const HOOK = /\bReact\.use(?:State|Effect|Ref|Memo|Callback|Reducer|LayoutEffect)\s*\(/g;

test('DashFinance is a wrapper whose hook count cannot change', () => {
  const body = bodyOf('DashFinance');
  const hooks = [...body.matchAll(HOOK)];
  assert.ok(hooks.length > 0, 're-anchor: DashFinance no longer holds the key subscription');
  // every hook must appear BEFORE the first conditional return
  const firstGate = body.search(/\bif\s*\([^;]*\)\s*return\b/);
  assert.ok(firstGate > 0, 're-anchor: the gate is gone');
  const lastHook = hooks[hooks.length - 1].index;
  assert.ok(lastHook < firstGate,
    'a hook is called AFTER the conditional return in DashFinance. The first time that condition flips, this ' +
    'component renders a different number of hooks than it did last time — React error #310, and with one ' +
    'error boundary around the whole console that means the entire page drops to the crash card.');
});

test('the ledger body is a separate component, so its hooks are all-or-nothing', () => {
  const gate = bodyOf('DashFinance');
  const book = bodyOf('DashFinanceBook');
  assert.match(gate, /Waiting for the books/, 'the gate has left the wrapper');
  assert.doesNotMatch(book, /Waiting for the books/,
    'the gate is back inside the component that owns the ledger hooks — the exact shape that crashed the console');
  assert.match(gate, /DashFinanceBook/, 'the wrapper no longer renders the ledger');
  assert.ok([...book.matchAll(HOOK)].length > 4,
    're-anchor: the ledger hooks are no longer in DashFinanceBook, so this test is guarding the wrong thing');
});

// NOT TESTED HERE, deliberately: "DashFinanceBook has no conditional return above its hooks". Written and
// removed the same hour — a plain regex for `if (...) return` cannot tell a component-level early return from
// an ordinary `if (!useRelay) return;` inside a useEffect callback, and it flagged exactly that. Splitting the
// two needs the brace tracking that the header explains cannot be done honestly without a parser. The two
// tests above pin the shape that actually broke; a third that cries wolf would only teach people to ignore
// this file.
