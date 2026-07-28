// A parent must be told a way to hand a child's account over that actually exists.
// Run: node --test scripts/child-handoff.test.mjs
//
// Reported 2026-07-28 while creating a child account — a path nothing had walked. The reveal screen said
// "open TrinityOne's camera and scan this". A fresh install has no such camera, and never did: the only
// scanner it offers belongs to device TRANSFER, which expects a live mutually-verified exchange with another
// running phone. So the child's phone sat showing its own code, waiting for a partner that never came, and
// the parent reasonably concluded there was no way in.
//
// The intended route was always the phone's OWN camera — the code is a link carrying the seed in its
// fragment. Two things are asserted here: that we no longer name a camera we do not have, and that the 12
// words are offered as an equal route, because a child WITH the app installed cannot use the link (it opens
// the browser, since the invite lives at "/" and only "/join" is claimed — and /join deliberately refuses an
// invite, because an invite replaces the device identity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
const reveal = (() => {
  const at = ID.indexOf('HAND IT TO THE CHILD');
  assert.notEqual(at, -1, 'the child hand-off screen is gone');
  const end = ID.indexOf('</React.Fragment>', at);
  // strip comments: the note explaining the fix quotes the old wording, and matching prose rather than
  // rendered text is how a correct fix gets reported as broken. It has happened four times this week.
  return ID.slice(at, end)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
})();

test('it no longer points the parent at a camera the app does not have', () => {
  assert.doesNotMatch(reveal, /TrinityOne’s camera|TrinityOne's camera/,
    'the screen still tells a parent to scan with an in-app camera that does not exist on a fresh install');
});

test('it names the camera that will actually work', () => {
  assert.match(reveal, /normal camera app/i,
    'nothing tells the parent which camera to use, which is the whole reason the route looked broken');
});

test('the 12 words are offered as a real alternative, not a footnote', () => {
  // The link route lands in the BROWSER. A child who already installed the app needs the words.
  assert.match(reveal, /12 words/, 'the words are not offered, so a child with the app installed has no route');
  assert.match(reveal, /used it before/i,
    'the words route must name the buttons the child will actually see, or a parent has to guess');
});
