// THE UNIFIED GROUP-SETTINGS PANEL OPENS ON THE DESKTOP CONSOLE (phase 1), NOT ONLY ON THE PHONE APP.
//   Run: node --test scripts/the-group-settings-panel-opens-on-desktop.test.mjs
//
// Before this, setSettingsFor's panel rendered only on isNative; the desktop web console showed every control
// as an inline row pill and had no settings panel, and no way to edit a group's name or description at all.
// Phase 1: the gear shows on every row, the desktop row is decluttered (category/icon/child-safe/encrypt pills
// fold into the panel), and the panel — now responsive, a centered dialog on desktop — gains editable Name and
// Description fields that publish against the RAW group document (not the live-subtitle display row).
//
// HOW IT ASSERTS (CLAUDE.md rules 1 and 3). The REAL DashGroups is sliced from app/stew-dashboard.jsx by
// brace-match, compiled with the packaged build's esbuild (--jsx=transform) and rendered through the miniature
// React; ListPanel is replaced with a prop-capturing stub so the row's own slots (renderInline/renderRight/
// renderAside) are exercised, and the panel's real inputs are driven. Nothing matches text in the .jsx. The
// window is forced to DESKTOP: no window.Capacitor (isNative false) and innerWidth 1200 (useStewNarrow false).
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
const tick = () => new Promise(r => setTimeout(r, 0));
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

async function loadMany(anchors, globals) {
  const names = anchors.map(a => a.name);
  const src = anchors.map(a => fnBody(STEW, a.anchor, a.name)).join('\n') + `\nexport { ${names.join(', ')} };\n`;
  const tmp = join(tmpdir(), 'grpset-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__grpset_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

// An invite-only group with a real, human-written description — the one that must survive, NOT the live count.
const ROOM = {
  id: 'g-sg', name: 'Safeguarding leads', kind: 'group', sub: 'Weekly prayer for the sick and grieving',
  icon: '', accent: '', category: 'staff', visibility: 'invite', members: ['aa11', 'bb22'],
  encrypted: false, childsafe: false, leaders: ['aa11'], eventPolicy: 'leaders',
};
const LIVE_SUB = '2 members · invite-only';   // the decorated display string groupLiveSub puts on the row

async function screen() {
  const { React, draw } = miniReact();
  const published = [];
  let groups = [ROOM];
  const win = {
    // NO Capacitor key → isNative is false (desktop web). innerWidth 1200 → useStewNarrow(760) is false (wide).
    innerWidth: 1200,
    Steward: { publishGroup: async (g) => { published.push(g); return { ...g, ts: 1 }; }, sendDM: async () => ({ id: 'dm' }), publishGroupKey: async () => ({ ok: 1 }) },
    useStewardGroups: () => groups, useStewardRosters: () => [], useStewardMembers: () => [{ pubkey: 'aa11', name: 'Alice' }],
    useStewardCategories: () => [{ id: 'staff', name: 'Staff' }],   // non-empty, so the OLD row WOULD have shown a category <select>
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const mod = await loadMany([
    { name: 'DashGroups', anchor: 'function DashGroups()' },
    { name: 'stewKeyRecipients', anchor: 'function stewKeyRecipients(' }, { name: 'stewKeyRecipientsOrAdmitted', anchor: 'function stewKeyRecipientsOrAdmitted(' },
    { name: 'useStewKeyRecipients', anchor: 'function useStewKeyRecipients(' },
    { name: 'useStewNarrow', anchor: 'function useStewNarrow(' },   // real responsive flag; reads window.innerWidth
    { name: 'groupIcon', anchor: 'function groupIcon(' },
  ], {
    STEW_KEYS_LOADING: 'loading',
    React, window: win, CustomEvent: function (t, o) { return { type: t, detail: o && o.detail }; }, setTimeout, clearTimeout,
    location: { search: '', hostname: 'x' }, document: { addEventListener() {}, removeEventListener() {} },
    ListPanel: function ListPanel(p) { win.__captured = p; return null; },
    Icon: (p) => React.createElement('span', {}, 'ICON:' + (p.name || '')),   // surface icon names as text
    SkPill: (p) => React.createElement('span', {}, p.children), SkConfirm: Stub('SkConfirm'), SkBadge: Stub('SkBadge'),
    SkToggle: Stub('SkToggle'), GroupIconPicker: Stub('GroupIconPicker'),
    NewGroupModal: Stub('NewGroupModal'), CategoriesModal: Stub('CategoriesModal'),
    GroupChatModal: Stub('GroupChatModal'), GroupLeadersModal: Stub('GroupLeadersModal'),
    EditGroupMembersModal: Stub('EditGroupMembersModal'), KeyDistributor: Stub('KeyDistributor'),
    useRealMemberCount: () => 5, useStewDialog: () => ({}),
    nameHandle: () => '', shortNpub: () => '',
    groupLiveSub: () => LIVE_SUB,
  });
  let tree = draw(mod.DashGroups, {});
  const captured = () => win.__captured;
  const row = () => captured().items.find(x => x.id === ROOM.id);
  const redraw = () => { tree = draw(mod.DashGroups, {}); return tree; };
  const dialog = () => { const d = find(redraw(), n => n.props && n.props.role === 'dialog'); return d; };
  const openPanel = () => {
    const it = row();
    const gear = find(captured().renderRight(it), n => n.type === 'button' && /Settings for/.test(String(n.props['aria-label'] || '')));
    assert.equal(gear.length, 1, 'the desktop row has no Settings gear to open the panel');
    gear[0].props.onClick();
  };
  const panel = () => { const d = dialog(); assert.equal(d.length, 1, 'the group-settings panel is not open'); return d[0]; };
  const input = (dlg, label) => { const i = find(dlg, n => n.type === 'input' && n.props['aria-label'] === label); assert.equal(i.length, 1, `no ${label} field in the panel`); return i[0]; };
  return { published, screen: () => tree, captured, row, redraw, openPanel, panel, input, dialog, setGroups: (g) => { groups = g; } };
}

test('DESKTOP: the row has a Settings gear, and clicking it opens a panel with Name and Description fields', async () => {
  const s = await screen();
  s.openPanel();
  const dlg = s.panel();
  const name = s.input(dlg, 'Group name');
  const desc = s.input(dlg, 'Group description');
  assert.equal(name.props.value, ROOM.name, 'the name field is not seeded from the group name');
  assert.equal(desc.props.value, ROOM.sub, 'the description field is not seeded from the RAW description');
  assert.notEqual(desc.props.value, LIVE_SUB, 'the description field shows the live subtitle, not the real description');
});

test('DESKTOP: editing the name publishes { name } carrying the RAW sub, not the live subtitle', async () => {
  const s = await screen();
  s.openPanel();
  const name = s.input(s.panel(), 'Group name');
  await name.props.onBlur({ target: { value: 'Pastoral team' } });
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(s.published.length, 1, 'editing the name published nothing');
  assert.equal(s.published[0].name, 'Pastoral team', 'publishGroup did not receive the new name');
  assert.equal(s.published[0].sub, ROOM.sub, 'the published sub is not the group’s real description: ' + s.published[0].sub);
  assert.notEqual(s.published[0].sub, LIVE_SUB, 'the live subtitle was published over the real description');
});

test('DESKTOP: a blank name is NOT published', async () => {
  const s = await screen();
  s.openPanel();
  const name = s.input(s.panel(), 'Group name');
  await name.props.onBlur({ target: { value: '   ' } });
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(s.published.length, 0, 'a blank name was published — the guard is missing');
});

test('DESKTOP: a name over 60 chars is capped to 60 when published', async () => {
  const s = await screen();
  s.openPanel();
  const name = s.input(s.panel(), 'Group name');
  await name.props.onBlur({ target: { value: 'x'.repeat(80) } });
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(s.published.length, 1);
  assert.equal(s.published[0].name.length, 60, 'the name was not capped at 60 (relay GROUP_NAMES truncation)');
});

test('DESKTOP (regression): child-safe is still reachable from the panel and publishes the toggle', async () => {
  const s = await screen();
  s.openPanel();
  const dlg = s.panel();
  // the child-safe row: the one sToggle carrying "Child-safe" text AND exactly one checkbox (not the encryption row)
  const rows = find(dlg, n => n.type !== 'function' && texts(n).join(' ').includes('Child-safe')
    && find(n, c => c.type === 'input' && c.props.type === 'checkbox').length === 1);
  assert.ok(rows.length >= 1, 'the panel does not render a Child-safe control');
  const box = find(rows[rows.length - 1], c => c.type === 'input' && c.props.type === 'checkbox')[0];
  await box.props.onChange({ target: { checked: true } });
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(s.published.length, 1, 'toggling child-safe from the desktop panel published nothing');
  assert.equal(s.published[0].childsafe, true, 'child-safe was not flipped on');
});

test('DESKTOP row is decluttered: People, Leaders, Chat, Settings gear + Delete — no category/icon/child-safe/encrypt pills', async () => {
  const s = await screen();
  const it = s.row();
  const right = texts(s.captured().renderRight(it)).join(' ').replace(/\s+/g, ' ');   // normalise: join()/separate text nodes add spaces
  const aside = texts(s.captured().renderAside(it)).join(' ').replace(/\s+/g, ' ');
  // KEPT ('.' tolerates the middle-dot separator char)
  assert.match(right, /People . 2/, 're-anchor: the invite-only People button is gone, so the checks below are vacuous');
  assert.match(right, /Leaders . 1/, 'the Leaders button must stay and fold in its count');
  assert.match(right, /Chat/, 'the Chat button must stay on the row');
  // the row slots are read unexpanded, so the Icon's `name` prop stands in for the rendered glyph
  assert.match(right, /sliders/, 'the Settings gear (sliders icon) must render on the desktop row');
  assert.match(right, /Settings/, 'the Settings gear must be labelled for the desktop row');
  assert.match(aside, /trash/, 'Delete (trash icon) must stay in renderAside');
  // REMOVED (these moved into the panel; cats is non-empty so the OLD row would have shown a <select>)
  const selects = find(s.captured().renderRight(it), n => n.type === 'select');
  assert.equal(selects.length, 0, 'the category <select> is still on the desktop row — it must move into the panel');
  assert.doesNotMatch(right, /Child-safe/, 'the Child-safe pill is still on the desktop row');
  assert.doesNotMatch(right, /Encrypt/, 'the Encrypt pill is still on the desktop row');
  assert.doesNotMatch(right, /Change icon/, 'the icon button is still on the desktop row');
});
