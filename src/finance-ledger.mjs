// src/finance-ledger.mjs — TrinityOne Finance: the pure double-entry ledger core.
// No I/O, no browser, no relay — just the accounting engine, so it can be proven correct in isolation.
//
// INVARIANTS (see check()):
//   1. every journal entry balances: Σ debits == Σ credits
//   2. the trial balance balances: Σ all debit-balances == Σ all credit-balances
//   3. fund balances reconcile to the overall surplus (income − expenditure)
//   4. sequence numbers are contiguous 1..n (single-writer, relay-ordered upstream)
//
// MONEY is INTEGER minor units (e.g. cents / sats). Never floats — floating-point money is how ledgers rot.
// Sign convention: debits increase assets & expenses; credits increase liabilities, equity & income.

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
export const FUND_KINDS = ['general', 'designated', 'restricted'];
const DEBIT_NORMAL = new Set(['asset', 'expense']);   // credit-normal: liability, equity, income

export function createBook({ baseCurrency = 'USD', decimals = 2, fiscalYearStart = '01-01', multiCurrency = false } = {}) {
  // `multiCurrency` (Phase 8) is an OPT-IN console flag carried on the finance/settings doc — absent/false by
  // default (a silent-£ church, DOMAIN 2026-10-29: nation-neutral, no pilot currency prompt). It is a PASSIVE
  // field: NO projection or invariant reads it (trialBalance/fundBalances/balanceSheet/check all read only
  // p.amount, which is ALWAYS base-currency minor units). It only gates whether the console's entry form offers
  // the currency+rate fields. bookToDocs/finItemToDoc OMIT it when false so a silent-£ settings doc is unchanged.
  const book = {
    baseCurrency, decimals, fiscalYearStart, multiCurrency: !!multiCurrency,
    accounts: new Map(),   // id -> { id, code, name, type }
    funds: new Map(),      // id -> { id, name, kind }
    journal: [],           // append-only: [{ seq, date, memo, postings, by, ts, reverses }]
    _seq: 0,
  };
  addFund(book, { id: 'general', name: 'General fund', kind: 'general' });   // the default, always present
  return book;
}

export function addAccount(book, { id, code, name, type, archived = false }) {
  if (!ACCOUNT_TYPES.includes(type)) throw new Error('bad account type: ' + type);
  id = id || code;
  if (!id) throw new Error('account needs an id or code');
  if (book.accounts.has(id)) throw new Error('duplicate account: ' + id);
  // `archived` hides an account from the category pickers while KEEPING it in the ledger and reports (an account
  // with postings can never be deleted — check() requires every posting's account to exist). Absent → false, so
  // an older console that publishes an account doc without the field, and a book rebuilt from such a doc, both
  // read as not-archived. The flag travels on the account doc (finance-store bookToDocs/rebuildBook) and the
  // replaceable finance/account:<id> relay doc (stew-finance finItemToDoc + the seed/UI publish).
  const acc = { id, code: code || id, name: name || id, type, archived: !!archived };
  book.accounts.set(id, acc);
  return acc;
}

// Does the journal reference this account anywhere? The chart-management UI forbids a TYPE change on a posted
// account — changing account.type silently re-signs every projection that branches on it (trialBalance,
// incomeExpenditure, fundBalances, balanceSheet), a whole-book corruption with no error. Pure so the console
// and a node test share one definition (CLAUDE.md rule 1's point-of-use test asserts the disabled control;
// this is the engine half).
export function accountHasPostings(book, id) {
  for (const e of book.journal) for (const p of e.postings) if (p.account === id) return true;
  return false;
}

export function addFund(book, { id, name, kind = 'general' }) {
  if (!FUND_KINDS.includes(kind)) throw new Error('bad fund kind: ' + kind);
  id = id || name;
  if (!id) throw new Error('fund needs an id or name');
  if (book.funds.has(id)) throw new Error('duplicate fund: ' + id);
  const f = { id, name: name || id, kind };
  book.funds.set(id, f);
  return f;
}

// ── multi-currency (Phase 8) ─────────────────────────────────────────────────────────────────────────────
// A posting MAY carry the foreign-currency annotation trio { currency, origAmount, rate }. `amount` ALWAYS
// stays BASE-currency integer minor units so Σdr==Σcr and every projection/invariant is unchanged in base; the
// trio is a pure annotation the engine never sums. The base figure is DEFINED as round(origAmount × rate).
//
// ROUNDING MODE: half away from zero on the product in minor units (origAmount and base are both integers;
// origAmount>0 and rate>0, so this is half-UP). `Math.round` rounds a positive .5 up (toward +∞), which for the
// non-negative products here is identical to half-away-from-zero. Chosen because it is what a treasurer reading
// a printed FX slip expects (5431.55 → 5432, 10863.10 → 10863) and it is the ONE rule the console and the
// engine share, so the amount a caller computes and the amount _normalize re-derives always agree to the penny.
//
// WHY the caller, not _normalize, owns per-entry balance: rounding each leg independently can unbalance a
// multi-posting entry (5000+5000 vs 10000 @1.08631 → 10864 vs 10863). The guarantee is that one conversion is
// mirrored across the entry — the 2-posting UI path annotates ONLY the foreign cash leg and mirrors its base
// figure onto the plain other leg, and a >2-posting entry routes the rounding residual to a PLAIN base line on
// the reserved FX account (FX_ACCT). _normalize then re-checks each annotated leg's amount === baseAmount(...)
// AND the whole-entry Σdr==Σcr, so a caller that got either wrong is rejected, never silently stored.
export function baseAmount(origAmount, rate) {
  if (!Number.isSafeInteger(origAmount) || origAmount <= 0) throw new Error('origAmount must be a positive integer (minor units)');
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) throw new Error('rate must be a positive finite number');
  return Math.round(origAmount * rate);
}

// Post a BALANCED journal entry. postings: [{ account, fund?, dir:'dr'|'cr', amount(+int), currency?, origAmount?, rate? }]
// income/expense postings default to the general fund; the cash side (asset/liability/equity) may be fund-less.
function _normalize(book, postings) {
  if (!Array.isArray(postings) || postings.length < 2) throw new Error('a journal entry needs at least two postings');
  let dr = 0, cr = 0;
  const norm = postings.map((p, i) => {
    const acc = book.accounts.get(p.account);
    if (!acc) throw new Error(`posting ${i}: unknown account "${p.account}"`);
    if (p.dir !== 'dr' && p.dir !== 'cr') throw new Error(`posting ${i}: dir must be 'dr' or 'cr'`);
    if (!Number.isSafeInteger(p.amount) || p.amount <= 0) throw new Error(`posting ${i}: amount must be a positive integer (minor units)`);
    let fund = p.fund != null ? p.fund : ((acc.type === 'income' || acc.type === 'expense') ? 'general' : null);
    if (fund != null && !book.funds.has(fund)) throw new Error(`posting ${i}: unknown fund "${fund}"`);
    if (p.dir === 'dr') dr += p.amount; else cr += p.amount;
    // `donor` (Phase 4b): an OPTIONAL opaque donor id tagged on a giving posting — the link a giving-by-member
    // report and the UK Gift Aid pack group on. It is NEVER a name (donor NAMES live in finance/donor:<id>
    // docs); an opaque id keeps the journal name-free. A SIDE field: the double-entry engine never reads it
    // (balance, trialBalance, fundBalances all ignore it), it is carried so the serializers preserve it — and
    // on a POSTING, the live publish path (pubEntry) and bookToDocs both pass postings wholesale, so unlike an
    // ENTRY field it only needs preserving HERE, where _normalize rebuilds each posting. ⚠ APPEND-ONLY: a
    // donorId embedded in the journal is permanent and CANNOT be GDPR-erased (a "forget this donor" scrubs the
    // finance/donor doc, never the ledger) — acceptable under UK charity/HMRC 6-year retention, documented so
    // nobody is surprised. It is also network-readable via the journal's aggregate read, which is WHY it must
    // stay an opaque id and never a name.
    const o = { account: p.account, fund, dir: p.dir, amount: p.amount };
    // Multi-currency annotation (Phase 8). The trio travels TOGETHER or not at all. When ABSENT we OMIT the keys
    // entirely (never materialise currency:base/rate:1) so a silent-£ posting serialises BYTE-IDENTICALLY to a
    // pre-Phase-8 entry — the "existing suite unchanged" gate depends on it. When PRESENT we validate the shape
    // and re-derive the base figure: p.amount MUST equal baseAmount(origAmount, rate), the single rounding rule
    // the console entry form also uses. Like `donor`, the trio lives on the POSTING, and the live publish path
    // (pubEntry) and bookToDocs both pass postings wholesale, so it only needs preserving HERE, where every
    // path (post/applyEntry/reverse) rebuilds each posting through _normalize.
    const hasCur = p.currency != null || p.origAmount != null || p.rate != null;
    if (hasCur) {
      if (typeof p.currency !== 'string' || !p.currency) throw new Error(`posting ${i}: currency must be a non-empty string when a foreign amount is given`);
      const base = baseAmount(p.origAmount, p.rate);   // throws on a bad origAmount/rate
      if (p.amount !== base) throw new Error(`posting ${i}: base amount ${p.amount} ≠ round(origAmount×rate)=${base}`);
      o.currency = p.currency; o.origAmount = p.origAmount; o.rate = p.rate;
    }
    if (p.donor != null && p.donor !== '') o.donor = String(p.donor);
    return o;
  });
  if (dr !== cr) throw new Error(`entry does not balance: debits ${dr} ≠ credits ${cr}`);
  return norm;
}

export function post(book, { date = '', memo = '', postings, by = '', ts = 0, reverses = null, importKey = null, attachmentRefs = [], invoice = null, bill = null } = {}) {
  const norm = _normalize(book, postings);
  // attachmentRefs: ids of finance/attachment:<id> blobs (receipt images) tied to this entry. A SIDE field —
  // the ledger never reads it; it is carried so the serializers (pubEntry/bookToDocs) and the deserializers
  // (finItemToDoc/applyEntry) preserve the link. Absent → [] so an older console's entry round-trips unchanged.
  // invoice (Phase 5): the opaque finance/invoice:<id> this entry belongs to — set on the issue, settlement and
  // credit-note entries so "is THIS invoice paid?" can be netted from the AR postings tagged with it. Another
  // SIDE field (the double-entry engine never reads it: balance, trialBalance, fundBalances all ignore it),
  // carried so the SAME four serializers preserve it. Absent → null, so a pre-Phase-5 entry round-trips unchanged.
  // bill (Phase 6): the payable mirror of `invoice` — the opaque finance/bill:<id> this entry belongs to (set on
  // the receive and payment entries), netted over the AP postings to answer "is THIS bill paid?". Same SIDE-field
  // treatment through the same four serializers; absent → null, so a pre-Phase-6 entry round-trips unchanged.
  const entry = { seq: ++book._seq, date, memo, postings: norm, by, ts, reverses, importKey, attachmentRefs: Array.isArray(attachmentRefs) ? attachmentRefs : [], invoice: invoice ?? null, bill: bill ?? null };
  book.journal.push(entry);
  return entry;
}

// DISCARD ENTRIES THAT WERE NEVER ACCEPTED. This is not editing history — an entry the relay refused is not
// history, it is a local guess that turned out to be wrong, and leaving it behind does two kinds of damage.
//
// `post()` advances `book._seq` whether or not the publish lands, and the relay's journal rule is EXACTLY
// the next seq (gateway.mjs: `seq === FINANCE_SEQ.get(cp) + 1` — it rejects gaps, forks and edits alike). So
// one refused line silently invalidates every seq after it: the retry, and every ordinary entry the
// treasurer types afterwards, is numbered past a gap the relay will never accept. And the phantom entries
// carry importKeys, so the import de-dup then treats lines that never reached the relay as already imported
// and refuses to retry them.
//
// Callers: importStatement in app/stew-finance.jsx. Anything else that posts-then-publishes wants it too.
export function dropFrom(book, seq) {
  if (!Number.isSafeInteger(seq)) throw new Error('dropFrom needs an integer seq');
  const before = book.journal.length;
  book.journal = book.journal.filter(e => e.seq < seq);
  book._seq = book.journal.length ? Math.max(...book.journal.map(e => e.seq)) : seq - 1;
  return before - book.journal.length;
}

// Rebuild path: append an entry at its ORIGINAL seq, enforcing contiguity. This is the single-writer guard on
// the client side — a gap OR a fork (a repeated seq) throws instead of silently corrupting the ledger.
export function applyEntry(book, entry) {
  if (!entry || !Number.isSafeInteger(entry.seq)) throw new Error('entry needs an integer seq');
  if (entry.seq !== book._seq + 1) throw new Error(`sequence gap/fork: expected ${book._seq + 1}, got ${entry.seq}`);
  const norm = _normalize(book, entry.postings);
  const e = { seq: entry.seq, date: entry.date || '', memo: entry.memo || '', postings: norm, by: entry.by || '', ts: entry.ts || 0, reverses: entry.reverses ?? null, importKey: entry.importKey ?? null, attachmentRefs: Array.isArray(entry.attachmentRefs) ? entry.attachmentRefs : [], invoice: entry.invoice ?? null, bill: entry.bill ?? null };
  book.journal.push(e); book._seq = entry.seq;
  return e;
}

// Reverse a prior entry by appending its mirror — the ledger is append-only, we never edit history.
export function reverse(book, seq, { date, by = '', memo } = {}) {
  const orig = book.journal.find(e => e.seq === seq);
  if (!orig) throw new Error('no entry with seq ' + seq);
  if (orig.reverses != null) throw new Error('cannot reverse a reversal');
  if (book.journal.some(e => e.reverses === seq)) throw new Error('entry #' + seq + ' is already reversed');
  // Carry the donor id onto the mirror so a reversed gift nets OUT of that donor's giving-by-member / Gift Aid
  // total (the reversal posts a dr on the income account for the same donor). _normalize drops it if absent.
  // Carry the foreign-currency annotation trio onto the mirror too (Phase 8): the reversal represents the SAME
  // foreign amount moving the other way, so origAmount/rate/currency are unchanged (amount stays base, and
  // amount === baseAmount(origAmount, rate) still holds). Omitted when the original had no annotation.
  const postings = orig.postings.map(p => ({ account: p.account, fund: p.fund, dir: p.dir === 'dr' ? 'cr' : 'dr', amount: p.amount, ...(p.currency != null ? { currency: p.currency, origAmount: p.origAmount, rate: p.rate } : {}), ...(p.donor != null ? { donor: p.donor } : {}) }));
  return post(book, { date: date || orig.date, by, reverses: seq, memo: memo || `Reversal of #${seq}${orig.memo ? ': ' + orig.memo : ''}`, postings });
}

// The set of import fingerprints already in the journal — so a re-imported bank statement can't double-count
// (each imported line carries its statement lineKey as entry.importKey; see finance-import.mjs).
export function importedKeys(book) {
  const s = new Set();
  for (const e of book.journal) if (e.importKey) s.add(e.importKey);
  return s;
}

// ── projections (everything is derived from the journal) ──

function accountNet(book) {
  const net = new Map();   // accountId -> { dr, cr }
  for (const e of book.journal) for (const p of e.postings) {
    const n = net.get(p.account) || { dr: 0, cr: 0 }; n[p.dir] += p.amount; net.set(p.account, n);
  }
  return net;
}

export function trialBalance(book) {
  const net = accountNet(book);
  const rows = [...book.accounts.values()].map(a => {
    const n = net.get(a.id) || { dr: 0, cr: 0 };
    const bal = n.dr - n.cr;                       // debit-positive
    return { account: a.id, name: a.name, type: a.type, debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0 };
  });
  // deterministic conventional order (asset→liability→equity→income→expense, then by id) so the rebuilt
  // book presents identically no matter what order its events arrived in.
  rows.sort((a, b) => ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type) || (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

// The reserved account id that carries a fund TRANSFER. A transfer is one balanced journal entry with two
// postings on this account — {fund:A,dir:'dr'} + {fund:B,dir:'cr'}, equal amounts — so it is income/
// expenditure-neutral (the account is equity, which incomeExpenditure/surplus ignore) yet moves two fund
// balances by ±X, net zero. fundBalances/closingFunds recognise it by THIS ID, never by type==='equity': a
// real equity account (e.g. opening balances) carrying a fund would otherwise be miscounted and break
// check() invariant 3 (fundSum===surplus). It is published as an ordinary replaceable finance/account doc,
// never auto-created in createBook, so an un-upgraded console can still rebuild a book that contains a transfer.
export const FUND_TRANSFER_ACCT = 'fund-transfer';

// Fund balance = accumulated surplus attributable to the fund (income credited − expenditure charged), plus
// fund transfers (a dr on the reserved account reduces its fund, a cr increases it).
export function fundBalances(book) {
  const bal = new Map();
  for (const e of book.journal) for (const p of e.postings) {
    if (!p.fund) continue;
    const a = book.accounts.get(p.account);
    if (p.account === FUND_TRANSFER_ACCT) bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'cr' ? p.amount : -p.amount));
    else if (a && a.type === 'income') bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'cr' ? p.amount : -p.amount));
    else if (a && a.type === 'expense') bal.set(p.fund, (bal.get(p.fund) || 0) + (p.dir === 'dr' ? -p.amount : p.amount));
  }
  return [...book.funds.values()].map(f => ({ fund: f.id, name: f.name, kind: f.kind, balance: bal.get(f.id) || 0 }))
    .sort((a, b) => (a.fund === 'general') - (b.fund === 'general') === 0 ? (a.fund < b.fund ? -1 : a.fund > b.fund ? 1 : 0) : (a.fund === 'general' ? -1 : 1));   // general first, then by id — deterministic
}

// ── foreign balances + revaluation (Phase 8) ─────────────────────────────────────────────────────────────
// The reserved "Unrealised FX gains/(losses)" account. A RESERVED, idempotent id (the fund-transfer / AR / AP
// pattern): the console publishes finance/account:<id> publish-if-absent and addAccount()s it locally, so an
// un-upgraded console can still rebuild a book that posts to it. Type is INCOME (pinned) so a revaluation gain
// lands in the surplus where a treasurer expects it, and a loss nets it down; check() reconciles either way
// (surplus and the general fund both move by the delta, assets move by the same delta → balance sheet holds —
// proven in finance-multicurrency.test.mjs). assertFxAccount THROWS if a hand-made account collided on the slug
// with the wrong type, so the revaluation path refuses rather than post to a non-income account. Pure, so the
// console's publish-if-absent path and the node tests share one definition.
export const FX_ACCT = 'fx-gains';
export const FX_ACCOUNT = Object.freeze({ id: FX_ACCT, code: '4990', name: 'Unrealised FX gains/(losses)', type: 'income' });
export function assertFxAccount(book) {
  const a = book && book.accounts && typeof book.accounts.get === 'function' ? book.accounts.get(FX_ACCT) : null;
  if (!a) return false;
  if (a.type !== 'income') throw new Error('reserved account ' + FX_ACCT + ' must be income (found ' + a.type + ')');
  return true;
}

// The reserved per-currency foreign CASH account. ONE account per foreign currency, id `cash-<ccy>`, an asset —
// the console auto-publishes it publish-if-absent (the AR/AP/FX pattern) and directs a foreign entry's cash leg
// HERE, never to the base `bank`. This is what ENFORCES one-currency-per-account, the invariant foreignBalances
// relies on: base `bank` only ever takes plain base postings (record() hardcodes it), and a `cash-<ccy>` account
// only ever takes that currency's receipts + its own revaluations — so no account ever mixes base cash with a
// foreign holding, and reading a foreign account's full base balance as that currency's carrying value is safe.
// A factory (id/name depend on the currency), not a frozen constant. assertForeignCashAccount THROWS if a
// hand-made account collided on the slug with a non-asset type, so the console refuses rather than post to it.
export function foreignCashAccount(currency) {
  const c = String(currency || '').trim().toUpperCase();
  if (!c) throw new Error('a foreign cash account needs a currency');
  return Object.freeze({ id: 'cash-' + c.toLowerCase(), code: c, name: c + ' cash', type: 'asset', currency: c });
}
export function assertForeignCashAccount(book, currency) {
  const { id } = foreignCashAccount(currency);
  const a = book && book.accounts && typeof book.accounts.get === 'function' ? book.accounts.get(id) : null;
  if (!a) return false;
  if (a.type !== 'asset') throw new Error('reserved account ' + id + ' must be an asset (found ' + a.type + ')');
  return true;
}

// Net foreign holding PER (account, currency): the foreign quantity `origAmount` (debit-positive Σ over the
// ANNOTATED postings) and the base carrying value `base`. This is the ONLY projection that exposes the
// per-currency foreign balance — every other projection reads base `amount`. It is the input a revaluation
// consumes (the gain/loss is round(origAmount × newRate) − base).
//
// `base` is the account's FULL ledger balance (debit-positive Σ `amount` over ALL its postings), NOT just the
// annotated ones — because a REVALUATION adjusts the base carrying value with a PLAIN base posting (no foreign
// units move, so it carries no annotation). Summing only annotated postings would ignore prior revaluations and
// a second revaluation would double-count. This assumes a foreign cash account holds a SINGLE foreign currency
// (the model the console enforces: one account per currency); if an account somehow carries two currencies, we
// fall back to the per-currency annotated base so origAmount is still right. Silent-£ books have no annotated
// posting, so this returns []; a currency netted back to zero (e.g. a reversed entry) is dropped.
export function foreignBalances(book) {
  const orig = new Map();      // `${account}\u0000${currency}` -> Σ origAmount (signed)
  const annBase = new Map();   // same key -> Σ base amount of ANNOTATED postings (the multi-currency fallback)
  const acctBase = new Map();  // account -> Σ base amount over ALL its postings (the true carrying value)
  const ccys = new Map();      // account -> Set(currency)
  for (const e of book.journal) for (const p of e.postings) {
    const s = p.dir === 'dr' ? 1 : -1;
    acctBase.set(p.account, (acctBase.get(p.account) || 0) + s * p.amount);
    if (p.currency == null) continue;
    const key = p.account + '\u0000' + p.currency;
    orig.set(key, (orig.get(key) || 0) + s * p.origAmount);
    annBase.set(key, (annBase.get(key) || 0) + s * p.amount);
    if (!ccys.has(p.account)) ccys.set(p.account, new Set());
    ccys.get(p.account).add(p.currency);
  }
  const rows = [];
  for (const [key, o] of orig) {
    if (o === 0) continue;
    const [account, currency] = key.split('\u0000');
    const single = ccys.get(account).size === 1;
    rows.push({ account, currency, origAmount: o, base: single ? acctBase.get(account) : annBase.get(key) });
  }
  return rows.sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0)));
}

// Build the APPEND-ONLY revaluation entry for a foreign balance at a new rate (NOT an edit — it rides post()).
// The foreign cash account moves by the base delta; the reserved FX income account takes the mirror. BOTH legs
// are PLAIN base (no annotation): no foreign units move, only the base valuation changes, so origAmount would be
// zero and the trio would be meaningless. Throws when the FX account is absent/wrong-type, when there is no
// foreign balance for (account, currency), or when the new rate leaves the base carrying value unchanged.
export function revalueEntry(book, { account, currency, newRate, date = '', by = '', memo = '' } = {}) {
  if (typeof newRate !== 'number' || !Number.isFinite(newRate) || newRate <= 0) throw new Error('newRate must be a positive finite number');
  if (!assertFxAccount(book)) throw new Error('reserved account ' + FX_ACCT + ' is absent — publish it before revaluing');
  const row = foreignBalances(book).find(r => r.account === account && r.currency === currency);
  if (!row) throw new Error('no foreign balance to revalue for ' + account + ' / ' + currency);
  const target = baseAmount(row.origAmount > 0 ? row.origAmount : -row.origAmount, newRate) * (row.origAmount > 0 ? 1 : -1);
  const delta = target - row.base;   // change in base carrying value (debit-positive)
  if (delta === 0) throw new Error('revaluation at that rate would not change the base carrying value');
  const amt = Math.abs(delta);
  return { date, by, memo: memo || ('FX revaluation — ' + currency + ' @ ' + newRate), postings: [
    { account, dir: delta > 0 ? 'dr' : 'cr', amount: amt },          // the foreign cash account's base value moves
    { account: FX_ACCT, dir: delta > 0 ? 'cr' : 'dr', amount: amt }, // a gain credits income; a loss debits it
  ] };
}

export function incomeExpenditure(book, { from = '', to = '￿' } = {}) {
  let income = 0, expenditure = 0;
  const byAccount = new Map();
  for (const e of book.journal) {
    if (e.date < from || e.date > to) continue;
    for (const p of e.postings) {
      const a = book.accounts.get(p.account);
      if (a.type !== 'income' && a.type !== 'expense') continue;
      const signed = a.type === 'income' ? (p.dir === 'cr' ? p.amount : -p.amount) : (p.dir === 'dr' ? p.amount : -p.amount);
      if (a.type === 'income') income += signed; else expenditure += signed;
      byAccount.set(p.account, (byAccount.get(p.account) || 0) + signed);
    }
  }
  return { income, expenditure, surplus: income - expenditure, byAccount: [...byAccount].map(([account, amount]) => ({ account, amount })) };
}

export function balanceSheet(book, { asOf = '￿' } = {}) {
  let assets = 0, liabilities = 0, equityOpening = 0;
  for (const e of book.journal) {
    if (e.date > asOf) continue;
    for (const p of e.postings) {
      const a = book.accounts.get(p.account); const s = p.dir === 'dr' ? p.amount : -p.amount;
      if (a.type === 'asset') assets += s;
      else if (a.type === 'liability') liabilities += -s;
      else if (a.type === 'equity') equityOpening += -s;
    }
  }
  const { surplus } = incomeExpenditure(book, { to: asOf });
  const funds = equityOpening + surplus;                 // net assets carried in the funds
  return { assets, liabilities, funds, surplus, equityOpening, balanced: assets - liabilities === funds };
}

// The whole-book integrity check. Returns { ok, errors } — run it anywhere a projection is trusted.
export function check(book) {
  const errors = [];
  for (const e of book.journal) {
    let dr = 0, cr = 0; for (const p of e.postings) { if (p.dir === 'dr') dr += p.amount; else cr += p.amount; }
    if (dr !== cr) errors.push(`entry #${e.seq} unbalanced: debits ${dr} ≠ credits ${cr}`);
    if (e.postings.some(p => !book.accounts.has(p.account))) errors.push(`entry #${e.seq}: references an unknown account`);
  }
  book.journal.forEach((e, i) => { if (e.seq !== i + 1) errors.push(`sequence break at index ${i}: expected ${i + 1}, got ${e.seq}`); });
  const tb = trialBalance(book);
  if (!tb.balanced) errors.push(`trial balance unbalanced: debits ${tb.totalDebit} ≠ credits ${tb.totalCredit}`);
  const surplus = incomeExpenditure(book).surplus;
  const fundSum = fundBalances(book).reduce((s, f) => s + f.balance, 0);
  if (fundSum !== surplus) errors.push(`fund balances (${fundSum}) don't reconcile to surplus (${surplus})`);
  const bs = balanceSheet(book);
  if (!bs.balanced) errors.push(`balance sheet doesn't balance: assets−liabilities (${bs.assets - bs.liabilities}) ≠ funds (${bs.funds})`);
  return { ok: errors.length === 0, errors };
}
