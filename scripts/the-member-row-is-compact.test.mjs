// THE CONSOLE'S MEMBER ROW IS ONE LINE, WITH LESS ON IT.
//   Run: node --test scripts/the-member-row-is-compact.test.mjs
//
// Owner, 2026-10-13, from a screenshot: the row stacked an avatar/name/npub line over a strip of chips
// (JOINED, ANONYMOUS, Chat, Child, Clear for youth, Reconnect, Turn off photo) over "joined 5d ago · hasn't
// posted yet". Asked for: no JOINED / ANONYMOUS badge, no "joined … ago", no raw npub (except a short
// fragment when there is no name at all), "Photo" with a state toggle, and the controls up on the name's line.
// The owner then also dropped "hasn't posted yet".
//
// CLAUDE.md rule 3: nothing here matches text in app/*.jsx. DashMembers is compiled with the packaged build's
// esbuild and RENDERED through render-jsx-screen.mjs's miniature React, at a 1280px window (the wide row), and
// every claim is about the rendered tree. What this CANNOT see is layout; the height was measured in a real
// browser (see the commit) and is not asserted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts, flow } from './render-jsx-screen.mjs';

const NOW = Math.floor(Date.now() / 1000);
const PK = { glyph: 'e'.repeat(64), named: 'a'.repeat(64), handle: 'b'.repeat(64), anon: 'c'.repeat(64), anon2: 'd'.repeat(64) };
const NPUB = (pk) => 'npub1' + pk.slice(0, 58);
const MEMBERS = [
  { pubkey: PK.named, npub: NPUB(PK.named), name: 'Persephone Wilde', joined: NOW - 5 * 86400, count: 0, lastTs: 0, hasPhoto: true },
  { pubkey: PK.handle, npub: NPUB(PK.handle), name: 'Tobias Ashcroft', nip05: 'tobias@example.org', joined: NOW - 5 * 86400, count: 0, lastTs: 0, hasPhoto: true },
  // a real name that slugs to NOTHING (no ASCII letters), so there is no derived @handle either: the case where the old row printed the npub
  { pubkey: PK.glyph, npub: NPUB(PK.glyph), name: 'Мария Иванова', joined: NOW - 5 * 86400, count: 0, lastTs: 0 },
  { pubkey: PK.anon, npub: 'npub1wvm4xuf4c' + 'q'.repeat(40) + 'pwtur5', joined: NOW - 5 * 86400, count: 0, lastTs: 0 },
  { pubkey: PK.anon2, npub: 'npub1zzzzzzzzz' + 'k'.repeat(40) + 'abcdef', joined: NOW - 5 * 86400, count: 0, lastTs: 0 },
];

function renderLive({ nophoto = [], setNoPhoto = () => Promise.resolve(true), members = MEMBERS, minors = [], links = {}, delegated = false } = {}) {
  const { React, draw } = miniReact();
  const win = {
    // 1440, NOT 1280 (2026-10-14). Members now takes the phone card below 1366 — at 1280 the desktop row's
    // @handle was squeezed to 24.1px and to 0px by 1240, so the owner chose the one-line phone card for that
    // band. Every assertion in this file is about the DESKTOP row, so it is driven at a desktop width.
    // The phone card has its own coverage in console-phone-layout-batch-a.test.mjs and in
    // the-console-member-row-shows-the-whole-name.test.mjs, which measures it in a real browser at 1280.
    innerWidth: 1440,
    useStewardMembers: () => members,
    useStewardGroups: () => [], useStewardNetworks: () => [], useStewardCategories: () => [],
    useStewardRosters: () => ({}), useStewardChurch: () => ({ name: 'St X', features: {} }),
    useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors, approved: [], nophoto }),
    useStewardGuardians: () => ({ links, closed: {} }),
    usePendingJoins: () => [], usePendingGuardians: () => [],
    Steward: { pubkey: 'zzz', setNoPhoto, ...(delegated ? { actingChurch: 'c'.repeat(64) } : {}) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    localStorage: { getItem: () => null, setItem() {} },
  };
  const base = { React, Icon: () => null, window: win, localStorage: win.localStorage };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashMembers'], {
    ...base,
    SK_TINT: new Proxy({}, { get: () => ({ bg: '', fg: '' }) }),
    SkToggle: () => null, SkBadge: () => null, SkConfirm: () => null,
    SkPill: ({ children }) => React.createElement('span', { 'data-pill': '1' }, children),
    DismissibleNote: () => null, StewHelpLink: () => null,
    useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-13',
  });
  return () => draw(mod.DashMembers, {});
}
const render = (o) => renderLive(o)();

// Member cards: the column-flex, radius-13 divs that hold no other such card.
const isCard = (n) => n.type === 'div' && n.props && n.props.style && n.props.style.flexDirection === 'column' && n.props.style.borderRadius === 13;
const cards = (tree) => find(tree, isCard).filter(n => !find(n, c => c !== n && isCard(c)).length);
const rowText = (row) => flow(row).replace(/\s+/g, ' ').trim();
function rowOf(tree, name) {
  const hit = cards(tree).filter(n => rowText(n).includes(name));
  assert.equal(hit.length, 1, 'expected exactly one member row for ' + name + ', got ' + hit.length + ' of ' + cards(tree).length + ' cards');
  return hit[0];
}
const buttonsOf = (row) => find(row, n => n.type === 'button');
const labelOf = (b) => flow(b).replace(/\s+/g, ' ').trim() || b.props.title || '';   // the VISIBLE label (children only)

test('the badges and the joined-ago text are gone from the rendered row', () => {
  const tree = render();
  assert.equal(cards(tree).length, 5, 'the fixture should draw five member rows');
  for (const nm of ['Persephone Wilde', 'Tobias Ashcroft']) {
    const row = rowOf(tree, nm);
    const t = rowText(row);
    assert.ok(!/joined/i.test(t), nm + ': "joined" is still on the row: ' + t);
    assert.ok(!/anonymous/i.test(t), nm + ': "anonymous" is on a named member row: ' + t);
    assert.ok(!/posted yet/i.test(t), nm + ': "hasn\'t posted yet" is still on the row: ' + t);
    assert.ok(!/ ago/.test(t), nm + ': an "ago" is still on the row: ' + t);
    assert.deepEqual(find(row, n => n.props && n.props['data-pill']).filter(p => /joined|anonymous/i.test(texts(p).join(' '))), []);
  }
  for (const row of cards(tree).filter(r => /Anonymous/.test(rowText(r)))) {
    assert.ok(!/(joined|posted yet| ago)/i.test(rowText(row)), 'an anonymous row still carries joined/posted text: ' + rowText(row));
    // the name reads "Anonymous" once; an ANONYMOUS badge would make it twice
    assert.equal((rowText(row).match(/anonymous/gi) || []).length, 1, 'ANONYMOUS appears more than once: ' + rowText(row));
  }
});

test('a named member shows no raw npub; a member with a nicename shows @nicename', () => {
  const tree = render();
  const named = rowOf(tree, 'Persephone Wilde');
  assert.ok(!/npub1/.test(rowText(named)), 'a named member row still prints an npub: ' + rowText(named));
  const glyph = rowOf(tree, 'Мария Иванова');
  assert.ok(!/npub1/.test(rowText(glyph)), 'a named member with no @handle still prints an npub: ' + rowText(glyph));
  const handle = rowOf(tree, 'Tobias Ashcroft');
  assert.ok(/@tobias/.test(rowText(handle)), 'the nicename is not shown: ' + rowText(handle));
  assert.ok(!/npub1/.test(rowText(handle)), 'the nicename row still prints an npub: ' + rowText(handle));
});

test('two Anonymous members stay tellable apart: each keeps a SHORT npub fragment, not the whole key', () => {
  const rows = cards(render()).filter(r => /Anonymous/.test(rowText(r)));
  assert.equal(rows.length, 2, 'expected two Anonymous rows, got ' + rows.length);
  const frag = rows.map(r => (rowText(r).match(/npub1\S*/) || [''])[0]);
  assert.ok(frag.every(f => f.length > 8 && f.length < 30), 'the fragment is missing or is the full key: ' + JSON.stringify(frag));
  assert.notEqual(frag[0], frag[1], 'the two Anonymous rows are identical: ' + JSON.stringify(frag));
});

test('every action is still on the row: Chat, Child, Clear for youth, Reconnect, Photo, copy, Block', () => {
  const row = rowOf(render(), 'Persephone Wilde');
  const labels = buttonsOf(row).map(labelOf);
  for (const want of [/^Chat$/, /^Child$/, /^Clear for youth$/, /^Reconnect$/, /^Photo$/, /^Block$/]) {
    assert.ok(labels.some(l => want.test(l)), 'missing ' + want + ' among ' + JSON.stringify(labels));
  }
  assert.ok(buttonsOf(row).some(b => b.props.title === 'Copy npub'), 'the copy-npub control is gone');
});

test('the controls sit between the name and the copy / Block pair, which stays at the end', () => {
  const row = rowOf(render(), 'Persephone Wilde');
  // The declared flex order, as the browser applies it: the line's children sorted by `order` then DOM position.
  const line = find(row, n => n.type === 'div' && n.props.style && n.props.style.flexWrap === 'wrap' && (n.kids || []).length >= 3)[0];
  assert.ok(line, 'the one-row wrapper is gone');
  const kids = (line.kids || []).filter(k => k && typeof k === 'object');
  const visual = kids.map((k, i) => ({ i, o: (k.props && k.props.style && k.props.style.order) || 0, t: rowText(k) + ' ' + texts(k).join(' ') }))
    .sort((a, b) => a.o - b.o || a.i - b.i);
  const idx = (re) => visual.findIndex(v => re.test(v.t));
  assert.ok(idx(/Persephone/) >= 0 && idx(/Persephone/) < idx(/Chat/), 'the name must come before the controls');
  assert.ok(idx(/Chat/) < idx(/Block/), 'the controls must come before copy + Block');
  assert.equal(idx(/Block/), visual.length - 1, 'Block is not last on the row');
});

test('Photo is a switch that shows its state and calls the same handler', () => {
  const calls = [];
  const setNoPhoto = (list) => { calls.push(list); return Promise.resolve(true); };
  for (const [nophoto, checked, state] of [[[], 'true', 'on'], [[PK.named], 'false', 'off']]) {
    const row = rowOf(render({ nophoto, setNoPhoto }), 'Persephone Wilde');
    const sw = buttonsOf(row).find(b => /^Photo/.test(labelOf(b)));
    assert.ok(sw, 'no Photo control');
    assert.equal(sw.props.role, 'switch');
    assert.equal(sw.props['aria-checked'], checked, 'aria-checked does not reflect nophoto=' + JSON.stringify(nophoto));
    assert.equal(find(sw, n => n.props && n.props['data-switch'])[0].props['data-switch'], state);
    assert.ok(/^Photo\s*$/.test(flow(sw).replace(/\s+/g, ' ').trim()), 'the visible label is not just "Photo": ' + flow(sw));
    assert.ok(sw.props.title && sw.props.title.length > 40, 'the tooltip no longer explains what Photo does');
    sw.props.onClick();
  }
  assert.deepEqual(calls, [[PK.named], []], 'the toggle must call setNoPhoto: add when on, remove when off');
});

// ── a CHILD's parent controls are in More, not on the row (owner 2026-10-13: "Parent controls should be in another menu") ──
// The row is measured in a browser (the-member-row-is-one-line-on-the-console.test.mjs); this asserts, on the RENDERED tree
// and through the real click path, where the controls are and that they call the same handler.
const CHILD = PK.named, PARENT = PK.handle;
const childRow = (o) => rowOf(render({ minors: [CHILD], ...o }), 'Persephone Wilde');
const sheetOf = (tree) => find(tree, n => n.props && Array.isArray(n.props.actions) && n.props.actions.some(a => a.key === 'parent'))[0];

test('a child row carries no Link parent / Parents button and no guardian pill, only a More button', () => {
  for (const links of [{}, { [CHILD]: [PARENT] }]) {
    const row = childRow({ links });
    const labels = buttonsOf(row).map(labelOf);
    assert.ok(!labels.some(l => /^(Link parent|Parents)$/.test(l)), 'the parent button is still on the child row: ' + JSON.stringify(labels));
    assert.deepEqual(find(row, n => n.props && n.props['data-pill']).filter(p => /guardian|parent:/i.test(texts(p).join(' '))), [], 'a guardian pill is still on the child row');
    const more = buttonsOf(row).filter(b => /^More for /.test(b.props['aria-label'] || ''));
    assert.equal(more.length, 1, 'expected one More button on the child row: ' + JSON.stringify(buttonsOf(row).map(b => b.props['aria-label'] || labelOf(b))));
    assert.ok(labels.some(l => /^Chat$/.test(l)) && labels.some(l => /^Reconnect$/.test(l)), 'another control went missing: ' + JSON.stringify(labels));
  }
});

test('an adult row gets no More button (nothing in the sheet that the row does not already offer)', () => {
  const row = rowOf(render({ minors: [CHILD] }), 'Tobias Ashcroft');
  assert.deepEqual(buttonsOf(row).filter(b => /^More for /.test(b.props['aria-label'] || '')), []);
});

test('More opens the sheet; Link parent / Parents is in it and opens the guardian picker for THAT child; the header says the guardian state', () => {
  for (const [links, label, fact] of [[{}, 'Link parent', /no guardian/], [{ [CHILD]: [PARENT] }, 'Parents', /parent:\s+Tobias Ashcroft/]]) {
    const live = renderLive({ minors: [CHILD], links });
    let tree = live();
    assert.equal(sheetOf(tree), undefined, 'the sheet is open before More is pressed');
    buttonsOf(rowOf(tree, 'Persephone Wilde')).find(b => /^More for /.test(b.props['aria-label'] || '')).props.onClick();
    tree = live();
    const sheet = sheetOf(tree);
    assert.ok(sheet, 'More did not open the sheet with a parent action');
    const act = sheet.props.actions.find(a => a.key === 'parent');
    assert.equal(act.label, label);
    assert.ok(fact.test(sheet.props.facts.map(f => texts(f).join(' ')).join(' | ')), 'the sheet header does not state the guardian state: ' + sheet.props.facts.map(f => texts(f).join(' ')));
    assert.equal(find(tree, n => n.props && n.props.child === CHILD && n.props.onLink).length, 0, 'the picker was open before the action ran');
    act.onPick();
    const picker = find(live(), n => n.props && n.props.child === CHILD && typeof n.props.onLink === 'function');
    assert.equal(picker.length, 1, 'picking Link parent in More did not open the guardian picker for the child');
  }
});

test('a delegated steward (who cannot write guardians) is not offered the parent action in More', () => {
  const live = renderLive({ minors: [CHILD], delegated: true });
  let tree = live();
  const row = rowOf(tree, 'Persephone Wilde');
  assert.ok(!buttonsOf(row).map(labelOf).some(l => /^(Link parent|Parents)$/.test(l)));
  buttonsOf(row).find(b => /^More for /.test(b.props['aria-label'] || '')).props.onClick();
  tree = live();
  const sheet = find(tree, n => n.props && Array.isArray(n.props.actions))[0];
  assert.ok(sheet && !sheet.props.actions.some(a => a.key === 'parent'), 'a delegated steward is offered the parent action');
});

// THE NAME BLOCK'S FLOOR. Read off the RENDERED element, not the source (CLAUDE.md rule 3: app/*.jsx ships
// unbundled, so a `false && ` in front of a condition leaves every word of it in place and a text match still
// passes). What this cannot see is layout, so the rendered WIDTH of the name and the ellipsis are measured in
// a browser by the-console-member-row-shows-the-whole-name.test.mjs; this is the cheap guard that fails in
// two seconds if the floor is taken out again. At a 90px basis the block measured 104.5px of a 620px column
// at 1280x900 and "Persephone Wilde" ellipsised with the @handle at 0px beside it.
test('the name block is rendered with a 150px floor, not the 90px basis that truncated every name', () => {
  const tree = render();
  for (const nm of ['Persephone Wilde', 'Tobias Ashcroft']) {
    const row = rowOf(tree, nm);
    const blocks = find(row, n => n.type === 'div' && n.props && n.props.style && typeof n.props.style.flex === 'string' && /^1 1 \d+(\.\d+)?px$/.test(n.props.style.flex));
    assert.equal(blocks.length, 1, nm + ': expected exactly one flex-basis block on the row (the name block), got ' + blocks.length);
    const st = blocks[0].props.style;
    const basis = parseFloat(String(st.flex).split(' ')[2]);
    assert.ok(basis >= 150, nm + ": the name block's flex-basis is " + basis + 'px. Flex line-breaking uses the hypothetical size, so at 90px all four blocks fit one line and the name is handed what the controls leave - 104.5px of 620px, ellipsised (measured 2026-10-13)');
    assert.ok(Number(st.minWidth) >= 150, nm + ": the name block's minWidth is " + JSON.stringify(st.minWidth) + ' - the floor is not guaranteed once the line is full');
  }
});
