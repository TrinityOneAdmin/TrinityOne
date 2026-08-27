// A DELEGATED STEWARD'S CONSOLE MUST COME BACK TO THE CHURCH IT WAS RUNNING.
// Run: node --test scripts/console-remembers-its-church.test.mjs
//
// "Help run a church" gives you a console of your own — your own empty church, with an invite poster, a join
// link and a warning that anyone with the link can walk in. Being approved as a steward of a REAL church does
// not move you across; a switcher does, and nothing persisted the choice.
//
// SIMULATION ROUND 9. The churchwarden was approved, reloaded, and landed back in his own empty church with
// no sign anything had happened. His rota page said "Build your first team" while St Aidan's already had
// four. So he built his own, in good faith, and published a rota for a Sunday that already had one — which
// is what put two competing rotas on one service and wiped ten real people off every phone in the parish.
// In his words: "every page refresh throws me back into my own empty church, and I have to find the switcher
// again." The collision was the visible damage; this is the reason it happened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const S = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const V = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

test('choosing a church writes the choice down', () => {
  const body = stripComments(fnBody(S, 'setActiveIdentity(targetPub)', 'setActiveIdentity'));
  assert.match(body, /localStorage\.setItem\(ACTIVE_ID_KEY/,
    'the console still forgets which church it is running the moment the page reloads');
  // …and it must be written for EVERY branch, including going back to your own church, or the old choice
  // lingers and drags you back into a church you deliberately left.
  const at = body.indexOf('ACTIVE_ID_KEY');
  const firstBranch = body.indexOf('if (tp === churchPub)');
  assert.ok(at !== -1 && firstBranch !== -1 && at < firstBranch,
    'the choice is only recorded on some branches — switching back to your own church would not stick');
});

test('and the console goes back there on boot', () => {
  const body = stripComments(fnBody(S, 'subscribeStewardedChurches(cb)', 'subscribeStewardedChurches'));
  assert.match(body, /localStorage\.getItem\(ACTIVE_ID_KEY\)/,
    'nothing reads the remembered church back, so writing it down achieves nothing');
  assert.match(body, /setActiveIdentity\(want\)/, 'the remembered church is read but never entered');
});

test('it refuses a church we do not steward', () => {
  // A stale or tampered entry must not put the console into a church it has no business in. The switch
  // itself would refuse, but failing earlier and quietly is better than relying on that.
  const body = stripComments(fnBody(S, 'subscribeStewardedChurches(cb)', 'subscribeStewardedChurches'));
  assert.match(body, /stewardedChurches\.has\(want\)/, 'a stale remembered church is entered without checking');
});

test('it never hijacks a church this console actually HOLDS', () => {
  // The ordinary owner case. A vicar's own console must not be switched anywhere by this.
  const body = stripComments(fnBody(S, 'subscribeStewardedChurches(cb)', 'subscribeStewardedChurches'));
  assert.match(body, /!_ownedPubs\.has\(want\)/, 'an owner’s console can be redirected by a remembered value');
  assert.match(body, /want !== churchPub/, 'the console can be told to switch to the church it already is');
});

test('and it does not switch when already there', () => {
  const body = stripComments(fnBody(S, 'subscribeStewardedChurches(cb)', 'subscribeStewardedChurches'));
  assert.match(body, /actingChurch !== want/,
    're-entering the church we are already in resets profile state and re-subscribes for nothing');
});

test('the shipped console carries all of this', () => {
  // The console loads app/*.jsx raw but src/steward.src.js is bundled — a fix that never got built is not a fix.
  assert.match(stripComments(V), /ACTIVE_ID_KEY/, 'vendor/steward.js was not rebuilt from source');
});
