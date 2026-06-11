// fellowship.src.js — TrinityOne chat transport over Nostr (bundled → vendor/fellowship.js)
//
// MVP transport: signed kind-1 events grouped by a 't' tag (the spec's tag-based model,
// §5.2). Points at the local dev relay by default; swap window.Fellowship.relays for a
// hosted NIP-29 relay later (the app only ever talks to window.Fellowship).
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { decode as nip19decode } from 'nostr-tools/nip19';
import { encrypt as nip04encrypt, decrypt as nip04decrypt } from 'nostr-tools/nip04';

// a church is identified by its npub (or hex pubkey) -- resolve to a 32-byte hex pubkey
function toPub(npubOrHex) {
  if (!npubOrHex) return null;
  if (/^[0-9a-f]{64}$/i.test(npubOrHex)) return npubOrHex.toLowerCase();
  try { const d = nip19decode(npubOrHex); return d.type === 'npub' ? d.data : null; } catch { return null; }
}
const GROUP_D = 'trinityone/group:';

const NET = 'trinityone';                       // network-wide tag
// Relays are configurable + persisted, so pointing at a hosted wss:// relay is a settings
// change, not a code change. Default = a relay on the SAME host the app is served from, port
// 7447. That makes self-hosting on one machine work for both this device (localhost) and phones
// on the LAN (they open http://<machine-ip>:8000 -> relay at ws://<machine-ip>:7447) with no
// hardcoded IP. Production points this at the church's wss:// relay via the in-app Relays setting.
// The unified gateway (scripts/gateway.mjs) serves the app AND the relay at /relay on ONE origin,
// so the relay is reachable wherever the app is -- localhost, the LAN IP, or a public tunnel --
// with no hardcoded host and over a single tunnel. ws on http, wss on https (a tunnel).
const _loc = (typeof location !== 'undefined') ? location : null;
const RELAY_BASE = _loc && _loc.host ? _loc.host : '127.0.0.1:8090';
// The packaged app (Capacitor) runs from localhost inside the webview, so it can't derive the
// church relay from its own origin like the web build does. Ship the church's relay as the DEFAULT
// (still changeable in the in-app Relays settings + persisted to localStorage). Pilot = Trinity
// Littlehampton's stable Funnel.
const CHURCH_RELAY = 'wss://trinityone.tailbeaac0.ts.net/relay';
const _native = !!(typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const DEFAULT_RELAYS = _native
  ? [CHURCH_RELAY]
  : [((_loc && _loc.protocol === 'https:') ? 'wss://' : 'ws://') + RELAY_BASE + '/relay'];
const RELAYS_KEY = 'trinityone.relays';
function loadRelays() {
  try { const r = JSON.parse(localStorage.getItem(RELAYS_KEY) || 'null'); if (Array.isArray(r) && r.length) return r; } catch {}
  return DEFAULT_RELAYS.slice();
}
const HANDLE_POOL = ['Cedar', 'River', 'Sparrow', 'Olive', 'Wren', 'Maple', 'Reed', 'Dove', 'Ash', 'Linden', 'Heron', 'Bramble'];
const COLORS = ['#5E8C6A', '#C2913A', '#C25A38', '#5360D6', '#1F9488', '#C24B7A'];

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function profile(pub) {
  const h = hashStr(pub || '');
  return { pubkey: pub, handle: 'Anonymous ' + HANDLE_POOL[h % HANDLE_POOL.length], color: COLORS[(h >>> 8) % COLORS.length] };
}

const pool = new SimplePool();
let sk = null, pub = null;

// kind-0 profile metadata cache (pubkey -> {name, picture, about})
const profiles = {};
const pendingProfiles = new Set();
const PROFILE_KEY = 'trinityone.profile';   // own display name (public; ok in localStorage)

const AV_SYMBOLS = ['halo', 'dove', 'fish', 'flame', 'vine', 'wheat', 'anchor', 'crook', 'chalice', 'olive', 'mountain', 'well', 'star'];
// resolved display = kind-0 name/avatar if known, else a deterministic anonymous handle + symbol
function displayFor(pubkey) {
  const base = profile(pubkey);
  const p = profiles[pubkey];
  const av = (p && p.av) || { kind: 'symbol', color: base.color, symbol: AV_SYMBOLS[hashStr(pubkey || '') % AV_SYMBOLS.length] };
  const handle = (p && p.name) || base.handle;
  return { pubkey, handle, name: handle, color: av.color || base.color, av, picture: p && p.picture };
}

async function deriveFromIdentity() {
  const mnemonic = window.TrinityIdentity ? await window.TrinityIdentity.exportMnemonic() : null;
  if (!mnemonic) throw new Error('no identity available to sign with');
  sk = privateKeyFromSeedWords(mnemonic);
  pub = getPublicKey(sk);
  window.Fellowship.myPubkey = pub;
  // signal that the signing key is now ready, so listeners (e.g. the app's serving subscriptions,
  // which bail when myPubkey is null) re-run with a valid pubkey instead of needing a restart.
  try { window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: pub } })); } catch {}
}
async function init() {
  if (window.TrinityIdentity && window.TrinityIdentity.ready) await window.TrinityIdentity.ready;
  await deriveFromIdentity();
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) { const p = JSON.parse(raw); profiles[pub] = p; window.Fellowship.myProfile = p; }
  } catch {}
}
// keep the signing key in step with identity regeneration / restore
window.addEventListener('trinity-identity', () => { deriveFromIdentity().catch(() => {}); });

window.Fellowship = {
  relays: loadRelays(),
  myPubkey: null,
  myProfile: null,
  churchPub: null,        // hex pubkey of the active church; messages are tagged ['p', churchPub]
  ready: null,
  profile,
  displayFor,
  // http(s) base of the church's gateway (derived from its relay) — for the /feed video proxy
  gatewayBase() {
    const r = (window.Fellowship.relays || [])[0] || '';
    try { const u = new URL(r); return (u.protocol === 'wss:' ? 'https:' : 'http:') + '//' + u.host; } catch { return ''; }
  },

  // scope outgoing messages to a church (so its steward can see who's participating). The member
  // app calls this with the active church's npub whenever it changes; null clears the scope.
  setChurch(npubOrHex) { window.Fellowship.churchPub = toPub(npubOrHex); return window.Fellowship.churchPub; },

  // announce membership of a church (a signed, addressable presence event) so the steward can see
  // people who joined even if they never post. Idempotent (addressable, d=member:<churchPub>).
  // This makes the member's pseudonymous npub visible as a member of this church.
  async announceMembership(npubOrHex) {
    const cp = toPub(npubOrHex); if (!cp) return;
    if (!sk) { try { await window.Fellowship.ready; } catch { return; } }
    if (!sk) return;
    const evt = finalizeEvent({
      kind: 30078, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp]],
      content: JSON.stringify({ joined: Math.floor(Date.now() / 1000) }),
    }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] membership publish failed', e); }
    return evt;
  },
  // leave a church: tombstone the membership event (they vanish from the steward's list unless they
  // have posted). Wired for when an unfollow action exists.
  async leaveMembership(npubOrHex) {
    const cp = toPub(npubOrHex); if (!cp || !sk) return;
    const evt = finalizeEvent({
      kind: 30078, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp], ['deleted', '1']], content: '',
    }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch {}
    return evt;
  },

  // relay configuration (persisted) — accepts ws:// or wss:// URLs
  setRelays(urls) {
    const list = [...new Set((urls || []).map(u => (u || '').trim()).filter(u => /^wss?:\/\//i.test(u)))];
    window.Fellowship.relays = list.length ? list : DEFAULT_RELAYS.slice();
    try { localStorage.setItem(RELAYS_KEY, JSON.stringify(window.Fellowship.relays)); } catch {}
    window.dispatchEvent(new CustomEvent('trinity-relays', { detail: window.Fellowship.relays }));
    return window.Fellowship.relays;
  },
  addRelay(url) { return window.Fellowship.setRelays([...window.Fellowship.relays, url]); },
  removeRelay(url) { return window.Fellowship.setRelays(window.Fellowship.relays.filter(r => r !== url)); },

  // publish this user's kind-0 profile (display name etc.) and cache it
  async setProfile(meta) {
    if (!sk) await window.Fellowship.ready;
    const prev = profiles[pub] || {};
    const p = {
      name: (meta.name != null ? meta.name : (prev.name || '')).trim(),
      about: (meta.about != null ? meta.about : (prev.about || '')).trim(),
      picture: (meta.picture != null ? meta.picture : (prev.picture || '')).trim(),
    };
    if (meta.av || prev.av) p.av = meta.av || prev.av;   // chosen symbol/monogram avatar
    const evt = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(p) }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] profile publish failed', e); }
    profiles[pub] = p; window.Fellowship.myProfile = p;
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {}
    window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: pub } }));
    return evt;
  },

  // fetch kind-0 for pubkeys we haven't resolved yet; fires 'trinity-profiles' on arrival
  requestProfiles(pubkeys) {
    const need = [...new Set(pubkeys)].filter(pk => pk && !(pk in profiles) && !pendingProfiles.has(pk));
    if (!need.length) return;
    need.forEach(pk => pendingProfiles.add(pk));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [0], authors: need }], {
      onevent(e) {
        try {
          const m = JSON.parse(e.content);
          profiles[e.pubkey] = { name: m.name || m.display_name || '', picture: m.picture || '', about: m.about || '', av: m.av || undefined };
          window.dispatchEvent(new CustomEvent('trinity-profiles', { detail: { pubkey: e.pubkey } }));
        } catch {}
      },
      oneose() { need.forEach(pk => pendingProfiles.delete(pk)); try { sub.close(); } catch {} },
    });
  },

  // publish a message to a group (kind 1, tagged with the network + group ids)
  async publishMessage(groupId, content, extraTags = []) {
    if (!sk) await window.Fellowship.ready;
    const churchTag = window.Fellowship.churchPub ? [['p', window.Fellowship.churchPub]] : [];
    const evt = finalizeEvent({
      kind: 1, created_at: Math.floor(Date.now() / 1000),
      tags: [['t', NET], ['t', groupId], ...churchTag, ...extraTags], content,
    }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); }
    catch (e) { console.warn('[fellowship] publish failed', e); }
    return evt;
  },

  // ── direct messages (1:1, encrypted) ──
  // NIP-04 encrypted kind-4: the content is private to the two parties; the relay sees only that two
  // pubkeys are talking (full metadata privacy = NIP-17, a later/Stage-6 upgrade). Peer = a hex pubkey.
  async sendDM(peerPub, content) {
    if (!sk) await window.Fellowship.ready;
    let ciphertext; try { ciphertext = await nip04encrypt(sk, peerPub, content); } catch (e) { console.warn('[fellowship] DM encrypt failed', e); return null; }
    const evt = finalizeEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', peerPub]], content: ciphertext }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] DM publish failed', e); }
    return evt;
  },
  // a 1:1 thread with one peer; onMsg({ id, mine, content, ts, pubkey }). Returns an unsubscribe fn.
  subscribeThread(peerPub, onMsg) {
    if (!pub) return () => {};
    const seen = new Set();
    const deliver = async (e) => {
      if (seen.has(e.id)) return; seen.add(e.id);
      const mine = e.pubkey === pub;
      let content = ''; try { content = await nip04decrypt(sk, peerPub, e.content); } catch (err) { content = '🔒 (could not decrypt)'; }
      try { onMsg({ id: e.id, mine, content, ts: e.created_at, pubkey: e.pubkey }); } catch (err) {}
    };
    const sub = pool.subscribeMany(window.Fellowship.relays, [
      { kinds: [4], authors: [pub], '#p': [peerPub] },   // sent by me to peer
      { kinds: [4], authors: [peerPub], '#p': [pub] },   // sent by peer to me
    ], { onevent: deliver, oneose() {} });
    return () => { try { sub.close(); } catch {} };
  },
  // inbox: every DM involving me, grouped by peer; onConvos([{ peer, lastTs, preview }]). Unsub fn.
  subscribeDMs(onConvos) {
    if (!pub) { onConvos([]); return () => {}; }
    const byPeer = new Map();
    const emit = () => onConvos([...byPeer.values()].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)));
    const handle = async (e) => {
      const peer = e.pubkey === pub ? (e.tags.find(t => t[0] === 'p') || [])[1] : e.pubkey;
      if (!peer) return;
      const prev = byPeer.get(peer);
      if (prev && prev.lastTs >= e.created_at) return;
      let preview = ''; try { preview = await nip04decrypt(sk, peer, e.content); } catch (err) { preview = '🔒'; }
      byPeer.set(peer, { peer, lastTs: e.created_at, preview: (e.pubkey === pub ? 'You: ' : '') + preview });
      emit();
    };
    const sub = pool.subscribeMany(window.Fellowship.relays, [
      { kinds: [4], authors: [pub] }, { kinds: [4], '#p': [pub] },
    ], { onevent: handle, oneose() { emit(); } });
    return () => { try { sub.close(); } catch {} };
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

  // watch several groups at once (for the group-list previews/unread); onEvent(groupId, e).
  // Scoped to the active church (read live so church switches don't miss events): churches that
  // happen to share a group id (e.g. "prayer") don't cross-contaminate each other's chat.
  subscribeGroups(groupIds, onEvent) {
    const set = new Set(groupIds);
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], '#t': groupIds, limit: 500 }], {
      onevent(e) {
        const cp = window.Fellowship.churchPub;
        if (cp && !e.tags.some(t => t[0] === 'p' && t[1] === cp)) return;
        const gid = (e.tags.find(t => t[0] === 't' && set.has(t[1])) || [])[1];
        if (gid) { try { onEvent(gid, e); } catch (err) { console.error(err); } }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // react to a message (NIP-25 kind 7). content = emoji, or '-' to retract.
  async react(groupId, targetId, targetPubkey, content) {
    if (!sk) await window.Fellowship.ready;
    const evt = finalizeEvent({
      kind: 7, created_at: Math.floor(Date.now() / 1000),
      tags: [['e', targetId], ['p', targetPubkey || ''], ['t', NET], ['t', groupId]], content,
    }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch (e) { console.warn('[fellowship] react failed', e); }
    return evt;
  },

  // live reactions in a group; onReaction({ targetId, pubkey, content, ts })
  subscribeReactions(groupId, onReaction) {
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [7], '#t': [groupId], limit: 1000 }], {
      onevent(e) {
        const targetId = (e.tags.find(t => t[0] === 'e') || [])[1];
        if (targetId) { try { onReaction({ targetId, pubkey: e.pubkey, content: e.content, ts: e.created_at }); } catch (err) { console.error(err); } }
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
        // and only this church's messages (when scoped) — avoids cross-church group-id collisions
        const cp = window.Fellowship.churchPub;
        if (cp && !e.tags.some(t => t[0] === 'p' && t[1] === cp)) return;
        try { onEvent(e); } catch (err) { console.error(err); }
      },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ── read a church's published GROUP definitions (kind 30078, by the steward console) ──
  // onGroups([{id,name,kind,sub}]) fires on change; returns an unsubscribe fn.
  subscribeChurchGroups(churchNpub, onGroups) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onGroups([]); return () => {}; }
    const byId = new Map();
    const emit = () => onGroups([...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [pubk], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(GROUP_D)) return;
        const id = d.slice(GROUP_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ── read the reading plans a church shares (kind-30078, d=plan:) ──
  subscribeChurchPlans(churchNpub, onPlans) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onPlans([]); return () => {}; }
    const PLAN_D = 'trinityone/plan:';
    const byId = new Map();
    const emit = () => onPlans([...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [pubk], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(PLAN_D)) return;
        const id = d.slice(PLAN_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ── read the devotionals a church shares (kind-30078, d=devotional:) — full content for rendering ──
  subscribeChurchDevotionals(churchNpub, onDevos) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onDevos([]); return () => {}; }
    const DEVO_D = 'trinityone/devotional:';
    const byId = new Map();
    const emit = () => onDevos([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [pubk], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(DEVO_D)) return;
        const id = d.slice(DEVO_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ── generic reader for the church's own addressable docs with a given d-prefix ──
  _subChurchAddr(churchNpub, prefix, map, onItems) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onItems([]); return () => {}; }
    const byId = new Map();
    const emit = () => onItems([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [pubk], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(prefix)) return;
        const id = d.slice(prefix.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, ...map(JSON.parse(e.content), id), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // ── serving: services, per-service rotas, rosters, events the church publishes ──
  subscribeChurchServices(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/service:', (c) => ({ date: c.date, time: c.time, name: c.name }), cb); },
  subscribeChurchRotas(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/rota:', (c, id) => ({ service: id, published: !!c.published, assign: c.assign || {} }), cb); },
  subscribeChurchRosters(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/roster:', (c, id) => ({ team: id, roles: c.roles || [], people: c.people || [] }), cb); },
  subscribeChurchEvents(churchNpub, cb) { return window.Fellowship._subChurchAddr(churchNpub, 'trinityone/event:', (c) => ({ date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, image: c.image || '', groupId: c.groupId || '' }), cb); },

  // ── serving requests the church p-tagged to ME ("can you serve?") ──
  subscribeMyServingRequests(onReqs) {
    const me = window.Fellowship.myPubkey;
    if (!me) { onReqs([]); return () => {}; }
    const REQUEST_D = 'trinityone/request:';
    const byId = new Map();
    const emit = () => onReqs([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], '#p': [me], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(REQUEST_D)) return;
        const id = d.slice(REQUEST_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, church: e.pubkey, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member -> church: reply to a serving request (accept/decline/swap) — p-tagged to the church
  async respondToServingRequest(churchNpub, requestId, verdict, swapTo) {
    if (!sk) await window.Fellowship.ready;
    const cp = toPub(churchNpub); if (!cp || !sk) return;
    const content = JSON.stringify({ request: requestId, v: verdict, swapTo: swapTo || '' });
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/reqreply:' + requestId], ['t', NET], ['p', cp]], content }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch {}
    return evt;
  },
  // my replies to serving requests (own reqreply docs) -> { requestId: verdict }
  subscribeMyReqReplies(onReplies) {
    const me = window.Fellowship.myPubkey;
    if (!me) { onReplies({}); return () => {}; }
    const RR = 'trinityone/reqreply:'; const byReq = {};
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [me], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(RR)) return; try { byReq[d.slice(RR.length)] = JSON.parse(e.content).v; onReplies({ ...byReq }); } catch {} },
      oneose() { onReplies({ ...byReq }); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member RSVP to a calendar event — one addressable doc per (member,event), p-tagged to church
  async setEventRsvp(churchNpub, eventId, verdict) {
    const cp = toPub(churchNpub); if (!cp || !sk) return;
    const content = JSON.stringify({ event: eventId, v: verdict });
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/rsvp:' + eventId], ['t', NET], ['p', cp]], content }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch {}
    return evt;
  },
  subscribeMyRsvps(onRsvps) {
    const me = window.Fellowship.myPubkey;
    if (!me) { onRsvps({}); return () => {}; }
    const RSVP_D = 'trinityone/rsvp:'; const byEvent = {};
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [me], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(RSVP_D)) return; try { byEvent[d.slice(RSVP_D.length)] = JSON.parse(e.content).v; onRsvps({ ...byEvent }); } catch {} },
      oneose() { onRsvps({ ...byEvent }); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member sets the Sundays they're unavailable (own addressable doc, p-tagged to church)
  async setUnavailable(churchNpub, dates) {
    const cp = toPub(churchNpub); if (!cp || !sk) return;
    const me = window.Fellowship.myPubkey;
    const content = JSON.stringify({ dates: dates || [] });
    const evt = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/unavail:' + me], ['t', NET], ['p', cp]], content }, sk);
    try { await Promise.any(pool.publish(window.Fellowship.relays, evt)); } catch {}
    return evt;
  },

  // ── read a church's kind-0 profile (name etc.) -- used when following a church by npub ──
  subscribeChurchProfile(churchNpub, onProfile) {
    const pubk = toPub(churchNpub);
    if (!pubk) { onProfile(null); return () => {}; }
    let latest = 0;
    const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [0], authors: [pubk] }], {
      onevent(e) { if (e.created_at < latest) return; latest = e.created_at; try { onProfile(JSON.parse(e.content)); } catch {} },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },
};
window.Fellowship.ready = init().catch(e => console.error('[fellowship] init failed', e));
