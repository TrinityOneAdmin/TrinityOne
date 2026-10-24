// THE STEWARD'S MEMBER-PICKER MODALS CAN BE SEARCHED BY NAME OR @HANDLE — AND THE SEARCH NEVER DROPS A TICK.
//   Run: node --test scripts/the-members-picker-can-be-searched.test.mjs
//
// Owner decision 2026-10-19: add a name/@handle search filter to all three "pick many members from the whole
// church" modals in app/stew-dashboard.jsx — NewGroupModal (invite-only list), EditGroupMembersModal and
// GroupLeadersModal. Always show the box, no autofocus, no size threshold.
//
// CLAUDE.md rules 1 + 3: app/*.jsx ships UNBUNDLED, so a text match on the source survives `false && ` in front
// of any of it — deleting the search box from the screen would leave every word of it in the file. So each REAL
// component is sliced out by brace-match, compiled with the packaged build's esbuild, rendered through the
// miniature React, and every assertion reads the resulting tree or the args the modal passed to a stubbed
// Steward. Assertion (b) in each modal FAILS if the search <input> is removed from the screen — that is the
// point. Assertion (c) proves the filter is VIEW-ONLY: a member ticked and then filtered out of sight is still
// in the member/leader list the modal saves (ticking is by pubkey into `sel`, independent of what is shown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts, reads } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const tickMicro = () => new Promise(r => setTimeout(r, 0));
const tickAll = async () => { for (let i = 0; i < 6; i++) await tickMicro(); };

const hex = (c) => c.repeat(64);
const ALICE = hex('a'), BOB = hex('b'), CARL = hex('c');
// Bob's NAME contains no "bobby"; his @handle does — so a search for "bobby" exercises the @handle branch alone.
const MEMBERS = [
  { pubkey: ALICE, name: 'Alice Anderson', npub: 'npub1alice', nip05: 'alice@grace.church' },
  { pubkey: BOB,   name: 'Bob Brown',      npub: 'npub1bob',   nip05: 'bobby@grace.church' },
  { pubkey: CARL,  name: 'Carl Carter',    npub: 'npub1carl',  nip05: 'carl@grace.church' },
];
const NAMES = MEMBERS.map(m => m.name);
// The shared @handle helper, real-shaped: nameHandle(m) is the local part of the member's nip05.
const nameHandle = (m) => (m && m.nip05) ? m.nip05.split('@')[0] : '';

// ── the slice-and-compile harness (same shape as people-waiting-to-join-are-not-offered-in-pickers.test.mjs) ──
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

async function component(name, anchor, globals) {
  const base = fnBody(DASH, anchor, name);
  const body = base + (/\buseStewKeyRecipients\(/.test(base)
    ? '\n' + ['stewKeyRecipients', 'stewKeyRecipientsOrAdmitted', 'useStewKeyRecipients'].map(n => fnBody(DASH, 'function ' + n + '(', n)).join('\n')
      + '\n' + DASH.match(/^const STEW_KEYS_LOADING = .*;$/m)[0]
    : '');
  const tmp = join(tmpdir(), 'pickersearch-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, body + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__pickersearch_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}

function baseGlobals(React, win) {
  return {
    React, window: win, setTimeout, clearTimeout, console, CustomEvent,
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, location: { search: '', hostname: 'x' },
    Icon: Stub('Icon'), SkToggle: Stub('SkToggle'), SkBadge: Stub('SkBadge'),
    nameHandle, shortNpub: (n) => n || '—', useStewDialog: () => ({ current: null }),
  };
}

// ── tree readers ──────────────────────────────────────────────────────────────────────────────────────────
// A member ROW is a button whose title starts "Tick to …" — the Create/Save buttons never match.
const memberRows = (tree) => find(tree, n => n.type === 'button' && typeof n.props.title === 'string' && n.props.title.startsWith('Tick to'));
const rowNames = (tree) => memberRows(tree).map(b => NAMES.find(n => texts(b).join(' ').includes(n))).filter(Boolean);
const searchBox = (tree) => find(tree, n => n.type === 'input' && n.props.type === 'search');
const headerCount = (tree, word) => { const m = reads(tree).match(new RegExp(word + ' · (\\d+)')); return m ? Number(m[1]) : null; };

// ── NewGroupModal ─────────────────────────────────────────────────────────────────────────────────────────
async function mountNewGroup() {
  const { React, draw } = miniReact();
  const published = [], closed = [];
  const win = {
    useStewardMembers: () => MEMBERS,
    useStewardPickableMembers: (m) => m,            // passthrough: the pick list IS the full church here
    useStewardCategories: () => [],
    useStewardChurch: () => ({ features: { encryptComms: false } }),   // keeps Encrypted OFF → the simple publish path
    useStewardGroups: () => [],
    useStewKeyRecipients: undefined,                // sliced-in real helper is used; not referenced on this path
    Steward: { publishGroup: async (g) => { published.push(g); return { id: 'g1', ts: 1 }; } },
  };
  const C = await component('NewGroupModal', 'function NewGroupModal(', baseGlobals(React, win));
  const props = { open: true, onClose: () => closed.push(1) };
  draw(C, props);                 // first draw runs the open-reset effect
  let tree = draw(C, props);
  // reveal the invite-only member list by toggling checkboxes until "WHO'S IN" appears
  for (const b of find(tree, n => n.type === 'input' && n.props.type === 'checkbox' && typeof n.props.onChange === 'function')) {
    b.props.onChange({ target: { checked: true } }); tree = draw(C, props);
    if (reads(tree).includes('WHO’S IN')) break;
  }
  assert.match(reads(tree), /WHO’S IN/, 're-anchor: could not open the invite-only member list');
  const render = () => draw(C, props);
  return {
    render, published, closed,
    setName: (v) => { find(render(), n => n.type === 'input' && n.props['aria-label'] === 'Name')[0].props.onChange({ target: { value: v } }); },
    setSearch: (v) => { const i = searchBox(render()); assert.equal(i.length, 1, 'the search box is not on the NewGroupModal'); i[0].props.onChange({ target: { value: v } }); },
    tick: (name) => { const r = memberRows(render()).find(b => texts(b).join(' ').includes(name)); assert.ok(r, 'row missing to tick: ' + name); r.props.onClick(); },
    create: async () => { const b = find(render(), n => n.type === 'button' && String(n.props.className || '').includes('sk-btn--clay')); assert.equal(b.length, 1, 'Create button gone'); await b[0].props.onClick(); await tickAll(); },
  };
}

test('NewGroupModal: invite-only member list is searchable by name and by @handle, header holds the tick count', async () => {
  const m = await mountNewGroup();
  // (a) CONTROL — every member renders before any search
  assert.deepEqual(rowNames(m.render()).sort(), [...NAMES].sort(), 'the invite list does not start by showing every member');
  assert.equal(searchBox(m.render()).length, 1, 'no search box is shown (owner: always show it)');
  // (b) name search narrows to one — FAILS if the box is deleted from the screen
  m.setSearch('alice');
  assert.deepEqual(rowNames(m.render()), ['Alice Anderson'], 'a name search did not narrow to the one match');
  // starts-with, NOT contains-anywhere (owner 2026-10-19): a mid-word substring must match nobody
  m.setSearch('nderson');
  assert.equal(memberRows(m.render()).length, 0, 'STARTS-WITH BROKEN: "nderson" (mid-word of Anderson) matched — the filter reverted to contains-anywhere');
  // @handle search narrows to Bob, whose NAME does not contain the query
  m.setSearch('bobby');
  assert.deepEqual(rowNames(m.render()), ['Bob Brown'], 'an @handle search (not a name match) did not find the member');
  // (e) NO-MATCH line
  m.setSearch('zzzzz');
  assert.equal(memberRows(m.render()).length, 0, 'rows still shown for a query nobody matches');
  assert.match(reads(m.render()), /No members match/, 'no "No members match" line was shown');
  // (c)+(d) tick two, filter to one, and the header still counts the ticks
  m.setSearch('');
  m.tick('Carl Carter'); m.tick('Bob Brown');
  m.setSearch('alice');                                  // Bob and Carl are now filtered OUT of view
  assert.deepEqual(rowNames(m.render()), ['Alice Anderson'], 'the view did not narrow while two others were ticked');
  assert.equal(headerCount(m.render(), 'IN'), 2, 'the header counts the VISIBLE rows, not the members still selected');
  // the save keeps the filtered-out ticks
  m.setName('Youth');
  await m.create();
  assert.equal(m.published.length, 1, 'the group was not created');
  const saved = (m.published[0].members || []).slice().sort();
  assert.ok(saved.includes(BOB) && saved.includes(CARL),
    'SELECTION DROPPED BY THE FILTER: Bob and/or Carl were ticked, then scrolled out of view by a search, and the created group left them out — ' + JSON.stringify(saved));
});

// ── EditGroupMembersModal ─────────────────────────────────────────────────────────────────────────────────
async function mountEditMembers(group) {
  const { React, draw } = miniReact();
  const published = [], closed = [];
  const win = {
    useStewardMembers: () => MEMBERS,
    useStewardPickableMembers: (m) => m,
    useStewardRosters: () => [],
    useMealsSettings: () => ({}),
    Steward: { publishGroup: async (g) => { published.push(g); return { id: 'g1' }; } },
  };
  const C = await component('EditGroupMembersModal', 'function EditGroupMembersModal(', baseGlobals(React, win));
  const props = { group, onClose: () => closed.push(1) };
  const render = () => draw(C, props);
  render();
  return {
    render, published, closed,
    setSearch: (v) => { const i = searchBox(render()); assert.equal(i.length, 1, 'the search box is not on the EditGroupMembersModal'); i[0].props.onChange({ target: { value: v } }); },
    tick: (name) => { const r = memberRows(render()).find(b => texts(b).join(' ').includes(name)); assert.ok(r, 'row missing to tick: ' + name); r.props.onClick(); },
    save: async () => { const b = find(render(), n => n.type === 'button' && String(n.props.className || '').includes('sk-btn--clay')); assert.equal(b.length, 1, 'Save button gone'); await b[0].props.onClick(); await tickAll(); },
  };
}

test('EditGroupMembersModal: the member list is searchable, and a tick filtered out of view is still saved', async () => {
  const m = await mountEditMembers({ id: 'g1', name: 'Room', members: [ALICE] });
  // (a) CONTROL
  assert.deepEqual(rowNames(m.render()).sort(), [...NAMES].sort(), 'the editor does not start by listing every member');
  assert.equal(searchBox(m.render()).length, 1, 'no search box is shown');
  // (b) narrow by name — FAILS if the box is deleted
  m.setSearch('carl');
  assert.deepEqual(rowNames(m.render()), ['Carl Carter'], 'a name search did not narrow to the one match');
  // starts-with, NOT contains-anywhere (owner 2026-10-19): a mid-word substring must match nobody
  m.setSearch('arter');
  assert.equal(memberRows(m.render()).length, 0, 'STARTS-WITH BROKEN: "arter" (mid-word of Carter) matched — the filter reverted to contains-anywhere');
  // @handle branch
  m.setSearch('bobby');
  assert.deepEqual(rowNames(m.render()), ['Bob Brown'], 'an @handle search did not find the member');
  // (e) NO-MATCH
  m.setSearch('zzzzz');
  assert.equal(memberRows(m.render()).length, 0, 'rows still shown for a no-match query');
  assert.match(reads(m.render()), /No members match/, 'no "No members match" line');
  // (c)+(d) tick Bob, filter him out, header still counts both ticked, save keeps him
  m.setSearch('');
  m.tick('Bob Brown');                                   // sel = { Alice (seeded), Bob }
  m.setSearch('alice');                                  // Bob filtered OUT of view
  assert.deepEqual(rowNames(m.render()), ['Alice Anderson'], 'the view did not narrow while Bob was ticked');
  assert.equal(headerCount(m.render(), 'MEMBERS'), 2, 'the MEMBERS header counts the visible rows, not the selection');
  await m.save();
  assert.equal(m.published.length, 1, 'the member list was not saved');
  const saved = (m.published[0].members || []).slice().sort();
  assert.ok(saved.includes(ALICE) && saved.includes(BOB),
    'SELECTION DROPPED BY THE FILTER: Bob was ticked, then searched out of view, and the saved member list left him out — ' + JSON.stringify(saved));
  assert.equal(m.closed.length, 1, 'a successful save did not close the modal');
});

// ── GroupLeadersModal ─────────────────────────────────────────────────────────────────────────────────────
// (NB: this modal has no "· N" count header, so assertion (d) does not apply to it — there is no count to check.)
async function mountLeaders(group) {
  const { React, draw } = miniReact();
  const published = [], dms = [], closed = [];
  const win = {
    useStewardMembers: () => MEMBERS,
    useStewardPickableMembers: (m) => m,
    Steward: { publishGroup: async (g) => { published.push(g); return { id: 'g1' }; }, sendDM: async (pk) => { dms.push(pk); return { id: 'dm1' }; } },
  };
  const C = await component('GroupLeadersModal', 'function GroupLeadersModal(', baseGlobals(React, win));
  const props = { group, onClose: () => closed.push(1) };
  const render = () => draw(C, props);
  render();
  return {
    render, published, dms, closed,
    setSearch: (v) => { const i = searchBox(render()); assert.equal(i.length, 1, 'the search box is not on the GroupLeadersModal'); i[0].props.onChange({ target: { value: v } }); },
    tick: (name) => { const r = memberRows(render()).find(b => texts(b).join(' ').includes(name)); assert.ok(r, 'row missing to tick: ' + name); r.props.onClick(); },
    save: async () => { const b = find(render(), n => n.type === 'button' && String(n.props.className || '').includes('sk-btn--clay')); assert.equal(b.length, 1, 'Save button gone'); await b[0].props.onClick(); await tickAll(); },
  };
}

test('GroupLeadersModal: the candidate list is searchable, and a leader ticked then filtered out is still saved', async () => {
  const m = await mountLeaders({ id: 'g1', name: 'Room', leaders: [] });
  // (a) CONTROL
  assert.deepEqual(rowNames(m.render()).sort(), [...NAMES].sort(), 'the leaders modal does not start by listing every member');
  assert.equal(searchBox(m.render()).length, 1, 'no search box is shown');
  // (b) narrow by name — FAILS if the box is deleted
  m.setSearch('alice');
  assert.deepEqual(rowNames(m.render()), ['Alice Anderson'], 'a name search did not narrow to the one match');
  // starts-with, NOT contains-anywhere (owner 2026-10-19): a mid-word substring must match nobody
  m.setSearch('nderson');
  assert.equal(memberRows(m.render()).length, 0, 'STARTS-WITH BROKEN: "nderson" (mid-word of Anderson) matched — the filter reverted to contains-anywhere');
  // @handle branch
  m.setSearch('bobby');
  assert.deepEqual(rowNames(m.render()), ['Bob Brown'], 'an @handle search did not find the member');
  // (e) NO-MATCH
  m.setSearch('zzzzz');
  assert.equal(memberRows(m.render()).length, 0, 'rows still shown for a no-match query');
  assert.match(reads(m.render()), /No members match/, 'no "No members match" line');
  // (c) tick Carl, filter him out, save keeps him as a leader
  m.setSearch('');
  m.tick('Carl Carter');
  m.setSearch('alice');                                  // Carl filtered OUT of view
  assert.deepEqual(rowNames(m.render()), ['Alice Anderson'], 'the view did not narrow while Carl was ticked');
  await m.save();
  assert.equal(m.published.length, 1, 'the leadership change was not saved');
  assert.ok((m.published[0].leaders || []).includes(CARL),
    'SELECTION DROPPED BY THE FILTER: Carl was ticked as a leader, then searched out of view, and the saved leader list left him out — ' + JSON.stringify(m.published[0].leaders));
  assert.equal(m.closed.length, 1, 'a successful save did not close the modal');
});
