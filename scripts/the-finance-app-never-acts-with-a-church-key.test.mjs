// THE FINANCE APP NEVER DESTROYS, EXPOSES OR ACTS WITH A CHURCH KEY — AND SAYS WHAT IS TRUE IN ITS OWN WORDS.
//   Run: node --test scripts/the-finance-app-never-acts-with-a-church-key.test.mjs
//
// T1Finance audit of 740245da..572ca5aa (AMBER). On the WEB finance.html shares localStorage with steward.html, so an
// owner who opens /finance.html has the CHURCH key loaded; on Android "Restore my helper words" accepts a church's
// phrase too. So the finance app must not treat the key it holds as "only a helper key":
//   F1 — its Settings sheet has no "Remove from this device" (Steward.removeKey() deletes the device's own key) and no
//        "Remove lock" (plaintext at rest); "Show my 12 words" only while acting for a church AND with no sign this
//        device's own key runs a church (Steward.ownKeyBlank()), worded honestly because that sign is one-directional;
//   F2 — it does not self-register the key or re-sync its relays (initChurch, the restore, the waiting screen);
//   F5 — its removal, waiting and restore screens do not speak the console's language ("start a church", "Settings →
//        Security", "this console"), and the removal notice says honestly what leaves the device and what cannot.
//
// POINT OF USE (CLAUDE.md rules 1 & 3): finance.html's own script list (and steward.html's for the controls) loaded into
// one scope through console-screens.mjs, the real components RENDERED and their real buttons PRESSED; the engine calls
// that would act on a key (removeKey, removeLock, exportMnemonic, selfRegister, autoSyncIfRedundant) are counted.
// Rendered text is read from the tree; nothing is matched in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConsole, consoleScripts, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';
import { fnBody, deps } from './test-slice.mjs';

const CHURCH = 'cc'.repeat(32);
const say = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');

function load({ app = 'finance', steward = {}, search = '', expr, beforeLoad } = {}) {
  const fr = fakeReact();
  const calls = { removeKey: 0, removeLock: 0, exportMnemonic: 0, selfRegister: 0, autoSync: 0, adopt: 0 };
  const Steward = fakeSteward({
    hasKey: true, locked: false, needsPin: false, pendingStewardRequest: () => null, removedNotices: () => [],
    removeKey: () => { calls.removeKey++; return Promise.resolve(); },
    removeLock: async () => { calls.removeLock++; return true; },
    exportMnemonic: () => { calls.exportMnemonic++; return 'one two three four five six seven eight nine ten eleven twelve'; },
    selfRegister: () => { calls.selfRegister++; return Promise.resolve(true); },
    autoSyncIfRedundant: () => { calls.autoSync++; },
    adoptChurch: () => { calls.adopt++; },
    ...steward,
  });
  const { window } = fakeBrowser({ Steward });
  window.location.search = search;
  window.setTimeout = (f) => { try { f(); } catch (e) {} return 0; };   // initChurch's 5 s deferral runs at once, so a call cannot hide behind it
  if (beforeLoad) beforeLoad(window);
  const files = app === 'finance' ? consoleScripts('finance.html') : consoleScripts();
  const mods = loadConsole({ React: fr.React, window, expr, files, vendor: app === 'finance' ? ['finance-mode.js'] : [] });
  return { fr, window, mods, calls };
}
const buttonsOf = (tree) => nodes(tree).filter(n => n.type === 'button');
const labelOf = (b) => texts(b).join(' ').replace(/\s+/g, ' ').trim();

// ── F1: the Settings sheet ─────────────────────────────────────────────────────────────────────────────────────────
function settings(steward) {
  const r = load({ steward, expr: '{ FinanceSettings, PinModal }' });
  let tree = null;
  const draw = () => { r.fr.reset(); tree = r.mods.FinanceSettings({ onClose() {} }); r.fr.flush(); return tree; };
  draw();
  return { ...r, draw, get tree() { return tree; } };
}
const delegatedBlank = { actingChurch: CHURCH, isDelegated: () => true, ownKeyBlank: () => true };

test('F1: no button on the finance Settings sheet can remove the key or its PIN — pressing every one of them, PIN or no PIN', () => {
  for (const extra of [{ hasPinLock: () => true }, { hasPinLock: () => false }]) {
    for (const who of [delegatedBlank, { actingChurch: '', isDelegated: () => false, ownKeyBlank: () => false }]) {
      const s = settings({ ...who, ...extra });
      const labels = buttonsOf(s.tree).map(labelOf);
      assert.ok(!labels.some(l => /remove/i.test(l)), 'a Remove control is on the finance Settings sheet: ' + JSON.stringify(labels));
      for (const label of labels) {
        const b = buttonsOf(s.draw()).find(x => labelOf(x) === label);
        if (b) { b.props.onClick({ stopPropagation() {}, preventDefault() {} }); s.draw(); }
      }
      assert.equal(s.calls.removeKey, 0, 'a finance Settings button removed the key');
      assert.equal(s.calls.removeLock, 0, 'a finance Settings button removed the PIN');
      for (const pm of nodes(s.tree).filter(n => n.type === s.mods.PinModal)) assert.notEqual(pm.props.action, 'remove', 'the finance sheet opened PIN REMOVAL');
      assert.match(say(s.tree), /To stop helping, ask the church to remove you\. To clear this device, uninstall the app\./, 'the honest "how to stop" line is missing');
    }
  }
});

test('F1: setting and changing the PIN stay', () => {
  const noPin = settings({ ...delegatedBlank, hasPinLock: () => false });
  buttonsOf(noPin.tree).find(b => /Lock with a PIN/.test(labelOf(b))).props.onClick(); noPin.draw();
  assert.equal(nodes(noPin.tree).find(n => n.type === noPin.mods.PinModal).props.action, 'set');
  const pin = settings({ ...delegatedBlank, hasPinLock: () => true });
  buttonsOf(pin.tree).find(b => /Change PIN/.test(labelOf(b))).props.onClick(); pin.draw();
  assert.equal(nodes(pin.tree).find(n => n.type === pin.mods.PinModal).props.action, 'change');
});

test('F1: the 12 words show only when acting for a church AND with no sign the own key runs one — and never claim "not the church\'s key"', () => {
  const ok = settings(delegatedBlank);
  assert.ok(nodes(ok.tree).some(n => n.props && n.props['data-finance-words']), 'a delegated helper with a blank own key cannot see their words (M3 restore needs them)');
  assert.doesNotMatch(say(ok.tree), /not the church/i, 'the sheet still promises the words are "not the church\'s key" — it cannot know that');
  assert.match(say(ok.tree), /If this device also runs a church, these are that church’s key/);
  buttonsOf(ok.tree).find(b => /Show my 12 words/.test(labelOf(b))).props.onClick(); ok.draw();
  assert.equal(ok.calls.exportMnemonic, 1);
  assert.match(say(ok.tree), /one two three four/);
  for (const who of [{ actingChurch: CHURCH, isDelegated: () => true, ownKeyBlank: () => false },   // a sign: the own key runs a church
                     { actingChurch: '', isDelegated: () => false, ownKeyBlank: () => true },        // not acting for a church
                     { actingChurch: '', isDelegated: () => false, ownKeyBlank: () => false }]) {     // the owner, on the web
    const s = settings(who);
    assert.ok(!nodes(s.tree).some(n => n.props && n.props['data-finance-words']), 'the words were offered for ' + JSON.stringify({ d: who.isDelegated(), blank: who.ownKeyBlank() }));
    for (const b of buttonsOf(s.tree)) { b.props.onClick({ stopPropagation() {}, preventDefault() {} }); }
    assert.equal(s.calls.exportMnemonic, 0, 'the key\'s words were read out when they must not be');
  }
});

// ── F2: the finance app does not act with the key it holds ────────────────────────────────────────────────────────
test('F2: with a key loaded, the finance app neither self-registers it (/config) nor re-syncs its relays at boot — the console still does', () => {
  const fin = load({ steward: { hasKey: true, init() {} }, expr: '1' });
  assert.equal(fin.calls.selfRegister, 0, 'the finance app self-registered the key it holds (a /config POST) at boot');
  assert.equal(fin.calls.autoSync, 0, 'the finance app re-synced the church\'s relays (a relays-doc publish) at boot');
  const stw = load({ app: 'steward', steward: { hasKey: true, init() {} }, expr: '1' });
  assert.equal(stw.calls.selfRegister, 1, 'CONTROL: the steward console stopped self-registering at boot');
  assert.equal(stw.calls.autoSync, 1, 'CONTROL: the steward console stopped its redundancy sync');
});

test('F2: "Restore my helper words" restores, and does not self-register — the console\'s restore still does', () => {
  for (const [app, open, want] of [['finance', 'Restore my helper words', 0], ['steward', 'Restore a church', 1]]) {
    const r = load({ app, steward: { hasKey: false }, expr: '{ StewardWelcome }' });
    let tree = null; const draw = () => { r.fr.reset(); tree = r.mods.StewardWelcome(); r.fr.flush(); };
    draw();
    buttonsOf(tree).find(b => labelOf(b).includes(open)).props.onClick(); draw();
    nodes(tree).find(n => n.type === 'textarea').props.onChange({ target: { value: 'one two three four five six seven eight nine ten eleven twelve' } }); draw();
    buttonsOf(tree).find(b => /^Restore( church)?$/.test(labelOf(b))).props.onClick(); draw();
    assert.equal(r.calls.adopt, 1, app + ': Restore did not restore');
    assert.equal(r.calls.selfRegister, want, app + ': restore self-registered ' + r.calls.selfRegister + ' time(s), expected ' + want);
  }
});

test('F2: the waiting screen\'s "Check again" does not self-register in the finance app — and still does in the console', () => {
  for (const [app, want] of [['finance', 0], ['steward', 1]]) {
    const r = load({ app, steward: { hasKey: true, init() {} }, expr: '{ StewardAwaitingApproval }' });
    r.calls.selfRegister = 0;   // the boot path is the previous test's subject
    r.fr.reset(); const tree = r.mods.StewardAwaitingApproval({ church: { name: 'St Aidan', church: CHURCH } }); r.fr.flush();
    buttonsOf(tree).find(b => /Check again/.test(labelOf(b))).props.onClick();
    assert.equal(r.calls.selfRegister, want, app + ': Check again self-registered ' + r.calls.selfRegister + ' time(s)');
    if (app === 'finance') assert.doesNotMatch(say(tree), /console/i, 'the finance waiting screen talks about "this console" (F5)');
  }
});

// ── F5: the finance app's own words ───────────────────────────────────────────────────────────────────────────────
test('F5: the finance removal notice says the books left this device and what cannot be taken back — no console language', () => {
  for (const discards of [true, false]) {
    const r = load({ steward: { removedDiscardsKey: () => discards }, expr: '{ StewardRemoved }' });
    r.fr.reset(); const tree = r.mods.StewardRemoved({ notes: [{ cp: CHURCH, name: 'St Aidan' }] }); r.fr.flush();
    const t = say(tree);
    assert.match(t, /books have been taken off this device/, 'the finance removal notice does not say the books left the device');
    assert.match(t, /anything already copied off it can’t be taken back/, 'the finance removal notice overstates what removal does');
    assert.doesNotMatch(t, /start a church|Help run a church|console/i, 'console language in the finance removal notice: ' + t);
  }
  const c = load({ app: 'steward', steward: { removedDiscardsKey: () => true }, expr: '{ StewardRemoved }' });
  c.fr.reset(); const ct = c.mods.StewardRemoved({ notes: [{ cp: CHURCH, name: 'St Aidan' }] }); c.fr.flush();
  assert.match(say(ct), /start a church/, 'CONTROL: the console\'s removal notice changed');
});

test('F5: the finance restore box is labelled as the helper\'s words, not "your church\'s recovery phrase"', () => {
  for (const [app, open, want] of [['finance', 'Restore my helper words', 'Your 12 helper words'], ['steward', 'Restore a church', 'Your church\'s 12-word recovery phrase']]) {
    const r = load({ app, steward: { hasKey: false }, expr: '{ StewardWelcome }' });
    let tree = null; const draw = () => { r.fr.reset(); tree = r.mods.StewardWelcome(); r.fr.flush(); };
    draw(); buttonsOf(tree).find(b => labelOf(b).includes(open)).props.onClick(); draw();
    assert.equal(nodes(tree).find(n => n.type === 'textarea').props['aria-label'], want, app + ': the restore box label');
  }
});

test('F5: StewardRoot\'s removal banner and resumed-key banner speak the finance app\'s language', () => {
  const steward = { removedNotices: () => [{ cp: CHURCH, name: 'St Aidan' }], removedLeavesNothing: () => false, keyResumedUnknown: true, actingChurch: 'ee'.repeat(32), isDelegated: () => true };
  const fin = load({ steward, expr: '{ StewardRoot }' });
  fin.fr.reset(); fin.mods.StewardRoot(); fin.fr.flush();
  fin.fr.reset(); const ft = fin.mods.StewardRoot(); fin.fr.flush();
  const banner = nodes(ft).find(n => n.props && n.props['data-stew-removed-banner']);
  assert.ok(banner, 're-anchor: no removal banner');
  assert.match(say(banner), /anything already copied off it can’t be taken back/);
  assert.doesNotMatch(say(banner), /console/i);
  assert.doesNotMatch(say(ft), /Settings → Security/, 'the finance app points at a Settings page it does not have');
  const stw = load({ app: 'steward', steward, expr: '{ StewardRoot }' });
  stw.fr.reset(); stw.mods.StewardRoot(); stw.fr.flush();
  stw.fr.reset(); const st = stw.mods.StewardRoot(); stw.fr.flush();
  assert.match(say(st), /Settings → Security/, 'CONTROL: the console\'s resumed-key banner changed');
});

// ── the engine half of F1's signal: Steward.ownKeyBlank(), lifted from the shipped bundle ────────────────────────────
test('F1 signal: Steward.ownKeyBlank() is false once this device knows its own key runs a church (a remembered name, or a self-registration)', () => {
  const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const getter = 'function ' + fnBody(VENDOR, VENDOR.indexOf('\n    ownKeyBlank() {') + 5, 'ownKeyBlank');
  const body = deps(VENDOR, '_ownKeyBlank lsGet OWN_NAME_LS SELFREG_KEY', ['churchPub', 'localStorage']) + getter;
  const ME = 'ab'.repeat(32);
  const run = (store) => {
    const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
    return new Function('churchPub', 'localStorage', body + '\nreturn ownKeyBlank();')(ME, localStorage);
  };
  assert.equal(run({}), true, 'a key with no remembered name and no registration should read as blank');
  assert.equal(run({ ['trinityone.steward.ownname.' + ME]: 'St Aidan' }), false, 'a remembered own church name was not a sign the key runs a church');
  assert.equal(run({ 'trinityone.steward.selfreg': JSON.stringify({ [ME + '@wss://relay.example']: 1 }) }), false, 'a self-registration was not a sign the key runs a church');
  assert.equal(run({ 'trinityone.steward.selfreg': JSON.stringify({ ['cd'.repeat(32) + '@wss://relay.example']: 1 }) }), true, 'ANOTHER key\'s registration counted against this one');
});
