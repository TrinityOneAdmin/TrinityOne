// A CONTROL MAY NOT THANK YOU FOR SOMETHING IT DID NOT DO.
// Run: node --test scripts/serving-response-honesty.test.mjs
//
// Found on a device, 2026-08-19, on the OPPO against a live relay. A member placed straight onto a published
// rota — no "can you serve?" request in flight, which is the ordinary case — opened their slot and tapped
// "I'm away — take me off". The app answered "Taken off — thanks for letting us know". The relay received
// ZERO events. Measured, not inferred: the event count before and after was identical.
//
// The cause was one statement's ordering. ctx.respondServing() refuses when there is no request to reply to,
// and honestly says so in a toast — and then every caller ran its own success toast on the very next line,
// painting over the truth a frame later:
//
//     ctx.respondServing(item, 'decline'); ctx.toast('Taken off — thanks for letting us know'); onClose();
//
// Six controls did this: accept (twice), decline, swap, "I'm away", and "I'm back on". The round of
// 2026-08-18 corrected the WORDING of the swap toast — "Asked your leader, X isn't on the app" — and left the
// control underneath it claiming success. That is the same defect the round was named for.
//
// The consequence in a parish is not cosmetic: someone tells their church they cannot come on Sunday, is
// thanked for it, and nobody is told. They simply do not turn up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const SERV = readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// the shipped helper, lifted and run — not a paraphrase of it
// ANCHOR ON `async function`, or the slice starts AFTER the async keyword and the lifted body is a plain
// function containing `await` — which throws a SyntaxError at load, so the whole FILE dies and prints no
// failure. svRespond became async when respondServing started reporting whether the relay took the reply.
const svRespond = new Function(fnBody(SERV, 'async function svRespond(', 'svRespond') + '\nreturn svRespond;')();

const spy = async (sent) => {
  const toasts = [], closed = [];
  const ctx = { respondServing: () => sent, toast: (t) => toasts.push(t) };
  const ok = await svRespond(ctx, { id: 'x' }, 'decline', '', 'Taken off — thanks for letting us know', () => closed.push(1));
  return { ok, toasts, closed };
};

test('when nothing was sent, the member is NOT thanked', async () => {
  const r = await spy(false);
  assert.deepEqual(r.toasts, [],
    'the app claimed "Taken off — thanks for letting us know" over a response that never left the phone. ' +
    'respondServing already explained why in its own toast; this one overwrites it.');
  assert.equal(r.ok, false, 'the helper reported success for a send that did not happen');
});

test('and the sheet is not closed, so they can try again', async () => {
  assert.deepEqual((await spy(false)).closed, [],
    'the sheet closed on a failed send, so the member has nothing to retry from and no sign anything is wrong');
});

test('when it WAS sent, the member is told, and the sheet closes', async () => {
  const r = await spy(true);
  assert.deepEqual(r.toasts, ['Taken off — thanks for letting us know'], 'a successful response now says nothing at all');
  assert.deepEqual(r.closed, [1], 'a successful response leaves the sheet open');
});

test('respondServing ANSWERS its caller — false when it refuses, true when it sends', async () => {
  // A caller cannot tell truth from silence unless this returns something. Both branches must be explicit:
  // the guard that toasts "your leader hasn't sent a request" must return false, and the send path true.
  const body = fnBody(stripComments(APP), 'respondServing: async (item, verdict, swapTo) =>', 'respondServing');
  assert.match(body, /if\s*\(!reqId\)\s*\{[^}]*return false;/,
    'the no-request branch returns nothing, so every caller reads undefined and assumes it worked');
  // THIS ASSERTION USED TO READ `assert.match(body, /return true;/)`, AND THAT WAS THE BUG DEFENDING ITSELF.
  // Pre-push audit, 2026-08-25: the send path fires the publish WITHOUT awaiting it and returns true before
  // any I/O, and the helper underneath swallows a failed publish (`try { await _publishAny(...) } catch {}`).
  // So a member on a published rota taps "I'm away" with no signal, is told "Taken off — thanks for letting
  // us know", and the church receives nothing. They do not turn up on Sunday. That is the exact scenario the
  // commit this file guards was named for — and pinning the literal `return true;` meant an honest fix, one
  // that reported the real outcome, would FAIL this test. A test that forbids the correct answer is worse
  // than no test.
  // What is still required is that the send path ANSWERS its caller at all — silence is what makes a caller
  // assume success. Any explicit answer satisfies it, so the honest fix is now free to land.
  // THE QUEUED FIX HAS NOW LANDED — 2026-09-03, audit 2026-09-02 #6, batch 7. respondServing is async,
  // awaits respondToServingRequest, and the engine returns null when no relay accepted instead of handing
  // back the event regardless. The assertion below stays deliberately loose for the same reason it was
  // loosened: it must not forbid the next honest shape either. What is asserted is that the send path
  // ANSWERS its caller; the behaviour itself is covered by the tests above and by
  // scripts/a-reply-that-did-not-send-is-not-a-reply.test.mjs.
  assert.match(body, /return\s+(true|ok|sent|!!|await|Boolean\()/,
    'the send path answers its caller with nothing, so every caller reads undefined and assumes it worked');
});

test('NO control talks to respondServing directly — they all go through the helper', async () => {
  // The structural half. Fixing six call sites is worth little if the seventh, added next month, copies the
  // old shape from one of its neighbours. Comments are stripped: this repo has shipped an assertion that was
  // satisfied by the comment explaining the rule.
  const src = stripComments(SERV);
  const direct = [...src.matchAll(/ctx\.respondServing\(/g)];
  assert.equal(direct.length, 1,
    `${direct.length} direct calls to ctx.respondServing — exactly one is allowed, inside svRespond(). A ` +
    'control that calls it directly and then toasts is how "thanks for letting us know" gets shown over a ' +
    'response that was never sent.');
  const helper = fnBody(src, 'function svRespond(', 'svRespond');
  assert.match(helper, /ctx\.respondServing\(/, 're-anchor: the one permitted call is no longer in svRespond');
});
