// THE PATH INTO THE FEATURE: A BANK-STATEMENT IMPORT CAN TAG A DONOR, AND THAT TAG REACHES THE POSTING.
//   Run: node --test scripts/finance-import-tags-donor.test.mjs
//
// Stream C (CLAUDE.md rule 1 — test the path INTO the feature, not just the engine). Statement-IMPORTED gifts
// used to come in UNtagged, so every one fell to "(unattributed)" in giving-by-member and was excluded from
// Gift Aid. The manual path (BooksRecord) already tags a donor; this adds the SAME per-line opaque-id picker to
// the Import REVIEW path, money-IN lines only.
//
// HOW THIS TEST REACHES THE FEATURE (rule 3 — never a text match in app/*.jsx, which ships unbundled so a
// `false &&` would leave the words in place): it renders the REAL DashFinanceBook + FinanceImport through
// loadConsole with the SHIPPED vendor/finance-ledger.js, opens the import dialog from the screen's own button,
// feeds a CSV through the file input, reaches the review step, CHOOSES a donor on a money-in row via its real
// onChange, taps "Post", and then reads the opaque id back off the POSTED book and runs the real givingByMember.
// Delete the picker <select> and test 1 goes red; delete the doPost/importStatement wiring and test 2 goes red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';
import { givingByMember } from '../src/finance-reports.mjs';

const F = new Function(readFileSync(new URL('../vendor/finance-ledger.js', import.meta.url), 'utf8') + '\nreturn FinanceLedger;')();
const tick = () => new Promise(r => setTimeout(r, 0));

// Ada is a real, Gift-Aid-eligible donor record; the import picker must offer her keyed by her OPAQUE id 'd1'.
const DONOR_ID = 'd1';
const DONOR_NAME = 'Ada Lovelace';

function seedBook(build) {
  const b = F.createBook({ baseCurrency: 'GBP', decimals: 2 });
  [['bank', '1000', 'Bank / cash', 'asset'], ['giving', '4000', 'Giving & offerings', 'income'],
   ['other-expense', '5900', 'Other costs', 'expense']].forEach(([id, code, name, type]) => F.addAccount(b, { id, code, name, type }));
  if (build) build(b);
  const docs = F.bookToDocs(b).map(d => {
    if (d.t === 'settings') return { ...d, id: 'settings' };
    if (d.t === 'account') return { ...d, id: 'account:' + d.id };
    if (d.t === 'fund') return { ...d, id: 'fund:' + d.id };
    return { ...d, id: 'journal:' + d.seq };
  });
  // A finance/donor:<id> side doc (NOT part of the double-entry book) — finItemToDoc decodes 'donor:d1' into the
  // console's `donors` state, which DashFinanceBook now threads into FinanceImport.
  docs.push({ id: 'donor:' + DONOR_ID, name: DONOR_NAME, eligible: true });
  return docs;
}

const hasText = (n, s) => nodes(n).some(k => (k.kids || []).some(c => typeof c === 'string' && c.includes(s)));

// Render DashFinanceBook on a relay-backed console whose books hold `build`'s entries plus the donor record.
async function openFinance(build) {
  const { React, reset, flush, fresh } = fakeReact();
  let encCb = null; const published = [];
  const Steward = fakeSteward({
    actingChurch: '', encSubscribe: (prefix, cb) => { encCb = cb; return () => {}; },
    encPublish: async (d, body) => { published.push({ d, body }); return true; }, relayAuthed: () => true,
  });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = F;
  const mods = loadConsole({ React, window, expr: '{ DashFinanceBook, FinanceImport }' });
  let tree;
  const draw = () => { reset(); tree = mods.DashFinanceBook(); flush(); return tree; };
  draw();
  assert.ok(encCb, 'DashFinanceBook never subscribed to the finance documents');
  encCb(seedBook(build)); draw();
  const button = (label) => nodes(tree).find(n => n.type === 'button' && hasText(n, label));
  return { React, window, mods, draw, button, tree: () => tree, published, fresh, reset, flush };
}

// Open the import dialog from the Finance screen and walk it to the review step with `csv` as the chosen file.
// `beforePost(ctx)` runs at the review step (ctx = { tree, draw, redraw }); if `post`, it then taps "Post".
async function importCsv(h, csv, { post = true, beforePost = null } = {}) {
  h.button('Import statement').props.onClick(); h.draw();
  const el = nodes(h.tree()).find(n => n.type === h.mods.FinanceImport);
  assert.ok(el, 'tapping Import statement did not open the import dialog');
  const dialogProps = el.props;
  h.fresh();
  let closed = false;
  const props = { ...dialogProps, onClose: () => { closed = true; } };
  h.window.FileReader = class { readAsText() { this.result = csv; this.onload && this.onload(); } };
  let t;
  const draw = () => { h.reset(); t = h.mods.FinanceImport(props); h.flush(); return t; };
  const btn = (label) => nodes(t).find(n => n.type === 'button' && hasText(n, label));
  draw();
  nodes(t).find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [{ name: 'statement.csv' }] } });
  draw();
  btn('Review transactions').props.onClick(); draw();
  const out = { book: props.book, closed: () => closed, tree: () => t, nodesOf: () => nodes(t) };
  if (beforePost) { beforePost({ tree: () => t, draw, nodesOf: () => nodes(t) }); draw(); }
  if (!post) return out;
  const postBtn = btn('Post');
  assert.ok(postBtn, 'the review step showed no Post button');
  postBtn.props.onClick(); await tick(); draw();
  out.errs = nodes(t).filter(n => n.type === 'p').map(p => (p.kids || []).join(''));
  return out;
}

const HEAD = 'Date,Description,Amount\n';
const donorSelects = (ns) => ns.filter(n => n.type === 'select' && n.props && n.props['aria-label'] === 'Donor');

// ── 1. THE PICKER: present on a money-IN review row, ABSENT on money-OUT ────────────────────────────────────
test('the review step shows a Donor picker on a money-IN line and NONE on a money-OUT line', async () => {
  const h = await openFinance();
  // One credit (money-in) and one debit (money-out) in one statement.
  const r = await importCsv(h, HEAD + '02/09/2026,Sunday gift,100.00\n03/09/2026,Hall bill,-45.00\n', { post: false });
  const sels = donorSelects(r.nodesOf());
  assert.equal(sels.length, 1, 'expected exactly one Donor picker — one per money-IN line, none on money-OUT (a bill has no giver)');
  const sel = sels[0];
  const opts = nodes(sel).filter(n => n.type === 'option');
  assert.ok(opts.some(o => o.props.value === '' && (o.kids || []).join(' ').includes('(unattributed)')), 'the picker has no "(unattributed)" default');
  const ada = opts.find(o => o.props.value === DONOR_ID);
  assert.ok(ada, 'the donor is not offered keyed by its OPAQUE id — the option value must be the id (what reaches the network-readable journal), never the name');
  assert.ok((ada.kids || []).join(' ').includes(DONOR_NAME), 're-anchor: the option for the opaque id does not display the donor name');
  assert.ok(!opts.some(o => o.props.value === DONOR_NAME), 'the donor NAME is being used as an option value — it must be the opaque id');
});

// ── 2. THE WIRING: choosing a donor lands the OPAQUE id on the income (cr) leg, never the bank leg ──────────
test('choosing a donor on a money-IN line tags the income (cr) posting with the opaque id, not the bank leg', async () => {
  const h = await openFinance();
  const r = await importCsv(h, HEAD + '02/09/2026,Sunday gift,100.00\n', {
    beforePost: ({ nodesOf }) => {
      const sel = donorSelects(nodesOf())[0];
      assert.ok(sel, 'no Donor picker to choose from on the money-in line');
      sel.props.onChange({ target: { value: DONOR_ID } });
    },
  });
  assert.equal(r.closed(), true, 'the import did not close cleanly: ' + JSON.stringify(r.errs));
  const gift = r.book.journal.find(e => /Sunday gift/.test(e.memo));
  assert.ok(gift, 'the imported gift was never posted to the book');
  const income = gift.postings.find(p => p.account === 'giving');
  const bank = gift.postings.find(p => p.account === 'bank');
  assert.equal(income.dir, 'cr', 're-anchor: the income leg is no longer the cr leg');
  assert.equal(income.donor, DONOR_ID, 'the chosen donor id did not land on the income posting — giving-by-member will never attribute this imported gift');
  assert.equal(bank.donor, undefined, 'the donor id leaked onto the bank (cash) leg — it belongs on the income posting alone');
});

// A money-in line left on "(unattributed)" posts no donor (the default must not invent an attribution).
test('a money-IN line left on "(unattributed)" posts NO donor', async () => {
  const h = await openFinance();
  const r = await importCsv(h, HEAD + '02/09/2026,Plate cash,55.00\n');   // no beforePost: donor stays ''
  const gift = r.book.journal.find(e => /Plate cash/.test(e.memo));
  assert.ok(gift, 'the gift was not posted');
  assert.ok(gift.postings.every(p => p.donor === undefined), 'an unattributed import carried a donor id — "(unattributed)" must tag nothing');
});

// ── 3. MONEY-OUT never carries a donor ──────────────────────────────────────────────────────────────────────
test('a money-OUT line carries no donor on any posting', async () => {
  const h = await openFinance();
  const r = await importCsv(h, HEAD + '03/09/2026,Hall bill,-45.00\n');
  const bill = r.book.journal.find(e => /Hall bill/.test(e.memo));
  assert.ok(bill, 'the money-out line was not posted');
  assert.ok(bill.postings.every(p => p.donor === undefined), 'a money-out entry carried a donor — expenses have no giver');
});

// ── 4. giving-by-member ATTRIBUTES the imported gift to the donor NAME, not "(unattributed)" ────────────────
test('…and givingByMember then attributes the imported gift to the donor, not "(unattributed)"', async () => {
  const h = await openFinance();
  const r = await importCsv(h, HEAD + '02/09/2026,Sunday gift,100.00\n', {
    beforePost: ({ nodesOf }) => { donorSelects(nodesOf())[0].props.onChange({ target: { value: DONOR_ID } }); },
  });
  const rows = givingByMember(r.book, { donors: [{ id: DONOR_ID, name: DONOR_NAME, eligible: true }] });
  const ada = rows.find(row => row.donor === DONOR_ID);
  assert.ok(ada, 'the imported gift was not attributed to the donor at all');
  assert.equal(ada.name, DONOR_NAME, 'the imported gift was not resolved to the donor name');
  assert.equal(ada.amount, 10000, 'the attributed amount is wrong (expected £100.00 in minor units)');
  assert.ok(!rows.some(row => row.unattributed), 'the imported gift still shows as unattributed — the INTO path is broken');
});
