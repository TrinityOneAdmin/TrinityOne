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
  // ── CA — SHIPPED (receipts/reclaim wave, 2026-10-30). CANADA official donation receipt via the SHARED
  //    contribution-statement engine (window.FinanceContribution, perDonorReceipt mode). Full field list VERIFIED
  //    against CRA "What information must be on an official donation receipt" (Income Tax Reg. s.3501). It needs
  //    the church's CRA registration number + an authorised signatory — captured OWNER-ONLY on church.features
  //    (see taxRegLabel) and threaded into the receipt — plus a unique serial (YEAR-donorId). The DONOR claims a
  //    non-refundable credit; the church reclaims nothing.
  CA: {
    id: 'CA',
    label: 'Canada',
    currency: { base: 'CAD', decimals: 2, fiscalYearStart: '01-01' },   // SUGGESTED default only — currency is a free Book setting
    donor: { fields: ['name', 'address'], labels: { name: 'Name', address: 'Address (for the receipt)' } },
    taxTool: 'contributionStatement',
  },
  // ── IE — SHIPPED (receipts/reclaim wave). IRELAND Charitable Donation Scheme — a RECLAIM tool (the CHARITY
  //    claims, like Gift Aid), in its OWN pack src/finance-pack-ie.mjs (window.FinanceIrishCDS). Math VERIFIED
  //    against Revenue TDM 36-00-17: specified rate 31% grossed up ×100/(100−31) (refund ≈44.93% of the gift),
  //    €250/yr minimum, €1,000,000/yr maximum, 10%-of-income restriction for an associated donor. Per-church gate:
  //    the owner-only Tax tools switch is the "approved body" confirmation; each donor needs a CHY3 (enduring) or
  //    CHY4 (annual) certificate (certType + certDeclaredAt + eligible), mirroring Gift Aid's declaration.
  IE: {
    id: 'IE',
    label: 'Ireland',
    currency: { base: 'EUR', decimals: 2, fiscalYearStart: '01-01' },   // SUGGESTED default only
    donor: {
      fields: ['name', 'address', 'eligible', 'certType', 'certDeclaredAt'],
      labels: {
        name: 'Name',
        eligible: 'Has given a CHY3/CHY4 certificate (Ireland)',
        address: 'Address',
        certType: 'Certificate type (CHY3 enduring / CHY4 annual)',
        certDeclaredAt: 'Certificate date',
      },
    },
    taxTool: 'charitableDonationScheme',
  },
  // ── ZA — SHIPPED (EU/ZA receipts wave, 2026-10-30). SOUTH AFRICA section 18A donation receipt via the SHARED
  //    contribution-statement engine (perDonorReceipt mode). The FURTHER donor fields are VERIFIED from SARS
  //    Notice 6762 of 2025 (GG 53589) under s.18A(2)(a)(vii), in force 1 March 2026. Needs the church's s18A/PBO
  //    reference number (captured owner-only; see taxRegLabel) + a unique receipt number (YEAR-donorId). Only an
  //    s18A-approved PBO may issue it — opt-in like Gift Aid. The donor fields below carry the prescribed PII.
  ZA: {
    id: 'ZA',
    label: 'South Africa',
    currency: { base: 'ZAR', decimals: 2, fiscalYearStart: '03-01' },   // SA tax year 1 Mar–end Feb; SUGGESTED default only
    donor: {
      fields: ['name', 'address', 'natureOfPerson', 'idType', 'idNumber', 'taxRef', 'contactNumber', 'email', 'tradingName'],
      labels: {
        name: 'Name',
        address: 'Address',
        natureOfPerson: 'Nature of person (natural person / company / trust …)',
        idType: 'ID type & country of issue',
        idNumber: 'ID / registration number',
        taxRef: 'Income-tax reference number',
        contactNumber: 'Contact number',
        email: 'Email address',
        tradingName: 'Trading name (if different)',
      },
    },
    taxTool: 'contributionStatement',
  },
  // ── STILL DESIGNED + HELD — NOT live (CLAUDE.md rule 4: never ship an outdated/unverified prescribed form —
  //    a wrong form is a receipt the tax office REJECTS). Each blocker below is the reason it is not yet a region
  //    (currency for these churches is the free Book-settings picker):
  //      · Germany (DE, EUR)  — Zuwendungsbestätigung: ≈18 BINDING BMF "Muster" whose text must be reproduced
  //        VERBATIM per donation type. The CURRENT templates (BMF Formularcenter) could not be retrieved/rendered
  //        this round, so we cannot reproduce them faithfully. HELD. (A simplified proof exists for gifts ≤ €300
  //        — NOT the receipt.)
  //      · France (FR, EUR)   — reçu fiscal: the Cerfa 11580 version is in flux (*04 vs *05) and the official
  //        model text (impots.gouv.fr / arrêté 26 June 2008 / BOFiP BOI-IR-RICI-250-40) could not be rendered via
  //        available tools this round. The mentions are known from secondary sources but NOT pinned to a current
  //        official source, and the version matters — HELD until the current *NN model is confirmed.
  //      · Netherlands (NL, EUR) — the deduction instrument is a 5-year PERIODIC-GIFT AGREEMENT (periodieke gift),
  //        NOT a per-donation receipt. It needs its OWN tool (a distinct taxTool that generates the Belastingdienst
  //        agreement document: donor + ANBI RSIN/transaction number + fixed annual amount + duration ≥5yr +
  //        signatures), not the receipt engine. HELD as a scoped follow-up — do not force it into the receipt shape.
  //      · Australia (AU, AUD, FY 07-01) — an ordinary church is NOT a DGR, so donations are not deductible and a
  //        receipt would be wrong; correct default is currency-only (no region). A DGR-gated receipt is a future
  //        option ONLY for a church that confirms it operates a registered DGR fund (ABN) — we do not invent it.
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
export function taxToolFor(id)       { return getJurisdiction(id).taxTool; }        // 'giftAid' | 'contributionStatement' | 'charitableDonationScheme' | null

// Does this jurisdiction's receipt need the church to supply its own REGISTRATION number (captured owner-only on
// church.features.taxRegNumber, threaded into the generated receipt)? Returns the label for that field, or '' if
// the jurisdiction needs none. DATA, no tax math — the owner-only Tax tools subcard shows the capture field iff
// this is truthy, and the finance console passes the captured number + signatory into the receipt document.
const TAX_REG_LABELS = { CA: 'CRA charity registration number', ZA: 'SARS s18A / PBO reference number' };   // receipts that require the church's own reg number
export function taxRegLabel(id) { return TAX_REG_LABELS[id] || ''; }
