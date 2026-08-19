// THE EASY ROUTE EXISTS. THE COPY SENDS PARENTS DOWN THE HARD ONE.
// Run: node --test scripts/child-handoff-route.test.mjs
//
// Creating a child account mints the child's key on the PARENT'S phone and shows a QR. What the parent is
// told to do with it, for a child who already has the app installed — the ordinary case when a church
// onboards a family — is:
//
//     "open it there instead and choose 'I've used it before' → 'I have my 12 words', then type the phrase"
//
// Twelve words, transcribed onto a second phone, in a church hall, with a child waiting. Meanwhile the app's
// restore screen has offered "Someone set this up for me" all along: a camera that reads the very code on the
// parent's screen and signs the child in without a word being typed. Nobody was told.
//
// The roadmap carried this as `child-qr-deadend`, whose original complaint ("open TrinityOne's camera" — no
// such camera exists on a fresh install) was fixed on 2026-07-28. This is what was left underneath it.
//
// The first test is the one that matters: it drives BOTH shipped functions and proves the recommended route
// actually works end to end, rather than asserting that some words appear on a screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const IDENTITY = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
const EXTRAS = readFileSync(new URL('../app/identity-extras.jsx', import.meta.url), 'utf8');

function lift(src, anchor, name, stubs) {
  const body = fnBody(src, anchor, name);
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
  });
  // A declaration (`const x = …`, `function x…`) cannot be wrapped in `return (…)` — it is a statement, and
  // the first draft of this file died on "Unexpected token 'const'". Emit it as one, then hand back the name.
  const decl = /^(const|let|var|function|async function)\b/.test(body.trim());
  const src2 = decl ? `with (scope) { ${body}\n; return ${name}; }` : `with (scope) { return (${body}); }`;
  return new Function('scope', src2)(scope);
}

const PHRASE = 'trim stadium message bicycle napkin bleak slow life wool total sand cost';

test('the code the parent shows IS a code the app can sign in from', () => {
  const inviteUrlFor = lift(EXTRAS, 'function inviteUrlFor(mnemonic, ctx) {', 'inviteUrlFor', {
    _inviteChurchNp: () => 'npub1example',
    _inviteRelay: () => 'wss://relay.example/relay',
    _inviteBase: () => 'https://app.trinityone.church',
  });
  const seedFromScan = lift(IDENTITY, 'const seedFromScan = (text) => {', 'seedFromScan', {});
  const url = inviteUrlFor(PHRASE, {});
  assert.match(url, /#invite=/, 're-anchor: the seed no longer travels in the fragment');
  assert.equal(seedFromScan(url), PHRASE,
    'the scanner on the restore screen cannot read the code the parent is showing, so "Someone set this up ' +
    'for me" is not a route for a child hand-off at all and the twelve words are the only way through');
});

test('and it refuses anything that is not one', () => {
  const seedFromScan = lift(IDENTITY, 'const seedFromScan = (text) => {', 'seedFromScan', {});
  assert.equal(seedFromScan('https://app.trinityone.church/?follow=npub1x'), '',
    'a church JOIN link reads as a sign-in seed, which would be an identity takeover from an ordinary invite');
  assert.equal(seedFromScan('WIFI:S=ChurchHall;T=WPA;P=hunter2;;'), '', 'a Wi-Fi code reads as a seed');
  assert.equal(seedFromScan('https://app.trinityone.church/#invite=only four words here'), '',
    'a link carrying something that is not a 12-word phrase is accepted as one');
});

test('the parent is pointed at the scan route, not told to transcribe twelve words', () => {
  const src = stripComments(IDENTITY);
  const i = src.indexOf('HAND IT TO THE CHILD’S DEVICE');
  assert.ok(i > 0, 're-anchor: the child hand-off section has moved');
  const block = src.slice(i, i + 2600);
  assert.match(block, /Someone set this up for me/,
    'a parent whose child has the app is still told to type twelve words onto the second phone, while the ' +
    'app can read the code already on screen. That is the moment this product should be at its easiest.');
  assert.doesNotMatch(block, /I have my 12 words[^]{0,80}type the phrase/,
    'the twelve-word transcription is still offered as the route for a phone that has the app');
});

test('the camera route stays, and stays honest about where it lands', () => {
  const src = stripComments(IDENTITY);
  const i = src.indexOf('HAND IT TO THE CHILD’S DEVICE');
  const block = src.slice(i, i + 2600);
  assert.match(block, /normal camera app/,
    'the route for a phone with no app yet has gone — that is the only one that works before installing');
  assert.match(block, /browser/,
    'the copy no longer says the camera route opens the browser rather than the app, which is the surprise ' +
    'the parent then has to make sense of on their own');
});
