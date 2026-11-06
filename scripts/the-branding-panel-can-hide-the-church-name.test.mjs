// THE BRANDING PANEL'S "HIDE CHURCH NAME" SWITCH WRITES features.hideChurchName (owner 2026-11-06, pilot UI #5).
//   Run: node --test scripts/the-branding-panel-can-hide-the-church-name.test.mjs
//
// The switch lives in DashBrandingPanel (console) and is shown only when the church HAS a banner. Toggling it
// publishes through the existing free-form `features` object — NO engine/whitelist change — so it must SPREAD
// the church's current features, not replace them.
//
// POINT OF USE (CLAUDE.md rule 1): the REAL DashBrandingPanel is sliced from app/stew-dashboard.jsx, compiled
// with the packaged build's esbuild, rendered through the miniature React, and its SkToggle is driven; what
// reached window.Steward.publishProfile is asserted. Rule 3: nothing matches text in app/*.jsx. If the switch
// is removed, find() returns nothing and the test goes red; if it stops spreading feats, the spread assertion
// reddens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

async function loadMany(anchors, globals) {
  const names = anchors.map(a => a.name);
  const src = anchors.map(a => fnBody(STEW, a.anchor, a.name)).join('\n') + `\nexport { ${names.join(', ')} };\n`;
  const tmp = join(tmpdir(), 'brand-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__brand_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

async function panel(church) {
  const { React, draw } = miniReact();
  const published = [];
  const win = { Steward: { publishProfile: async (m) => { published.push(m); return true; } } };
  const mod = await loadMany([{ name: 'DashBrandingPanel', anchor: 'function DashBrandingPanel(' }], {
    React, window: win, setTimeout, clearTimeout,
    Panel: (p) => React.createElement('div', {}, p && p.children),
    ImageCropModal: Stub('ImageCropModal'), SkBadge: Stub('SkBadge'),
    Icon: (p) => React.createElement('span', {}, 'ICON:' + (p && p.name || '')),
    SkToggle: Stub('SkToggle'),
  });
  const tree = draw(mod.DashBrandingPanel, { church });
  // the name switch is the SkToggle whose options are show/hide name
  const toggle = find(tree, n => n.props && Array.isArray(n.props.options)
    && n.props.options.some(o => o && o.value === 'hide'))[0];
  return { published, toggle, tree };
}

const BANNER = 'data:image/png;base64,AA';

test('with a banner, the switch is present and turning it ON publishes features.hideChurchName:true', async () => {
  const p = await panel({ name: 'St Aidan', banner: BANNER, features: {} });
  assert.ok(p.toggle, 'no "hide church name" switch in the branding panel for a church with a banner');
  assert.equal(p.toggle.props.value, 'show', 'the switch does not start on "Show name" when the flag is unset');
  await p.toggle.props.onChange('hide');
  assert.equal(p.published.length, 1, 'toggling the switch published nothing');
  assert.deepEqual(p.published[0], { features: { hideChurchName: true } },
    'the switch did not publish features.hideChurchName:true (got: ' + JSON.stringify(p.published[0]) + ')');
});

test('turning it OFF publishes features.hideChurchName:false', async () => {
  const p = await panel({ name: 'St Aidan', banner: BANNER, features: { hideChurchName: true } });
  assert.ok(p.toggle, 'no switch present when the flag is already on');
  assert.equal(p.toggle.props.value, 'hide', 'the switch does not reflect the saved ON state');
  await p.toggle.props.onChange('show');
  assert.deepEqual(p.published[0], { features: { hideChurchName: false } },
    'turning the switch off did not publish hideChurchName:false (got: ' + JSON.stringify(p.published[0]) + ')');
});

test('the publish SPREADS the existing features (no engine/whitelist change — it must not blank other flags)', async () => {
  const p = await panel({ name: 'St Aidan', banner: BANNER, features: { memberPhotos: true, resources: false } });
  await p.toggle.props.onChange('hide');
  assert.deepEqual(p.published[0], { features: { memberPhotos: true, resources: false, hideChurchName: true } },
    'the switch clobbered the church’s other feature flags instead of spreading them (got: ' + JSON.stringify(p.published[0]) + ')');
});

test('with NO banner the switch is not shown (there is no image carrying the name to hide behind)', async () => {
  const p = await panel({ name: 'St Aidan', features: {} });
  assert.ok(!p.toggle, 'the hide-name switch appears without a banner — it should only offer to hide text an image duplicates');
});
