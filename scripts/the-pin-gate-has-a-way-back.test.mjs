// "SET A CONSOLE PIN" HAS A BACK THAT KNOWS WHICH ROUTE BROUGHT YOU THERE.
// Run: node --test scripts/the-pin-gate-has-a-way-back.test.mjs
//
// Owner, 2026-09-22, on the Suite's first run: "We still need a back or cancel button at this stage." The gate
// (StewardForcedPin, app/steward-root.jsx) was built inescapable — AUDIT-2026-07-28 — because the seed it
// guards may exist only in memory and a RELOAD destroys it. That is an argument against reload, not against a
// Back that discards or keeps on purpose. Three routes reach the gate and Back means something different on each:
//   (a) a NEW CHURCH (createKey; `trinityone.steward.newchurch` set; nothing on disk, nothing published):
//       "Go back — nothing has been created yet" → the seed is dropped, the setup choices come back;
//   (b) a RESTORE / HANDOFF / ADOPT over a church already on the device (its ciphertext is still there —
//       cd67c7a stopped restoreKey wiping it): "Keep my current church" → the restored seed is dropped, the
//       previous church is untouched and the console locks so its PIN opens it. On a FRESH device (no previous
//       church) the label is (a)'s and the setup choices come back;
//   (c) a LEGACY plaintext seed init() found on disk: NO Back. That seed IS the church; leaving would leave it
//       unencrypted.
//
// RULE 1 (CLAUDE.md): the point of use. The real StewardRoot is drawn and must route needsPin into the real
// gate; the real gate's Back is pressed; the real StewardRoot is drawn again and must show the setup choices
// (or the unlock screen). The gate and the root live in TWO console loads that share one localStorage and one
// window.Steward — the harness holds one hook store per load — so the discard the gate calls reaches the
// root's own steward-key listener, exactly as it does in the browser.
// RULE 3: nothing here matches text in a .jsx file. Components are called and their output read.
//
// What is faked and what is not: the browser, and window.Steward. The fake Steward's discardUnsavedKey does
// what scripts/discarding-an-unsaved-church-key.test.mjs proves the SHIPPED one does (hasKey false, needsPin
// false, locked iff a ciphertext is on disk, steward-key fired). Nothing that decides WHICH Back to show, or
// what pressing it clears, is stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const KEY_LS = 'trinityone.steward.church-key', ENC_LS = 'trinityone.steward.church-key.enc', NEW_LS = 'trinityone.steward.newchurch';
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');

// The console twice — once to draw the root, once to draw the gate — over ONE storage and ONE engine.
function console2({ storage = {}, setPin } = {}) {
  const calls = { discard: 0 };
  const root = fakeReact(), gate = fakeReact();
  const rootB = fakeBrowser(), gateB = fakeBrowser();
  for (const [k, v] of Object.entries(storage)) rootB.localStorage.setItem(k, v);
  gateB.window.localStorage = rootB.localStorage; gateB.window.sessionStorage = rootB.localStorage;
  const ls = rootB.localStorage;
  // the engine after createKey / restoreKey / a legacy init(): key in memory, PIN forced
  const Steward = fakeSteward({
    hasKey: true, needsPin: true, locked: false, keyResumedUnknown: false,
    hasPinLock: () => !!ls.getItem(ENC_LS),
    setPin: setPin || (async () => true),
    selfRegister: async () => {},   // steward-root.jsx's boot calls it when a key is loaded and chains .catch
    discardUnsavedKey() {
      calls.discard++;
      if (!Steward.needsPin || ls.getItem(KEY_LS)) return false;   // the shipped refusals, pinned in the engine test
      Steward.hasKey = false; Steward.needsPin = false; Steward.locked = !!ls.getItem(ENC_LS);
      // the shipped engine dispatches on window; here that is the ROOT's window, whose listeners the root registered
      rootB.window.dispatch('steward-needs-pin', { type: 'steward-needs-pin' });
      rootB.window.dispatch('steward-key', { type: 'steward-key' });
      return true;
    },
  });
  rootB.window.Steward = Steward; gateB.window.Steward = Steward;
  const { StewardRoot, StewardForcedPin: RootGate, StewardWelcome, StewardUnlock, StewDashboard } = loadConsole({ React: root.React, window: rootB.window, expr: '{ StewardRoot, StewardForcedPin, StewardWelcome, StewardUnlock, StewDashboard }' });
  const { StewardForcedPin } = loadConsole({ React: gate.React, window: gateB.window, expr: '{ StewardForcedPin }' });
  let rootTree, gateTree;
  const drawRoot = () => { root.reset(); rootTree = StewardRoot({}); root.flush(); return rootTree; };
  const drawGate = () => { gate.reset(); gateTree = StewardForcedPin({}); gate.flush(); return gateTree; };
  const rootShows = () => {
    const types = nodes(rootTree).map(n => n.type);
    return types.includes(RootGate) ? 'gate' : types.includes(StewardWelcome) ? 'welcome' : types.includes(StewardUnlock) ? 'unlock' : types.includes(StewDashboard) ? 'dashboard' : 'nothing';
  };
  const unmount = () => { root.unmount(); gate.unmount(); };
  return { ls, calls, Steward, drawRoot, drawGate, rootShows, gateTree: () => gateTree, unmount };
}

test('(a) a new church: the root shows the gate; the gate offers "Go back — nothing has been created yet"; pressing it empties the device and the root shows the setup choices', () => {
  const c = console2({ storage: { [NEW_LS]: '1' } });
  c.drawRoot();
  assert.equal(c.rootShows(), 'gate', 'THE POINT OF USE: with needsPin set, StewardRoot did not put StewardForcedPin on screen');

  const tree = c.drawGate();
  const back = button(tree, 'Go back — nothing has been created yet');
  assert.ok(back, 'THE DEFECT: no "Go back — nothing has been created yet" on the gate after Start a new church. Buttons: ' + JSON.stringify(nodes(tree).filter(n => n.type === 'button').map(n => texts(n).join(' ').trim())));
  assert.equal(button(tree, 'Keep my current church'), undefined, 'a brand-new church was offered "Keep my current church" — there is no current church');
  assert.ok(button(tree, 'Set PIN'), 're-anchor: the gate lost its Set PIN button');
  assert.equal(back.props.disabled, false, 'Back is disabled before anything has started');

  back.props.onClick();
  assert.equal(c.calls.discard, 1, 'Back did not call Steward.discardUnsavedKey — the seed is still in memory and needsPin still set');
  assert.equal(c.ls.getItem(NEW_LS), null, 'the `newchurch` wizard marker survived Back; the next church on this device would inherit it');
  assert.deepEqual([...Array(c.ls.length)].map((_, i) => c.ls.key(i)).filter(k => k.startsWith(KEY_LS)), [], 'a church-key row is in storage after going back from a church that was never created');

  // the root heard the discard through its own listeners: redraw and read what it shows now
  c.drawRoot();
  assert.equal(c.rootShows(), 'welcome', 'after Back the root shows ' + c.rootShows() + ', not the setup choices (StewardWelcome)');
  c.unmount();
});

test('(b) a restore over a church already on the device: "Keep my current church" drops the restored seed, leaves the ciphertext alone, and the root shows the unlock screen', () => {
  const CT = '{"v":2,"it":600000,"salt":"s","iv":"i","ct":"the-previous-church"}';
  const c = console2({ storage: { [ENC_LS]: CT } });
  c.drawRoot();
  assert.equal(c.rootShows(), 'gate', 'THE POINT OF USE: the root did not show the gate over a restore');

  const tree = c.drawGate();
  const keep = button(tree, 'Keep my current church');
  assert.ok(keep, 'THE DEFECT: no "Keep my current church" on the gate after a restore over an existing church. Buttons: ' + JSON.stringify(nodes(tree).filter(n => n.type === 'button').map(n => texts(n).join(' ').trim())));
  assert.equal(button(tree, 'nothing has been created yet'), undefined, 'a restore over an existing church was labelled as if nothing existed');
  assert.match(said(tree), /church already on this device is unchanged/, 'the one line under "Keep my current church" does not say what happens to each church');

  keep.props.onClick();
  assert.equal(c.calls.discard, 1, '"Keep my current church" did not call Steward.discardUnsavedKey');
  assert.equal(c.ls.getItem(ENC_LS), CT, 'THE PREVIOUS CHURCH’S CIPHERTEXT CHANGED under "Keep my current church" — its PIN no longer opens it');
  assert.equal(c.ls.getItem(KEY_LS), null, 'a plaintext key row appeared in storage');

  c.drawRoot();
  assert.equal(c.rootShows(), 'unlock', 'after "Keep my current church" the root shows ' + c.rootShows() + ', not the unlock screen for the church that was kept');
  c.unmount();
});

test('(b′) a restore on a FRESH device (no previous church): the label is the new-church one and Back returns to the setup choices', () => {
  const c = console2({ storage: {} });   // no newchurch marker, no ciphertext: a phrase typed on an empty device
  const tree = c.drawGate();
  assert.ok(button(tree, 'Go back — nothing has been created yet'), 'a fresh device restoring a church has no Back, or the wrong one');
  assert.equal(button(tree, 'Keep my current church'), undefined, '"Keep my current church" offered with no church on the device');
  button(tree, 'Go back — nothing has been created yet').props.onClick();
  assert.equal(c.calls.discard, 1, 'Back did not discard');
  c.drawRoot();
  assert.equal(c.rootShows(), 'welcome', 'after Back the root shows ' + c.rootShows() + ', not the setup choices');
  c.unmount();
});

test('(c) a legacy plaintext migration: NO Back — the seed on disk is the church and must be encrypted before anything else', () => {
  const c = console2({ storage: { [KEY_LS]: 'fine flash wait silly next awkward charge front scout build damage river' } });
  c.drawRoot();
  assert.equal(c.rootShows(), 'gate', 're-anchor: the root did not show the gate over a legacy seed');
  const tree = c.drawGate();
  const labels = nodes(tree).filter(n => n.type === 'button').map(n => texts(n).join(' ').trim());
  assert.equal(button(tree, 'Go back'), undefined, 'THE DEFECT: a Back is offered on the legacy-migration path — cancelling leaves the church key unencrypted on disk. Buttons: ' + JSON.stringify(labels));
  assert.equal(button(tree, 'Keep my current church'), undefined, '"Keep my current church" is offered on the legacy-migration path. Buttons: ' + JSON.stringify(labels));
  assert.ok(button(tree, 'Set PIN'), 're-anchor: the gate lost its Set PIN button');
  assert.equal(c.calls.discard, 0, 'something called discardUnsavedKey on the legacy path without a button being pressed');
  c.unmount();
});

test('Back is disabled while the PIN is being set, and pressing it then discards nothing', async () => {
  // busy is reached through the real path: type a PIN twice, press Set PIN with a setPin that never returns
  const c = console2({ storage: { [NEW_LS]: '1' }, setPin: () => new Promise(() => {}) });
  let tree = c.drawGate();
  const inputs = nodes(tree).filter(n => n.type === 'input' && n.props.type === 'password');
  assert.equal(inputs.length, 2, 're-anchor: the gate no longer has two password fields');
  inputs[0].props.onChange({ target: { value: 'cedar-harbour-lamp-42' } });
  inputs[1].props.onChange({ target: { value: 'cedar-harbour-lamp-42' } });
  tree = c.drawGate();
  button(tree, 'Set PIN').props.onClick();
  await new Promise(r => setTimeout(r, 0));
  tree = c.drawGate();
  const back = button(tree, 'Go back — nothing has been created yet');
  assert.ok(back, 're-anchor: Back is gone while busy');
  assert.equal(back.props.disabled, true, 'Back is enabled while setPin is running — a discard racing an encrypt-and-save');
  back.props.onClick();
  assert.equal(c.calls.discard, 0, 'Back discarded the seed while setPin was still writing it');
  c.unmount();
});

test('if the engine refuses the discard, the gate says so and stays', () => {
  const c = console2({ storage: { [NEW_LS]: '1' } });
  c.Steward.discardUnsavedKey = () => { c.calls.discard++; return false; };
  let tree = c.drawGate();
  button(tree, 'Go back — nothing has been created yet').props.onClick();
  assert.equal(c.calls.discard, 1);
  tree = c.drawGate();
  assert.match(said(tree), /Couldn’t go back/, 'a refused discard left the steward with a Back that silently did nothing');
  assert.equal(c.ls.getItem(NEW_LS), '1', 'the newchurch marker was cleared although nothing was discarded');
  c.unmount();
});
