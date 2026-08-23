// "IT TAKES MY WORD ENTIRELY, ON ONE TAP." — Rev. Miriam, on clearing an adult to work with young people.
// Run: node --test scripts/safeguarding-paper-trail.test.mjs
//
// She is right, and it is the one place in this app where being right about that matters outside the app. A
// church can be asked — by a diocese, an insurer, a parent, or a court — who cleared this person, and when,
// and on what basis. Today the honest answer is "the app says he's cleared, and that is all it says": the
// document is a bare list of public keys with no date, no author and nowhere to record that a check was ever
// done. A safeguarding record that cannot be produced is not a safeguarding record.
//
// The list itself must not change shape. The RELAY reads `pubkeys` from this document to police who may
// contact a child (approvedIn, gateway.mjs) — so the trail is added ALONGSIDE it, and a relay or an app that
// has never heard of the trail keeps working exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const STEW = stripComments(readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8'));
const GATE = stripComments(readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8'));

test('S2 — a clearance records who granted it and when', () => {
  const fn = fnBody(STEW, 'setApproved(pubkeys, opts)');
  assert.match(fn, /cleared/, 'the published document still carries no trail at all');
  assert.match(fn, /by:/, 'nothing records WHO cleared them');
  assert.match(fn, /at:/, 'nothing records WHEN');
});

test('S2 — `pubkeys` keeps its shape, because the relay polices with it', () => {
  // approvedIn() reads pubkeys from this document to decide whether an adult may contact a child. Changing
  // that field's shape would silently change who can reach children on every relay running older code.
  const fn = fnBody(STEW, 'setApproved(pubkeys, opts)');
  assert.match(fn, /pubkeys: list/, 'the list the relay reads is no longer published as a plain array');
  assert.match(GATE, /JSON\.parse\([^)]*\)\.pubkeys|\.pubkeys\b/, 'the relay no longer reads pubkeys — re-anchor');
});

const STEWD = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('S2 — a refusal to write the record is not swallowed', () => {
  // setApproved now REJECTS rather than fabricate a date when the record has not loaded. Both call sites
  // treated it as synchronous — one inside `try { } catch (e) {}`, which catches nothing a promise throws.
  // An unhandled rejection here means the steward saw the toggle move and believes someone is cleared.
  const t1 = STEWD.slice(STEWD.indexOf('const toggleMinor'), STEWD.indexOf('const toggleApproved'));
  assert.match(t1, /setApproved\(nextApproved\)[\s\S]{0,120}catch\(/,
    'the unmark path can reject with nobody catching it');
  const t2 = STEWD.slice(STEWD.indexOf('const toggleApproved'), STEWD.indexOf('const guardReqs'));
  assert.match(t2, /catch\(/, 'the clearance path can reject with nobody catching it');
  assert.match(t2, /steward-write-blocked/, 'a failed clearance tells the steward nothing');
});

const IDENT = stripComments(readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8'));

test('S5 — a cleared adult can see that they are cleared', () => {
  // Samuel and Yusuf both turned up to help with young people not knowing whether the church had cleared
  // them. The guide explains marking a CHILD and never mentions clearing an ADULT, and their own app said
  // nothing either way.
  //
  // Nothing new has to be published for this. The per-member sealed clearance doc ALREADY carries `cleared`
  // (fellowship.src.js), for the same reason a child's own device is told they are a child: the church's
  // approved: list is owner-only, so a member cannot be shown the list — but they can be told about
  // themselves. The app knew and never said.
  assert.match(IDENT, /safeguard\.cleared/, "a member is never shown their own youth clearance");
  assert.match(IDENT, /clearanceKnown/,
    'nothing distinguishes "not cleared" from "we have not heard yet", which is the difference between ' +
    'turning someone away and asking them to wait');
});

test('S1 — "who is cleared?" is answerable without reading every row', () => {
  // Miriam: "with a hundred members I'd be lost." Today the only way to answer it is to scroll the whole
  // membership one row at a time, and the search box matches names — so it cannot even be used to filter to
  // the people the question is about.
  assert.match(STEWD, /clearedList|Cleared for youth work/,
    'there is still no summary of who is cleared');
});

test('S1 — the summary shows the trail, or it answers nothing useful', () => {
  // A list of names is barely better than the rows. The question a church is actually asked is "who cleared
  // this person, and when" — so the summary is where S2's record has to surface.
  const i = STEWD.indexOf('clearedList');
  assert.ok(i > 0, 'no summary');
  const block = STEWD.slice(i, STEWD.indexOf('\n  const ', i + 10));
  assert.match(block, /cleared\[|sg\.cleared/, 'the summary does not read the clearance record at all');
});

test('S2 — an OLD clearance is not stamped with today on the next unrelated write', () => {
  // Caught live: clearing Callum rebuilt the whole document, and Yusuf — cleared days earlier, with no record
  // because the record did not exist yet — came back reading "Cleared Aug 23, 2026". The panel says in so
  // many words that old clearances are "not back-dated", so this was the code contradicting its own UI.
  //
  // Only someone who was NOT on the previous list is new. Anyone already on it with no record has exactly
  // that: no record. Saying so is the whole point of a paper trail.
  const fn = fnBody(STEW, 'setApproved(pubkeys, opts)');
  assert.match(fn, /_approvedPrev|wasApproved/,
    'nothing distinguishes a NEW clearance from one that was already there');
});
