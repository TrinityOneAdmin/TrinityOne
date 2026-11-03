// THE UK GIFT AID PACK: ELIGIBLE DONORS ONLY, THE GASDS CAP, AND KEPT OUT OF THE NATION-NEUTRAL CORE.
//   Run: node --test scripts/finance-pack-giftaid.test.mjs
//
// Phase 4b adds src/finance-pack-giftaid.mjs — a UK regional pack that is OFF BY DEFAULT and ADDITIVE. The two
// findings this guards (AUDIT-PHASE-4 finding 2):
//   · the pack must build a claim for ELIGIBLE, DECLARED donors only, never the rest;
//   · it must NOT be in the core bundle's import graph — a church with Gift Aid off ships no UK tax logic.
// Plus the GASDS small-donations cap, and that the pack is inert (builds an empty claim) when there is nobody
// to claim for. The ENGINE is pure, so it runs directly; the STRUCTURAL claim is proved against esbuild's own
// import graph of src/finance-bundle.mjs (the core), not a grep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createBook, addAccount, post, reverse } from '../src/finance-ledger.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { givingByMember } from '../src/finance-reports.mjs';
import { giftAidClaim, gasdsSmallDonations, GASDS_MAX_PER_DONATION, GASDS_ANNUAL_CAP } from '../src/finance-pack-giftaid.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  return b;   // createBook already seeds the 'general' fund
}
// a gift of `minor` pence, optionally tagged to a donor
const gift = (b, minor, donor, date = '2026-05-01') =>
  post(b, { date, memo: 'Gift', postings: [{ account: 'bank', dir: 'dr', amount: minor }, { account: 'giving', dir: 'cr', amount: minor, ...(donor ? { donor } : {}) }] });

// ── Gift Aid proper: eligible, DECLARED donors only ─────────────────────────────────────────────────────
test('the claim includes an eligible, declared donor — and nobody else', () => {
  const b = book();
  gift(b, 10000, 'd1');     // Ada — eligible + declared → claim
  gift(b, 4000, 'd2');      // Ben — eligible but NO declaration → no claim
  gift(b, 8000, 'd3');      // Cal — NOT eligible → no claim
  gift(b, 2000, null);      // anonymous plate cash → no donor, no claim
  const donors = [
    { id: 'd1', name: 'Ada', eligible: true, giftAidDeclaredAt: '2026-01-01', postcode: 'SW1A 1AA' },
    { id: 'd2', name: 'Ben', eligible: true, giftAidDeclaredAt: '' },
    { id: 'd3', name: 'Cal', eligible: false, giftAidDeclaredAt: '2026-01-01' },
  ];
  const claim = giftAidClaim(b, { donors, givingByMember });
  assert.deepEqual(claim.rows.map(r => r.name), ['Ada'], 'the claim did not include exactly the one eligible, declared donor: ' + JSON.stringify(claim.rows.map(r => r.name)));
  assert.equal(claim.rows[0].donated, 10000, 'the donated total is wrong');
  assert.equal(claim.rows[0].giftAid, 2500, 'Gift Aid is not 25p per £1 (£100 → £25)');
  assert.equal(claim.totalGiftAid, 2500, 'the claim total is not the sum of the eligible rows');
});

test('a donor with a declaration but no giving in the period is left out (an empty line is not a claim)', () => {
  const b = book();
  gift(b, 5000, 'd1', '2025-05-01');   // last year
  const donors = [{ id: 'd1', name: 'Ada', eligible: true, giftAidDeclaredAt: '2026-01-01' }];
  const claim = giftAidClaim(b, { donors, from: '2026-01-01', to: '2026-12-31', givingByMember });
  assert.equal(claim.rows.length, 0, 'a donor with no giving in the period produced a claim line');
  assert.equal(claim.totalGiftAid, 0);
});

test('a reversed gift nets out of the donor\'s claim', () => {
  const b = book();
  const e = gift(b, 10000, 'd1');
  reverse(b, e.seq);   // reverse() carries the donor onto the mirror, so the dr on `giving` subtracts from the total
  const donors = [{ id: 'd1', name: 'Ada', eligible: true, giftAidDeclaredAt: '2026-01-01' }];
  const claim = giftAidClaim(b, { donors, givingByMember });
  assert.equal(claim.totalGiftAid, 0, 'a reversed gift still produced a Gift Aid claim — the donor tag did not ride the reversal');
});

// ── GASDS: the per-donation ceiling and the annual cap ──────────────────────────────────────────────────
test('GASDS counts only small donations and claims 25% of them', () => {
  const r = gasdsSmallDonations([1000, 2000, 3000]);   // all ≤ £30
  assert.equal(r.eligibleTotal, 6000, 'eligible total wrong');
  assert.equal(r.cappedTotal, 6000, 'nothing is over the annual cap here');
  assert.equal(r.topUp, 1500, 'GASDS top-up is not 25% (£60 → £15)');
});
test('GASDS EXCLUDES a donation over the per-donation ceiling', () => {
  const big = GASDS_MAX_PER_DONATION + 1;
  const r = gasdsSmallDonations([1000, big]);
  assert.equal(r.count, 1, 'the oversized donation was counted as a small donation');
  assert.equal(r.eligibleTotal, 1000, 'the oversized donation leaked into the eligible total');
  assert.equal(r.excludedOverLimit, big, 'the oversized donation was not reported as excluded');
});
test('GASDS caps the claim at the annual small-donations limit', () => {
  const over = GASDS_ANNUAL_CAP + 50000;                 // more small giving than the annual cap allows
  const many = Array.from({ length: Math.ceil(over / GASDS_MAX_PER_DONATION) }, () => GASDS_MAX_PER_DONATION);
  const r = gasdsSmallDonations(many);
  assert.ok(r.eligibleTotal > GASDS_ANNUAL_CAP, 're-anchor: this case must exceed the cap to test it');
  assert.equal(r.cappedTotal, GASDS_ANNUAL_CAP, 'the claim was not capped at the annual limit');
  assert.equal(r.topUp, Math.round(GASDS_ANNUAL_CAP * 0.25), 'the capped top-up is wrong');
  assert.equal(r.overCap, r.eligibleTotal - GASDS_ANNUAL_CAP, 'the over-cap amount is not reported');
});

// ── inert when there is nobody to claim for ─────────────────────────────────────────────────────────────
test('the pack is inert on an empty/ineligible book: no rows, zero claim', () => {
  const b = book();
  gift(b, 5000, 'd1');
  const claim = giftAidClaim(b, { donors: [{ id: 'd1', name: 'Ada', eligible: false }], givingByMember });
  assert.deepEqual(claim.rows, [], 'an all-ineligible book still produced claim rows');
  assert.equal(claim.totalGiftAid, 0);
  assert.equal(gasdsSmallDonations([]).topUp, 0, 'GASDS over no donations still claimed something');
});

// ── STRUCTURAL: the core bundle does NOT import the pack (DOMAIN nation-neutral) ─────────────────────────
// esbuild's own metafile is the import graph the shipped bundle is built from — the honest source of truth,
// not a grep over text. Written to a temp file (--metafile=/dev/stdout competes with the bundle on stdout).
function importGraph(entry) {
  const dir = mkdtempSync(join(tmpdir(), 'ga-meta-'));
  try {
    execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
      [join(ROOT, entry), '--bundle', '--format=iife', '--metafile=' + join(dir, 'm.json'), '--outfile=' + join(dir, 'out.js'), '--log-level=error']);
    return Object.keys(JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')).inputs);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('src/finance-bundle.mjs (the core) does NOT import the Gift Aid pack', () => {
  const inputs = importGraph('src/finance-bundle.mjs');
  assert.ok(inputs.some(p => p.endsWith('finance-ledger.mjs')), 're-anchor: the core bundle no longer includes finance-ledger.mjs, so this graph is not the core');
  const leaked = inputs.filter(p => /finance-pack-giftaid\.mjs$|finance-giftaid-bundle\.mjs$/.test(p));
  assert.deepEqual(leaked, [],
    'the UK Gift Aid pack is in the CORE bundle\'s import graph — a church with Gift Aid off would ship UK tax ' +
    'logic, violating DOMAIN nation-neutrality. Keep it in src/finance-giftaid-bundle.mjs only: ' + leaked.join(', '));
});

test('the Gift Aid bundle DOES import the pack (re-anchor: the separate bundle is real)', () => {
  const inputs = importGraph('src/finance-giftaid-bundle.mjs');
  assert.ok(inputs.some(p => p.endsWith('finance-pack-giftaid.mjs')), 'the Gift Aid bundle does not import the pack — the pack ships nowhere');
});

// ── STRUCTURAL (wave 3): the jurisdiction REGISTRY does NOT import the pack either ───────────────────────
// The registry (src/finance-jurisdictions.mjs) ships in the CORE bundle, so it is the new way UK tax logic
// could leak into a neutral church: if it ever `import`ed the pack to call it, the core test above would still
// pass (the registry is in the core graph, so is the pack — but transitively through the registry). This
// anchors the registry's own graph directly: it is NEUTRAL METADATA and names the tax tool only by STRING.
test('src/finance-jurisdictions.mjs (the registry) does NOT import the Gift Aid pack', () => {
  const inputs = importGraph('src/finance-jurisdictions.mjs');
  assert.ok(inputs.some(p => p.endsWith('finance-jurisdictions.mjs')), 're-anchor: the registry graph does not include the registry itself');
  const leaked = inputs.filter(p => /finance-pack-giftaid\.mjs$|finance-giftaid-bundle\.mjs$/.test(p));
  assert.deepEqual(leaked, [],
    'the jurisdiction registry imports the UK Gift Aid pack — it must hold NO tax math and name the tax tool ' +
    'by STRING only, or a church on None ships UK tax logic through the core bundle: ' + leaked.join(', '));
});
