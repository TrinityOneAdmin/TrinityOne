// THE DONOR FORM IS ON THE SCREEN, AND THE GIFT AID TOGGLE DEFAULTS OFF.
//   Run: node --test scripts/finance-donor-and-giftaid-ui.test.mjs
//
// Phase 4b, point-of-use (CLAUDE.md rules 1 & 3 — assert on the RENDERED tree, never on text in app/*.jsx):
//   · BooksDonor (the add/edit-donor dialog) renders its name field, its Gift Aid-declaration toggle and a
//     Save control — delete them from the screen and this fails.
//   · The UK Gift Aid congregation-feature toggle (DashFeaturesPanel) renders and DEFAULTS OFF — the whole of
//     DOMAIN nation-neutrality turns on this. It rides the opt-in `=== true` convention, so with no features
//     set the switch reads OFF, and tapping it publishes features.giftAid = true (NOT the default-on `!==
//     false` convention, which would turn a UK scheme on for every church).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

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
  const tree = draw(BooksDonor, { book: { baseCurrency: 'GBP', decimals: 2 }, initial: null, onSave: (d) => { saved.push(d); return true; }, onClose() {} });
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

// ── DashFeaturesPanel: the Gift Aid toggle, and that it DEFAULTS OFF ─────────────────────────────────────
const furniture = (React) => ({
  Panel: function Panel({ title, children }) { return React.createElement('section', { 'data-panel': title }, children); },
  SkConfirm: function SkConfirm(props) { return React.createElement('div', { 'data-confirm': props.title }); },
  Icon: function Icon() { return null; },
  DashMealsPanel: function DashMealsPanel() { return null; },
  DashGivingPanel: function DashGivingPanel() { return null; },
  stewCapState: () => ({ allowed: true, owner: true, why: '' }),
  useStewKeyRecipients: () => ({ approved: () => [] }),
});
async function featuresPanel(church) {
  const { React, draw } = miniReact();
  const published = [];
  const Comp = await loadComponent('app/stew-dashboard.jsx', 'DashFeaturesPanel', 'function DashFeaturesPanel(', {
    React,
    window: {
      useStewardGroups: () => [], useStewardMembers: () => [{ pubkey: 'm1' }], useStewardAdmitted: () => [],
      useStewardJoinPolicy: () => false,
      Steward: { actingChurch: null, publishProfile: (p) => published.push(p), setJoinPolicy() {}, setAdmitted() {} },
    },
    ...furniture(React),
  });
  return { draw: () => draw(Comp, { church, show: 'features' }), published };
}
const rowFor = (tree, label) => find(tree, n => n.type === 'div' && typeof n.props.onClick === 'function' && texts(n).join(' | ').includes(label));
// the switch inside a row: an element with role="switch" and an aria-checked prop
const switchIn = (row) => find(row, n => n.props && n.props.role === 'switch')[0];

test('the Gift Aid (UK) toggle is on the Congregation features page', async () => {
  const s = await featuresPanel({ features: {} });
  assert.equal(rowFor(s.draw(), 'Gift Aid (UK)').length, 1, 'the Gift Aid (UK) toggle is not a row on Congregation features');
});

test('Gift Aid DEFAULTS OFF — with no features set, its switch reads OFF', async () => {
  const s = await featuresPanel({ features: {} });                 // a brand-new church
  const row = rowFor(s.draw(), 'Gift Aid (UK)')[0];
  const sw = switchIn(row);
  assert.ok(sw, 're-anchor: the Gift Aid row has no switch');
  assert.equal(sw.props['aria-checked'], false,
    'Gift Aid is ON by default — a UK-only scheme would be enabled for every church, violating DOMAIN ' +
    'nation-neutrality. It must ride the opt-in (=== true) convention, not the default-on one.');
});

test('tapping Gift Aid publishes features.giftAid = true (strict opt-in, not !== false)', async () => {
  const s = await featuresPanel({ features: {} });
  rowFor(s.draw(), 'Gift Aid (UK)')[0].props.onClick({ stopPropagation() {} });
  assert.equal(s.published.length, 1, 'tapping Gift Aid published nothing');
  assert.equal(s.published[0].features.giftAid, true,
    'tapping Gift Aid (off) did not write features.giftAid = true — it wrote ' + JSON.stringify(s.published[0].features));
});

test('an existing church with Gift Aid ON reads the switch ON (the toggle reflects state)', async () => {
  const s = await featuresPanel({ features: { giftAid: true } });
  assert.equal(switchIn(rowFor(s.draw(), 'Gift Aid (UK)')[0]).props['aria-checked'], true, 'features.giftAid === true did not read ON');
});
