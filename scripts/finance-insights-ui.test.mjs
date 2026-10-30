// THE INSIGHTS TAB IS REACHABLE, AND EVERY CHART ACTUALLY RENDERS AN <svg> (UX-F, 2026-10-30).
//   Run: node --test scripts/finance-insights-ui.test.mjs
//
// CLAUDE.md rules 1 & 3 (point-of-use). Every assertion renders REAL console components through
// scripts/console-screens.mjs (the whole console compiled the way the phone loads it) and reads the RENDERED
// TREE — never the .jsx text, so a `false &&` in front of a chart cannot satisfy it. Delete a chart body (or
// return null), or drop the tab from the strip, and the matching assertion fails.
//
// Two halves:
//   1. DashFinanceBook: the Insights tab is on the strip, selecting it reveals the projection chart (and the
//      sub-view switcher swaps the four charts). console-screens renders ONE component body and leaves child
//      COMPONENTS as element nodes, so the four charts are asserted by their PRESENCE + the data props
//      DashFinanceBook hands them — their <svg> bodies are proven in half 2.
//   2. Each chart component rendered DIRECTLY with a seeded book: the tree contains an <svg> with the expected
//      number of series marks and the series LABELS in text (accessible — not colour-alone).
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook + the four Books*Chart components).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reports = await import('../src/finance-reports.mjs');
const _budget = await import('../src/finance-budget.mjs');
const _charts = await import('../src/finance-charts.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reports, ..._budget, ..._charts };

const EXPR = '{ DashFinanceBook, BooksProjectionChart, BooksMonthlyTrendChart, BooksBudgetChart, BooksFundBalanceChart }';

function setup() {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({ actingChurch: '', pubkey: 'ab'.repeat(32), encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; }, encPublish: async () => true, relayAuthed: () => true });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: EXPR });
  window.useStewardChurch = () => ({ name: 'St Test', features: {} });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const button = (label) => all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const comp = (name) => all().find(n => typeof n.type === 'function' && n.type.name === name);
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  return { mods, draw, all, button, comp, click, feedItems, get tree() { return tree; } };
}

// A book with activity across a few months of THIS fiscal year, so the charts have data to draw.
function seedItems() {
  const Y = new Date().getFullYear();
  return [
    { id: 'settings', baseCurrency: 'GBP', decimals: 2, fiscalYearStart: '01-01' },
    { id: 'account:bank', code: '1000', name: 'Bank', type: 'asset' },
    { id: 'account:giving', code: '4000', name: 'Giving', type: 'income' },
    { id: 'account:utilities', code: '5000', name: 'Utilities', type: 'expense' },
    { id: 'journal:1', seq: 1, date: Y + '-01-15', memo: 'Gift', postings: [{ account: 'bank', dir: 'dr', amount: 20000 }, { account: 'giving', dir: 'cr', amount: 20000 }] },
    { id: 'journal:2', seq: 2, date: Y + '-02-10', memo: 'Electric', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] },
    { id: 'journal:3', seq: 3, date: Y + '-03-05', memo: 'Gift', postings: [{ account: 'bank', dir: 'dr', amount: 12000 }, { account: 'giving', dir: 'cr', amount: 12000 }] },
  ];
}

// ── half 1: the Insights tab in the real DashFinanceBook ──

test('the Insights tab is on the strip', () => {
  const h = setup();
  h.draw();
  assert.ok(h.button('Insights'), 'the Insights tab is not on the Finance tab strip');
});

test('selecting Insights reveals the projection chart with the computed projection, and hides Transactions', () => {
  const h = setup();
  h.draw();
  h.feedItems(seedItems());
  h.click('Insights');
  const chart = h.comp('BooksProjectionChart');
  assert.ok(chart, 'the Insights tab did not reveal the projection chart');
  // The data must actually be COMPUTED and handed down — delete the F.yearEndProjection call and this fails.
  assert.ok(chart.props && chart.props.proj && chart.props.proj.projected, 'DashFinanceBook did not pass a computed projection to the chart');
  assert.ok(!nodes(h.tree).some(n => n.type === 'div' && texts(n).join(' ').includes('Recent transactions')) , 'the Transactions panel is still showing on the Insights tab');
});

test('the Insights sub-view switcher swaps the four charts', () => {
  const h = setup();
  h.draw();
  h.feedItems(seedItems());
  h.click('Insights');
  assert.ok(h.comp('BooksProjectionChart') && !h.comp('BooksMonthlyTrendChart'), 'projection is not the default sub-view');
  h.click('Monthly trend');
  assert.ok(h.comp('BooksMonthlyTrendChart') && !h.comp('BooksProjectionChart'), 'the Monthly trend sub-view did not swap in the trend chart');
  h.click('Budget vs actual');
  assert.ok(h.comp('BooksBudgetChart') && !h.comp('BooksMonthlyTrendChart'), 'the Budget vs actual sub-view did not swap in the budget chart');
  h.click('Fund balances');
  assert.ok(h.comp('BooksFundBalanceChart') && !h.comp('BooksBudgetChart'), 'the Fund balances sub-view did not swap in the fund chart');
});

// ── half 2: each chart component renders a real <svg> with the expected series ──

function chartMods() {
  const fr = fakeReact();
  const { window } = fakeBrowser();
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: EXPR });
  window.useStewardChurch = () => ({ name: 'St Test', features: {} });
  return mods;
}
function chartBook() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.addFund(b, { id: 'building', name: 'Building fund', kind: 'restricted' });
  FL.post(b, { date: '2026-01-15', postings: [{ account: 'bank', dir: 'dr', amount: 20000 }, { account: 'giving', dir: 'cr', amount: 20000 }] });
  FL.post(b, { date: '2026-02-10', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] });
  FL.post(b, { date: '2026-03-05', postings: [{ account: 'bank', dir: 'dr', amount: 60000 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 60000 }] });
  return b;
}
const svgs = tree => nodes(tree).filter(n => n.type === 'svg');
const marks = (tree, type) => nodes(tree).filter(n => n.type === type);

test('BooksProjectionChart renders an <svg> with YTD+projected bars and the three group labels', () => {
  const mods = chartMods();
  const b = chartBook();
  const proj = FL.yearEndProjection(b, { today: '2026-06-30', fiscalYearStart: '01-01' });
  const tree = mods.BooksProjectionChart({ book: b, proj });
  assert.equal(svgs(tree).length, 1, 'the projection chart drew no <svg>');
  assert.ok(marks(tree, 'rect').length >= 3, 'the projection chart drew fewer than one bar per group');
  const t = texts(tree).join(' ');
  for (const label of ['Income', 'Spending', 'Surplus']) assert.ok(t.includes(label), 'missing the "' + label + '" group label (series must be named, not colour-alone)');
  assert.ok(t.includes('At this pace'), 'missing the projection caption');
});

test('BooksMonthlyTrendChart renders an <svg> with TWO series polylines, each labelled', () => {
  const mods = chartMods();
  const b = chartBook();
  const series = FL.monthlyTotals(b, { from: '2026-01-01', to: '2026-12-31' });
  const tree = mods.BooksMonthlyTrendChart({ book: b, series });
  assert.equal(svgs(tree).length, 1, 'the trend chart drew no <svg>');
  assert.equal(marks(tree, 'polyline').length, 2, 'the trend chart must draw exactly two series (income + spending)');
  const t = texts(tree).join(' ');
  assert.ok(t.includes('Income') && t.includes('Spending'), 'the trend series are not both labelled in text');
});

test('BooksBudgetChart renders an <svg>, names the category, and flags an over-budget expense', () => {
  const mods = chartMods();
  const b = chartBook();
  // Utilities budgeted at £50 but £80 actually spent → an over-budget expense row.
  const budget = { year: '2026', lines: [{ account: 'utilities', amount: 5000 }] };
  const rows = FL.budgetVsActual(b, budget, { from: '2026-01-01', to: '2026-12-31' });
  const tree = mods.BooksBudgetChart({ book: b, rows });
  assert.equal(svgs(tree).length, 1, 'the budget chart drew no <svg>');
  const t = texts(tree).join(' ');
  assert.ok(t.includes('Utilities'), 'the budget chart did not name the category');
  assert.ok(t.includes('Over by'), 'the budget chart did not flag the over-budget expense');
});

test('BooksFundBalanceChart renders an <svg> with one polyline per fund, each named', () => {
  const mods = chartMods();
  const b = chartBook();
  const data = FL.monthlyFundBalances(b, { from: '2026-01-01', to: '2026-12-31' });
  const tree = mods.BooksFundBalanceChart({ book: b, data });
  assert.equal(svgs(tree).length, 1, 'the fund chart drew no <svg>');
  assert.equal(marks(tree, 'polyline').length, data.funds.length, 'the fund chart must draw one polyline per fund');
  const t = texts(tree).join(' ');
  for (const f of data.funds) assert.ok(t.includes(f.name) || t.includes(f.name.slice(0, 9)), 'fund "' + f.name + '" is not labelled (colour-alone is not accessible)');
});

test('an empty book draws a placeholder, not a broken <svg>', () => {
  const mods = chartMods();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  const series = FL.monthlyTotals(b, { from: '2026-01-01', to: '2026-12-31' });   // all-zero months
  const tree = mods.BooksMonthlyTrendChart({ book: b, series });
  // A trend over all-zero months still draws (flat lines) — but a book with NO months yields no series → placeholder.
  const bare = mods.BooksMonthlyTrendChart({ book: b, series: [] });
  assert.equal(svgs(bare).length, 0, 'an empty series must fall back to a placeholder, not an <svg>');
  assert.ok(svgs(tree).length <= 1, 'the zero-activity frame must not error');
});
