// identity.src.js — TrinityOne self-custodial Nostr identity (bundled by esbuild → vendor/identity.js)
//
// Hard constraints honoured (see reference/trinityone-fellowship-spec.md §3, §13):
//   • Random entropy only — BIP-39 mnemonic, Nostr key via NIP-06 (m/44'/1237'/0'/0/0). No brainwallet.
//   • Private material NEVER in localStorage. Native = OS secure store (Keystore/Keychain);
//     web/dev = ephemeral in-memory only (regenerated each session, nothing persisted).
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
    apply(deriveProfile(mnemonic), { ephemeral: !isNative() });
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
    apply(deriveProfile(m), { ephemeral: !isNative() });
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
