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
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import { encrypt as nip04encrypt, decrypt as nip04decrypt } from 'nostr-tools/nip04';
import qrcode from 'qrcode-generator';

const NET = 'trinityone';
const KEY_LS = 'trinityone.steward.church-key';     // localStorage seed (pilot)
const FUND_D = 'trinityone/fund:';
const GROUP_D = 'trinityone/group:';
const PLAN_D = 'trinityone/plan:';
const DEVO_D = 'trinityone/devotional:';
const ROSTER_D = 'trinityone/roster:';      // per-team roles + people (church)
const SERVICE_D = 'trinityone/service:';    // a dated gathering (church)
const ROTA_D = 'trinityone/rota:';          // per-service assignments (church)
const EVENT_D = 'trinityone/event:';        // calendar event (church)
const REQUEST_D = 'trinityone/request:';    // steward -> member "can you serve?" (church, p=member)
const REQREPLY_D = 'trinityone/reqreply:';  // member -> steward accept/decline/swap (member, p=church)
const NETWORK_D = 'trinityone/network:';    // church -> network membership ("we belong to X"), p=network
const now = () => Math.floor(Date.now() / 1000);
function toPubHex(npubOrHex) { try { if (/^[0-9a-f]{64}$/i.test(npubOrHex)) return npubOrHex.toLowerCase(); const d = nip19decode(npubOrHex); return d && d.type === 'npub' ? d.data : null; } catch { return null; } }

const RELAYS_LS = 'trinityone.steward.extra-relays';   // extra public relays the church also publishes to
const NETKEYS_LS = 'trinityone.steward.network-keys';  // networks OWNED on this console: [{ pub, mnemonic, name }]
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
// networks whose signing key lives on this device (so this console can publish AS the network)
function netKeys() { try { const a = JSON.parse(lsGet(NETKEYS_LS) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
function saveNetKey(rec) {
  const a = netKeys().filter(x => x.pub !== rec.pub); a.push(rec); lsSet(NETKEYS_LS, JSON.stringify(a));
}
function ownRelay() {
  const l = (typeof location !== 'undefined') ? location : null;
  if (!l || !l.host) return 'ws://127.0.0.1:8090/relay';
  return ((l.protocol === 'https:') ? 'wss://' : 'ws://') + l.host + '/relay';
}
function extraRelays() {
  try { const a = JSON.parse(lsGet(RELAYS_LS) || '[]'); return Array.isArray(a) ? a.filter(Boolean) : []; } catch { return []; }
}
// normalise a user-typed relay address to a ws/wss URL
function normRelay(input) {
  let v = String(input || '').trim();
  if (!v) return '';
  if (!/^wss?:\/\//i.test(v)) v = 'wss://' + v.replace(/^\/+/, '');
  return v.replace(/\/+$/, '');
}
function relays() {
  const own = ownRelay();
  const out = [own];
  for (const r of extraRelays()) { if (r && r !== own && !out.includes(r)) out.push(r); }
  return out;
}

const pool = new SimplePool();
let sk = null, pub = null;                 // the ACTIVE signing identity (church, or an owned network when toggled)
let churchSk = null, churchPub = null;     // the real church key — preserved so we can always switch back
let lastProfile = {};   // cached church profile so partial publishProfile edits don't wipe other fields

function setKey(mnemonic) {
  sk = privateKeyFromSeedWords(mnemonic);
  pub = getPublicKey(sk);
  churchSk = sk; churchPub = pub;           // the device's church key
  window.Steward.pubkey = pub;
  window.Steward.npub = npubEncode(pub);
  window.Steward.churchPub = pub;
  window.Steward.activePub = pub;
  window.Steward.hasKey = true;
}
async function publish(evt) {
  try { await Promise.any(pool.publish(relays(), evt)); }
  catch (e) {
    console.warn('[steward] publish failed', e);
    // every relay rejected — surface it so the steward isn't left wondering why nothing saved
    let reason = '';
    try { const errs = (e && e.errors) || []; reason = (errs[0] && (errs[0].message || String(errs[0]))) || ''; } catch (x) {}
    try { window.dispatchEvent(new CustomEvent('steward-publish-error', { detail: { reason, evt } })); } catch (x) {}
  }
  return evt;
}
// resolve the signing key for a chosen publishing identity. asPub === church pub (or empty) -> church key;
// asPub === an owned network's pub -> that network's key (so the doc is authored by the network).
function skFor(asPub) {
  if (!asPub || asPub === pub) return sk;
  const rec = netKeys().find(x => x.pub === asPub);
  if (rec) { try { return privateKeyFromSeedWords(rec.mnemonic); } catch { return null; } }
  return null;
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
  // load the persisted church key if there is one; only generate a NEW key when none exists.
  // (Bug fix: previously this always created+OVERWROTE the stored key on a normal load, so the church
  // identity changed on every reload — members vanished because they're tagged to the old pubkey.)
  ensureKey() {
    if (window.Steward.hasKey) return { npub: window.Steward.npub };
    if (window.Steward.init()) return { npub: window.Steward.npub };   // init() loads the saved seed
    return window.Steward.createKey();
  },
  exportMnemonic() { return lsGet(KEY_LS); },
  // restore/import a church key from its 12-word recovery phrase (replaces the current key on this device)
  restoreKey(mnemonic) {
    const m = (mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (m.split(' ').length < 12) throw new Error('Enter the full 12-word recovery phrase.');
    setKey(m); lsSet(KEY_LS, m);   // setKey -> privateKeyFromSeedWords throws if the phrase is invalid
    return { npub: window.Steward.npub };
  },

  // ---- publish (signed by the church) ----
  publishProfile(meta) {
    if (!sk) return Promise.resolve(null);
    lastProfile = { ...lastProfile, ...meta };   // merge so a partial edit (e.g. name) keeps channel etc.
    const m = lastProfile;
    const content = JSON.stringify({ name: m.name || '', about: m.about || '', nip05: m.nip05 || '', picture: m.picture || '', channel: m.channel || '', audioFeed: m.audioFeed || '' });
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
  // Post a kind-1 message into a group as the church. MUST carry ['p', churchPub] — the member's
  // subscribeGroup scopes by it, so without it the post is invisible to members (was the bug).
  publishPost(content, group) {
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['t', group || 'announce'], ['p', pub]], content: content || '' }, sk));
  },
  // read a group/team's chat (kind-1 tagged with the group id, scoped to this church) — for the console chat view.
  // Folds in kind-7 reactions (same shape the member app posts) so the console shows + sets reactions too.
  subscribeGroupChat(groupId, onMsgs) {
    const byId = new Map();
    const rx = new Map();   // msgId -> Map(reactorPub -> emoji)
    const attach = () => [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(m => {
      const r = rx.get(m.id); return { ...m, reactions: r ? [...r.values()].filter(Boolean) : [], myReaction: r ? r.get(pub) || '' : '' };
    });
    const emit = () => onMsgs(attach());
    const sub = pool.subscribeMany(relays(), [{ kinds: [1], '#t': [groupId], limit: 300 }, { kinds: [7], '#t': [groupId], limit: 500 }], {
      onevent(e) {
        if (e.kind === 7) {
          const tid = (e.tags.find(t => t[0] === 'e') || [])[1]; if (!tid) return;
          let m = rx.get(tid); if (!m) { m = new Map(); rx.set(tid, m); }
          if (e.content === '-' || e.content === '') m.delete(e.pubkey); else m.set(e.pubkey, e.content);
          emit(); return;
        }
        if (!e.tags.some(t => t[0] === 't' && t[1] === groupId)) return;
        if (!e.tags.some(t => t[0] === 'p' && t[1] === pub)) return;   // this church's scope
        byId.set(e.id, { id: e.id, by: e.pubkey, mine: e.pubkey === pub, text: e.content, ts: e.created_at, kind: (e.tags.find(t => t[0] === 'k') || [])[1] || '' });
        emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // react to a group message (NIP-25 kind-7), interoperable with the member app. emoji '' or '-' retracts.
  reactGroup(groupId, msgId, targetPub, emoji) {
    if (!sk || !groupId || !msgId) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 7, created_at: now(), tags: [['e', msgId], ['p', targetPub || ''], ['t', NET], ['t', groupId]], content: emoji || '-' }, sk));
  },

  // ---- direct messages: the church <-> a member (NIP-04 encrypted kind-4) ----
  async sendDM(peerHex, content) {
    if (!sk || !peerHex) return null;
    let enc = ''; try { enc = await nip04encrypt(sk, peerHex, content); } catch { return null; }
    const evt = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', peerHex], ['t', NET]], content: enc }, sk);
    return publish(evt);
  },
  // the 1:1 thread with one member (decrypts both directions; carries kind-7 reactions per message)
  subscribeDMThread(peerHex, onMsgs) {
    const byId = new Map();
    const rx = new Map();   // msgId -> Map(reactorPub -> emoji)
    const attach = () => [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(m => {
      const r = rx.get(m.id); const reactions = r ? [...r.values()].filter(Boolean) : [];
      return { ...m, reactions, myReaction: r ? r.get(pub) || '' : '' };
    });
    const emit = () => onMsgs(attach());
    const take = async (e) => {
      if (byId.has(e.id)) return;
      const mine = e.pubkey === pub; const other = mine ? peerHex : e.pubkey;
      let text = ''; try { text = await nip04decrypt(sk, other, e.content); } catch { return; }
      byId.set(e.id, { id: e.id, mine, text, ts: e.created_at }); emit();
    };
    const takeRx = (e) => {
      const tid = (e.tags.find(t => t[0] === 'e') || [])[1]; if (!tid) return;
      let m = rx.get(tid); if (!m) { m = new Map(); rx.set(tid, m); }
      if (e.content === '-' || e.content === '') m.delete(e.pubkey); else m.set(e.pubkey, e.content);
      emit();
    };
    const sub = pool.subscribeMany(relays(), [
      { kinds: [4], authors: [pub], '#p': [peerHex] }, { kinds: [4], authors: [peerHex], '#p': [pub] },
      { kinds: [7], authors: [pub], '#p': [peerHex] }, { kinds: [7], authors: [peerHex], '#p': [pub] },
    ], {
      onevent(e) { if (e.kind === 7) takeRx(e); else take(e); }, oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // react to a member's DM (NIP-25 kind-7). emoji '' or '-' retracts.
  async reactDM(peerHex, msgId, emoji) {
    if (!sk || !peerHex || !msgId) return null;
    const evt = finalizeEvent({ kind: 7, created_at: now(), tags: [['e', msgId], ['p', peerHex], ['t', NET], ['k', '4']], content: emoji || '-' }, sk);
    return publish(evt);
  },
  // list of members who have a DM thread with the church (most recent first)
  subscribeDMConvos(onConvos) {
    const byPeer = new Map();
    const emit = () => onConvos([...byPeer.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [4], authors: [pub] }, { kinds: [4], '#p': [pub] }], {
      onevent(e) {
        const mine = e.pubkey === pub; const peer = mine ? (e.tags.find(t => t[0] === 'p') || [])[1] : e.pubkey;
        if (!peer || peer === pub) return;
        const prev = byPeer.get(peer);
        if (!prev || e.created_at > prev.ts) { byPeer.set(peer, { peer, npub: npubEncode(peer), ts: e.created_at }); emit(); }
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
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

  // ---- groups (the church's chat rooms) ----
  publishGroup(group) {
    if (!sk) return Promise.resolve(null);
    const id = group.id || ('grp' + Date.now());
    const content = JSON.stringify({ name: group.name || 'Group', kind: group.kind || 'group', sub: group.sub || '', icon: group.icon || '', accent: group.accent || '', leaders: Array.isArray(group.leaders) ? group.leaders : [] });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + id], ['t', NET]], content }, sk))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  // set which members can post events for a group (re-publishes the group def, preserving its fields)
  setGroupLeaders(group, leaderPubs) {
    return window.Steward.publishGroup({ ...group, leaders: (leaderPubs || []).filter(Boolean) });
  },
  removeGroup(id) {
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + id], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  subscribeGroups(onGroups) {
    const byId = new Map();
    const emit = () => onGroups([...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }], {
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

  // ---- reading plans the church shares with the congregation ----
  // Published as a signed kind-30078 (d=plan:<id>) with the full plan (days included) so member apps
  // render it without needing the plan built in. Members then start/track it locally.
  // asPub (optional) publishes the plan AS an owned network instead of the church — network-wide reading plan.
  publishPlan(plan, asPub) {
    const signer = skFor(asPub); if (!signer) return Promise.resolve(null);
    const id = plan.id || ('plan' + Date.now());
    const content = JSON.stringify({ id, title: plan.title || 'Plan', sub: plan.sub || '', tag: plan.tag || '', accent: plan.accent || 'var(--clay)', blurb: plan.blurb || '', days: plan.days || [] });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', PLAN_D + id], ['t', NET]], content }, signer))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  removePlan(id) {
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', PLAN_D + id], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  subscribePlans(onPlans) {
    const byId = new Map();
    const emit = () => onPlans([...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }], {
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

  // ---- devotionals the church shares (an uploaded text/Markdown reflection on a passage) ----
  // devo = { id?, title, ref, text }. The file (.txt or .md) is read client-side; its text is stored in the event.
  publishDevotional(devo) {
    if (!sk) return Promise.resolve(null);
    const id = devo.id || ('devo' + Date.now());
    const base = { id, title: devo.title || 'Devotional', ref: devo.ref || '', type: devo.type || 'txt', text: devo.text || '' };
    if (typeof devo.order === 'number') base.order = devo.order;   // steward-controlled display order (lower = first)
    const content = JSON.stringify(base);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', DEVO_D + id], ['t', NET]], content }, sk))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  removeDevotional(id) {
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', DEVO_D + id], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  subscribeDevotionals(onDevos) {
    const byId = new Map();
    // explicit steward order first (lower = earlier); the rest fall back to newest-first
    const ord = d => (typeof d.order === 'number' ? d.order : Infinity);
    const emit = () => onDevos([...byId.values()].sort((a, b) => ord(a) - ord(b) || (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(DEVO_D)) return;
        const id = d.slice(DEVO_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { const c = JSON.parse(e.content); byId.set(id, { id, title: c.title, ref: c.ref, type: c.type, text: c.text || '', order: c.order, hasFile: !!c.text, ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ════════════ SERVING / ROTA / CALENDAR (the coverage board) ════════════
  // A generic addressable-doc subscription over the church's own kind-30078 with a given d-prefix.
  _subAddr(prefix, map, onItems) {
    const byId = new Map();
    const emit = () => onItems([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }], {
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

  // ---- team rosters: the roles a team needs + the people who can serve ----
  // roster = { roles:[{id,name}], people:[{id,name,pub?}] }, keyed by team(group) id.
  publishRoster(teamId, roster) {
    if (!sk || !teamId) return Promise.resolve(null);
    const roles = (roster.roles || []).map(r => ({ id: r.id || ('r' + Math.random().toString(36).slice(2, 7)), name: r.name || 'Role' }));
    const people = (roster.people || []).map(p => ({ id: p.id || ('p' + Math.random().toString(36).slice(2, 7)), name: p.name || '', pub: p.pub || '' }));
    const content = JSON.stringify({ roles, people });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ROSTER_D + teamId], ['t', NET]], content }, sk))
      .then(() => ({ id: teamId, roles, people }));
  },
  subscribeRosters(onRosters) { return this._subAddr(ROSTER_D, (c, id) => ({ team: id, roles: c.roles || [], people: c.people || [] }), onRosters); },

  // ---- services: a dated gathering people serve at ----
  // service = { id?, date:'YYYY-MM-DD', time:'10:30', name }
  publishService(svc) {
    if (!sk) return Promise.resolve(null);
    const id = svc.id || ('svc' + Date.now());
    const content = JSON.stringify({ date: svc.date || '', time: svc.time || '10:30', name: svc.name || 'Sunday Gathering' });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', SERVICE_D + id], ['t', NET]], content }, sk))
      .then(() => ({ id, ...JSON.parse(content) }));
  },
  removeService(id) {
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', SERVICE_D + id], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  subscribeServices(onServices) { return this._subAddr(SERVICE_D, (c) => ({ date: c.date, time: c.time, name: c.name }), onServices); },

  // ---- rota: assignments for one service (latest wins; published flag) ----
  // rota = { service:<serviceId>, published:bool, assign:{ '<teamId>::<roleId>': {name, pub} } }
  publishRota(rota) {
    if (!sk || !rota || !rota.service) return Promise.resolve(null);
    const content = JSON.stringify({ service: rota.service, published: !!rota.published, assign: rota.assign || {} });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ROTA_D + rota.service], ['t', NET]], content }, sk))
      .then(() => ({ id: rota.service, service: rota.service, published: !!rota.published, assign: rota.assign || {} }));
  },
  removeRota(serviceId) {
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ROTA_D + serviceId], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  subscribeRotas(onRotas) { return this._subAddr(ROTA_D, (c, id) => ({ service: id, published: !!c.published, assign: c.assign || {} }), onRotas); },

  // ---- calendar events (non-serving: workdays, lunches, prayer evenings…) ----
  // event = { id?, date, time, title, where, blurb, accent }
  // asPub (optional) publishes the event AS an owned network instead of the church — network-wide event.
  publishEvent(ev, asPub) {
    const signer = skFor(asPub); if (!signer) return Promise.resolve(null);
    const id = ev.id || ('evt' + Date.now());
    const groupId = ev.groupId || '';
    const content = JSON.stringify({ date: ev.date || '', time: ev.time || '', title: ev.title || 'Event', where: ev.where || '', blurb: ev.blurb || '', accent: ev.accent || 'var(--clay)', image: ev.image || '', groupId });
    const tags = [['d', EVENT_D + id], ['t', NET]];
    if (groupId) tags.push(['t', groupId]);   // lets a group's chat filter to its own events
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags, content }, signer))
      .then(() => ({ id, ...JSON.parse(content) }));
  },
  removeEvent(id) {
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', EVENT_D + id], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  subscribeEvents(onEvents) { return this._subAddr(EVENT_D, (c) => ({ date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent }), onEvents); },

  // ---- serving requests: steward -> a member "can you serve?" (p-tagged to the member) ----
  sendServingRequest(req) {
    if (!sk || !req || !req.memberPub) return Promise.resolve(null);
    const id = req.id || ('req' + Date.now());
    const content = JSON.stringify({ serviceId: req.serviceId || '', teamId: req.teamId || '', roleId: req.roleId || '', role: req.role || '', teamName: req.teamName || '', icon: req.icon || 'hand', accent: req.accent || 'var(--clay)', date: req.date || '', time: req.time || '', service: req.service || '', from: req.from || 'Your church', note: req.note || '' });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', REQUEST_D + id], ['t', NET], ['p', req.memberPub]], content }, sk))
      .then(() => ({ id, ...JSON.parse(content), memberPub: req.memberPub }));
  },
  // the church's own "can you serve?" request docs (so the board can join replies to a slot)
  subscribeRequests(onRequests) {
    const byId = new Map();
    const emit = () => onRequests([...byId.values()]);
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(REQUEST_D)) return;
        const id = d.slice(REQUEST_D.length);
        const memberPub = (e.tags.find(t => t[0] === 'p') || [])[1] || '';
        if (!e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, memberPub, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // the steward's view of replies members sent back (reqreply docs p-tagged to the church)
  subscribeRequestReplies(onReplies) {
    const byId = new Map();
    const emit = () => onReplies([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#p': [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(REQREPLY_D)) return;
        const id = d.slice(REQREPLY_D.length);
        if (!e.content) { byId.delete(id); emit(); return; }
        try { byId.set(id, { id, by: e.pubkey, ...JSON.parse(e.content), ts: e.created_at }); emit(); } catch {}
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member unavailability docs p-tagged to the church -> { memberPub: [dates] } (for "Away" + Auto-fill)
  subscribeUnavail(onUnavail) {
    const UNAVAIL_D = 'trinityone/unavail:'; const byMember = {};
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#p': [pub], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(UNAVAIL_D)) return; try { byMember[e.pubkey] = JSON.parse(e.content).dates || []; onUnavail({ ...byMember }); } catch {} },
      oneose() { onUnavail({ ...byMember }); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // member RSVPs p-tagged to the church -> { eventId: { memberPub: v } } (for "going" counts)
  subscribeRsvps(onRsvps) {
    const RSVP_D = 'trinityone/rsvp:'; const byEvent = {};
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], '#p': [pub], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(RSVP_D)) return; const ev = d.slice(RSVP_D.length); try { (byEvent[ev] = byEvent[ev] || {})[e.pubkey] = JSON.parse(e.content).v; onRsvps({ ...byEvent }); } catch {} },
      oneose() { onRsvps({ ...byEvent }); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- members: people who participate in this church's chat ----
  // In an anonymous, self-custodial model there is no follower registry. The real, privacy-
  // respecting signal a steward can see is participation: members tag their messages with the
  // church's pubkey (['p', churchPub]), so we read kind-1 events addressed to us, aggregate by
  // author, and resolve each author's kind-0 profile. The church's own posts are excluded.
  subscribeMembers(onMembers) {
    const MEMBER_D = 'trinityone/member:';
    const byPub = new Map();          // pubkey -> { pubkey, npub, name, picture, count, lastTs, firstTs, joined }
    const profSubs = new Map();       // pubkey -> kind-0 sub (resolve display name)
    const emit = () => onMembers([...byPub.values()].sort((a, b) => ((b.lastTs || b.joined || 0) - (a.lastTs || a.joined || 0))));
    const get = (pk) => byPub.get(pk) || { pubkey: pk, npub: npubEncode(pk), name: '', picture: '', count: 0, lastTs: 0, firstTs: Infinity, joined: 0 };
    const ensureProfile = (pk) => {
      if (profSubs.has(pk)) return;
      const s = pool.subscribeMany(relays(), [{ kinds: [0], authors: [pk] }], {
        onevent(e) { try { const meta = JSON.parse(e.content); const m = byPub.get(pk); if (m) { m.name = meta.name || meta.display_name || ''; m.picture = meta.picture || ''; emit(); } } catch {} },
        oneose() {},
      });
      profSubs.set(pk, s);
    };
    // kind-1 = participation (message count); kind-30078 member:<pub> = an explicit join (even if quiet)
    const sub = pool.subscribeMany(relays(), [{ kinds: [1], '#p': [pub] }, { kinds: [30078], '#p': [pub] }], {
      onevent(e) {
        if (e.pubkey === pub) return;                  // skip the church's own posts
        if (e.kind === 30078) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (!d.startsWith(MEMBER_D)) return;
          const left = e.tags.some(t => t[0] === 'deleted') || !e.content;
          const m = get(e.pubkey);
          if (left) { m.joined = 0; if (m.count === 0) { byPub.delete(e.pubkey); emit(); return; } }
          else { let j = e.created_at; try { j = JSON.parse(e.content).joined || e.created_at; } catch {} m.joined = j; }
          byPub.set(e.pubkey, m); ensureProfile(e.pubkey); emit(); return;
        }
        const m = get(e.pubkey);
        m.count++; if (e.created_at > m.lastTs) m.lastTs = e.created_at; if (e.created_at < m.firstTs) m.firstTs = e.created_at;
        byPub.set(e.pubkey, m); ensureProfile(e.pubkey); emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} for (const s of profSubs.values()) { try { s.close(); } catch {} } };
  },

  // ---- church profile (kind-0): name etc. shown to members and in the console ----
  subscribeProfile(onProfile) {
    let latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [0], authors: [pub] }], {
      onevent(e) { if (e.created_at < latest) return; latest = e.created_at; try { const p = JSON.parse(e.content); lastProfile = { ...lastProfile, ...p }; onProfile(p); } catch {} },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- networks: a church declares it belongs to a wider group/network (its own npub) ----
  // The church publishes network:<networkPub> (p-tagged to the network). Members of the church
  // discover the network and can follow it — its groups/events/plans load like any church.
  joinNetwork(input) {
    if (!sk) return Promise.resolve(null);
    const np = toPubHex(input); if (!np) return Promise.resolve(null);
    const content = JSON.stringify({ joined: true });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', NETWORK_D + np], ['t', NET], ['p', np]], content }, sk)).then(() => ({ networkPub: np, npub: npubEncode(np) }));
  },
  leaveNetwork(networkPub) {
    if (!sk) return Promise.resolve(null);
    const np = toPubHex(networkPub) || networkPub;
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', NETWORK_D + np], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  // create a brand-new network: generate its key, join it (so the relay lets it post here), then
  // publish the network's profile + a starter announcements channel (signed by the network key).
  // Returns { npub, mnemonic } — save/share these to run the network's own console later.
  async createNetwork(name) {
    if (!sk) return null;
    const m = generateSeedWords();
    const nsk = privateKeyFromSeedWords(m);
    const nPub = getPublicKey(nsk);
    saveNetKey({ pub: nPub, mnemonic: m, name: name || 'Network' });   // keep the key so this console can publish AS the network
    await window.Steward.joinNetwork(nPub);   // church joins first so the relay whitelists the network key
    await publish(finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: name || 'Network' }) }, nsk));
    await publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + 'net-announce'], ['t', NET]], content: JSON.stringify({ name: 'Announcements', kind: 'broadcast', sub: 'From ' + (name || 'the network'), icon: 'globe', accent: 'var(--clay)' }) }, nsk));
    window.dispatchEvent(new CustomEvent('steward-networks'));
    return { networkPub: nPub, npub: npubEncode(nPub), mnemonic: m };
  },
  // networks whose signing key is on THIS console -> [{ pub, npub, name }] (publish-as identities)
  ownedNetworks() { return netKeys().map(r => ({ pub: r.pub, npub: npubEncode(r.pub), name: r.name || 'Network' })); },
  // post a broadcast announcement AS an owned network (kind-1 into the net-announce channel)
  publishNetworkAnnouncement(networkPub, text) {
    const signer = skFor(networkPub); if (!signer || !text || !text.trim()) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['t', 'net-announce'], ['p', networkPub]], content: text.trim() }, signer));
  },
  // a network's broadcast announcements (most recent first) — for previewing on the console
  subscribeNetworkAnnouncements(networkPub, onPosts) {
    const np = toPubHex(networkPub) || networkPub;
    const byId = new Map();
    const emit = () => onPosts([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [1], authors: [np], '#t': ['net-announce'] }], {
      onevent(e) { byId.set(e.id, { id: e.id, text: e.content, ts: e.created_at }); emit(); }, oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // import an existing network's recovery phrase so this console can also publish as it
  importNetworkKey(mnemonic, name) {
    const mm = (mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (mm.split(' ').length < 12) throw new Error('Enter the full 12-word recovery phrase.');
    const nsk = privateKeyFromSeedWords(mm); const nPub = getPublicKey(nsk);
    saveNetKey({ pub: nPub, mnemonic: mm, name: name || 'Network' });
    window.dispatchEvent(new CustomEvent('steward-networks'));
    return { networkPub: nPub, npub: npubEncode(nPub) };
  },
  // every identity this console can publish as: the church + any owned networks
  identities() {
    return [{ kind: 'church', pub: churchPub, npub: churchPub ? npubEncode(churchPub) : '' }, ...netKeys().map(r => ({ kind: 'network', pub: r.pub, npub: npubEncode(r.pub), name: r.name || 'Network' }))];
  },
  // switch the WHOLE console between the church and an owned network — the active signing+reading
  // identity. Subscriptions are keyed on activePub, so the dashboard re-renders as the chosen identity.
  setActiveIdentity(targetPub) {
    const tp = toPubHex(targetPub) || targetPub || churchPub;
    if (tp === churchPub) { sk = churchSk; pub = churchPub; }
    else {
      const rec = netKeys().find(x => x.pub === tp);
      if (!rec) return false;
      try { sk = privateKeyFromSeedWords(rec.mnemonic); pub = getPublicKey(sk); } catch { return false; }
    }
    lastProfile = {};   // don't carry one identity's profile fields into the other's edits
    window.Steward.pubkey = pub; window.Steward.npub = npubEncode(pub); window.Steward.activePub = pub;
    window.dispatchEvent(new CustomEvent('steward-identity', { detail: { pub } }));
    return true;
  },
  isViewingNetwork() { return pub !== churchPub; },
  // this church's network memberships -> [{ networkPub, npub }]
  subscribeNetworks(onNetworks) {
    const byId = new Map();
    const emit = () => onNetworks([...byId.values()]);
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(NETWORK_D)) return; const np = d.slice(NETWORK_D.length); if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(np); emit(); return; } byId.set(np, { networkPub: np, npub: npubEncode(np) }); emit(); },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },
  // resolve a network's display name (its kind-0 profile)
  subscribeNetworkProfile(networkPub, onProfile) {
    const np = toPubHex(networkPub) || networkPub; let latest = 0;
    const sub = pool.subscribeMany(relays(), [{ kinds: [0], authors: [np] }], {
      onevent(e) { if (e.created_at < latest) return; latest = e.created_at; try { onProfile(JSON.parse(e.content)); } catch {} }, oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- relays: the church's relay(s) — real status, not a mock ----
  relayList() { return relays(); },
  ownRelay() { return ownRelay(); },
  extraRelays() { return extraRelays(); },
  // add a public relay the church ALSO publishes to (redundancy if the self-hosted relay is offline)
  addRelay(input) {
    const url = normRelay(input);
    if (!url || url === ownRelay()) return false;
    const cur = extraRelays(); if (cur.includes(url)) return false;
    lsSet(RELAYS_LS, JSON.stringify([...cur, url]));
    window.dispatchEvent(new CustomEvent('steward-relays'));
    return url;
  },
  removeRelay(url) {
    const next = extraRelays().filter(r => r !== url);
    lsSet(RELAYS_LS, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('steward-relays'));
    return true;
  },
  // probe each relay with a throwaway WS; resolves [{ url, status:'on'|'off', ms }]
  relayStatus() {
    return Promise.all(relays().map(url => new Promise(res => {
      let done = false; const t0 = Date.now();
      const finish = (status) => { if (done) return; done = true; try { ws.close(); } catch {} res({ url, status, ms: status === 'on' ? Date.now() - t0 : null }); };
      let ws;
      try { ws = new WebSocket(url); } catch { return res({ url, status: 'off', ms: null }); }
      const to = setTimeout(() => finish('off'), 2500);
      ws.onopen = () => { clearTimeout(to); finish('on'); };
      ws.onerror = () => { clearTimeout(to); finish('off'); };
    })));
  },
  // live count of the church's footprint on the relay (its own events + everything addressed to it),
  // plus how many of those are the church's own announcements (kind-1 it authored)
  subscribeStats(onStats) {
    const ids = new Set(), ann = new Set();
    const emit = () => onStats({ events: ids.size, announcements: ann.size });
    const sub = pool.subscribeMany(relays(), [{ authors: [pub] }, { '#p': [pub] }], {
      onevent(e) { ids.add(e.id); if (e.kind === 1 && e.pubkey === pub) ann.add(e.id); emit(); },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // a live, recent activity feed derived from real events (groups, joins, posts) — newest first
  subscribeActivity(onActivity, max = 12) {
    const byId = new Map();
    const emit = () => onActivity([...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, max));
    const sub = pool.subscribeMany(relays(), [{ kinds: [1, 30078], authors: [pub] }, { kinds: [1, 30078], '#p': [pub] }], {
      onevent(e) {
        const own = e.pubkey === pub;
        let item = null;
        if (e.kind === 30078) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          const deleted = e.tags.some(t => t[0] === 'deleted') || !e.content;
          if (d.startsWith(GROUP_D)) { let n = ''; try { n = JSON.parse(e.content).name; } catch {} item = { ic: 'chat', tint: 'sage', text: deleted ? 'A group was removed' : `Group “${n || 'untitled'}” ${own ? 'created' : 'updated'}` }; }
          else if (d.startsWith('trinityone/member:')) { if (!deleted) item = { ic: 'pray', tint: 'sage', text: 'A new member joined' }; }
          else if (d.startsWith(FUND_D)) { let n = ''; try { n = JSON.parse(e.content).name; } catch {} item = { ic: 'gift', tint: 'gold', text: deleted ? 'A fund was removed' : `Fund “${n || ''}” updated` }; }
        } else if (e.kind === 1) {
          if (own) item = { ic: 'send', tint: 'gold', text: 'You posted an announcement' };
          else { const g = (e.tags.find(t => t[0] === 't' && t[1] !== NET) || [])[1] || 'a group'; item = { ic: 'chat', tint: 'clay', text: `New message in ${g}` }; }
        }
        if (item) { byId.set(e.id, { id: e.id, ts: e.created_at, ...item }); emit(); }
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- join flow: members follow the church by its npub ----
  // The member app at the gateway root reads ?follow=<npub> and follows the church.
  joinUrl() {
    const np = window.Steward.npub || '';
    const o = (typeof location !== 'undefined' && location.origin) || '';
    // A LAN/localhost origin (plain http) isn't reachable by congregants off the church wifi, so
    // join links/QRs must use the stable PUBLIC url. An https origin (the public Funnel) is used as-is.
    const PUBLIC_BASE = 'https://trinityone.tailbeaac0.ts.net';
    const base = o.startsWith('https://') ? o : PUBLIC_BASE;
    // carry the church's public relay so a member who follows from anywhere connects to the right relay,
    // not just whatever their app defaults to (lets churches run on their own relay).
    const relay = base.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:') + '/relay';
    return base + '/?follow=' + np + '&relay=' + encodeURIComponent(relay);
  },
  // a short, human-shareable code (the npub itself — paste-able into the member app's "Follow a church")
  joinCode() { return window.Steward.npub || ''; },
  // a real QR encoding the join URL; scan with a phone camera to open the app already following.
  joinQR() {
    const qr = qrcode(0, 'M'); qr.addData(window.Steward.joinUrl()); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  },
};

window.Steward.init();
