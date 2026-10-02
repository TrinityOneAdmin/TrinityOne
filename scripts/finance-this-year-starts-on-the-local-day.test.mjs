// FINANCE'S "THIS YEAR" STARTS ON THE LOCAL CALENDAR DAY.
//   Run: node --test scripts/finance-this-year-starts-on-the-local-day.test.mjs
//
// 7ae78c3 (the fiscal-year fix) built the year's start from the LOCAL year but compared it with the UTC date
// (`new Date().toISOString().slice(0, 10)`). On the first day of the financial year, from local midnight until UTC
// caught up (an hour in a UK summer, longer elsewhere), "this year" meant LAST year and the Surplus card and
// Reports showed last year's totals. Caught by calendar-day.test.mjs in the release run, 2026-09-30.
//
// HOW IT ASSERTS. The `fyStart` statement is sliced from the shipped app/stew-finance.jsx and run with a clock
// that stands at 00:30 local on 6 April 2027 — which is still 5 April in UTC — and the local-date helper the app
// uses (todayISO, app/recur.jsx) answering the local day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stmt } from './test-slice.mjs';

const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');
const anchor = 'const fyStart = (() =>';
const at = FIN.indexOf(anchor);
assert.notEqual(at, -1, 'fyStart is gone from app/stew-finance.jsx — re-anchor this test');
assert.equal(FIN.indexOf(anchor, at + 1), -1, 'fyStart appears twice');
const FY = stmt(FIN, anchor);

// A clock at 00:30 local on `localDay`, where UTC is still the day before.
function clockAt(localDay, utcDay) {
  const [y] = localDay.split('-').map(Number);
  class FakeDate { getFullYear() { return y; } toISOString() { return utcDay + 'T23:30:00.000Z'; } }
  return { Date: FakeDate, todayISO: () => localDay };
}
const fyStart = (fiscalYearStart, clock) =>
  new Function('book', 'Date', 'todayISO', `${FY}\nreturn fyStart;`)({ fiscalYearStart }, clock.Date, clock.todayISO);

test('on the first day of the financial year, just after local midnight, "this year" starts today', () => {
  assert.equal(fyStart('04-06', clockAt('2027-04-06', '2027-04-05')), '2027-04-06',
    'the financial year had started on the local calendar, but the screen still counted last year');
});

test('CONTROL: the day before, "this year" is still last year', () => {
  assert.equal(fyStart('04-06', clockAt('2027-04-05', '2027-04-05')), '2026-04-06');
});

test('CONTROL: a calendar-year church, mid-year', () => {
  assert.equal(fyStart(undefined, clockAt('2027-09-30', '2027-09-30')), '2027-01-01');
});
