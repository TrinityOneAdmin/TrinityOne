// F2: closing "record a transaction" (opened by the + FAB) returns to the page you tapped + from.
//   Run: node --test scripts/finance-record-close-returns.test.mjs
// Runs the REAL finRecordNav lifted from app/stew-finance.jsx and drives it the way the FAB handler and
// BooksRecord's onClose/onRecord do (see DashFinanceBook). Wiring into the component is by device check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-finance.jsx'), 'utf8');
const finRecordNav = new Function(fnBody(SRC, 'function finRecordNav(', 'finRecordNav') + '\nreturn finRecordNav;')();

// A tiny page model mirroring the handlers' use of the refs.
function session(startTab) {
  const s = { tab: startTab, origin: null };
  s.fab = () => { const n = finRecordNav(s.origin, 'open', s.tab); s.origin = n.origin; if (n.goTo) s.tab = n.goTo; };
  s.close = () => { const n = finRecordNav(s.origin, 'close', s.tab); s.origin = n.origin; if (n.goTo) s.tab = n.goTo; };
  s.save = () => { s.origin = finRecordNav(s.origin, 'save', s.tab).origin; };
  return s;
}

for (const page of ['summary', 'donors', 'reports', 'accounts']) {
  test(`+ from ${page}, then close, lands back on ${page}`, () => {
    const s = session(page); s.fab();
    assert.equal(s.tab, 'transactions');
    s.close();
    assert.equal(s.tab, page);
  });
}
test('+ from transactions, close, stays on transactions', () => {
  const s = session('transactions'); s.fab(); s.close(); assert.equal(s.tab, 'transactions');
});
test('save then close keeps you on transactions and forgets the origin', () => {
  const s = session('summary'); s.fab(); s.save(); s.close();
  assert.equal(s.tab, 'transactions'); assert.equal(s.origin, null);
});
test('a later + does not inherit a stale origin', () => {
  const s = session('donors'); s.fab(); s.close(); s.tab = 'reports'; s.fab(); s.close();
  assert.equal(s.tab, 'reports');
});
