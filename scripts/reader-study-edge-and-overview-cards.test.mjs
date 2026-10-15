// Three small UI changes, 2026-10-15 (owner): the reader's slide-out tab reads STUDY, not NOTES; and the Overview's
// "Groups & rooms" and "Recent activity" cards fold behind a chevron like the Joining code card.
// (The WordNet licence pill test lives in word-definitions-reach-the-reader.test.mjs.)
// Run: node --test scripts/reader-study-edge-and-overview-cards.test.mjs
//
// Users of the changed code (rule 2): CommentaryEdge has one caller (ReadScreen, desktop excluded); only its drawn
// label and aria-label changed, not the storage or the 'notes' tab id inside CommentaryPanel. Panel's collapsible
// props are unchanged; two more DashOverview call sites now pass them (36 call sites in all).
// HOW IT ASSERTS (rule 3): the REAL components are drawn through the mini-React; nothing is matched in source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts, reads } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

test('the reader edge tab is labelled STUDY (drawn and announced), and still toggles the panel', () => {
  const { React, draw } = miniReact();
  const { CommentaryEdge } = loadScreen('app/screens-read.jsx', ['CommentaryEdge'], { React, window: {}, Icon: Stub('Icon') });
  let toggled = 0;
  const tree = draw(CommentaryEdge, { open: false, onToggle: () => { toggled++; } });
  const b = find(tree, n => n.type === 'button');
  assert.equal(b.length, 1);
  assert.equal(reads(b[0]), 'STUDY');
  assert.match(String(b[0].props['aria-label']), /study/i);
  assert.ok(!/notes/i.test(reads(b[0]) + b[0].props['aria-label']), 'the old NOTES wording is still on the tab');
  b[0].props.onClick();
  assert.equal(toggled, 1);
});

function overview() {
  const { React, draw } = miniReact();
  const groups = [{ id: 'g1', name: 'Youth Room', kind: 'chat' }];
  const activity = [{ id: 'a1', text: 'Someone joined', tint: 'ink', ic: 'chat', ts: 1 }];
  const win = {
    Steward: { joinUrl: () => 'https://x/?follow=npub1abc', qrSVG: () => '<svg></svg>' },
    useStewardGroups: () => groups, useStewardActivity: () => activity,
    useStewardChurch: () => ({ name: 'St X', npub: 'npub1abc', features: {} }), useStewardConn: () => 0,
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
    useGoPublicGate: () => ({}), copyText() {}, ago: () => 'now', groupLiveSub: () => 'sub',
  });
  return () => draw(mod.DashOverview, { onTab() {}, onNewPost() {}, onSettings() {} });
}
const chev = (tree, name) => find(tree, n => n.type === 'button' && new RegExp('^(Collapse|Expand) ' + name).test(String(n.props['aria-label'])));
const shown = {
  'Groups & rooms': (t) => texts(t).includes('Youth Room'),
  'Recent activity': (t) => texts(t).includes('Someone joined'),
};

for (const name of Object.keys(shown)) {
  test(`the "${name}" card has a chevron, folds its body away and shows it again`, () => {
    const redraw = overview();
    let tree = redraw();
    assert.equal(chev(tree, name).length, 1, 'no chevron on the card');
    assert.ok(shown[name](tree), 'control: the body should show while open');
    chev(tree, name)[0].props.onClick();
    tree = redraw();
    assert.equal(shown[name](tree), false, 'the body is still drawn after collapsing');
    assert.ok(texts(tree).includes(name), 'the header must stay');
    assert.equal(chev(tree, name)[0].props['aria-expanded'], false);
    // folding one card must not fold the others
    for (const other of Object.keys(shown).filter(x => x !== name)) assert.ok(shown[other](tree), other + ' folded too');
    chev(tree, name)[0].props.onClick();
    tree = redraw();
    assert.ok(shown[name](tree));
  });
}
