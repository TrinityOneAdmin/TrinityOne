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
import { listJurisdictions, resolveJurisdiction } from '../src/finance-jurisdictions.mjs';

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

// ── DashFeaturesPanel: the owner-only Region (jurisdiction) selector, and that it DEFAULTS to None ───────
// Wave 3 replaced the standalone "Gift Aid (UK)" opt-in toggle with ONE selector. These four cases replace the
// four Gift-Aid-toggle cases 1:1 (the control changed by owner decision; net test count is unchanged). The
// selector reads the registry via window.FinanceLedger — provided here from the real src module so the
// resolve/list logic under test is the shipped one. featOwner is true because Steward.actingChurch is null.
const furniture = (React) => ({
  Panel: function Panel({ title, children }) { return React.createElement('section', { 'data-panel': title }, children); },
  SkConfirm: function SkConfirm(props) { return React.createElement('div', { 'data-confirm': props.title }); },
  Icon: function Icon() { return null; },
  DashMealsPanel: function DashMealsPanel() { return null; },
  DashGivingPanel: function DashGivingPanel() { return null; },
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
      FinanceLedger: { listJurisdictions, resolveJurisdiction },   // the real registry drives the picker
      Steward: { actingChurch, publishProfile: (p) => published.push(p), setJoinPolicy() {}, setAdmitted() {} },
    },
    ...furniture(React),
  });
  return { draw: () => draw(Comp, { church, show: 'features' }), published };
}
// the Region selector: the one <select> on the panel (aria-label "Region / jurisdiction")
const regionSelect = (tree) => find(tree, n => n.type === 'select' && (n.props && /Region/.test(n.props['aria-label'] || '')))[0];

test('the Region (jurisdiction) selector is on the Congregation features page', async () => {
  const s = await featuresPanel({ features: {} });
  const sel = regionSelect(s.draw());
  assert.ok(sel, 'the Region (jurisdiction) selector is not on Congregation features');
  // its options come from the registry (None + UK), so a new jurisdiction is DATA, not markup
  const optVals = find(sel, n => n.type === 'option').map(o => o.props.value).sort();
  assert.deepEqual(optVals, ['None', 'UK'], 'the Region selector options are not the registry list (None + UK)');
});

test('the Region selector DEFAULTS to None — with no features set it reads nation-neutral', async () => {
  const s = await featuresPanel({ features: {} });                 // a brand-new church
  const sel = regionSelect(s.draw());
  assert.ok(sel, 're-anchor: no Region selector');
  assert.equal(sel.props.value, 'None',
    'the Region selector is not None by default — a UK-only scheme would be the default, violating DOMAIN ' +
    'nation-neutrality.');
});

test('selecting United Kingdom publishes features.jurisdiction = UK and syncs the legacy giftAid boolean', async () => {
  const s = await featuresPanel({ features: {} });
  regionSelect(s.draw()).props.onChange({ target: { value: 'UK' } });
  assert.equal(s.published.length, 1, 'choosing a region published nothing');
  assert.equal(s.published[0].features.jurisdiction, 'UK',
    'choosing United Kingdom did not write features.jurisdiction = UK — it wrote ' + JSON.stringify(s.published[0].features));
  assert.equal(s.published[0].features.giftAid, true,
    'choosing UK did not keep the legacy features.giftAid boolean in sync (an un-upgraded console reads the boolean)');
});

test('selecting None publishes jurisdiction = None and clears the legacy giftAid boolean (override)', async () => {
  const s = await featuresPanel({ features: { giftAid: true } });  // a legacy UK church
  regionSelect(s.draw()).props.onChange({ target: { value: 'None' } });
  assert.equal(s.published[0].features.jurisdiction, 'None', 'choosing None did not write features.jurisdiction = None');
  assert.equal(s.published[0].features.giftAid, false, 'choosing None did not turn the legacy giftAid boolean off');
});

test('a legacy church with giftAid:true (no jurisdiction) reads the selector as UK (back-compat)', async () => {
  const s = await featuresPanel({ features: { giftAid: true } });
  assert.equal(regionSelect(s.draw()).props.value, 'UK', 'a legacy giftAid:true church did not read back as UK on the selector');
});

test('the Region selector is OWNER-ONLY — a delegated steward (actingChurch set) does not see it', async () => {
  const s = await featuresPanel({ features: {} }, { actingChurch: 'cd'.repeat(32) });
  assert.ok(!regionSelect(s.draw()), 'the Region selector showed to a delegate — publishProfile would silently fail under their hand');
});
