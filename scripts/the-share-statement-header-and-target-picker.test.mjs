// SHARE-STATEMENT PLACEMENT + SEND-TARGET CHOOSER ARE ACTUALLY ON THE SCREEN (Stream B, 2026-10-30).
//   Run: node --test scripts/the-share-statement-header-and-target-picker.test.mjs
//
// CLAUDE.md rules 1 & 3 (point-of-use). Every assertion renders the REAL console through
// scripts/console-screens.mjs (compiled the way the phone loads it) and reads the RENDERED TREE
// (React.createElement nodes), NEVER the .jsx text — so a `false && ` in front of a control cannot
// satisfy it (app/stew-finance.jsx ships UNBUNDLED, where a text-match would still pass). Delete the
// header "Share statement" button, the "Send to" picker, or the publishPost call, and a test turns red.
//
// What this proves is reachable:
//   1. "Share statement" renders in the HEADER as a sibling of "Import statement" — NOT in the
//      Transactions-tab card (which keeps only Export CSV).
//   2. The "Send to" picker offers whole-church + every ordinary group, and DEFAULTS to whole-church.
//   3. Posting drives the SHIPPED postStatementToMembers → Steward.publishPost with the CHOSEN group id
//      (and, untouched, the broadcast group id by default).
//   4. The posted content is AGGREGATE + name-free: a seeded donor's NAME never reaches the post.
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook, FinanceShareStatement).
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

const GROUPS = [
  { id: 'notices', name: 'Notices', kind: 'broadcast', sub: 'Dates, news and what’s on' },
  { id: 'prayer', name: 'Prayer', kind: 'group', sub: 'Share & lift requests' },
  { id: 'youth', name: 'Youth', kind: 'group', sub: 'The youth group' },
];
const BROADCAST_ID = 'notices';

const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  if (d.t === 'donor') return { ...d, id: 'donor:' + d.id };
  return d;
});

function setup() {
  const fr = fakeReact();
  let encSubCb = null;
  const published = [];   // every Steward.publishPost(content, groupId) call, captured
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async () => true,
    relayAuthed: () => true,
    publishPost: async (content, groupId) => { published.push({ content, groupId }); return true; },
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, FinanceShareStatement }' });
  // steward-root.jsx (a console script) DEFINES window.useStewardChurch/useStewardGroups at load, so our
  // stubs must be installed AFTER loadConsole or they are clobbered back to the real (empty) subscriptions.
  window.useStewardChurch = () => ({ name: 'Grace', accent: '', picture: '' });
  window.useStewardGroups = () => GROUPS;
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const button = (label, scope) => (scope ? nodes(scope) : all()).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feedItems = (items) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(items); draw(); };
  // the node whose DIRECT children include a button with `label` (its "row")
  const rowOf = (label) => all().find(n => Array.isArray(n.kids) && n.kids.some(k => k && k.type === 'button' && texts(k).join(' ').includes(label)));
  return { fr, mods, published, draw, all, button, click, feedItems, rowOf, get tree() { return tree; } };
}

function seedBook() {
  const Y = new Date().getFullYear();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  // a gift TAGGED to a donor — the donor's NAME lives only in the finance/donor doc, never in the journal
  FL.post(b, { date: Y + '-01-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000, donor: 'd1' }] });
  FL.post(b, { date: Y + '-01-20', memo: 'electric', postings: [{ account: 'utilities', dir: 'dr', amount: 8000 }, { account: 'bank', dir: 'cr', amount: 8000 }] });
  return b;
}
// book docs + a donor doc carrying a DISTINCTIVE name the shared statement must never leak
const seedItems = () => [...toItems(FL.bookToDocs(seedBook())), { t: 'donor', id: 'donor:d1', name: 'Zebediah Quux' }];

test('the "Share statement" control is in the HEADER, a sibling of "Import statement" — not in the Transactions card', () => {
  const h = setup();
  h.draw();
  h.feedItems(seedItems());
  // exactly ONE Share-statement button on the screen
  const shares = h.all().filter(n => n.type === 'button' && texts(n).join(' ').includes('Share statement'));
  assert.equal(shares.length, 1, 'expected exactly one "Share statement" button on the screen, found ' + shares.length);
  // it sits in the header action row (the row that also holds "Import statement")
  const headerRow = h.rowOf('Import statement');
  assert.ok(headerRow, 're-anchor: no row contains the "Import statement" button');
  assert.ok(headerRow.kids.some(k => k && k.type === 'button' && texts(k).join(' ').includes('Share statement')),
    'the "Share statement" button is NOT a sibling of "Import statement" in the header — point-of-use fail');
  // the Transactions-tab card row (the one holding Export CSV) must NOT carry it
  const csvRow = h.rowOf('Export CSV');
  assert.ok(csvRow, 're-anchor: no row contains the "Export CSV" button');
  assert.ok(!csvRow.kids.some(k => k && k.type === 'button' && texts(k).join(' ').includes('Share statement')),
    'the "Share statement" button is still in the Transactions card — it must move OUT to the header');
});

test('the "Send to" picker offers whole-church + every group and DEFAULTS to whole-church', () => {
  const h = setup();
  // render the modal directly with canPost + the real group list (whole-church broadcast first)
  const fr = h.fr; fr.fresh();
  const m = (() => { fr.reset(); const t = h.mods.FinanceShareStatement({ book: seedBook(), F: FL, churchName: 'Grace', accent: '', logo: '', canPost: true, groups: GROUPS, onPostToMembers() {}, onClose() {} }); fr.flush(); return t; })();
  const select = nodes(m).find(n => n.type === 'select' && n.props && n.props.id === 'fin-share-target');
  assert.ok(select, 'the "Send to" target picker did not render — delete it and this fails');
  const optLabels = nodes(select).filter(o => o.type === 'option').map(o => texts(o).join(''));
  assert.ok(optLabels.some(l => /Whole church/.test(l)), 'the whole-church option is missing from the picker');
  assert.ok(optLabels.some(l => /Prayer/.test(l)) && optLabels.some(l => /Youth/.test(l)), 'the ordinary groups are not offered in the picker');
  // default selected value = the broadcast group id, and it is the FIRST option
  assert.equal(select.props.value, BROADCAST_ID, 'the picker must default to the whole-church broadcast group');
  const firstOpt = nodes(select).filter(o => o.type === 'option')[0];
  assert.equal(firstOpt.props.value, BROADCAST_ID, 'whole-church must be the FIRST option in the picker');
});

// Drive the SHIPPED chain: DashFinanceBook wires the real postStatementToMembers onto the modal; we render
// that modal with its real props and click Post → confirm → Yes, spying Steward.publishPost at the boundary.
function openRealModal(h) {
  h.draw();
  h.feedItems(seedItems());
  h.click('Share statement');                                   // header trigger → sharing = true
  const modal = h.all().find(n => n.type === h.mods.FinanceShareStatement);
  assert.ok(modal, 'the header "Share statement" button did not open the FinanceShareStatement modal');
  const props = modal.props;
  assert.equal(props.canPost, true, 'canPost should be true when a broadcast group + relay Steward are present');
  const fr = h.fr; fr.fresh();
  let m = null;
  const drawM = () => { fr.reset(); m = h.mods.FinanceShareStatement(props); fr.flush(); return m; };
  drawM();
  const mBtn = (label) => nodes(m).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
  const mSelect = () => nodes(m).find(n => n.type === 'select' && n.props && n.props.id === 'fin-share-target');
  const setTarget = (v) => { mSelect().props.onChange({ target: { value: v } }); drawM(); };
  const post = async () => {
    mBtn('Post to members').props.onClick({ stopPropagation() {}, preventDefault() {} }); drawM();   // → confirm
    mBtn('Yes, post to members').props.onClick({ stopPropagation() {}, preventDefault() {} });        // → doPost (async)
    await new Promise(r => setTimeout(r));   // let doPost → postStatementToMembers → publishPost settle
  };
  return { setTarget, post, drawM, get m() { return m; } };
}

test('posting to a CHOSEN group calls Steward.publishPost with that group id (name-free content)', async () => {
  const h = setup();
  const d = openRealModal(h);
  d.setTarget('prayer');
  await d.post();
  assert.equal(h.published.length, 1, 'expected exactly one publishPost call, got ' + h.published.length);
  assert.equal(h.published[0].groupId, 'prayer', 'the statement was NOT posted to the chosen group');
  const content = h.published[0].content;
  assert.ok(/Total income/.test(content) && /£/.test(content), 're-anchor: the posted content is not the aggregate statement text');
  assert.ok(!/Zebediah/.test(content), 'INVARIANT BROKEN: a donor name reached the shared statement');
});

test('posting with the DEFAULT target uses the whole-church broadcast group id', async () => {
  const h = setup();
  const d = openRealModal(h);
  await d.post();   // no setTarget — default stands
  assert.equal(h.published.length, 1, 'expected exactly one publishPost call');
  assert.equal(h.published[0].groupId, BROADCAST_ID, 'the default post must go to the whole-church broadcast group');
});
