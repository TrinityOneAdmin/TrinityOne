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
const HANDLE_POOL = ['Cedar', 'River', 'Sparrow', 'Olive', 'Wren', 'Maple', 'Reed', 'Dove', 'Ash', 'Linden', 'Heron', 'Bramble'];
const COLORS = ['#5E8C6A', '#C2913A', '#C25A38', '#5360D6', '#1F9488', '#C24B7A'];

let memMnemonic = null;   // in-memory fallback (private mode / localStorage unavailable)
let webPersisted = false; // true once the seed is saved in THIS browser's localStorage

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
async function secureSet(mnemonic) {
  if (!isNative()) {
    memMnemonic = mnemonic;
    try { localStorage.setItem(STORE_KEY, mnemonic); webPersisted = true; } catch (e) { webPersisted = false; }
    return;
  }
  try {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.set(STORE_KEY, mnemonic);
  } catch (e) { console.warn('[identity] secure set failed', e); }
}

function deriveProfile(mnemonic) {
  const sk = privateKeyFromSeedWords(mnemonic);      // Uint8Array (nostr-tools v2)
  const pub = getPublicKey(sk);                      // 32-byte x-only pubkey, hex
  return profileFromPub(pub);
}

async function init() {
  let mnemonic = await secureGet();
  if (!mnemonic) { mnemonic = generateSeedWords(); await secureSet(mnemonic); }
  apply(deriveProfile(mnemonic), { ephemeral: isEphemeral() });
}

function apply(profile, meta) {
  window.TrinityIdentity.current = profile;
  window.TrinityIdentity.ephemeral = !!(meta && meta.ephemeral);
  window.dispatchEvent(new CustomEvent('trinity-identity', { detail: profile }));
}

window.TrinityIdentity = {
  current: null,
  ephemeral: false,
  ready: null,
  async regenerate() {
    const mnemonic = generateSeedWords();
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

  // restore an identity from a pasted 12-word BIP-39 phrase
  async importMnemonic(words) {
    const m = String(words || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(m, wordlist)) throw new Error('That doesn’t look like a valid 12-word recovery phrase.');
    await secureSet(m);
    apply(deriveProfile(m), { ephemeral: isEphemeral() });
    return window.TrinityIdentity.current;
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
