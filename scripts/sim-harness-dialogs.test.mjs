// A HARNESS THAT ENABLES THE PAGE DOMAIN MUST ANSWER THE PAGE'S DIALOGS.
// Run: node --test scripts/sim-harness-dialogs.test.mjs
//
// 2026-08-19. Three steward consoles "froze" during simulation rounds and the rounds recorded it as a product
// defect. It was this harness. Once a DevTools client enables the Page domain, Chrome stops auto-dismissing
// window.confirm()/prompt()/alert() and waits for THAT client to answer. Every driver here is one-shot: it
// taps a control and exits. So a tap on anything the console guards with a confirm — auto-fill ("Create
// weekly services for the next ~4 weeks…"), "Remove series", "Rotate…", close a care need, publish drafts,
// restore a church, leave a network — opened a dialog nobody ever answered.
//
// The renderer then parks inside the dialog's nested run loop: process alive, 0% CPU, Runtime.evaluate never
// returns, and Chrome has forgotten the dialog by the time you ask, so Page.handleJavaScriptDialog replies
// "No dialog is showing". Measured on the wedged browser, then reproduced from scratch on a blank page.
//
// The cost was not only the lost consoles. Every confirm-guarded control in the console — which is to say
// nearly every destructive or bulk action a steward performs — was unreachable to every round that has ever
// run, while the harness made it look as though the product died when a steward tried to use one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from './test-slice.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const drivers = readdirSync(DIR)
  .filter(f => /^(sim-|cdp).*\.mjs$/.test(f) && !f.endsWith('.test.mjs'))
  // Comments are stripped before matching: the explanation above names every one of these methods, and this
  // repo has already shipped an assertion that was satisfied by the comment describing the rule.
  .map(f => ({ f, src: stripComments(readFileSync(DIR + f, 'utf8')) }))
  .filter(x => x.src.includes('Page.enable'));

test('every driver that enables the Page domain also handles dialogs', () => {
  assert.ok(drivers.length >= 3, `only ${drivers.length} drivers found — has this file moved?`);
  for (const { f, src } of drivers) {
    assert.match(src, /Page\.javascriptDialogOpening/,
      `${f} enables the Page domain but never listens for a dialog. A single window.confirm() reached by an ` +
      'actor kills that browser for the rest of the round, and the round reports it as the app freezing.');
    assert.match(src, /Page\.handleJavaScriptDialog/,
      `${f} notices a dialog but never answers it, which parks the renderer exactly the same way`);
  }
});

test('the actor SAYS what it agreed to on the actor\'s behalf', () => {
  const src = stripComments(readFileSync(DIR + 'sim-actor.mjs', 'utf8'));
  assert.match(src, /dialogs\.push/, 'the actor answers dialogs silently — a report can then claim a destructive ' +
    'action was never confirmed, and nobody can see what the harness consented to');
  assert.match(src, /the app asked, and I answered/, 'nothing is printed, so the consent never reaches the log');
});

test('a prompt with no answer is cancelled, not answered with nothing', () => {
  const src = stripComments(readFileSync(DIR + 'sim-actor.mjs', 'utf8'));
  assert.match(src, /accept:\s*false|\{\s*accept\s*\}/,
    'the actor can only ever accept, so window.prompt("New fund name") creates a fund with no name');
});

test('a driver notices an instance that is ALREADY parked instead of hanging on it', () => {
  const src = stripComments(readFileSync(DIR + 'sim-actor.mjs', 'utf8'));
  assert.match(src, /Promise\.race/, 'no timeout anywhere: against a parked instance every command hangs with no output');
  assert.match(src, /Page\.navigate/, 'nothing recovers a parked instance, so one abandoned dialog ends that actor\'s round');
});
