// THE "INCOME VS SPENDING" CHART SHOWS ONLY IN THE FINANCE APP, NEVER IN THE STEWARD CONSOLE (point-of-use test).
//   Run: node --test scripts/the-income-chart-shows-only-in-the-finance-app.test.mjs
//
// app/stew-finance.jsx draws the chart only when window.stewIsFinanceApp() is true; app/steward-root.jsx defines that as
// window.TRINITY_APP === 'finance', and only finance-mode.js (loaded by finance.html alone) sets TRINITY_APP.
//
// POINT OF USE (CLAUDE.md rules 1 & 3): this renders the REAL DashFinanceBook twice over the SAME seeded book; the only
// difference is window.TRINITY_APP. stewIsFinanceApp is lifted from app/steward-root.jsx and run (not text-matched in
// an assertion). The chart is found in the rendered tree by its aria-label.
//
// SABOTAGE (done by hand 2026-11-28, scoped to the one gate line `monthlyIE.length > 0 && window.stewIsFinanceApp &&
// window.stewIsFinanceApp() && (() => {` in DashFinanceBook): deleting the `window.stewIsFinanceApp && window.stewIsFinanceApp() &&`
// part turns the "console" test RED and leaves the "finance app" test green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConsole, fakeReact, fakeBrowser, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reconcile = await import('../src/finance-reconcile.mjs');
const _reports = await import('../src/finance-reports.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reconcile, ..._reports };

// The REAL stewIsFinanceApp, lifted from the shipped steward-root.jsx (one line, no JSX) and run against the fake window.
const LIFT = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8').match(/^function stewIsFinanceApp\(\) \{.*\}$/m);
assert.ok(LIFT, 're-anchor: stewIsFinanceApp is no longer a one-line function in steward-root.jsx');
const stewIsFinanceAppFor = (window) => new Function('window', LIFT[0] + '; return stewIsFinanceApp;')(window);

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  return d;
});
function seedItems() {
  const Y = new Date().getFullYear();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'rent', code: '5000', name: 'Rent', type: 'expense' });
  FL.post(b, { date: Y + '-01-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });
  FL.post(b, { date: Y + '-01-06', memo: 'hall', postings: [{ account: 'rent', dir: 'dr', amount: 9000 }, { account: 'bank', dir: 'cr', amount: 9000 }] });
  return toItems(FL.bookToDocs(b));
}

// Renders the real DashFinanceBook with `app` as window.TRINITY_APP (undefined = steward console) and returns the tree.
function render(app) {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward0(() => { }, (cb) => { encSubCb = cb; });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  if (app !== undefined) window.TRINITY_APP = app;
  window.stewIsFinanceApp = stewIsFinanceAppFor(window);
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  window.useStewardChurch = () => ({ name: 'Grace', accent: '', picture: '' });
  window.useStewardGroups = () => [];
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  draw();
  assert.ok(encSubCb, 'encSubscribe was not wired');
  encSubCb(seedItems()); draw();
  return tree;
}
import { fakeSteward } from './console-screens.mjs';
function fakeSteward0(_x, onEnc) {
  return fakeSteward({ encSubscribe: (_p, cb) => { onEnc(cb); return () => {}; }, encPublish: async () => true, relayAuthed: () => true });
}

const CHART = 'Monthly income vs spending bar chart';
const hasChart = (tree) => nodes(tree).some(n => n && n.props && n.props['aria-label'] === CHART);
const hasBook = (tree) => texts(tree).includes('Funds');

test('the finance app (TRINITY_APP = "finance") shows the Income vs Spending chart', () => {
  const tree = render('finance');
  assert.ok(hasBook(tree), 're-anchor: the overview ("Funds" card) did not render, so absence below would be meaningless');
  assert.ok(hasChart(tree), 'the chart is missing in the finance app');
});

test('the steward console (TRINITY_APP unset) does NOT show the chart, on the same book', () => {
  const tree = render(undefined);
  assert.ok(hasBook(tree), 're-anchor: the overview ("Funds" card) did not render');
  assert.ok(!hasChart(tree), 'the Income vs Spending chart leaked into the steward console');
});
