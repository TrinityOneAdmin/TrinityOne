// A REPLY MUST REACH WHOEVER THE REQUEST REACHED — not whoever happens to be on the care rota.
// Run: node --test scripts/care-thread-reaches-request-audience.test.mjs
//
// Measured on the OPPO against the live relay, 2026-08-27, and this is not a hypothetical:
//   - Dorothy, 15, marked as a child, asked for help. Her request sealed to the church key and to the one
//     adult the church had cleared for youth work — Bram, who is NOT on the care rota. Correct.
//   - Bram opened it under "FROM A YOUNG PERSON · CONFIDENTIAL" and messaged her. She read it and replied.
//   - Her reply was sealed to [church, her, her, ...the care rota]. The relay SERVED the event to Bram —
//     it appeared in his own authenticated query — but he held no wrapped key, so `_openSealed` returned null
//     and `subscribeCareChat` dropped it as if it had never been said. Her phone showed it sent.
//
// The child answers the one adult who reached out, and nobody comes. The same seal also wrapped her words, in
// openable form, for the whole care rota — the exact group the feature exists to keep out. That church had
// `adminGroupId: ""`, no care team at all, which makes it the DEFAULT configuration and not an edge case.
//
// The fix does not try to detect a child. It cannot: publishCareRequest branches on `_sgSelf.isMinor`, which
// is the ASKER's own status, and in a thread the sender is usually the adult. Instead the reply reuses the
// request's own recipient list, which `_sealToPubs` leaves in the event in clear as `{ keys: {pub: wrapped} }`.
// So the thread reaches exactly whoever the request reached, by construction, for adult and child alike.
//
// These tests RUN the shipped functions with real nip44 crypto and decrypt the result with each person's own
// key. A source-text test would not do: a pre-push audit defeated a string-matching test on this same feature
// by moving the value into an unused variable, and every assertion stayed green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { encrypt as nip44e, decrypt as nip44d, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import { stripComments } from './test-slice.mjs';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const VEN = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const MEALS_SRC = readFileSync(new URL('../src/steward-meals.src.js', import.meta.url), 'utf8');
const MEALS_VEN = readFileSync(new URL('../vendor/steward-meals.js', import.meta.url), 'utf8');

const slice = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `re-anchor: could not find ${JSON.stringify(from)}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `re-anchor: could not find ${JSON.stringify(to)} after it`);
  return src.slice(a, b);
};

const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();      // the console
const ellie  = K();      // 15, marked as a child
const grace  = K();      // cleared for youth work. NOT on the care rota.
const rota   = K();      // an ordinary care-team member. Cleared for nothing.
const hexOf  = (b) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

// Build the fixture the way the app does: a child's request sealed to [church, ellie, grace] and NOT to rota.
function sealTo(authorSk, recips, bodyObj) {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const keyHex = hexOf(keyBytes);
  const enc = nip44e(JSON.stringify(bodyObj), keyBytes);
  const keys = {};
  for (const p of [...new Set(recips)]) keys[p] = nip44e(keyHex, nip44ck(authorSk, p));
  return { keys, enc };
}
const openAs = (readerSk, readerPub, o, authorPub) => {
  const mine = o && o.keys && o.keys[readerPub];
  if (!mine) return null;
  try {
    const kh = nip44d(mine, nip44ck(readerSk, authorPub));
    return JSON.parse(nip44d(o.enc, Uint8Array.from(kh.match(/../g).map(h => parseInt(h, 16)))));
  } catch (e) { return null; }
};

const REQ_ID = 'abc123';
const CHILD_REQUEST = sealTo(ellie.sk, [church.pub, ellie.pub, grace.pub], { note: 'please can someone help' });

// ── build a runnable sendCareChat out of the SHIPPED SOURCE ──────────────────────────────────────────────
function buildSender({ requestEvent }) {
  const audienceFn = slice(SRC, 'async function _fetchCareThreadAudience(', '\n}\n') + '\n}';
  const sealFn = slice(SRC, 'function _sealToPubs(', '\n}\n') + '\n}';
  const method = slice(SRC, '  async sendCareChat(reqId, requesterPub, text) {', '  subscribeCareChat(reqId, cb) {');
  const published = [];
  const pool = { querySync: async () => (requestEvent ? [requestEvent] : []) };
  const fn = new Function(
    'pool', 'churchRelays', 'CAREREQ_D', 'CARECHAT_D', 'NET', 'sk', 'pub', 'window', 'crypto',
    'nip44e', 'nip44ck', '_hex', 'finalizeEvent', '_publishAny', 'published',
    `${audienceFn}\n${sealFn}\nconst api = { ${method} __end(){} };\nreturn api.sendCareChat;`
  )(
    pool, () => ['ws://x'], 'trinityone/carereq:', 'trinityone/carechat:', 'trinityone',
    grace.sk, grace.pub,
    { Fellowship: { churchPub: church.pub, ready: Promise.resolve() } },
    crypto, nip44e, nip44ck, hexOf,
    (e) => ({ ...e, pubkey: grace.pub, id: 'evt' }),
    async (_r, evt) => { published.push(evt); return true; },
    published,
  );
  return { send: fn, published };
}

test('the cleared adult can open the child’s reply — the whole point', async () => {
  // Ellie replies. Run it as ELLIE by rebuilding with her keys.
  const audienceFn = slice(SRC, 'async function _fetchCareThreadAudience(', '\n}\n') + '\n}';
  const sealFn = slice(SRC, 'function _sealToPubs(', '\n}\n') + '\n}';
  const method = slice(SRC, '  async sendCareChat(reqId, requesterPub, text) {', '  subscribeCareChat(reqId, cb) {');
  const published = [];
  const reqEvent = { created_at: 100, pubkey: ellie.pub, content: JSON.stringify(CHILD_REQUEST) };
  const send = new Function(
    'pool', 'churchRelays', 'CAREREQ_D', 'CARECHAT_D', 'NET', 'sk', 'pub', 'window', 'crypto',
    'nip44e', 'nip44ck', '_hex', 'finalizeEvent', '_publishAny',
    `${audienceFn}\n${sealFn}\nconst api = { ${method} __end(){} };\nreturn api.sendCareChat;`
  )(
    { querySync: async () => [reqEvent] }, () => ['ws://x'],
    'trinityone/carereq:', 'trinityone/carechat:', 'trinityone',
    ellie.sk, ellie.pub,
    { Fellowship: { churchPub: church.pub, ready: Promise.resolve() } },
    crypto, nip44e, nip44ck, hexOf,
    (e) => ({ ...e, pubkey: ellie.pub, id: 'evt' }),
    async (_r, evt) => { published.push(evt); return true; },
  );

  const out = await send(REQ_ID, ellie.pub, 'Yes please — could someone visit on Saturday?');
  assert.ok(out, 'the reply was not sent at all');
  assert.equal(published.length, 1, 'expected exactly one published event');

  const sealed = JSON.parse(published[0].content);
  const body = openAs(grace.sk, grace.pub, sealed, ellie.pub);
  assert.ok(body, 'THE CLEARED YOUTH WORKER CANNOT OPEN THE CHILD’S REPLY. She answered the one adult who ' +
    'reached out and his app will drop her message as though it was never said.');
  assert.equal(body.text, 'Yes please — could someone visit on Saturday?');
});

test('and the care rota, who were never in the request, are not given a key to it', async () => {
  const audienceFn = slice(SRC, 'async function _fetchCareThreadAudience(', '\n}\n') + '\n}';
  const sealFn = slice(SRC, 'function _sealToPubs(', '\n}\n') + '\n}';
  const method = slice(SRC, '  async sendCareChat(reqId, requesterPub, text) {', '  subscribeCareChat(reqId, cb) {');
  const published = [];
  const reqEvent = { created_at: 100, pubkey: ellie.pub, content: JSON.stringify(CHILD_REQUEST) };
  const send = new Function(
    'pool', 'churchRelays', 'CAREREQ_D', 'CARECHAT_D', 'NET', 'sk', 'pub', 'window', 'crypto',
    'nip44e', 'nip44ck', '_hex', 'finalizeEvent', '_publishAny',
    `${audienceFn}\n${sealFn}\nconst api = { ${method} __end(){} };\nreturn api.sendCareChat;`
  )(
    { querySync: async () => [reqEvent] }, () => ['ws://x'],
    'trinityone/carereq:', 'trinityone/carechat:', 'trinityone',
    ellie.sk, ellie.pub,
    { Fellowship: { churchPub: church.pub, ready: Promise.resolve() } },
    crypto, nip44e, nip44ck, hexOf,
    (e) => ({ ...e, pubkey: ellie.pub, id: 'evt' }),
    async (_r, evt) => { published.push(evt); return true; },
  );
  await send(REQ_ID, ellie.pub, 'something private');
  const sealed = JSON.parse(published[0].content);
  assert.equal(sealed.keys[rota.pub], undefined,
    'a child’s words are key-wrapped, in openable form, for the care rota — the exact group this feature ' +
    'exists to keep out');
  assert.ok(sealed.keys[church.pub], 'the church key must keep a copy — the office is the route of last resort');
});

test('when the request cannot be read, it REFUSES — it does not fall back to the care team', async () => {
  const { send, published } = buildSender({ requestEvent: null });
  const out = await send(REQ_ID, ellie.pub, 'hello');
  assert.equal(out, null, 'a send that could not establish its audience reported success');
  assert.equal(published.length, 0,
    'it published anyway. Falling back to the care rota is the defect this file exists to prevent — a silent ' +
    'wide seal on a child’s thread is worse than a send that visibly fails.');
});

test('the console sends the same way — both halves of the app must agree', () => {
  const fn = stripComments(slice(MEALS_SRC, 'async function sendCareChat(', '\n  }\n'));
  assert.match(fn, /CAREREQ_D \+ reqId/,
    'the console still seals a reply to the care-team roster, so a steward answering a young person produces ' +
    'a message the cleared adult handling it cannot open');
  assert.doesNotMatch(fn, /CARETEAM_D/,
    'the console still consults the care-team roster to decide who a reply reaches');
});

test('the shipped bundles carry it', () => {
  assert.match(VEN, /_fetchCareThreadAudience/,
    'vendor/fellowship.js predates this fix — run: npm run build:fellowship');
  assert.match(MEALS_VEN, /carereq:/,
    'vendor/steward-meals.js predates this fix — run: bash scripts/build-steward-meals.sh');
});
