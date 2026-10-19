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

test('DESKTOP: the name save publishes the group AS IT IS NOW — the document, not the opened snapshot', async () => {
  // Modelled on group-dialogs-publish-the-document-not-the-row: MOVE the underlying group after the panel
  // opens, then save. The publish must carry the LIVE doc (raw(g)), not the snapshot taken at open — so this
  // bites if the handler is `{ ...g, name }` (g.sub is the stale open-time description) instead of
  // `{ ...raw(g), name }`. It also pins that the live subtitle never reaches the wire.
  const s = await screen();
  s.openPanel();
  s.panel();   // panel open; the snapshot (ROOM.sub, no order) is taken now
  // another steward changes the description AND the order underneath, after the panel opened
  s.setGroups([{ ...ROOM, sub: 'Rewritten by another steward', order: 7 }]);
  const name = s.input(s.panel(), 'Group name');   // re-read from the post-move render
  await name.props.onBlur({ target: { value: 'Pastoral team' } });
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(s.published.length, 1, 'editing the name published nothing');
  assert.equal(s.published[0].name, 'Pastoral team', 'publishGroup did not receive the new name');
  assert.equal(s.published[0].sub, 'Rewritten by another steward', 'the save used the STALE open-time snapshot sub, not the live document — publish-the-document-not-the-row is broken: ' + s.published[0].sub);
  assert.notEqual(s.published[0].sub, ROOM.sub, 'the save reverted the description another steward had changed');
  assert.notEqual(s.published[0].sub, LIVE_SUB, 'the live subtitle was published over the real description');
  assert.equal(s.published[0].order, 7, 'a field another steward changed (order) was reverted by the name save — it is not building on the live document');
  assert.deepEqual(s.published[0].members, ROOM.members, 'the invite-only members list was not carried from the live document');
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

test('DESKTOP row is decluttered: People, Leaders, Chat, gear + Delete + read-only status; the CLICKABLE toggles are gone', async () => {
  const s = await screen();
  const it = s.row();   // ROOM: not child-safe, not encrypted, invite-only
  const rightNode = s.captured().renderRight(it);
  const right = texts(rightNode).join(' ').replace(/\s+/g, ' ');   // normalise: join()/separate text nodes add spaces
  const aside = texts(s.captured().renderAside(it)).join(' ').replace(/\s+/g, ' ');
  // KEPT ('.' tolerates the middle-dot separator char)
  assert.match(right, /People . 2/, 're-anchor: the invite-only People button is gone, so the checks below are vacuous');
  assert.match(right, /Leaders . 1/, 'the Leaders button must stay and fold in its count');
  assert.match(right, /Chat/, 'the Chat button must stay on the row');
  // the row slots are read unexpanded, so the Icon's `name` prop stands in for the rendered glyph
  assert.match(right, /sliders/, 'the Settings gear (sliders icon) must render on the desktop row');
  assert.match(right, /Settings/, 'the Settings gear must be labelled for the desktop row');
  assert.match(aside, /trash/, 'Delete (trash icon) must stay in renderAside');
  // READ-ONLY status is back (ROOM is not child-safe → "Adults only")
  assert.match(right, /Adults only/, 'the read-only child-safe status indicator is missing from the row');
  // REMOVED: the clickable action TOGGLES moved into the panel (cats is non-empty, so the OLD row would have shown a <select>)
  assert.equal(find(rightNode, n => n.type === 'select').length, 0, 'the category <select> is still on the desktop row — it must move into the panel');
  const btnSig = find(rightNode, n => n.type === 'button').map(b => String((b.props || {})['aria-label'] || '') + ' | ' + texts(b).join(' '));
  assert.ok(!btnSig.some(l => /child-safe is (on|off)\. Press|Child-safe\?/.test(l)), 'the old CLICKABLE Child-safe toggle button is still on the row — only the read-only status may remain');
  assert.ok(!btnSig.some(l => /encryption is (on|off)\. Press|Encrypt\?|Encrypted/.test(l)), 'the old CLICKABLE Encrypt toggle button is still on the row');
  assert.doesNotMatch(right, /Encrypt/, 'the row still says "Encrypt" — the sealed status reads "Sealed", and the toggle lives in the panel');
  assert.doesNotMatch(right, /Change icon/, 'the icon button is still on the desktop row');
});

test('DESKTOP row status indicators: child-safe reflects the flag, the lock shows only when sealed, and both are READ-ONLY', async () => {
  const s = await screen();
  const rr = s.captured();
  const childSafeInd = (node) => find(node, n => n.type !== 'function' && /(child-safe|adults only)/i.test(String((n.props || {})['aria-label'] || '')));
  const lockInd = (node) => find(node, n => n.type !== 'function' && /sealed end-to-end/i.test(String((n.props || {})['aria-label'] || '')));

  const safe = rr.renderRight({ id: 'cs1', name: 'Youth', kind: 'group', visibility: 'open', childsafe: true });
  const adult = rr.renderRight({ id: 'cs2', name: 'Elders', kind: 'group', visibility: 'open', childsafe: false });
  const onInd = childSafeInd(safe), offInd = childSafeInd(adult);
  assert.equal(onInd.length, 1, 'a child-safe room shows no child-safe status indicator');
  assert.equal(offInd.length, 1, 'a non-child-safe room shows no status indicator — "which rooms are adults-only" must be visible too');
  assert.match(onInd[0].props['aria-label'], /child-safe/i, 'the ON indicator does not name the child-safe state');
  assert.match(offInd[0].props['aria-label'], /adults only/i, 'the OFF indicator does not name the adults-only state');
  assert.notEqual(onInd[0].props['aria-label'], offInd[0].props['aria-label'], 'the two states are not distinguishable');
  // READ-ONLY: not a button, no onClick — it is NOT the old toggle
  assert.notEqual(onInd[0].type, 'button', 'the child-safe status is a button — it must be read-only, not the old toggle');
  assert.equal(onInd[0].props.onClick, undefined, 'the child-safe status has an onClick — it must be read-only');
  assert.ok(onInd[0].props.title, 'the child-safe status has no title');

  const sealed = rr.renderRight({ id: 'e1', name: 'Secret', kind: 'group', visibility: 'open', encrypted: true });
  const plain = rr.renderRight({ id: 'e2', name: 'Open', kind: 'group', visibility: 'open', encrypted: false });
  const lock = lockInd(sealed);
  assert.equal(lock.length, 1, 'the Sealed indicator must show when the group is encrypted');
  assert.equal(lockInd(plain).length, 0, 'the Sealed indicator must NOT show when the group is not encrypted');
  assert.notEqual(lock[0].type, 'button', 'the Sealed status is a button — it must be read-only');
  assert.equal(lock[0].props.onClick, undefined, 'the Sealed status has an onClick — it must be read-only');
});

test('DESKTOP: closing the panel (Escape / Back / backdrop / ×) flushes a typed-but-unblurred name', async () => {
  // FIX 1: useStewDialog closes by UNMOUNTING, and React fires no onBlur on a removed element, so Escape/Back
  // dropped the edit. The × / backdrop / Escape / Back all route through flushSettingsAndClose. Drive the ×
  // (same handler) after typing via onChange only — NO blur — and the name must still be published.
  const s = await screen();
  s.openPanel();
  const name = s.input(s.panel(), 'Group name');
  await name.props.onChange({ target: { value: 'Renamed room' } });   // type, do NOT blur
  const dlg = s.panel();   // redraw: the snapshot now holds the typed name
  const closeBtn = find(dlg, n => n.type === 'button' && String((n.props || {}).title || '') === 'Close')[0];
  assert.ok(closeBtn, 'the panel has no Close control');
  await closeBtn.props.onClick();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(s.published.length, 1, 'closing the panel dropped the typed name — the close does not flush the pending edit');
  assert.equal(s.published[0].name, 'Renamed room', 'the flushed name is wrong');
  assert.equal(s.published[0].sub, ROOM.sub, 'the flush did not carry the group’s real description');
  assert.equal(s.dialog().length, 0, 'the panel did not close after flushing');
});
