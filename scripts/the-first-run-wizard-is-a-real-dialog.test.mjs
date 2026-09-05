// THE FIRST-LAUNCH WIZARD COVERS THE WHOLE APP. IT MUST ALSO CLOSE IT OFF.
// Run: node --test scripts/the-first-run-wizard-is-a-real-dialog.test.mjs
//
// Finding 6 of the 2026-09-05 re-verification audit. IdentityOnboarding rendered nine full-screen <div>s
// with no role, no aria-modal, and no focus management, mounted as a SIBLING of the running app inside
// PhoneFrame. Nothing made the tree beneath it unreachable, and the first step has no autoFocus — so on
// first launch focus stayed on <body>, a screen reader began reading the Today screen behind the wizard,
// and a user could swipe into the tab bar and activate Chat underneath a modal they had not finished.
//
// This RENDERS the real component rather than grepping for the attributes, because app/*.jsx ships
// UNBUNDLED: a `false && ` in front of a branch leaves every word of `role="dialog"` in the file and a text
// assertion still passes (CLAUDE.md rule 3).
//
// The sibling-inert effect is driven too, against a fake parent with fake siblings — including its cleanup,
// because an effect that marks the app inert and never puts it back is a worse bug than the one being fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const JS = transformSync(readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8'),
  { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });

function mount({ step = 0, refEl = null, runEffects = false } = {}) {
  const states = [];
  const effects = [];
  let idx = 0;
  const ref = { current: refEl };
  let refHanded = false;
  const React = {
    useState(init) {
      const i = idx++;
      if (states.length <= i) states.push(i === 0 ? step : (typeof init === 'function' ? init() : init));
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect(fn, deps) { effects.push([fn, deps]); },
    // The FIRST useRef in this component is the dialog's panel ref; hand it the fake element so the
    // sibling-inert effect has something to work with. Later refs get their own objects.
    useRef(init) { if (!refHanded) { refHanded = true; return ref; } return { current: init === undefined ? null : init }; },
    createElement: h,
  };
  const scope = {
    React, h, Frag: 'Frag', Icon: () => null,
    useDialogA11y() {},   // its own behaviour is app/ui.jsx's; what is under test here is that it is USED
    window: { TrinityData: {}, TrinityIdentity: {} },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
  };
  const names = Object.keys(scope);
  const { IdentityOnboarding } = new Function(...names, JS + '\nreturn { IdentityOnboarding };')(...names.map(n => scope[n]));
  const el = IdentityOnboarding({ open: true, identity: null, onSave() {}, onSkip() {} });
  const cleanups = runEffects ? effects.map(([fn]) => fn()).filter(f => typeof f === 'function') : [];
  return { el, cleanups };
}

test('the wizard announces itself as a modal dialog', () => {
  const { el } = mount();
  assert.equal(el.props.role, 'dialog',
    'the first-launch wizard renders as a plain div — a screen reader has no idea it is a modal, and reads ' +
    'the app behind it');
  assert.equal(el.props['aria-modal'], 'true', 'the wizard is a dialog but not a modal one');
  assert.ok((el.props['aria-label'] || '').trim(), 'the dialog has no name');
  assert.equal(el.props.tabIndex, -1, 'the panel cannot receive focus, so focus stays on <body> on first launch');
});

test('every step of the wizard is a dialog, not just the first', () => {
  // Nine full-screen roots share this component. Fixing the one that happens to render first is this
  // codebase's most repeated defect, so walk them.
  let checked = 0;
  for (const step of [0, 1, 2, 3, 4]) {
    let el;
    try { ({ el } = mount({ step })); } catch (e) { continue; }   // a step needing state we did not seed
    if (!el || !el.props) continue;
    checked++;
    assert.equal(el.props.role, 'dialog', `step ${step} renders without dialog semantics`);
    assert.equal(el.props['aria-modal'], 'true', `step ${step} is not marked modal`);
  }
  assert.ok(checked >= 3, `only ${checked} steps rendered — the walk has drifted, re-anchor it`);
});

test('the app behind the wizard is made unreachable, and put back afterwards', () => {
  const attrs = new Map();
  const mk = (name) => ({
    name,
    hasAttribute: (a) => attrs.has(name + ':' + a),
    setAttribute: (a, v) => attrs.set(name + ':' + a, v),
    removeAttribute: (a) => attrs.delete(name + ':' + a),
  });
  const appTree = mk('app'), splash = mk('splash');
  const panel = mk('panel');
  panel.parentElement = { children: [appTree, splash, panel] };

  const { cleanups } = mount({ refEl: panel, runEffects: true });

  assert.equal(attrs.get('app:inert'), '',
    'THE DEFECT: the running app stays reachable behind a modal covering the whole screen — a screen ' +
    'reader can wander into it and activate the tab bar underneath');
  assert.equal(attrs.get('app:aria-hidden'), 'true', 'the app behind the wizard is still announced');
  assert.equal(attrs.get('splash:inert'), '', 'only the first sibling was closed off');
  assert.equal(attrs.has('panel:inert'), false, 'the wizard made ITSELF inert — the member can do nothing at all');

  assert.ok(cleanups.length >= 1, 'the effect returns no cleanup, so the app stays inert after the wizard closes');
  cleanups.forEach(fn => fn());
  assert.equal(attrs.has('app:inert'), false, 'the app was left inert after the wizard closed — nothing works');
  assert.equal(attrs.has('app:aria-hidden'), false, 'the app was left hidden from screen readers');
});
