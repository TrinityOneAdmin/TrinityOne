#!/usr/bin/env node
// Verify a Suite JS auto-update bundle's detached Ed25519 signature over the EXACT tarball bytes.
//
//   node scripts/verify-suite-bundle.mjs <bundle.tgz> <bundle.sig> <release-pubkey.pem>
//
// Exit 0 = the signature is good; any non-zero exit = REJECT. The reason is written to stderr.
//
// WHY THIS EXISTS AND WHY IT IS IN NODE (not Rust, not openssl):
//   The Suite's trust root is the pinned Ed25519 release public key that ships in the read-only, OS-signed
//   app payload (relay-app/release-pubkey.pem). The thing we must prove about a downloaded bundle is that it
//   chains to that key. The Rust app shell holds no crypto key and has no portable openssl (not reliably
//   present on Windows/macOS), so it shells out to THIS script with the bundled node — the same node the
//   relay already runs. It reuses the exact crypto path production already trusts for the release manifest
//   (crypto.verify(null, …) — raw Ed25519, algorithm=null; see gateway.mjs fetchSignedApkManifest), so there
//   is ONE verification implementation, used by both the relay (pre-verify at stage time) and the shell
//   (authoritative verify before activating).
//
// INTEGRITY IS THE SIGNATURE OVER THE BYTES, NOT A HASH IN A MANIFEST. The manifest's sha256 is advisory and
// will not match a host-rebuilt tgz; this verifier only ever checks the detached signature over the literal
// tarball bytes. Keep it self-contained and side-effect-free (it reads three files, writes nothing) so the
// read-only payload can run it against the writable staging path without trusting anything there.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export function verifyBundle(tgzPath, sigPath, pemPath) {
  if (!tgzPath || !sigPath || !pemPath) return { code: 2, error: 'usage: verify-suite-bundle.mjs <tgz> <sig> <pubkey.pem>' };
  let pub, data, signature;
  try { pub = createPublicKey(readFileSync(pemPath)); } catch (e) { return { code: 3, error: 'cannot read public key: ' + ((e && e.message) || e) }; }
  try { data = readFileSync(tgzPath); } catch (e) { return { code: 4, error: 'cannot read bundle: ' + ((e && e.message) || e) }; }
  try { signature = readFileSync(sigPath); } catch (e) { return { code: 5, error: 'cannot read signature: ' + ((e && e.message) || e) }; }
  let ok = false;
  try { ok = cryptoVerify(null, data, pub, signature); } catch (e) { return { code: 6, error: 'verify error: ' + ((e && e.message) || e) }; }
  if (!ok) return { code: 1, error: 'signature does not verify against the key' };
  return { code: 0 };
}

// Run only when invoked as a script (not when imported by a test). import.meta.url === the executed file.
const invokedDirectly = (() => {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return true; }
})();
if (invokedDirectly) {
  const r = verifyBundle(process.argv[2], process.argv[3], process.argv[4]);
  if (r.code !== 0) process.stderr.write(r.error + '\n');
  process.exit(r.code);
}
