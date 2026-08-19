// A DELEGATE MUST NOT LEARN THE BOUNDARIES BY HITTING THEM.
// Run: node --test scripts/delegate-console-honesty.test.mjs
//
// A delegated steward saw a near-identical console to the owner's — same tabs, same buttons, a small STEWARD
// badge — and nothing anywhere saying what they may do. Zero owner-only controls were disabled: every one
// looked live and failed when pressed, and until 2026-07-28 most failed SILENTLY (the dialog closed, the
// toggle stayed put, a field said "Saved ✓", and nothing had happened). Two of the most serious bugs found
// that day were in delegated paths precisely because nobody goes there.
//
// Capabilities (2026-08-19) added a second class of the same thing — whatever a church did not grant. Without
// this, scoping a steward would just mean more buttons that look live and fail, and a simulated steward would
// file every refusal as a product defect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
// stewCapState reads the label table for its refusal wording, so lift that with it — a stub would let the
// test pass while the real screen said "undefined".
const stmtOf = (src, anchor) => { const i = src.indexOf(anchor); const j = src.indexOf('\n', i); return src.slice(i, j); };
const stewCapState = new Function(
  stmtOf(DASH, 'const STEW_CAP_LABEL = ') + '\n' +
  fnBody(DASH, 'function stewCapState(cap) {', 'stewCapState') + '\nreturn stewCapState;')();

const withSteward = (S, fn) => { const prev = global.window; global.window = { Steward: S }; try { return fn(); } finally { global.window = prev; } };

test('the owner console is never restricted', () => {
  const r = withSteward({ actingChurch: '', myStewardCaps: () => [] }, () => stewCapState('finance'));
  assert.equal(r.allowed, true,
    'the owner — who holds the church key and is not on the roster at all — has been locked out of their own console');
});

test('a steward their church has NOT scoped keeps everything', () => {
  const r = withSteward({ actingChurch: 'cp', myStewardCaps: () => null }, () => stewCapState('care'));
  assert.equal(r.allowed, true,
    'an unscoped delegate lost access. Every roster written before capabilities existed is unscoped, so this ' +
    'is what almost every real delegate looks like');
});

test('and a scoped one gets what they were given, and not what they were not', () => {
  const S = { actingChurch: 'cp', myStewardCaps: () => ['care'] };
  assert.equal(withSteward(S, () => stewCapState('care')).allowed, true, 'a granted capability is refused');
  const no = withSteward(S, () => stewCapState('finance'));
  assert.equal(no.allowed, false, 'a capability the church did not grant is offered anyway');
  assert.match(no.why, /hasn’t given you/,
    'the refusal does not say WHOSE decision it was, so the delegate cannot tell whether to ask someone or ' +
    'whether the app is broken');
});

test('it fails OPEN when the roster is not known yet', () => {
  const r = withSteward({ actingChurch: 'cp' }, () => stewCapState('members'));
  assert.equal(r.allowed, true,
    'a console that has not yet reached the relay hides real controls, so a slow connection looks exactly ' +
    'like a church that scoped you. The relay still refuses anything genuinely out of bounds.');
});

test('the two refusals are worded differently — one is permanent, one is not', () => {
  const src = stripComments(DASH);
  const blocked = fnBody(src, 'function StewCapBlocked(', 'StewCapBlocked');
  assert.match(blocked, /hasn’t been given to you/, 'the capability refusal does not say it can be changed');
  assert.match(blocked, /Settings → Delegated stewards/, 'it does not say where the owner would change it');
  assert.match(src, /Only the church key can change who the stewards are/,
    'the owner-only boundary reads like a capability their church could grant. It cannot be granted — it is ' +
    'what stops a steward adding themselves — and a delegate who confuses the two asks for the wrong thing.');
});

test('a delegate is told, on arrival, that this can be taken away', () => {
  const brief = stripComments(fnBody(DASH, 'function DelegateBrief(', 'DelegateBrief'));
  assert.match(brief, /your own key/i, 'the orientation never says they are signing as themselves, not as the church');
  assert.match(brief, /remove you/i,
    'the orientation does not say they can be removed at any time. A steward who learns that from a screen ' +
    'going blank mid-task learns something worse.');
  assert.match(brief, /myStewardCaps/, 'the orientation does not name what THIS steward was actually given');
});

test('the locked areas are marked in the nav, not hidden from it', () => {
  const src = stripComments(DASH);
  assert.match(src, /locked: true, cap: c/,
    'a capability a delegate lacks removes the tab entirely. A missing tab reads as a broken console; a ' +
    'padlocked one that explains itself reads as a church that has scoped you');
  assert.match(src, /n\.locked \? /, 'nothing renders the padlock, so the mark never reaches the screen');
});

test('granting Finance says plainly that it opens no screen yet', () => {
  const src = stripComments(DASH);
  assert.match(src, /encrypted to the church key, so a delegated steward cannot open them yet/,
    'an owner can grant Finance and neither of them will understand why the delegate still sees nothing — ' +
    'the books are sealed to the church key, which a delegate does not hold');
});
