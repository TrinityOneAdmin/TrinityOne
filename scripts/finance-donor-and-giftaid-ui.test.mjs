// THE DONOR FORM IS ON THE SCREEN, AND THE REGION (JURISDICTION) SELECTOR DEFAULTS TO NONE.
//   Run: node --test scripts/finance-donor-and-giftaid-ui.test.mjs
//
// Phase 4b + wave 3, point-of-use (CLAUDE.md rules 1 & 3 — assert on the RENDERED tree, never on text in
// app/*.jsx):
//   · BooksDonor (the add/edit-donor dialog) renders its name field, its Gift Aid-declaration toggle and a
//     Save control — delete them from the screen and this fails.
//   · The owner-only Region (jurisdiction) selector (DashFeaturesPanel) renders and DEFAULTS to None — the
//     whole of DOMAIN nation-neutrality turns on this. Wave 3 REPLACED the standalone "Gift Aid (UK)" toggle
//     with this one selector: it reads/writes church.features.jurisdiction, defaults to None with no features
//     set, selecting United Kingdom publishes features.jurisdiction = 'UK' (keeping the legacy giftAid boolean
//     in sync), and a legacy giftAid:true church reads back as UK. (The four Gift-Aid-toggle cases these
//     replaced are gone BY DESIGN — the control changed; count below is net-neutral, documented in the commit.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { listJurisdictions, listTaxRegions, resolveJurisdiction, taxToolFor, donorLabels, TAX_DISCLAIMER } from '../src/finance-jurisdictions.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

async function loadComponent(file, name, anchor, globals) {
  const src = fnBody(read(file), anchor, name);
  const tmp = join(tmpdir(), 'dgui-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__dgui_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}

// ── BooksDonor: the add-donor form is on the screen ─────────────────────────────────────────────────────
test('BooksDonor renders a name field, a Gift Aid-declaration toggle and a Save control', async () => {
  const { React, draw } = miniReact();
  const saved = [];
  const BooksDonor = await loadComponent('app/stew-finance.jsx', 'BooksDonor', 'function BooksDonor(', {
    React, useStewDialog: () => ({ current: null }),
    bkCard: {}, bkLbl: {}, bkFld: {},
  });
  // giftAidOn: true — the UK Gift Aid pack is ON, so the eligibility toggle is on the form (the gate's
  // on-branch; the off-branch is the dedicated gate tests below).
  const tree = draw(BooksDonor, { book: { baseCurrency: 'GBP', decimals: 2 }, initial: null, giftAidOn: true, onSave: (d) => { saved.push(d); return true; }, onClose() {} });
  // it is a real dialog
  assert.ok(find(tree, n => n.props && n.props.role === 'dialog').length === 1, 'BooksDonor did not render a dialog');
  // a name input
  const inputs = find(tree, n => n.type === 'input');
  assert.ok(inputs.some(i => /name/i.test((i.props && i.props.placeholder) || '')), 'the donor name field is not on the form');
  // a Gift Aid eligibility checkbox
  assert.ok(inputs.some(i => i.props && i.props.type === 'checkbox'), 'the Gift Aid-declaration (eligible) toggle is not on the form');
  // a Save/Add control
  const buttons = find(tree, n => n.type === 'button');
  assert.ok(buttons.some(b => /add donor|save/i.test(texts(b).join(' '))), 'there is no Save/Add control on the donor form: ' + buttons.map(b => texts(b).join('')).join(', '));
});

// ── The Gift Aid wording is GATED on the UK pack (wave 2, 2026-10-30) ────────────────────────────────────
// Point-of-use (CLAUDE.md rules 1 & 3): these render the REAL BooksDonor body (lifted via fnBody) and read the
// RENDERED tree, so a `false &&` left in app/*.jsx cannot satisfy them — the strings/inputs must actually be
// absent from (or present in) the tree. giftAidOn is the single boolean the pack gate keys on.
async function loadBooksDonor() {
  const { React, draw } = miniReact();
  const BooksDonor = await loadComponent('app/stew-finance.jsx', 'BooksDonor', 'function BooksDonor(', {
    React, useStewDialog: () => ({ current: null }), bkCard: {}, bkLbl: {}, bkFld: {},
  });
  return { React, draw, BooksDonor };
}

test('T1 — with giftAidOn=false the donor editor shows NO Gift Aid text and none of the UK-only inputs', async () => {
  const { draw, BooksDonor } = await loadBooksDonor();
  const tree = draw(BooksDonor, { book: { baseCurrency: 'GBP', decimals: 2 }, initial: null, giftAidOn: false, onSave: () => true, onClose() {} });
  // No "Gift Aid" anywhere in the rendered tree — texts() also collects the checkbox aria-label, so a hidden
  // field cannot smuggle the phrase back in through a prop.
  assert.ok(!/Gift Aid/.test(texts(tree).join(' ')), 'with the UK pack off, the donor editor still shows "Gift Aid" wording: ' + texts(tree).join(' | '));
  // None of the UK-only inputs: the eligibility checkbox and the declaration-date picker.
  const inputs = find(tree, n => n.type === 'input');
  assert.ok(!inputs.some(i => i.props && i.props.type === 'checkbox'), 'the Gift Aid eligibility checkbox is still on the form with the pack off');
  assert.ok(!inputs.some(i => i.props && i.props.type === 'date'), 'the Gift Aid declaration-date picker is still on the form with the pack off');
  // The name field + a Save control still render (the editor is not gone, only the UK fields). Match the Name
  // field by its own placeholder — NOT /name/i, which would also match the hidden address field's "House
  // name/number & street" placeholder and so could not tell "name field present" from "address field present".
  assert.ok(inputs.some(i => /jane okafor/i.test((i.props && i.props.placeholder) || '')), 'gating the UK fields also removed the donor name field');
  assert.ok(find(tree, n => n.type === 'button' && /add donor|save/i.test(texts(n).join(' '))).length >= 1, 'gating the UK fields also removed the Save control');
});

test('T2 — with giftAidOn=true the UK Gift Aid fields and labels are all present', async () => {
  const { draw, BooksDonor } = await loadBooksDonor();
  const tree = draw(BooksDonor, { book: { baseCurrency: 'GBP', decimals: 2 }, initial: null, giftAidOn: true, onSave: () => true, onClose() {} });
  const all = texts(tree).join(' ');
  assert.ok(/Has made a Gift Aid declaration \(UK\)/.test(all), 'the Gift Aid declaration wording is missing with the pack on');
  assert.ok(/Address \(for a Gift Aid claim\)/.test(all), 'the "Address (for a Gift Aid claim)" label is missing with the pack on');
  assert.ok(/Declaration date/.test(all), 'the Declaration date label is missing with the pack on');
  const inputs = find(tree, n => n.type === 'input');
  assert.ok(inputs.some(i => i.props && i.props.type === 'checkbox'), 'the eligibility checkbox is missing with the pack on');
  assert.ok(inputs.some(i => i.props && i.props.type === 'date'), 'the declaration-date picker is missing with the pack on');
});

test('T3 — saving with the UK fields hidden PRESERVES the donor’s prior eligible/address/postcode/declaration values', async () => {
  const { draw, BooksDonor } = await loadBooksDonor();
  let saved = null;
  const initial = { id: 'd1', name: 'Ada Lovelace', eligible: true, address: '1 Analytical St', postcode: 'AB1 2CD', giftAidDeclaredAt: '2026-01-01' };
  const tree = draw(BooksDonor, { book: { baseCurrency: 'GBP', decimals: 2 }, initial, giftAidOn: false, onSave: (d) => { saved = d; return true; }, onClose() {} });
  // The UK inputs are hidden (giftAidOn=false) — but the Save control must still carry the loaded values.
  const saveBtn = find(tree, n => n.type === 'button' && /save|add donor/i.test(texts(n).join(' ')))[0];
  assert.ok(saveBtn, 're-anchor: no Save control on the donor editor');
  await saveBtn.props.onClick({ stopPropagation() {}, preventDefault() {} });
  assert.ok(saved, 'clicking Save did not call onSave');
  assert.equal(saved.eligible, true, 'eligible was dropped on save when the UK fields were hidden');
  assert.equal(saved.address, '1 Analytical St', 'address was dropped on save when the UK fields were hidden');
  assert.equal(saved.postcode, 'AB1 2CD', 'postcode was dropped on save when the UK fields were hidden');
  assert.equal(saved.giftAidDeclaredAt, '2026-01-01', 'the declaration date was dropped on save when the UK fields were hidden');
});

// ── DashFeaturesPanel: the owner-only Tax tools SUBCARD — its switch, the nested Region picker, the scripture
// moment, and nation-neutral-by-default ─────────────────────────────────────────────────────────────────
// Owner change (2026-10-30): the standalone Region selector is now nested under Finance, behind its own
// owner-only "Tax tools" switch (church.features.taxTools). Switch OFF → no Region picker; ON → the Region
// <select> (real regions only, no None). Flipping OFF→ON pops a 1 Samuel 8:10–18 scripture moment. The panel
// reads the registry via window.FinanceLedger (real src module) and uses window.useStewDialog (stubbed).
const furniture = (React) => ({
  Panel: function Panel({ title, children }) { return React.createElement('section', { 'data-panel': title }, children); },
  SkConfirm: function SkConfirm(props) { return React.createElement('div', { 'data-confirm': props.title }); },
  Icon: function Icon() { return null; },
  DashMealsPanel: function DashMealsPanel() { return null; },
  DashGivingPanel: function DashGivingPanel() { return null; },
  // The scripture moment is its OWN top-level component (extracted so the panel carries no role="dialog"). The
  // DashFeaturesPanel slice references it by name, so supply a marker stub; its PRESENCE is what the OFF→ON
  // test asserts. The modal's CONTENT (the 1 Samuel 8 text) is proven by lifting TaxScriptureModal itself below.
  TaxScriptureModal: function TaxScriptureModal(props) { return React.createElement('div', { 'data-tax-scripture': true }); },
  stewCapState: () => ({ allowed: true, owner: true, why: '' }),
  useStewKeyRecipients: () => ({ approved: () => [] }),
});
async function featuresPanel(church, { actingChurch = null } = {}) {
  const { React, draw } = miniReact();
  const published = [];
  const Comp = await loadComponent('app/stew-dashboard.jsx', 'DashFeaturesPanel', 'function DashFeaturesPanel(', {
    React,
    window: {
      useStewardGroups: () => [], useStewardMembers: () => [{ pubkey: 'm1' }], useStewardAdmitted: () => [],
      useStewardJoinPolicy: () => false,
      useStewDialog: () => ({ current: null }),                    // scripture modal registers its Escape/back here
      FinanceLedger: { listJurisdictions, listTaxRegions, resolveJurisdiction, taxToolFor, TAX_DISCLAIMER },   // the real registry drives the picker + gate + disclaimer
      Steward: { actingChurch, publishProfile: (p) => published.push(p), setJoinPolicy() {}, setAdmitted() {} },
    },
    ...furniture(React),
  });
  return { React, draw: () => draw(Comp, { church, show: 'features' }), published };
}
// the Tax tools on/off switch (role=switch, aria-label "Toggle Tax tools")
const taxSwitch = (tree) => find(tree, n => n.props && n.props.role === 'switch' && /Toggle Tax tools/.test(n.props['aria-label'] || ''))[0];
// the Finance module row switch (aria-label "Toggle Finance") — the Tax tools subcard nests under it
const financeSwitch = (tree) => find(tree, n => n.props && n.props.role === 'switch' && /^Toggle Finance$/.test(n.props['aria-label'] || ''))[0];
// the Region selector inside the subcard (aria-label "Region / jurisdiction")
const regionSelect = (tree) => find(tree, n => n.type === 'select' && (n.props && /Region/.test(n.props['aria-label'] || '')))[0];
// the scripture moment — now its OWN component (extracted so the panel carries no role="dialog"); the panel
// renders it as a <TaxScriptureModal> node, which the furniture stub above marks. Assert PRESENCE here; the
// modal's text is proven by the direct-lift test at the end of the file.
const scriptureDialog = (tree) => find(tree, n => typeof n.type === 'function' && n.type.name === 'TaxScriptureModal')[0];

test('the Tax tools switch is on the Congregation features page (owner, Finance on), region picker hidden by default', async () => {
  const s = await featuresPanel({ features: {} });
  const tree = s.draw();
  assert.ok(taxSwitch(tree), 'the Tax tools switch is not on Congregation features');
  assert.ok(!regionSelect(tree), 'the Region picker shows with Tax tools OFF — it must be gated behind the switch');
});

// Owner feedback: the subcard must read as a CHILD of Finance — rendered directly beneath the Finance module
// row, not as a sibling of the Extras section. Proof: in document order the Tax tools switch is the very next
// role="switch" after the Finance row's switch (nothing — e.g. Kids check-in — sits between them).
test('the Tax tools subcard is NESTED directly under the Finance row', async () => {
  const s = await featuresPanel({ features: {} });
  const tree = s.draw();
  const switches = find(tree, n => n.props && n.props.role === 'switch').map(n => n.props['aria-label']);
  const fi = switches.indexOf('Toggle Finance');
  assert.ok(fi >= 0, 're-anchor: no Finance module row switch');
  assert.equal(switches[fi + 1], 'Toggle Tax tools',
    'the Tax tools switch does not immediately follow the Finance row — it is not nested under Finance: ' + JSON.stringify(switches));
});

test('Tax tools DEFAULTS OFF — with no features set the switch reads OFF and the book stays neutral', async () => {
  const s = await featuresPanel({ features: {} });                 // a brand-new church
  assert.equal(taxSwitch(s.draw()).props['aria-checked'], false,
    'Tax tools is ON by default — a church would get tax tooling unasked, violating DOMAIN nation-neutrality.');
});

test('turning Tax tools ON reveals the Region picker — REAL regions only (UK, not None)', async () => {
  const s = await featuresPanel({ features: { taxTools: true } });  // the switch-on state
  const tree = s.draw();
  assert.equal(taxSwitch(tree).props['aria-checked'], true, 're-anchor: the switch does not read ON with taxTools:true');
  const sel = regionSelect(tree);
  assert.ok(sel, 'the Region picker is not shown with Tax tools ON');
  const optVals = find(sel, n => n.type === 'option').map(o => o.props.value);
  assert.ok(!optVals.includes('None'), 'the Region picker offers "None" — None is the switch being off, not a region');
  assert.ok(optVals.includes('UK'), 'the Region picker does not offer the UK region');
});

test('selecting a region writes jurisdiction + taxTools:true + the synced giftAid boolean', async () => {
  const s = await featuresPanel({ features: { taxTools: true } });
  regionSelect(s.draw()).props.onChange({ target: { value: 'UK' } });
  assert.equal(s.published.length, 1, 'choosing a region published nothing');
  assert.equal(s.published[0].features.jurisdiction, 'UK', 'choosing UK did not write features.jurisdiction = UK — it wrote ' + JSON.stringify(s.published[0].features));
  assert.equal(s.published[0].features.taxTools, true, 'choosing a region did not keep taxTools on');
  assert.equal(s.published[0].features.giftAid, true, 'choosing UK did not sync the legacy giftAid boolean (an un-upgraded console reads it)');
});

test('BACK-COMPAT: a legacy giftAid:true church (no taxTools) reads the switch ON and the region UK', async () => {
  const s = await featuresPanel({ features: { giftAid: true } });
  const tree = s.draw();
  assert.equal(taxSwitch(tree).props['aria-checked'], true, 'a legacy giftAid:true church did not read the Tax tools switch ON');
  const sel = regionSelect(tree);
  assert.ok(sel, 'a legacy giftAid:true church shows no Region picker (the switch should read ON)');
  assert.equal(sel.props.value, 'UK', 'a legacy giftAid:true church did not read the region as UK');
});

test('the Tax tools subcard is OWNER-ONLY — a delegated steward (actingChurch set) does not see it', async () => {
  const s = await featuresPanel({ features: {} }, { actingChurch: 'cd'.repeat(32) });
  const tree = s.draw();
  assert.ok(!taxSwitch(tree), 'the Tax tools switch showed to a delegate — publishProfile would silently fail under their hand');
  assert.ok(!regionSelect(tree), 'the Region picker showed to a delegate');
});

test('the Tax tools subcard is hidden when the Finance feature is off (features.finance === false)', async () => {
  const s = await featuresPanel({ features: { finance: false } });
  assert.ok(!taxSwitch(s.draw()), 'the Tax tools switch showed with Finance turned off — it must nest under Finance');
});

// ── CHANGE C: the 1 Samuel 8 scripture moment on the OFF→ON flip ────────────────────────────────────────
// The panel pops it ONLY on OFF→ON. The modal is its own component (TaxScriptureModal); here we assert the
// panel renders that node at the right moment. Its TEXT is proven by lifting TaxScriptureModal directly below.
test('flipping Tax tools OFF→ON pops the scripture moment (the TaxScriptureModal component)', async () => {
  const s = await featuresPanel({ features: {} });   // OFF
  const tree0 = s.draw();
  assert.ok(!scriptureDialog(tree0), 're-anchor: the scripture modal is up before the toggle');
  taxSwitch(tree0).props.onClick({ stopPropagation() {} });   // OFF → ON
  const tree1 = s.draw();                                      // re-render reads the new local state
  assert.ok(scriptureDialog(tree1), 'flipping Tax tools on did not pop the TaxScriptureModal scripture moment');
  // and the publish turned the switch on
  assert.equal(s.published.length, 1, 'flipping the switch published nothing');
  assert.equal(s.published[0].features.taxTools, true, 'flipping the switch on did not write features.taxTools = true');
});

test('the scripture moment does NOT appear on initial render with Tax tools already ON', async () => {
  const s = await featuresPanel({ features: { taxTools: true } });   // already on at load
  assert.ok(!scriptureDialog(s.draw()), 'the scripture moment fired on load, not only on the OFF→ON flip');
});

test('turning Tax tools OFF does NOT pop the scripture moment', async () => {
  const s = await featuresPanel({ features: { taxTools: true } });   // ON
  taxSwitch(s.draw()).props.onClick({ stopPropagation() {} });       // ON → OFF
  assert.ok(!scriptureDialog(s.draw()), 'the scripture moment fired when turning Tax tools OFF');
  assert.equal(s.published[0].features.taxTools, false, 'turning the switch off did not write features.taxTools = false');
});

// TaxScriptureModal ITSELF — lifted and rendered directly, so we prove the passage text, the reference label,
// a role="dialog", and that the single "Amen" dismiss calls onClose. (Extracted from DashFeaturesPanel so the
// panel carries no dialog; registered in every-console-dialog-mounts.test.mjs.)
test('TaxScriptureModal renders 1 Samuel 8:10–18 (WEB), a role="dialog", and an Amen dismiss that closes', async () => {
  const { React, draw } = miniReact();
  let closed = 0;
  const Modal = await loadComponent('app/stew-dashboard.jsx', 'TaxScriptureModal', 'function TaxScriptureModal(', {
    React, window: { useStewDialog: () => ({ current: null }) },
  });
  const tree = draw(Modal, { onClose: () => { closed++; } });
  const dlg = find(tree, n => n.props && n.props.role === 'dialog' && /1 Samuel 8/.test(n.props['aria-label'] || ''))[0];
  assert.ok(dlg, 'TaxScriptureModal did not render a role="dialog" labelled 1 Samuel 8:10–18');
  const words = texts(tree).join(' ');
  assert.ok(/1 Samuel 8:10/.test(words), 'the modal does not carry the 1 Samuel 8:10–18 reference');
  assert.ok(/will take your sons/.test(words), 'the modal does not carry a line of the WEB passage (1 Sam 8:11)');
  assert.ok(/a tenth of your flocks/.test(words), 'the modal does not carry the later passage text (1 Sam 8:17)');
  const amen = find(tree, n => n.type === 'button' && /Amen/.test(texts(n).join(' ')))[0];
  assert.ok(amen, 'the modal has no "Amen" dismiss');
  amen.props.onClick({ stopPropagation() {} });
  assert.equal(closed, 1, 'the Amen dismiss did not call onClose');
});

// ── EXPANSION WAVE: the Region picker lists the new verified schemes; the subcard shows the tax disclaimer ──
test('the Region picker lists the new scheme regions (US, NZ) alongside UK — real schemes only, no None/held', async () => {
  const s = await featuresPanel({ features: { taxTools: true } });
  const sel = regionSelect(s.draw());
  assert.ok(sel, 're-anchor: the Region picker is not shown with Tax tools ON');
  const optVals = find(sel, n => n.type === 'option').map(o => o.props.value).sort();
  assert.deepEqual(optVals, ['NZ', 'UK', 'US'], 'the Region picker options are not exactly the three real schemes: ' + JSON.stringify(optVals));
  // held / currency-only countries must never appear as selectable regions
  for (const held of ['None', 'CA', 'DE', 'FR', 'NL', 'ZA', 'AU', 'IE']) assert.ok(!optVals.includes(held), held + ' leaked into the Region picker — it is not a live scheme');
});

test('the Tax tools subcard renders the shared tax disclaimer when ON (a tax surface must carry the caveat)', async () => {
  const s = await featuresPanel({ features: { taxTools: true } });
  const tree = s.draw();
  // rendered-tree, not source text: the node carries data-tax-disclaimer AND the real constant's words
  const node = find(tree, n => n.props && n.props['data-tax-disclaimer'])[0];
  assert.ok(node, 'the Tax tools subcard did not render the disclaimer footnote');
  assert.ok(/not tax advice/i.test(texts(tree).join(' ')), 'the subcard disclaimer text is not on the rendered tree');
});

test('with Tax tools OFF the subcard shows no disclaimer (it is a tax surface only when on)', async () => {
  const s = await featuresPanel({ features: {} });
  assert.ok(!find(s.draw(), n => n.props && n.props['data-tax-disclaimer'])[0], 'the disclaimer rendered with Tax tools off');
});

// ── BooksDonor: a contribution-statement region shows the registry address label (point-of-use, rendered tree) ──
test('with statementOn (Gift Aid off) the donor editor shows the registry address label and an address input', async () => {
  const { draw, BooksDonor } = await loadBooksDonor();
  const tree = draw(BooksDonor, { book: { baseCurrency: 'USD', decimals: 2 }, initial: null, giftAidOn: false, statementOn: true, addressLabel: donorLabels('US').address, onSave: () => true, onClose() {} });
  const all = texts(tree).join(' ');
  assert.ok(/Mailing address/.test(all), 'the US "Mailing address" registry label is not on the statement donor form');
  assert.ok(!/Gift Aid/.test(all), 'a contribution-statement region leaked Gift Aid wording onto the donor form');
  const inputs = find(tree, n => n.type === 'input');
  assert.ok(inputs.some(i => /street, city, postcode/i.test((i.props && i.props.placeholder) || '')), 'no address input rendered for the statement region');
  // and no UK-only inputs (checkbox / date) since Gift Aid is off
  assert.ok(!inputs.some(i => i.props && (i.props.type === 'checkbox' || i.props.type === 'date')), 'a UK-only Gift Aid input rendered in a contribution-statement region');
});

// ── BooksStatementPanel: renders the per-donor summary AND the shared tax disclaimer (rendered tree) ────────
test('BooksStatementPanel renders the donor summary and the shared tax disclaimer; nothing when statementOn=false', async () => {
  const { React, draw } = miniReact();
  const stmtResult = { rows: [{ donor: 'd1', name: 'Ada', total: 120000 }], totalDonated: 120000, statement: 'No goods or services …', from: '', to: '' };
  const Panel = await loadComponent('app/stew-finance.jsx', 'BooksStatementPanel', 'function BooksStatementPanel(', {
    React, bkCard: {}, booksFmt: (m) => '$' + (m / 100).toFixed(2),
    window: { FinanceContribution: { contributionStatement: () => stmtResult } },
  });
  const F = { givingByMember: () => [], TAX_DISCLAIMER };
  // statementOn=false → inert: no disclaimer, no rows on the rendered tree
  const off = draw(Panel, { book: {}, F, donors: new Map([['d1', { id: 'd1', name: 'Ada' }]]), statementOn: false, jurisdiction: 'US' });
  assert.ok(!find(off, n => n.props && n.props['data-tax-disclaimer'])[0], 'the panel rendered a disclaimer with statementOn=false');
  assert.ok(!/Ada/.test(texts(off).join(' ')), 'the panel rendered donor rows with statementOn=false');
  // statementOn=true → the donor row + the disclaimer are on the rendered tree
  const tree = draw(Panel, { book: {}, F, donors: new Map([['d1', { id: 'd1', name: 'Ada' }]]), statementOn: true, jurisdiction: 'US' });
  const all = texts(tree).join(' ');
  assert.ok(/Ada/.test(all), 'the statement panel did not render the donor row');
  assert.ok(find(tree, n => n.props && n.props['data-tax-disclaimer'])[0], 'the statement panel did not render the shared tax disclaimer footnote');
  assert.ok(/not tax advice/i.test(all), 'the statement panel disclaimer text is not on the rendered tree');
});
