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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from './test-slice.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));

// THE SUBJECT OF THIS FILE IS NOT IN THE REPOSITORY. Commit 1a79a27 took the simulation out — it carried 36
// private keys — so `scripts/sim*.mjs` is gitignored and `sim-actor.mjs` exists only on a machine that has
// the sim tooling. These tests still earn their place there: they are the guard that stopped three "console
// freezes" being filed as product defects. But on a clean checkout, or in CI, their subject is absent, and a
// test that fails because the thing it examines was deliberately removed is noise that hides real failures.
// So SKIP with the reason stated, and never fail. Skipping is also why the driver sweep below is guarded:
// with no drivers on disk the loop asserts nothing and reports a confident green, which is worse than a
// failure — it is the vacuous pass this repo has been bitten by before.
const ACTOR = 'sim-actor.mjs';
const haveActor = existsSync(DIR + ACTOR);
const noActor = haveActor ? false : ACTOR + ' is not in the repository (commit 1a79a27, it carried private keys) — nothing to examine';

const drivers = readdirSync(DIR)
  .filter(f => /^(sim-|cdp).*\.mjs$/.test(f) && !f.endsWith('.test.mjs'))
  // Comments are stripped before matching: the explanation above names every one of these methods, and this
  // repo has already shipped an assertion that was satisfied by the comment describing the rule.
  .map(f => ({ f, src: stripComments(readFileSync(DIR + f, 'utf8')) }))
  .filter(x => x.src.includes('Page.enable'));

test('every driver that enables the Page domain also handles dialogs',
  { skip: drivers.length ? false : 'no sim drivers on disk — see the note above' }, () => {
  assert.ok(drivers.length >= 3, `only ${drivers.length} drivers found — has this file moved?`);
  for (const { f, src } of drivers) {
    assert.match(src, /Page\.javascriptDialogOpening/,
      `${f} enables the Page domain but never listens for a dialog. A single window.confirm() reached by an ` +
      'actor kills that browser for the rest of the round, and the round reports it as the app freezing.');
    assert.match(src, /Page\.handleJavaScriptDialog/,
      `${f} notices a dialog but never answers it, which parks the renderer exactly the same way`);
  }
});

test('the actor SAYS what it agreed to on the actor\'s behalf', { skip: noActor }, () => {
  const src = stripComments(readFileSync(DIR + 'sim-actor.mjs', 'utf8'));
  assert.match(src, /dialogs\.push/, 'the actor answers dialogs silently — a report can then claim a destructive ' +
    'action was never confirmed, and nobody can see what the harness consented to');
  assert.match(src, /the app asked, and I answered/, 'nothing is printed, so the consent never reaches the log');
});

test('a prompt with no answer is cancelled, not answered with nothing', { skip: noActor }, () => {
  const src = stripComments(readFileSync(DIR + 'sim-actor.mjs', 'utf8'));
  assert.match(src, /accept:\s*false|\{\s*accept\s*\}/,
    'the actor can only ever accept, so window.prompt("New fund name") creates a fund with no name');
});

test('a driver notices an instance that is ALREADY parked instead of hanging on it', { skip: noActor }, () => {
  const src = stripComments(readFileSync(DIR + 'sim-actor.mjs', 'utf8'));
  assert.match(src, /Promise\.race/, 'no timeout anywhere: against a parked instance every command hangs with no output');
  assert.match(src, /Page\.navigate/, 'nothing recovers a parked instance, so one abandoned dialog ends that actor\'s round');
});
