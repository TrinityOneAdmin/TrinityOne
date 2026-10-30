// src/finance-jurisdictions.mjs — TrinityOne Finance: the JURISDICTION REGISTRY (wave 3). PURE, DATA-ONLY.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// NEUTRAL METADATA, NOT A COUNTRY PACK. This file holds NO tax math. It declares, per jurisdiction, three
// things: the DEFAULT book currency, the donor field set + labels, and the STRING KEY of the tax tool that is
// active ('giftAid' | 'contributionStatement' | null). The actual tax ENGINE stays in its own separate bundle
// (src/finance-pack-giftaid.mjs -> window.FinanceGiftAid); this registry only NAMES it. So this module MUST
// NOT import any country pack, and it is safe to ship in the CORE finance bundle (src/finance-bundle.mjs) — a
// church on 'None' still ships no tax logic. A STRUCTURAL test (finance-pack-giftaid.test.mjs) asserts both
// that the core bundle and THIS module are absent the pack from their import graphs.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
//
// PURE. No DOM, no relay, no I/O — and NO `Date` (the pack's rule: a pure module that calls new Date()
// reintroduces the UTC off-by-one). Adding a jurisdiction is adding ONE entry below — no UI surgery.
//
// DOMAIN: nation-neutral by default. The DEFAULT is 'None', and 'None' keeps the pilot's silent-£ book
// (GBP, 2 decimals, calendar year) — changing that default is an owner decision, not this file's to make.
//
// WHERE THE SETTING LIVES (owner decision, 2026-10-30): on the CHURCH PROFILE as church.features.jurisdiction
// (owner-only, written via publishProfile — exactly where features.giftAid lived), NOT on finance/settings.
// So resolveJurisdiction() reads `features`, and a delegated finance steward cannot change it. The currency
// DEFAULT it yields is applied to an EMPTY book through the steward-writable finance/settings seed, so a
// steward still manages currency afterwards without ever being able to change the jurisdiction.

// NOTE (UK fiscal-year start): the UK personal tax year starts 6 April, but a charity may keep any year end,
// and changing fiscalYearStart only moves report boundaries (it never reinterprets a stored amount). The owner
// DECIDED (2026-10-30) a fresh UK book defaults to '04-06' (the UK tax-year start), so None and UK now seed
// DIFFERENT fiscal-year starts ('01-01' vs '04-06') — the GBP base + 2 decimals stay identical. A steward can
// still change the year end afterwards; only the empty-book default moved.

// A tax tool must NEVER present its figures as authoritative (owner request 2026-10-30). This is the ONE shared
// constant: EVERY tax surface (the Gift Aid panel, the contribution-statement panel, the Region/Tax-tools subcard)
// AND every EXPORTED tax document (the Gift Aid claim CSV, each generated giving statement) pulls THIS string and
// never retypes it — so a tax figure can never leave the app without the caveat. It ships in the core bundle
// (window.FinanceLedger.TAX_DISCLAIMER); the separate packs receive it by injection from the caller.
export const TAX_DISCLAIMER = 'A best-effort guide, not tax advice — tax rules change, sometimes overnight, so always check these figures against your tax authority’s current guidance (or your accountant) before you file or claim.';

export const JURISDICTIONS = {
  None: {
    id: 'None',
    label: 'None (neutral)',
    currency: { base: 'GBP', decimals: 2, fiscalYearStart: '01-01' },   // silent-£, the pilot default
    donor: { fields: ['name'], labels: { name: 'Name' } },
    taxTool: null,
  },
  UK: {
    id: 'UK',
    label: 'United Kingdom',
    currency: { base: 'GBP', decimals: 2, fiscalYearStart: '04-06' },   // UK tax-year start (owner decision 2026-10-30); see note above
    donor: {
      fields: ['title', 'firstName', 'lastName', 'name', 'house', 'address', 'postcode', 'eligible', 'giftAidDeclaredAt'],
      labels: {
        name: 'Name',
        eligible: 'Has made a Gift Aid declaration (UK)',
        address: 'Address (for a Gift Aid claim)',
        postcode: 'Postcode',
        giftAidDeclaredAt: 'Declaration date',
      },
    },
    taxTool: 'giftAid',
  },
  // ── US — SHIPPED (expansion wave, 2026-10-30). A year-end per-donor CONTRIBUTION STATEMENT: an annual giving
  //    summary the DONOR uses for their own deduction — NO church rebate, NO church filing (unlike Gift Aid). The
  //    engine is the SHARED src/finance-pack-contribution.mjs (window.FinanceContribution). The statement a church
  //    produces IS the valid written acknowledgment: IRS Pub 1771 blesses an annual summary that carries the org
  //    name, the amount/date(s), and the "no goods or services … other than intangible religious benefits"
  //    statement (that fixed wording lives as DATA in the pack's STATEMENT_RULES.US, traced to Pub 1771).
  US: {
    id: 'US',
    label: 'United States',
    currency: { base: 'USD', decimals: 2, fiscalYearStart: '01-01' },   // SUGGESTED default only — currency is a free, independent Book setting
    donor: { fields: ['name', 'address'], labels: { name: 'Name', address: 'Mailing address' } },
    taxTool: 'contributionStatement',
  },
  // ── NZ — SHIPPED (expansion wave). Same shared CONTRIBUTION-STATEMENT engine. The DONOR claims a 33.33%
  //    donation tax credit from Inland Revenue (NOT a church reclaim), and IRD requires a receipt per claimed
  //    donation. A receipt showing the donee-org name, the donor, the amount/date and that no goods/services were
  //    received is what IRD wants (STATEMENT_RULES.NZ, traced to ird.govt.nz) — no prescribed template to miss.
  NZ: {
    id: 'NZ',
    label: 'New Zealand',
    currency: { base: 'NZD', decimals: 2, fiscalYearStart: '04-01' },   // NZ tax year 1 Apr–31 Mar; SUGGESTED default only
    donor: { fields: ['name', 'address'], labels: { name: 'Name', address: 'Postal address' } },
    taxTool: 'contributionStatement',
  },
  // ── DESIGNED, HELD — NOT shipped this wave (CLAUDE.md rule 4 / owner: never ship guessed mandatory wording).
  //    Each of these has a real charitable-giving scheme (see PLAN-JURISDICTION-EXPANSION-2026-10-30.md), but its
  //    VALID receipt needs a prescribed official template or church-registration data we do not yet collect, so it
  //    is NOT a live region (the Region picker lists ACTUAL schemes only; currency for these churches is handled by
  //    the free Book-settings currency picker, no region needed). Flip each on in a focused wave once its receipt
  //    wording is verified and the per-church registration gate is built:
  //      · Canada (CA, CAD)  — official receipt is PRESCRIBED by Income Tax Reg. s.3501 (unique serial number,
  //        BN/registration number, CRA web address, authorised signature, split-receipting). HELD: those fields
  //        are church-registration data we don't collect; a summary without them is not a valid CRA receipt.
  //      · Australia (AU, AUD, FY 07-01) — deductible only via a DGR; a church is NOT a DGR in its own right.
  //        HELD: needs an explicit "this church operates a DGR fund (ABN …)" gate before any deductible receipt.
  //      · Germany (DE, EUR)  — Zuwendungsbestätigung on the OFFICIAL template (§50 EStDV / BMF 07.11.2013).
  //        HELD: the deduction depends on matching that prescribed template.
  //      · France (FR, EUR)   — reçu fiscal on the Cerfa 11580 model + a post-2021 annual declaration. HELD: form.
  //      · Netherlands (NL, EUR) — ANBI; the deductible instrument is a 5-year PERIODIC-GIFT AGREEMENT, not a
  //        receipt. HELD: a plain summary is not the instrument.
  //      · South Africa (ZA, ZAR, FY 03-01) — s18A receipt (prescribed content) PLUS an IT3(d) filing duty the
  //        church inherits. HELD: receipt wording + the filing obligation need verification + a gate.
  //      · Ireland (IE, EUR)  — the one new RECLAIM scheme (church claims money back, like Gift Aid): a blended
  //        31% GROSSED-UP refund (= donation × 0.31/0.69 ≈ 44.93%), €250/yr minimum, CHY3/CHY4 certificates, caps.
  //        HELD by explicit owner instruction: reclaim math ships only after Revenue's current rate/caps are
  //        re-confirmed and legal signs off. Its engine (src/finance-pack-ie.mjs) is deliberately ABSENT for now.
};

export const DEFAULT_JURISDICTION = 'None';

// The list the owner-only picker renders its options from — DATA, so a new jurisdiction needs no UI change.
export function listJurisdictions() {
  return Object.values(JURISDICTIONS).map(j => ({ id: j.id, label: j.label }));
}

// The Region picker lists ONLY jurisdictions that carry an ACTUAL tax scheme (taxTool != null) — currency is a
// FREE, independent Book setting, so a currency-only place is NOT a region (owner model 2026-10-30). 'None' has a
// null taxTool (it is the switch being off), so this naturally excludes it. Encoding the rule here means a future
// currency-only / designed-but-held entry can never leak into the picker.
export function listTaxRegions() {
  return Object.values(JURISDICTIONS).filter(j => j.taxTool != null).map(j => ({ id: j.id, label: j.label }));
}

// The pack record for an id, or the neutral default for an unknown/empty id (never throws).
export function getJurisdiction(id) {
  return JURISDICTIONS[id] || JURISDICTIONS[DEFAULT_JURISDICTION];
}

// Resolve the active jurisdiction id from the church profile. Computed on READ — no stored document changes
// until a church actively picks one. The owner-only "Tax tools" SWITCH (church.features.taxTools) gates
// everything, and 'None' is its OFF state (owner decision 2026-10-30):
//   taxOn = taxTools === true  OR  (taxTools === undefined AND the legacy giftAid boolean is true)   // MIGRATION
//   · !taxOn                                        -> 'None';
//   · taxOn + a KNOWN non-None features.jurisdiction -> it wins;
//   · taxOn + legacy giftAid === true                -> 'UK';
//   · taxOn, nothing set                             -> 'UK' (the sole tax region; the switch being on implies one).
// BACK-COMPAT: an existing UK church (giftAid:true, no taxTools) reads as switch-ON + UK — Gift Aid keeps
// working untouched, and the panel shows the switch ON.
export function resolveJurisdiction({ features } = {}) {
  const f = features || {};
  const taxOn = f.taxTools === true || (f.taxTools === undefined && f.giftAid === true);
  if (!taxOn) return 'None';
  if (f.jurisdiction && f.jurisdiction !== 'None' && JURISDICTIONS[f.jurisdiction]) return f.jurisdiction;
  if (f.giftAid === true) return 'UK';
  return 'UK';
}

// The three things a pack drives. Each takes an id (as returned by resolveJurisdiction) and reads DATA only.
export function currencyDefaults(id) { return getJurisdiction(id).currency; }       // drives the empty-book currency default
export function donorFields(id)      { return getJurisdiction(id).donor.fields; }   // donor field set (extensibility; form still gates binary this round)
export function donorLabels(id)      { return getJurisdiction(id).donor.labels; }   // donor labels
export function taxToolFor(id)       { return getJurisdiction(id).taxTool; }        // 'giftAid' | 'contributionStatement' | null
