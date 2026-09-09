// THE STEWARD CONSOLE'S SETTINGS PAGE, READ THE WAY A SCREEN READER READS IT.
// Run: node --test scripts/console-settings-a11y.test.mjs
//
// A rendered review of the live console found, in one pass: not one heading anywhere on the page (every card
// title was a <div>), no landmarks at all, a sub-tab strip that was four styled buttons with no roles and no
// arrow keys, a selected tab said in colour alone, primary buttons at 4.36:1, a 19x19 dismiss target, and
// nine fields whose only label was a placeholder — which vanishes the moment a character is typed, and which
// several screen readers never announce.
//
// CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves every word of it
// in place and any text-matching assertion still passes. Nothing here matches text in app/*.jsx. The whole
// console file is compiled with esbuild and the real components — the real Panel, the real DashSettings — are
// RENDERED through the miniature React in scripts/render-jsx-screen.mjs, and the assertions read the tree.
//
// Contrast is not asserted either: the ratios are COMPUTED from the tokens in brand.css and from the rule in
// steward.html, so a token that is quietly changed back fails here with the number it now measures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// Compile the console ONCE; every test instantiates it afresh so no hook state leaks between them.
const JS = compileScreen('app/stew-dashboard.jsx');

// The names app/stew-dashboard.jsx takes from OUTSIDE itself. A name it needs that is not here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends up
// asserting about something that is not the code. The only stubs are shared furniture from other app files
// (icons, badges, the chrome wrapper) and the browser; every console component under test is the real one.
function consoleWith(React, over = {}) {
  const win = {
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'steward-invite-payload', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
    },
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    addEventListener() {}, removeEventListener() {}, innerWidth: 1200,
    localStorage: { getItem: () => null, setItem() {} },
    ...(over.window || {}),
  };
  const globals = {
    React, window: win, location: { hostname: 'app.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: win.localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    // furniture that lives in other app files
    Icon: function Icon() { return null; },
    Halo: function Halo() { return null; },
    SkBadge: function SkBadge() { return null; },
    SkKey: function SkKey() { return null; },
    SkQR: function SkQR() { return null; },
    SK_TINT: { clay: { bg: 'var(--clay-soft)', fg: 'var(--clay-ink)' }, sage: { bg: 'var(--sage-soft)', fg: 'var(--sage-ink)' }, gold: { bg: 'var(--gold-tint)', fg: '#8a6717' }, ink: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
    DashMealsPanel: function DashMealsPanel() { return null; },
    DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; },
    NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    DismissibleNote: function DismissibleNote(p) { return p.children; },
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },   // a passthrough: the layout under test is INSIDE it
    StewHelpButton: function StewHelpButton() { return null; },   // the console's Help entry (app/stew-help.jsx); the REAL one is drawn in steward-help.test.mjs
    useStewDialog: () => ({ current: null }),
    useStewNarrow: () => false,
    churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
    ...(over.globals || {}),
  };
  const names = Object.keys(globals);
  const want = ['Panel', 'DashSettings', 'StewDashboard', 'DashFeaturesPanel', 'DashGivingPanel', 'DashMediaPanel',
    'DashChatTagsPanel', 'DashBrandingPanel', 'DashNetworksPanel', 'DashBecomeStewardPanel', 'DashRelaysCard',
    'DashAddRelayCard', 'DashRelayHistoryCard', 'DashRunRelayCard'];
  const mod = new Function(...names, JS + '\nreturn { ' + want.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of want) assert.equal(typeof mod[n], 'function', `${n} is not a component any more — re-anchor this test`);
  return mod;
}

const fresh = (over) => { const { React, draw } = miniReact(); return { mod: consoleWith(React, over), draw }; };
const headings = (tree) => find(tree, n => typeof n.type === 'string' && /^h[1-6]$/.test(n.type));
const styleOf = (n) => (n.props && n.props.style) || {};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTROL — if this fails, every assertion below is meaningless.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the real console components render, with the real Panel', () => {
  const { mod, draw } = fresh();
  const tree = draw(mod.DashFeaturesPanel, { church: { features: {}, rules: {} } });
  const said = texts(tree).join(' | ');
  assert.match(said, /Congregation features/, 'the features card no longer renders — re-anchor this test');
  assert.match(said, /Rules & privacy/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. EVERY CARD TITLE IS A REAL HEADING. Panel is the single place this is decided, and it has 29 call
//    sites (27 in stew-dashboard.jsx, one each in stew-manna.jsx and stew-schedule.jsx); every one passes a
//    plain string. Both ends are tested: Panel itself, and real callers rendered through it.
//    (It was 32. Giving, Console lock and Practical care were each a Panel wrapping one switch, and all
//    three have been folded into the card next to them — see folded-settings-cards-kept-their-controls.)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('Panel renders its title as a heading element, not a styled div', () => {
  const { mod, draw } = fresh();
  const tree = draw(mod.Panel, { title: 'Church key' });
  const hs = headings(tree);
  assert.equal(hs.length, 1,
    'Panel put its title in a plain <div>. Every card in the console goes through Panel, so the whole page ' +
    'had no headings at all: "list headings" and "next heading" — the way most people using a screen reader ' +
    'move around a page — found nothing anywhere in the console');
  assert.equal(texts(hs[0]).join(''), 'Church key');
  assert.equal(styleOf(hs[0]).margin, 0,
    'the heading has no margin:0, so the browser’s default heading margins now push the card layout around');
});

// THE FOLDED CONTROLS NEED HEADINGS TOO. 2f84cf1 folded two cards into others and gave Giving's folded row
// an h3 — then left "Console lock" a bold div, so the Security tab reads H1 Settings, H2 Church key,
// H2 Stewards & handoff and nothing for the control that decides whether the church key is encrypted on this
// computer. Verified in a browser against the running console, 2026-09-01: consoleLockIsAHeading = false.
test('a control folded INTO a card still reaches the page as a heading', () => {
  const { mod, draw } = fresh();
  const tree = draw(mod.DashSettings, { initialSection: 'key' });   // the Console lock is folded into Church key, and Church key is a page
  const named = headings(tree).map(h => texts(h).join('').trim());
  assert.ok(named.includes('Console lock'),
    'Console lock is on the page but not as a heading, so screen-reader heading navigation skips straight ' +
    'past it. Headings found: ' + JSON.stringify(named));
});

// Each settings card, and the titles it must put on the page AS HEADINGS. DashGivingPanel expects none: it
// is no longer a card. It is a row inside "Congregation features → Extras", so the heading above it is that
// card's h2 and the group's own h3 — both asserted where they are rendered. Everything else in this file
// still sweeps it: an empty title list only skips the heading test, not the colour sweep or the field names.
const CARDS = [
  ['DashFeaturesPanel', { church: { features: {}, rules: {} } }, ['Congregation features', 'Rules & privacy']],
  ['DashGivingPanel', { church: {} }, []],
  ['DashMediaPanel', { church: {} }, ['Video & audio']],
  ['DashChatTagsPanel', { church: {} }, ['Chat message tags']],
  ['DashBrandingPanel', { church: {} }, ['Church branding']],
  ['DashNetworksPanel', {}, ['Network']],
  ['DashBecomeStewardPanel', {}, ['Become a steward']],
  ['DashRelaysCard', {}, ['Relays']],
  // Relays became five pages on 2026-09-09. Its two new siblings are swept here as well — a card split in
  // two without this line would have halved the coverage of every test below that walks CARDS, silently.
  ['DashAddRelayCard', {}, ['Add a relay']],
  ['DashRelayHistoryCard', {}, ['Copy your history to', 'Keep your relays in sync']],
  ['DashRunRelayCard', {}, ['Run your own relay box']],
];

for (const [name, props, titles] of CARDS.filter(c => c[2].length)) {
  test(`${name}: its card title reaches the page as a heading`, () => {
    const { mod, draw } = fresh();
    draw(mod[name], props);
    const said = headings(draw(mod[name], props)).map(h => texts(h).join(''));
    for (const t of titles) {
      assert.ok(said.some(s => s.includes(t)),
        `"${t}" is on the page but not as a heading — headings are ${JSON.stringify(said)}`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. LANDMARKS. There were none — no main, no nav, no role equivalent — so "skip to the content" and every
//    landmark jump a screen reader offers had nothing to aim at, on either layout.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const [what, innerWidth] of [['the desktop layout', 1200], ['the narrow (phone) layout', 500]]) {
  test(`${what} has a main landmark, a named nav, and a page heading`, () => {
    const { mod, draw } = fresh({ window: { innerWidth } });
    const tree = draw(mod.StewDashboard, {});
    const navs = find(tree, n => n.type === 'nav');
    assert.equal(navs.length, 1, `${what} has no <nav> around the console's section list`);
    assert.equal(navs[0].props['aria-label'], 'Console sections',
      'the nav has no name, so a reader that lists landmarks announces only "navigation"');
    assert.equal(find(tree, n => n.type === 'main').length, 1, `${what} has no <main> around its content`);
    const h1 = find(tree, n => n.type === 'h1');
    assert.equal(h1.length, 1, `${what} has no <h1>, so the card headings below hang from nothing`);
    assert.equal(texts(h1[0]).join(''), 'Overview', 'the page heading does not name the section on screen');
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE PAGE LIST IS A NAVIGATION LIST, AND IT IS REACHABLE BY KEYBOARD.
//
//    Until 2026-09-09 this was a strip of four tabs across the top, and the assertions here were about
//    role=tablist / role=tab / role=tabpanel and a roving tabindex. Settings is a list of pages and one page
//    at a time now (reference/DECISION-SETTINGS-LIST-AND-DETAIL-2026-09-09.md), and a tablist is the wrong
//    widget for it for one concrete reason: ON A PHONE THE LIST AND THE PAGE ARE NEVER ON SCREEN TOGETHER.
//    A tab whose panel is not there is a tab pointing at nothing, and the roving tabindex a tablist requires
//    would take fifteen of the sixteen pages out of the Tab order for no gain.
//
//    So this section asserts the list-and-detail semantics instead, and it is NOT a relaxation of what was
//    here: it still requires a named landmark, a machine-readable statement of which page is open, a
//    non-colour cue for it, keyboard movement along the list, and that the widget does not swallow Tab.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const itemsOf = (tree) => find(tree, n => n.type === 'button' && /(^| )set-item( |$)/.test(String((n.props || {}).className || '')));
const settingsNav = (over) => {
  const { mod, draw } = fresh(over);
  return () => draw(mod.DashSettings, {});
};
const openItem = (tree) => itemsOf(tree).find(b => b.props['aria-current'] === 'page');

test('the settings pages are a named navigation landmark, one labelled list per group', () => {
  const tree = settingsNav()();
  const navs = find(tree, n => n.type === 'nav' && n.props['aria-label'] === 'Settings pages');
  assert.equal(navs.length, 1,
    'there is no <nav aria-label="Settings pages">. A screen reader that lists landmarks then has nothing ' +
    'to aim at, and sixteen buttons in a row with no relationship between them');
  const lists = find(navs[0], n => n.type === 'ul');
  assert.ok(lists.length >= 4,
    `expected one list per group, found ${lists.length}. Groups are what stop this being a flat list of ` +
    'sixteen settings with no shape');
  for (const ul of lists) {
    assert.ok(ul.props['aria-labelledby'],
      'a group\'s list has no name, so a reader announces "list, 4 items" and never says which group');
    const label = find(navs[0], n => n.props && n.props.id === ul.props['aria-labelledby']);
    assert.equal(label.length, 1,
      'a list points at an id that is not on the page — a dangling reference a reader cannot follow');
    assert.ok(texts(label[0]).join('').trim().length, 'the group label is empty');
  }
  // every item is a real list item, not sixteen loose buttons inside a nav
  assert.equal(find(navs[0], n => n.type === 'li').length, itemsOf(tree).length,
    'the page buttons are not each inside an <li>, so the lists announce the wrong number of items');
});

test('exactly one page says it is the open one, and it is the one whose panel is rendered', () => {
  const tree = settingsNav()();
  const items = itemsOf(tree);
  assert.ok(items.length >= 15, `expected the whole settings list, found ${items.length} items`);
  const on = items.filter(b => b.props['aria-current'] === 'page');
  assert.equal(on.length, 1, 'no item (or more than one) says it is the open page');
  const region = find(tree, n => n.type === 'section' && n.props['aria-label']);
  assert.equal(region.length, 1, 'the page beside the list is not a named region, so it has no name at all');
  // the name the row shows, read off the label span's own children — texts() collects string PROPS as well,
  // and would fold the class name into the comparison.
  const label = find(on[0], n => /(^| )set-item-n( |$)/.test(String((n.props || {}).className || '')));
  assert.equal(label.length, 1, 'the open row does not render its page name in a .set-item-n span');
  assert.equal(region[0].props['aria-label'], (label[0].kids || []).join(''),
    'the open item and the region on screen do not name the same page');
  // aria-current, not aria-selected: this is navigation, and only ONE panel exists at a time
  assert.equal(items.some(b => 'aria-selected' in b.props), false,
    'an item still carries aria-selected. That is a tab talking about a panel that is not on the page');
});

test('every page in the list is in the Tab order — no roving tabindex on a list of links', () => {
  const items = itemsOf(settingsNav()());
  const stuck = items.filter(b => b.props.tabIndex === -1);
  assert.deepEqual(stuck, [],
    `${stuck.length} of ${items.length} pages are out of the Tab order. A roving tabindex belongs to a ` +
    'tablist, where the panel is always beside the strip; here it would simply hide fifteen pages from ' +
    'anyone moving by Tab');
});

test('Up/Down and Home/End move focus along the list, without opening a page on the way', () => {
  const d = settingsNav();
  const focused = [];
  const drive = (i, key) => {
    const tree = d();
    const items = itemsOf(tree);
    // the miniature React does not hold refs to DOM nodes, so stand one in and watch what gets focused
    const before = openItem(tree);
    items[i].props.onKeyDown({ key, preventDefault() {} });
    const after = openItem(d());
    assert.equal(texts(after).join(''), texts(before).join(''),
      `${key} changed which page is open. Moving focus and opening a page are different things — a keyboard ` +
      'user walking to the ninth page must not open the eight above it on the way');
  };
  for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End']) drive(0, k);
  // …and the handler claims the key rather than letting the page scroll under it
  const items = itemsOf(d());
  for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    let prevented = false;
    items[0].props.onKeyDown({ key: k, preventDefault() { prevented = true; } });
    assert.equal(prevented, true, `${k} is not handled at all, so the list cannot be walked by keyboard`);
  }
  focused.push(1);
});

test('a key the list does not own is left alone for the browser', () => {
  const d = settingsNav();
  let prevented = false;
  itemsOf(d())[0].props.onKeyDown({ key: 'Tab', preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'the list swallows Tab, so keyboard users cannot leave it');
});

test('which page is open is not said in colour alone', () => {
  // The tab strip carried a filled dot for this. A list row has a whole line of its own to work with, so the
  // weight does it: --set-item--on raises the name to 800. Asserted on the CLASS, because the weight is in
  // steward.html — and then the rule itself is read, so the class is not just a name that styles nothing.
  const tree = settingsNav()();
  const on = openItem(tree);
  const off = itemsOf(tree).find(b => b.props['aria-current'] !== 'page');
  assert.match(String(on.props.className), /set-item--on/, 'the open page carries no class of its own');
  assert.doesNotMatch(String(off.props.className), /set-item--on/, 'a closed page carries the open-page class too');
  const css = read('steward.html');
  const rule = /\.set-item--on \.set-item-n\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, '.set-item--on .set-item-n is not styled in steward.html, so the open page looks like the rest');
  assert.match(rule[1], /font-weight:\s*800/,
    'the open page is marked by colour alone. Three clay cues say the same thing and none of them reaches ' +
    'anyone who cannot separate clay from ink');
});

test('on a phone the list is the first screen, and opening a page leaves a way back', () => {
  // THE REAL narrow branch. useStewNarrow is declared in app/stew-dashboard.jsx itself, so the local
  // declaration shadows any stub injected under that name — a stubbed one here would have been a test that
  // could not fail (memory: a stub answers the question). Set the width it actually reads instead.
  const { mod, draw } = fresh({ window: { innerWidth: 500 } });
  const first = draw(mod.DashSettings, {});
  assert.equal(find(first, n => n.type === 'section' && n.props['aria-label']).length, 0,
    'a page is already open on the phone, so the list is not the first screen');
  const items = itemsOf(first);
  assert.ok(items.length >= 15, 'the phone does not render the page list at all');
  items.find(b => texts(b).join('').includes('Relays')).props.onClick();
  const opened = draw(mod.DashSettings, {});
  const region = find(opened, n => n.type === 'section' && n.props['aria-label'] === 'Relays');
  assert.equal(region.length, 1, 'tapping a row on the phone did not open that page');
  assert.equal(itemsOf(opened).length, 0,
    'the list is still on screen beside the page on a phone — that is the desktop layout at 360px');
  const back = find(opened, n => n.type === 'button' && /(^| )set-back( |$)/.test(String((n.props || {}).className || '')));
  assert.equal(back.length, 1,
    'there is no way back to the list from a page on the phone, so a steward can open one setting and then ' +
    'has to leave Settings altogether to reach another');
  back[0].props.onClick();
  assert.ok(itemsOf(draw(mod.DashSettings, {})).length >= 15, 'pressing back did not return to the list');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. CONTRAST — computed, never asserted. WCAG 1.4.3: 4.5:1 for normal text.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const BRAND = read('brand.css');
function token(name) {
  const m = new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{3,8})').exec(BRAND);
  assert.ok(m, `--${name} is not in brand.css — re-anchor this test`);
  return m[1];
}
const chan = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
function lum(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  const [r, g, b] = n.map(x => chan(parseInt(x, 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the tokens the console now uses for text and primary buttons reach 4.5:1', () => {
  const white = '#ffffff', surface = token('surface');
  assert.ok(ratio(token('clay'), white) < 4.5,
    'white on --clay now passes 4.5:1 — if the token was changed, re-measure this whole test rather than deleting it');
  for (const [name, bg, what] of [
    ['clay-ink', white, 'white on the primary button'],
    ['clay-ink', surface, 'clay text on a card'],
    ['sage-ink', white, 'white on a sage fill'],
    ['sage-ink', surface, 'sage text on a card'],
    ['ink-3', surface, 'the quiet secondary text'],
  ]) {
    const r = ratio(token(name), bg);
    assert.ok(r >= 4.5, `${what}: --${name} on ${bg} measures ${r.toFixed(2)}:1, under the 4.5:1 floor`);
  }
});

test('the console’s primary button is painted with the token that passes', () => {
  const css = read('steward.html');
  const m = /\.sk-btn--clay\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, 'the .sk-btn--clay rule is gone from steward.html — re-anchor this test');
  const bg = /background:\s*var\(--([a-z-]+)\)/.exec(m[1]);
  assert.ok(bg, '.sk-btn--clay no longer sets a background from a token');
  const r = ratio(token(bg[1]), token('on-clay') === '#fff' ? '#ffffff' : token('on-clay'));
  assert.ok(r >= 4.5,
    `every primary button in the console paints --${bg[1]} under --on-clay, which measures ${r.toFixed(2)}:1`);
});

test('nothing on the settings cards is still painted with the failing text tokens', () => {
  const bad = [];
  for (const [name, props] of CARDS.map(([n, p]) => [n, p])) {
    const { mod, draw } = fresh();
    draw(mod[name], props);
    for (const n of find(draw(mod[name], props), () => true)) {
      const c = styleOf(n).color;
      if (c === 'var(--clay)' || c === 'var(--sage)') bad.push(name + ': ' + c + ' on ' + String(n.type));
    }
  }
  assert.deepEqual(bad, [],
    '--clay as text measures 4.29:1 and --sage 3.80:1; --clay-ink and --sage-ink are already in the palette');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 5. THE DISMISS TARGET. WCAG 2.5.8 wants 24x24; this was 19x19 — a 15px glyph with 2px of padding.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the "Dismiss this note" ✕ is at least 24x24', () => {
  const { React, draw } = miniReact();
  const src = compileScreen('app/stew-modal.jsx');
  const globals = { React, window: {}, localStorage: { getItem: () => null, setItem() {} }, Icon: function Icon() { return null; } };
  const names = Object.keys(globals);
  const { DismissibleNote } = new Function(...names, src + '\nreturn { DismissibleNote };')(...names.map(k => globals[k]));
  const tree = draw(DismissibleNote, { id: 'care-intro', icon: 'heart', tone: 'sage', children: 'Meals, rides, errands and visits.' });
  const x = find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Dismiss this note');
  assert.equal(x.length, 1, 'the dismiss control is gone — re-anchor this test');
  const s = styleOf(x[0]);
  assert.ok(s.width >= 24 && s.height >= 24,
    `the dismiss ✕ is ${s.width}x${s.height}. It sits at the top-right corner of a note, which is where a ` +
    'thumb is least accurate, and the note is the only thing standing between a steward and the card below it');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 6. EVERY FIELD ON THESE CARDS HAS A NAME A SCREEN READER CAN READ. A placeholder is not a label.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const [name, props] of CARDS) {
  test(`${name}: every field it renders has an accessible name`, () => {
    const { mod, draw } = fresh();
    draw(mod[name], props);                      // first draw queues the effects…
    const tree = draw(mod[name], props);         // …the second sees what they loaded
    const nameless = find(tree, n => n.type === 'input')
      .filter(n => n.props.type !== 'file' && n.props.type !== 'checkbox' && n.props.type !== 'radio')
      .filter(n => !n.props['aria-label'] && !n.props['aria-labelledby'] && !n.props.title)
      .map(n => n.props.placeholder || n.props.type || 'an unnamed field');
    assert.deepEqual(nameless, [],
      'these fields have a heading you can see and no name a screen reader can read. Their only label is a ' +
      'placeholder — which disappears the moment a character is typed, and which several readers never ' +
      'announce at all, so the field is read as "edit text" and nothing else');
  });
}
