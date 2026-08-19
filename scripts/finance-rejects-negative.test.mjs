// A TYPED MINUS SIGN MUST NOT BECOME A POSITIVE POSTING.
// Run: node --test scripts/finance-rejects-negative.test.mjs
//
// Found by an accountant persona on 2026-08-18, driving the real console. She typed `-500` into Money In,
// expecting either a £500 expense or a complaint. The field accepted it silently and posted **+£500.00** —
// a £1,000 error from one character, in the one screen where being out by a thousand pounds matters.
//
// The cause is a sanitiser that predates the sign question: `String(str).replace(/[^0-9.]/g, '')` strips
// everything that is not a digit or a dot, and a leading `-` is not a digit. The direction of a posting comes
// from an explicit Money In / Money Out toggle, so the minus cannot flip income to expense on its own — which
// is why this is "silently accepted as the opposite of what was typed" rather than a corrupted ledger. It is
// still wrong, and a treasurer reconciling against a bank statement finds it as a £1,000 hole.
//
// The fix is to REFUSE, not to guess. `-500` in a box labelled Money In is ambiguous — the person may have
// meant an expense, or a correction, or made a typo — and a bookkeeping tool that guesses is worse than one
// that asks. Returning 0 makes it invalid, which is the same thing the field already does with empty input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');
const booksParse = new Function(fnBody(FIN, 'function booksParse(') + '; return booksParse;')();
const book = { decimals: 2 };

test('a plain amount still parses to minor units', () => {
  assert.equal(booksParse('500', book), 50000, 're-anchor: ordinary parsing has changed');
  assert.equal(booksParse('12.34', book), 1234);
  assert.equal(booksParse('£1,000.50', book), 100050, 'currency symbols and separators must still be tolerated');
});

test('a NEGATIVE amount is refused, not silently made positive', () => {
  assert.notEqual(booksParse('-500', book), 50000,
    'typing -500 posted +£500.00 — a £1,000 swing from a character the field accepted without comment');
  assert.equal(booksParse('-500', book), 0,
    'a negative amount must be invalid (0), the same as empty input — a bookkeeping tool must refuse an ' +
    'ambiguous sign rather than guess which direction the treasurer meant');
  assert.equal(booksParse('-0.01', book), 0, 'including small ones');
  assert.equal(booksParse('−500', book), 0, 'and a unicode minus, which a phone keyboard and Excel both produce');
});

test('a minus that is not a sign is still refused rather than mis-parsed', () => {
  // "500-600" is not an amount. Before the fix it silently became 500600.
  assert.equal(booksParse('500-600', book), 0, 'an embedded minus makes the input ambiguous — refuse it');
});
