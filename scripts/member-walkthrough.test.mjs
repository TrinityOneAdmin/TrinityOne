// THE MEMBER APP HAS A FIRST-RUN TOUR (A BIBLE PART AND A COMMUNITY PART) AND READER TIPS.
//   Run: node --test scripts/member-walkthrough.test.mjs
//
// app/member-tour.jsx (steps, start rules, host) on app/tour-kit.jsx (the bubble, shared with the console's tour).
//
// CLAUDE.md rule 1 — every start is tested AT THE POINT OF USE, through the screen that really triggers it:
//   · the REAL App (app/app.jsx, every script index.html lists, loaded by scripts/app-screens.mjs): the setup
//     screen is finished by calling the onSkip / onSave App really gave it; a church is joined by calling the
//     ctx.followChurch App really hands its screens; Help's replay is the ctx.replayTour App really hands them.
//     What is asserted is the MemberTourBubble the host App mounted put up.
//   · the REAL ReadScreen (app/screens-read.jsx): drawing it is what asks for the reader tips, and the tip
//     points at the verse anchor that ReadScreen itself drew.
//   · the REAL ChatScreen / TodayScreen / TabBar / DesktopNav / HelpIndex, drawn through the miniature React in
//     scripts/render-jsx-screen.mjs, for the anchors and the words the tour reads from them.
// Rule 3 — nothing here matches text in an app/*.jsx file. The pure functions are RUN.
//
// ANCHORS IN THE APP-LEVEL TESTS. The App harness (fakeReact) draws App only, not its children, so the anchors
// TabBar / TodayScreen / ChatScreen draw are not in that tree. Those tests answer document.querySelector from a
// list of anchors stated per test; the screen-level tests below prove each anchor really is drawn, by the screen
// that owns it, and the host-over-screen tests answer querySelector from the drawn screen itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const NPUB = 'npub1' + '0'.repeat(58);
const NPUB2 = 'npub1' + '2'.repeat(58);
const BIBLE_TITLES = ['Welcome', 'Verse of the day', 'Read', 'Library', 'You'];

// ── a document whose querySelector('[data-tour="x"]') answers from what a screen drew ──────────────────────
// `source()` returns either a Set of anchor names (App-level tests) or a list of drawn trees.
function tourDoc(source) {
  const el = (props) => ({
    getClientRects: () => [1], scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 20, top: 30, right: 140, bottom: 74, width: 120, height: 44 }),
    getAttribute: (k) => (props && props[k] != null ? String(props[k]) : null),
  });
  return (sel) => {
    const m = /^\[data-tour="([^"]+)"\]$/.exec(sel);
    if (!m) return null;
    const src = source();
    if (src instanceof Set) return src.has(m[1]) ? el(src.facts && src.facts[m[1]]) : null;
    for (const t of src) { const n = find(t, x => x.props && x.props['data-tour'] === m[1])[0]; if (n) return el(n.props); }
    return null;
  };
}
const anchors = (names, facts) => { const s = new Set(names); s.facts = facts || {}; return s; };

// ══════════════ THE REAL APP ════════════════════════════════════════════════════════════════════════════
// opts: { onboarded, church (follow one at boot), store (Map shared across boots), anchors (Set), search (the page's
//         location.search), setup(window) (run after the app's scripts load, before its first frame) }
function bootApp(opts = {}) {
  const r = fakeReact();
  const env = appBrowser();
  const window = env.window;
  if (opts.store) for (const [k, v] of opts.store) window.localStorage.setItem(k, v);
  if (opts.search) window.location.search = opts.search;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const mod = loadApp({ React: r.React, window, expr: '({ App, MemberTourHost, MemberTourBubble, Splash, IdentityOnboarding, ChurchSwitcher, TabBar, HelpCenter, ProfileSheet, memberTourStore, memberTourStart, memberTourJoined })' });
  for (const k of Object.keys(mod)) assert.ok(mod[k], k + ' is not in the member app scope — re-anchor this test');
  window.TrinityData.CHURCHES = [];
  if (opts.onboarded !== false) window.localStorage.setItem('trinityone.onboarded', 'true');
  if (opts.church) {
    window.TrinityData.CHURCHES = [{ id: NPUB, npub: NPUB, name: 'Test Church' }];
    window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(NPUB));
  }
  window.Fellowship = new Proxy({
    myPubkey: 'dd'.repeat(32), CANONICAL_RELAYS: [], hasRelays: true, toPub: (x) => x,
    isBlockedChurch: () => false, checkChurch: async () => 'church', ready: Promise.resolve(),
  }, { get: (t, k) => (k in t ? t[k] : (k === 'then' || typeof k === 'symbol') ? undefined : () => () => {}) });
  let anc = opts.anchors || anchors(['tab-today', 'tab-read', 'tab-chat', 'tab-library', 'tab-you', 'votd']);
  window.document.querySelector = tourDoc(() => anc);
  // One frame: App, then the host App mounted (fakeReact draws one component; the host's hooks follow App's in
  // the same, stable order), then effects. The host's output is the bubble element it put up, or null.
  const frame = () => {
    r.reset();
    const tree = App();
    const hostEl = nodes(tree).find(n => n.type === mod.MemberTourHost);
    const out = hostEl ? hostEl.type(hostEl.props) : null;
    r.flush();
    return { tree, hostEl, out };
  };
  const { App } = mod;
  const show = () => { frame(); frame(); return frame(); };
  const el = (tree, type) => nodes(tree).find(n => n.type === type);
  const ctxOf = (tree) => { const n = nodes(tree).find(x => x.props && x.props.ctx && 'followChurch' in x.props.ctx); assert.ok(n, 'no screen received a ctx — re-anchor'); return n.props.ctx; };
  // the splash ends by calling the onDone App gave it
  const endSplash = () => { const s = el(frame().tree, mod.Splash); if (s) s.props.onDone(); };
  if (opts.setup) opts.setup(window);
  return { mod, window, store: window.localStorage, frame, show, el, ctxOf, endSplash, setAnchors: (a) => { anc = a; } };
}
const bubbleOf = (f, h) => (f.out && f.out.type === h.mod.MemberTourBubble && f.out.props.variant !== 'tip') ? f.out.props : null;
// Walk the tour with the bubble's own Next, collecting titles, checking `each` after every frame.
function walkApp(h, each) {
  const seen = [];
  for (let g = 0; g < 20; g++) {
    const f = h.show();
    if (each) each(f);
    const b = bubbleOf(f, h);
    if (!b) return seen;
    seen.push(b.step.title);
    b.onNext();
  }
  throw new Error('the tour never ended');
}
const settle = () => new Promise(r => setTimeout(r, 30));

test('CONTROL: App mounts the tour host, and an already set-up member with no request sees nothing', () => {
  const h = bootApp();
  h.endSplash();
  const f = h.show();
  assert.ok(f.hostEl, 'App does not mount MemberTourHost');
  assert.equal(f.out, null, 'something showed with nothing asking for it');
});

test('POINT OF USE: skipping the setup screen starts the Bible tour — not over the setup screen, not over the follow sheet', () => {
  const h = bootApp({ onboarded: false });
  h.endSplash();
  let f = h.show();
  const ob = h.el(f.tree, h.mod.IdentityOnboarding);
  assert.ok(ob, 'the setup screen did not open on a first run — re-anchor this test');
  assert.equal(bubbleOf(f, h), null, 'the tour showed over the setup screen');
  ob.props.onSkip();                                   // the handler App really gave it
  f = h.show();
  const sw = h.el(f.tree, h.mod.ChurchSwitcher);
  assert.equal(sw.props.open, true, 'premise: skipping setup opens the follow-a-church sheet');
  assert.equal(bubbleOf(f, h), null, 'the tour showed over the follow-a-church sheet');
  sw.props.onClose();
  f = h.show();
  const b = bubbleOf(f, h);
  assert.ok(b, 'closing the follow sheet after setup did not start the tour');
  assert.equal(b.step.title, 'Welcome');
  assert.equal(b.pos + ' of ' + b.count, '1 of 5');
  assert.equal(h.store.getItem('trinityone.tour.bible'), '1', 'the Bible part was not recorded as seen on this device');
  assert.deepEqual(walkApp(h), BIBLE_TITLES);
});

test('POINT OF USE: finishing the setup screen (onSave) starts it too', () => {
  const h = bootApp({ onboarded: false });
  h.endSplash();
  const ob = h.el(h.show().tree, h.mod.IdentityOnboarding);
  ob.props.onSave({ name: 'Sam' });
  h.el(h.show().tree, h.mod.ChurchSwitcher).props.onClose();
  const b = bubbleOf(h.show(), h);
  assert.ok(b, 'finishing setup did not start the tour');
  assert.equal(b.step.title, 'Welcome');
});

test('POINT OF USE: joining a church runs the Community part, once, where the person is', async () => {
  const h = bootApp({ anchors: anchors(['tab-today', 'tab-read', 'tab-chat', 'tab-library', 'tab-you', 'votd', 'happening']) });
  h.store.setItem('trinityone.tour.bible', '1');      // they had the Bible part already
  h.endSplash();
  let f = h.show();
  assert.equal(bubbleOf(f, h), null);
  h.ctxOf(f.tree).followChurch(NPUB);                  // what the follow sheet calls (screens-church.jsx)
  await settle();                                      // checkChurch answers "church"
  const titles = walkApp(h);
  // on Today: the groups list is on Community, so that step is skipped — the tour does not go there
  assert.deepEqual(titles, ['Community', 'What’s happening'], 'joining a church did not run the Community part');
  assert.equal(h.store.getItem('trinityone.tour.community'), '1');
  // a second church joined later does not run it again
  h.ctxOf(h.show().tree).followChurch(NPUB2);
  await settle();
  assert.equal(bubbleOf(h.show(), h), null, 'the Community part ran a second time');
});

test('an upgrading member (set up on an earlier version, already in a church) gets no tour, and no Community part on a later join', async () => {
  const h = bootApp({ church: true });
  h.endSplash();
  for (let i = 0; i < 3; i++) assert.equal(bubbleOf(h.show(), h), null, 'the tour started on boot for an existing member');
  assert.equal(h.store.getItem('trinityone.tour.community'), '1', 'an existing member was not recorded as having joined before');
  assert.equal(h.mod.memberTourJoined(), false);
  h.ctxOf(h.show().tree).followChurch(NPUB2);
  await settle();
  assert.equal(bubbleOf(h.show(), h), null, 'joining a second church ran the Community part for an existing member');
});

test('seen-state: a second first-run start on the same device does nothing; a second boot shows nothing', () => {
  const h = bootApp({ onboarded: false });
  h.endSplash();
  h.el(h.show().tree, h.mod.IdentityOnboarding).props.onSkip();
  h.el(h.show().tree, h.mod.ChurchSwitcher).props.onClose();
  walkApp(h);
  assert.equal(h.mod.memberTourStart('onboarding'), false, 'an automatic start ran a second time');
  const store = new Map([['trinityone.tour.bible', '1']]);
  const again = bootApp({ store });
  again.endSplash();
  assert.equal(bubbleOf(again.show(), again), null);
  assert.equal(again.mod.memberTourStart('invite'), false);
});

test('landing on Community in a church: Community part first, then the Bible part — and the tab never changes', () => {
  const facts = { groups: { 'data-tour-minor': '0', 'data-tour-count': '2' } };
  const h = bootApp({ church: true, anchors: anchors(['tab-today', 'tab-read', 'tab-chat', 'tab-library', 'tab-you', 'groups'], facts) });
  h.endSplash();
  let f = h.show();
  h.el(f.tree, h.mod.TabBar).props.onChange('chat');   // the person taps Community
  f = h.show();
  assert.equal(h.el(f.tree, h.mod.TabBar).props.active, 'chat');
  h.ctxOf(f.tree).replayTour();                          // Help → Take the tour again
  const titles = walkApp(h, (fr) => {
    assert.equal(h.el(fr.tree, h.mod.TabBar).props.active, 'chat', 'the tour moved the person off the page they were on');
    for (const [k, v] of Object.entries(fr.hostEl.props)) assert.notEqual(typeof v, 'function', 'the tour host was handed a function (' + k + ') — it must not be able to change the page');
  });
  // the verse card is on Today, so it is skipped here rather than navigated to
  assert.deepEqual(titles, ['Community', 'Groups and teams', 'Welcome', 'Read', 'Library', 'You']);
});

test('POINT OF USE: Help → "Take the tour again" closes Help and the profile hub, then replays', () => {
  const h = bootApp();
  h.store.setItem('trinityone.tour.bible', '1');
  h.endSplash();
  let f = h.show();
  const ctx = h.ctxOf(f.tree);
  assert.equal(typeof ctx.replayTour, 'function', 'App hands its screens no replayTour');
  ctx.openProfile(); ctx.openHelp('index');
  f = h.show();
  assert.equal(h.el(f.tree, h.mod.HelpCenter).props.open, true, 'premise: Help is open');
  assert.equal(bubbleOf(f, h), null, 'the tour showed over Help');
  h.ctxOf(f.tree).replayTour();
  f = h.show();
  assert.equal(h.el(f.tree, h.mod.HelpCenter).props.open, false, 'Help stayed open');
  assert.equal(h.el(f.tree, h.mod.ProfileSheet).props.open, false, 'the profile hub stayed open over the tour');
  assert.ok(bubbleOf(f, h), 'the tour did not replay');
});

test('the tour waits behind any open sheet on the back stack, then shows', () => {
  const h = bootApp();
  h.endSplash();
  h.show();
  h.window.__trinityBackStack.push({ close() {} });   // what every open BottomSheet / Overlay does (ui.jsx useBackLayer)
  h.mod.memberTourStart('replay');
  assert.equal(bubbleOf(h.show(), h), null, 'the tour showed over an open sheet');
  h.window.__trinityBackStack.length = 0;
  assert.ok(bubbleOf(h.show(), h), 'the tour did not show once the sheet closed');
});

// ── 2026-11-19 audit fixes, through the real App ────────────────────────────────────────────────────────────
test('POINT OF USE: an invite link adopted on a never-set-up phone starts the tour (App\'s invite effect)', async () => {
  const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const run = async (onboarded) => {
    const h = bootApp({ onboarded, search: '?invite=' + encodeURIComponent(seed),
      setup: (w) => { w.confirm = () => true; w.TrinityIdentity = { importMnemonic: async () => {} }; } });
    h.endSplash();
    h.show();
    await settle();                                     // the confirm, then importMnemonic
    return { h, b: bubbleOf(h.show(), h) };
  };
  const fresh = await run(false);
  assert.ok(fresh.b, 'adopting an invite on a phone that was never set up did not start the tour');
  assert.equal(fresh.b.step.title, 'Welcome');
  // CONTROL: the same link on a phone already set up is not a first run, and starts nothing
  const used = await run(true);
  assert.equal(used.b, null, 'an invite adopted on an already set-up phone started the tour');
});

test('POINT OF USE: the tour never shows over the PIN gate; it shows once the person goes past it', () => {
  const h = bootApp({ setup: (w) => { w.TrinityIdentity = { isLocked: () => true }; } });
  h.endSplash();
  let f = h.show();
  const gate = nodes(f.tree).find(n => n.type && n.type.name === 'PinUnlockGate');
  assert.ok(gate, 'premise: the PIN gate is not up for a locked identity');
  h.mod.memberTourStart('replay');
  for (let i = 0; i < 3; i++) assert.equal(bubbleOf(h.show(), h), null, 'the tour showed over the PIN gate');
  gate.props.onReadBible();                             // "read the Bible without unlocking": the gate goes
  assert.ok(bubbleOf(h.show(), h), 'the tour did not show once the gate had gone');
});

test('the tour hides when a sheet or the PIN lock comes up mid-run, and resumes at the same step', () => {
  const h = bootApp();
  h.endSplash();
  h.show();
  h.mod.memberTourStart('replay');
  bubbleOf(h.show(), h).onNext();
  const at = bubbleOf(h.show(), h).step.title;
  assert.equal(at, 'Verse of the day', 'premise: Next did not move to step 2');
  h.window.__trinityBackStack.push({ close() {} });   // a sheet opens over the tour
  for (let i = 0; i < 2; i++) assert.equal(bubbleOf(h.show(), h), null, 'the tour stayed up over a sheet that opened while it ran');
  h.window.__trinityBackStack.length = 0;
  const resumed = bubbleOf(h.show(), h);
  assert.ok(resumed, 'the tour did not come back once the sheet closed');
  assert.equal(resumed.step.title, at, 'the tour did not come back at the step it was on');
  h.window.TrinityIdentity = { isLocked: () => true };   // the PIN idle-lock
  h.window.dispatch('trinity-identity-lock', {});
  assert.ok(nodes(h.show().tree).some(n => n.type && n.type.name === 'PinUnlockGate'), 'premise: the idle-lock did not put the PIN gate up');
  assert.equal(bubbleOf(h.show(), h), null, 'the tour stayed up over the PIN gate');
  h.window.TrinityIdentity = { isLocked: () => false };
  h.window.dispatch('trinity-identity-lock', {});
  const back = bubbleOf(h.show(), h);
  assert.ok(back, 'the tour did not come back after unlocking');
  assert.equal(back.step.title, at, 'the tour came back at a different step');
});

// ══════════════ THE HOST OVER REAL SCREENS (the full miniature React: the bubble is drawn) ══════════════════
// o: { failWrites (localStorage.setItem throws, as a full or blocked store does), setTimeout (to record timers) }
function kit(React, win, doc, store, o = {}) {
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { if (o.failWrites) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } store.set(k, String(v)); } };
  const base = { React, window: win, document: doc, localStorage: ls, getComputedStyle: () => ({}), console, setTimeout: o.setTimeout || (() => 0), clearTimeout() {}, Event: class { constructor(t) { this.type = t; } } };
  const K = loadScreen('app/tour-kit.jsx', ['tourKitFind', 'tourKitWalk', 'tourKitPlace', 'tourKitInsets', 'tourKitFlag', 'tourKitFlagSet', 'TourKitBubble'], base);
  const M = loadScreen('app/member-tour.jsx', ['MemberTourHost', 'memberTourPlan', 'memberTourGroupsText', 'memberTourNextTip', 'memberTourReader', 'memberTourStart'],
    { ...base, ...K, useDialogA11y: () => {} });
  return { K, M, ls };
}
const drawnBubble = (tree, which) => find(tree, n => n.props && n.props['data-member-tour'] === which)[0] || null;
const titleOf = (b) => { const h2 = find(b, n => n.type === 'h2')[0]; return h2 ? texts(h2.kids || []).join('') : null; };

function readerScreen(React, win) {
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const BOOKS = [43];
  win.Bible = {
    loaded: true, activeVersion: 'WEB', books: () => BOOKS, maxChapter: () => 21, bookName: () => 'John', versions: () => [{ abbr: 'WEB' }],
    getVerses: () => [{ v: 1, text: 'In the beginning', html: 'In the beginning' }, { v: 2, text: 'The same', html: 'The same' }],
    bookMeta: () => [{ num: 43, name: 'John', abbr: 'Joh', group: 'g', ch: 21 }],
    getCommentary: () => [], commentaryList: () => [], searchDict: () => [], subscribe: () => () => {}, defaultLoc: () => ({ book: 43, chap: 1 }),
    refLabel: (l, v) => 'John ' + l.chap + (v != null ? ':' + v : ''), refKey: (l, v) => l.book + '.' + l.chap + '.' + v, step: () => null,
  };
  Object.assign(win, { speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h, getSelection: () => ({ toString: () => '' }), TrinityData: { CROSSREFS: {} } });
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams, SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: Stub('BottomSheet'), useBackLayer: () => {},
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'), IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
  });
  const ctx = { loc: { book: 43, chap: 1 }, version: 'WEB', setLoc() {}, toast() {}, highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {},
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {} };
  return { ReadScreen, ctx };
}

test('POINT OF USE: opening the reader shows "Tap a verse" on the first verse ReadScreen drew; then the header tips, one at a time', () => {
  const { React, draw } = miniReact();
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  let screens = [];
  const store = new Map();
  const { M } = kit(React, win, { querySelector: tourDoc(() => screens) }, store);
  win.memberTourReader = M.memberTourReader;            // as member-tour.jsx puts it on window
  const { ReadScreen, ctx } = readerScreen(React, win);
  // CONTROL: the host alone, with no reader drawn, offers nothing
  assert.equal(drawnBubble(draw(M.MemberTourHost, { page: 'read' }), 'tip-card'), null, 'a reader tip showed with no reader on screen');
  const reader = draw(ReadScreen, { ctx });              // its effect asks for the reader tips
  screens = [reader];
  const verseAnchors = find(reader, n => n.props && n.props['data-tour'] === 'verse');
  assert.equal(verseAnchors.length, 1, 'ReadScreen does not mark exactly one verse (the first) as the tour anchor');
  assert.equal(verseAnchors[0].props.id, 'rv-1', 'the anchor is not on the first verse');
  draw(M.MemberTourHost, { page: 'read' });
  let tree = draw(M.MemberTourHost, { page: 'read' });
  let tip = drawnBubble(tree, 'tip-card');
  assert.ok(tip, 'drawing the reader did not bring up the "Tap a verse" tip');
  assert.equal(titleOf(tip), 'Tap a verse');
  assert.equal(drawnBubble(tree, 'bubble'), null, 'a tip came up as a tour dialog');
  const order = [titleOf(tip)];
  for (let g = 0; g < 6; g++) {
    const got = find(tip, n => n.type === 'button' && texts(n.kids || []).join('').trim() === 'Got it')[0];
    assert.ok(got, 'the tip has no Got it'); got.props.onClick();
    draw(M.MemberTourHost, { page: 'read' });
    tree = draw(M.MemberTourHost, { page: 'read' });
    tip = drawnBubble(tree, 'tip-card');
    if (!tip) break;
    assert.equal(find(tree, n => n.props && n.props['data-member-tour'] === 'tip-card').length, 1, 'two tips stacked');
    order.push(titleOf(tip));
  }
  // no audio Bible on this phone: no Listen tip
  assert.deepEqual(order, ['Tap a verse', 'Translation', 'Study']);
  assert.equal(store.get('trinityone.tour.tip.verse'), '1');
});

test('a reader tip never shows over an open sheet, and gives way when one opens (it counts as seen)', () => {
  const { React, draw } = miniReact();
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, __trinityBackStack: [] };
  let screens = [];
  const store = new Map();
  const { M } = kit(React, win, { querySelector: tourDoc(() => screens) }, store);
  win.memberTourReader = M.memberTourReader;
  const { ReadScreen, ctx } = readerScreen(React, win);
  screens = [draw(ReadScreen, { ctx })];
  const sheet = { close() {} };
  win.__trinityBackStack.push(sheet);                  // a sheet is open (the verse card, a picker…)
  draw(M.MemberTourHost, { page: 'read' });
  assert.equal(drawnBubble(draw(M.MemberTourHost, { page: 'read' }), 'tip-card'), null, 'a tip showed over an open sheet');
  win.__trinityBackStack.length = 0;
  draw(M.MemberTourHost, { page: 'read' });
  assert.equal(titleOf(drawnBubble(draw(M.MemberTourHost, { page: 'read' }), 'tip-card')), 'Tap a verse');
  win.__trinityBackStack.unshift(sheet);              // the person taps a verse: its card opens under the tip's own entry
  draw(M.MemberTourHost, { page: 'read' });
  assert.equal(drawnBubble(draw(M.MemberTourHost, { page: 'read' }), 'tip-card'), null, 'the tip stayed up over the sheet that opened');
  assert.equal(store.get('trinityone.tour.tip.verse'), '1');
  win.__trinityBackStack.splice(0, 1);                // the verse card closes
  draw(M.MemberTourHost, { page: 'read' });
  assert.equal(titleOf(drawnBubble(draw(M.MemberTourHost, { page: 'read' }), 'tip-card')), 'Translation', 'the tip a sheet interrupted came back instead of giving way');
});

// ── 2026-11-19 audit fixes, over the real reader ───────────────────────────────────────────────────────────
test('POINT OF USE: with a store that refuses writes, "Got it" still moves the reader tips on — no tip comes back', () => {
  const { React, draw } = miniReact();
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  let screens = [];
  const store = new Map();
  const { M } = kit(React, win, { querySelector: tourDoc(() => screens) }, store, { failWrites: true });
  win.memberTourReader = M.memberTourReader;
  const { ReadScreen, ctx } = readerScreen(React, win);
  screens = [draw(ReadScreen, { ctx })];
  draw(M.MemberTourHost, { page: 'read' });
  let tip = drawnBubble(draw(M.MemberTourHost, { page: 'read' }), 'tip-card');
  const order = [];
  for (let g = 0; g < 8 && tip; g++) {
    order.push(titleOf(tip));
    find(tip, n => n.type === 'button' && texts(n.kids || []).join('').trim() === 'Got it')[0].props.onClick();
    draw(M.MemberTourHost, { page: 'read' });
    tip = drawnBubble(draw(M.MemberTourHost, { page: 'read' }), 'tip-card');
  }
  assert.equal(store.size, 0, 'premise: the store took a write it was meant to refuse');
  assert.deepEqual(order, ['Tap a verse', 'Translation', 'Study'], 'a tip came back after Got it because its seen-flag could not be stored');
});

test('with every reader tip seen, an open sheet no longer makes the host look again every 700ms', () => {
  const { React, draw } = miniReact();
  const timers = [];
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, __trinityBackStack: [{ close() {} }] };
  const store = new Map();
  const { M } = kit(React, win, { querySelector: () => null }, store, { setTimeout: (f, ms) => { timers.push(ms); return 0; } });
  M.memberTourReader();
  const polls = () => timers.filter(ms => ms === 700).length;
  draw(M.MemberTourHost, { page: 'read' });
  assert.ok(polls() > 0, 'CONTROL: with tips still to show and a sheet open, the host does not look again');
  for (const id of ['verse', 'version', 'listen', 'study']) store.set('trinityone.tour.tip.' + id, '1');
  timers.length = 0;
  draw(M.MemberTourHost, { page: 'read' });
  draw(M.MemberTourHost, { page: 'read' });
  assert.equal(polls(), 0, 'the host kept re-rendering every 700ms with nothing left to show');
});

function chatScreen(React, draw, { rooms = [], isMinor = false } = {}) {
  const win = {
    Fellowship: { myPubkey: 'mehex', relays: [], subscribeChurchGroups: (_np, cb) => { cb(rooms); return () => {}; }, subscribeChurchCategories: (_np, cb) => { cb([]); return () => {}; },
      subscribeGroups: () => () => {}, displayFor: () => ({ handle: 'sam', color: '#888' }), assumeMinor: async () => isMinor },
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
    TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
    addEventListener: () => {}, removeEventListener: () => {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatScreen'], {
    React, window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.example/' }, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-18', Icon: () => null,
    IconBtn: ({ name }) => React.createElement('button', { title: name }),
    Overlay: ({ open, children }) => (open ? children : null), ScreenScroll: ({ children }) => children, ChurchPill: () => null, UserAvatar: () => null,
    SectionLabel: ({ children }) => children, BottomSheet: ({ open, children }) => (open ? children : null), safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast: () => {}, church: { npub: 'npub1church', name: 'St Aidan’s', id: 'c1' },
    joinState: { loaded: true, isPending: false, removed: false, offline: false, unknown: false },
    myLeaderGroups: [], churchEvents: [], myPubkey: 'mehex', safeguard: { isMinor, clearanceKnown: true },
    openPeople: () => {}, openDM: () => {}, openDMInbox: () => {}, openGroup: () => {} };
  return () => draw(mod.ChatScreen, { ctx });
}
const ADULT_ROOM = { id: 'g1', name: 'Whole Church', kind: 'group', visibility: 'open', childsafe: false };
const KIDS_ROOM = { id: 'g2', name: 'Youth', kind: 'group', visibility: 'open', childsafe: true };

// The groups step's words, read by the host from the groups anchor the REAL ChatScreen drew for this reader.
function groupsStepOver(rooms, isMinor) {
  const { React, draw } = miniReact();
  const store = new Map();
  let screens = [];
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  const { M } = kit(React, win, { querySelector: tourDoc(() => screens) }, store);
  const chat = chatScreen(React, draw, { rooms, isMinor });
  chat();
  const tree = chat();
  screens = [tree];
  const anchor = find(tree, n => n.props && n.props['data-tour'] === 'groups')[0];
  M.memberTourStart('replay');
  draw(M.MemberTourHost, { page: 'chat', inChurch: true });
  const host = draw(M.MemberTourHost, { page: 'chat', inChurch: true });
  const b = drawnBubble(host, 'bubble');
  return { anchor, title: b && titleOf(b), text: b && texts(find(b, n => n.type === 'p')[0].kids || []).join(''), shown: texts(tree).join(' | ') };
}

test('POINT OF USE: the Groups step uses the young-person words for a child, read from the list ChatScreen drew', () => {
  const adult = groupsStepOver([ADULT_ROOM, KIDS_ROOM], false);
  assert.ok(adult.anchor, 'ChatScreen does not draw the groups anchor');
  assert.equal(adult.title, 'Groups and teams', 'the groups step was not the first one shown on Community (tab-chat is not drawn here)');
  assert.equal(adult.text, 'Groups you can join.');
  const child = groupsStepOver([ADULT_ROOM, KIDS_ROOM], true);
  assert.equal(child.anchor.props['data-tour-minor'], '1');
  assert.equal(child.anchor.props['data-tour-count'], '1', 'the count is not the list the child was shown');
  assert.doesNotMatch(child.shown, /Whole Church/, 'premise: the adults-only group is hidden from the child');
  assert.equal(child.text, 'The groups your church has opened for you.');
});

test('POINT OF USE: a young person whose church opened NO groups for them gets the ordinary "none yet" words', () => {
  const none = groupsStepOver([ADULT_ROOM], true);
  assert.equal(none.anchor.props['data-tour-count'], '0');
  assert.equal(none.text, 'Your church hasn’t opened any groups for you yet.');
  assert.doesNotMatch(none.text, /ask|leader|steward/i, 'the none-yet words tell a child to go and ask someone (DOMAIN.md: no fault to report)');
});

test('Android Back / Escape skip the tour: the drawn bubble puts itself on the back stack that both go through', () => {
  const { React, draw } = miniReact();
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  const { M } = kit(React, win, { querySelector: () => null }, new Map());
  M.memberTourStart('replay');
  draw(M.MemberTourHost, { page: 'today' });
  const tree = draw(M.MemberTourHost, { page: 'today' });
  const b = drawnBubble(tree, 'bubble');
  assert.ok(b, 'premise: the tour is up');
  assert.equal(b.props.role, 'dialog');
  assert.equal(b.props['aria-modal'], 'true');
  const entry = (win.__trinityBackStack || []).filter(e => e.memberTour).pop();
  assert.ok(entry, 'the tour is not on the back stack, so Back and Escape (window.trinityGoBack) cannot close it');
  entry.close();                                       // what window.trinityGoBack does with the top entry
  assert.equal(drawnBubble(draw(M.MemberTourHost, { page: 'today' }), 'bubble'), null, 'Back did not skip the tour');
});

// ══════════════ THE ANCHORS, DRAWN BY THE SCREENS THAT OWN THEM ═════════════════════════════════════════
test('the tab bar (phone) and the sidebar (desktop) both draw an anchor for every tab and for You', () => {
  const { React, draw } = miniReact();
  const ui = loadScreen('app/ui.jsx', ['TabBar', 'DesktopNav'], {
    React, window: {}, document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({}) },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, console, Icon: () => null, UserAvatar: () => null, Halo: () => null,
  });
  for (const C of [ui.TabBar, ui.DesktopNav]) {
    const tree = draw(C, { active: 'today', onChange() {}, onProfile() {} });
    const got = find(tree, n => n.type === 'button' && n.props['data-tour']).map(n => n.props['data-tour']);
    assert.deepEqual(got, ['tab-today', 'tab-read', 'tab-chat', 'tab-library', 'tab-you'], C.name + ' anchors');
  }
});

function todayScreen(min, church) {
  const { React, draw } = miniReact();
  const h = loadScreen('app/ui.jsx', ['churchMainColor', 'churchOnColor', 'churchMainGradient'], {
    React, window: {}, document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({}) },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, console, Icon: () => null,
  });
  const store = new Map([['trinityone.votd-min', min]]);
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem(k, v) { store.set(k, String(v)); }, removeItem(k) { store.delete(k); } };
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] }, ChurchBadge: Stub('ChurchBadge'),
    TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], {
    React, window: win, localStorage, document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon: () => null, ChurchBadge: Stub('ChurchBadge'), churchMainColor: h.churchMainColor, churchOnColor: h.churchOnColor, churchMainGradient: h.churchMainGradient,
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }), todayISO: () => '2026-11-18', fetch: async () => ({ ok: false, json: async () => ({}) }),
  });
  const ctx = { church: church ? { name: 'Grace', initials: 'GC', npub: 'np1' } : null, openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {}, openShareSheet() {}, planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {}, newJournal() {} };
  draw(TodayScreen, { ctx });
  return draw(TodayScreen, { ctx });
}
const tourAnchors = (tree) => find(tree, n => n.props && n.props['data-tour']).map(n => n.props['data-tour']);

test('Today: the verse card is an anchor minimised and expanded; What’s happening is one for a member; there is NO Listen on Today', () => {
  for (const min of ['1', '0']) {
    const a = tourAnchors(todayScreen(min, true));
    assert.equal(a.filter(x => x === 'votd').length, 1, 'the verse of the day is not exactly one anchor (votd-min ' + min + ')');
    assert.ok(a.includes('happening'), 'What’s happening is not an anchor for a church member');
    assert.ok(!a.includes('listen'), 'Today draws a Listen anchor — owner: there is no Listen on the verse of the day');
  }
  assert.ok(!tourAnchors(todayScreen('1', false)).includes('happening'), 'What’s happening is an anchor with no church');
  // and the plan never asks for one
  const { React } = miniReact();
  const { M } = kit(React, {}, { querySelector: () => null }, new Map());
  const plan = M.memberTourPlan({ parts: { bible: true, community: true }, page: 'today' });
  assert.ok(!plan.some(s => s.id === 'listen' || s.targets.includes('listen')), 'the tour has a Listen step');
  assert.deepEqual(plan.find(s => s.id === 'votd').targets, ['votd']);
});

test('the reader draws the Translation, Listen and Study anchors', () => {
  const { React, draw } = miniReact();
  const win = {};
  const { ReadScreen, ctx } = readerScreen(React, win);
  const a = tourAnchors(draw(ReadScreen, { ctx }));
  for (const t of ['verse', 'version', 'listen', 'study']) assert.equal(a.filter(x => x === t).length, 1, t + ' is not exactly one anchor in the reader');
});

test('POINT OF USE: the Help index draws "Take the tour again" only when App hands it ctx.replayTour, and it calls it', () => {
  const { React, draw } = miniReact();
  const { HelpIndex } = loadScreen('app/screens-help-main.jsx', ['HelpIndex'], {
    React, window: {}, localStorage: { getItem: () => null, setItem() {} }, document: { addEventListener() {}, removeEventListener() {} },
    Icon: () => null, IconBtn: Stub('IconBtn'), Overlay: Stub('Overlay'), HelpIllo: () => null, TextSizeStepper: Stub('TextSizeStepper'), useReadAloud: () => ({ stop() {} }),
    console, setTimeout, clearTimeout, speechSynthesis: null,
  });
  const D = { intro: 'Help', articles: [{ id: 'words', title: 'Words', summary: '' }, { id: 'a', title: 'A', summary: 's', illo: 'x' }] };
  let n = 0;
  const tree = draw(HelpIndex, { D, fs: 1, onOpen() {}, onBackup() {}, ctx: { replayTour: () => { n++; }, toast() {} } });
  const b = find(tree, x => x.type === 'button' && x.props['data-help-tour'] === 'replay');
  assert.equal(b.length, 1, 'the member Help has no "Take the tour again"');
  assert.match(texts(b[0]).join(' '), /Take the tour again/);
  b[0].props.onClick();
  assert.equal(n, 1);
  assert.equal(find(draw(HelpIndex, { D, fs: 1, onOpen() {}, onBackup() {}, ctx: { toast() {} } }), x => x.props && x.props['data-help-tour']).length, 0);
});

// ══════════════ THE PURE PARTS ══════════════════════════════════════════════════════════════════════════
test('plan order: Bible first on Today; Community first on Community; each part only when asked for', () => {
  const { React } = miniReact();
  const { M } = kit(React, {}, { querySelector: () => null }, new Map());
  const ids = (o) => M.memberTourPlan(o).map(s => s.id);
  assert.deepEqual(ids({ parts: { bible: true, community: true }, page: 'today' }), ['welcome', 'votd', 'read', 'library', 'you', 'community', 'groups', 'happening']);
  assert.deepEqual(ids({ parts: { bible: true, community: true }, page: 'chat' }), ['community', 'groups', 'happening', 'welcome', 'votd', 'read', 'library', 'you']);
  assert.deepEqual(ids({ parts: { bible: true }, page: 'chat' }), ['welcome', 'votd', 'read', 'library', 'you']);
  assert.deepEqual(ids({ parts: { community: true }, page: 'today' }), ['community', 'groups', 'happening']);
  assert.equal(M.memberTourGroupsText({ minor: true, count: 0 }), 'Your church hasn’t opened any groups for you yet.');
  assert.equal(M.memberTourGroupsText(null), 'Groups you can join.');
  // the Community words never say "rooms" (owner: groups or teams)
  for (const s of M.memberTourPlan({ parts: { community: true } })) assert.doesNotMatch(s.title + ' ' + s.text, /\brooms?\b/i);
});

test('reader tips: one at a time, in order; Listen only with an audio Bible on the phone', () => {
  const { React } = miniReact();
  const { M } = kit(React, {}, { querySelector: () => null }, new Map());
  const all = () => true;
  const next = (seen, audio, present = all) => { const t = M.memberTourNextTip({ seen: (k) => seen.includes(k), present, audio }); return t && t.id; };
  assert.equal(next([], false), 'verse');
  assert.equal(next(['tip.verse'], false), 'version');
  assert.equal(next(['tip.verse', 'tip.version'], false), 'study', 'Listen was offered with no audio Bible');
  assert.equal(next(['tip.verse', 'tip.version'], true), 'listen');
  assert.equal(next(['tip.verse', 'tip.version', 'tip.listen', 'tip.study'], true), null);
  assert.equal(next(['tip.verse'], false, (a) => a !== 'version'), 'study', 'a tip whose button is not on screen was not passed over');
});

test('the bubble stays inside a 16px gutter and clear of the safe areas at phone width', () => {
  const { React } = miniReact();
  const { K } = kit(React, {}, { querySelector: () => null }, new Map());
  const vp = { w: 390, h: 844, t: 47, b: 34 }, size = { w: 320, h: 190 };
  for (const rect of [null, { left: 4, top: 4, right: 48, bottom: 48, width: 44, height: 44 }, { left: 300, top: 770, right: 380, bottom: 830, width: 80, height: 60 }]) {
    const p = K.tourKitPlace(rect, size, vp);
    assert.ok(p.left >= 16 && p.left + size.w <= vp.w - 16, 'left out of the gutter for ' + JSON.stringify(rect));
    assert.ok(p.top >= 16 + vp.t && p.top + size.h <= vp.h - 16 - vp.b, 'top ' + p.top + ' under a safe area for ' + JSON.stringify(rect));
  }
});

// ══════════════ THE SHELLS ══════════════════════════════════════════════════════════════════════════════
test('both pages load tour-kit.jsx, before their own tour; neither tour file is one the member build strips', () => {
  const tags = (f) => [...read(f).matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const idx = tags('index.html'), stw = tags('steward.html');
  assert.ok(idx.indexOf('app/tour-kit.jsx') >= 0 && idx.indexOf('app/tour-kit.jsx') < idx.indexOf('app/member-tour.jsx') && idx.indexOf('app/member-tour.jsx') < idx.indexOf('app/app.jsx'),
    'index.html must load tour-kit.jsx, then member-tour.jsx, then app.jsx');
  assert.ok(stw.indexOf('app/tour-kit.jsx') >= 0 && stw.indexOf('app/tour-kit.jsx') < stw.indexOf('app/stew-tour.jsx'), 'steward.html must load tour-kit.jsx before stew-tour.jsx');
  // scripts/sync-web.sh deletes app/stew-*.js and app/steward-root.js from the member build
  for (const f of ['tour-kit', 'member-tour']) assert.ok(!/^stew-/.test(f) && f !== 'steward-root', f + ' would be stripped from the member build');
});
