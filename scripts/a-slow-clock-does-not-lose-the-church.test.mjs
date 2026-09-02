// A PHONE WITH THE WRONG TIME MUST STILL FIND ITS CHURCH.
// Run: node --test scripts/a-slow-clock-does-not-lose-the-church.test.mjs
//
// AUDIT 2026-09-02 #1. `verifyRelayIdentity` used to require |now - created_at| <= 300s on top of the
// nonce. That one line sat underneath every other protection in the product: a phone whose clock was more
// than five minutes out could admit NO relay at all — not fewer, none — and every send then failed with
// "NOT sent, speak to a leader in person" while nothing on any screen mentioned the clock. A cheap Android
// with no NTP, or a handset flat for a fortnight, is the first audience this product is written for.
//
// It bought nothing either. The freshness of this exchange is the 128-bit CSPRNG nonce: a captured proof
// carries the wrong one and is refused a few lines earlier, and a proof carrying the RIGHT one was minted
// for this call whatever its clock says.
//
// TWO HALVES, because the engine being right is not the feature (CLAUDE.md rule 1):
//   1. the shipped bundles accept a skewed proof, and still refuse a stale-nonce one
//   2. the Relays sheet the member actually reads says "Connected" for that relay — and still says
//      "Not in use" when the verifier says no, which is what proves the screen consults it at all
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyEvent, getEventHash, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { createServer } from 'node:http';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const BUNDLES = ['vendor/fellowship.js', 'vendor/steward.js'];

// Lift the shipped verifier out of the BUNDLE, not out of src — a test that reads src proves nothing about
// what ships. Same slicing idiom as a-relay-proves-the-key-it-advertises.test.mjs.
function slice(src, head, name) {
  const i = src.indexOf(head);
  assert.ok(i >= 0, `${name} not found in the bundle — re-anchor this test`);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
function lift(file) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const body = [
    slice(src, 'function relayIdentityNonce', 'relayIdentityNonce'),
    slice(src, 'function relayHttpBase', 'relayHttpBase'),
    slice(src, 'function relayAddrKey', 'relayAddrKey'),
    slice(src, 'async function verifyRelayIdentity', 'verifyRelayIdentity'),
  ].join('\n');
  return new Function('verifyEvent', 'verifyEvent2', 'fetch',
    body + '\nreturn { verifyRelayIdentity };')(verifyEvent, verifyEvent, globalThis.fetch);
}

// A relay that answers /relay-identity with a correctly signed proof at whatever age we ask for.
async function relayWithClock(skewSec) {
  const sk = generateSecretKey();
  const pub = getPublicKey(sk);
  let base = '';
  const srv = createServer((req, res) => {
    const u = new URL(req.url, base);
    const nonce = u.searchParams.get('nonce') || '';
    const ev = { kind: 27235, pubkey: pub, created_at: Math.floor(Date.now() / 1000) + skewSec,
      tags: [['u', 'relay-identity'], ['method', 'GET'], ['nonce', nonce], ['relay', base]], content: '' };
    ev.id = getEventHash(ev);
    ev.sig = bytesToHex(schnorr.sign(hexToBytes(ev.id), sk));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ proof: ev }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  // unref, or the listener keeps the test runner's loop alive and the file hangs instead of failing —
  // and a run that prints no summary reads like a pass. Ephemeral port (0) so nothing collides with a
  // relay or another suite running on this box.
  srv.unref();
  return { base, pub, stop: () => { try { srv.closeAllConnections?.(); } catch {} srv.close(); } };
}

test('no freshness WINDOW has been reintroduced into the shipped verifier', () => {
  // Kept as its own test on purpose. When this lived inside lift() it tripped first and made every other
  // test in this file fail for one reason, so "it fails against the old bundle" proved nothing about which
  // line was responsible. Separated, the tests below fail on what verifyRelayIdentity actually RETURNS.
  for (const f of BUNDLES) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    const body = slice(src, 'async function verifyRelayIdentity', 'verifyRelayIdentity');
    assert.equal(/RELAY_PROOF_WINDOW_SEC/.test(body), false,
      `${f}: verifyRelayIdentity applies a freshness window again — a phone with a skewed clock will be ` +
      `locked out of every relay, and told to speak to a leader`);
  }
});

test('the shipped bundles admit a relay whose clock is a quarter of an hour out', async () => {
  for (const skew of [-900, +900, -86400]) {
    const r = await relayWithClock(skew);
    for (const f of BUNDLES) {
      const got = await lift(f).verifyRelayIdentity(r.base);
      assert.ok(got, `${f}: a correctly signed proof ${skew}s from our clock was refused — that member ` +
        `can admit no relay at all, and the app tells them to speak to a leader`);
      assert.equal(got.relayPub, r.pub);
    }
    r.stop();
  }
});

test('a proof that answers the wrong question is still refused', async () => {
  // The nonce is what freshness rests on now, so this is the assertion that has to hold.
  const sk = generateSecretKey();
  const pub = getPublicKey(sk);
  let base = '';
  const srv = createServer((req, res) => {
    const ev = { kind: 27235, pubkey: pub, created_at: Math.floor(Date.now() / 1000),
      tags: [['u', 'relay-identity'], ['method', 'GET'], ['nonce', 'deadbeef'.repeat(4)], ['relay', base]], content: '' };
    ev.id = getEventHash(ev);
    ev.sig = bytesToHex(schnorr.sign(hexToBytes(ev.id), sk));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ proof: ev }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  base = 'http://127.0.0.1:' + srv.address().port;
  for (const f of BUNDLES) {
    assert.equal(await lift(f).verifyRelayIdentity(base), null,
      `${f}: a proof carrying somebody else's nonce was accepted — freshness is gone entirely`);
  }
  try { srv.closeAllConnections?.(); } catch {}
  srv.close();
});

// ── POINT OF USE ────────────────────────────────────────────────────────────────────────────────────────
// The member never sees verifyRelayIdentity. What they see is one word on the Relays sheet, and that word
// is the whole feature: "Connected" means their church's traffic is going somewhere.
test('the Relays sheet reads Connected for a skew-verified relay — and Not in use when the verifier says no',
  async () => {
    const r = await relayWithClock(-900);
    const proved = await lift('vendor/fellowship.js').verifyRelayIdentity(r.base);
    assert.ok(proved, 'precondition: the bundle must accept the skewed proof before the screen can show it');

    const render = (verified) => {
      const { React, draw } = miniReact();
      const g = {
        React,
        Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
        // passthroughs: we are asserting on the sheet's own words, not on the chrome around them
        BottomSheet: (p) => p.children,
        Sheet: (p) => p.children,
        IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
        Row: (p) => p.children,
        copyText: () => {},
        window: { Fellowship: { relays: [r.base.replace('http', 'ws') + '/relay'], relayVerified: () => verified },
                  TrinityData: { RELAYS: [] }, addEventListener() {}, removeEventListener() {} },
        document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }),
                    body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
      };
      const { RelaysSheet } = loadScreen('app/identity-extras.jsx', ['RelaysSheet'], g);
      return texts(draw(RelaysSheet, { open: true, onClose() {}, ctx: {} })).join(' ');
    };

    const yes = render(true);
    assert.match(yes, /Connected/,
      'a relay the shipped verifier proved is not shown as Connected — the member is told their church ' +
      'has no relay while it has one');
    // and the screen must actually CONSULT the verifier, or the assertion above passes over a hard-coded word
    const no = render(false);
    assert.match(no, /Not in use/,
      'the sheet says Connected even when the verifier says no — the label is hard-coded and the test above ' +
      'proves nothing');
    r.stop();
  });
