// src/finance-pack-ie.mjs — TrinityOne Finance: IRELAND Charitable Donation Scheme (CDS) RECLAIM pack. OFF BY DEFAULT.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// THIS IS A COUNTRY RECLAIM TOOL — LIKE GIFT AID, THE CHARITY CLAIMS. THE CORE MUST NOT IMPORT IT. The core
// finance bundle (src/finance-bundle.mjs) deliberately does NOT import this; it is bundled SEPARATELY
// (src/finance-ie-bundle.mjs -> vendor/finance-ie.js -> window.FinanceIrishCDS) and the console calls it ONLY
// when the resolved jurisdiction's active tax tool IS 'charitableDonationScheme' (gated through the owner-only
// Tax tools switch + Region picker, exactly as Gift Aid is gated). A STRUCTURAL test (finance-pack-ie.test.mjs)
// asserts this file and its bundle are absent from the core bundle's and the registry's import graphs.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
//
// VERIFIED against Revenue's Tax and Duty Manual Part 36-00-17 ("Charitable Donation Scheme", s.848A TCA 1997),
// read 2026-10-30. The figures below are quoted from it:
//   · The donation is "grossed up at the specified rate, currently 31%": grossed-up = donation × 100/(100−31).
//     The approved body reclaims the tax deemed deducted = grossed-up − donation = donation × 31/69 ≈ 44.93% of
//     the donation (NOT 31% of the donation). Revenue worked example: a €1,000 donation → deemed €1,449.28
//     (€1,000 × 100/69), tax deducted €449.28 → the body claims a refund of €449.28.
//   · Minimum: the minimum relevant donation in a year is €250 (s.848A(1)).
//   · Maximum: the maximum qualifying donation by an individual in a year is €1,000,000 (s.848A(3A)(a)(i)).
//   · Associated donor: where the donor is associated with the body (e.g. an employee or member), relief is
//     restricted to 10% of the individual's total income for the year (s.848A(3A)(a)(ii)).
//   · The refund is subject to the amount of income tax ACTUALLY PAID by the donor — Revenue checks this at
//     claim time; the church cannot know it, so the schedule reports the gross refund the body claims.
//   · The donor must have given the body a valid certificate — CHY3 (Enduring, up to 5 years) or CHY4 (annual).
//
// PURE. No DOM, no relay, no I/O, no `Date`. Period bounds injected as ISO strings. Money is INTEGER minor units
// (euro cents). Per-row rounding to the cent, matching Revenue's worked example.

export const CDS_SPECIFIED_RATE = 31;             // the "specified rate", currently 31% (per cent) — TDM 36-00-17
export const CDS_MIN_ANNUAL = 25000;              // €250.00 in cents — minimum relevant donation per year (s.848A(1))
export const CDS_MAX_ANNUAL = 100000000;          // €1,000,000.00 in cents — maximum qualifying donation per year (s.848A(3A)(a)(i))
export const CDS_ASSOCIATED_INCOME_FRACTION = 0.10; // associated donor → relief restricted to 10% of total income (s.848A(3A)(a)(ii))

// grossed-up = donation × 100/(100−rate); refund = grossed-up − donation. Rounded to the cent per row (Revenue basis).
export const cdsGrossUp = (minor, rate = CDS_SPECIFIED_RATE) => Math.round(minor * 100 / (100 - rate));
export const cdsRefund = (minor, rate = CDS_SPECIFIED_RATE) => cdsGrossUp(minor, rate) - minor;

// Build the CDS claim schedule over [from, to] inclusive for donors who have a valid CHY3/CHY4 certificate.
//
// A donor qualifies iff their finance/donor record is `eligible === true` AND carries a `certType` of 'CHY3' or
// 'CHY4' AND a `certDeclaredAt` (an ISO date). Their period giving is summed via the injected `givingByMember`
// (so the grouping rule stays in ONE place). A donor below the €250 annual minimum is left out. A qualifying
// donation is capped at €1,000,000. An ASSOCIATED donor (`associated === true`) has relief restricted to 10% of
// their `income` (minor units, their total income for the year): if that income is not on file we CANNOT compute
// the cap, so the donor is reported in `needsReview` and NOT claimed (never over-claim). The refund is the tax
// deemed deducted on the grossed-up amount; the actual payout is subject to the donor's tax paid (Revenue's check).
export function charitableDonationClaim(book, {
  donors = [], from = '', to = '￿', givingByMember,
  rate = CDS_SPECIFIED_RATE, minAnnual = CDS_MIN_ANNUAL, maxAnnual = CDS_MAX_ANNUAL,
} = {}) {
  if (typeof givingByMember !== 'function') throw new Error('charitableDonationClaim needs the givingByMember projection injected');
  const list = Array.isArray(donors) ? donors : (donors instanceof Map ? [...donors.values()] : Object.values(donors || {}));
  const byId = new Map(list.map(d => [String(d.id), d]));
  const given = new Map();
  for (const r of givingByMember(book, { from, to, donors: list })) if (r.donor) given.set(r.donor, r.amount);

  const rows = [];
  const needsReview = [];
  for (const [id, d] of byId) {
    if (!(d.eligible === true && (d.certType === 'CHY3' || d.certType === 'CHY4') && d.certDeclaredAt)) continue; // no valid cert → no claim
    const donated = given.get(id) || 0;
    if (donated < minAnnual) continue;                       // below the €250 annual minimum → not a relevant donation
    let qualifying = Math.min(donated, maxAnnual);           // capped at the €1,000,000 annual maximum
    if (d.associated === true) {
      if (!(Number.isFinite(d.income) && d.income > 0)) {    // associated but no income on file → cannot apply the 10% cap
        needsReview.push({ donor: id, name: d.name || id, donated, reason: 'associated donor — needs total income to apply the 10% relief restriction' });
        continue;
      }
      qualifying = Math.min(qualifying, Math.floor(d.income * CDS_ASSOCIATED_INCOME_FRACTION));
      if (qualifying <= 0) continue;
    }
    rows.push({
      donor: id, name: d.name || id, address: d.address || '', certType: d.certType,
      donated: qualifying, refund: cdsRefund(qualifying, rate),
    });
  }
  rows.sort((a, b) => b.donated - a.donated);
  const totalDonated = rows.reduce((s, r) => s + r.donated, 0);
  const totalRefund = rows.reduce((s, r) => s + r.refund, 0);   // per-row rounding, summed — Revenue's basis
  return { rows, needsReview, totalDonated, totalRefund, rate, from, to };
}

// The pack's "registration" surface: when the CDS tax tool is active, the console asks the pack which extra report
// formats it offers and merges them into the Reports panel. The CORE never calls this.
export function cdsReportFormats() {
  return [
    { key: 'cdsClaim', label: 'Charitable Donation Scheme claim (Ireland)', pack: 'charitableDonationScheme', build: charitableDonationClaim },
  ];
}
