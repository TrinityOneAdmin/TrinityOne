// THE OVERVIEW'S "VERSE PROMPT IS LIVE" CARD OPENS RESOURCES ON THE VERSE PROMPT, NOT ON READING PLANS.
// Run: node --test scripts/the-verse-prompt-card-opens-the-verse-prompt.test.mjs
//
// The card used to call onTab('resources'), and DashResources always started on 'plans' — so the one card on
// the Overview that is about the verse prompt landed a steward on a different page and left them to find the
// "Verse prompt" button themselves (owner report, 2026-11-16).
//
// CLAUDE.md rules 1 and 3: driven through the REAL StewDashboard (compiled with the build's esbuild, rendered
// through scripts/render-jsx-screen.mjs), tapping the card that is actually drawn, and reading which Resources
// view is actually mounted. Nothing here matches text in app/*.jsx. Deleting any of the four links — the
// card's handler, the onResources prop on DashOverview, the initialView prop on DashResources, or
// DashResources honouring it — turns this file red (measured by scoped sabotage when it was written).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const JS = compileScreen('app/stew-dashboard.jsx');

// Everything app/stew-dashboard.jsx takes from outside itself (same set as
// scripts/settings-pages-are-a-list-and-a-detail.test.mjs), plus a verse prompt that is live and a switch for
// the Resources capability.
function consoleWith(React, over = {}) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  // The Resources capability is decided by the file's OWN stewCapState(), from Steward.actingChurch and
  // myStewardCaps(); `caps` is the list a delegate holds, null for the owner console.
  const caps = over.caps === undefined ? null : over.caps;
  const win = {
    NETWORKS_ENABLED: true,
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    usePendingStewards: () => [],
    useStewardPlans: () => [],
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false,
      whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'steward-invite-payload', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
      ownRelay: () => 'wss://relay.grace.example/relay',
      backupState: async () => ({ boxes: 1, online: 1, syncOn: false }),
      addRelay: () => '', removeRelay: () => {}, rememberRelayName: () => {},
      selfRegister: async () => ({}),
      ...(caps ? { actingChurch: 'npub1grace', myStewardCaps: () => caps } : {}),
      // A verse prompt that is LIVE: a ref, no schedule. The Overview subscribes in an effect, so the card
      // appears on the draw after the first.
      subscribeVersePrompt: (cb) => { cb({ ref: 'John 3:16' }); return () => {}; },
    },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return true; },
    innerWidth: 1200,
    localStorage,
  };
  const globals = {
    React, window: win,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example', search: '' },
    navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
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
    StewHelpButton: function StewHelpButton() { return null; },
    StewHelpLink: function StewHelpLink() { return null; },
    WizMeetings: function WizMeetings() { return null; },
    _wizMeetingId: () => 'evt1',
    useStewDialog: () => ({ current: null }),
    churchHandle: () => 'grace',
  };
  const names = Object.keys(globals);
  const want = ['StewDashboard', 'DashResources', 'DashPlans', 'DashVersePrompt'];
  const mod = new Function(...names, JS + '\nreturn { ' + want.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of want) assert.equal(typeof mod[n], 'function', `${n} is not a component any more — re-anchor this test`);
  return { mod, caps };
}

// Which Resources view is MOUNTED, read off the tree by component identity — never by its words.
const mounted = (tree, mod) => ({
  resources: find(tree, n => n.type === mod.DashResources).length,
  plans: find(tree, n => n.type === mod.DashPlans).length,
  verse: find(tree, n => n.type === mod.DashVersePrompt).length,
});
const verseCard = (tree) => find(tree, n => n.type === 'button' && typeof n.props.onClick === 'function'
  && /Verse prompt (is live|scheduled)/.test(texts(n).join(' ')));
const navButton = (tree, key) => find(tree, n => n.type === 'button' && n.props.key === key && typeof n.props.onClick === 'function');

test('tapping "Verse prompt is live" on the Overview opens Resources on the Verse prompt, not Reading plans', () => {
  const { React, draw } = miniReact();
  const { mod } = consoleWith(React);
  draw(mod.StewDashboard, {});                       // the Overview subscribes to the verse prompt in an effect…
  const overview = draw(mod.StewDashboard, {});      // …and this draw shows the card
  const card = verseCard(overview);
  assert.equal(card.length, 1, 'the Overview drew no "Verse prompt is live" card for a live verse prompt — re-anchor this test');
  card[0].props.onClick();
  draw(mod.StewDashboard, {});                       // Resources mounts; its one-shot effect runs
  const after = draw(mod.StewDashboard, {});
  const m = mounted(after, mod);
  assert.equal(m.resources, 1, 'tapping the verse prompt card did not open Resources at all');
  assert.equal(m.verse, 1, 'tapping the verse prompt card opened Resources but not on the Verse prompt');
  assert.equal(m.plans, 0, 'tapping the verse prompt card opened Resources on Reading plans');
});

test('control: reaching Resources from the sidebar still opens on Reading plans', () => {
  const { React, draw } = miniReact();
  const { mod } = consoleWith(React);
  const first = draw(mod.StewDashboard, {});
  const nav = navButton(first, 'resources');
  assert.equal(nav.length, 1, 'the sidebar has no Resources button — re-anchor this test');
  nav[0].props.onClick();
  draw(mod.StewDashboard, {});
  const m = mounted(draw(mod.StewDashboard, {}), mod);
  assert.equal(m.resources, 1, 'the sidebar Resources button did not open Resources');
  assert.equal(m.plans, 1, 'a plain visit to Resources no longer opens on Reading plans');
  assert.equal(m.verse, 0, 'a plain visit to Resources opened the Verse prompt');
});

test('DashResources asked for "verse" shows the Verse prompt and reports the request consumed; unknown views fall back to plans', () => {
  {
    const { React, draw } = miniReact();
    const { mod } = consoleWith(React);
    let consumed = 0;
    const tree = draw(mod.DashResources, { initialView: 'verse', onViewConsumed: () => { consumed++; } });
    const m = mounted(tree, mod);
    assert.equal(m.verse, 1, 'DashResources ignored initialView "verse"');
    assert.equal(m.plans, 0);
    assert.equal(consumed, 1, 'DashResources did not report the one-shot request consumed, so it would re-open the verse prompt on every visit');
  }
  {
    const { React, draw } = miniReact();
    const { mod } = consoleWith(React);
    const m = mounted(draw(mod.DashResources, { initialView: 'nonsense', onViewConsumed() {} }), mod);
    assert.equal(m.plans, 1, 'an unknown initialView did not fall back to Reading plans');
  }
});

test('a verse-prompt request that Resources could not take (padlocked) does not ambush the next plain visit', () => {
  const { React, draw } = miniReact();
  const { mod, caps } = consoleWith(React, { caps: ['members'] });
  draw(mod.StewDashboard, {});
  const overview = draw(mod.StewDashboard, {});
  const card = verseCard(overview);
  assert.equal(card.length, 1, 'no verse prompt card on the Overview — re-anchor this test');
  card[0].props.onClick();                           // Resources is padlocked: StewCapBlocked, the request is unconsumed
  const blocked = draw(mod.StewDashboard, {});
  assert.equal(mounted(blocked, mod).resources, 0, 'Resources mounted although the capability is off — re-anchor this test');
  navButton(blocked, 'overview')[0].props.onClick(); // leave Resources…
  draw(mod.StewDashboard, {});                       // …the stale request is dropped here
  caps.push('content');                              // the capability arrives
  const back = draw(mod.StewDashboard, {});
  navButton(back, 'resources')[0].props.onClick();   // a plain visit
  draw(mod.StewDashboard, {});
  const m = mounted(draw(mod.StewDashboard, {}), mod);
  assert.equal(m.resources, 1);
  assert.equal(m.plans, 1, 'a plain visit to Resources opened on the Verse prompt because an old, unconsumed card tap was still pending');
});
