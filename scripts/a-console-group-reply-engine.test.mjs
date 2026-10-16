// CONSOLE GROUP-CHAT REPLY, ENGINE HALF. Run: node --test scripts/a-console-group-reply-engine.test.mjs
//
// Lifts the SHIPPED publishPost and subscribeGroupChat out of vendor/steward.js and runs them (rule 3: no text
// matching). The screen half is scripts/a-console-group-reply-ui.test.mjs.
//
// Users of the code touched (rule 2), from `grep -n "publishPost(\|subscribeGroupChat(" app/*.jsx src/*.js`:
//   publishPost       -> stew-dashboard.jsx NewPostModal (2 args, unchanged), GroupChatModal.send (now 3 args).
//                        A 2-arg call builds the identical tag list as before (asserted below).
//   subscribeGroupChat-> GroupChatModal only. It gains `replyTo` + `quote` on each message; nothing reads them
//                        but the reply UI. Removed messages keep `text: ''` and now also lose replyTo/quote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const PUB = 'c'.repeat(64), AUTHOR = 'a'.repeat(64), OTHER = 'b'.repeat(64);

async function post(args, { skeys = {} } = {}) {
  const body = fnBody(STEWARD, 'publishPost(content, group, replyTo) {', 'publishPost');
  let published = null;
  const scope = { sk: new Uint8Array(32).fill(1), _skeys: skeys, _sealedGroupIds: new Set(), publish: (e) => { published = e; return Promise.resolve(e); },
    feChurch: (e) => e, now: () => 1000, NET: 'net', pub: PUB, encrypt2: (t) => 'SEALED:' + t, Promise, console };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  await fn.publishPost(...args);
  return published;
}

test('a reply carries e/reply + p(author) AFTER the church p-tag, which stays first', async () => {
  const e = await post(['hi', 'g1', { id: 'm9', by: AUTHOR }]);
  const ps = e.tags.filter(t => t[0] === 'p');
  assert.deepEqual(ps[0], ['p', PUB], "['p', church] must be the FIRST p-tag — subscribeGroupChat/subscribeGroup scope on it");
  assert.deepEqual(e.tags.find(t => t[0] === 'e'), ['e', 'm9', '', 'reply']);
  assert.deepEqual(ps[1], ['p', AUTHOR]);
  assert.ok(e.tags.some(t => t[0] === 't' && t[1] === 'g1'), 'the group t-tag (what the relay scopes by) must remain');
});

test('no replyTo: the tag list is exactly what it was before', async () => {
  const e = await post(['hi', 'g1']);
  assert.deepEqual(e.tags, [['t', 'net'], ['t', 'g1'], ['p', PUB]]);
});

test('a reply into a sealed room is still sealed, and the reply tags ride alongside enc', async () => {
  const e = await post(['secret', 'g1', { id: 'm9', by: AUTHOR }], { skeys: { g1: [new Uint8Array(32).fill(2)] } });
  assert.equal(e.content, 'SEALED:secret');
  assert.ok(e.tags.some(t => t[0] === 'enc'));
  assert.deepEqual(e.tags.find(t => t[0] === 'e'), ['e', 'm9', '', 'reply']);
});

function room({ hiddenIds = [], skeys = {} } = {}) {
  const body = fnBody(STEWARD, 'subscribeGroupChat(groupId, onMsgs) {', 'subscribeGroupChat');
  let onevent = null; const out = [];
  const pool = { subscribeMany: (r, f, h) => { if (f.some(x => x.kinds && x.kinds.includes(1))) onevent = h.onevent; return { close() {} }; } };
  let hiddenCb = null;
  const scope = { pool, relays: () => [], pub: PUB, _skeys: skeys, decrypt3: (c) => c.replace(/^SEALED:/, ''), setTimeout: () => 0, clearTimeout() {},
    window: { Steward: { subscribeHidden: (cb) => { hiddenCb = cb; cb(new Set(hiddenIds)); return () => {}; } } }, Map, Set };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  fn.subscribeGroupChat('g1', (m) => { out.length = 0; out.push(...m); });
  const ev = (id, by, content, extra = [], ts = 1) => ({ kind: 1, id, pubkey: by, content, created_at: ts, tags: [['t', 'g1'], ['p', PUB], ...extra] });
  return { send: (e) => onevent(e), ev, out, hide: (ids) => hiddenCb(new Set(ids)) };
}

test('a kind-1 with an e/reply tag yields a message whose quote is the message it answers', () => {
  const r = room();
  r.send(r.ev('m1', AUTHOR, 'Can someone bring chairs?', [], 1));
  r.send(r.ev('m2', PUB, 'I will', [['e', 'm1', '', 'reply'], ['p', AUTHOR]], 2));
  const m2 = r.out.find(m => m.id === 'm2');
  assert.equal(m2.replyTo, 'm1');
  assert.deepEqual({ id: m2.quote.id, by: m2.quote.by, text: m2.quote.text }, { id: 'm1', by: AUTHOR, text: 'Can someone bring chairs?' });
  assert.equal(r.out.find(m => m.id === 'm1').quote, null, 'a plain message has no quote');
});

test('a reply to a message that is not loaded keeps replyTo but has no quote', () => {
  const r = room();
  r.send(r.ev('m2', OTHER, 'agreed', [['e', 'gone', '', 'reply']], 2));
  const m = r.out[0]; assert.equal(m.replyTo, 'gone'); assert.equal(m.quote, null);
});

test('only an e-tag marked reply counts (a stray e-tag is not a quote)', () => {
  const r = room();
  r.send(r.ev('m1', AUTHOR, 'one', [], 1)); r.send(r.ev('m2', AUTHOR, 'two', [['e', 'm1']], 2));
  assert.equal(r.out.find(m => m.id === 'm2').replyTo, '');
});

test('a reply sealed in the room is quoted in plain words once decrypted', () => {
  const r = room({ skeys: { g1: [new Uint8Array(32)] } });
  r.send(r.ev('m1', AUTHOR, 'SEALED:the words', [['enc', '1']], 1));
  r.send(r.ev('m2', AUTHOR, 'SEALED:ok', [['enc', '1'], ['e', 'm1', '', 'reply']], 2));
  assert.equal(r.out.find(m => m.id === 'm2').quote.text, 'the words');
});

test('a REMOVED message is not quoted back, and a removed reply drops its quote', () => {
  const r = room({ hiddenIds: ['m1'] });
  r.send(r.ev('m1', AUTHOR, 'regrettable words', [], 1));
  r.send(r.ev('m2', OTHER, 'replying', [['e', 'm1', '', 'reply']], 2));
  const m2 = r.out.find(m => m.id === 'm2');
  assert.equal(m2.quote, null, 'a removed message was reprinted as a quote');
  assert.equal(r.out.find(m => m.id === 'm1').text, '');
  assert.ok(!JSON.stringify(r.out).includes('regrettable'), 'removed words leaked into the emitted list');
  r.hide(['m2']);
  assert.equal(r.out.find(m => m.id === 'm2').quote, null);
});
