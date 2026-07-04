// Tests for the bank-statement import engine.  Run: node --test scripts/finance-import.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, guessColumns, parseMoney, parseDate, statementLines, lineKey, suggestCategory } from '../src/finance-import.mjs';

test('parseCsv handles quotes, embedded commas, and blank lines', () => {
  const { header, rows } = parseCsv('Date,Description,Amount\n2026-07-01,"TESCO, LONDON",-12.50\n\n2026-07-02,Sunday offering,250.00\n');
  assert.deepEqual(header, ['Date', 'Description', 'Amount']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], 'TESCO, LONDON');   // embedded comma preserved
});

test('guessColumns: single signed amount column', () => {
  const m = guessColumns(['Date', 'Description', 'Amount']);
  assert.equal(m.date, 0); assert.equal(m.description, 1); assert.equal(m.amount, 2);
  assert.equal(m.moneyIn, -1); assert.equal(m.moneyOut, -1);
});

test('guessColumns: separate money-in / money-out columns', () => {
  const m = guessColumns(['Transaction Date', 'Details', 'Paid Out', 'Paid In', 'Balance']);
  assert.equal(m.date, 0); assert.equal(m.description, 1);
  assert.equal(m.moneyOut, 2); assert.equal(m.moneyIn, 3);
  assert.equal(m.amount, -1);   // not a single-amount sheet
});

test('parseMoney handles symbols, thousands, parens, signs, CR/DR', () => {
  assert.equal(parseMoney('£1,234.56'), 123456);
  assert.equal(parseMoney('(50.00)'), -5000);
  assert.equal(parseMoney('-50'), -5000);
  assert.equal(parseMoney('250.00'), 25000);
  assert.equal(parseMoney('80.00 DR'), -8000);
  assert.equal(parseMoney('80.00 CR'), 8000);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('  '), null);
});

test('parseDate: ISO, day-first, month-first, DD-MMM, garbage', () => {
  assert.equal(parseDate('2026-07-01'), '2026-07-01');
  assert.equal(parseDate('01/07/2026'), '2026-07-01');            // day-first (default)
  assert.equal(parseDate('07/01/2026', true), '2026-07-01');      // month-first toggle
  assert.equal(parseDate('01-Jul-2026'), '2026-07-01');
  assert.equal(parseDate('5/7/26'), '2026-07-05');                // 2-digit year + single digits
  assert.equal(parseDate('not a date'), '');
});

test('statementLines: single amount column → in/out + dedup key', () => {
  const rows = [['2026-07-01', 'Sunday offering', '250.00'], ['2026-07-02', 'Electric', '-84.00'], ['2026-07-03', 'blank', '']];
  const lines = statementLines({ rows, mapping: { date: 0, description: 1, amount: 2, moneyIn: -1, moneyOut: -1 } });
  assert.equal(lines.length, 2);   // blank/zero row dropped
  assert.deepEqual({ dir: lines[0].dir, amt: lines[0].amountMinor }, { dir: 'in', amt: 25000 });
  assert.deepEqual({ dir: lines[1].dir, amt: lines[1].amountMinor }, { dir: 'out', amt: 8400 });
  assert.equal(lines[0].key, lineKey('2026-07-01', 25000, 'Sunday offering'));
  assert.notEqual(lines[0].key, lines[1].key);
});

test('statementLines: separate in/out columns', () => {
  const rows = [['2026-07-01', 'Offering', '', '250.00'], ['2026-07-02', 'Electric', '84.00', '']];
  const lines = statementLines({ rows, mapping: { date: 0, description: 1, amount: -1, moneyOut: 2, moneyIn: 3 } });
  assert.deepEqual(lines.map(l => l.dir), ['in', 'out']);
  assert.deepEqual(lines.map(l => l.amountMinor), [25000, 8400]);
});

test('an in and an out of the same amount get distinct dedup keys', () => {
  const kIn = lineKey('2026-07-01', 5000, 'X');
  const kOut = lineKey('2026-07-01', -5000, 'X');
  assert.notEqual(kIn, kOut);
});

test('suggestCategory matches remembered rules', () => {
  const rules = [{ match: 'TESCO', account: 'other-expense', fund: 'general' }, { match: 'offering', account: 'giving', fund: 'general' }];
  assert.deepEqual(suggestCategory({ description: 'TESCO LONDON 4421' }, rules), { account: 'other-expense', fund: 'general' });
  assert.deepEqual(suggestCategory({ description: 'Sunday Offering' }, rules), { account: 'giving', fund: 'general' });
  assert.equal(suggestCategory({ description: 'Unknown payee' }, rules), null);
});
