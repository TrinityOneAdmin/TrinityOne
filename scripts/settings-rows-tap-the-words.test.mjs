// TAPPING THE WORDS MUST WORK THE SWITCH — ON EVERY SETTINGS ROW, NOT JUST THE THREE THAT HAD IT.
// Run: node --test scripts/settings-rows-tap-the-words.test.mjs
//
// The switch on a settings row is a 48x28 button pinned to the far right of a full-width row. The words
// naming it are the obvious target and are ~90% of the row. Where the row has no handler, pressing them
// does nothing at all — and "nothing at all" is indistinguishable from a broken app. Colin, on the console:
// "you have to hit the little switch itself rather than the words, which Margaret will not work out",
// Margaret being 79. Rev. Miriam lost a week of practical care to the same shape.
//
// The fix already existed on the ITEMS block of "Congregation features" and on the practical-care row in
// stew-meals.jsx. Every OTHER row in DashFeaturesPanel was the same markup with the handler missing.
//
// CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves every word of
// it in place and a text match still passes. Nothing here matches text in app/*.jsx. The components are
// sliced, compiled, RENDERED through a miniature React, and the handlers found in the tree are CALLED — so
// deleting a row handler makes these go red, and so does adding one where it must not be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// Slice ONE component out of a console file, compile it the way sync-web.sh does, and hand it back with the
// names it takes from elsewhere in scope. A name the component needs and we did not supply is a
// ReferenceError at the point of use, which is what we want — a silently-stubbed global is how a test ends
// up asserting about something that is not the code.
async function loadComponent(file, name, anchor, globals) {
  const src = fnBody(read(file), anchor, name);
  const tmp = join(tmpdir(), 'rows-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__rows_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}

// The stubs that stand in for the console's shared furniture. Panel and SkConfirm are rendered, not skipped,
// so the tree below is the whole card.
const furniture = (React) => ({
  Panel: function Panel({ title, children }) { return React.createElement('section', { 'data-panel': title }, children); },
  SkConfirm: function SkConfirm(props) { return React.createElement('div', { 'data-confirm': props.title }); },
  Icon: function Icon() { return null; },
  DismissibleNote: function DismissibleNote({ children }) { return React.createElement('div', {}, children); },
  AnnounceCareModal: function AnnounceCareModal() { return null; },
  RosterModal: function RosterModal() { return null; },
});

// The row that CARRIES a given label — the one div with a click handler whose subtree says those words.
function rowFor(tree, label) {
  const rows = find(tree, n => n.type === 'div' && typeof n.props.onClick === 'function' && texts(n).join(' | ').includes(label));
  assert.equal(rows.length, 1,
    `"${label}": expected exactly one clickable row, found ${rows.length}. Either the row lost its handler ` +
    `(pressing the words does nothing, which is the bug this file exists for) or the markup moved — re-anchor.`);
  return rows[0];
}
const switchFor = (tree, ariaLabel) => {
  const b = find(tree, n => n.type === 'button' && n.props.role === 'switch' && n.props['aria-label'] === ariaLabel);
  assert.equal(b.length, 1, `the switch labelled "${ariaLabel}" is not on the card — re-anchor this test`);
  return b[0];
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// DashFeaturesPanel — "Congregation features" + "Rules & privacy", nine rows between them
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function featuresPanel(church = {}, groups = []) {
  const { React, draw } = miniReact();
  const published = [], joinPolicy = [], admitted = [];
  const Comp = await loadComponent('app/stew-dashboard.jsx', 'DashFeaturesPanel', 'function DashFeaturesPanel(', {
    React,
    window: {
      useStewardGroups: () => groups,
      useStewardMembers: () => [{ pubkey: 'm1' }],
      useStewardAdmitted: () => [],
      useStewardJoinPolicy: () => !!(church.rules && church.rules.approval),
      Steward: {
        publishProfile: (p) => published.push(p),
        setJoinPolicy: (v) => joinPolicy.push(v),
        setAdmitted: (v) => admitted.push(v),
      },
    },
    // "Congregation features → Extras" now holds the practical-care and giving rows, which are components
    // from elsewhere. Stubbed here because this file is about the ROWS THIS CARD OWNS; each of those two has
    // its own test below, driving the real component.
    DashMealsPanel: function DashMealsPanel() { return null; },
    DashGivingPanel: function DashGivingPanel() { return null; },
    ...furniture(React),
  });
  return { draw: () => draw(Comp, { church }), published, joinPolicy, admitted };
}

// label → [the switch's aria-label, what pressing the words must do]
const FEATURE_ROWS = [
  ['Bible',                          'Toggle Bible',                 p => assert.deepEqual(p.features.read, false)],
  ['Community',                      'Toggle Community',             p => assert.deepEqual(p.features.community, false)],
  ['Library',                        'Toggle Library',               p => assert.deepEqual(p.features.library, false)],
  ['Kids check-in',                  'Toggle Kids check-in',         p => assert.deepEqual(p.features.checkin, true)],
  ['Allow member photos',            'Toggle member photos',         p => assert.deepEqual(p.features.memberPhotos, false)],
  ['Require a real first & last name', 'Toggle require full name',   p => assert.deepEqual(p.rules.fullName, true)],
];

for (const [label, aria, expect] of FEATURE_ROWS) {
  test(`the words "${label}" work the switch`, async () => {
    const s = await featuresPanel();
    rowFor(s.draw(), label).props.onClick({ stopPropagation() {} });
    assert.equal(s.published.length, 1,
      `pressing the words "${label}" published nothing. On the console this row is full width and its switch ` +
      `is 48px at the far right: a steward who presses the obvious target gets no response whatsoever, and ` +
      `cannot tell the setting from a broken page`);
    expect(s.published[0]);
  });

  test(`…and the switch beside "${label}" stops the row handler firing too`, async () => {
    const s = await featuresPanel();
    let stopped = false;
    switchFor(s.draw(), aria).props.onClick({ stopPropagation() { stopped = true; } });
    assert.ok(stopped,
      `the switch for "${label}" does not stop propagation, so a press on the switch itself runs the row ` +
      `handler as well and toggles straight back — which looks exactly like nothing happening`);
    assert.equal(s.published.length, 1, `the switch for "${label}" published ${s.published.length} times, not once`);
    expect(s.published[0]);
  });
}

test('the words "Allow children’s photos" work the switch', async () => {
  // only rendered once member photos are on
  const s = await featuresPanel({ features: { memberPhotos: true } });
  rowFor(s.draw(), 'Allow children’s photos').props.onClick({ stopPropagation() {} });
  assert.equal(s.published.length, 1, 'pressing the words of the children’s-photo row published nothing');
  assert.equal(s.published[0].features.childPhotos, true);
});

test('the words "Require approval to join" work the switch', async () => {
  const s = await featuresPanel();
  rowFor(s.draw(), 'Require approval to join').props.onClick({ stopPropagation() {} });
  assert.deepEqual(s.joinPolicy, [true], 'pressing the words of the approval row changed no join policy');
  assert.equal(s.admitted.length, 1,
    'turning approval on must still grandfather everyone already here, or existing members are made to wait');
});

test('the words "Encrypt all group chat" open the confirmation, and do not seal anything on their own', async () => {
  // one unsealed group, so the switch reads OFF and pressing it is the one that seals the church
  const s = await featuresPanel({}, [{ id: 'g1', kind: 'group', name: 'Youth', encrypted: false }]);
  assert.equal(find(s.draw(), n => n.props && n.props['data-confirm']).length, 0, 'the confirmation is showing before anything was pressed');
  rowFor(s.draw(), 'Encrypt all group chat').props.onClick({ stopPropagation() {} });
  const dlg = find(s.draw(), n => n.props && n.props['data-confirm']);
  assert.equal(dlg.length, 1,
    'pressing the words of the encrypt-all row did nothing — this row reaches every group in the church and ' +
    'was the least reachable control on the card');
  assert.equal(dlg[0].props['data-confirm'], 'Encrypt all group chat?');
  assert.equal(s.published.length, 0, 'the row press sealed groups without asking — it must only offer the confirmation');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// The practical-care row (app/stew-meals.jsx) — fixed earlier, kept honest here
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the words "Practical care (Meal trains)" work the switch', async () => {
  const { React, draw } = miniReact();
  const enabled = [];
  const Comp = await loadComponent('app/stew-meals.jsx', 'DashMealsPanel', 'function DashMealsPanel(', {
    React,
    window: {
      useMealsSettings: () => ({ enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' }),
      useStewardGroups: () => [], useStewardMembers: () => [], useStewardRosters: () => [],
      StewardMeals: { setEnabled: (on) => enabled.push(on), publishCareTeam: () => {} },
    },
    ...furniture(React),
  });
  const tree = draw(Comp, { church: {} });
  rowFor(tree, 'Practical care (Meal trains)').props.onClick({ stopPropagation() {} });
  assert.deepEqual(enabled, [true],
    'pressing the words of the practical-care row did nothing. Rev. Miriam: "clicking the words … does ' +
    'nothing at all; only the little switch itself responds, and I could not land on it"');
  let stopped = false;
  find(tree, n => n.type === 'button' && n.props.role === 'switch' && n.props['aria-label'] === 'Toggle practical care')[0]
    .props.onClick({ stopPropagation() { stopped = true; } });
  assert.ok(stopped, 'the practical-care switch does not stop propagation, so a press on it would toggle straight back');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE TWO ROWS THAT MUST STAY DEAD. Their switch is `disabled` for the pilot; a row handler would sail past
// that and publish the change from a press on the label. Giving is locked and Manna is locked, and a sweep
// that "fixed every sibling" without looking would unlock both.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function lockedRow(file, name, anchor, globals, label, aria) {
  const { React, draw } = miniReact();
  const Comp = await loadComponent(file, name, anchor, { React, ...globals(React), ...furniture(React) });
  const tree = draw(Comp, { church: {} });
  const sw = find(tree, n => n.type === 'button' && n.props['aria-label'] === aria);
  assert.equal(sw.length, 1, `the ${label} switch is not on the card — re-anchor this test`);
  assert.equal(sw[0].props.disabled, true, `the ${label} switch is no longer disabled — this test guards the pilot lock`);
  const clickable = find(tree, n => n.type === 'div' && typeof n.props.onClick === 'function' && texts(n).join(' | ').includes(label));
  assert.equal(clickable.length, 0,
    `the ${label} row is clickable. Its switch is disabled for the pilot, and a row handler bypasses that ` +
    `entirely: a press anywhere on the words would turn it on. Do not add one until the lock is lifted.`);
}

test('the locked Giving row is not clickable, so the words cannot turn giving on', async () => {
  await lockedRow('app/stew-dashboard.jsx', 'DashGivingPanel', 'function DashGivingPanel(',
    () => ({ window: { Steward: { publishProfile: () => { throw new Error('giving was published from a locked row'); } } } }),
    'Show the Giving tab to members', 'Toggle giving');
});

test('the locked Manna row is not clickable, so the words cannot enable disbursements', async () => {
  await lockedRow('app/stew-manna.jsx', 'DashMannaPanel', 'function DashMannaPanel(',
    () => ({ window: {
      useMannaSettings: () => ({ enabled: false }),
      StewardManna: { setEnabled: () => { throw new Error('Manna was enabled from a locked row'); } },
    } }),
    'Disbursements (Manna)', 'Manna is locked during the pilot');
});
