// IRELAND CHARITABLE DONATION SCHEME (CDS) RECLAIM PACK: the grossing-up math against Revenue's own worked
// example, the €250 min / €1,000,000 max, the 10% associated-donor restriction, CHY3/CHY4 cert gating, and kept
// OUT of the nation-neutral core.  Run: node --test scripts/finance-pack-ie.test.mjs
//
// The figures are VERIFIED against Revenue's Tax and Duty Manual Part 36-00-17 (s.848A TCA 1997), read
// 2026-10-30. The headline worked example there: a €1,000 donation is grossed up at the specified rate 31% to
// €1,449.28 (= €1,000 × 100/69); the body reclaims the tax deducted, €449.28. These tests pin exactly that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createBook, addAccount, post } from '../src/finance-ledger.mjs';
import { givingByMember } from '../src/finance-reports.mjs';
import {
  charitableDonationClaim, cdsGrossUp, cdsRefund, cdsReportFormats,
  CDS_SPECIFIED_RATE, CDS_MIN_ANNUAL, CDS_MAX_ANNUAL,
} from '../src/finance-pack-ie.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
function book() {
  const b = createBook({ baseCurrency: 'EUR', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  return b;
}
const gift = (b, minor, donor, date = '2026-05-01') =>
  post(b, { date, memo: 'Gift', postings: [{ account: 'bank', dir: 'dr', amount: minor }, { account: 'giving', dir: 'cr', amount: minor, ...(donor ? { donor } : {}) }] });
const chy = (over = {}) => ({ eligible: true, certType: 'CHY3', certDeclaredAt: '2026-01-01', ...over });

// ── Revenue's own worked example: €1,000 → grossed €1,449.28, refund €449.28 ────────────────────────────
test('grossing-up matches Revenue TDM 36-00-17: €1,000 → €1,449.28 grossed, €449.28 refund', () => {
  assert.equal(CDS_SPECIFIED_RATE, 31, 're-anchor: the specified rate is not 31%');
  assert.equal(cdsGrossUp(100000), 144928, '€1,000 did not gross up to €1,449.28 (×100/69)');
  assert.equal(cdsRefund(100000), 44928, 'the refund on €1,000 is not €449.28 (grossed − donation)');
  // via the full claim builder, for one certified donor who gave exactly €1,000
  const b = book(); gift(b, 100000, 'd1');
  const claim = charitableDonationClaim(b, { donors: [{ id: 'd1', name: 'Jo', ...chy() }], givingByMember });
  assert.deepEqual(claim.rows.map(r => r.name), ['Jo'], 'the certified donor is not on the claim');
  assert.equal(claim.rows[0].donated, 100000, 'the donated amount is wrong');
  assert.equal(claim.rows[0].refund, 44928, 'the per-donor refund is not €449.28');
  assert.equal(claim.totalRefund, 44928, 'the claim total is not the sum of the refunds');
});

// ── certificate gating: a valid CHY3/CHY4 cert is required, exactly like a Gift Aid declaration ──────────
test('only donors with eligible + a CHY3/CHY4 cert + a cert date are claimed', () => {
  const b = book();
  gift(b, 100000, 'd1');   // Jo — eligible + CHY3 + date → claim
  gift(b, 100000, 'd2');   // Mo — eligible but NO certType → no claim
  gift(b, 100000, 'd3');   // Lee — certType but NOT eligible → no claim
  gift(b, 100000, 'd4');   // Al — eligible + CHY4 but no cert date → no claim
  const donors = [
    { id: 'd1', name: 'Jo', ...chy() },
    { id: 'd2', name: 'Mo', eligible: true, certType: '', certDeclaredAt: '2026-01-01' },
    { id: 'd3', name: 'Lee', eligible: false, certType: 'CHY3', certDeclaredAt: '2026-01-01' },
    { id: 'd4', name: 'Al', eligible: true, certType: 'CHY4', certDeclaredAt: '' },
  ];
  const claim = charitableDonationClaim(b, { donors, givingByMember });
  assert.deepEqual(claim.rows.map(r => r.name), ['Jo'], 'the claim did not include exactly the one certified donor: ' + JSON.stringify(claim.rows.map(r => r.name)));
});

// ── the €250 minimum and the €1,000,000 maximum ─────────────────────────────────────────────────────────
test('a donor below the €250 annual minimum is excluded; at/above it is included', () => {
  const b = book();
  gift(b, CDS_MIN_ANNUAL - 1, 'd1');   // €249.99 → below the minimum
  gift(b, CDS_MIN_ANNUAL, 'd2');       // €250.00 → qualifies
  const donors = [{ id: 'd1', name: 'Under', ...chy() }, { id: 'd2', name: 'At', ...chy() }];
  const claim = charitableDonationClaim(b, { donors, givingByMember });
  assert.deepEqual(claim.rows.map(r => r.name), ['At'], 'the €250 minimum was not applied correctly');
  assert.equal(claim.rows[0].refund, cdsRefund(CDS_MIN_ANNUAL), 'the €250 refund is wrong');
});

test('a donation above the €1,000,000 annual maximum is capped at €1,000,000 for relief', () => {
  const b = book(); gift(b, CDS_MAX_ANNUAL + 50000000, 'd1');   // €1.5m given
  const claim = charitableDonationClaim(b, { donors: [{ id: 'd1', name: 'Big', ...chy() }], givingByMember });
  assert.equal(claim.rows[0].donated, CDS_MAX_ANNUAL, 'the donation was not capped at the €1,000,000 maximum');
  assert.equal(claim.rows[0].refund, cdsRefund(CDS_MAX_ANNUAL), 'the refund was not computed on the capped amount');
});

// ── the 10% associated-donor restriction (s.848A(3A)(a)(ii)) ────────────────────────────────────────────
test('an associated donor is restricted to 10% of total income; without income they go to needsReview', () => {
  const b = book();
  gift(b, 500000, 'd1');   // €5,000 given by an associated donor with €20,000 income → relief base = €2,000
  gift(b, 500000, 'd2');   // €5,000 given by an associated donor with NO income on file → cannot compute → review
  const donors = [
    { id: 'd1', name: 'Assoc-known', ...chy({ associated: true, income: 2000000 }) },   // 10% of €20,000 = €2,000
    { id: 'd2', name: 'Assoc-unknown', ...chy({ associated: true }) },
  ];
  const claim = charitableDonationClaim(b, { donors, givingByMember });
  assert.deepEqual(claim.rows.map(r => r.name), ['Assoc-known'], 'the associated-with-income donor was not the only claimed row');
  assert.equal(claim.rows[0].donated, 200000, 'relief base was not restricted to 10% of total income (€2,000)');
  assert.equal(claim.rows[0].refund, cdsRefund(200000), 'the restricted refund is wrong');
  assert.equal(claim.needsReview.length, 1, 'the associated donor with no income was not flagged for review');
  assert.equal(claim.needsReview[0].name, 'Assoc-unknown');
});

test('the pack is inert when no donor holds a certificate: no rows, zero reclaim', () => {
  const b = book(); gift(b, 100000, 'd1');
  const claim = charitableDonationClaim(b, { donors: [{ id: 'd1', name: 'Jo', eligible: false }], givingByMember });
  assert.deepEqual(claim.rows, [], 'an uncertified book still produced claim rows');
  assert.equal(claim.totalRefund, 0);
});

test('charitableDonationClaim throws without the givingByMember projection injected', () => {
  assert.throws(() => charitableDonationClaim(book(), { donors: [{ id: 'd1', name: 'Jo', ...chy() }] }), /givingByMember/);
});

test('cdsReportFormats advertises the Ireland CDS claim format', () => {
  const fmts = cdsReportFormats();
  assert.ok(fmts.some(f => f.key === 'cdsClaim' && f.pack === 'charitableDonationScheme' && typeof f.build === 'function'), 'the pack does not advertise its claim format');
});

// ── STRUCTURAL: the reclaim pack stays OUT of the core bundle and the registry, INSIDE its own bundle ────
function importGraph(entry) {
  const dir = mkdtempSync(join(tmpdir(), 'ie-meta-'));
  try {
    execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
      [join(ROOT, entry), '--bundle', '--format=iife', '--metafile=' + join(dir, 'm.json'), '--outfile=' + join(dir, 'out.js'), '--log-level=error']);
    return Object.keys(JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')).inputs);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const leaksIe = (inputs) => inputs.filter(p => /finance-pack-ie\.mjs$|finance-ie-bundle\.mjs$/.test(p));

test('src/finance-bundle.mjs (the core) does NOT import the Ireland reclaim pack', () => {
  const inputs = importGraph('src/finance-bundle.mjs');
  assert.ok(inputs.some(p => p.endsWith('finance-ledger.mjs')), 're-anchor: this is not the core graph');
  assert.deepEqual(leaksIe(inputs), [], 'the Ireland reclaim pack is in the CORE bundle\'s import graph: ' + leaksIe(inputs).join(', '));
});

test('src/finance-jurisdictions.mjs (the registry) does NOT import the Ireland reclaim pack', () => {
  const inputs = importGraph('src/finance-jurisdictions.mjs');
  assert.deepEqual(leaksIe(inputs), [], 'the registry imports the Ireland reclaim pack — it must name the tax tool by STRING only: ' + leaksIe(inputs).join(', '));
});

test('the Ireland bundle DOES import the pack (re-anchor: the separate bundle is real)', () => {
  const inputs = importGraph('src/finance-ie-bundle.mjs');
  assert.ok(inputs.some(p => p.endsWith('finance-pack-ie.mjs')), 'the Ireland bundle does not import the pack');
});
