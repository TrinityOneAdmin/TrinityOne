// DUAL-CONTROL ANCHORS ON THE KEY THAT SIGNS, NOT ON window.Steward.pubkey.
//   Run: node --test scripts/finance-dual-control-anchors-on-the-signer.test.mjs
//
// THE BUG THIS LOCKS. Dual-control bill approval must compare "who am I?" against "who recorded it?", and the
// relay binds both to the SIGNER of the event (finance/billapproval:<billId>:<approverhex> is refused unless
// e.pubkey === approverhex — see finance-bill-approval-rule.test.mjs). The console's finance screen used
// window.Steward.pubkey as "who am I?". That is the signer ONLY on an owner console. On a DELEGATED console the
// steward's OWN key signs while `pubkey` is the CHURCH it acts for, so the console built an approval address for
// the wrong key, the relay refused it, and NO delegated steward could ever complete a dual-control approval —
// with one steward the whole separation-of-duties feature was dead. (Reproduced on two live consoles 2026-11-03:
// delegated pubkey = church 2d42…, its finance docs signed by its own churchPub 1da6…; the relay stored zero
// billapproval rows.) The fix anchors on the SIGNER by exposing window.Steward.signerPub() === _myOwnPub() ===
// getPublicKey(sk), and the finance screen reads that instead of pubkey.
//
// HOW THIS ASSERTS. It drives the SHIPPED code: _myOwnPub and the signerPub accessor are lifted out of
// vendor/steward.js — the bundle the console actually loads — and RUN. A mirror written here would pass its own
// sabotage (reference: tests-must-drive-shipped-code), so nothing between getPublicKey(sk) and the accessor is
// this file's own copy. It fails if _myOwnPub stops returning the signer, or if signerPub stops delegating to it
// (e.g. reverted to return pubkey/pub). The console-JSX wiring (the three readers) is proven at the point of use
// by the controlled simulation; the relay's approver==signer binding by finance-bill-approval-rule.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// Lift _myOwnPub from the bundle. esbuild renames the imported getPublicKey to getPublicKey2 inside the bundle,
// so the lifted body references getPublicKey2 — we alias it to the real one in scope, and provide sk/pub.
const myOwnPubBody = fnBody(VENDOR, 'function _myOwnPub() {', '_myOwnPub');
assert.match(myOwnPubBody, /getPublicKey\d*\(sk\)/, '_myOwnPub in vendor/steward.js no longer derives from getPublicKey(sk) — re-anchor this test');
function makeMyOwnPub(scope) {
  const s = { getPublicKey, getPublicKey2: getPublicKey, ...scope };
  return new Function('scope', `with (scope) { ${myOwnPubBody} return _myOwnPub; }`)(s);
}

test('owner console: the signer is the church key (pubkey, churchPub and signer all agree)', () => {
  const church = K();
  // setKey(): sk = pub = churchPub. _myOwnPub() === getPublicKey(sk) === churchPub.
  const signer = makeMyOwnPub({ sk: church.sk, pub: church.pub })();
  assert.equal(signer, church.pub, 'owner signer should be the church key');
});

test('DELEGATED console: the signer is the steward’s OWN key, NOT the church it acts for', () => {
  const church = K();     // the church being acted for — this is window.Steward.pubkey in delegated mode
  const steward = K();    // the device's own key — the key that actually signs (sk), == churchPub
  // setActiveIdentity() delegated branch: sk = churchSk (OUR key) = steward.sk; pub = tp (the church).
  const signer = makeMyOwnPub({ sk: steward.sk, pub: church.pub })();
  assert.equal(signer, steward.pub, 'delegated signer should be the steward’s own key (getPublicKey(sk))');
  assert.notEqual(signer, church.pub, 'delegated signer must NOT be the church (pubkey) — that is the bug the fix closes');
});

test('network-identity console: the signer is the network key (getPublicKey(sk)), proving the anchor is sk-derived', () => {
  const network = K();    // sk = networkSk, pub = networkPub; churchPub (a different device key) is NOT the signer
  const signer = makeMyOwnPub({ sk: network.sk, pub: network.pub })();
  assert.equal(signer, network.pub, 'network signer should be getPublicKey(networkSk)');
});

test('window.Steward.signerPub is wired to _myOwnPub (the exposed accessor returns the signer, not pubkey)', () => {
  // Lift the exposed accessor and run it with a sentinel _myOwnPub. If someone rewired signerPub to return
  // this.pubkey / pub instead of _myOwnPub(), this fails — the console would silently go back to the wrong key.
  const body = fnBody(VENDOR, 'signerPub() {', 'signerPub');
  const SENTINEL = 'deadbeef'.repeat(8);
  const fn = new Function('scope', `with (scope) { const o = { ${body} }; return o.signerPub; }`)({ _myOwnPub: () => SENTINEL });
  assert.equal(fn(), SENTINEL, 'window.Steward.signerPub() must return _myOwnPub() (the signer), not another identity field');
});
