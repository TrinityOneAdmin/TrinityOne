// MULTI-CURRENCY ENGINE (Phase 8).  Run: node --test scripts/finance-multicurrency.test.mjs
//
// The hard rule this phase rests on: `amount` is ALWAYS base-currency integer minor units, so Σdr==Σcr and
// every projection/invariant is unchanged in base; { currency, origAmount, rate } is a pure annotation the
// engine never sums. A silent-£ book (no annotated posting) must behave EXACTLY as today — the point-of-use
// half (the control is on the screen only when opted in) is finance-multicurrency-ui.test.mjs.
//
// Callers of the changed engine: finance-store (bookToDocs settings flag), finance-statement (foreign CSV
// column, off by default), finance-bundle (re-export → window.FinanceLedger), app/stew-finance.jsx
// (recordEntry / BooksRecord / setMultiCurrencyOn / ensureFx / revalue), and these tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBook, addAccount, post, reverse, applyEntry, check,
  baseAmount, foreignBalances, revalueEntry, FX_ACCT, FX_ACCOUNT, assertFxAccount,
  foreignCashAccount, assertForeignCashAccount, trialBalance,
} from '../src/finance-ledger.mjs';
import { bookToDocs, rebuildBook } from '../src/finance-store.mjs';

const bankBal = (b) => { const r = trialBalance(b).rows.find(x => x.account === 'bank') || { debit: 0, credit: 0 }; return r.debit - r.credit; };

// A church that trades a little in USD: a GBP base, a USD cash account, a couple of income lines, the reserved
// FX account. Base currency GBP; USD postings carry origAmount (US cents) + rate (GBP per USD).
function fxBook({ fx = true } = {}) {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'usd-cash', code: '1050', name: 'USD cash', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'missions', code: '4100', name: 'Missions gifts', type: 'income' });
  if (fx) addAccount(b, { id: FX_ACCT, code: FX_ACCOUNT.code, name: FX_ACCOUNT.name, type: FX_ACCOUNT.type });
  return b;
}

// ── back-compat: a silent-£ book is byte-identical ─────────────────────────────────────────────────────────
test('a no-currency posting normalises to EXACTLY {account,fund,dir,amount} — the trio is omitted, not defaulted', () => {
  const b = fxBook();
  const e = post(b, { postings: [
    { account: 'bank', dir: 'dr', amount: 5000 },
    { account: 'giving', dir: 'cr', amount: 5000 },
  ] });
  const bankP = e.postings.find(p => p.account === 'bank');
  assert.deepEqual(Object.keys(bankP).sort(), ['account', 'amount', 'dir', 'fund'],
    'a plain posting grew extra keys — the silent-£ journal body would no longer be byte-identical');
  assert.equal('currency' in bankP, false);
  assert.equal('origAmount' in bankP, false);
  assert.equal('rate' in bankP, false);
});

test('a silent-£ book serialises with NO multiCurrency flag and NO foreign balances', () => {
  const b = fxBook();
  post(b, { postings: [{ account: 'bank', dir: 'dr', amount: 5000 }, { account: 'giving', dir: 'cr', amount: 5000 }] });
  const settings = bookToDocs(b).find(d => d.t === 'settings');
  assert.equal('multiCurrency' in settings, false, 'a book that never opted in must not carry the flag on its settings doc');
  assert.deepEqual(foreignBalances(b), [], 'a silent-£ book has no foreign balances');
});

test('the multiCurrency flag round-trips when ON and is absent when OFF', () => {
  const on = createBook({ baseCurrency: 'GBP', decimals: 2, multiCurrency: true });
  assert.equal(on.multiCurrency, true);
  const onDoc = bookToDocs(on).find(d => d.t === 'settings');
  assert.equal(onDoc.multiCurrency, true, 'an opted-in book must carry multiCurrency:true');
  assert.equal(rebuildBook(bookToDocs(on)).book.multiCurrency, true, 'the flag was lost on rebuild');

  const off = createBook({ baseCurrency: 'GBP', decimals: 2 });
  assert.equal(off.multiCurrency, false, 'absent flag must read false (silent-£ default)');
  assert.equal(rebuildBook([{ t: 'settings', baseCurrency: 'GBP', decimals: 2 }]).book.multiCurrency, false,
    'an OLD settings doc with no flag must rebuild as not-multiCurrency');
});

// ── the rounding rule ──────────────────────────────────────────────────────────────────────────────────────
test('baseAmount rounds origAmount×rate half-up to integer base minor units', () => {
  assert.equal(baseAmount(5000, 1.08631), 5432);     // 5431.55 → 5432
  assert.equal(baseAmount(10000, 1.08631), 10863);   // 10863.10 → 10863
  assert.equal(baseAmount(10000, 0.79), 7900);
  assert.throws(() => baseAmount(0, 1), /positive integer/);
  assert.throws(() => baseAmount(100, 0), /positive finite/);
  assert.throws(() => baseAmount(100, -1), /positive finite/);
});

test('a 2-posting foreign entry balances in base; the annotation rides only the cash leg', () => {
  const b = fxBook();
  const base = baseAmount(10000, 0.79);   // 7900
  const e = post(b, { memo: 'USD gift', postings: [
    { account: 'usd-cash', dir: 'dr', amount: base, currency: 'USD', origAmount: 10000, rate: 0.79 },
    { account: 'giving', dir: 'cr', amount: base },
  ] });
  assert.equal(check(b).ok, true, check(b).errors.join('; '));
  const cash = e.postings.find(p => p.account === 'usd-cash');
  assert.equal(cash.currency, 'USD'); assert.equal(cash.origAmount, 10000); assert.equal(cash.rate, 0.79);
  assert.equal(cash.amount, 7900, 'the base figure must be round(origAmount×rate)');
  const inc = e.postings.find(p => p.account === 'giving');
  assert.equal('currency' in inc, false, 'the plain category leg must carry no annotation');
});

test('_normalize REJECTS a posting whose base amount ≠ round(origAmount×rate)', () => {
  const b = fxBook();
  assert.throws(() => post(b, { postings: [
    { account: 'usd-cash', dir: 'dr', amount: 7901, currency: 'USD', origAmount: 10000, rate: 0.79 },   // 7901 ≠ 7900
    { account: 'giving', dir: 'cr', amount: 7901 },
  ] }), /round\(origAmount/);
  assert.throws(() => post(b, { postings: [   // currency without a valid origAmount
    { account: 'usd-cash', dir: 'dr', amount: 100, currency: 'USD', rate: 1 },
    { account: 'giving', dir: 'cr', amount: 100 },
  ] }), /positive integer/);
});

test('a >2-posting entry: independent per-leg rounding would unbalance it; routing the residual to the FX line keeps Σdr==Σcr', () => {
  const b = fxBook();
  const rate = 1.08631;
  // 10000 USD received, split across two income lines of 5000 each, deposited to USD cash.
  // Per-leg: round(5000×r)=5432 twice = 10864; per-side cash: round(10000×r)=10863. Residual = 1.
  const legA = baseAmount(5000, rate), legB = baseAmount(5000, rate), cashBase = baseAmount(10000, rate);
  assert.equal(legA + legB, 10864);
  assert.equal(cashBase, 10863);
  // WITHOUT the residual line this does not balance — the engine's balance check protects the ledger (it throws).
  assert.throws(() => post(b, { postings: [
    { account: 'usd-cash', dir: 'dr', amount: cashBase, currency: 'USD', origAmount: 10000, rate },
    { account: 'giving', dir: 'cr', amount: legA, currency: 'USD', origAmount: 5000, rate },
    { account: 'missions', dir: 'cr', amount: legB, currency: 'USD', origAmount: 5000, rate },
  ] }), /does not balance/);
  // WITH the 1-penny residual routed to the FX line (plain base) it balances and check() passes.
  const e = post(b, { memo: 'split USD gift', postings: [
    { account: 'usd-cash', dir: 'dr', amount: cashBase, currency: 'USD', origAmount: 10000, rate },
    { account: FX_ACCT, dir: 'dr', amount: 1 },   // rounding residual, base currency, no annotation
    { account: 'giving', dir: 'cr', amount: legA, currency: 'USD', origAmount: 5000, rate },
    { account: 'missions', dir: 'cr', amount: legB, currency: 'USD', origAmount: 5000, rate },
  ] });
  const dr = e.postings.filter(p => p.dir === 'dr').reduce((s, p) => s + p.amount, 0);
  const cr = e.postings.filter(p => p.dir === 'cr').reduce((s, p) => s + p.amount, 0);
  assert.equal(dr, cr, 'Σdr must equal Σcr after the residual is routed to the FX line');
  assert.equal(check(b).ok, true, check(b).errors.join('; '));
});

// ── foreign balances + revaluation ─────────────────────────────────────────────────────────────────────────
test('foreignBalances reports Σ origAmount and Σ base per (account, currency), debit-positive', () => {
  const b = fxBook();
  post(b, { postings: [{ account: 'usd-cash', dir: 'dr', amount: 7900, currency: 'USD', origAmount: 10000, rate: 0.79 }, { account: 'giving', dir: 'cr', amount: 7900 }] });
  post(b, { postings: [{ account: 'usd-cash', dir: 'dr', amount: 3950, currency: 'USD', origAmount: 5000, rate: 0.79 }, { account: 'giving', dir: 'cr', amount: 3950 }] });
  const fb = foreignBalances(b);
  assert.equal(fb.length, 1);
  assert.deepEqual(fb[0], { account: 'usd-cash', currency: 'USD', origAmount: 15000, base: 11850 });
});

test('revaluation is an append-only entry (reverses:null, new seq) and check() stays ok — a GAIN credits income', () => {
  const b = fxBook();
  post(b, { postings: [{ account: 'usd-cash', dir: 'dr', amount: 7900, currency: 'USD', origAmount: 10000, rate: 0.79 }, { account: 'giving', dir: 'cr', amount: 7900 }] });
  const e = post(b, revalueEntry(b, { account: 'usd-cash', currency: 'USD', newRate: 0.82, date: '2026-06-30' }));
  assert.equal(e.seq, 2, 'the revaluation must be appended, not edit history');
  assert.equal(e.reverses, null, 'a revaluation is not a reversal');
  const cash = e.postings.find(p => p.account === 'usd-cash');
  const fx = e.postings.find(p => p.account === FX_ACCT);
  assert.equal(cash.dir, 'dr'); assert.equal(cash.amount, 300);   // 8200 − 7900
  assert.equal(fx.dir, 'cr'); assert.equal(fx.amount, 300, 'a gain credits the FX income account');
  assert.equal('currency' in cash, false, 'a revaluation leg carries NO annotation — no foreign units moved');
  assert.equal(check(b).ok, true, check(b).errors.join('; '));
  // the base carrying value is revalued; the foreign holding is unchanged
  assert.deepEqual(foreignBalances(b), [{ account: 'usd-cash', currency: 'USD', origAmount: 10000, base: 8200 }]);
});

test('a revaluation LOSS debits the FX income account and still reconciles', () => {
  const b = fxBook();
  post(b, { postings: [{ account: 'usd-cash', dir: 'dr', amount: 7900, currency: 'USD', origAmount: 10000, rate: 0.79 }, { account: 'giving', dir: 'cr', amount: 7900 }] });
  const e = post(b, revalueEntry(b, { account: 'usd-cash', currency: 'USD', newRate: 0.70 }));
  const cash = e.postings.find(p => p.account === 'usd-cash');
  const fx = e.postings.find(p => p.account === FX_ACCT);
  assert.equal(cash.dir, 'cr'); assert.equal(cash.amount, 900);   // 7000 − 7900 = −900
  assert.equal(fx.dir, 'dr'); assert.equal(fx.amount, 900, 'a loss debits the FX income account');
  assert.equal(check(b).ok, true, check(b).errors.join('; '));
});

test('revalueEntry refuses when the FX account is absent or the wrong type, and when there is nothing to revalue', () => {
  const noFx = fxBook({ fx: false });
  post(noFx, { postings: [{ account: 'usd-cash', dir: 'dr', amount: 7900, currency: 'USD', origAmount: 10000, rate: 0.79 }, { account: 'giving', dir: 'cr', amount: 7900 }] });
  assert.equal(assertFxAccount(noFx), false);
  assert.throws(() => revalueEntry(noFx, { account: 'usd-cash', currency: 'USD', newRate: 0.82 }), new RegExp(FX_ACCT));

  const wrong = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(wrong, { id: FX_ACCT, code: '9999', name: 'Clash', type: 'expense' });   // hand-made, wrong type
  assert.throws(() => assertFxAccount(wrong), /must be income/);

  const b = fxBook();
  assert.throws(() => revalueEntry(b, { account: 'usd-cash', currency: 'USD', newRate: 0.82 }), /no foreign balance/);
});

// ── reversal carries the annotation ────────────────────────────────────────────────────────────────────────
test('reversing a foreign entry mirrors the annotation and still balances in base', () => {
  const b = fxBook();
  const e = post(b, { postings: [{ account: 'usd-cash', dir: 'dr', amount: 7900, currency: 'USD', origAmount: 10000, rate: 0.79 }, { account: 'giving', dir: 'cr', amount: 7900 }] });
  const rev = reverse(b, e.seq);
  const cash = rev.postings.find(p => p.account === 'usd-cash');
  assert.equal(cash.dir, 'cr'); assert.equal(cash.currency, 'USD'); assert.equal(cash.origAmount, 10000); assert.equal(cash.rate, 0.79);
  assert.equal(check(b).ok, true, check(b).errors.join('; '));
  assert.deepEqual(foreignBalances(b), [], 'a reversed foreign entry nets the foreign balance back to zero');
});

// ── the whole annotated journal round-trips through the store ──────────────────────────────────────────────
test('an annotated journal survives bookToDocs → rebuildBook unchanged', () => {
  const b = fxBook({ fx: true });
  b.multiCurrency = true;
  post(b, { memo: 'USD gift', postings: [{ account: 'usd-cash', dir: 'dr', amount: 7900, currency: 'USD', origAmount: 10000, rate: 0.79 }, { account: 'giving', dir: 'cr', amount: 7900 }] });
  post(b, revalueEntry(b, { account: 'usd-cash', currency: 'USD', newRate: 0.82 }));
  const r = rebuildBook(bookToDocs(b));
  assert.ok(r.ok, 'rebuild failed: ' + r.errors.join('; '));
  assert.equal(r.book.multiCurrency, true);
  assert.deepEqual(foreignBalances(r.book), foreignBalances(b));
  assert.deepEqual(r.book.journal, b.journal, 'the annotated journal did not round-trip byte-for-byte');
});

// ── the reserved per-currency cash account + the isolation it enforces (AUDIT-P8 #1 fix) ────────────────────
test('foreignCashAccount derives a dedicated per-currency asset id; assertForeignCashAccount pins the type', () => {
  assert.deepEqual({ ...foreignCashAccount('usd') }, { id: 'cash-usd', code: 'USD', name: 'USD cash', type: 'asset', currency: 'USD' });
  assert.equal(foreignCashAccount('EUR').id, 'cash-eur');
  assert.throws(() => foreignCashAccount(''), /needs a currency/);
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  assert.equal(assertForeignCashAccount(b, 'USD'), false);
  addAccount(b, { id: 'cash-usd', code: 'USD', name: 'USD cash', type: 'liability' });   // hand-made, wrong type
  assert.throws(() => assertForeignCashAccount(b, 'USD'), /must be an asset/);
});

// THE BUG THIS FIX EXISTS FOR. If a foreign receipt's cash leg lands on the base `bank` account (£1000 already
// in it), foreignBalances reads the account's WHOLE base balance (107900) as the USD holding's carrying value,
// and revaluing books a ~£997 fake loss that also strips £997 off real bank cash — while check() stays ok. The
// fix is isolation: a foreign receipt goes to a DEDICATED cash-<ccy> account, so base `bank` is never touched.
test('CONTROL — the corruption when a foreign leg shares the base bank account (why isolation is required)', () => {
  const b = fxBook();   // bank (GBP), usd-cash, giving, missions, fx-gains
  post(b, { postings: [{ account: 'bank', dir: 'dr', amount: 100000 }, { account: 'giving', dir: 'cr', amount: 100000 }] });   // £1000 base cash
  post(b, { postings: [{ account: 'bank', dir: 'dr', amount: 7900, currency: 'USD', origAmount: 10000, rate: 0.79 }, { account: 'giving', dir: 'cr', amount: 7900 }] });   // WRONG: foreign on bank
  const row = foreignBalances(b).find(r => r.account === 'bank' && r.currency === 'USD');
  assert.equal(row.base, 107900, 'DEMONSTRATES the trap: the whole bank balance is mistaken for the USD holding');
  // revaluing that polluted balance would knock the fake delta off real bank cash (bank is the SAME account) —
  // this is exactly what the console now makes unreachable by routing foreign cash to cash-<ccy>.
});

test('FIX — a foreign receipt on a DEDICATED per-currency account leaves base bank cash untouched, through revaluation', () => {
  const b = fxBook();
  post(b, { postings: [{ account: 'bank', dir: 'dr', amount: 100000 }, { account: 'giving', dir: 'cr', amount: 100000 }] });   // £1000 base cash
  assert.equal(bankBal(b), 100000);
  const acctId = foreignCashAccount('USD').id;                 // 'cash-usd' — NOT bank
  addAccount(b, { id: acctId, code: 'USD', name: 'USD cash', type: 'asset' });
  post(b, { postings: [{ account: acctId, dir: 'dr', amount: 7900, currency: 'USD', origAmount: 10000, rate: 0.79 }, { account: 'giving', dir: 'cr', amount: 7900 }] });
  assert.equal(bankBal(b), 100000, 'the foreign receipt must not move base bank cash');
  const fb = foreignBalances(b);
  assert.deepEqual(fb, [{ account: 'cash-usd', currency: 'USD', origAmount: 10000, base: 7900 }], 'the holding is the dedicated account only — not polluted by base cash');
  // revalue up: only cash-usd and fx-gains move; bank is never in the entry
  post(b, revalueEntry(b, { account: acctId, currency: 'USD', newRate: 0.82 }));
  assert.equal(bankBal(b), 100000, 'revaluation must NEVER touch base bank cash');
  assert.deepEqual(foreignBalances(b), [{ account: 'cash-usd', currency: 'USD', origAmount: 10000, base: 8200 }]);
  assert.equal(check(b).ok, true, check(b).errors.join('; '));
});
