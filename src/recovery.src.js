// recovery.src.js — browser entry: expose the guardian recovery core + a memory-hard KDF as window.TrinityRecovery.
// Bundle with scripts/build-recovery.sh → vendor/recovery.js (loaded by index.html + steward.html before app/*.jsx).
// The Shamir math lives in recovery-core.mjs (unit-tested in scripts/recovery.test.mjs); Argon2id comes from the
// already-vetted @noble/hashes (a transitive dep of the identity layer — no NEW supply-chain surface).
import { splitMnemonic, combineMnemonic, splitBytes, combineBytes, encodeShare, decodeShare } from './recovery-core.mjs';
import { argon2idAsync } from '@noble/hashes/argon2.js';

// OWASP argon2id recommendation for interactive use: m=19 MiB, t=2, p=1. Memory-hardness is the point — it caps
// how far an attacker can parallelise offline guessing on a GPU/rig, which is what makes a short (6-digit) PIN on
// an encrypted CLOUD backup actually costly to brute-force. 19 MiB stays feasible on low-end Android WebViews
// (the thin-device audience); a longer passphrase is still strongly encouraged in the UI.
const ARGON2_DEFAULT = { t: 2, m: 19456, p: 1 };

// derive 32 raw key bytes from a passphrase/PIN + salt (Uint8Array). Returns { raw, params } so the caller can
// record the exact params in the backup envelope (future-proofs a params bump without breaking old files).
async function argon2Raw(passphrase, saltBytes, params) {
  const p = { t: (params && params.t) || ARGON2_DEFAULT.t, m: (params && params.m) || ARGON2_DEFAULT.m, p: (params && params.p) || ARGON2_DEFAULT.p };
  const raw = await argon2idAsync(new TextEncoder().encode(String(passphrase)), saltBytes, { t: p.t, m: p.m, p: p.p, dkLen: 32 });
  return { raw, params: p };
}

window.TrinityRecovery = { splitMnemonic, combineMnemonic, splitBytes, combineBytes, encodeShare, decodeShare, argon2Raw, ARGON2_DEFAULT };
