// THE OWNER'S BY-LINE IS ITS OWN SETTINGS PAGE, "Your name as a steward" — not the top of Delegated stewards.
// Run: node --test scripts/the-steward-by-line-is-its-own-settings-page.test.mjs
//
// Owner, 2026-09-22, from a screenshot of the Suite: the name-and-role field ("the name members see under every
// notice from this console") "shouldn't be in the delegated stewards area" — it is about the OWNER, not the
// helpers. And the example placeholders ("Rev Ada Nwachukwu" / "Vicar") go: plain "Your name" / "Role (optional)".
//
// What this file proves, on the REAL DashSettings drawn through scripts/render-jsx-screen.mjs's miniature
// React (never by matching text in app/*.jsx — rule 3):
//   1. the row exists in the list, in the People group, and a delegated steward does not get it;
//   2. opening it renders the field, with the plain placeholders, and no placeholder anywhere in Settings is
//      the old example;
//   3. Save calls the SAME handler with the same arguments it called before the move — Steward.setVoice(name,
//      office), spied — so the publish underneath (Steward._voiceSave, church-signed) is untouched;
//   4. the Delegated stewards page no longer carries the field, and the "don't share this console" sentence
//      moved with it, whose "Delegated stewards" words open that page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const JS = compileScreen('app/stew-dashboard.jsx');

function consoleWith(React, over = {}) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : (/\.setgroups\./.test(k) ? '[]' : null)),   // every group open: the list is not under test here
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const calls = [];
  const win = {
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    usePendingStewards: () => [], useStewardStewards: () => [],
    Steward: {
      isDelegated: () => !!over.delegated, actingChurch: over.delegated ? 'otherchurch' : '',
      hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'x', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
      ownRelay: () => 'wss://relay.grace.example/relay',
      backupState: async () => ({ boxes: 1, online: 1, syncOn: false }),
      addRelay: () => '', removeRelay: () => {}, rememberRelayName: () => {},
      selfRegister: async () => ({}),
      stewardCaps: () => ({}), stewardLabels: () => ({}), stewardSince: () => ({}), stewardCapNames: () => [],
      // the by-line as stored, and the spy on the one handler that publishes it
      voice: () => ({ self: over.self || null, public: {} }),
      setVoice: async (name, office) => { calls.push([name, office]); return true; },
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    innerWidth: 1200, localStorage,
  };
  const globals = {
    React, window: win,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' },
    navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, Halo: function Halo() { return null; },
    SkBadge: function SkBadge() { return null; }, SkKey: function SkKey() { return null; },
    SkQR: function SkQR() { return null; }, SkPill: function SkPill() { return null; },
    SK_TINT: { clay: {}, sage: {}, gold: {}, ink: {} },
    DashMealsPanel: function DashMealsPanel() { return null; }, DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; }, NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    DismissibleNote: function DismissibleNote(p) { return p.children; }, ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    StewHelpButton: function StewHelpButton() { return null; }, StewHelpLink: function StewHelpLink() { return null; },
    WizMeetings: function WizMeetings() { return null; }, _wizMeetingId: () => 'evt1',
    useStewDialog: () => ({ current: null }), churchHandle: () => 'grace', stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashSettings, SETTINGS_GROUPS };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashSettings, 'function', 'DashSettings is not a component any more — re-anchor this test');
  return { mod, calls };
}

function settings(pageKey, over = {}) {
  const { React, draw } = miniReact();
  const c = consoleWith(React, over);
  const render = () => draw(c.mod.DashSettings, { initialSection: pageKey, onSectionConsumed() {} });
  render();
  return { ...c, render, tree: render() };
}

const rows = (tree) => find(tree, n => n.type === 'button' && /(^| )set-item( |$)/.test(String((n.props || {}).className || '')));
const shownIn = (node, cls) => { const hit = find(node, n => new RegExp('(^| )' + cls + '( |$)').test(String((n.props || {}).className || ''))); return hit.length ? (hit[0].kids || []).join('') : ''; };
const rowNames = (tree) => rows(tree).map(b => shownIn(b, 'set-item-n'));
const region = (tree) => find(tree, n => n.type === 'section' && n.props['aria-label'])[0];
const inputs = (node) => find(node, n => n.type === 'input');
const nameField = (node) => inputs(node).find(i => i.props['aria-label'] === 'Your name');
const roleField = (node) => inputs(node).find(i => i.props['aria-label'] === 'Your role');
// A button by the words it SHOWS — its own string children, not texts(), which folds class names in too.
const buttonSaying = (node, re) => find(node, n => n.type === 'button' && re.test((n.kids || []).filter(k => typeof k === 'string').join('').trim()));
const ROW = 'Your name as a steward';

test('CONTROL: the Delegated stewards page still renders, and the People group still holds its three older pages', () => {
  const s = settings('delegated');
  assert.equal(region(s.tree).props['aria-label'], 'Delegated stewards', 're-anchor: the delegated page did not open');
  const names = rowNames(s.tree);
  for (const n of ['Congregation features', 'Rules & privacy', 'Chat message tags']) assert.ok(names.includes(n), `re-anchor: "${n}" is not in the list`);
});

test('the row "Your name as a steward" is in the list, in the People group, after Chat message tags and before the Security pages', () => {
  const s = settings(null);
  const names = rowNames(s.tree);
  assert.ok(names.includes(ROW), 'the by-line has no row of its own in Settings');
  const grp = s.mod.SETTINGS_GROUPS.find(([, items]) => items.some(p => p.n === ROW));
  assert.equal(grp && grp[0], 'People', 'the row is not in the People group');
  assert.equal(names.indexOf(ROW), names.indexOf('Chat message tags') + 1, 'the row is not the last of People, directly after Chat message tags');
  assert.ok(names.indexOf(ROW) < names.indexOf('Delegated stewards'), 'the row is not above Delegated stewards');
});

test('a delegated steward does not get the row — the by-line is the owner\'s, and its document is church-signed', () => {
  const d = settings(null, { delegated: true });
  assert.equal(rowNames(d.tree).includes(ROW), false, 'a delegate\'s list offers the owner\'s by-line, which their console cannot publish');
});

test('opening the row renders the name and role fields, with plain placeholders, and no example name anywhere in Settings', () => {
  const s = settings('voice');
  assert.equal(region(s.tree).props['aria-label'], ROW, 'the row did not open a page named for it');
  const nm = nameField(region(s.tree)), rl = roleField(region(s.tree));
  assert.ok(nm && rl, 'the page does not render both the name field and the role field');
  assert.equal(nm.props.placeholder, 'Your name', 'the name field\'s placeholder is not the plain "Your name"');
  assert.equal(rl.props.placeholder, 'Role (optional)', 'the role field\'s placeholder is not the plain "Role (optional)"');
  // every page, every input: the example vicar is gone from the placeholders
  for (const [, items] of s.mod.SETTINGS_GROUPS) {
    for (const p of items) {
      const t = settings(p.k).tree;
      for (const i of inputs(t)) {
        assert.doesNotMatch(String(i.props.placeholder || ''), /Nwachukwu|^Vicar$/, `the ${p.k} page still shows the example placeholder "${i.props.placeholder}"`);
      }
    }
  }
});

test('Save calls Steward.setVoice(name, office) — the same handler, the same arguments, as before the move', async () => {
  const s = settings('voice');
  const page = region(s.tree);
  nameField(page).props.onChange({ target: { value: 'Rev Ada' } });
  roleField(region(s.render())).props.onChange({ target: { value: 'Vicar' } });
  const save = buttonSaying(region(s.render()), /^Save$/);
  assert.equal(save.length, 1, 'no Save button on the page');
  await save[0].props.onClick();
  assert.deepEqual(s.calls, [['Rev Ada', 'Vicar']], 'Save did not call setVoice with the typed name and role');
  // and what the page shows back is fed from the same store: a stored by-line pre-fills the fields
  const again = settings('voice', { self: { name: 'Rev Ada', office: 'Vicar' } });
  assert.equal(nameField(region(again.tree)).props.value, 'Rev Ada', 'a stored by-line does not pre-fill the name');
  assert.equal(roleField(region(again.tree)).props.value, 'Vicar', 'a stored by-line does not pre-fill the role');
});

test('the Delegated stewards page no longer carries the field; the "don\'t share this console" sentence went with it, and its words open that page', () => {
  const d = settings('delegated');
  assert.equal(nameField(region(d.tree)), undefined, 'the by-line field is still on the Delegated stewards page');
  assert.doesNotMatch(texts(region(d.tree)).join(' '), /don’t share this console/, 'the "don\'t share this console" sentence is still on the Delegated stewards page');
  const v = settings('voice');
  assert.match(texts(region(v.tree)).join(' '), /don’t share this console/, 'the "don\'t share this console" sentence did not move to the by-line page');
  const link = buttonSaying(region(v.tree), /^Delegated stewards$/);
  assert.equal(link.length, 1, 'the sentence has no "Delegated stewards" control to take the steward there');
  link[0].props.onClick();
  assert.equal(region(v.render()).props['aria-label'], 'Delegated stewards', 'pressing "Delegated stewards" in the sentence did not open that page');
});
