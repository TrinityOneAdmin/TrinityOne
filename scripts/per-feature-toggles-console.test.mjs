// PER-FEATURE VISIBILITY TOGGLES — THE CONSOLE HALF (rota / rooms / calendar / resources / finance).
//   Run: node --test scripts/per-feature-toggles-console.test.mjs
//
// A steward hides a whole section from the console (and, where it has one, from the member app) by turning
// it off in Settings → Congregation features. Three things must hold, and each is proved by RUNNING shipped
// code, never by matching text in app/*.jsx (CLAUDE.md rule 3 — those ship unbundled, so `false && ` leaves
// every word in place and a text match still passes):
//
//   1. stewNav() — the real church-nav memo body, lifted to module scope — DROPS a section when
//      church.features.<k> === false, keeps it when unset (default ON), and still MARKS a section the
//      delegate's capability does not cover. A deleted filter fails test group (1).
//   2. stewFinanceOn() — the NEW finance gate — returns false for features.finance === false EVEN with the
//      module present and the capability held, and true when unset. This is distinct from the pre-existing
//      "module + capability" finOn, which is what makes Finance hide-able per church at all.
//   3. DashFeaturesPanel renders the five switch rows TO THE OWNER and publishes features.<k>=false when
//      tapped — and renders NONE of them to a DELEGATED steward, because publishProfile refuses a delegate
//      silently (a switch that always fails is worse than no switch).
//
// stewNav / stewFinanceOn are PURE (no JSX, no neighbours), so they are sliced with fnBody and run as-is.
// DashFeaturesPanel is sliced, compiled and rendered through the miniature React, exactly as
// scripts/settings-rows-tap-the-words.test.mjs does the rows it already owns.
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
const DASH = read('app/stew-dashboard.jsx');

// The base NAV the console ships (church view). Lifted from source so the test cannot drift from the order the
// console actually renders. (It is a plain array literal, read with a tiny eval of the exact statement.)
function liftNAV() {
  const m = DASH.match(/\nconst NAV = (\[[\s\S]*?\n\]);/);
  assert.ok(m, 'could not lift the NAV array — re-anchor this test');
  return new Function('return ' + m[1])();
}
const NAV = liftNAV();
// the two pure helpers, lifted and run as the console runs them
const stewNav = new Function(fnBody(DASH, 'function stewNav(', 'stewNav') + '\nreturn stewNav;')();
const stewFinanceOn = new Function(fnBody(DASH, 'function stewFinanceOn(', 'stewFinanceOn') + '\nreturn stewFinanceOn;')();

const keysOf = (nav) => nav.map(n => n.key);
const allowAll = () => ({ allowed: true, owner: true, why: '' });
// an owner console, every module off so the nav is just the base sections
const baseOpts = (over = {}) => ({ finOn: false, mannaOn: false, mealsOn: false, checkinOn: false, capState: allowAll, ...over });

// ── (1) stewNav hides a section when its flag is false, keeps it when unset ─────────────────────────────────
for (const key of ['rota', 'calendar', 'rooms', 'resources']) {
  test(`stewNav drops "${key}" when church.features.${key} === false`, () => {
    const on = keysOf(stewNav(NAV, { features: {} }, baseOpts()));
    assert.ok(on.includes(key), `re-anchor: "${key}" is not even in the default nav`);
    const off = keysOf(stewNav(NAV, { features: { [key]: false } }, baseOpts()));
    assert.ok(!off.includes(key),
      `features.${key} === false but the "${key}" section is still in the console nav — the gate was deleted ` +
      `or never runs. Nav was: ${JSON.stringify(off)}`);
    // the OTHER sections must be untouched — a gate that hides more than its own key is as wrong as one that hides nothing
    for (const other of ['overview', 'groups', 'members', 'settings']) {
      assert.ok(off.includes(other), `turning off "${key}" also dropped "${other}" — the filter is hitting the wrong rows`);
    }
  });
  test(`stewNav keeps "${key}" when the flag is UNSET (default on — existing churches unchanged)`, () => {
    assert.ok(keysOf(stewNav(NAV, {}, baseOpts())).includes(key),
      `"${key}" is missing with no features set at all — the default must be ON, or every existing church loses it`);
    assert.ok(keysOf(stewNav(NAV, { features: { [key]: true } }, baseOpts())).includes(key),
      `"${key}" is missing with features.${key} === true`);
  });
}

// ── (1b) a hidden section is GONE, not merely padlocked; a present one still padlocks on a scoped delegate ──
test('a delegate without the content capability still SEES rota/calendar/rooms/resources, marked locked', () => {
  const scoped = (cap) => (cap === 'content' ? { allowed: false, owner: false, why: 'no content' } : allowAll());
  const nav = stewNav(NAV, {}, baseOpts({ capState: scoped }));
  for (const key of ['rota', 'calendar', 'rooms', 'resources']) {
    const n = nav.find(x => x.key === key);
    assert.ok(n, `re-anchor: "${key}" is not in the nav`);
    assert.equal(n.locked, true, `"${key}" is not marked locked for a delegate without content — the padlock was lost`);
  }
});
test('hiding a feature OUTRANKS the padlock — the section is absent, not a locked tab', () => {
  const nav = stewNav(NAV, { features: { rota: false } }, baseOpts({ capState: allowAll }));
  assert.ok(!keysOf(nav).includes('rota'), 'a hidden feature must be gone from the nav, not shown as a locked row');
});

// ── (2) the NEW finance gate ────────────────────────────────────────────────────────────────────────────────
test('stewFinanceOn: features.finance === false hides Finance EVEN with the module present and capability held', () => {
  const held = { financePresent: true, capState: () => ({ allowed: true }) };
  assert.equal(stewFinanceOn({ features: {} }, held), true, 're-anchor: Finance is off even with module + capability and the flag unset');
  assert.equal(stewFinanceOn({ features: { finance: true } }, held), true, 'features.finance === true should keep Finance on');
  assert.equal(stewFinanceOn({ features: { finance: false } }, held), false,
    'features.finance === false did NOT hide Finance although DashFinance is present and the capability is held — ' +
    'this is the new per-church gate, and it is not working');
});
test('stewFinanceOn still requires the module and the capability (the pre-existing gate is intact)', () => {
  assert.equal(stewFinanceOn({ features: {} }, { financePresent: false, capState: () => ({ allowed: true }) }), false, 'Finance shown with no DashFinance module');
  assert.equal(stewFinanceOn({ features: {} }, { financePresent: true, capState: () => ({ allowed: false }) }), false, 'Finance shown without the finance capability');
});
test('stewNav places Finance iff finOn is true (so the finance flag, folded into finOn, controls the section)', () => {
  assert.ok(!keysOf(stewNav(NAV, {}, baseOpts({ finOn: false }))).includes('finance'), 'Finance appeared with finOn false');
  assert.ok(keysOf(stewNav(NAV, {}, baseOpts({ finOn: true }))).includes('finance'), 'Finance missing with finOn true');
});

// ── (3) DashFeaturesPanel: the five rows are OWNER-ONLY and publish features.<k>=false ──────────────────────
async function loadComponent(file, name, anchor, globals) {
  const src = fnBody(read(file), anchor, name);
  const tmp = join(tmpdir(), 'pft-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__pft_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}
const furniture = (React) => ({
  Panel: function Panel({ title, children }) { return React.createElement('section', { 'data-panel': title }, children); },
  SkConfirm: function SkConfirm(props) { return React.createElement('div', { 'data-confirm': props.title }); },
  Icon: function Icon() { return null; },
  DashMealsPanel: function DashMealsPanel() { return null; },
  DashGivingPanel: function DashGivingPanel() { return null; },
  stewCapState: () => ({ allowed: true, owner: true, why: '' }),
  useStewKeyRecipients: () => ({ approved: () => [] }),   // the encrypt-all section's shared filter; not under test here
});

async function featuresPanel({ delegate = false } = {}) {
  const { React, draw } = miniReact();
  const published = [];
  const Comp = await loadComponent('app/stew-dashboard.jsx', 'DashFeaturesPanel', 'function DashFeaturesPanel(', {
    React,
    window: {
      useStewardGroups: () => [], useStewardMembers: () => [{ pubkey: 'm1' }], useStewardAdmitted: () => [],
      useStewardJoinPolicy: () => false,
      // the one switch that makes this the owner's console or a delegate's: publishProfile refuses the delegate
      Steward: { actingChurch: delegate ? 'npub1other' : null, publishProfile: (p) => published.push(p), setJoinPolicy() {}, setAdmitted() {} },
    },
    ...furniture(React),
  });
  return { draw: () => draw(Comp, { church: {}, show: 'features' }), published };
}
const rowFor = (tree, label) => find(tree, n => n.type === 'div' && typeof n.props.onClick === 'function' && texts(n).join(' | ').includes(label));

const MODULE_ROWS = [
  ['Rota & serving', 'rota'], ['Calendar & events', 'calendar'], ['Rooms & booking', 'rooms'],
  ['Reading plans & devotionals', 'resources'], ['Finance', 'finance'],
];

for (const [label, key] of MODULE_ROWS) {
  test(`the owner sees "${label}" and tapping it publishes features.${key} = false`, async () => {
    const s = await featuresPanel();
    const rows = rowFor(s.draw(), label);
    assert.equal(rows.length, 1, `"${label}" is not a single tappable row on the owner's Congregation features page`);
    rows[0].props.onClick({ stopPropagation() {} });
    assert.equal(s.published.length, 1, `tapping "${label}" published nothing`);
    assert.equal(s.published[0].features[key], false,
      `tapping "${label}" (default ON) did not write features.${key} = false — it wrote ${JSON.stringify(s.published[0].features)}`);
  });
  test(`a DELEGATE is never shown the "${label}" switch (publishProfile would refuse it silently)`, async () => {
    const s = await featuresPanel({ delegate: true });
    assert.equal(rowFor(s.draw(), label).length, 0,
      `"${label}" is on a delegate's console. publishProfile refuses a delegate and returns null while this row ` +
      `keeps its new position: a switch that always silently fails. It must be owner-only.`);
  });
}

test('the owner still sees the existing Bible row (re-anchor: the panel rendered at all)', async () => {
  const s = await featuresPanel();
  assert.equal(rowFor(s.draw(), 'Bible').length, 1, 'the Congregation features panel did not render its own rows');
});
