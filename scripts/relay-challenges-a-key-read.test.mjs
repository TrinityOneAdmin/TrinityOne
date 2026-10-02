// THE RELAY CHALLENGES ANY SOCKET THAT ASKS FOR A KEY ENVELOPE — WHETHER OR NOT ONE EXISTS — AND NOTHING ELSE NEW.
//   Run: node --test scripts/relay-challenges-a-key-read.test.mjs
//
// THE DEFECT (measured 2026-10-02). The relay challenges lazily (NIP-42): an unauthenticated REQ is sent an AUTH
// frame only when the relay WITHHELD something from it, or the filter names invite-only content or a safety-check
// d-tag. A brand-new church has no key envelopes yet, so a console asking for them is answered "nothing" and never
// challenged — and without signing in it can never mint the keys it is asking about.
//
// THE FIX under test, in the REQ handler (`wantsKeyD`, scripts/gateway.mjs): a filter that names a key-envelope
// d-tag is challenged from the FILTER, exactly as `wantsSafetyD` is, whether or not anything matched. It changes
// who is ASKED to sign in; it does not change who is SERVED anything (canRead is untouched) and it does not touch
// which relays a church talks to (CLAUDE.md rule 10) — it is a frame the relay sends to a socket that connected
// to it.
//
// WHAT EACH ROW WOULD CATCH
//   · `|| wantsKeyD` dropped from the challenge condition            → "every key-envelope d-tag is challenged" red;
//   · a key-envelope type missing from KEY_ENVELOPE_D (one is dropped in the second sabotage case) → the same row
//     red: the set is DERIVED HERE from the doc registry (every D.*KEY), so a type added there and not in the
//     relay fails, not just a type removed from it;
//   · the clause widened to a d-tag that is not a key (the "ordinary reads are NOT challenged" row) → red;
//   · the challenge starting to serve: the "a challenge serves nothing" row publishes a real envelope and asks
//     for it without signing in.
//
// A real gateway on a FREE port, raw WebSocket clients — no browser, so this file never skips.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, nip44 } from 'nostr-tools';
import * as H from './relay-network-harness.mjs';
import { rawReq } from './new-church-session.mjs';
import { D } from './trinity-doc-types.mjs';
import { WebSocket } from 'ws';

let relay;
const church = H.key();
// every document type in the registry that is a KEY ENVELOPE, by the registry's own naming (NAMEKEY, CAREKEY, …)
const KEY_TYPES = Object.entries(D).filter(([name]) => /KEY$/.test(name));

before(async () => { relay = await H.startRelay({ name: 'keychallenge', churches: [church.pub] }); });
after(() => { try { H.stopAll(); } catch {} });

test('the registry still has the key-envelope types this relay is expected to challenge (guards the derivation below)', () => {
  assert.deepEqual(KEY_TYPES.map(([n]) => n).sort(), ['CAREKEY', 'CHECKINKEY', 'FINANCEKEY', 'GROUPKEY', 'MEDIAKEY', 'NAMEKEY'],
    'the registry\'s key-envelope types changed — decide whether the relay should challenge the new one (KEY_ENVELOPE_D in scripts/gateway.mjs) and update this list');
});

test('every key-envelope d-tag is challenged when asked for unauthenticated — even when nothing matches', { timeout: 60000 }, async () => {
  for (const [name, prefix] of KEY_TYPES) {
    const t0 = Date.now();
    const r = await rawReq(relay, { kinds: [30078], '#d': [prefix + church.pub] });
    assert.equal(r.auth, true, `an unauthenticated REQ for ${name} (${prefix}) got no AUTH challenge although the document does not exist — a brand-new church's console is never asked to sign in`);
    assert.equal(r.events, 0, `${name}: nothing exists, so nothing may be served`);
    assert.ok(Date.now() - t0 < 2500, `${name}: the EOSE was held for ${Date.now() - t0} ms — the challenge must not delay an answer that is simply empty`);
  }
});

test('ordinary reads are NOT challenged — the lazy-auth decision stands', { timeout: 60000 }, async () => {
  const asks = [
    ['kind 1 browsing', { kinds: [1], limit: 5 }],
    ['kind 0 profiles', { kinds: [0], limit: 5 }],
    ['the church\'s public join policy', { kinds: [30078], '#d': ['trinityone/joinpolicy:' + church.pub] }],
    ['a per-session helper grant (not a church\'s key)', { kinds: [30078], '#d': ['trinityone/checkinhelper:some-session'] }],
    ['the church\'s own documents by tag', { kinds: [30078], authors: [church.pub], '#t': ['trinityone'] }],
  ];
  for (const [what, filter] of asks) {
    const r = await rawReq(relay, filter);
    assert.equal(r.auth, false, `${what}: a plain read was challenged — every member would now pay an auth round-trip to browse (${JSON.stringify(filter)})`);
  }
});

test('a challenge serves nothing: the envelope is there, the unauthenticated asker is challenged and is still handed none of it', { timeout: 60000 }, async () => {
  const ck = nip44.v2.utils.getConversationKey(church.sk, church.pub);
  const env = finalizeEvent({ kind: 30078, created_at: H.now(), tags: [['d', 'trinityone/namekey:' + church.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: { [church.pub]: nip44.v2.encrypt(JSON.stringify(['ab'.repeat(32)]), ck) }, rev: 1 }) }, church.sk);
  await H.publishAll(relay, [env]);
  const r = await rawReq(relay, { kinds: [30078], '#d': ['trinityone/namekey:' + church.pub] });
  assert.equal(r.auth, true, 'asking for an envelope that exists was not challenged');
  assert.equal(r.events, 0, 'the relay served a key envelope to a socket that has not signed in');
});

test('a socket that has signed in is not challenged again', { timeout: 60000 }, async () => {
  const challenges = await new Promise((resolve, reject) => {
    const w = new WebSocket(relay.wsUrl); let signedIn = false, challenges = 0;
    const timer = setTimeout(() => { try { w.close(); } catch {} reject(new Error('timed out: challenges=' + challenges + ' signedIn=' + signedIn)); }, 10000);
    w.on('message', (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') { challenges++; if (challenges === 1) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: H.now(), tags: [['relay', relay.wsUrl], ['challenge', m[1]]], content: '' }, church.sk)])); }
      else if (m[0] === 'OK' && m[2] && !signedIn) { signedIn = true; w.send(JSON.stringify(['REQ', 'again', { kinds: [30078], '#d': ['trinityone/carekey:' + church.pub] }])); }
      else if (m[0] === 'EOSE' && m[1] === 'again') { setTimeout(() => { clearTimeout(timer); try { w.close(); } catch {} resolve(challenges); }, 300); }
    });
    w.on('open', () => w.send(JSON.stringify(['REQ', 'first', { kinds: [30078], '#d': ['trinityone/carekey:' + church.pub] }])));
    w.on('error', reject);
  });
  assert.equal(challenges, 1, 'a socket that had signed in was challenged ' + challenges + ' times');
});
