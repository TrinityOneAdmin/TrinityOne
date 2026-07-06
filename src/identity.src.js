// identity.src.js — TrinityOne self-custodial Nostr identity (bundled by esbuild → vendor/identity.js)
//
// Hard constraints honoured (see reference/trinityone-fellowship-spec.md §3, §13):
//   • Random entropy only — BIP-39 mnemonic, Nostr key via NIP-06 (m/44'/1237'/0'/0/0). No brainwallet.
//   • Native = OS secure store (Keystore/Keychain), never localStorage. Web/desktop persists the
//     seed in this browser's localStorage so the identity sticks across reloads (pilot trade-off).
//
// Exposes window.TrinityIdentity and dispatches a 'trinity-identity' event when it changes.
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import qrcode from 'qrcode-generator';

const STORE_KEY = 'trinityone.nostr.mnemonic';
// Optional "community PIN": when set, the seed is stored ONLY as this AES-GCM blob (the plaintext copy
// above is removed), so without the PIN the key can't load — the church community is unreachable and
// the app presents as a plain offline Bible reader (plausible deniability). OFF by default.
const ENC_KEY = 'trinityone.nostr.mnemonic.enc';
const HANDLE_POOL = ['Cedar', 'River', 'Sparrow', 'Olive', 'Wren', 'Maple', 'Reed', 'Dove', 'Ash', 'Linden', 'Heron', 'Bramble'];
const COLORS = ['#5E8C6A', '#C2913A', '#C25A38', '#5360D6', '#1F9488', '#C24B7A'];

let memMnemonic = null;   // in-memory fallback (private mode / localStorage unavailable)
let webPersisted = false; // true once the seed is saved in THIS browser's localStorage
let sessionMnemonic = null;   // seed decrypted from the PIN blob, held in memory for THIS session only (never re-persisted as plaintext)

// ── Community-PIN crypto — REUSED verbatim from the steward console (src/steward.src.js): PBKDF2
// (SHA-256, 210 000 iterations) → AES-GCM-256. No home-rolled crypto; identical blob shape {v,salt,iv,ct}. ──
const b64e = (u8) => btoa(String.fromCharCode(...u8));
const b64d = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveAes(pin, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function encRaw() { try { return localStorage.getItem(ENC_KEY); } catch { return null; } }
function hasEnc() { return !!encRaw(); }
async function decryptEnc(pin) {   // returns the seed string, or throws on wrong PIN / damaged blob
  const o = JSON.parse(encRaw());
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt)), b64d(o.ct)));
}

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

function profileFromPub(pubHex) {
  const h = hashStr(pubHex);
  return {
    pubkey: pubHex,
    npub: npubEncode(pubHex),
    handle: 'Anonymous ' + HANDLE_POOL[h % HANDLE_POOL.length],
    color: COLORS[(h >>> 8) % COLORS.length],
  };
}

function isNative() {
  const c = window.Capacitor;
  return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
}

// Native: OS secure store (Keychain/Keystore) -- the gold standard.
// Web/desktop: persist the seed in THIS browser's localStorage so the same identity (name,
// messages, synced data) returns across reloads. It never leaves the device; the app still
// pushes you to write down your 12 words. (The native app remains the more-secure option.)
function isEphemeral() { return !isNative() && !webPersisted; }
async function secureGet() {
  // When a community PIN is set, the seed lives ONLY in the encrypted blob. Return the in-memory copy
  // if we've unlocked this session; otherwise null (locked) — NEVER fall back to a plaintext store.
  if (hasEnc()) return sessionMnemonic;
  if (!isNative()) {
    try { const v = localStorage.getItem(STORE_KEY); if (typeof v === 'string' && v) { webPersisted = true; return v; } } catch (e) {}
    return memMnemonic;
  }
  try {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    const v = await SecureStorage.get(STORE_KEY);
    return typeof v === 'string' ? v : null;
  } catch (e) { console.warn('[identity] secure get failed', e); return null; }
}
// Persist the plaintext seed. Returns TRUE only if it durably landed — callers that then delete another
// copy (removePin) MUST check this, or a silent native failure destroys the only durable copy of the key.
async function secureSet(mnemonic) {
  if (!isNative()) {
    memMnemonic = mnemonic;
    try { localStorage.setItem(STORE_KEY, mnemonic); webPersisted = true; return true; } catch (e) { webPersisted = false; return false; }
  }
  try {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.set(STORE_KEY, mnemonic);
    // read-back: a Keystore that silently no-ops the write (known on some Androids after credential changes)
    // returns from set() without throwing — only a mismatched read exposes it. Get-throw stays lenient
    // (set didn't throw) so we don't report a false failure.
    try { const v = await SecureStorage.get(STORE_KEY); if (v != null && v !== mnemonic) return false; } catch (e) {}
    return true;
  } catch (e) { console.warn('[identity] secure set failed', e); return false; }
}
// remove every PLAINTEXT copy of the seed (web localStorage + native secure store). The encrypted
// blob is untouched. Called when a PIN is enabled so no readable key remains at rest.
async function secureRemove() {
  memMnemonic = null; webPersisted = false;
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  if (isNative()) {
    try { const { SecureStorage } = await import('@aparajita/capacitor-secure-storage'); await SecureStorage.remove(STORE_KEY); }
    catch (e) { console.warn('[identity] secure remove failed', e); }
  }
}

function deriveProfile(mnemonic) {
  const sk = privateKeyFromSeedWords(mnemonic);      // Uint8Array (nostr-tools v2)
  const pub = getPublicKey(sk);                      // 32-byte x-only pubkey, hex
  return profileFromPub(pub);
}

async function init() {
  // Community PIN is on and we haven't unlocked this session → stay locked. Crucially, do NOT generate
  // a fresh key here (that would silently orphan the member's encrypted identity). No identity loads,
  // so Fellowship never gets a signing key and the app looks like a plain Bible reader.
  if (hasEnc()) { applyLocked(); return; }
  let mnemonic = await secureGet();
  if (!mnemonic) { mnemonic = generateSeedWords(); await secureSet(mnemonic); }
  apply(deriveProfile(mnemonic), { ephemeral: isEphemeral() });
}

function apply(profile, meta) {
  window.TrinityIdentity.current = profile;
  window.TrinityIdentity.ephemeral = !!(meta && meta.ephemeral);
  window.TrinityIdentity.locked = false;
  window.dispatchEvent(new CustomEvent('trinity-identity', { detail: profile }));
}

// no usable identity in memory because a community PIN is set and hasn't been entered this session
function applyLocked() {
  window.TrinityIdentity.current = null;
  window.TrinityIdentity.ephemeral = false;
  window.TrinityIdentity.locked = true;
  // 'trinity-identity-lock' is the dedicated signal for the community gate; 'trinity-identity' (null)
  // keeps existing listeners (Fellowship re-derive, app idTick) in step.
  window.dispatchEvent(new CustomEvent('trinity-identity-lock', { detail: { locked: true } }));
  window.dispatchEvent(new CustomEvent('trinity-identity', { detail: null }));
}

window.TrinityIdentity = {
  current: null,
  ephemeral: false,
  locked: false,            // true when a community PIN is set and hasn't been entered this session
  ready: null,
  async regenerate() {
    const mnemonic = generateSeedWords();
    // a brand-new identity starts with no PIN — clear any stale lock so the fresh key persists plainly
    try { localStorage.removeItem(ENC_KEY); } catch (e) {}
    sessionMnemonic = null;
    await secureSet(mnemonic);
    apply(deriveProfile(mnemonic), { ephemeral: isEphemeral() });
    return window.TrinityIdentity.current;
  },
  copyNpub() {
    const np = window.TrinityIdentity.current && window.TrinityIdentity.current.npub;
    if (np && navigator.clipboard) navigator.clipboard.writeText(np).catch(() => {});
    return np;
  },
  // the current identity's 12-word recovery phrase (native: secure store; web: ephemeral)
  async exportMnemonic() { return secureGet(); },

  // restore an identity from a pasted 12-word BIP-39 phrase. RECOVERY ALWAYS WINS: importing clears any
  // community-PIN lock and restores the plaintext seed, so a forgotten PIN can NEVER trap the key —
  // the 12 words bring the identity back and turn protection off (the member can re-enable it after).
  async importMnemonic(words) {
    const m = String(words || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(m, wordlist)) throw new Error('That doesn’t look like a valid 12-word recovery phrase.');
    try { localStorage.removeItem(ENC_KEY); } catch (e) {}
    sessionMnemonic = null;
    await secureSet(m);
    apply(deriveProfile(m), { ephemeral: isEphemeral() });
    return window.TrinityIdentity.current;
  },

  // ───────────────────────── Optional community PIN (OFF by default) ─────────────────────────
  // hasPin(): a PIN blob exists.  isLocked(): a PIN is set and we haven't unlocked this session.
  hasPin() { return hasEnc(); },
  isLocked() { return hasEnc() && !sessionMnemonic; },
  // Turn protection ON: encrypt the current seed under the PIN, then wipe every plaintext copy.
  // Requires the seed to be available (identity unlocked / no prior PIN). Returns false if it can't.
  async setPin(pin) {
    if (!pin || pin.length < 6) return false;   // floor: the PIN is the only secret over the at-rest blob (audit #5); UI adds the all-numeric rule
    const m = sessionMnemonic || await secureGet();   // secureGet returns the plaintext seed while no blob exists yet
    if (!m) return false;
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveAes(pin, salt), new TextEncoder().encode(m)));
    try { localStorage.setItem(ENC_KEY, JSON.stringify({ v: 1, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) })); }
    catch (e) { return false; }
    sessionMnemonic = m;                 // stay unlocked for the rest of this session
    window.TrinityIdentity.locked = false;
    await secureRemove();                // drop the plaintext seed (web localStorage + native secure store)
    return true;
  },
  // Enter the PIN → decrypt into memory and light the identity back up (fires trinity-identity so
  // Fellowship re-derives the signing key). Returns true on success, false on a wrong PIN.
  async unlock(pin) {
    if (!hasEnc()) return true;
    let m; try { m = await decryptEnc(pin); } catch (e) { return false; }
    sessionMnemonic = m;
    window.TrinityIdentity.locked = false;
    apply(deriveProfile(m), { ephemeral: false });
    return true;
  },
  // check a PIN with NO side effects (gates "turn off" / "change PIN")
  async verifyPin(pin) {
    if (!hasEnc()) return false;
    try { await decryptEnc(pin); return true; } catch (e) { return false; }
  },
  // Turn protection OFF: verify the PIN, restore the plaintext seed, remove the blob.
  async removePin(pin) {
    if (!hasEnc()) return true;
    let m; try { m = await decryptEnc(pin); } catch (e) { return false; }
    // Restore the plaintext seed FIRST and only drop the encrypted blob if that durably landed. If native
    // persistence fails, keep the blob + PIN + session so the key is never left with no durable copy.
    const saved = await secureSet(m);
    if (!saved) return false;
    try { localStorage.removeItem(ENC_KEY); } catch (e) {}
    sessionMnemonic = null;
    window.TrinityIdentity.locked = false;
    apply(deriveProfile(m), { ephemeral: isEphemeral() });
    return true;
  },
  // Re-lock this session WITHOUT removing the PIN (forget the decrypted seed). Community becomes
  // unreachable until unlock() is called again.
  lock() {
    if (!hasEnc()) return false;
    sessionMnemonic = null;
    window.TrinityIdentity.locked = true;
    // best-effort forensic hygiene: drop cached community data if Fellowship is present
    try { if (window.Fellowship && window.Fellowship.clearCommunityCache) window.Fellowship.clearCommunityCache(); } catch (e) {}
    applyLocked();
    return true;
  },

  // steward onboarding: mint a NEW identity to hand to a member (does NOT touch yours)
  makeInvite() {
    const mnemonic = generateSeedWords();
    return { mnemonic, profile: deriveProfile(mnemonic) };
  },

  // render any string as a QR (SVG markup) — used for the steward invite
  qrSVG(text) {
    const qr = qrcode(0, 'M'); qr.addData(String(text || '')); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  },
};

window.TrinityIdentity.ready = init().catch(e => console.error('[identity] init failed', e));
