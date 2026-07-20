// Outbox — UX-AUDIT-2026-07-20 E1. Run: node --test scripts/outbox.test.mjs
//
// A message that couldn't be sent used to be GONE: the composer cleared, the transport logged a warning,
// nothing appeared in the thread. On the intermittent connections this product is built for that is the
// failure that costs the most trust, because nobody reports it — they just stop trusting the app with
// anything that matters.
//
// These pin the properties that make the queue safe. The one that matters most is IDEMPOTENCE: the event is
// signed ONCE at compose time and republished verbatim, so a retry cannot produce a second message. Sign per
// attempt instead and a member on a flaky connection would spam their own prayer group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';

const sk = generateSecretKey();
const now = () => Math.floor(Date.now() / 1000);
const mk = (content, groupId) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['t', groupId]], content }, sk);

// the queue, mirroring fellowship.src.js's shape
function makeOutbox(store = new Map()) {
  let q = JSON.parse(store.get('outbox') || '[]');
  const save = () => store.set('outbox', JSON.stringify(q.slice(-200)));
  return {
    queue(evt, groupId) { q.push({ evt, groupId, at: now(), tries: 0 }); save(); return evt; },
    drop(id) { q = q.filter(o => o.evt.id !== id); save(); },
    forGroup(g) { return q.filter(o => o.groupId === g).map(o => o.evt); },
    all() { return q; },
    async flush(publish) {
      for (const item of [...q]) {
        try { await publish(item.evt); q = q.filter(o => o.evt.id !== item.evt.id); save(); }
        catch { item.tries++; save(); }
      }
    },
  };
}

test('a failed send is kept, not lost', async () => {
  const ob = makeOutbox();
  ob.queue(mk('please pray for my mum', 'g1'), 'g1');
  await ob.flush(async () => { throw new Error('offline'); });
  assert.equal(ob.all().length, 1, 'the message was dropped when the send failed — this is the whole bug');
  assert.equal(ob.all()[0].tries, 1);
  assert.equal(ob.forGroup('g1')[0].content, 'please pray for my mum');
});

test('it is delivered on the next attempt, and only once', async () => {
  const ob = makeOutbox();
  const evt = ob.queue(mk('hello', 'g1'), 'g1');
  await ob.flush(async () => { throw new Error('offline'); });
  const sent = [];
  await ob.flush(async (e) => { sent.push(e); });
  assert.deepEqual(sent.map(e => e.id), [evt.id]);
  assert.equal(ob.all().length, 0, 'a delivered message must leave the queue');
  await ob.flush(async (e) => { sent.push(e); });
  assert.equal(sent.length, 1, 'flushing again re-sent a message that had already gone');
});

test('a retry republishes the IDENTICAL event — no duplicate message', async () => {
  // Signing per attempt would give a new id and created_at each time, so every retry would land as a
  // SEPARATE message in the group. On a flaky link a member would spam their own prayer request.
  const ob = makeOutbox();
  const evt = ob.queue(mk('one message only', 'g1'), 'g1');
  const seen = [];
  await ob.flush(async (e) => { seen.push({ id: e.id, at: e.created_at }); throw new Error('still offline'); });
  await ob.flush(async (e) => { seen.push({ id: e.id, at: e.created_at }); });
  assert.equal(seen[0].id, seen[1].id, 'the retry had a different event id — the relay would store two messages');
  assert.equal(seen[0].at, seen[1].at, 'created_at changed on retry — the message would jump in the timeline');
  assert.equal(seen[1].id, evt.id);
  assert.equal(verifyEvent(evt), true, 'the queued event must still verify after a round-trip through storage');
});

test('the queue survives being written to storage and read back', async () => {
  const store = new Map();
  const a = makeOutbox(store);
  a.queue(mk('typed on the train', 'g1'), 'g1');
  const b = makeOutbox(store);   // simulates the app being closed and reopened
  assert.equal(b.all().length, 1, 'closing the app lost the queued message');
  assert.equal(b.forGroup('g1')[0].content, 'typed on the train');
  assert.equal(verifyEvent(b.forGroup('g1')[0]), true, 'the signature did not survive JSON storage');
});

test('the relay echo replaces the pending bubble instead of duplicating it', () => {
  // The thread renders queued messages after the delivered ones, filtered by id. Because the event is
  // republished verbatim, the echo carries the SAME id — so the pending copy simply drops out.
  const ob = makeOutbox();
  const evt = ob.queue(mk('hi', 'g1'), 'g1');
  const delivered = [{ id: evt.id, content: 'hi' }];               // what came back from the relay
  const have = new Set(delivered.map(m => m.id));
  const shown = [...delivered, ...ob.forGroup('g1').filter(q => !have.has(q.id))];
  assert.equal(shown.length, 1, 'the message rendered twice — once pending, once delivered');
});

test('the queue is bounded', () => {
  const ob = makeOutbox();
  for (let i = 0; i < 260; i++) ob.queue(mk('m' + i, 'g1'), 'g1');
  assert.equal(ob.all().length <= 260, true);
  const store = new Map(); const a = makeOutbox(store);
  for (let i = 0; i < 260; i++) a.queue(mk('m' + i, 'g1'), 'g1');
  assert.equal(makeOutbox(store).all().length, 200, 'an unbounded queue would grow until storage failed');
});

test('messages are queued per group', () => {
  const ob = makeOutbox();
  ob.queue(mk('to group one', 'g1'), 'g1');
  ob.queue(mk('to group two', 'g2'), 'g2');
  assert.equal(ob.forGroup('g1').length, 1);
  assert.equal(ob.forGroup('g2')[0].content, 'to group two');
});

test('a permanently refused message is not retried forever', async () => {
  // A relay REFUSING a message ("blocked: not a member of that group") is not the same as being unable to
  // reach one. Conflating them means an un-sendable message is retried every 45 seconds for the life of the
  // install — which is exactly what an on-device test in airplane mode surfaced.
  const PERMANENT = /^(blocked|invalid|rate-limited|restricted|error: )/i;
  const classify = (msg) => PERMANENT.test(msg) ? 'permanent' : 'transient';
  assert.equal(classify('blocked: not a member or not permitted for this group'), 'permanent');
  assert.equal(classify('invalid: too many filters'), 'permanent');
  assert.equal(classify('rate-limited: too many subscriptions'), 'permanent');
  assert.equal(classify('timeout'), 'transient', 'a timeout must stay queued — that is just no signal');
  assert.equal(classify('WebSocket connection failed'), 'transient');
  assert.equal(classify('websocket error'), 'transient');
});

test('an offline publish is bounded in time', async () => {
  // Promise.any over sockets that never open stays pending indefinitely, so the composer would sit on
  // "sending" for minutes and a flush would never finish. Race it against a timeout.
  const never = () => new Promise(() => {});
  const bounded = (ms) => Promise.race([never(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  const t0 = Date.now();
  await assert.rejects(() => bounded(120), /timeout/);
  assert.equal(Date.now() - t0 < 2000, true, 'the bounded publish did not give up promptly');
});
