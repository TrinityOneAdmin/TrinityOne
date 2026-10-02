// A PERSON STILL WAITING TO JOIN (OR BLOCKED) MUST NOT BE OFFERED IN A STEWARD'S PICKER.
//   Run: node --test scripts/people-waiting-to-join-are-not-offered-in-pickers.test.mjs
//
// Sim finding (block A2, item 7). `useStewardMembers` returns every member document the relay has ever served,
// pending and blocked included. Every list a steward CHOOSES from read it directly, so a church that requires
// approval to join offered somebody still at the door as a candidate to put in a group, make a group leader or
// a STEWARD, link as a child's parent, clear to work with children, roster, or name as a care recipient —
// before anyone had said they belong. `useStewardPickableMembers` (app/steward-root.jsx) is the picker's view;
// the eight picker components below consult it. `useStewardMembers` itself is deliberately NOT filtered: key
// recipients, counts, name lookups and the pending list all need the full list.
//
// HOW IT ASSERTS (CLAUDE.md rules 1 and 3). Each REAL component is sliced out of its app/*.jsx by
// brace-match, compiled with the packaged build's esbuild and rendered through the miniature React; the
// names on its rendered tree are read. Nothing matches text in the .jsx. The hook is the SHIPPED one, lifted
// out of app/steward-root.jsx, and wired to stubs of the DATA streams only (members, admitted, blocked, the
// join policy, "have the streams loaded") — never to a stub that filters, which would hand the test the very
// decision it is named after. Deleting the call in any one picker leaves the pending person on its list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const ROOT_JSX = read('app/steward-root.jsx'), DASH = read('app/stew-dashboard.jsx'),
  SCH = read('app/stew-schedule.jsx'), MEALS = read('app/stew-meals.jsx');

const hex = (c) => c.repeat(64);
const ALICE = hex('a'), PAT = hex('b'), BOB = hex('c'), CARL = hex('d');
const MEMBERS = [
  { pubkey: ALICE, name: 'Alice Adult', npub: 'npub1alice' },
  { pubkey: PAT, name: 'Pending Pat', npub: 'npub1pat' },
  { pubkey: BOB, name: 'Blocked Bob', npub: 'npub1bob' },
  { pubkey: CARL, name: 'Carl Admitted', npub: 'npub1carl' },
];

// ── the shipped hook, over data-stream stubs ──────────────────────────────────────────────────────────────
function pickableHook({ joinApproval = true, loaded = true, admitted = [ALICE, CARL], blocked = [BOB] } = {}) {
  const win = {
    useStewardMembers: () => MEMBERS, useStewardAdmitted: () => admitted, useStewardBlocked: () => blocked,
    useStewardJoinPolicy: () => joinApproval, useStewardIdv: () => 1, stewardStreamLoaded: () => loaded,
  };
  const src = fnBody(ROOT_JSX, 'function useStewardPickableMembers(', 'useStewardPickableMembers');
  win.useStewardPickableMembers = new Function('window', `${src}\nreturn useStewardPickableMembers;`)(win);
  return win;
}

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const Pass = (n) => { const f = function (p) { return p.children === undefined ? null : p.children; }; Object.defineProperty(f, 'name', { value: n }); return f; };

async function component(file, src, name, anchor, globals) {
  const body = fnBody(src, anchor, name);
  const tmp = join(tmpdir(), 'pickers-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, body + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__pickers_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}

function baseGlobals(React, win) {
  return {
    React, window: win, setTimeout, clearTimeout, console, CustomEvent,
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, location: { search: '', hostname: 'x' },
    Icon: Stub('Icon'), SkPill: Stub('SkPill'), SkToggle: Stub('SkToggle'), SkBadge: Stub('SkBadge'), CkModal: Pass('CkModal'), SchModal: Pass('SchModal'), Panel: Pass('Panel'),
    nameHandle: () => '', shortNpub: (n) => n || '—', todayISO: () => '2026-10-02',
    memDisplay: (m) => m.name || m.pubkey, useStewDialog: () => ({}),
    lbl: {}, SK_TINT: new Proxy({}, { get: () => ({ fg: '#000', bg: '#fff' }) }), CAP_LABEL: {}, CAP_SUB: {}, schFld: {}, schLbl: {}, mealsFld: {}, recipRow: {},
  };
}
const said = (tree) => texts(tree).join(' | ');
const NAMES = ['Alice Adult', 'Pending Pat', 'Blocked Bob', 'Carl Admitted'];
const offered = (tree) => NAMES.filter(n => said(tree).includes(n));

// Every picker, rendered the way a steward reaches it, returning the rendered tree.
const PICKERS = {
  async NewGroupModal(win) {
    const { React, draw } = miniReact();
    const C = await component('dash', DASH, 'NewGroupModal', 'function NewGroupModal(', {
      ...baseGlobals(React, win), useStewardCategories: () => [], useStewardChurch: () => ({}) });
    const props = { open: true, onClose() {} };
    draw(C, props);
    let tree = draw(C, props);
    const box = find(tree, n => n.type === 'input' && n.props.type === 'checkbox' && typeof n.props.onChange === 'function');
    // the invite-only checkbox is the first one that reveals "WHO'S IN"
    for (const b of box) { b.props.onChange({ target: { checked: true } }); tree = draw(C, props); if (said(tree).includes('WHO’S IN')) break; }
    assert.match(said(tree), /WHO’S IN/, 're-anchor: could not open the invite-only member list');
    return tree;
  },
  async EditGroupMembersModal(win) {
    const { React, draw } = miniReact();
    const C = await component('dash', DASH, 'EditGroupMembersModal', 'function EditGroupMembersModal(', {
      ...baseGlobals(React, win), useStewardRosters: () => [], useMealsSettings: () => ({}) });
    return draw(C, { group: { id: 'g1', name: 'Room', members: [ALICE] }, onClose() {} });
  },
  async GroupLeadersModal(win) {
    const { React, draw } = miniReact();
    const C = await component('dash', DASH, 'GroupLeadersModal', 'function GroupLeadersModal(', baseGlobals(React, win));
    return draw(C, { group: { id: 'g1', name: 'Room', leaders: [] }, onClose() {} });
  },
  async GuardianLinkModal(win) {
    const { React, draw } = miniReact();
    const C = await component('dash', DASH, 'GuardianLinkModal', 'function GuardianLinkModal(', baseGlobals(React, win));
    return draw(C, { child: hex('e'), childName: 'Little Eve', members: MEMBERS, guardians: {}, minorsSet: new Set(), onLink() {}, onUnlink() {}, onClose() {} });
  },
  async ClearPersonModal(win) {
    const { React, draw } = miniReact();
    const C = await component('dash', DASH, 'ClearPersonModal', 'function ClearPersonModal(', baseGlobals(React, win));
    win.Steward = { checkinPermissionLifetimes: () => [{ id: 'day', label: 'One day' }], checkinPermissionPreview: () => ({ ok: true, why: '' }) };
    return draw(C, { members: MEMBERS, rosters: [], groups: [], nameFor: (p) => p, already: [], minors: new Set(), minorsKnown: true, onClose() {} });
  },
  async RosterModal(win) {
    const { React, draw } = miniReact();
    const C = await component('sch', SCH, 'RosterModal', 'function RosterModal(', {
      ...baseGlobals(React, win), useSch: React.useState, useSchE: React.useEffect, useSchR: React.useRef, teamMeta: (t) => ({ name: t.name, icon: 'hand', accent: 'var(--clay)' }), schBtn: {}, schInp: {} });
    return draw(C, { team: { id: 't1', name: 'Welcome team', members: [] }, roster: { team: 't1', people: [], roles: [], pods: [] }, members: MEMBERS, onClose() {} });
  },
  async RecipientPicker(win) {
    const { React, draw } = miniReact();
    const C = await component('meals', MEALS, 'RecipientPicker', 'function RecipientPicker(', baseGlobals(React, win));
    const props = { members: MEMBERS, value: '', onChange() {} };
    let tree = draw(C, props);
    const open = find(tree, n => n.type === 'button' && typeof n.props.onClick === 'function')[0];
    open.props.onClick();
    return draw(C, props);
  },
};

for (const [name, open] of Object.entries(PICKERS)) {
  test(`${name}: a person waiting to join and a blocked person are NOT offered; admitted people are`, async () => {
    const tree = await open(pickableHook());
    const got = offered(tree);
    assert.ok(got.includes('Alice Adult') && got.includes('Carl Admitted'),
      `re-anchor: ${name} no longer lists the admitted members at all, so the absences below are vacuous. Screen read: ${said(tree)}`);
    assert.ok(!got.includes('Pending Pat'), `${name} OFFERS SOMEBODY WHO IS STILL WAITING TO JOIN. Screen read: ${said(tree)}`);
    assert.ok(!got.includes('Blocked Bob'), `${name} offers a blocked person. Screen read: ${said(tree)}`);
  });
}

test('DashStewardsPanel: somebody waiting to join is not offered as a steward candidate', async () => {
  const { React, draw } = miniReact();
  const win = pickableHook();
  win.useStewardStewards = () => []; win.useStewardCaps = () => ({});
  win.Steward = { pubkey: hex('f'), actingChurch: '', stewardName: () => '' };
  const g = baseGlobals(React, win);
  const C = await component('dash', DASH, 'DashStewardsPanel', 'function DashStewardsPanel(', new Proxy(g, {}));
  let tree;
  try { tree = draw(C, { church: {} }); }
  catch (e) { assert.fail('re-anchor DashStewardsPanel harness: ' + e.message); }
  // the candidate list only opens from the "add a steward" control; open every button until names show up
  const names = () => offered(tree);
  for (const b of find(tree, n => n.type === 'button' && typeof n.props.onClick === 'function' && /Add|steward/i.test(texts(n).join(' ')))) {
    b.props.onClick(); tree = draw(C, { church: {} });
    if (names().length) break;
  }
  assert.ok(names().includes('Alice Adult'), 're-anchor: the steward candidates never appeared. Screen read: ' + said(tree));
  assert.ok(!names().includes('Pending Pat'), 'DashStewardsPanel OFFERS SOMEBODY STILL WAITING TO JOIN AS A STEWARD. Screen read: ' + said(tree));
  assert.ok(!names().includes('Blocked Bob'), 'DashStewardsPanel offers a blocked person as a steward');
});

// ── CONTROLS: the rule does not over-reach ───────────────────────────────────────────────────────────────
test('CONTROL: a church that does NOT require approval has no queue — everyone not blocked is offered', async () => {
  const tree = await PICKERS.GuardianLinkModal(pickableHook({ joinApproval: false }));
  assert.ok(offered(tree).includes('Pending Pat'), 'with approval off nobody is pending, but the picker hid somebody');
  assert.ok(!offered(tree).includes('Blocked Bob'), 'a blocked person is offered when approval is off');
});

test('CONTROL: until the admitted/blocked streams have loaded nobody is assumed pending (the picker is not emptied by a slow link)', async () => {
  const tree = await PICKERS.GuardianLinkModal(pickableHook({ loaded: false, admitted: [], blocked: [] }));
  assert.ok(offered(tree).includes('Alice Adult') && offered(tree).includes('Pending Pat'),
    'on a hard reload the pickers went empty while the rosters were still arriving');
});

test('CONTROL: somebody already in the group stays listed so a steward can un-tick them, even if blocked since', async () => {
  const win = pickableHook({ blocked: [BOB, ALICE] });
  const tree = await PICKERS.EditGroupMembersModal(win);   // Alice is in the group and is now blocked
  assert.ok(offered(tree).includes('Alice Adult'), 'an existing group member vanished from the editor, so she can never be removed');
  assert.ok(!offered(tree).includes('Blocked Bob'));
});
