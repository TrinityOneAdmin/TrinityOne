// THE SETTINGS GROUPS COLLAPSE, THE CHOICE IS REMEMBERED, AND NOTHING CAN HIDE THE PAGE YOU ARE ON.
// Run: node --test scripts/settings-groups-collapse-and-are-remembered.test.mjs
//
// Owner, 2026-09-09: *"can we make the groups collapsable? Church, People, Infra, Security, that will help
// tidy it up."* Sixteen pages in one column is a lot to scan and most stewards live in one or two groups.
//
// THE FAULT THIS FILE EXISTS FOR is the one the alias collision already demonstrated on this branch: a page
// that exists and cannot be reached. A collapsed group is a second way to produce it, and a worse one,
// because it can happen to a page that is ON SCREEN — deep-link into a collapsed group, or reload while a
// page inside one is open, and the steward is looking at a page with no row in the list leading back to it,
// no error, and nothing to suggest the list is not the whole list. So the invariant is checked at RENDER
// time and not only on mount: `open` falls back to the first page when an identity switch takes pages away,
// and that fallback can land inside a collapsed group too.
//
// WHAT MAY COLLAPSE, exactly: groups. Not a page, not a card, and above all not the sentence under a switch —
// rule 5 of reference/DECISION-SETTINGS-LIST-AND-DETAIL-2026-09-09.md. A whole rarely-opened page may be a
// click away; the consequence text beside a control may not. That rule is asserted here too, because "make
// it tidier" is exactly the request under which such a sentence gets folded away.
//
// CLAUDE.md rule 3: app/stew-dashboard.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves
// every word of it in place and a text-matching assertion still passes. Nothing here matches text in
// app/*.jsx. The REAL DashSettings is rendered through the miniature React in scripts/render-jsx-screen.mjs,
// against a REAL storage object whose contents are read back and asserted on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const JS = compileScreen('app/stew-dashboard.jsx');

const CHURCH = 'churchpub0000000000000000000000000000000000000000000000000000000';
const OWNER = CHURCH;                       // an owner signs as the church itself
const DELEGATE = 'delegatepub00000000000000000000000000000000000000000000000000000';

// One console. `store` is a real Map the test reads back, so "remembered" is a fact about storage and not
// about a component that happened to keep its state.
function consoleWith(React, over = {}) {
  const store = over.store || new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const win = {
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    usePendingStewards: () => [],
    Steward: {
      isDelegated: () => !!over.delegated, hasKey: true, hasPinLock: () => false,
      whereChurchLives: () => 'community',
      churchPub: over.churchPub || CHURCH,
      actingChurch: over.actingChurch || '',
      pubkey: over.pubkey || OWNER,
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'x', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC', joinCode: () => 'ABC',
      ownRelay: () => 'wss://relay.grace.example/relay',
      backupState: async () => ({ boxes: 1, online: 1, syncOn: false }),
      addRelay: () => '', removeRelay: () => {}, rememberRelayName: () => {},
      selfRegister: async () => ({}),
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    innerWidth: over.innerWidth || 1200,
    localStorage,
  };
  const globals = {
    React, window: win,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' },
    navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; },
    Halo: function Halo() { return null; },
    SkBadge: function SkBadge() { return null; },
    SkKey: function SkKey() { return null; },
    SkQR: function SkQR() { return null; },
    SkPill: function SkPill() { return null; },
    SK_TINT: { clay: {}, sage: {}, gold: {}, ink: {} },
    DashMealsPanel: function DashMealsPanel() { return null; },
    DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; },
    NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    DismissibleNote: function DismissibleNote(p) { return p.children; },
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    StewHelpButton: function StewHelpButton() { return null; },
    WizMeetings: function WizMeetings() { return null; },
    _wizMeetingId: () => 'evt1',
    useStewDialog: () => ({ current: null }),
    churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const want = ['DashSettings', 'SETTINGS_GROUPS', 'settingsGroupsLsKey', 'readCollapsedGroups',
    'writeCollapsedGroups', 'settingsGroupOf'];
  const mod = new Function(...names, JS + '\nreturn { ' + want.join(', ') + ' };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashSettings, 'function', 'DashSettings is not a component any more — re-anchor this test');
  assert.equal(typeof mod.settingsGroupsLsKey, 'function', 'settingsGroupsLsKey is gone — re-anchor this test');
  return { mod, store, win };
}

// A settings screen, drawn. `mount()` draws it fresh; the returned `draw` re-draws the SAME instance.
function screen(pageKey, over = {}) {
  const { React, draw } = miniReact();
  const c = consoleWith(React, over);
  const render = () => draw(c.mod.DashSettings, { initialSection: pageKey, onSectionConsumed() {} });
  render();
  return { ...c, render, tree: render() };
}

const nav = (tree) => find(tree, n => n.type === 'nav' && n.props['aria-label'] === 'Settings pages')[0];
const headers = (tree) => find(tree, n => n.type === 'button' && /(^| )set-grp( |$)/.test(String((n.props || {}).className || '')));
// The name a control SHOWS, read off its label span's own children. texts() collects string props too, so it
// would fold the class name into every comparison.
const shownIn = (node, cls) => {
  const hit = find(node, n => new RegExp('(^| )' + cls + '( |$)').test(String((n.props || {}).className || '')));
  return hit.length ? (hit[0].kids || []).join('') : '';
};
const grpName = (h) => shownIn(h, 'set-grp-n');
const header = (tree, name) => headers(tree).find(b => grpName(b) === name);
const rows = (tree) => find(tree, n => n.type === 'button' && /(^| )set-item( |$)/.test(String((n.props || {}).className || '')));
const rowNames = (tree) => rows(tree).map(b => shownIn(b, 'set-item-n'));
const region = (tree) => find(tree, n => n.type === 'section' && n.props['aria-label']);
const GROUPS = ['Church', 'People', 'Infrastructure', 'Security'];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTROL — if this fails, every assertion below is meaningless.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the list renders four group headers, all open, with every page under them', () => {
  const s = screen(null);
  assert.deepEqual(headers(s.tree).map(grpName), GROUPS,
    'the four group headers are not the four groups — re-anchor this test');
  assert.equal(rows(s.tree).length, 16, `expected 16 page rows with nothing collapsed, found ${rows(s.tree).length}`);
});

test('a steward who has never chosen gets every group OPEN, on the phone as well as in a browser', () => {
  // THE DECISION, PINNED. A phone is where sixteen rows in a column is worst, so starting collapsed there was
  // the obvious move and is NOT what this does. Two reasons:
  //   · the phone list is the layout the owner has approved twice, and rule 2 of the decision note says it
  //     must not change. Replacing its first screen with four words is a change to it, and nobody asked for
  //     one — the ask was for groups that CAN collapse, "that will help tidy it up";
  //   · a first screen showing four words and nothing else asks a steward who does not yet know the product
  //     to guess where a setting lives. This project's defaults lean open.
  // The preference is remembered on the phone too, so a steward who wants it tidy collapses once and it
  // stays. If the owner would rather the phone started shut, that is this test plus one default.
  for (const [what, innerWidth] of [['a browser', 1200], ['a phone', 500]]) {
    const s = screen(null, { innerWidth });
    assert.deepEqual(headers(s.tree).map(b => b.props['aria-expanded']), [true, true, true, true],
      `on ${what}, a steward who has never collapsed anything does not get all four groups open`);
  }
  // …and "never chosen" is stored as nothing at all, so a later default can tell a fresh console from a
  // deliberate one without asking again.
  const fresh = screen(null);
  assert.equal(fresh.store.size, 0,
    'merely opening Settings writes a collapsed-groups preference. Then nothing can ever tell a steward who ' +
    'chose "all open" from one who has never touched it');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. A GROUP COLLAPSES, AND AN OPEN ONE SHOWS ITS PAGES.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('collapsing a group hides its pages and nothing else; opening it brings them back', () => {
  const s = screen('identity');                       // the open page is in Church, so Infrastructure is free
  const before = rowNames(s.tree);
  assert.ok(before.includes('Relays') && before.includes('Add a relay'), 're-anchor: Infrastructure is not listed');

  header(s.tree, 'Infrastructure').props.onClick();
  const after = rowNames(s.render());
  assert.equal(after.includes('Relays'), false, 'collapsing Infrastructure left its pages in the list');
  assert.deepEqual(after, before.filter(n => !['Relays', 'Add a relay', 'Move or copy history', 'Run your own box', 'Network'].includes(n)),
    'collapsing Infrastructure changed which OTHER pages are listed. A group collapses its own pages and no others');
  // the header itself is still there, or the group could never be opened again
  assert.ok(header(s.render(), 'Infrastructure'), 'the collapsed group’s header vanished with its pages');

  header(s.render(), 'Infrastructure').props.onClick();
  assert.deepEqual(rowNames(s.render()), before, 'opening the group again did not bring its pages back');
});

test('a collapsed group says how many pages are behind it', () => {
  const s = screen('identity');
  header(s.tree, 'Infrastructure').props.onClick();
  const h = header(s.render(), 'Infrastructure');
  assert.equal(shownIn(h, 'set-grp-c'), '5',
    'a shut group does not say how many pages are inside it, so it is a word with nothing to tell a steward ' +
    'whether it is worth opening');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. THE CHOICE IS REMEMBERED — in storage, and keyed so it cannot reach another church or another identity.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the choice survives a remount, read back from storage and not from a component that kept it', () => {
  const store = new Map();
  const first = screen('identity', { store });
  header(first.tree, 'People').props.onClick();
  header(first.render(), 'Infrastructure').props.onClick();

  const keys = [...store.keys()];
  assert.equal(keys.length, 1, `expected one stored preference, found ${keys.length}: ${keys.join(', ')}`);
  assert.deepEqual(JSON.parse(store.get(keys[0])).sort(), ['Infrastructure', 'People'],
    'the collapsed groups were not written to storage as the names of the groups');

  // a genuinely new mount, sharing only the storage
  const second = screen('identity', { store });
  const names = rowNames(second.tree);
  assert.equal(names.includes('Relays'), false, 'Infrastructure came back open — the choice was not remembered');
  assert.equal(names.includes('Chat message tags'), false, 'People came back open — the choice was not remembered');
  assert.ok(names.includes('Church identity'), 'a group nobody collapsed came back shut');
  assert.deepEqual(headers(second.tree).map(b => b.props['aria-expanded']), [true, false, false, true],
    'the restored headers do not say which groups are shut');
});

test('the key names the church AND the identity, so neither can read the other’s preference', () => {
  const key = (over) => consoleWith(miniReact().React, over).mod.settingsGroupsLsKey();
  const ours = key({});
  assert.match(ours, /^trinityone\.steward\.setgroups\./,
    'the preference is stored under an unnamespaced key: ' + ours);
  assert.ok(ours.includes(CHURCH), 'the key does not name the church, so two churches on one console share one preference');

  const otherChurch = key({ churchPub: 'otherchurch000000000000000000000000000000000000000000000000000000' });
  assert.notEqual(ours, otherChurch, 'a second church reads the first church’s collapsed groups');

  // a delegated steward of the SAME church has a genuinely different list — the four owner-only Security
  // pages are not theirs — so "Security collapsed" does not mean the same thing to both.
  const asDelegate = key({ delegated: true, actingChurch: CHURCH, pubkey: DELEGATE });
  assert.notEqual(ours, asDelegate, 'a delegated steward and the owner share one collapsed-groups preference');
  assert.ok(asDelegate.includes(CHURCH), 'a delegate’s key does not name the church they are acting for');

  // and a delegate is keyed by the church they act for, not by whatever churchPub happens to be on the box
  const elsewhere = key({ delegated: true, actingChurch: CHURCH, pubkey: DELEGATE, churchPub: 'unused' });
  assert.equal(asDelegate, elsewhere,
    'a delegate’s key changes with a field that is not the church they are acting for');
});

test('storage that throws, or holds rubbish, leaves every group open rather than blank', () => {
  // localStorage throws in a private window and in a thumbnailer; a settings list that renders nothing there
  // is a worse outcome than one that forgets a preference.
  for (const bad of ['not json', '{"Church":true}', '[1,2,3]', 'null']) {
    const store = new Map();
    const s = screen('identity', { store });
    store.set([...s.store.keys()][0] || s.mod.settingsGroupsLsKey(), bad);
    const again = screen('identity', { store });
    assert.equal(rows(again.tree).length, 16,
      `a stored value of ${bad} did not leave every group open — it rendered ${rows(again.tree).length} rows`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. NOTHING CAN HIDE THE PAGE YOU ARE ON. The fault this file exists for.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a deep link into a collapsed group opens that group', () => {
  const store = new Map();
  const seed = screen('identity', { store });
  header(seed.tree, 'Security').props.onClick();               // Security is shut, and stored shut

  // …and now something deep-links straight into it. Overview's steward-requests banner does exactly this.
  const s = screen('delegated', { store });
  assert.equal(region(s.tree)[0].props['aria-label'], 'Delegated stewards', 're-anchor: the deep link did not land');
  assert.ok(rowNames(s.tree).includes('Delegated stewards'),
    'the deep link opened a page inside a collapsed group and left its row hidden. The steward is looking at ' +
    'a page with no row in the list leading back to it, no error, and nothing to say the list is partial');
  assert.equal(header(s.tree, 'Security').props['aria-expanded'], true,
    'the group holding the open page says it is shut while its pages are on screen');
  // the OTHER groups the steward shut stay shut — opening one is not a reason to forget the rest
  assert.equal(JSON.parse(store.get([...store.keys()][0])).includes('Security'), true,
    'landing on a page inside a collapsed group erased the steward’s stored choice as a side effect');
});

test('a reload while a page in a collapsed group is open shows that group, however it was stored', () => {
  // The stored value is written by hand here: this is the state a console comes back to after a reload, and
  // it must not depend on which control put it there.
  const store = new Map();
  const probe = consoleWith(miniReact().React, { store });
  store.set(probe.mod.settingsGroupsLsKey(), JSON.stringify(GROUPS));   // every group shut
  for (const [page, group] of [['identity', 'Church'], ['rules', 'People'], ['relays', 'Infrastructure'], ['key', 'Security']]) {
    const s = screen(page, { store });
    assert.equal(header(s.tree, group).props['aria-expanded'], true,
      `every group is stored shut and the console reopened on ${page}; ${group} did not open to show it`);
    assert.equal(rows(s.tree).some(b => b.props['aria-current'] === 'page'), true,
      `the open page ${page} has no row in the list, so there is no way back to it`);
    // and it is the ONLY group forced open — the preference is honoured everywhere else
    assert.deepEqual(headers(s.tree).filter(b => b.props['aria-expanded']).map(grpName),
      [group], `opening ${page} opened more than its own group`);
  }
});

test('on a phone, where no page is open beside the list, a collapsed group really is collapsed', () => {
  // useStewNarrow is declared in app/stew-dashboard.jsx, so it is the window width that decides, not a stub.
  const store = new Map();
  const seed = screen(null, { store, innerWidth: 500 });   // no deep link: the phone's own first screen
  assert.equal(region(seed.tree).length, 0, 're-anchor: a page is open on the phone’s first screen');
  header(seed.tree, 'Church').props.onClick();
  const names = rowNames(seed.render());
  assert.equal(names.includes('Church identity'), false,
    'nothing is open on the phone’s list screen, so no group is the "current" one and Church should shut ' +
    'like any other');
  assert.ok(names.includes('Relays'), 'collapsing Church on the phone took another group with it');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. IT IS A DISCLOSURE, AND IT IS REACHABLE BY KEYBOARD.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('each group header is a real button that says whether it is open', () => {
  const s = screen('identity');
  for (const h of headers(s.tree)) {
    assert.equal(h.type, 'button',
      'a group header is a <' + h.type + '>. aria-expanded on a div is not a control: it cannot be tabbed to ' +
      'and Enter does nothing');
    assert.equal(typeof h.props['aria-expanded'], 'boolean',
      'a group header does not say whether it is expanded, so a screen reader announces a button with no state');
    assert.equal(typeof h.props.onClick, 'function', 'a group header does not respond to a press');
    assert.notEqual(h.props.tabIndex, -1, 'a group header is out of the Tab order');
  }
  header(s.tree, 'People').props.onClick();
  assert.equal(header(s.render(), 'People').props['aria-expanded'], false,
    'pressing a group header did not change what it says about itself');
});

test('a shut group’s list is not left behind pointing at nothing', () => {
  const s = screen('identity');
  const listFor = (t, g) => find(nav(t), n => n.type === 'ul' && n.props['aria-labelledby'] === header(t, g).props.id);
  assert.equal(listFor(s.tree, 'People').length, 1, 're-anchor: the People list is not labelled by its header');
  header(s.tree, 'People').props.onClick();
  assert.equal(listFor(s.render(), 'People').length, 0,
    'a shut group still renders its list. Either its rows are reachable when they should not be, or it is an ' +
    'empty list a reader announces as "list, 0 items"');
  // every list still on the page names a header that is also still on the page
  for (const ul of find(nav(s.render()), n => n.type === 'ul')) {
    assert.equal(find(nav(s.render()), n => n.props && n.props.id === ul.props['aria-labelledby']).length, 1,
      'a group list points at an id that is not on the page — a dangling reference a reader cannot follow');
  }
});

// THE ARROW WALK, WITH SOMETHING TO WATCH. miniReact never touches the DOM, so a ref callback is not called
// for us and navRefs stays empty — a test that only presses keys can watch nothing and passes whatever the
// arithmetic does. So the rendered rows' OWN ref callbacks are invoked here with a sentinel that knows which
// page it belongs to, exactly as a browser would populate them, and then the component's own handler decides
// which one to focus.
//
// This is the difference the test exists for: index the walk over all sixteen pages instead of the rows on
// screen and the slots belonging to a shut group are never filled, so ArrowDown at that group's boundary
// reaches an empty slot, `el && el.focus` declines, and the arrow keys stop dead in the middle of the list
// with nothing on screen to say why.
function walkable(s) {
  const t = s.render();
  const seen = [];
  const rs = rows(t);
  rs.forEach((b) => {
    const name = shownIn(b, 'set-item-n');
    b.props.ref({ focus() { seen.push(name); } });     // the component writes this into its own navRefs
  });
  return { rows: rs, names: rs.map(b => shownIn(b, 'set-item-n')), seen };
}

test('the arrow keys move focus over the rows on screen, never into a shut group’s empty slots', () => {
  const s = screen('identity');
  header(s.tree, 'People').props.onClick();          // People shuts; Church holds the open page and stays
  const w = walkable(s);
  assert.equal(w.rows.length, 16 - 3, `expected the three People rows to be gone, found ${w.rows.length} rows`);
  assert.equal(w.names.includes('Congregation features'), false, 're-anchor: People is still listed');

  // THE BOUNDARY PRESS. The row after Church's last is the first row of the next group ON SCREEN.
  const lastOfChurch = w.names.lastIndexOf('Backup & data');
  assert.notEqual(lastOfChurch, -1, 're-anchor: Backup & data is not the last Church row');
  w.rows[lastOfChurch].props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  assert.deepEqual(w.seen, ['Relays'],
    'ArrowDown at the edge of a shut group focused ' + JSON.stringify(w.seen) + ' instead of the next row on ' +
    'screen. An empty result means the walk is indexed over all sixteen pages: the slots behind a shut group ' +
    'are never filled, so the arrow keys stop dead there and nothing says why');

  // Home and End reach the two ends of what is VISIBLE, not of the full list
  const w2 = walkable(s);
  w2.rows[0].props.onKeyDown({ key: 'End', preventDefault() {} });
  w2.rows[0].props.onKeyDown({ key: 'Home', preventDefault() {} });
  assert.deepEqual(w2.seen, [w2.names[w2.names.length - 1], w2.names[0]],
    'End and Home do not reach the last and first rows on screen; they reached ' + JSON.stringify(w2.seen));

  // …and wrapping goes round the visible list, not into the hidden part of it
  const w3 = walkable(s);
  w3.rows[w3.rows.length - 1].props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  w3.rows[0].props.onKeyDown({ key: 'ArrowUp', preventDefault() {} });
  assert.deepEqual(w3.seen, [w3.names[0], w3.names[w3.names.length - 1]],
    'the walk does not wrap round the rows on screen; it reached ' + JSON.stringify(w3.seen));

  let prevented = 0;
  for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    w.rows[0].props.onKeyDown({ key: k, preventDefault() { prevented++; } });
  }
  assert.equal(prevented, 4, 'the list no longer handles the arrow keys');
  let swallowed = false;
  w.rows[0].props.onKeyDown({ key: 'Tab', preventDefault() { swallowed = true; } });
  assert.equal(swallowed, false, 'the list swallows Tab, so keyboard users cannot leave it');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 5. GROUPS COLLAPSE. NOTHING ELSE DOES.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the pages themselves do not collapse, and the words under a switch stay put', () => {
  // Rule 5 of the decision note: a whole rarely-opened page may be a click away; the sentence under a control
  // may not. "Make it tidier" is precisely the request under which such a sentence gets folded away.
  const s = screen('rules');
  const page = region(s.tree)[0];
  // EVERY SWITCH ROW STILL CARRIES ITS SENTENCE. Asserted structurally rather than by naming one arm of one
  // sentence: which arm renders depends on how the church has the switch set, and a test that names one arm
  // passes for the wrong reason the moment a default changes.
  const switchRows = find(page, n => /(^| )set-row( |$)/.test(String((n.props || {}).className || '')));
  assert.ok(switchRows.length >= 4, `expected the Rules & privacy switches, found ${switchRows.length} rows`);
  for (const row of switchRows) {
    const desc = shownIn(row, 'set-desc');
    assert.ok(desc && desc.length > 20,
      'a switch on this page has no consequence sentence beside it any more (row: ' +
      texts(row).join(' ').slice(0, 60) + '…). Groups collapse; the words telling a steward what a switch ' +
      'does to their church do not — rule 5 of the decision note');
  }
  const said = texts(page).join(' | ');
  assert.match(said, /Recommended for safeguarding/,
    'the safeguarding note under children’s photos is gone from the page');
  // and no control on a page carries the disclosure the GROUPS use
  assert.equal(find(region(s.tree)[0], n => n.props && 'aria-expanded' in n.props).length, 0,
    'something on the page itself has become a disclosure. Only the groups in the list may collapse');
});

test('every page is still reachable once its group is opened — collapsing hides, it does not remove', () => {
  const store = new Map();
  const probe = consoleWith(miniReact().React, { store });
  store.set(probe.mod.settingsGroupsLsKey(), JSON.stringify(GROUPS));   // everything shut
  const s = screen(null, { store, innerWidth: 500 });                    // the phone's list, nothing open
  assert.equal(rows(s.tree).length, 0, 're-anchor: rows are showing with every group shut and no page open');
  const reached = [];
  for (const g of GROUPS) {
    header(s.render(), g).props.onClick();
    reached.push(...rowNames(s.render()).filter(n => !reached.includes(n)));
    header(s.render(), g).props.onClick();
  }
  assert.equal(reached.length, 16,
    `opening each group in turn reached ${reached.length} of the 16 pages. A page that no group reveals is a ` +
    'page nothing can open');
});
