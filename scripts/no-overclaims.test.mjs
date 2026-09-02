// THE PRODUCT DOES NOT CLAIM MORE THAN IT DOES.
// Run: node --test scripts/no-overclaims.test.mjs
//
// Two claims that members read as untrue, found by starting a round at the website (round 11, 2026-08-22).
//
// 1. "Tap it and you're in — no forms, no password, nothing to remember."
//    Femi, asked to vet it before it went to the congregation: "It isn't — a steward has to let you in, and
//    the app itself says that can take up to a day. Someone tapping a link during a service will be sat
//    there waiting." FOUR members sat waiting for approval in that round. And "nothing to remember" is the
//    opposite of true: the twelve words are the one thing a member MUST keep, and Bridget, 74, nearly gave
//    up over exactly that screen.
//
// 2. "Your money is always held as Bitcoin (in 'sats')."
//    Three members read this and two were unsettled by it. Colin: "if the PCC is told that, there will be a
//    conversation." Tomasz: "I do not give money through the app. That sentence made me uneasy for no
//    reason." Femi: "I have no wallet and couldn't find any giving in the app at all, so that line lands
//    oddly."
//    It is also WRONG about the product: giving is non-custodial by design — a member gives from their OWN
//    wallet straight to the church — and giving is switched off for the pilot entirely (givingOn = false).
//    So it announces custody of money that does not exist, to people who cannot give.
//
// The honesty of this product is the thing every single agent has praised. These two lines spend that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const site   = readFileSync(new URL('../welcome.html', import.meta.url), 'utf8');
const extras = readFileSync(new URL('../app/screens-extras.jsx', import.meta.url), 'utf8');
// THE RULE DOCUMENTS ARE PART OF THE PRODUCT'S HONESTY TOO. A future session is told to trust these two
// before touching any relay list, so a stale rule in them is more dangerous than a stale comment in code:
// it is the thing someone reads INSTEAD of the code. Both said "one of three roots" for a day after
// `proveRelay()` stopped requiring a root at all (`src/relay-net.src.js:260` returns `{root:'software'}`
// on its own). Round 7 found the divergence; this keeps it found.
const admission = readFileSync(new URL('../reference/RELAY-ADMISSION.md', import.meta.url), 'utf8');
const rules     = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');

test('the site does not promise you are in the moment you tap', () => {
  assert.equal(/nothing to remember/.test(site), false,
    '"nothing to remember" — the twelve words are precisely something to remember, and losing them is ' +
    'unrecoverable');
  if (/Tap it and you/.test(site)) {
    assert.match(site, /steward|approve|let you in/i,
      'the joining claim must acknowledge that a church may hold you for approval — four members sat ' +
      'waiting in round 11 having been told they were in');
  }
});

// 3. "Free to use, with help on hand whenever you need it." — and, in the same block, "we'll be alongside
//    you the whole way." Owner, 2026-09-01: "we don't have capacity to offer support for churches, we do
//    have tutorials and a help section, but no support." Both sentences promise a PERSON. What exists is
//    written: help.html, the in-app help screens, and the move-over guide. A church under pressure choosing
//    whether to trust this with its congregation's data must not be choosing on a promise nobody can keep.
test('the site does not promise support that does not exist', () => {
  assert.equal(/help on hand/i.test(site), false,
    '"help on hand" promises a person to call. There is no support capacity — only written guides');
  assert.equal(/alongside you the whole way/i.test(site), false,
    '"alongside you the whole way" is the same promise in warmer words');
  assert.equal(/(we|our team) (will |'ll )?(be )?(here|there) (to help|for you|whenever)/i.test(site), false,
    'any phrasing that offers a person rather than a written guide');
});

test('the app does not claim to hold anyone’s money', () => {
  assert.equal(/money is always held as Bitcoin/.test(extras), false,
    'the currency screen announces custody of the member\'s money. Giving is non-custodial by design and ' +
    'switched off for the pilot, so this is untrue twice over');
});

test('the rule documents describe the admission rule the code actually has', () => {
  // Prove-it-fails note: at 50e196c both files contained this string —
  //   git show 50e196c:CLAUDE.md | grep -c 'one of three roots'                  -> 1
  //   git show 50e196c:reference/RELAY-ADMISSION.md | grep -c 'one of three roots' -> 2
  // so this assertion fails against the unfixed tree, which is the only reason it is worth having.
  assert.equal(/one of three roots/i.test(rules), false,
    'CLAUDE.md rule 10 still requires "one of three roots". proveRelay() admits on the software proof ' +
    'alone — a session following that rule looks for a root match the code no longer requires');
  assert.equal(/one of three roots/i.test(admission), false,
    'RELAY-ADMISSION.md still states the three-root invariant that the code no longer implements');
  // and the boundary must not be described as wider than it is
  assert.match(admission, /same address|proxy at the/i,
    'RELAY-ADMISSION.md must say plainly that a proxy at the SAME address is not refused — the previous ' +
    'wording implied the binding closed that case, and it never did');
});
