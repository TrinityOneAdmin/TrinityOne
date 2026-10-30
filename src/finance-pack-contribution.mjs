// src/finance-pack-contribution.mjs — TrinityOne Finance: the SHARED CONTRIBUTION-STATEMENT pack. OFF BY DEFAULT.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// THIS IS A COUNTRY TOOL. THE CORE MUST NOT IMPORT IT. (Same rule as the Gift Aid pack / DOMAIN nation-neutral.)
// The core finance bundle (src/finance-bundle.mjs) deliberately does NOT import this; a church that never turns a
// tax tool on never ships a line of it in window.FinanceLedger. This module is bundled SEPARATELY
// (src/finance-contribution-bundle.mjs -> vendor/finance-contribution.js -> window.FinanceContribution) and the
// console only ever calls it when the resolved jurisdiction's active tax tool IS 'contributionStatement' (gated
// through the owner-only Tax tools switch + Region picker, exactly as Gift Aid is gated). A STRUCTURAL test
// (finance-pack-contribution.test.mjs) asserts this file and its bundle are absent from the core bundle's and the
// registry's import graphs.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT THIS IS (and is NOT). A CONTRIBUTION STATEMENT is a per-donor, year-end summary of the gifts a donor made
// to this church — the DONOR uses it for their own tax deduction. There is NO church rebate and NO state filing
// by the church (that is what separates it from Gift Aid / a reclaim scheme). The MATH is identical in every
// country: sum each donor's gifts over [from, to]. What differs country to country is the REQUIRED fields and the
// fixed legal WORDING the receipt must carry — that is DATA in STATEMENT_RULES below, each entry traced to the
// official source, NOT bespoke math.
//
// CORRECTNESS (CLAUDE.md rule 4 / project safety): a country appears in STATEMENT_RULES ONLY where its receipt
// requirement is confirmed against an official source and the statement a church can actually produce IS a valid
// record for the donor. SHIPPED: US (Pub 1771), New Zealand (IRD), and Canada (CRA s.3501 — the full official-
// receipt field list, verified 2026-10-30; it needs the church's CRA registration number + an authorised
// signatory, captured owner-only on church.features and threaded in by the caller, plus a unique serial). STILL
// HELD and DELIBERATELY ABSENT until their prescribed wording/template is verified: Germany (§50 EStDV official
// Muster), France (Cerfa 11580), South Africa (s18A — the mandatory field set changed in 2023/2026 and could not
// be confirmed against a current SARS source this round), Netherlands (the deductible instrument is a periodic-
// gift AGREEMENT, not a church receipt), Australia (an ordinary church is NOT a DGR, so a deductible receipt is
// wrong unless it runs a registered DGR fund). Ireland's RECLAIM scheme lives in its OWN pack (finance-pack-ie).
//
// PURE. No DOM, no relay, no I/O — and NO `Date` of its own (a pure module that calls new Date() reintroduces the
// UTC off-by-one). Period bounds are injected by the caller as ISO 'YYYY-MM-DD' strings. Money stays INTEGER
// minor units. CURRENCY-AGNOSTIC: the engine works in minor units and never reads the book's base currency, so a
// jurisdiction whose suggested default is EUR runs identically on a USD or GBP book (currency is an independent
// Book setting, decoupled from the tax scheme).

// The per-jurisdiction receipt DATA. Each entry is traced to its official source. `statement` is the fixed line
// the receipt must carry; `requiredFields` names what the receipt must show; the threshold notes are the
// donor-side figures a church may surface (they are NOT used to drop donors from the summary — a church issues a
// full statement; the threshold is information, not a filter).
export const STATEMENT_RULES = {
  US: {
    label: 'United States',
    requiredFields: ['orgName', 'name', 'total', 'period'],   // IRS Pub 1771: org name, amount, and date(s), + the statement below
    ackThreshold: 25000,                                      // $250.00 in cents — a WRITTEN ACKNOWLEDGMENT is required for any single gift ≥ $250
    statement: 'No goods or services were provided in exchange for these contributions, other than intangible religious benefits.',
    source: 'IRS Publication 1771 — Charitable Contributions: Substantiation and Disclosure Requirements (irs.gov)',
  },
  NZ: {
    label: 'New Zealand',
    requiredFields: ['orgName', 'name', 'total', 'period'],   // IRD: donee org name, donor, amount, date; a receipt is required to claim
    minClaim: 500,                                            // $5.00 in cents — the donation tax credit applies to gifts of $5 or more
    statement: 'Donation to an approved donee organisation. No goods or services were received in return. Retain this receipt to claim your donation tax credit.',
    source: 'Inland Revenue New Zealand — Tax credits for donations (ird.govt.nz)',
  },
  // CANADA — an OFFICIAL DONATION RECEIPT (Income Tax Regulations s.3501). Unlike US/NZ it is NOT a single annual
  // summary: each receipt is PER DONOR and carries a UNIQUE SERIAL, the charity's CRA registration number, place +
  // date of issue, the donor's name/address, the gift amount, the eligible amount, an authorised signature line,
  // and the CRA name + website. The DONOR claims a non-refundable credit; the church reclaims nothing. The fixed
  // strings here are DATA, traced to CRA's "What information must be on an official donation receipt" (2026-10-30).
  CA: {
    label: 'Canada',
    requiredFields: ['officialReceiptLine', 'serial', 'orgName', 'orgAddress', 'regNumber', 'placeOfIssue', 'dateGift', 'dateIssued', 'name', 'donorAddress', 'amount', 'advantage', 'eligibleAmount', 'signature', 'authorityName', 'authorityUrl'],
    perDonorReceipt: true,   // one serial-numbered OFFICIAL receipt per donor, not a single summary table
    needsReg: true,          // the church must supply its CRA registration number (+ an authorised signatory)
    regLabel: 'CRA charity registration number',
    officialReceiptLine: 'Official receipt for income tax purposes',
    authorityName: 'Canada Revenue Agency',
    authorityUrl: 'canada.ca/charities-giving',
    statement: '',           // CA's required wording is the officialReceiptLine on each receipt, not a summary line
    source: 'Canada Revenue Agency — What information must be on an official donation receipt (Income Tax Regulations s.3501), canada.ca',
  },
};

// Build the per-donor contribution statement over [from, to] inclusive, for the given jurisdiction.
//
// `book` is a finance-ledger book; `donors` is an array of finance/donor records ({ id, name, address? }) or a
// Map id->record. `givingByMember` is injected (the core report fn) so this pack does not re-import
// finance-reports and the grouping rule stays in ONE place — exactly as the Gift Aid pack does. Donations are the
// income postings tagged with a donor's opaque id, summed per donor; an unattributed (no-donor) gift carries no
// record and so never appears on a named statement. A donor with no giving in the period is left out (an empty
// statement is not a statement).
export function contributionStatement(book, { donors = [], from = '', to = '￿', givingByMember, jurisdiction = '' } = {}) {
  if (typeof givingByMember !== 'function') throw new Error('contributionStatement needs the givingByMember projection injected');
  const list = Array.isArray(donors) ? donors : (donors instanceof Map ? [...donors.values()] : Object.values(donors || {}));
  const byId = new Map(list.map(d => [String(d.id), d]));
  const given = new Map();   // donorId -> amount given in period (minor units)
  for (const r of givingByMember(book, { from, to, donors: list })) if (r.donor) given.set(r.donor, r.amount);

  const rows = [];
  for (const [id, d] of byId) {
    const total = given.get(id) || 0;
    if (total <= 0) continue;                                 // nothing given this period → no statement line
    rows.push({ donor: id, name: d.name || id, address: d.address || '', total });
  }
  rows.sort((a, b) => b.total - a.total);
  const totalDonated = rows.reduce((s, r) => s + r.total, 0);
  const rule = STATEMENT_RULES[jurisdiction] || {};
  return {
    rows, totalDonated, from, to, jurisdiction,
    statement: rule.statement || '',        // the fixed legal line the receipt must carry (DATA, sourced)
    source: rule.source || '',
    requiredFields: rule.requiredFields || ['name', 'total'],
  };
}

// Build the EXPORTED statement document a church hands a donor / keeps on file — a pure HTML string (no DOM).
// Embeds the per-donor rows, the sourced statement wording, the official source line, AND the tax `disclaimer`
// passed in by the caller (the ONE shared constant — see window.FinanceLedger.TAX_DISCLAIMER; it is NOT retyped
// here, so a tax figure can never leave the app without the caveat). `money` formats a minor-unit integer for
// display; inject the console's formatter, else it falls back to the raw integer. HTML-escapes every field (a
// donor name/address is free text).
export function contributionStatementDoc(stmt, opts = {}) {
  const s = stmt || {};
  const {
    orgName = '', orgAddress = '', regNumber = '', authorizedBy = '', placeOfIssue = '',
    dateIssued = '', disclaimer = '', money = (m) => String(m),
  } = opts;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rule = STATEMENT_RULES[s.jurisdiction] || {};
  const period = (s.from || '') + (s.to && s.to !== '￿' ? ' to ' + s.to : '');
  const year = (s.from || dateIssued || '').slice(0, 4);
  const discP = disclaimer ? `<p class="tax-disclaimer"><small>${esc(disclaimer)}</small></p>` : '';

  // CANADA (and any future perDonorReceipt jurisdiction): one OFFICIAL, serial-numbered receipt per donor, with
  // every CRA-required field. The serial is UNIQUE per donor per fiscal year ("YEAR-donorId") — CRA requires a
  // unique serial, and a church issues one annual receipt per donor, so a reprint correctly bears the same number.
  // A missing registration number renders a VISIBLE placeholder (never silently absent) so nothing invalid ships
  // unnoticed; the console also warns before export.
  if (rule.perDonorReceipt) {
    const regLine = regNumber
      ? `${esc(rule.regLabel || 'Registration number')}: ${esc(regNumber)}`
      : `${esc(rule.regLabel || 'Registration number')}: [REQUIRED — enter it in Tax tools]`;
    const receipts = (s.rows || []).map(r => {
      const serial = (year ? year + '-' : '') + String(r.donor);
      return '<section class="receipt" style="page-break-after:always;border:1px solid #ccc;padding:12px;margin:0 0 12px">'
        + `<h2>${esc(rule.officialReceiptLine || 'Official receipt')}</h2>`
        + `<p>Receipt no.: ${esc(serial)}</p>`
        + `<p>${esc(orgName)}${orgAddress ? ', ' + esc(orgAddress) : ''}</p>`
        + `<p>${regLine}</p>`
        + `<p>Issued: ${esc(dateIssued || period)}${placeOfIssue ? ' · ' + esc(placeOfIssue) : ''}</p>`
        + `<p>Donor: ${esc(r.name)}${r.address ? ', ' + esc(r.address) : ''}</p>`
        + `<p>Gift received in: ${esc(period || year)}</p>`
        + `<p>Amount of gift: ${esc(money(r.total))} · Value of advantage: ${esc(money(0))} · Eligible amount: ${esc(money(r.total))}</p>`
        + `<p>Authorised signature: ${esc(authorizedBy)} _______________________</p>`
        + `<p><small>${esc(rule.authorityName || '')}${rule.authorityUrl ? ' — ' + esc(rule.authorityUrl) : ''}</small></p>`
        + discP
        + '</section>';
    }).join('');
    return '<!doctype html><html><head><meta charset="utf-8">'
      + `<title>Official donation receipts${orgName ? ' — ' + esc(orgName) : ''}</title></head><body>`
      + `<h1>Official donation receipts${orgName ? ' — ' + esc(orgName) : ''}</h1>`
      + (receipts || '<p>No attributed giving in this period.</p>')
      + '</body></html>';
  }

  // US / NZ: a single annual giving-summary document (the donor's own record).
  const body = (s.rows || []).map(r =>
    `<tr><td>${esc(r.name)}</td><td>${esc(r.address)}</td><td style="text-align:right">${esc(money(r.total))}</td></tr>`).join('');
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<title>Annual giving statement${orgName ? ' — ' + esc(orgName) : ''}</title></head><body>`
    + '<h1>Annual giving statement</h1>'
    + (orgName ? `<p>${esc(orgName)}</p>` : '')
    + (period ? `<p>Period: ${esc(period)}</p>` : '')
    + `<table><thead><tr><th>Donor</th><th>Address</th><th>Total</th></tr></thead><tbody>${body}</tbody>`
    + `<tfoot><tr><td></td><td style="text-align:right">Total</td><td style="text-align:right">${esc(money(s.totalDonated || 0))}</td></tr></tfoot></table>`
    + (s.statement ? `<p>${esc(s.statement)}</p>` : '')
    + (s.source ? `<p><small>Source: ${esc(s.source)}</small></p>` : '')
    + discP
    + '</body></html>';
}

// The pack's "registration" surface: when a contributionStatement jurisdiction is active, the console asks the
// pack which extra report formats it offers and merges them into the Reports panel. The CORE never calls this.
// (Keyed 'givingStatement', NOT 'statement' — the core already ships an aggregate FINANCIAL statement under
// src/finance-statement.mjs; these are different things and must not collide.)
export function contributionReportFormats() {
  return [
    { key: 'givingStatement', label: 'Annual giving statement', pack: 'contributionStatement', build: contributionStatement },
  ];
}
