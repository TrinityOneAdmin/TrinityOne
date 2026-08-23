// A CODE THAT ONLY THE CLIPBOARD CAN CARRY IS NOT A CODE TWO PEOPLE CAN EXCHANGE.
// Run: node --test scripts/steward-code-is-readable.test.mjs
//
// Round 7, R7-22. Two actors walked the handoff that makes someone a steward: the helper shows her code, the
// vicar types it into his console. It could not be done, and the walk stopped there.
//
// Measured in the DOM, not merely observed on screen: every occurrence of the code was elided —
// `npub1ttpk5wj59j5zj…`, `npub1ttpk5wj59…p4r0ud` — and no occurrence anywhere was ever the full string.
// Sidebar, code card, and the Show-QR screen all truncated. So the code could travel by CLIPBOARD (same
// device) or QR (same room, with a camera), and by no other route at all.
//
// A vicar at the church computer and a volunteer at home on the phone is the ordinary case, not an edge one.
// There was no way to read it aloud, write it on paper, or put it in an email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const DATA = stripComments(readFileSync(new URL('../app/stew-data.jsx', import.meta.url), 'utf8'));
const ROOT = stripComments(readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8'));

const skKey = DATA.slice(DATA.indexOf('function SkKey('), DATA.indexOf('function SkKey(') + 2200);

test('the steward code card can show the whole value', () => {
  assert.ok(skKey.length > 100, 're-anchor: SkKey is gone from stew-data.jsx');
  assert.match(skKey, /useState\(false\)[\s\S]{0,400}?full/,
    'SkKey has no way to reveal the full value, so the only routes out are the clipboard and a QR code');
  assert.match(skKey, /\{full \? value : short\}/,
    'the element still renders the shortened form unconditionally — nothing shows the full string');
});

test('the revealed value wraps and can be selected, so it can be read out or copied by hand', () => {
  assert.match(skKey, /wordBreak: 'break-all'/,
    'the full value does not wrap, so on any narrow console it is still cut off — which is the same defect ' +
    'wearing a different hat');
  assert.match(skKey, /userSelect: 'text'/, 'the revealed value cannot be selected, so it cannot be copied by hand');
});

test('the reveal control has an accessible name', () => {
  // The chat room taught this the expensive way the same night: an icon-only control with no name is
  // invisible to a screen reader AND to every automated actor, which is how a round loses a whole test.
  assert.match(skKey, /aria-label=\{full \?/,
    'the reveal control has no accessible name, so a screen-reader user cannot find the way to the full code');
  assert.match(skKey, /Show the full/, 're-anchor: the reveal wording changed');
});

test('the steward-code screen still renders through SkKey', () => {
  // If this screen ever stops using SkKey, everything above stops guarding the thing it was written for.
  assert.match(ROOT, /<SkKey value=\{npub \|\| '—'\} label="your steward code" \/>/,
    're-anchor: the "Help run a church" screen no longer shows the code through SkKey, so the reveal added ' +
    'for R7-22 may not be on the screen where the handoff actually happens');
});
