// REVOKING A HELPER spends their row's controls AT ONCE (no laggy miss-click target through several relay round-trips),
// but RESTORES them if the write did not land — the relay ack decides, never the click.
//
// CHANGED 2026-11-17 (removing a steward keeps what they saved): the removal now carries the person's settings over to
// the church first, for up to ~20 s, so the row no longer LEAVES at once — it stays, reads "Removing… keeping what they
// set up", and its Revoke/Permissions controls are gone until the roster write lands (a console closed mid-carry has
// removed nobody, and a row that had left would say it had). `hasRow` below reads the row's Revoke control, so the
// assertions are unchanged in substance; test 1's name and messages say what is now true.
// Run: node --test scripts/revoking-a-helper-drops-the-row-and-reverts-on-failure.test.mjs
//
// POINT OF USE (CLAUDE.md rules 1 & 3). This MOUNTS the real DashStewardsPanel out of app/stew-dashboard.jsx
// through console-screens.mjs and PRESSES the real Revoke controls; no text is matched in the .jsx. The handlers
// are EXECUTED, so deleting the fix fails the test:
//   • without the optimistic drop, the row is still shown right after Revoke is confirmed (test 1 goes red);
//   • CRITICAL (two-controls-that-report-false-success): if the roster write did not land, the row MUST come back —
//     test 2 makes setStewards resolve false and stewardRemovalOutcome report 'not-landed', then asserts the row
//     returns with the existing fail note. Drop the restoreOptimistic() and it stays gone (a false "removed").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const OWNER = 'aa'.repeat(32);
const HELPER = 'bb'.repeat(32);

function setup({ setStewardsResult = true, outcome = 'unknown' } = {}) {
  const fr = fakeReact();
  const wrote = [];
  const Steward = fakeSteward({
    actingChurch: '', pubkey: OWNER,
    stewardPresets: () => [{ id: 'general', label: 'General helper', caps: ['care', 'content', 'members'], hint: '' }],
    presetCaps: () => ['care', 'content', 'members'],
    stewardCapNames: () => ['finance', 'care', 'safeguarding', 'members', 'content', 'sealedrooms'],
    hasPinLock: () => false,
    stewardLabels: () => ({ [HELPER]: 'Ruth Bexley' }), stewardCaps: () => ({}), stewardSince: () => ({}),
    subscribeStewardRequests: (cb) => { cb([]); return () => {}; },
    setStewards: (pubkeys) => { wrote.push(pubkeys); return Promise.resolve(setStewardsResult); },
    // REMOVE KEEPS WHAT THEY SAVED (2026-11-17): Remove asks the engine to carry + write the roster; here, the roster write alone
    removeStewardKeeping: (pk) => { const next = state.roster.filter(p => p !== pk); wrote.push(next); return Promise.resolve(setStewardsResult).then(w => ({ wrote: w, carry: null, next })); },
    stewardRemovalOutcome: () => outcome,
    // The landed path rotates keys; give it a clean no-op so a SUCCESSFUL revoke resolves instead of throwing.
    publishStewardRevoke: () => Promise.resolve(true), listIsFresh: () => false,
  });
  const { window, localStorage } = fakeBrowser({ Steward });
  const state = { roster: [HELPER] };
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashStewardsPanel }' });
  window.useStewardStewards = () => state.roster.slice();
  // keep the key-rotation machinery inert and successful, so landed/success does not hit the harness's undefined stubs
  window.useStewKeyRecipients = () => ({ approved: () => null, orAdmitted: (x) => x });
  window.rotateChurchKeys = () => Promise.resolve(Object.assign([], { pending: [] }));
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashStewardsPanel({ church: { name: 'St Aidan' } }); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const words = () => texts(tree).join(' ');
  // The row's own control — present ONLY when the helper's steward row is rendered. The confirmation / fail notes
  // mention the helper's NAME, so a name-in-text check cannot tell "row present" from "note about them"; this can.
  const hasRow = () => all().some(n => n.type === 'button' && n.props && n.props.title === 'Revoke this helper');
  const press = (match) => {
    const b = all().find(n => n.type === 'button' && (typeof match === 'string' ? texts(n).join(' ').includes(match) : match(n)));
    assert.ok(b, 're-anchor: no button for ' + match);
    b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw();
  };
  draw(); draw();
  return { fr, draw, all, words, hasRow, press, state, localStorage, get wrote() { return wrote; } };
}

test('anchor: a steward row with a Revoke control renders', () => {
  const h = setup();
  assert.ok(h.words().includes('Ruth Bexley'), 'the helper row did not render');
  assert.ok(h.all().some(n => n.type === 'button' && n.props && n.props.title === 'Revoke this helper'),
    'no Revoke control on the helper row — re-anchor');
});

test('confirming Revoke spends the row’s controls at once, and the row says it is being removed', () => {
  const h = setup();                                    // setStewards resolves true -> lands
  assert.ok(h.hasRow(), 'staging: the helper row should be present before Revoke');
  h.press((n) => n.props && n.props.title === 'Revoke this helper');   // arm
  h.press('Revoke');                                   // confirm -> remove(HELPER)
  assert.ok(!h.hasRow(),
    'the helper row still offered Revoke right after Revoke was confirmed — the in-flight state did not run');
  assert.match(h.words(), /Removing… keeping what they set up/, 'the row does not say the removal is in progress');
  assert.equal(h.wrote.length, 1, 'the roster write was not attempted');
});

test('NO FALSE SUCCESS: a write that did not land brings the row BACK with the fail note', async () => {
  const h = setup({ setStewardsResult: false, outcome: 'not-landed' });
  h.press((n) => n.props && n.props.title === 'Revoke this helper');   // arm
  h.press('Revoke');                                   // confirm -> optimistic drop
  assert.ok(!h.hasRow(), 'staging: the row’s controls should be spent on confirm');
  await new Promise(r => setImmediate(r));              // let settle() resolve to 'not-landed'
  h.draw();
  assert.ok(h.hasRow(),
    'THE SAFETY RULE: the roster write did not land, yet the helper row stayed gone — the UI reported a removal that never happened');
  assert.match(h.words(), /every relay still lists them as a steward/,
    'the existing not-landed fail note was not shown after the failed revoke');
});

test('CONTROL: a landed revoke leaves the row gone (success is still real)', async () => {
  const h = setup({ setStewardsResult: true, outcome: 'landed' });
  h.press((n) => n.props && n.props.title === 'Revoke this helper');
  h.press('Revoke');
  await new Promise(r => setImmediate(r));
  h.state.roster = [];                                  // the relay-confirmed roster now drops them
  h.draw();
  assert.ok(!h.hasRow(), 'a genuinely removed helper reappeared after the write landed');
  assert.match(h.words(), /no longer a steward/, 'a landed revoke did not confirm the removal');
});
