// THE GROUP-ROW "ADULTS ONLY"/"CHILD-SAFE"/"SEALED" TAGS ARE LABELS, NOT BUTTONS (owner 2026-11-06, pilot UI #3).
//   Run: node --test scripts/the-adults-only-tag-is-a-label-not-a-button.test.mjs
//
// In the console Groups list (DashGroups, desktop web), these status tags sit in a row of real pill-buttons
// (People / Leaders / Chat / Settings). They are READ-ONLY by owner decision — the toggles live in the settings
// panel — but they were drawn as filled, bordered, fully-rounded pills, so they read as tappable. This restyles
// them to plain inline labels (no border, no fill, no pill radius) while keeping them non-interactive.
//
// HONEST SCOPE: the VISUAL affordance is verified by eye in the console. What is asserted here is the contract
// that makes a label a label and FAILS if the pill chrome is restored (CLAUDE.md rule 1): the tag node is a
// <span> (not a <button>), has no onClick, and its style carries none of border / background / borderRadius.
// Rule 3: the REAL DashGroups is sliced from app/stew-dashboard.jsx, compiled and rendered; its renderRight is
// called and the drawn node is inspected — nothing matches text in app/*.jsx.
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
  const tmp = join(tmpdir(), 'tag-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__tag_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

async function rowRight() {
  const { React, draw } = miniReact();
  const win = {
    innerWidth: 1200,   // wide → desktop row, so renderRight returns the status tags (not the APK null branch)
    Steward: { publishGroup: async () => ({}) },
    useStewardGroups: () => [], useStewardRosters: () => [], useStewardMembers: () => [],
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
    Icon: (p) => React.createElement('span', {}, 'ICON:' + (p && p.name || '')),
    SkPill: (p) => React.createElement('span', {}, p && p.children), SkConfirm: Stub('SkConfirm'), SkBadge: Stub('SkBadge'),
    SkToggle: Stub('SkToggle'), GroupIconPicker: Stub('GroupIconPicker'),
    NewGroupModal: Stub('NewGroupModal'), CategoriesModal: Stub('CategoriesModal'),
    GroupChatModal: Stub('GroupChatModal'), GroupLeadersModal: Stub('GroupLeadersModal'),
    EditGroupMembersModal: Stub('EditGroupMembersModal'), KeyDistributor: Stub('KeyDistributor'),
    useRealMemberCount: () => 5, useStewDialog: () => ({}),
    nameHandle: () => '', shortNpub: () => '', groupLiveSub: () => 'live',
  });
  draw(mod.DashGroups, {});
  const renderRight = win.__captured && win.__captured.renderRight;
  assert.equal(typeof renderRight, 'function', 'DashGroups did not hand ListPanel a renderRight — re-anchor this test');
  return renderRight;
}

// a tag carries the label affordance iff: it is a <span> (not a <button>), has no onClick, and its inline
// style declares none of the button chrome we stripped.
function assertIsLabel(node, what) {
  assert.ok(node, 'no "' + what + '" status tag found on the group row — re-anchor this test');
  assert.equal(node.type, 'span', 'the "' + what + '" tag is a <' + node.type + '>, not a <span> label');
  assert.equal(typeof node.props.onClick, 'undefined', 'the "' + what + '" tag has an onClick — a status label must not be interactive');
  const s = node.props.style || {};
  assert.ok(!('border' in s), 'THE DEFECT: the "' + what + '" tag still has a border — it reads as a button');
  assert.ok(!('background' in s), 'THE DEFECT: the "' + what + '" tag still has a filled background — it reads as a button');
  assert.ok(!('borderRadius' in s), 'THE DEFECT: the "' + what + '" tag still has a pill borderRadius — it reads as a button');
}

const tagByAria = (right, it, re) => find(right(it), n => n.type === 'span' && re.test(String(n.props['aria-label'] || '')))[0];

test('the ADULTS-ONLY tag is a non-interactive label, not a button', async () => {
  const right = await rowRight();
  const it = { id: 'g1', name: 'Leaders', kind: 'group', childsafe: false, encrypted: false, visibility: 'open', members: [], leaders: [] };
  assertIsLabel(tagByAria(right, it, /adults only: hidden from children/), 'Adults only');
});

test('the CHILD-SAFE tag is a non-interactive label, not a button', async () => {
  const right = await rowRight();
  const it = { id: 'g2', name: 'Youth', kind: 'group', childsafe: true, encrypted: false, visibility: 'open', members: [], leaders: [] };
  assertIsLabel(tagByAria(right, it, /child-safe: members marked as a child can join/), 'Child-safe');
});

test('the SEALED tag is a non-interactive label, not a button', async () => {
  const right = await rowRight();
  const it = { id: 'g3', name: 'Safeguarding', kind: 'group', childsafe: false, encrypted: true, visibility: 'open', members: [], leaders: [] };
  assertIsLabel(tagByAria(right, it, /sealed end-to-end/), 'Sealed');
});
