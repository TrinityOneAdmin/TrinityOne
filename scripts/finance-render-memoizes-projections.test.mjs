// THE FINANCE SCREEN MEMOISES ITS PROJECTIONS AND SKIPS A REDUNDANT REBUILD (perf wave, 2026-11-02).
//   Run: node --test scripts/finance-render-memoizes-projections.test.mjs
//
// Point-of-use (CLAUDE.md rules 1 & 3): every assertion renders the REAL DashFinanceBook through
// scripts/console-screens.mjs and drives it the way the console does — never matches .jsx text. Each test
// wraps the pure window.FinanceLedger fns in CALL COUNTERS and proves:
//   1. an unrelated re-render (opening the "More" tab popover) does NOT re-walk the journal — the render-body
//      projections are memoised; a real book change (a delivered journal entry) DOES recompute them.
//   2. STALENESS GUARD: an optimistic record() (which mutates the book IN PLACE and bumps the counter, leaving
//      the book's object identity unchanged) still updates the on-screen "Income this year" stat — this FAILS
//      if the memo is keyed on `book` identity instead of the bump counter `tick`.
//   3. the Invoices/Bills tabs call the BATCH invoiceStatuses/billStatuses ONCE, not the per-row single-item
//      invoiceStatus/billStatus (the O(rows × journal) fix), and stay flat across an unrelated re-render.
//   4. a SIDE-DOC-only delivery (a new invoice doc) does NOT trigger rebuildBook()+check(); an appended journal
//      doc DOES. (bookDocSignature guard.)
//
// If any memoisation is reverted, the "flat" assertions fail; if the key is changed to `book`, the staleness
// assertion fails; if the batch wiring is reverted, the "single-item not called" assertion fails.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook + the donor panels).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reconcile = await import('../src/finance-reconcile.mjs');
const _reports = await import('../src/finance-reports.mjs');
const _invoice = await import('../src/finance-invoice.mjs');
const _bill = await import('../src/finance-bill.mjs');
const _budget = await import('../src/finance-budget.mjs');
const _charts = await import('../src/finance-charts.mjs');
const _jx = await import('../src/finance-jurisdictions.mjs');
const BASE_FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reconcile, ..._reports, ..._invoice, ..._bill, ..._budget, ..._charts, ..._jx };

const Y = new Date().getFullYear();

// docs → encSubscribe items (id = the d-suffix after 'finance/'), covering the book docs + the side docs we feed.
const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  if (d.t === 'invoice') return { ...d, id: 'invoice:' + d.id };
  if (d.t === 'bill') return { ...d, id: 'bill:' + d.id };
  return d;
});

// A book dated in the CURRENT fiscal year so its income lands in the "Income this year" stat (from = Y-01-01).
function seedBook() {
  const b = BASE_FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  BASE_FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  BASE_FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  BASE_FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  BASE_FL.post(b, { date: Y + '-01-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });
  BASE_FL.post(b, { date: Y + '-01-12', memo: 'gift', postings: [{ account: 'bank', dir: 'dr', amount: 60000 }, { account: 'giving', dir: 'cr', amount: 60000 }] });
  return b;   // income so far = 85000 → £850.00
}

// A spied FinanceLedger: BASE_FL with call counters on the fns the render body / tabs are supposed to memoise.
function spiedFL() {
  const c = { fundBalances: 0, incomeExpenditure: 0, trialBalance: 0, buildStatement: 0, invoiceStatuses: 0, billStatuses: 0, invoiceStatus: 0, billStatus: 0, rebuildBook: 0, givingByMember: 0 };
  const wrap = (name) => (...a) => { c[name]++; return BASE_FL[name](...a); };
  const FL = { ...BASE_FL };
  for (const k of Object.keys(c)) FL[k] = wrap(k);
  return { FL, c, reset: () => Object.keys(c).forEach(k => { c[k] = 0; }) };
}

function setup(FL) {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '', pubkey: 'ff'.repeat(32),
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const node = (name) => all().find(n => typeof n.type === 'function' && n.type.name === name);
  const strip = () => { const s = node('FinTabStrip'); assert.ok(s, 're-anchor: FinTabStrip not rendered'); return s; };
  const goTab = (key) => { strip().props.setTab(key); draw(); };
  const toggleMore = () => { strip().props.setMoreOpen(o => !o); draw(); };   // an UNRELATED re-render (no book / tab change)
  const button = (label) => all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feed = (items) => { assert.ok(encSubCb, 'encSubscribe not wired'); encSubCb(items); draw(); };
  return { fr, draw, all, node, goTab, toggleMore, button, click, feed, get tree() { return tree; } };
}

test('render-body projections do NOT re-walk the journal on an unrelated re-render, but DO when the book changes', () => {
  const { FL, c, reset } = spiedFL();
  const h = setup(FL);
  h.draw();
  h.feed(toItems(FL.bookToDocs(seedBook())));
  reset();                       // baseline AFTER the book is loaded and drawn
  h.toggleMore();                // open the More popover — nothing about the book or tab changed
  assert.equal(c.fundBalances, 0, 'fundBalances re-walked on an unrelated re-render — not memoised');
  assert.equal(c.incomeExpenditure, 0, 'incomeExpenditure re-walked on an unrelated re-render — not memoised');
  assert.equal(c.trialBalance, 0, 'trialBalance re-walked on an unrelated re-render — not memoised');
  assert.equal(c.buildStatement, 0, 'buildStatement (rptModel) rebuilt on an unrelated re-render — not memoised');
  // a real book change (a delivered journal entry) MUST recompute them
  reset();
  const b2 = seedBook();
  BASE_FL.post(b2, { date: Y + '-02-01', memo: 'extra', postings: [{ account: 'bank', dir: 'dr', amount: 1000 }, { account: 'giving', dir: 'cr', amount: 1000 }] });
  h.feed(toItems(FL.bookToDocs(b2)));
  assert.ok(c.fundBalances > 0 && c.incomeExpenditure > 0 && c.trialBalance > 0, 'the projections did not recompute after the book changed — the memo key never advances');
});

test('STALENESS GUARD: an optimistic record() (in-place mutation) updates the Income stat — proves key is `tick`, not `book`', async () => {
  const { FL } = spiedFL();
  const h = setup(FL);
  h.draw();
  h.feed(toItems(FL.bookToDocs(seedBook())));
  assert.ok(texts(h.tree).some(t => t.includes('£850.00')), 're-anchor: the Income-this-year stat (£850.00) is not on screen before the entry');
  h.click('Record a transaction');                      // mount BooksRecord
  const rec = h.node('BooksRecord');
  assert.ok(rec && rec.props.onRecord, 're-anchor: BooksRecord / its onRecord prop not found');
  // Drive the REAL optimistic path (F.post mutates bookRef.current in place, then bump()) — no FX.
  await rec.props.onRecord({ dir: 'in', legs: [{ account: 'giving', fund: 'general', amountMinor: 5000 }], totalMinor: 5000, date: Y + '-03-01', memo: 'spy gift', attachment: null, donor: '', fx: null });
  h.draw();
  assert.ok(texts(h.tree).some(t => t.includes('£900.00')), 'the Income stat did NOT update after an optimistic entry — the memo is keyed on `book` identity (stale), not on `tick`');
  assert.ok(!texts(h.tree).some(t => t.includes('£850.00')), 'the stale £850.00 is still showing after the entry');
});

test('Invoices tab: the BATCH invoiceStatuses runs (once), the per-row invoiceStatus does NOT, and it stays flat on an unrelated re-render', () => {
  const { FL, c, reset } = spiedFL();
  const h = setup(FL);
  h.draw();
  // a book with the reserved AR account + one ISSUED invoice (so a status badge renders)
  const b = seedBook();
  BASE_FL.addAccount(b, { id: _invoice.AR_ACCT, code: _invoice.AR_ACCOUNT.code, name: _invoice.AR_ACCOUNT.name, type: 'asset' });
  const inv = { id: 'inv1', number: '2026-1', contact: 'Scouts', issued: Y + '-02-01', due: Y + '-02-28', lines: [{ desc: 'Hall', account: 'giving', fund: 'general', amount: 4000 }] };
  BASE_FL.post(b, BASE_FL.invoiceIssueEntry(inv));
  const items = toItems(FL.bookToDocs(b)).concat(toItems([{ t: 'invoice', ...inv }]));
  h.feed(items);
  h.goTab('invoices');
  assert.ok(texts(h.tree).join(' ').includes('Invoice'), 're-anchor: the invoices list did not render');
  reset();
  h.toggleMore();                // unrelated re-render while on the invoices tab
  assert.equal(c.invoiceStatuses, 0, 'invoiceStatuses re-ran on an unrelated re-render — the map is not memoised');
  assert.equal(c.invoiceStatus, 0, 'the per-row invoiceStatus was called — the batch wiring was reverted');
  // a book change recomputes the batch map (and still never the per-row fn)
  reset();
  const b2 = seedBook();
  BASE_FL.post(b2, { date: Y + '-02-02', memo: 'x', postings: [{ account: 'bank', dir: 'dr', amount: 100 }, { account: 'giving', dir: 'cr', amount: 100 }] });
  h.feed(toItems(FL.bookToDocs(b2)).concat(toItems([{ t: 'invoice', ...inv }])));
  assert.ok(c.invoiceStatuses > 0, 'invoiceStatuses did not recompute after a book change');
  assert.equal(c.invoiceStatus, 0, 'the per-row invoiceStatus must never be called from the render — the batch map is the source');
});

test('Bills tab: the BATCH billStatuses runs, the per-row billStatus does NOT, and it stays flat on an unrelated re-render', () => {
  const { FL, c, reset } = spiedFL();
  const h = setup(FL);
  h.draw();
  const b = seedBook();
  BASE_FL.addAccount(b, { id: _bill.AP_ACCT, code: _bill.AP_ACCOUNT.code, name: _bill.AP_ACCOUNT.name, type: _bill.AP_ACCOUNT.type });
  const bill = { id: 'b1', number: 'INV-9', supplier: 'Gas', received: Y + '-02-01', due: Y + '-02-28', lines: [{ desc: 'Gas', account: 'utilities', fund: 'general', amount: 3000 }] };
  BASE_FL.post(b, BASE_FL.billReceiveEntry(bill));
  const items = toItems(FL.bookToDocs(b)).concat(toItems([{ t: 'bill', ...bill }]));
  h.feed(items);
  h.goTab('bills');
  assert.ok(texts(h.tree).join(' ').includes('Bill'), 're-anchor: the bills list did not render');
  reset();
  h.toggleMore();
  assert.equal(c.billStatuses, 0, 'billStatuses re-ran on an unrelated re-render — the map is not memoised');
  assert.equal(c.billStatus, 0, 'the per-row billStatus was called — the batch wiring was reverted');
});

test('a side-doc-only delivery (new invoice doc) does NOT rebuild the book; an appended journal doc DOES', () => {
  const { FL, c, reset } = spiedFL();
  const h = setup(FL);
  h.draw();
  const b = seedBook();
  const bookItems = toItems(FL.bookToDocs(b));
  h.feed(bookItems);                                  // first delivery → one rebuild
  assert.equal(c.rebuildBook, 1, 'the first delivery should rebuild exactly once');
  // deliver the SAME book docs plus a NEW invoice SIDE doc → book unchanged → NO rebuild
  const invItems = bookItems.concat(toItems([{ t: 'invoice', id: 'inv1', number: '1', contact: 'X', issued: Y + '-02-01', due: Y + '-03-01', lines: [{ desc: 'Hall', account: 'giving', fund: 'general', amount: 4000 }] }]));
  h.feed(invItems);
  assert.equal(c.rebuildBook, 1, 'a side-doc-only delivery wrongly re-ran rebuildBook()+check() — the signature guard is not working');
  // the new invoice must still reach its own state (the side-doc setters still ran): the Invoices tab shows it
  h.goTab('invoices');
  assert.ok(texts(h.tree).join(' ').includes('Invoice'), 'the new invoice side doc did not reach the screen on the skipped delivery');
  // now append a JOURNAL doc → the book changed → rebuild MUST run again
  reset();
  const b2 = seedBook();
  BASE_FL.post(b2, { date: Y + '-02-05', memo: 'new', postings: [{ account: 'bank', dir: 'dr', amount: 700 }, { account: 'giving', dir: 'cr', amount: 700 }] });
  h.feed(toItems(FL.bookToDocs(b2)).concat(invItems.filter(it => String(it.id).startsWith('invoice:'))));
  assert.equal(c.rebuildBook, 1, 'an appended journal entry must rebuild the book exactly once (the signature changed)');
});
