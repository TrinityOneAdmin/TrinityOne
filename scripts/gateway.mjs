// gateway.mjs -- TrinityOne unified self-host gateway.
// ONE node process, ONE port: serves the static web app AND the Nostr relay (at /relay), so the
// whole thing needs exactly ONE public tunnel and the app derives its relay from its own origin
// (ws[s]://<host>/relay). This is the engine the church Relay app wraps. NIP-01 + disk persistence.
//
//   node scripts/gateway.mjs [port]        default port 8090
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, renameSync, statSync, createReadStream } from 'fs';
import { extname, normalize, join, sep } from 'path';
import { lookup as dnsLookup } from 'dns/promises';
import { decode as nip19decode, npubEncode } from 'nostr-tools/nip19';
import { verifyEvent } from 'nostr-tools/pure';
import webpush from 'web-push';
import { randomBytes, timingSafeEqual } from 'crypto';
import { spawn } from 'child_process';

const ROOT = join(new URL('..', import.meta.url).pathname);   // project dir
const PORT = Number(process.argv[2] || process.env.PORT || 8090);
const DB = process.env.RELAY_DB || join(ROOT, 'relay', 'relay-db.json');
const MAX_EVENTS = 20000;

// ---- write policy (enabled only when the church key is configured) ----
// Set the church via env CHURCH_NPUB or relay/church.json {"npub":"npub1…"}. When set, the relay
// enforces: only the church key defines groups/funds and posts to BROADCAST groups; only joined
// members (or the church) may post messages / reactions / DMs / their own data. Unset = open (dev).
const NET = 'trinityone';
const GROUP_D = 'trinityone/group:', FUND_D = 'trinityone/fund:', MEMBER_D = 'trinityone/member:', PLAN_D = 'trinityone/plan:', DEVO_D = 'trinityone/devotional:', ROTA_D = 'trinityone/rota:';
const ROSTER_D = 'trinityone/roster:', SERVICE_D = 'trinityone/service:', EVENT_D = 'trinityone/event:', REQUEST_D = 'trinityone/request:';
const NETWORK_D = 'trinityone/network:';   // the church declares it belongs to a network (the network's pubkey)
const BLOCKED_D = 'trinityone/blocked:';   // a church's blocklist (banned member pubkeys) — d=blocked:<churchpub>
function toHexPub(s) { if (!s) return null; s = String(s).trim(); if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase(); try { const d = nip19decode(s); return d.type === 'npub' ? d.data : null; } catch { return null; } }
// the relay can host MULTIPLE churches — each manages its own data, scoped by author. Configure via
// CHURCH_NPUB (comma-separated) or relay/church.json ({npub} | {npubs:[…]} | {churches:[{npub}…]}).
const CHURCH_PUBS = new Set();
const CHURCH_NAMES = new Map();   // hex pub -> display name (for the Relay app dashboard)
const addChurch = (s, name) => { const h = toHexPub(s); if (h) { CHURCH_PUBS.add(h); if (name) CHURCH_NAMES.set(h, name); } };
const CHURCH_FILE = join(ROOT, 'relay', 'church.json');
// (re)load the write policy from env + church.json — called at startup and after a browser config save
function loadChurches() {
  CHURCH_PUBS.clear(); CHURCH_NAMES.clear();
  (process.env.CHURCH_NPUB || '').split(',').forEach(s => addChurch(s));
  try {
    const cj = JSON.parse(readFileSync(CHURCH_FILE, 'utf8'));
    if (cj) { if (cj.npub) addChurch(cj.npub, cj.name); (cj.npubs || []).forEach(s => addChurch(s)); (cj.churches || []).forEach(c => addChurch(c && (c.npub || c), c && c.name)); }
  } catch {}
}
loadChurches();
// admin token — gates the browser config endpoint (/config), which changes the write policy. Generated
// once and stored 0600. Loopback requests (you're on the box) are trusted; LAN/tunnel must present it.
const ADMIN_FILE = join(ROOT, 'relay', 'admin.json');
let ADMIN_TOKEN = '';
try { ADMIN_TOKEN = JSON.parse(readFileSync(ADMIN_FILE, 'utf8')).token || ''; } catch {}
if (!ADMIN_TOKEN) { ADMIN_TOKEN = randomBytes(24).toString('base64url'); try { writeFileSync(ADMIN_FILE, JSON.stringify({ token: ADMIN_TOKEN }), { mode: 0o600 }); } catch {} }
function reqToken(req) { const h = req.headers['authorization'] || ''; const m = /^Bearer\s+(.+)$/i.exec(h); if (m) return m[1].trim(); try { return new URL(req.url, 'http://x').searchParams.get('token') || ''; } catch { return ''; } }
// Always require the admin token. Do NOT trust loopback: the relay runs behind the Tailscale Funnel /
// cloudflared, which proxy from 127.0.0.1, so a public request is indistinguishable from a local one.
function adminOK(req) { const t = reqToken(req); if (!t || !ADMIN_TOKEN) return false; const a = Buffer.from(t), b = Buffer.from(ADMIN_TOKEN); return a.length === b.length && timingSafeEqual(a, b); }
const STARTED_AT = Date.now();
const MEMBERS = new Set();     // pubkeys that announced membership (minus those removed)
const BROADCAST = new Set();   // group ids the church marked broadcast
const NETWORKS = new Set();    // network pubkeys this church joined — allowed to publish church-style content here
const GROUP_LEADERS = new Map(); // groupId -> Set(pubkey) — members a leader empowered to post events for that group
const BLOCKED_BY = new Map();    // churchpub -> Set(blocked member pubkeys); BLOCKED is the union for fast checks
const BLOCKED = new Set();       // banned pubkeys — rejected on write, withheld on read
function rebuildBlocked() { BLOCKED.clear(); for (const s of BLOCKED_BY.values()) for (const p of s) BLOCKED.add(p); }
const GROUP_VIS = new Map();     // groupId -> 'open' | 'invite'
const GROUP_MEMBERS = new Map(); // groupId -> Set(pubkey) allowed to post in an invite-only group

// ---- web push (VAPID): notify members of serving requests in real time (PWA) ----
const VAPID_PATH = join(ROOT, 'relay', 'vapid.json');
const SUBS_PATH = join(ROOT, 'relay', 'push-subs.json');
let VAPID = null;
try { VAPID = JSON.parse(readFileSync(VAPID_PATH, 'utf8')); }
catch { VAPID = webpush.generateVAPIDKeys(); try { writeFileSync(VAPID_PATH, JSON.stringify(VAPID)); } catch {} }
webpush.setVapidDetails('mailto:steward@trinityone.app', VAPID.publicKey, VAPID.privateKey);
let pushSubs = {};   // { memberHex: [PushSubscription, …] }
try { pushSubs = JSON.parse(readFileSync(SUBS_PATH, 'utf8')); } catch {}
function saveSubs() { try { writeFileSync(SUBS_PATH, JSON.stringify(pushSubs)); } catch {} }
function pushTo(memberHex, payload) {
  const list = pushSubs[memberHex] || [];
  list.forEach(sub => webpush.sendNotification(sub, JSON.stringify(payload)).catch(err => {
    if (err && (err.statusCode === 410 || err.statusCode === 404)) { pushSubs[memberHex] = (pushSubs[memberHex] || []).filter(s => s.endpoint !== sub.endpoint); saveSubs(); }
  }));
}
// fire a push to the church's steward when a brand-new member joins (a member: doc for one of our
// churches, not a leave, not the church itself, and not someone we already counted). wasMember is the
// membership state captured BEFORE note() ran, so a returning member's heartbeat doesn't re-alert.
function maybePushJoin(evt, wasMember) {
  try {
    if (wasMember || evt.kind !== 30078) return;
    const d = (evt.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (!d.startsWith(MEMBER_D)) return;
    const churchPub = d.slice(MEMBER_D.length);
    if (!CHURCH_PUBS.has(churchPub) || evt.pubkey === churchPub) return;
    if ((evt.tags || []).some(t => t[0] === 'deleted') || !evt.content) return;   // a leave, not a join
    let name = '';   // best-effort: the joiner's latest kind-0 display name
    for (let i = events.length - 1; i >= 0; i--) { const e = events[i]; if (e.pubkey === evt.pubkey && e.kind === 0) { try { const m = JSON.parse(e.content); name = m.name || m.display_name || ''; } catch {} break; } }
    pushTo(churchPub, { title: 'New member', body: (name || 'Someone') + ' just joined your church', url: '/steward', tag: 'join-' + evt.pubkey.slice(0, 8) });
  } catch {}
}
// fire a push when the church sends a member a serving request (p-tagged to them)
function maybePush(evt) {
  try {
    if (evt.kind !== 30078 || !CHURCH_PUBS.has(evt.pubkey)) return;
    const d = (evt.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (!d.startsWith(REQUEST_D)) return;
    const target = (evt.tags.find(t => t[0] === 'p') || [])[1]; if (!target) return;
    const c = JSON.parse(evt.content || '{}');
    pushTo(target, { title: 'Can you serve?', body: `${c.teamName || 'Serving'} · ${c.role || ''}${c.date ? ' · ' + c.date : ''}`, url: '/?serving=1' });
  } catch {}
}
const dtag = (e) => { const t = (e.tags || []).find(t => t[0] === 'd'); return t ? t[1] : ''; };
// NIP-01 replaceable (0/3/10000-19999) + addressable (30000-39999 by d-tag): keep only the newest
// per (pubkey, kind[, d]). Without this, e.g. a member's swap then decline reqreply both linger and
// clients guess by arrival order — the source of stale/wrong rota verdicts.
function replKey(e) {
  const k = e.kind;
  if (k === 0 || k === 3 || (k >= 10000 && k < 20000)) return e.pubkey + ':' + k;
  if (k >= 30000 && k < 40000) return e.pubkey + ':' + k + ':' + dtag(e);
  return null;
}
function dedupEvents(arr) {
  const latest = new Map(); const plain = [];
  for (const e of arr) { const rk = replKey(e); if (!rk) { plain.push(e); continue; } const cur = latest.get(rk); if (!cur || (e.created_at || 0) >= (cur.created_at || 0)) latest.set(rk, e); }
  return [...plain, ...latest.values()].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
}
const gidOf = (e) => { const t = (e.tags || []).find(t => t[0] === 't' && t[1] !== NET); return t ? t[1] : ''; };
function note(e) {   // keep MEMBERS / BROADCAST in step with accepted events
  if (!CHURCH_PUBS.size || e.kind !== 30078) return;
  const d = dtag(e), removed = (e.tags || []).some(t => t[0] === 'deleted') || !e.content;
  if (d.startsWith(MEMBER_D) && CHURCH_PUBS.has(d.slice(MEMBER_D.length))) { if (removed) MEMBERS.delete(e.pubkey); else MEMBERS.add(e.pubkey); }   // joined one of our churches
  else if (d.startsWith(NETWORK_D) && CHURCH_PUBS.has(e.pubkey)) {   // a church joined/left a network
    const np = d.slice(NETWORK_D.length); if (removed) NETWORKS.delete(np); else NETWORKS.add(np);
  }
  else if (d.startsWith(GROUP_D) && (CHURCH_PUBS.has(e.pubkey) || NETWORKS.has(e.pubkey))) {
    const id = d.slice(GROUP_D.length); let c = {}; try { c = JSON.parse(e.content); } catch {}
    if (removed) { BROADCAST.delete(id); GROUP_LEADERS.delete(id); GROUP_VIS.delete(id); GROUP_MEMBERS.delete(id); return; }
    if (c.kind === 'broadcast') BROADCAST.add(id); else BROADCAST.delete(id);
    // a group def may name member leaders who can post events for that group
    GROUP_LEADERS.set(id, new Set(Array.isArray(c.leaders) ? c.leaders : []));
    // invite-only groups carry the allowlist of member pubkeys who may post
    if (c.visibility === 'invite') { GROUP_VIS.set(id, 'invite'); GROUP_MEMBERS.set(id, new Set((Array.isArray(c.members) ? c.members : []).map(p => toHexPub(p) || p).filter(Boolean))); }
    else { GROUP_VIS.set(id, 'open'); GROUP_MEMBERS.delete(id); }
  }
  else if (d.startsWith(BLOCKED_D) && CHURCH_PUBS.has(e.pubkey) && d.slice(BLOCKED_D.length) === e.pubkey) {
    const set = new Set(); if (!removed) { try { (JSON.parse(e.content).pubkeys || []).forEach(p => { const h = toHexPub(p); if (h) set.add(h); }); } catch {} }
    BLOCKED_BY.set(e.pubkey, set); rebuildBlocked();
    for (const pk of set) MEMBERS.delete(pk);   // a blocked member drops off the roster
  }
}
// the group id an event-doc is scoped to (its non-NET 't' tag), or '' for a whole-church event
const eventGroup = (e) => { const t = (e.tags || []).find(t => t[0] === 't' && t[1] !== NET); return t ? t[1] : ''; };
function accept(e) {
  if (!CHURCH_PUBS.size) return true;                            // unconfigured = open
  // a network a church belongs to may publish church-style content here (groups/events/plans/posts)
  const isChurch = CHURCH_PUBS.has(e.pubkey), isNetwork = NETWORKS.has(e.pubkey), isLeader = isChurch || isNetwork, isMember = isLeader || MEMBERS.has(e.pubkey);
  if (BLOCKED.has(e.pubkey) && !isLeader) return false;          // a blocked member can't write anything
  const k = e.kind;
  if (k === 0) return true;                                      // profiles (replaceable, low risk)
  if (k === 30078) {
    const d = dtag(e);
    if (d.startsWith(EVENT_D)) {   // a group's leader may post an event for that one group
      if (isLeader) return true;
      const g = eventGroup(e); const leaders = g && GROUP_LEADERS.get(g);
      return !!(leaders && leaders.has(e.pubkey));
    }
    if (d.startsWith(GROUP_D) || d.startsWith(FUND_D) || d.startsWith(PLAN_D) || d.startsWith(DEVO_D) || d.startsWith(ROTA_D)
      || d.startsWith(ROSTER_D) || d.startsWith(SERVICE_D) || d.startsWith(REQUEST_D) || d.startsWith(BLOCKED_D)) return isLeader;   // church/network definitions (incl. the blocklist)
    if (d.startsWith(MEMBER_D) || d.startsWith(NETWORK_D)) return true;   // joining a church / a church joining a network
    return isMember;                                            // member's own data (MyData)
  }
  if (k === 1) {   // chat
    const g = gidOf(e);
    if (g && BROADCAST.has(g)) return isLeader;                 // broadcast channel = church/network only
    if (g && GROUP_VIS.get(g) === 'invite') { const mem = GROUP_MEMBERS.get(g); return isLeader || !!(mem && mem.has(e.pubkey)); }  // invite-only group
    return isMember;
  }
  if (k === 7 || k === 4 || k === 1059 || k === 1060) return isMember;    // reactions + DMs
  return isMember;                                               // anything else: members only
}
// read-gate (NIP-42): an invite-only group's messages are served only to a connection that has proven
// (via AUTH) it belongs to that group's member list (or is the church/network). Everything else is public.
function canRead(e, authed) {
  if (e.kind !== 1) return true;
  const g = gidOf(e);
  if (!g || GROUP_VIS.get(g) !== 'invite') return true;
  if (!authed) return false;
  if (CHURCH_PUBS.has(authed) || NETWORKS.has(authed)) return true;
  const mem = GROUP_MEMBERS.get(g); return !!(mem && mem.has(authed));
}

// ---- static file serving ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.jsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.gz': 'application/gzip', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.map': 'application/json',
  '.apk': 'application/vnd.android.package-archive', '.webmanifest': 'application/manifest+json',
};
// ---- video feed proxy: fetch a church's YouTube/Rumble channel feed server-side (browsers can't,
// the RSS has no CORS). Returns { channel:{name,url,platform}, videos:[{id,ytId,title,published,thumb}] }.
const feedCache = new Map();            // channelUrl -> { ts, data }
const FEED_TTL = 8 * 60 * 1000;
const decodeXml = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
// ---- SSRF guard: the /feed and /audiofeed proxies fetch church-supplied URLs server-side. Only
// allow public http(s) hosts, re-checked on every redirect hop, so the proxy can't be aimed at the
// gateway's own network — cloud metadata (169.254.169.254), localhost, or LAN admin panels.
// (Residual: DNS rebinding between this lookup and fetch's own resolution; acceptable for the pilot.)
function isPrivateIp(ip) {
  ip = String(ip).toLowerCase();
  const v4 = ip.replace(/^::ffff:/, '').match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = +v4[1], b = +v4[2];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return ip === '::1' || ip === '::' || ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd');
}
async function assertPublicUrl(raw) {
  let u; try { u = new URL(raw); } catch { throw new Error('bad url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked protocol');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('blocked host');
  let addrs; try { addrs = await dnsLookup(host, { all: true }); } catch { throw new Error('dns'); }
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('blocked address');
  return u;
}
async function fetchText(url) {
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(cur);
    const r = await fetch(cur, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; TrinityOne/1.0)' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (r.status >= 300 && r.status < 400) { const loc = r.headers.get('location'); if (!loc) throw new Error('bad redirect'); cur = new URL(loc, cur).toString(); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  throw new Error('too many redirects');
}
async function resolveYouTube(input) {
  let channelId = (input.match(/channel\/(UC[\w-]+)/) || input.match(/^(UC[\w-]+)$/) || [])[1] || null;
  if (!channelId) {
    let pageUrl = input;
    if (/^@[\w.\-]+$/.test(input)) pageUrl = 'https://www.youtube.com/' + input;
    else if (!/^https?:/i.test(input)) pageUrl = 'https://www.youtube.com/' + input.replace(/^\/+/, '');
    const html = await fetchText(pageUrl);
    channelId = (html.match(/"channelId":"(UC[\w-]+)"/) || html.match(/channel\/(UC[\w-]+)/) || [])[1] || null;
  }
  if (!channelId) throw new Error('could not resolve YouTube channel');
  const xml = await fetchText('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId);
  const chName = decodeXml((xml.match(/<title>([^<]+)<\/title>/) || [])[1] || 'Channel');
  const videos = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const vid = (e.match(/<yt:videoId>([^<]+)</) || [])[1]; if (!vid) continue;
    videos.push({ id: vid, ytId: vid, title: decodeXml((e.match(/<title>([^<]+)</) || [])[1] || ''), published: (e.match(/<published>([^<]+)</) || [])[1] || '', thumb: 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg' });
  }
  return { channel: { name: chName, url: 'https://www.youtube.com/channel/' + channelId, platform: 'youtube' }, videos };
}
async function resolveRumble(input) {
  // Rumble has no clean public feed; best-effort scrape of the channel page for video links.
  const html = await fetchText(input);
  const name = decodeXml((html.match(/<title>([^<]+)<\/title>/) || [])[1] || 'Channel').replace(/\s*-\s*Rumble.*$/i, '');
  const videos = []; const seen = new Set(); const re = /href="(\/v[a-z0-9]+-[^"]+\.html)"/gi; let m;
  while ((m = re.exec(html)) && videos.length < 15) { if (seen.has(m[1])) continue; seen.add(m[1]); videos.push({ id: m[1], rumbleUrl: 'https://rumble.com' + m[1], title: '', published: '', thumb: '' }); }
  return { channel: { name, url: input, platform: 'rumble' }, videos };
}
async function getFeed(url) {
  const cached = feedCache.get(url); if (cached && Date.now() - cached.ts < FEED_TTL) return cached.data;
  let data;
  if (/youtu\.?be|youtube\.com/.test(url) || /^@[\w.\-]+$/.test(url) || /^UC[\w-]+$/.test(url)) data = await resolveYouTube(url);
  else if (/rumble\.com/.test(url)) data = await resolveRumble(url);
  else data = { channel: { url, platform: 'link' }, videos: [] };
  feedCache.set(url, { ts: Date.now(), data });
  return data;
}

// ---- audio feed proxy: a church's podcast RSS -> episodes the Listen tab streams (CORS-free) ----
const audioCache = new Map();
const pickTag = (block, tag) => { const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i')); return m ? decodeXml(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()) : ''; };
async function resolvePodcast(url) {
  const xml = await fetchText(url);
  const head = xml.split('<item')[0];
  const chName = pickTag(head, 'title') || 'Podcast';
  const chImg = (head.match(/<itunes:image[^>]*href="([^"]+)"/i) || head.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i) || [])[1] || '';
  const episodes = [];
  for (const part of xml.split('<item').slice(1)) {
    const block = '<item' + part.split('</item>')[0];
    const enc = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*>/i);
    const audio = enc ? enc[1] : '';
    const type = (block.match(/<enclosure[^>]*type="([^"]+)"/i) || [])[1] || '';
    if (!audio || (type && !/audio/i.test(type) && !/\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.test(audio))) continue;
    episodes.push({
      id: pickTag(block, 'guid') || audio,
      title: pickTag(block, 'title') || 'Episode',
      audio, published: pickTag(block, 'pubDate'),
      duration: pickTag(block, 'itunes:duration'),
      image: (block.match(/<itunes:image[^>]*href="([^"]+)"/i) || [])[1] || chImg,
    });
    if (episodes.length >= 50) break;
  }
  return { channel: { name: chName, image: chImg, url, platform: 'podcast' }, episodes };
}
async function getAudioFeed(url) {
  const c = audioCache.get(url); if (c && Date.now() - c.ts < FEED_TTL) return c.data;
  const data = await resolvePodcast(url);
  audioCache.set(url, { ts: Date.now(), data });
  return data;
}

// security response headers. CSP is deliberately compatible with the current build (Babel needs
// 'unsafe-eval'; the app has many inline styles/handlers → 'unsafe-inline') but still blocks the
// big wins: no external/injected <script>, no <object>/<embed>, no <base> hijack, no framing.
// Referrer-Policy: no-referrer also stops invite links (which carry a seed in the URL) leaking via Referer.
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' };
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss: ws:",
  "object-src 'none'", "base-uri 'self'", "frame-src 'self'", "frame-ancestors 'self'",
].join('; ');

// ── Tailscale control (powers the "Go public" wizard in relay-app/control.html) ────────────────
// The installer grants the relay user `tailscale set --operator`, so these run without sudo. Every
// route that calls these is gated behind the admin token (adminOK) — nothing here is interpolated
// into a shell (spawn with an arg array), and the only caller-supplied value (an optional auth key)
// is format-checked first.
const TS_BIN = 'tailscale';
function tsRun(args, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false, child;
    const finish = (code) => { if (done) return; done = true; resolve({ code, out, err }); };
    try { child = spawn(TS_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ code: -1, out: '', err: String((e && e.message) || e), missing: true }); return; }
    child.on('error', (e) => { err += String((e && e.message) || e); finish(-1); });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => finish(code));
    if (timeoutMs) setTimeout(() => finish(0), timeoutMs);
  });
}
async function tsState() {
  const st = await tsRun(['status', '--json'], { timeoutMs: 8000 });
  if (st.missing || /not found|executable file not found|no such file/i.test(st.err)) return { installed: false };
  let j = null; try { j = JSON.parse(st.out); } catch {}
  if (!j) {
    const needsOperator = /operator|access denied|permission denied|use sudo|connect: permission/i.test(st.err);
    return { installed: true, backendState: 'Unknown', needsOperator, error: (st.err || '').trim().slice(0, 200) };
  }
  const backendState = j.BackendState || 'Unknown';
  const dnsName = String((j.Self && j.Self.DNSName) || '').replace(/\.$/, '');
  let funnelOn = false;
  const sv = await tsRun(['serve', 'status', '--json'], { timeoutMs: 6000 });
  try { const sj = JSON.parse(sv.out); funnelOn = !!(sj && sj.AllowFunnel && Object.values(sj.AllowFunnel).some(Boolean)); } catch {}
  if (!funnelOn) { const fn = await tsRun(['funnel', 'status'], { timeoutMs: 6000 }); if (/https:\/\/\S+/.test(fn.out)) funnelOn = true; }
  const publicUrl = (funnelOn && dnsName) ? 'https://' + dnsName : '';
  return { installed: true, backendState, loggedIn: backendState === 'Running', dnsName, funnelOn, publicUrl, relayWss: publicUrl ? publicUrl.replace(/^https/, 'wss') + '/relay' : '' };
}

function serveStatic(req, res) {
  const route = (req.url || '/').split('?')[0];
  // relay status (for the Relay app control dashboard)
  if (route === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true, port: PORT, uptimeMs: Date.now() - STARTED_AT,
      writePolicy: CHURCH_PUBS.size > 0,
      // church npubs/names are intentionally NOT exposed here (unauthenticated) — the dashboard reads
      // the list from the token-gated /config; /status carries only non-sensitive counts.
      counts: { churches: CHURCH_PUBS.size, members: MEMBERS.size, broadcastGroups: BROADCAST.size, events: events.length, connections: wss ? wss.clients.size : 0 },
    }));
    return;
  }
  // self-host bundle: a fresh tarball of the committed code, so a new relay box can install straight
  // from this funnel instead of the (private) GitHub repo. `git archive` only emits tracked files —
  // relay/ secrets are gitignored, so nothing sensitive ships. Public on purpose (the installer curls it).
  if (route === '/relay-app/bundle.tgz') {
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="trinityone.tar.gz"' });
    const git = spawn('git', ['-C', ROOT, 'archive', '--format=tar.gz', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
    git.stdout.pipe(res);
    git.on('error', () => { try { res.destroy(); } catch {} });
    git.on('close', (code) => { if (code !== 0) { try { res.destroy(); } catch {} } });
    return;
  }
  // "Go public" wizard control — token-gated. Lets the relay dashboard bring the node onto Tailscale
  // and turn on Funnel (public HTTPS/WSS) with no terminal. See relay-app/control.html.
  if (route === '/tailscale/state' || route === '/tailscale/up' || route === '/tailscale/funnel') {
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS };
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    if (route === '/tailscale/state' && req.method === 'GET') {
      tsState().then(s => { res.writeHead(200, H); res.end(JSON.stringify(s)); })
        .catch(e => { res.writeHead(200, H); res.end(JSON.stringify({ installed: true, error: String((e && e.message) || e) })); });
      return;
    }
    if (route === '/tailscale/up' && req.method === 'POST') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        let authKey = ''; try { authKey = String((JSON.parse(body || '{}')).authKey || '').trim(); } catch {}
        if (authKey && !/^tskey-[A-Za-z0-9-]+$/.test(authKey)) { res.writeHead(400, H); res.end('{"error":"that does not look like a Tailscale auth key"}'); return; }
        tsState().then(cur => {
          if (cur.loggedIn) { res.writeHead(200, H); res.end(JSON.stringify({ running: true, ...cur })); return; }
          const args = ['up']; if (authKey) args.push('--auth-key=' + authKey);
          let resolved = false, buf = '';
          const respond = (obj, code = 200) => { if (resolved) return; resolved = true; res.writeHead(code, H); res.end(JSON.stringify(obj)); };
          let child;
          try { child = spawn(TS_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
          catch (e) { respond({ error: String((e && e.message) || e) }, 500); return; }
          const scan = () => { const m = buf.match(/https:\/\/login\.tailscale\.com\/\S+/); if (m) respond({ authUrl: m[0] }); };
          child.stdout.on('data', d => { buf += d; scan(); });
          child.stderr.on('data', d => { buf += d; scan(); });
          child.on('error', e => respond({ error: String((e && e.message) || e) }, 500));
          child.on('close', code => respond({ running: code === 0, code, output: buf.trim().slice(0, 300) }));
          setTimeout(() => respond({ pending: true, output: buf.trim().slice(0, 300) }), 12000);
          child.unref();   // let `up` keep running so the login can complete; the client polls /state
        }).catch(e => { res.writeHead(500, H); res.end(JSON.stringify({ error: String((e && e.message) || e) })); });
      });
      return;
    }
    if (route === '/tailscale/funnel' && req.method === 'POST') {
      tsRun(['funnel', '--bg', String(PORT)], { timeoutMs: 25000 }).then(async r => {
        if (r.code === 0) { const s = await tsState(); res.writeHead(200, H); res.end(JSON.stringify({ ok: true, ...s })); }
        else { const needsPolicy = /funnel|not available|https|cert|denied|not enabled/i.test((r.err || '') + (r.out || '')); res.writeHead(200, H); res.end(JSON.stringify({ ok: false, error: (r.err || r.out || 'funnel failed').trim().slice(0, 300), needsPolicy })); }
      }).catch(e => { res.writeHead(500, H); res.end(JSON.stringify({ error: String((e && e.message) || e) })); });
      return;
    }
    res.writeHead(405, H); res.end('{"error":"method"}'); return;
  }
  // browser setup wizard: read/write the relay's write policy (church.json). Auth required (token or
  // loopback). The control dashboard uses this so a steward never has to SSH in and edit a file.
  if (route === '/config') {
    // token-gated, so cross-origin is fine (the steward console on pages.dev registers its church here)
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...CORS };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...SEC_HEADERS, ...CORS }); res.end(); return; }
    const isAdmin = adminOK(req);
    const curChurches = () => [...CHURCH_PUBS].map(p => ({ npub: npubEncode(p), name: CHURCH_NAMES.get(p) || '' }));
    const writeChurches = (list) => { const tmp = CHURCH_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify({ churches: list }, null, 2) + '\n'); renameSync(tmp, CHURCH_FILE); loadChurches(); };
    if (req.method === 'GET') {
      if (!isAdmin) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }   // don't leak the church list
      res.writeHead(200, H);
      res.end(JSON.stringify({ ok: true, port: PORT, configured: CHURCH_PUBS.size > 0, churches: curChurches() }));
      return;
    }
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          // addChurch: idempotent append. Authorized by EITHER the admin token OR a NIP-98 proof signed by
          // the church key being registered — so a steward self-registers their OWN church (and only it),
          // with no admin token. (Append only ever adds one's own npub; it can't clobber other churches.)
          if (parsed.addChurch) {
            const hex = toHexPub(String(parsed.addChurch.npub || '').trim());
            if (!hex) { res.writeHead(400, H); res.end(JSON.stringify({ error: 'not a valid npub' })); return; }
            if (!isAdmin) {
              const a = parsed.auth;
              const sigOk = a && typeof a === 'object' && a.kind === 27235 && verifyEvent(a);
              const fresh = sigOk && Math.abs(Math.floor(Date.now() / 1000) - (a.created_at || 0)) <= 300;
              const ownsKey = sigOk && a.pubkey === hex;   // the signer IS the church being registered
              const uTag = sigOk && (a.tags.find(t => t[0] === 'u') || [])[1];
              const uOk = uTag && /\/config\/?$/.test(String(uTag));   // bound to this endpoint (anti-replay)
              if (!(sigOk && fresh && ownsKey && uOk)) { res.writeHead(401, H); res.end(JSON.stringify({ error: 'unauthorized: register with the admin token, or sign a fresh proof with this church key' })); return; }
            }
            const list = curChurches();
            const name = String(parsed.addChurch.name || '').slice(0, 80);
            const existing = list.find(c => toHexPub(c.npub) === hex);
            // cap self-registration: a valid signature is cheap to mint with a fresh keypair, so
            // without a ceiling anyone could append churches forever and bloat the write policy.
            // The admin token bypasses this (real onboarding); a new self-register past the cap is refused.
            if (!isAdmin && !existing && list.length >= 200) { res.writeHead(429, H); res.end(JSON.stringify({ error: 'registration capacity reached — contact the relay operator' })); return; }
            if (existing) { if (name) existing.name = name; } else { list.push({ npub: npubEncode(hex), name }); }
            writeChurches(list);
            res.writeHead(200, H); res.end(JSON.stringify({ ok: true, added: npubEncode(hex), configured: true, churches: isAdmin ? list : undefined }));
            return;
          }
          // full replace — admin token only (rewrites the whole write policy)
          if (!isAdmin) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
          const churches = parsed.churches;
          if (!Array.isArray(churches)) throw new Error('expected { churches: [...] } or { addChurch: {…} }');
          const clean = [];
          for (const c of churches.slice(0, 50)) {
            const hex = toHexPub(String((c && c.npub) || '').trim());
            if (!hex) { res.writeHead(400, H); res.end(JSON.stringify({ error: 'not a valid npub: ' + String((c && c.npub) || '').slice(0, 24) })); return; }
            clean.push({ npub: npubEncode(hex), name: String((c && c.name) || '').slice(0, 80) });
          }
          writeChurches(clean);
          res.writeHead(200, H); res.end(JSON.stringify({ ok: true, configured: CHURCH_PUBS.size > 0, churches: clean }));
        } catch (e) { res.writeHead(400, H); res.end(JSON.stringify({ error: String((e && e.message) || 'bad request') })); }
      });
      return;
    }
    res.writeHead(405, H); res.end('{"error":"method"}'); return;
  }
  // audio (podcast) feed proxy
  if (route === '/audiofeed') {
    let u = ''; try { u = new URL(req.url, 'http://x').searchParams.get('url') || ''; } catch {}
    const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=600' }); res.end(JSON.stringify(obj)); };
    if (!u) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); res.end('{"error":"no url"}'); return; }
    getAudioFeed(u).then(json).catch(e => json({ channel: { url: u, platform: 'podcast' }, episodes: [], error: String((e && e.message) || e) }));
    return;
  }
  // video feed proxy
  if (route === '/feed') {
    let u = ''; try { u = new URL(req.url, 'http://x').searchParams.get('url') || ''; } catch {}
    const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=600' }); res.end(JSON.stringify(obj)); };
    if (!u) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); res.end('{"error":"no url"}'); return; }
    getFeed(u).then(json).catch(e => json({ channel: { url: u, platform: 'link' }, videos: [], error: String((e && e.message) || e) }));
    return;
  }
  // audio-bible chunk proxy: range-fetch a slice of a WHITELISTED public-domain WEB audio zip so the
  // member app can pull a single chapter (CORS-free) and inflate it. Whitelist = SSRF guard; len-capped.
  if (route === '/audiozip') {
    const H = { 'Access-Control-Allow-Origin': '*' };
    const SRC = { nt: 'https://www.audiotreasure.com/content/WEBD_AT/zipfiles/WEB_NT_Audio.zip', ot: 'https://www.audiotreasure.com/content/WEBD_AT/zipfiles/WEB_OT_Audio.zip' };
    let q; try { q = new URL(req.url, 'http://x').searchParams; } catch { q = null; }
    const t = q && q.get('t'); const start = q && parseInt(q.get('start'), 10); const len = q && parseInt(q.get('len'), 10);
    if (!q || !SRC[t] || !Number.isFinite(start) || start < 0 || !Number.isFinite(len) || len <= 0 || len > 30 * 1024 * 1024) { res.writeHead(400, H); res.end('bad request'); return; }
    fetch(SRC[t], { headers: { Range: 'bytes=' + start + '-' + (start + len - 1) } })
      .then(async up => {
        if (up.status !== 206 && up.status !== 200) { res.writeHead(502, H); res.end('upstream ' + up.status); return; }
        const buf = Buffer.from(await up.arrayBuffer());
        res.writeHead(200, { ...H, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000', 'Content-Length': buf.length });
        res.end(buf);
      }).catch(() => { try { res.writeHead(502, H); res.end('upstream error'); } catch {} });
    return;
  }
  // web-push: hand out the VAPID public key + accept member push subscriptions
  if (route === '/push/vapid') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ publicKey: VAPID.publicKey })); return; }
  if (route === '/push/subscribe') {
    if (req.method !== 'POST') { res.writeHead(405).end('method'); return; }
    let body = ''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const { sub, auth } = JSON.parse(body);
        const j401 = (m) => { res.writeHead(401, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end(m); };
        if (!sub || !sub.endpoint) { res.writeHead(400).end('bad'); return; }
        // require a NIP-98-style proof the subscriber controls the pubkey, bound to THIS endpoint, fresh —
        // so nobody can register their endpoint under another member's key (notification hijack).
        if (!auth || typeof auth !== 'object' || !verifyEvent(auth)) return j401('unauthorized');
        const u = (auth.tags.find(t => t[0] === 'u') || [])[1];
        if (u !== sub.endpoint) return j401('endpoint mismatch');
        if (Math.abs(Math.floor(Date.now() / 1000) - (auth.created_at || 0)) > 300) return j401('stale proof');
        const pubkey = auth.pubkey;
        if (!/^[0-9a-f]{64}$/i.test(pubkey)) { res.writeHead(400).end('bad'); return; }
        const list = pushSubs[pubkey] = pushSubs[pubkey] || [];
        if (!list.some(s => s.endpoint === sub.endpoint)) { list.push(sub); saveSubs(); }
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
      } catch { res.writeHead(400).end('bad'); }
    });
    return;
  }
  // NIP-05: serve verified `name@thisrelay` handles for this relay's people (the church + its members),
  // resolved from their kind-0 profiles. First-come on a slug; the church outranks members. So a member
  // gets a real verified handle for free — no third-party domain.
  if (route === '/.well-known/nostr.json') {
    let qName = ''; try { qName = (new URL(req.url, 'http://x').searchParams.get('name') || '').toLowerCase().trim(); } catch {}
    const host = (req.headers.host || '').split(',')[0].trim();
    const relayUrl = host ? 'wss://' + host + '/relay' : '';
    const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '').slice(0, 30);
    const names = {}, relays = {}, claimed = new Set();
    // churches first (priority), then members; earliest profile wins a contested slug
    const k0 = events.filter(e => e.kind === 0).sort((a, b) => (CHURCH_PUBS.has(b.pubkey) - CHURCH_PUBS.has(a.pubkey)) || ((a.created_at || 0) - (b.created_at || 0)));
    for (const e of k0) {
      if (BLOCKED.has(e.pubkey)) continue;
      let meta = {}; try { meta = JSON.parse(e.content); } catch {}
      let local = (meta.nip05 && String(meta.nip05).includes('@')) ? slug(String(meta.nip05).split('@')[0]) : slug(meta.name);
      if (!local || claimed.has(local)) continue;
      claimed.add(local); names[local] = e.pubkey; if (relayUrl) relays[e.pubkey] = [relayUrl];
    }
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (qName) { const pk = names[qName]; res.writeHead(200, H); res.end(JSON.stringify(pk ? { names: { [qName]: pk }, relays: relayUrl ? { [pk]: [relayUrl] } : {} } : { names: {} })); return; }
    res.writeHead(200, H); res.end(JSON.stringify({ names, relays })); return;
  }
  let p; try { p = decodeURIComponent(route); } catch { res.writeHead(400).end('bad request'); return; }
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  // path-traversal guard: the resolved path must stay strictly inside ROOT. Normalize ROOT's trailing
  // separator first (it may already carry one), so the boundary is exactly `<root>/` — a sibling like
  // `<root>-evil` can't satisfy it, and the trailing-slash double-up doesn't reject valid files.
  const rootBase = ROOT.replace(/[/\\]+$/, '');
  if (file !== rootBase && !file.startsWith(rootBase + sep)) { res.writeHead(403).end('forbidden'); return; }
  let st; try { st = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
  if (st.isDirectory()) { res.writeHead(404).end('not found'); return; }
  const ext = extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Access-Control-Allow-Origin': '*', ...SEC_HEADERS };
  if (ext === '.html') headers['Content-Security-Policy'] = CSP;
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

// ---- relay (NIP-01, persisted) ----
let events = [];
try { const d = JSON.parse(readFileSync(DB, 'utf8')); if (Array.isArray(d)) events = dedupEvents(d).slice(-MAX_EVENTS); } catch {}
if (CHURCH_PUBS.size) events.forEach(note);   // rebuild member/broadcast state from stored events
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null;
    try { const tmp = DB + '.tmp'; writeFileSync(tmp, JSON.stringify(events)); renameSync(tmp, DB); }
    catch (e) { console.warn('[relay] save failed:', e.message); }
  }, 1500);
}
function matchFilter(evt, f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  if (f.ids && !f.ids.includes(evt.id)) return false;
  if (f.authors && !f.authors.includes(evt.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(evt.kind)) return false;
  if (f.since && evt.created_at < f.since) return false;
  if (f.until && evt.created_at > f.until) return false;
  for (const k in f) if (k[0] === '#') {
    const tag = k.slice(1), vals = f[k];
    if (!evt.tags.some(t => t[0] === tag && vals.includes(t[1]))) return false;
  }
  return true;
}
const matchAny = (evt, filters) => filters.some(f => matchFilter(evt, f));
const subs = new Map();   // ws -> Map(subId -> filters[])

const server = createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });   // 1 MB cap (default is 100 MB — memory-DoS guard)
const MAX_SUBS_PER_CONN = 64;   // a single connection can't flood the relay with REQ subscriptions
server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/relay') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  subs.set(ws, new Map());
  ws.isAlive = true;
  ws._auth = null;                                    // pubkey once the client proves it via NIP-42 AUTH
  ws._challenge = randomBytes(16).toString('hex');    // per-connection nonce
  try { ws.send(JSON.stringify(['AUTH', ws._challenge])); } catch {}   // invite-only reads need an authed connection
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const [type, ...rest] = msg;
    if (type === 'EVENT') {
      const evt = rest[0]; if (!evt || !evt.id) return;
      if (!accept(evt)) { ws.send(JSON.stringify(['OK', evt.id, false, 'blocked: not a member or not permitted for this group'])); return; }
      const wasMember = MEMBERS.has(evt.pubkey);   // capture before note() flips it, to detect a genuinely new join
      note(evt);   // a membership/broadcast change takes effect for subsequent events
      // replaceable/addressable: drop older versions; ignore if we already hold a newer one
      const rk = replKey(evt);
      if (rk) {
        const older = [];
        for (let i = events.length - 1; i >= 0; i--) { if (replKey(events[i]) !== rk) continue; if ((events[i].created_at || 0) > (evt.created_at || 0)) { ws.send(JSON.stringify(['OK', evt.id, true, 'have newer'])); return; } older.push(i); }
        for (const i of older) events.splice(i, 1);   // descending indices — safe to splice in order
      }
      events.push(evt); if (events.length > MAX_EVENTS) events.shift();
      scheduleSave();
      maybePush(evt);   // notify the targeted member if this is a serving request
      maybePushJoin(evt, wasMember);   // notify the steward's phone if this is a fresh church join
      ws.send(JSON.stringify(['OK', evt.id, true, '']));
      for (const [client, m] of subs) { if (client.readyState !== 1) continue;
        for (const [subId, filters] of m) if (matchAny(evt, filters) && canRead(evt, client._auth)) client.send(JSON.stringify(['EVENT', subId, evt])); }
    } else if (type === 'REQ') {
      const subId = rest[0];
      let filters = rest.slice(1);
      if (filters.length === 1 && Array.isArray(filters[0])) filters = filters[0];
      const mysubs = subs.get(ws);
      if (!mysubs.has(subId) && mysubs.size >= MAX_SUBS_PER_CONN) { ws.send(JSON.stringify(['CLOSED', subId, 'rate-limited: too many subscriptions'])); return; }
      mysubs.set(subId, filters);
      // withhold a blocked member's events, and an invite-only group's messages from non-members (NIP-42)
      let matched = events.filter(e => matchAny(e, filters) && !BLOCKED.has(e.pubkey) && canRead(e, ws._auth));
      const lim = Math.max(0, ...filters.map(f => f.limit || 0));
      if (lim) matched = matched.slice(-lim);
      for (const e of matched) ws.send(JSON.stringify(['EVENT', subId, e]));
      ws.send(JSON.stringify(['EOSE', subId]));
    } else if (type === 'AUTH') {
      // NIP-42: the client proves which pubkey it controls, so we can serve it invite-only group reads
      const evt = rest[0];
      try {
        const ch = evt && (evt.tags.find(t => t[0] === 'challenge') || [])[1];
        const fresh = evt && Math.abs(Math.floor(Date.now() / 1000) - (evt.created_at || 0)) < 600;
        if (evt && evt.kind === 22242 && ch === ws._challenge && fresh && verifyEvent(evt)) {
          ws._auth = evt.pubkey; ws.send(JSON.stringify(['OK', evt.id, true, '']));
        } else ws.send(JSON.stringify(['OK', (evt && evt.id) || '', false, 'auth-failed: bad challenge or signature']));
      } catch { ws.send(JSON.stringify(['OK', (evt && evt.id) || '', false, 'auth-failed'])); }
    } else if (type === 'CLOSE') { subs.get(ws)?.delete(rest[0]); }
  });
  ws.on('close', () => subs.delete(ws));
});
// keepalive: ping every 25s so idle relay sockets stay open through the Tailscale Funnel / mobile NAT
// (otherwise live pushes silently stop until the client reconnects). Terminate sockets that miss a pong.
const wsHeartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false; try { ws.ping(); } catch {}
  }
}, 25000);
wss.on('close', () => clearInterval(wsHeartbeat));
server.listen(PORT, '0.0.0.0', () =>
  console.log(`TrinityOne gateway on http://0.0.0.0:${PORT}  (app + relay at /relay, ${events.length} events loaded)` +
    (CHURCH_PUBS.size ? `\n  write policy ON — ${CHURCH_PUBS.size} church(es), ${MEMBERS.size} members, ${BROADCAST.size} broadcast group(s)` : `\n  write policy OFF (open relay — set up a church in the control dashboard)`) +
    `\n  setup / control:  http://localhost:${PORT}/relay-app/control.html` +
    `\n  admin token (needed to configure from another device): ${ADMIN_TOKEN}`));
