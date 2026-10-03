// A SIX-DIGIT PIN REFUSED IN THE BROWSER SAYS WHY. Sim round 2026-10-02, finding #59.
// Run: node --test scripts/a-web-pin-refusal-says-why.test.mjs
//
// Deliberate rule, owner decision 2026-09-05 (see scripts/one-pin-rule-that-follows-where-the-seed-is-kept.test.mjs
// and reference/DOMAIN.md): on the phone app six digits is enough because the encrypted key sits in the hardware
// secure store; in a browser the whole blob sits in localStorage, where a million combinations is minutes, so an
// all-number PIN needs 8+ digits. That rule is NOT changed here. What was wrong is that the refusal ("easy to guess")
// did not say why the same app accepts six digits elsewhere, so it read as a bug. The sentence now gives the reason.
//
// Users of the changed text (rule 2): pinRuleError has two callers, IdentityOnboarding.savePin (app/identity.jsx) and
// CommunitySecuritySheet.doEnable (app/identity-extras.jsx); both print the string unchanged. The rule itself
// (thresholds, who is refused) is untouched and still proven by one-pin-rule-that-follows-where-the-seed-is-kept.
//
// HOW IT ASSERTS (rule 3): the SHIPPED vendor/identity.js runs whole in a vm and supplies the real rule; the real
// CommunitySecuritySheet is drawn with it, a six-digit PIN is typed twice and "Turn on protection" is pressed, and the
// error on screen is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFellowship } from './fellowship-vm.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function sheet(native) {
  const { TI, win } = loadFellowship({ bundle: 'identity' });
  const { React, draw } = miniReact();
  const ID = Object.assign(Object.create(TI), { hasPin: () => false, isLocked: () => false, setPin: async () => true, pinRuleError: (p) => TI.pinRuleError(p, native) });
  const mod = loadScreen('app/identity-extras.jsx', ['CommunitySecuritySheet'], {
    React, window: { TrinityIdentity: ID, addEventListener() {}, removeEventListener() {} }, Icon: Stub('Icon'), IconBtn: Stub('IconBtn'),
    BottomSheet: ({ open, children }) => (open ? children : null), localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, console, lsGet: (k, d) => d, lsSet() {},
  });
  const props = { open: true, onClose() {}, ctx: { toast() {} } };
  let tree = draw(mod.CommunitySecuritySheet, props);
  const redraw = () => (tree = draw(mod.CommunitySecuritySheet, props));
  const type = (label, v) => find(tree, n => n.type === 'input' && n.props['aria-label'] === label)[0].props.onChange({ target: { value: v } });
  return {
    pressWith: async (pin) => {
      type('Choose a PIN or passphrase', pin); redraw(); type('Confirm your PIN', pin); redraw();
      const b = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Turn on protection'))[0];
      assert.ok(b, 'no "Turn on protection" button - re-anchor this test');
      await b.props.onClick(); redraw();
      return texts(tree).join(' | ');
    },
  };
}

test('in a browser, six digits is refused WITH the reason', async () => {
  const s = await sheet(false).pressWith('123456');
  assert.match(s, /web browser/i, 'the refusal does not say this is about the browser');
  assert.match(s, /secure store/i, 'the refusal does not say WHY (the phone keeps the key in a secure store)');
  assert.match(s, /8\+ digits/, 'the refusal does not say what would be accepted');
  assert.match(s, /phone app accepts 6/i, 'the refusal does not say that the phone app takes six');
});

test('on the phone app, the same six digits is not refused at all', async () => {
  const s = await sheet(true).pressWith('123456');
  assert.doesNotMatch(s, /web browser|secure store/i, 'the web refusal appeared on the phone, where six digits is the rule');
});
