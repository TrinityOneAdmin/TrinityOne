// THE MEMBER APP WIRES THE SWAP-ASK SUBSCRIPTION TO THE SCREEN, AND THE ANSWER BACK OUT.
// Run: node --test scripts/the-member-app-wires-swap-asks-to-the-screen.test.mjs
//
// T-3 of the 2026-09-27 audit: the engine tests cover the engine and the screen tests take fixtures, but the line
// joining them — the subscription App() opens and the ctx field it fills — can be deleted with everything green.
// For the swap ask that would be exactly the original defect again (item 25): a teammate asked to cover, whose
// phone never hears. So this mounts the REAL App with a recording Fellowship and checks, in order:
//   · App opens subscribeSwapTraffic, and what it reports lands on the ctx the Serving screen reads (swapAsks);
//   · only THIS church's asks, only ones not yet answered, only ones not already past;
//   · answering goes out through Fellowship.answerSwapAsk, and a sent answer clears the ask;
//   · a swap ask carries its slot to the engine (respondToServingRequest's fifth argument);
//   · who each of my own asks named (subscribeMyReqReplies' second argument) reaches ctx.servSwapTo.
// CLAUDE.md rule 1 (point of use) and rule 3 (no text matching in app/*.jsx).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

const HEX = 'a'.repeat(64), OTHER_HEX = 'b'.repeat(64), ME = 'dd'.repeat(32), RUTH = 'aa'.repeat(32), COLIN = 'cc'.repeat(32);
const NPUB = 'npub1' + '0'.repeat(58);
let App, window, reset, flush;
const calls = {}, callbacks = {}, toasts = [];
let answerOutcome = { ok: true };

const slotOf = (date) => ({ serviceId: 'svc1', teamId: 't1', roleId: 'r1', teamName: 'Welcome', role: 'Greeter', date, time: '10:30', service: 'Sunday Gathering' });
const ask = (over = {}) => ({ id: 'req1', from: RUTH, church: HEX, ts: 5, slot: slotOf('2099-10-04'), ...over });

before(() => {
  const r = fakeReact(); reset = r.reset; flush = r.flush;
  const env = appBrowser(); window = env.window;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  App = loadApp({ React: r.React, window, expr: 'App' });
  window.TrinityData.CHURCHES = [{ id: NPUB, npub: NPUB, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(NPUB));
  window.Fellowship = new Proxy({
    myPubkey: ME, CANONICAL_RELAYS: [], hasRelays: true,
    toPub: (x) => (x === NPUB ? HEX : x),
    respondToServingRequest: async (...a) => { (calls.respondToServingRequest = calls.respondToServingRequest || []).push(a); return { ok: true }; },
    answerSwapAsk: async (...a) => { (calls.answerSwapAsk = calls.answerSwapAsk || []).push(a); return answerOutcome; },
  }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return (...args) => { (calls[k] = calls[k] || []).push(args); const cb = args.find(a => typeof a === 'function'); if (cb) callbacks[k] = cb; return () => {}; };
    },
  });
});

function draw() { reset(); const tree = App(); flush(); return tree; }
const ctxOf = (tree) => { const n = nodes(tree).find(x => x.props && x.props.ctx && 'swapAsks' in x.props.ctx); assert.ok(n, 'no screen received a ctx with swapAsks — the field is gone from the ctx App builds'); return n.props.ctx; };

test('App opens subscribeSwapTraffic', () => {
  draw();
  assert.ok(calls.subscribeSwapTraffic, 'App never called Fellowship.subscribeSwapTraffic — a teammate asked to cover would never be told');
  assert.equal(typeof callbacks.subscribeSwapTraffic, 'function');
});

test('an ask the engine reports reaches ctx.swapAsks for the Serving screen', () => {
  callbacks.subscribeSwapTraffic({ asks: [ask()], answers: {} });
  const ctx = ctxOf(draw());
  assert.deepEqual(ctx.swapAsks.map(a => a.id), ['req1'], 'THE DEFECT: the subscription is open but what it reports never reaches the screen');
});

test('only THIS church\'s asks, and only ones still to come', () => {
  callbacks.subscribeSwapTraffic({ asks: [
    ask({ id: 'mine' }), ask({ id: 'elsewhere', church: OTHER_HEX }), ask({ id: 'past', slot: slotOf('2001-01-07') })], answers: {} });
  const ctx = ctxOf(draw());
  assert.deepEqual(ctx.swapAsks.map(a => a.id), ['mine'], 'another church\'s ask, or one for a Sunday already gone, reached this church\'s screen');
});

test('answering sends through Fellowship.answerSwapAsk to the ask\'s own church, and a sent answer clears the ask', async () => {
  callbacks.subscribeSwapTraffic({ asks: [ask({ id: 'a1' })], answers: {} });
  let ctx = ctxOf(draw());
  answerOutcome = { ok: true };
  const ok = await ctx.answerSwap(ctx.swapAsks[0], true);
  assert.equal(ok, true);
  assert.deepEqual(calls.answerSwapAsk.at(-1).map((x, i) => i === 1 ? x.id : x), [HEX, 'a1', true], 'the answer did not go to the ask\'s church with the ask and the verdict');
  ctx = ctxOf(draw());
  assert.deepEqual(ctx.swapAsks.map(a => a.id), [], 'the ask is still on the screen after it was answered');
});

test('a failed answer keeps the ask on the screen and does not report success', async () => {
  callbacks.subscribeSwapTraffic({ asks: [ask({ id: 'a2' })], answers: {} });
  let ctx = ctxOf(draw());
  answerOutcome = { ok: false, reason: 'refused' };
  const ok = await ctx.answerSwap(ctx.swapAsks[0], true);
  assert.equal(ok, false, 'a refused answer was reported as sent');
  ctx = ctxOf(draw());
  assert.deepEqual(ctx.swapAsks.map(a => a.id), ['a2'], 'an answer that never left the phone cleared the ask');
});

test('a swap reply carries the slot it is about to the engine, and nothing else does', async () => {
  const ctx = ctxOf(draw());
  const item = { id: 'req9', church: HEX, serviceId: 'svc1', teamId: 't1', roleId: 'r1', teamName: 'Welcome', role: 'Greeter', date: '2099-10-04', time: '10:30', service: 'Sunday Gathering' };
  await ctx.respondServing(item, 'swap', COLIN);
  const sw = calls.respondToServingRequest.at(-1);
  assert.deepEqual([sw[0], sw[1], sw[2], sw[3]], [HEX, 'req9', 'swap', COLIN]);
  assert.deepEqual({ ...sw[4] }, { serviceId: 'svc1', teamId: 't1', roleId: 'r1', teamName: 'Welcome', role: 'Greeter', date: '2099-10-04', time: '10:30', service: 'Sunday Gathering' },
    'the slot did not reach the engine, so the teammate\'s phone cannot say what it is being asked to cover');
  await ctx.respondServing(item, 'decline', '');
  assert.equal(calls.respondToServingRequest.at(-1)[4], undefined, 'a decline carried a slot');
});

test('who my own swap asks named reaches ctx.servSwapTo', () => {
  assert.equal(typeof callbacks.subscribeMyReqReplies, 'function', 'App never opened subscribeMyReqReplies');
  callbacks.subscribeMyReqReplies({ req1: 'swap' }, { swapTo: { req1: COLIN } });
  const ctx = ctxOf(draw());
  assert.deepEqual({ ...ctx.servSwapTo }, { req1: COLIN }, 'the second argument of subscribeMyReqReplies never reaches the screen, so the row cannot say who was asked');
});

test('the member\'s answers to MY asks reach ctx.swapAnswers, per author', () => {
  callbacks.subscribeSwapTraffic({ asks: [], answers: { req1: { [COLIN]: { by: COLIN, yes: true, ts: 9 } } } });
  const ctx = ctxOf(draw());
  assert.equal(ctx.swapAnswers.req1[COLIN].yes, true);
});
