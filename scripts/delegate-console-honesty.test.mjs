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
  // UPDATED after round 7. This used to require the panel to say "Settings → Delegated stewards" — written
  // when that looked like helpfully precise directions. It is not: Settings → Security is owner-gated
  // (`section === 'security' && !delegated`), and this panel is shown to DELEGATES by definition, because
  // they are the only people who ever get refused. A steward followed it and reported "no such page exists;
  // Security shows one general paragraph only". Directions to a door that is not there for you are worse
  // than no directions. Name the person to ask instead.
  assert.doesNotMatch(blocked, /Settings → (Security → )?Delegated stewards/,
    'the refusal still sends a delegate to an owner-only page — the one instruction it gives cannot be ' +
    'followed by anyone who reads it');
  assert.match(blocked, /whoever holds the church key/i,
    'the refusal does not name who to ask, which is the only actionable thing it can offer a delegate');
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

test('the capability editor lives in the panel that renders it', () => {
  // THE ONE MY OTHER TESTS COULD NOT SEE. scopeEditor was defined inside DashMembers and called from
  // DashStewardsPanel, so every structural assertion passed — the text was all present, in the same file —
  // and the shipped console threw "ReferenceError: scopeEditor is not defined" and showed the crash screen
  // the instant an owner opened it. Three attempts, three crashes, and the round could not scope anybody.
  // A helper and its caller must be in the same function body.
  const panel = fnBody(stripComments(DASH), 'function DashStewardsPanel(', 'DashStewardsPanel');
  assert.match(panel, /const scopeEditor = /,
    'scopeEditor is called from DashStewardsPanel but defined somewhere else, which is a ReferenceError the ' +
    'moment an owner opens it — and no amount of matching source text elsewhere in the file will notice');
  assert.match(panel, /scopeEditor\(pk\)/, 're-anchor: the panel no longer calls it');
});

test('the Finance capability does not describe a limit that was removed', () => {
  const src = stripComments(DASH);
  assert.doesNotMatch(src, /cannot open them yet/,
    'the editor still tells owners a delegate cannot open the books. That stopped being true when the books ' +
    'got a key of their own, and stale copy about a limit is its own kind of untruth.');
});
