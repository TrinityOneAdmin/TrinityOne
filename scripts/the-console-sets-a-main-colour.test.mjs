// THE CONSOLE SETS THE CHURCH'S MAIN COLOUR, AND THE ACCENT STAYS THE ACCENT (owner 2026-11-12, item 3).
//   Run: node --test scripts/the-console-sets-a-main-colour.test.mjs
//
// DashBrandingPanel (the second card on Settings → Church identity) has a Main colour picker beside the
// accent one: a spectrum tile, a hex field, preset swatches and Reset. Each publishes `mainColor` through
// window.Steward.publishProfile, and the accent controls still publish `accent` and never `mainColor`, so the
// two colours cannot be swapped.
//
// POINT OF USE (CLAUDE.md rule 1): the REAL DashBrandingPanel is sliced from app/stew-dashboard.jsx, compiled
// with the build's esbuild, drawn through the miniature React, and its controls are driven; what reached
// publishProfile is asserted. Rule 3: nothing matches text in app/*.jsx.
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function load(globals) {
  const src = fnBody(STEW, 'function DashBrandingPanel(', 'DashBrandingPanel') + '\nexport { DashBrandingPanel };\n';
  const tmp = join(tmpdir(), 'mainc-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__mainc_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

async function panel(church) {
  const { React, draw } = miniReact();
  const published = [];
  const win = { Steward: { publishProfile: async (m) => { published.push(m); return true; } } };
  const mod = await load({
    React, window: win, setTimeout, clearTimeout,
    Panel: (p) => React.createElement('div', {}, p && p.children),
    ImageCropModal: Stub('ImageCropModal'), SkBadge: Stub('SkBadge'), SkToggle: Stub('SkToggle'),
    Icon: (p) => React.createElement('span', {}, 'ICON:' + (p && p.name || '')),
  });
  const render = () => draw(mod.DashBrandingPanel, { church });
  render();
  const by = (label) => find(render(), n => n.props && n.props['aria-label'] === label)[0];
  return { published, render, by };
}

test('the Main colour picker publishes { mainColor } (and not accent)', async () => {
  const p = await panel({ name: 'Grace', accent: '#C25A38' });
  const pick = p.by('Main colour picker');
  assert.ok(pick, 'there is no Main colour picker on the branding card');
  pick.props.onChange({ target: { value: '#1f4e79' } });
  await sleep(450);
  assert.deepEqual(p.published, [{ mainColor: '#1f4e79' }], 'the Main picker did not publish mainColor: ' + JSON.stringify(p.published));
});

test('the Main colour hex field publishes once the code is a complete #RRGGBB, and not before', async () => {
  const p = await panel({ name: 'Grace' });
  const hex = p.by('Main colour hex code');
  assert.ok(hex, 'there is no Main colour hex field');
  // "1F4" is the first half of "1F4E79", not a #RGB code: it must not be expanded to #11ff44 and published
  // (audit 2026-11-13 MEDIUM). The box keeps what was typed.
  hex.props.onChange({ target: { value: '1F4' } });
  await sleep(450);
  assert.deepEqual(p.published, [], 'a 3-character entry was published: ' + JSON.stringify(p.published));
  assert.equal(p.by('Main colour hex code').props.value, '1F4', 'the box rewrote what was typed');
  p.by('Main colour hex code').props.onChange({ target: { value: '1F4E79' } });
  await sleep(450);
  assert.deepEqual(p.published.at(-1), { mainColor: '#1f4e79' });
});

test('a Main colour swatch publishes it, and Reset publishes { mainColor: "" }', async () => {
  const p = await panel({ name: 'Grace', mainColor: '#1f4e79' });
  const sw = p.by('Main colour #3B6FB0');
  assert.ok(sw, 'there is no Main colour swatch');
  sw.props.onClick();
  await sleep(450);
  assert.deepEqual(p.published.at(-1), { mainColor: '#3b6fb0' });
  const reset = p.by('Reset main colour');
  assert.ok(reset, 'a church with a main colour has no Reset for it');
  reset.props.onClick();
  assert.deepEqual(p.published.at(-1), { mainColor: '' });
});

test('an unset main colour publishes nothing on its own, and offers no Reset', async () => {
  const p = await panel({ name: 'Grace', accent: '#C25A38' });
  await sleep(450);
  assert.deepEqual(p.published, []);
  assert.equal(p.by('Reset main colour'), undefined);
  assert.equal(p.by('Main colour picker').props.value, '#c25a38', 'the unset picker does not show the accent as its placeholder');
});

test('the accent controls still publish { accent } and never mainColor — the two cannot be swapped', async () => {
  const p = await panel({ name: 'Grace', mainColor: '#1f4e79' });
  const pick = p.by('Accent colour picker');
  assert.ok(pick, 'there is no Accent colour picker');
  pick.props.onChange({ target: { value: '#b0853b' } });
  await sleep(450);
  assert.deepEqual(p.published, [{ accent: '#b0853b' }], 'the accent picker published something else: ' + JSON.stringify(p.published));
  p.by('Accent colour hex code').props.onChange({ target: { value: '5E8C6A' } });
  await sleep(450);
  assert.deepEqual(p.published.at(-1), { accent: '#5E8C6A' });
  assert.ok(p.published.every(m => !('mainColor' in m)), 'an accent control published mainColor');
});

// POINT OF USE for the UNTRUSTED kind-0: the REAL useStewardChurch (app/steward-root.jsx) is sliced and run with
// a profile whose mainColor is garbage, and its result is fed to the REAL DashBrandingPanel. Neither may crash,
// and the panel must show no main colour (no Reset).
const ROOT_JSX = readFileSync(join(ROOT, 'app/steward-root.jsx'), 'utf8');
async function churchFromProfile(profile) {
  const src = fnBody(ROOT_JSX, 'function useStewardChurch(', 'useStewardChurch') + '\nexport { useStewardChurch };\n';
  const tmp = join(tmpdir(), 'mainc-root-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  let state = {}; const effects = [];
  const key = '__mainc_root_' + Math.random().toString(36).slice(2);
  const g = globalThis[key] = {
    useSt: () => [state, (v) => { state = v; }],
    useStE: (f) => { effects.push(f); },
    useStewardIdv: () => 1, useStewardConn: () => 1,
    window: { Steward: { subscribeProfile: (cb) => { cb(profile); return () => {}; }, npub: 'npub1x', isViewingNetwork: () => false }, addEventListener() {}, removeEventListener() {} },
  };
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  mod.useStewardChurch();
  for (const f of effects) f();          // clear-on-identity, then subscribeProfile delivers the profile
  return mod.useStewardChurch();
}

test('a garbage / non-string mainColor on the kind-0 reaches the branding panel as no main colour, without crashing', async () => {
  for (const bad of [{ x: 1 }, 42, true, ['#112233'], 'url(https://evil.example/b.png)', '#12345', 'red', '#12345G']) {
    const church = await churchFromProfile({ name: 'Grace', mainColor: bad });
    assert.equal(church.mainColor, '', 'the console accepted mainColor ' + JSON.stringify(bad));
    const p = await panel(church);                       // must not throw
    assert.equal(p.by('Reset main colour'), undefined, 'garbage mainColor ' + JSON.stringify(bad) + ' shows as a set main colour');
  }
  const ok = await churchFromProfile({ name: 'Grace', mainColor: '#1f4e79' });
  assert.equal(ok.mainColor, '#1f4e79');
  assert.ok((await panel(ok)).by('Reset main colour'), 'a valid main colour no longer shows Reset');
});
