// THE SETTINGS CARDS SIT WHERE SOMEBODY PUT THEM, AND THE PHONE KEEPS ITS ROOMY LAYOUT.
//
// Run: node --test scripts/settings-cards-sit-in-authored-stacks.test.mjs
//
// THE FILENAME IS HISTORICAL. It was written for `.sk-cols`, a two-track grid of "authored stacks", which on
// 2026-09-09 was itself replaced by a list of pages and one page at a time
// (reference/DECISION-SETTINGS-LIST-AND-DETAIL-2026-09-09.md). THE RULE IT PROTECTS DID NOT CHANGE and is the
// first rule of that decision note:
//
//     POSITIONS ARE AUTHORED, NEVER COMPUTED.
//
// The layout has now failed that rule twice and been rebuilt twice, so the history is worth keeping in front
// of whoever reads this next:
//
//   · `.sk-masonry { column-width: 330px }` — CSS multi-column. The BROWSER chose where the column broke, so
//     three things nobody had decided followed from the card heights: the reading order ran down one column and
//     then across, the Tab order jumped back up the page, and the split moved whenever a card grew. One card
//     carried a comment saying it had been reordered IN SOURCE to please the packing.
//   · `.sk-cols` — a two-track grid whose direct children were the columns. It fixed the moving and did not
//     fix the height: measured 2026-09-08 at 1280x713, every section still ran about two screenfuls, because
//     the height was CONTENT — one section doing six jobs at once.
//   · `.set-page` — a flex COLUMN holding one subject. Nothing packs, so nothing can move; and there is no
//     second track for a card to fall into, which is the failure mode the middle version had.
//
// So the shape this file asserts is different and the guarantee is the same, plus one that is new and is the
// reason the whole layout is a container query: THE PHONE'S ROOMY LAYOUT IS CORRECT AND MUST NOT CHANGE. The
// owner has confirmed it twice. Everything compact lives behind `@container`, never `@media`, and the roomy
// values are the DEFAULT — so a card in a narrow page gets them whatever the window is doing.
//
// CLAUDE.md rule 3: app/stew-dashboard.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves
// every word of it in place and a text-matching assertion still passes. Nothing here matches text in
// app/*.jsx. The console is compiled with the same esbuild the build uses and the REAL DashSettings is
// rendered through the miniature React in scripts/render-jsx-screen.mjs; every assertion reads the tree that
// comes back. The CSS assertions are about steward.html, which is a served file and not JSX, and they claim
// only what is declared there.
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
      ownRelay: () => 'wss://relay.grace.example/relay',
      backupState: async () => ({ boxes: 2, online: 2, syncOn: true }),
      addRelay: () => '', removeRelay: () => {}, rememberRelayName: () => {},
      ...(over.steward || {}),
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    innerWidth: over.innerWidth || 1200,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const globals = {
    React, window: win, location: { host: 'app.example', hostname: 'app.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: win.localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
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
    useStewDialog: () => ({ current: null }),
    churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashSettings, Panel, SETTINGS_GROUPS };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashSettings, 'function', 'DashSettings is not a component any more — re-anchor this test');
  assert.equal(typeof mod.Panel, 'function', 'Panel is not a component any more — re-anchor this test');
  assert.ok(Array.isArray(mod.SETTINGS_GROUPS), 'SETTINGS_GROUPS is gone — re-anchor this test');
  return mod;
}

// Draw one settings page and hand back the region the cards were rendered into.
function pageFor(key, over = {}) {
  return withDraw(key, over).page;
}

function withDraw(key, over = {}) {
  const { React, draw } = miniReact();
  const mod = consoleWith(React, over);
  const render = () => draw(mod.DashSettings, { initialSection: key, onSectionConsumed() {} });
  render();                       // the first draw queues the effects…
  const tree = render();          // …the second sees what they loaded
  const regions = find(tree, n => n.type === 'section' && n.props['aria-label']);
  assert.equal(regions.length, 1, `expected exactly one page open for "${key}", found ${regions.length}`);
  return { page: regions[0], tree, draw: render, mod };
}

const ALL_PAGES = (() => {
  const { React } = miniReact();
  return consoleWith(React).SETTINGS_GROUPS
    .reduce((a, [, items]) => a.concat(items), [])
    .filter(p => !p.delegate)
    .map(p => p.k);
})();

// The children of a node as the FLEX COLUMN sees them: React.Fragment is not a box, so it is flattened
// through, and the `{cond ? … : null}` arms that are closed contribute nothing.
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTROL — if this fails, every assertion below is meaningless.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the real DashSettings renders one page at a time, with its cards on it', () => {
  assert.match(texts(pageFor('identity')).join(' | '), /Church identity/,
    'the identity page no longer renders the church identity card — re-anchor this test');
  assert.match(texts(pageFor('key')).join(' | '), /Church key/,
    'the Church key page no longer renders the church-key card — re-anchor this test');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE PAGE IS A FLEX COLUMN, AND THE CARDS ARE ITS OWN CHILDREN. NOTHING PACKS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('every settings page is .set-page — never a packing grid, and never two of them', () => {
  for (const k of ALL_PAGES) {
    const page = pageFor(k);
    assert.equal(page.props.className, 'set-page',
      `the ${k} page is not .set-page. A masonry (column-width) or an auto-fit grid decides the reading and ` +
      'Tab order from the card heights, and .set-page is also the container every density rule measures — ' +
      'without it a browser gets the phone\'s roomy spacing on every card');
  }
});

test('the cards on a page are the page\'s own children, in the order they are written', () => {
  for (const k of ALL_PAGES) {
    const kids = boxes(pageFor(k));
    assert.ok(kids.length >= 1, `the ${k} page renders nothing at all`);
    for (const kid of kids) {
      // Nothing between the page and a card may carry a layout class of its own: a wrapper with a grid or a
      // column-count on it puts the browser back in charge of where the cards go.
      const cls = String((kid.props || {}).className || '');
      assert.doesNotMatch(cls, /sk-cols|net-grid|relay-grid|sk-masonry/,
        `the ${k} page has a ${cls} wrapper in it, so its cards are being packed again rather than placed`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. EACH CARD IS ON THE PAGE IT WAS AUTHORED ONTO — and, above all, IS STILL THERE. A card dropped while
//    moving it says nothing: the page simply renders without it.
//    (The exhaustive reconciliation — every panel on exactly one page, nothing orphaned — is
//    scripts/settings-pages-are-a-list-and-a-detail.test.mjs. This is the per-page table.)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const CARDS_ON = {
  identity: ['Panel:Church identity'],
  branding: ['DashBrandingPanel'],
  media: ['DashMediaPanel'],
  backup: ['DashBackup'],
  // Both come out of DashFeaturesPanel, which owns their shared state; `show` picks which one it renders.
  features: ['DashFeaturesPanel'],
  rules: ['DashFeaturesPanel'],
  tags: ['DashChatTagsPanel'],
  relays: ['DashRelaysCard'],
  'add-relay': ['DashAddRelayCard'],
  history: ['DashRelayHistoryCard'],
  ownbox: ['DashRunRelayCard'],
  network: ['DashNetworksPanel'],
  key: ['Panel:Church key'],
  stewards: ['Panel:Stewards & handoff'],
  delegated: ['DashStewardsPanel'],
  become: ['DashBecomeStewardPanel'],
};

test('the page table covers every page in the list, with nothing invented', () => {
  assert.deepEqual(Object.keys(CARDS_ON).sort(), [...ALL_PAGES].sort(),
    'the table below and the real navigation disagree about which pages exist. A page in the navigation and ' +
    'not in this table is a page nothing asserts about');
});

for (const [key, want] of Object.entries(CARDS_ON)) {
  test(`the ${key} page holds exactly the cards it is meant to`, () => {
    assert.deepEqual(boxes(pageFor(key)).map(cardId), want,
      `the ${key} page's cards are not the ones authored onto it. A card missing from this list is off the ` +
      'page entirely and nothing on screen says so');
  });
}

test('a delegated steward gets the one card they are allowed, and none of the owner-only ones', () => {
  const page = pageFor('access', { steward: { isDelegated: () => true } });
  assert.deepEqual(boxes(page).map(cardId), ['Panel:Security'],
    'a delegated steward’s Security page is not the one notice card. The church key, the recovery phrase, the ' +
    'blocklist and the steward roster belong to whoever holds the key');
});

test('the identity page leads with the church’s own identity, not with whatever fitted', () => {
  // Under the masonry this order was advisory at best: cards were packed by height, so which card came first
  // was a consequence of how tall they happened to be.
  assert.equal(cardId(boxes(pageFor('identity'))[0]), 'Panel:Church identity',
    'the first card on the identity page is no longer the church’s own identity');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE STYLESHEET SIDE. A declaration, not a behaviour: .set-page has to exist and be a flex column, and
//    every packing rule has to be GONE — a rule left behind is one a future card can pick up by accident.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const CSS = read('steward.html').replace(/\/\*[\s\S]*?\*\//g, '');   // comments explain the history; they are not rules

test('steward.html defines .set-page as a container-sized flex column', () => {
  const rule = CSS.match(/\.set-page\s*\{([^}]*)\}/);
  assert.ok(rule, '.set-page is not defined in steward.html, so the settings page has no layout at all');
  assert.match(rule[1], /display:\s*flex/, '.set-page is not a flex box');
  assert.match(rule[1], /flex-direction:\s*column/,
    '.set-page is not a column. A row, or a grid with more than one track, hands the browser back the decision ' +
    'about which card goes where — which is the whole defect this layout exists to end');
  assert.match(rule[1], /min-width:\s*0/, '.set-page has no min-width:0, so a wide card can push its track open');
  assert.match(rule[1], /container-type:\s*inline-size/,
    '.set-page is not a container, so the @container rules below measure nothing and every card in a browser ' +
    'falls back to the roomy phone spacing');
  assert.doesNotMatch(rule[1], /column-count|column-width|columns:/,
    '.set-page is a multi-column box again. The browser then picks the break point, and the reading order, the ' +
    'Tab order and the split all move whenever a card grows');
});

test('steward.html lays the list beside the page, and stacks them on a phone', () => {
  const shell = CSS.match(/\.set-shell\s*\{([^}]*)\}/);
  assert.ok(shell, '.set-shell is not defined, so the list and the page have nothing placing them');
  assert.match(shell[1], /display:\s*grid/, '.set-shell is not a grid');
  assert.match(shell[1], /grid-template-columns:\s*minmax\(/,
    '.set-shell no longer names its two tracks explicitly. auto-fit here would collapse the list into the page ' +
    'at widths where both are on screen');
  const one = CSS.match(/\.set-shell--one\s*\{([^}]*)\}/);
  assert.ok(one, '.set-shell--one is gone, so the phone gets the browser\'s two-track shell for its one child');
  assert.match(one[1], /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    '.set-shell--one is not a single track. On a phone only ONE of the list and the page is rendered, and in a ' +
    'two-track grid that one child sits in the narrow 236px track');
});

test('steward.html no longer packs the settings cards by any means', () => {
  for (const [sel, what] of [
    ['sk-masonry', 'the CSS multi-column masonry'],
    ['sk-cols', 'the two-track grid of authored stacks'],
    ['net-grid', 'the Network tab\'s own two-track grid'],
    ['relay-grid', 'the Relays card\'s two-across section grid'],
  ]) {
    assert.equal(new RegExp('\\.' + sel + '\\s*[>{,:]').test(CSS), false,
      `.${sel} is still a rule in steward.html — ${what}. It has no user left, and a packing rule lying about ` +
      'is one a future card can pick up by accident; that is why .sk-masonry was deleted rather than orphaned');
  }
  assert.equal(/column-count|column-width/.test(CSS), false,
    'a multi-column declaration is back in steward.html. Measured 2026-09-01: dead column space on ' +
    'Church / Features / Security was 469 / 488 / 799px for a masonry against 133 / 363 / 262px for authored ' +
    'positions, and the masonry also decided the reading and Tab order');
});

test('nothing in the settings layout is sized from the viewport', () => {
  const media = CSS.match(/@media[^{]*\{[^{}]*\.(set-page|set-shell|set-list|set-item)\b/);
  assert.equal(media, null,
    'a settings layout rule is inside an @media query. The panel sits inside a sidebar and a grid track, so ' +
    'the window’s width says nothing about its own — this is the mistake the deleted .relay-grid recorded, ' +
    'where a 1120px viewport query gave a card two ~150px columns at a 1130px window and broke every line to ' +
    'one word. Which surface is on screen is decided in JS (useStewNarrow), once.');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. THE DENSITY RULES ARE SIZED FROM THE CONTAINER, SO THE PHONE KEEPS ITS ROOMY LAYOUT.
//    Added 2026-09-08 with the compact pass and carried through the 2026-09-09 redesign unchanged. The
//    console ships in its OWN apk, where the roomier spacing is correct — the owner asked for the compact
//    pass in a BROWSER and has confirmed the phone twice. Everything compact therefore lives behind
//    @container, never @media: these cards sit inside a sidebar and a grid track, so the window width says
//    nothing about the room a card actually has. Verified in Chromium at both widths before the compact pass
//    merged — a 360px viewport computes 22px panel padding, a 1280px one computes 15px 17px.
//    steward.html is a served file, not JSX, so rule 3 does not apply and these read the rules themselves.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the compact settings rules are container queries, never viewport ones', () => {
  const compact = [...CSS.matchAll(/@container[^{]*\{([\s\S]*?)\n  \}/g)].map(m => m[1]).join('\n');
  assert.ok(compact, 'there is no @container block in steward.html — the density pass is gone');
  for (const sel of ['.sk-panel', '.set-row', '.set-desc', '.set-note']) {
    assert.ok(compact.includes(sel),
      `${sel} is no longer tightened inside @container. If it moved to @media, a phone-width CARD inside a ` +
      'wide window gets the compact spacing and a wide card inside a narrow one does not — which is the ' +
      'exact bug the deleted .relay-grid rule already recorded.');
  }
  const viewport = CSS.match(/@media[^{]*\{[^{}]*\.(sk-panel|set-row|set-desc|set-note)\b/);
  assert.equal(viewport, null,
    'a settings density rule is inside an @media query. The console ships in its own apk where the roomy ' +
    'layout is correct, and these elements live inside a sidebar and a grid track — size them from the ' +
    'container that holds them, not from the window.');
});

test('the container query does not fire below the threshold, and the threshold is above a phone page', () => {
  // THE PHONE LAYOUT IS CORRECT AND MUST NOT CHANGE. Measured on the console: a 1265px page is 199px of nav
  // plus 1033px of main, and on a phone the page the cards sit in is about 336px. So the one number that
  // decides whether a phone gets the compact spacing is this threshold, and it has to stay comfortably above
  // 336px — the assertion is on the NUMBER, because "it looked right" is what a re-tuned value costs.
  const q = [...CSS.matchAll(/@container\s*\(min-width:\s*(\d+)px\)/g)].map(m => Number(m[1]));
  assert.equal(q.length, 1, `expected one @container threshold for the settings density, found ${q.length}`);
  assert.ok(q[0] >= 400,
    `the density container query fires at ${q[0]}px. A settings page on a phone measures about 336px, so any ` +
    'threshold at or below that hands the phone the compact spacing the owner has twice said is wrong');
  assert.ok(q[0] <= 560,
    `the density container query fires at ${q[0]}px, which a page in a browser (about 770px) still clears — ` +
    'but only just. Re-measure before raising it further.');
});

test('the roomy spacing is the DEFAULT, so a narrow page is never compacted by accident', () => {
  for (const [sel, prop] of [['.sk-panel', /padding:\s*22px/], ['.set-row', /padding:\s*11px 13px/],
                             ['.set-desc', /font-size:\s*12\.5px/]]) {
    const base = CSS.match(new RegExp('\\n  \\' + sel + '\\s*\\{([^}]*)\\}'));
    assert.ok(base, sel + ' has no base rule outside the container query, so a browser without container ' +
      'query support (or any card under the threshold) gets no spacing at all');
    assert.match(base[1], prop, sel + "'s roomy default changed — that value is what the phone renders");
  }
  // and the card title, which is the third of the three sizes the owner approved on the phone
  const h2 = CSS.match(/@container[^{]*\{[\s\S]*?\.sk-panel h2\s*\{([^}]*)\}/);
  assert.ok(h2, '.sk-panel h2 is no longer sized inside the container query');
  assert.match(h2[1], /font-size:\s*15px/,
    'the compact card title is no longer 15px. The phone default is Panel’s own inline 16.5px, and this rule ' +
    'is the only thing that changes it — moving the 15px out of @container would apply it everywhere');
});
