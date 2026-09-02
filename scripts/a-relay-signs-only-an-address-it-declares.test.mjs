// A FORWARDER RUNS NONE OF OUR SOFTWARE, AND USED TO PASS THE TEST ANYWAY.
//
// The whole product rule is "only TrinityOne software talks to TrinityOne software", and the proof of
// possession was how a box demonstrated it. But a host that forwards `/relay-identity` to a genuine relay
// gets a genuine, correctly-signed, correctly-nonced proof and hands it straight back. It has learned no key
// and forged nothing — and the church's corpus, and every member's IP address, then land on a box running a
// reverse proxy. Answering the question was never the same as being the thing.
//
// So a relay now DECLARES the addresses it answers at and refuses to sign any other, and the client checks
// that the address in the proof is the one it dialled. Both halves are required: a `Host` header is chosen
// by whoever stands in front of the box, so without the declaration a forwarder simply sends our own name.
//
// EVERY PARTICIPANT HERE IS REAL — a spawned `scripts/gateway.mjs` and a genuine forwarding proxy in front
// of it. The attack cannot be staged with a stub, because the entire point is that the proof it relays is
// authentic.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';

// Lift the SHIPPED verifier out of each bundle, so this tests what a phone and a console actually run.
function lift(file) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const grab = (anchor, name) => {
    const i = src.indexOf(anchor);
    assert.ok(i >= 0, `${file}: ${name} is not in the bundle — the lift anchor moved`);
    let depth = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
    }
    throw new Error(`${file}: unbalanced braces lifting ${name}`);
  };
  const body = [
    grab('function relayIdentityNonce', 'relayIdentityNonce'),
    grab('function relayHttpBase', 'relayHttpBase'),
    grab('function relayAddrKey', 'relayAddrKey'),
    grab('async function verifyRelayIdentity', 'verifyRelayIdentity'),
  ].join('\n');
  // Prove the lifted code really is the binding, not a version that carries the address without checking it.
  assert.match(body, /relayAddrKey\(/, `${file}: the lifted verifier never calls relayAddrKey — nothing is bound`);
  return new Function('verifyEvent', 'verifyEvent2', 'fetch', 'RELAY_PROOF_WINDOW_SEC',
    body + '\nreturn { verifyRelayIdentity, relayAddrKey };')(verifyEvent, verifyEvent, globalThis.fetch, 300);
}
const verifiers = [['vendor/fellowship.js', lift('vendor/fellowship.js')], ['vendor/steward.js', lift('vendor/steward.js')]];

let REAL;
before(async () => { REAL = await H.startRelay({ name: 'real' }); });
after(() => H.stopAll());

test('a real relay proves itself at the address it was dialled on', async () => {
  for (const [file, v] of verifiers) {
    const got = await v.verifyRelayIdentity(REAL.wsUrl);
    assert.ok(got, `${file}: a genuine relay could not prove itself at its own ws address`);
    assert.equal(got.relayPub, REAL.relayPub, `${file}: proved the wrong key`);
    assert.equal(v.relayAddrKey(got.url), v.relayAddrKey(REAL.wsUrl),
      `${file}: the proof named an address other than the one dialled`);
  }
});

test('a forwarder in front of a real relay is refused, and gets no proof to forward', async () => {
  // A genuine reverse proxy: no key of its own, and it answers by asking the real relay the SAME question.
  const fwd = await H.startImpostor({
    name: 'forwarder',
    handler: async (req, res, u) => {
      if (!u.pathname.startsWith('/relay-identity')) return H.sendJson(res, { error: 'not a relay' }, 404);
      const qs = u.searchParams.toString();
      const r = await fetch(REAL.base + '/relay-identity?' + qs);
      H.sendJson(res, await r.json(), r.status);
    },
  });
  try {
    // (a) THE RELAY REFUSES TO SIGN. The forwarder asks on its own behalf; the address it names is not one
    //     this box declares, so there is no proof to pass on. This is the half a Host header would defeat.
    const direct = await fetch(REAL.base + '/relay-identity?nonce=' + 'ab'.repeat(16) +
      '&for=' + encodeURIComponent(fwd.base + '/relay'));
    assert.equal(direct.status, 421,
      'the relay signed an address it does not declare. A forwarder can then have its OWN address signed by ' +
      'somebody else\'s key, which is the forwarding hole in one step.');
    const body = await direct.json();
    assert.equal(body.code, 'undeclared-address', 'the refusal is not machine-readable for an operator');

    // (b) AND THE CLIENT REFUSES. Belt and braces: even were a proof obtained, it names the real relay's
    //     address and not the forwarder's, so the dialled-address check rejects it.
    for (const [file, v] of verifiers) {
      assert.equal(await v.verifyRelayIdentity(fwd.base + '/relay'), null,
        `${file}: a forwarder that runs NONE of our software was accepted as a TrinityOne relay.`);
    }
  } finally { fwd.stop(); }
});

test('a forwarder that rewrites Host to the real relay is still refused by the client', async () => {
  // The other variant: the proxy makes the real relay sign the real relay's OWN name, which succeeds. What
  // it cannot do is make that equal the address the client dialled — which is the proxy's.
  const fwd = await H.startImpostor({
    name: 'host-rewriter',
    handler: async (req, res, u) => {
      if (!u.pathname.startsWith('/relay-identity')) return H.sendJson(res, { error: 'not a relay' }, 404);
      const r = await fetch(REAL.base + '/relay-identity?nonce=' + encodeURIComponent(u.searchParams.get('nonce') || '') +
        '&for=' + encodeURIComponent(REAL.wsUrl));
      H.sendJson(res, await r.json(), r.status);
    },
  });
  try {
    // The proof it relays really is valid — otherwise this test is about a broken proxy.
    const raw = await (await fetch(fwd.base + '/relay-identity?nonce=' + 'cd'.repeat(16))).json();
    assert.ok(raw.proof && verifyEvent(raw.proof), 'precondition: the relayed proof is genuinely signed');
    assert.equal((raw.proof.tags.find(t => t[0] === 'relay') || [])[1], REAL.wsUrl,
      'precondition: the relayed proof names the REAL relay, which is what makes it useless to the proxy');
    for (const [file, v] of verifiers) {
      assert.equal(await v.verifyRelayIdentity(fwd.base + '/relay'), null,
        `${file}: a proxy inherited a relay's identity by making it sign its own name.`);
    }
  } finally { fwd.stop(); }
});

test('the path is bound, not just the host — a proxy on another path of the same host is refused', async () => {
  // The quiet variant Fable named: an attacker who controls a DIFFERENT PATH of a legitimate host. Host-only
  // comparison would admit it. The client states the address it intends via `for=`, so the relay can refuse.
  const other = REAL.wsUrl.replace(/\/relay$/, '/not-the-relay');
  const r = await fetch(REAL.base + '/relay-identity?nonce=' + 'ef'.repeat(16) + '&for=' + encodeURIComponent(other));
  assert.equal(r.status, 421, 'the relay signed a path it does not declare');
  for (const [file, v] of verifiers) {
    assert.equal(await v.verifyRelayIdentity(other), null, `${file}: a different path on the same host was admitted`);
  }
});

test('teardown leaves nothing behind', () => {
  H.stopAll();
  const left = H.leftovers();
  assert.deepEqual(left.processes, [], 'a relay process survived');
  assert.deepEqual(left.impostors, [], 'an impostor survived');
});
