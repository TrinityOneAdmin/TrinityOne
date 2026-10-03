// SIM ROUND 2 (2026-10-02), FINANCE: findings 16, 61 and 62, driven through the real Finance screen.
//   Run: node --test scripts/a-second-identical-payment-imports-and-the-export-is-in-pounds.test.mjs
//
//  16  A bank import dropped a real second payment. The review marks the lines already in the books as `dup`
//      and ticks the rest; importStatement then counted the SAME held entry again against the one pick that
//      shared its key, skipped it, and the modal closed with no message. Books £45 short of the bank.
//  61  The reversal of a £100 gift read "+£100" in green (inflow was "is this an income account", not "which
//      way did the posting go").
//  62  "Export CSV" wrote the ledger's integer pence, so £45.00 read 4500 in the treasurer's spreadsheet.
//
// HOW THIS TEST REACHES THEM. It loads the console's own scripts (loadConsole), renders DashFinanceBook, opens
// the import dialog from the button, feeds a CSV through the file input, taps "Review transactions" and
// "Post N transactions", and clicks "Export CSV" — so deleting the call site from the screen turns it red, not
// just breaking an engine function. The ledger is the SHIPPED vendor/finance-ledger.js.
//
// Callers of the code changed (CLAUDE.md rule 2): importStatement (one caller: FinanceImport's doPost, passes
// the new 2nd argument), booksEntryView (one caller: the Recent transactions list in DashFinanceBook),
// journalCsvRows (new; one caller: exportCsv in DashFinanceBook).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

const F = new Function(readFileSync(new URL('../vendor/finance-ledger.js', import.meta.url), 'utf8') + '\nreturn FinanceLedger;')();
const tick = () => new Promise(r => setTimeout(r, 0));

function seedBook(build) {
  const b = F.createBook({ baseCurrency: 'GBP', decimals: 2 });
  [['bank', '1000', 'Bank / cash', 'asset'], ['giving', '4000', 'Giving & offerings', 'income'],
   ['other-expense', '5900', 'Other costs', 'expense']].forEach(([id, code, name, type]) => F.addAccount(b, { id, code, name, type }));
  if (build) build(b);
  // `id` goes AFTER the spread: finItemToDoc keys on the d-suffix ('account:bank'), and a doc's own `id` would win otherwise.
  return F.bookToDocs(b).map(d => {
    if (d.t === 'settings') return { ...d, id: 'settings' };
    if (d.t === 'account') return { ...d, id: 'account:' + d.id };
    if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
    return { ...d, id: 'journal:' + d.seq };
  });
}

const kidsText = (n) => nodes(n).flatMap(k => (k.kids || []).filter(s => typeof s === 'string' || typeof s === 'number')).join('');
const hasText = (n, s) => nodes(n).some(k => (k.kids || []).some(c => typeof c === 'string' && c.includes(s)));

// Render DashFinanceBook on a relay-backed console whose books hold `build`'s entries.
async function openFinance(build) {
  const { React, reset, flush, fresh, unmount } = fakeReact();
  let encCb = null; const published = [];
  const Steward = fakeSteward({
    actingChurch: '', encSubscribe: (prefix, cb) => { encCb = cb; return () => {}; },
    encPublish: async (d, body) => { published.push({ d, body }); return true; }, relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = F;
  let csvText = null;
  const mods = loadConsole({ React, window, expr: '{ DashFinanceBook, FinanceImport }' });
  window.saveConsoleFile = async (name, text) => { csvText = text; return 'Saved ' + name; };   // booksDownload's one dependency
  let tree;
  const draw = () => { reset(); tree = mods.DashFinanceBook(); flush(); return tree; };
  draw();
  assert.ok(encCb, 'DashFinanceBook never subscribed to the finance documents');
  encCb(seedBook(build)); draw();
  const button = (label) => nodes(tree).find(n => n.type === 'button' && hasText(n, label));
  return { React, window, mods, draw, button, tree: () => tree, published, csv: () => csvText, fresh, reset, flush, unmount };
}

// Open the dialog from the Finance screen and walk it as a treasurer does, with `csv` as the chosen file.
// Stops after the review step unless `post` is true.
async function importCsv(h, csv, { post = true } = {}) {
  // The FIRST open goes through the Finance screen's own button, so the dialog is given its book and its onPost
  // (importStatement) by DashFinanceBook. Drawing the dialog needs its own hook slots (fresh()), which also drops
  // DashFinanceBook's — so a later open re-uses the props the screen handed over; they close over the same
  // live book (bookRef), exactly as a second tap on the real screen would.
  if (!h.dialogProps) {
    h.button('Import statement').props.onClick(); h.draw();
    const el = nodes(h.tree()).find(n => n.type === h.mods.FinanceImport);
    assert.ok(el, 'tapping Import statement did not open the import dialog');
    h.dialogProps = el.props;
    h.fresh();
  } else h.fresh();
  let closed = false;
  const props = { ...h.dialogProps, onClose: () => { closed = true; } };
  h.window.FileReader = class { readAsText() { this.result = csv; this.onload && this.onload(); } };
  let t;
  const draw = () => { h.reset(); t = h.mods.FinanceImport(props); h.flush(); return t; };
  const btn = (label) => nodes(t).find(n => n.type === 'button' && hasText(n, label));
  draw();
  nodes(t).find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [{ name: 'statement.csv' }] } });
  draw();
  btn('Review transactions').props.onClick(); draw();
  const counts = kidsText(nodes(t).find(n => n.type === 'span' && hasText(n, 'found')));
  const out = { counts, book: props.book, closed: () => closed };
  if (!post) return out;
  const postBtn = btn('Post');
  assert.ok(postBtn, 'the review step showed no Post button');
  out.postLabel = kidsText(postBtn);
  postBtn.props.onClick(); await tick(); draw();
  out.errs = nodes(t).filter(n => n.type === 'p').map(kidsText);
  return out;
}

const HEAD = 'Date,Description,Amount\n';
const cleaners = (b) => b.journal.filter(e => /CLEANER/i.test(e.memo));

test('16: a second identical payment on a later statement is imported, not silently dropped', async () => {
  const h = await openFinance();
  // Statement A, imported earlier: one cleaner payment of £45.00.
  const a = await importCsv(h, HEAD + '02/09/2026,CLEANER,-45.00\n');
  assert.equal(a.closed(), true, 'harness: the first import did not complete — ' + JSON.stringify(a.errs));
  assert.equal(cleaners(a.book).length, 1, 'harness: statement A did not post its one cleaner');

  // Statement B: the SAME payment again plus a genuine SECOND identical one, and the flowers.
  const b = await importCsv(h, HEAD + '02/09/2026,CLEANER,-45.00\n02/09/2026,CLEANER,-45.00\n03/09/2026,FLOWERS,-38.00\n');
  assert.match(b.counts, /2 selected.*3 found.*1 already imported/, 'the review no longer flags exactly one line as already imported');
  assert.equal(b.postLabel, 'Post 2 transactions');
  assert.equal(b.closed(), true, 'the import did not close cleanly: ' + JSON.stringify(b.errs));
  assert.equal(cleaners(b.book).length, 2,
    'THE SECOND CLEANER WAS DROPPED. The review ticked it and "Post 2 transactions" posted one, with no message: ' +
    'the books end £45 short of the bank statement');
  assert.equal(b.book.journal.length, 3, 'expected cleaner (A) + second cleaner + flowers');
  const bank = F.trialBalance(b.book).rows.find(r => r.account === 'bank');
  assert.equal(bank.credit - bank.debit, 4500 + 4500 + 3800, 'the bank account does not match the two statements');
  h.unmount();
});

test('16 CONTROL: the same statement imported twice flags every line and posts nothing more', async () => {
  const h = await openFinance();
  const csv = HEAD + '02/09/2026,CLEANER,-45.00\n02/09/2026,CLEANER,-45.00\n';
  const first = await importCsv(h, csv);
  assert.equal(cleaners(first.book).length, 2, 'harness: the first import did not post both lines');
  const second = await importCsv(h, csv, { post: false });
  assert.match(second.counts, /0 selected.*2 found.*2 already imported/, 're-importing the same file no longer flags both lines');
  assert.equal(cleaners(second.book).length, 2);
  h.unmount();
});

// A gift of £100.00 and its reversal, then a £45.50 payment, as the books hold them.
const withReversal = (b) => {
  F.post(b, { date: '2026-09-01', memo: 'Sunday gift', postings: [{ account: 'bank', dir: 'dr', amount: 10000 }, { account: 'giving', fund: 'general', dir: 'cr', amount: 10000 }] });
  F.reverse(b, 1);
  F.post(b, { date: '2026-09-02', memo: 'Hall hire', postings: [{ account: 'other-expense', fund: 'general', dir: 'dr', amount: 4550 }, { account: 'bank', dir: 'cr', amount: 4550 }] });
};
const rowAmount = (tree, seq) => {
  const row = nodes(tree).find(n => n.type === 'div' && n.props && n.props.key === seq && n.props.style && n.props.style.borderTop);
  assert.ok(row, 'no Recent transactions row for #' + seq);
  const amt = nodes(row).find(n => (n.kids || []).some(s => typeof s === 'string' && /^£/.test(s)));
  assert.ok(amt, 'row #' + seq + ' shows no amount');
  return { sign: amt.kids[0], text: amt.kids[1], color: amt.props.style.color };
};

test('61: the reversal of a gift reads as a deduction, the gift as a receipt', async () => {
  const h = await openFinance(withReversal);
  const gift = rowAmount(h.tree(), 1), rev = rowAmount(h.tree(), 2), spend = rowAmount(h.tree(), 3);
  assert.deepEqual([gift.sign, gift.text], ['+', '£100.00']);
  assert.deepEqual([rev.sign, rev.text], ['−', '£100.00'],
    'THE REVERSAL OF A £100 GIFT IS SHOWN WITH A "+" — a deduction displayed as a receipt');
  assert.notEqual(rev.color, gift.color, 'the reversal is the same colour as the gift it takes back');
  assert.match(rev.color, /clay/, 'a deduction should wear the same colour as other money out');
  assert.deepEqual([spend.sign, spend.text], ['−', '£45.50'], 'CONTROL: an ordinary payment is still money out');
  h.unmount();
});

test('62: Export CSV writes pounds, not pence', async () => {
  const h = await openFinance(withReversal);
  h.button('Export CSV').props.onClick(); await tick();
  const csv = h.csv();
  assert.ok(csv, 'Export CSV saved nothing');
  const rows = csv.split('\n').map(l => l.split('","').map(c => c.replace(/^"|"$/g, '')));
  assert.deepEqual(rows[0], ['seq', 'date', 'memo', 'account', 'fund', 'debit', 'credit']);
  const hall = rows.filter(r => r[2] === 'Hall hire');
  assert.deepEqual(hall.map(r => [r[3], r[5], r[6]]), [['Other costs', '45.50', ''], ['Bank / cash', '', '45.50']],
    'THE EXPORT CARRIES PENCE: a £45.50 payment reads 4550 in the treasurer\'s spreadsheet');
  assert.ok(!/"(4550|10000)"/.test(csv), 'a raw minor-unit amount is still in the file');
  assert.ok(rows.some(r => r[5] === '100.00' || r[6] === '100.00'), 'the £100.00 gift is missing from the export');
  h.unmount();
});
