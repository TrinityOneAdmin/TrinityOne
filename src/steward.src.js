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

  // ---- groups (the church's chat rooms) ----
  publishGroup(group) {
    if (!sk) return Promise.resolve(null);
    const id = group.id || ('grp' + Date.now());
    const content = JSON.stringify({ name: group.name || 'Group', kind: group.kind || 'group', sub: group.sub || '', icon: group.icon || '', accent: group.accent || '' });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + id], ['t', NET]], content }, sk))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
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
  publishPlan(plan) {
    if (!sk) return Promise.resolve(null);
    const id = plan.id || ('plan' + Date.now());
    const content = JSON.stringify({ id, title: plan.title || 'Plan', sub: plan.sub || '', tag: plan.tag || '', accent: plan.accent || 'var(--clay)', blurb: plan.blurb || '', days: plan.days || [] });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', PLAN_D + id], ['t', NET]], content }, sk))
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
    const content = JSON.stringify({ id, title: devo.title || 'Devotional', ref: devo.ref || '', type: devo.type || 'txt', text: devo.text || '' });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', DEVO_D + id], ['t', NET]], content }, sk))
      .then(e => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
  },
  removeDevotional(id) {
    if (!sk) return Promise.resolve(null);
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', DEVO_D + id], ['t', NET], ['deleted', '1']], content: '' }, sk));
  },
  subscribeDevotionals(onDevos) {
    const byId = new Map();
    const emit = () => onDevos([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
    const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], '#t': [NET] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (!d.startsWith(DEVO_D)) return;
        const id = d.slice(DEVO_D.length);
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { byId.delete(id); emit(); return; }
        try { const c = JSON.parse(e.content); byId.set(id, { id, title: c.title, ref: c.ref, type: c.type, hasFile: !!c.text, ts: e.created_at }); emit(); } catch {}
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
  publishEvent(ev) {
    if (!sk) return Promise.resolve(null);
    const id = ev.id || ('evt' + Date.now());
    const content = JSON.stringify({ date: ev.date || '', time: ev.time || '', title: ev.title || 'Event', where: ev.where || '', blurb: ev.blurb || '', accent: ev.accent || 'var(--clay)' });
    return publish(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', EVENT_D + id], ['t', NET]], content }, sk))
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
      onevent(e) { if (e.created_at < latest) return; latest = e.created_at; try { onProfile(JSON.parse(e.content)); } catch {} },
      oneose() {},
    });
    return () => { try { sub.close(); } catch {} };
  },

  // ---- relays: the church's relay(s) — real status, not a mock ----
  relayList() { return relays(); },
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
    return base + '/?follow=' + np;
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
