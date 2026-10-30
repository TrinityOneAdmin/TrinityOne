// THE JURISDICTION REGISTRY: resolve precedence (back-compat), the shipped packs, and the nation-neutral
// default. Run: node --test scripts/finance-jurisdictions.test.mjs
//
// Wave 3. src/finance-jurisdictions.mjs is a PURE data module (no DOM/relay/Date). These are the unit facts
// the UI wiring and the console gate stand on; the point-of-use proofs that the SCREEN actually consults them
// live in finance-tabs-ui.test.mjs (the empty-book currency default + the tax-tool gate) and
// finance-donor-and-giftaid-ui.test.mjs (the owner-only picker). The structural "core/registry ship no tax
// math" proof is in finance-pack-giftaid.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JURISDICTIONS, DEFAULT_JURISDICTION, listJurisdictions, listTaxRegions, getJurisdiction,
  resolveJurisdiction, currencyDefaults, donorFields, donorLabels, taxToolFor, taxRegLabel, TAX_DISCLAIMER,
} from '../src/finance-jurisdictions.mjs';

// ── the shipped set (EU/ZA wave): None + UK + US + NZ + Canada + Ireland + South Africa ─────────────────
// COUNT NOTE (CLAUDE.md rule 8): this test asserted the six-entry set; the EU/ZA wave adds ZA (s18A receipt —
// the FURTHER donor fields verified from SARS Notice 6762 of 2025, in force 1 March 2026), so it now asserts the
// SEVEN-entry set. The STILL-HELD countries (AU/DE/FR/NL) are deliberately NOT live entries — their prescribed
// wording/template could not be pinned to a current official source this round — so this test pins they are ABSENT.
test('the shipped registry is None + UK + US + NZ + Canada + Ireland + South Africa; still-held countries are absent', () => {
  assert.deepEqual(Object.keys(JURISDICTIONS).sort(), ['CA', 'IE', 'NZ', 'None', 'UK', 'US', 'ZA'], 'the shipped jurisdictions are not exactly the seven');
  assert.equal(DEFAULT_JURISDICTION, 'None', 'the default jurisdiction is not the nation-neutral None');
  assert.deepEqual(listJurisdictions().map(o => o.id).sort(), ['CA', 'IE', 'NZ', 'None', 'UK', 'US', 'ZA'], 'the picker-source options are not the shipped seven');
  assert.ok(listJurisdictions().every(o => o.id && o.label), 'a picker option is missing an id or a label');
  for (const held of ['AU', 'DE', 'FR', 'NL']) assert.ok(!JURISDICTIONS[held], held + ' shipped as a live entry — it is still HELD until its prescribed receipt wording is verified');
});

// ── the Region picker lists ACTUAL schemes only (taxTool != null) — currency-only places are not regions ──
test('listTaxRegions returns the real schemes only (UK, US, NZ, CA, IE, ZA) and never None', () => {
  const ids = listTaxRegions().map(o => o.id).sort();
  assert.deepEqual(ids, ['CA', 'IE', 'NZ', 'UK', 'US', 'ZA'], 'listTaxRegions is not exactly the six real schemes: ' + JSON.stringify(ids));
  assert.ok(!ids.includes('None'), 'listTaxRegions offered None — None is the switch being off, not a region');
  assert.ok(listTaxRegions().every(o => taxToolFor(o.id) != null), 'listTaxRegions returned an entry with no tax tool');
});

// ── Canada + Ireland + South Africa — the receipts/reclaim-wave regions ─────────────────────────────────
test('Canada needs a CRA registration number; Ireland is a reclaim region; South Africa needs an s18A/PBO number', () => {
  assert.equal(taxToolFor('CA'), 'contributionStatement', 'Canada did not resolve to the contribution-statement tool');
  assert.deepEqual(currencyDefaults('CA'), { base: 'CAD', decimals: 2, fiscalYearStart: '01-01' }, 'Canada currency default wrong');
  assert.ok(/CRA/.test(taxRegLabel('CA')), 'Canada must declare it needs a CRA registration number (taxRegLabel)');
  assert.equal(taxToolFor('IE'), 'charitableDonationScheme', 'Ireland did not resolve to the reclaim tool');
  assert.deepEqual(currencyDefaults('IE'), { base: 'EUR', decimals: 2, fiscalYearStart: '01-01' }, 'Ireland currency default wrong');
  for (const k of ['eligible', 'certType', 'certDeclaredAt']) assert.ok(donorFields('IE').includes(k), 'the Ireland donor field set is missing ' + k);
  // South Africa s18A — the verified FURTHER donor fields (SARS Notice 6762 of 2025) + the PBO reg number
  assert.equal(taxToolFor('ZA'), 'contributionStatement', 'South Africa did not resolve to the contribution-statement tool');
  assert.deepEqual(currencyDefaults('ZA'), { base: 'ZAR', decimals: 2, fiscalYearStart: '03-01' }, 'South Africa currency default wrong');
  assert.ok(/s18A|PBO/.test(taxRegLabel('ZA')), 'South Africa must declare it needs an s18A/PBO reference number');
  for (const k of ['natureOfPerson', 'idType', 'idNumber', 'taxRef', 'contactNumber', 'email']) assert.ok(donorFields('ZA').includes(k), 'the South Africa donor field set is missing ' + k);
});

test('taxRegLabel is empty for regions whose receipt needs no church registration number', () => {
  for (const id of ['US', 'NZ', 'UK', 'IE', 'None']) assert.equal(taxRegLabel(id), '', id + ' must not demand a registration number');
});

// ── US + NZ are verified CONTRIBUTION-STATEMENT regions; currency is DECOUPLED from the tool ────────────
test('US and NZ are contribution-statement regions with their own currency defaults + address labels', () => {
  assert.equal(taxToolFor('US'), 'contributionStatement', 'US did not resolve to the contribution-statement tool');
  assert.equal(taxToolFor('NZ'), 'contributionStatement', 'NZ did not resolve to the contribution-statement tool');
  assert.deepEqual(currencyDefaults('US'), { base: 'USD', decimals: 2, fiscalYearStart: '01-01' }, 'US currency default wrong');
  assert.deepEqual(currencyDefaults('NZ'), { base: 'NZD', decimals: 2, fiscalYearStart: '04-01' }, 'NZ currency default wrong');
  for (const id of ['US', 'NZ']) assert.ok(donorFields(id).includes('name') && donorFields(id).includes('address'), id + ' donor field set must carry name + address for the statement');
  assert.equal(donorLabels('US').address, 'Mailing address', 'US address label is not "Mailing address"');
  assert.equal(donorLabels('NZ').address, 'Postal address', 'NZ address label is not "Postal address"');
});

test('currency and tax tool are INDEPENDENT dimensions — same tool, different currencies', () => {
  // US and NZ share a tool but NOT a currency: the scheme never implies a single currency, and the currency
  // default is only a suggestion (the Book-settings picker sets the real currency, free of the region).
  assert.equal(taxToolFor('US'), taxToolFor('NZ'), 're-anchor: US and NZ should share the contribution-statement tool');
  assert.notEqual(currencyDefaults('US').base, currencyDefaults('NZ').base, 'two same-tool regions collapsed to one currency — currency is not decoupled from the tax scheme');
});

test('TAX_DISCLAIMER is exported, non-empty, and reads as a caveat (never retyped by the panels/exports)', () => {
  assert.equal(typeof TAX_DISCLAIMER, 'string');
  assert.ok(TAX_DISCLAIMER.length > 20, 'the tax disclaimer is empty/too short');
  assert.ok(/not tax advice/i.test(TAX_DISCLAIMER), 'the disclaimer does not read as a tax caveat');
});

// ── resolve precedence (the migration rule) ─────────────────────────────────────────────────────────────
test('BACK-COMPAT: a legacy church with features.giftAid === true (no taxTools) reads as switch-ON + UK', () => {
  assert.equal(resolveJurisdiction({ features: { giftAid: true } }), 'UK',
    'an existing UK church (legacy giftAid boolean, no taxTools) did not resolve to UK — it would lose Gift Aid');
  assert.equal(taxToolFor(resolveJurisdiction({ features: { giftAid: true } })), 'giftAid',
    'the legacy giftAid church did not get the Gift Aid tax tool');
});

test('NATION-NEUTRAL DEFAULT: the Tax tools switch OFF (or absent) resolves to None with no tax tool', () => {
  assert.equal(resolveJurisdiction({}), 'None');
  assert.equal(resolveJurisdiction({ features: {} }), 'None');
  assert.equal(resolveJurisdiction(), 'None', 'resolveJurisdiction() with no argument must not throw and must be None');
  assert.equal(resolveJurisdiction({ features: { taxTools: false } }), 'None', 'an explicit taxTools:false did not resolve to None');
  assert.equal(taxToolFor(resolveJurisdiction({ features: {} })), null, 'a neutral church must have NO tax tool');
});

test('the Tax tools SWITCH gates everything: taxTools:true with nothing else set defaults to the sole region UK', () => {
  assert.equal(resolveJurisdiction({ features: { taxTools: true } }), 'UK', 'switch on with nothing set did not default to UK');
  assert.equal(taxToolFor(resolveJurisdiction({ features: { taxTools: true } })), 'giftAid', 'switch-on default did not enable Gift Aid');
});

test('the SWITCH overrides the legacy boolean: taxTools:false + giftAid:true ⇒ None (off wins)', () => {
  assert.equal(resolveJurisdiction({ features: { taxTools: false, giftAid: true } }), 'None',
    'turning the switch off did not override a stale legacy giftAid boolean');
  assert.equal(taxToolFor(resolveJurisdiction({ features: { taxTools: false, giftAid: true } })), null,
    'the switch off still left the Gift Aid tax tool active');
});

test('with the switch ON, a KNOWN non-None jurisdiction wins', () => {
  assert.equal(resolveJurisdiction({ features: { taxTools: true, jurisdiction: 'UK' } }), 'UK', 'an explicit UK with the switch on did not win');
});

test('an UNKNOWN jurisdiction (switch on) falls through to the legacy boolean then the UK default', () => {
  assert.equal(resolveJurisdiction({ features: { taxTools: true, jurisdiction: 'ZZ', giftAid: true } }), 'UK', 'an unknown id did not fall back to the legacy boolean');
  assert.equal(resolveJurisdiction({ features: { taxTools: true, jurisdiction: 'ZZ' } }), 'UK', 'an unknown id (switch on) did not fall back to the UK default');
  // and with the switch OFF an explicit jurisdiction is inert
  assert.equal(resolveJurisdiction({ features: { jurisdiction: 'UK' } }), 'None', 'a jurisdiction with the switch off (no taxTools, no giftAid) must be inert → None');
});

// ── what each pack drives ───────────────────────────────────────────────────────────────────────────────
test('currencyDefaults: UK and None both seed GBP/2, but UK starts the fiscal year on 6 April (owner decision)', () => {
  assert.deepEqual(currencyDefaults('None'), { base: 'GBP', decimals: 2, fiscalYearStart: '01-01' }, 'None is not the silent-£ default');
  // UK: same GBP/2 as None, but the fiscal year now defaults to the UK tax-year start (6 April), not 1 January.
  assert.deepEqual(currencyDefaults('UK'), { base: 'GBP', decimals: 2, fiscalYearStart: '04-06' }, 'UK currency default is not the 6-April UK tax year');
  assert.equal(currencyDefaults('UK').fiscalYearStart, '04-06', 'UK fiscalYearStart must be 04-06 (MM-DD)');
  assert.notEqual(currencyDefaults('UK').fiscalYearStart, currencyDefaults('None').fiscalYearStart, 'UK and None must now seed DIFFERENT fiscal-year starts');
  // an unknown id degrades to the neutral default, never throws
  assert.deepEqual(currencyDefaults('ZZ'), currencyDefaults('None'), 'an unknown id did not degrade to the neutral currency default');
});

test('taxToolFor: UK → giftAid, None → null', () => {
  assert.equal(taxToolFor('UK'), 'giftAid');
  assert.equal(taxToolFor('None'), null);
});

test('donorFields/donorLabels: UK carries the Gift-Aid field set + labels; None is minimal', () => {
  const uf = donorFields('UK'); const ul = donorLabels('UK');
  for (const k of ['eligible', 'postcode', 'giftAidDeclaredAt', 'address']) assert.ok(uf.includes(k), 'the UK donor field set is missing ' + k);
  assert.ok(/Gift Aid declaration/.test(ul.eligible), 'the UK eligible label is not the Gift Aid declaration wording');
  const nf = donorFields('None');
  assert.ok(!nf.includes('postcode') && !nf.includes('giftAidDeclaredAt'), 'the None donor field set leaks UK-only fields');
});

test('getJurisdiction never throws and degrades unknown ids to the neutral default', () => {
  assert.equal(getJurisdiction('UK').id, 'UK');
  assert.equal(getJurisdiction('nope').id, 'None');
  assert.equal(getJurisdiction(undefined).id, 'None');
});
