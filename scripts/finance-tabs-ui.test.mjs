// THE FINANCE SCREEN IS TABBED, AND EVERY TAB IS REACHABLE (Stream A, 2026-10-29).
//   Run: node --test scripts/finance-tabs-ui.test.mjs
//
// CLAUDE.md rules 1 & 3 (point-of-use). Every assertion renders the REAL DashFinanceBook through
// scripts/console-screens.mjs (the whole console compiled the way the phone loads it) and reads the RENDERED
// TREE — never the .jsx text, so a `false &&` in front of a tab cannot satisfy it. Delete a tab from the strip,
// or a panel from under its tab, and the matching assertion fails.
//
// Covers: the tab strip renders all seven tabs; the DEFAULT tab is Transactions (the recent-transactions list);
// selecting a tab shows THAT panel and hides the others; the Donors tab's two sub-tabs switch between the donor
// records (Donors) and the giving record (Giving record = giving-by-member + the Gift Aid panel); and the Gift
// Aid panel is wired under the Giving-record sub-tab with the church's giftAid gate passed through.
//
// console-screens.mjs renders ONE component's own body and leaves child components as element nodes (it does not
// call them), so BooksGivingByMember / BooksGiftAidPanel are asserted by their PRESENCE as children of the right
// sub-tab and by the props DashFinanceBook hands them — their own bodies are covered by finance-giving-by-member
// and finance-pack-giftaid / finance-donor-and-giftaid-ui.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reports = await import('../src/finance-reports.mjs');
const _budget = await import('../src/finance-budget.mjs');
const _charts = await import('../src/finance-charts.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reports, ..._budget, ..._charts };

function setup(opts = {}) {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    pubkey: 'ab'.repeat(32),
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  // Injected AFTER loadConsole (the console scripts define their own window.useStewardChurch and would clobber
  // an earlier value). giftAid is a strict opt-in (features.giftAid === true), off by default.
  window.useStewardChurch = () => ({ name: 'St Test', features: opts.giftAid ? { giftAid: true } : {} });
  // The Gift Aid claim logic lives in a separate bundle the panel reaches for only when the toggle is on; stub
  // it so the panel does not report "module hasn't loaded" if a future test expands children.
  if (opts.giftAid) window.FinanceGiftAid = { giftAidClaim: () => ({ rows: [], totalDonated: 0, totalGiftAid: 0 }) };
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const button = (label) => all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const comp = (name) => all().find(n => typeof n.type === 'function' && n.type.name === name);
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  const screen = () => texts(tree).join(' ');
  return { fr, draw, all, button, comp, click, feedItems, screen, get tree() { return tree; } };
}

// A minimal relay delivery: settings + two accounts + one donor-tagged gift, so the screen is NOT in the seed
// path and the Donors tab has a record and giving to show.
function seedItems() {
  const Y = new Date().getFullYear();
  return [
    { id: 'settings', baseCurrency: 'GBP', decimals: 2, fiscalYearStart: '01-01' },
    { id: 'account:bank', code: '1000', name: 'Bank', type: 'asset' },
    { id: 'account:giving', code: '4000', name: 'Giving', type: 'income' },
    { id: 'donor:d1', name: 'Ada Lovelace', eligible: true, postcode: 'AB1 2CD', giftAidDeclaredAt: '2026-01-01' },
    { id: 'journal:1', seq: 1, date: Y + '-02-01', memo: 'Gift', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', dir: 'cr', amount: 10000, donor: 'd1' }] },
  ];
}

const TAB_LABELS = ['Transactions', 'Reports', 'Accounts & funds', 'Invoices', 'Bills', 'Budget', 'Donors', 'Insights'];

test('the tab strip renders all eight tabs', () => {
  const h = setup();
  h.draw();
  for (const label of TAB_LABELS) {
    assert.ok(h.button(label), 'the "' + label + '" tab is not on the strip — the Finance screen is missing a tab');
  }
});

test('the DEFAULT tab is Transactions (the recent-transactions list), not any other panel', () => {
  const h = setup();
  h.draw();
  h.feedItems(seedItems());   // a real book so the recent list has a row
  assert.match(h.screen(), /Recent transactions/, 'the recent-transactions card is not shown by default — Transactions is not the default tab');
  assert.ok(!h.button('Export PDF'), 'the Reports panel is showing by default — only its tab should reveal it');
  assert.ok(!h.button('Add account'), 'the Accounts & funds panel is showing by default — only its tab should reveal it');
  assert.ok(!h.button('New bill'), 'the Bills panel is showing by default — only its tab should reveal it');
  assert.ok(!/At this pace/.test(h.screen()), 'the Insights panel is showing by default — only its tab should reveal it');
});

test('selecting a tab shows THAT panel and hides the others', () => {
  const h = setup();
  h.draw();
  h.feedItems(seedItems());

  h.click('Reports');
  assert.ok(h.button('Export PDF'), 'the Reports tab did not reveal the Reports panel (no Export PDF)');
  assert.ok(!h.button('Add account'), 'the Accounts & funds panel is still showing on the Reports tab');
  assert.ok(!/Recent transactions/.test(h.screen()), 'the Transactions panel is still showing on the Reports tab');

  h.click('Accounts & funds');
  assert.ok(h.button('Add account'), 'the Accounts & funds tab did not reveal its panel (no Add account)');
  assert.ok(!h.button('Export PDF'), 'the Reports panel is still showing on the Accounts & funds tab');

  h.click('Bills');
  assert.ok(h.button('New bill'), 'the Bills tab did not reveal its panel (no New bill)');
  assert.ok(!h.button('Add account'), 'the Accounts & funds panel is still showing on the Bills tab');

  h.click('Transactions');
  assert.match(h.screen(), /Recent transactions/, 'returning to the Transactions tab did not bring the recent list back');
  assert.ok(!h.button('New bill'), 'the Bills panel is still showing on the Transactions tab');
});

test('the Donors tab has two sub-tabs that switch between the donor records and the giving record', () => {
  const h = setup();
  h.draw();
  h.feedItems(seedItems());
  h.click('Donors');
  // sub-tab strip is present
  assert.ok(h.button('Giving record'), 'the Donors tab has no "Giving record" sub-tab');
  // DEFAULT sub-tab is the donor records: the Add-donor control shows and the giving-by-member view does not
  assert.ok(h.button('Add donor'), 'the default Donors sub-tab does not offer "Add donor"');
  assert.ok(!h.comp('BooksGivingByMember'), 'the giving-by-member view is showing on the donor-records sub-tab');

  h.click('Giving record');
  assert.ok(!h.button('Add donor'), 'the "Add donor" control is still showing on the Giving-record sub-tab');
  assert.ok(h.comp('BooksGivingByMember'), 'the Giving-record sub-tab does not show the giving-by-member view');
});

test('the Gift Aid panel is wired under the Giving-record sub-tab, gated by the church giftAid feature', () => {
  // OFF (default): the panel sits under Giving record but DashFinanceBook passes giftAidOn=false (it renders
  // nothing itself; that null-gate is finance-pack-giftaid's test — here we prove the placement + the gate wire).
  const off = setup({ giftAid: false });
  off.draw();
  off.feedItems(seedItems());
  off.click('Donors');
  assert.ok(!off.comp('BooksGiftAidPanel'), 'the Gift Aid panel is on the donor-records sub-tab — it belongs under Giving record');
  off.click('Giving record');
  const gaOff = off.comp('BooksGiftAidPanel');
  assert.ok(gaOff, 'the Gift Aid panel is not under the Giving-record sub-tab');
  assert.equal(gaOff.props.giftAidOn, false, 'with the church giftAid feature off, the panel must be handed giftAidOn=false');

  // ON: same placement, giftAidOn=true passed through.
  const on = setup({ giftAid: true });
  on.draw();
  on.feedItems(seedItems());
  on.click('Donors');
  on.click('Giving record');
  const gaOn = on.comp('BooksGiftAidPanel');
  assert.ok(gaOn, 'the Gift Aid panel is not under the Giving-record sub-tab when giftAid is on');
  assert.equal(gaOn.props.giftAidOn, true, 'with the church giftAid feature on, the panel must be handed giftAidOn=true');
});

// T4 — DashFinanceBook threads the giftAidOn gate to BOTH donor-facing children (wave 2, 2026-10-30). Rule 2:
// the callers threaded are the BooksDonor render (donor editor) and the BooksGivingByMember render (giving-by-
// member list). console-screens renders DashFinanceBook's own body and leaves these as element nodes, so the
// prop it hands them is exactly what we assert. Drop either prop and the matching assertion reads undefined.
test('T4 — DashFinanceBook hands giftAidOn to the donor editor and the giving-by-member list', () => {
  for (const flag of [false, true]) {
    const h = setup({ giftAid: flag });
    h.draw();
    h.feedItems(seedItems());
    h.click('Donors');            // opens the Donors tab; its DEFAULT sub-tab is the records list
    // the donor editor child (opened from the records sub-tab) gets the gate
    h.click('Add donor');
    const ed = h.comp('BooksDonor');
    assert.ok(ed, 'opening "Add donor" did not mount the BooksDonor editor');
    assert.equal(ed.props.giftAidOn, flag, 'BooksDonor was not handed giftAidOn=' + flag);
    // the giving-by-member child (under the Giving-record sub-tab) gets the gate. Switch the sub-tab directly
    // (do NOT re-click "Donors" — the tab and the sub-tab share that label).
    h.click('Giving record');
    const gbm = h.comp('BooksGivingByMember');
    assert.ok(gbm, 'BooksGivingByMember is not rendered under the Giving-record sub-tab');
    assert.equal(gbm.props.giftAidOn, flag, 'BooksGivingByMember was not handed giftAidOn=' + flag);
  }
});

// T5 — the donor-RECORDS list badge + postcode line are gated (these live in DashFinanceBook's OWN body, so
// console-screens renders them for real). seedItems()'s donor d1 is eligible with postcode AB1 2CD.
test('T5 — the donor-records list gates the Gift Aid badge and the postcode on the UK pack', () => {
  const off = setup({ giftAid: false });
  off.draw();
  off.feedItems(seedItems());
  off.click('Donors');
  assert.match(off.screen(), /Ada Lovelace/, 're-anchor: the seeded donor is not in the records list');
  assert.ok(!/Gift Aid/.test(off.screen()), 'the "Gift Aid" badge still shows in the donor list with the UK pack off');
  assert.ok(!/AB1 2CD/.test(off.screen()), 'the donor postcode still shows in the list with the UK pack off');

  const on = setup({ giftAid: true });
  on.draw();
  on.feedItems(seedItems());
  on.click('Donors');
  assert.ok(/Gift Aid/.test(on.screen()), 'the "Gift Aid" badge is missing from the donor list with the UK pack on');
  assert.ok(/AB1 2CD/.test(on.screen()), 'the donor postcode is missing from the list with the UK pack on');
});
