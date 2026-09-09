// EVERY SETTINGS PAGE IS REACHABLE, HOLDS EXACTLY ONE SUBJECT, AND NO PANEL IS ORPHANED.
// Run: node --test scripts/settings-pages-are-a-list-and-a-detail.test.mjs
//
// 2026-09-09 replaced the four Settings tabs (Church / Features / Network & relays / Security) with a list of
// pages and one page at a time — reference/DECISION-SETTINGS-LIST-AND-DETAIL-2026-09-09.md — and split the
// Relays card, measured at over 1000px doing eight jobs, into five pages of its own.
//
// THE FAILURE THIS FILE EXISTS FOR IS SILENT. Moving fifteen panels off four tabs and onto sixteen pages is
// fifteen chances to drop one: a card left off every page simply never renders, and nothing on screen, in the
// console, or in any other test says so — the page it should have been on looks finished. A card put on TWO
// pages is the same shape of mistake in reverse, and on the two that share a component (Congregation features
// and Rules & privacy both come out of DashFeaturesPanel) it is the likely one.
//
// So the test is exhaustive rather than a spot check: it walks SETTINGS_GROUPS — the real array the real
// navigation is built from — opens every page in it, and reconciles the panels it finds against the complete
// list of panels that existed BEFORE the change. Every one must appear, and appear once.
//
// CLAUDE.md rule 3: app/stew-dashboard.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves
// every word of it in place and a text-matching assertion still passes. Nothing here matches text in
// app/*.jsx. The screen is compiled with the same esbuild the build uses, the REAL DashSettings and the REAL
// Panel are rendered through the miniature React in scripts/render-jsx-screen.mjs, and every assertion reads
// the tree that comes back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

const JS = compileScreen('app/stew-dashboard.jsx');

// Everything app/stew-dashboard.jsx takes from OUTSIDE itself. A name it needs that is not here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends up
// asserting about something that is not the code. Every settings component under test is the real one; the
// stubs are furniture from other app files and the browser.
function consoleWith(React, over = {}) {
  const store = new Map(over.storage || []);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const win = {
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => (over.relays || []), useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    usePendingStewards: () => (over.pendingStewards || []),
    Steward: {
      isDelegated: () => !!over.delegated, hasKey: true, hasPinLock: () => false,
      whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'steward-invite-payload', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
      // a fixed destination, so "Copy your history to <relay>" has a title this test can name
      ownRelay: () => 'wss://relay.grace.example/relay',
      backupState: async () => ({ boxes: 1, online: 1, syncOn: false }),
      addRelay: () => '', removeRelay: () => {}, rememberRelayName: () => {},
      selfRegister: async () => ({}),
      ...(over.steward || {}),
    },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return true; },
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
    SK_TINT: { clay: { bg: 'var(--clay-soft)', fg: 'var(--clay-ink)' }, sage: { bg: 'var(--sage-soft)', fg: 'var(--sage-ink)' }, gold: { bg: 'var(--gold-tint)', fg: '#8a6717' }, ink: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
    DashMealsPanel: function DashMealsPanel() { return null; },
    DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; },
    NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    DismissibleNote: function DismissibleNote(p) { return p.children; },
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    StewHelpButton: function StewHelpButton() { return null; },
    WizMeetings: function WizMeetings() { return null; },
    _wizMeetingId: () => 'evt1',   // app/stew-console.jsx; the setup wizard's meetings editor reaches for it
    useStewDialog: () => ({ current: null }),
    churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const want = ['DashSettings', 'DashOverview', 'StewSetupWizard', 'StewDashboard', 'Panel', 'SETTINGS_GROUPS', 'SETTINGS_PAGE_ALIASES'];
  const mod = new Function(...names, JS + '\nreturn { ' + want.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of want.slice(0, 5)) {
    assert.equal(typeof mod[n], 'function', `${n} is not a component any more — re-anchor this test`);
  }
  assert.ok(Array.isArray(mod.SETTINGS_GROUPS), 'SETTINGS_GROUPS is not the array the navigation is built from — re-anchor this test');
  return mod;
}

// Draw one settings page and hand back the tree, the drawer, and the page catalogue.
function settings(pageKey, over = {}) {
  const { React, draw } = miniReact();
  const mod = consoleWith(React, over);
  const render = () => draw(mod.DashSettings, { initialSection: pageKey, onSectionConsumed() {} });
  render();                                    // the first draw queues the effects…
  return { mod, render, tree: render() };      // …the second sees what they loaded
}

// EVERY CARD ON THE PAGE, read off the rendered tree as "which Panel was mounted, with which title" — never
// its text, which is what rule 3 forbids. Panel is the one place a card's title becomes a heading, so a card
// that is not a Panel is not a card.
const cardsOn = (tree) => find(tree, n => typeof n.type === 'function' && n.type.name === 'Panel')
  .map(n => String(n.props.title));

// The page region the detail is rendered into, and the rows of the list.
const region = (tree) => find(tree, n => n.type === 'section' && n.props['aria-label']);
const rows = (tree) => find(tree, n => n.type === 'button' && /(^| )set-item( |$)/.test(String((n.props || {}).className || '')));
const openRow = (tree) => rows(tree).find(b => b.props['aria-current'] === 'page');

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTROL — if this fails, every assertion below is meaningless.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the real DashSettings renders a list of pages and one page beside it', () => {
  const s = settings(null);
  assert.ok(rows(s.tree).length >= 15, `the settings list rendered ${rows(s.tree).length} rows`);
  assert.equal(region(s.tree).length, 1, 'no page is open beside the list in a browser');
  assert.deepEqual(cardsOn(settings('relays').tree), ['Relays'],
    'the Relays page no longer renders the Relays card — re-anchor this test');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. EVERY PAGE IN THE LIST IS REACHABLE, AND RENDERS A BODY OF ITS OWN.
//    Walked from SETTINGS_GROUPS itself, so a page added to the navigation without a body fails here rather
//    than opening blank — which is how a list-and-detail fails, and it fails looking finished.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function catalogue(over = {}) {
  const { React } = miniReact();
  const mod = consoleWith(React, over);
  const visible = mod.SETTINGS_GROUPS
    .map(([g, items]) => [g, items.filter(p => (over.delegated ? !p.owner : !p.delegate))])
    .filter(([, items]) => items.length);
  return { groups: visible, pages: visible.reduce((a, [, items]) => a.concat(items), []), aliases: mod.SETTINGS_PAGE_ALIASES };
}

test('the list is grouped the way the mockup groups it', () => {
  assert.deepEqual(catalogue().groups.map(([g]) => g), ['Church', 'People', 'Infrastructure', 'Security'],
    'the settings groups are not Church / People / Infrastructure / Security. Those four are the grouping the ' +
    'owner agreed from reference/mockups/settings-list-detail.html');
});

for (const p of catalogue().pages) {
  test(`the ${p.k} page is reachable, and renders at least one card of its own`, () => {
    const s = settings(p.k);
    const open = openRow(s.tree);
    assert.ok(open, `opening the ${p.k} page marked no row in the list as the open one`);
    const r = region(s.tree);
    assert.equal(r.length, 1, `the ${p.k} page rendered no detail region`);
    assert.equal(r[0].props['aria-label'], p.n,
      `the ${p.k} page's region is named "${r[0].props['aria-label']}" and the list calls it "${p.n}"`);
    const cards = cardsOn(s.tree);
    assert.ok(cards.length >= 1,
      `the ${p.k} page ("${p.n}") is in the list and renders NO card. A page with no body is the way this ` +
      'layout fails: the list looks complete and the page opens empty');
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. NO PANEL IS ORPHANED, AND NONE IS ON TWO PAGES.
//    The reconciliation. WAS_ON_A_TAB is every panel Settings rendered before the change; SPLIT_OUT is what
//    the Relays card became. Both lists together must be exactly the set of panels the sixteen pages render,
//    with nothing left over on either side.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const WAS_ON_A_TAB = [
  // Church tab
  'Church identity', 'Church branding', 'Video & audio', 'Backup & data',
  // Features tab
  'Congregation features', 'Rules & privacy', 'Chat message tags',
  // Network & relays tab
  'Network', 'Run your own relay box', 'Relays',
  // Security tab, owner
  'Church key', 'Stewards & handoff', 'Delegated stewards', 'Become a steward',
];
// What the Relays card's other seven jobs became. "A relay is refusing our posts" is deliberately NOT here:
// it is a fault, not a page, and it stays a banner on Relays — see the refusal test in
// scripts/relay-refusal-banner-and-retry-stay-together.test.mjs.
const SPLIT_OUT = ['Add a relay', 'Copy your history to relay.grace.example', 'Keep your relays in sync'];

test('every panel that was on a tab is now on exactly one page, and nothing is left over', () => {
  const seen = new Map();   // panel title -> [pages it appears on]
  for (const p of catalogue().pages) {
    for (const title of cardsOn(settings(p.k).tree)) {
      if (!seen.has(title)) seen.set(title, []);
      seen.get(title).push(p.k);
    }
  }
  const want = [...WAS_ON_A_TAB, ...SPLIT_OUT].sort();
  const got = [...seen.keys()].sort();

  const orphaned = want.filter(t => !seen.has(t));
  assert.deepEqual(orphaned, [],
    'these panels are on NO page: ' + orphaned.join(', ') + '. Each of them was on a Settings tab before ' +
    '2026-09-09 and a steward could reach it. A panel left off every page does not error, does not warn and ' +
    'does not appear — the page it belonged on simply looks finished without it.');

  const twice = [...seen.entries()].filter(([, on]) => on.length > 1);
  assert.deepEqual(twice, [],
    'these panels are on more than one page: ' + twice.map(([t, on]) => `${t} (${on.join(', ')})`).join('; ') +
    '. One card, one job, one page — two copies of a switch are two places to change it and one of them is ' +
    'always the stale one.');

  assert.deepEqual(got, want,
    'the set of panels across every settings page is not the set this change set out to place. Anything in ' +
    '`got` and not in `want` is a card nobody accounted for; add it to WAS_ON_A_TAB or SPLIT_OUT only after ' +
    'checking it is meant to be there.');
});

test('a delegated steward gets the one page they are allowed, and none of the owner-only ones', () => {
  const cat = catalogue({ delegated: true });
  assert.deepEqual(cat.groups.find(([g]) => g === 'Security')[1].map(p => p.k), ['access'],
    'a delegated steward’s Security group is not the single notice page. The church key, the handoff, the ' +
    'steward roster and the blocklist belong to whoever holds the key, and the relay enforces that — a ' +
    'delegate pressing those controls gets a failed publish and no explanation');
  assert.deepEqual(cardsOn(settings('access', { delegated: true }).tree), ['Security'],
    'the delegate’s notice page does not render the notice');
  for (const k of ['key', 'stewards', 'delegated', 'become']) {
    assert.equal(cat.pages.some(p => p.k === k), false, `the owner-only ${k} page is in a delegate’s list`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. POSITIONS ARE AUTHORED, NEVER COMPUTED — the rule the old .sk-cols test protected, carried forward.
//    The cards on a page are the ones written into that page, in that order, as DIRECT children of the page.
//    Nothing between them may decide where they sit.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the cards on a page are its own direct children, in the order they are written', () => {
  // "Move or copy history" is the only page with two cards, so it is the only one where an order exists to
  // get wrong — and it is the one that came out of a split, which is when order gets lost.
  assert.deepEqual(cardsOn(settings('history').tree),
    ['Copy your history to relay.grace.example', 'Keep your relays in sync'],
    'the two cards on Move or copy history are not in the authored order. Copying a history onto a relay ' +
    'comes before keeping two relays in step, because you cannot do the second until the first has happened');
  const r = region(settings('history').tree)[0];
  // React fragments create no DOM, so what the flex column actually receives is what boxes() returns.
  const boxes = (n) => {
    const out = [];
    for (const k of (n.kids || [])) {
      if (k == null || k === false || typeof k === 'string' || typeof k === 'number') continue;
      if (k.type === 'Fragment') out.push(...boxes(k));
      else out.push(k);
    }
    return out;
  };
  const kids = boxes(r).filter(k => typeof k.type === 'function' || (k.type === 'div' || k.type === 'section'));
  for (const k of kids) {
    assert.notEqual(k.props && k.props.className, 'sk-cols',
      'a settings page is packing its cards into a grid again. .set-page is a flex COLUMN: a grid that packs ' +
      'decides the reading order, the Tab order and the split point from the card heights, and all three then ' +
      'move whenever a card grows');
  }
});

test('the page is the container the density rules measure, and the list is a sibling of it', () => {
  const s = settings('relays');
  const r = region(s.tree)[0];
  assert.equal(r.props.className, 'set-page',
    'the settings page is not .set-page, so the @container rules in steward.html have nothing to measure and ' +
    'every card falls back to the roomy phone spacing in a browser');
  const shell = find(s.tree, n => n.type === 'div' && /(^| )set-shell( |$)/.test(String((n.props || {}).className || '')));
  assert.equal(shell.length, 1, 'there is no .set-shell around the list and the page');
  const inShell = (shell[0].kids || []).length;
  assert.ok(inShell >= 1, 'the shell has no children');
  assert.doesNotMatch(String(shell[0].props.className), /set-shell--one/,
    'a browser is being given the phone’s one-column shell');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. EVERY DEEP LINK LANDS ON THE RIGHT PAGE — both ends of it.
//    "A signature change has TWO caller lists." The keys DashSettings accepts are one end; the screens that
//    pass them are the other, and each of those is DRIVEN here rather than read.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const LANDS_ON = [
  // what the shipped callers pass, after 2026-09-09
  ['relays', 'Relays', 'Overview’s relay stat card, and the setup wizard’s "Relays & settings"'],
  ['delegated', 'Delegated stewards', 'Overview’s "N people want to help steward" banner'],
  ['key', 'Church key', 'the sidebar’s "lock with a PIN" link'],
  // the keys that named TABS until 2026-09-09. A saved link, or a screen nobody updated, must still land on
  // a real page. 'features' and 'network' are page keys as well as old tab keys, and the PAGE wins — see the
  // invariant asserted below.
  ['church', 'Church identity', 'the old Church tab, which is not a page key'],
  ['features', 'Congregation features', 'the old Features tab, which is also a page key'],
  ['network', 'Network', 'the old Network & relays tab, which is also a page key'],
  ['security', 'Delegated stewards', 'the old Security tab, which is not a page key'],
];

for (const [key, page, who] of LANDS_ON) {
  test(`a deep link to "${key}" opens ${page} (${who})`, () => {
    const r = region(settings(key).tree);
    assert.equal(r.length, 1, `a deep link to "${key}" opened no page at all`);
    assert.equal(r[0].props['aria-label'], page,
      `a deep link to "${key}" opened "${r[0].props['aria-label']}". Before this change it named a TAB; a key ` +
      'that resolves to nothing lands the steward on a blank panel, which is what the old ' +
      "`initialSection === 'relays' ? 'network'` alias existed to prevent.");
  });
}

test('no alias shadows a page of the same name', () => {
  // THE BUG THIS CAUGHT, before it shipped. Three of the four old tab keys — 'features', 'network', 'relays' —
  // are page keys too. With the alias map consulted first, `network: 'relays'` rewrote every link to the
  // Network PAGE into a link to Relays, and nothing could open Network at all: a page in the list, with a
  // body, that no deep link could reach.
  const cat = catalogue();
  const shadowed = Object.keys(cat.aliases).filter(k => cat.pages.some(p => p.k === k));
  assert.deepEqual(shadowed, [],
    'these aliases have the same name as a page: ' + shadowed.join(', ') + '. An alias is for a key that is ' +
    'NOT a page; one that shares a page\'s name makes that page unreachable by link, silently.');
  for (const [from, to] of Object.entries(cat.aliases)) {
    assert.ok(cat.pages.some(p => p.k === to) || cat.groups.some(([, items]) => items.some(p => p.k === to)),
      `the alias ${from} points at "${to}", which is not a page key at all`);
  }
});

test('a delegate deep-linked to an owner-only page lands on the notice, never on nothing', () => {
  // Overview's steward-requests banner sends whoever is looking at it to Delegated stewards, and a delegate
  // may not have that page. Round 7: a steward followed that banner and found "no such page exists".
  const r = region(settings('delegated', { delegated: true }).tree);
  assert.equal(r.length, 1, 'a delegate following the steward-requests banner reached no page at all');
  assert.equal(r[0].props['aria-label'], 'Security',
    'a delegate deep-linked to an owner-only page landed on "' + r[0].props['aria-label'] + '" rather than the ' +
    'notice explaining what they may do here');
});

test('Overview’s relay card and steward-requests banner pass the page keys those pages answer to', () => {
  const { React, draw } = miniReact();
  const mod = consoleWith(React, { pendingStewards: [{ pubkey: 'p1' }, { pubkey: 'p2' }] });
  const asked = [];
  const tree = draw(mod.DashOverview, { onTab() {}, onNewPost() {}, onSettings: (s) => asked.push(s) });
  const relayCard = find(tree, n => n.props && typeof n.props.onClick === 'function' && n.props.label === 'Your relay');
  assert.equal(relayCard.length, 1, 'Overview’s "Your relay" stat card is gone — re-anchor this test');
  relayCard[0].props.onClick();

  const banner = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('to help steward'));
  assert.equal(banner.length, 1, 'Overview’s steward-requests banner did not render — re-anchor this test');
  banner[0].props.onClick();

  assert.deepEqual(asked, ['relays', 'delegated'],
    'Overview deep-links Settings with ' + JSON.stringify(asked) + '. Those strings have to be page keys ' +
    'from SETTINGS_GROUPS (or one of the four aliased tab keys), and the pages they land on are asserted above.');
  for (const k of asked) {
    assert.ok(catalogue().pages.some(p => p.k === k) || Object.prototype.hasOwnProperty.call(catalogue().aliases, k),
      `Overview passes "${k}", which is neither a page nor an alias — it would land on the default page`);
  }
});

test('the setup wizard’s "Relays & settings" shortcut asks for the Relays page, not just the Settings tab', () => {
  // The shortcut only renders on the wizard's LAST step, and reaching that step means publishing through five
  // others. So the step is SEEDED, the way scripts/connect-by-name-names-the-church.test.mjs seeds the field
  // it drives — and scoped the same way, because a mis-aimed seed reports exactly what a blind test reports:
  // `React.useState(0)` occurs exactly ONCE inside StewSetupWizard and it is `step`. Everything the assertion
  // below reads is the real component's real output.
  const src = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
  const at = src.indexOf('function StewSetupWizard(');
  assert.notEqual(at, -1, 'StewSetupWizard is gone from app/stew-dashboard.jsx — re-anchor this test');
  const body = src.slice(at, src.indexOf('\nfunction ', at + 1));
  const zeros = body.match(/React\.useState\(0\)/g) || [];
  assert.equal(zeros.length, 1,
    `React.useState(0) occurs ${zeros.length} times inside StewSetupWizard, so seeding the step could be ` +
    'aiming at some other piece of state — re-anchor this test rather than guessing');
  assert.ok(body.includes('const [step, setStep] = React.useState(0)'),
    'the wizard’s step is no longer the useState(0) this test seeds — re-anchor it');

  const { React: R, draw } = miniReact();
  const React = { ...R, useState: (init) => (init === 0 ? [6, () => {}] : R.useState(init)) };
  const mod = consoleWith(React);
  const asked = [];
  const tabs = [];
  const tree = draw(mod.StewSetupWizard, {
    church: { name: 'Grace Church' }, onDone() {}, onTab: (t) => tabs.push(t),
    onSettings: (s) => asked.push(s), onInvite() {}, onNewPost() {},
  });
  assert.match(texts(tree).join(' '), /You’re all set/,
    'seeding the step did not reach the wizard’s last step, so the shortcut below is not the one on screen');
  const shortcut = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Relays & settings'));
  assert.equal(shortcut.length, 1, 'the wizard’s "Relays & settings" shortcut is gone — re-anchor this test');
  shortcut[0].props.onClick();
  assert.deepEqual(asked, ['relays'],
    'the wizard’s "Relays & settings" shortcut asked for ' + JSON.stringify(asked) + ' instead of the Relays ' +
    'page. Its own words say "Manage relays, video & audio in Settings", and the page Settings opens by ' +
    'default is Church identity — so without a page key this shortcut lands somewhere it did not promise');
  assert.deepEqual(tabs, [],
    'the shortcut still falls through to onTab(\'settings\') even though it was handed a page to open');
});

test('the sidebar’s "lock with a PIN" link opens the Church key page, with the PIN dialog on it', () => {
  // Driven through the REAL StewDashboard, because the link is in its sidebar and the page it lands on is
  // decided by openSettings → DashSettings. Both halves of the deep link run.
  const { React, draw } = miniReact();
  const mod = consoleWith(React);
  const first = draw(mod.StewDashboard, {});
  const link = find(first, n => n.type === 'span' && typeof n.props.onClick === 'function'
    && texts(n).join(' ').includes('lock with a PIN'));
  assert.equal(link.length, 1, 'the sidebar’s "lock with a PIN" link is gone — re-anchor this test');
  link[0].props.onClick();
  draw(mod.StewDashboard, {});                    // Settings mounts here and its one-shot effect queues…
  const after = draw(mod.StewDashboard, {});      // …and this draw is the one that shows what it did
  const r = find(after, n => n.type === 'section' && n.props['aria-label']);
  assert.equal(r.length, 1, 'following "lock with a PIN" opened no settings page');
  assert.equal(r[0].props['aria-label'], 'Church key',
    'following "lock with a PIN" landed on "' + r[0].props['aria-label'] + '". The console lock is folded ' +
    'into the Church key card, so any other page is a dead end');
  const dlg = find(after, n => n.props && n.props.role === 'dialog');
  assert.ok(dlg.length >= 1,
    'the one-shot "pin" intent no longer opens the PIN dialog. The link is the only way into locking this ' +
    'console from the sidebar, and without a PIN the church key sits unencrypted on this computer');
});
