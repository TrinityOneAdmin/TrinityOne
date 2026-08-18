// WITHDRAWING A REQUEST FOR HELP MUST ASK FIRST — IT DELETES THE THREAD TOO.
// Run: node --test scripts/care-withdraw-confirms.test.mjs
//
// A simulated 81-year-old lost his hospital-lift request AND the private care-team conversation attached to it
// to a single tap of "Withdraw": instant, no confirm, no undo, no toast (2026-08-18). Withdraw is the one
// destructive, irreversible control on that card — a day-signup toggle re-signs with a tap, but a withdrawn
// request and its thread are gone, and you start over.
//
// The fix is a real dialog, away from the finger that tapped Withdraw (NOT a same-spot second tap — that is
// the trap the Leave-church change had to avoid), naming what goes, safe choice first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');

test('the Withdraw button opens a confirm rather than deleting on the tap', () => {
  const fn = stripComments(fnBody(TODAY, 'function MyRequestRow({ r, onCancel, onMessage }) {'));
  // the button must NOT call onCancel directly any more…
  assert.doesNotMatch(fn, /Withdraw['"]?\s*>[^<]*<\/button>[\s\S]{0,4}: null[\s\S]{0,4}onClick=\{async[^}]*onCancel\(\)/,
    'the withdraw button still deletes on its own tap');
  assert.match(fn, /onClick=\{\(\) => setConfirming\(true\)\}[^>]*title="Withdraw this request"/,
    'the Withdraw button must open the confirm, not run onCancel');
});

test('the confirm is a real dialog that names what is lost, and only THEN cancels', () => {
  const fn = stripComments(fnBody(TODAY, 'function MyRequestRow({ r, onCancel, onMessage }) {'));
  assert.match(fn, /role="dialog" aria-modal="true"/, 'a real dialog, not an in-place second tap');
  assert.match(fn, /conversation with your care team/i, 'it must name the thread that also goes');
  assert.match(fn, /can’t be undone/i, 'and that it is irreversible');
  // the safe option first, and onCancel reached ONLY from the destructive button inside the dialog
  assert.match(fn, />Keep it</, 'the safe choice must be a real button');
  const destructive = fn.slice(fn.indexOf('>Keep it<'));
  assert.match(destructive, /await onCancel\(\)/, 'the actual withdraw happens from inside the confirmed path');
});
