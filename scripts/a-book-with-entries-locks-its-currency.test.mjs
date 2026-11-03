// A BOOK WITH ENTRIES LOCKS ITS CURRENCY (and decimals) — the Book-settings picker on Accounts & funds.
//   Run: node --test scripts/a-book-with-entries-locks-its-currency.test.mjs
//
// THE FEATURE (wave #1 of the finance-jurisdiction stack). A "Book settings" card at the top of the
// Accounts & funds tab lets a treasurer set base currency, decimal places and the financial-year start.
// It writes the REPLACEABLE finance/settings doc via saveBookSettings — the same encPublish path as the
// Phase-8 multi-currency toggle, no new relay doc kind.
//
// THE RISK IT GUARDS. Money is stored as INTEGER minor units of the BASE currency, so changing baseCurrency
// or decimals after a journal entry exists would silently reinterpret every stored figure. So once
// book.journal.length > 0 the currency + decimals controls LOCK (render disabled, with a 🔒 note); the
// financial-year start never reinterprets an amount and stays editable always.
//
// POINT OF USE (rule 1): these tests MOUNT DashFinanceBook and assert on the RENDERED tree (rule 3 — never a
// text match in app/*.jsx). They fail if the Book-settings card, the lock, or the formatter fix is deleted
// from the screen — not merely if an engine behind them breaks.
//
// Callers of shared code exercised here: DashFinanceBook's saveBookSettings + Book-settings card
// (app/stew-finance.jsx), the finance/settings encPublish path, and fmtMoney (src/finance-statement.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

// ── helpers shared by the mount tests ──────────────────────────────────────────────────────────────────
async function mountBook() {
  const { React, reset, flush, fresh, unmount } = fakeReact();
  let encSubCb = null;
  const pubs = [];
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (prefix, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async (d, body) => { pubs.push({ d, body }); return true; },
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  // The real console loads the WHOLE finance bundle as window.FinanceLedger — mirror it (same as the
  // gapped-book test), so the reports render path (F.yearRange etc.) resolves.
  const _bundle = await import('../src/finance-bundle.mjs');
  window.FinanceLedger = { ..._bundle };
  const mods = loadConsole({ React, window, expr: '{ DashFinanceBook }' });

  let tree;
  const draw = () => { reset(); tree = mods.DashFinanceBook(); flush(); return tree; };
  const all = () => nodes(tree);
  const goTab = (key) => { const s = all().find(n => typeof n.type === 'function' && n.type.name === 'FinTabStrip'); if (!s) throw new Error('re-anchor: FinTabStrip not rendered'); s.props.setTab(key); draw(); };
  const selectByLabel = (label) => all().find(n => n.type === 'select' && n.props && n.props['aria-label'] === label);
  const button = (label) => all().find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(label)));
  const hasText = (t) => all().some(n => (n.kids || []).some(k => typeof k === 'string' && k.includes(t)));
  return { window, draw, all, selectByLabel, button, goTab, hasText, unmount, pubs, encSubCb: () => encSubCb };
}

// Build the docs for a book that already has ONE journal entry, shaped exactly as encSubscribe delivers them
// (the gapped-book test's mapping): settings/account/fund/journal each carry an `id`.
function entriesDelivery(F) {
  const b = F.createBook({ baseCurrency: 'GBP', decimals: 2 });
  F.addAccount(b, { id: 'bank:main', code: '1000', name: 'Main', type: 'asset' });
  F.addAccount(b, { id: 'income:giving', code: '4000', name: 'Giving', type: 'income' });
  F.post(b, { date: '2026-01-01', memo: 'Entry one', postings: [{ account: 'bank:main', dir: 'dr', amount: 500 }, { account: 'income:giving', dir: 'cr', amount: 500 }] });
  // Shape each doc as encSubscribe delivers it: `id` is the d-tag suffix after 'finance/'. The prefix MUST be
  // set AFTER the spread — bookToDocs already carries d.id for accounts/funds, and spreading it last would
  // overwrite the prefixed id so finItemToDoc drops the account (then the journal rebuild errors and no clean
  // book is produced — which is exactly the lock predicate silently failing).
  return F.bookToDocs(b).map(d => {
    if (d.t === 'settings') return { ...d, id: 'settings' };
    if (d.t === 'account') return { ...d, id: 'account:' + d.id };
    if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
    if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
    return d;
  });
}

test('CONTROL: createBook round-trips a non-GBP, non-2dp book through the doc store', async () => {
  const { createBook, addAccount, post } = await import('../src/finance-ledger.mjs');
  const { bookToDocs, rebuildBook } = await import('../src/finance-store.mjs');
  const b = createBook({ baseCurrency: 'USD', decimals: 0, fiscalYearStart: '04-01' });
  addAccount(b, { id: 'bank:main', code: '1000', name: 'Main', type: 'asset' });
  addAccount(b, { id: 'income:giving', code: '4000', name: 'Giving', type: 'income' });
  post(b, { date: '2026-01-01', memo: 'A', postings: [{ account: 'bank:main', dir: 'dr', amount: 100 }, { account: 'income:giving', dir: 'cr', amount: 100 }] });
  const r = rebuildBook(bookToDocs(b));
  assert.ok(r.book, 'rebuild produced no book');
  assert.equal(r.book.baseCurrency, 'USD');
  assert.equal(r.book.decimals, 0);
  assert.equal(r.book.fiscalYearStart, '04-01');
});

test('POINT OF USE: the Book-settings picker is on Accounts & funds and writes currency/decimals/fiscal-year', async () => {
  const m = await mountBook();
  m.draw();                                  // tab defaults to 'transactions'
  m.goTab('accounts');

  const ccy = m.selectByLabel('Base currency');
  const dec = m.selectByLabel('Decimal places');
  const fy = m.selectByLabel('Financial year start month');
  assert.ok(ccy, 'THE BOOK-SETTINGS CARD IS GONE — no Base currency control on Accounts & funds');
  assert.ok(dec, 'no Decimal places control on Accounts & funds');
  assert.ok(fy, 'no Financial year start control on Accounts & funds');

  // Each control writes the finance/settings doc through saveBookSettings.
  ccy.props.onChange({ target: { value: 'USD' } });
  dec.props.onChange({ target: { value: '0' } });
  fy.props.onChange({ target: { value: '04' } });

  const settings = m.pubs.filter(p => p.d === 'finance/settings');
  assert.ok(settings.length >= 3, 'the picker did not publish finance/settings for each change');
  assert.equal(settings.find(p => p.body.baseCurrency === 'USD') !== undefined, true, 'currency change was not persisted as USD');
  assert.equal(settings.some(p => p.body.decimals === 0), true, 'decimals change was not persisted as 0');
  assert.equal(settings.some(p => p.body.fiscalYearStart === '04-01'), true, 'fiscal-year start was not persisted as 04-01');
  m.unmount();
});

test('POINT OF USE: once the book has an entry, currency + decimals lock (with a 🔒 note); fiscal-year stays editable', async () => {
  const m = await mountBook();
  m.draw();
  m.goTab('accounts');

  const F = m.window.FinanceLedger;
  assert.ok(m.encSubCb(), 'encSubscribe was not called');
  m.encSubCb()(entriesDelivery(F));          // deliver a book that already has one journal entry
  m.draw();

  const ccy = m.selectByLabel('Base currency');
  const dec = m.selectByLabel('Decimal places');
  const fy = m.selectByLabel('Financial year start month');
  assert.ok(ccy && dec && fy, 're-anchor: Book-settings controls missing after an entries delivery');
  assert.equal(ccy.props.disabled, true,
    'CURRENCY IS NOT LOCKED ON A BOOK WITH ENTRIES — changing it would silently re-denominate every stored figure');
  assert.equal(dec.props.disabled, true,
    'DECIMAL PLACES ARE NOT LOCKED ON A BOOK WITH ENTRIES — changing them would silently re-scale every stored figure');
  assert.ok(!fy.props.disabled, 'the financial-year start must stay editable — it never reinterprets a stored amount');
  assert.ok(m.hasText('already has transactions'),
    'NO LOCK EXPLANATION IS SHOWN — the treasurer sees greyed controls with no reason and no way forward');
  m.unmount();
});

test('POINT OF USE: an empty book leaves currency + decimals editable (not over-locked)', async () => {
  const m = await mountBook();
  m.draw();
  m.goTab('accounts');
  const ccy = m.selectByLabel('Base currency');
  const dec = m.selectByLabel('Decimal places');
  assert.ok(ccy && dec, 're-anchor: Book-settings controls missing on an empty book');
  assert.ok(!ccy.props.disabled, 'currency must be editable on an empty book (nothing to reinterpret yet)');
  assert.ok(!dec.props.disabled, 'decimals must be editable on an empty book');
  assert.ok(!m.hasText('already has transactions'), 'the lock note must not show on an empty book');
  m.unmount();
});

test('fmtMoney shows an unknown currency as its CODE, not a bare number (the formatter fix)', async () => {
  const { fmtMoney } = await import('../src/finance-statement.mjs');
  // The fix: `SYM[currency] || ''` → `|| currency`. A currency outside the built-in four now prints its code.
  assert.equal(fmtMoney(100000, 'NGN', 2), 'NGN1,000.00', 'an unknown currency must show its code, not a bare number');
  // The built-in four are unchanged (fixtures that rely on them must stay green).
  assert.equal(fmtMoney(100000, 'GBP', 2), '£1,000.00');
  assert.equal(fmtMoney(100000, 'USD', 2), '$1,000.00');
  assert.equal(fmtMoney(100000, 'EUR', 2), '€1,000.00');
  assert.equal(fmtMoney(100000, 'sats', 0), '100,000 ⚡');
});
