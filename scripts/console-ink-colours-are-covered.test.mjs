// THE CONSOLE'S READABLE-COLOUR SWEEP, ACTUALLY COVERED.
// Run: node --test scripts/console-ink-colours-are-covered.test.mjs
//
// bbdf924 moved ~90 colour sites off the bare brand tokens: white on --clay measures 4.36:1 and --clay on a
// card 4.29:1, both under WCAG 1.4.3's 4.5:1 floor, so text and button fills now use --clay-ink (5.88:1 on
// white, 5.78:1 on a card) and --sage-ink (5.33:1 on a card, against --sage's 3.80:1). The test that shipped
// with it (scripts/console-settings-a11y.test.mjs:246) sweeps the rendered cards for a leftover bare token,
// and an audit of that commit reverted 27 of those sites one at a time: 25 of the 27 left all 28 tests
// green. Two reasons, both structural:
//
//   1. the cards render in ONE state — an empty church, no relays, no status messages — so nearly every
//      site sits inside a branch the sweep never executes. DashRelaysCard alone has 15 token uses and the
//      old sweep reached ZERO of them, because with `useStewardRelays: () => []` there is no relay row, no
//      health line, no backup warning and no message from any of its six async actions.
//   2. the sweep only looks at 8 components in ONE of the TEN files bbdf924 touched. The other nine had no
//      colour assertion of any kind.
//
// This file closes both holes with two independent mechanisms, and is explicit about which is which:
//
//   PART 1 is BEHAVIOURAL. It renders the real DashRelaysCard through the miniature React in
//   render-jsx-screen.mjs and asserts the colour that ARRIVES ON SCREEN at 14 of its 15 token uses: relays
//   online / offline / still checking, one relay box vs two, and the success and failure line of each
//   status message, each one produced by pressing the card's own button and letting its own handler run.
//   Real code runs and the ternaries are evaluated, so `false && ` in front of a branch fails it. (The 15th
//   is the ✓ arm of the register message, which the card itself unmounts in the same turn — see the note
//   above that test.)
//
//   PART 2 is A LINT OVER SOURCE TEXT, and claims nothing about behaviour. CLAUDE.md rule 3 is the trap
//   here: app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves every word of it in
//   place and a text-matching assertion still passes. So Part 2 deliberately asserts only about
//   DECLARATIONS — "which colour tokens are written into `color:` and `background:` in these ten files" —
//   which is a fact about the source and is true whether or not the branch ever runs. It cannot and does
//   not prove that any of it is on screen. That is Part 1's job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileScreen, miniReact, find, texts, button } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const styleOf = (n) => (n.props && n.props.style) || {};
const BARE = new Set(['var(--clay)', 'var(--sage)']);

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// PART 1 — RENDERED. The real component, real branches, real handlers.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

const JS = compileScreen('app/stew-dashboard.jsx');

// Everything DashRelaysCard takes from outside its own file. A name it needs that is not here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends
// up asserting about something that is not the code. Panel is the REAL Panel from the same file; the only
// stubs are furniture from other app files (Icon, SkPill from stew-data.jsx) and the browser.
function relaysCard({ relays = [], backup = null, steward = {}, rejected = false } = {}) {
  const { React, draw } = miniReact();
  const listeners = new Map();
  const store = new Map();
  if (rejected) store.set('trinityone.steward.relay-rejected', String(Date.now()));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const win = {
    useStewardRelays: () => relays,
    addEventListener(t, f) { (listeners.get(t) || listeners.set(t, []).get(t)).push(f); },
    removeEventListener(t, f) { const a = listeners.get(t) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatchEvent(e) { (listeners.get(e && e.type) || []).slice().forEach(f => f(e)); return true; },
    localStorage,
    Steward: {
      ownRelay: () => 'wss://relay.grace.example/relay',
      backupState: async () => { if (backup === null) throw new Error('no backup state'); return backup; },
      addRelay: () => '',
      removeRelay: () => {},
      rememberRelayName: () => {},
      ...steward,
    },
  };
  const globals = {
    React, window: win, localStorage,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' },
    navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    // furniture from other app files
    Icon: function Icon() { return null; },
    SkPill: function SkPill() { return null; },
    SkBadge: function SkBadge() { return null; },
    useStewDialog: () => ({ current: null }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashRelaysCard, Panel };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashRelaysCard, 'function', 'DashRelaysCard is not a component any more — re-anchor this test');
  assert.equal(typeof mod.Panel, 'function', 'Panel is not a component any more — re-anchor this test');
  return { draw: () => draw(mod.DashRelaysCard, {}), win };
}

// setImmediate drains the whole microtask queue first, so one hop is enough for the card's promise chains
// (backupState, syncEnable, resolveRelayName → registerAtRelay, cloneFromRelay, registerWithRelay).
const settle = () => new Promise(r => setImmediate(r));

// The card loads its backup state in an effect, so a state that depends on it needs a draw, a settle and a
// redraw before anything it gates is on screen.
async function paint(card) { card.draw(); await settle(); return card.draw(); }

const said = (n) => texts(n).join('').replace(/\s+/g, ' ').trim();
// A node whose own visible text matches, ignoring the containers that merely contain it.
const smallest = (tree, re) => {
  const all = find(tree, n => typeof n.type === 'string' && re.test(said(n)));
  const uniq = [...new Set(all)];
  return uniq.sort((a, b) => said(a).length - said(b).length)[0];
};

const ONE_UP_ONE_DOWN = [
  { url: 'wss://relay.grace.example/relay', status: 'on', ms: 21 },
  { url: 'wss://nos.lol', status: 'off' },
];

test('CONTROL: the real DashRelaysCard renders, and its relay rows reach the screen', async () => {
  const tree = await paint(relaysCard({ relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 2, syncOn: true } }));
  const all = said(tree);
  assert.match(all, /Where your church publishes/, 'DashRelaysCard no longer renders its blurb — re-anchor this test');
  assert.match(all, /wss:\/\/nos\.lol/, 'the relay list is not rendering a row per relay, so nothing below is being measured');
  assert.match(all, /Offline/);
  assert.match(all, /Answering/);   // was "Live"; renamed 2026-09-08 because answering a socket is not accepting a write
});

test('a relay that is DOWN says so in --clay-ink, and one that is up in --sage-ink', async () => {
  const tree = await paint(relaysCard({ relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 1, syncOn: true } }));
  const off = smallest(tree, /^Offline$/);
  const on = smallest(tree, /^Answering$/);
  assert.ok(off && on, 'the per-relay health line is gone — re-anchor this test');
  assert.equal(styleOf(off).color, 'var(--clay-ink)',
    '"Offline" is the one word on this card that tells a steward their church is unreachable, and it is ' +
    'painted ' + styleOf(off).color + '. --clay measures 4.29:1 on a card, under the 4.5:1 floor');
  assert.equal(styleOf(on).color, 'var(--sage-ink)',
    '"Answering" is painted at ' + styleOf(on).color + '; --sage measures 3.80:1 as text');
  // the globe chip beside the live relay, which is a separate site in the same row
  const chip = find(tree, n => n.type === 'div' && styleOf(n).width === 26 && styleOf(n).height === 26);
  assert.equal(chip.length, 2, 'expected one globe chip per relay row — re-anchor this test');
  assert.equal(styleOf(chip[0]).color, 'var(--sage-ink)', 'the live relay’s globe chip is painted ' + styleOf(chip[0]).color);
});

test('the "N/N online" count in the card header is --clay-ink when a relay is down, --sage-ink when all are up', async () => {
  const down = await paint(relaysCard({ relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 1, syncOn: true } }));
  const bad = smallest(down, /online$/);
  assert.ok(bad, 'the header count is gone — re-anchor this test');
  assert.equal(said(bad), '1/2 online');
  assert.equal(styleOf(bad).color, 'var(--clay-ink)', 'the "1/2 online" header is painted ' + styleOf(bad).color);

  const allUp = await paint(relaysCard({
    relays: ONE_UP_ONE_DOWN.map(r => ({ ...r, status: 'on' })), backup: { boxes: 2, online: 2, syncOn: true },
  }));
  const good = smallest(allUp, /online$/);
  assert.equal(said(good), '2/2 online');
  assert.equal(styleOf(good).color, 'var(--sage-ink)', 'the "2/2 online" header is painted ' + styleOf(good).color);
});

test('the single-point-of-failure warning is legible', async () => {
  const tree = await paint(relaysCard({ relays: [ONE_UP_ONE_DOWN[0]], backup: { boxes: 1, online: 1, syncOn: false } }));
  assert.match(said(tree), /One relay is a single point of failure/,
    'the one-relay warning did not render, so its colour is not being measured');
  const warn = smallest(tree, /^⚠$/);
  assert.ok(warn, 'the ⚠ glyph is gone — re-anchor this test');
  assert.equal(styleOf(warn).color, 'var(--clay-ink)', 'the ⚠ is painted ' + styleOf(warn).color);
});

test('the "enter a relay address" error under the Add box is legible', async () => {
  const card = relaysCard({ relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 2, syncOn: true } });
  const tree = await paint(card);
  const add = button(tree, 'Add relay').filter(b => b.props.onClick);
  assert.equal(add.length, 1, 'the Add relay button is gone — re-anchor this test');
  add[0].props.onClick();                       // Steward.addRelay returns '' → the card sets its error
  const after = card.draw();
  const err = smallest(after, /^Enter a relay address/);
  assert.ok(err, 'pressing Add relay with an empty box no longer says anything');
  assert.equal(styleOf(err).color, 'var(--clay-ink)', 'the add-relay error is painted ' + styleOf(err).color);
});

test('the connect-by-name result is legible whether it worked or failed', async () => {
  for (const [ok, resolve, expect, re] of [
    [true, async () => ({ url: 'wss://grace-city.example' }), 'var(--sage-ink)', /^✓ Connected/],
    // C5: a null resolve no longer means only "no such name" — the resolver also refuses a cleartext answer
    // and an address this church has not signed into its network, and telling a steward their relay "is not
    // registered" would be a plain untruth in those two cases (memory: fix-the-control-not-the-label).
    [false, async () => null, 'var(--clay-ink)', /^✗ Couldn’t use/],
  ]) {
    const card = relaysCard({
      relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 2, syncOn: true },
      steward: { resolveRelayName: resolve, addRelay: () => 'wss://grace-city.example', registerAtRelay: async () => ({ ok: true }) },
    });
    const tree = await paint(card);
    const input = find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Relay name to connect to');
    assert.equal(input.length, 1, 'the connect-by-name field is gone — re-anchor this test');
    input[0].props.onChange({ target: { value: 'grace-city' } });
    const go = button(card.draw(), 'Connect').filter(b => b.props['aria-label'] === 'Connect to relay by name');
    assert.equal(go.length, 1, 'the Connect button is gone — re-anchor this test');
    go[0].props.onClick();
    await settle();
    const msg = smallest(card.draw(), re);
    assert.ok(msg, `the connect-by-name ${ok ? 'success' : 'failure'} message did not render`);
    assert.equal(styleOf(msg).color, expect, `the connect-by-name ${ok ? 'success' : 'failure'} line is painted ${styleOf(msg).color}`);
  }
});

test('the copy-your-history result is legible whether it worked or failed', async () => {
  for (const [clone, expect, re] of [
    [async () => ({ imported: 12 }), 'var(--sage-ink)', /^✓ Copied/],
    [async () => { throw new Error('relay refused'); }, 'var(--clay-ink)', /^✗ relay refused/],
  ]) {
    const card = relaysCard({
      relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 2, syncOn: true },
      steward: { cloneFromRelay: clone },
    });
    const tree = await paint(card);
    const input = find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Relay to copy your history from');
    assert.equal(input.length, 1, 'the clone-source field is gone — re-anchor this test');
    input[0].props.onChange({ target: { value: 'wss://old.example.com' } });
    const go = button(card.draw(), 'Copy across');
    assert.equal(go.length, 1, 'the Copy across button is gone — re-anchor this test');
    go[0].props.onClick();
    await settle();
    const msg = smallest(card.draw(), re);
    assert.ok(msg, 'the clone result message did not render');
    assert.equal(styleOf(msg).color, expect, `the clone result line is painted ${styleOf(msg).color}`);
  }
});

test('the keep-your-relays-in-sync result is legible whether it worked or failed', async () => {
  for (const [enable, expect, re] of [
    [async () => ({ relays: 2 }), 'var(--sage-ink)', /^✓ Sync on/],
    [async () => { throw new Error('Couldn’t update sync.'); }, 'var(--clay-ink)', /^Couldn’t update sync\./],
  ]) {
    const card = relaysCard({
      relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 2, syncOn: false },
      steward: { syncEnable: enable },
    });
    const tree = await paint(card);
    const go = button(tree, 'Turn on sync');
    assert.equal(go.length, 1, 'the "Turn on sync" button did not render for a church with two relay boxes');
    go[0].props.onClick();
    await settle();
    const msg = smallest(card.draw(), re);
    assert.ok(msg, 'the sync result message did not render');
    assert.equal(styleOf(msg).color, expect, `the sync result line is painted ${styleOf(msg).color}`);
  }
});

// Only the ✗ arm is reachable from the screen: on success the card calls clearRelayRejection(), whose
// 'steward-relay-cleared' event sets regNeeded false in the same turn, so the whole panel — the ✓ line
// included — is gone by the next paint. The ✓ arm's colour is held by the source lint in Part 2 instead.
test('the relay-is-refusing-our-posts failure is legible', async () => {
  const card = relaysCard({
    relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 2, syncOn: true }, rejected: true,
    steward: { registerWithRelay: async () => { throw new Error('Couldn’t reach the relay.'); } },
  });
  const tree = await paint(card);
  const open = button(tree, 'A relay is refusing our posts');
  assert.equal(open.length, 1, 'the refusing-posts control did not render for a church with a live rejection');
  open[0].props.onClick();
  const opened = card.draw();
  const input = find(opened, n => n.type === 'input' && n.props['aria-label'] === 'Relay admin token');
  assert.equal(input.length, 1, 'the admin-token field is gone — re-anchor this test');
  input[0].props.onChange({ target: { value: 'tok' } });
  const go = button(card.draw(), 'Register').filter(b => b.props.onClick && !b.props['aria-label']);
  assert.equal(go.length, 1, 'the Register button is gone — re-anchor this test');
  go[0].props.onClick();
  await settle();
  const msg = smallest(card.draw(), /^✗ Couldn’t reach the relay\.$/);
  assert.ok(msg, 'the register failure message did not render');
  assert.equal(styleOf(msg).color, 'var(--clay-ink)', 'the register failure line is painted ' + styleOf(msg).color);
});

// Every state above, swept in one pass. This is the guard against a NEW site being added on a bare token
// inside a branch nobody thought to assert on individually — and, unlike the old sweep, the branches it
// walks have actually been executed.
test('across every state this card can be in, nothing on screen is TEXT painted --clay or --sage', async () => {
  const trees = [];
  const collect = async (opts, drive) => {
    const card = relaysCard(opts);
    const t = await paint(card);
    if (drive) { await drive(card, t); trees.push(card.draw()); } else trees.push(t);
  };
  await collect({ relays: [], backup: null });                                              // checking…
  await collect({ relays: ONE_UP_ONE_DOWN, backup: { boxes: 1, online: 1, syncOn: false } });
  await collect({ relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 1, syncOn: true } });
  await collect({ relays: ONE_UP_ONE_DOWN.map(r => ({ ...r, status: 'on' })), backup: { boxes: 2, online: 2, syncOn: false } });
  await collect({ relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 2, syncOn: true }, rejected: true });
  await collect(
    { relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 2, syncOn: true }, steward: { addRelay: () => 'wss://nos.lol' } },
    (card, t) => { button(t, 'Add relay').filter(b => b.props.onClick)[0].props.onClick(); });
  await collect(
    { relays: ONE_UP_ONE_DOWN, backup: { boxes: 2, online: 2, syncOn: true }, steward: { autoPickRelays: async () => [] } },
    async (card, t) => { button(t, 'Auto-find relays for me')[0].props.onClick(); await settle(); });

  assert.ok(trees.length === 7, 'a state was dropped from the sweep');
  const bad = [];
  for (const t of trees) {
    for (const n of find(t, () => true)) {
      const c = styleOf(n).color;
      if (BARE.has(c)) bad.push(String(n.type) + ' “' + said(n).slice(0, 40) + '” → ' + c);
    }
  }
  assert.deepEqual(bad, [],
    '--clay on a card measures 4.29:1 and --sage 3.80:1, both under the 4.5:1 floor; --clay-ink and --sage-ink ' +
    'are already in the palette and measure 5.78:1 and 5.33:1 there');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// PART 2 — A LINT OVER SOURCE TEXT. READ THE HEADER OF THIS FILE BEFORE ADDING TO IT.
//
// These two tests make NO claim that any of this reaches a screen. app/*.jsx ships unbundled, so text is
// still text inside a branch that never runs (CLAUDE.md rule 3). What they assert is a fact about the
// SOURCE and is true either way: which colour tokens are written into `color:` / `background:` in the ten
// files bbdf924 touched. Part 1 is what proves the rendered half.
//
// Together they close both directions of a revert:
//   · every revert REMOVES a `--clay-ink`/`--sage-ink` use from some file  → the floor test below;
//   · every revert ADDS a bare `var(--clay)`/`var(--sage)` in a colour position → the inventory test.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

// The ten files the sweep in bbdf924 touched (its own commit message lists them).
const SWEPT = ['app/stew-custody.jsx', 'app/stew-dashboard.jsx', 'app/stew-data.jsx', 'app/stew-extension.jsx',
  'app/stew-manna.jsx', 'app/stew-meals.jsx', 'app/stew-modal.jsx', 'app/stew-relay.jsx',
  'app/stew-schedule.jsx', 'steward.html'];

// Pull out every `color:` / `background:` declaration with its value. The value runs to the first comma,
// semicolon, newline or closing bracket at nesting depth zero, so `color-mix(in oklab, var(--clay) 8%, …)`
// and a nested ternary come out whole rather than being cut at their first comma.
function colourDecls(src) {
  const out = [];
  const re = /\b(color|background|backgroundColor|background-color)\s*:/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0, v = '';
    for (let i = re.lastIndex; i < src.length; i++) {
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
      else if ((c === ',' || c === ';' || c === '\n') && depth === 0) break;
      v += c;
    }
    out.push({ prop: m[1], value: v.trim().replace(/\s+/g, ' ') });
  }
  return out;
}

// A tint is not a fill: `color-mix(in oklab, var(--clay) 8%, var(--surface))` is a pale wash behind dark
// text and has nothing to do with the 4.5:1 floor, so the bare-token test looks past it.
const withoutTints = (v) => v.replace(/color-mix\([^)]*\)/g, '').replace(/linear-gradient\([^)]*\)/g, '');
const usesBare = (v) => /var\(--(clay|sage)\)/.test(withoutTints(v));

// How many times each file names --clay-ink or --sage-ink today, counted as raw occurrences so that the
// handful outside a `color:`/`background:` declaration (an <Icon color=…> prop, a border, three
// intermediate variables) are covered too. This is a FLOOR, not an equality: adding more is fine, and
// every single-site revert drops one file below its number. 211 across the ten files.
const INK_FLOOR = [
  ['app/stew-custody.jsx', 1], ['app/stew-dashboard.jsx', 147], ['app/stew-data.jsx', 1],
  ['app/stew-extension.jsx', 2], ['app/stew-manna.jsx', 13], ['app/stew-meals.jsx', 20],
  ['app/stew-modal.jsx', 1], ['app/stew-relay.jsx', 7], ['app/stew-schedule.jsx', 17], ['steward.html', 2],
];

test('LINT: no file loses a --clay-ink / --sage-ink colour it has today', () => {
  const low = [];
  assert.deepEqual(INK_FLOOR.map(e => e[0]), SWEPT, 'the ink floor and the swept-file list disagree');
  for (const [f, floor] of INK_FLOOR) {
    const n = (read(f).match(/var\(--(?:clay|sage)-ink\)/g) || []).length;
    if (n < floor) low.push(`${f}: ${n} readable-token colours, was ${floor}`);
  }
  assert.deepEqual(low, [],
    'a colour that was moved to the readable token has gone back to the bare one. White on --clay is 4.36:1 ' +
    'and --clay on a card 4.29:1, both under WCAG 1.4.3’s 4.5:1. If you deliberately removed a site, lower its ' +
    'number in INK_FLOOR in the same commit and say why (CLAUDE.md rule 8).');
});

// The complete inventory of bare --clay / --sage still written into a `color:` or `background:` in these ten
// files: [how many, exactly what]. These are the sites bbdf924 did NOT move — mostly non-text graphics that
// the 4.5:1 floor does not govern (status dots, toggle tracks, progress bars, a step rail), plus the
// TrinityOne wordmark, which WCAG 1.4.3 exempts as a logotype. It is NOT a certificate that every entry is
// correct; it is a fixed baseline, so that a colour going back to a bare token shows up as an entry that
// was not here before.
const BARE_INVENTORY = [
  ['app/stew-custody.jsx', []],
  ['app/stew-dashboard.jsx', [
    [3, "background: 'var(--clay)'"],
    [3, "background: 'var(--sage)'"],
    [1, "background: allUp ? 'var(--sage)' : 'var(--clay)'"],
    [1, "background: approval ? 'var(--clay)' : 'var(--line)'"],
    [1, "background: church.giving ? 'var(--sage)' : 'var(--line)'"],
    [1, "background: composeEvt ? 'var(--clay-soft)' : 'var(--clay)'"],
    [1, "background: encOn ? 'var(--clay)' : 'var(--line)'"],
    [1, "background: freq === k ? 'var(--clay)' : 'transparent'"],
    [1, "background: fullName ? 'var(--sage)' : 'var(--line)'"],
    [1, "background: i <= step ? 'var(--clay)' : 'var(--line)'"],
    [1, "background: kidPhotosOn ? 'var(--clay)' : 'var(--line)'"],
    [2, "background: m.mine ? 'var(--clay)' : 'var(--surface-2)'"],
    [2, "background: on ? 'var(--clay)' : 'transparent'"],
    [1, "background: on ? 'var(--clay)' : 'var(--surface)'"],
    [1, "background: on ? 'var(--clay)' : 'var(--surface-2)'"],
    [3, "background: on ? 'var(--sage)' : 'transparent'"],
    [1, "background: on(k) ? 'var(--sage)' : 'var(--line)'"],
    [1, "background: onOpt(k) ? 'var(--sage)' : 'var(--line)'"],
    [1, "background: photosOn ? 'var(--clay)' : 'var(--line)'"],
    [1, "background: pinnedId === s.id ? 'var(--clay)' : 'var(--surface)'"],
    [1, "background: restoreTarget === k ? 'var(--clay)' : 'transparent'"],
    [1, "background: up ? 'var(--sage)' : 'var(--clay)'"],
    [2, "color: 'var(--clay)'"],                            // the "One" of the TrinityOne wordmark, twice
  ]],
  ['app/stew-data.jsx', []],
  ['app/stew-extension.jsx', [
    [1, "background: 'var(--clay)'"],
    [1, "background: 'var(--sage)'"],
    [1, "background: i < 4 ? 'var(--clay)' : 'var(--line)'"],
  ]],
  ['app/stew-manna.jsx', [
    [2, "background: 'var(--clay)'"],
    [3, "background: 'var(--sage)'"],
    [1, "background: active ? 'var(--sage)' : 'var(--line)'"],
    [1, "background: on ? 'var(--clay)' : 'transparent'"],
    [1, "background: vs.ok ? 'var(--sage)' : 'var(--ink-3)'"],
  ]],
  ['app/stew-meals.jsx', [
    [1, "background: 'var(--clay)'"],
    [1, "background: active ? 'var(--sage)' : 'var(--line)'"],
    [1, "background: m.mine ? 'var(--clay)' : 'var(--surface-2)'"],
    [1, "background: on ? 'var(--clay)' : 'var(--surface)'"],
    [1, "background: s.openedBy === k ? 'var(--clay)' : 'var(--surface)'"],
    [1, "background: s.visibility === k ? 'var(--clay)' : 'var(--surface)'"],
    [1, "background: type === k ? 'var(--clay)' : 'var(--surface)'"],
  ]],
  ['app/stew-modal.jsx', []],
  ['app/stew-relay.jsx', [
    [1, "background: 'var(--clay)'"],
  ]],
  ['app/stew-schedule.jsx', [
    [2, "background: c.total && c.filled === c.total ? 'var(--sage)' : 'var(--gold)'"],
    [1, "background: gaps ? 'linear-gradient(90deg, var(--sage), var(--gold))' : 'var(--sage)'"],
    [1, "background: isPublished ? 'var(--sage)' : undefined"],
  ]],
  ['steward.html', []],
];

test('LINT: no colour in the swept files has gone back to a bare --clay / --sage', () => {
  assert.deepEqual(BARE_INVENTORY.map(e => e[0]), SWEPT, 'the inventory and the swept-file list disagree');
  const wrong = [];
  for (const [f, expected] of BARE_INVENTORY) {
    const now = new Map();
    for (const d of colourDecls(read(f))) {
      if (!usesBare(d.value)) continue;
      const k = d.prop + ': ' + d.value;
      now.set(k, (now.get(k) || 0) + 1);
    }
    const want = new Map(expected.map(([n, k]) => [k, n]));
    for (const [k, n] of now) {
      const w = want.get(k) || 0;
      if (n > w) wrong.push(`${f}: ${n - w} NEW · ${k}`);
    }
    for (const [k, w] of want) {
      const n = now.get(k) || 0;
      if (n < w) wrong.push(`${f}: ${w - n} GONE · ${k}`);
    }
  }
  assert.deepEqual(wrong, [],
    'NEW means a colour is written with a bare brand token where it was not before — white on --clay is ' +
    '4.36:1 and --clay on a card 4.29:1, under WCAG 1.4.3’s 4.5:1; use --clay-ink (5.88:1 on white) or ' +
    '--sage-ink. ' +
    'GONE means an entry in BARE_INVENTORY no longer exists: if you improved or deleted that site, delete ' +
    'its line here in the same commit (CLAUDE.md rule 8).');
});
