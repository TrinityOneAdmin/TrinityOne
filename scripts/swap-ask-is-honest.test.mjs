// THE APP MUST NOT SAY IT ASKED SOMEONE IT CANNOT REACH.
// Run: node --test scripts/swap-ask-is-honest.test.mjs
//
// A rota roster row is `{ id, name, pub }`, and `pub` is empty for anyone a steward typed in by hand instead
// of linking to their app account — a deliberate, useful capability, because a parish rota carries the
// organist who will never install anything.
//
// But SwapSheet offered those people as swap targets and toasted "Asked Colin to swap". The reply it sends
// carries `swapTo: ''` for them (fellowship.src.js, respondToServingRequest), which is byte-for-byte the same
// document as the "ask my leader" path. Colin is never contacted, never knows, and the member believes cover
// is arranged. The sheet's own copy promised "They'll get a friendly ask."
//
// Found during the audit of 2026-08-18, not by the simulation — a whole family of these lives wherever an
// unlinked name is treated as a person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stripComments } from './test-slice.mjs';

const cut = (src) => {
  const a = src.indexOf('ON YOUR TEAM');
  const b = src.indexOf('Ask my leader for a swap', a);
  return src.slice(a, b === -1 ? a + 4000 : b);
};
const NOW = cut(stripComments(readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8')));

test('re-anchor: the swap sheet is still here', () => {
  assert.ok(NOW.length > 200 && NOW.includes('doAsk('), 'SwapSheet has moved');
});

test('an unlinked teammate is labelled as unreachable', () => {
  assert.match(NOW, /p\.pub \?/,
    'every teammate row reads the same regardless of whether they have an account — an unlinked name looks ' +
    'exactly like someone the app can contact');
  assert.match(NOW, /[Nn]ot on the app/, 'and it must say so in words the member understands');
});

test('the confirmation does not claim to have asked someone unreachable', () => {
  const handler = (NOW.match(/onClick=\{\(\) => pick && doAsk\(([^]*?)\)\}/) || [])[1] || '';
  assert.ok(handler, 're-anchor: the ask button handler has changed shape');
  assert.match(handler, /pick\.pub \?/,
    'the toast still says "Asked <name> to swap" for a person the request never reaches — swapTo:"" sends it ' +
    'to the leader, so the named teammate hears nothing');
});

// PROVE THIS GOES RED AGAINST THE CODE THAT SHIPPED. A test written after a fix is worthless unless it would
// have caught the bug; this reads the committed version straight out of git and asserts it fails.
test('the pre-fix source would have failed these assertions', () => {
  let old = '';
  try { old = execFileSync('git', ['show', 'HEAD:app/screens-serving.jsx'], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }); }
  catch (e) { return; }   // no git (sabotage sandbox) — skip rather than fail for an unrelated reason
  const OLD = cut(stripComments(old));
  assert.doesNotMatch(OLD, /[Nn]ot on the app/,
    're-anchor: the shipped version already had this label, so this test is not proving what it claims');
  const oldHandler = (OLD.match(/onClick=\{\(\) => pick && doAsk\(([^]*?)\)\}/) || [])[1] || '';
  assert.doesNotMatch(oldHandler, /pick\.pub \?/,
    're-anchor: the shipped handler already branched on pub');
});
