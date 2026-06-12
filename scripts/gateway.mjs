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
import webpush from 'web-push';
import { randomBytes, timingSafeEqual } from 'crypto';

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
    if (c.kind === 'broadcast' && !removed) BROADCAST.add(id); else BROADCAST.delete(id);
    // a group def may name member leaders who can post events for that group
    if (removed) GROUP_LEADERS.delete(id);
    else GROUP_LEADERS.set(id, new Set(Array.isArray(c.leaders) ? c.leaders : []));
  }
}
// the group id an event-doc is scoped to (its non-NET 't' tag), or '' for a whole-church event
const eventGroup = (e) => { const t = (e.tags || []).find(t => t[0] === 't' && t[1] !== NET); return t ? t[1] : ''; };
function accept(e) {
  if (!CHURCH_PUBS.size) return true;                            // unconfigured = open
  // a network a church belongs to may publish church-style content here (groups/events/plans/posts)
  const isChurch = CHURCH_PUBS.has(e.pubkey), isNetwork = NETWORKS.has(e.pubkey), isLeader = isChurch || isNetwork, isMember = isLeader || MEMBERS.has(e.pubkey);
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
      || d.startsWith(ROSTER_D) || d.startsWith(SERVICE_D) || d.startsWith(REQUEST_D)) return isLeader;   // church/network definitions
    if (d.startsWith(MEMBER_D) || d.startsWith(NETWORK_D)) return true;   // joining a church / a church joining a network
    return isMember;                                            // member's own data (MyData)
  }
  if (k === 1) { const g = gidOf(e); if (g && BROADCAST.has(g)) return isLeader; return isMember; }  // broadcast = church/network
  if (k === 7 || k === 4 || k === 1059 || k === 1060) return isMember;    // reactions + DMs
  return isMember;                                               // anything else: members only
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
  // browser setup wizard: read/write the relay's write policy (church.json). Auth required (token or
  // loopback). The control dashboard uses this so a steward never has to SSH in and edit a file.
  if (route === '/config') {
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS };
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    if (req.method === 'GET') {
      res.writeHead(200, H);
      res.end(JSON.stringify({ ok: true, port: PORT, configured: CHURCH_PUBS.size > 0, churches: [...CHURCH_PUBS].map(p => ({ npub: npubEncode(p), name: CHURCH_NAMES.get(p) || '' })) }));
      return;
    }
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => {
        try {
          const churches = JSON.parse(body || '{}').churches;
          if (!Array.isArray(churches)) throw new Error('expected { churches: [...] }');
          const clean = [];
          for (const c of churches.slice(0, 50)) {
            const npub = String((c && c.npub) || '').trim();
            const hex = toHexPub(npub);
            if (!hex) { res.writeHead(400, H); res.end(JSON.stringify({ error: 'not a valid npub: ' + npub.slice(0, 24) })); return; }
            clean.push({ npub: npubEncode(hex), name: String((c && c.name) || '').slice(0, 80) });
          }
          const tmp = CHURCH_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify({ churches: clean }, null, 2) + '\n'); renameSync(tmp, CHURCH_FILE);
          loadChurches();   // apply live — no restart needed
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
  // web-push: hand out the VAPID public key + accept member push subscriptions
  if (route === '/push/vapid') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ publicKey: VAPID.publicKey })); return; }
  if (route === '/push/subscribe') {
    if (req.method !== 'POST') { res.writeHead(405).end('method'); return; }
    let body = ''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => { try { const { sub, pubkey } = JSON.parse(body); if (sub && sub.endpoint && /^[0-9a-f]{64}$/i.test(pubkey || '')) { const list = pushSubs[pubkey] = pushSubs[pubkey] || []; if (!list.some(s => s.endpoint === sub.endpoint)) { list.push(sub); saveSubs(); } } res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok'); } catch { res.writeHead(400).end('bad'); } });
    return;
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
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/relay') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  subs.set(ws, new Map());
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const [type, ...rest] = msg;
    if (type === 'EVENT') {
      const evt = rest[0]; if (!evt || !evt.id) return;
      if (!accept(evt)) { ws.send(JSON.stringify(['OK', evt.id, false, 'blocked: not a member or not permitted for this group'])); return; }
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
      ws.send(JSON.stringify(['OK', evt.id, true, '']));
      for (const [client, m] of subs) { if (client.readyState !== 1) continue;
        for (const [subId, filters] of m) if (matchAny(evt, filters)) client.send(JSON.stringify(['EVENT', subId, evt])); }
    } else if (type === 'REQ') {
      const subId = rest[0];
      let filters = rest.slice(1);
      if (filters.length === 1 && Array.isArray(filters[0])) filters = filters[0];
      subs.get(ws).set(subId, filters);
      let matched = events.filter(e => matchAny(e, filters));
      const lim = Math.max(0, ...filters.map(f => f.limit || 0));
      if (lim) matched = matched.slice(-lim);
      for (const e of matched) ws.send(JSON.stringify(['EVENT', subId, e]));
      ws.send(JSON.stringify(['EOSE', subId]));
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
