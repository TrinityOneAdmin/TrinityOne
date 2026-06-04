// identity.src.js — Lumen self-custodial Nostr identity (bundled by esbuild → vendor/identity.js)
//
// Hard constraints honoured (see reference/lumen-fellowship-spec.md §3, §13):
//   • Random entropy only — BIP-39 mnemonic, Nostr key via NIP-06 (m/44'/1237'/0'/0/0). No brainwallet.
//   • Private material NEVER in localStorage. Native = OS secure store (Keystore/Keychain);
//     web/dev = ephemeral in-memory only (regenerated each session, nothing persisted).
//
// Exposes window.LumenIdentity and dispatches a 'lumen-identity' event when it changes.
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const STORE_KEY = 'lumen.nostr.mnemonic';
const HANDLE_POOL = ['Cedar', 'River', 'Sparrow', 'Olive', 'Wren', 'Maple', 'Reed', 'Dove', 'Ash', 'Linden', 'Heron', 'Bramble'];
const COLORS = ['#5E8C6A', '#C2913A', '#C25A38', '#5360D6', '#1F9488', '#C24B7A'];

let memMnemonic = null;   // web/dev ephemeral store (never persisted)

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

// secure store is only ever touched on a real device; the @aparajita web fallback
// is deliberately NOT used (it would put the key somewhere extractable).
async function secureGet() {
  if (!isNative()) return memMnemonic;
  try {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    const v = await SecureStorage.get(STORE_KEY);
    return typeof v === 'string' ? v : null;
  } catch (e) { console.warn('[identity] secure get failed', e); return null; }
}
async function secureSet(mnemonic) {
  if (!isNative()) { memMnemonic = mnemonic; return; }
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
  apply(deriveProfile(mnemonic), { ephemeral: !isNative() });
}

function apply(profile, meta) {
  window.LumenIdentity.current = profile;
  window.LumenIdentity.ephemeral = !!(meta && meta.ephemeral);
  window.dispatchEvent(new CustomEvent('lumen-identity', { detail: profile }));
}

window.LumenIdentity = {
  current: null,
  ephemeral: false,
  ready: null,
  async regenerate() {
    const mnemonic = generateSeedWords();
    await secureSet(mnemonic);
    apply(deriveProfile(mnemonic), { ephemeral: !isNative() });
    return window.LumenIdentity.current;
  },
  copyNpub() {
    const np = window.LumenIdentity.current && window.LumenIdentity.current.npub;
    if (np && navigator.clipboard) navigator.clipboard.writeText(np).catch(() => {});
    return np;
  },
  // for a future recovery screen (show-once 12 words); native only, ephemeral on web
  async exportMnemonic() { return secureGet(); },
};

window.LumenIdentity.ready = init().catch(e => console.error('[identity] init failed', e));
