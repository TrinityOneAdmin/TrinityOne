// steward.src.js -- the church's Nostr identity + publishing for the Steward console.
// Bundled -> vendor/steward.js. The church-side analog of fellowship.js.
//
// PILOT signing model: the console holds the church key itself (BIP-39 seed in localStorage),
// like the member identity. The NIP-07 extension / NIP-46 phone-bunker signer abstraction is the
// productization (see reference/proposal-relay-app-steward-console.md, Decision 3) -- this engine
// is written so swapping in a signer later means replacing finalizeEvent, nothing above it.
//
// Publishes, all signed by the church key, to the relay served on the console's own origin (/relay):
//   - church profile   kind 0
//   - funds            kind 30078, d = trinityone/fund:<id>   (NIP-78 app data, addressable)
//   - announcements    kind 1,     t = trinityone, t = <group>
// and reads the church's own published events back (so the dashboard shows real data, and members'
// app can read the same church profile + funds).
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { npubEncode } from 'nostr-tools/nip19';

const NET = 'trinityone';
const KEY_LS = 'trinityone.steward.church-key';     // localStorage seed (pilot)
const FUND_D = 'trinityone/fund:';
const now = () => Math.floor(Date.now() / 1000);

function relays() {
  const l = (typeof location !== 'undefined') ? location : null;
  if (!l || !l.host) return ['ws://127.0.0.1:8090/relay'];
  return [((l.protocol === 'https:') ? 'wss://' : 'ws://') + l.host + '/relay'];
}
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

const pool = new SimplePool();
let sk = null, pub = null;

function setKey(mnemonic) {
  sk = privateKeyFromSeedWords(mnemonic);
  pub = getPublicKey(sk);
  window.Steward.pubkey = pub;
  window.Steward.npub = npubEncode(pub);
  window.Steward.hasKey = true;
}
async function publish(evt) {
  try { await Promise.any(pool.publish(relays(), evt)); }
  catch (e) { console.warn('[steward] publish failed', e); }
  return evt;
}

window.Steward = {
  pubkey: null, npub: null, hasKey: false,

  // ---- key (pilot: self-custodial in localStorage; later: a signer) ----
  init(mnemonicOverride) {
    const m = mnemonicOverride || lsGet(KEY_LS);
    if (m) { if (mnemonicOverride) lsSet(KEY_LS, m); setKey(m); }
    return window.Steward.hasKey;
  },
  createKey() {
    const m = generateSeedWords(); lsSet(KEY_LS, m); setKey(m);
    window.dispatchEvent(new CustomEvent('steward-key', { detail: { npub: window.Steward.npub } }));
    return { npub: window.Steward.npub };
  },
  ensureKey() { return window.Steward.hasKey ? { npub: window.Steward.npub } : window.Steward.createKey(); },
  exportMnemonic() { return lsGet(KEY_LS); },

  // ---- publish (signed by the church) ----
  publishProfile(meta) {
    if (!sk) return Promise.resolve(null);
    const content = JSON.stringify({ name: meta.name || '', about: meta.about || '', nip05: meta.nip05 || '', picture: meta.picture || '' });
    return publish(finalizeEvent({ kind: 0, created_at: now(), tags: [], content }, sk));
  },
  publishFund(fund) {
    if (!sk) return Promise.resolve(null);
    const id = fund.id || ('fund' + Date.now());
    const content = JSON.stringify({ name: fund.name || 'Fund', sub: fund.sub || '', icon: fund.icon || 'gift',
      address: fund.address || '', custody: fund.custody || 'Custodial · Strike' });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', FUND_D + id], ['t', NET]], content }, sk))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  removeFund(id) {
    if (!sk) return Promise.resolve(null);
    // tombstone: republish the addressable event with empty content (a real relay would honor NIP-09 too)
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', FUND_D + id], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  publishPost(content, group) {
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['t', group || 'announce']], content: content || '' }, sk));
  },

  // ---- read the church's own data (live) ----
  // onFunds(fundsArray) fires whenever the fund set changes; returns an unsubscribe fn.
  subscribeFunds(onFunds) {
    const byId = new Map();
    const emit = () => onFunds([...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(FUND_D)) return;
        const id = d.slice(FUND_D.length);
        const deleted = e.tags.some(t => t[0] === 'deleted') || !e.content;
        if (deleted) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
};

window.Steward.init();
