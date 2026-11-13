// THE RECONCILE VIEW AND THE RECURRING-PAYMENTS CONTROLS ARE ACTUALLY ON THE SCREEN.
//   Run: node --test scripts/the-reconcile-view-and-recurring-are-on-screen.test.mjs
//
// CLAUDE.md rules 1 & 3 (point-of-use). Each assertion renders the REAL DashFinanceBook / FinanceReconcile
// through scripts/console-screens.mjs (the whole console compiled the way the phone loads it) and reads the
// RENDERED TREE — never the .jsx text, so a `false &&` in front of a control cannot satisfy it. Delete the
// control from the screen and the test fails.
//
// Covers (AUDIT-PHASE-3): the reconcile view renders its Matched / Unmatched sections; the statement
// closing-balance-check RESULT renders (deliverable 3 is user-facing, not engine-only); and a template's
// "Post this month" control is on the Recurring-payments panel.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook + FinanceReconcile + BooksTemplateEdit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reconcile = await import('../src/finance-reconcile.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reconcile };

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  return d;
});

function setup() {
  const fr = fakeReact();
  const pub = [];
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async (d, body) => { pub.push({ d, body }); return true; },
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, FinanceReconcile }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const button = (label) => all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  return { fr, pub, mods, draw, all, button, click, feedItems, get tree() { return tree; } };
}

function seedBook() {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'rent', code: '5000', name: 'Rent', type: 'expense' });
  return b;
}

test('the Finance screen offers a Reconcile control, and it opens the reconcile view', () => {
  const h = setup();
  h.draw();
  // 431d9368 added the book preloader: until encSubscribe has delivered once, the Finance page is only a
  // spinner. Deliver a book first, as the Recurring test below does.
  h.feedItems(toItems(FL.bookToDocs(seedBook())));
  assert.ok(h.button('Reconcile'), 'NO "Reconcile" control on the Finance screen');
  const isReconcile = (n) => n && (n.type === h.mods.FinanceReconcile || (n.type && n.type.name === 'FinanceReconcile'));
  assert.ok(!h.all().some(isReconcile), 'CONTROL: the reconcile view was already open before Reconcile was pressed');
  h.click('Reconcile');
  assert.ok(h.all().some(isReconcile), 'pressing Reconcile did not open the reconcile view (no FinanceReconcile in the tree)');
});

test('the Recurring-payments panel shows a template with a "Post this month" control', () => {
  const h = setup();
  h.draw();
  const b = seedBook();
  const items = [...toItems(FL.bookToDocs(b)),
    { id: 'template:t1', name: 'Rent', account: 'rent', fund: 'general', dir: 'out', amount: 50000, dayOfMonth: 15 }];
  h.feedItems(items);
  h.click('Recurring payments');   // open the collapsible panel
  assert.ok(texts(h.tree).join(' ').includes('Rent'), 're-anchor: the template name is not on the panel');
  assert.ok(h.button('Post this month'),
    'NO "Post this month" control for the recurring template — the feature is not reachable from the screen');
});

test('the reconcile view renders Matched and Unmatched sections over the ledger', () => {
  const h = setup();
  const b = seedBook();
  // one ledger entry that a statement line will match, so the Matched section is non-empty
  FL.post(b, { date: '2026-03-01', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });
  const lines = [
    { date: '2026-03-02', description: 'OFFERING', amountMinor: 10000, dir: 'in', key: '2026-03-02|10000|offering' },
    { date: '2026-03-10', description: 'MYSTERY', amountMinor: 4200, dir: 'out', key: '2026-03-10|-4200|mystery' },
  ];
  h.fr.reset();
  const tree = h.mods.FinanceReconcile({ book: b, F: FL, today: '2026-03-31', saved: { id: 'r1', lines, reconciled: [], closing: null, asOf: '2026-03-31' }, onSaveReconcile() {}, onClose() {} });
  h.fr.flush();
  const joined = texts(tree).join(' ');
  assert.ok(/Matched \(\s*1\s*\)/.test(joined), 'the Matched section (count 1) did not render. Screen: ' + joined);
  assert.ok(/Unmatched \(\s*\d+\s*\)/.test(joined), 'the Unmatched section did not render. Screen: ' + joined);
  assert.ok(joined.includes('MYSTERY'), 'the genuinely-unmatched statement line is not shown');
});

test('the statement closing-balance-check RESULT renders (agrees / off-by), not just the engine', () => {
  const h = setup();
  const b = seedBook();
  FL.post(b, { date: '2026-03-01', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });

  // (1) a closing balance that agrees renders the "Agrees" result
  h.fr.reset();
  let tree = h.mods.FinanceReconcile({ book: b, F: FL, today: '2026-03-31', saved: { id: 'r1', lines: [{ date: '2026-03-02', description: 'X', amountMinor: 10000, dir: 'in', key: 'k' }], reconciled: [], closing: 10000, asOf: '2026-03-31' }, onSaveReconcile() {}, onClose() {} });
  h.fr.flush();
  assert.ok(texts(tree).join(' ').includes('Agrees'),
    'the balance-check RESULT did not render for an agreeing balance — the check is engine-only on the screen');

  // (2) a wrong closing balance renders the disagreement + the gap
  h.fr.fresh();
  tree = h.mods.FinanceReconcile({ book: b, F: FL, today: '2026-03-31', saved: { id: 'r1', lines: [{ date: '2026-03-02', description: 'X', amountMinor: 10000, dir: 'in', key: 'k' }], reconciled: [], closing: 9500, asOf: '2026-03-31' }, onSaveReconcile() {}, onClose() {} });
  h.fr.flush();
  const joined = texts(tree).join(' ');
  assert.ok(joined.includes('Does not agree'), 'a wrong closing balance did not render a disagreement');
  assert.ok(joined.includes('5.00'), 'the £5.00 gap (10000 vs 9500 minor) is not shown to the treasurer');
});
