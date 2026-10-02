// A MEMBER'S "CONTACT YOUR CHURCH" MESSAGE MUST REACH THE CONSOLE — AND THE CONSOLE MUST NEVER DROP ONE SILENTLY.
//   Run: node --test scripts/a-members-message-to-the-church-reaches-the-console.test.mjs
//
// Sim finding (block A2, item 2). The member app SENDS direct messages with NIP-44 (_dmEncrypt) and reads
// NIP-44 first, NIP-04 second. The console's subscribeDMThread decrypted with NIP-04 ONLY and, when that
// threw — which it does for every NIP-44 payload — did `return`: the message was dropped with no trace. The
// member's thread showed it sent; the church never saw it. sendDM on the console also encrypted NIP-04, so
// even a reply that did get written was in the deprecated format.
//
// THE SHIPPED FUNCTIONS, out of vendor/steward.js (rule: tests drive shipped code, not a mirror — the older
// scripts/dm-crypto.test.mjs tests a COPY of the helpers). subscribeDMThread and sendDM are lifted over the
// REAL nostr-tools crypto; only the relay pool is replaced, by one that hands the test its onevent handler.
// The crypto helpers the lifted functions call are lifted from the bundle too, under the names esbuild gave
// them (it renumbers: encrypt2/decrypt3 today, something else after the next import).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { encrypt as nip44e, decrypt as nip44d, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import { encrypt as nip04e, decrypt as nip04d } from 'nostr-tools/nip04';
import { fnBody, stmt } from './test-slice.mjs';

const ST = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const churchSk = generateSecretKey(), CHURCH = getPublicKey(churchSk);
const memberSk = generateSecretKey(), MEMBER = getPublicKey(memberSk);

// What the bundle's own helpers are called, read off the shipped text.
const DEC = stmt(ST, 'var _dmDecrypt =', '_dmDecrypt');
const ENC = stmt(ST, 'var _dmEncrypt =', '_dmEncrypt');
const decName = (DEC.match(/return (\w+)\(ct, (\w+)\(/) || [])[1];
const ckName = (DEC.match(/return \w+\(ct, (\w+)\(/) || [])[1];
const dec04Name = (DEC.match(/await (\w+)\(sk2/) || [])[1];
const encName = (ENC.match(/=> (\w+)\(text, /) || [])[1];
assert.ok(decName && ckName && dec04Name && encName, 're-anchor: could not read the bundle\'s crypto helper names');

const helpers = new Function(decName, ckName, dec04Name, encName,
  ENC + '\n' + DEC + '\nreturn { _dmEncrypt, _dmDecrypt };')(
  (ct, k) => nip44d(ct, k), nip44ck, nip04d, (t, k) => nip44e(t, k));

function lift(method, stubs) {
  const proxy = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const src = fnBody(ST, method.anchor, method.name);
  return new Function('scope', `with (scope) { return ({ ${src} }).${method.name}; }`)(proxy);
}

// subscribeDMThread as the CHURCH CONSOLE (sk = church key, pub = church pubkey) over a pool we drive by hand.
function thread() {
  const handlers = {};
  const pool = { subscribeMany: (_r, _f, h) => { Object.assign(handlers, h); return { close() {} }; } };
  const out = { msgs: [] };
  const sub = lift({ anchor: 'subscribeDMThread(peerHex, onMsgs) {', name: 'subscribeDMThread' },
    { pool, relays: () => [], sk: churchSk, pub: CHURCH, _dmDecrypt: helpers._dmDecrypt });
  sub(MEMBER, (m) => { out.msgs = m; });
  out.deliver = async (evt) => { handlers.onevent(evt); await new Promise(r => setTimeout(r, 20)); };
  return out;
}
const dm = (from, to, content, extra = {}) =>
  finalizeEvent({ kind: 4, created_at: 1000 + (extra.i || 0), tags: [['p', to]], content }, from);

test('a member\'s NIP-44 message (what the member app really sends) opens on the console', async () => {
  const t = thread();
  await t.deliver(dm(memberSk, CHURCH, nip44e('Please could someone call me', nip44ck(memberSk, CHURCH))));
  assert.equal(t.msgs.length, 1, 'THE MESSAGE NEVER APPEARED — the console dropped a NIP-44 payload it could not read');
  assert.equal(t.msgs[0].text, 'Please could someone call me');
  assert.equal(t.msgs[0].mine, false);
});

test('a NIP-04 message from an older member build still opens (the fallback is kept)', async () => {
  const t = thread();
  await t.deliver(dm(memberSk, CHURCH, await nip04e(memberSk, CHURCH, 'sent from an old build')));
  assert.equal(t.msgs.length, 1);
  assert.equal(t.msgs[0].text, 'sent from an old build');
});

test('the church\'s own earlier reply reads back, in either format', async () => {
  const t = thread();
  await t.deliver(dm(churchSk, MEMBER, nip44e('we will ring you', nip44ck(churchSk, MEMBER)), { i: 1 }));
  await t.deliver(dm(churchSk, MEMBER, await nip04e(churchSk, MEMBER, 'an old reply'), { i: 2 }));
  assert.deepEqual(t.msgs.map(m => [m.mine, m.text]), [[true, 'we will ring you'], [true, 'an old reply']]);
});

test('a message that cannot be decrypted at all is SHOWN as such, never silently dropped', async () => {
  const t = thread();
  await t.deliver(dm(memberSk, CHURCH, 'not-a-ciphertext'));
  assert.equal(t.msgs.length, 1,
    'AN UNREADABLE MESSAGE VANISHED WITHOUT A TRACE — the church never learns somebody wrote');
  assert.match(t.msgs[0].text, /could not decrypt/);
  assert.equal(t.msgs[0].undecryptable, true);
});

// ── the console's own sends are NIP-44 now ───────────────────────────────────────────────────────────────────
function sender() {
  const published = [];
  const scope = {
    sk: churchSk, pub: CHURCH, NET: 'trinityone', now: () => 2000,
    finalizeEvent, _monotonic: (t) => t, _sOutLoad() {}, _sOutSave() {},
    _sOutbox: [], _sOutPlain: new Map(),
    _dmEncrypt: helpers._dmEncrypt,
    publish: async (e) => { published.push(e); return true; },
  };
  // finalizeEvent is imported under a bundle name; bind whatever the body calls so a rename fails loudly.
  const body = fnBody(ST, 'async sendDM(peerHex, content) {', 'sendDM');
  const fin = (body.match(/\b(finalizeEvent\d*)\(/) || [])[1];
  assert.ok(fin, 're-anchor: sendDM no longer signs an event');
  scope[fin] = finalizeEvent;
  return { send: lift({ anchor: 'async sendDM(peerHex, content) {', name: 'sendDM' }, scope), published };
}

test('the console sends NIP-44, which the member app reads first', async () => {
  const s = sender();
  const evt = await s.send(MEMBER, 'Thank you — we have your message');
  assert.ok(evt && s.published.length === 1, 're-anchor: sendDM did not publish');
  const ct = s.published[0].content;
  assert.ok(!ct.includes('?iv='), 'THE CONSOLE STILL SENDS DEPRECATED NIP-04');
  assert.equal(Buffer.from(ct, 'base64')[0], 2, 'expected a NIP-44 v2 payload');
  assert.equal(nip44d(ct, nip44ck(memberSk, CHURCH)), 'Thank you — we have your message',
    'the member cannot open what the console sent');
});
