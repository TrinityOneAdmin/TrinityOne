// THE SETTINGS CARDS SIT IN STACKS SOMEBODY AUTHORED, AND EVERY CARD IS STILL ON ITS TAB.
// Run: node --test scripts/settings-cards-sit-in-authored-stacks.test.mjs
//
// Settings used to lay its cards out with `.sk-masonry { column-width: 330px }` — CSS multi-column. The
// browser picked the break points, so three things nobody decided followed from the card heights: the
// reading order ran down one column and then across, the Tab order jumped back up the page, and the split
// moved whenever a card grew. One card in this very panel carried a comment saying it had been reordered
// in source to please the packing.
//
// The replacement is a two-track grid (`.sk-cols`) whose DIRECT CHILDREN ARE THE COLUMNS: one <div> per
// authored stack, cards inside it. That has exactly one failure mode worth guarding, and it is silent — a
// card left outside a stack claims a grid track of its own and the two-column shape comes apart, or a card
// dropped while re-nesting simply vanishes off the tab with nothing to say so.
//
// CLAUDE.md rule 3: app/stew-dashboard.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves
// every word of it in place and a text-matching assertion still passes. Nothing here matches text in
// app/*.jsx. The console is compiled with the same esbuild the build uses and the REAL DashSettings is
// rendered through the miniature React in scripts/render-jsx-screen.mjs; every assertion reads the tree
// that comes back. The two CSS assertions are about steward.html, which is a served file and not JSX, and
// they claim only what is declared there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const JS = compileScreen('app/stew-dashboard.jsx');

// Everything app/stew-dashboard.jsx takes from OUTSIDE itself. A name it needs that is not here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends
// up asserting about something that is not the code. Panel and DashSettings are the REAL ones; the stubs
// are furniture from other app files and the browser.
function consoleWith(React, over = {}) {
  const win = {
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'steward-invite-payload', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
      ...(over.steward || {}),
    },
    addEventListener() {}, removeEventListener() {}, innerWidth: 1200,
    localStorage: { getItem: () => null, setItem() {} },
  };
  const globals = {
    React, window: win, location: { hostname: 'app.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: win.localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
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
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    useStewDialog: () => ({ current: null }),
    useStewNarrow: () => false,
    churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashSettings, Panel };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashSettings, 'function', 'DashSettings is not a component any more — re-anchor this test');
  assert.equal(typeof mod.Panel, 'function', 'Panel is not a component any more — re-anchor this test');
  return mod;
}

// Draw one settings sub-tab and hand back its tabpanel node.
function panelFor(section, over = {}) {
  const { React, draw } = miniReact();
  const mod = consoleWith(React, over);
  const tree = draw(mod.DashSettings, { initialSection: section, onSectionConsumed() {} });
  const panels = find(tree, n => n.props && n.props.role === 'tabpanel');
  assert.equal(panels.length, 1, `expected one tabpanel on the ${section} tab, found ${panels.length}`);
  return panels[0];
}

// The children of a node as the GRID sees them: React.Fragment is not a box, so it is flattened through,
// and the `{cond ? … : null}` arms that are closed contribute nothing.
function boxes(n) {
  const out = [];
  for (const k of (n.kids || [])) {
    if (k == null || k === false || typeof k === 'string' || typeof k === 'number') continue;
    if (k.type === 'Fragment') out.push(...boxes(k));
    else out.push(k);
  }
  return out;
}

// What a card IS, read off the rendered element: the component that was mounted, plus the Panel title where
// the card is a Panel written inline. Never its text, which is what rule 3 forbids.
const cardId = (n) => (typeof n.type === 'function'
  ? n.type.name + (n.props && typeof n.props.title === 'string' ? ':' + n.props.title : '')
  : '<' + n.type + '>');

const idsIn = (stack) => boxes(stack).map(cardId);

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTROL — if this fails, every assertion below is meaningless.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the real DashSettings renders a tabpanel per sub-tab, with its cards on it', () => {
  const church = panelFor('church');
  assert.match(texts(church).join(' | '), /Church identity/, 'the Church tab no longer renders its identity card — re-anchor this test');
  const security = panelFor('security');
  assert.match(texts(security).join(' | '), /Church key/, 'the Security tab no longer renders the church-key card — re-anchor this test');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE PANEL IS A TWO-TRACK GRID, AND ITS CHILDREN ARE THE COLUMNS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the settings tabpanel is .sk-cols, and the Network tab keeps its own grid', () => {
  for (const s of ['church', 'features', 'security']) {
    assert.equal(panelFor(s).props.className, 'sk-cols',
      `the ${s} tab is not laid out with .sk-cols. A masonry (column-width) decides the reading and Tab ` +
      'order from the card heights; a plain row-major grid makes every row as tall as its tallest card');
  }
  assert.equal(panelFor('network').props.className, 'net-grid',
    'the Network tab lost its own two-track grid — the Relays card is wide and does not belong in a stack');
});

test('every direct child of the settings panel is an authored stack, never a card', () => {
  for (const s of ['church', 'features', 'security']) {
    const kids = boxes(panelFor(s));
    assert.ok(kids.length >= 1, `the ${s} tab renders nothing at all`);
    for (const k of kids) {
      assert.equal(typeof k.type, 'string',
        `a card (${cardId(k)}) is a DIRECT child of the ${s} tab, so it claims a grid track of its own and ` +
        'the two-column shape comes apart. Cards go inside a stack <div>');
      assert.equal(k.type, 'div', `the ${s} tab has a <${k.type}> where a stack <div> should be`);
      assert.equal(k.props.className, undefined,
        `a stack on the ${s} tab carries a className; .sk-cols styles its children by position, not by class`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. EACH CARD IS IN THE STACK IT WAS AUTHORED INTO — and, above all, IS STILL THERE. A card dropped while
//    re-nesting says nothing: the tab simply renders without it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const STACKS = {
  church: [
    ['Panel:Church identity', 'DashBrandingPanel'],
    ['DashMediaPanel', 'DashBackup'],
  ],
  features: [
    ['DashFeaturesPanel'],
    ['DashChatTagsPanel', 'DashGivingPanel', 'DashMealsPanel'],
  ],
  security: [
    ['Panel:Church key', 'Panel:Console lock', 'Panel:Stewards & handoff'],
    ['DashStewardsPanel', 'DashBecomeStewardPanel'],
  ],
};

for (const [section, want] of Object.entries(STACKS)) {
  test(`the ${section} tab is ${want.length} authored stacks, holding exactly the cards it is meant to`, () => {
    const kids = boxes(panelFor(section));
    assert.equal(kids.length, want.length,
      `the ${section} tab has ${kids.length} columns, not ${want.length}`);
    assert.deepEqual(kids.map(idsIn), want,
      `the ${section} tab's cards are not the ones authored into its stacks. A card missing from this list ` +
      'is off the tab entirely and nothing on screen says so');
  });
}

test('a delegated steward gets the one card they are allowed, and it is still in a stack', () => {
  const kids = boxes(panelFor('security', { steward: { isDelegated: () => true } }));
  assert.deepEqual(kids.map(idsIn), [['Panel:Security']],
    'a delegated steward’s Security tab is not one stack holding the one notice card — a bare card here ' +
    'would be a grid track of its own, and the owner-only cards must not appear at all');
  // Measured in Chromium: .sk-cols collapses the tracks it has no stack for, so ONE stack is handed the
  // whole 1120px. This card is a single paragraph and would be set a line at a time across it.
  assert.equal((kids[0].props.style || {}).maxWidth, 552,
    'the lone card on a delegated steward’s Security tab is not capped at a column’s width, so it is set ' +
    'across the full 1120px panel');
});

test('the church tab reorders with the identity, not with the card heights', () => {
  // The masonry packed by height, so this order was advisory at best: the identity card is the first thing
  // on the page and Branding follows it because they are the same subject, not because they happened to fit.
  const first = boxes(panelFor('church'))[0];
  assert.equal(cardId(boxes(first)[0]), 'Panel:Church identity',
    'the first card on the Church tab is no longer the church’s own identity');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE STYLESHEET SIDE. A declaration, not a behaviour: .sk-cols has to exist and be a grid, and the
//    masonry rule has to be gone, or the className asserted above lands on nothing.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const CSS = read('steward.html').replace(/\/\*[\s\S]*?\*\//g, '');   // comments explain the history; they are not rules

test('steward.html defines .sk-cols as a container-sized grid of stacks', () => {
  const rule = CSS.match(/\.sk-cols\s*\{([^}]*)\}/);
  assert.ok(rule, '.sk-cols is not defined in steward.html, so the settings panel has no layout at all');
  assert.match(rule[1], /display:\s*grid/, '.sk-cols is not a grid');
  assert.match(rule[1], /grid-template-columns:\s*repeat\(auto-fit,/,
    '.sk-cols does not use auto-fit. auto-fill leaves the empty third track in place and the two stacks ' +
    'sit in two of three columns with a hole beside them');
  assert.match(rule[1], /minmax\(min\(360px,\s*100%\),\s*1fr\)/,
    'the track floor is not min(360px, 100%): a bare 360px floor keeps a 360px track even when the panel ' +
    'is narrower than that, which is what pushed the Relays card past its own border once already');
  const kids = CSS.match(/\.sk-cols\s*>\s*\*\s*\{([^}]*)\}/);
  assert.ok(kids, '.sk-cols > * is not styled, so each stack is a plain block and its cards do not space');
  assert.match(kids[1], /flex-direction:\s*column/, 'a stack is not a column');
  assert.match(kids[1], /min-width:\s*0/, 'a stack has no min-width:0, so a wide card can push its track open');
});

test('steward.html no longer sizes the settings cards from the viewport, or by masonry', () => {
  assert.equal(/\.sk-masonry/.test(CSS), false,
    'the masonry rule is still in steward.html. It has one user and that user has moved, so a rule left ' +
    'behind is one a future card can pick up by accident');
  const media = CSS.match(/@media[^{]*\{[^{}]*\.sk-cols/);
  assert.equal(media, null,
    'the settings columns are being sized by a viewport media query. The panel sits inside a sidebar and a ' +
    'grid track, so the window’s width says nothing about its own — this is the mistake the .relay-grid ' +
    'comment in the same file records');
});
