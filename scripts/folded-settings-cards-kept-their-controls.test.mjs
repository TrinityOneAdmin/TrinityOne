// FOUR CARDS BECAME TWO ROWS AND A STRIP, AND EVERY CONTROL THEY HELD IS STILL THERE AND STILL WORKS.
// Run: node --test scripts/folded-settings-cards-kept-their-controls.test.mjs
//
// Settings → Features was five cards, two of which were a Panel wrapping ONE switch: "Giving" and
// "Practical care". Both are now rows in "Congregation features → Extras", beside "Kids check-in", which
// already had exactly that shape. Settings → Security had "Console lock" as a card of its own directly
// under "Church key"; both were about whether the one key this device holds is protected, so the lock is
// now a strip inside the church-key card, under the line that says the key is held here.
//
// Folding a card into another card is the shape that loses controls silently. The switch, its handler and
// its configuration are all somewhere else in the tree afterwards, and a screen missing a control looks
// exactly like a screen that never had one. So this file asserts, for every control that moved: it is
// rendered, it is rendered INSIDE the card it was folded into, and pressing it still does what it did.
//
// CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves every word of
// it in place and a text-matching assertion still passes. Nothing here matches text in app/*.jsx. Both
// console files are compiled with the same esbuild the build uses, the real components are rendered
// through the miniature React in scripts/render-jsx-screen.mjs, and the handlers found in the tree are
// CALLED — so a control that moved but stopped working goes red here, not just one that vanished.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const DASH = compileScreen('app/stew-dashboard.jsx');
const MEALS = compileScreen('app/stew-meals.jsx');

// app/stew-meals.jsx no longer takes Panel from the console file — the card wrapper is what was removed —
// so the REAL DashMealsPanel can be loaded on its own and handed to the console as its global, exactly as
// the classic-script build does it (stew-meals.jsx sets window.DashMealsPanel; both files share scope).
function realMeals(React, over = {}) {
  const globals = {
    React,
    window: {
      useMealsSettings: () => ({ enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' }),
      useStewardGroups: () => [], useStewardMembers: () => [], useStewardRosters: () => [],
      StewardMeals: { setEnabled: () => {}, publishCareTeam: () => {} },
      Steward: { publishGroup: () => null },
      ...(over.window || {}),
    },
    Icon: function Icon() { return null; },
    RosterModal: function RosterModal() { return null; },
    // Panel is still a global this file COULD reach — it is one classic script scope in the browser — so it
    // is supplied, not withheld. Withholding it would make "practical care went back to being a card" fail
    // as a ReferenceError, which is a harness death dressed up as a finding: every test on the tab would go
    // red and none of them would be measuring the card.
    Panel: function Panel({ title, children }) { return React.createElement('section', { 'data-panel': title }, children); },
    setTimeout, clearTimeout, console,
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, MEALS + '\nreturn { DashMealsPanel };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashMealsPanel, 'function', 'DashMealsPanel is not a component any more — re-anchor this test');
  return mod.DashMealsPanel;
}

// The console, with the REAL practical-care component mounted in it rather than a stub — the point of this
// file is where that component ends up, so a stub would be asserting about the stub.
function consoleWith(React, over = {}) {
  const win = {
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {}, ...(over.church || {}) }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    useMealsSettings: () => ({ enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' }),
    StewardMeals: { setEnabled: () => {}, publishCareTeam: () => {} },
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'steward-invite-payload', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
      publishGroup: () => null,
      ...(over.steward || {}),
    },
    addEventListener() {}, removeEventListener() {}, innerWidth: 1200,
    localStorage: { getItem: () => null, setItem() {} },
  };
  const globals = {
    React, window: win, location: { hostname: 'app.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: win.localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    Icon: function Icon() { return null; },
    Halo: function Halo() { return null; },
    SkBadge: function SkBadge() { return null; },
    SkKey: function SkKey() { return null; },
    SkQR: function SkQR() { return null; },
    SK_TINT: { clay: { bg: 'var(--clay-soft)', fg: 'var(--clay-ink)' }, sage: { bg: 'var(--sage-soft)', fg: 'var(--sage-ink)' }, gold: { bg: 'var(--gold-tint)', fg: '#8a6717' }, ink: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
    DashMealsPanel: realMeals(React, { window: { ...(over.mealsWindow || {}) } }),
    DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; },
    NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    DismissibleNote: function DismissibleNote(p) { return p.children; },
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    RosterModal: function RosterModal() { return null; },
    useStewDialog: () => ({ current: null }),
    useStewNarrow: () => false,
    churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, DASH + '\nreturn { DashSettings, Panel };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashSettings, 'function', 'DashSettings is not a component any more — re-anchor this test');
  return mod;
}

function settings(section, over = {}) {
  const { React, draw } = miniReact();
  const mod = consoleWith(React, over);
  const render = () => draw(mod.DashSettings, { initialSection: section, onSectionConsumed() {} });
  render();                                    // first draw queues the effects…
  return { render, tree: render() };           // …the second sees what they loaded
}

// The subtree of the card whose heading says `title` — the Panel element itself, so "inside this card" is a
// containment question and not a guess from the order things appear in.
function card(tree, title) {
  const hit = find(tree, n => typeof n.type === 'function' && n.type.name === 'Panel' && n.props.title === title);
  assert.equal(hit.length, 1, `expected exactly one "${title}" card, found ${hit.length} — re-anchor this test`);
  return hit[0];
}
const cardTitles = (tree) => find(tree, n => typeof n.type === 'function' && n.type.name === 'Panel').map(n => n.props.title);
const switchNamed = (tree, aria) => find(tree, n => n.type === 'button' && n.props['aria-label'] === aria);
const buttonSaying = (tree, label) => find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));
const rowSaying = (tree, label) => find(tree, n => n.type === 'div' && typeof n.props.onClick === 'function' && texts(n).join(' | ').includes(label));

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTROL — if this fails, every assertion below is meaningless.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the real Settings renders, with the real practical-care component inside it', () => {
  const f = settings('features');
  assert.match(texts(f.tree).join(' | '), /Congregation features/, 'the features card is gone — re-anchor this test');
  assert.match(texts(f.tree).join(' | '), /Practical care \(Meal trains\)/,
    'the practical-care row did not render at all, so nothing below is measuring where it sits');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. FEATURES — five cards are three, and the two that went are rows in the Extras group.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the Features tab is three cards, not five', () => {
  assert.deepEqual(cardTitles(settings('features').tree),
    ['Congregation features', 'Rules & privacy', 'Chat message tags'],
    'Giving and Practical care were each a card wrapping one switch. If either has its own card again, the ' +
    'tab is back to five boxes of equal weight for three subjects');
});

for (const [what, aria] of [['Practical care', 'Toggle practical care'], ['Giving', 'Toggle giving']]) {
  test(`the ${what} switch is inside the "Congregation features" card, in its Extras group`, () => {
    const tree = settings('features').tree;
    assert.equal(switchNamed(tree, aria).length, 1,
      `the ${what} switch is not on the Features tab at all — folding a card is how a control gets lost`);
    const feat = card(tree, 'Congregation features');
    assert.equal(switchNamed(feat, aria).length, 1,
      `the ${what} switch is on the tab but not inside "Congregation features", so it is still a card or a ` +
      'stray element of its own');
    // …and specifically in Extras, which is the group that already had this row shape.
    const extras = find(feat, n => n.type === 'h3' && texts(n).join('') === 'Extras');
    assert.equal(extras.length, 1,
      'the Extras group has no heading of its own. Giving used to be a card with an <h2>; with that gone, ' +
      'this is the only landmark left between "Congregation features" and the next card');
  });
}

test('the Giving row is still locked for the pilot — the switch is disabled and the words are not a target', () => {
  const tree = settings('features').tree;
  const sw = switchNamed(tree, 'Toggle giving');
  assert.equal(sw.length, 1, 'the giving switch is gone — re-anchor this test');
  assert.equal(sw[0].props.disabled, true,
    'the Giving switch is no longer disabled. Giving is locked off for the pilot; this switch publishes ' +
    'giving:true to every member of the church');
  assert.equal(rowSaying(tree, 'Show the Giving tab to members').length, 0,
    'the Giving row has a click handler. Every other settings row toggles when its words are pressed, and a ' +
    'row handler sails straight past `disabled` — so a press anywhere on the label would turn giving on. ' +
    'The row shape it was folded into is exactly the one that carries such a handler; do not copy it here.');
});

test('pressing the words of the practical-care row still turns practical care on', () => {
  const enabled = [];
  const s = settings('features', { mealsWindow: { StewardMeals: { setEnabled: (on) => { enabled.push(on); return null; }, publishCareTeam: () => {} } } });
  const rows = rowSaying(s.tree, 'Practical care (Meal trains)');
  assert.equal(rows.length, 1, `expected one clickable practical-care row, found ${rows.length}`);
  rows[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(enabled, [true],
    'the practical-care row lost its handler when it moved into the Extras group. Rev. Miriam lost a week ' +
    'of practical care to exactly this: "only the little switch itself responds, and I could not land on it"');
});

test('practical care still brings its own settings with it when it is on', () => {
  const s = settings('features', { mealsWindow: { useMealsSettings: () => ({ enabled: true, visibility: 'all', openedBy: 'steward', adminGroupId: '' }) } });
  const said = texts(card(s.tree, 'Congregation features')).join(' | ');
  assert.match(said, /WHO SEES OPEN NEEDS\?/,
    'practical care is on and its visibility setting is not inside the card it was folded into — the ' +
    'configuration was left behind with the card wrapper');
  assert.match(said, /WHO CAN OPEN A NEED\?/);
  assert.match(said, /CARE-TEAM GROUP/,
    'the care-team picker is gone, and an empty care team is a church where "ask for help" reaches nobody');
});

test('the giving setup is still reachable from the row it was folded into', () => {
  // The card wrapper is gone, so this link IS the whole way in to the Lightning address. Nothing else on
  // the Features tab opens it.
  // (Noted while writing this and NOT fixed here, because it predates the fold and belongs in its own
  // change: the field below has no aria-label and no title, only a placeholder. The a11y sweep in
  // console-settings-a11y.test.mjs never reached it, because it renders DashGivingPanel with an empty
  // church, where the setup is collapsed and the field does not exist.)
  const s = settings('features');
  const open = buttonSaying(card(s.tree, 'Congregation features'), 'Set up the Lightning address');
  assert.equal(open.length, 1, 'the collapsed giving setup has no way to open — the row is now all there is');
  open[0].props.onClick();
  const after = s.render();
  const field = find(after, n => n.type === 'input' && n.props.inputMode === 'email');
  assert.equal(field.length, 1, 'opening the giving setup renders no Lightning-address field');
  assert.equal(find(card(after, 'Congregation features'), n => n.type === 'input' && n.props.inputMode === 'email').length, 1,
    'the giving setup opened somewhere other than inside the card the row now lives in');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. SECURITY — the console lock is a strip inside the church-key card, and still works both ways round.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the Security tab no longer has a card for the console lock', () => {
  assert.deepEqual(cardTitles(settings('security').tree),
    ['Church key', 'Stewards & handoff', 'Delegated stewards', 'Become a steward'],
    'the console lock is a card again. It and "Church key" are the same subject — whether the one key on ' +
    'this device is protected — and two boxes made them read as two decisions');
});

test('an unlocked console offers the PIN from inside the church-key card, and the button opens the PIN dialog', () => {
  const s = settings('security');
  const key = card(s.tree, 'Church key');
  assert.match(texts(key).join(' | '), /Held on this device/,
    'the "held on this device" strip is gone — the lock was folded in under it');
  const lock = buttonSaying(key, 'Lock with a PIN');
  assert.equal(lock.length, 1,
    'there is no way to lock this console from inside the church-key card. Without a PIN the church key sits ' +
    'unencrypted and anyone who opens this browser can post as the church');
  lock[0].props.onClick();
  const dlg = find(s.render(), n => n.props && n.props.role === 'dialog');
  assert.ok(dlg.length >= 1, 'pressing "Lock with a PIN" opened nothing — the button moved but its handler did not');
});

test('a locked console offers Change PIN and Remove lock from the same place', () => {
  const s = settings('security', { steward: { hasPinLock: () => true } });
  const key = card(s.tree, 'Church key');
  for (const label of ['Change PIN', 'Remove lock']) {
    assert.equal(buttonSaying(key, label).length, 1,
      `"${label}" is not inside the church-key card. It was on the console-lock card, and that card is gone`);
  }
  buttonSaying(key, 'Remove lock')[0].props.onClick();
  const dlg = find(s.render(), n => n.props && n.props.role === 'dialog');
  assert.ok(dlg.length >= 1, '"Remove lock" opened nothing');
});

test('the console lock says which state it is in, in words and not only in a colour', () => {
  const off = texts(card(settings('security').tree, 'Church key')).join(' | ');
  const on = texts(card(settings('security', { steward: { hasPinLock: () => true } }).tree, 'Church key')).join(' | ');
  assert.match(off, /Not locked/, 'an unlocked console does not say so, so the strip reads the same either way');
  assert.match(off, /anyone who opens this browser can post as the church/i,
    'the unlocked strip no longer says what being unlocked costs');
  assert.match(on, /Locked with a PIN/, 'a locked console does not say so');
  assert.match(on, /auto-locks after 10 minutes idle/,
    'the locked strip no longer says the console locks itself, which is the half a steward relies on');
});
