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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const REFUSAL = 'blocked: not a member or not permitted for this group';

// One `window` shared by both files, exactly as steward.html shares one — app/stew-modal.jsx writes
// `window.stewModalOpen` onto it and app/stew-dashboard.jsx reads it.
function console_(openAtMount) {
  const listeners = {};
  // A root element that records what the banner writes to it. The reserved-space rules in steward.html are
  // keyed off this one attribute, so nothing else about them can be true if this is not set.
  const root = {
    attrs: {},
    setAttribute(k, v) { root.attrs[k] = v; },
    removeAttribute(k) { delete root.attrs[k]; },
  };
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
    document: { documentElement: root },
    useStewDialog: modal.useStewDialog, useStewModalOpen: modal.useStewModalOpen,
    noteRelayRejection: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    console, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, Promise, RegExp,
  });
  const api = { win, timers, modalReact: mr, modal, dash, root };
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
  // ⚠ THE CARD MUST INTERCEPT. A pointer-transparent card shipped here for exactly one commit and was the
  // worst thing on this branch: the card is OPAQUE, so an 11px band that PAINTED as an error banner
  // ACTUATED "Post to members" behind it — measured with elementFromPoint at 730x328. A steward aiming at
  // the banner would have published the church's quarterly finances to every member. What keeps the strip
  // off a dialog's buttons is the reserved space (the row below), never pointer-events.
  assert.equal(cardsOf(c.tree)[0].props.style.pointerEvents, 'auto',
    'THE CARD LETS TAPS THROUGH TO WHATEVER IS BEHIND IT. It is opaque, so what a steward sees is a banner ' +
    'and what they press is a dialog\'s primary action.');
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
  assert.equal(w.maxHeight, 'min(24vh, 62px)',
    'the collapsed strip grew. At 730x328 a 92vh dialog leaves nothing at the foot of the screen, so the ' +
    'strip is kept to one short row and lets taps through — both halves matter, and this is the first.');
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

test('THE RESERVED SPACE: the page is told a banner is standing there, and in which state', () => {
  // This is what actually keeps the strip off a dialog's buttons — not pointer-events, which was tried for
  // one commit and turned an unreachable button into a silently WRONG one. The two lengths live in
  // steward.html; this attribute is the only thing the banner contributes, and without it every rule there
  // is inert and the strip is back on top of "Post to members".
  const c = console_(true);
  assert.equal(c.root.attrs['data-stew-banner'], undefined, 're-anchor: something reserved space before a message existed');
  c.fire({ reason: 'timeout' });
  assert.equal(c.root.attrs['data-stew-banner'], 'clamped',
    'NOTHING RESERVES THE SPACE. The rules in steward.html are keyed on this attribute, so a dialog is laid ' +
    'out full height and the strip lands on its buttons.');
  showBtn(c.tree)[0].props.onClick();
  c.drawBanner();
  assert.equal(c.root.attrs['data-stew-banner'], 'open',
    'expanding the banner does not widen the reservation, so the expanded card covers the dialog');
});

test('…and the reservation is released the moment the message is', () => {
  // Left set, the console keeps every dialog short for the rest of the session over a message that is gone —
  // AUDIT-9's "it eats the page" in a different hat.
  const c = console_(true);
  c.fire({ reason: 'timeout' });
  assert.equal(c.root.attrs['data-stew-banner'], 'clamped');
  dismissBtn(c.tree)[dismissBtn(c.tree).length - 1].props.onClick();
  c.drawBanner();
  assert.equal(c.root.attrs['data-stew-banner'], undefined,
    'THE RESERVATION OUTLIVED THE MESSAGE. Every dialog in the console stays short for the rest of the session.');
});

test('…and no space is reserved when there is no dialog to reserve it from', () => {
  const c = console_(false);
  c.fire({ reason: 'timeout' });
  assert.equal(c.root.attrs['data-stew-banner'], undefined,
    'the console shortens its dialogs over a banner that is in flow and not over them at all');
});

test('the two lengths in steward.html and the two in this component are the SAME lengths', () => {
  // ⚠ A DRIFT HERE IS INVISIBLE ON SCREEN until a dialog is tall enough to reach the strip, and then it is
  // the 92vh finance modals — the ones this banner is raised above modals for. So they are pinned against
  // each other rather than trusted to be kept in step by hand.
  const html = readFileSync(new URL('../steward.html', import.meta.url), 'utf8');
  const c = console_(true);
  c.fire({ reason: 'timeout' });
  const clampedCap = wrapperOf(c.tree).props.style.maxHeight;
  showBtn(c.tree)[0].props.onClick();
  const openCap = wrapperOf(c.drawBanner()).props.style.maxHeight;
  for (const [state, cap] of [['clamped', clampedCap], ['open', openCap]]) {
    const rule = html.slice(html.indexOf('html[data-stew-banner="' + state + '"]'));
    const end = rule.indexOf('}');
    assert.notEqual(end, -1, `steward.html has no html[data-stew-banner="${state}"] rule — re-anchor`);
    const block = rule.slice(0, end);
    const want = cap.replace(/\s+/g, '');
    assert.ok(block.replace(/\s+/g, '').includes('margin-bottom:' + want),
      `steward.html reserves a different height for "${state}" than the banner actually takes. The banner ` +
      `caps itself at ${cap}; the rule says ${JSON.stringify(block.trim())}`);
    assert.ok(block.replace(/\s+/g, '').includes('calc(100vh-' + want + '-28px)'),
      `steward.html shortens a dialog by a different height than the banner takes for "${state}"`);
  }
});

// ── REGRESSION TRIPWIRE (source text, not behaviour), and it is labelled as such ──────────────────────────
//
// Everything above renders. This does not, and it cannot: it exists to catch an overlay that does not exist
// yet. The render test proves ONE dialog (SkConfirm, through the real useStewDialog) moves the banner; it
// structurally cannot know about a modal somebody writes next month, and a modal that skips registration is
// one the banner goes on cropping with every test green.
//
// It is here because that is exactly what happened on the day the fix was written: three console overlays
// had no useStewDialog at all — DelegateBrief, StewApproveSheet and MealsNeedModal — and the first cut of
// this work missed every one of them. An audit brief found them.
//
// WHAT COUNTS AS A MODAL HERE: full-viewport (`position: 'fixed'` with `inset: 0`) AND visually covering —
// it either dims (a `background` with rgba()/color-mix()) or blurs. That deliberately excludes the invisible
// click-catchers a dropdown puts behind itself (app/stew-schedule.jsx has two, zIndex 40, no background):
// those cover nothing, so the banner has nothing to get out of the way of.
const APP = new URL('../app/', import.meta.url).pathname;
const STEW_FILES = readdirSync(APP).filter(f => /^stew-.*\.jsx$/.test(f));

test('TRIPWIRE: every covering overlay in the console registers itself as a modal', () => {
  const missing = [], seen = [];
  for (const f of STEW_FILES) {
    const src = readFileSync(join(APP, f), 'utf8');
    const lines = src.split('\n');
    for (const m of src.matchAll(/position:\s*'fixed',[^\n]{0,200}inset:\s*0[^\n]{0,400}/g)) {
      const chunk = m[0];
      if (!/background:\s*'(?:rgba|color-mix)|backdropFilter:\s*'blur\(/.test(chunk)) continue;   // a click-catcher
      const at = m.index;
      let owner = null;
      for (let j = src.slice(0, at).split('\n').length - 1; j >= 0; j--) {
        const d = lines[j].match(/^function\s+([A-Za-z_$][\w$]*)/);
        if (d) { owner = d[1]; break; }
      }
      assert.ok(owner, `could not find the component owning an overlay in app/${f} — re-anchor this tripwire`);
      if (seen.includes(f + ':' + owner)) continue;
      seen.push(f + ':' + owner);
      // ⚠ NOT fnBody. A straight apostrophe in JSX TEXT is an unbalanced quote to every brace-walking
      // slicer in scripts/ — app/stew-finance.jsx has one, and fnBody dies on it with "could not find the
      // end of BooksDonate". That trap is written up in DashRelaysCard's own source. Slicing from this
      // top-level `function` to the NEXT one is enough for a presence check and cannot be tripped by
      // punctuation.
      const from = src.indexOf('\nfunction ' + owner);
      const next = src.indexOf('\nfunction ', from + 1);
      const body = src.slice(from, next === -1 ? src.length : next);
      if (!/useStewDialog\(|useStewModalOpen/.test(body)) missing.push('app/' + f + ' · ' + owner);
    }
  }
  assert.ok(seen.length > 20, `only ${seen.length} covering overlays found — the scan has stopped scanning`);
  assert.deepEqual(missing, [],
    'THESE OVERLAYS DO NOT REGISTER AS MODALS, so the console\'s error banner will sit on their heading ' +
    'exactly as it did on the Oppo on 2026-09-17: ' + missing.join(', ') + '. One line fixes each — see ' +
    'WizShell in app/stew-dashboard.jsx.');
});
