// INVITE-ONLY IS A READ BOUNDARY, AND PHASE 2 PUTS IT WHERE A STEWARD CAN REACH IT — at CREATION for a
// BROADCAST (not only a group), and as an ON/OFF SWITCH in the unified group-settings panel.
//   Run: node --test scripts/invite-only-unlocks-for-broadcast-and-toggles-in-the-panel.test.mjs
//
// NO RELAY CHANGE. The relay (scripts/gateway.mjs) already keys its read gate on visibility==='invite'
// regardless of kind, so a broadcast can be invite-only with no gateway edit — these tests are CONSOLE-only.
//
// HOW IT ASSERTS (CLAUDE.md rules 1 and 3). The REAL NewGroupModal and the REAL DashGroups are sliced out of
// app/stew-dashboard.jsx by brace-match, compiled with the packaged build's esbuild (--jsx=transform) and
// rendered through the miniature React; the rendered tree is read and the publish stub captures what reached
// the wire. Nothing matches text in the .jsx. SkConfirm / EditGroupMembersModal are prop-capturing stubs so a
// confirm that is SKIPPED, or a picker opened without a seed, is visible as a missing node / missing prop.
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
const said = (tree) => texts(tree).join(' | ');

// ── slice + compile one or more top-level functions from stew-dashboard.jsx ──────────────────────────────
async function loadMany(anchors, globals) {
  const names = anchors.map(a => a.name);
  const src = anchors.map(a => fnBody(STEW, a.anchor, a.name)).join('\n') + `\nexport { ${names.join(', ')} };\n`;
  const tmp = join(tmpdir(), 'invbc-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__invbc_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// PART A — NewGroupModal: a BROADCAST can be created invite-only (member picker shows; publishes visibility).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
async function newGroupScreen() {
  const { React, draw } = miniReact();
  const published = [];
  const win = {
    innerWidth: 1200,
    Steward: { publishGroup: async (g) => { published.push(g); return { ...g, id: 'g-new', ts: 1 }; }, createEncryptedGroup: async () => ({ ok: 1 }) },
    useStewardMembers: () => [{ pubkey: 'aa11', name: 'Alice', npub: 'npub1a' }, { pubkey: 'bb22', name: 'Bob', npub: 'npub1b' }],
    useStewardPickableMembers: (m) => m,
    useStewardCategories: () => [], useStewardChurch: () => ({}), useStewardGroups: () => [],
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const mod = await loadMany([
    { name: 'NewGroupModal', anchor: 'function NewGroupModal(' },
    { name: 'stewKeyRecipients', anchor: 'function stewKeyRecipients(' }, { name: 'stewKeyRecipientsOrAdmitted', anchor: 'function stewKeyRecipientsOrAdmitted(' },
    { name: 'useStewKeyRecipients', anchor: 'function useStewKeyRecipients(' },
  ], {
    STEW_KEYS_LOADING: 'loading',
    React, window: win, CustomEvent: function (t, o) { return { type: t, detail: o && o.detail }; }, setTimeout, clearTimeout,
    location: { search: '', hostname: 'x' }, document: { addEventListener() {}, removeEventListener() {} },
    Icon: (p) => React.createElement('span', {}, 'ICON:' + (p.name || '')),
    SkToggle: Stub('SkToggle'), useStewDialog: () => ({}),
    nameHandle: () => '', shortNpub: () => '',
  });
  const props = { open: true, onClose() {} };
  let tree = draw(mod.NewGroupModal, props);
  tree = draw(mod.NewGroupModal, props);   // let the open-effect run
  const redraw = () => (tree = draw(mod.NewGroupModal, props));
  return { published, redraw, tree: () => tree, props };
}

test('CREATE: a BROADCAST can be made invite-only — the member picker appears and publishGroup carries visibility:invite + members', async () => {
  const s = await newGroupScreen();
  // name it (Create is disabled on a blank name)
  const nameInput = find(s.tree(), n => n.type === 'input' && n.props['aria-label'] === 'Name')[0];
  assert.ok(nameInput, 're-anchor: no Name input');
  nameInput.props.onChange({ target: { value: 'Announcements' } }); s.redraw();
  // switch TYPE to broadcast (SkToggle is stubbed → drive its onChange directly)
  const typeToggle = find(s.tree(), n => typeof n.type === 'function' && n.type.name === 'SkToggle')[0];
  assert.ok(typeToggle && typeof typeToggle.props.onChange === 'function', 're-anchor: no TYPE toggle');
  typeToggle.props.onChange('broadcast'); s.redraw();
  // tick invite-only: toggle each checkbox until the WHO'S IN picker appears (it must, now, for a broadcast)
  let opened = false;
  const boxes = find(s.tree(), n => n.type === 'input' && n.props.type === 'checkbox' && typeof n.props.onChange === 'function');
  for (const b of boxes) { b.props.onChange({ target: { checked: true } }); s.redraw(); if (said(s.tree()).includes('WHO’S IN')) { opened = true; break; } }
  assert.ok(opened, 'the invite-only member picker does NOT appear for a broadcast — it is still gated to group');
  // pick a member
  const row = find(s.tree(), n => n.type === 'button' && texts(n).includes('Alice'))[0];
  assert.ok(row, 're-anchor: no member row in the picker');
  row.props.onClick(); s.redraw();
  // create
  const createBtn = find(s.tree(), n => n.type === 'button' && texts(n).join(' ').includes('Create group'))[0];
  assert.ok(createBtn, 're-anchor: no Create button');
  createBtn.props.onClick();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(s.published.length, 1, 'creating the broadcast published nothing');
  assert.equal(s.published[0].kind, 'broadcast', 'the created room is not a broadcast');
  assert.equal(s.published[0].visibility, 'invite', 'the broadcast was NOT created invite-only — visibility is ' + s.published[0].visibility);
  assert.deepEqual(s.published[0].members, ['aa11'], 'the chosen member was not carried onto the invite-only broadcast');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// PART B — the settings panel invite-only ON/OFF switch.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
async function panelScreen(roomOverrides = {}, { approvalReady = true } = {}) {
  const { React, draw } = miniReact();
  const published = [];
  const ROOM = {
    id: 'g1', name: 'Prayer', kind: 'group', sub: 'Whole church', icon: '', accent: '', category: '',
    visibility: 'open', encrypted: false, childsafe: false, leaders: [], ...roomOverrides,
  };
  let groups = [ROOM];
  const win = {
    innerWidth: 1200,
    Steward: {
      publishGroup: async (g) => { published.push(g); return { ...g, ts: 1 }; },
      sendDM: async () => ({ id: 'dm' }), publishGroupKey: async () => ({ ok: 1 }),
      // make dgKr.approved() return a real set so the OFF→ON seed is non-empty
      listIsFresh: () => approvalReady, joinPolicyFresh: () => false,
    },
    useStewardGroups: () => groups, useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'aa11', name: 'Alice' }, { pubkey: 'bb22', name: 'Bob' }],
    useStewardCategories: () => [], useStewardBlocked: () => [], useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const mod = await loadMany([
    { name: 'DashGroups', anchor: 'function DashGroups()' },
    { name: 'stewKeyRecipients', anchor: 'function stewKeyRecipients(' }, { name: 'stewKeyRecipientsOrAdmitted', anchor: 'function stewKeyRecipientsOrAdmitted(' },
    { name: 'useStewKeyRecipients', anchor: 'function useStewKeyRecipients(' },
    { name: 'useStewNarrow', anchor: 'function useStewNarrow(' },
    { name: 'groupIcon', anchor: 'function groupIcon(' },
  ], {
    STEW_KEYS_LOADING: 'loading',
    React, window: win, CustomEvent: function (t, o) { return { type: t, detail: o && o.detail }; }, setTimeout, clearTimeout,
    location: { search: '', hostname: 'x' }, document: { addEventListener() {}, removeEventListener() {} },
    ListPanel: function ListPanel(p) { win.__captured = p; return null; },
    Icon: (p) => React.createElement('span', {}, 'ICON:' + (p.name || '')),
    SkPill: (p) => React.createElement('span', {}, p.children), SkConfirm: Stub('SkConfirm'), SkBadge: Stub('SkBadge'),
    SkToggle: Stub('SkToggle'), GroupIconPicker: Stub('GroupIconPicker'),
    NewGroupModal: Stub('NewGroupModal'), CategoriesModal: Stub('CategoriesModal'),
    GroupChatModal: Stub('GroupChatModal'), GroupLeadersModal: Stub('GroupLeadersModal'),
    EditGroupMembersModal: Stub('EditGroupMembersModal'), KeyDistributor: Stub('KeyDistributor'),
    useRealMemberCount: () => 5, useStewDialog: () => ({}),
    nameHandle: () => '', shortNpub: () => '', groupLiveSub: () => 'live',
  });
  let tree = draw(mod.DashGroups, {});
  const captured = () => win.__captured;
  const redraw = () => (tree = draw(mod.DashGroups, {}));
  const row = () => captured().items.find(x => x.id === ROOM.id);
  const openPanel = () => {
    const gear = find(captured().renderRight(row()), n => n.type === 'button' && /Settings for/.test(String(n.props['aria-label'] || '')));
    assert.equal(gear.length, 1, 'no Settings gear on the row');
    gear[0].props.onClick(); redraw();
  };
  const inviteBox = () => {
    const b = find(redraw(), n => n.type === 'input' && n.props.type === 'checkbox' && /invite-only is (on|off)/.test(String(n.props['aria-label'] || '')));
    return b;
  };
  const skconfirm = () => find(redraw(), n => typeof n.type === 'function' && n.type.name === 'SkConfirm');
  const editModal = () => find(redraw(), n => typeof n.type === 'function' && n.type.name === 'EditGroupMembersModal');
  return { published, captured, redraw, row, openPanel, inviteBox, skconfirm, editModal };
}

test('PANEL (open group): the invite-only switch is present and turning it ON opens the member picker SEEDED from approved members', async () => {
  const s = await panelScreen({ visibility: 'open' });
  s.openPanel();
  const box = s.inviteBox();
  assert.equal(box.length, 1, 'no invite-only switch in the panel for an open group');
  assert.equal(box[0].props.checked, false, 'the switch shows ON for an open group');
  box[0].props.onChange({ target: { checked: true } });
  const modal = s.editModal();
  assert.equal(modal.length, 1, 'turning invite-only ON did not open the member picker');
  assert.equal(modal[0].props.group.id, 'g1', 'the picker opened on the wrong group');
  assert.deepEqual(modal[0].props.seed, ['aa11', 'bb22'], 'the picker was NOT seeded from the currently-approved members (got: ' + JSON.stringify(modal[0].props.seed) + ')');
  assert.equal(s.published.length, 0, 'turning invite-only ON published immediately — it must wait for the picker to save');
});

test('PANEL (open BROADCAST): the invite-only switch is present and works — a broadcast can be made invite-only from the panel', async () => {
  const s = await panelScreen({ kind: 'broadcast', visibility: 'open' });
  s.openPanel();
  const box = s.inviteBox();
  assert.equal(box.length, 1, 'no invite-only switch in the panel for a broadcast');
  box[0].props.onChange({ target: { checked: true } });
  const modal = s.editModal();
  assert.equal(modal.length, 1, 'turning invite-only ON on a broadcast did not open the member picker');
  assert.deepEqual(modal[0].props.seed, ['aa11', 'bb22'], 'the broadcast picker was not seeded from approved members');
});

test('PANEL (invite group): turning invite-only OFF is gated behind a history-exposure confirm; publishGroup fires ONLY on confirm, with visibility/members cleared', async () => {
  const s = await panelScreen({ visibility: 'invite', members: ['aa11'] });
  s.openPanel();
  const box = s.inviteBox();
  assert.equal(box.length, 1, 'no invite-only switch in the panel for an invite group');
  assert.equal(box[0].props.checked, true, 'the switch does not show ON for an invite-only group');
  box[0].props.onChange({ target: { checked: false } });
  // the confirm must appear, and NOTHING may have been published yet
  const cf = s.skconfirm();
  assert.equal(cf.length, 1, 'turning invite-only OFF did NOT raise a confirm — it exposes the whole history, it must be confirmed');
  assert.match(String(cf[0].props.body || ''), /readable by anyone in your church/i, 'the confirm does not warn that past messages become readable by the whole church');
  assert.equal(s.published.length, 0, 'invite-only was opened to the church WITHOUT confirmation — publishGroup fired before the confirm');
  // confirm it
  cf[0].props.onConfirm();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(s.published.length, 1, 'confirming did not publish the change');
  assert.equal(s.published[0].visibility, undefined, 'visibility was not cleared — the group did not land in the relay open branch (got: ' + s.published[0].visibility + ')');
  assert.equal(s.published[0].members, undefined, 'the members allowlist was not cleared when opening the group up');
});

test('PANEL (encrypted invite group): the OFF confirm adds the extra warning that new members cannot read old encrypted messages', async () => {
  const s = await panelScreen({ visibility: 'invite', members: ['aa11'], encrypted: true });
  s.openPanel();
  const box = s.inviteBox();
  box[0].props.onChange({ target: { checked: false } });
  const cf = s.skconfirm();
  assert.equal(cf.length, 1, 'no confirm on turning an encrypted invite group open');
  assert.match(String(cf[0].props.body || ''), /old encrypted messages/i, 'the extra encrypted-history warning sentence is missing from the confirm');
  // still allowed (owner decision: warn, but do not block) — confirm goes through
  cf[0].props.onConfirm();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(s.published.length, 1, 'the confirm blocked opening an encrypted group — it must WARN but still allow');
  assert.equal(s.published[0].visibility, undefined, 'visibility not cleared on the encrypted group');
});

test('PANEL (team): no invite-only switch is exposed for a team (membership comes from the roster)', async () => {
  const s = await panelScreen({ kind: 'team', visibility: 'open' });
  s.openPanel();
  assert.equal(s.inviteBox().length, 0, 'a team must NOT get an invite-only switch — its membership is the roster');
});
