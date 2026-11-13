// THE CONSOLE GROUPS ROW IS COMPACT IN A NARROW BROWSER WINDOW, NOT ONLY ON THE APK (2026-11-13, item C).
//   Run: node --test scripts/the-group-row-is-compact-at-phone-width-on-the-web.test.mjs
//
// DashGroups decided ListPanel's `compact` row from the Capacitor bridge alone (`compact={isNative}`), so the
// web console on a phone drew the desktop row: a 38px kind tile plus a wrapping strip of tags and buttons that
// squeezed the group's name to a few characters. It now passes `compact={isNative || stewNarrow}`, where
// stewNarrow = useStewNarrow() = innerWidth < 760. That breakpoint is wider than a phone: a tablet in portrait
// or a half-width desktop window gets the compact row too.
//
// Point of use (rule 1): the REAL DashGroups, the REAL ListPanel and the REAL useStewNarrow are sliced from
// app/stew-dashboard.jsx, compiled and rendered together; nothing is matched as text in app/*.jsx (rule 3).
// useStewNarrow takes its first value from innerWidth in its useState initialiser and then follows the window
// through a 'resize' listener (app/stew-dashboard.jsx, useStewNarrow), so in the console the row switches live
// across 760px. This harness fires no resize events, so every case below mounts a fresh miniReact with
// window.innerWidth set BEFORE the first draw — the initialiser is the only path these cases exercise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

async function loadMany(anchors, globals) {
  const names = anchors.map(a => a.name);
  const src = anchors.map(a => fnBody(STEW, a.anchor, a.name)).join('\n') + `\nexport { ${names.join(', ')} };\n`;
  const tmp = join(tmpdir(), 'gcw-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__gcw_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

const GROUP = { id: 'g1', name: 'Main chat', kind: 'group', childsafe: false, encrypted: false, visibility: 'open', members: [], leaders: [] };

// Mount the real DashGroups → real ListPanel at `width`, optionally inside the Capacitor shell.
async function renderGroups(width, native = false) {
  const { React, draw } = miniReact();
  const win = {
    innerWidth: width,   // set BEFORE mount: useStewNarrow's useState initialiser takes its first value from it
    Steward: { publishGroup: async () => ({}) },
    useStewardGroups: () => [GROUP], useStewardRosters: () => [], useStewardMembers: () => [],
    useStewardCategories: () => [], useStewardBlocked: () => [], useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  if (native) win.Capacitor = { isNativePlatform: () => true };
  const mod = await loadMany([
    { name: 'DashGroups', anchor: 'function DashGroups()' },
    { name: 'ListPanel', anchor: 'function ListPanel(' },
    { name: 'useStewNarrow', anchor: 'function useStewNarrow(' },
    { name: 'groupIcon', anchor: 'function groupIcon(' },
    { name: 'stewKeyRecipients', anchor: 'function stewKeyRecipients(' }, { name: 'stewKeyRecipientsOrAdmitted', anchor: 'function stewKeyRecipientsOrAdmitted(' },
    { name: 'useStewKeyRecipients', anchor: 'function useStewKeyRecipients(' },
  ], {
    STEW_KEYS_LOADING: 'loading',
    React, window: win, CustomEvent: function (t, o) { return { type: t, detail: o && o.detail }; }, setTimeout, clearTimeout,
    location: { search: '', hostname: 'x' }, document: { addEventListener() {}, removeEventListener() {} },
    Panel: (p) => React.createElement('div', { 'data-panel': p.title }, p.children),   // pass-through so the rows draw
    Icon: (p) => React.createElement('span', {}, 'ICON:' + (p && p.name || '')),
    SkPill: (p) => React.createElement('span', {}, p && p.children), SkConfirm: Stub('SkConfirm'), SkBadge: Stub('SkBadge'),
    SkToggle: Stub('SkToggle'), GroupIconPicker: Stub('GroupIconPicker'),
    NewGroupModal: Stub('NewGroupModal'), CategoriesModal: Stub('CategoriesModal'),
    GroupChatModal: Stub('GroupChatModal'), GroupLeadersModal: Stub('GroupLeadersModal'),
    EditGroupMembersModal: Stub('EditGroupMembersModal'), KeyDistributor: Stub('KeyDistributor'),
    useRealMemberCount: () => 5, useStewDialog: () => ({}),
    nameHandle: () => '', shortNpub: () => '', groupLiveSub: () => '5 members',
  });
  const tree = draw(mod.DashGroups, {});
  // The row is ListPanel's draggable card for this group; find it by its key-bearing wrapper (draggable prop).
  const rows = find(tree, n => n && n.props && 'draggable' in n.props && n.props.style && typeof n.props.style.padding === 'string');
  assert.equal(rows.length, 1, 're-anchor: expected exactly one group row from the real ListPanel, found ' + rows.length);
  const row = rows[0];
  const t = texts(row).join(' ');
  assert.match(t, /Main chat/, 're-anchor: the row did not draw the group name, so every check below would be vacuous');
  // the 38×38 kind tile: a div sized 38 wide/high (only the non-compact branch draws it)
  const kindTile = find(row, n => n && n.type === 'div' && n.props && n.props.style && n.props.style.width === 38 && n.props.style.height === 38);
  const settingsGear = find(row, n => n && n.type === 'button' && /^Settings for /.test(String(n.props && n.props['aria-label'] || '')));
  return { t, padding: row.props.style.padding, kindTile: kindTile.length, gear: settingsGear.length };
}

test('web at phone width (390px, no Capacitor): the group row is the compact row', async () => {
  const r = await renderGroups(390);
  assert.equal(r.padding, '9px 12px', 'THE DEFECT: a 390px browser drew the desktop row padding — compact is not following the width');
  assert.equal(r.kindTile, 0, 'THE DEFECT: the 38px kind tile is drawn at phone width');
  assert.doesNotMatch(r.t, /Leaders/, 'THE DEFECT: the desktop controls strip (Leaders) is drawn at phone width');
  assert.doesNotMatch(r.t, /Adults only/, 'THE DEFECT: the desktop status strip is drawn at phone width');
  assert.match(r.t, /5 members/, 'the member count must still show on the compact row');
  assert.equal(r.gear, 1, 'the settings gear must sit by the name on the compact row — it is the way into every control the strip had');
});

test('web at 1200px (no Capacitor): the desktop row is untouched', async () => {
  const r = await renderGroups(1200);
  assert.equal(r.padding, '13px 14px', 'the desktop row padding changed');
  assert.equal(r.kindTile, 1, 'the kind tile must still draw on the desktop row');
  assert.match(r.t, /Leaders/, 'the desktop controls strip must still draw');
  assert.match(r.t, /Adults only/, 'the read-only child-safe status must still show on the desktop row');
});

test('APK (Capacitor native) at 1200px: still compact — the native path is unchanged', async () => {
  const r = await renderGroups(1200, true);
  assert.equal(r.padding, '9px 12px', 'the APK lost its compact row');
  assert.equal(r.kindTile, 0, 'the APK row drew the kind tile');
  assert.doesNotMatch(r.t, /Leaders/, 'the APK row drew the desktop strip');
});
