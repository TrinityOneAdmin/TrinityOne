// A PUSH TOKEN WHOSE FIRST SEND IS REFUSED (cold gate / offline) IS QUEUED FOR RETRY — NOT LOST.
//   Run: node --test scripts/a-push-token-that-cant-send-yet-is-queued-for-retry.test.mjs
//
// publishPushToken USED to be a one-shot `_publishBounded(churchRelays(), evt)` with a console.warn on failure:
// no retry, no persistence. A member who enables "Prompt alerts" right after joining hits a COLD gate cache (the
// church's own box is not proved yet) or a socket still coming up; that one send is refused as an outage and the
// token is GONE — the relay never learns where to push, the member gets no notifications, and nothing says so.
// The fix routes the token through the SAME retried outbox announceMembership uses (queue first, attempt, retry
// across reconnects/restarts, re-derive publishSetFor(cp) at send time).
//
// POINT OF USE (CLAUDE.md rule 1): this lifts the SHIPPED publishPushToken out of vendor/fellowship.js and runs
// it. The decisive test makes the immediate attempt fail and asserts the token is STILL QUEUED — which is false,
// and the test red, the instant anyone reverts publishPushToken to a one-shot send with no queue. Nothing here
// matches text in app/*.jsx (rule 3): every claim is about the real function's effect on the real _outbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const MEMBER = 'a'.repeat(64);
const CHURCH = 'c'.repeat(64);

// Run a function sliced from the bundle with a controlled scope (the a-refused… harness pattern): any free name
// not provided throws loudly, so a rename in the bundle fails the test instead of silently passing.
function lift(src, scope) {
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return ${src}; }`)(proxy);
}

// The shipped publishPushToken over a controlled outbox, with the immediate flush made to NOT deliver (offline).
function engine() {
  const flushCalls = [];
  const scope = {
    sk: new Uint8Array(32),
    pub: MEMBER,
    NET: 'trinityone',
    _outbox: [],
    _outboxSave: () => {},
    _monotonicF: (t) => t,                                  // real one only bumps created_at; irrelevant here
    // OFFLINE: the attempt runs but delivers nothing and removes nothing — exactly a cold gate / dead socket.
    _outboxFlush: async (pred) => { flushCalls.push(pred); },
  };
  // bind finalizeEvent under whatever name the bundle gave it (finalizeEvent / finalizeEvent2 …), so a rename is loud
  const body = fnBody(BUNDLE, 'async publishPushToken(token, env) {', 'publishPushToken');
  const fin = (body.match(/\b(finalizeEvent\d*)\(/) || [])[1];
  assert.ok(fin, 're-anchor: publishPushToken no longer signs an event');
  scope[fin] = (t) => ({ ...t, id: 'ev' + Math.random().toString(36).slice(2), pubkey: MEMBER });
  scope._outboxDropPushTokens = lift('(' + fnBody(BUNDLE, 'function _outboxDropPushTokens(p) {', '_outboxDropPushTokens').replace(/^function /, 'function ') + ')', scope);
  const buildBody = fnBody(BUNDLE, '_buildPushTokenEvent({', '_buildPushTokenEvent');   // bundle renames the destructured `pub`→`pub2`
  scope.window = { Fellowship: {
    ready: Promise.resolve(),
    churchPub: CHURCH,
    _buildPushTokenEvent: lift('(' + buildBody.replace(/^_buildPushTokenEvent/, 'function _buildPushTokenEvent') + ')', scope),
  } };
  const publishPushToken = lift('(' + body.replace(/^async publishPushToken/, 'async function publishPushToken') + ')', scope);
  const deleteBody = fnBody(BUNDLE, 'async deletePushToken() {', 'deletePushToken');
  const deletePushToken = lift('(' + deleteBody.replace(/^async deletePushToken/, 'async function deletePushToken') + ')', scope);
  return { scope, flushCalls, publishPushToken, deletePushToken };
}

test('a token whose first send is refused stays QUEUED for retry (not dropped like the old one-shot)', async () => {
  const { scope, flushCalls, publishPushToken } = engine();
  const r = await publishPushToken('AABB1122CCDD', 'sandbox');

  // THE GUARD: a one-shot publish that failed would leave the queue empty. The retry path keeps the token.
  assert.equal(scope._outbox.length, 1, 'the token must be queued so a reconnect/restart can retry it');
  const item = scope._outbox[0];
  assert.equal(item.pushtoken, true, 'queued as a pushtoken item (so _outboxFull excludes it and replace works)');
  assert.equal(item.cp, CHURCH, 'tagged with the active church so _itemChurch routes it to publishSetFor(cp)');
  assert.equal(item.groupId, null); assert.ok(!item.peer && !item.join && !item.leave, 'a plain church item to the outbox');
  assert.equal(JSON.parse(item.evt.content).token, 'aabb1122ccdd', 'the real (lowercased) token rides the queued event');
  assert.equal(flushCalls.length, 1, 'it still ATTEMPTS immediately (queue first, then send) — not queue-only');
  assert.equal(r.ok, true, 'durably queued counts as ok; delivery is the retry loop’s job');
  assert.equal(r.delivered, false, 'the offline attempt did not clear it from the queue');
});

test('a bad (non-hex) token never reaches the queue', async () => {
  const { scope, publishPushToken } = engine();
  const r = await publishPushToken('not-a-hex-token', 'sandbox');
  assert.deepEqual(r, { ok: false, reason: 'bad-token' });
  assert.equal(scope._outbox.length, 0, 'garbage is refused before it can sit in the outbox retrying forever');
});

test('a newer token REPLACES the older queued one (pushtoken:<pub> is one replaceable doc)', async () => {
  const { scope, publishPushToken } = engine();
  await publishPushToken('1111aaaa', 'sandbox');
  await publishPushToken('2222bbbb', 'sandbox');
  assert.equal(scope._outbox.length, 1, 'only one pushtoken action is ever queued for this device');
  assert.equal(JSON.parse(scope._outbox[0].evt.content).token, '2222bbbb', 'the newer token wins');
});

test('turning push OFF queues a deregister through the same retried path (a refused delete must not strand a live token)', async () => {
  const { scope, flushCalls, publishPushToken, deletePushToken } = engine();
  await publishPushToken('3333cccc', 'sandbox');        // registered, still queued (offline)
  await deletePushToken();
  assert.equal(scope._outbox.length, 1, 'the queued register is dropped and the deregister replaces it');
  const item = scope._outbox[0];
  assert.equal(item.pushtoken, true);
  assert.equal(item.evt.content, '', 'a deregister is an empty replaceable copy');
  assert.ok(item.evt.tags.some(t => t[0] === 'deleted'), 'carrying the `deleted` tag the registry drops the token on');
  assert.equal(flushCalls.length, 2, 'the deregister attempts immediately too, and retries if refused');
});

// ── routing: a queued pushtoken item lands where announceMembership's join lands — publishSetFor(cp) ──
test('the outbox routes a pushtoken item to the church’s publish set, and the cp tag is what does it', () => {
  const scope = {
    publishSetFor: (cp) => ['SET:' + cp],                 // sentinel: the join/profile retry target
    memberChurchPubs: () => [CHURCH],
    dmSendRelays: () => ['DM'], profilePublishRelays: () => ['PROFILE'],
    _netRelays: (a) => a, CANONICAL_RELAYS: ['wss://shared/relay'],
  };
  scope._itemChurch = lift('(' + fnBody(BUNDLE, 'function _itemChurch(o) {', '_itemChurch').replace(/^function /, 'function ') + ')', scope);
  scope._outboxRelays = lift('(' + fnBody(BUNDLE, 'function _outboxRelays(item) {', '_outboxRelays').replace(/^function /, 'function ') + ')', scope);

  const withCp = scope._outboxRelays({ evt: { tags: [] }, pushtoken: true, cp: CHURCH, groupId: null, relays: [] });
  assert.deepEqual(withCp, ['SET:' + CHURCH], 'a pushtoken tagged with its church retries to publishSetFor(cp) — the join path');

  // Strip the cp and it falls back to the shared pool, never publishSetFor — proving cp is what routes it.
  const noCp = scope._outboxRelays({ evt: { tags: [] }, pushtoken: true, cp: '', groupId: null, relays: [] });
  assert.deepEqual(noCp, ['wss://shared/relay'], 'without the church tag it is just a shared-pool send');
});

// ── a stuck token must not refuse the member’s chat: _outboxFull ignores pushtoken items ──
test('queued pushtoken items do not count toward the chat-queue limit', () => {
  const scope = { _outbox: [], OUTBOX_MAX: 2, pub: MEMBER };
  scope._mine = lift('(' + fnBody(BUNDLE, 'function _mine(o) {', '_mine').replace(/^function /, 'function ') + ')', scope);
  scope._outboxFull = lift('(' + fnBody(BUNDLE, 'function _outboxFull() {', '_outboxFull').replace(/^function /, 'function ') + ')', scope);
  const chat = () => ({ evt: { pubkey: MEMBER }, groupId: 'g' });
  const tok = () => ({ evt: { pubkey: MEMBER }, pushtoken: true, cp: CHURCH });

  scope._outbox = [chat(), chat()];
  assert.equal(scope._outboxFull(), true, 'two of the member’s chat messages fill the queue (OUTBOX_MAX=2)');

  scope._outbox = [chat(), tok(), tok(), tok(), tok()];
  assert.equal(scope._outboxFull(), false, 'one chat message + four pushtokens is NOT full — pushtokens are excluded');
});
