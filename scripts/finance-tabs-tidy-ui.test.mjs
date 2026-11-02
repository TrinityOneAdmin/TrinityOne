// POINT-OF-USE (CLAUDE.md 1 & 3): the Finance tab strip is the owner's 2+More layout, ON THE SCREEN.
//   Run: node --test scripts/finance-tabs-tidy-ui.test.mjs
//
// Renders the REAL FinTabStrip (app/stew-finance.jsx) through scripts/console-screens.mjs — the whole console
// compiled the way the phone loads it — and reads the RENDERED TREE, never the .jsx text. Delete the strip (or
// move a tab between primary/More) and these fail.
//
// Asserts: only Transactions + Reports are top-level; a "More ▾" button is present; the six More tabs are
// ABSENT until the popover is open and PRESENT once it is; choosing a More tab calls setTab(key); the More
// button shows the active child ("More · Bills") when a More tab is selected; and the popover is NOT a dialog
// (role!=="dialog") so it stays off every-console-dialog-mounts.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook renders <FinTabStrip/>).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

import * as _ledger from '../src/finance-ledger.mjs';
import * as _store from '../src/finance-store.mjs';
import * as _statement from '../src/finance-statement.mjs';
import * as _import from '../src/finance-import.mjs';
const FL = { ..._ledger, ..._store, ..._statement, ..._import };

const PRIMARY = ['Transactions', 'Reports'];
const MORE = ['Invoices', 'Bills', 'Accounts & funds', 'Budget', 'Donors', 'Insights'];

function strip({ tab = 'transactions', moreOpen = false, width = 500 } = {}) {
  const fr = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward({ actingChurch: '' }) });
  // useStewNarrow() reads window.innerWidth: <760 = narrow (2+More), >=760 = all tabs inline (desktop). The
  // default here is a NARROW width so the collapse tests assert the phone layout explicitly.
  window.innerWidth = width;
  window.FinanceLedger = FL;
  const { FinTabStrip } = loadConsole({ React: fr.React, window, expr: '{ FinTabStrip }' });
  assert.equal(typeof FinTabStrip, 'function', 'FinTabStrip is not exported — the tab strip was removed/renamed');
  const calls = { setTab: [], setMore: [] };
  let moreVal = moreOpen;
  const setMoreOpen = (u) => { moreVal = typeof u === 'function' ? u(moreVal) : u; calls.setMore.push(moreVal); };
  const setTab = (t) => calls.setTab.push(t);
  fr.reset();
  const tree = FinTabStrip({ tab, setTab, moreOpen, setMoreOpen });
  fr.flush();
  return { tree, calls };
}

const buttonLabels = (tree) => nodes(tree).filter(n => n.type === 'button').map(b => String((b.kids || [])[0] || ''));
const findButton = (tree, label) => nodes(tree).find(n => n.type === 'button' && String((n.kids || [])[0] || '') === label);

test('NARROW closed: only Transactions + Reports + a More button are top-level; the six More tabs are hidden', () => {
  const { tree } = strip({ tab: 'transactions', moreOpen: false, width: 500 });
  const labels = buttonLabels(tree);
  for (const p of PRIMARY) assert.ok(labels.includes(p), `primary tab "${p}" is not a top-level button`);
  assert.ok(labels.some(l => l.startsWith('More')), 'the "More" button is not on the strip');
  for (const m of MORE) assert.ok(!labels.includes(m), `"${m}" is top-level but should be inside the closed More menu`);
});

test('open: the six More tabs render as buttons and choosing one calls setTab(key)', () => {
  const { tree, calls } = strip({ tab: 'transactions', moreOpen: true });
  const labels = buttonLabels(tree);
  for (const m of MORE) assert.ok(labels.includes(m), `"${m}" is not in the open More menu`);
  findButton(tree, 'Bills').props.onClick();
  assert.deepEqual(calls.setTab, ['bills'], 'choosing "Bills" from More did not call setTab("bills")');
});

test('the More button shows the ACTIVE child when a More tab is selected', () => {
  const { tree } = strip({ tab: 'bills', moreOpen: false });
  const labels = buttonLabels(tree);
  assert.ok(labels.some(l => l === 'More · Bills ▾'), 'the More button does not surface the active child "Bills"; got: ' + labels.join(' | '));
});

test('clicking More toggles the popover open (calls setMoreOpen(true))', () => {
  const { tree, calls } = strip({ tab: 'transactions', moreOpen: false });
  const more = nodes(tree).find(n => n.type === 'button' && String((n.kids || [])[0] || '').startsWith('More'));
  more.props.onClick();
  assert.ok(calls.setMore.includes(true), 'clicking More did not open the popover');
});

test('the More popover is NOT a dialog (stays off every-console-dialog-mounts)', () => {
  const { tree } = strip({ tab: 'transactions', moreOpen: true });
  assert.equal(nodes(tree).filter(n => n.props && n.props.role === 'dialog').length, 0, 'the tab strip rendered a role="dialog" — it must be a lightweight menu');
});

// ── DESKTOP / wide (owner device-test, 2026-11-02): >=760 shows ALL tabs inline, NO "More" button ───────────
// useStewNarrow() is <760, so 500 is narrow (2+More, above) and 760/1200 are desktop (all inline). These fail
// if the desktop branch is removed and the strip collapses on desktop again.
test('DESKTOP (1200): all eight tabs are top-level pills and there is NO More button', () => {
  const { tree } = strip({ tab: 'transactions', moreOpen: false, width: 1200 });
  const labels = buttonLabels(tree);
  for (const l of [...PRIMARY, ...MORE]) assert.ok(labels.includes(l), `desktop: tab "${l}" is not a top-level pill`);
  assert.ok(!labels.some(l => /^More/.test(l)), 'desktop still shows a "More" button — the strip must not collapse at a wide width');
});

test('DESKTOP: a would-be-More tab (Insights) is directly clickable and calls setTab', () => {
  const { tree, calls } = strip({ tab: 'transactions', moreOpen: false, width: 1200 });
  findButton(tree, 'Insights').props.onClick();
  assert.deepEqual(calls.setTab, ['insights'], 'a top-level tab on desktop did not call setTab');
});

test('BOUNDARY: at exactly 760 the strip is desktop (all inline); at 500 it collapses to 2+More', () => {
  const wide = buttonLabels(strip({ moreOpen: false, width: 760 }).tree);
  assert.ok(MORE.every(m => wide.includes(m)) && !wide.some(l => /^More/.test(l)), '760 should be the desktop (all-inline) layout');
  const narrow = buttonLabels(strip({ moreOpen: false, width: 500 }).tree);
  assert.ok(!narrow.includes('Insights') && narrow.some(l => /^More/.test(l)), '500 should be the narrow (2+More) layout');
});
