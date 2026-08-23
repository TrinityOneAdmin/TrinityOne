// FIVE SMALL DEFECTS, EACH OF WHICH COST A REAL MEMBER SOMETHING.
// Run: node --test scripts/small-fixes-round4.test.mjs
//
// From three sessions of a simulated congregation, all verified against the source by an independent pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const CHURCH = stripComments(readFileSync(new URL('../app/screens-church.jsx', import.meta.url), 'utf8'));
const TODAY  = stripComments(readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8'));
const READ   = stripComments(readFileSync(new URL('../app/screens-read.jsx', import.meta.url), 'utf8'));
const LIB    = stripComments(readFileSync(new URL('../app/screens-library.jsx', import.meta.url), 'utf8'));

test('M4 — a church with one member does not say "1 members"', () => {
  // Bridget, Lorna and Patrick each read it as an empty church. A pending member sees only themselves, so
  // the NUMBER is right; the word is not.
  assert.equal(/\{c\.members\}<\/b> members/.test(CHURCH), false,
    'the church card still hard-codes the plural');
});

test('C14 — "Nobody has listed themselves" does not deny the person reading it', () => {
  // Callum saw this directly above "You're ready to help — DIY · Moving · Rides". The list is deliberately
  // "who could help YOU", so the exclusion is right and only the wording is wrong.
  assert.equal(/Nobody has listed themselves as available yet/.test(TODAY), false,
    'the empty-state still says nobody, to somebody who has just listed themselves');
});

test('B3 — the highlight colours are named', () => {
  // Marta could not highlight at all: five unnamed circles with nothing to choose between them. The names
  // already exist as ids; they were simply never surfaced.
  const i = READ.indexOf('HL_COLORS.map');
  assert.ok(i > 0, 'highlight swatches not found');
  const block = READ.slice(i, i + 420);
  assert.match(block, /aria-label|title=/,
    'the swatches carry no name of any kind, so neither a screen reader nor a person can tell them apart');
});

test('V1 — the notes panel New note does not throw', () => {
  // `sel` is not in scope in CommentaryPanel; pressing New note threw a ReferenceError. Found by review,
  // never reported by a member — because nobody got that far.
  const i = READ.indexOf('function CommentaryPanel');
  const fn = READ.slice(i, READ.indexOf('\nfunction ', i + 10));
  assert.equal(/setCVerse\(String\(\(sel \|\| 1\)\)\)/.test(fn), false,
    'CommentaryPanel still references `sel`, which is not in its scope');
});

test('V2 — "Removed" is not claimed over a removal that cannot happen', () => {
  // removeModule cannot remove a commentary, yet the UI toasts "Removed". Same family as every other
  // control in this programme that reported success over nothing.
  // The real mechanism, sharper than filed: removeModule is `async`, so `if (removeModule(...))` tested a
  // PROMISE — always truthy — and the success toast fired whatever the removal returned.
  const i = LIB.indexOf('const remove = ');
  assert.ok(i > 0, 'remove handler not found');
  const fn = LIB.slice(i, i + 620);
  assert.equal(/if \(window\.Bible\.removeModule\(/.test(fn), false,
    'the removal result is still used as a synchronous boolean, so it is a Promise and always truthy');
  assert.match(fn, /await window\.Bible\.removeModule/,
    'removeModule is async and must be awaited before its result is believed');
});

test('the Care card is mounted on Today, and shows the ask even with no open needs', () => {
  // Owner's decision 2026-08-23: "Only on the today screen when Care is switched on."
  //
  // CareCard already had a Today variant and it was DEAD CODE — mounted in exactly one place
  // (screens-serving.jsx, `embedded`), the other branch commented "Today-card variant (currently unused)".
  // Three members failed to find Care; all three read Today first. Verity, 71, with a broken wrist:
  // "I'd never have thought to look for it under Serving & events. If I'd needed help badly I'd have
  // telephoned Miriam."
  //
  // The old branch returned null on `!live.length`, which would have hidden it in exactly her situation:
  // nobody had asked yet, and she was the one needing to ask.
  assert.match(TODAY, /<CareCard ctx=\{ctx\} \/>/,
    'the Today variant of CareCard is still not mounted anywhere');
  const i = TODAY.indexOf('function CareCard');
  const fn = TODAY.slice(i, TODAY.indexOf('\n// Emergency', i));
  assert.equal(/if \(!live\.length\) return null;/.test(fn), false,
    'the Today card still hides itself when nobody has asked for help yet — the one moment somebody needs ' +
    'to ask');
  assert.match(fn, /if \(!s\.enabled\) return null;/,
    'it must still stay hidden for a church that has not switched care on');
});

test('M1 — Today says you are waiting for approval', () => {
  // Six members across four rounds looked at Today first and saw a normal, working app. The waiting page
  // itself is praised by everyone who reaches it — it just lives on one tab out of five.
  // Bridget, 74: "at a glance I'd have believed I was already in." Eunice put the tablet down.
  assert.match(TODAY, /joinState && ctx\.joinState\.isPending/,
    'Today never reads the pending state');
  assert.match(TODAY, /Waiting to be let in/,
    'Today does not say you are waiting');
});

test('C17 — the RSVP row states your answer and marks the pressed button', () => {
  const SERV = stripComments(readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8'));
  const i = SERV.indexOf('function svEventRsvpRow');
  // Slice to the function's end, not a fixed byte count — the explanatory comment pushed
  // aria-pressed past 1600 chars and the assertion failed on window size, not on the code.
  const fn = SERV.slice(i, SERV.indexOf('\nfunction ', i + 10));
  assert.match(fn, /aria-pressed=\{on\}/, 'the chosen button is not marked as pressed');
  assert.match(fn, /You’re going|You're going/, 'your answer is still never stated in words');
});

const FELLOW = stripComments(readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8'));

test('C1 — a request can name more than one kind of help', () => {
  // Verity needed a lift AND a shop. Tapping Rides then Errands kept only Errands — a single-value
  // useState — so she sent two separate requests for one situation, and the care team triaged them as two.
  const i = TODAY.indexOf('function AskForHelpForm');
  assert.ok(i > 0, 'AskForHelpForm not found');
  const form = TODAY.slice(i, TODAY.indexOf('\nfunction ', i + 10));
  assert.equal(/const \[type, setType\] = React\.useState\(''\)/.test(form), false,
    'what would help is still a single string, so a second tap replaces the first');
  assert.match(form, /types/, 'the form does not carry a list of kinds');
});

test('C1 — the wire body carries every kind chosen, and type still holds the first', () => {
  // `type` is what every existing reader keys off — the row labels, the icon, the need the care team opens.
  // It must keep meaning what it meant, or older builds read "other" for a request they can see the note of.
  const i = FELLOW.indexOf('async publishCareRequest');
  const body = FELLOW.slice(i, FELLOW.indexOf('const keyBytes', i));
  assert.match(body, /types:/, 'the published body drops every kind after the first');
  assert.match(body, /type: /, 'the published body no longer carries `type`, which older readers require');
});

const LIBSRC = stripComments(readFileSync(new URL('../app/screens-library.jsx', import.meta.url), 'utf8'));
const WATCH  = stripComments(readFileSync(new URL('../app/screens-watch.jsx', import.meta.url), 'utf8'));
const STEWD  = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('C2 — the tab holding audio sermons does not call itself Watch', () => {
  // St Wilfrid's uploaded an AUDIO sermon. It landed under a tab named "Watch", beside a "Listen" section
  // that holds only Audio Bibles. Nobody looking for a sermon to listen to would open Watch.
  const i = LIBSRC.indexOf("['watch',");
  assert.ok(i > 0, 'the segmented control was not found');
  const seg = LIBSRC.slice(i, i + 60);
  assert.equal(/'watch', 'Watch'/.test(seg), false, 'the tab is still called Watch alone');
});

test('C2 — an audio-only church still gets its sermons labelled as audio', () => {
  // The Listen/Watch sub-heads were gated on bothTypes, so a church with only audio — the exact case that
  // was reported — saw no "Listen" anywhere.
  assert.equal(/bothTypes \?/.test(WATCH), false,
    'the sub-heads are still conditional on the church having both kinds');
});

test('C3 — an upload is not published under its file name', () => {
  // "sermon-the-good-shepherd" was the title members saw. Verity and Desmond both read it as a broken entry.
  assert.equal(/publishSermon\(\{ title: f\.name\.replace/.test(STEWD), false,
    'the file name is still what gets published as the title');
});

test('C3 — the steward is asked to name it, and the ask is what starts the upload', () => {
  // Also C4's symptom: picking a file started a silent background upload, so Miriam picked the file again.
  // A modal in front of you cannot be mistaken for nothing having happened.
  assert.match(STEWD, /pendingUpload|SermonDetailsModal/,
    'nothing stands between choosing a file and the upload beginning');
});

test('C4 — the same bytes do not become a second sermon', () => {
  // Miriam's one upload left TWO sermon docs on the relay pointing at one blob. The blob store is
  // content-addressed, so it deduped itself; only the DOC was minted twice, under a fresh id each time.
  const i = STEWD.indexOf('const doUpload');
  const fn = STEWD.slice(i, STEWD.indexOf('const fmtSize', i));
  assert.match(fn, /sha256 === b\.sha256|dupe/,
    'nothing checks whether this exact file is already published');
});

test('C4 — the encrypted case is warned about, not silently missed', () => {
  // Encryption uses a fresh nonce, so the same sermon encrypts to different bytes and a sha check CANNOT
  // see it. The file's own identity can, and it never leaves the console.
  assert.match(STEWD, /lastModified/,
    'no check covers the encrypted path, where the sha differs every time');
});

test('C3 — the speaker and date reach the member, not just the console', () => {
  // Half of what was asked for. A title alone still leaves "who preached it, and when?" unanswered, and the
  // details typed at upload were only ever shown under a VIDEO.
  const i = WATCH.indexOf('function SermonRow');
  const row = WATCH.slice(i, WATCH.indexOf('\nfunction ', i + 10));
  assert.match(row, /s\.desc/, 'the row never shows the details the steward typed');
});

test('C8 — a queue of join requests can be admitted in one action', () => {
  // Miriam pressed Approve eighteen times to open a church. setAdmitted takes the whole list, so admitting
  // one at a time was eighteen round trips for one decision.
  assert.match(STEWD, /admitAll|confirmAdmitAll/, 'there is still no way to admit more than one person at a time');
});

test('C8 — admitting everyone still shows the steward who they are', () => {
  // Only a steward at an unlocked console admits anyone (decided 2026-08-18). A bulk button that hides the
  // names would keep the letter of that and lose the point of it.
  const i = STEWD.indexOf('confirmAdmitAll');
  assert.ok(i > 0, 'no confirm step');
  assert.match(STEWD.slice(i - 3000, i + 3000), /pendingJoins\.map|names/,
    'the confirm never names the people being let in');
});

const IDENT = stripComments(readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8'));

test('CHECK-IN — a parent is told WHO does it and WHERE', () => {
  // Aisha's complaint was never "let me do it". It was: nothing told her whether check-in is something she
  // does, something a leader does at the door, or something that happens in the app. The one sentence a
  // parent ever sees — "you can collect them at check-in" — answers none of that.
  const i = IDENT.indexOf('collect them at check-in');
  assert.equal(i, -1, 'the parent-facing sentence still leaves check-in unexplained');
});

test('CHECK-IN — the console says it is a door operation, on the church’s device', () => {
  // Records are sealed to the church key, so a parent's app could not decrypt a pickup code even if we built
  // one. The fix is to say so, not to build a surface that cannot work.
  const panel = fnBody(STEWD, 'function DashCheckin');
  assert.match(panel, /at the door|on this device, at the door|door/i,
    'nothing on the check-in screen says where or by whom this is done');
});

test('M2 — a member who never set a name is told they appear as Anonymous', () => {
  // Ada made the choice by accident during joining and recovered only by hunting through You. "Continue
  // without a name" stays — anonymity is an option — but the state it leaves you in must be visible.
  assert.match(IDENT.replace(/<\/?b>/g, ''), /You appear as Anonymous to everyone in your church/,
    'nothing anywhere shows a nameless member how they appear to the church');
  // and it must be fixable where it is stated — hunting is what went wrong the first time.
  const i = IDENT.indexOf('You appear as');
  assert.match(IDENT.slice(i - 1400, i), /setEdit\(true\)/,
    'the notice states the problem without offering the fix');
});
