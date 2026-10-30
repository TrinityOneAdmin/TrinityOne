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
// record for the donor. Countries whose valid receipt needs a prescribed official template or church-registration
// data we do not yet collect (Canada s.3501 serial/registration/signature; Germany §50 EStDV official template;
// France Cerfa 11580; South Africa s18A + IT3(d); Australia DGR; Netherlands periodic-gift agreement; Ireland
// reclaim) are DELIBERATELY ABSENT and must not be added until their wording is verified — see the registry.
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
export function contributionStatementDoc(stmt, { orgName = '', disclaimer = '', money = (m) => String(m) } = {}) {
  const s = stmt || {};
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const period = (s.from || '') + (s.to && s.to !== '￿' ? ' to ' + s.to : '');
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
    + (disclaimer ? `<p class="tax-disclaimer"><small>${esc(disclaimer)}</small></p>` : '')
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
