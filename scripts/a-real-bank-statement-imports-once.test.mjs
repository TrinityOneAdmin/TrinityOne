// A REAL-SHAPED BANK EXPORT, THROUGH THE SHIPPED IMPORTER AND LEDGER, ONTO A RELAY THAT ENFORCES ITS RULES.
// Run: node --test scripts/a-real-bank-statement-imports-once.test.mjs
//
// The existing import tests use synthetic lines with distinct keys, which is how the branch shipped a version
// that silently dropped the second of two identical payments. This drives the fixture in
// scripts/fixtures/bank-statement-sample.csv — day-first dates, quoted commas, thousands separators, separate
// money-in/out columns — through parseCsv, guessColumns and statementLines exactly as the console does, then
// posts it against a relay applying the real journal rule (a document is accepted only when its seq is
// EXACTLY the next one, gateway.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, guessColumns, statementLines } from '../src/finance-import.mjs';

const LEDGER = new Function(readFileSync(new URL('../vendor/finance-ledger.js', import.meta.url), 'utf8')
  + '; return FinanceLedger;')();
const CSV = readFileSync(new URL('./fixtures/bank-statement-sample.csv', import.meta.url), 'utf8');

function lines() {
  const p = parseCsv(CSV);
  const ls = statementLines({ rows: p.rows, mapping: guessColumns(p.header), decimals: 2, monthFirst: false });
  assert.ok(ls.length >= 12, 'the fixture stopped parsing — re-anchor this test');
  assert.equal(ls.filter(l => !l.date).length, 0, 'a date in the fixture no longer parses');
  return ls;
}

function book() {
  const b = LEDGER.createBook({});
  LEDGER.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  LEDGER.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  LEDGER.addAccount(b, { id: 'costs', code: '5000', name: 'Running costs', type: 'expense' });
  if (!b.funds.has('general')) LEDGER.addFund(b, { id: 'general', name: 'General' });
  return b;
}

// The shipped import loop, in the shape app/stew-finance.jsx runs it: serial, de-dup read fresh from the
// book, roll the local entry back on refusal and stop.
function importInto(b, relay, ls, { failFrom = null } = {}) {
  const already = LEDGER.importedKeys(b);
  const out = { posted: 0, failed: [], skipped: [] };
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i];
    if (line.key && already.has(line.key)) { out.skipped.push(line); continue; }
    const acct = line.dir === 'in' ? 'giving' : 'costs';
    const P = line.dir === 'in'
      ? [{ account: 'bank', dir: 'dr', amount: line.amountMinor }, { account: acct, fund: 'general', dir: 'cr', amount: line.amountMinor }]
      : [{ account: acct, fund: 'general', dir: 'dr', amount: Math.abs(line.amountMinor) }, { account: 'bank', dir: 'cr', amount: Math.abs(line.amountMinor) }];
    const e = LEDGER.post(b, { date: line.date, memo: line.description, importKey: line.key, postings: P });
    const ok = (failFrom == null || out.posted < failFrom) && relay.publish(e);
    if (!ok) { LEDGER.dropFrom(b, e.seq); for (let j = i; j < ls.length; j++) out.failed.push(ls[j]); break; }
    out.posted++;
  }
  return out;
}

function relay() {
  let head = 0; const stored = [];
  return { stored, keys: () => stored.map(e => e.importKey),
           publish(e) { if (e.seq !== head + 1) return false; head = e.seq; stored.push(e); return true; } };
}

test('the whole statement imports, including two identical payments on one day', () => {
  const ls = lines(), b = book(), r = relay();
  const res = importInto(b, r, ls);
  assert.equal(res.failed.length, 0);
  assert.equal(res.posted, ls.length,
    'lines went missing. Two £20.00 standing orders on the same day share a de-dup fingerprint, and dropping ' +
    'the second is money absent from a church\'s books with nothing on screen');
  const twenties = r.stored.filter(e => e.importKey === '2026-09-01|2000|standing order giving');
  assert.equal(twenties.length, 2, 'only one of the two identical standing orders reached the relay');
});

test('importing the same statement again posts nothing', () => {
  const ls = lines(), b = book(), r = relay();
  importInto(b, r, ls);
  const again = importInto(b, r, ls);
  assert.equal(again.posted, 0, 'a second import of the same file doubled the books');
  assert.equal(again.skipped.length, ls.length);
});

test('a half-failed import, then Try again: nothing doubled, nothing lost', () => {
  const ls = lines(), b = book(), r = relay();
  const first = importInto(b, r, ls, { failFrom: 5 });
  assert.equal(first.posted, 5, 'the harness did not produce the partial failure this test is about');
  const second = importInto(b, r, ls);          // the relay is back
  assert.equal(first.posted + second.posted, ls.length, 'the retry could not finish the statement');
  const keys = r.keys();
  assert.equal(keys.length, ls.length, 'the retry re-posted lines that had already landed');
  assert.deepEqual(r.stored.map(e => e.seq), ls.map((_, i) => i + 1), 'the journal is not contiguous');
});

test('the books balance and match the statement', () => {
  const ls = lines(), b = book(), r = relay();
  importInto(b, r, ls);
  const tb = LEDGER.trialBalance(b);
  const bank = tb.rows.find(x => x.account === 'bank');
  const net = ls.reduce((a, l) => a + (l.dir === 'in' ? l.amountMinor : -Math.abs(l.amountMinor)), 0);
  assert.equal(bank.debit - bank.credit, net, 'the bank balance does not match the statement it came from');
  assert.equal(LEDGER.check(b).ok !== false, true, 'the ledger does not balance after importing a real statement');
});

test('KNOWN LIMIT, held here so it is a decision and not a surprise', () => {
  // Two DIFFERENT transactions — Wickes roof repair "PART 1" and "PART 2" — share a date, an amount, and the
  // first 40 characters of their description, which is all lineKey keeps. Within one import both post. On a
  // RE-import both are skipped, so if only one had gone in the other can never be added by importing again.
  const ls = lines();
  const wick = ls.filter(l => /WICKES/.test(l.description));
  assert.equal(wick.length, 2, 'the fixture no longer carries the long-description pair — re-anchor this');
  assert.equal(wick[0].key, wick[1].key,
    'the two long descriptions no longer collide — if lineKey was widened, say so here and delete this test');
  const b = book(), r = relay();
  assert.equal(importInto(b, r, ls).posted, ls.length, 'both must still post within a single import');
});
