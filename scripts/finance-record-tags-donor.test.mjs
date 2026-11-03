// THE PATH INTO THE FEATURE: RECORDING A GIFT CAN TAG A DONOR, AND THAT TAG REACHES THE POSTING.
//   Run: node --test scripts/finance-record-tags-donor.test.mjs
//
// Phase 4b build-audit F1 (CLAUDE.md rule 1 — test the path INTO the feature, not just the engine). The
// engine carries posting.donor and givingByMember/Gift-Aid read it, but until this was built NOTHING in the
// app ever SET posting.donor, so giving-by-member was always "(unattributed)" in the shipped console. Two
// halves, both on the rendered/record path, never a text match in app/*.jsx (rule 3):
//   A. THE PICKER — the REAL BooksRecord (sliced, compiled, rendered through miniReact) shows a Donor picker
//      on a MONEY-IN entry, its options map each donor NAME to that donor's OPAQUE id, and choosing one puts
//      that id (NOT the name) into the onRecord payload. Delete the picker and this fails (confirmed by a
//      /tmp sabotage in the repo's audit).
//   B. THE WIRING — the REAL record() closure (lifted from DashFinanceBook and run with a real ledger) applies
//      that id to the income posting(s) only, never the bank leg and never a money-out leg; and givingByMember
//      then attributes the gift to the donor's NAME instead of "(unattributed)".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { createBook, addAccount, post } from '../src/finance-ledger.mjs';
import { givingByMember } from '../src/finance-reports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-finance.jsx'), 'utf8');
const DONORS = [{ id: 'd-opaque-1', name: 'Ada Lovelace', eligible: true }, { id: 'd-opaque-2', name: 'Ben Shaw', eligible: false }];

function book() {
  const b = createBook({ baseCurrency: 'GBP', decimals: 2 });
  addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  addAccount(b, { id: 'utilities', code: '5000', name: 'Utilities', type: 'expense' });
  return b;
}

// ── A. THE PICKER ───────────────────────────────────────────────────────────────────────────────────────
async function loadBooksRecord() {
  const src = fnBody(SRC, 'function BooksRecord(', 'BooksRecord');
  const tmp = join(tmpdir(), 'rtd-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { BooksRecord };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  // the module-level helpers the slice leaves free
  const globals = {
    React: null,   // filled per render below
    booksParse: (s) => Math.round(parseFloat(String(s || '0').replace(/[^0-9.]/g, '')) * 100) || 0,
    booksTodayISO: () => '2026-05-01',
    booksFmt: (m) => '£' + (m / 100).toFixed(2),
    booksShrinkImage: async () => 'data:', booksRandId: () => 'att1',
    useStewDialog: () => ({ current: null }),
    bkCard: {}, bkLbl: {}, bkFld: {}, CCY_SYM: { GBP: '£' },
  };
  return { js, globals };
}

test('BooksRecord shows a Donor picker on money-IN, mapping each donor NAME to its opaque id', async () => {
  const { js, globals } = await loadBooksRecord();
  const { React, draw } = miniReact();
  const g = { ...globals, React };
  const key = '__rtd_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { BooksRecord } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));

  const captured = [];
  const props = { book: book(), donors: DONORS, onRecord: (p) => captured.push(p), onClose() {}, initial: null };
  let tree = draw(BooksRecord, props);

  const donorSel = find(tree, n => n.type === 'select' && n.props && n.props['aria-label'] === 'Donor')[0];
  assert.ok(donorSel, 'there is no Donor picker on a money-in entry — the path INTO giving-by-member is missing (rule 1)');
  // the opaque id is the option VALUE; the NAME is only display text (this harness's texts() folds the string
  // `value` prop into the text, so match by VALUE and check the name is PRESENT, rather than an exact text ===)
  const opts = find(donorSel, n => n.type === 'option');
  assert.ok(opts.some(o => o.props.value === '' && texts(o).join(' ').includes('(unattributed)')), 'the picker has no "(unattributed)" default');
  const ada = opts.find(o => o.props.value === 'd-opaque-1');
  assert.ok(ada, 'the donor is not offered in the picker keyed by its opaque id — the picker must carry the OPAQUE id as the option value (the value is what reaches the network-readable journal), never the name');
  assert.ok(texts(ada).join(' ').includes('Ada Lovelace'), 're-anchor: the option for the opaque id does not display the donor name');

  // choose Ada, fill an amount, submit — and read what onRecord received
  donorSel.props.onChange({ target: { value: 'd-opaque-1' } });
  find(tree, n => n.type === 'input' && n.props && n.props['aria-label'] === 'Amount')[0].props.onChange({ target: { value: '100.00' } });
  tree = draw(BooksRecord, props);
  find(tree, n => n.type === 'button' && /Record money IN/.test(texts(n).join(' ')))[0].props.onClick({ stopPropagation() {} });

  assert.equal(captured.length, 1, 'submitting recorded nothing');
  assert.equal(captured[0].donor, 'd-opaque-1', 'the chosen donor id did not reach the record payload');
  assert.notEqual(captured[0].donor, 'Ada Lovelace', 'the payload carries the donor NAME — it must be the opaque id, never the name');
});

test('the Donor picker is NOT shown on a money-OUT entry (a bill has no giver)', async () => {
  const { js, globals } = await loadBooksRecord();
  const { React, draw } = miniReact();
  const g = { ...globals, React };
  const key = '__rtd_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { BooksRecord } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const tree = draw(BooksRecord, { book: book(), donors: DONORS, onRecord() {}, onClose() {}, initial: { dir: 'out' } });
  assert.equal(find(tree, n => n.type === 'select' && n.props && n.props['aria-label'] === 'Donor').length, 0,
    'a Donor picker is shown on a money-out entry — expenses have no donor');
});

// ── B. THE WIRING: the REAL record() tags the income posting with the opaque id ─────────────────────────────
function liftRecord(captureEntry) {
  const body = fnBody(SRC, 'const record = async ({ dir, legs, totalMinor, date, memo, attachment, donor }) => {', 'record');
  const b = book();
  const scope = {
    bookRef: { current: b },
    F: { post },
    pubAttachment: async () => true,
    pubEntry: async (bk, entry) => { captureEntry(entry); return true; },
    _dropIfRefused: () => {},
    bump: () => {},
  };
  const fn = new Function(...Object.keys(scope), body + '\nreturn record;')(...Object.values(scope));
  return { record: fn, book: b };
}

test('record() applies the donor id to the income posting ONLY, never the bank leg', async () => {
  let entry = null;
  const { record } = liftRecord(e => { entry = e; });
  await record({ dir: 'in', legs: [{ account: 'giving', fund: 'general', amountMinor: 10000 }], totalMinor: 10000, date: '2026-05-01', memo: 'Gift', attachment: null, donor: 'd-opaque-1' });
  assert.ok(entry, 'record() posted nothing');
  const income = entry.postings.find(p => p.account === 'giving');
  const bank = entry.postings.find(p => p.account === 'bank');
  assert.equal(income.donor, 'd-opaque-1', 'the donor id did not land on the income posting — giving-by-member will never attribute this gift');
  assert.equal(bank.donor, undefined, 'the donor id leaked onto the bank (cash) leg — it belongs on the income posting alone');
});

test('a SPLIT money-in entry tags every income leg with the donor', async () => {
  let entry = null;
  const { record } = liftRecord(e => { entry = e; });
  await record({ dir: 'in', legs: [{ account: 'giving', fund: 'general', amountMinor: 6000 }, { account: 'giving', fund: 'general', amountMinor: 4000 }], totalMinor: 10000, date: '2026-05-01', memo: 'Gift', attachment: null, donor: 'd-opaque-1' });
  const incomeLegs = entry.postings.filter(p => p.account === 'giving');
  assert.equal(incomeLegs.length, 2, 're-anchor: the split did not produce two income legs');
  assert.ok(incomeLegs.every(p => p.donor === 'd-opaque-1'), 'a split gift did not tag every income leg with the donor');
});

test('money-OUT never carries a donor, even if one is passed', async () => {
  let entry = null;
  const { record } = liftRecord(e => { entry = e; });
  await record({ dir: 'out', legs: [{ account: 'utilities', fund: 'general', amountMinor: 5000 }], totalMinor: 5000, date: '2026-05-01', memo: 'Bill', attachment: null, donor: 'd-opaque-1' });
  assert.ok(entry.postings.every(p => p.donor === undefined), 'a money-out entry carried a donor — expenses have no giver');
});

test('…and givingByMember then attributes the gift to the donor NAME, not "(unattributed)"', async () => {
  let entry = null;
  const { record, book: b } = liftRecord(e => { entry = e; });
  await record({ dir: 'in', legs: [{ account: 'giving', fund: 'general', amountMinor: 10000 }], totalMinor: 10000, date: '2026-05-01', memo: 'Gift', attachment: null, donor: 'd-opaque-1' });
  const rows = givingByMember(b, { donors: DONORS });
  const ada = rows.find(r => r.donor === 'd-opaque-1');
  assert.ok(ada, 'the recorded gift was not attributed to the donor at all');
  assert.equal(ada.name, 'Ada Lovelace', 'the gift was not resolved to the donor name');
  assert.equal(ada.amount, 10000, 'the attributed amount is wrong');
  assert.ok(!rows.some(r => r.unattributed), 'the gift still shows as unattributed — the INTO path is broken');
});
