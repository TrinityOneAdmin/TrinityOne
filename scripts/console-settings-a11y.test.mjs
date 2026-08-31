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
    useStewDialog: () => ({ current: null }),
    useStewNarrow: () => false,
    churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
    ...(over.globals || {}),
  };
  const names = Object.keys(globals);
  const want = ['Panel', 'DashSettings', 'StewDashboard', 'DashFeaturesPanel', 'DashGivingPanel', 'DashMediaPanel',
    'DashChatTagsPanel', 'DashBrandingPanel', 'DashNetworksPanel', 'DashBecomeStewardPanel', 'DashRelaysCard'];
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
// 1. EVERY CARD TITLE IS A REAL HEADING. Panel is the single place this is decided, and it has 32 call
//    sites (29 in stew-dashboard.jsx, one each in stew-manna.jsx, stew-meals.jsx, stew-schedule.jsx); every
//    one passes a plain string. Both ends are tested: Panel itself, and real callers rendered through it.
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

const CARDS = [
  ['DashFeaturesPanel', { church: { features: {}, rules: {} } }, ['Congregation features', 'Rules & privacy']],
  ['DashGivingPanel', { church: {} }, ['Giving']],
  ['DashMediaPanel', { church: {} }, ['Video & audio']],
  ['DashChatTagsPanel', { church: {} }, ['Chat message tags']],
  ['DashBrandingPanel', { church: {} }, ['Church branding']],
  ['DashNetworksPanel', {}, ['Network']],
  ['DashBecomeStewardPanel', {}, ['Become a steward']],
  ['DashRelaysCard', {}, ['Relays']],
];

for (const [name, props, titles] of CARDS) {
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
// 3. THE SUB-TAB STRIP IS A REAL TAB WIDGET.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const tabsOf = (tree) => find(tree, n => n.props && n.props.role === 'tab');
const settings = () => {
  const { mod, draw } = fresh();
  return () => draw(mod.DashSettings, {});
};

test('the settings sub-tabs are a tablist of tabs, not four unrelated buttons', () => {
  const d = settings();
  const tree = d();
  const list = find(tree, n => n.props && n.props.role === 'tablist');
  assert.equal(list.length, 1, 'there is no tablist: a screen reader announces four buttons with no relationship');
  assert.equal(list[0].props['aria-label'], 'Settings sections');
  const tabs = tabsOf(tree);
  assert.equal(tabs.length, 4, `expected 4 tabs, found ${tabs.length}`);
  const sel = tabs.filter(t => t.props['aria-selected'] === true);
  assert.equal(sel.length, 1, 'no tab (or more than one) says it is the selected one');
  assert.match(texts(sel[0]).join(''), /Church/);
  // roving tabindex: exactly one tab in the Tab order
  assert.deepEqual(tabs.map(t => t.props.tabIndex), [0, -1, -1, -1],
    'every tab is in the Tab order, so Tab walks through all four instead of moving to the panel');
  const panel = find(tree, n => n.props && n.props.role === 'tabpanel');
  assert.equal(panel.length, 1, 'the section below the strip is not a tabpanel');
  assert.equal(panel[0].props['aria-labelledby'], sel[0].props.id,
    'the panel is not tied to its tab, so a reader entering it cannot say which section it belongs to');
  assert.equal(sel[0].props['aria-controls'], panel[0].props.id);
  // Only the OPEN section's panel is rendered, so only the selected tab may claim to control one: an
  // aria-controls pointing at an id that is not on the page is a dangling reference, and a reader that
  // follows it lands nowhere.
  for (const t of tabs.filter(t => t.props['aria-selected'] === false)) {
    assert.equal(t.props['aria-controls'], undefined,
      'an unselected tab points at a panel that is not rendered');
  }
});

test('the arrow keys move along the tab strip, and Home/End jump to the ends', () => {
  const d = settings();
  const press = (key) => {
    const tabs = tabsOf(d());
    const i = tabs.findIndex(t => t.props['aria-selected'] === true);
    tabs[i].props.onKeyDown({ key, preventDefault() {} });
    return texts(tabsOf(d()).find(t => t.props['aria-selected'] === true)).join('');
  };
  assert.match(press('ArrowRight'), /Features/, 'ArrowRight does nothing — the strip is unreachable by keyboard alone');
  assert.match(press('ArrowRight'), /Network/);
  assert.match(press('End'), /Security/, 'End does not jump to the last tab');
  assert.match(press('ArrowRight'), /Church/, 'ArrowRight does not wrap round from the last tab to the first');
  assert.match(press('ArrowLeft'), /Security/, 'ArrowLeft does not wrap round from the first tab to the last');
  assert.match(press('Home'), /Church/, 'Home does not jump to the first tab');
});

test('a key the tab strip does not own is left alone for the browser', () => {
  const d = settings();
  let prevented = false;
  tabsOf(d())[0].props.onKeyDown({ key: 'Tab', preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'the strip swallows Tab, so keyboard users cannot leave it');
  assert.match(texts(tabsOf(d()).find(t => t.props['aria-selected'] === true)).join(''), /Church/);
});

test('which tab is open is not said in colour alone', () => {
  const d = settings();
  const tabs = tabsOf(d());
  const sel = tabs.find(t => t.props['aria-selected'] === true);
  const other = tabs.find(t => t.props['aria-selected'] === false);
  assert.notEqual(styleOf(sel).fontWeight, styleOf(other).fontWeight,
    'the selected tab differs from the others only in colour — three clay cues (tint, border, text) say the ' +
    'same thing, and none of them reaches anyone who cannot separate clay from ink');
  const marked = (t) => find(t, n => n.type === 'span' && styleOf(n).background && styleOf(n).background !== 'transparent');
  assert.equal(marked(sel).length, 1, 'the selected tab carries no non-colour marker');
  assert.equal(marked(other).length, 0, 'an unselected tab carries the selected marker too, so it marks nothing');
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
