// A DUPLICATE IMPORT COUNTS, NOT JUST EXISTS.
//   Run: node --test scripts/a-duplicate-import-counts-not-just-exists.test.mjs
//
// THE DEFECT. The import review screen used `importedKeys(book)` — a Set — to mark statement
// lines as duplicates. Two identical payments (same amount, date, description) share one key.
// If one was already in the journal, BOTH were greyed out as "already imported", so the second
// legitimate payment was silently dropped.
//
// THE FIX. `toReview` now counts how many of each key the journal holds and decrements on each
// match. Two in the statement and one in the journal marks one as dup and lets the other through.
//
// Caller of toReview: the import modal in `app/stew-finance.jsx`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');
const TOREVIEW_DECL = fnBody(SRC, 'const toReview = () => {', 'toReview');
const TOREVIEW = TOREVIEW_DECL.replace(/^const toReview\s*=\s*/, '');

function runToReview(journalEntries, statementLines) {
  let captured = null;
  const scope = {
    parsed: { rows: [] },
    dec: 2,
    monthFirst: true,
    F: {
      statementLines: () => statementLines,
      suggestCategory: () => null,
    },
    builtMapping: () => ({}),
    defAccount: () => 'bank:main',
    book: {
      journal: journalEntries,
      accounts: new Map([['bank:main', { name: 'Main', type: 'asset' }]]),
      funds: new Map([['general', { name: 'General' }]]),
    },
    setLines: () => {},
    setRowState: (rs) => { captured = rs; },
    setErr: () => {},
    setStep: () => {},
  };
  const fn = new Function('scope', `with (scope) { return (${TOREVIEW}); }`)(
    new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (k in t) return t[k];
        if (String(k) in globalThis) return globalThis[String(k)];
        throw new ReferenceError('toReview needs `' + String(k) + '`');
      },
      set: (t, k, v) => { t[k] = v; return true; },
    })
  );
  fn();
  return captured;
}

function line(key) { return { key, date: '2026-01-15', description: 'Payment', amountMinor: 10000, dir: 'in' }; }

test('two identical statement lines, one already imported: only one is dup', () => {
  const rs = runToReview(
    [{ importKey: 'pay-x' }],
    [line('pay-x'), line('pay-x')]
  );
  assert.equal(rs.length, 2);
  assert.equal(rs[0].dup, true, 'the first line with a matching key should be marked dup');
  assert.equal(rs[1].dup, false,
    'THE SECOND IDENTICAL PAYMENT IS MARKED AS A DUPLICATE — a church that receives two £100 ' +
    'gifts on the same Sunday from the same person has one silently dropped from the import');
  assert.equal(rs[1].selected, true, 'the non-dup line should be selected for import');
});

test('two identical statement lines, neither imported: both are new', () => {
  const rs = runToReview([], [line('pay-x'), line('pay-x')]);
  assert.equal(rs[0].dup, false);
  assert.equal(rs[1].dup, false);
});

test('two identical statement lines, both already imported: both are dup', () => {
  const rs = runToReview(
    [{ importKey: 'pay-x' }, { importKey: 'pay-x' }],
    [line('pay-x'), line('pay-x')]
  );
  assert.equal(rs[0].dup, true);
  assert.equal(rs[1].dup, true);
});

test('CONTROL: a unique statement line already imported is dup', () => {
  const rs = runToReview(
    [{ importKey: 'pay-y' }],
    [line('pay-y')]
  );
  assert.equal(rs[0].dup, true);
  assert.equal(rs[0].selected, false);
});
