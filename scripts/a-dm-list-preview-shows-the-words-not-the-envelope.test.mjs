// A REPLY IN THE PRIVATE-MESSAGE LIST SHOWS ITS WORDS, NOT THE ENVELOPE.
//   Run: node --test scripts/a-dm-list-preview-shows-the-words-not-the-envelope.test.mjs
//
// Owner saw a row reading {"v":1,"t":"Yo","r":"c60f...  A reply is sent as a JSON envelope (_dmWrap) and only the
// thread view unwrapped it; the conversation list built its preview from the raw decrypted body.
//
// Point of use: the SHIPPED subscribeDMs out of vendor/fellowship.js, fed relay events through the handler the
// subscription registers, reading what it hands the screen (onConvos). Decryption is stubbed (it is not what
// changed); the real _dmWrap and _dmUnwrap from the bundle are used, so the wrapped bodies are the real ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FEL = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const sub = fnBody(FEL, 'subscribeDMs(onConvos) {', 'subscribeDMs');
const wrap = fnBody(FEL, '_dmWrap(text, replyTo, meta) {', '_dmWrap');
const unwrap = fnBody(FEL, '_dmUnwrap(body) {', '_dmUnwrap');
const coalesce = /\n  function _coalesce\(fn\) \{[\s\S]*?\n  \}\n/.exec(FEL);
assert.ok(coalesce, '_coalesce not found in the bundle');

const ME = 'a'.repeat(64), PEER = 'b'.repeat(64);
const make = new Function('pool', 'window', 'pub', 'sk', '_dmDecrypt', '_netRelays', 'dmReadRelays',
  `${coalesce[0]}\nreturn ({ ${wrap}, ${unwrap}, ${sub} });`);

// `events`: [{ from: 'me'|'peer', body (the decrypted text) | undecryptable: true, ts }]
async function inbox(events) {
  let handler;
  const pool = { subscribeMany: (_u, _f, h) => { handler = h.onevent; return { close() {} }; } };
  const window = { Fellowship: { relays: [] } };
  const dec = async (_sk, _peer, ct) => { if (ct === 'BAD') throw new Error('x'); return ct; };
  const o = make(pool, window, ME, new Uint8Array(32), dec, u => u, () => []);
  window.Fellowship._dmUnwrap = o._dmUnwrap;   // as in the app: the methods live on window.Fellowship
  let last = null;
  o.subscribeDMs(c => { last = c; });
  for (const e of events) {
    await handler({ pubkey: e.from === 'me' ? ME : PEER, tags: [['p', e.from === 'me' ? PEER : ME]],
      created_at: e.ts, content: e.undecryptable ? 'BAD' : e.body });
  }
  await new Promise(r => setTimeout(r, 20));
  return { last };
}
const envelope = (text) => make({}, {}, ME, null, null, null)._dmWrap(text, { id: 'c60fc75b35b7d2cd3' + 'e'.repeat(47) });

test('a reply from the other person previews as its words, not the JSON envelope', async () => {
  const body = envelope('Yo');
  assert.ok(body.startsWith('{"v":1'), 'fixture really is the wrapped form');
  const { last } = await inbox([{ from: 'peer', body, ts: 10 }]);
  assert.equal(last[0].preview, 'Yo');
});

test('a reply I sent previews as "You: " + its words', async () => {
  const { last } = await inbox([{ from: 'me', body: envelope('Yo'), ts: 10 }]);
  assert.equal(last[0].preview, 'You: Yo');
});

test('a plain message is unchanged, mine and theirs', async () => {
  const a = await inbox([{ from: 'peer', body: 'hello there', ts: 10 }]);
  assert.equal(a.last[0].preview, 'hello there');
  const b = await inbox([{ from: 'me', body: 'hello there', ts: 10 }]);
  assert.equal(b.last[0].preview, 'You: hello there');
});

test('a body that is not a v1 envelope is passed through untouched', async () => {
  for (const body of ['{"v":2,"t":"x","r":"y"}', '{"hello":1}', '{not json', '{"v":1,"t":5}']) {
    const { last } = await inbox([{ from: 'peer', body, ts: 10 }]);
    assert.equal(last[0].preview, body, body);
  }
});

test('a body that cannot be decrypted still shows the lock', async () => {
  const a = await inbox([{ from: 'peer', undecryptable: true, ts: 10 }]);
  assert.equal(a.last[0].preview, '🔒');
  const b = await inbox([{ from: 'me', undecryptable: true, ts: 10 }]);
  assert.equal(b.last[0].preview, 'You: 🔒');
});
