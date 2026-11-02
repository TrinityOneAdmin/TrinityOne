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
const _juris = await import('../src/finance-jurisdictions.mjs');   // wave 3 — the registry ships in the core bundle
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reports, ..._budget, ..._charts, ..._juris };

function setup(opts = {}) {
  const fr = fakeReact();
  let encSubCb = null;
  const pubs = [];   // [d-tag, body] captured from every encPublish (wave 3: proves the empty-book currency seed)
  const Steward = fakeSteward({
    actingChurch: '',
    pubkey: 'ab'.repeat(32),
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async (d, body) => { pubs.push([d, body]); return true; },
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = opts.FL || FL;   // opts.FL: a custom registry (wave 3) to drive the empty-book currency default
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  // Injected AFTER loadConsole (the console scripts define their own window.useStewardChurch and would clobber
  // an earlier value). opts.features is the whole features object (wave 3 jurisdiction tests); opts.giftAid is
  // the wave-2 shorthand for the legacy strict opt-in (features.giftAid === true), off by default.
  const features = opts.features || (opts.giftAid ? { giftAid: true } : {});
  window.useStewardChurch = () => ({ name: 'St Test', features });
  // The Gift Aid claim logic lives in a separate bundle the panel reaches for only when the gate is on; stub it
  // so the panel does not report "module hasn't loaded" if a future test expands children.
  if (opts.giftAid || features.giftAid === true || features.jurisdiction === 'UK') window.FinanceGiftAid = { giftAidClaim: () => ({ rows: [], totalDonated: 0, totalGiftAid: 0 }) };
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const button = (label) => all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const comp = (name) => all().find(n => typeof n.type === 'function' && n.type.name === name);
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  const screen = () => texts(tree).join(' ');
  // Owner's 2+More tab layout: only Transactions + Reports are top-level; the rest live in the FinTabStrip
  // "More" popover (a child component console-screens does not render), so a main-tab switch goes through its
  // setTab prop. Sub-tabs/buttons INSIDE a panel are still reached with click(). (The strip's own layout is
  // covered by scripts/finance-tabs-tidy-ui.test.mjs.)
  const goTab = (key) => { const s = all().find(n => typeof n.type === 'function' && n.type.name === 'FinTabStrip'); assert.ok(s, 're-anchor: FinTabStrip not rendered'); s.props.setTab(key); draw(); };
  return { fr, draw, all, button, comp, click, goTab, feedItems, screen, pubs, get tree() { return tree; } };
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

// Owner's 2+More layout (2026-11-02). The tab strip is its own component (FinTabStrip), so the pills are NOT in
// DashFinanceBook's own rendered tree — the strip's shape (which pills are primary, the More menu, the active-
// child label) is covered by scripts/finance-tabs-tidy-ui.test.mjs. Here we prove every tab is still REACHABLE
// (via the strip's setTab) and reveals its panel.
const PANEL_PROBE = [
  ['reports', 'Export PDF'], ['accounts', 'Add account'], ['invoices', 'New invoice'],
  ['bills', 'New bill'], ['budget', 'Edit budget'], ['donors', 'Add donor'],
];

test('every tab is reachable via the strip and reveals its own panel', () => {
  const h = setup();
  h.draw();
  h.feedItems(seedItems());
  for (const [key, probe] of PANEL_PROBE) {
    h.goTab(key);
    assert.ok(h.button(probe), 'reaching "' + key + '" did not reveal its panel (no "' + probe + '")');
  }
  h.goTab('transactions');
  assert.match(h.screen(), /Recent transactions/, 'reaching Transactions did not show the recent-transactions list');
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

  h.goTab('reports');
  assert.ok(h.button('Export PDF'), 'the Reports tab did not reveal the Reports panel (no Export PDF)');
  assert.ok(!h.button('Add account'), 'the Accounts & funds panel is still showing on the Reports tab');
  assert.ok(!/Recent transactions/.test(h.screen()), 'the Transactions panel is still showing on the Reports tab');

  h.goTab('accounts');
  assert.ok(h.button('Add account'), 'the Accounts & funds tab did not reveal its panel (no Add account)');
  assert.ok(!h.button('Export PDF'), 'the Reports panel is still showing on the Accounts & funds tab');

  h.goTab('bills');
  assert.ok(h.button('New bill'), 'the Bills tab did not reveal its panel (no New bill)');
  assert.ok(!h.button('Add account'), 'the Accounts & funds panel is still showing on the Bills tab');

  h.goTab('transactions');
  assert.match(h.screen(), /Recent transactions/, 'returning to the Transactions tab did not bring the recent list back');
  assert.ok(!h.button('New bill'), 'the Bills panel is still showing on the Transactions tab');
});

test('the Donors tab has two sub-tabs that switch between the donor records and the giving record', () => {
  const h = setup();
  h.draw();
  h.feedItems(seedItems());
  h.goTab('donors');
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
  off.goTab('donors');
  assert.ok(!off.comp('BooksGiftAidPanel'), 'the Gift Aid panel is on the donor-records sub-tab — it belongs under Giving record');
  off.click('Giving record');
  const gaOff = off.comp('BooksGiftAidPanel');
  assert.ok(gaOff, 'the Gift Aid panel is not under the Giving-record sub-tab');
  assert.equal(gaOff.props.giftAidOn, false, 'with the church giftAid feature off, the panel must be handed giftAidOn=false');

  // ON: same placement, giftAidOn=true passed through.
  const on = setup({ giftAid: true });
  on.draw();
  on.feedItems(seedItems());
  on.goTab('donors');
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
    h.goTab('donors');            // opens the Donors tab; its DEFAULT sub-tab is the records list
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
  off.goTab('donors');
  assert.match(off.screen(), /Ada Lovelace/, 're-anchor: the seeded donor is not in the records list');
  assert.ok(!/Gift Aid/.test(off.screen()), 'the "Gift Aid" badge still shows in the donor list with the UK pack off');
  assert.ok(!/AB1 2CD/.test(off.screen()), 'the donor postcode still shows in the list with the UK pack off');

  const on = setup({ giftAid: true });
  on.draw();
  on.feedItems(seedItems());
  on.goTab('donors');
  assert.ok(/Gift Aid/.test(on.screen()), 'the "Gift Aid" badge is missing from the donor list with the UK pack on');
  assert.ok(/AB1 2CD/.test(on.screen()), 'the donor postcode is missing from the list with the UK pack on');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// WAVE 3 — the jurisdiction REGISTRY drives the finance screen. Point-of-use, on the REAL DashFinanceBook.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════

// W3-1 — THE EMPTY-BOOK CURRENCY DEFAULT comes from the registry (the owner-only → steward-writable seam).
// An EMPTY relay delivery drives the seed branch, which must seed + publish finance/settings with the
// currency the registry yields for the resolved jurisdiction — NOT a hardcoded 'GBP'. We inject a registry
// whose currencyDefaults returns a SENTINEL so a reverted/hardcoded seed cannot pass: delete the wiring and
// the seed publishes GBP, which is not the sentinel, and this fails.
test('W3-1 — the empty-book seed takes its currency default from the jurisdiction registry', () => {
  const sentinel = { base: 'ZZZ', decimals: 3, fiscalYearStart: '07-01' };
  const customFL = { ...FL, resolveJurisdiction: () => 'TESTX', currencyDefaults: (id) => (id === 'TESTX' ? sentinel : FL.currencyDefaults(id)) };
  const h = setup({ FL: customFL, features: { jurisdiction: 'US' } });
  h.draw();
  h.feedItems([]);                     // empty delivery → the seed branch
  const settings = h.pubs.find(([d]) => d === 'finance/settings');
  assert.ok(settings, 'the empty-book seed did not publish finance/settings at all');
  assert.equal(settings[1].baseCurrency, 'ZZZ', 'the seed did not apply the jurisdiction currency default (it is hardcoded, not read from the registry)');
  assert.equal(settings[1].decimals, 3, 'the seed did not apply the jurisdiction decimals default');
  assert.equal(settings[1].fiscalYearStart, '07-01', 'the seed did not apply the jurisdiction fiscal-year default');
});

test('W3-1b — with the NEUTRAL default (no features) the seed is still the silent-£ book (unchanged)', () => {
  const h = setup({ features: {} });   // None → GBP/2/01-01, the real registry
  h.draw();
  h.feedItems([]);
  const settings = h.pubs.find(([d]) => d === 'finance/settings');
  assert.ok(settings, 're-anchor: no finance/settings seed on an empty neutral book');
  assert.equal(settings[1].baseCurrency, 'GBP', 'a neutral church no longer seeds a silent-£ book');
});

// W3-2 — THE TAX-TOOL GATE is driven by the resolver (the Tax tools SWITCH), not the raw boolean.
// BooksGiftAidPanel is handed giftAidOn = taxToolFor(resolveJurisdiction(...)) === 'giftAid'. Covers: the
// switch on + UK region on; back-compat legacy boolean (no taxTools) ⇒ on; the switch off overrides a stale
// giftAid:true ⇒ off; neutral default ⇒ off; switch on with nothing set ⇒ UK default on.
function gaPanelFor(features) {
  const h = setup({ features });
  h.draw();
  h.feedItems(seedItems());
  h.goTab('donors');
  h.click('Giving record');
  const ga = h.comp('BooksGiftAidPanel');
  assert.ok(ga, 're-anchor: the Gift Aid panel is not under the Giving-record sub-tab');
  return ga.props.giftAidOn;
}
test('W3-2 — Tax tools on + region UK turns the Gift Aid tool on', () => {
  assert.equal(gaPanelFor({ taxTools: true, jurisdiction: 'UK' }), true, 'taxTools on + UK did not activate the Gift Aid tax tool');
});
test('W3-2 — Tax tools on with nothing else set defaults to UK and turns Gift Aid on', () => {
  assert.equal(gaPanelFor({ taxTools: true }), true, 'the switch on with no region did not default to UK + Gift Aid');
});
test('W3-2 — BACK-COMPAT: a legacy features.giftAid=true (no taxTools) still turns Gift Aid on', () => {
  assert.equal(gaPanelFor({ giftAid: true }), true, 'a legacy UK church lost its Gift Aid tool after the gate was rewired to the switch');
});
test('W3-2 — the SWITCH OFF (taxTools:false) OVERRIDES a stale giftAid:true (tool off)', () => {
  assert.equal(gaPanelFor({ taxTools: false, giftAid: true }), false, 'turning the switch off did not override the legacy boolean on the screen');
});
test('W3-2 — the NATION-NEUTRAL default (no features) leaves the Gift Aid tool off', () => {
  assert.equal(gaPanelFor({}), false, 'a neutral church shows the Gift Aid tool');
});

// W3-3 — THE DONOR LABELS (wave 2 gated on giftAidOn) follow the switch too, since giftAidOn's SOURCE is the
// resolver. With the switch on (+UK) the donor-records list shows the UK wording; off it does not.
// (The records-list badge/postcode live in DashFinanceBook's own body, so console-screens renders them.)
test('W3-3 — donor labels follow the switch: on+UK shows the Gift Aid badge + postcode, off hides them', () => {
  const uk = setup({ features: { taxTools: true, jurisdiction: 'UK' } });
  uk.draw(); uk.feedItems(seedItems()); uk.goTab('donors');
  assert.ok(/Gift Aid/.test(uk.screen()), 'jurisdiction=UK did not show the Gift Aid wording in the donor list');
  assert.ok(/AB1 2CD/.test(uk.screen()), 'jurisdiction=UK did not show the donor postcode');

  const none = setup({ features: {} });
  none.draw(); none.feedItems(seedItems()); none.goTab('donors');
  assert.match(none.screen(), /Ada Lovelace/, 're-anchor: the seeded donor is not in the list');
  assert.ok(!/Gift Aid/.test(none.screen()), 'the neutral default still shows Gift Aid wording in the donor list');
  assert.ok(!/AB1 2CD/.test(none.screen()), 'the neutral default still shows the donor postcode');
});
