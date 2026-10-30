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
// and changing fiscalYearStart only moves report boundaries (it never reinterprets a stored amount). Whether a
// fresh UK book should default to '04-06' is an OPEN owner decision (see the wave-3 plan); until it is taken we
// keep '01-01' so the two SHIPPED jurisdictions (None, UK) seed a byte-identical book to today's silent-£.

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
    currency: { base: 'GBP', decimals: 2, fiscalYearStart: '01-01' },   // see UK fiscal-year note above
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
  // ── US — DESIGNED, NOT BUILT this round (owner: one pack at a time). Kept as a comment, not a live entry,
  //    so the SHIPPED registry is UK + None only. The US tax tool is a year-end per-donor CONTRIBUTION
  //    STATEMENT (an annual giving summary the DONOR uses for their own deduction — NO church rebate, unlike
  //    Gift Aid). Adding it later is exactly one entry here plus a separate src/finance-pack-us.mjs engine:
  //    US: { id:'US', label:'United States',
  //          currency:{ base:'USD', decimals:2, fiscalYearStart:'01-01' },
  //          donor:{ fields:['name','address'], labels:{ address:'Mailing address' } },
  //          taxTool:'contributionStatement' },
};

export const DEFAULT_JURISDICTION = 'None';

// The list the owner-only picker renders its options from — DATA, so a new jurisdiction needs no UI change.
export function listJurisdictions() {
  return Object.values(JURISDICTIONS).map(j => ({ id: j.id, label: j.label }));
}

// The pack record for an id, or the neutral default for an unknown/empty id (never throws).
export function getJurisdiction(id) {
  return JURISDICTIONS[id] || JURISDICTIONS[DEFAULT_JURISDICTION];
}

// Resolve the active jurisdiction id from the church profile. Computed on READ — no stored document changes
// until a church actively picks one. Precedence (owner decision 2026-10-30):
//   1. an EXPLICIT church.features.jurisdiction that is a KNOWN id  -> it wins;
//   2. else the LEGACY boolean church.features.giftAid === true     -> 'UK' (existing UK churches, no action);
//   3. else                                                         -> 'None' (nation-neutral default).
export function resolveJurisdiction({ features } = {}) {
  const f = features || {};
  if (f.jurisdiction && JURISDICTIONS[f.jurisdiction]) return f.jurisdiction;
  if (f.giftAid === true) return 'UK';
  return DEFAULT_JURISDICTION;
}

// The three things a pack drives. Each takes an id (as returned by resolveJurisdiction) and reads DATA only.
export function currencyDefaults(id) { return getJurisdiction(id).currency; }       // drives the empty-book currency default
export function donorFields(id)      { return getJurisdiction(id).donor.fields; }   // donor field set (extensibility; form still gates binary this round)
export function donorLabels(id)      { return getJurisdiction(id).donor.labels; }   // donor labels
export function taxToolFor(id)       { return getJurisdiction(id).taxTool; }        // 'giftAid' | 'contributionStatement' | null
