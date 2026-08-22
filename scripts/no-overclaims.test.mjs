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

test('the app does not claim to hold anyone’s money', () => {
  assert.equal(/money is always held as Bitcoin/.test(extras), false,
    'the currency screen announces custody of the member\'s money. Giving is non-custodial by design and ' +
    'switched off for the pilot, so this is untrue twice over');
});
