// A CONSOLE POP-UP MUST COVER THE SCREEN, NOT THE PANE IT HAPPENS TO SIT IN.
//   Run: node --test scripts/a-console-dialog-fits-the-phone.test.mjs
//
// Found by the owner on the built steward APK, 2026-09-15: *"that box with the blurred out background
// definitely needs fixing"*. Measured on the handset (Oppo CPH2477, 360x730 CSS px, DPR 2) before the fix:
//
//   New group   overlay position:absolute   dialog top 251  bottom 814   viewport 730   -> 84px off the bottom
//   New event   overlay position:absolute   dialog top 385  bottom 849   viewport 730   -> 119px off the bottom
//
// In both cases the clipped part held **Cancel and the save button**, and the overlay does not scroll, so on a
// phone the steward could not finish the job at all. The same measurement named the visual symptom the owner
// had described: because the backdrop was `position: absolute`, it painted only inside the content pane, so
// the header and the whole navigation stayed undimmed above it and the blur stopped in a hard grey edge down
// each side.
//
// THE CONTROL THAT PROVED THE CAUSE, same phone, same page, same `blur(3px)`: the Help sheet, which is
// `position: fixed`, measured 0,0 -> 360x730 with its dialog at 46..684 and nothing clipped. One property
// separated the two. 26 overlays were `absolute`; 4 were already `fixed`.
//
// ⚠ AND `position: fixed` ALONE IS NOT THE WHOLE FIX. A flex container that centres its child clips the TOP
// of a child taller than itself, and the clipped part cannot be scrolled to — the scroll origin is already
// past it. Measured in the shipped WebView (Chrome 152) rather than assumed:
//
//   align-items: center        a child 400px taller than the viewport reports top = -200   (unreachable)
//   align-items: safe center   the same child reports top = 0                              (reachable)
//
// So the fix is three properties per overlay: `position: fixed`, `overflowY: 'auto'`, and `safe center` in
// place of `center`. `safe` falls back to flex-start only when centring would overflow, so a dialog that
// fits is still centred and nothing that worked moves.
//
// ── HOW THIS ASSERTS, AND WHY NOTHING CHEAPER WOULD DO ────────────────────────────────────────────────────
//
// CLAUDE.md rule 3: `app/stew-*.jsx` ship UNBUNDLED, so `false && ` in front of a condition leaves every word
// in place and a text-matching assertion still passes. Nothing in the first test below matches text. Each
// modal is COMPILED with the same esbuild the packaged build uses and RENDERED through the miniature React in
// scripts/render-jsx-screen.mjs, and the style object asserted on is the one the component actually
// evaluated. Deleting the fix from the source makes these fail; commenting it out does too.
//
// The second test is a different instrument for a different job, and it is labelled as such: a REGRESSION
// TRIPWIRE over the source text, there to catch a NEW overlay written in the old shape — something the render
// test cannot do, because it only knows about modals that exist today and that a fixture can stand up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = readdirSync(join(ROOT, 'app')).filter(f => /^stew-.*\.jsx$/.test(f)).map(f => 'app/' + f);

// The overlay is the element carrying the blurred backdrop. Found by its STYLE, never by its text.
const overlayOf = (tree) => find(tree, n => n.props && n.props.style
  && /blur\(/.test(String(n.props.style.backdropFilter || n.props.style.WebkitBackdropFilter || '')))[0];

// The stubs the console's modals take from their neighbours. Deliberately minimal: anything a modal needs
// beyond this is a modal whose fixture does not stand up, and it is REPORTED rather than silently skipped.
const globals = (React) => ({
  React,
  Icon: () => null,
  SkToggle: () => null,
  useStewDialog: () => ({ current: null }),
  todayISO: () => '2026-09-15',
  window: {
    useStewardGroups: () => [], useStewardMembers: () => [], useStewardNetworks: () => [],
    useStewardCategories: () => [], useStewardRosters: () => ({}), Steward: {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    localStorage: { getItem: () => null, setItem() {} },
  },
});

const PROPS = {
  SchModal: { title: 'T', children: null, onClose() {} },
  RoomBookingModal: { bk: { id: '', room: '', from: 0, to: 0 }, rooms: [], bookings: [], onClose() {} },
  GroupLeadersModal: { group: { id: 'g', name: 'G' }, onClose() {} },
  NameEditModal: { open: true, label: 'church', current: '', onClose() {} },
  SeriesNameModal: { current: '', onClose() {} },
  SeriesScheduleModal: { series: { id: 's', name: 'S' }, onClose() {} },
  WebAddressModal: { church: { nip05: '', name: 'X' }, onClose() {} },
};
const DEFAULT_PROPS = { open: true, onClose() {}, children: null };

// Which component owns each blurred overlay, read off the source so a NEW modal joins this list by itself.
function modalsWithOverlays() {
  const out = [];
  for (const rel of FILES) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const lines = src.split('\n');
    for (const m of src.matchAll(/position:\s*'(?:fixed|absolute)',[^\n]{0,80}inset:\s*0[\s\S]{0,400}?backdropFilter:\s*'blur\(/g)) {
      const ln = src.slice(0, m.index).split('\n').length;
      for (let i = ln - 1; i >= 0; i--) {
        const fn = /^function ([A-Z][A-Za-z0-9_]*)\s*\(/.exec(lines[i]);
        if (fn) { out.push({ rel, name: fn[1] }); break; }
      }
    }
  }
  // de-duplicate: one component may hold more than one overlay
  const seen = new Set();
  return out.filter(o => { const k = o.rel + ':' + o.name; if (seen.has(k)) return false; seen.add(k); return true; });
}

test('every console pop-up that renders covers the SCREEN, and a tall one can be scrolled to', () => {
  const targets = modalsWithOverlays();
  assert.ok(targets.length >= 20,
    'expected the console to still have ~25 blurred pop-ups; found ' + targets.length + '. If they were ' +
    'deliberately removed, update this number — a shrinking list is how this test would quietly stop looking.');

  const checked = [], skipped = [];
  for (const { rel, name } of targets) {
    const { React, draw } = miniReact();
    let mod;
    try { mod = loadScreen(rel, [name], globals(React)); }
    catch (e) { skipped.push(name + ' (load: ' + String(e.message).slice(0, 70) + ')'); continue; }
    let tree;
    try { tree = draw(mod[name], PROPS[name] || DEFAULT_PROPS); }
    catch (e) { skipped.push(name + ' (render: ' + String(e.message).slice(0, 70) + ')'); continue; }
    const ov = overlayOf(tree);
    if (!ov) { skipped.push(name + ' (its overlay is behind a state this fixture does not reach)'); continue; }
    const st = ov.props.style;
    checked.push(name);

    assert.equal(st.position, 'fixed',
      name + "'s backdrop is position:" + st.position + '. Anything but `fixed` sizes it to the content pane, ' +
      'so the dialog is measured against the wrong box and its buttons fall off the bottom of a 730px phone.');
    assert.equal(st.overflowY, 'auto',
      name + "'s backdrop cannot scroll, so a dialog taller than the phone has an unreachable part.");
    if (st.alignItems === 'center') {
      assert.fail(name + " centres with plain `center`. Measured in the shipped WebView: a child taller than " +
        'the viewport then sits at top=-200 and cannot be scrolled to. Use `safe center`.');
    }
  }

  // ⚠ A HARNESS THAT COVERS NOTHING PASSES EVERY ASSERTION ABOVE. Fail if the fixtures stopped standing up.
  assert.ok(checked.length >= 14,
    'only ' + checked.length + ' of ' + targets.length + ' pop-ups could be rendered, so this test is barely ' +
    'looking at anything. Skipped: ' + skipped.join('; '));
});

test('REGRESSION TRIPWIRE (source text, not behaviour): no console overlay is written as position:absolute', () => {
  // This one DOES read the source, on purpose and for one job only: catching a NEW overlay written in the old
  // shape, which the render test cannot see because it has no fixture for a component nobody has written yet.
  // It proves nothing about what is on screen — the test above does that.
  const offenders = [];
  for (const rel of FILES) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/position:\s*'absolute',[^\n]{0,80}inset:\s*0[\s\S]{0,400}?backdropFilter:\s*'blur\(/g)) {
      offenders.push(rel + ':' + src.slice(0, m.index).split('\n').length);
    }
  }
  assert.deepEqual(offenders, [],
    'these modal backdrops are position:absolute, which covers the content pane instead of the screen and ' +
    'clips the dialog: ' + offenders.join(', '));
});
