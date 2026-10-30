// THE MULTI-CURRENCY CONTROLS ARE ACTUALLY ON THE SCREEN — OFF BY DEFAULT — AND A FOREIGN ENTRY NEVER TOUCHES
// BASE CASH (Phase 8, point-of-use; CLAUDE.md rules 1 & 3).  Run: node --test scripts/finance-multicurrency-ui.test.mjs
//
// Every assertion renders the REAL BooksRecord / DashFinanceBook through console-screens.mjs (the console
// compiled the way the phone loads it) and reads the RENDERED TREE — never the .jsx text. It proves:
//   • the currency + rate fields appear on the Record form ONLY when multiCurrency is on, ABSENT by default;
//   • the form offers NO base-cash picker for a foreign entry (the account is derived from the currency), so a
//     foreign leg can never be aimed at the base `bank` — the AUDIT-P8 #1 corruption;
//   • the opt-in switch under Accounts & funds, off by default;
//   • END-TO-END: a foreign gift typed into the real form and run through the real recordEntry lands on a
//     DEDICATED cash-<ccy> account, leaves base bank cash UNCHANGED, reports the right foreignBalances, and a
//     revaluation still never moves base cash. This is the wiring whose absence let finding 1 slip.
// The engine half is finance-multicurrency.test.mjs.
//
// Callers of the sliced code: app/stew-finance.jsx (BooksRecord, DashFinanceBook, setMultiCurrencyOn,
// ensureForeignCash, recordEntry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reconcile = await import('../src/finance-reconcile.mjs');
const _reports = await import('../src/finance-reports.mjs');
const _invoice = await import('../src/finance-invoice.mjs');
const _budget = await import('../src/finance-budget.mjs');
const _bill = await import('../src/finance-bill.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reconcile, ..._reports, ..._invoice, ..._budget, ..._bill };
const SRC = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');

function mcBook(on) {
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2, multiCurrency: on });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  return b;
}

function drawRecord(book) {
  const fr = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward({ actingChurch: '' }) });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ BooksRecord }' });
  const props = { book, donors: [], onRecord() {}, onClose() {}, initial: { dir: 'in' } };
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.BooksRecord(props); fr.flush(); return tree; };
  return { draw, tree: () => tree };
}
const byAria = (tree, label) => nodes(tree).filter(n => n.props && n.props['aria-label'] === label);

test('with multiCurrency ON, the Record form offers a currency + an exchange rate — and NO base-cash picker', () => {
  const h = drawRecord(mcBook(true));
  const tree = h.draw();
  assert.ok(nodes(tree).some(n => n.props && n.props.role === 'dialog'), 'the Record form did not render a dialog');
  assert.equal(byAria(tree, 'Currency').length, 1, 'the Currency field is not on the screen when multiCurrency is on');
  assert.equal(byAria(tree, 'Exchange rate').length, 1, 'the Exchange-rate field is not on the screen when multiCurrency is on');
  assert.equal(byAria(tree, 'Cash or bank account').length, 0, 'there must be NO cash picker — a foreign entry must not be directable at the base bank (AUDIT-P8 #1)');
  // and `bank` is not offered as a selectable foreign cash target anywhere on the form
  const optTexts = nodes(tree).filter(n => n.type === 'option').map(o => texts(o).join(''));
  assert.ok(!optTexts.includes('Bank'), 'the base Bank account must not be offered as a foreign cash option');
  assert.equal(byAria(tree, 'Amount').length, 1, 'the amount field should still be present');
});

test('by DEFAULT (multiCurrency OFF) the currency + rate fields are ABSENT — a silent-£ Record form', () => {
  const h = drawRecord(mcBook(false));
  const tree = h.draw();
  assert.ok(nodes(tree).some(n => n.props && n.props.role === 'dialog'), 'the Record form did not render a dialog');
  assert.equal(byAria(tree, 'Currency').length, 0, 'the Currency field must NOT be on a default silent-£ Record form');
  assert.equal(byAria(tree, 'Exchange rate').length, 0, 'the Exchange-rate field must NOT be on a default silent-£ Record form');
  assert.equal(byAria(tree, 'Amount').length, 1, 'the ordinary amount field is still present');
});

// ── END-TO-END: the real form → the real recordEntry → a dedicated account, base bank untouched ─────────────
// Lift the REAL ensureForeignCash + recordEntry (not stubs) so this exercises the exact routing that finding 1
// got wrong. record() is referenced but not called on the foreign path, so a stub suffices for it.
function liftRecordEntry(book, published) {
  const body = fnBody(SRC, 'const ensureForeignCash = async (currency) => {', 'ensureForeignCash')
    + '\n' + fnBody(SRC, 'const recordEntry = async ({ dir, legs, totalMinor, date, memo, attachment, donor, fx }) => {', 'recordEntry')
    + '\nreturn recordEntry;';
  const scope = {
    record: async () => true,
    bookRef: { current: book },
    F: FL,
    useRelay: true,                                    // exercise the real publish-if-absent for cash-<ccy>
    S: { encPublish: async (d, b2) => { published.push({ d, body: b2 }); return true; } },
    pubAttachment: async () => true,
    pubEntry: async () => true,                        // F.post already applied the entry to `book`
    _dropIfRefused: () => {},
    bump: () => {},
    window: { dispatchEvent: () => true },
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
  };
  return new Function(...Object.keys(scope), body)(...Object.values(scope));
}

test('END-TO-END: a foreign gift typed into the form routes to a dedicated cash-<ccy> account and leaves base bank cash untouched, through revaluation', async () => {
  // A church with £1000 real GBP in the bank.
  const book = mcBook(true);
  FL.addAccount(book, { id: FL.FX_ACCT, code: FL.FX_ACCOUNT.code, name: FL.FX_ACCOUNT.name, type: FL.FX_ACCOUNT.type });
  FL.post(book, { postings: [{ account: 'bank', dir: 'dr', amount: 100000 }, { account: 'giving', dir: 'cr', amount: 100000 }] });
  const bankBal = () => { const r = FL.trialBalance(book).rows.find(x => x.account === 'bank'); return r.debit - r.credit; };
  assert.equal(bankBal(), 100000);

  // Render the REAL Record form, type a $100 gift at 0.79, and press Record — capturing the payload the form emits.
  const fr = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward({ actingChurch: '' }) });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ BooksRecord }' });
  let payload = null;
  const props = { book, donors: [], onRecord: (p) => { payload = p; }, onClose() {}, initial: { dir: 'in' } };
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.BooksRecord(props); fr.flush(); return tree; };
  const setField = (label, value) => { const n = byAria(draw(), label)[0]; assert.ok(n, 're-anchor: no field "' + label + '"'); n.props.onChange({ target: { value } }); };
  setField('Currency', 'USD');
  setField('Exchange rate', '0.79');
  setField('Amount', '100.00');
  const rec = nodes(draw()).find(n => n.type === 'button' && /Record money/.test(texts(n).join(' ')));
  assert.ok(rec && !rec.props.disabled, 'the Record button is not enabled for a valid foreign entry');
  rec.props.onClick({ stopPropagation() {}, preventDefault() {} });

  assert.ok(payload && payload.fx, 'the form did not emit a foreign (fx) payload');
  // field-by-field, not deepEqual: payload.fx is built in the vm realm, so its prototype differs (see console-screens.mjs).
  assert.equal(payload.fx.currency, 'USD', 'the fx currency is wrong');
  assert.equal(payload.fx.origAmount, 10000, 'the fx origAmount (foreign minor units) is wrong');
  assert.equal(payload.fx.rate, 0.79, 'the fx rate is wrong');
  assert.ok(!('cashAccount' in payload.fx), 'the form must NOT name a cash account — recordEntry derives it from the currency');

  // Run the payload through the REAL recordEntry.
  const published = [];
  const recordEntry = liftRecordEntry(book, published);
  const ok = await recordEntry(payload);
  assert.equal(ok, true, 'recordEntry did not report success');

  // The cash leg landed on the dedicated cash-usd account — NEVER bank.
  const entry = book.journal[book.journal.length - 1];
  const cash = entry.postings.find(p => p.currency === 'USD');
  assert.equal(cash.account, 'cash-usd', 'the foreign cash leg must land on the dedicated per-currency account');
  assert.equal(cash.amount, 7900);
  assert.ok(!entry.postings.some(p => p.account === 'bank'), 'a foreign entry must NOT post to the base bank account');
  assert.ok(published.some(p => p.d === 'finance/account:cash-usd'), 'the dedicated account was not published-if-absent');

  // Base bank cash is untouched; the foreign holding is reported against its own account.
  assert.equal(bankBal(), 100000, 'recording a foreign gift must not move base bank cash');
  assert.deepEqual(FL.foreignBalances(book), [{ account: 'cash-usd', currency: 'USD', origAmount: 10000, base: 7900 }]);

  // Revalue the holding up — base bank cash is STILL untouched (the revaluation only moves cash-usd vs fx-gains).
  FL.post(book, FL.revalueEntry(book, { account: 'cash-usd', currency: 'USD', newRate: 0.82 }));
  assert.equal(bankBal(), 100000, 'a revaluation must NEVER touch base bank cash');
  assert.deepEqual(FL.foreignBalances(book), [{ account: 'cash-usd', currency: 'USD', origAmount: 10000, base: 8200 }]);
  assert.equal(FL.check(book).ok, true, FL.check(book).errors.join('; '));
});

// ── the opt-in SWITCH is on the screen, under Accounts & funds, and OFF by default ──────────────────────────
function openManaging({ multiCurrency = undefined } = {}) {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  draw();
  const docs = [
    { t: 'settings', baseCurrency: 'GBP', decimals: 2, fiscalYearStart: '01-01', ...(multiCurrency ? { multiCurrency: true } : {}), id: 'settings' },
    { t: 'account', id: 'account:bank', code: '1000', name: 'Bank', type: 'asset' },
    { t: 'account', id: 'account:giving', code: '4000', name: 'Giving', type: 'income' },
  ];
  encSubCb(docs); draw();
  const button = (label) => nodes(tree).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  button('Accounts & funds').props.onClick({ stopPropagation() {}, preventDefault() {} }); draw();
  return { tree: () => tree };
}

test('Accounts & funds carries a "Record transactions in other currencies" switch, UNCHECKED by default', () => {
  const h = openManaging({});
  const box = byAria(h.tree(), 'Record transactions in other currencies');
  assert.equal(box.length, 1, 'the multiCurrency opt-in switch is not on the screen');
  assert.equal(box[0].type, 'input');
  assert.equal(!!box[0].props.checked, false, 'the switch must default to OFF (silent-£, opt-in)');
});

test('with the church opted in, the switch reads CHECKED (the control is driven by the finance/settings flag)', () => {
  const h = openManaging({ multiCurrency: true });
  const box = byAria(h.tree(), 'Record transactions in other currencies');
  assert.equal(box.length, 1);
  assert.equal(!!box[0].props.checked, true, 'an opted-in church must show the switch on');
});
