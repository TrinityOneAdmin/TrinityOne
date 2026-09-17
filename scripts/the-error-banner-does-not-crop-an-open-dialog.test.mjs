// THE BANNER MUST OUTRANK A MODAL WITHOUT SITTING ON ITS TITLE.
//   Run: node --test scripts/the-error-banner-does-not-crop-an-open-dialog.test.mjs
//
// TWO FIXES POINTING IN OPPOSITE DIRECTIONS, AND BOTH ARE RIGHT.
//
// AUDIT-9 moved PublishErrorBanner into flow and had to give it `zIndex: 240`, because every console modal is
// a full-viewport overlay with a dim and a blur at 50-220 and the banner was being painted UNDERNEATH them —
// greyed and untappable. That is not a safeguarding-only problem: FinanceShareStatement and the first-run
// wizard both publish while their modal is still open, so a relay refusal explained itself behind a blur.
//
// The flip side, found by the owner on the Oppo (360x730) on 2026-09-17, over the seal dialog: an opaque
// `var(--paper)` band, full width, at exactly the height a centred dialog's top edge sits — taking its title
// and first lines. He described it as "oddly cropped".
//
// THE SHAPE CHOSEN: while any dialog is open the banner moves to the FOOT of the viewport, fixed, keeps
// z-index 240, drops its opaque background, becomes pointer-transparent except for the card itself, and
// clamps to ONE LINE with a `Show` control. Rationale, stated so it can be argued with: a dialog's identity
// is at its top and the banner's is not — the banner is the thing that can be summarised. And at 730x328
// (the Oppo in landscape, 32px of it navigation bar) a dialog may be 86vh tall, so NO arrangement leaves a
// multi-line banner and a full-height dialog both wholly visible; something must shrink, and it is the
// banner, reversibly, in one tap.
//
// ⚠ AND THE THREE OLD DEFECTS MUST NOT COME BACK: behind the modal (AUDIT-9), over the tab strip (AUDIT-8),
// or eating the scrolling content region (AUDIT-9, which is why 40vh/220px is capped). Each has a row below.
//
// CLAUDE.md rule 3: nothing here matches text in app/*.jsx. The components are COMPILED with the real esbuild
// and RENDERED, and every assertion reads a style object the component actually evaluated, or the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const REFUSAL = 'blocked: not a member or not permitted for this group';

// One `window` shared by both files, exactly as steward.html shares one — app/stew-modal.jsx writes
// `window.stewModalOpen` onto it and app/stew-dashboard.jsx reads it.
function console_(openAtMount) {
  const listeners = {};
  const win = {
    Steward: { actingChurch: '' },
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter(x => x !== fn); },
    dispatchEvent: (e) => { (listeners[e.type] || []).forEach(fn => fn(e)); },
  };
  // THE REAL REGISTRY, out of app/stew-modal.jsx — not a stub of it. A stub here would be a test of the test.
  const mr = miniReact();
  const modal = loadScreen('app/stew-modal.jsx', ['useStewDialog', 'useStewModalOpen'], {
    React: mr.React, window: win, document: undefined, Icon: Stub('Icon'),
    setTimeout, clearTimeout, console,
  });
  if (openAtMount) win.stewModalOpen = () => true;
  const b = miniReact();
  const timers = [];
  const dash = loadScreen('app/stew-dashboard.jsx', ['PublishErrorBanner', 'SkConfirm'], {
    React: b.React, window: win, Icon: Stub('Icon'),
    useStewDialog: modal.useStewDialog, useStewModalOpen: modal.useStewModalOpen,
    noteRelayRejection: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    console, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, Promise, RegExp,
  });
  const api = { win, timers, modalReact: mr, modal, dash };
  api.drawBanner = () => { api.tree = b.draw(dash.PublishErrorBanner, {}); return api.tree; };
  api.fire = (detail) => {
    (listeners['steward-publish-error'] || []).forEach(fn => fn({ detail }));
    return api.drawBanner();
  };
  api.openDialog = () => mr.draw(dash.SkConfirm, { title: 'Seal “Musicians”?', body: 'x', onConfirm() {}, onCancel() {} });
  api.drawBanner();
  return api;
}
// the banner's outermost box — the one the wrapper style is on
const wrapperOf = (tree) => find(tree, n => n.props && n.props.style && n.props.style.zIndex === 240)[0];
const cardsOf = (tree) => find(tree, n => n.props && n.props.role === 'alert');
const showBtn = (tree) => find(tree, n => n.type === 'button' && /Show the whole message/.test(String((n.props || {})['aria-label'] || '')));
const dismissBtn = (tree) => find(tree, n => n.type === 'button' && /Dismiss/i.test(String((n.props || {})['aria-label'] || '')));

test('CONTROL: with no dialog open the banner is exactly what AUDIT-8 and AUDIT-9 left', () => {
  // If this row fails, every row below is measuring something else.
  const c = console_(false);
  c.fire({ reason: 'timeout' });
  const w = wrapperOf(c.tree).props.style;
  assert.equal(w.position, 'relative', 'the banner left the flow when no dialog is open');
  assert.equal(w.background, 'var(--paper)', 'the in-flow banner is transparent, so the page shows through it');
  assert.equal(w.maxHeight, 'min(40vh, 220px)',
    'THE CAP IS GONE. Uncapped, a long message took the whole fold: measured at 360x520 the content region ' +
    'was 38px tall and entirely below it. AUDIT-9.');
  assert.equal(w.zIndex, 240, 'the banner no longer outranks the overlays (50-220). AUDIT-9.');
  assert.ok(!('bottom' in w), 'the in-flow banner is anchored to the viewport, which would cover the content');
});

test('with a dialog open the banner is at the FOOT of the viewport, not over the dialog’s title', () => {
  const c = console_(true);
  c.fire({ reason: 'timeout' });
  const w = wrapperOf(c.tree).props.style;
  assert.equal(w.position, 'fixed',
    'THE BANNER IS STILL IN FLOW BEHIND A DIALOG, which puts its opaque band exactly where a centred ' +
    'dialog’s top edge is at 360x730 — the owner’s "oddly cropped".');
  assert.equal(w.bottom, 0, 'it is not anchored to the bottom, so it is somewhere over the dialog');
  assert.ok(!('top' in w), 'it is anchored to the TOP, which is where the dialog’s title is');
  assert.equal(w.background, 'transparent',
    'the opaque band is back: it paints over the dialog’s backdrop across the full width of the screen');
});

test('…and it still outranks the modal — the AUDIT-9 defect must not come back', () => {
  const c = console_(true);
  c.fire({ reason: 'timeout' });
  const w = wrapperOf(c.tree).props.style;
  assert.ok(w.zIndex > 220,
    'THE BANNER IS BEHIND THE OVERLAY AGAIN (they run to 220). It would be greyed by the dim and untappable, ' +
    'which is exactly the state AUDIT-9 found — and the wizard and FinanceShareStatement both publish with ' +
    'their modal open, so this is not a corner case.');
  assert.equal(w.pointerEvents, 'none',
    'the strip swallows taps across the whole width of the dialog behind it');
  assert.equal(cardsOf(c.tree)[0].props.style.pointerEvents, 'auto',
    'the message itself cannot be tapped, so it cannot be dismissed or expanded');
});

test('…clamped to one line, and short enough to clear a full-height dialog in landscape', () => {
  const c = console_(true);
  c.fire({ reason: 'timeout' });
  const w = wrapperOf(c.tree).props.style;
  const text = find(cardsOf(c.tree)[0], n => n.props && n.props.style && n.props.style.whiteSpace === 'nowrap');
  assert.equal(text.length, 1, 'the message is not clamped to a single line while a dialog is up');
  assert.equal(text[0].props.style.textOverflow, 'ellipsis', 'a clamped line with no ellipsis just truncates silently');
  // 730x328 is the Oppo in landscape. A dialog there is at most 86vh (SkConfirm) inside a 24px-padded
  // overlay, so its lowest ink is at about 305px; the strip must start below that. 30vh of 328 is 98px, so
  // the 84px literal is what binds, and the card inside it is ~32px.
  assert.equal(w.maxHeight, 'min(30vh, 84px)',
    'the collapsed strip is taller than the room a landscape dialog leaves at the foot of the screen');
});

test('the whole message is one tap away, and the message is still dismissible', () => {
  const c = console_(true);
  c.fire({ reason: 'timeout' });
  assert.equal(showBtn(c.tree).length, 1, 'a summary with no way to read the rest is a worse banner than the one that cropped');
  assert.ok(dismissBtn(c.tree).length >= 1, 'the message cannot be dismissed while a dialog is open');
  showBtn(c.tree)[0].props.onClick();
  const after = c.drawBanner();
  assert.equal(find(cardsOf(after)[0], n => n.props && n.props.style && n.props.style.whiteSpace === 'nowrap').length, 0,
    'pressing Show did not expand the message');
  const w = wrapperOf(after).props.style;
  assert.equal(w.pointerEvents, 'auto', 'an expanded message that needs scrolling cannot be scrolled');
  assert.equal(w.maxHeight, 'min(40vh, 220px)', 'the expanded banner is uncapped, so it can take the whole screen');
  assert.equal(w.bottom, 0, 'expanding moved it back over the dialog’s title');
});

test('it follows the dialog: opening one moves it, closing one puts it back', () => {
  const c = console_(false);
  c.fire({ reason: 'timeout' });
  assert.equal(wrapperOf(c.tree).props.style.position, 'relative');
  c.win.stewModalOpen = () => true;
  c.win.dispatchEvent({ type: 'stew-modals' });
  assert.equal(wrapperOf(c.drawBanner()).props.style.position, 'fixed',
    'the banner did not react to a dialog opening, so it only ever gets out of the way by luck');
  c.win.stewModalOpen = () => false;
  c.win.dispatchEvent({ type: 'stew-modals' });
  assert.equal(wrapperOf(c.drawBanner()).props.style.position, 'relative',
    'THE BANNER STAYED AT THE FOOT AFTER THE DIALOG CLOSED. Fixed to the viewport it covers the content ' +
    'region, which is the other half of AUDIT-9.');
});

test('expanding it is for THIS dialog — the next one opens under a one-line bar again', () => {
  // Latched, the steward's own tap re-creates the cropping for every later dialog.
  const c = console_(true);
  c.fire({ reason: 'timeout' });
  showBtn(c.tree)[0].props.onClick();
  c.drawBanner();
  c.win.stewModalOpen = () => false;
  c.win.dispatchEvent({ type: 'stew-modals' });
  c.drawBanner();
  c.win.stewModalOpen = () => true;
  c.win.dispatchEvent({ type: 'stew-modals' });
  const after = c.drawBanner();
  assert.equal(showBtn(after).length, 1,
    'THE BANNER OPENED THE NEXT DIALOG ALREADY EXPANDED, which is the crop this file exists to stop, ' +
    'reintroduced by the steward’s own earlier tap');
});

test('THE WIRING: a real console dialog registers itself, through the real hook', () => {
  // Not a stub of the registry and not a text match — SkConfirm (the chrome the seal dialog uses) is compiled
  // out of app/stew-dashboard.jsx and rendered with the REAL useStewDialog out of app/stew-modal.jsx, and
  // its effect is what has to move the banner. Everything above is dormant without this.
  const c = console_(false);
  assert.equal(!!(c.win.stewModalOpen && c.win.stewModalOpen()), false, 're-anchor: something was open before we began');
  c.openDialog();
  assert.equal(c.win.stewModalOpen(), true,
    'A CONSOLE DIALOG DOES NOT REGISTER ITSELF. Every assertion above is then about a branch nothing reaches, ' +
    'and the banner goes on cropping dialogs exactly as it did.');
});

test('…and it does not cover the tab strip, which is the AUDIT-8 defect', () => {
  // The tab strip is at the TOP of the narrow layout, inside the header block the banner renders after.
  // In flow the banner cannot reach it; anchored to the viewport it must not be anchored to the top.
  for (const open of [false, true]) {
    const c = console_(open);
    c.fire({ reason: 'timeout' });
    const w = wrapperOf(c.tree).props.style;
    assert.ok(!('top' in w) && w.position !== 'absolute',
      'the banner is positioned from the top of the viewport again — measured with elementFromPoint at 360px ' +
      'that covered every control in the tab strip, including the Members tab the message tells you to open');
  }
});
