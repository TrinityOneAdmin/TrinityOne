// "I'M AWAY" MUST SURVIVE, SHOW ITSELF, AND ADMIT WHEN IT FAILED.
// Run: node --test scripts/unavail-roundtrip.test.mjs
//
// Three defects on one sheet, all found on 2026-08-18, all in the same family — a control that cannot be
// trusted about its own outcome:
//
//  1. IT NEVER LOADED WHAT YOU ALREADY SAID. `useSvE(() => { if (open) setSel([]); }, [open])` blanked the
//     selection every time the sheet opened, and the document is addressable — each save REPLACES the array.
//     So a member who marked 13 + 27 Sep, reopened the sheet (blank), ticked 20 Sep and pressed "Mark 1 away"
//     silently destroyed the two dates they had already given. Verified in the store. It also means there is
//     no way to CANCEL an unavailability: you cannot untick what is never shown.
//  2. IT TOASTED BEFORE IT PUBLISHED. The handler called setUnavailableDates(sel), toasted "Marked N away"
//     and closed — synchronously, never awaiting. `setUnavailable` then swallowed its own failure
//     (`try { await _publishAny(...) } catch {}`), and ctx.setUnavailableDates dropped the promise too.
//  3. SO A REFUSED WRITE LOOKED IDENTICAL TO A SAVED ONE. Three members marked themselves away while still
//     pending approval; the relay correctly refused all three ("not a member"), the app said nothing, and for
//     two of them the dates were never stored anywhere. Their leader will rota them onto days they refused.
//
// The point of this test is the ROUND TRIP: what you save comes back, and what fails says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const SERV = stripComments(readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8'));
const FEL  = stripComments(readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8'));
const APP  = stripComments(readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8'));

// Slice to the END of the function, not a fixed width: a magic number stops covering its target the moment
// the function grows, and this repo has a test (test-windows.test.mjs) whose whole job is catching that.
const _uStart = SERV.indexOf('function UnavailSheet(');
const _uEnd = SERV.indexOf('\nfunction ', _uStart + 10);
const sheet = SERV.slice(_uStart, _uEnd === -1 ? SERV.length : _uEnd);

test('re-anchor: the sheet is still here', () => {
  assert.ok(sheet.includes('When are you away?'), 'UnavailSheet has moved or been renamed');
});

test('opening the sheet LOADS the dates already given, instead of blanking them', () => {
  const openEffect = (sheet.match(/useSvE\(\(\) => \{ if \(open\)([^}]*)\}/) || [])[1] || '';
  assert.doesNotMatch(openEffect, /setSel\(\[\]\)\s*;?\s*$/,
    'the sheet still clears the selection on open — with a replace-on-save document that means marking one ' +
    'new date deletes every date given before it');
  assert.match(sheet, /ctx\.(getUnavailableDates|unavailableDates)/,
    'the sheet must read the member’s current unavailability so they can see and UNTICK it');
});

test('save AWAITS the publish and only then reports success', () => {
  const handler = (sheet.match(/onClick=\{(async[^]*?)\}\s*disabled=/) || [])[1] || '';
  assert.match(handler, /await/, 'the save handler must await the publish before it claims anything');
  const toastAt = handler.indexOf('ctx.toast');
  const awaitAt = handler.indexOf('await');
  assert.ok(awaitAt !== -1 && awaitAt < toastAt,
    'the success toast still fires before the publish resolves — that is what made a refused write look saved');
  assert.match(handler, /catch|ok|err/i, 'a failed publish must be handled, not swallowed');
});

test('the fellowship call reports failure instead of swallowing it', () => {
  const fn = FEL.slice(FEL.indexOf('async setUnavailable('), FEL.indexOf('async setUnavailable(') + 900);
  assert.doesNotMatch(fn, /catch \{\s*\}/,
    'setUnavailable still swallows its publish error — the caller cannot tell a refusal from a save');
  assert.match(fn, /throw|return\s+(false|null|\{)/,
    'it must give the caller something to test');
});

test('the ctx wrapper passes the promise through', () => {
  const wrap = APP.slice(APP.indexOf('setUnavailableDates:'), APP.indexOf('setUnavailableDates:') + 400);
  assert.match(wrap, /return\s+/,
    'ctx.setUnavailableDates dropped the promise, so even an awaited handler could not see the outcome');
});
