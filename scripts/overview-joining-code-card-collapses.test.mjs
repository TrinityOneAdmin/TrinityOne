// The Overview's "Joining code" card folds away behind a chevron in its header (owner 2026-10-14, cosmetic #6).
// Run: node --test scripts/overview-joining-code-card-collapses.test.mjs
//
// Users of the changed code (rule 2): Panel (app/stew-dashboard.jsx) has 36 call sites; the new props
// collapsible/open/onToggle default to off/true, so the other 35 are unchanged (the control test below finds exactly one
// chevron on the whole Overview). DashOverview's joinPanel is the only caller that passes them. JoinCard and PushEnabler
// are untouched; only whether they are drawn changes.
//
// HOW IT ASSERTS (rule 3): the REAL DashOverview is rendered through the mini-React; the tap is the real onClick found on
// the chevron button, then the screen is drawn again. Nothing is matched in source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function overview() {
  const { React, draw } = miniReact();
  const win = {
    Steward: { joinUrl: () => 'https://x/?follow=npub1abc', qrSVG: () => '<svg></svg>' },
    useStewardRelays: () => [], useStewardGroups: () => [], useStewardMembers: () => [], useStewardRosters: () => [],
    useStewardStats: () => ({ events: 0, announcements: 0 }), useStewardActivity: () => [],
    useStewardChurch: () => ({ name: 'St X', npub: 'npub1abc', features: {} }), useStewardConn: () => 0, useStewardStewards: () => [],
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: { getItem: () => null, setItem() {} },
  };
  const proxied = new Proxy(win, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('useSteward')) return () => []; return undefined; }, has: () => true });
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashOverview'], {
    React, window: proxied, localStorage: win.localStorage,
    Icon: function Icon(p) { return { type: 'icon', props: p, kids: [] }; },
    SkBadge: Stub('SkBadge'), SkToggle: Stub('SkToggle'), SkPill: Stub('SkPill'), SkConfirm: Stub('SkConfirm'),
    DismissibleNote: Stub('DismissibleNote'), StewHelpLink: Stub('StewHelpLink'), DashMealsPanel: Stub('DashMealsPanel'), DashMannaPanel: Stub('DashMannaPanel'),
    Halo: Stub('Halo'), SkKey: Stub('SkKey'), SkQR: Stub('SkQR'), StewVersion: Stub('StewVersion'), NetworkAnnounceComposer: Stub('NetworkAnnounceComposer'), ConsoleChrome: Stub('ConsoleChrome'), StewHelpButton: Stub('StewHelpButton'),
    WizMeetings: Stub('WizMeetings'), _wizMeetingId: () => 'evt1', churchHandle: () => 'grace', stewCapState: () => ({ allowed: false }), location: { host: 'x', hostname: 'x' }, navigator: { userAgent: '' }, document: { addEventListener() {}, removeEventListener() {} },
    setInterval, clearInterval, console, fetch: async () => ({ ok: false, json: async () => ({}) }),
    SK_TINT: { clay: {}, gold: {}, sage: {}, ink: {} }, useStewDialog: () => ({ current: null }), useStewNarrow: () => false, todayISO: () => '2026-10-03', CustomEvent,
    useGoPublicGate: () => ({}), copyText() {},
  });
  return () => draw(mod.DashOverview, { onTab() {}, onNewPost() {}, onSettings() {} });
}

const chevron = (tree) => find(tree, n => n.type === 'button' && /(Collapse|Expand) Joining code/.test(String(n.props['aria-label'])));
const iconOf = (btn) => find(btn, n => n.type === 'icon')[0].props.name;
const bodyShown = (tree) => find(tree, n => n.props && n.props.role === 'img' && /Joining QR code/.test(String(n.props['aria-label']))).length > 0;

test('the Joining code card has a chevron, open by default, showing the code', () => {
  const tree = overview()();
  const c = chevron(tree);
  assert.equal(c.length, 1, 'no chevron on the Joining code card');
  assert.equal(iconOf(c[0]), 'chevD');
  assert.equal(c[0].props['aria-expanded'], true);
  assert.ok(bodyShown(tree), 'the control: the card body (the joining QR) should show while expanded');
});

test('tapping the chevron hides the card body and flips the chevron; tapping again restores it', () => {
  const redraw = overview();
  let tree = redraw();
  chevron(tree)[0].props.onClick();
  tree = redraw();
  assert.equal(bodyShown(tree), false, 'the joining code is still shown after collapsing');
  assert.ok(texts(tree).includes('Joining code'), 'the card header must stay when collapsed');
  assert.equal(iconOf(chevron(tree)[0]), 'chevU');
  assert.equal(chevron(tree)[0].props['aria-expanded'], false);
  chevron(tree)[0].props.onClick();
  tree = redraw();
  assert.ok(bodyShown(tree));
  assert.equal(iconOf(chevron(tree)[0]), 'chevD');
});

test('control: the Overview has exactly three chevrons - Joining code, Groups & rooms, Recent activity (2026-10-15)', () => {
  const tree = overview()();
  const all = find(tree, n => n.type === 'button' && /^(Collapse|Expand) /.test(String(n.props['aria-label'])));
  assert.deepEqual(all.map(b => String(b.props['aria-label'])).sort(), ['Collapse Groups & rooms', 'Collapse Joining code', 'Collapse Recent activity']);
});
