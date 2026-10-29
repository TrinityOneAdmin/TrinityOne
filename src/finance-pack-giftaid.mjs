// src/finance-pack-giftaid.mjs — TrinityOne Finance: UK Gift Aid REGIONAL PACK (Phase 4b). OFF BY DEFAULT.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// THIS IS A COUNTRY. THE CORE MUST NOT IMPORT IT. (CONTEXT constraint 1; DOMAIN: nation-neutral, UK off by
// default.) The core finance bundle (src/finance-bundle.mjs) deliberately does NOT `export *` from here, so a
// church that never turns Gift Aid on never ships a line of UK tax logic in window.FinanceLedger. This module
// is bundled SEPARATELY (src/finance-giftaid-bundle.mjs -> vendor/finance-giftaid.js -> window.FinanceGiftAid)
// and the console only ever calls it when `church.features.giftAid === true` (strict ===, NOT the default-on
// `!== false` convention — that would turn a UK scheme on for every church in the world). A STRUCTURAL test
// (finance-pack-giftaid.test.mjs) asserts this file is absent from the core bundle's import graph.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
//
// PURE. No DOM, no relay, no I/O — and NO `Date` of its own (CONTEXT: a pure module that calls new Date()
// reintroduces the UTC off-by-one). The period bounds are injected by the caller as ISO 'YYYY-MM-DD' strings.
// Money stays INTEGER minor units (pence). The claim is built straight off the journal + the donor records and
// reconciles to the penny.
//
// WHAT HMRC WANTS, modelled at the level a small church actually claims:
//   · Gift Aid proper — 25p reclaimed per £1 given (basic-rate 20% grossed up), for donations from donors who
//     have made a Gift Aid DECLARATION and are marked eligible. The R68/online schedule aggregates per donor:
//     title, first name, last name, house name/number, postcode, total donated, date range.
//   · GASDS (Gift Aid Small Donations Scheme) — the same 25% top-up on SMALL cash/contactless donations for
//     which there is NO declaration, each donation at or under a per-donation ceiling (£30), capped at an
//     annual small-donations limit (£8,000 of donations → £2,000 top-up). Both ceilings are parameters.

// 25p per £1 = a quarter. Expressed as a fraction so the arithmetic stays integer-exact and auditable; HMRC
// rounds each claim line, so we round to the nearest penny per donor row (not once at the end).
export const GIFT_AID_RATE = 0.25;                 // basic rate 20% grossed up: 20/(100-20) = 0.25
export const GASDS_MAX_PER_DONATION = 3000;        // £30.00 in pence — the per-donation small-donations ceiling
export const GASDS_ANNUAL_CAP = 800000;            // £8,000.00 in pence — the annual small-donations limit
const topUp = (minor, rate) => Math.round(minor * rate);

// Build the Gift Aid claim schedule for ELIGIBLE donors ONLY, over [from, to] inclusive.
//
// A donor qualifies iff their finance/donor record is `eligible === true` AND carries a `giftAidDeclaredAt`
// (an ISO date — the declaration HMRC requires; without it there is no claim, only GASDS). Donations are the
// income postings tagged with that donor's opaque id (givingByMember's grouping), summed per donor. A donor
// with no qualifying donation in the period is left OUT of the schedule (an empty claim line is not a claim).
//
// `book` is a finance-ledger book; `donors` is an array of finance/donor records ({ id, name, eligible,
// giftAidDeclaredAt, address?, postcode?, title?, firstName?, lastName?, house? }) or a Map id->record.
// `givingByMember` is injected (the core report fn) so this pack does not re-import finance-reports and the
// grouping rule stays in ONE place.
export function giftAidClaim(book, { donors = [], from = '', to = '￿', rate = GIFT_AID_RATE, givingByMember } = {}) {
  if (typeof givingByMember !== 'function') throw new Error('giftAidClaim needs the givingByMember projection injected');
  const list = Array.isArray(donors) ? donors : (donors instanceof Map ? [...donors.values()] : Object.values(donors || {}));
  const byId = new Map(list.map(d => [String(d.id), d]));
  const given = new Map();   // donorId -> amount given in period (minor units)
  for (const r of givingByMember(book, { from, to, donors: list })) if (r.donor) given.set(r.donor, r.amount);

  const rows = [];
  for (const [id, d] of byId) {
    if (!(d.eligible === true && d.giftAidDeclaredAt)) continue;   // not an eligible, declared donor → no Gift Aid
    const donated = given.get(id) || 0;
    if (donated <= 0) continue;                                    // nothing given this period → no claim line
    rows.push({
      donor: id,
      title: d.title || '', firstName: d.firstName || '', lastName: d.lastName || '',
      name: d.name || id, house: d.house || '', postcode: d.postcode || '',
      donated, giftAid: topUp(donated, rate),
    });
  }
  rows.sort((a, b) => b.donated - a.donated);
  const totalDonated = rows.reduce((s, r) => s + r.donated, 0);
  const totalGiftAid = rows.reduce((s, r) => s + r.giftAid, 0);   // per-row rounding, summed — HMRC's basis
  return { rows, totalDonated, totalGiftAid, rate, from, to };
}

// GASDS — the top-up on small donations that have NO Gift Aid declaration. `donations` is a list of individual
// small-donation amounts (minor units). Only donations AT OR UNDER maxPerDonation count; the counted total is
// then capped at annualCap, and the top-up is `rate` of the capped total. Returns the figures a treasurer
// needs AND the amounts that were excluded, so the screen can explain why a claim is smaller than the cash.
export function gasdsSmallDonations(donations = [], { maxPerDonation = GASDS_MAX_PER_DONATION, annualCap = GASDS_ANNUAL_CAP, rate = GIFT_AID_RATE } = {}) {
  const amounts = (donations || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  const eligible = amounts.filter(n => n <= maxPerDonation);
  const tooLarge = amounts.filter(n => n > maxPerDonation);
  const eligibleTotal = eligible.reduce((s, n) => s + n, 0);
  const cappedTotal = Math.min(eligibleTotal, annualCap);          // the annual small-donations limit
  return {
    count: eligible.length,
    eligibleTotal,                         // small donations that qualify, before the annual cap
    cappedTotal,                           // the amount the top-up is actually claimed on
    overCap: Math.max(0, eligibleTotal - annualCap),
    excludedOverLimit: tooLarge.reduce((s, n) => s + n, 0),   // donations too large to be "small" (declaration route instead)
    topUp: topUp(cappedTotal, rate),
    maxPerDonation, annualCap, rate,
  };
}

// The pack's "registration" surface: when the toggle is on, the console asks the pack which extra report
// formats it offers, and merges them into the Reports panel. The CORE never calls this — it is the additive
// seam that keeps UK tax out of the nation-neutral core (CONTEXT constraint 1). Kept here (not in the core
// report list) on purpose.
export function giftAidReportFormats() {
  return [
    { key: 'giftaid', label: 'Gift Aid claim (UK)', pack: 'giftAid', build: giftAidClaim },
    { key: 'gasds', label: 'GASDS small donations (UK)', pack: 'giftAid', build: gasdsSmallDonations },
  ];
}
