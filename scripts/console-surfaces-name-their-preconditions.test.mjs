// A CONSOLE SURFACE MUST NOT OFFER AN ACTION WITHOUT NAMING ITS PRECONDITION.
// Run: node --test scripts/console-surfaces-name-their-preconditions.test.mjs
//
// Console audit 2026-09-19 §A5, §A6 and §C (TrinityOne-internal/UI-AUDIT-console-2026-09-19.md), work package
// P11b. Each test below is one surface the audit photographed on the Oppo offering something it could not do,
// or describing something that did not yet exist:
//   · Group leaders: "the people you tick below" pre-selected and Save live, on a church nobody has joined;
//   · Finance: opening the tab for the first time PUBLISHED a £ book (finance/settings, baseCurrency GBP) with
//     no currency control anywhere — against the owner's nation-neutral default;
//   · Calendar: "No upcoming services" under a "Sunday Service" the wizard had just created — the wizard's
//     meetings are calendar events, the calendar's "services" are the rota's;
//   · Set a console PIN: "Settings → Security" (the page is Settings → Church key) and "recover via your 12-word
//     phrase" on the path where the phrase has not been shown yet;
//   · Bulk upload: "Drop files here" on a phone, which has nothing to drop from;
//   · Congregation features: "Set up the Lightning address" offered two lines under "Locked during the pilot".
//
// Every screen is mounted the way the phone mounts it — scripts/console-screens.mjs compiles every console
// script with esbuild `jsx: 'transform'` into ONE scope — and the assertions read control STATE (disabled,
// present, absent), a publish spy on window.Steward, and the rendered text of the mounted tree. Where the only
// change is a sentence, the sentence is read off the RENDERED tree, never off the source file.
//
// ⚠ RULE 3 (CLAUDE.md): nothing here matches text in a .jsx file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(label)));
// a button whose text, at any depth, contains `label` (the option rows wrap their label in a div)
const buttonSaying = (tree, label) => nodes(tree).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');
// a subscription that answers at once with a fixed value — the shape makeSub (steward-root.jsx) expects
const answers = (value) => (cb) => { cb(value); return () => {}; };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. GROUP LEADERS — Save waits until there is someone to tick, or another option is chosen.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function leadersDialog({ members }) {
  const { React, reset, flush, unmount } = fakeReact();
  const publishes = [];
  const Steward = fakeSteward({ churchPub: 'cp', subscribeMembers: answers(members), publishGroup: async (g) => { publishes.push(g); return { id: 'evt' }; } });
  const { window } = fakeBrowser({ Steward });
  const { GroupLeadersModal } = loadConsole({ React, window, expr: '{ GroupLeadersModal }' });
  let tree;
  const group = { id: 'g1', name: 'Youth', leaders: [], members: members.map(m => m.pubkey) };
  const draw = () => { reset(); tree = GroupLeadersModal({ group, onClose() {} }); flush(); return tree; };
  draw(); draw();   // the second draw sees what the members subscription delivered
  return { draw, get tree() { return tree; }, publishes, unmount };
}

test('Group leaders: with nobody in the church, the dialog says so where the list would be and Save is disabled', () => {
  const d = leadersDialog({ members: [] });
  const save = button(d.tree, 'Save');
  assert.ok(save, 're-anchor: no Save button in the Group leaders dialog');
  assert.equal(save.props.disabled, true,
    'THE DEFECT: "The leaders you choose — the people you tick below" is selected, there is nobody below, and Save is live');
  const status = nodes(d.tree).find(n => n.props && n.props.role === 'status');
  assert.ok(status, 'nothing on the dialog names the precondition (no role="status" line where the list would be)');
  assert.match(said(status), /no one to tick|nobody/i, 'the empty-state line does not say there is nobody to tick: ' + JSON.stringify(said(status)));
  // pressing it anyway must publish nothing
  save.props.onClick();
  assert.equal(d.publishes.length, 0, 'a press on the disabled Save still published a leader list');
  d.unmount();
});

test('Group leaders: choosing "Stewards only" with nobody in the church makes Save live again — the block is about the leaders option, not the dialog', () => {
  const d = leadersDialog({ members: [] });
  const stewards = buttonSaying(d.tree, 'Stewards only');
  assert.ok(stewards, 're-anchor: no "Stewards only" option');
  stewards.props.onClick();
  d.draw();
  assert.equal(button(d.tree, 'Save').props.disabled, false, 'Save stays disabled after a different option is chosen');
  d.unmount();
});

test('Group leaders: with one member in the church, Save is enabled and the empty-state line is gone', () => {
  const d = leadersDialog({ members: [{ pubkey: 'p1', npub: 'npub1p1', name: 'Ruth' }] });
  assert.equal(button(d.tree, 'Save').props.disabled, false, 'Save is disabled with someone to tick');
  assert.equal(nodes(d.tree).some(n => n.props && n.props.role === 'status'), false, 'the "nobody to tick" line is shown with a member on screen');
  d.unmount();
});
