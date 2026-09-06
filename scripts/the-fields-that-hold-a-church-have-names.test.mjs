// THE CONTROLS THAT DECIDE WHETHER A CHURCH SURVIVES MUST BE ANNOUNCEABLE.
// Run: node --test scripts/the-fields-that-hold-a-church-have-names.test.mjs
//
// Measured live on 2026-09-04 — console in a browser, and the shipping APK on an Oppo — not read off source:
//
//   recovery-phrase quiz, console : labels:0  aria-label:null  aria-labelledby:null  placeholder:""  id:""
//   recovery-phrase quiz, phone   : labels:0  aria-label:null  and all THREE share placeholder "type it here",
//                                   so a screen reader announces the same name three times and cannot say
//                                   which word is wanted
//   message "…" moderation menu   : 21px wide, innerText "", aria-label null — the only route to Remove/Pin
//   bank-import column selects    : labels:0 on all four, on the screen that decides which column is money
//   "Restore a church" textarea   : labels:0 — the field that takes the church's twelve words
//
// The a11y sweep that named nine PIN fields (d5cd066) was scoped to `type="password"` and its test sweeps
// for password inputs, so none of these were in range. They are not passwords; they are the church.
//
// WHAT THIS TEST IS WORTH, stated plainly (rule 3): app/*.jsx ships UNBUNDLED, so `false && ` in front of a
// condition leaves every word in place and a text assertion still passes. These assertions catch a name
// being DELETED — the likely regression — and cannot catch one being disabled. The live DOM measurements
// above are the real evidence; this is the guard that stops them silently regressing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const near = (src, anchor, span) => { const i = src.indexOf(anchor); assert.notEqual(i, -1, anchor + ' is gone — re-anchor'); return src.slice(i, i + span); };

test('the console recovery-phrase quiz names each box by the word it wants', () => {
  const s = read('app/stew-dashboard.jsx');
  const w = near(s, 'Quick check — type these three from your written list', 1400);
  assert.match(w, /aria-label=\{'Word ' \+ \(pos \+ 1\)/,
    'the three answer boxes announce as unnamed edit fields, on the one screen where a wrong answer loses ' +
    'the church key — and the step is unskippable (canContinue requires saved && verified)');
});

test('the member recovery-phrase quiz associates its label, and does not name all three the same', () => {
  const s = read('app/identity.jsx');
  // Anchor on the block, not on the caption: htmlFor sits BEFORE the caption text, so a window opening at
  // it looks the wrong way and reports a present fix as missing.
  const w = near(s, 'checkIdx.map((idx, i) =>', 1400);
  assert.match(w, /htmlFor=\{'recovery-word-' \+ idx\}/, 'the <label> has no htmlFor, so it associates with nothing');
  assert.match(w, /id=\{'recovery-word-' \+ idx\}/, 'the input has no id for the label to point at');
});

test('the message moderation menu can be announced', () => {
  const s = read('app/stew-dashboard.jsx');
  const w = near(s, "setMenuFor(v => v === m.id ? '' : m.id)", 500);
  assert.match(w, /aria-label=/, 'the only route to Remove and Pin is an unnamed 21px button');
});

test('every bank-import column select says which column it is', () => {
  const s = read('app/stew-finance.jsx');
  assert.match(near(s, 'const colSelect =', 400), /aria-label=\{label\}/, 'colSelect dropped its name');
  const names = (s.match(/Which column holds/g) || []).length;
  assert.equal(names, 5, `expected all five colSelect call sites to pass a name, found ${names}`);
});

test('the field that takes a church\'s twelve words has a name', () => {
  const s = read('app/steward-root.jsx');
  assert.match(near(s, 'word one  word two  word three', 400).slice(0, 400) + near(s, 'setPhrase(e.target.value)', 400),
    /aria-label="Your church's 12-word recovery phrase"/, 'the restore textarea announces as an unnamed edit field');
});

// ── F6: a subscription that cannot survive a reconnect ────────────────────────────────────────────────
// Measured 2026-09-04: with the relay stopped mid-operation and restarted, the console showed a care request
// as STILL needing "Set up help" while simultaneously showing the need it had already created from it. The
// relay held the carereqstatus that closed it; only a reload cured the screen. A steward reading that sets
// the same help up twice. The Overview banner beside it already carried _ovConn for exactly this reason.
test('the console care list re-subscribes when the relay comes back', () => {
  const s = read('app/stew-meals.jsx');
  const w = near(s, 'subscribeCareRequests(list => setReqs', 400);
  assert.match(w, /\[church\.npub, _careConn\]/,
    'the care list is subscribed once and never again, so a socket that dropped and returned leaves it ' +
    'frozen — showing work as outstanding that the relay already records as done');
});

test('the member care lists re-subscribe too', () => {
  const s = read('app/screens-today.jsx');
  const deps = (s.match(/ctx\.connTick\]/g) || []).length;
  assert.ok(deps >= 2, `both care subscriptions should re-run on a reconnect; found ${deps} that do`);
});
