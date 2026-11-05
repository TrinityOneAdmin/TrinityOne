// THE FULL-KEY HANDOVER IS A GROUP APART FROM HELPERS, AND STILL CARRIES ITS FULL-KEY WARNING.
// Run: node --test scripts/the-handover-is-a-group-apart-from-helpers.test.mjs
//
// Owner decision 2026-11-05: separate the full-key church HANDOVER (which SHARES the recovery phrase, i.e.
// gives away the whole church) from the everyday HELPERS area (revocable access that never copies the key),
// so a steward adding a helper cannot drift one row up into giving the entire church away. The handover row
// was "Stewards & handoff", sitting one row above "Helpers" in a single "Security" group; it is now "Hand
// over the church" in a "Master key" group, a group apart from "Helpers".
//
// CLAUDE.md rule 1 (test at the point of USE) and rule 3 (app/*.jsx ships UNBUNDLED, so a text match in the
// SOURCE still passes over `false && `): this MOUNTS the real DashSettings out of app/stew-dashboard.jsx,
// compiled with the same esbuild the build uses, and reads the RENDERED tree — the menu rows the console
// actually draws and the handover page it actually opens. Nothing matches text in the .jsx source. Delete the
// handover panel, or merge its row back into the Helpers cluster, and these go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const JS = compileScreen('app/stew-dashboard.jsx');

// One console, with the handful of names DashSettings takes from sibling app files stubbed — exactly as the
// other settings tests (settings-groups-collapse-and-are-remembered, folded-settings-cards-kept-their-controls)
// mount it. The REAL DashSettings, the REAL SETTINGS_GROUPS and the REAL Panel (both defined in this file) are
// what render; only cross-file leaves are stubbed.
function consoleWith(React, over = {}) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  };
  const win = {
    NETWORKS_ENABLED: true,
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    usePendingStewards: () => [],
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false,
      whereChurchLives: () => 'community',
      churchPub: 'churchpub0000000000000000000000000000000000000000000000000000000',
      actingChurch: '', pubkey: 'churchpub0000000000000000000000000000000000000000000000000000000',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'x', qrSVG: () => '<svg></svg>',
      handoffPayload: () => 'handoff-payload', exportMnemonic: () => 'word '.repeat(12).trim(),
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC', joinCode: () => 'ABC',
      ownRelay: () => 'wss://relay.grace.example/relay',
      addRelay: () => '', removeRelay: () => {}, rememberRelayName: () => {},
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    innerWidth: over.innerWidth || 500,
    localStorage,
  };
  // THE CONSOLE APK, so every group starts OPEN and the menu's rows are all on screen to read. (The Suite's
  // shut-by-default start is asserted in settings-groups-collapse-and-are-remembered; here it would only hide
  // the rows this file is about.)
  if (over.phoneApp !== false) win.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  const globals = {
    React, window: win,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' },
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
    SK_TINT: { clay: {}, sage: {}, gold: {}, ink: {} },
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
    stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashSettings };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashSettings, 'function', 'DashSettings is not a component any more — re-anchor this test');
  return { mod, win };
}

function screen(pageKey, over = {}) {
  const { React, draw } = miniReact();
  const c = consoleWith(React, over);
  const render = () => draw(c.mod.DashSettings, { initialSection: pageKey, onSectionConsumed() {} });
  render();
  return { ...c, render, tree: render() };
}

// The menu's group headers and rows, read off the class names the real nav emits (set-grp / set-grp-n,
// set-item / set-item-n), plus which group a given row sits under — resolved through the real
// aria-labelledby wiring (each <ul> of rows names its header's id), NOT by guessing from render order.
const headers = (tree) => find(tree, n => n.type === 'button' && /(^| )set-grp( |$)/.test(String((n.props || {}).className || '')));
const shownIn = (node, cls) => {
  const hit = find(node, n => new RegExp('(^| )' + cls + '( |$)').test(String((n.props || {}).className || '')));
  return hit.length ? (hit[0].kids || []).join('') : '';
};
const grpName = (h) => shownIn(h, 'set-grp-n');
const rows = (tree) => find(tree, n => n.type === 'button' && /(^| )set-item( |$)/.test(String((n.props || {}).className || '')));
const rowNames = (tree) => rows(tree).map(b => shownIn(b, 'set-item-n'));
const uls = (tree) => find(tree, n => n.type === 'ul' && /(^| )set-items( |$)/.test(String((n.props || {}).className || '')));
function groupOfRow(tree, rowName) {
  const ul = uls(tree).find(u => find(u, n => n.type === 'span' && /(^| )set-item-n( |$)/.test(String((n.props || {}).className || '')) && (n.kids || []).join('') === rowName).length);
  if (!ul) return null;
  const gid = ul.props['aria-labelledby'];
  const h = headers(tree).find(b => b.props.id === gid);
  return h ? grpName(h) : null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTROL — the list renders its rows at all; if not, nothing below means anything.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the Settings menu renders its rows, Helpers among them', () => {
  const s = screen(null);
  assert.ok(rowNames(s.tree).includes('Helpers'),
    're-anchor: the Settings menu does not render a "Helpers" row at all, so the separation below cannot be read');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE MENU SHOWS "HAND OVER THE CHURCH", NOT "STEWARDS & HANDOFF".
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the Settings menu offers a row called "Hand over the church", and the old "Stewards & handoff" name is gone', () => {
  const names = rowNames(screen(null).tree);
  assert.ok(names.includes('Hand over the church'),
    'the full-key handover row is not called "Hand over the church". The row that shares the recovery phrase ' +
    'must name the danger plainly, so it cannot be mistaken for adding a helper. Rows on screen: ' + JSON.stringify(names));
  assert.equal(names.includes('Stewards & handoff'), false,
    'the menu still shows the old "Stewards & handoff" label, which reads like naming a helper rather than ' +
    'giving the whole church away');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. IT IS A GROUP APART FROM HELPERS — not one row above it in the same cluster.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('"Hand over the church" sits in a different group from "Helpers"', () => {
  const tree = screen(null).tree;
  const handover = groupOfRow(tree, 'Hand over the church');
  const helpers = groupOfRow(tree, 'Helpers');
  assert.ok(handover, 're-anchor: could not find which group holds "Hand over the church"');
  assert.ok(helpers, 're-anchor: could not find which group holds "Helpers"');
  assert.notEqual(handover, helpers,
    'the full-key handover ("' + handover + '") and the everyday "Helpers" area ("' + helpers + '") are in the ' +
    'SAME group. The whole point of this change is that someone adding a helper cannot drift one row up into ' +
    'giving the entire church away — they must read as two separate clusters');
  // and the Church key — the other master-key item — is grouped WITH the handover, not with Helpers
  assert.equal(groupOfRow(tree, 'Church key'), handover,
    'the "Church key" row is not in the same group as "Hand over the church". Both reveal or share the one ' +
    'recovery phrase; they are the master-key cluster and belong together, apart from Helpers');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE HANDOVER PAGE STILL CARRIES ITS FULL-KEY WARNING, and points helpers at "Helpers".
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the handover page is titled "Hand over the church" and keeps its full-key warning', () => {
  const s = screen('stewards');
  const region = find(s.tree, n => n.type === 'section' && n.props['aria-label'])[0];
  assert.ok(region, 're-anchor: opening the handover page rendered no detail region');
  assert.equal(region.props['aria-label'], 'Hand over the church',
    'the open handover page is not named "Hand over the church"');
  const panel = find(s.tree, n => typeof n.type === 'function' && n.type.name === 'Panel' && n.props.title === 'Hand over the church');
  assert.equal(panel.length, 1,
    'the handover panel is not titled "Hand over the church" (found ' + panel.length + ' matching panels) — ' +
    'the visible title still says the old name or the panel is gone');
  const said = texts(region).join(' | ');
  assert.match(said, /Anyone with this phrase can fully manage the church/,
    'the full-key warning is gone from the handover page. That warning is the one thing that must survive this ' +
    'rename: the page SHARES the recovery phrase, which is the whole church');
  assert.match(said, /Helpers/,
    'the handover page no longer points a steward who only wants to add a helper at the "Helpers" area — the ' +
    'cross-reference that keeps them off the full-key path');
});
