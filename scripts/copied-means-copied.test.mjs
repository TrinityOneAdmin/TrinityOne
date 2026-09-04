// "COPIED" MUST MEAN COPIED, AND A WIZARD MUST NOT ASK YOU TO CONFIRM WORDS IT NEVER SHOWED YOU.
// Run: node --test scripts/copied-means-copied.test.mjs
//
// AUDIT 2026-09-02 #13 and #14. Both are about the twelve words, which are the account: lose them and there
// is no recovery, by design.
//
// #13 — every "Copy" control toasted its reassurance whether or not the clipboard write happened, and
// swallowed the failure. The worst is the child-account sheet: a parent reads "Recovery words copied —
// store them safely", closes it, and finds an empty clipboard. Those words are shown once.
//
// #14 — the secure store can answer empty for a moment after boot, so the wizard retries twelve times. When
// the retries ran out the screen said "Preparing…" for ever WITH THE TICK-BOX AND CONTINUE STILL ENABLED,
// so a member could confirm they had written down words they had never seen and land on a check screen with
// nothing to check. The real cause is SecureStorage deferring on a sleeping screen — exactly what happens
// when somebody puts the phone down mid-onboarding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const IDENT = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
const EXTRAS = readFileSync(new URL('../app/identity-extras.jsx', import.meta.url), 'utf8');

// Run the shipped copyPhrase against a clipboard that refuses, and one that is missing entirely.
function runCopyPhrase({ clipboard }) {
  const toasts = [];
  const body = fnBody(EXTRAS, 'const copyPhrase = () => {', 'copyPhrase');
  const fn = new Function('navigator', 'ctx', 'words',
    body + '\nreturn copyPhrase;')(
    { clipboard }, { toast: (t) => toasts.push(String(t)) }, ['w1', 'w2']);
  fn();
  return toasts;
}

test('a clipboard write that FAILS does not say the phrase was copied', async () => {
  const toasts = runCopyPhrase({ clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(toasts.some(t => /copied/i.test(t) && !/couldn/i.test(t)), false,
    'the app said the recovery phrase was copied when the write was refused. Those words ARE the account; ' +
    'a member who trusts that and closes the sheet has nothing');
  assert.ok(toasts.some(t => /write (them|the words) down/i.test(t)),
    'having failed, it must say what to do instead — writing them down is the whole point of the screen');
});

test('a phone with NO clipboard says so instead of claiming success', async () => {
  const toasts = runCopyPhrase({ clipboard: undefined });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(toasts.some(t => /^Phrase copied/i.test(t)), false,
    'with no clipboard at all the app still reported the phrase copied');
  assert.ok(toasts.length, 'the control did nothing and said nothing');
});

test('CONTROL: a clipboard write that SUCCEEDS still says so', async () => {
  const toasts = runCopyPhrase({ clipboard: { writeText: () => Promise.resolve() } });
  await new Promise(r => setTimeout(r, 5));
  assert.ok(toasts.some(t => /copied/i.test(t)),
    'a successful copy stopped confirming itself — the member is left unsure whether it worked');
});

test('the child-account sheet does not toast "copied" before the write resolves', () => {
  // That sheet shows a child's twelve words ONCE. Slice the handler and check the reassurance is inside a
  // .then rather than sitting beside a fire-and-forget write.
  const i = IDENT.indexOf('Recovery words copied');
  assert.ok(i > 0, 'the child-account copy control has moved — re-anchor this test');
  const around = stripComments(IDENT.slice(Math.max(0, i - 700), i + 200));
  assert.match(around, /\.then\(\s*\(\)\s*=>\s*ctx\.toast\('Recovery words copied/,
    'the child-account sheet still announces "Recovery words copied" without waiting for the clipboard. ' +
    'Those words are shown once and cannot be recovered');
  assert.match(around, /catch\(\s*\(\)\s*=>\s*ctx\.toast\(/,
    'a refused copy on that sheet is still swallowed, so the parent is told nothing at all');
});

test('the wizard cannot continue past words it never produced', () => {
  const src = stripComments(IDENT);
  const i = src.indexOf("onClick={() => setStep(2)}");
  assert.ok(i > 0, 'the back-up step\'s Continue has moved — re-anchor this test');
  const btn = src.slice(i, i + 260);
  assert.match(btn, /disabled=\{!ack \|\| words\.length < 12\}/,
    'Continue is enabled while the phrase is still "Preparing…", so a member can confirm they wrote down ' +
    'words they were never shown and reach a check screen with nothing to check');
});

test('…and it says so rather than sitting on "Preparing…" for ever', () => {
  const src = stripComments(IDENT);
  assert.match(src, /hasn’t produced your words yet/,
    'when the twelve retries run out the wizard still shows no error at all');
  assert.match(src, /do not skip this step/i,
    'the message does not tell the member the one thing that matters: not to skip it');
});
