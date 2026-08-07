// identity.src.js — TrinityOne self-custodial Nostr identity (bundled by esbuild → vendor/identity.js)
//
// Hard constraints honoured (see reference/trinityone-fellowship-spec.md §3, §13):
//   • Random entropy only — BIP-39 mnemonic, Nostr key via NIP-06 (m/44'/1237'/0'/0/0). No brainwallet.
//   • Native = OS secure store (Keystore/Keychain), never localStorage. Web/desktop persists the
//     seed in this browser's localStorage so the identity sticks across reloads (pilot trade-off).
//
// Exposes window.TrinityIdentity and dispatches a 'trinity-identity' event when it changes.
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { getPublicKey, generateSecretKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
// deep subpath, NOT the `nostr-tools` barrel. AUDIT-2026-07-26 S7: `import { nip44 } from 'nostr-tools'` pulled
// the whole library into this bundle for one function — vendor/identity.js went 282 KB → 409 KB, and a full
// relay/WebSocket/fetch/NIP-05/LNURL/wallet stack became resident in the boot-critical module that owns the 12
// words. None of it was called. +127 KB on first launch is the opposite of the thin-pipe test. Every other
// import in this file was already a subpath; so is src/fellowship.src.js:8.
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { sha256 } from '@noble/hashes/sha2.js';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import qrcode from 'qrcode-generator';

const STORE_KEY = 'trinityone.nostr.mnemonic';
// Optional "community PIN": when set, the seed is stored ONLY as this AES-GCM blob (the plaintext copy
// above is removed), so without the PIN the key can't load — the church community is unreachable and
// the app presents as a plain offline Bible reader (plausible deniability). OFF by default.
const ENC_KEY = 'trinityone.nostr.mnemonic.enc';
// The account's PUBLIC key, in the clear. Not a secret — it is published in every event this identity signs.
// It exists so a LOCKED phone can answer "do these twelve words belong to the account on this device?".
// Without it the lock screen cannot tell "let me back into MY account" from "replace this account with a
// different one", and importMnemonic destroys the stored key before anything is checked. 2026-08-05.
const PUB_KEY = 'trinityone.nostr.pub';
const COLORS = ['#5E8C6A', '#C2913A', '#C25A38', '#5360D6', '#1F9488', '#C24B7A'];

let memMnemonic = null;   // in-memory fallback (private mode / localStorage unavailable)
let webPersisted = false; // true once the seed is saved in THIS browser's localStorage
let sessionMnemonic = null;   // seed decrypted from the PIN blob, held in memory for THIS session only (never re-persisted as plaintext)

// ── phone-to-phone transfer (see beginTransfer/sealTransfer/acceptTransfer below) ──
const XFER_PREFIX = 'trinityone:xfer:';
let xferSk = null;   // the RECEIVING phone's throwaway private key. Memory only — never persisted, cleared after one use.
let xferPending = null;   // { mnemonic, sas, npub } decrypted but NOT yet adopted — waiting on the member's check

// The check code both phones display.
//
// WHAT IT REPLACED, AND WHY (AUDIT-2026-07-26 S5). The first version was four characters derived from the
// receiving phone's public key alone: `A[h[i] % 32]` × 4 = exactly 2^20, as a pure function of a value that
// travels in the open. That is precomputable — grind ~5M keypairs once, index them by code, and you hold a
// keypair for every possible code forever. A hostile member could read the four characters off the new phone's
// screen, hold up a pre-ground QR that collides with them, and the old phone would display the SAME four
// characters while sealing the member's 12 words to the attacker's key. Both screens agreed, so the member was
// told everything was fine. The check was the entire integrity story of the transfer, and it was free to forge.
//
// This one is computed over the WHOLE TRANSCRIPT — the receiving key, the sending key, and the ciphertext —
// so it does not exist until both phones have actually exchanged, and neither side can steer it: the
// ciphertext carries a fresh random nonce from the sealing phone. Forging a match now means finding a
// 40-bit collision against a value you cannot see until the exchange has already happened.
//
// 40 bits, not 20: eight characters from a 32-letter alphabet. The alphabet divides 256 exactly, so `% 32`
// stays uniform, and 0/O and 1/I are left out because these are read aloud across a room.
function xferSas(recvPubHex, sendPubHex, ct) {
  const A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const h = sha256(new TextEncoder().encode('trinityone/xfer/sas/v2\n' + String(recvPubHex) + '\n' + String(sendPubHex) + '\n' + String(ct)));
  let s = '';
  for (let i = 0; i < 8; i++) s += A[h[i] % A.length];
  return s.slice(0, 4) + ' ' + s.slice(4);   // two groups of four — easier to read out and to compare at a glance
}

// ── Community-PIN crypto — REUSED verbatim from the steward console (src/steward.src.js): PBKDF2
// (SHA-256, 210 000 iterations) → AES-GCM-256. No home-rolled crypto; identical blob shape {v,salt,iv,ct}. ──
const b64e = (u8) => btoa(String.fromCharCode(...u8));
const b64d = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
// SECURITY-AUDIT-2026-07-06 M11: the PIN is the ONLY secret over the at-rest seed blob, offline-brute-forceable
// on a seized device — so use a costlier KDF (600k, matching the backup file's floor; was 210k). The iteration
// count is STORED in the blob (`it`) so EXISTING blobs written at 210k still decrypt (o.it || legacy) and no
// member is ever locked out; only new/re-set PINs use the stronger cost.
const PIN_ITER = 600000;              // new blobs
const PIN_ITER_LEGACY = 210000;       // blobs written before this change (no `it` field)
async function deriveAes(pin, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iterations || PIN_ITER_LEGACY, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// localStorage[ENC_KEY] holds EITHER the full blob (web + legacy native) OR a {native:1} marker (native, M12).
// Its mere presence means "a PIN is set" — so hasEnc() stays synchronous and the boot/lock flow is unchanged.
function encMarker() { try { return JSON.parse(localStorage.getItem(ENC_KEY) || 'null'); } catch { return null; } }
function hasEnc() { try { return !!localStorage.getItem(ENC_KEY); } catch { return false; } }
// SECURITY-AUDIT-2026-07-06 M12: on native the encrypted seed blob lives in the OS hardware store (Keystore/
// Keychain), NOT a plain localStorage file — so a forensic image of the app's WebView storage never yields the
// ciphertext to brute-force offline; extracting it requires the device's hardware-bound key. localStorage keeps
// only a non-secret marker. Web/desktop keeps the blob in localStorage as before (no secure store there).
async function getEncBlob() {   // the {v,it,salt,iv,ct} object, or null
  const o = encMarker(); if (!o) return null;
  if (o.native && isNative()) {
    try { const { SecureStorage } = await import('@aparajita/capacitor-secure-storage'); const s = await SecureStorage.get(ENC_KEY); return s ? JSON.parse(s) : null; }
    catch (e) { console.warn('[identity] secure enc get failed', e); return null; }
  }
  return o.ct ? o : null;   // web / legacy-native: the full blob is right here in localStorage
}
// write the ciphertext blob to the hardware store, returning TRUE only if it durably landed (read-back verified).
// setPin MUST gate on this before dropping the plaintext, or a silent Keystore no-op would orphan the only key.
async function secureSetEnc(blobStr) {
  try {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.set(ENC_KEY, blobStr);
    try { const v = await SecureStorage.get(ENC_KEY); if (v != null && v !== blobStr) return false; } catch (e) {}
    return true;
  } catch (e) { console.warn('[identity] secure enc set failed', e); return false; }
}
async function secureRemoveEnc() {   // drop the native blob (recovery / removePin); no-op on web
  if (!isNative()) return;
  try { const { SecureStorage } = await import('@aparajita/capacitor-secure-storage'); await SecureStorage.remove(ENC_KEY); }
  catch (e) { console.warn('[identity] secure enc remove failed', e); }
}
async function clearEnc() { try { localStorage.removeItem(ENC_KEY); } catch (e) {} await secureRemoveEnc(); }

// ── "Remember me on this device", 30 days (owner, 2026-08-05) ────────────────────────────────────────────
//
// WHAT THIS TRADES, stated plainly because the UI has to say it too. The PIN protects against SOMEBODY HOLDING
// THE PHONE. So remembering means, precisely: anyone who can unlock this phone can open your church. There is
// no version that keeps the protection and skips the PIN, because the PIN *is* the protection. It is still a
// reasonable thing to choose — people already trust their phone's own lock and biometrics with more than this —
// but the tickbox must say the consequence rather than "stay signed in".
//
// HOW IT IS BUILT, and the trap it must not fall into. The lock is armed by the mere PRESENCE of the encrypted
// blob (app/app.jsx's lockNow: `hasEnc() && !sessionMnemonic`). So "remembered" MUST mean sessionMnemonic is
// populated at boot — never that the blob is removed. Removing it would not open the lock, it would DELETE the
// lock, which is exactly the bypass fixed in 23f0798: the blob's absence lets anyone in, for ever, not just the
// person who ticked the box. Keeping the blob also means the PIN still works and turning the feature off needs
// no re-entry.
//
// The seed and its expiry live TOGETHER in the OS secure store. Putting the expiry in localStorage alone would
// let "clear site data" extend the window indefinitely — the one action a person trying to hide something is
// most likely to take.
//
// NATIVE ONLY. On web the seed would sit in localStorage, which is far weaker than a hardware-backed store, and
// the threat model here is a seized device.
const REMEMBER_KEY = 'trinityone.nostr.remember';
const REMEMBER_DAYS = 30;
const nowSec = () => Math.floor(Date.now() / 1000);
async function rememberRead() {   // → { m, until } or null. Never returns an EXPIRED record.
  if (!isNative()) return null;
  try {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    const s = await SecureStorage.get(REMEMBER_KEY);
    if (!s) return null;
    const o = JSON.parse(String(s));
    if (!o || typeof o.m !== 'string' || !o.m || !(o.until > 0)) return null;
    // EXPIRY IS ENFORCED HERE, at the read, not by each caller. The 30-day bound is the whole reason the owner
    // chose this over "never ask again" — a phone lost and not missed quickly re-locks by itself — so it must
    // not depend on every future caller remembering to compare a timestamp. Clearing on the way out also means
    // a lapsed record stops being re-examined on every launch.
    if (o.until <= nowSec()) { await rememberClear(); return null; }
    return o;
  } catch (e) { console.warn('[identity] remember read failed', e); return null; }
}
// Returns TRUE only if it durably landed, read-back verified — the same discipline as secureSetEnc, and for the
// same reason in reverse: a caller told "remembered" that was not remembered sends the member away believing
// the phone will open, when in 30 days' time it will ask for a PIN they may no longer have written down.
async function rememberWrite(m, until) {
  if (!isNative()) return false;
  // The record carries the account it was made for, so a boot can tell whether it still belongs here.
  const payload = JSON.stringify({ m, until, pub: deriveProfile(m).pubkey });
  try {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.set(REMEMBER_KEY, payload);
    const v = await SecureStorage.get(REMEMBER_KEY);
    if (v == null || String(v) !== payload) return false;
    return true;
  } catch (e) { console.warn('[identity] remember write failed', e); return false; }
}
async function rememberClear() {
  if (!isNative()) return;
  try { const { SecureStorage } = await import('@aparajita/capacitor-secure-storage'); await SecureStorage.remove(REMEMBER_KEY); }
  catch (e) { console.warn('[identity] remember clear failed', e); }
}
// WHOSE encrypted blob is on this device? Written by setPin. Absent on a device whose PIN predates this, and
// on the two recovery paths that rebuild the marker without knowing the account — callers must read that as
// "cannot prove it", never as "must be fine".
function encOwnerPub() {
  try { const o = JSON.parse(localStorage.getItem(ENC_KEY) || 'null'); return (o && o.pub) || null; } catch (e) { return null; }
}
// The remembered seed, but ONLY if it belongs to the account the encrypted blob holds.
//
// The audit found rememberClear() missing from importMnemonic() and setPin(), so a record could outlive the
// identity that made it and open the phone as that identity with no PIN. Both calls are now there — but the
// bug WAS a list of call sites being incomplete, and a fix shaped like a longer list fails the same way the
// next time this file grows. So the guarantee lives here instead: a record that does not match is inert
// however it survived, and is destroyed on sight rather than left to expire on time it may have plenty of.
//
// Fails CLOSED. No recorded owner, or no owner on the record, means the check cannot be made — and the cost
// of guessing wrong is somebody else's account opening without a PIN.
async function rememberedSeed() {
  const rec = await rememberRead();   // expiry is enforced in there
  if (!rec) return null;
  const owner = encOwnerPub();
  if (!owner || !rec.pub || String(rec.pub).toLowerCase() !== String(owner).toLowerCase()) {
    await rememberClear();
    return null;
  }
  return rec.m;
}
// native: is there an encrypted-seed blob in the hardware store with NO localStorage marker? (marker lost to a
// kill before flush). Only setPin writes this blob; removePin/recovery/regenerate all clearEnc() it — so an
// orphan can only mean "a PIN was set but the marker didn't persist", which init() recovers as a locked identity.
async function hasOrphanEncBlob() {
  try { const { SecureStorage } = await import('@aparajita/capacitor-secure-storage'); const s = await SecureStorage.get(ENC_KEY); return !!(s && String(s).indexOf('"ct"') >= 0); }
  catch (e) { return false; }
}
async function decryptEnc(pin) {   // returns the seed string, or throws on wrong PIN / damaged blob
  const o = await getEncBlob(); if (!o) throw new Error('no encrypted blob');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt), o.it || PIN_ITER_LEGACY), b64d(o.ct)));
}

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

function profileFromPub(pubHex) {
  const h = hashStr(pubHex);
  return {
    pubkey: pubHex,
    npub: npubEncode(pubHex),
    // NO AUTO-GENERATED PSEUDONYM (2026-07-30, owner's call). This was "Anonymous " + a word from a pool, so a
    // member who had chosen nothing still appeared to have picked a name — which removed any reason to set a
    // real one and made anonymity the default posture. In a church the direction is the opposite: real names
    // encouraged, anonymity available and explicit. Empty means "not chosen"; the UI says so and offers to fix
    // it, rather than inventing an identity on the member's behalf. Their avatar (symbol + colour, hashed off
    // this same key) still tells them apart. See UNNAMED in src/fellowship.src.js.
    handle: '',
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
  if (hasEnc()) {
    // "Remember me on this device". The encrypted blob is still here and still armed — this only restores the
    // in-memory seed the PIN would have produced, so the lock is OPENED rather than removed. If the 30 days
    // have passed we drop the record and lock normally; a window that quietly renewed itself would not be a
    // 30-day window. Any failure to read falls through to the lock, which is the safe direction.
    // rememberRead() refuses and clears an expired record, so a non-null answer is a live one by construction.
    const remembered = await rememberedSeed();   // live, AND belonging to the account this blob holds
    if (remembered) {
      sessionMnemonic = remembered;
      apply(deriveProfile(remembered), { ephemeral: false });
      return;
    }
    applyLocked(); return;
  }
  let mnemonic = await secureGet();
  if (!mnemonic) {
    // SECURITY-AUDIT-2026-07-06 M12 resilience: the localStorage marker may have been lost (app killed before the
    // WebView flushed it), but the encrypted seed is still safe in the hardware store. Recover the PIN-locked
    // identity instead of silently minting a new key. (In the pre-M12 design a lost blob meant the seed was gone.)
    if (isNative() && await hasOrphanEncBlob()) { try { localStorage.setItem(ENC_KEY, JSON.stringify({ v: 2, native: 1 })); } catch (e) {} applyLocked(); return; }
    mnemonic = generateSeedWords(); await secureSet(mnemonic);
  }
  apply(deriveProfile(mnemonic), { ephemeral: isEphemeral() });
}

function apply(profile, meta) {
  try { if (profile && profile.pubkey) localStorage.setItem(PUB_KEY, String(profile.pubkey)); } catch (e) {}
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
    await clearEnc();   // M12: also drop the native SecureStorage blob, not just the localStorage marker
    await rememberClear();   // …and never leave the PREVIOUS identity's seed remembered on this device
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

  // ── PHONE TO PHONE ────────────────────────────────────────────────────────────────────────────────
  // Moving to a new phone used to mean reading 12 words off one screen and typing them into another.
  // This carries them across directly, and THE SECRET NEVER APPEARS ON EITHER SCREEN.
  //
  // The direction is deliberately reversed. The NEW phone shows a throwaway PUBLIC key; the OLD phone scans
  // it and encrypts the words to it (NIP-44, the same versioned encryption used everywhere else here). Anyone
  // photographing either screen gets a public key or a ciphertext — neither is worth anything. Only the new
  // phone holds the matching private key, and that key lives in memory for the length of the transfer only.
  //
  // We carry the MNEMONIC, not the raw signing key. NIP-49 is the standard for moving a key under a
  // passphrase, but it encrypts the 32 key bytes — a phone given only those could never show its owner their
  // 12 words again, so the account could never be backed up from it. The words are the recoverable thing.
  //
  // The check code is a short authentication string over the whole exchange (see xferSas above). It appears on
  // BOTH phones only once they have swapped codes, and the member compares them before the account is adopted.
  // Nothing is shown before that, because before that there is nothing either phone could honestly vouch for.
  beginTransfer() {
    xferSk = generateSecretKey();
    xferPending = null;
    return { qr: XFER_PREFIX + getPublicKey(xferSk) };
  },
  // OLD phone: seal this device's words to the new phone's scanned key.
  async sealTransfer(scanned) {
    const pub = String(scanned || '').trim().replace(XFER_PREFIX, '');
    if (!/^[0-9a-f]{64}$/i.test(pub)) throw new Error('That doesn’t look like a TrinityOne transfer code.');
    const m = await secureGet();
    if (!m) throw new Error('This phone’s account is locked — unlock it first, then try again.');
    const sk = generateSecretKey();   // throwaway SENDER key too, so the QR carries no hint of who this is
    const c = nip44v2.encrypt(m, nip44v2.utils.getConversationKey(sk, pub));
    const s = getPublicKey(sk);
    return { qr: JSON.stringify({ v: 1, t: 'trinityone/xfer', s, c }), code: xferSas(pub, s, c) };
  },
  // NEW phone: open the sealed reply. This decrypts and validates, then STOPS — it does not adopt the account.
  // The member has to see the check code match on both phones first, which is the entire reason there is one;
  // the previous version adopted silently the moment a payload decrypted, so a mismatched code arrived too
  // late to protect anything, and nothing ever showed them WHICH account they had just become.
  async acceptTransfer(scanned) {
    if (!xferSk) throw new Error('Start the transfer on this phone first.');
    let o = null;
    try { o = JSON.parse(String(scanned || '')); } catch (e) { o = null; }
    if (!o || o.t !== 'trinityone/xfer' || !/^[0-9a-f]{64}$/i.test(o.s || '') || !o.c) throw new Error('That QR isn’t a TrinityOne transfer.');
    let m = '';
    try { m = nip44v2.decrypt(o.c, nip44v2.utils.getConversationKey(xferSk, o.s)); }
    catch (e) { throw new Error('Couldn’t read that code — it was meant for a different phone.'); }
    m = String(m || '').trim().toLowerCase().replace(/\s+/g, ' ');
    // Validate BEFORE we show a check code and an account. A payload that opened but carries nothing usable is
    // a failure to report now, not after the member has confirmed it.
    if (!validateMnemonic(m, wordlist)) throw new Error('That code opened, but it didn’t carry an account.');
    xferPending = { mnemonic: m, sas: xferSas(getPublicKey(xferSk), o.s, o.c), npub: deriveProfile(m).npub };
    return { sas: xferPending.sas, npub: xferPending.npub };
  },
  // NEW phone: the member has compared the code on both screens and says they match. Only now do we become
  // that account. One-shot in both directions — the throwaway key and the held words are dropped here.
  async confirmTransfer() {
    if (!xferPending) throw new Error('Nothing to confirm — start the transfer again.');
    const m = xferPending.mnemonic;
    xferPending = null;
    xferSk = null;   // a scanned reply can never be replayed into a second device
    return window.TrinityIdentity.importMnemonic(m);   // validates the phrase again; clears any PIN
  },
  endTransfer() { xferSk = null; xferPending = null; },

  // restore an identity from a pasted 12-word BIP-39 phrase. RECOVERY ALWAYS WINS: importing clears any
  // community-PIN lock and restores the plaintext seed, so a forgotten PIN can NEVER trap the key —
  // Does this phrase belong to the account already on this phone? Returns 'match' | 'different' | 'unknown'.
  // 'unknown' means we have no stored public key to compare against (an identity created before 2026-08-05),
  // and the caller must treat it as 'different' — refusing to guess is the whole point.
  whoseMnemonic(words) {
    const m = String(words || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(m, wordlist)) throw new Error('That doesn’t look like a valid 12-word recovery phrase.');
    let have = ''; try { have = localStorage.getItem(PUB_KEY) || ''; } catch (e) {}
    if (!have) return 'unknown';
    let got = ''; try { got = (deriveProfile(m) || {}).pubkey || ''; } catch (e) { return 'different'; }
    return got && got === have ? 'match' : 'different';
  },
  // UNLOCK — not replace. For the lock screen, where the member means "let me back into MY account".
  //
  // importMnemonic() below deletes the encrypted blob BEFORE it stores anything, which had two consequences on
  // that screen. A member typing a valid phrase that was not theirs destroyed the account they were trying to
  // open, with no undo, under copy saying "nothing else is lost". And because the lock is armed by the mere
  // PRESENCE of that blob (see lockNow in app/app.jsx), deleting it did not open the lock — it REMOVED it, so
  // any valid phrase at all walked past a locked phone and reached the notes, journal and outbox that
  // clearCommunityCache deliberately keeps. Found by adversarial review 2026-08-05.
  //
  // This refuses unless the phrase derives the key already on the device. Replacing an account is still
  // possible — through importMnemonic, behind the confirmation its other three callers already use.
  async unlockWithMnemonic(words) {
    const who = window.TrinityIdentity.whoseMnemonic(words);
    if (who !== 'match') { const e = new Error('Those words belong to a different account.'); e.notThisAccount = true; e.reason = who; throw e; }
    return window.TrinityIdentity.importMnemonic(words);
  },
  // the 12 words bring the identity back and turn protection off (the member can re-enable it after).
  // REPLACE semantics: this destroys whatever is on the device. Callers that mean "unlock" want
  // unlockWithMnemonic() above; callers that mean "replace" must confirm first, as three of them already do.
  async importMnemonic(words) {
    const m = String(words || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(m, wordlist)) throw new Error('That doesn’t look like a valid 12-word recovery phrase.');
    await clearEnc();   // M12: also drop the native SecureStorage blob, not just the localStorage marker
    await rememberClear();   // this device is no longer that account — do not leave its seed remembered
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
    await rememberClear();   // a record made before this PIN was set belongs to a state that no longer exists
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveAes(pin, salt, PIN_ITER), new TextEncoder().encode(m)));
    const blob = JSON.stringify({ v: 2, it: PIN_ITER, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) });   // M11: carries its iteration count
    if (isNative()) {
      // SECURITY-AUDIT-2026-07-06 M12: put the ciphertext in the hardware store, and CONFIRM it durably landed
      // BEFORE writing the marker or dropping the plaintext — a failed Keystore write leaves the plaintext seed
      // intact (the PIN simply isn't set), so the only durable copy of the key is never destroyed.
      if (!(await secureSetEnc(blob))) return false;
      // The marker records WHICH account this blob holds. Nothing secret — a pubkey is public — and it is the
      // only reference the boot path can consult without the PIN. Without it a remembered seed cannot be
      // checked against anything, which is how a record left by a previous identity came to open the phone as
      // that identity. The two recovery paths that also write this marker do NOT know the account (that is the
      // point of them), so they leave it absent and rememberedSeed() refuses rather than guesses.
      const ownerPub = deriveProfile(m).pubkey;
      try { localStorage.setItem(ENC_KEY, JSON.stringify({ v: 2, native: 1, pub: ownerPub })); } catch (e) { return false; }
    } else {
      try { localStorage.setItem(ENC_KEY, blob); } catch (e) { return false; }   // web/desktop: no secure store — keep the blob in localStorage
    }
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
    // SECURITY-AUDIT-2026-07-06 M12 migration: a PIN set before this change kept the blob in localStorage on
    // native. Now that we've unlocked (blob + pin in hand), move it into the hardware store and swap localStorage
    // to a marker — but only after the Keystore copy is verified durable, so the transition can't lose the key.
    try {
      const o = encMarker();
      if (isNative() && o && o.ct && !o.native) {
        const raw = localStorage.getItem(ENC_KEY);
        if (raw && await secureSetEnc(raw)) { try { localStorage.setItem(ENC_KEY, JSON.stringify({ v: 2, native: 1 })); } catch (e) {} }
      }
    } catch (e) {}
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
    await clearEnc();   // M12: also drop the native SecureStorage blob, not just the localStorage marker
    // No PIN left to skip, so a remembered copy is just a second plaintext seed at rest with nothing guarding
    // it. secureSet above already holds the durable copy.
    await rememberClear();
    sessionMnemonic = null;
    window.TrinityIdentity.locked = false;
    apply(deriveProfile(m), { ephemeral: isEphemeral() });
    return true;
  },
  // ── "Remember me on this device" (30 days). See the block by REMEMBER_KEY for what it trades. ──
  rememberDays: REMEMBER_DAYS,
  // Offer it only where it is honest to: native, and only once a PIN actually exists to be skipped.
  canRemember() { return isNative() && hasEnc(); },
  // Called AFTER a successful unlock, only when the member ticked the box. Reads the seed from this session
  // rather than taking it as an argument, so there is no way to remember a key that was never unlocked.
  async rememberDevice() {
    if (!isNative() || !hasEnc() || !sessionMnemonic) return false;
    return rememberWrite(sessionMnemonic, nowSec() + REMEMBER_DAYS * 86400);
  },
  // Turning it off must clear BOTH the stored seed and its expiry — they live in one record, so this does.
  // Does NOT lock the current session: the member is looking at the app, and throwing them out for changing
  // a preference would be its own bug. The next launch will ask for the PIN.
  async forgetDevice() { await rememberClear(); return true; },
  // For the profile screen: 0 when not remembered, else the unix second it lapses.
  async rememberedUntil() { const r = await rememberRead(); return (r && r.until > nowSec()) ? r.until : 0; },

  // Re-lock this session WITHOUT removing the PIN (forget the decrypted seed). Community becomes
  // unreachable until unlock() is called again.
  lock() {
    if (!hasEnc()) return false;
    sessionMnemonic = null;
    // "Lock now" must MEAN now. Leaving the remembered seed in place would re-open the account on the next
    // launch, so the one control a member reaches for when someone is about to pick up their phone would be
    // undone by restarting the app. Fire-and-forget: the in-memory seed is already gone above, so the lock is
    // effective immediately whatever the store does.
    rememberClear();
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
