// A HELPER WHO HAS ASKED TO HELP, AND IS NOT YET APPROVED, sees a "Waiting for the church to approve you" screen —
// not an empty console. Run: node --test scripts/a-waiting-helper-sees-a-pending-screen.test.mjs
//
// Two halves, each at its point of use (CLAUDE.md rules 1 & 3):
//
//   A. THE ENGINE accessor Steward.pendingStewardRequest() is LIFTED from the SHIPPED bundle vendor/steward.js and
//      run. It reports { church } ONLY while the pending-church key is set (what requestSteward wrote and the grant
//      clears), the console is a pure helper (_ownKeyBlank), and no church is stewarded yet — so it can never fake
//      an approval. (Rebuild vendor/steward.js before this test, per the task: it reads the bundle.)
//
//   B. THE WIRING: the real StewardRoot (app/steward-root.jsx) is MOUNTED through console-screens.mjs with a key
//      present; when the accessor reports a pending request and no stewarded church, it renders StewardAwaitingApproval
//      and NOT StewDashboard, and the reverse when there is no pending request. The screen's own copy is asserted on
//      the real StewardAwaitingApproval component. Delete the branch or the screen and these go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

// ── A. THE ENGINE ACCESSOR, LIFTED FROM THE SHIPPED BUNDLE ───────────────────────────────────────────────────
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const PEND_KEY = 'trinityone.steward.pending-church';
function accessor({ pending = '', churchPub = 'me', blank = true, churches = new Map() }) {
  const store = new Map(); if (pending) store.set(PEND_KEY, pending);
  const scope = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) },
    PENDING_CHURCH_KEY: PEND_KEY, churchPub, _ownKeyBlank: () => blank, stewardedChurches: churches,
  };
  return new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, 'pendingStewardRequest() {', 'pendingStewardRequest')} }).pendingStewardRequest; }`)(scope).call(scope);
}

test('A1: a pure helper with an outstanding request and no granted church is reported as waiting', () => {
  assert.deepEqual(accessor({ pending: 'cc' }), { church: 'cc', name: '' },
    'a pending request with no granted church must report { church } so the UI can show the waiting screen');
});

test('A2: no pending-church key -> not waiting (null)', () => {
  assert.equal(accessor({ pending: '' }), null, 'with nothing pending the accessor must report null, not a waiting state');
});

test('A3: an OWNER (not a blank helper) is never shown the waiting screen', () => {
  assert.equal(accessor({ pending: 'cc', blank: false }), null,
    'a console that owns a church was reported as waiting — the screen would hide its own console');
});

test('A4: a helper who ALREADY stewards a church is not waiting (that church is shown instead)', () => {
  assert.equal(accessor({ pending: 'dd', churches: new Map([['cc', { name: 'St Aidan' }]]) }), null,
    'a helper already stewarding a church was reported as waiting');
});

test('A5: the pending church being our OWN key is ignored (never wait on ourselves)', () => {
  assert.equal(accessor({ pending: 'me', churchPub: 'me' }), null, 'the accessor waited on our own church key');
});

// ── B. THE WIRING + THE SCREEN ───────────────────────────────────────────────────────────────────────────────
function root({ pending }) {
  const fr = fakeReact();
  const Steward = fakeSteward({
    hasKey: true, locked: false, needsPin: false, keyResumedUnknown: false,
    pendingStewardRequest: () => pending,   // what the (separately-tested) engine accessor would answer
    hasPinLock: () => false,
    selfRegister: () => Promise.resolve(),   // initChurch() calls this at module load when a key is present
  });
  const { window } = fakeBrowser({ Steward });
  const mods = loadConsole({ React: fr.React, window, expr: '{ StewardRoot, StewardAwaitingApproval, StewDashboard }' });
  window.useStewardStewardedChurches = () => [];   // no granted church
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.StewardRoot(); fr.flush(); return tree; };
  draw(); draw();
  const has = (comp) => nodes(tree).some(n => n && n.type === comp);
  return { mods, has, tree };
}

test('B1: with a pending request and no granted church, StewardRoot shows the waiting screen, not the dashboard', () => {
  const r = root({ pending: { church: 'cc', name: '' } });
  assert.ok(r.has(r.mods.StewardAwaitingApproval),
    'a waiting helper was NOT shown the pending screen — StewardRoot dropped them onto an empty console');
  assert.ok(!r.has(r.mods.StewDashboard), 'the full dashboard rendered for a helper still waiting for approval');
});

test('B2: with no pending request, StewardRoot shows the dashboard (the screen does not steal the console)', () => {
  const r = root({ pending: null });
  assert.ok(r.has(r.mods.StewDashboard), 'the dashboard did not render for an approved/owner console');
  assert.ok(!r.has(r.mods.StewardAwaitingApproval), 'the waiting screen showed when there was no pending request');
});

test('B3: the screen names the wait and reassures (real StewardAwaitingApproval copy)', () => {
  const fr = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward({}) });
  const mods = loadConsole({ React: fr.React, window, expr: '{ StewardAwaitingApproval }' });
  fr.reset(); const tree = mods.StewardAwaitingApproval({ church: { church: 'cc', name: '' } }); fr.flush();
  assert.match(texts(tree).join(' '), /Waiting for the church to approve you/,
    'the pending screen does not say the console is waiting for approval');
});
