// THE ONE CONTROL THAT PROMISES A SECOND ATTEMPT, ON THE SCREEN WHERE THE ACCOUNT IS LOST WITHOUT IT.
// Run: node --test scripts/the-wizard-try-again-actually-retries.test.mjs
//
// AUDIT 2026-09-04. The onboarding wizard's back-up step fetches the member's twelve words. When that fails
// it says so and offers "Try again" — and the button did nothing. The effect that fetches lists only
// `[step]`, and the failure message only ever renders on step 1, so the button set `step` to the value it
// already had; React saw no change and never re-ran the effect. `setWords([])` could not help either, since
// `words` is already empty in the one state where the message appears.
//
// This is the screen where skipping the step loses the account for ever, so a dead retry is the worst place
// for one. CLAUDE.md rule 3: nothing here matches text in app/*.jsx — the real component is rendered and the
// engine underneath it counts its own calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';

const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };
const WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

function wizard({ failFirst }) {
  const { React, draw } = miniReact();
  const calls = { exportMnemonic: 0 };
  let failing = failFirst;
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    navigator: { userAgent: '', clipboard: null },
    location: { search: '', hostname: 'x', href: 'https://localhost/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    cx: (...a) => a.filter(Boolean).join(' '),
    UserAvatar: Stub('UserAvatar'),
    AvatarPicker: Stub('AvatarPicker'),
    Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
    lsGet: (k, d) => d, lsSet: () => {},
    window: {
      addEventListener() {}, removeEventListener() {}, innerWidth: 360,
      TrinityIdentity: {
        current: null, locked: false, hasPin: () => false, isLocked: () => false,
        canRemember: () => false, rememberDays: 30,
        // The phone that has not produced the words yet, then does.
        exportMnemonic: async () => { calls.exportMnemonic++; return failing ? '' : WORDS; },
      },
      Fellowship: { ready: Promise.resolve() },
    },
  };
  const { IdentityOnboarding } = loadScreen('app/identity.jsx', ['IdentityOnboarding'], globals);
  return { draw, IdentityOnboarding, calls, recover: () => { failing = false; } };
}

// Walk to the back-up step: past the "have you used it before" intro, past the name step.
function toBackupStep(draw, Comp, props) {
  let tree = draw(Comp, props);
  const nu = button(tree, 'I’m new here')[0];
  assert.ok(nu, 'the welcome screen has changed — re-anchor this test');
  nu.props.onClick({ stopPropagation() {} });
  tree = draw(Comp, props);
  const cont = button(tree, 'Continue')[0] || button(tree, 'Next')[0];
  assert.ok(cont, 'no way forward from the name step — re-anchor this test (buttons: ' +
    find(tree, n => n.type === 'button').map(n => texts(n).join('')).join(' / ') + ')');
  cont.props.onClick({ stopPropagation() {} });
  return draw(Comp, props);
}

test('"Try again" asks the phone for the words a SECOND time', async () => {
  const { draw, IdentityOnboarding, calls, recover } = wizard({ failFirst: true });
  const props = { open: true, onDone() {}, onSkip() {} };
  let tree = toBackupStep(draw, IdentityOnboarding, props);
  // The shipped code retries 12 times at 300ms before giving up loudly, so this has to outwait ~3.6s.
  // Fewer, longer waits than that and the message has not appeared yet — which reads exactly like the
  // feature being broken.
  for (let i = 0; i < 45; i++) { await new Promise(r => setTimeout(r, 120)); tree = draw(IdentityOnboarding, props); }
  assert.match(texts(tree).join(' '), /hasn’t produced your words yet/,
    'the failure message never appeared, so this test is not in the state it is named for');
  const before = calls.exportMnemonic;
  assert.ok(before > 0, 'the wizard never asked for the words at all — re-anchor this test');

  const again = button(tree, 'Try again')[0];
  assert.ok(again, 'the retry control is gone from the screen where the account is lost without it');
  recover();
  again.props.onClick({ stopPropagation() {} });
  tree = draw(IdentityOnboarding, props);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(calls.exportMnemonic > before,
    'pressing "Try again" asked the phone for nothing. The button sets state the screen already holds, so ' +
    'React re-runs no effect — the only control offering a second attempt does nothing at all');
});

test('…and once the words arrive, the member can get past the step', async () => {
  const { draw, IdentityOnboarding, calls, recover } = wizard({ failFirst: true });
  const props = { open: true, onDone() {}, onSkip() {} };
  let tree = toBackupStep(draw, IdentityOnboarding, props);
  for (let i = 0; i < 45; i++) { await new Promise(r => setTimeout(r, 120)); tree = draw(IdentityOnboarding, props); }
  recover();
  const retry = button(tree, 'Try again')[0];
  assert.ok(retry, 'the retry control is gone — re-anchor this test');
  retry.props.onClick({ stopPropagation() {} });
  for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 60)); tree = draw(IdentityOnboarding, props); }
  const words = texts(tree).join(' ');
  assert.match(words, /sausage/, 'the words never appeared after a successful retry');
  assert.ok(!/hasn’t produced your words yet/.test(words), 'the failure message is still up after it succeeded');
});

test('CONTROL: a phone that produces the words needs no retry at all', async () => {
  const { draw, IdentityOnboarding } = wizard({ failFirst: false });
  const props = { open: true, onDone() {}, onSkip() {} };
  let tree = toBackupStep(draw, IdentityOnboarding, props);
  for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 60)); tree = draw(IdentityOnboarding, props); }
  const words = texts(tree).join(' ');
  assert.match(words, /sausage/, 'the ordinary path stopped showing the words');
  assert.ok(!/Try again/.test(words), 'the failure message shows on a phone that worked');
});
