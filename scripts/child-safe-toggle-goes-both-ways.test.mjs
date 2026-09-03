// "CHILD-SAFE" MUST BE A TOGGLE, AND A ROOM NOBODY TICKED MUST NOT BE BORN CHILD-SAFE.
//   Run: node --test scripts/child-safe-toggle-goes-both-ways.test.mjs
//
// `childsafe` on a group document is the single fact the relay consults before it decides whether a young
// person is served that room's name, its messages and its events (canRead's GROUP_CHILDSAFE checks). It is
// the church saying "children may be in here". Four separate ways it can be set wrongly were confirmed by
// audit on 2026-09-01 with the whole suite green:
//
//   8.  the Groups-tab toggle can stop turning child-safe OFF. `publishGroup({ ...it, childsafe:
//       !it.childsafe })` -> `!it.childsafe || true` and a steward who realises the youth room has become an
//       adults-only room presses the control, watches it, and it stays on. A church can never take it back.
//   9.  the same toggle can be made to publish `childsafe: true` outright. That cruder form does redden the
//       suite today — but only in scripts/controls-have-accessible-names.test.mjs, which FINDS the line by
//       the literal string `childsafe: !it.childsafe` in order to read its aria-label. Delete the string and
//       its anchor stops resolving. That is a re-anchor tripwire, not a behavioural guard: it says "this
//       line moved", never "an adults-only room was opened to children". Both forms must redden this file.
//   10. `if (childsafe) g.childsafe = true;` in NewGroupModal.create can go unconditional, so EVERY room a
//       church creates is published as one children may enter, including the one it makes for its
//       safeguarding team.
//   11. the new-room checkbox's `onChange` can be emptied, so a steward ticks "👶 Child-safe", sees the tick,
//       and creates an adults-only room — the youth group is then invisible to the young people it is for,
//       which per reference/DOMAIN.md is a SILENT absence: nothing on any screen explains it.
//
// And the fifth, one layer down: src/steward.src.js shapes the published content with
// `childsafe: group.childsafe ? true : void 0`. Turn that into a bare `true` and every group on the relay
// becomes child-safe regardless of what any console said. That one is asserted against vendor/steward.js,
// the file that actually ships.
//
// HOW IT ASSERTS. CLAUDE.md rule 3 — app/*.jsx ships UNBUNDLED, so `false && ` or `|| true` leaves every word
// of the original in the file and a text match still passes. Nothing here matches text in app/*.jsx. The
// real DashGroups and the real NewGroupModal are sliced out by brace-match, compiled with the same esbuild
// the packaged build uses, rendered through the miniature React in scripts/render-jsx-screen.mjs, and driven
// by their ACCESSIBLE NAMES: the group row's toggle by its aria-label, the new-room checkbox through the
// label that names it, the create button by the words on it. What reached window.Steward.publishGroup is
// what is asserted. The vendor case runs the SHIPPED expression rather than reading it.
//
// MEASURED RED/GREEN, 2026-09-01. Each sabotage was scoped to its enclosing function and verified to occur
// exactly once inside it before the edit (CLAUDE.md "sabotage must be scoped" — these are near-identical
// siblings: the row carries an `encrypted` toggle written the same way, and the modal has three checkboxes).
//   · the shipped console + vendor                                            6 pass / 0 fail
//   · row toggle -> `childsafe: !it.childsafe || true`                         5 pass / 1 fail
//   · row toggle -> `childsafe: true`                                          5 pass / 1 fail
//   · create -> `g.childsafe = true;` unconditional                            5 pass / 1 fail
//   · the new-room checkbox's onChange -> `e => {}`                            5 pass / 1 fail
//   · src/steward.src.js -> `childsafe: true`, vendor/steward.js rebuilt       5 pass / 1 fail
// The runner slices the enclosing function (DashGroups, NewGroupModal), asserts the anchor occurs exactly
// once inside it, replaces it there, runs this file, and restores the source byte-for-byte. The last row is
// the real thing: src edited, `bash scripts/build-steward.sh` run, then both files restored (vendor/steward.js
// back to sha fa53482f…).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody, stmt } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const VENDOR = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 5));

// One component out of the console, compiled by the real esbuild and loaded as a module. Same mechanism as
// scripts/a-dm-that-never-sent-is-not-sent.test.mjs.
async function loadConsoleComponent(name, anchor, globals) {
  const src = fnBody(STEW, anchor, name);
  const tmp = join(tmpdir(), 'csafe-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__csafe_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ── the Groups tab: one room's row of controls ─────────────────────────────────────────────────────────────
// DashGroups hands its row controls to ListPanel as `renderRight`. Stubbing ListPanel to capture that prop is
// how the real control is obtained without reimplementing the list around it.
async function groupsTab() {
  const { React, draw } = miniReact();
  const published = [];
  let captured = null;
  const win = {
    Steward: { publishGroup: (g) => { published.push(g); return Promise.resolve({ ...g, ts: 1 }); } },
    useStewardGroups: () => [], useStewardRosters: () => [], useStewardMembers: () => [],
    useStewardCategories: () => [], dispatchEvent: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  const Comp = await loadConsoleComponent('DashGroups', 'function DashGroups()', {
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    location: { search: '', hostname: 'x' }, document: { addEventListener() {}, removeEventListener() {} },
    ListPanel: function ListPanel(p) { captured = p; return null; },
    Icon: Stub('Icon'), SkPill: Stub('SkPill'), SkConfirm: Stub('SkConfirm'),
    NewGroupModal: Stub('NewGroupModal'), CategoriesModal: Stub('CategoriesModal'),
    GroupChatModal: Stub('GroupChatModal'), GroupLeadersModal: Stub('GroupLeadersModal'),
    EditGroupMembersModal: Stub('EditGroupMembersModal'), KeyDistributor: Stub('KeyDistributor'),
    useRealMemberCount: () => 5, useStewDialog: () => ({}),
  });
  draw(Comp, {});
  assert.ok(captured && typeof captured.renderRight === 'function',
    'the Groups tab no longer renders its rows through ListPanel’s renderRight — re-anchor this test');
  // The child-safe control on one room's row, found by its accessible name. The `encrypted` toggle beside it
  // is written identically, so anything less specific than this would be pressing the wrong button.
  const control = (group) => {
    const hits = find(captured.renderRight(group), n => n.type === 'button'
      && /child-safe is (on|off)\./.test(String((n.props || {})['aria-label'] || '')));
    assert.equal(hits.length, 1,
      `a room's row no longer carries exactly one child-safe control (found ${hits.length}) — re-anchor this test`);
    return hits[0];
  };
  return { control, published };
}

test('CONTROL: a room’s row carries a child-safe toggle that says which way it is set', async () => {
  const g = await groupsTab();
  assert.match(g.control({ id: 'g1', name: 'Youth group', kind: 'group', childsafe: true }).props['aria-label'],
    /^Youth group — child-safe is on\./);
  assert.match(g.control({ id: 'g2', name: 'Marriage counselling', kind: 'group' }).props['aria-label'],
    /^Marriage counselling — child-safe is off\./);
});

test('PRESSING IT ON AN ALREADY-CHILD-SAFE ROOM TURNS CHILD-SAFE OFF', async () => {
  const g = await groupsTab();
  g.control({ id: 'g1', name: 'Youth group', kind: 'group', childsafe: true }).props.onClick();
  assert.equal(g.published.length, 1, 'the control published nothing at all — the setting cannot be changed');
  assert.ok(!g.published[0].childsafe,
    'a room that is already child-safe stayed child-safe when the steward pressed the control to restrict it ' +
    'to adults. `childsafe` is what the relay reads before serving a room’s name, its messages and its events ' +
    'to a young person, so a church that has decided a room is no longer for children cannot make that true — ' +
    'and the screen reports the press as having worked');
  assert.equal(g.published[0].name, 'Youth group', 'the room was republished without its own name');
});

test('…and pressing it on an adults-only room turns child-safe ON, which is the other half of a toggle', async () => {
  const g = await groupsTab();
  g.control({ id: 'g2', name: 'Youth group', kind: 'group' }).props.onClick();
  assert.equal(g.published.length, 1, 'the control published nothing at all');
  assert.equal(g.published[0].childsafe, true,
    'a church can no longer open a room to the young people it is for — and per reference/DOMAIN.md the room ' +
    'simply is not there on their phones, with nothing to explain why');
});

// ── creating a room ────────────────────────────────────────────────────────────────────────────────────────
async function newGroupModal() {
  const { React, draw } = miniReact();
  const published = [];
  const win = {
    Steward: { publishGroup: (g) => { published.push(g); return Promise.resolve({ id: 'g1', ...g, ts: 1 }); },
      publishGroupKey: async () => ({ skipped: [] }) },
    useStewardMembers: () => [], useStewardCategories: () => [],
    useStewardChurch: () => ({ features: {} }), dispatchEvent: () => true,
  };
  const Comp = await loadConsoleComponent('NewGroupModal', 'function NewGroupModal(', {
    React, window: win, CustomEvent, Promise, setTimeout,
    Icon: Stub('Icon'), SkToggle: Stub('SkToggle'), SkPill: Stub('SkPill'),
    nameHandle: () => '', shortNpub: () => 'npub1…',
    // The modal announces itself as a dialog and traps focus since the a11y batch (2026-09-03), through the
    // same shared helper every other console modal uses.
    useStewDialog: () => ({}),
  });
  const props = { open: true, onClose: () => {} };
  let tree = draw(Comp, props);
  const redraw = () => { tree = draw(Comp, props); return tree; };
  // The modal carries THREE checkboxes (child-safe, invite-only, encrypted). Reach the one under test through
  // the label that names it, never by position.
  const childSafeBox = () => {
    const labels = find(tree, n => n.type === 'label' && texts(n).join(' ').includes('Child-safe'));
    assert.equal(labels.length, 1, 'the new-room form no longer has exactly one control labelled Child-safe — re-anchor');
    const boxes = find(labels[0], n => n.type === 'input' && n.props.type === 'checkbox');
    assert.equal(boxes.length, 1, 'the Child-safe label no longer contains exactly one checkbox — re-anchor');
    return boxes[0];
  };
  const type = (label, value) => {
    const i = find(tree, n => n.type === 'input' && n.props['aria-label'] === label)[0];
    assert.ok(i, `the new-room form has no field labelled ${label} — re-anchor this test`);
    i.props.onChange({ target: { value } });
    redraw();
  };
  const create = async () => {
    const btns = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Create group'));
    assert.equal(btns.length, 1, 'the new-room form no longer has a Create group button — re-anchor this test');
    btns[0].props.onClick();
    await tick();
  };
  return { childSafeBox, type, create, redraw, published };
}

test('A ROOM CREATED WITH THE BOX UNTICKED IS NOT PUBLISHED AS CHILD-SAFE', async () => {
  const m = await newGroupModal();
  m.type('Name', 'Safeguarding team');
  assert.equal(m.childSafeBox().props.checked, false, 're-anchor: the box is ticked before anyone touched it');
  await m.create();
  assert.equal(m.published.length, 1, 'creating a room published nothing');
  assert.ok(!m.published[0].childsafe,
    'a room nobody marked child-safe was created as one. Every room a church makes — its safeguarding team’s ' +
    'own room included — would then be a room the relay lets children read');
});

test('…and ticking the box really does create a child-safe room', async () => {
  // The pair. Without this, the test above would also pass over a checkbox whose onChange does nothing, and
  // a steward who ticks "👶 Child-safe", sees the tick, and creates the youth group would find it invisible to
  // every young person in the church with nothing on any screen to say why.
  const m = await newGroupModal();
  m.type('Name', 'Youth group');
  m.childSafeBox().props.onChange({ target: { checked: true } });
  m.redraw();
  assert.equal(m.childSafeBox().props.checked, true,
    'the tick did not stick: the steward sees an empty box after pressing it');
  await m.create();
  assert.equal(m.published.length, 1, 'creating a room published nothing');
  assert.equal(m.published[0].childsafe, true,
    'the steward ticked “Child-safe” and the room was published as adults-only. The young people it was ' +
    'made for are never served it, and nothing anywhere says so');
});

// ── one layer down: what publishGroup actually puts on the wire ────────────────────────────────────────────
// vendor/steward.js is the file the console loads. This runs the SHIPPED expression rather than reading it:
// a bundled file is not covered by CLAUDE.md rule 3 (esbuild removes dead code, so text CAN be matched there)
// but a value change like `? true : void 0` -> `true` leaves the surrounding text intact either way, and
// running it is the only thing that answers the question.
test('publishGroup puts childsafe on the wire ONLY when the group says so', async () => {
  const line = stmt(VENDOR, 'const content = JSON.stringify({ name: group.name || "Group"',
    'publishGroup’s content shaping in vendor/steward.js');
  const shape = new Function('group', 'inviteOnly', 'EVENT_POLICIES',
    line + '\nreturn JSON.parse(content);');
  const POL = ['leaders', 'stewards', 'everyone'];
  assert.equal(shape({ name: 'Marriage counselling' }, false, POL).childsafe, undefined,
    'a group with no childsafe flag is published AS child-safe, so every room on the relay is one children ' +
    'may read whatever the console said');
  assert.equal(shape({ name: 'Youth group', childsafe: true }, false, POL).childsafe, true,
    'a room the church marked child-safe is not published as one — it disappears from the young people it is for');
  assert.equal(shape({ name: 'Marriage counselling', childsafe: false }, false, POL).childsafe, undefined,
    'turning child-safe OFF does not reach the wire, so a church can never take it back');
});
