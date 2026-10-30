// src/finance-charts.mjs — TrinityOne Finance: pure projections for the console "Insights" charts (UX-F).
//
// Three projections the existing modules do NOT give — a year-end projection from the year-to-date run rate,
// income/spending bucketed by month, and each fund's balance at each month-end — plus the pure fiscal-year
// range helper. They feed FOUR inline-SVG charts on the console Finance → Insights tab; the fourth chart
// (budget vs actual) reuses the Phase-7 budgetVsActual and needs nothing here.
//
// Like every pure finance module: no DOM, no relay, no I/O, and — the load-bearing rule — NO `Date`-"now".
// The caller INJECTS the clock as ISO strings (`today`, `from`, `to`) and `fiscalYearStart` ('MM-DD'); a pure
// module that calls `new Date().toISOString()` reintroduces the UTC off-by-one that
// finance-this-year-starts-on-the-local-day.test.mjs guards (CONTEXT 2026-10-29). Deterministic calendar
// arithmetic on EXPLICIT components (Date.UTC(y, m-1, d)) reads no clock and is the same form quarterRange()
// already uses in finance-statement.mjs — it is NOT the banned pattern.
//
// Money stays INTEGER minor units; the caller formats (booksFmt/fmtMoney). Every figure derives from the
// journal and reconciles to it to the penny (finance-charts.test.mjs). These are pure READ overlays: nothing
// here posts, touches book._seq, or changes what check(book) returns.

import { incomeExpenditure, FUND_TRANSFER_ACCT } from './finance-ledger.mjs';

const END = '￿';   // the same high sentinel finance-ledger uses: lexically after every ISO date

// ── deterministic date helpers (explicit components only — no clock read) ──────────────────────────────────
function dayMs(iso) { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); }
function dayDiff(a, b) { return Math.round((dayMs(b) - dayMs(a)) / 86400000); }   // whole days b − a
function addDays(iso, n) {
  const d = new Date(dayMs(iso) + n * 86400000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
const monthKey = iso => String(iso).slice(0, 7);                                   // 'YYYY-MM'
function stepMonth(ym) { let [y, m] = ym.split('-').map(Number); m += 1; if (m > 12) { m = 1; y += 1; } return y + '-' + String(m).padStart(2, '0'); }
function monthList(fromYM, toYM) { const out = []; let cur = fromYM; for (let i = 0; i < 1200 && cur <= toYM; i++) { out.push(cur); cur = stepMonth(cur); } return out; }

// The signed change a single posting makes to ITS fund's balance — the SAME rule as finance-ledger.fundBalances,
// finance-reports.fundDelta and finance-statement.closingFunds: keyed on the reserved transfer account id,
// never on type==='equity' (a real equity account carrying a fund would otherwise be miscounted). This is the
// FOURTH copy; keep all four identical — a drift here silently breaks check() invariant 3 (fund sum === surplus).
function fundDelta(book, p) {
  if (!p.fund) return 0;
  if (p.account === FUND_TRANSFER_ACCT) return p.dir === 'cr' ? p.amount : -p.amount;
  const a = book.accounts.get(p.account);
  if (!a) return 0;
  if (a.type === 'income') return p.dir === 'cr' ? p.amount : -p.amount;
  if (a.type === 'expense') return p.dir === 'dr' ? -p.amount : p.amount;
  return 0;
}

// The fiscal year that CONTAINS `today`, as ISO bounds. Pure equivalent of the shipped `fyStart` statement in
// app/stew-finance.jsx (which reads the LOCAL clock) — here `today` is injected instead, so the only clock read
// is removed. `fiscalYearStart` is 'MM-DD' (default '01-01'). `from` is the start on/before today; `to` is the
// day BEFORE the next year's start (inclusive). A non-01-01 year spans the calendar boundary and labels as
// "2027/2028". Matches the shipped fyStart.from for every clock (finance-charts.test.mjs cross-checks the slice).
export function fiscalYearRange(today, fiscalYearStart = '01-01') {
  const t = String(today);
  const mmdd = /^\d{2}-\d{2}$/.test(String(fiscalYearStart)) ? String(fiscalYearStart) : '01-01';
  const y = Number(t.slice(0, 4));
  const cand = y + '-' + mmdd;
  const from = cand <= t ? cand : (y - 1) + '-' + mmdd;      // same test the shipped fyStart makes (t <= today)
  const fromYear = Number(from.slice(0, 4));
  const to = addDays((fromYear + 1) + '-' + mmdd, -1);        // one day before next year's start
  const label = mmdd === '01-01' ? String(fromYear) : (fromYear + '/' + (fromYear + 1));
  return { from, to, label };
}

// Project the full fiscal year linearly from the YEAR-TO-DATE run rate ("at this pace, year-end ≈ £X").
// Pure: the fiscal window comes from `today` + `fiscalYearStart`, the YTD figures from incomeExpenditure over
// [from, today] — the SAME engine (and so the same signs) as the Finance stat cards.
//   · ytd       — incomeExpenditure(book,{from,to:today}) (income/expenditure/surplus)
//   · projected — each leg scaled by 1/fraction and ROUNDED; surplus is the two projected legs' difference
//                 (never a separate scale, so a deficit projects consistently). fraction===1 ⇒ projected===ytd.
//   · fraction  — elapsed days / days in the fiscal year (both inclusive). Guarded: fraction 0 ⇒ projected 0,
//                 never NaN/Infinity (empty book, or today == from on a zero-length guard).
//   · lowConfidence — true when less than ~1/12 of the year has elapsed (UX-F: still show it, but caveat it).
export function yearEndProjection(book, { today = '', fiscalYearStart = '01-01' } = {}) {
  const { from, to, label } = fiscalYearRange(today, fiscalYearStart);
  const ytd = incomeExpenditure(book, { from, to: today });
  const totalDays = dayDiff(from, to) + 1;                    // inclusive days in the fiscal year
  let elapsedDays = dayDiff(from, today) + 1;                 // inclusive days from the start up to today
  if (elapsedDays < 0) elapsedDays = 0;
  if (elapsedDays > totalDays) elapsedDays = totalDays;
  const fraction = totalDays > 0 ? elapsedDays / totalDays : 0;
  const scale = v => (fraction > 0 ? Math.round(v / fraction) : 0);
  const pIncome = scale(ytd.income), pExp = scale(ytd.expenditure);
  return {
    from, to, label, today: String(today),
    elapsedDays, totalDays, fraction,
    ytd: { income: ytd.income, expenditure: ytd.expenditure, surplus: ytd.surplus },
    projected: { income: pIncome, expenditure: pExp, surplus: pIncome - pExp },
    lowConfidence: fraction < 1 / 12,
  };
}

// Income and spending bucketed by calendar month across [from, to], as a DENSE, ordered list (every month from
// `from` to `to` inclusive, empty months = zeros — a trend line needs the gaps filled, not skipped). Signs are
// the incomeExpenditure rule (income cr−dr, expense dr−cr), so Σ over the buckets reconciles to
// incomeExpenditure(book,{from,to}) for income, expenditure and surplus, to the penny.
export function monthlyTotals(book, { from = '', to = END } = {}) {
  const buckets = new Map();                                  // 'YYYY-MM' -> { income, expenditure }
  for (const e of book.journal) {
    if (e.date < from || e.date > to) continue;
    const ym = monthKey(e.date);
    for (const p of e.postings) {
      const a = book.accounts.get(p.account);
      if (!a || (a.type !== 'income' && a.type !== 'expense')) continue;
      const signed = a.type === 'income' ? (p.dir === 'cr' ? p.amount : -p.amount) : (p.dir === 'dr' ? p.amount : -p.amount);
      let b = buckets.get(ym); if (!b) { b = { income: 0, expenditure: 0 }; buckets.set(ym, b); }
      if (a.type === 'income') b.income += signed; else b.expenditure += signed;
    }
  }
  const dates = book.journal.map(e => e.date).filter(Boolean);
  const loYM = from ? monthKey(from) : (dates.length ? monthKey(dates.reduce((a, b) => a < b ? a : b)) : '');
  const hiYM = (to && to !== END) ? monthKey(to) : (dates.length ? monthKey(dates.reduce((a, b) => a > b ? a : b)) : loYM);
  const months = loYM ? monthList(loYM, hiYM < loYM ? loYM : hiYM) : [];
  return months.map(ym => { const b = buckets.get(ym) || { income: 0, expenditure: 0 }; return { month: ym, income: b.income, expenditure: b.expenditure, surplus: b.income - b.expenditure }; });
}

// Each fund's CLOSING balance at the end of every month in [from, to]. The snapshot for a month is the fund's
// cumulative balance over ALL journal entries dated on or before that month's end (so the first column already
// carries everything from before the window — the opening balance). Same fund-delta rule as closingFunds.
// Returns { months:['YYYY-MM',…], funds:[{ fund, name, kind, balances:[… one per month] }] } (general first,
// then by name). The LAST column equals closingFunds(book, <end of that last month>); with all-time bounds it
// equals fundBalances(book) — both proven in finance-charts.test.mjs.
export function monthlyFundBalances(book, { from = '', to = END } = {}) {
  const dates = book.journal.map(e => e.date).filter(Boolean);
  const loYM = from ? monthKey(from) : (dates.length ? monthKey(dates.reduce((a, b) => a < b ? a : b)) : '');
  const hiYM = (to && to !== END) ? monthKey(to) : (dates.length ? monthKey(dates.reduce((a, b) => a > b ? a : b)) : loYM);
  const months = loYM ? monthList(loYM, hiYM < loYM ? loYM : hiYM) : [];
  const perMonth = new Map();                                 // 'YYYY-MM' -> Map(fundId -> signed delta)
  for (const e of book.journal) {
    const ym = monthKey(e.date);
    for (const p of e.postings) {
      const d = fundDelta(book, p); if (d === 0) continue;
      let fm = perMonth.get(ym); if (!fm) { fm = new Map(); perMonth.set(ym, fm); }
      fm.set(p.fund, (fm.get(p.fund) || 0) + d);
    }
  }
  const funds = [...book.funds.values()];
  const running = new Map(funds.map(f => [f.id, 0]));
  if (loYM) for (const [ym, fm] of perMonth) if (ym < loYM) for (const [fund, d] of fm) running.set(fund, (running.get(fund) || 0) + d);   // carry the opening in
  const series = new Map(funds.map(f => [f.id, []]));
  for (const ym of months) {
    const fm = perMonth.get(ym);
    if (fm) for (const [fund, d] of fm) running.set(fund, (running.get(fund) || 0) + d);
    for (const f of funds) series.get(f.id).push(running.get(f.id) || 0);
  }
  return {
    months,
    funds: funds.map(f => ({ fund: f.id, name: f.name, kind: f.kind, balances: series.get(f.id) }))
      .sort((a, b) => (a.fund === 'general' ? -1 : b.fund === 'general' ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))),
  };
}
