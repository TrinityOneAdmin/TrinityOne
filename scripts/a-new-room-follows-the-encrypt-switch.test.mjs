// THE NEW ROOM FORM DOES NOT TICK "Encrypted" WHILE THE CHURCH SWITCH READS OFF. Sim 2026-10-02, finding #58.
// Run: node --test scripts/a-new-room-follows-the-encrypt-switch.test.mjs
//
// "Encrypt all comms" on the Rules page reads OFF while any non-team room is still unsealed - it will not claim
// a protection the church does not have. The New room form worked the default out separately, from the flag
// alone, so a church that read OFF on one screen got Encrypted ticked on the other. The form now applies the
// switch's own predicate (flag not false AND no non-team room unsealed).
//
// ⚠ WHAT THIS CHANGES AND WHAT IT DOES NOT. Only the DEFAULT TICK on the form, and only for a church that still
// has an unsealed non-team room. The tick is still the steward's to set. An explicit "off" and a brand-new
// church (no features, no rooms) behave as before. The owner's 2026-08-22 decision - "a church is encrypted
// unless its steward decides otherwise" - is therefore read through the switch the steward can see, not the raw
// flag; a church that wants every new room sealed has one tap to get there (the switch seals the old ones).
//
// Users of what changed (rule 2): only NewGroupModal's default tick, which is read once, when the form opens, by
// the form's own Encrypted checkbox. DashFeaturesPanel's switch is untouched; the last test renders it beside the
// form so the two cannot drift apart unnoticed. NewGroupModal is opened from DashGroups only.
//
// HOW IT ASSERTS (rule 3): both real components are compiled and rendered; the tick and the switch are read
// off the drawn tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function mount(name, props, { church, groups }) {
  const { React, draw } = miniReact();
  const win = {
    useStewardChurch: () => church, useStewardGroups: () => groups, useStewardMembers: () => [], useStewardCategories: () => [],
    useStewardRosters: () => ({}), useStewardConn: () => 0,
    Steward: { publishProfile: async () => true, sealGroup: async () => ({ ok: true }), subscribeGroupAdmins: () => () => {} },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: { getItem: () => null, setItem() {} },
  };
  const mod = loadScreen('app/stew-dashboard.jsx', [name], {
    React, window: win, localStorage: win.localStorage, Icon: Stub('Icon'), SkToggle: Stub('SkToggle'), SkBadge: Stub('SkBadge'),
    SkConfirm: Stub('SkConfirm'), SkPill: Stub('SkPill'), useStewDialog: () => ({ current: null }), StewHelpLink: Stub('StewHelpLink'),
    DismissibleNote: Stub('DismissibleNote'), DashMealsPanel: Stub('DashMealsPanel'), todayISO: () => '2026-10-03', CustomEvent,
  });
  draw(mod[name], props);                       // the draw that queues the effects
  return draw(mod[name], props);                // …and the one that sees what they set
}
const encryptedTick = (tree) => {
  const label = find(tree, n => n.type === 'label' && texts(n).join(' ').includes('Encrypted'))[0];
  assert.ok(label, 'the form has no Encrypted tick - re-anchor this test');
  const input = find(label, n => n.type === 'input')[0];
  return !!input.props.checked;
};
const formFor = (church, groups) => encryptedTick(mount('NewGroupModal', { open: true, onClose() {} }, { church, groups }));

const SEALED = { id: 'a', kind: 'group', encrypted: true };
const OPEN = { id: 'b', kind: 'group', encrypted: false };

test('a church that still has an unsealed room: the switch reads off and the form does not tick Encrypted', () => {
  assert.equal(formFor({ features: {} }, [SEALED, OPEN]), false,
    'THE DEFECT: Encrypted is ticked on a form for a church whose "Encrypt all comms" switch reads off');
});

test('a church whose rooms are all sealed still gets Encrypted ticked', () => {
  assert.equal(formFor({ features: {} }, [SEALED]), true);
});

test('a brand-new church (no features, no rooms) still gets Encrypted ticked', () => {
  assert.equal(formFor({}, []), true);
});

test('an explicit off stays off', () => {
  assert.equal(formFor({ features: { encryptComms: false } }, [SEALED]), false);
});

test('a team does not count as an unsealed room (the encrypt control is not offered for teams)', () => {
  assert.equal(formFor({ features: {} }, [SEALED, { id: 't', kind: 'team', encrypted: false }]), true);
});

// The switch itself must read what it always did - the helper replaced an inline expression there.
function switchReads(church, groups) {
  const tree = mount('DashFeaturesPanel', { church, show: 'privacy' }, { church, groups });
  const sw = find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Toggle encrypt all group chat')[0];
  assert.ok(sw, 'the Encrypt all comms switch did not render - re-anchor this test (the `show` prop may have changed)');
  return !!sw.props['aria-checked'];
}
test('the Rules page switch and the form agree in every case above', () => {
  for (const [church, groups] of [
    [{ features: {} }, [SEALED, OPEN]], [{ features: {} }, [SEALED]], [{}, []],
    [{ features: { encryptComms: false } }, [SEALED]], [{ features: {} }, [SEALED, { id: 't', kind: 'team', encrypted: false }]],
  ]) assert.equal(switchReads(church, groups), formFor(church, groups),
    'the switch and the form disagree for ' + JSON.stringify({ church, groups }));
});
