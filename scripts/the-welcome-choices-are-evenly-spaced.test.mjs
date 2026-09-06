// THE FIRST SCREEN ANYONE SEES: THREE CHOICES, EVENLY SPACED, AND NOT BY THREE COPIES OF ONE STYLE.
// Run: node --test scripts/the-welcome-choices-are-evenly-spaced.test.mjs
//
// Owner, 2026-09-04: "the buttons are unevenly spaced." They were: the first and third carried
// `marginBottom: 10` and the second carried none, so "I've used it before" and "Someone set this up for me"
// sat flush together under a first button that was spaced properly.
//
// The cause is the point. The third button was added later (AUDIT-2026-07-28, the child whose parent set the
// account up) with the FIRST button's style, and the second's missing margin went unnoticed because it had
// until then been the last in the list. Spacing done per-button puts it in the wrong place — it belongs to
// the GROUP — so the next person to insert one reintroduces exactly this.
//
// CLAUDE.md rule 3: app/*.jsx ships unbundled, so no assertion here matches its text. The real component is
// rendered and the tree is measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';

const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };

function welcome() {
  const { React, draw } = miniReact();
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    // IdentityOnboarding calls useDialogA11y (app/ui.jsx) so the first-run wizard is a real modal dialog —
    // added 2026-09-05 with finding 6. In the app both are classic scripts and ui.jsx loads first, so it is a
    // plain global; here it has to be supplied or the component throws before rendering anything. Its own
    // behaviour is app/ui.jsx's business and is covered by the-first-run-wizard-is-a-real-dialog.test.mjs.
    useDialogA11y: () => {},
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    navigator: { userAgent: '', clipboard: null },
    location: { search: '', hostname: 'x', href: 'https://localhost/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    cx: (...a) => a.filter(Boolean).join(' '),
    Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
    lsGet: (k, d) => d, lsSet: () => {},
    window: {
      addEventListener() {}, removeEventListener() {}, innerWidth: 360,
      TrinityIdentity: { current: null, locked: false, hasPin: () => false, isLocked: () => false,
                         canRemember: () => false, rememberDays: 30 },
      Fellowship: { ready: Promise.resolve() },
    },
  };
  const { IdentityOnboarding } = loadScreen('app/identity.jsx', ['IdentityOnboarding'], globals);
  return { draw, IdentityOnboarding };
}

function choices() {
  const { draw, IdentityOnboarding } = welcome();
  const tree = draw(IdentityOnboarding, { open: true, onDone() {}, onSkip() {} });
  const words = texts(tree).join(' ');
  assert.match(words, /Welcome to TrinityOne/, 'this is not the welcome screen — re-anchor this test');
  const labels = ['I’m new here', 'I’ve used it before', 'Someone set this up for me'];
  const btns = labels.map(l => {
    const b = button(tree, l)[0];
    assert.ok(b, 'the "' + l + '" choice is gone from the first screen anyone sees');
    return b;
  });
  return { tree, btns, labels };
}

test('no choice is spaced differently from its neighbours', () => {
  const { btns, labels } = choices();
  const margins = btns.map(b => (b.props.style || {}).marginBottom);
  const uneven = margins.filter((m, i) => m !== margins[0]);
  assert.equal(uneven.length, 0,
    'the three welcome choices carry different bottom margins (' +
    labels.map((l, i) => l + '=' + String(margins[i])).join(', ') +
    '), so they do not sit evenly — which is what the owner saw');
});

test('the spacing belongs to the GROUP, not to each button', () => {
  // The fix that lasts. With a per-button margin the next inserted button reintroduces the bug; with a gap on
  // the container it cannot.
  const { tree, btns } = choices();
  for (const b of btns) {
    assert.equal((b.props.style || {}).marginBottom, undefined,
      'a welcome choice is spacing itself again — the next button added beside it will not match');
  }
  const rows = find(tree, n => n.props && n.props.style && n.props.style.gap && n.props.style.flexDirection === 'column');
  const holder = rows.find(r => button(r, 'I’ve used it before').length && button(r, 'I’m new here').length);
  assert.ok(holder, 'the three choices are not in a container that spaces them');
  assert.ok(holder.props.style.gap > 0, 'the container spaces them by zero');
});

test('all three choices are drawn from ONE style, so they cannot drift apart', () => {
  const { btns } = choices();
  assert.equal(btns[0].props.style, btns[1].props.style,
    'these were three separate copies of the same inline object, which is how one of them came to differ');
  assert.equal(btns[1].props.style, btns[2].props.style);
});

test('CONTROL: they are still three distinct, equally-weighted choices', () => {
  // Deliberately equal weight — colouring one as the primary action is a nudge, and both wrong answers cost
  // something. A tidy-up must not quietly promote one of them.
  const { btns, tree } = choices();
  const bg = btns.map(b => (b.props.style || {}).background);
  assert.equal(new Set(bg).size, 1, 'one choice is now styled as the primary action; they must stay equal');
  assert.match(texts(tree).join(' '), /Skip setup for now/, 'the way out of the screen is gone');
});
