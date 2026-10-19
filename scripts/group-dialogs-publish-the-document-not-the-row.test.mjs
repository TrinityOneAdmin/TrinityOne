// THE INVITE AND LEADERS DIALOGS MUST PUBLISH THE GROUP DOCUMENT, NOT THE ROW ON SCREEN — AND THE DOCUMENT AS IT IS NOW.
// Run: node --test scripts/group-dialogs-publish-the-document-not-the-row.test.mjs
//
// The desktop row's "People · N" and "Leaders" buttons handed the DISPLAY item (whose `sub` is the live string
// "12 members · invite-only") to EditGroupMembersModal / GroupLeadersModal, which publish `{...group, ...}`;
// publishGroup writes `sub: group.sub`, so every save overwrote the group's description with the count. And the
// dialogs held the group as it was when opened, so another steward's change made meanwhile was reverted.
//
// Point of use (rule 1): the REAL DashGroups, EditGroupMembersModal and GroupLeadersModal are compiled from
// app/stew-dashboard.jsx and rendered together; the test presses the row's own buttons, then Save, and reads what
// reaches publishGroup. No text-matching of the source (rule 3).
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
  const tmp = join(tmpdir(), 'grpdlg-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__grpdlg_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

const ROOM = {
  id: 'g-sg', name: 'Safeguarding leads', kind: 'group', sub: 'Weekly prayer for the sick and grieving',
  icon: '', accent: '', category: 'staff', visibility: 'invite', members: ['aa11', 'bb22'],
  encrypted: false, childsafe: false, leaders: ['aa11'], eventPolicy: 'leaders',
};
const ALICE = { pubkey: 'aa11', name: 'Alice' };

async function screen() {
  const { React, draw } = miniReact();
  const published = [], keys = [], events = [];
  let groups = [ROOM];
  let captured = null;
  const win = {
    Steward: { publishGroup: async (g) => { published.push(g); return { ...g, ts: 1 }; }, sendDM: async () => ({ id: 'dm' }), publishGroupKey: async (id, list, o) => { keys.push({ id, list, o }); return { ok: 1 }; } },
    useStewardGroups: () => groups, useStewardRosters: () => [], useStewardMembers: () => [ALICE],
    useStewardCategories: () => [], dispatchEvent: (e) => { events.push(e); return true; }, addEventListener() {}, removeEventListener() {},
  };
  const mod = await loadMany([
    { name: 'DashGroups', anchor: 'function DashGroups()' },
    { name: 'EditGroupMembersModal', anchor: 'function EditGroupMembersModal(' },
    { name: 'GroupLeadersModal', anchor: 'function GroupLeadersModal(' },
    // the shared approved-members filter DashGroups seals with (round 3a) — compiled in, not stubbed
    { name: 'stewKeyRecipients', anchor: 'function stewKeyRecipients(' }, { name: 'stewKeyRecipientsOrAdmitted', anchor: 'function stewKeyRecipientsOrAdmitted(' },
    { name: 'useStewKeyRecipients', anchor: 'function useStewKeyRecipients(' },
    { name: 'groupIcon', anchor: 'function groupIcon(' },   // DashGroups draws every room's icon through it
  ], {
    STEW_KEYS_LOADING: 'loading',
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    location: { search: '', hostname: 'x' }, document: { addEventListener() {}, removeEventListener() {} },
    ListPanel: function ListPanel(p) { captured = p; return null; },
    Icon: Stub('Icon'), SkPill: Stub('SkPill'), SkConfirm: Stub('SkConfirm'), SkBadge: Stub('SkBadge'),
    NewGroupModal: Stub('NewGroupModal'), CategoriesModal: Stub('CategoriesModal'),
    GroupChatModal: Stub('GroupChatModal'), KeyDistributor: Stub('KeyDistributor'),
    useRealMemberCount: () => 5, useStewDialog: () => ({}), useStewNarrow: () => false,   // DashGroups now reads a responsive flag (phase 1 settings panel)
    nameHandle: () => '', shortNpub: () => '', teamPeopleForAllowlist: () => [], publishCareTeamFor: async () => {},
    groupLiveSub: () => '2 members · invite-only',   // the decorated string that replaces the real description in the row
  });
  let tree = draw(mod.DashGroups, {});
  const redraw = () => { tree = draw(mod.DashGroups, {}); return tree; };
  const rowButton = (re) => {
    const it = captured.items.find(x => x.id === ROOM.id);
    assert.notEqual(it.sub, ROOM.sub, 'the row is no longer decorated — re-anchor this test');
    const hits = [captured.renderRight(it), captured.renderAside(it)]
      .flatMap(n => find(n, b => b.type === 'button' && re.test(texts(b).join(' '))));
    assert.equal(hits.length, 1, `expected one row button matching ${re}, found ${hits.length} — re-anchor`);
    return hits[0];
  };
  const clickSave = async () => {
    const dlg = find(redraw(), n => n.props && n.props.role === 'dialog');
    assert.equal(dlg.length, 1, 'no dialog is open after pressing the row button');
    const save = find(dlg[0], n => n.type === 'button' && String(n.props.className || '').includes('sk-btn--clay'));
    assert.equal(save.length, 1, 'the dialog Save button is gone — re-anchor');
    await save[0].props.onClick();
    for (let i = 0; i < 8; i++) await tick();
  };
  return { published, keys, events, rowButton, redraw, clickSave, setGroups: (g) => { groups = g; } };
}

test('CONTROL: the row is decorated, and Leaders opens a dialog that saves', async () => {
  const s = await screen();
  s.rowButton(/Leaders/).props.onClick();
  await s.clickSave();
  assert.equal(s.published.length, 1, 'Leaders → Save published nothing — nothing below is meaningful');
});

test('Leaders → Save keeps the group’s own description, not the live count', async () => {
  const s = await screen();
  s.rowButton(/Leaders/).props.onClick();
  await s.clickSave();
  assert.equal(s.published[0].sub, ROOM.sub, 'the description was overwritten with the row’s display string: ' + s.published[0].sub);
});

test('Invite · N → Save keeps the group’s own description, not the live count', async () => {
  const s = await screen();
  s.rowButton(/People/).props.onClick();
  await s.clickSave();
  assert.equal(s.published.length, 1);
  assert.equal(s.published[0].sub, ROOM.sub, 'the description was overwritten with the row’s display string: ' + s.published[0].sub);
});

test('Leaders: a child-safe flag set by another steward after the dialog opened survives Save', async () => {
  const s = await screen();
  s.rowButton(/Leaders/).props.onClick();
  s.redraw();
  s.setGroups([{ ...ROOM, childsafe: true, category: 'kids' }]);   // another steward, meanwhile
  s.redraw();
  await s.clickSave();
  assert.equal(s.published[0].childsafe, true, 'Save reverted the child-safe flag another steward had just set');
  assert.equal(s.published[0].category, 'kids', 'Save reverted the category another steward had just set');
});

test('Invite: child-safe and category set by another steward after the dialog opened survive Save', async () => {
  const s = await screen();
  s.rowButton(/People/).props.onClick();
  s.redraw();
  s.setGroups([{ ...ROOM, childsafe: true, category: 'kids' }]);
  s.redraw();
  await s.clickSave();
  assert.equal(s.published[0].childsafe, true, 'Save reverted the child-safe flag another steward had just set');
  assert.equal(s.published[0].category, 'kids');
});

test('Invite: someone another steward removed after the dialog opened is NOT re-added, and is not a key recipient', async () => {
  const s = await screen();
  s.setGroups([{ ...ROOM, encrypted: true }]);
  s.redraw();
  s.rowButton(/People/).props.onClick();
  s.redraw();
  s.setGroups([{ ...ROOM, encrypted: true, members: ['aa11'] }]);   // another steward removed bb22
  s.redraw();
  await s.clickSave();
  assert.deepEqual(s.published[0].members, ['aa11'], 'Save re-added the member another steward had removed');
  assert.equal(s.keys.length, 1);
  assert.deepEqual(s.keys[0].list, ['aa11'], 'the group key was sealed to the member another steward removed');
});

test('Invite: a member another steward added meanwhile is kept', async () => {
  const s = await screen();
  s.rowButton(/People/).props.onClick();
  s.redraw();
  s.setGroups([{ ...ROOM, members: ['aa11', 'bb22', 'cc33'] }]);
  s.redraw();
  await s.clickSave();
  assert.deepEqual([...s.published[0].members].sort(), ['aa11', 'bb22', 'cc33']);
});

test('Invite: encryption turned on by another steward after open still gets its key, for the new list', async () => {
  const s = await screen();
  s.rowButton(/People/).props.onClick();
  s.redraw();
  s.setGroups([{ ...ROOM, encrypted: true }]);
  s.redraw();
  await s.clickSave();
  assert.equal(s.keys.length, 1, 'the group was encrypted meanwhile but no key was published for the saved list');
  assert.deepEqual(s.keys[0].list, ['aa11', 'bb22']);
});

test('Invite and Leaders: a group deleted after the dialog opened is not resurrected, and the steward is told', async () => {
  for (const which of [/People/, /Leaders/]) {
    const s = await screen();
    s.rowButton(which).props.onClick();
    s.redraw();
    s.setGroups([]);   // another steward deleted it
    s.redraw();
    await s.clickSave();
    assert.equal(s.published.length, 0, `${which}: Save republished a deleted group`);
    assert.equal(s.keys.length, 0);
    const msg = s.events.map(e => JSON.stringify(e && e.detail)).join(' ');
    assert.match(msg, /was removed/, `${which}: nothing told the steward the group was gone`);
  }
});
