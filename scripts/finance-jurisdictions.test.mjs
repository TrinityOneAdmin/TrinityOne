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
  JURISDICTIONS, DEFAULT_JURISDICTION, listJurisdictions, getJurisdiction,
  resolveJurisdiction, currencyDefaults, donorFields, donorLabels, taxToolFor,
} from '../src/finance-jurisdictions.mjs';

// ── the shipped set is exactly UK + None (US is designed, not shipped) ──────────────────────────────────
test('the shipped registry is UK + None only (US is designed, not a live entry)', () => {
  assert.deepEqual(Object.keys(JURISDICTIONS).sort(), ['None', 'UK'], 'the shipped jurisdictions are not exactly None + UK');
  assert.equal(DEFAULT_JURISDICTION, 'None', 'the default jurisdiction is not the nation-neutral None');
  assert.deepEqual(listJurisdictions().map(o => o.id).sort(), ['None', 'UK'], 'the picker options are not None + UK');
  assert.ok(listJurisdictions().every(o => o.id && o.label), 'a picker option is missing an id or a label');
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
