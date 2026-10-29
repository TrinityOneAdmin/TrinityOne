// THE AGGREGATE REPORTS PANEL AND ITS PRESETS ARE ACTUALLY ON THE SCREEN (Phase 4a).
//   Run: node --test scripts/the-reports-panel-renders-its-presets.test.mjs
//
// CLAUDE.md rules 1 & 3 (point-of-use). Each assertion renders the REAL DashFinanceBook through
// scripts/console-screens.mjs (the console compiled the way the phone loads it) and reads the RENDERED TREE —
// never the .jsx text, so a `false &&` in front of a control cannot satisfy it. Delete a preset button, a
// report section, or an export control from the screen and the matching test fails.
//
// The engine half (figures reconcile to the journal) is finance-reports.test.mjs. This proves the figures and
// the controls are REACHABLE: the trustees' fund-movements table, giving-by-fund, receipts & payments, and the
// PDF/CSV/HTML export buttons all render over a real seeded book.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const _reconcile = await import('../src/finance-reconcile.mjs');
const _reports = await import('../src/finance-reports.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import, ..._reconcile, ..._reports };

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  return d;
});

function setup() {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const button = (label) => all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  return { fr, draw, all, button, click, feedItems, get tree() { return tree; } };
}

// A book with a restricted Building fund and income to both funds, dated in the CURRENT year so it falls inside
// the panel's default "Year to date" period (the component reads the real clock for the period bounds).
function seedBook() {
  const Y = new Date().getFullYear();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  FL.addFund(b, { id: 'building', name: 'Building fund', kind: 'restricted' });
  FL.post(b, { date: Y + '-01-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });
  FL.post(b, { date: Y + '-01-12', memo: 'roof', postings: [{ account: 'bank', dir: 'dr', amount: 60000 }, { account: 'giving', fund: 'building', dir: 'cr', amount: 60000 }] });
  FL.post(b, { date: Y + '-01-20', memo: 'electric', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] });
  return b;
}

test('the Reports panel offers every Phase-4a preset + an export control', () => {
  const h = setup();
  h.draw();
  h.feedItems(toItems(FL.bookToDocs(seedBook())));
  h.click('Reports');   // open the collapsible
  for (const label of ['Income & expenditure', 'Balance sheet', 'Fund summary', 'Giving by fund', 'Receipts & payments', "Trustees' report"]) {
    assert.ok(h.button(label), 'NO "' + label + '" report preset on the screen');
  }
  for (const label of ['Export PDF', 'Export CSV', 'Export HTML']) {
    assert.ok(h.button(label), 'NO "' + label + '" control on the Reports panel');
  }
  // period controls
  assert.ok(h.button('This quarter') && h.button('Year to date') && h.button('Last year'), 'the period controls are not on the panel');
  // (Phase 4a originally asserted no giving-by-member existed. Phase 4b has since added it as its OWN
  // finance-gated "Donors & giving by member" panel — NOT a Reports preset; the aggregate presets are the
  // ones enumerated above. The member-facing SHARE/broadcast path staying name-free is guarded in
  // finance-giving-by-member.test.mjs, so the obsolete whole-tree negative guard is removed here.)
});

test("the Trustees' report renders the fund-movements table over the ledger", () => {
  const h = setup();
  h.draw();
  h.feedItems(toItems(FL.bookToDocs(seedBook())));
  h.click('Reports');
  h.click("Trustees' report");
  const joined = texts(h.tree).join(' ');
  assert.ok(joined.includes('Fund movements'), 'the fund-movements section did not render');
  assert.ok(/Opening/.test(joined) && /Closing/.test(joined), 'the Opening/Closing columns did not render');
  assert.ok(joined.includes('Building fund'), 're-anchor: the restricted fund is not shown in the movements table');
  assert.ok(joined.includes('£600.00'), 'the building fund £600 closing figure is not on the screen');
});

test('the Giving-by-fund report renders aggregate per-fund giving (no member names)', () => {
  const h = setup();
  h.draw();
  h.feedItems(toItems(FL.bookToDocs(seedBook())));
  h.click('Reports');
  h.click('Giving by fund');
  const joined = texts(h.tree).join(' ');
  assert.ok(joined.includes('Giving by fund'), 'the giving-by-fund section did not render');
  assert.ok(joined.includes('Building fund'), 'the building fund row is not shown');
  assert.ok(joined.includes('£600.00') && joined.includes('£250.00'), 'the per-fund giving figures are not on the screen');
});

test('the Receipts & payments (SORP) report renders its totals', () => {
  const h = setup();
  h.draw();
  h.feedItems(toItems(FL.bookToDocs(seedBook())));
  h.click('Reports');
  h.click('Receipts & payments');
  const joined = texts(h.tree).join(' ');
  assert.ok(joined.includes('Total receipts'), 'the receipts total did not render');
  assert.ok(joined.includes('Total payments'), 'the payments total did not render');
  assert.ok(joined.includes('Net cash movement'), 'the net cash movement did not render');
});
