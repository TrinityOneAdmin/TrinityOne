// THE ACCOUNTS & FUNDS MANAGEMENT UI IS ACTUALLY ON THE SCREEN AND WIRED TO THE RELAY.
//   Run: node --test scripts/the-accounts-and-funds-panel-is-on-screen.test.mjs
//
// CLAUDE.md rules 1 & 3 (point-of-use). Each assertion renders the REAL DashFinanceBook / BooksRecord /
// BooksAccountEdit / BooksFundMove through scripts/console-screens.mjs (the whole console compiled the way
// the phone loads it, one shared scope), and reads the RENDERED TREE — never the .jsx text, so a `false &&`
// in front of a control cannot satisfy it. Deleting the control from the screen fails the test.
//
// Covers: the Add-account / Add-fund / Move-between-funds controls exist; adding an account publishes a
// replaceable finance/account doc; an archived account is gone from the BooksRecord category picker (and a
// live one stays); a fund transfer posts ONE balanced journal entry on the reserved account, publishing the
// reserved account first; and the TYPE selector is locked on a posted account (a type change would silently
// re-sign every report).
//
// Callers of the sliced code: app/stew-finance.jsx (DashFinanceBook + its modals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const _ledger = await import('../src/finance-ledger.mjs');
const _store = await import('../src/finance-store.mjs');
const _statement = await import('../src/finance-statement.mjs');
const _import = await import('../src/finance-import.mjs');
const FL = { ..._ledger, ..._store, ..._statement, ..._import };

// Map a finance-store doc to the encSubscribe item shape DashFinanceBook's finItemToDoc reads.
// NOTE the spread comes BEFORE `id:` — the account/fund docs carry their own `id` field (the slug), and the
// encSubscribe item's `id` is the d-suffix (`account:<slug>`), so `...d` first then the prefixed id, or d.id
// silently overwrites it and finItemToDoc drops the doc.
const toItems = (docs) => docs.map(d => {
  if (d.t === 'settings') return { ...d, id: 'settings' };
  if (d.t === 'account') return { ...d, id: 'account:' + d.id };
  if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
  if (d.t === 'journal') return { ...d, id: 'journal:' + d.seq };
  return d;
});

function setup() {
  const fr = fakeReact();
  const pub = [];
  let encSubCb = null;
  const Steward = fakeSteward({
    actingChurch: '',
    encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; },
    encPublish: async (d, body) => { pub.push({ d, body }); return true; },
    relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, BooksRecord, BooksAccountEdit, BooksFundMove }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const button = (label) => all().find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(label)));
  const comp = (name) => all().find(n => typeof n.type === 'function' && n.type.name === name);
  const click = (label) => { const b = button(label); assert.ok(b, 're-anchor: no button labelled "' + label + '"'); b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw(); };
  const feed = (docs) => { assert.ok(encSubCb, 'encSubscribe was not wired'); encSubCb(toItems(docs)); draw(); };
  return { fr, pub, mods, draw, all, button, comp, click, feed, get tree() { return tree; } };
}

test('the Accounts & funds panel offers Add account, Add fund and Move between funds', () => {
  const h = setup();
  h.draw();
  h.click('Accounts & funds');   // open the collapsible panel
  assert.ok(h.button('Add account'), 'NO "Add account" control on the Accounts & funds panel');
  assert.ok(h.button('Add fund'), 'NO "Add fund" control on the Accounts & funds panel');
  assert.ok(h.button('Move between funds'), 'NO "Move between funds" control on the Accounts & funds panel');
});

test('adding an account publishes a replaceable finance/account:<id> doc', async () => {
  const h = setup();
  h.draw();
  h.click('Accounts & funds');
  h.click('Add account');
  const modal = h.comp('BooksAccountEdit');
  assert.ok(modal, '"Add account" did not open the account modal');
  await modal.props.onSave({ id: 'youth-work', code: '', name: 'Youth work', type: 'expense', archived: false });
  assert.ok(h.pub.some(p => p.d === 'finance/account:youth-work'),
    'adding an account published no finance/account doc; published: ' + h.pub.map(p => p.d).join(', '));
});

test('an ARCHIVED account is absent from the BooksRecord category picker, a live one is present', () => {
  const h = setup();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addAccount(b, { id: 'old-appeal', code: '4500', name: 'Harvest appeal 2025', type: 'income', archived: true });
  h.fr.reset();
  const t = h.mods.BooksRecord({ book: b, onRecord() {}, onClose() {} });
  h.fr.flush();
  const opts = nodes(t).filter(n => n.type === 'option').flatMap(n => (n.kids || []).filter(k => typeof k === 'string'));
  assert.ok(opts.includes('Giving'), 're-anchor: the live income account is missing from the picker');
  assert.ok(!opts.includes('Harvest appeal 2025'),
    'AN ARCHIVED ACCOUNT STILL APPEARS IN THE CATEGORY PICKER — archiving does not hide it. Options: ' + opts.join(', '));
});

test('a fund transfer posts ONE balanced journal entry on the reserved account, publishing that account first', async () => {
  const h = setup();
  h.draw();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addFund(b, { id: 'building', name: 'Building', kind: 'restricted' });
  FL.post(b, { date: '2026-01-01', memo: 'gift', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });
  h.feed(FL.bookToDocs(b));
  h.click('Accounts & funds');
  h.click('Move between funds');
  const modal = h.comp('BooksFundMove');
  assert.ok(modal, '"Move between funds" did not open the transfer modal');
  const ok = await modal.props.onTransfer({ fromFund: 'general', toFund: 'building', amountMinor: 3000, date: '2026-02-01', memo: 'to building' });
  assert.ok(ok, 'the transfer handler reported failure');
  assert.ok(h.pub.some(p => p.d === 'finance/account:fund-transfer'),
    'the reserved fund-transfer account was NOT published before the first transfer (publish-if-absent)');
  const jpub = h.pub.find(p => /^finance\/journal:/.test(p.d));
  assert.ok(jpub, 'the transfer published no journal entry');
  const legs = jpub.body.postings;
  assert.ok(legs.length === 2 && legs.every(p => p.account === 'fund-transfer'), 'the transfer legs are not both on the reserved account');
  const dr = legs.filter(p => p.dir === 'dr').reduce((s, p) => s + p.amount, 0);
  const cr = legs.filter(p => p.dir === 'cr').reduce((s, p) => s + p.amount, 0);
  assert.equal(dr, cr, 'the transfer entry does not balance (Σdr ≠ Σcr)');
});

test('F4: the TYPE selector is DISABLED on a posted account, and editable otherwise', () => {
  const h = setup();
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  const typeSelect = (tree) => nodes(tree).find(n => n.type === 'select');

  h.fr.reset();
  const posted = h.mods.BooksAccountEdit({ book: b, initial: { id: 'giving', code: '4000', name: 'Giving', type: 'income', posted: true }, onSave() {}, onClose() {} });
  h.fr.flush();
  assert.equal(typeSelect(posted).props.disabled, true,
    'THE TYPE SELECTOR IS NOT DISABLED ON A POSTED ACCOUNT — a type change would silently re-sign every projection');

  h.fr.fresh();
  const adding = h.mods.BooksAccountEdit({ book: b, initial: null, onSave() {}, onClose() {} });
  h.fr.flush();
  assert.ok(!typeSelect(adding).props.disabled, 'the type selector should be editable when adding/for an unused account');
});

test('B1/F3: the recent-transactions feed shows a transfer AS a transfer, not as a signed outflow', () => {
  const h = setup();
  h.draw();
  // A book that already holds a fund transfer (general → building), fed through encSubscribe exactly as the
  // relay delivers it. The reserved account doc is present, as publish-if-absent guarantees.
  const b = FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  FL.addFund(b, { id: 'building', name: 'Building', kind: 'restricted' });
  FL.addAccount(b, { id: 'fund-transfer', code: '3900', name: 'Fund transfer', type: 'equity' });
  FL.post(b, { date: '2026-01-01', memo: '', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });
  FL.post(b, { date: '2026-01-02', memo: '', postings: [{ account: 'fund-transfer', fund: 'general', dir: 'dr', amount: 3000 }, { account: 'fund-transfer', fund: 'building', dir: 'cr', amount: 3000 }] });
  h.feed(FL.bookToDocs(b));

  // (1) the feed names it a transfer between the two funds — this text comes from booksEntryView's transfer
  // branch; delete that branch and the row falls back to the reserved account name as a plain outflow.
  assert.ok(texts(h.tree).includes('Transfer: General fund → Building'),
    'THE TRANSFER IS NOT RENDERED AS A TRANSFER in the feed. Screen said: ' + texts(h.tree).join(' | '));

  // (2) its amount is NEUTRAL — no +/− sign, not the clay (outflow) / sage (inflow) colour. Feed amount cells
  // are the only divs at fontSize 14.5 / nowrap; the £30.00 one is the transfer row.
  const amt = nodes(h.tree).find(n => n.type === 'div' && n.props && n.props.style
    && n.props.style.fontSize === 14.5 && n.props.style.whiteSpace === 'nowrap'
    && (n.kids || []).join('').includes('30.00'));
  assert.ok(amt, 're-anchor: no transfer amount row at £30.00 in the feed');
  assert.equal(amt.props.style.color, 'var(--ink-3)',
    'the transfer amount is coloured as an inflow/outflow, not neutral — it reads as money moving in or out');
  const shown = (amt.kids || []).join('');
  assert.ok(!shown.includes('−') && !shown.includes('+'),
    'the transfer amount carries a +/− sign — it reads as income or spending. Shown: ' + JSON.stringify(shown));
});
