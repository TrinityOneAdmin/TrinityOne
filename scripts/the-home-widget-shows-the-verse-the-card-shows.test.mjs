// THE HOME-SCREEN WIDGET SHOWS THE VERSE THE TODAY CARD SHOWS — TODAY, AND AFTER "ANOTHER VERSE".
//   Run: node --test scripts/the-home-widget-shows-the-verse-the-card-shows.test.mjs
//
// reference/PLAN-phone-widget-2026-11-16.html, slice 1. The widget cannot run the app's JavaScript, so the
// Today screen writes it a 60-day table of verses (TrinityWidget.publishVotd) and the native widget looks up
// today's local date in it. This file is the POINT OF USE (CLAUDE.md rule 1): it renders the REAL TodayScreen
// (compiled from app/screens-today.jsx by scripts/render-jsx-screen.mjs, the same esbuild the APK build uses)
// with a recording stand-in for the native plugin, and reads the card's verse OFF THE RENDERED TREE — so
// deleting the write from the screen, or breaking the "Another verse" rewrite, turns this red even though
// the pure table builder below stays correct. Nothing here matches text in app/*.jsx (rule 3).
//
// Runs in Europe/London so the summer-time rows mean the same thing on every machine.
process.env.TZ = 'Europe/London';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileScreen, loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const POOL = [
  { ref: 'John 3:16', text: 'POOL-A For God so loved the world.' },
  { ref: 'Psalms 23:1', text: 'POOL-B The Lord is my shepherd.' },
  { ref: 'Romans 8:28', text: 'POOL-C All things work together for good.' },
];
// A loaded translation that has John 3:16 only — proves the widget gets the member's TRANSLATION, not the pool.
const TRANSLATED = 'BSB-TEXT For God so loved the world that He gave His one and only Son.';
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const localISO = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

function todayScreen({ widget = '1', plugin = true, church = '', locked = false, pin = false, rememberedUntil = 0, feedBases = null, feed = {}, resources = true, nativeEnabled = null, unreachable = [], redirectTo = {}, parseRef = null, chapters = {}, bibleLoaded = true } = {}) {
  const listeners = {};
  const opts = { feedBases };
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const date = new Date('2026-09-30T09:00:00Z');   // 10:00 BST
  const store = new Map([['trinityone.votd-min', '0']]);   // the card EXPANDED, so "Another verse" is on screen
  if (widget != null) store.set('trinityone.widget', widget);
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
  const native = { prompt: null };   // what the fake plugin holds in "widget storage"
  const published = [], prompts = [], textsSent = [], promptRefused = [], warned = [], cleared = [], fetched = [], fetchInits = [], probed = [], hearted = [];
  const win = {
    addEventListener(t, h) { (listeners[t] = listeners[t] || []).push(h); }, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [],
      widgetFeedBases: (np) => (opts.feedBases && np === church ? { npub: CHURCH_NPUB, bases: opts.feedBases } : null) },
    TrinityIdentity: { rememberedUntil: async () => rememberedUntil },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }], VOTD_POOL: POOL },
    Bible: {
      parseRef: parseRef || (r => (r === 'John 3:16' ? { book: 43, chap: 3, verse: 16 } : r === 'Psalms 23:1' ? { book: 19, chap: 23, verse: 1 } : null)),
      // `chapters` ({ 'book:chap': rows }) adds whole chapters of this phone's Bible (the passage tests below).
      loaded: bibleLoaded, books: () => [43].concat(Object.keys(chapters).map(k => Number(k.split(':')[0]))),
      getVerses: (b, c) => (chapters[b + ':' + c] ? chapters[b + ':' + c] : b === 43 && c === 3 ? [{ v: 16, text: TRANSLATED }] : []),
      maxChapter: () => 1, activeVersion: 'BSB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }),
      refKey: (loc, v) => loc.book + '.' + loc.chap + '.' + v,   // the reader's canonical key (the verse heart uses it)
    },
    Capacitor: plugin ? { Plugins: { TrinityWidget: { status: () => Promise.resolve(nativeEnabled == null ? { supported: true } : { supported: true, enabled: nativeEnabled }),
      // PromptFetchJob.probe's contract: https only, NO redirects (a redirecting base is a failure), found / absent
      // (EVERY base 404) / unreachable.
      probe: async ({ npub, bases }) => { probed.push({ npub, bases: [...bases] }); let best = null, n404 = 0, fail = 0;
        for (const b of bases) { if (!/^https:\/\//.test(b)) continue; if (unreachable.includes(b) || redirectTo[b]) { fail++; continue; }
          if (feed[b] && npub === CHURCH_NPUB) { if (!best || (feed[b].ts || 0) > (best.ts || 0)) best = feed[b]; } else n404++; }
        return best ? { outcome: 'found', copy: best } : (n404 && !fail ? { outcome: 'absent' } : { outcome: 'unreachable' }); }, publishVotd: (a) => { published.push(a); return Promise.resolve(); },
      // TrinityWidgetPlugin.promptArgs's contract (JVM-tested: native/trinity-widget/android/src/test/…/PublishPromptArgsTest):
      // validUntil must be a NUMBER of unix SECONDS, in the future and at most 366 days out; anything else is REFUSED.
      // (Until 2026-11-17 the native side read it with PluginCall.getLong, silently stored 0 and dropped the config at
      // the next redraw while resolving — a stub that accepted everything could never show that.)
      publishPrompt: (a) => { const v = a && a.validUntil, nowS = Math.floor(date.getTime() / 1000);
        if (!/^npub1[a-z0-9]{58}$/.test(String(a && a.npub))) { promptRefused.push(a); return Promise.reject(new Error('bad npub')); }
        if (typeof v !== 'number' || !Number.isFinite(v) || Math.trunc(v) <= nowS || Math.trunc(v) > nowS + 366 * 86400) { promptRefused.push(a); return Promise.reject(new Error('bad validUntil')); }
        prompts.push(a); native.prompt = JSON.parse(JSON.stringify(a)); return Promise.resolve(); },
      // TrinityWidgetPlugin.publishTexts (JVM-tested: PublishTextsTest): ONLY the stored config's texts, and only for
      // the same church; nothing stored or another church's -> { updated: false }, nothing changes.
      publishTexts: (a) => { textsSent.push(a);
        if (!/^npub1[a-z0-9]{58}$/.test(String(a && a.npub))) return Promise.reject(new Error('bad npub'));
        if (!a.texts || typeof a.texts !== 'object') return Promise.reject(new Error('bad texts'));
        if (!native.prompt || native.prompt.npub !== a.npub) return Promise.resolve({ updated: false });
        native.prompt.texts = JSON.parse(JSON.stringify(a.texts)); return Promise.resolve({ updated: true }); },
      clearPrompt: () => { cleared.push(1); native.prompt = null; return Promise.resolve(); } } } } : undefined,
  };
  let pickStore = null;
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console: { ...console, warn: (...a) => { warned.push(a.join(' ')); } },
    Icon, ChurchBadge,
    lsGet: (k, d) => (k === 'trinityone.streak' ? { count: 7, last: localISO(date) } : k === 'trinityone.votd-pick' ? pickStore : d),
    lsSet: (k, v) => { if (k === 'trinityone.votd-pick') pickStore = v; },
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => localISO(date),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    // THE WEBVIEW'S fetch AS IT IS ON THE APK (audit re-check R1): CapacitorHttp is enabled, so every external GET goes
    // through https://localhost/_capacitor_http_interceptor_?u=… and the response's url is THAT, never the relay's.
    fetch: async (url, init) => { fetched.push(String(url)); fetchInits.push(init || {});
      const iurl = 'https://localhost/_capacitor_http_interceptor_?u=' + encodeURIComponent(String(url));
      const base = Object.keys({ ...feed, ...redirectTo }).concat(unreachable).find(b => String(url).startsWith(b + '/'));
      if (base && unreachable.includes(base)) throw new Error('unreachable');
      if (base && redirectTo[base]) return { status: 200, ok: true, url: iurl, json: async () => ({ ts: 9, ref: 'ELSEWHERE 1:1', schedule: [] }) };
      const hit = Object.keys(feed).find(b => String(url) === b + '/public/' + CHURCH_NPUB + '/verse-prompt.json'); return hit ? { status: 200, ok: true, url: iurl, json: async () => feed[hit] } : { status: 404, ok: false, url: iurl, json: async () => ({}) }; },
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const ctx = {
    church: { name: 'Grace', initials: 'SB', npub: 'np1', features: resources ? {} : { resources: false } },
    churchNpub: church, commLocked: locked, hasCommunityPin: pin,
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {}, openShareSheet() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
    bookmarkItems: [], toggleBookmark: (k) => { hearted.push(k); }, setBookmarkTags: () => {},
  };
  return { draw: () => draw(TodayScreen, { ctx }), bible: win.Bible, native, published, prompts, textsSent, promptRefused, warned, cleared, fetched, fetchInits, probed, hearted, opts, store,
    fire: (t) => (listeners[t] || []).forEach(h => h({})), today: localISO(date), nowS: Math.floor(date.getTime() / 1000) };
}

// The verse the CARD shows, read off the rendered tree: which pool ref's label is on screen, and the text.
function cardVerse(tree) {
  const all = texts(tree).join('\n');
  const refs = POOL.map(p => p.ref).filter(r => all.includes(r));
  const text = [TRANSLATED, ...POOL.map(p => p.text)].find(t => all.includes(t)) || null;
  return { refs, text };
}

test('with the widget ON, Today writes the widget a 60-day table whose TODAY is the verse on the card', () => {
  const s = todayScreen();
  const tree = s.draw();
  const card = cardVerse(tree);
  assert.equal(card.refs.length, 1, `expected exactly one verse reference on the card, saw ${JSON.stringify(card.refs)}`);
  assert.equal(s.published.length, 1,
    `Today did not write the home-screen widget's table (publishVotd called ${s.published.length} times) — ` +
    `the widget would show nothing, or a stale verse, for ever`);
  const days = s.published[0].days;
  assert.equal(Object.keys(days).length, 60, 'the table does not run 60 days ahead');
  assert.ok(days[s.today], `the table has no entry for today (${s.today})`);
  assert.equal(days[s.today].ref, card.refs[0], 'the widget would show a DIFFERENT verse from the Today card');
  assert.equal(days[s.today].text, card.text, 'the widget text is not the text the card shows (translation lost?)');
});

test('"Another verse" rewrites TODAY on the widget to the new card verse, and leaves the other 59 days alone', () => {
  const s = todayScreen();
  let tree = s.draw();
  const before = cardVerse(tree).refs[0];
  const btn = find(tree, n => n.type === 'button' && (n.props || {})['aria-label'] === 'Another verse');
  assert.equal(btn.length, 1, 'no "Another verse" control on the expanded card — nothing to press');
  btn[0].props.onClick({ stopPropagation() {} });
  tree = s.draw();
  const after = cardVerse(tree);
  assert.equal(after.refs.length, 1);
  assert.notEqual(after.refs[0], before, 'pressing "Another verse" did not change the card — the test cannot see the pick path');
  assert.equal(s.published.length, 2,
    `after "Another verse" the widget's table was not rewritten (publishVotd called ${s.published.length} times): ` +
    `the home screen would keep showing ${before} while the app shows ${after.refs[0]}`);
  const [first, second] = s.published.map(p => p.days);
  assert.equal(second[s.today].ref, after.refs[0], 'the rewritten table does not show the picked verse for today');
  for (const day of Object.keys(first)) {
    if (day === s.today) continue;
    assert.deepEqual(second[day], first[day], `the pick changed ${day} too — it must only change today`);
  }
});

test('with the widget OFF (the default), Today writes nothing for it', () => {
  for (const widget of [null, '0']) {
    const s = todayScreen({ widget });
    s.draw();
    assert.equal(s.published.length, 0, `widget setting ${JSON.stringify(widget)}: Today wrote the widget table anyway`);
  }
});

test('on the web / iOS (no native plugin) Today renders and writes nothing', () => {
  const s = todayScreen({ plugin: false });
  const tree = s.draw();
  assert.equal(cardVerse(tree).refs.length, 1, 'the card is missing when the plugin is absent');
});

// ── the pure pieces: the card's own rule, at NOON ─────────────────────────────────────────────────────────────
function pure() {
  const { React } = miniReact();
  return loadScreen('app/screens-today.jsx', ['votdDayPick', 'votdWidgetDays', 'TodayScreen'],
    { React, window: {}, localStorage: { getItem: () => null } });
}
const pool365 = () => { const js = compileScreen('app/data.jsx'); const w = {}; new Function('window', js)(w); return w.TrinityData.VOTD_POOL; };

test('each table day is the card rule evaluated at local NOON — across both summer-time changes', () => {
  const { votdDayPick, votdWidgetDays } = pure();
  const pool = pool365();
  const from = new Date(2026, 2, 1, 0, 30);   // 1 Mar 2026, spans the 29 Mar change
  const days = votdWidgetDays(pool, null, from, 245, null);   // to late October, spanning the 25 Oct change
  for (const [iso, e] of Object.entries(days)) {
    const [y, m, d] = iso.split('-').map(Number);
    assert.equal(e.ref, votdDayPick(pool, new Date(y, m - 1, d, 12)).ref, `${iso}: the table differs from the card at noon`);
  }
  assert.ok(days['2026-03-29'] && days['2026-10-25'], 'the table skipped a summer-time change day');
});

test('KNOWN FINDING (not fixed here): in summer time the CARD rule returns yesterday between 00:00 and 01:00', () => {
  // Documents the card's behaviour as it is today (plan §4). When the owner has it fixed, flip this row on purpose.
  const { votdDayPick } = pure();
  const pool = pool365();
  assert.equal(votdDayPick(pool, new Date(2026, 6, 1, 0, 30)).ref, votdDayPick(pool, new Date(2026, 5, 30, 12)).ref,
    '00:30 BST on 1 July no longer returns 30 June\'s verse — the card bug was fixed; update this row and the plan');
  assert.notEqual(votdDayPick(pool, new Date(2026, 6, 1, 12)).ref, votdDayPick(pool, new Date(2026, 5, 30, 12)).ref);
});

// ── the Settings switch: the only way the widget is ever switched on ─────────────────────────────────────────
function settingsSwitch({ plugin = true } = {}) {
  const { React, draw } = miniReact();
  const store = new Map(), calls = [], events = [];
  const W = { setEnabled: (a) => { calls.push(['setEnabled', a.on]); return Promise.resolve(); }, requestPin: () => { calls.push(['requestPin']); return Promise.resolve({ requested: true }); } };
  const win = { Capacitor: plugin ? { Plugins: { TrinityWidget: W } } : { Plugins: {} },
    TrinityIdentity: { qrSVG: () => '' }, addEventListener() {}, removeEventListener() {}, dispatchEvent: (e) => { events.push(e.type); },
    innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  const globals = {
    React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console, fetch: async () => ({ ok: false }),
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'), AvatarPicker: Stub('AvatarPicker'),
    QRScanner: Stub('QRScanner'), BackupCard: Stub('BackupCard'), ChurchBadge: Stub('ChurchBadge'),
    Overlay: Stub('Overlay'), BottomSheet: Stub('BottomSheet'), NotifToggleRow: Stub('NotifToggleRow'),
    safeCssColor: (c) => c, lsGet: (k, d) => d, lsSet: () => {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  };
  const { HomeWidgetToggle } = loadScreen('app/identity.jsx', ['HomeWidgetToggle'], globals);
  return { draw: () => draw(HomeWidgetToggle, {}), store, calls, events };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('the Settings switch is OFF by default, and turning it on enables the widget and tells Today', async () => {
  const s = settingsSwitch();
  let tree = s.draw();
  let sw = find(tree, n => n.type === 'button' && (n.props || {}).role === 'switch');
  assert.equal(sw.length, 1, 'no home-screen widget switch in Settings on the APK');
  assert.equal(sw[0].props['aria-checked'], false, 'the widget switch is ON for a member who never touched it — it must be opt-in');
  sw[0].props.onClick({ stopPropagation() {} });
  await tick(); await tick();
  assert.equal(s.store.get('trinityone.widget'), '1', 'turning the switch on did not record it, so Today never writes the widget');
  assert.deepEqual(s.calls[0], ['setEnabled', true], 'turning the switch on did not enable the native widget');
  assert.ok(s.events.includes('trinity-widget-changed'), 'Today is not told the widget was switched on');
  tree = s.draw();
  sw = find(tree, n => n.type === 'button' && (n.props || {}).role === 'switch');
  sw[0].props.onClick({ stopPropagation() {} });
  await tick(); await tick();
  assert.equal(s.store.get('trinityone.widget'), '0');
  assert.ok(s.calls.some(c => c[0] === 'setEnabled' && c[1] === false), 'turning the switch off did not disable (and clear) the widget');
});

test('without the native plugin (web, iOS) there is no widget switch at all', () => {
  const s = settingsSwitch({ plugin: false });
  const tree = s.draw();
  assert.equal(find(tree, n => n.type === 'button' && (n.props || {}).role === 'switch').length, 0);
});

// ── slice 1b: the church's PUBLIC verse prompt (plan §4b) ────────────────────────────────────────────────────
const CHURCH_NPUB = 'npub1' + 'q'.repeat(58);
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
const COPY = { generator: 'TrinityOne', v: 1, ts: 1790000000, ref: 'John 3:16', schedule: [{ at: 1790000100, ref: 'Psalms 23:1' }] };

test('1b: Today hands the widget ONLY admitted https relays, the npub, a week\'s validity and the member\'s translation', async () => {
  const s = todayScreen({ church: 'grace', feedBases: ['https://box.example', 'wss://not-http.example', 'http://cleartext.example', 'https://a8.example'], feed: { 'https://a8.example': COPY } });
  s.draw(); await settle();
  assert.equal(s.prompts.length, 1, `Today did not configure the widget's church verse prompt (publishPrompt called ${s.prompts.length} times)`);
  const p = s.prompts[0];
  assert.equal(p.npub, CHURCH_NPUB);
  assert.deepEqual(p.bases, ['https://box.example', 'https://a8.example'],
    'the widget was handed an address that is not an admitted https relay from Fellowship.widgetFeedBases (CLAUDE.md rule 10)');
  assert.equal(s.probed.length, 1);
  assert.deepEqual(s.probed[0].bases, ['https://box.example', 'https://a8.example'], 'Today asked the native probe about an address it was not given');
  assert.equal(p.validUntil, s.nowS + 7 * 86400, 'with no PIN the config must expire in a week, enforced natively');
  assert.equal(p.cached.ref, 'John 3:16');
  assert.equal(p.texts['John 3:16'], TRANSLATED, 'the widget does not get the member\'s own translation of the prompt');
});

test('1b: a PIN without "remember me" gets NO church config (it would outlive the lock); with it, validity = its expiry', async () => {
  let s = todayScreen({ church: 'grace', pin: true, rememberedUntil: 0, feedBases: ['https://a8.example'], feed: { 'https://a8.example': COPY } });
  s.draw(); await settle();
  assert.equal(s.prompts.length, 0, 'a member with a PIN and no remember-me had the church written outside the lock');
  assert.ok(s.cleared.length >= 1, 'and what was there was not cleared');
  s = todayScreen({ church: 'grace', pin: true, rememberedUntil: 1800000000, feedBases: ['https://a8.example'], feed: { 'https://a8.example': COPY } });
  s.draw(); await settle();
  assert.equal(s.prompts.length, 1);
  assert.equal(s.prompts[0].validUntil, 1800000000, 'validity is not the remember-me expiry');
});

test('1b: locked, no church, Resources off, widget off, or nothing shared — the church config is CLEARED, never written', async () => {
  const cases = {
    locked: { church: 'grace', locked: true },
    'no church': { church: '' },
    'resources off': { church: 'grace', resources: false },
    'widget off': { church: 'grace', widget: '0' },
    'nothing shared (404 everywhere)': { church: 'grace', feed: {} },
  };
  for (const [name, o] of Object.entries(cases)) {
    const s = todayScreen({ feedBases: ['https://a8.example'], feed: { 'https://a8.example': COPY }, ...o });
    s.draw(); await settle();
    assert.equal(s.prompts.length, 0, `${name}: the church verse prompt was written to the widget`);
    assert.ok(s.cleared.length >= 1, `${name}: the widget's church config was not cleared`);
  }
});

test('1b: before any relay is admitted, Today writes NO address (and does not clear a good config)', async () => {
  const s = todayScreen({ church: 'grace', feedBases: [], feed: {} });
  s.draw(); await settle();
  assert.equal(s.prompts.length, 0);
  assert.equal(s.probed.length + s.fetched.length, 0, 'Today probed something although no relay was admitted');
});

test('DEVICE 2026-11-17: a config the native side REFUSES is not taken for success — logged, and asked again on the next run', async () => {
  // A validUntil in milliseconds (or anything not future unix seconds) is refused by TrinityWidgetPlugin.promptArgs.
  const s = todayScreen({ church: 'grace', pin: true, rememberedUntil: 1800000000 * 1000, feedBases: ['https://a8.example'], feed: { 'https://a8.example': COPY } });
  s.draw(); await settle();
  assert.equal(s.prompts.length, 0, 'the fake plugin accepted a validUntil the real one refuses');
  assert.equal(s.promptRefused.length, 1, 'Today did not try to configure the widget');
  assert.ok(s.warned.some(w => /publishPrompt refused: bad validUntil/.test(w)), 'the refusal was swallowed without a word');
  // audit L2: a config that cannot be bounded is never kept — the old one (maybe older relay addresses) is cleared.
  assert.equal(s.cleared.length, 1, 'a validUntil refusal left the previous native config in place');
  s.fire('trinity-relays-verified'); s.draw(); await settle();
  assert.equal(s.probed.length, 2, 'after a refusal Today kept the hourly throttle, so the widget stays unconfigured for an hour');
});

// DEVICE D1 2026-11-17: the live prompt "1 Samuel 8:11-18; Matthew 20:27-29; Numbers 7" showed "Tap to read" for
// Numbers 7 — the texts map was filled one VERSE per ref. parseRef here is the REAL one, lifted from engine.js.
const ENGINE = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
const realParseRef = (() => {
  const a = ENGINE.indexOf('  const BOOK_NAMES = ['), b = ENGINE.indexOf('  const USFM_BOOK = {');
  assert.ok(a > 0 && b > a, 're-anchor: engine.js parseRef moved');
  return new Function(ENGINE.slice(a, b) + '\nreturn parseRef;')();
})();
const chapterOf = (tag, n) => Array.from({ length: n }, (_, i) => ({ v: i + 1, text: `${tag}${i + 1} ` + 'word '.repeat(12).trim() + '.' }));
test('D1: the widget gets the member\'s text for a RANGE and a whole CHAPTER, capped, under the ref as given', async () => {
  const LIVE = { generator: 'TrinityOne', v: 1, ts: 1790000000, ref: '1 Samuel 8:11-18; Matthew 20:27-29; Numbers 7', schedule: [] };
  const s = todayScreen({ church: 'grace', feedBases: ['https://a8.example'], feed: { 'https://a8.example': LIVE },
    parseRef: realParseRef, chapters: { '9:8': chapterOf('S', 22), '40:20': chapterOf('M', 34), '4:7': chapterOf('N', 89) } });
  s.draw(); await settle();
  assert.equal(s.prompts.length, 1, 'Today did not configure the widget');
  const t = s.prompts[0].texts;
  assert.deepEqual(Object.keys(t).sort(), ['1 Samuel 8:11-18', 'Matthew 20:27-29', 'Numbers 7'], 'a passage got no text (the widget says "Tap to read")');
  assert.match(t['Matthew 20:27-29'], /^M27 .*M28 .*M29 word/, 'the range is not its verses joined');
  assert.doesNotMatch(t['Matthew 20:27-29'], /M26 |M30 /, 'the range ran past its ends');
  assert.match(t['1 Samuel 8:11-18'], /^S11 /);
  assert.match(t['Numbers 7'], /^N1 word .* N2 word/, 'the chapter does not open with its first verses');
  for (const [r, x] of Object.entries(t)) assert.ok(x.length <= 600, `${r}: ${x.length} chars crossed into widget storage`);
  assert.ok(t['Numbers 7'].endsWith('\u2026') && !/N89 /.test(t['Numbers 7']), 'an 89-verse chapter was not capped with an ellipsis');
});

test('DEVICE 2026-11-17: the Bible loading AFTER the first write sends the texts — ONLY the texts, with NO second probe', async () => {
  const LIVE = { generator: 'TrinityOne', v: 1, ts: 1790000000, ref: '1 Samuel 8:11-18; Numbers 7', schedule: [] };
  const s = todayScreen({ church: 'grace', feedBases: ['https://a8.example'], feed: { 'https://a8.example': LIVE },
    parseRef: realParseRef, chapters: { '9:8': chapterOf('S', 22), '4:7': chapterOf('N', 89) }, bibleLoaded: false });
  s.draw(); await settle();
  assert.equal(s.prompts.length, 1, 'Today did not configure the widget');
  assert.deepEqual(s.prompts[0].texts, {}, 'premise: with the Bible not loaded the first write has no texts');
  // Re-audit S1: meanwhile the BACKGROUND JOB found the copy withdrawn and stored null.
  s.native.prompt.cached = null;
  s.bible.loaded = true; s.draw(); await settle();
  assert.equal(s.probed.length, 1, 'the Bible loading probed the relays again (small pipes: the texts are local)');
  assert.equal(s.textsSent.length, 1, 'the Bible loaded but the widget was never given the texts (it says "Tap to read" for the hour)');
  assert.deepEqual(Object.keys(s.native.prompt.texts).sort(), ['1 Samuel 8:11-18', 'Numbers 7']);
  assert.equal(s.prompts.length, 1, 'the texts went through publishPrompt, which replaces the whole config');
  assert.equal(s.native.prompt.cached, null, 'the texts re-send put back a copy the background job had withdrawn');
  // Re-audit N-a: a re-run with the same texts (here: relay admission settles again) sends nothing.
  s.fire('trinity-relays-verified'); s.draw(); await settle();
  assert.equal(s.textsSent.length, 1, 'a re-run with the same texts wrote the widget again');
  assert.equal(s.probed.length, 1);
  s.bible.activeVersion = 'KJV'; s.draw(); await settle();
  assert.equal(s.textsSent.length, 2, 'a change of translation did not re-send the texts');
  assert.equal(s.probed.length, 1);
  assert.equal(s.prompts.length, 1);
});

// ── audit fixes (AUDIT-phone-widget-c60c0f72-2026-11-16) ─────────────────────────────────────────────────────
test('F4: Today follows the NATIVE state — a lost stored flag over an enabled widget still gets the table', async () => {
  const s = todayScreen({ widget: null, nativeEnabled: true });
  s.draw(); await settle(); s.draw(); await settle();
  assert.equal(s.store.get('trinityone.widget'), '1', 'the stored flag was not repaired from the native state');
  assert.ok(s.published.length >= 1, 'the widget is on the home screen but Today never wrote its table (it believed the stored flag)');
});

test('F5 / R1: the probe is NATIVE — no JS fetch (on the APK it would go through the Capacitor interceptor)', async () => {
  // With the APK-shaped fetch above, the 016bd45d code (a JS fetch + a check that the answer's url starts with the
  // base) rejected EVERY answer and the widget was never configured. The probe now runs natively.
  const s = todayScreen({ church: 'grace', feedBases: ['https://a8.example'], feed: { 'https://a8.example': COPY } });
  s.draw(); await settle();
  assert.equal(s.fetched.length, 0, 'Today fetched the feed from the webview: ' + s.fetched.join(', '));
  assert.equal(s.probed.length, 1, 'Today did not ask the native probe');
  assert.equal(s.prompts.length, 1, 'ON THE APK the widget is never configured with the church prompt');
  const r = todayScreen({ church: 'grace', feedBases: ['https://a8.example'], redirectTo: { 'https://a8.example': 'https://elsewhere.example/x.json' } });
  r.draw(); await settle();
  assert.equal(r.prompts.length, 0, 'a redirecting relay\'s answer was handed to the widget');
  assert.equal(r.cleared.length, 0, 'a redirecting (unreachable) relay is not proof of "not shared"');
});

test('F6/F7: admission finishing AFTER Today drew still configures the widget, with the new addresses', async () => {
  const s = todayScreen({ church: 'grace', feedBases: [], feed: { 'https://a8.example': COPY } });
  s.draw(); await settle();
  assert.equal(s.prompts.length, 0);
  s.opts.feedBases = ['https://a8.example'];
  s.fire('trinity-relays-verified');
  s.draw(); await settle();
  assert.equal(s.prompts.length, 1, 'a relay proved after Today drew never reached the widget — nothing re-ran the writer');
  assert.deepEqual(s.prompts[0].bases, ['https://a8.example']);
  const n = s.probed.length;
  s.fire('trinity-relays-verified'); s.draw(); await settle();
  assert.equal(s.probed.length, n, 'the same church, addresses and prompt were probed again within the hour (small pipes)');
});

test('F8: a 404 beside a base that could not be reached does NOT clear the widget\'s prompt', async () => {
  const s = todayScreen({ church: 'grace', feedBases: ['https://old.example', 'https://own.example'], feed: {}, unreachable: ['https://own.example'] });
  s.draw(); await settle();
  assert.equal(s.cleared.length, 0, 'one old relay\'s 404 wiped the prompt while the church\'s own box was only unreachable');
  assert.equal(s.prompts.length, 0);
});

test('R3: when the widget\'s church settings are cleared from ELSEWHERE, the hourly throttle does not stop Today rewriting them', async () => {
  // Church A -> B -> A within the hour: app.jsx clears on every change (TrinityIdentity.widgetForgetChurch), which
  // fires 'trinity-widget-forgot-church'. Today must forget its throttle and write A again.
  const s = todayScreen({ church: 'grace', feedBases: ['https://a8.example'], feed: { 'https://a8.example': COPY } });
  s.draw(); await settle();
  assert.equal(s.prompts.length, 1);
  s.fire('trinity-widget-forgot-church');
  s.draw(); await settle();
  assert.equal(s.probed.length, 2, 'after a clear from elsewhere Today did not probe again (throttled for up to an hour)');
  assert.equal(s.prompts.length, 2, 'after a clear from elsewhere the widget was left with no church prompt');
});

test('MERGE (integration 3b6bacd6): the verse heart files the verse ACTUALLY SHOWN — also after "Another verse"', async () => {
  const s = todayScreen({ widget: '0' });
  let tree = s.draw();
  const keyOf = { 'John 3:16': '43.3.16', 'Psalms 23:1': '19.23.1' };
  const heart = () => find(tree, n => n.type === 'button' && /Favourites$/.test(String((n.props || {})['aria-label'] || '')));
  // keep tapping "Another verse" until a verse this Bible stub can key is showing, and it differs from the first
  const first = cardVerse(tree).refs[0];
  for (let i = 0; i < 40; i++) {
    const cur = cardVerse(tree).refs[0];
    if (cur !== first && keyOf[cur]) break;
    find(tree, n => n.type === 'button' && (n.props || {})['aria-label'] === 'Another verse')[0].props.onClick({ stopPropagation() {} });
    tree = s.draw();
  }
  const shown = cardVerse(tree).refs[0];
  assert.ok(shown !== first && keyOf[shown], 're-anchor: could not get a different, keyable verse onto the card');
  assert.equal(heart().length, 1, 'no heart on the card');
  heart()[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(s.hearted, [keyOf[shown]], 'the heart filed a DIFFERENT verse from the one on the card (the day\'s, not the pick)');
});
