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

// ── THE OPPOSITE LIE, AND THIS ONE IS RUN RATHER THAN READ ────────────────────────────────────────────────
//
// Added 2026-09-16. `respondToServingRequest` returned `null` for all three failure outcomes at once, so
// respondServing could only ever say the settled sentence — "you're still shown as not having replied" —
// over a reply nobody had merely ACKNOWLEDGED. Believing the church never heard, a member arranges cover for
// a Sunday she is already down for. A wrong failure message sends somebody to redo work already done, which
// is why it is worse than no message.
//
// Answering again is safe, and the wording says so: the verdict arrives already decided and goes to the
// fixed d-tag `reqreply:<requestId>`, so a second press writes the same answer to the same document. (Unlike
// setEventRsvp, this is not a toggle and cannot reverse itself — which is why the two sentences differ.)
//
// LIFTED AND RUN, never text-matched: app/*.jsx ships unbundled, so `false && ` in front of the new branch
// would leave every word of it in place and a text assertion would still pass (CLAUDE.md rule 3).
const respondServing = (outcome) => {
  const toasts = [];
  const replies = [];
  const body = fnBody(APP, 'respondServing: async (item, verdict, swapTo) =>', 'respondServing');
  const window = { Fellowship: { respondToServingRequest: async () => outcome } };
  const obj = new Function('churches', 'activeChurch', 'toast', 'window', 'setServReplies',
    'return ({ ' + body + ' })')(
    [{ id: 'c1', npub: 'npub1church' }], 'c1',
    (m, o) => toasts.push({ m: String(m), e: !!(o && o.error) }),
    window,
    (f) => replies.push(typeof f === 'function' ? f({}) : f));
  return { fn: obj.respondServing, toasts, replies };
};
const ITEM = { id: 'req-1' };

test('an UNCONFIRMED reply is not reported as "you’re still shown as not having replied"', async () => {
  const r = respondServing({ ok: false, reason: 'unconfirmed' });
  const out = await r.fn(ITEM, 'accept', '');
  assert.equal(out, false, 'an unconfirmed reply must not be reported to the caller as a confirmed send');
  assert.equal(r.toasts.length, 1, 'nothing was said at all');
  assert.match(r.toasts[0].m, /couldn’t confirm/i,
    'a reply nobody answered for is still being called a settled failure, so a member who HAS replied goes ' +
    'and arranges cover for a Sunday she is already down for');
  assert.match(r.toasts[0].m, /won’t change what you said/i,
    'the member is not told that pressing the same button again is safe, which is the only thing that makes ' +
    '"it may well have" actionable rather than merely worrying');
});

test('CONTROL: a reply that genuinely never left the phone still says so plainly', async () => {
  // Without this, "always say we couldn’t confirm" passes the row above — and softening a settled failure is
  // the direction that leaves a rota relying on an answer the church never received.
  const r = respondServing({ ok: false, reason: 'not-sent' });
  await r.fn(ITEM, 'accept', '');
  assert.match(r.toasts[0].m, /still shown as not having replied/i,
    'a reply that reached no relay at all is being softened into "it may well have"');
});

test('CONTROL: an ACCEPTED reply is recorded and says nothing about failure', async () => {
  const r = respondServing({ ok: true, evt: { id: 'e' } });
  const out = await r.fn(ITEM, 'accept', '');
  assert.equal(out, true, 'a reply a relay accepted is being reported as a failure — the opposite lie');
  assert.equal(r.toasts.filter(t => t.e).length, 0, 'a successful reply toasted an error');
  assert.deepEqual(r.replies, [{ 'req-1': 'accept' }],
    'the answer was not recorded on the member’s own screen, so their slot still reads unanswered');
});

test('⚠ the truthiness trap: a FAILURE OBJECT must not take the success arm', async () => {
  // respondToServingRequest answers an object now, and an object is always truthy — `if (sent)` would read
  // every failure as a send. That is the markSafe trap, set three times in this repo already.
  const r = respondServing({ ok: false, reason: 'refused' });
  const out = await r.fn(ITEM, 'accept', '');
  assert.equal(out, false, 'respondServing read a failure OBJECT as a success — it must test `sent.ok`');
  assert.deepEqual(r.replies, [], 'a refused reply was recorded on the member’s screen as though it had sent');
});
