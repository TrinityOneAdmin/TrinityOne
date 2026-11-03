// THE BANK-RECONCILIATION + RECURRING-TEMPLATE ENGINE (src/finance-reconcile.mjs).
//   Run: node --test scripts/finance-reconcile.test.mjs
//
// Pure module, so these are plain node tests over the real functions — the point-of-use tests that the
// screen actually USES them are in the-reconcile-view-and-recurring-are-on-screen.test.mjs (CLAUDE.md rule 1).
//
// Covers the AUDIT-PHASE-3 fixes:
//   · statementBalanceCheck computes its OWN date-bounded, SINGLE-account balance — proven with a SECOND
//     asset account present, so a right answer cannot come from an aggregate (balanceSheet) read (finding 1).
//   · templates post a BALANCED two-posting entry with a deterministic importKey, and posting the same
//     template-month twice is refused (finding 2).
//   · match() keys on the BANK-SIDE posting and respects the ±windowDays window (finding 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBook, addAccount, post, importedKeys } from '../src/finance-ledger.mjs';
import { match, statementBalanceCheck, templateEntry, templatePost, templateImportKey } from '../src/finance-reconcile.mjs';

function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'cash', code: '1010', name: 'Petty cash', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'rent', code: '5000', name: 'Rent', type: 'expense' });
  return b;
}
const line = (date, amountMinor, dir, description, key) => ({ date, amountMinor, dir, description, key: key || (date + '|' + (dir === 'in' ? amountMinor : -amountMinor) + '|' + description) });

// ── match ────────────────────────────────────────────────────────────────────────────────────────────────
test('auto-match pairs a line with the entry whose BANK leg agrees within the window; genuine misses stay unmatched', () => {
  const b = book();
  const A = post(b, { date: '2026-03-01', memo: 'gift', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });  // money in
  const B = post(b, { date: '2026-03-04', memo: 'rent', postings: [{ account: 'rent', fund: 'general', dir: 'dr', amount: 5000 }, { account: 'bank', dir: 'cr', amount: 5000 }] });        // money out
  const lines = [
    line('2026-03-02', 10000, 'in', 'OFFERING'),   // 1 day from A → matches
    line('2026-03-20', 5000, 'out', 'RENT'),        // 16 days from B → outside ±3 → no match
  ];
  const r = match(lines, b.journal, { windowDays: 3 });
  assert.equal(r.matched.length, 1, 'exactly one line should auto-match');
  assert.equal(r.matched[0].entry.seq, A.seq, 'the in-line matched the wrong entry');
  assert.equal(r.unmatchedLines.length, 1, 'the far line should be left unmatched');
  assert.equal(r.unmatchedLines[0].description, 'RENT');
  assert.ok(r.unmatchedEntries.some(e => e.seq === B.seq), 'entry B touches the bank and had no matching line — it must be an unmatched ENTRY');
});

test('match keys on the bank leg: a wrong amount or wrong direction does not match', () => {
  const b = book();
  post(b, { date: '2026-03-01', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });
  const r = match([line('2026-03-01', 10000, 'out', 'X'), line('2026-03-01', 9999, 'in', 'Y')], b.journal, { windowDays: 3 });
  assert.equal(r.matched.length, 0, 'neither a direction-flip nor a penny-off line should match');
});

test('an entry with a matching importKey is matched by KEY regardless of date distance', () => {
  const b = book();
  const C = post(b, { date: '2026-01-01', importKey: '2026-03-02|10000|offering', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });
  const r = match([line('2026-03-02', 10000, 'in', 'offering', '2026-03-02|10000|offering')], b.journal, { windowDays: 3 });
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].by, 'key', 'the link should be by importKey, not by amount/date');
  assert.equal(r.matched[0].entry.seq, C.seq);
});

// ── statementBalanceCheck ────────────────────────────────────────────────────────────────────────────────
test('statementBalanceCheck reads the BANK account alone, not the aggregate of all assets', () => {
  const b = book();
  post(b, { date: '2026-03-01', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });
  post(b, { date: '2026-03-02', memo: 'to petty cash', postings: [{ account: 'cash', dir: 'dr', amount: 3000 }, { account: 'bank', dir: 'cr', amount: 3000 }] });
  // bank = 7000, cash = 3000, AGGREGATE assets = 10000. A balanceSheet-based check would wrongly agree at 10000.
  assert.deepEqual(statementBalanceCheck(b, '2026-03-31', 7000), { agrees: true, delta: 0, balance: 7000 });
  const off = statementBalanceCheck(b, '2026-03-31', 10000);
  assert.equal(off.agrees, false, 'the aggregate (10000) must NOT agree — that is the finding-1 bug');
  assert.equal(off.delta, -3000);
});

test('statementBalanceCheck is date-bounded and inclusive of the as-of day', () => {
  const b = book();
  post(b, { date: '2026-03-31', postings: [{ account: 'bank', dir: 'dr', amount: 7000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 7000 }] });   // ON the as-of day
  post(b, { date: '2026-04-05', postings: [{ account: 'bank', dir: 'dr', amount: 2000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 2000 }] });   // after
  assert.equal(statementBalanceCheck(b, '2026-03-31', 7000).agrees, true, 'an entry dated ON the statement date must count; a later one must not');
  assert.equal(statementBalanceCheck(b, '2026-04-30', 9000).agrees, true, 'by end of April both entries count');
});

// ── recurring templates ──────────────────────────────────────────────────────────────────────────────────
test('a template builds a BALANCED two-posting entry (out: category dr / bank cr) with the month importKey', () => {
  const t = { id: 't1', name: 'Rent', account: 'rent', fund: 'general', dir: 'out', amount: 50000, dayOfMonth: 15 };
  const e = templateEntry(t, '2026-03');
  assert.equal(e.date, '2026-03-15');
  assert.equal(e.importKey, 'template:t1:2026-03');
  assert.equal(e.postings.length, 2);
  const dr = e.postings.filter(p => p.dir === 'dr').reduce((s, p) => s + p.amount, 0);
  const cr = e.postings.filter(p => p.dir === 'cr').reduce((s, p) => s + p.amount, 0);
  assert.equal(dr, cr, 'the entry does not balance');
  assert.ok(e.postings.some(p => p.account === 'rent' && p.dir === 'dr'));
  assert.ok(e.postings.some(p => p.account === 'bank' && p.dir === 'cr'));
  // and the engine accepts it against a real book
  const b = book();
  assert.doesNotThrow(() => post(b, { date: e.date, memo: e.memo, importKey: e.importKey, postings: e.postings }));
});

test('a money-in template credits the category and debits the bank', () => {
  const e = templateEntry({ id: 't2', name: 'Standing gift', account: 'giving', dir: 'in', amount: 2500, dayOfMonth: 1 }, '2026-03');
  assert.ok(e.postings.some(p => p.account === 'bank' && p.dir === 'dr'));
  assert.ok(e.postings.some(p => p.account === 'giving' && p.dir === 'cr'));
});

test('dayOfMonth is clamped into the month (a 31st in February lands on the 28th)', () => {
  assert.equal(templateEntry({ id: 't', name: '', account: 'rent', dir: 'out', amount: 100, dayOfMonth: 31 }, '2026-02').date, '2026-02-28');
  assert.equal(templateEntry({ id: 't', name: '', account: 'rent', dir: 'out', amount: 100, dayOfMonth: 31 }, '2028-02').date, '2028-02-29');   // leap year
});

test('IDEMPOTENCY: once a template-month is in the book, templatePost refuses a second post', () => {
  const b = book();
  const t = { id: 't1', name: 'Rent', account: 'rent', fund: 'general', dir: 'out', amount: 50000, dayOfMonth: 15 };
  const plan = templatePost(b, t, '2026-03');
  assert.ok(plan, 'the first post for a month should be offered');
  post(b, { date: plan.date, memo: plan.memo, importKey: plan.importKey, postings: plan.postings });
  assert.ok(importedKeys(b).has(templateImportKey('t1', '2026-03')), 'the posted entry carries the month importKey');
  assert.equal(templatePost(b, t, '2026-03'), null, 'the SAME template-month must not be posted twice');
  assert.ok(templatePost(b, t, '2026-04'), 'a DIFFERENT month is still offered');
});
