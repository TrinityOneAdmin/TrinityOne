// The Overview's "People have signed up to help" card folds behind a chevron (owner 2026-10-19: FOLD ONLY, no dismiss).
// Run: node --test scripts/overview-signups-card-collapses.test.mjs
//
// Users of the changed code (rule 2): careSignupBanner in DashOverview (app/stew-dashboard.jsx) is the only thing edited; it is
// drawn at three layout sites (narrow, snug, wide) from ONE const and ONE state flag (signupsOpen). Panel, careSignupSummary and
// the other banners are untouched. The sign-up card is steward-console only (no member-app screen draws it).
//
// HOW IT ASSERTS (rule 3): the REAL DashOverview is rendered through the mini-React with the REAL careSignupSummary; the tap is the
// real onClick found on the chevron, then the screen is drawn again. Nothing is matched in source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const MEALS_JSX = readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const ADULT = 'a'.repeat(64), SECOND = 'b'.repeat(64), THIRD = 'c'.repeat(64);

function overview({ narrow = false, badStore = false } = {}) {
  const { React, draw } = miniReact();
  const needs = [{ id: 'n1', displayLabel: 'Verity - a lift', endDate: '2026-11-01' }];
  // `slots`/`dir` are mutable so a test can simulate a responder signing up or being swapped out between redraws.
  let slots = [{ needId: 'n1', pubkey: ADULT, isoDate: '2026-10-20' }, { needId: 'n1', pubkey: SECOND, isoDate: '2026-10-21' }];
  let dir = { [ADULT]: { name: 'Callum' }, [SECOND]: { name: 'Desmond' }, [THIRD]: { name: 'Esther' } };
  const clicks = [];
  // A real little store so a dismiss actually persists (and can be read back); `badStore` makes both ops throw.
  const store = {};
  const localStorage = badStore
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: (k) => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); } };
  const win = {
    Steward: { joinUrl: () => 'https://x/?follow=npub1abc', qrSVG: () => '<svg></svg>', churchPub: 'churchpub1' },
    useStewardRelays: () => [], useStewardGroups: () => [], useStewardMembers: () => [], useStewardRosters: () => [],
    useStewardStats: () => ({ events: 0, announcements: 0 }), useStewardActivity: () => [],
    useStewardChurch: () => ({ name: 'St X', npub: 'npub1abc', features: {} }), useStewardConn: () => 0, useStewardStewards: () => [],
    useMealsSettings: () => ({ enabled: true }), useMealsNeeds: () => needs, useMealsSlots: () => slots,
    useStewardDirectory: () => dir,
    StewardMeals: { subscribeCareRequests: () => () => {} }, todayISO: () => '2026-10-15',
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage,
  };
  new Function('window', `const needTitle = (need) => need.displayLabel || 'A member in our church';\n` + fnBody(MEALS_JSX, 'function careSignupSummary(', 'careSignupSummary') + '\nwindow.careSignupSummary = careSignupSummary;')(win);
  const proxied = new Proxy(win, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('useSteward')) return () => []; return undefined; }, has: () => true });
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashOverview'], {
    React, window: proxied, localStorage: win.localStorage,
    Icon: function Icon(p) { return { type: 'icon', props: p, kids: [] }; },
    SkBadge: Stub('SkBadge'), SkToggle: Stub('SkToggle'), SkPill: Stub('SkPill'), SkConfirm: Stub('SkConfirm'),
    DismissibleNote: Stub('DismissibleNote'), StewHelpLink: Stub('StewHelpLink'), DashMealsPanel: Stub('DashMealsPanel'), DashMannaPanel: Stub('DashMannaPanel'),
    Halo: Stub('Halo'), SkKey: Stub('SkKey'), SkQR: Stub('SkQR'), StewVersion: Stub('StewVersion'), NetworkAnnounceComposer: Stub('NetworkAnnounceComposer'), ConsoleChrome: Stub('ConsoleChrome'), StewHelpButton: Stub('StewHelpButton'),
    WizMeetings: Stub('WizMeetings'), _wizMeetingId: () => 'evt1', churchHandle: () => 'grace', stewCapState: () => ({ allowed: true }), location: { host: 'x', hostname: 'x' }, navigator: { userAgent: '' }, document: { addEventListener() {}, removeEventListener() {} },
    setInterval, clearInterval, console, fetch: async () => ({ ok: false, json: async () => ({}) }),
    SK_TINT: { clay: {}, gold: {}, sage: {}, ink: {} }, useStewDialog: () => ({ current: null }), useStewNarrow: () => narrow, todayISO: () => '2026-10-15', CustomEvent,
    useGoPublicGate: () => ({}), copyText() {},
  });
  return { redraw: () => draw(mod.DashOverview, { onTab: (t) => clicks.push(t), onNewPost() {}, onSettings() {} }), clicks, store, setSlots: (s) => { slots = s; } };
}

const chevron = (tree) => find(tree, n => n.props && /(Collapse|Expand) sign-ups/.test(String(n.props['aria-label'])));
const dismiss = (tree) => find(tree, n => n.props && /Dismiss sign-ups/.test(String(n.props['aria-label'])));
const heading = 'People have signed up to help';
const cardShown = (tree) => texts(tree).includes(heading);
const namesShown = (tree) => texts(tree).join('|').includes('Callum, Desmond');
const iconOf = (el) => find(el, n => n.type === 'icon')[0].props.name;

for (const narrow of [false, true]) {
  test(`(narrow=${narrow}) the sign-ups card has a chevron, open by default, naming who signed up`, () => {
    const tree = overview({ narrow }).redraw();
    assert.equal(chevron(tree).length, 1, 'no collapse control on the sign-ups card');
    assert.equal(chevron(tree)[0].props['aria-expanded'], true);
    assert.equal(iconOf(chevron(tree)[0]), 'chevD');
    assert.ok(namesShown(tree), 'control: names show while expanded');
  });

  test(`(narrow=${narrow}) tapping the chevron hides the names but keeps the heading; tapping again restores`, () => {
    const o = overview({ narrow });
    let tree = o.redraw();
    let stopped = false;
    chevron(tree)[0].props.onClick({ stopPropagation() { stopped = true; } });
    assert.ok(stopped, 'must stop the tap reaching the card, or folding would also open Care');
    tree = o.redraw();
    assert.equal(namesShown(tree), false, 'names still shown after collapsing');
    assert.ok(texts(tree).includes('People have signed up to help'), 'heading must stay when collapsed');
    assert.equal(chevron(tree)[0].props['aria-expanded'], false);
    assert.equal(iconOf(chevron(tree)[0]), 'chevU');
    chevron(tree)[0].props.onClick({ stopPropagation() {} });
    tree = o.redraw();
    assert.ok(namesShown(tree));
    assert.equal(iconOf(chevron(tree)[0]), 'chevD');
    assert.deepEqual(o.clicks, [], 'folding must not navigate');
  });

  // The dismiss X is a SECOND control, distinct from the fold chevron: it hides the whole card, not just the names.
  test(`(narrow=${narrow}) tapping the dismiss X hides the whole card without navigating`, () => {
    const o = overview({ narrow });
    let tree = o.redraw();
    assert.equal(dismiss(tree).length, 1, 'no dismiss control on the sign-ups card');
    assert.ok(cardShown(tree), 'control: card shows before dismiss');
    let stopped = false;
    dismiss(tree)[0].props.onClick({ stopPropagation() { stopped = true; } });
    assert.ok(stopped, 'dismiss must stop the tap reaching the card, or it would also open Care');
    tree = o.redraw();
    assert.equal(cardShown(tree), false, 'the whole card must be gone after dismiss');
    assert.deepEqual(o.clicks, [], 'dismissing must not navigate');
  });

  // THE SWAP CASE (audit correction): after a dismiss, one responder is REPLACED by another on the same need — the
  // count is unchanged (two either way), but a new person has answered, so the card MUST reappear. This fails if the
  // dismiss is a boolean-hidden flag, or if the signature is count-based (needId + names.length) rather than keyed
  // on the actual responders.
  test(`(narrow=${narrow}) after dismiss, a swapped responder (same count) brings the card back`, () => {
    const o = overview({ narrow });
    let tree = o.redraw();
    dismiss(tree)[0].props.onClick({ stopPropagation() {} });
    tree = o.redraw();
    assert.equal(cardShown(tree), false, 'card hidden immediately after dismiss');
    // Desmond cancels, Esther signs up to the SAME need — still two responders, so a count signature is unchanged.
    o.setSlots([{ needId: 'n1', pubkey: ADULT, isoDate: '2026-10-20' }, { needId: 'n1', pubkey: THIRD, isoDate: '2026-10-22' }]);
    tree = o.redraw();
    assert.ok(cardShown(tree), 'a new responder (same count) must bring the card back — not a count/boolean dismiss');
  });
}

// A thrown localStorage (private window, blocked site data) must not crash the Overview: the card still renders.
test('a localStorage that throws does not crash the sign-ups card', () => {
  const o = overview({ badStore: true });
  let tree;
  assert.doesNotThrow(() => { tree = o.redraw(); }, 'reading the ack must be caught');
  assert.ok(cardShown(tree), 'the card still renders when localStorage is unreadable');
  assert.doesNotThrow(() => { dismiss(tree)[0].props.onClick({ stopPropagation() {} }); }, 'writing the ack must be caught');
  // The dismiss still works via in-memory state even though the write threw.
  tree = o.redraw();
  assert.equal(cardShown(tree), false, 'dismiss works from state even when the write throws');
});
