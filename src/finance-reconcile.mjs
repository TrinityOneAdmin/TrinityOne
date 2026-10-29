// src/finance-reconcile.mjs — bank reconciliation + recurring templates (pure: no I/O, no browser, no relay).
//
// Two jobs, both derived from the journal so they can be proven in node and ship as window.FinanceLedger:
//   · match(statementLines, journalEntries, {windowDays}) — line up imported bank lines against the ledger's
//     BANK-SIDE postings (a journal entry is double-entry; a bank statement only ever sees the bank leg).
//   · statementBalanceCheck(book, asOf, closingMinor) — does the bank account's ledger balance AS OF the
//     statement date agree with the treasurer's closing balance? It computes its OWN date-bounded,
//     single-account balance — NOT trialBalance (all-time) and NOT balanceSheet (aggregate assets), either of
//     which is wrong the moment a second asset account or a later transaction exists (AUDIT-PHASE-3 finding 1).
//   · templateEntry / templatePost — a recurring standing order posted once a month, with a deterministic
//     importKey so the ledger's own de-dup refuses a double-post (AUDIT-PHASE-3 finding 2).
//
// MONEY is INTEGER minor units, matching finance-ledger.mjs. NO `Date` here: any "today"/"this month" is
// INJECTED by the caller (the console's local-day helper), so this module can never reintroduce the UTC
// off-by-one guarded by finance-this-year-starts-on-the-local-day.test.mjs.

import { importedKeys } from './finance-ledger.mjs';

const BANK = 'bank';

// Days since civil epoch for an ISO 'YYYY-MM-DD' — pure integer arithmetic (Howard Hinnant's days_from_civil),
// NO `Date`. Used only to measure the gap between two GIVEN dates, never to read the clock. null if unparseable.
function dayNum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? '' : iso));
  if (!m) return null;
  let y = +m[1]; const mo = +m[2], d = +m[3];
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo > 2 ? mo - 3 : mo + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// The bank-side of a journal entry: the posting on `account` (the bank/cash account). A statement only ever
// records this leg, so matching keys on it, not on the whole entry — otherwise a multi-posting entry (a split
// deposit, a fund transfer) is ambiguous. dr to the bank is money IN, cr is money OUT, matching import's dirs.
function bankSide(entry, account) {
  for (const p of (entry && entry.postings) || []) {
    if (p.account === account) return { dir: p.dir === 'dr' ? 'in' : 'out', amount: p.amount };
  }
  return null;
}

// Reconcile imported bank lines against the ledger. Returns { matched:[{line,entry,by}], unmatchedLines,
// unmatchedEntries }. Only entries that touch the bank account are candidates — nothing else is a bank
// movement, so a non-bank entry can be neither matched nor "unmatched" against a bank statement.
//
// Pass 1 reuses the importKey a straight-import already stamped on its entry (line.key === entry.importKey) —
// a definite link. Pass 2 matches the rest by direction + exact amount + date within ±windowDays, nearest
// date first. Each line and each entry is used at most once, so two identical payments need two ledger entries
// to both match (the same basis as the import de-dup).
export function match(statementLines, journalEntries, { windowDays = 3, account = BANK } = {}) {
  const lines = (statementLines || []).map((l, i) => ({ l, i }));
  const lineUsed = new Array(lines.length).fill(false);
  const cands = [];
  for (const e of (journalEntries || [])) {
    const bs = bankSide(e, account);
    if (bs) cands.push({ e, dir: bs.dir, amount: bs.amount, day: dayNum(e.date), importKey: e.importKey || null, used: false });
  }
  const matched = [];
  // Pass 1 — importKey identity.
  for (const { l, i } of lines) {
    if (!l || !l.key) continue;
    const c = cands.find(c => !c.used && c.importKey && c.importKey === l.key);
    if (c) { c.used = true; lineUsed[i] = true; matched.push({ line: l, entry: c.e, by: 'key' }); }
  }
  // Pass 2 — amount + direction + date proximity (nearest wins).
  for (const { l, i } of lines) {
    if (lineUsed[i] || !l) continue;
    const ld = dayNum(l.date);
    let best = null, bestDist = Infinity;
    for (const c of cands) {
      if (c.used || c.dir !== l.dir || c.amount !== l.amountMinor) continue;
      const known = ld != null && c.day != null;
      const dist = known ? Math.abs(ld - c.day) : 0;   // a line/entry with no date can still match on amount
      if ((!known || dist <= windowDays) && dist < bestDist) { best = c; bestDist = dist; }
    }
    if (best) { best.used = true; lineUsed[i] = true; matched.push({ line: l, entry: best.e, by: 'amount' }); }
  }
  const unmatchedLines = [];
  for (const { l, i } of lines) if (!lineUsed[i]) unmatchedLines.push(l);
  const unmatchedEntries = cands.filter(c => !c.used).map(c => c.e);
  return { matched, unmatchedLines, unmatchedEntries };
}

// The bank account's ledger balance AS OF a date, computed directly: Σ (dr − cr) over postings to `account`
// across entries dated on or before asOf (INCLUSIVE, like balanceSheet's `e.date > asOf` boundary — a closing
// balance is end-of-day on the statement date). Integer minor units. Does NOT read trialBalance/balanceSheet.
export function statementBalanceCheck(book, asOfDate, closingMinor, account = BANK) {
  let balance = 0;
  for (const e of ((book && book.journal) || [])) {
    if (asOfDate && e.date && e.date > asOfDate) continue;   // inclusive upper bound
    for (const p of (e.postings || [])) if (p.account === account) balance += (p.dir === 'dr' ? p.amount : -p.amount);
  }
  const target = Math.round(Number(closingMinor) || 0);
  const delta = balance - target;
  return { agrees: delta === 0, delta, balance };
}

// ── recurring templates ──────────────────────────────────────────────────────────────────────────────────
// A deterministic key per template per month, so the ledger's own importedKeys/count de-dup refuses a second
// "post this month" for the same month (two co-stewards, a double tap). The month is INJECTED (YYYY-MM).
export function templateImportKey(id, yyyymm) { return 'template:' + id + ':' + yyyymm; }

const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function daysInMonth(y, m) { return (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) ? 29 : DIM[m - 1]; }

// Build the BALANCED two-posting journal entry a template posts for `yyyymm` (same shape as record()/import):
// 'in' → bank dr / category cr; 'out' → category dr / bank cr. The date is dayOfMonth clamped into the month
// (so a 31st in February lands on the 28th/29th). Caller posts it through the awaited pubEntry/dropFrom path.
export function templateEntry(template, yyyymm, { account = BANK } = {}) {
  const mm = /^(\d{4})-(\d{2})$/.exec(String(yyyymm == null ? '' : yyyymm));
  if (!mm) throw new Error('templateEntry needs a YYYY-MM month');
  const y = +mm[1], mo = +mm[2];
  if (mo < 1 || mo > 12) throw new Error('templateEntry: bad month ' + yyyymm);
  const day = Math.max(1, Math.min(daysInMonth(y, mo), Math.round(Number(template.dayOfMonth) || 1)));
  const date = yyyymm + '-' + String(day).padStart(2, '0');
  const amount = template.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('templateEntry: amount must be a positive integer (minor units)');
  const fund = template.fund || 'general';
  const postings = template.dir === 'in'
    ? [{ account, dir: 'dr', amount }, { account: template.account, fund, dir: 'cr', amount }]
    : [{ account: template.account, fund, dir: 'dr', amount }, { account, dir: 'cr', amount }];
  return { date, memo: template.name || '', importKey: templateImportKey(template.id, yyyymm), postings };
}

// Decide whether to post a template for a month: return the entry to post, or null if the book ALREADY holds
// this template-month (the deterministic importKey is in importedKeys). No money moves here — the caller posts
// a non-null result and awaits the relay. This is what makes "post this month" idempotent.
export function templatePost(book, template, yyyymm, opts = {}) {
  if (importedKeys(book).has(templateImportKey(template.id, yyyymm))) return null;
  return templateEntry(template, yyyymm, opts);
}
