// gateway.mjs -- TrinityOne unified self-host gateway.
// ONE node process, ONE port: serves the static web app AND the Nostr relay (at /relay), so the
// whole thing needs exactly ONE public tunnel and the app derives its relay from its own origin
// (ws[s]://<host>/relay). This is the engine the church Relay app wraps. NIP-01 + disk persistence.
//
//   node scripts/gateway.mjs [port]        default port 8090
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, renameSync, statSync, createReadStream, existsSync, mkdirSync } from 'fs';
import { extname, normalize, join, sep } from 'path';
import { lookup as dnsLookup } from 'dns/promises';
import { decode as nip19decode, npubEncode } from 'nostr-tools/nip19';
import { openStore, matchFilter } from './event-store.mjs';   // durable event storage (node:sqlite) + the canonical read predicate
import { verifyEvent } from 'nostr-tools/pure';
import webpush from 'web-push';
import { randomBytes, timingSafeEqual } from 'crypto';
import { spawn, spawnSync } from 'child_process';

const ROOT = join(new URL('..', import.meta.url).pathname);   // project dir
const PORT = Number(process.argv[2] || process.env.PORT || 8090);
const DB = process.env.RELAY_DB || join(ROOT, 'relay', 'relay-db.json');                 // legacy JSON store (migrated from, once)
const SQLITE_DB = process.env.RELAY_SQLITE || join(ROOT, 'relay', 'relay.sqlite');       // durable event store
const MAX_EVENTS = parseInt(process.env.RELAY_MAX_EVENTS, 10) || 20000;   // ephemeral budget; raise on a shared/public relay
const NONMEMBER_KIND0_CAP = 1000;   // cap stored profiles from non-members (L2: prevent unbounded growth)
const STEWARDREQ_CAP = 50;          // cap pending steward-requests per church from strangers (audit L1: anti-flood)
// relay feature toggles — what this box serves besides the Nostr relay itself (owner request). Defaults
// preserve current behaviour (all on); edited via the token-gated /settings endpoint + the control dashboard.
const SETTINGS_FILE = join(ROOT, 'relay', 'relay-settings.json');
const SETTINGS = { serveApp: true, serveModules: true, serveAudio: true, appUrl: '' };
function loadSettings() {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    if (s && typeof s === 'object') {
      SETTINGS.serveApp = s.serveApp !== false; SETTINGS.serveModules = s.serveModules !== false;
      SETTINGS.serveAudio = s.serveAudio !== false; SETTINGS.appUrl = typeof s.appUrl === 'string' ? s.appUrl.slice(0, 200) : '';
    }
  } catch {}
}
function saveSettings() { try { const tmp = SETTINGS_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify(SETTINGS, null, 2) + '\n'); renameSync(tmp, SETTINGS_FILE); } catch {} }
loadSettings();

// where this box pulls code updates from (written by the installer); blank on the release host itself.
const ORIGIN = (() => { try { return readFileSync(join(ROOT, 'relay', 'origin'), 'utf8').trim(); } catch { return ''; } })();
// build version — `git archive` stamps version.txt via export-subst when the bundle is built; on a git
// working tree the $Format placeholders stay literal, so fall back to git. Reported in /status so the
// control dashboard can tell an installed relay whether a newer build is available.
const BUILD = (() => {
  let sha = '', date = '';
  try { const [a, b] = readFileSync(join(ROOT, 'version.txt'), 'utf8').split('\n'); sha = (a || '').trim(); date = (b || '').trim(); } catch {}
  if (!sha || sha.startsWith('$Format')) {
    try { sha = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(); } catch {}
    try { date = spawnSync('git', ['-C', ROOT, 'show', '-s', '--format=%cI', 'HEAD'], { encoding: 'utf8' }).stdout.trim(); } catch {}
  }
  return { sha, short: sha.slice(0, 7), date };
})();
const UPDATE_FLAG = join(ROOT, 'relay', '.update-request');   // the relay can only write under relay/; a root path-unit watches this and runs the update

// ---- signed self-update bundle ----------------------------------------------------------------
// Security: the self-update downloads /relay-app/bundle.tgz and applies it. To stop a compromised
// origin/DNS/TLS pushing a malicious bundle, the release host SIGNS the bundle with an Ed25519
// release secret (relay/release-key.pem — gitignored, release host only) and serves a detached
// signature at /relay-app/bundle.sig. Every relay verifies that signature against the BAKED-IN
// public key (relay-app/release-pubkey.pem, committed) before applying — see scripts/relay-update.sh.
//
// CRITICAL byte-identity: `git archive HEAD` is not byte-deterministic across invocations (gzip mtime
// etc.), so we MUST sign the exact bytes we serve. We generate the bundle ONCE, cache it keyed by the
// current HEAD sha, and serve the cached bytes for /bundle.tgz and a detached signature over those same
// bytes for /bundle.sig. Regenerated only when HEAD changes. We sign the raw bundle bytes (openssl
// pkeyutl -rawin), NOT a client-supplied hash — no signing oracle.
const RELEASE_KEY = join(ROOT, 'relay', 'release-key.pem');    // release SECRET (gitignored; release host only)
const BUNDLE_CACHE_DIR = join(ROOT, 'relay', '.bundle-cache'); // per-HEAD cached bundle + signature (gitignored)
// Build (or reuse) the cached, signed bundle for the current HEAD. Returns { tgz, sig } absolute paths,
// or null if we can't (e.g. no release key on a non-release box — then we just serve the unsigned tgz
// as before, and signed verification only kicks in once a key is present). Cheap on the hot path: if the
// files for this sha already exist, we return immediately without spawning anything.
function ensureSignedBundle() {
  const sha = BUILD.sha && !BUILD.sha.startsWith('$Format') ? BUILD.sha : 'HEAD';
  const tgz = join(BUNDLE_CACHE_DIR, sha + '.tgz');
  const sig = join(BUNDLE_CACHE_DIR, sha + '.tgz.sig');
  if (existsSync(tgz)) return { tgz, sig: existsSync(sig) ? sig : null, sha };
  if (!existsSync(RELEASE_KEY)) return null;   // not a release host — no signed bundle to serve
  try {
    mkdirSync(BUNDLE_CACHE_DIR, { recursive: true });
    const tmp = tgz + '.tmp.' + process.pid;
    // git archive -> deterministic-enough single artifact we then freeze on disk and never regenerate for this sha.
    const ar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar.gz', 'HEAD'], { maxBuffer: 512 * 1024 * 1024 });
    if (ar.status !== 0 || !ar.stdout || !ar.stdout.length) return null;
    writeFileSync(tmp, ar.stdout);
    // detached Ed25519 signature over the EXACT cached bytes.
    const sigTmp = sig + '.tmp.' + process.pid;
    const sg = spawnSync('openssl', ['pkeyutl', '-sign', '-inkey', RELEASE_KEY, '-rawin', '-in', tmp, '-out', sigTmp]);
    if (sg.status !== 0) return null;
    renameSync(tmp, tgz);                          // publish bytes + sig atomically-ish
    renameSync(sigTmp, sig);
    return { tgz, sig, sha };
  } catch { return null; }
}

// ---- write policy (enabled only when the church key is configured) ----
// Set the church via env CHURCH_NPUB or relay/church.json {"npub":"npub1…"}. When set, the relay
// enforces: only the church key defines groups/funds and posts to BROADCAST groups; only joined
// members (or the church) may post messages / reactions / DMs / their own data. Unset = open (dev).
const NET = 'trinityone';
const GROUP_D = 'trinityone/group:', FUND_D = 'trinityone/fund:', MEMBER_D = 'trinityone/member:', PLAN_D = 'trinityone/plan:', DEVO_D = 'trinityone/devotional:', ROTA_D = 'trinityone/rota:';
const CATEGORY_D = 'trinityone/category:';   // steward-editable named container for groups (SECURITY-AUDIT-2026-06-24 M1)
const ROSTER_D = 'trinityone/roster:', SERVICE_D = 'trinityone/service:', EVENT_D = 'trinityone/event:', REQUEST_D = 'trinityone/request:';
const ROOM_D = 'trinityone/room:', BOOKING_D = 'trinityone/booking:';   // shared room calendar (church-only writes)
const RUNSHEET_D = 'trinityone/runsheet:';   // a service's order-of-service + song setlist — d=runsheet:<serviceId> (church/steward)
const NETWORK_D = 'trinityone/network:';   // the church declares it belongs to a network (the network's pubkey)
const BLOCKED_D = 'trinityone/blocked:';   // a church's blocklist (banned member pubkeys) — d=blocked:<churchpub>
const PIN_D = 'trinityone/pin:';           // a group's pinned message — d=pin:<groupId> (one per group)
const HIDE_D = 'trinityone/hidden:';       // a removed/hidden message — d=hidden:<msgId> (one per message)
const MINORS_D = 'trinityone/minors:';     // safeguarding: a church's list of minor (child) pubkeys — d=minors:<churchpub>
const APPROVED_D = 'trinityone/approved:'; // safeguarding: adults cleared to contact youth (mirrors the church's DBS/cleared list) — d=approved:<churchpub>
const GUARDIANS_D = 'trinityone/guardians:'; // safeguarding v2: church-signed child→parents map — d=guardians:<churchpub>; a guardian may always DM their own child
// (a parent's guardian-link REQUEST is d=trinityone/guardreq:<childpub>, authored by the parent — member-writable, falls to the default member rule)
const JOINPOLICY_D = 'trinityone/joinpolicy:'; // church-signed join policy — d=joinpolicy:<churchpub>, content {approval:bool}; ON = members need steward approval to post
const ADMITTED_D = 'trinityone/admitted:';   // church-signed allowlist of approved members — d=admitted:<churchpub> (only meaningful when approval is ON)
const STEWARDS_D = 'trinityone/stewards:';   // church-signed steward roster — d=stewards:<churchpub>, content {pubkeys:[…]}; delegates day-to-day church powers to those keys (revocable: owner re-signs without them). Owner-only to edit. See STEWARD-ROSTER-DESIGN.md.
const STEWARDREQ_D = 'trinityone/stewardreq:'; // a would-be steward's REQUEST to a church — d=stewardreq:<churchpub>, authored by the requester (openly writable, like a join). The owner reviews + approves it into the roster (owner-only).
// Meal trains / practical-care module (optional, per-church). care: needs are church/steward/care-team-admin authored;
// careslot: are member-signed offers to help; careskip: are RECIPIENT-only ("I don't need help that day"). See SPINE.md + src/steward-meals.src.js.
// NOTE: 'trinityone/care:' is NOT a prefix of careslot:/careskip: — the colon makes them distinct, so startsWith() is unambiguous.
const MEALS_SETTINGS_D = 'trinityone/meals-settings'; // church-signed config — {enabled, visibility, openedBy, adminGroupId} (single doc, no suffix)
const NEED_D = 'trinityone/care:';        // a care need — d=care:<id> (church / steward / care-team admin; or any member when openedBy='member')
const SLOT_D = 'trinityone/careslot:';    // a member's fill for one (need,date) — d=careslot:<careId>:<iso> (member-signed, addressable per author)
const SKIP_D = 'trinityone/careskip:';    // recipient marks a day they don't need help — d=careskip:<careId>:<iso> (RECIPIENT-only)
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
const MEMBERS = new Set();     // EFFECTIVE members (write-allowed): self-joined, minus blocked, minus unapproved (when a church gates joining). Rebuilt by rebuildMembers().
const MEMBER_DOCS = new Map(); // churchpub -> Set(pubkeys who published a member: doc — i.e. asked to join / joined)
const REQUIRE_APPROVAL = new Set(); // churchpubs whose joins need steward approval (default: open join)
const ADMITTED_BY = new Map();      // churchpub -> Set(approved member pubkeys) (only used when that church requires approval)
const JOIN_NOTIFIED = new Set();    // "pubkey:churchpub" we've already alerted the steward about (join or request) — dedupe push spam
const BROADCAST = new Set();   // group ids the church marked broadcast
const NETWORKS = new Set();    // network pubkeys this church joined — allowed to publish church-style content here
const GROUP_LEADERS = new Map(); // groupId -> Set(pubkey) — members a leader empowered to post events for that group
const STEWARDS_BY = new Map();   // churchpub -> Set(steward pubkeys) from the owner-signed stewards: roster (delegated, revocable authority)
// Meal trains / care module state (rebuilt from stored events by note()):
const ROSTER_PEOPLE = new Map();     // teamId(groupId) -> Set(pubkey) — people LINKED on a team roster; the care-team's members live here
const MEALS_ADMIN_GROUP = new Map(); // churchpub -> care-team groupId (its roster people may open/manage care needs)
const MEALS_OPEN_MEMBER = new Set(); // churchpubs whose meals-settings allow ANY member to open their own care need (openedBy='member')
const CARE_RECIPIENT = new Map();    // careId -> recipient pubkey (so a careskip: write can be gated to the recipient alone)
// is `pub` a current steward of church `cp`? (empty/no roster => false => behaviour identical to pre-roster)
const stewardOf = (pub, cp) => { const s = STEWARDS_BY.get(cp); return !!(cp && s && s.has(pub)); };
// is `pub` on the care-team of church `cp`? (a member of the roster of cp's configured care-team group)
const careAdmin = (pub, cp) => { const g = cp && MEALS_ADMIN_GROUP.get(cp); const ppl = g && ROSTER_PEOPLE.get(g); return !!(ppl && ppl.has(pub)); };
// the church a steward-authored CONTENT event acts for: its ["church", <cp>] tag, validated to a configured church.
const namedChurch = (e) => { const t = (e.tags || []).find(t => t[0] === 'church'); const h = t && (toHexPub(t[1]) || t[1]); return h && CHURCH_PUBS.has(h) ? h : ''; };
const BLOCKED_BY = new Map();    // churchpub -> Set(blocked member pubkeys); BLOCKED is the union for fast checks
const BLOCKED = new Set();       // banned pubkeys — rejected on write, withheld on read
function rebuildBlocked() { BLOCKED.clear(); for (const s of BLOCKED_BY.values()) for (const p of s) BLOCKED.add(p); rebuildMembers(); }
// effective membership = everyone who published a member: doc, minus the blocked, minus (for a church that
// requires approval) anyone the steward hasn't admitted yet. A pending member's doc is stored (so the steward
// sees the request) but grants no posting rights until they're on that church's admitted list.
function rebuildMembers() {
  MEMBERS.clear();
  for (const [cp, set] of MEMBER_DOCS) {
    const gated = REQUIRE_APPROVAL.has(cp), admitted = ADMITTED_BY.get(cp);
    for (const pk of set) {
      if (BLOCKED.has(pk)) continue;
      if (gated && !(admitted && admitted.has(pk))) continue;   // awaiting approval
      MEMBERS.add(pk);
    }
  }
}
// safeguarding: per-church lists of minors and of adults cleared to contact youth (unions for fast checks)
const MINORS_BY = new Map();   // churchpub -> Set(minor pubkeys)
const MINORS = new Set();
function rebuildMinors() { MINORS.clear(); for (const s of MINORS_BY.values()) for (const p of s) MINORS.add(p); }
const APPROVED_BY = new Map(); // churchpub -> Set(approved-adult pubkeys)
const APPROVED = new Set();
function rebuildApproved() { APPROVED.clear(); for (const s of APPROVED_BY.values()) for (const p of s) APPROVED.add(p); }
// safeguarding v2: parent↔child links (a guardian may always DM their own child, even if not cleared for youth generally)
const GUARDIANS_BY = new Map(); // churchpub -> Map(childPub -> Set(parentPubs))
const GUARDIANS = new Map();    // childPub -> Set(parentPubs) (union across churches)
function rebuildGuardians() { GUARDIANS.clear(); for (const m of GUARDIANS_BY.values()) for (const [c, ps] of m) { let s = GUARDIANS.get(c); if (!s) { s = new Set(); GUARDIANS.set(c, s); } for (const p of ps) s.add(p); } }
function guardianLinked(a, b) { const ga = GUARDIANS.get(a); if (ga && ga.has(b)) return true; const gb = GUARDIANS.get(b); return !!(gb && gb.has(a)); }
const GROUP_VIS = new Map();     // groupId -> 'open' | 'invite'
const GROUP_MEMBERS = new Map(); // groupId -> Set(pubkey) allowed to post in an invite-only group
const GROUP_NAMES = new Map();   // groupId -> display name (for push titles)

// ---- marketing email capture (website "Stay updated" form) — opt-in list, stored locally ----
const SUBS_FILE = join(ROOT, 'relay', 'subscribers.json');
let subscribers = []; try { const d = JSON.parse(readFileSync(SUBS_FILE, 'utf8')); if (Array.isArray(d)) subscribers = d; } catch {}
const subSeen = new Set(subscribers.map(s => String(s.email || '').toLowerCase()));
const SUB_RL = new Map();   // ip -> [recent signup timestamps] — basic per-IP anti-flood

// ---- web push (VAPID): notify members of serving requests in real time (PWA) ----
const VAPID_PATH = join(ROOT, 'relay', 'vapid.json');
const SUBS_PATH = join(ROOT, 'relay', 'push-subs.json');
let VAPID = null;
try { VAPID = JSON.parse(readFileSync(VAPID_PATH, 'utf8')); }
catch { VAPID = webpush.generateVAPIDKeys(); try { writeFileSync(VAPID_PATH, JSON.stringify(VAPID), { mode: 0o600 }); } catch {} }   // SECURITY-AUDIT-2026-06-24 M3: VAPID private key must not be group-readable
webpush.setVapidDetails('mailto:steward@trinityone.app', VAPID.publicKey, VAPID.privateKey);
let pushSubs = {};   // { memberHex: [PushSubscription, …] }
try { pushSubs = JSON.parse(readFileSync(SUBS_PATH, 'utf8')); } catch {}
function saveSubs() { try { writeFileSync(SUBS_PATH, JSON.stringify(pushSubs)); } catch {} }
// per-member category prefs ({ dm, announce, serving }) set from the app's notification settings. A
// missing member or missing category defaults to ON, so older clients keep getting everything.
const PREFS_PATH = join(ROOT, 'relay', 'push-prefs.json');
let pushPrefs = {};   // { memberHex: { dm, announce, serving } }
try { pushPrefs = JSON.parse(readFileSync(PREFS_PATH, 'utf8')); } catch {}
function savePrefs() { try { writeFileSync(PREFS_PATH, JSON.stringify(pushPrefs)); } catch {} }
function wantsPush(memberHex, category) {
  if (!category) return true;                       // uncategorised pushes always go (e.g. steward join)
  const p = pushPrefs[memberHex];
  return !p || p[category] !== false;               // default ON unless explicitly disabled
}
function pushTo(memberHex, payload, category) {
  if (!wantsPush(memberHex, category)) return;
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
    if (evt.kind !== 30078) return;
    const d = (evt.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (!d.startsWith(MEMBER_D)) return;
    const churchPub = d.slice(MEMBER_D.length);
    if (!CHURCH_PUBS.has(churchPub) || evt.pubkey === churchPub) return;
    if ((evt.tags || []).some(t => t[0] === 'deleted') || !evt.content) return;   // a leave, not a join
    const key = evt.pubkey + ':' + churchPub;
    if (JOIN_NOTIFIED.has(key)) return;   // already told the steward (dedupe re-announce heartbeats)
    JOIN_NOTIFIED.add(key);
    const name = displayName(evt.pubkey);   // best-effort: the joiner's latest kind-0 display name
    // a church that requires approval gets a "wants to join" request; otherwise it's a fresh join
    const pending = REQUIRE_APPROVAL.has(churchPub) && !((ADMITTED_BY.get(churchPub) || new Set()).has(evt.pubkey));
    if (pending) pushTo(churchPub, { title: 'Join request', body: (name || 'Someone') + ' is asking to join your church', url: '/steward', tag: 'joinreq-' + evt.pubkey.slice(0, 8) });
    else pushTo(churchPub, { title: 'New member', body: (name || 'Someone') + ' just joined your church', url: '/steward', tag: 'join-' + evt.pubkey.slice(0, 8) });
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
    pushTo(target, { title: 'Can you serve?', body: `${c.teamName || 'Serving'} · ${c.role || ''}${c.date ? ' · ' + c.date : ''}`, url: '/?serving=1' }, 'serving');
  } catch {}
}
// best-effort latest display name from a pubkey's most recent kind-0 profile
function displayName(pubkey) {
  const k0 = store.query({ kinds: [0], authors: [pubkey], limit: 1 });   // kind-0 is replaceable → the one row is newest
  if (k0[0]) { try { const m = JSON.parse(k0[0].content); return m.name || m.display_name || ''; } catch { return ''; } }
  return '';
}
// fire a closed-app push for a new chat message: 1:1 DMs (to the recipient) and broadcast/announcement
// posts (to every member). Ordinary group chatter is intentionally NOT pushed — the in-app Community
// dot already covers it; only personal DMs and church announcements escalate to a phone notification.
function maybePushMessage(evt) {
  try {
    if (evt.kind === 4) {                                          // NIP-04 direct message (content encrypted)
      const target = (evt.tags.find(t => t[0] === 'p') || [])[1];
      if (!target || target === evt.pubkey) return;               // needs a distinct recipient
      const who = displayName(evt.pubkey);
      pushTo(target, {
        title: 'New message',
        body: who ? who + ' sent you a message' : 'You have a new direct message',
        url: '/?tab=chat&dm=' + evt.pubkey, tag: 'dm-' + evt.pubkey.slice(0, 8),
      }, 'dm');
      return;
    }
    if (evt.kind === 1) {                                          // group chat post
      const gid = gidOf(evt); if (!gid || !BROADCAST.has(gid)) return;   // announcements only (church-posted)
      const gname = GROUP_NAMES.get(gid) || 'Your church';
      const recips = (GROUP_VIS.get(gid) === 'invite') ? [...(GROUP_MEMBERS.get(gid) || [])] : [...MEMBERS];
      for (const r of recips) {
        if (!r || r === evt.pubkey) continue;
        pushTo(r, { title: gname, body: 'New announcement', url: '/?tab=chat&group=' + gid, tag: 'grp-' + gid }, 'announce');
      }
    }
  } catch {}
}
const dtag = (e) => { const t = (e.tags || []).find(t => t[0] === 'd'); return t ? t[1] : ''; };
// (replaceable/addressable dedup + smart retention now live in event-store.mjs — the durable store owns them.)
const gidOf = (e) => { const t = (e.tags || []).find(t => t[0] === 't' && t[1] !== NET); return t ? t[1] : ''; };
function note(e) {   // keep MEMBERS / BROADCAST in step with accepted events
  if (!CHURCH_PUBS.size || e.kind !== 30078) return;
  const d = dtag(e), removed = (e.tags || []).some(t => t[0] === 'deleted') || !e.content;
  let cp;   // the church a <cp>-keyed admin doc is for — author is the church itself OR one of its rostered stewards
  if (d.startsWith(MEMBER_D) && CHURCH_PUBS.has(d.slice(MEMBER_D.length))) {   // asked to join / joined one of our churches
    const cp = d.slice(MEMBER_D.length); let s = MEMBER_DOCS.get(cp); if (!s) { s = new Set(); MEMBER_DOCS.set(cp, s); }
    if (removed) s.delete(e.pubkey); else s.add(e.pubkey);
    rebuildMembers();   // effective membership respects the join policy + admitted list + blocklist
  }
  else if (d.startsWith(NETWORK_D) && CHURCH_PUBS.has(e.pubkey)) {   // a church joined/left a network
    const np = d.slice(NETWORK_D.length); if (removed) NETWORKS.delete(np); else NETWORKS.add(np);
  }
  else if (d.startsWith(GROUP_D) && (CHURCH_PUBS.has(e.pubkey) || NETWORKS.has(e.pubkey) || stewardOf(e.pubkey, namedChurch(e)))) {
    const id = d.slice(GROUP_D.length); let c = {}; try { c = JSON.parse(e.content); } catch {}
    if (removed) { BROADCAST.delete(id); GROUP_LEADERS.delete(id); GROUP_VIS.delete(id); GROUP_MEMBERS.delete(id); GROUP_NAMES.delete(id); return; }
    if (c.name) GROUP_NAMES.set(id, String(c.name).slice(0, 60));
    if (c.kind === 'broadcast') BROADCAST.add(id); else BROADCAST.delete(id);
    // a group def may name member leaders who can post events for that group
    GROUP_LEADERS.set(id, new Set(Array.isArray(c.leaders) ? c.leaders : []));
    // invite-only groups carry the allowlist of member pubkeys who may post
    if (c.visibility === 'invite') { GROUP_VIS.set(id, 'invite'); GROUP_MEMBERS.set(id, new Set((Array.isArray(c.members) ? c.members : []).map(p => toHexPub(p) || p).filter(Boolean))); }
    else { GROUP_VIS.set(id, 'open'); GROUP_MEMBERS.delete(id); }
  }
  else if (d.startsWith(BLOCKED_D) && CHURCH_PUBS.has(e.pubkey) && d.slice(BLOCKED_D.length) === e.pubkey) {
    const set = new Set(); if (!removed) { try { (JSON.parse(e.content).pubkeys || []).forEach(p => { const h = toHexPub(p); if (h) set.add(h); }); } catch {} }
    BLOCKED_BY.set(e.pubkey, set); rebuildBlocked();   // rebuildBlocked() rebuilds MEMBERS (drops the blocked)
  }
  else if (d.startsWith(JOINPOLICY_D) && CHURCH_PUBS.has(cp = d.slice(JOINPOLICY_D.length)) && (e.pubkey === cp || stewardOf(e.pubkey, cp))) {   // a church's join policy
    let approval = false; if (!removed) { try { approval = !!JSON.parse(e.content).approval; } catch {} }
    if (approval) REQUIRE_APPROVAL.add(cp); else REQUIRE_APPROVAL.delete(cp);
    rebuildMembers();
  }
  else if (d.startsWith(ADMITTED_D) && CHURCH_PUBS.has(cp = d.slice(ADMITTED_D.length)) && (e.pubkey === cp || stewardOf(e.pubkey, cp))) {   // a church's approved-members allowlist
    const set = new Set(); if (!removed) { try { (JSON.parse(e.content).pubkeys || []).forEach(p => { const h = toHexPub(p); if (h) set.add(h); }); } catch {} }
    ADMITTED_BY.set(cp, set); rebuildMembers();
  }
  else if (d.startsWith(MINORS_D) && CHURCH_PUBS.has(cp = d.slice(MINORS_D.length)) && e.pubkey === cp) {   // safeguarding: church's minors list — OWNER-ONLY
    const set = new Set(); if (!removed) { try { (JSON.parse(e.content).pubkeys || []).forEach(p => { const h = toHexPub(p); if (h) set.add(h); }); } catch {} }
    MINORS_BY.set(cp, set); rebuildMinors();
  }
  else if (d.startsWith(APPROVED_D) && CHURCH_PUBS.has(cp = d.slice(APPROVED_D.length)) && e.pubkey === cp) {   // safeguarding: church's cleared-adults list — OWNER-ONLY
    const set = new Set(); if (!removed) { try { (JSON.parse(e.content).pubkeys || []).forEach(p => { const h = toHexPub(p); if (h) set.add(h); }); } catch {} }
    APPROVED_BY.set(cp, set); rebuildApproved();
  }
  else if (d.startsWith(GUARDIANS_D) && CHURCH_PUBS.has(cp = d.slice(GUARDIANS_D.length)) && e.pubkey === cp) {   // safeguarding v2: church's parent↔child map — OWNER-ONLY
    const map = new Map();
    if (!removed) { try { const links = (JSON.parse(e.content).links) || {}; for (const [c, ps] of Object.entries(links)) { const ch = toHexPub(c); if (!ch) continue; const set = new Set(); (ps || []).forEach(p => { const h = toHexPub(p); if (h) set.add(h); }); map.set(ch, set); } } catch {} }
    GUARDIANS_BY.set(cp, map); rebuildGuardians();
  }
  else if (d.startsWith(STEWARDS_D) && CHURCH_PUBS.has(e.pubkey) && d.slice(STEWARDS_D.length) === e.pubkey) {   // OWNER-ONLY: a church's steward roster (delegated, revocable authority)
    const set = new Set(); if (!removed) { try { (JSON.parse(e.content).pubkeys || []).forEach(p => { const h = toHexPub(p); if (h) set.add(h); }); } catch {} }
    STEWARDS_BY.set(e.pubkey, set);
  }
  else if (d.startsWith(ROSTER_D) && (CHURCH_PUBS.has(e.pubkey) || NETWORKS.has(e.pubkey) || stewardOf(e.pubkey, namedChurch(e)))) {   // a team roster — track its LINKED people so care-team admins can be resolved
    const id = d.slice(ROSTER_D.length);
    if (removed) { ROSTER_PEOPLE.delete(id); return; }
    const set = new Set(); try { (JSON.parse(e.content).people || []).forEach(p => { const h = p && toHexPub(p.pub); if (h) set.add(h); }); } catch {}
    ROSTER_PEOPLE.set(id, set);
  }
  else if (d === MEALS_SETTINGS_D) {   // optional Care module config — only the church key (or one of its stewards) sets it
    const owner = CHURCH_PUBS.has(e.pubkey) ? e.pubkey : (stewardOf(e.pubkey, cp = namedChurch(e)) ? cp : '');
    if (!owner) return;
    if (removed) { MEALS_ADMIN_GROUP.delete(owner); MEALS_OPEN_MEMBER.delete(owner); return; }
    try { const c = JSON.parse(e.content); MEALS_ADMIN_GROUP.set(owner, String(c.adminGroupId || '')); if (c.openedBy === 'member') MEALS_OPEN_MEMBER.add(owner); else MEALS_OPEN_MEMBER.delete(owner); } catch {}
  }
  else if (d.startsWith(NEED_D)) {   // a care need (already passed accept(): church/steward/care-admin/allowed-member) — record its recipient for careskip gating
    const id = d.slice(NEED_D.length);
    if (removed) { CARE_RECIPIENT.delete(id); return; }
    try { const r = toHexPub((JSON.parse(e.content) || {}).recipient || ''); if (r) CARE_RECIPIENT.set(id, r); else CARE_RECIPIENT.delete(id); } catch {}
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
  if (k === 0) {                                                 // profiles (replaceable, per-pubkey)
    if (isMember) return true;                                   // members/leaders: always
    if (store.query({ kinds: [0], authors: [e.pubkey], limit: 1 }).length) return true;  // a stranger updating their own
    let strangers = 0;                                           // else cap how many non-member profiles we store
    for (const x of store.query({ kinds: [0], limit: 1000000 })) { if (!(CHURCH_PUBS.has(x.pubkey) || NETWORKS.has(x.pubkey) || MEMBERS.has(x.pubkey))) strangers++; }
    return strangers < NONMEMBER_KIND0_CAP;
  }
  if (k === 30078) {
    const d = dtag(e);
    // Steward authority is ADDITIVE (see STEWARD-ROSTER-DESIGN.md): isLeader (the church/network key) always
    // passes exactly as before; a rostered steward of the relevant church ALSO passes for DELEGATED ops.
    // OWNER-ONLY ops never consult the roster — so they stay church-key-only automatically.
    if (d.startsWith(STEWARDS_D)) return CHURCH_PUBS.has(e.pubkey) && d.slice(STEWARDS_D.length) === e.pubkey;   // OWNER-ONLY: only the church key edits its own steward roster
    if (d.startsWith(BLOCKED_D)) return isLeader;                                                                // OWNER-ONLY: banning is not delegated to stewards
    if (d.startsWith(EVENT_D) || d.startsWith(PIN_D) || d.startsWith(HIDE_D)) {   // church/steward, or a group's empowered member, may post events / pin / hide
      if (isLeader || stewardOf(e.pubkey, namedChurch(e))) return true;
      const g = eventGroup(e); const leaders = g && GROUP_LEADERS.get(g);
      return !!(leaders && leaders.has(e.pubkey));
    }
    // <cp>-keyed membership admin: the church is named in the d-tag → delegate to a steward of THAT church
    for (const pfx of [JOINPOLICY_D, ADMITTED_D]) {
      if (d.startsWith(pfx)) return isLeader || stewardOf(e.pubkey, d.slice(pfx.length));
    }
    // SAFEGUARDING lists (who's a child / cleared adult / guardian link) — OWNER-ONLY (church key), never a delegated steward
    for (const pfx of [MINORS_D, APPROVED_D, GUARDIANS_D]) {
      if (d.startsWith(pfx)) return CHURCH_PUBS.has(e.pubkey) && d.slice(pfx.length) === e.pubkey;
    }
    // church-authored CONTENT docs: a steward names the church via a ["church", <cp>] tag
    if (d.startsWith(GROUP_D) || d.startsWith(FUND_D) || d.startsWith(PLAN_D) || d.startsWith(DEVO_D) || d.startsWith(ROTA_D)
      || d.startsWith(ROSTER_D) || d.startsWith(SERVICE_D) || d.startsWith(REQUEST_D)
      || d.startsWith(ROOM_D) || d.startsWith(BOOKING_D) || d.startsWith(RUNSHEET_D)
      || d.startsWith(CATEGORY_D)) return isLeader || stewardOf(e.pubkey, namedChurch(e));   // SECURITY-AUDIT-2026-06-24 M1: gate category writes
    if (d.startsWith(MEMBER_D) || d.startsWith(NETWORK_D)) return true;   // joining a church / a church joining a network
    if (d.startsWith(STEWARDREQ_D)) {                          // requesting to steward a church — capped (L1: anti-flood)
      if (isMember) return true;                               // a known member asking to help: always
      if (store.query({ kinds: [30078], authors: [e.pubkey], '#d': [d], limit: 1 }).length) return true;   // updating their own pending request
      let pend = 0; for (const x of store.query({ kinds: [30078], '#d': [d], limit: 1000000 })) { if (!MEMBERS.has(x.pubkey)) pend++; }   // else cap strangers' pending requests for this church
      return pend < STEWARDREQ_CAP;
    }
    // Meal trains / Care module (optional, per-church) — must precede the generic member fallback:
    if (d === MEALS_SETTINGS_D) return isLeader || stewardOf(e.pubkey, namedChurch(e));   // enable/configure the module: church or rostered steward
    if (d.startsWith(NEED_D)) {                                 // open / edit / close a care need
      const cp = namedChurch(e) || (isChurch ? e.pubkey : '');
      // church / steward / care-team admin; or any NON-minor member when the church allows member-opened needs (children never open needs)
      return isLeader || stewardOf(e.pubkey, cp) || careAdmin(e.pubkey, cp) || (MEALS_OPEN_MEMBER.has(cp) && isMember && !MINORS.has(e.pubkey));
    }
    if (d.startsWith(SLOT_D)) return isMember;                  // fill a slot: any member offers help (the event is keyed by their own pubkey, so they can't forge another member's)
    if (d.startsWith(SKIP_D)) {                                 // mark a day "I don't need help": the RECIPIENT, or a steward/care-team blocking a date on their behalf (recipient may not be on the app)
      const careId = d.slice(SKIP_D.length).split(':')[0];
      const cp = namedChurch(e) || (isChurch ? e.pubkey : '');
      return !!careId && (e.pubkey === CARE_RECIPIENT.get(careId) || isLeader || stewardOf(e.pubkey, cp) || careAdmin(e.pubkey, cp));
    }
    return isMember;                                            // member's own data (MyData)
  }
  if (k === 1) {   // chat
    const g = gidOf(e);
    if (g && BROADCAST.has(g)) return isLeader || stewardOf(e.pubkey, namedChurch(e));   // broadcast channel = church/network/steward only
    if (g && GROUP_VIS.get(g) === 'invite') { const mem = GROUP_MEMBERS.get(g); return isLeader || stewardOf(e.pubkey, namedChurch(e)) || !!(mem && mem.has(e.pubkey)); }  // invite-only group
    return isMember;
  }
  if (k === 4) {   // NIP-04 direct message — safeguarding gate
    if (!isMember) return false;
    const target = (e.tags.find(t => t[0] === 'p') || [])[1];
    const targetHex = target ? (toHexPub(target) || target) : '';
    // the church/steward account is the safeguarding authority: it may DM anyone, and a child may DM it.
    if (isLeader || CHURCH_PUBS.has(targetHex) || NETWORKS.has(targetHex)) return true;
    if (guardianLinked(e.pubkey, targetHex)) return true;   // v2: a parent may always DM their own child (and vice versa)
    // otherwise, if either party is a minor, the OTHER party must be a cleared adult (both directions;
    // covers minor↔minor too, since neither is on the approved list). Relay-enforced, client can't bypass.
    if (MINORS.has(e.pubkey) && !APPROVED.has(targetHex)) return false;
    if (targetHex && MINORS.has(targetHex) && !APPROVED.has(e.pubkey)) return false;
    return true;
  }
  if (k === 7 || k === 1059 || k === 1060) return isMember;    // reactions + sealed/gift-wrapped DMs
  return isMember;                                               // anything else: members only
}
// read-gate (NIP-42): an invite-only group's messages are served only to a connection that has proven
// (via AUTH) it belongs to that group's member list (or is the church/network). Everything else is public.
function canRead(e, authed) {
  if (e.kind === 4) {   // safeguarding: never serve a stored minor↔non-approved-adult DM (catches pre-existing messages / belt-and-braces over accept())
    const target = (e.tags.find(t => t[0] === 'p') || [])[1];
    const targetHex = target ? (toHexPub(target) || target) : '';
    if (CHURCH_PUBS.has(e.pubkey) || NETWORKS.has(e.pubkey) || CHURCH_PUBS.has(targetHex) || NETWORKS.has(targetHex)) return true;   // church/steward DMs always deliverable
    if (guardianLinked(e.pubkey, targetHex)) return true;   // v2: parent↔child always deliverable
    if (MINORS.has(e.pubkey) && !APPROVED.has(targetHex)) return false;
    if (targetHex && MINORS.has(targetHex) && !APPROVED.has(e.pubkey)) return false;
    return true;
  }
  if (e.kind === 30078) {
    const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
    // care coordination (needs / member fills / skips) is readable by the whole church — members MUST see
    // who's already helping + each other's "what I'm bringing" notes, not just stewards. These are
    // member-authored but church-tagged, so they'd otherwise fail the steward-roster gate below. Write
    // access stays gated in accept(); the UI still applies the per-need visibility setting.
    if (d.startsWith(NEED_D) || d.startsWith(SLOT_D) || d.startsWith(SKIP_D)) return true;
    // roster-verify steward-authored church content: a doc carrying ['church',<cp>] is only served while
    // its author is on <cp>'s CURRENT signed roster — so a revoked steward's content stops being delivered.
    const ch = (e.tags.find(t => t[0] === 'church') || [])[1];
    if (ch) { const r = STEWARDS_BY.get(ch); return e.pubkey === ch || !!(r && r.has(e.pubkey)); }
    return true;
  }
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

// security response headers. By default the CSP is compatible with the RAW (runtime-Babel) build the
// gateway serves from the repo (Babel needs 'unsafe-eval'; its injected transpiled code needs
// 'unsafe-inline'). When the gateway instead serves a PRE-TRANSPILED build (no Babel — like sync-web /
// build-pages produce), set STRICT_CSP=1 to drop both from script-src — keeping only 'wasm-unsafe-eval'
// for sql.js. The Cloudflare Pages deploy is already strict via its own _headers (build-pages.sh).
// Referrer-Policy: no-referrer also stops invite links (which carry a seed in the URL) leaking via Referer.
//
// SECURITY-AUDIT-2026-06-24 M4 (standing residual): default-off STRICT_CSP keeps the gateway-served
// raw-JSX path working but leaves runtime-Babel-eval as a real XSS amplifier on every church relay
// that runs `relay-app/install.sh`. The proper fix is to pre-transpile JSX in install.sh so STRICT_CSP=1
// becomes the default. Tracked; not in this commit. Production-grade church operators can set
// `STRICT_CSP=1` in the systemd unit's Environment= today AFTER they've run `bash scripts/sync-web.sh`
// to populate www/ — but the default repo serve at `/` still loads .jsx files via Babel.
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' };
const CSP = [
  "default-src 'self'",
  process.env.STRICT_CSP ? "script-src 'self' 'wasm-unsafe-eval'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // SECURITY-AUDIT-2026-06-24 M11 followup: dropped the Google Fonts allowlist now that all marketing
  // HTML loads vendor/fonts/fonts.css locally. style-src 'unsafe-inline' stays for the marketing pages'
  // <style> blocks; font-src self covers the local woff2s.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss: ws:",
  "object-src 'none'", "base-uri 'self'", "frame-src 'self'", "frame-ancestors 'self'",
].join('; ');

// ── L1: throttle the unauthenticated /audiozip proxy (memory/bandwidth amplification) ──────────
// /audiozip buffers up to 30 MB/request in RAM from an upstream. It's SSRF-safe + length-capped, but
// unauthenticated + unthrottled a flood is an amplification DoS. Two bounds: a GLOBAL ceiling on
// concurrent in-flight upstream fetches (the real protection — behind the public tunnel every client
// shares one source address, so per-IP alone is weak), plus a light best-effort per-IP rate limit.
const AZ_MAX_CONCURRENT = 4;                 // most simultaneous upstream fetches we'll buffer at once
const AZ_WINDOW_MS = 60_000, AZ_MAX_PER_WINDOW = 200;   // per-IP: ~200 requests/min — SECURITY-AUDIT-2026-06-24 L11: raised from 30 because Tailscale Funnel / cloudflared collapse every public client behind one source IP. 4-concurrent global cap (AZ_MAX_CONCURRENT) remains the real DoS protection.
let azInFlight = 0;
const azHits = new Map();                    // ip -> [recent request timestamps]
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function azRateLimited(ip) {
  const now = Date.now();
  const arr = (azHits.get(ip) || []).filter(t => now - t < AZ_WINDOW_MS);
  arr.push(now); azHits.set(ip, arr);
  if (azHits.size > 5000) for (const [k, v] of azHits) { if (!v.length || now - v[v.length - 1] > AZ_WINDOW_MS) azHits.delete(k); }
  return arr.length > AZ_MAX_PER_WINDOW;
}

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
      version: BUILD.sha, versionShort: BUILD.short, builtAt: BUILD.date, origin: ORIGIN,   // for the dashboard's update check
      writePolicy: CHURCH_PUBS.size > 0,
      // church npubs/names are intentionally NOT exposed here (unauthenticated) — the dashboard reads
      // the list from the token-gated /config; /status carries only non-sensitive counts.
      counts: { churches: CHURCH_PUBS.size, members: MEMBERS.size, broadcastGroups: BROADCAST.size, events: store.count(), connections: wss ? wss.clients.size : 0 },
      serves: { app: SETTINGS.serveApp, modules: SETTINGS.serveModules, audio: SETTINGS.serveAudio },   // what this relay also hosts (toggleable in the control dashboard)
    }));
    return;
  }
  // self-host bundle: a fresh tarball of the committed code, so a new relay box can install straight
  // from this funnel instead of the (private) GitHub repo. `git archive` only emits tracked files —
  // relay/ secrets are gitignored, so nothing sensitive ships. Public on purpose (the installer curls it).
  if (route === '/relay-app/bundle.tgz') {
    // Serve the cached, signed bytes when we have a release key (so /bundle.sig signs exactly these
    // bytes). Falls back to streaming git archive directly when there's no release key (dev / a relay
    // box that isn't the release host) — same behaviour as before.
    const b = ensureSignedBundle();
    if (b && existsSync(b.tgz)) {
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="trinityone.tar.gz"' });
      createReadStream(b.tgz).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="trinityone.tar.gz"' });
    const git = spawn('git', ['-C', ROOT, 'archive', '--format=tar.gz', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
    git.stdout.pipe(res);
    git.on('error', () => { try { res.destroy(); } catch {} });
    git.on('close', (code) => { if (code !== 0) { try { res.destroy(); } catch {} } });
    return;
  }
  // detached Ed25519 signature over the EXACT bytes served at /relay-app/bundle.tgz, made with the
  // release secret. The self-updater verifies this against the baked-in public key before applying.
  if (route === '/relay-app/bundle.sig') {
    const b = ensureSignedBundle();
    if (!b || !b.sig || !existsSync(b.sig)) { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('no signature (this host has no release key)'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="bundle.tgz.sig"' });
    createReadStream(b.sig).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
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
  // relay feature toggles (what this box serves besides the relay) — token-gated, same pattern as /config
  if (route === '/settings') {
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...CORS };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...SEC_HEADERS, ...CORS }); res.end(); return; }
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    if (req.method === 'GET') { res.writeHead(200, H); res.end(JSON.stringify({ ok: true, settings: SETTINGS })); return; }
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        try {
          const s = JSON.parse(body || '{}');
          if ('serveApp' in s) SETTINGS.serveApp = !!s.serveApp;
          if ('serveModules' in s) SETTINGS.serveModules = !!s.serveModules;
          if ('serveAudio' in s) SETTINGS.serveAudio = !!s.serveAudio;
          if ('appUrl' in s) SETTINGS.appUrl = String(s.appUrl || '').slice(0, 200);
          saveSettings();
          res.writeHead(200, H); res.end(JSON.stringify({ ok: true, settings: SETTINGS }));
        } catch (e) { res.writeHead(400, H); res.end(JSON.stringify({ error: String((e && e.message) || 'bad request') })); }
      });
      return;
    }
    res.writeHead(405, H); res.end('{"error":"method"}'); return;
  }
  // relay self-update: POST drops a flag in relay/ (the only path the sandboxed relay can write); a root
  // systemd path-unit watches it and runs scripts/relay-update.sh (pull bundle, swap code, restart).
  if (route === '/update') {
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...CORS };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...SEC_HEADERS, ...CORS }); res.end(); return; }
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    let pending = false; try { statSync(UPDATE_FLAG); pending = true; } catch {}
    if (req.method === 'GET') { res.writeHead(200, H); res.end(JSON.stringify({ ok: true, version: BUILD.sha, versionShort: BUILD.short, builtAt: BUILD.date, origin: ORIGIN, pending })); return; }
    if (req.method === 'POST') {
      if (!ORIGIN) { res.writeHead(400, H); res.end('{"error":"this relay has no update origin (it may be the release host itself)"}'); return; }
      try { writeFileSync(UPDATE_FLAG, JSON.stringify({ at: Date.now() }) + '\n'); res.writeHead(200, H); res.end(JSON.stringify({ ok: true, queued: true })); }
      catch (e) { res.writeHead(500, H); res.end(JSON.stringify({ error: 'could not queue the update: ' + String((e && e.message) || e) })); }
      return;
    }
    res.writeHead(405, H); res.end('{"error":"method"}'); return;
  }
  // Deploy the latest APKs without SSH: pull trinityone[-steward].apk from the update ORIGIN into
  // relay/apks/ (the one dir the sandboxed relay can write). The static handler serves /…apk from there.
  if (route === '/relay-app/fetch-apk') {
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...CORS };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...SEC_HEADERS, ...CORS }); res.end(); return; }
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    if (req.method !== 'POST') { res.writeHead(405, H); res.end('{"error":"method"}'); return; }
    if (!ORIGIN) { res.writeHead(400, H); res.end('{"error":"this relay has no origin to fetch from"}'); return; }
    const apkDir = join(ROOT, 'relay', 'apks');
    (async () => {
      try { mkdirSync(apkDir, { recursive: true }); } catch {}
      const files = {};
      for (const f of ['trinityone.apk', 'trinityone-steward.apk']) {
        try {
          const r = await fetch(ORIGIN.replace(/\/+$/, '') + '/' + f);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 1000000) throw new Error('too small (' + buf.length + ' bytes) — origin may not have it');
          const tmp = join(apkDir, f + '.tmp'); writeFileSync(tmp, buf); renameSync(tmp, join(apkDir, f));
          files[f] = { ok: true, bytes: buf.length };
        } catch (e) { files[f] = { ok: false, error: String((e && e.message) || e) }; }
      }
      const anyOk = Object.values(files).some(x => x.ok);
      res.writeHead(anyOk ? 200 : 502, H); res.end(JSON.stringify({ origin: ORIGIN, files }));
    })();
    return;
  }
  // marketing email capture: POST is public (opt-in signup, honeypot + per-IP rate limit); GET is the
  // admin export (token-gated). The list is a plain opt-in marketing list, stored in relay/subscribers.json.
  if (route === '/subscribe') {
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...CORS };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...SEC_HEADERS, ...CORS }); res.end(); return; }
    if (req.method === 'GET') {   // admin export
      if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
      res.writeHead(200, H); res.end(JSON.stringify({ count: subscribers.length, subscribers })); return;
    }
    if (req.method === 'POST') {  // public opt-in signup
      const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
      const now = Date.now();
      const recent = (SUB_RL.get(ip) || []).filter(t => now - t < 3600000);
      if (recent.length >= 5) { res.writeHead(429, H); res.end('{"error":"too many requests — try again later"}'); return; }
      let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        let email = '', hp = '', src = '';
        try { const j = JSON.parse(body || '{}'); email = String(j.email || '').trim().toLowerCase(); hp = String(j.website || '').trim(); src = String(j.src || '').slice(0, 24); } catch {}
        recent.push(now); SUB_RL.set(ip, recent);
        if (hp) { res.writeHead(200, H); res.end('{"ok":true}'); return; }   // honeypot tripped: feign success, store nothing
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) { res.writeHead(400, H); res.end('{"error":"that doesn\'t look like a valid email"}'); return; }
        if (!subSeen.has(email)) {
          subSeen.add(email);
          subscribers.push({ email, at: now, src });
          try { const tmp = SUBS_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify(subscribers)); renameSync(tmp, SUBS_FILE); } catch {}
        }
        res.writeHead(200, H); res.end('{"ok":true,"subscribed":true}');
      });
      return;
    }
    res.writeHead(405, H); res.end('{"error":"method"}'); return;
  }
  // audio (podcast) feed proxy
  if (route === '/audiofeed') {
    if (!SETTINGS.serveAudio) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('{"error":"audio off"}'); return; }
    let u = ''; try { u = new URL(req.url, 'http://x').searchParams.get('url') || ''; } catch {}
    const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=600' }); res.end(JSON.stringify(obj)); };
    if (!u) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); res.end('{"error":"no url"}'); return; }
    getAudioFeed(u).then(json).catch(e => json({ channel: { url: u, platform: 'podcast' }, episodes: [], error: String((e && e.message) || e) }));
    return;
  }
  // video feed proxy
  if (route === '/feed') {
    if (!SETTINGS.serveAudio) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('{"error":"media off"}'); return; }
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
    if (!SETTINGS.serveAudio) { res.writeHead(404, H); res.end('audio is not served from this relay'); return; }
    const SRC = { nt: 'https://www.audiotreasure.com/content/WEBD_AT/zipfiles/WEB_NT_Audio.zip', ot: 'https://www.audiotreasure.com/content/WEBD_AT/zipfiles/WEB_OT_Audio.zip' };
    let q; try { q = new URL(req.url, 'http://x').searchParams; } catch { q = null; }
    const t = q && q.get('t'); const start = q && parseInt(q.get('start'), 10); const len = q && parseInt(q.get('len'), 10);
    if (!q || !SRC[t] || !Number.isFinite(start) || start < 0 || !Number.isFinite(len) || len <= 0 || len > 30 * 1024 * 1024) { res.writeHead(400, H); res.end('bad request'); return; }
    if (azRateLimited(clientIp(req))) { res.writeHead(429, { ...H, 'Retry-After': '60' }); res.end('rate limited'); return; }   // L1
    if (azInFlight >= AZ_MAX_CONCURRENT) { res.writeHead(503, { ...H, 'Retry-After': '5' }); res.end('busy — try again shortly'); return; }   // L1
    azInFlight++;
    fetch(SRC[t], { headers: { Range: 'bytes=' + start + '-' + (start + len - 1) } })
      .then(async up => {
        if (up.status !== 206 && up.status !== 200) { res.writeHead(502, H); res.end('upstream ' + up.status); return; }
        const buf = Buffer.from(await up.arrayBuffer());
        res.writeHead(200, { ...H, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000', 'Content-Length': buf.length });
        res.end(buf);
      }).catch(() => { try { res.writeHead(502, H); res.end('upstream error'); } catch {} })
      .finally(() => { azInFlight--; });   // L1: always release the slot
    return;
  }
  // web-push: hand out the VAPID public key + accept member push subscriptions
  if (route === '/push/vapid') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ publicKey: VAPID.publicKey })); return; }
  if (route === '/push/subscribe') {
    if (req.method !== 'POST') { res.writeHead(405).end('method'); return; }
    let body = ''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const { sub, auth, prefs } = JSON.parse(body);
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
        if (prefs && typeof prefs === 'object') { pushPrefs[pubkey] = { dm: prefs.dm !== false, announce: prefs.announce !== false, serving: prefs.serving !== false }; savePrefs(); }
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
      } catch { res.writeHead(400).end('bad'); }
    });
    return;
  }
  if (route === '/push/unsubscribe') {
    if (req.method !== 'POST') { res.writeHead(405).end('method'); return; }
    let body = ''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const { endpoint, auth } = JSON.parse(body);
        const j401 = (m) => { res.writeHead(401, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end(m); };
        if (!endpoint) { res.writeHead(400).end('bad'); return; }
        // same NIP-98 proof (bound to the endpoint) so only the owner can drop their own subscription
        if (!auth || typeof auth !== 'object' || !verifyEvent(auth)) return j401('unauthorized');
        const u = (auth.tags.find(t => t[0] === 'u') || [])[1];
        if (u !== endpoint) return j401('endpoint mismatch');
        if (Math.abs(Math.floor(Date.now() / 1000) - (auth.created_at || 0)) > 300) return j401('stale proof');
        const pubkey = auth.pubkey;
        if (pushSubs[pubkey]) { pushSubs[pubkey] = pushSubs[pubkey].filter(s => s.endpoint !== endpoint); if (!pushSubs[pubkey].length) delete pushSubs[pubkey]; saveSubs(); }
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
      } catch { res.writeHead(400).end('bad'); }
    });
    return;
  }
  // NIP-05: serve verified `name@thisrelay` handles for this relay's people (the church + its members),
  // resolved from their kind-0 profiles. First-come on a slug; the church outranks members. So a member
  // gets a real verified handle for free — no third-party domain.
  if (route === '/.well-known/nostr.json') {
    // SECURITY-AUDIT-2026-06-24 L7: scoped lookups only. The old fallback (no ?name= → return the
    // full {names, relays} map of every kind-0 profile) leaked every member's pubkey + name slug +
    // church affiliation cross-origin. The NIP-05 spec only requires the scoped form.
    let qName = ''; try { qName = (new URL(req.url, 'http://x').searchParams.get('name') || '').toLowerCase().trim(); } catch {}
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (!qName) { res.writeHead(200, H); res.end(JSON.stringify({ names: {} })); return; }
    const host = (req.headers.host || '').split(',')[0].trim();
    const relayUrl = host ? 'wss://' + host + '/relay' : '';
    const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '').slice(0, 30);
    // Resolve only the one requested slug. Churches outrank members on a contested slug; earliest
    // profile wins among the same tier. Same precedence as before, just no bulk dump.
    const k0 = store.query({ kinds: [0], limit: 1000000 }).sort((a, b) => (CHURCH_PUBS.has(b.pubkey) - CHURCH_PUBS.has(a.pubkey)) || ((a.created_at || 0) - (b.created_at || 0)));
    for (const e of k0) {
      if (BLOCKED.has(e.pubkey)) continue;
      let meta = {}; try { meta = JSON.parse(e.content); } catch {}
      const local = (meta.nip05 && String(meta.nip05).includes('@')) ? slug(String(meta.nip05).split('@')[0]) : slug(meta.name);
      if (local !== qName) continue;
      res.writeHead(200, H); res.end(JSON.stringify({ names: { [qName]: e.pubkey }, relays: relayUrl ? { [e.pubkey]: [relayUrl] } : {} })); return;
    }
    res.writeHead(200, H); res.end(JSON.stringify({ names: {} })); return;
  }
  let p; try { p = decodeURIComponent(route); } catch { res.writeHead(400).end('bad request'); return; }
  if (p === '/' || p.endsWith('/')) {
    // Flagship host split: the bare apex (MARKETING_HOST, default trinityone.church) serves the MARKETING
    // site at its root; the app subdomain (app.trinityone.church) — and every other host (*.ts.net,
    // localhost, the control dashboard) — serves the web APP. Other self-hosting churches are unaffected:
    // their Host never equals the marketing apex, so they always get index.html.
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    const marketingHost = (process.env.MARKETING_HOST || 'trinityone.church').toLowerCase();
    p += (p === '/' && host === marketingHost) ? 'welcome.html' : 'index.html';
  }
  // APKs deployed via the dashboard "Fetch latest APK" button live under relay/apks/ (writable, survives
  // self-updates). Serve from there if present; a root-level copy (manual scp) still works as a fallback.
  if (/^\/(trinityone|trinityone-steward)\.apk$/.test(p)) {
    const relApk = join(ROOT, 'relay', 'apks', p.slice(1));
    let st2 = null; try { st2 = statSync(relApk); } catch {}
    if (st2 && st2.isFile()) {
      res.writeHead(200, { 'Content-Type': MIME['.apk'] || 'application/octet-stream', 'Content-Length': st2.size, 'Access-Control-Allow-Origin': '*', 'Content-Disposition': 'attachment; filename="' + p.slice(1) + '"', ...SEC_HEADERS });
      createReadStream(relApk).pipe(res); return;
    }
  }
  // feature gates: the relay always serves its own control UI (/relay-app/*); module downloads + the web-app
  // mirror are switchable by the operator (the relay can be relay-only, or also host modules and/or the app).
  if (p.startsWith('/modules/')) { if (!SETTINGS.serveModules) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('module hosting is off on this relay'); return; } }
  else if (!p.startsWith('/relay-app/') && !SETTINGS.serveApp) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('the web app is not served from this relay'); return; }
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

// ---- relay (NIP-01) — events live in SQLite (node:sqlite); REQ reads are indexed queries ----
const store = openStore(SQLITE_DB, { maxEvents: MAX_EVENTS });
// one-time migration from the legacy JSON array store (then retire the file so it can't re-import)
if (store.count() === 0 && existsSync(DB)) {
  try {
    const arr = JSON.parse(readFileSync(DB, 'utf8'));
    if (Array.isArray(arr) && arr.length) { const n = store.importAll(arr); renameSync(DB, DB + '.migrated'); console.log(`[relay] migrated ${n} events from ${DB} → sqlite`); }
  } catch (e) { console.warn('[relay] JSON→sqlite migration failed:', e.message); }
}
store.cull();
// rebuild member/broadcast/care state from the structured (kind-30078) docs, oldest-first as before
if (CHURCH_PUBS.size) for (const e of store.query({ kinds: [30078], limit: 1000000 }).sort((a, b) => (a.created_at || 0) - (b.created_at || 0))) note(e);
function scheduleSave() {}   // no-op: SQLite persists synchronously (WAL); kept so existing call sites are harmless
// matchFilter is imported from event-store.mjs (single source of truth, also used by the SQL read path)
const matchAny = (evt, filters) => filters.some(f => matchFilter(evt, f));
const subs = new Map();   // ws -> Map(subId -> filters[])

const server = createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });   // 1 MB cap (default is 100 MB — memory-DoS guard)
const MAX_SUBS_PER_CONN = 256;  // headroom: a real client opens many subs (members, chat, profiles, etc.)
server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/relay') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  subs.set(ws, new Map());
  ws.isAlive = true;
  ws._auth = null;                                    // pubkey once the client proves it via NIP-42 AUTH
  ws._rl = { n: 0, t: Date.now(), drop: 0 };          // per-connection inbound rate limit (CPU-DoS guard)
  ws._challenge = randomBytes(16).toString('hex');    // per-connection nonce
  // LAZY NIP-42: we do NOT challenge on connect (that made every member pay a slow auth round-trip).
  // We only send the AUTH challenge when a REQ actually tries to read invite-only content (below), so
  // ordinary public reads have zero auth overhead and invite-group members auth exactly when needed.
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    // DoS guard: verifyEvent (schnorr) runs on every inbound EVENT, so an unthrottled flood — even of
    // forged events that get rejected — is a CPU-amplification vector. Cap inbound messages per
    // connection (~100/s, far above any legitimate client); persistent abuse closes the socket.
    const _now = Date.now();
    if (_now - ws._rl.t >= 1000) { ws._rl.t = _now; ws._rl.n = 0; }
    if (++ws._rl.n > 100) { if (++ws._rl.drop > 500) { try { ws.close(1008, 'rate limit'); } catch (e) {} } return; }
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const [type, ...rest] = msg;
    if (type === 'EVENT') {
      const evt = rest[0]; if (!evt || !evt.id) return;
      // NIP-01: a relay MUST verify the signature before storing/serving. Without this, anyone could
      // forge events under any pubkey (church/steward/member) — fake announcements, fake funds (with a
      // hostile lud16 to redirect giving), or flood forged events to evict real ones (MAX_EVENTS DoS).
      if (!verifyEvent(evt)) { ws.send(JSON.stringify(['OK', evt.id, false, 'invalid: signature failed'])); return; }
      if (!accept(evt)) { ws.send(JSON.stringify(['OK', evt.id, false, 'blocked: not a member or not permitted for this group'])); return; }
      const wasMember = MEMBERS.has(evt.pubkey);   // capture before note() flips it, to detect a genuinely new join
      note(evt);   // a membership/broadcast change takes effect for subsequent events
      // durable store handles replaceable dedup + smart retention (structure kept, oldest ephemeral culled).
      // 'have-newer' / 'duplicate' → acknowledge but don't re-broadcast.
      const putRes = store.put(evt);
      if (putRes === 'have-newer') { ws.send(JSON.stringify(['OK', evt.id, true, 'have newer'])); return; }
      if (putRes === 'duplicate') { ws.send(JSON.stringify(['OK', evt.id, true, 'duplicate'])); return; }
      store.cull();
      maybePush(evt);   // notify the targeted member if this is a serving request
      maybePushJoin(evt, wasMember);   // notify the steward's phone if this is a fresh church join
      maybePushMessage(evt);   // notify on a new DM (recipient) or church announcement (members)
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
      // serve everything this connection may read now (blocked members withheld; invite-only group
      // messages withheld from non-members per NIP-42)
      let matched = []; const _seen = new Set();
      for (const f of filters) for (const e of store.query(f)) { if (_seen.has(e.id)) continue; _seen.add(e.id); if (BLOCKED.has(e.pubkey) || !canRead(e, ws._auth)) continue; matched.push(e); }
      matched.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));   // oldest→newest, matching the previous array delivery order
      // LAZY NIP-42: challenge ONLY when the REQ explicitly targets an invite-only group (a #t for an
      // invite group id). A broad query (e.g. #p:church) that merely happens to match an invite message
      // is NOT challenged — those messages are just silently withheld — so ordinary reads pay no auth cost.
      const wantsInvite = !ws._auth && filters.some(f => (f['#t'] || []).some(t => GROUP_VIS.get(t) === 'invite'));
      if (wantsInvite) { try { ws.send(JSON.stringify(['AUTH', ws._challenge])); } catch {} }
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
          // now authed: replay the invite-only messages their open subs were waiting on (public events
          // were already delivered at REQ time, so only re-send invite-group ones to avoid duplicates)
          const mine = subs.get(ws);
          if (mine) for (const [subId, filters] of mine) {
            const seen = new Set();
            for (const f of filters) for (const e of store.query(f)) {
              if (seen.has(e.id)) continue; seen.add(e.id);
              if (BLOCKED.has(e.pubkey) || !canRead(e, ws._auth)) continue;
              const g = gidOf(e); if (g && GROUP_VIS.get(g) === 'invite') ws.send(JSON.stringify(['EVENT', subId, e]));
            }
          }
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
  console.log(`TrinityOne gateway on http://0.0.0.0:${PORT}  (app + relay at /relay, ${store.count()} events loaded)` +
    (CHURCH_PUBS.size ? `\n  write policy ON — ${CHURCH_PUBS.size} church(es), ${MEMBERS.size} members, ${BROADCAST.size} broadcast group(s)` : `\n  write policy OFF (open relay — set up a church in the control dashboard)`) +
    `\n  setup / control:  http://localhost:${PORT}/relay-app/control.html` +
    `\n  admin token (needed to configure from another device): ${ADMIN_TOKEN}`));
