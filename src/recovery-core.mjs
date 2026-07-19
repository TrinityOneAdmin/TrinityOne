// recovery-core.mjs — Shamir secret sharing over GF(256) for guardian-assisted recovery.
//
// WHY: the 12-word seed is a single point of loss (lose the phone + the paper → the identity is gone) AND, if
// handed whole to a "guardian" for safekeeping, a single point of COERCION (one person who can be pressured to
// surrender someone's key). A 2-of-3 split fixes both at once: the secret is reconstructable from ANY 2 of 3
// shares, so losing one is survivable — and NO single holder (not even the guardian) can recover alone, so no
// one person becomes the key. This is the honest way to offer "your guardian can help you back in" to a
// persecuted-church audience without creating a new betrayal surface.
//
// Pure + dependency-free so it is unit-testable in node (scripts/recovery.test.mjs) and bundles for the browser
// (src/recovery.src.js → window.TrinityRecovery). It shares a secret's BYTES; the caller decides that the secret
// is a BIP-39 mnemonic string. Threshold/total are encoded into each share so combine() can validate.

// ── GF(256), AES reducing polynomial 0x11b, generator 3 ─────────────────────────────────────────
const EXP = new Uint8Array(255);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // x = x * 3  (= x*2 ^ x), with reduction by 0x11b
    let x2 = x << 1; if (x2 & 0x100) x2 ^= 0x11b;
    x = (x2 ^ x) & 0xff;
  }
})();
function gmul(a, b) { if (a === 0 || b === 0) return 0; return EXP[(LOG[a] + LOG[b]) % 255]; }
function gdiv(a, b) { if (a === 0) return 0; return EXP[(LOG[a] - LOG[b] + 255) % 255]; }

// evaluate a polynomial (coeffs low→high, all in GF(256)) at point x via Horner
function evalPoly(coeffs, x) { let acc = 0; for (let j = coeffs.length - 1; j >= 0; j--) acc = gmul(acc, x) ^ coeffs[j]; return acc; }

// split `secret` (Uint8Array) into `total` shares, any `threshold` of which reconstruct it.
// `rand(n)` returns n cryptographically-random bytes (Uint8Array). Higher-degree coefficients MUST be random —
// that is what makes fewer than `threshold` shares reveal nothing about the secret.
export function splitBytes(secret, threshold, total, rand) {
  if (!(secret instanceof Uint8Array)) throw new Error('secret must be Uint8Array');
  if (threshold < 2 || total < threshold || total > 255) throw new Error('bad threshold/total');
  const shares = [];
  for (let x = 1; x <= total; x++) shares.push({ x, threshold, y: new Uint8Array(secret.length) });
  for (let i = 0; i < secret.length; i++) {
    const coeffs = new Uint8Array(threshold);
    coeffs[0] = secret[i];
    const r = rand(threshold - 1);
    for (let j = 1; j < threshold; j++) coeffs[j] = r[j - 1];
    for (const sh of shares) sh.y[i] = evalPoly(coeffs, sh.x);
  }
  return shares;
}

// reconstruct the secret from >= threshold shares via Lagrange interpolation at x=0.
// (In GF(256) subtraction is XOR, so 0 - x_k == x_k and x_j - x_k == x_j ^ x_k.)
export function combineBytes(shares) {
  if (!shares || shares.length < 2) throw new Error('need at least 2 shares');
  const xs = shares.map(s => s.x);
  if (new Set(xs).size !== xs.length) throw new Error('duplicate share x-coordinates');
  const len = shares[0].y.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (let j = 0; j < shares.length; j++) {
      let num = 1, den = 1;
      for (let k = 0; k < shares.length; k++) {
        if (k === j) continue;
        num = gmul(num, shares[k].x);
        den = gmul(den, shares[j].x ^ shares[k].x);
      }
      acc ^= gmul(shares[j].y[i], gdiv(num, den));
    }
    out[i] = acc;
  }
  return out;
}

// ── human/transport share encoding: "TRS1.<threshold>.<x>.<hexY>.<crc16>" ───────────────────────
const _hex = (u8) => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
const _unhex = (s) => { const u = new Uint8Array(s.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16); return u; };
function crc16(str) { let c = 0xffff; for (let i = 0; i < str.length; i++) { c ^= str.charCodeAt(i) << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c.toString(16).padStart(4, '0'); }

export function encodeShare(share) {
  const body = 'TRS1.' + share.threshold + '.' + share.x + '.' + _hex(share.y);
  return body + '.' + crc16(body);
}
export function decodeShare(str) {
  const s = String(str || '').trim();
  const m = s.match(/^TRS1\.(\d+)\.(\d+)\.([0-9a-fA-F]+)\.([0-9a-fA-F]{4})$/);
  if (!m) throw new Error('That is not a valid recovery share.');
  const body = s.slice(0, s.lastIndexOf('.'));
  if (crc16(body) !== m[4].toLowerCase()) throw new Error('This recovery share looks damaged (checksum failed).');
  return { threshold: parseInt(m[1], 10), x: parseInt(m[2], 10), y: _unhex(m[3]) };
}

// ── mnemonic-string convenience wrappers (what the app actually calls) ───────────────────────────
export function splitMnemonic(mnemonic, opts = {}) {
  const threshold = opts.threshold || 2, total = opts.total || 3;
  const rand = opts.rand || ((n) => { const u = new Uint8Array(n); globalThis.crypto.getRandomValues(u); return u; });   // browser window.crypto / node v19+ globalThis.crypto; the test passes its own rand
  const secret = new TextEncoder().encode(String(mnemonic).trim());
  return splitBytes(secret, threshold, total, rand).map(encodeShare);
}
export function combineMnemonic(shareStrings) {
  const shares = shareStrings.map(decodeShare);
  const t = shares[0].threshold;
  if (shares.length < t) throw new Error('Need ' + t + ' shares to recover; you have ' + shares.length + '.');
  return new TextDecoder().decode(combineBytes(shares)).trim();
}
