// A RELAY MUST PROVE IT HOLDS THE KEY IT ADVERTISES. Run: node --test scripts/a-relay-proves-the-key-it-advertises.test.mjs
//
// THE ATTACK THIS EXISTS TO STOP, in one sentence: today a relay's identity is a bare string on an
// unauthenticated GET — `relayPub` in `/status` and in the NIP-11 document — so anyone can copy a real
// relay's `/status` onto their own host and be believed to be that relay. Every gate the closed-network plan
// builds on "which relay is this?" is decoration until that stops, which is why this lands before any of
// them. The fourth test below stages exactly that impersonation and is the one to read first.
//
// WHAT IS REAL HERE AND WHAT IS NOT:
//   • The relay is a real `node scripts/gateway.mjs` on a port obtained by binding one, with its own temp
//     data directory and its own freshly generated identity key (harness `startRelay`).
//   • The verifier is lifted out of BOTH SHIPPED BUNDLES — `vendor/fellowship.js` and `vendor/steward.js` —
//     and executed, not read. A test that re-implemented the check would pass its own sabotage, and this
//     repo has shipped that mistake. The two bundles are checked separately because the member app and the
//     console are built independently and have drifted before.
//   • The impostors are real HTTP hosts (harness `startImpostor`). They have to be: the thing under test is
//     a stranger's box copying a real relay's answers, and a relay handle cannot play that part — it holds a
//     key, which is the whole thing an impostor lacks.
//
// NOTHING CONSUMES THIS YET, and these tests deliberately assert nothing about which relays anything talks
// to. The endpoint and the verifier are C2; the gates that read them are C3/C4, with an audit between,
// because a relay older than this cannot answer and would drop out of its own church's network the day
// something started requiring an answer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey, getEventHash, verifyEvent } from 'nostr-tools/pure';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

// ── the verifier, out of the bundles that actually ship ─────────────────────────────────────────────────
// esbuild renames an import when the name is already taken in the bundle: both bundles carry TWO copies of
// nostr-tools' pure module, so the verifier's `verifyEvent` is emitted as `verifyEvent2`. Which suffix it
// lands on is a build detail, so bind BOTH names to the real library function rather than pinning one — and
// assert the lifted body actually calls one of them, so a verifier that stopped checking signatures at all
// cannot slip through as "well, it did not reference the name".
//
// The library IS injected, and that is not a stub: `verifyEvent` is nostr-tools', identical to the one the
// bundle would have used. Everything the test is NAMED after — the nonce check, the freshness window, the
// shape checks, the fail-closed — is lifted and run.
function lift(file) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const body = [
    // RELAY_PROOF_WINDOW_SEC is no longer sliced: verifyRelayIdentity stopped consulting a clock
    // (audit 2026-09-02 #1 — a phone 5 min out could admit no relay at all), so esbuild tree-shakes
    // the constant out of the bundles entirely. Slicing a name that is no longer there makes the
    // lift THROW, and a test that dies prints no failure — it reads like a pass. See CLAUDE.md.
    fnBody(src, 'function relayIdentityNonce', 'relayIdentityNonce'),
    fnBody(src, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(src, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(src, 'async function verifyRelayIdentity', 'verifyRelayIdentity'),
  ].join('\n');
  assert.match(body, /verifyEvent2?\(ev\)/,
    `${file}'s verifyRelayIdentity does not verify the event signature at all`);
  // The freshness of this exchange is the NONCE, not a clock (see the note in relay-identity.src.js).
  // Assert the lifted body still checks it — that is the line a regression would quietly drop.
  // quote-agnostic: src is single-quoted, esbuild emits double
  assert.match(body, /tag\(["']nonce["']\)/,
    `${file}'s verifyRelayIdentity does not check the nonce, which is the only freshness it has`);
  const api = new Function('verifyEvent', 'verifyEvent2', 'fetch',
    body + '\nreturn { verifyRelayIdentity, relayIdentityNonce };'
  )(verifyEvent, verifyEvent, globalThis.fetch);
  return api;
}
const BUNDLES = ['vendor/fellowship.js', 'vendor/steward.js'];
const verifiers = BUNDLES.map(f => [f, lift(f)]);

const hex32 = () => bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
const nonceOf = (ev) => String((ev.tags.find(t => t[0] === 'nonce') || [])[1] || '');
// Ask the relay itself, over HTTP, exactly the way the verifier does — used where the test needs the RAW
// answer (to capture one for replay, or to compare two answers) rather than the verdict.
async function askRelay(base, nonce) {
  const r = await fetch(`${base}/relay-identity?nonce=${nonce}`);
  return { status: r.status, body: r.ok ? await r.json() : null };
}

// A well-formed kind-27235 proof with an arbitrary pubkey in it, signed by an arbitrary key. This is how an
// impostor is built: it puts the pubkey it wants to CLAIM in the event and signs with the key it actually
// has. `finalizeEvent` cannot express that (it derives the pubkey from the key), so the event is assembled
// and hashed by hand — the id is computed for the CLAIMED pubkey, so the only thing wrong with it is the
// signature, which is precisely the case under test.
function proofClaiming(claimPub, signWithSk, nonce, url, createdAt) {
  const ev = { kind: 27235, pubkey: claimPub, created_at: createdAt ?? Math.floor(Date.now() / 1000),
    tags: [['u', 'relay-identity'], ['method', 'GET'], ['nonce', nonce], ['relay', url]], content: '' };
  ev.id = getEventHash(ev);
  ev.sig = bytesToHex(schnorr.sign(hexToBytes(ev.id), signWithSk));
  return ev;
}

let R, statusPub;
before(async () => {
  R = await H.startRelay({ name: 'R' });
  statusPub = (await R.status()).relayPub;
});
after(() => H.stopAll());

// ── 1. the happy path ───────────────────────────────────────────────────────────────────────────────────
test('a fresh nonce verifies, and proves the key the relay advertises', async () => {
  assert.match(statusPub || '', /^[0-9a-f]{64}$/, 'the relay did not advertise a relayPub at all');
  for (const [file, v] of verifiers) {
    const got = await v.verifyRelayIdentity(R.base);
    assert.ok(got, `${file}: a real relay could not prove its own identity`);
    assert.equal(got.relayPub, statusPub,
      `${file}: the key the relay PROVED is not the key it advertises in /status`);
    // UPDATED 2026-09-02, when the address binding landed. This used to read "the signed URL is carried,
    // not gated on" — it is now GATED on, because a forwarder that runs none of our software could
    // otherwise pass a genuine proof along and take the socket itself. The relay signs the address it
    // DECLARES, in the canonical ws:// form, so the expectation is that form and not the http:// spelling
    // the caller happened to dial. The scheme is deliberately not compared (see relayAddrKey).
    assert.equal(got.url, R.base.replace(/^http:/, 'ws:'),
      `${file}: the proof did not bind the relay's own declared address`);
  }
});

// ── 2. THE ONE THAT MATTERS ─────────────────────────────────────────────────────────────────────────────
// A captured proof is the cheapest possible attack: no key, no compromise, just a copy of an answer the
// relay gave somebody else. Two halves, because both must hold — the verifier must refuse a stale proof,
// AND the relay must never hand one out in the first place.
test('a replayed proof is rejected', async () => {
  // (a) capture a GENUINE proof. If this is not genuine the rest of the test proves nothing.
  const captured = hex32();
  const first = await askRelay(R.base, captured);
  assert.equal(first.status, 200);
  const P = first.body.proof;
  assert.equal(P.kind, 27235);
  assert.equal(nonceOf(P), captured, 'the relay did not bind the nonce it was asked with');
  assert.ok(verifyEvent(JSON.parse(JSON.stringify(P))), 'the captured proof is not even validly signed');
  assert.equal(P.pubkey, statusPub);

  // (b) THE RELAY ITSELF never answers a new question with an old answer. This is the half the required
  // sabotage (a static pre-signed event) turns red: a relay serving one fixed proof passes every signature
  // check in the world and fails here.
  const second = await askRelay(R.base, hex32());
  assert.notEqual(second.body.proof.id, P.id,
    'the relay served the SAME proof for a different nonce — a captured answer would be valid for ever');
  assert.notEqual(nonceOf(second.body.proof), captured);

  // (c) THE VERIFIER refuses that captured proof when a host serves it back. This is the impostor with the
  // best material available to it short of the key.
  const replayer = await H.startImpostor({
    name: 'replayer',
    handler: (req, res) => H.sendJson(res, { proof: P }),
  });
  for (const [file, v] of verifiers) {
    assert.equal(await v.verifyRelayIdentity(replayer.base), null,
      `${file}: a host replaying a proof the real relay gave somebody else was accepted`);
  }

  // (d) and the relay refuses to sign over a degenerate nonce, which would make (b) and (c) moot: a host
  // that once saw the proof for nonce "" could otherwise serve it to every lazy caller for ever.
  for (const bad of ['', 'zz', '0', 'a'.repeat(31), 'a'.repeat(33), '../../etc']) {
    const r = await fetch(`${R.base}/relay-identity?nonce=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, `the relay signed a proof over a bad nonce (${JSON.stringify(bad)})`);
  }
  replayer.stop();
});

// ── 3. a signature by some other key is not a proof of THIS key ─────────────────────────────────────────
test('a proof signed by a different key fails', async () => {
  const other = generateSecretKey();
  const otherPub = getPublicKey(other);
  assert.notEqual(otherPub, statusPub);

  // The impostor claims the relay's pubkey, answers the caller's own nonce, is perfectly fresh, and has a
  // correctly computed id. It simply does not hold the key, so the signature is its own.
  const liar = await H.startImpostor({
    name: 'liar',
    handler: (req, res, u) => H.sendJson(res, { proof: proofClaiming(statusPub, other, u.searchParams.get('nonce') || '', R.base) }),
  });
  for (const [file, v] of verifiers) {
    assert.equal(await v.verifyRelayIdentity(liar.base), null,
      `${file}: an event CLAIMING the relay's pubkey but signed by another key was accepted as proof of it`);
  }
  liar.stop();

  // The mirror image, so the failure above is the signature and not something incidental: the same host
  // signing HONESTLY as itself does verify — and comes back as ITS key, never as the relay's.
  // UPDATED 2026-09-02: this stranger now signs THE ADDRESS IT IS ACTUALLY SERVING AT. It used to sign a
  // fixed 'http://honest.invalid', which was fine while the signed address was carried but not checked;
  // under the address binding that is indistinguishable from a forwarder and is refused. Signing its own
  // address keeps the case doing its real job — proving the refusal above is about the SIGNATURE and not
  // something incidental — rather than accidentally re-testing the binding.
  let honestBase = '';
  const honest = await H.startImpostor({
    name: 'honest-stranger',
    handler: (req, res, u) => H.sendJson(res, { proof: proofClaiming(otherPub, other, u.searchParams.get('nonce') || '', honestBase) }),
  });
  honestBase = honest.base;
  for (const [file, v] of verifiers) {
    const got = await v.verifyRelayIdentity(honest.base);
    assert.ok(got, `${file}: a correctly signed proof by a stranger's own key did not verify at all`);
    assert.equal(got.relayPub, otherPub);
    assert.notEqual(got.relayPub, statusPub,
      `${file}: proving SOME key was treated as proving the relay's key`);
  }
  honest.stop();

  // AN OLD CLOCK IS NOT A FAILED PROOF, and this block used to assert the opposite.
  //
  // Two things were wrong with the assertion that replaced it. The rule changed: verifyRelayIdentity no
  // longer consults a clock at all, because requiring one meant a phone five minutes out could admit NO
  // relay and every send failed telling the member to speak to a leader (audit 2026-09-02 #1).
  //
  // And it never tested what it was named for. The fixture signed the `relay` tag as 'http://stale.invalid'
  // while the test dialled `stale.base`, so the proof was refused by the ADDRESS BINDING several lines
  // earlier and never reached the freshness check. It would have passed with the window deleted. Dial the
  // address the proof actually names, so the clock is the only thing left under test.
  const skewed = await H.startImpostor({
    name: 'skewed',
    handler: (req, res, u) => H.sendJson(res, { proof: proofClaiming(otherPub, other, u.searchParams.get('nonce') || '', skewed.base, Math.floor(Date.now() / 1000) - 900) }),
  });
  const ahead = await H.startImpostor({
    name: 'ahead',
    handler: (req, res, u) => H.sendJson(res, { proof: proofClaiming(otherPub, other, u.searchParams.get('nonce') || '', ahead.base, Math.floor(Date.now() / 1000) + 900) }),
  });
  for (const [file, v] of verifiers) {
    const behind = await v.verifyRelayIdentity(skewed.base);
    assert.ok(behind, `${file}: a proof 15 minutes BEHIND was refused — a phone with a slow clock can admit no relay`);
    assert.equal(behind.relayPub, otherPub);
    const fwd = await v.verifyRelayIdentity(ahead.base);
    assert.ok(fwd, `${file}: a proof 15 minutes AHEAD was refused — the same lockout with the sign flipped`);
    assert.equal(fwd.relayPub, otherPub);
  }
  skewed.stop(); ahead.stop();
});

// ── 4. THE WHOLE ATTACK, STAGED ─────────────────────────────────────────────────────────────────────────
// Not a hypothetical: this host copies the real relay's /status verbatim, which is all the evidence of
// identity that exists in the product today, and is therefore indistinguishable from the real relay to
// everything currently shipping. It cannot answer the one question that needs the key.
test('a host that merely echoes /status\'s relayPub cannot produce a proof', async () => {
  const realStatus = await (await fetch(`${R.base}/status`)).text();
  const echo = await H.startImpostor({
    name: 'echo',
    handler: (req, res, u) => {
      if (u.pathname === '/status') { H.sendJson(res, realStatus); return; }
      // It has the pubkey and nothing else, so this is the best it can do: assert the identity the way the
      // product does today, as a bare unsigned string.
      if (u.pathname === '/relay-identity') { H.sendJson(res, { relayPub: statusPub, nonce: u.searchParams.get('nonce') }); return; }
      res.writeHead(404); res.end();
    },
  });

  // The impersonation is COMPLETE at today's level of evidence — say it out loud, because if this assertion
  // ever fails the test below has stopped being about impersonation.
  const echoed = await (await fetch(`${echo.base}/status`)).json();
  assert.equal(echoed.relayPub, statusPub,
    'the echo host did not manage to claim the relay\'s identity, so this test is no longer staging the attack');

  for (const [file, v] of verifiers) {
    assert.equal(await v.verifyRelayIdentity(echo.base), null,
      `${file}: a host that only copied /status was accepted as the relay it copied`);
  }

  // The same host with no /relay-identity route at all — an un-upgraded relay, or a stranger's box. Also no.
  const silent = await H.startImpostor({
    name: 'silent',
    handler: (req, res, u) => { if (u.pathname === '/status') { H.sendJson(res, realStatus); return; } res.writeHead(404); res.end(); },
  });
  for (const [file, v] of verifiers) {
    assert.equal(await v.verifyRelayIdentity(silent.base), null,
      `${file}: a host with no /relay-identity endpoint was accepted`);
  }
  echo.stop(); silent.stop();
});

// ── 5. teardown, asserted rather than assumed ───────────────────────────────────────────────────────────
test('teardown leaves no process, directory or impostor behind', async () => {
  H.stopAll();
  assert.deepEqual(H.leftovers(), { processes: [], dirs: [], impostors: [] },
    'the harness left processes, directories or impostor hosts behind');
});
