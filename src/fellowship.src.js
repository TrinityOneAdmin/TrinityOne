// fellowship.src.js — TrinityOne chat transport over Nostr (bundled → vendor/fellowship.js)
//
// MVP transport: signed kind-1 events grouped by a 't' tag (the spec's tag-based model,
// §5.2). Points at the local dev relay by default; swap window.Fellowship.relays for a
// hosted NIP-29 relay later (the app only ever talks to window.Fellowship).
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';

const NET = 'trinityone';                       // network-wide tag
const RELAYS = ['ws://127.0.0.1:7447'];         // local dev relay
const HANDLE_POOL = ['Cedar', 'River', 'Sparrow', 'Olive', 'Wren', 'Maple', 'Reed', 'Dove', 'Ash', 'Linden', 'Heron', 'Bramble'];
const COLORS = ['#5E8C6A', '#C2913A', '#C25A38', '#5360D6', '#1F9488', '#C24B7A'];

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function profile(pub) {
  const h = hashStr(pub || '');
  return { pubkey: pub, handle: 'Anonymous ' + HANDLE_POOL[h % HANDLE_POOL.length], color: COLORS[(h >>> 8) % COLORS.length] };
}

const pool = new SimplePool();
let sk = null, pub = null;

async function deriveFromIdentity() {
  const mnemonic = window.TrinityIdentity ? await window.TrinityIdentity.exportMnemonic() : null;
  if (!mnemonic) throw new Error('no identity available to sign with');
  sk = privateKeyFromSeedWords(mnemonic);
  pub = getPublicKey(sk);
  window.Fellowship.myPubkey = pub;
}
async function init() {
  if (window.TrinityIdentity && window.TrinityIdentity.ready) await window.TrinityIdentity.ready;
  await deriveFromIdentity();
}
// keep the signing key in step with identity regeneration / restore
window.addEventListener('trinity-identity', () => { deriveFromIdentity().catch(() => {}); });

window.Fellowship = {
  relays: RELAYS,
  myPubkey: null,
  ready: null,
  profile,

  // publish a message to a group (kind 1, tagged with the network + group ids)
  async publishMessage(groupId, content, extraTags = []) {
    if (!sk) await window.Fellowship.ready;
    const evt = finalizeEvent({
      kind: 1, created_at: Math.floor(Date.now() / 1000),
      tags: [['t', NET], ['t', groupId], ...extraTags], content,
    }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); }
    catch (e) { console.warn('[fellowship] publish failed', e); }
    return evt;
  },

  // live connection status of each configured relay (throwaway WS probe)
  async relayStatus() {
    return Promise.all(window.Fellowship.relays.map(url => new Promise(res => {
      let done = false;
      const finish = (status) => { if (done) return; done = true; try { ws.close(); } catch {} res({ url, status }); };
      let ws;
      try { ws = new WebSocket(url); } catch { return res({ url, status: 'off' }); }
      const t = setTimeout(() => finish('off'), 2500);
      ws.onopen = () => { clearTimeout(t); finish('on'); };
      ws.onerror = () => { clearTimeout(t); finish('off'); };
    })));
  },

  // watch several groups at once (for the group-list previews/unread); onEvent(groupId, e)
  subscribeGroups(groupIds, onEvent) {
    const set = new Set(groupIds);
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], '#t': groupIds, limit: 500 }], {
      onevent(e) {
        const gid = (e.tags.find(t => t[0] === 't' && set.has(t[1])) || [])[1];
        if (gid) { try { onEvent(gid, e); } catch (err) { console.error(err); } }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // live subscription to a group's messages; returns an unsubscribe fn
  subscribeGroup(groupId, onEvent) {
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], '#t': [groupId], limit: 200 }], {
      onevent(e) {
        // belt-and-suspenders: only deliver events actually tagged for this group
        if (!e.tags.some(t => t[0] === 't' && t[1] === groupId)) return;
        try { onEvent(e); } catch (err) { console.error(err); }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
};
window.Fellowship.ready = init().catch(e => console.error('[fellowship] init failed', e));
