// gateway.mjs -- TrinityOne unified self-host gateway.
// ONE node process, ONE port: serves the static web app AND the Nostr relay (at /relay), so the
// whole thing needs exactly ONE public tunnel and the app derives its relay from its own origin
// (ws[s]://<host>/relay). This is the engine the church Relay app wraps. NIP-01 + disk persistence.
//
//   node scripts/gateway.mjs [port]        default port 8090
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, appendFileSync, renameSync, statSync, createReadStream, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { extname, normalize, join, sep } from 'path';
import { fileURLToPath } from 'url';
import { lookup as dnsLookup } from 'dns/promises';
import { decode as nip19decode, npubEncode } from 'nostr-tools/nip19';
import { openStore, matchFilter } from './event-store.mjs';   // durable event storage (node:sqlite) + the canonical read predicate
import { verifyEvent, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import webpush from 'web-push';
import { randomBytes, timingSafeEqual, createHash } from 'crypto';
import { spawn, spawnSync } from 'child_process';

// A church's relay must NOT die from a background hiccup (a dropped cloudflared pipe, a stray rejected fetch).
// On Node 22 an unhandled rejection/exception exits the process by default — which would kill the relay AND the
// control panel it serves. Log and keep serving instead; a genuinely fatal state will surface elsewhere.
process.on('unhandledRejection', (e) => { try { console.error('[unhandledRejection]', (e && e.stack) || e); } catch {} });
process.on('uncaughtException', (e) => { try { console.error('[uncaughtException]', (e && e.stack) || e); } catch {} });

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // project dir (fileURLToPath is correct on Windows; the bare .pathname yields "/C:/…")
// The ONE directory the relay writes to (event db, keys, church.json, blobs, push subs, apks…). Defaults to
// ROOT/relay so a git-checkout relay is byte-for-byte unchanged. The packaged desktop app sets TRINITY_DATA_DIR
// to a writable per-user location (OS app-data dir) so the app payload itself can stay READ-ONLY inside the
// installed bundle — the app ships its code read-only and keeps its data separately, the platform-native way.
const DATA_DIR = process.env.TRINITY_DATA_DIR || join(ROOT, 'relay');
try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const PORT = Number(process.argv[2] || process.env.PORT || 8090);
const DB = process.env.RELAY_DB || join(DATA_DIR,'relay-db.json');                 // legacy JSON store (migrated from, once)
const SQLITE_DB = process.env.RELAY_SQLITE || join(DATA_DIR,'relay.sqlite');       // durable event store
const MAX_EVENTS = parseInt(process.env.RELAY_MAX_EVENTS, 10) || 20000;   // ephemeral budget; raise on a shared/public relay
// FEDERATION Phase 3a — relay OFFER (opt-in): an operator willing to host OTHER churches sets RELAY_OPEN=1,
// so this relay advertises itself (in its NIP-11 doc) as accepting new churches. Default OFF: a private/home
// relay never offers itself, so discovery/auto-pick can't surface it (FEDERATION-PLAN risk #4). operator =
// the operator's npub (who a church is trusting + can contact); region = a hint for nearest-relay preference.
const OFFER_OPEN = /^(1|true|yes|on)$/i.test(process.env.RELAY_OPEN || '');
const OFFER_OPERATOR = (process.env.RELAY_OPERATOR || '').trim();
const OFFER_REGION = (process.env.RELAY_REGION || '').trim();
const OFFER_CAP = parseInt(process.env.RELAY_CHURCH_CAP, 10) || 0;   // 0 = no declared cap
const NONMEMBER_KIND0_CAP = 1000;   // cap stored profiles from non-members (L2: prevent unbounded growth)
const STEWARDREQ_CAP = 50;          // cap pending steward-requests per church from strangers (audit L1: anti-flood)
const MEMBER_DOC_CAP = 500;         // M1: cap distinct addressable (30078) docs per member — one member can't disk-exhaust the relay with novel d-tags
// relay feature toggles — what this box serves besides the Nostr relay itself (owner request). Defaults
// preserve current behaviour (all on); edited via the token-gated /settings endpoint + the control dashboard.
const SETTINGS_FILE = join(DATA_DIR,'relay-settings.json');
// mediaCap/churchCap: operator storage limits in BYTES (0 = unlimited), settable from the control panel — for a
// public relay hosting several churches. The effective cap is the setting if non-zero, else the env fallback.
const SETTINGS = { serveApp: true, serveModules: true, serveAudio: true, appUrl: '', mediaCap: 0, churchCap: 0 };
function loadSettings() {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    if (s && typeof s === 'object') {
      SETTINGS.serveApp = s.serveApp !== false; SETTINGS.serveModules = s.serveModules !== false;
      SETTINGS.serveAudio = s.serveAudio !== false; SETTINGS.appUrl = typeof s.appUrl === 'string' ? s.appUrl.slice(0, 200) : '';
      SETTINGS.mediaCap = Math.max(0, parseInt(s.mediaCap, 10) || 0); SETTINGS.churchCap = Math.max(0, parseInt(s.churchCap, 10) || 0);
    }
  } catch {}
}
const effMediaCap = () => SETTINGS.mediaCap || MEDIA_CAP;      // total media-storage cap (bytes), setting overrides env
const effChurchCap = () => SETTINGS.churchCap || CHURCH_MEDIA_CAP;   // per-church media-storage cap (bytes)
function saveSettings() { try { const tmp = SETTINGS_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify(SETTINGS, null, 2) + '\n'); renameSync(tmp, SETTINGS_FILE); } catch {} }
loadSettings();

// where this box pulls code updates from (written by the installer); blank on the release host itself.
const ORIGIN = (() => { try { return readFileSync(join(DATA_DIR,'origin'), 'utf8').trim(); } catch { return ''; } })();
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
const UPDATE_FLAG = join(DATA_DIR,'.update-request');   // the relay can only write under relay/; a root path-unit watches this and runs the update
// FEDERATION Phase 5 Tier 2 — self-hosted media (Blossom-style content-addressed blobs). A church stores its
// OWN audio/video here (no YouTube), addressed by its SHA-256. Upload is church/steward-signed (kind 24242);
// download is member-gated (NIP-98 kind 27235). Blobs live under relay/ (the one dir the relay may write).
const BLOB_DIR = join(DATA_DIR,'blobs');
try { mkdirSync(BLOB_DIR, { recursive: true }); } catch {}
const MAX_BLOB = parseInt(process.env.RELAY_MAX_BLOB, 10) || 200 * 1024 * 1024;   // 200 MB/blob cap (sermons: audio small, video low-bitrate)
const MAX_IMPORT = parseInt(process.env.RELAY_MAX_IMPORT, 10) || 256 * 1024 * 1024;   // restore/clone: cap the events JSONL body (blobs come separately via PUT /blob)
const _blobRe = /^[0-9a-f]{64}$/;
function _blobOwner(sha) { try { return readFileSync(join(BLOB_DIR, sha + '.church'), 'utf8').trim(); } catch { return ''; } }
// Operator storage controls (public/shared relays): a relay operator can DISABLE media hosting entirely, or
// cap total / per-church media bytes, so many churches sharing one node can't exhaust its disk. (Docs/events
// are already bounded by MEMBER_DOC_CAP + ephemeral retention; this is the equivalent for blobs.)
const MEDIA_OFF = /^(1|true|yes|on)$/i.test(process.env.RELAY_MEDIA_OFF || '');   // relay stays a relay, refuses all /blob uploads
const MEDIA_CAP = parseInt(process.env.RELAY_MEDIA_CAP, 10) || 0;                 // global media byte cap (0 = unlimited)
const CHURCH_MEDIA_CAP = parseInt(process.env.RELAY_CHURCH_MEDIA_CAP, 10) || 0;   // per-church media byte cap (0 = unlimited)
const _mediaBytesByChurch = new Map(); let _mediaBytesTotal = 0;   // usage, scanned from disk at boot + updated on upload
// P7: tally media usage AFTER the relay starts listening (was a synchronous statSync-per-blob walk blocking boot
// on a media-heavy box). SET the totals from the disk scan (authoritative) rather than accumulate, so any upload
// that lands during the brief window isn't double-counted — the scan already sees it on disk.
setTimeout(() => { try { let total = 0; const by = new Map(); for (const f of readdirSync(BLOB_DIR)) { if (!/^[0-9a-f]{64}$/.test(f)) continue; let sz; try { sz = statSync(join(BLOB_DIR, f)).size; } catch { continue; } total += sz; const o = _blobOwner(f); if (o) by.set(o, (by.get(o) || 0) + sz); } _mediaBytesTotal = total; _mediaBytesByChurch.clear(); for (const [k, v] of by) _mediaBytesByChurch.set(k, v); } catch {} }, 0);
// upload auth: a signed, time-bounded kind-24242 event by the CHURCH key, or a steward of a named church.
function _blobUploader(req) {
  const m = /^Nostr\s+(.+)$/i.exec(req.headers['authorization'] || ''); if (!m) return null;
  let ev; try { ev = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return null; }
  if (!ev || ev.kind !== 24242 || !verifyEvent(ev)) return null;
  const tag = (k) => (ev.tags.find(t => t[0] === k) || [])[1];
  if (tag('t') !== 'upload') return null;
  const exp = parseInt(tag('expiration') || '0', 10); if (!exp || exp < Math.floor(Date.now() / 1000)) return null;   // must expire (anti-replay)
  const cp = tag('church');
  if (cp && stewardOf(ev.pubkey, cp)) return { church: cp, want: (tag('x') || '').toLowerCase() };
  if (CHURCH_PUBS.has(ev.pubkey)) return { church: ev.pubkey, want: (tag('x') || '').toLowerCase() };
  return null;
}
// download gate: a fresh NIP-98 (kind 27235) proof, bound to THIS url, signed by a member of the owning church.
function _blobMember(req, ownerCp, host, path) {
  if (!ownerCp || !CHURCH_PUBS.size) return true;   // unconfigured / no owner recorded → open
  const m = /^Nostr\s+(.+)$/i.exec(req.headers['authorization'] || ''); if (!m) return false;
  let ev; try { ev = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return false; }
  if (!ev || ev.kind !== 27235 || !verifyEvent(ev)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - (ev.created_at || 0)) > 300) return false;   // fresh (±5 min)
  const uTag = (ev.tags.find(t => t[0] === 'u') || [])[1] || '';
  try { const uu = new URL(uTag); if (uu.host !== host || uu.pathname !== path) return false; } catch { return false; }   // bound to this relay+path (anti-replay)
  const p = ev.pubkey;
  // SECURITY-AUDIT: gate to an EFFECTIVE member of the owning church — mirror rebuildMembers()/H1, not the raw
  // MEMBER_DOCS join set (which still holds blocked + unapproved-pending pubkeys). Otherwise a BANNED member, or
  // a stranger who self-joined an approval-gated church but was never admitted, keeps downloading members-only media.
  const md = MEMBER_DOCS.get(ownerCp);
  const gated = REQUIRE_APPROVAL.has(ownerCp), admitted = ADMITTED_BY.get(ownerCp);
  const effectiveMember = !!(md && md.has(p)) && !BLOCKED.has(p) && (!gated || !!(admitted && admitted.has(p)));
  return p === ownerCp || stewardOf(p, ownerCp) || effectiveMember;   // church / steward / effective member of the OWNING church
}

// backup export gate: a fresh NIP-98 (kind 27235) proof bound to THIS url, signed by the church key OR one of
// its stewards. Returns the authorised church pubkey (cp) or null — only they may pull a church's full corpus.
function _exportAuth(req, host, path) {
  const m = /^Nostr\s+(.+)$/i.exec(req.headers['authorization'] || ''); if (!m) return null;
  let ev; try { ev = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return null; }
  if (!ev || ev.kind !== 27235 || !verifyEvent(ev)) return null;
  if (Math.abs(Math.floor(Date.now() / 1000) - (ev.created_at || 0)) > 300) return null;   // fresh (±5 min, anti-replay)
  const uTag = (ev.tags.find(t => t[0] === 'u') || [])[1] || '';
  try { const uu = new URL(uTag); if (uu.host !== host || uu.pathname !== path) return null; } catch { return null; }
  const cp = (ev.tags.find(t => t[0] === 'church') || [])[1] || (CHURCH_PUBS.has(ev.pubkey) ? ev.pubkey : '');
  return cp && (ev.pubkey === cp || stewardOf(ev.pubkey, cp)) ? cp : null;   // the church key, or a steward of that church
}
// resync gate: a fresh NIP-98 proof bound to /sync, signed by a relay the church TRUSTS (its pubkey is in the
// church-signed trusted-relays doc) — or by the church key / a steward. Only they receive the FULL corpus (incl.
// safeguarding-gated cleartext), because a trusted relay re-enforces canRead() when it serves members. Returns cp.
function _syncAuth(req, host, path) {
  const m = /^Nostr\s+(.+)$/i.exec(req.headers['authorization'] || ''); if (!m) return null;
  let ev; try { ev = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return null; }
  if (!ev || ev.kind !== 27235 || !verifyEvent(ev)) return null;
  if (Math.abs(Math.floor(Date.now() / 1000) - (ev.created_at || 0)) > 300) return null;
  const uTag = (ev.tags.find(t => t[0] === 'u') || [])[1] || '';
  try { const uu = new URL(uTag); if (uu.host !== host || uu.pathname !== path) return null; } catch { return null; }
  const cp = (ev.tags.find(t => t[0] === 'church') || [])[1] || '';
  if (!cp) return null;
  const trusted = TRUSTED_RELAYS.get(cp);
  if (trusted && trusted.has(ev.pubkey)) return cp;              // a relay the church authorised -> full corpus
  if (ev.pubkey === cp || stewardOf(ev.pubkey, cp)) return cp;   // the church key / a steward
  return null;
}

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
const RELEASE_KEY = join(DATA_DIR,'release-key.pem');    // release SECRET (gitignored; release host only)
const BUNDLE_CACHE_DIR = join(DATA_DIR,'.bundle-cache'); // per-HEAD cached bundle + signature (gitignored)
// Build (or reuse) the cached, signed bundle for the current HEAD. Returns { tgz, sig } absolute paths,
// or null if we can't (e.g. no release key on a non-release box — then we just serve the unsigned tgz
// as before, and signed verification only kicks in once a key is present). Cheap on the hot path: if the
// files for this sha already exist, we return immediately without spawning anything.
function ensureSignedBundle() {
  // Key the cache by the LIVE git HEAD, not the sha read at startup — so a new commit auto-invalidates the cache
  // and the next pull rebuilds. Without this the release host froze on its startup sha and every deploy needed a
  // manual `rm relay/.bundle-cache/*` (the "clear .bundle-cache to deploy" gotcha). Falls back to BUILD.sha/HEAD.
  let sha = BUILD.sha && !BUILD.sha.startsWith('$Format') ? BUILD.sha : 'HEAD';
  try { const g = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }); if (g.status === 0 && g.stdout && g.stdout.trim()) sha = g.stdout.trim(); } catch {}
  const tgz = join(BUNDLE_CACHE_DIR, sha + '.tgz');
  const sig = join(BUNDLE_CACHE_DIR, sha + '.tgz.sig');
  if (existsSync(tgz)) return { tgz, sig: existsSync(sig) ? sig : null, sha };
  if (!existsSync(RELEASE_KEY)) return null;   // not a release host — no signed bundle to serve
  try {
    mkdirSync(BUNDLE_CACHE_DIR, { recursive: true });
    const tmp = tgz + '.tmp.' + process.pid;
    // git archive -> deterministic-enough single artifact we then freeze on disk and never regenerate for this sha.
    if (process.env.STRICT_WEB_BUNDLE) {
      // D1: build a PRE-TRANSPILED (Babel-free) web bundle here on the release host — a8 has no esbuild to do
      // it at pull time. The script writes the .tgz straight to tmp. Falls through to a null return on failure.
      const bs = spawnSync('bash', [join(ROOT, 'scripts', 'build-strict-tgz.sh'), tmp], { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'ignore', 'inherit'] });
      if (bs.status !== 0 || !existsSync(tmp)) return null;
    } else {
      const ar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar.gz', 'HEAD'], { maxBuffer: 512 * 1024 * 1024 });
      if (ar.status !== 0 || !ar.stdout || !ar.stdout.length) return null;
      writeFileSync(tmp, ar.stdout);
    }
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
const FIN_JOURNAL_D = 'finance/journal:';   // church-book double-entry journal entry — d=finance/journal:<seq>, ["church",<cp>], single-writer & append-only
const ROOM_D = 'trinityone/room:', BOOKING_D = 'trinityone/booking:';   // shared room calendar (church-only writes)
const RUNSHEET_D = 'trinityone/runsheet:';   // a service's order-of-service + song setlist — d=runsheet:<serviceId> (church/steward)
const RELAYS_D = 'trinityone/relays';   // the church's trusted-relays list (resync): d=trinityone/relays, church-signed, content=[{pubkey,url}]
const NETWORK_D = 'trinityone/network:';   // the church declares it belongs to a network (the network's pubkey)
const BLOCKED_D = 'trinityone/blocked:';   // a church's blocklist (banned member pubkeys) — d=blocked:<churchpub>
const PIN_D = 'trinityone/pin:';           // a group's pinned message — d=pin:<groupId> (one per group)
const PINSERMON_D = 'trinityone/pinsermon:'; // the church's currently-featured/pinned sermon — d=pinsermon:<churchpub> (one per church) → member Today card + notification
const HIDE_D = 'trinityone/hidden:';       // a removed/hidden message — d=hidden:<msgId> (one per message)
const MINORS_D = 'trinityone/minors:';     // safeguarding: a church's list of minor (child) pubkeys — d=minors:<churchpub>
const APPROVED_D = 'trinityone/approved:'; // safeguarding: adults cleared to contact youth (mirrors the church's DBS/cleared list) — d=approved:<churchpub>
const GUARDIANS_D = 'trinityone/guardians:'; // safeguarding v2: church-signed child→parents map — d=guardians:<churchpub>; a guardian may always DM their own child
const GUARDNOTICE_D = 'trinityone/guardnotice:'; // safeguarding v2: church->parent notice of a steward-made guardian link — d=guardnotice:<parentpub>, p-tagged + NIP-44-encrypted to the parent (child link never in cleartext)
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
const AVAIL_D = 'trinityone/careavail:';  // a member's "I'm here to help" availability — d=careavail:<churchpub> (member-signed, one per member per church; non-minors only)
function toHexPub(s) { if (!s) return null; s = String(s).trim(); if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase(); try { const d = nip19decode(s); return d.type === 'npub' ? d.data : null; } catch { return null; } }
// the relay can host MULTIPLE churches — each manages its own data, scoped by author. Configure via
// CHURCH_NPUB (comma-separated) or relay/church.json ({npub} | {npubs:[…]} | {churches:[{npub}…]}).
const CHURCH_PUBS = new Set();
const CHURCH_NAMES = new Map();   // hex pub -> display name (for the Relay app dashboard)
const addChurch = (s, name) => { const h = toHexPub(s); if (h) { CHURCH_PUBS.add(h); if (name) CHURCH_NAMES.set(h, name); } };
const CHURCH_FILE = join(DATA_DIR,'church.json');
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
const ADMIN_FILE = join(DATA_DIR,'admin.json');
let ADMIN_TOKEN = '';
try { ADMIN_TOKEN = JSON.parse(readFileSync(ADMIN_FILE, 'utf8')).token || ''; } catch {}
if (!ADMIN_TOKEN) { ADMIN_TOKEN = randomBytes(24).toString('base64url'); try { writeFileSync(ADMIN_FILE, JSON.stringify({ token: ADMIN_TOKEN }), { mode: 0o600 }); } catch {} }
// Relay identity (for resync): this relay's own Nostr keypair. It proves WHICH relay is asking when it pulls a
// peer for a church's full corpus — a church authorises specific relay pubkeys as its trusted infrastructure
// (see TRUSTED_RELAYS), the same church key that gatekeeps writes. Generated once, stored 0600 (gitignored).
const RELAY_KEY_FILE = join(DATA_DIR,'relay-key.json');
let RELAY_SK = null, RELAY_PUB = '';
try { const k = JSON.parse(readFileSync(RELAY_KEY_FILE, 'utf8')); if (k && k.sk && k.pub) { RELAY_SK = Uint8Array.from(Buffer.from(k.sk, 'hex')); RELAY_PUB = k.pub; } } catch {}
if (!RELAY_SK || !RELAY_PUB) { RELAY_SK = generateSecretKey(); RELAY_PUB = getPublicKey(RELAY_SK); try { writeFileSync(RELAY_KEY_FILE, JSON.stringify({ sk: Buffer.from(RELAY_SK).toString('hex'), pub: RELAY_PUB }), { mode: 0o600 }); } catch {} }
// a relay-signed NIP-98 (kind-27235) proof bound to url+method+church — how this relay authenticates to a peer's /sync.
function relayProof(url, method, cp) { return 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', method], ['church', cp]], content: '' }, RELAY_SK))).toString('base64'); }
// this relay's OWN claim (control panel → claim a memorable name in a directory): kind-27235 signed by RELAY_SK, binding handle+relay-url.
function relayNameClaim(handle, url) { return 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', 'relay-names/claim'], ['method', 'POST'], ['handle', handle], ['relay', url]], content: '' }, RELAY_SK))).toString('base64'); }
// ── Relay name directory (Phase 2): a memorable handle a steward can TYPE to connect a church to a relay,
// instead of a wss:// URL. Any gateway can serve a directory; in practice relays register with the shared
// community host and consoles resolve there. A claim is SIGNED by the relay's own identity key, so a handle is
// owned by the first relay pubkey to take it and only that key can re-point it. Resolution is public.
const RELAY_NAMES_FILE = join(DATA_DIR, 'relay-names.json');
let RELAY_NAMES = {};
try { RELAY_NAMES = JSON.parse(readFileSync(RELAY_NAMES_FILE, 'utf8')) || {}; } catch {}
function saveRelayNames() { try { const tmp = RELAY_NAMES_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify(RELAY_NAMES, null, 2) + '\n'); renameSync(tmp, RELAY_NAMES_FILE); } catch {} }
const _handleRe = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;   // 3–32 chars, lowercase alnum + inner hyphens
// verify a claim: Authorization 'Nostr <base64 kind-27235 event>' signed by a relay key, tags bind handle+relay.
function _verifyRelayClaim(req, handle, relayUrl) {
  try {
    const h = req.headers['authorization'] || '';
    if (!/^Nostr /i.test(h)) return null;
    const ev = JSON.parse(Buffer.from(h.slice(6), 'base64').toString('utf8'));
    if (!ev || ev.kind !== 27235 || !verifyEvent(ev)) return null;
    if (Math.abs(Math.floor(Date.now() / 1000) - (ev.created_at || 0)) > 120) return null;   // anti-replay
    const tag = (n) => (ev.tags.find(t => Array.isArray(t) && t[0] === n) || [])[1];
    if (tag('handle') !== handle || tag('relay') !== relayUrl) return null;
    return ev.pubkey;   // the claiming relay's identity pubkey
  } catch { return null; }
}
// Where THIS relay registers its name + where consoles resolve names. Defaults to the shared community host;
// a church can self-host a directory by pointing RELAY_DIRECTORY at its own gateway.
const DIRECTORY = (process.env.RELAY_DIRECTORY || 'https://app.trinityone.church').replace(/\/+$/, '');
const MYNAME_FILE = join(DATA_DIR, 'relay-myname.json');
let MY_RELAY_NAME = ''; try { MY_RELAY_NAME = JSON.parse(readFileSync(MYNAME_FILE, 'utf8')).handle || ''; } catch {}
// ── Cloudflare quick tunnel (desktop "go public", no account): spawn cloudflared, capture its trycloudflare.com
// URL, and re-point the relay's directory name at it — so members connect by a stable NAME even though the
// quick-tunnel URL changes on each start. CLOUDFLARED_BIN is set by the desktop app to its bundled binary.
const CLOUDFLARED_BIN = process.env.CLOUDFLARED_BIN || 'cloudflared';
const TUNNEL_FLAG = join(DATA_DIR, 'tunnel-on');   // presence = "stay public": re-open the tunnel on every boot
const CF_LOG_FILE = join(DATA_DIR, 'cloudflared.log');   // full transcript of the last tunnel attempt (for diagnosing)
let CF_CHILD = null, CF_URL = '', CF_TAIL = [], CF_STARTING = null;   // CF_TAIL: ring buffer of log lines; CF_STARTING: in-flight start promise (dedupes concurrent starts)
function cfLog(s) { const line = String(s); for (const ln of line.split(/\r?\n/)) { if (ln.trim()) CF_TAIL.push(ln.trim()); } while (CF_TAIL.length > 40) CF_TAIL.shift(); try { appendFileSync(CF_LOG_FILE, line); } catch {} }
// Turn cloudflared's own log tail into a human hint about WHY the tunnel didn't hold. VPNs block the QUIC (UDP)
// path; a firewall / antivirus can block cloudflared's outbound entirely (it prints the URL, then can't keep the
// connection and exits "no more connections active"). Missing binary is a build problem.
function cfErrorHint() {
  const t = CF_TAIL.join('\n');
  if (/no more connections active|failed to (dial|connect)|context deadline|timeout|refused|unreachable|ERR /i.test(t))
    return 'the tunnel couldn’t stay connected. A VPN, firewall, or antivirus is likely blocking cloudflared — allow it through your firewall (or turn your VPN off) and click again.';
  return 'couldn’t reach Cloudflare — a VPN or firewall may be blocking it. Try turning your VPN off and click again.';
}
function cfPublicWss() { return CF_URL ? CF_URL.replace(/^https/i, 'wss') + '/relay' : ''; }
async function reclaimRelayName() {   // re-point the claimed name at the current public URL (needs both)
  if (!MY_RELAY_NAME || !CF_URL) return;
  const wss = cfPublicWss();
  try { await fetch(DIRECTORY + '/relay-names/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': relayNameClaim(MY_RELAY_NAME, wss) }, body: JSON.stringify({ handle: MY_RELAY_NAME, url: wss }) }); } catch {}
}
// the relay's pet-name as a directory handle slug (matches the client's stewardNameFor, lower-cased + hyphens),
// so going public can auto-claim a memorable name with zero steps — e.g. "Quiet Dove 45" -> "quiet-dove-45".
const _PET_ADJ = ['quiet', 'bright', 'gentle', 'steady', 'faithful', 'humble', 'joyful', 'kind', 'patient', 'bold', 'gracious', 'calm', 'glad', 'warm', 'true', 'sure'];
const _PET_NOUN = ['olive', 'cedar', 'dove', 'anchor', 'lamp', 'vine', 'shepherd', 'harbor', 'beacon', 'reed', 'sparrow', 'willow', 'spring', 'haven', 'ember', 'brook'];
function relayPetSlug() { const h = RELAY_PUB; if (!/^[0-9a-f]{64}$/i.test(h)) return ''; let x = 0; for (let i = 0; i < h.length; i++) x = (x * 31 + h.charCodeAt(i)) >>> 0; return _PET_ADJ[x % 16] + '-' + _PET_NOUN[(x >>> 4) % 16] + '-' + (10 + (x >>> 9) % 90); }
function startCloudflared() {
  if (CF_CHILD && CF_URL) return Promise.resolve({ ok: true, url: CF_URL });   // already public — don't spawn again
  if (CF_STARTING) return CF_STARTING;   // a start is already in flight (e.g. boot auto-reopen) — join it, never spawn a 2nd tunnel
  CF_STARTING = new Promise((resolve) => {
    const settle = (r) => { CF_STARTING = null; resolve(r); };
    try { writeFileSync(CF_LOG_FILE, ''); } catch {}    // fresh transcript per attempt
    CF_TAIL = [];
    // Let cloudflared auto-pick its transport (default): it prechecks connectivity and uses QUIC where it can,
    // falling back to HTTP/2 over ordinary HTTPS where UDP is blocked (e.g. behind a VPN). --edge-ip-version auto
    // lets it try IPv4 and IPv6 edges.
    let child; try { child = spawn(CLOUDFLARED_BIN, ['tunnel', '--no-autoupdate', '--edge-ip-version', 'auto', '--url', 'http://localhost:' + PORT], { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { settle({ ok: false, error: 'cloudflared isn’t bundled with this build — reinstall the latest Suite.' }); return; }
    CF_CHILD = child;
    let done = false, url = '', registered = false;
    // Success is NOT "the URL string appeared" — cloudflared prints the trycloudflare URL up front, BEFORE the
    // edge connection is up. If the connection then fails the child exits and the tunnel is dead. So we only
    // declare victory once we see a "Registered tunnel connection" line AND we have the URL.
    const finishOk = () => {
      if (done) return; done = true; CF_URL = url;
      try { writeFileSync(TUNNEL_FLAG, '1'); } catch {}
      if (!MY_RELAY_NAME) { MY_RELAY_NAME = relayPetSlug(); try { writeFileSync(MYNAME_FILE, JSON.stringify({ handle: MY_RELAY_NAME }) + '\n'); } catch {} }
      reclaimRelayName(); settle({ ok: true, url: CF_URL });
    };
    const onData = (d) => {
      const s = String(d); cfLog(s);
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i); if (m) url = m[0];
      if (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(s)) registered = true;
      if (url && registered) finishOk();
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    // A dead pipe on Windows emits 'error' on the stdio stream itself; with no listener Node throws and takes the
    // WHOLE relay down. Swallow those — they're never fatal to the relay.
    child.stdout.on('error', () => {}); child.stderr.on('error', () => {});
    // Only clear shared state if it's OUR child that died — a stale/duplicate tunnel exiting must not wipe a live one.
    child.on('exit', () => { if (CF_CHILD === child) { CF_CHILD = null; CF_URL = ''; } if (!done) { done = true; settle({ ok: false, error: cfErrorHint() }); } });
    child.on('error', (e) => { if (CF_CHILD === child) CF_CHILD = null; if (!done) { done = true; settle({ ok: false, error: String((e && e.message) || e) }); } });
    setTimeout(() => { if (!done) { done = true; try { if (child) child.kill(); } catch {} if (CF_CHILD === child) CF_CHILD = null; settle({ ok: false, error: cfErrorHint() }); } }, 30000);
  });
  return CF_STARTING;
}
function reqToken(req) { const h = req.headers['authorization'] || ''; const m = /^Bearer\s+(.+)$/i.exec(h); if (m) return m[1].trim(); try { return new URL(req.url, 'http://x').searchParams.get('token') || ''; } catch { return ''; } }
// Always require the admin token. Do NOT trust loopback: the relay runs behind the Tailscale Funnel /
// cloudflared, which proxy from 127.0.0.1, so a public request is indistinguishable from a local one.
function adminOK(req) { const t = reqToken(req); if (!t || !ADMIN_TOKEN) return false; const a = Buffer.from(t), b = Buffer.from(ADMIN_TOKEN); return a.length === b.length && timingSafeEqual(a, b); }
const STARTED_AT = Date.now();
const MEMBERS = new Set();     // EFFECTIVE members (write-allowed): self-joined, minus blocked, minus unapproved (when a church gates joining). Rebuilt by rebuildMembers().
const MEMBER_DOCS = new Map(); // churchpub -> Set(pubkeys who published a member: doc — i.e. asked to join / joined)
const TRUSTED_RELAYS = new Map(); // churchpub -> Set(relay pubkeys the church authorised as trusted infra — may pull the FULL corpus)
const PEER_URLS = new Map();      // churchpub -> Set(relay URLs to sync this church WITH, from the same church-signed doc)
const SYNC_CURSOR_FILE = join(DATA_DIR,'sync-cursors.json');   // { "<cp>@<peerUrl>": lastCreatedAt } — resumable, idempotent
let SYNC_CURSORS = {}; try { SYNC_CURSORS = JSON.parse(readFileSync(SYNC_CURSOR_FILE, 'utf8')) || {}; } catch {}
const SYNC_OVERLAP = 600;   // re-pull a 10-min window before the cursor each time, so an event that arrived out-of-order isn't missed
const GROUP_CHURCH = new Map();  // groupId -> owning church/network pubkey — per-church retention attribution for chat
const MEMBER_CHURCH = new Map(); // member pubkey -> a church they belong to — attributes their DMs/reactions to a church
const REQUIRE_APPROVAL = new Set(); // churchpubs whose joins need steward approval (default: open join)
const ADMITTED_BY = new Map();      // churchpub -> Set(approved member pubkeys) (only used when that church requires approval)
const JOIN_NOTIFIED = new Set();    // "pubkey:churchpub" we've already alerted the steward about (join or request) — dedupe push spam
const BROADCAST = new Set();   // group ids the church marked broadcast
const NETWORKS = new Set();    // network pubkeys this church joined — allowed to publish church-style content here
const GROUP_LEADERS = new Map(); // groupId -> Set(pubkey) — members a leader empowered to post events for that group
const GROUP_LEADER_BY = new Map(); // groupId -> { by, cp } — who authored the leader grant (M2: void it if they're later revoked)
const STEWARDS_BY = new Map();   // churchpub -> Set(steward pubkeys) from the owner-signed stewards: roster (delegated, revocable authority)
// Meal trains / care module state (rebuilt from stored events by note()):
const ROSTER_PEOPLE = new Map();     // teamId(groupId) -> Set(pubkey) — people LINKED on a team roster; the care-team's members live here
const ROSTER_BY = new Map();          // teamId(groupId) -> { by, cp } — who authored the roster (M2: void the care-admin grant if they're later revoked)
const FINANCE_SEQ = new Map();        // churchpub -> last accepted finance-journal seq — the relay is the ordering authority; the next write must be seq+1 (single-writer, no gaps/forks/edits)
const MEALS_ADMIN_GROUP = new Map(); // churchpub -> care-team groupId (its roster people may open/manage care needs)
const MEALS_OPEN_MEMBER = new Set(); // churchpubs whose meals-settings allow ANY member to open their own care need (openedBy='member')
const CARE_RECIPIENT = new Map();    // careId -> recipient pubkey (so a careskip: write can be gated to the recipient alone)
// is `pub` a current steward of church `cp`? (empty/no roster => false => behaviour identical to pre-roster)
const stewardOf = (pub, cp) => { const s = STEWARDS_BY.get(cp); return !!(cp && s && s.has(pub)); };
// M2: a delegated leader/care-admin grant is only honoured while the steward who authored it is STILL a
// steward (or the church/network key). So revoking a steward immediately drops the group-leader and
// care-team grants they created — no re-derivation pass, the check just runs at use-time.
const grantorOk = (src) => !!(src && (CHURCH_PUBS.has(src.by) || NETWORKS.has(src.by) || stewardOf(src.by, src.cp)));
// is `pub` on the care-team of church `cp`? (a member of the roster of cp's configured care-team group)
const careAdmin = (pub, cp) => { const g = cp && MEALS_ADMIN_GROUP.get(cp); const ppl = g && ROSTER_PEOPLE.get(g); return !!(ppl && ppl.has(pub) && grantorOk(ROSTER_BY.get(g))); };
// the church a steward-authored CONTENT event acts for: its ["church", <cp>] tag, validated to a configured church.
const namedChurch = (e) => { const t = (e.tags || []).find(t => t[0] === 'church'); const h = t && (toHexPub(t[1]) || t[1]); return h && CHURCH_PUBS.has(h) ? h : ''; };
// finance docs are authored EITHER by the church key itself (encPublish — self-encrypted, no ['church'] tag)
// OR by a steward naming the church in a ['church'] tag. Resolve the owning church for the finance gates from both.
const finCp = (e) => namedChurch(e) || (CHURCH_PUBS.has(e.pubkey) ? e.pubkey : '');
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
const SUBS_FILE = join(DATA_DIR,'subscribers.json');
let subscribers = []; try { const d = JSON.parse(readFileSync(SUBS_FILE, 'utf8')); if (Array.isArray(d)) subscribers = d; } catch {}
const subSeen = new Set(subscribers.map(s => String(s.email || '').toLowerCase()));
const SUB_RL = new Map();   // ip -> [recent signup timestamps] — basic per-IP anti-flood

// ---- web push (VAPID): notify members of serving requests in real time (PWA) ----
const VAPID_PATH = join(DATA_DIR,'vapid.json');
const SUBS_PATH = join(DATA_DIR,'push-subs.json');
let VAPID = null;
try { VAPID = JSON.parse(readFileSync(VAPID_PATH, 'utf8')); }
catch { VAPID = webpush.generateVAPIDKeys(); try { writeFileSync(VAPID_PATH, JSON.stringify(VAPID), { mode: 0o600 }); } catch {} }   // SECURITY-AUDIT-2026-06-24 M3: VAPID private key must not be group-readable
webpush.setVapidDetails('mailto:steward@trinityone.app', VAPID.publicKey, VAPID.privateKey);
let pushSubs = {};   // { memberHex: [PushSubscription, …] }
try { pushSubs = JSON.parse(readFileSync(SUBS_PATH, 'utf8')); } catch {}
function saveSubs() { try { writeFileSync(SUBS_PATH, JSON.stringify(pushSubs)); } catch {} }
// per-member category prefs ({ dm, announce, serving }) set from the app's notification settings. A
// missing member or missing category defaults to ON, so older clients keep getting everything.
const PREFS_PATH = join(DATA_DIR,'push-prefs.json');
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
    if (wasMember) return;   // ALREADY a known member (persisted state) → a boot re-announce, not a new join — the fix for re-notify-after-restart
    const key = evt.pubkey + ':' + churchPub;
    if (JOIN_NOTIFIED.has(key)) return;   // secondary in-session dedupe
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
// which church an event counts against for per-church retention: its explicit 'church' tag, else (for chat)
// its group's owning church, else (a member's DMs/reactions) that member's church, else '' (shared bucket).
function resolveChurch(e) {
  const ct = (e.tags || []).find(t => t[0] === 'church'); if (ct && ct[1]) return ct[1];
  if (CHURCH_PUBS.has(e.pubkey) || NETWORKS.has(e.pubkey)) return e.pubkey;
  const g = gidOf(e); if (g && GROUP_CHURCH.has(g)) return GROUP_CHURCH.get(g);
  return MEMBER_CHURCH.get(e.pubkey) || '';
}
// (re)build all in-memory church/member/group/care maps from the stored kind-30078 structure docs, oldest-first.
// Run at startup and after a restore/clone import so the imported church's membership + groups take effect at once.
function hydrateMaps() { if (!CHURCH_PUBS.size) return; for (const e of store.query({ kinds: [30078], limit: 1000000 }).sort((a, b) => (a.created_at || 0) - (b.created_at || 0))) note(e); }
// persist the current church allow-list to church.json (so a clone-registered church survives a relay restart).
function persistChurches() { try { const churches = [...CHURCH_PUBS].map(h => ({ npub: npubEncode(h), name: CHURCH_NAMES.get(h) || '' })); const tmp = CHURCH_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify({ churches }, null, 2) + '\n'); renameSync(tmp, CHURCH_FILE); } catch {} }
function note(e) {   // keep MEMBERS / BROADCAST in step with accepted events
  if (!CHURCH_PUBS.size || e.kind !== 30078) return;
  const d = dtag(e), removed = (e.tags || []).some(t => t[0] === 'deleted') || !e.content;
  let cp;   // the church a <cp>-keyed admin doc is for — author is the church itself OR one of its rostered stewards
  if (d.startsWith(MEMBER_D) && CHURCH_PUBS.has(d.slice(MEMBER_D.length))) {   // asked to join / joined one of our churches
    const cp = d.slice(MEMBER_D.length); let s = MEMBER_DOCS.get(cp); if (!s) { s = new Set(); MEMBER_DOCS.set(cp, s); }
    if (removed) { s.delete(e.pubkey); if (MEMBER_CHURCH.get(e.pubkey) === cp) MEMBER_CHURCH.delete(e.pubkey); } else { s.add(e.pubkey); MEMBER_CHURCH.set(e.pubkey, cp); }
    rebuildMembers();   // effective membership respects the join policy + admitted list + blocklist
  }
  else if (d.startsWith(NETWORK_D) && CHURCH_PUBS.has(e.pubkey)) {   // a church joined/left a network
    const np = d.slice(NETWORK_D.length); if (removed) NETWORKS.delete(np); else NETWORKS.add(np);
  }
  else if (d === RELAYS_D && CHURCH_PUBS.has(e.pubkey)) {   // the church's trusted-relays list (resync peers + full-corpus authorisation)
    const cp = e.pubkey; const pubs = new Set(), urls = new Set();
    if (!removed) { let list = []; try { list = JSON.parse(e.content); } catch {} for (const r of (Array.isArray(list) ? list : [])) { if (r && r.pubkey) pubs.add(String(r.pubkey)); if (r && r.url) urls.add(String(r.url)); } }
    TRUSTED_RELAYS.set(cp, pubs); PEER_URLS.set(cp, urls);
  }
  else if (d.startsWith(GROUP_D) && (CHURCH_PUBS.has(e.pubkey) || NETWORKS.has(e.pubkey) || stewardOf(e.pubkey, namedChurch(e)))) {
    const id = d.slice(GROUP_D.length); let c = {}; try { c = JSON.parse(e.content); } catch {}
    if (removed) { BROADCAST.delete(id); GROUP_LEADERS.delete(id); GROUP_LEADER_BY.delete(id); GROUP_VIS.delete(id); GROUP_MEMBERS.delete(id); GROUP_NAMES.delete(id); GROUP_CHURCH.delete(id); return; }
    GROUP_CHURCH.set(id, namedChurch(e) || e.pubkey);   // owning church/network — per-church retention attribution
    if (c.name) GROUP_NAMES.set(id, String(c.name).slice(0, 60));
    if (c.kind === 'broadcast') BROADCAST.add(id); else BROADCAST.delete(id);
    // a group def may name member leaders who can post events for that group
    GROUP_LEADERS.set(id, new Set(Array.isArray(c.leaders) ? c.leaders : [])); GROUP_LEADER_BY.set(id, { by: e.pubkey, cp: namedChurch(e) || e.pubkey });
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
    if (removed) { ROSTER_PEOPLE.delete(id); ROSTER_BY.delete(id); return; }
    const set = new Set(); try { (JSON.parse(e.content).people || []).forEach(p => { const h = p && toHexPub(p.pub); if (h) set.add(h); }); } catch {}
    ROSTER_PEOPLE.set(id, set); ROSTER_BY.set(id, { by: e.pubkey, cp: namedChurch(e) || e.pubkey });
  }
  else if (d.startsWith(FIN_JOURNAL_D)) {   // finance journal entry — track the book's high-water seq for the single-writer guard
    const fcp = finCp(e);
    if (fcp && (e.pubkey === fcp || stewardOf(e.pubkey, fcp))) {
      const seq = parseInt(d.slice(FIN_JOURNAL_D.length), 10);
      if (Number.isInteger(seq)) FINANCE_SEQ.set(fcp, Math.max(FINANCE_SEQ.get(fcp) || 0, seq));   // accepted entries are contiguous, so max == last-contiguous (rebuild-safe)
    }
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
    // SECURITY-AUDIT-2026-07-06 M6: reject in O(cap) once the stranger cap is reached, instead of scanning +
    // JSON-parsing the ENTIRE kind-0 table (limit 1e6) on every stranger profile write — a cheap-request →
    // expensive-work amplifier a spammer could drive with fresh keypairs. Bound the query to what's needed to
    // count the cap (members + up-to-cap strangers) and early-break, so the work never exceeds O(cap).
    let strangers = 0;
    for (const x of store.query({ kinds: [0], limit: NONMEMBER_KIND0_CAP + MEMBERS.size + 16 })) {
      if (CHURCH_PUBS.has(x.pubkey) || NETWORKS.has(x.pubkey) || MEMBERS.has(x.pubkey)) continue;
      if (++strangers >= NONMEMBER_KIND0_CAP) return false;
    }
    return true;
  }
  if (k === 30078) {
    const d = dtag(e);
    // Steward authority is ADDITIVE (see STEWARD-ROSTER-DESIGN.md): isLeader (the church/network key) always
    // passes exactly as before; a rostered steward of the relevant church ALSO passes for DELEGATED ops.
    // OWNER-ONLY ops never consult the roster — so they stay church-key-only automatically.
    if (d.startsWith(STEWARDS_D)) return CHURCH_PUBS.has(e.pubkey) && d.slice(STEWARDS_D.length) === e.pubkey;   // OWNER-ONLY: only the church key edits its own steward roster
    if (d.startsWith(BLOCKED_D)) return isLeader;                                                                // OWNER-ONLY: banning is not delegated to stewards
    if (d.startsWith(EVENT_D) || d.startsWith(PIN_D) || d.startsWith(HIDE_D)) {   // church/steward, or a group's empowered member, may post events / pin / hide
      // SECURITY-AUDIT-2026-07-06 M5: bind authority to the church that actually OWNS the referenced group,
      // not the one the author self-declares in its ['church'] tag. Otherwise a steward of church A could
      // pin/hide content in church B's group by naming A. GROUP_CHURCH is the group's true owner.
      const g = eventGroup(e); const owner = g && GROUP_CHURCH.get(g);
      if (owner) {
        if (e.pubkey === owner || isNetwork || stewardOf(e.pubkey, owner)) return true;   // owner church, its network, or a steward OF THE OWNER
        const leaders = GROUP_LEADERS.get(g);
        return !!(leaders && leaders.has(e.pubkey) && grantorOk(GROUP_LEADER_BY.get(g)));   // an empowered leader of that group (grant voided if its granter was revoked)
      }
      return isLeader || stewardOf(e.pubkey, namedChurch(e));   // group unknown to this relay → no target to cross-bind against; fall back to the self-named gate
    }
    // <cp>-keyed membership admin: the church is named in the d-tag → delegate to a steward of THAT church
    for (const pfx of [JOINPOLICY_D, ADMITTED_D]) {
      if (d.startsWith(pfx)) return isLeader || stewardOf(e.pubkey, d.slice(pfx.length));
    }
    // SAFEGUARDING lists (who's a child / cleared adult / guardian link) — OWNER-ONLY (church key), never a delegated steward
    for (const pfx of [MINORS_D, APPROVED_D, GUARDIANS_D]) {
      if (d.startsWith(pfx)) return CHURCH_PUBS.has(e.pubkey) && d.slice(pfx.length) === e.pubkey;
    }
    // a church->parent guardian-link NOTICE (d=guardnotice:<parentpub>). OWNER-signed only. NOT read-gated
    // (its content is encrypted to the parent) so the parent receives it WITHOUT auth — it's what prompts
    // them to authenticate for the gated guardians: map. Explicit rule = exempt from the per-member doc cap.
    if (d.startsWith(GUARDNOTICE_D)) return CHURCH_PUBS.has(e.pubkey);
    // FINANCE journal — single-writer, relay-ordered, APPEND-ONLY. The seq lives in the (unencrypted) d-tag so
    // the relay can order it without reading the (encrypted) entry; the church is named in a ["church",<cp>] tag.
    if (d.startsWith(FIN_JOURNAL_D)) {
      const cp = finCp(e);
      if (!cp || !(e.pubkey === cp || stewardOf(e.pubkey, cp))) return false;   // church key, or a steward of cp (treasurer)
      const seq = parseInt(d.slice(FIN_JOURNAL_D.length), 10);
      return Number.isInteger(seq) && seq === (FINANCE_SEQ.get(cp) || 0) + 1;   // exactly the next seq → rejects gaps, forks AND edits
    }
    if (d.startsWith('finance/')) {   // other finance docs (settings / accounts / funds) — role-gated, no seq
      const cp = finCp(e);
      return !!cp && (e.pubkey === cp || stewardOf(e.pubkey, cp));
    }
    // SECURITY-AUDIT-2026-07-06 M4: a giving fund carries the church's PAYMENT DESTINATION (lnaddr) — where
    // donations go. That is OWNER-ONLY: a delegated steward must not be able to create/replace a fund with
    // their own Lightning address and silently redirect members' gifts. Not in the steward-delegated set below.
    if (d.startsWith(FUND_D)) return isLeader;
    // church-authored CONTENT docs: a steward names the church via a ["church", <cp>] tag
    if (d.startsWith(GROUP_D) || d.startsWith(PLAN_D) || d.startsWith(DEVO_D) || d.startsWith(ROTA_D)
      || d.startsWith(ROSTER_D) || d.startsWith(SERVICE_D) || d.startsWith(REQUEST_D)
      || d.startsWith(ROOM_D) || d.startsWith(BOOKING_D) || d.startsWith(RUNSHEET_D)
      || d.startsWith(CATEGORY_D) || d.startsWith(PINSERMON_D)) return isLeader || stewardOf(e.pubkey, namedChurch(e));   // SECURITY-AUDIT-2026-06-24 M1: gate category writes
    if (d.startsWith(MEMBER_D) || d.startsWith(NETWORK_D)) return true;   // joining a church / a church joining a network
    if (d.startsWith(STEWARDREQ_D)) {                          // requesting to steward a church — capped (L1: anti-flood)
      if (isMember) return true;                               // a known member asking to help: always
      if (store.query({ kinds: [30078], authors: [e.pubkey], '#d': [d], limit: 1 }).length) return true;   // updating their own pending request
      // P5: bounded scan + early break — was an unbounded limit:1_000_000 fetch on every stranger request
      // (a cheap-request → full-table-scan amplifier). Mirror the M6 kind-0 fix: cap the rows and stop at the cap.
      let pend = 0;
      for (const x of store.query({ kinds: [30078], '#d': [d], limit: STEWARDREQ_CAP + MEMBERS.size + 8 })) { if (!MEMBERS.has(x.pubkey) && ++pend >= STEWARDREQ_CAP) break; }
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
    if (d.startsWith(AVAIL_D)) return isMember && !MINORS.has(e.pubkey);   // "I'm here to help": any non-minor member (keyed by own pubkey; minors excluded — being listed would invite contact from anyone in need)
    // M1: catch-all for a member's own addressable (MyData) docs with a novel d-tag. Addressable docs are never
    // culled, so cap distinct docs per author — a member can't disk-exhaust the relay by spamming unique d-tags.
    // Updating an existing d-tag is always fine; only a NEW one past the cap is refused.
    if (!isMember) return false;
    const mine = store.query({ kinds: [30078], authors: [e.pubkey], limit: MEMBER_DOC_CAP + 1 });
    if (mine.length > MEMBER_DOC_CAP && !mine.some(x => (x.tags.find(t => t[0] === 'd') || [])[1] === d)) return false;
    return true;
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
  if (k === 7) return isMember;                                // reactions
  if (k === 1059 || k === 1060) return false;                 // sealed/gift-wrapped DMs (NIP-17) are unused by this app; block them so they can't route around the kind-4 minor↔adult safeguarding gate. Re-enable with the same gate applied if NIP-17 is ever adopted.
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
    // the Care module — its CONFIG doc plus the needs / member fills / skips — is readable by the whole
    // church. Members MUST see that care is enabled (else the Care tab + banner never appear), who's
    // already helping, and each other's "what I'm bringing" notes — not just stewards. The settings doc
    // is steward/church-authored and the rest member-authored, so they'd otherwise fail the roster gate
    // below. Write access stays gated in accept(); the UI still applies the per-need visibility setting.
    if (d === MEALS_SETTINGS_D || d.startsWith(NEED_D) || d.startsWith(SLOT_D) || d.startsWith(SKIP_D) || d.startsWith(AVAIL_D)) return true;
    // safeguarding lists (minors/approved/guardians) are PII — which pubkeys are children. Members need them to
    // mirror the DM safeguarding gate on-device, but they must NOT be world-readable. Gate to authed members of
    // that church (lazy NIP-42: the REQ handler challenges when one is withheld, then AUTH-success re-delivers).
    if (d.startsWith(MINORS_D) || d.startsWith(APPROVED_D) || d.startsWith(GUARDIANS_D)) {
      const cp = d.startsWith(MINORS_D) ? d.slice(MINORS_D.length) : d.startsWith(APPROVED_D) ? d.slice(APPROVED_D.length) : d.slice(GUARDIANS_D.length);
      // SECURITY-AUDIT-2026-07-06 H1: gate to an EFFECTIVE member of THIS church — not the raw MEMBER_DOCS
      // join set, which still contains blocked + unapproved-pending pubkeys. Otherwise any stranger (even one
      // the church has BANNED) could self-join, AUTH with their own key, and read the plaintext list of which
      // members are children. Mirror rebuildMembers()'s per-church logic: joined ∧ not blocked ∧ (approved | not gated).
      const md = MEMBER_DOCS.get(cp);
      const gated = REQUIRE_APPROVAL.has(cp), admitted = ADMITTED_BY.get(cp);
      const effectiveMember = !!(md && md.has(authed)) && !BLOCKED.has(authed) && (!gated || !!(admitted && admitted.has(authed)));
      return !!authed && (CHURCH_PUBS.has(authed) || NETWORKS.has(authed) || stewardOf(authed, cp) || effectiveMember);
    }
    // FINANCE (books): the content is encrypted client-side (encPublish self-encrypts to the church key), so
    // the docs are ciphertext to everyone but the church. We do NOT gate reads behind NIP-42 auth — the pool
    // (steward console + member app) doesn't auth, so a read-gate would block the church from reading its OWN
    // books. Metadata-privacy via a proper NIP-42 auth handler is a queued follow-up (would also fix the
    // safeguarding-list read-gate the same way). Confidentiality here rests on the encryption, not the relay.
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
const MAX_PROXY_BYTES = 5 * 1024 * 1024;   // cap upstream reads — an attacker-supplied URL could otherwise stream GBs into RAM
const MAX_FEED_CACHE = 200;                // bound the proxy caches so distinct ?url= values can't grow them without limit
function boundCache(m) { if (m.size < MAX_FEED_CACHE) return; const now = Date.now(); for (const [k, v] of m) if (now - v.ts > FEED_TTL) m.delete(k); while (m.size >= MAX_FEED_CACHE) { const k = m.keys().next().value; if (k === undefined) break; m.delete(k); } }
async function readCapped(r, maxBytes) {
  const cl = Number(r.headers.get('content-length') || 0);
  if (cl && cl > maxBytes) throw new Error('response too large');
  if (!r.body) { const t = await r.text(); if (t.length > maxBytes) throw new Error('response too large'); return t; }
  const reader = r.body.getReader(); let total = 0; const chunks = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maxBytes) { try { await reader.cancel(); } catch {} throw new Error('response too large'); } chunks.push(Buffer.from(value)); }
  return Buffer.concat(chunks).toString('utf8');
}
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
    return readCapped(r, MAX_PROXY_BYTES);
  }
  throw new Error('too many redirects');
}
function _ytVideos(xml) {   // parse a YouTube RSS (channel OR playlist) into our video list
  const videos = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const vid = (e.match(/<yt:videoId>([^<]+)</) || [])[1]; if (!vid) continue;
    videos.push({ id: vid, ytId: vid, title: decodeXml((e.match(/<title>([^<]+)</) || [])[1] || ''), published: (e.match(/<published>([^<]+)</) || [])[1] || '', thumb: 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg' });
  }
  return videos;
}
async function resolveYouTube(input) {
  // FEDERATION Phase 5 Tier 1 — PLAYLIST support (incl. UNLISTED). YouTube's playlist RSS is keyed by
  // playlist_id, and an unlisted playlist is reachable BY ID — so a church can point at an unlisted playlist
  // (not publicly searchable / not on their channel) and its videos surface here, without any self-hosting.
  const playlistId = (input.match(/[?&]list=([\w-]+)/) || input.match(/^((?:PL|UU|OL|FL|RD|LL)[\w-]+)$/) || [])[1] || null;
  if (playlistId) {
    const xml = await fetchText('https://www.youtube.com/feeds/videos.xml?playlist_id=' + playlistId);
    return { channel: { name: decodeXml((xml.match(/<title>([^<]+)<\/title>/) || [])[1] || 'Playlist'), url: 'https://www.youtube.com/playlist?list=' + playlistId, platform: 'youtube', playlist: playlistId }, videos: _ytVideos(xml) };
  }
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
  return { channel: { name: chName, url: 'https://www.youtube.com/channel/' + channelId, platform: 'youtube' }, videos: _ytVideos(xml) };
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
  if (/youtu\.?be|youtube\.com/.test(url) || /^@[\w.\-]+$/.test(url) || /^UC[\w-]+$/.test(url) || /^(?:PL|UU|OL|FL|RD|LL)[\w-]+$/.test(url)) data = await resolveYouTube(url);   // Phase 5: bare channel OR playlist id
  else if (/rumble\.com/.test(url)) data = await resolveRumble(url);
  else data = { channel: { url, platform: 'link' }, videos: [] };
  boundCache(feedCache); feedCache.set(url, { ts: Date.now(), data });
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
  boundCache(audioCache); audioCache.set(url, { ts: Date.now(), data });
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
// D1: auto-detect a pre-transpiled build so the strict, eval-free CSP turns on with no per-operator env. A
// build is "strict" when its served index.html loads NO in-browser Babel. Read the shell for `text/babel`
// rather than probing for vendor/babel.min.js — the relay update extracts OVER existing files without pruning,
// so a stale babel.min.js can linger on disk after the switch and would wrongly force the lax CSP back on.
let _strictWeb = !!process.env.STRICT_CSP;
try { if (!_strictWeb) _strictWeb = !readFileSync(join(ROOT, 'index.html'), 'utf8').includes('type="text/babel"'); } catch {}
const CSP = [
  "default-src 'self'",
  _strictWeb ? "script-src 'self' 'wasm-unsafe-eval'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // SECURITY-AUDIT-2026-06-24 M11 followup: dropped the Google Fonts allowlist now that all marketing
  // HTML loads vendor/fonts/fonts.css locally. style-src 'unsafe-inline' stays for the marketing pages'
  // <style> blocks; font-src self covers the local woff2s.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // SECURITY-AUDIT-2026-07-06 M8: the profile-picture/accent/thumb url() BEACON vector is closed at the
  // SOURCE now (safeImgUrl/safeCssColor reject remote URLs before they reach CSS; v.thumb pinned to i.ytimg.com).
  // img-src MUST keep 'https:' because podcast/sermon artwork (<itunes:image>) is legitimately remote and
  // pulled un-proxied from the church's RSS feed (getAudioFeed) — tightening here would blank that artwork on
  // web. A future full lockdown needs the feed proxy to same-origin the images first.
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
let _nip05Map = { ts: 0, map: null };        // cached slug->pubkey for /.well-known/nostr.json (rebuilt ≤ every 30s) so hammering ?name= can't trigger a full kind-0 scan+parse per request (M5)
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
  if (st.missing || st.code === -1 || /not found|executable file not found|no such file|enoent/i.test(st.err)) return { installed: false };   // -1/ENOENT = spawn failed → tailscale not installed (e.g. desktop app)
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
      relayPub: RELAY_PUB,   // this relay's identity pubkey — a church authorises it as a trusted sync peer
      writePolicy: CHURCH_PUBS.size > 0,
      // church npubs/names are intentionally NOT exposed here (unauthenticated) — the dashboard reads
      // the list from the token-gated /config; /status carries only non-sensitive counts.
      counts: { churches: CHURCH_PUBS.size, members: MEMBERS.size, broadcastGroups: BROADCAST.size, events: store.count(), connections: wss ? wss.clients.size : 0 },
      serves: { app: SETTINGS.serveApp, modules: SETTINGS.serveModules, audio: SETTINGS.serveAudio },   // what this relay also hosts (toggleable in the control dashboard)
    }));
    return;
  }
  // Local-only admin-token disclosure. A request that GENUINELY originates on this machine is already inside
  // the trust boundary (it could just read relay/admin.json), so we hand it the token — letting the desktop
  // Relay app's own control panel (served on 127.0.0.1) authenticate itself with NO token-hunting on Mac/Win/
  // Linux alike. Safe against the "cloudflared proxies from 127.0.0.1" caveat (see adminOK note): a tunnelled
  // public request has an X-Forwarded-For header and a public Host — we require BOTH a real loopback socket AND
  // no proxy header AND a loopback Host, which only a direct same-machine request satisfies. No CORS header is
  // sent, so a cross-origin page in a local browser can't read the response either (only the relay's own UI can).
  if (route === '/local-token') {
    const ra = (req.socket && req.socket.remoteAddress) || '';
    const loopbackSock = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
    const proxied = req.headers['x-forwarded-for'] != null || req.headers['forwarded'] != null;
    const hostname = String(req.headers['host'] || '').replace(/^\[|\]$/g, '').split(':')[0].toLowerCase();
    const loopbackHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS };   // deliberately NO Access-Control-Allow-Origin
    if (loopbackSock && !proxied && loopbackHost) { res.writeHead(200, H); res.end(JSON.stringify({ token: ADMIN_TOKEN })); return; }
    res.writeHead(403, H); res.end('{"error":"not a local request"}'); return;
  }
  // Relay name directory — resolve a handle (public) or claim one (relay-key-signed). See _verifyRelayClaim.
  if (route.startsWith('/relay-names/')) {
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', ...SEC_HEADERS };
    if (req.method === 'OPTIONS') { res.writeHead(204, H); res.end(); return; }
    // THIS relay claims / reports its own name (control panel). Admin-gated. The relay signs the claim with its
    // identity key and registers it with the directory (using its own public wss address).
    if (route === '/relay-names/mine') {
      if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
      const ownUrl = async () => { if (cfPublicWss()) return cfPublicWss(); let st = {}; try { st = await tsState(); } catch {} return (process.env.RELAY_PUBLIC_URL || st.relayWss || '').trim(); };
      if (req.method === 'GET') {
        ownUrl().then(u => { res.writeHead(200, H); res.end(JSON.stringify({ handle: MY_RELAY_NAME, relayWss: u, pub: RELAY_PUB, directory: DIRECTORY })); });
        return;
      }
      if (req.method === 'POST') {
        let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
        req.on('end', async () => {
          let bd; try { bd = JSON.parse(body); } catch { res.writeHead(400, H); res.end('{"error":"bad json"}'); return; }
          const handle = String(bd.handle || '').toLowerCase().trim();
          if (!_handleRe.test(handle)) { res.writeHead(400, H); res.end('{"error":"name must be 3–32 chars: lowercase letters, numbers, hyphens"}'); return; }
          const myUrl = await ownUrl();
          if (!myUrl) { res.writeHead(400, H); res.end('{"error":"your relay isn’t reachable from the internet yet — turn on public access first, then claim a name"}'); return; }
          try {
            const r = await fetch(DIRECTORY + '/relay-names/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': relayNameClaim(handle, myUrl) }, body: JSON.stringify({ handle, url: myUrl }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { res.writeHead(r.status, H); res.end(JSON.stringify({ error: j.error || 'the directory rejected that name' })); return; }
            MY_RELAY_NAME = handle; try { writeFileSync(MYNAME_FILE, JSON.stringify({ handle }) + '\n'); } catch {}
            res.writeHead(200, H); res.end(JSON.stringify({ ok: true, handle, url: myUrl, directory: DIRECTORY }));
          } catch (e) { res.writeHead(502, H); res.end(JSON.stringify({ error: 'could not reach the name directory (' + DIRECTORY + ')' })); }
        });
        return;
      }
      res.writeHead(405, H); res.end('{"error":"method"}'); return;
    }
    if (req.method === 'GET' && route.startsWith('/relay-names/resolve/')) {
      const handle = decodeURIComponent(route.slice('/relay-names/resolve/'.length)).toLowerCase();
      const rec = RELAY_NAMES[handle];
      if (!rec) { res.writeHead(404, H); res.end('{"error":"no relay by that name"}'); return; }
      res.writeHead(200, H); res.end(JSON.stringify({ handle, url: rec.url, pub: rec.pub })); return;
    }
    if (req.method === 'POST' && route === '/relay-names/claim') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        let b; try { b = JSON.parse(body); } catch { res.writeHead(400, H); res.end('{"error":"bad json"}'); return; }
        const handle = String(b.handle || '').toLowerCase().trim();
        const url = String(b.url || '').trim();
        if (!_handleRe.test(handle)) { res.writeHead(400, H); res.end('{"error":"name must be 3–32 chars: lowercase letters, numbers, hyphens"}'); return; }
        if (!/^wss?:\/\/.+/i.test(url)) { res.writeHead(400, H); res.end('{"error":"url must be a ws:// or wss:// relay address"}'); return; }
        const pub = _verifyRelayClaim(req, handle, url);
        if (!pub) { res.writeHead(401, H); res.end('{"error":"claim must be signed by the relay identity key, binding this handle + url, within 2 min"}'); return; }
        const existing = RELAY_NAMES[handle];
        if (existing && existing.pub !== pub) { res.writeHead(409, H); res.end('{"error":"that name is already taken by another relay"}'); return; }
        for (const k of Object.keys(RELAY_NAMES)) { if (RELAY_NAMES[k].pub === pub && k !== handle) delete RELAY_NAMES[k]; }   // one handle per relay: release any previous
        RELAY_NAMES[handle] = { url, pub, at: Math.floor(Date.now() / 1000) };
        saveRelayNames();
        res.writeHead(200, H); res.end(JSON.stringify({ ok: true, handle, url, pub }));
      });
      return;
    }
    res.writeHead(404, H); res.end('{"error":"not found"}'); return;
  }
  // Cloudflare quick-tunnel control (desktop "go public", no account). Admin-gated.
  if (route === '/tunnel/up' || route === '/tunnel/state' || route === '/tunnel/down') {
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', ...SEC_HEADERS };
    if (req.method === 'OPTIONS') { res.writeHead(204, H); res.end(); return; }
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    if (route === '/tunnel/state' && req.method === 'GET') { res.writeHead(200, H); res.end(JSON.stringify({ running: !!CF_CHILD, url: CF_URL, wss: cfPublicWss() })); return; }
    if (route === '/tunnel/log' && req.method === 'GET') { res.writeHead(200, H); res.end(JSON.stringify({ tail: CF_TAIL.slice(-14) })); return; }
    if (route === '/tunnel/up' && req.method === 'POST') { startCloudflared().then(r => { res.writeHead(r.ok ? 200 : 502, H); res.end(JSON.stringify(r.ok ? { ok: true, url: CF_URL, wss: cfPublicWss(), name: MY_RELAY_NAME } : { error: r.error })); }); return; }
    if (route === '/tunnel/down' && req.method === 'POST') { try { if (CF_CHILD) CF_CHILD.kill(); } catch {} CF_CHILD = null; CF_URL = ''; try { unlinkSync(TUNNEL_FLAG); } catch {} res.writeHead(200, H); res.end('{"ok":true}'); return; }
    res.writeHead(405, H); res.end('{"error":"method"}'); return;
  }
  // church-data backup: stream every event this relay holds for the caller's church as JSONL (a self-verifying,
  // importAll()-restorable archive). NIP-98-authed to the church key or a steward of that church.
  if (route === '/export') {
    const cp = _exportAuth(req, req.headers['host'] || '', route);
    if (!cp) { res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('unauthorized: needs a fresh NIP-98 proof signed by the church key or a steward, bound to this URL'); return; }
    const events = store.exportChurch(cp);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="trinityone-church-backup.jsonl"', 'Cache-Control': 'no-store', ...SEC_HEADERS });
    res.write(JSON.stringify({ _manifest: { format: 'trinityone-church-backup', version: 1, church: cp, exportedAt: Math.floor(Date.now() / 1000), events: events.length, relay: ORIGIN } }) + '\n');
    for (const e of events) res.write(JSON.stringify(e) + '\n');
    res.end();
    return;
  }
  // backup media manifest: the sha256 + size of every blob this relay holds for the caller's church, so the
  // steward can pull them into a COMPLETE archive (events + media) client-side. Same NIP-98 gate as /export;
  // the bytes themselves come from GET /blob/<sha> (the church key passes _blobMember for its own blobs).
  if (route === '/export-media') {
    const cp = _exportAuth(req, req.headers['host'] || '', route);
    if (!cp) { res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('unauthorized'); return; }
    const blobs = [];
    try { for (const f of readdirSync(BLOB_DIR)) { if (!/^[0-9a-f]{64}$/.test(f)) continue; if (_blobOwner(f) !== cp) continue; let size = 0; try { size = statSync(join(BLOB_DIR, f)).size; } catch { continue; } blobs.push({ sha: f, size }); } } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS });
    res.end(JSON.stringify({ church: cp, blobs, totalBytes: blobs.reduce((a, b) => a + b.size, 0) }));
    return;
  }
  // relay resync (pull side): stream this church's events at/after ?since to a TRUSTED peer relay (or the church
  // key / steward). Because a trusted relay re-enforces the read-gate for its own members, serving the FULL corpus
  // — including safeguarding-gated cleartext — is safe. The peer imports + advances its cursor. See syncAllChurches().
  if (route === '/sync' && req.method === 'GET') {
    const cp = _syncAuth(req, req.headers['host'] || '', '/sync');
    const q = new URL(req.url, 'http://x').searchParams;
    if (!cp || q.get('church') !== cp) { res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('unauthorized'); return; }
    const since = parseInt(q.get('since') || '0', 10) || 0;
    const events = store.exportChurchSince(cp, since);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS });
    for (const e of events) res.write(JSON.stringify(e) + '\n');
    res.end();
    return;
  }
  // "Force sync now" from the control dashboard (admin-token gated): pull every church's trusted peers immediately.
  if (route === '/sync-now' && req.method === 'POST') {
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    runSync().then((n) => { res.writeHead(200, H); res.end(JSON.stringify({ ok: true, imported: n })); }).catch(() => { res.writeHead(500, H); res.end('{"error":"sync failed"}'); });
    return;
  }
  // resync media (manifest): the sha256 + size of every blob this relay holds for a church, to a TRUSTED peer
  // relay — it compares against its own and pulls only what it's missing (below). Same trust gate as /sync.
  if (route === '/sync-media' && req.method === 'GET') {
    const cp = _syncAuth(req, req.headers['host'] || '', '/sync-media');
    const q = new URL(req.url, 'http://x').searchParams;
    if (!cp || q.get('church') !== cp) { res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('unauthorized'); return; }
    const blobs = [];
    try { for (const f of readdirSync(BLOB_DIR)) { if (!/^[0-9a-f]{64}$/.test(f)) continue; if (_blobOwner(f) !== cp) continue; let size = 0; try { size = statSync(join(BLOB_DIR, f)).size; } catch { continue; } blobs.push({ sha: f, size }); } } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS });
    res.end(JSON.stringify({ church: cp, blobs }));
    return;
  }
  // resync media (bytes): stream one blob to a trusted peer relay — only if the blob belongs to the authed church.
  if (route.startsWith('/sync-blob/') && req.method === 'GET') {
    const sha = route.slice('/sync-blob/'.length).toLowerCase();
    const cp = _syncAuth(req, req.headers['host'] || '', route);
    const q = new URL(req.url, 'http://x').searchParams;
    if (!cp || q.get('church') !== cp || !/^[0-9a-f]{64}$/.test(sha) || _blobOwner(sha) !== cp) { res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('unauthorized'); return; }
    let data; try { data = readFileSync(join(BLOB_DIR, sha)); } catch { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store', ...SEC_HEADERS });
    res.end(data);
    return;
  }
  // negentropy resync (digest): per-bucket fingerprints of the church's event set, so a trusted peer can see which
  // buckets differ without pulling anything (finds old gaps a forward cursor misses). Same trust gate as /sync.
  if (route === '/sync-digest' && req.method === 'GET') {
    const cp = _syncAuth(req, req.headers['host'] || '', '/sync-digest');
    const q = new URL(req.url, 'http://x').searchParams;
    if (!cp || q.get('church') !== cp) { res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('unauthorized'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS });
    res.end(JSON.stringify({ church: cp, buckets: _bucketDigest(cp) }));
    return;
  }
  // negentropy resync (ids): the church's event IDs in ONE bucket — fetched only for buckets whose fingerprint differs.
  if (route === '/sync-ids' && req.method === 'GET') {
    const cp = _syncAuth(req, req.headers['host'] || '', '/sync-ids');
    const q = new URL(req.url, 'http://x').searchParams;
    const bucket = (q.get('bucket') || '').toLowerCase();
    if (!cp || q.get('church') !== cp || !/^[0-9a-f]{2}$/.test(bucket)) { res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('unauthorized'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS });
    res.end(JSON.stringify({ church: cp, bucket, ids: store.churchEventIds(cp).filter((id) => id.slice(0, 2) === bucket) }));
    return;
  }
  // negentropy resync (events): the raw events for the IDs a peer found it's missing (POSTed id list, bounded).
  if (route === '/sync-events' && req.method === 'POST') {
    const cp = _syncAuth(req, req.headers['host'] || '', '/sync-events');
    if (!cp) { res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('unauthorized'); return; }
    const chunks = []; let n = 0, big = false;
    req.on('data', (c) => { if (big) return; n += c.length; if (n > 4 * 1024 * 1024) { big = true; try { res.writeHead(413, { 'Cache-Control': 'no-store' }); res.end('too many ids'); } catch {} req.destroy(); return; } chunks.push(c); });
    req.on('end', () => {
      if (big) return;
      let ids = []; try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (Array.isArray(b.ids)) ids = b.ids.filter((x) => /^[0-9a-f]{64}$/.test(x)).slice(0, 5000); } catch {}
      const events = store.syncEventsByIds(cp, ids);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS });
      for (const e of events) res.write(JSON.stringify(e) + '\n');
      res.end();
    });
    return;
  }
  // RESTORE / CLONE (the import engine): take a church's backup (decrypted JSONL of signed events, streamed by the
  // client) and import it — bootstrapping a fresh relay or repopulating one after loss. NIP-98-authed to the church
  // key (which may also REGISTER a not-yet-known church here — same trust as self-registration) or a steward of an
  // already-known church. Every event is signature-verified before it's stored, so a compromised file can't inject
  // forgeries; the church key vouches for attributing them to cp. Media blobs restore separately via PUT /blob.
  if (route === '/import' && req.method === 'POST') {
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const cp = _exportAuth(req, req.headers['host'] || '', route);
    if (!cp) { res.writeHead(401, H); res.end('{"error":"unauthorized: a fresh NIP-98 proof by the church key (or a steward) bound to /import"}'); return; }
    const chunks = []; let n = 0, tooBig = false;
    req.on('data', (c) => { if (tooBig) return; n += c.length; if (n > MAX_IMPORT) { tooBig = true; try { res.writeHead(413, H); res.end('{"error":"import too large"}'); } catch {} req.destroy(); return; } chunks.push(c); });   // respond BEFORE destroy — destroy skips 'end', so a deferred 413 would hang the request (→ 502)
    req.on('end', () => {
      try {
        if (tooBig) return;   // 413 already sent in the data handler
        const fresh = !CHURCH_PUBS.has(cp);
        if (fresh) { addChurch(cp); persistChurches(); }   // clone onto a new relay: the church key registers its own church
        let imported = 0, duplicates = 0, invalid = 0;
        for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
          const s = line.trim(); if (!s) continue;
          let e; try { e = JSON.parse(s); } catch { invalid++; continue; }
          if (e && e._manifest) continue;                            // the archive's manifest header line
          let ok = false; try { ok = !!(e && e.id && e.sig && verifyEvent(e)); } catch { ok = false; }   // verifyEvent can THROW on malformed input — one bad line must never kill the whole import (→ hang → 502)
          if (!ok) { invalid++; continue; }
          try {
            const r = store.put(e, cp);                              // attribute to the authed church
            if (r === 'stored') { imported++; if (e.kind === 5) for (const t of e.tags) { if (t[0] === 'e' && t[1] && store.authorOf(t[1]) === e.pubkey) store.del(t[1]); } }   // apply deletions so a deleted message doesn't resurrect on restore
            else duplicates++;
          } catch { invalid++; }
        }
        // respond BEFORE the heavy re-scan so a slow hydrate can't time the request out at the proxy (→ 502)
        res.writeHead(200, H); res.end(JSON.stringify({ ok: true, church: cp, registered: fresh, imported, duplicates, invalid }));
        setImmediate(() => { try { hydrateMaps(); } catch {} try { store.cull(); } catch {} });   // membership/groups/care live once this settles
      } catch (err) { try { res.writeHead(500, H); res.end(JSON.stringify({ error: 'import failed: ' + ((err && err.message) || 'error') })); } catch {} }
    });
    return;
  }
  // NIP-11 relay information document (FEDERATION-PLAN Phase 1a). Served only to clients that ASK for
  // it (Accept: application/nostr+json) on the relay path, so normal browser GETs are unaffected. The
  // `trinityone` block is the capability signal a federating client checks BEFORE routing any gated
  // content here (risk #1: a generic relay enforces none of our membership/safeguarding policy). This
  // only ADVERTISES what the relay already does — it changes no read/write behaviour.
  if (route === '/relay' && /application\/nostr\+json/i.test(req.headers['accept'] || '')) {
    res.writeHead(200, { 'Content-Type': 'application/nostr+json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...SEC_HEADERS });
    res.end(JSON.stringify({
      name: 'TrinityOne relay',
      description: 'A TrinityOne church relay: membership-gated writes, safeguarding auth-gating (NIP-42), multi-church.',
      software: 'https://github.com/TrinityOneAdmin/TrinityOne',
      version: BUILD.short,
      supported_nips: [1, 42],
      limitation: { restricted_writes: true, max_message_length: 1024 * 1024 },
      trinityone: {
        enforces: true, multiChurch: true,   // enforces = this relay applies TrinityOne's write/safeguard policy
        media: !MEDIA_OFF,                    // does this relay host self-hosted media (blobs)? — the client hides the upload UI when false
        // OFFER fields (Phase 3a) appear ONLY when the operator opted in via RELAY_OPEN — a private relay omits
        // them entirely, so discovery/auto-pick never surfaces it. `full` lets a busy relay decline new churches
        // without going offline. `churches` is a load hint (already exposed unauthenticated in /status counts).
        ...(OFFER_OPEN ? {
          open: !(OFFER_CAP && CHURCH_PUBS.size >= OFFER_CAP),
          full: !!(OFFER_CAP && CHURCH_PUBS.size >= OFFER_CAP),
          churches: CHURCH_PUBS.size,
          ...(MEDIA_CAP ? { mediaCap: MEDIA_CAP, mediaUsed: _mediaBytesTotal } : {}),   // capacity hint for church discovery / auto-pick
          ...(CHURCH_MEDIA_CAP ? { churchMediaCap: CHURCH_MEDIA_CAP } : {}),
          ...(OFFER_OPERATOR ? { operator: OFFER_OPERATOR } : {}),
          ...(OFFER_REGION ? { region: OFFER_REGION } : {}),
        } : {}),
      },
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
              let uOk = false;
              try { const uu = new URL(String(uTag)); uOk = /\/config\/?$/.test(uu.pathname) && uu.host === (req.headers.host || '').split(',')[0].trim(); } catch {}   // L1: bind the proof to THIS relay's host + path (not just any /config) — anti-replay across relays
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
    if (req.method === 'GET') { res.writeHead(200, H); res.end(JSON.stringify({ ok: true, settings: SETTINGS, mediaUsed: _mediaBytesTotal, mediaEnv: { cap: MEDIA_CAP, churchCap: CHURCH_MEDIA_CAP } })); return; }
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        try {
          const s = JSON.parse(body || '{}');
          if ('serveApp' in s) SETTINGS.serveApp = !!s.serveApp;
          if ('serveModules' in s) SETTINGS.serveModules = !!s.serveModules;
          if ('serveAudio' in s) SETTINGS.serveAudio = !!s.serveAudio;
          if ('appUrl' in s) SETTINGS.appUrl = String(s.appUrl || '').slice(0, 200);
          if ('mediaCap' in s) SETTINGS.mediaCap = Math.max(0, parseInt(s.mediaCap, 10) || 0);
          if ('churchCap' in s) SETTINGS.churchCap = Math.max(0, parseInt(s.churchCap, 10) || 0);
          saveSettings();
          res.writeHead(200, H); res.end(JSON.stringify({ ok: true, settings: SETTINGS }));
        } catch (e) { res.writeHead(400, H); res.end(JSON.stringify({ error: String((e && e.message) || 'bad request') })); }
      });
      return;
    }
    res.writeHead(405, H); res.end('{"error":"method"}'); return;
  }
  // Suite desktop-app update check: compare THIS build's sha (version.txt, stamped at build) against the latest
  // published suite-latest.json on GitHub Releases. Fetched server-side so the launcher avoids a cross-origin CORS
  // fetch. Returns updateAvailable + the download page; the app can't self-install (it's an installer), so this
  // just surfaces "a new version is out — download it".
  if (route === '/suite-update' && req.method === 'GET') {
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...SEC_HEADERS };
    (async () => {
      let latest = null;
      try { const r = await fetch('https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download/suite-latest.json', { cache: 'no-store', signal: AbortSignal.timeout(6000) }); if (r.ok) latest = await r.json(); } catch {}
      const cur = BUILD.sha, ls = (latest && latest.sha) || '';
      res.writeHead(200, H); res.end(JSON.stringify({ current: cur, currentShort: BUILD.short, latest: ls, latestShort: ls.slice(0, 7), updateAvailable: !!(ls && cur && ls !== cur), url: 'https://github.com/TrinityOneAdmin/TrinityOne/releases/latest' }));
    })();
    return;
  }
  // relay self-update: POST drops a flag in relay/ (the only path the sandboxed relay can write); a root
  // systemd path-unit watches it and runs scripts/relay-update.sh (pull bundle, swap code, restart).
  if (route === '/update') {
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...CORS };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...SEC_HEADERS, ...CORS }); res.end(); return; }
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    let pending = false; try { statSync(UPDATE_FLAG); pending = true; } catch {}
    if (req.method === 'GET') {
      // Check the update source SERVER-SIDE (this box → origin), not in the operator's browser. The browser
      // often can't reach the release host's ts.net funnel (Tailscale MagicDNS hijacks the name to a private
      // address, or the network blocks ts.net), even though this server can. Best-effort, short timeout.
      (async () => {
        let latest = null;
        if (ORIGIN) {
          try {
            const r = await fetch(ORIGIN.replace(/\/+$/, '') + '/status', { cache: 'no-store', signal: AbortSignal.timeout(6000) });
            const s = await r.json();
            if (s && s.version) latest = { version: s.version, versionShort: s.versionShort, builtAt: s.builtAt };
          } catch {}
        }
        res.writeHead(200, H); res.end(JSON.stringify({ ok: true, version: BUILD.sha, versionShort: BUILD.short, builtAt: BUILD.date, origin: ORIGIN, pending, latest }));
      })();
      return;
    }
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
    const apkDir = join(DATA_DIR,'apks');
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
  // FEDERATION Phase 5 Tier 2 — self-hosted media blobs (Blossom-style, content-addressed).
  // CORS preflight: uploads mirror to a BACKUP host (different origin) and members fetch from it, so the
  // Authorization header requires an OPTIONS preflight that permits cross-origin PUT/GET.
  if ((route === '/blob' || route.startsWith('/blob/')) && req.method === 'OPTIONS') {
    const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, POST, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges' };
    if (req.headers['access-control-request-private-network']) h['Access-Control-Allow-Private-Network'] = 'true';   // permit a backup host on a more-private network (PNA)
    res.writeHead(204, h); res.end(); return;
  }
  // Upload: PUT /blob (church/steward-signed kind-24242). Download: GET /blob/<sha256> (member-gated NIP-98).
  if (route === '/blob' && (req.method === 'PUT' || req.method === 'POST')) {
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (MEDIA_OFF) { res.writeHead(403, H); res.end('{"error":"this relay hosts no media (relay-only)"}'); return; }   // operator disabled media
    const who = _blobUploader(req);
    if (!who) { res.writeHead(401, H); res.end('{"error":"unauthorized: sign a kind-24242 upload auth with the church (or steward) key"}'); return; }
    const chunks = []; let n = 0, tooBig = false;
    req.on('data', (c) => { n += c.length; if (n > MAX_BLOB) { tooBig = true; req.destroy(); return; } chunks.push(c); });
    req.on('end', () => {
      if (tooBig) { res.writeHead(413, H); res.end('{"error":"blob too large"}'); return; }
      let data = Buffer.concat(chunks);
      // native clients send base64 text (CapacitorHttp mangles a raw binary body) — decode back to the real bytes
      if (req.headers['x-blob-b64']) { try { data = Buffer.from(data.toString('latin1'), 'base64'); } catch { data = Buffer.alloc(0); } }
      if (!data.length) { res.writeHead(400, H); res.end('{"error":"empty"}'); return; }
      const sha = createHash('sha256').update(data).digest('hex');
      if (who.want && who.want !== sha) { res.writeHead(400, H); res.end('{"error":"hash mismatch (x tag != blob sha256)"}'); return; }
      const isNew = !existsSync(join(BLOB_DIR, sha));   // content-addressed: a re-upload of an existing blob adds no new bytes (don't re-charge quota)
      if (isNew) {
        const _mc = effMediaCap(), _cc = effChurchCap();
        if (_mc && _mediaBytesTotal + data.length > _mc) { res.writeHead(507, H); res.end('{"error":"this relay\'s media storage is full"}'); return; }
        if (_cc && (_mediaBytesByChurch.get(who.church) || 0) + data.length > _cc) { res.writeHead(507, H); res.end('{"error":"your church has reached its media storage limit on this relay"}'); return; }
      }
      try {
        const tmp = join(BLOB_DIR, sha + '.tmp'); writeFileSync(tmp, data);
        writeFileSync(join(BLOB_DIR, sha + '.church'), who.church);   // S4: write the owner sidecar BEFORE the blob is reachable — a failed sidecar must never leave a blob servable with no download gate (fail-open)
        renameSync(tmp, join(BLOB_DIR, sha));                          // now publish the blob into place (its gate already exists)
        const ct = req.headers['content-type'] || ''; if (ct && ct.indexOf('text/plain') !== 0) { try { writeFileSync(join(BLOB_DIR, sha + '.type'), ct); } catch {} }
      } catch (e) { res.writeHead(500, H); res.end('{"error":"store failed"}'); return; }
      if (isNew) { _mediaBytesTotal += data.length; _mediaBytesByChurch.set(who.church, (_mediaBytesByChurch.get(who.church) || 0) + data.length); }   // account the new bytes
      res.writeHead(201, H); res.end(JSON.stringify({ sha256: sha, size: data.length, url: '/blob/' + sha, type: req.headers['content-type'] || 'application/octet-stream' }));
    });
    req.on('error', () => { try { res.writeHead(400, H); res.end('{"error":"read"}'); } catch {} });
    return;
  }
  if (route.startsWith('/blob/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const sha = route.slice('/blob/'.length).toLowerCase();
    if (!_blobRe.test(sha)) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); res.end('bad hash'); return; }
    const file = join(BLOB_DIR, sha); let st; try { st = statSync(file); } catch { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('not found'); return; }
    const host = (req.headers.host || '').split(',')[0].trim();
    if (!_blobMember(req, _blobOwner(sha), host, route)) { res.writeHead(401, { 'Access-Control-Allow-Origin': '*', 'WWW-Authenticate': 'Nostr' }); res.end('members only'); return; }
    let ct = 'application/octet-stream'; try { ct = readFileSync(join(BLOB_DIR, sha + '.type'), 'utf8').trim() || ct; } catch {}
    const base = { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable', ...SEC_HEADERS };   // content-addressed → immutable
    if (/[?&]b64/.test(req.url || '')) {   // native download: CapacitorHttp mangles a binary response body → serve base64 text, the client decodes
      if (req.method === 'HEAD') { res.writeHead(200, { ...base, 'Content-Type': 'text/plain; charset=ascii', 'X-Blob-B64': '1' }); res.end(); return; }
      try { const s = readFileSync(file).toString('base64'); res.writeHead(200, { ...base, 'Content-Type': 'text/plain; charset=ascii', 'Content-Length': Buffer.byteLength(s), 'X-Blob-B64': '1' }); res.end(s); } catch { res.writeHead(500, base); res.end(); }
      return;
    }
    const range = req.headers['range'] && /bytes=(\d*)-(\d*)/.exec(req.headers['range']);   // seek support for audio/video
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : 0; const end = range[2] ? parseInt(range[2], 10) : st.size - 1;
      if (start > end || end >= st.size) { res.writeHead(416, base); res.end(); return; }
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(file, { start, end }).pipe(res); return;
    }
    res.writeHead(200, { ...base, 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res); return;
  }
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
    // Resolve from a cached slug->pubkey map (rebuilt ≤ every 30s). Same precedence as before — church profiles
    // outrank members, earliest wins among a tier — but the expensive kind-0 scan+parse now runs at most twice a
    // minute regardless of request rate, so this endpoint can't be used as an unauthenticated CPU amplifier (M5).
    if (!_nip05Map.map || Date.now() - _nip05Map.ts > 30000) {
      const k0 = store.query({ kinds: [0], limit: 1000000 }).sort((a, b) => (CHURCH_PUBS.has(b.pubkey) - CHURCH_PUBS.has(a.pubkey)) || ((a.created_at || 0) - (b.created_at || 0)));
      const map = new Map();
      for (const e of k0) {
        if (BLOCKED.has(e.pubkey)) continue;
        let meta = {}; try { meta = JSON.parse(e.content); } catch {}
        const local = (meta.nip05 && String(meta.nip05).includes('@')) ? slug(String(meta.nip05).split('@')[0]) : slug(meta.name);
        if (local && !map.has(local)) map.set(local, e.pubkey);
      }
      _nip05Map = { ts: Date.now(), map };
    }
    const pub = _nip05Map.map.get(qName);
    if (pub) { res.writeHead(200, H); res.end(JSON.stringify({ names: { [qName]: pub }, relays: relayUrl ? { [pub]: [relayUrl] } : {} })); return; }
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
    p += (p === '/' && host === marketingHost) ? 'welcome-simple.html' : 'index.html';
  }
  // APKs deployed via the dashboard "Fetch latest APK" button live under relay/apks/ (writable, survives
  // self-updates). Serve from there if present; a root-level copy (manual scp) still works as a fallback.
  if (/^\/(trinityone|trinityone-steward)\.apk$/.test(p)) {
    const relApk = join(DATA_DIR,'apks', p.slice(1));
    let st2 = null; try { st2 = statSync(relApk); } catch {}
    if (st2 && st2.isFile()) {
      let ver = ''; try { ver = (JSON.parse(readFileSync(join(ROOT, 'apk-latest.json'), 'utf8')).versionName || '').trim(); } catch {}
      const apkName = p.slice(1).replace('.apk', '') + (ver ? '-' + ver : '') + '.apk';   // versioned save name (e.g. trinityone-0.9.26.apk) so downloads self-label — no ambiguous trinityone(1).apk
      res.writeHead(200, { 'Content-Type': MIME['.apk'] || 'application/octet-stream', 'Content-Length': st2.size, 'Cache-Control': 'no-store, must-revalidate', 'Access-Control-Allow-Origin': '*', 'Content-Disposition': 'attachment; filename="' + apkName + '"', ...SEC_HEADERS });
      createReadStream(relApk).pipe(res); return;
    }
  }
  // feature gates: the relay always serves its own control UI (/relay-app/*); module downloads + the web-app
  // mirror are switchable by the operator (the relay can be relay-only, or also host modules and/or the app).
  if (p.startsWith('/modules/')) { if (!SETTINGS.serveModules) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('module hosting is off on this relay'); return; } }
  else if (!p.startsWith('/relay-app/') && !SETTINGS.serveApp) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('the web app is not served from this relay'); return; }
  // SECURITY (audit 2026-07-06, found live-exposed): never serve private subtrees or dotfiles even though
  // they sit inside ROOT. relay/ holds runtime secrets (admin token, VAPID private key, church.json, the
  // WHOLE event DB relay.sqlite); android/ios hold signing material; node_modules is bulk; dotfiles cover
  // .git/.github/.claude/.env. The traversal guard below only stops ESCAPING ROOT — these are inside it.
  // The web app + control UI stay reachable: 'relay-app' is a distinct path segment from 'relay', and the
  // APK/module handlers ran above. 404 (not 403) so the endpoint doesn't confirm a file exists.
  if (p.split('/').some(s => s === 'relay' || s === 'android' || s === 'ios' || s === 'node_modules' || (s && s[0] === '.'))) { res.writeHead(404).end('not found'); return; }
  let file = normalize(join(ROOT, p));
  // path-traversal guard: the resolved path must stay strictly inside ROOT. Normalize ROOT's trailing
  // separator first (it may already carry one), so the boundary is exactly `<root>/` — a sibling like
  // `<root>-evil` can't satisfy it, and the trailing-slash double-up doesn't reject valid files.
  const rootBase = ROOT.replace(/[/\\]+$/, '');
  if (file !== rootBase && !file.startsWith(rootBase + sep)) { res.writeHead(403).end('forbidden'); return; }
  let st; try { st = statSync(file); } catch {
    // extensionless clean URLs (e.g. the church join link /join → join.html) serve a .html sibling before 404-ing
    if (!extname(p) && p !== '/') { try { const alt = file + '.html'; const ast = statSync(alt); if (ast.isFile()) { file = alt; st = ast; } } catch {} }
    if (!st) { res.writeHead(404).end('not found'); return; }
  }
  if (st.isDirectory()) { res.writeHead(404).end('not found'); return; }
  const ext = extname(file).toLowerCase();
  // HTML: rewrite our OWN local asset URLs to carry the build sha (?v=<sha>) so a deploy is NEVER served
  // stale by a CDN — each release changes the URL, forcing a fresh fetch. HTML itself isn't CDN-cached, so the
  // fresh HTML always points at the new URLs (this is what actually defeats a Cloudflare edge cache that
  // ignores our no-cache header). External (http/data) srcs are left untouched.
  if (ext === '.html') {
    let html; try { html = readFileSync(file, 'utf8'); } catch { res.writeHead(404).end('not found'); return; }
    const v = (BUILD && BUILD.short) || '0';
    html = html.replace(/\b(src|href)="([^"]+\.(?:m?js|jsx|css))"/g, (m, attr, url) => (/^(https?:|\/\/|data:)/i.test(url) || url.includes('?')) ? m : attr + '="' + url + '?v=' + v + '"');
    const body = Buffer.from(html);
    res.writeHead(200, { 'Content-Type': MIME['.html'] || 'text/html', 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache', ...SEC_HEADERS });
    res.end(body); return;
  }
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Access-Control-Allow-Origin': '*', ...SEC_HEADERS };
  // app assets change every release — revalidate (belt-and-braces with the ?v= cache-bust above).
  if (['.js', '.mjs', '.jsx', '.css', '.json'].includes(ext)) headers['Cache-Control'] = 'no-cache';
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
let _putsSinceCull = 0;   // E6: cull runs every 256 stored events (or startup), not on every single one
// rebuild member/broadcast/care state from the structured (kind-30078) docs, oldest-first as before
hydrateMaps();
// now that group→church / member→church maps are built, attribute any events stored without a church
// (migrated chat, or pre-map writes) so per-church retention buckets them correctly
if (CHURCH_PUBS.size) { const r = store.reattribute(resolveChurch); if (r) console.log(`[relay] attributed ${r} events to a church (per-church retention)`); }

// ── relay resync (pull-since-cursor): converge each church with the trusted peer relays it authorised ──────────
// Pull a peer's /sync for a church since our cursor, verify + store new events (dedup by ID for free), apply kind-5
// deletions (or a deleted message resurrects), advance the cursor. Idempotent + resumable; overlap window catches
// out-of-order arrivals. Because IDs are content hashes, arrival order is irrelevant — the set converges.
async function syncChurchFromPeer(cp, peerBase) {
  const key = cp + '@' + peerBase;
  const since = Math.max(0, (SYNC_CURSORS[key] || 0) - SYNC_OVERLAP);
  const url = peerBase + '/sync?church=' + encodeURIComponent(cp) + '&since=' + since;
  let body;
  try { const r = await fetch(url, { headers: { Authorization: relayProof(url, 'GET', cp) } }); if (!r.ok) return { ok: false, status: r.status }; body = await readCapped(r, MAX_IMPORT); }
  catch { return { ok: false }; }
  let maxTs = SYNC_CURSORS[key] || 0, imported = 0;
  for (const line of body.split('\n')) {
    const s = line.trim(); if (!s) continue;
    let e; try { e = JSON.parse(s); } catch { continue; }
    if (!e || !e.id || !e.sig || !verifyEvent(e)) continue;   // integrity: never store an unverifiable event
    const put = store.put(e, cp);
    if (put === 'stored') { imported++; note(e); if (e.kind === 5) for (const t of e.tags) { if (t[0] === 'e' && t[1] && store.authorOf(t[1]) === e.pubkey) store.del(t[1]); } }   // apply deletions, as the live path does
    if ((e.created_at || 0) > maxTs) maxTs = e.created_at || 0;
  }
  SYNC_CURSORS[key] = maxTs; try { writeFileSync(SYNC_CURSOR_FILE, JSON.stringify(SYNC_CURSORS)); } catch {}
  return { ok: true, imported };
}
// negentropy set reconciliation: partition a church's event IDs into buckets by ID prefix (256 buckets) and
// fingerprint each — sha256 of the sorted IDs (first 16 bytes) + count. Two relays compare digests; only buckets
// whose fingerprints DIFFER need their ID lists exchanged, so we find EVERY difference (including old gaps a
// forward-only cursor never backfills) while transferring almost nothing when already in sync. sha256-of-the-
// exact-set (not an XOR/sum) can't silently collide. Deterministic — both sides bucket identically.
function _bucketDigest(cp) {
  const buckets = {};
  for (const id of store.churchEventIds(cp)) { if (!/^[0-9a-f]{64}$/.test(id)) continue; const b = id.slice(0, 2); (buckets[b] || (buckets[b] = [])).push(id); }
  const out = {};
  for (const b in buckets) { const ids = buckets[b].sort(); out[b] = { fp: createHash('sha256').update(ids.join('')).digest('hex').slice(0, 32), n: ids.length }; }
  return out;
}
// negentropy pull: compare our digest with a peer's; for each differing bucket, fetch the peer's IDs, diff against
// ours, and pull only the events we're missing. Runs ALONGSIDE the v1 cursor pull (kept as a correctness backstop).
async function reconcileChurchWithPeer(cp, peerBase) {
  const digUrl = peerBase + '/sync-digest?church=' + encodeURIComponent(cp);
  let peerBuckets; try { const r = await fetch(digUrl, { headers: { Authorization: relayProof(digUrl, 'GET', cp) } }); if (!r.ok) return 0; peerBuckets = (await r.json()).buckets || {}; } catch { return 0; }
  const mine = _bucketDigest(cp), missing = [];
  for (const b in peerBuckets) {
    if (mine[b] && mine[b].fp === peerBuckets[b].fp) continue;   // bucket identical on both sides -> nothing to do
    const idsUrl = peerBase + '/sync-ids?church=' + encodeURIComponent(cp) + '&bucket=' + b;
    let peerIds; try { const r = await fetch(idsUrl, { headers: { Authorization: relayProof(idsUrl, 'GET', cp) } }); if (!r.ok) continue; peerIds = (await r.json()).ids || []; } catch { continue; }
    const have = new Set(store.churchEventIds(cp).filter((id) => id.slice(0, 2) === b));
    for (const id of peerIds) if (/^[0-9a-f]{64}$/.test(id) && !have.has(id)) missing.push(id);
  }
  if (!missing.length) return 0;
  let imported = 0;
  for (let i = 0; i < missing.length; i += 1000) {   // pull the missing events in bounded batches
    const evUrl = peerBase + '/sync-events';
    let body; try { const r = await fetch(evUrl, { method: 'POST', headers: { Authorization: relayProof(evUrl, 'POST', cp), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: missing.slice(i, i + 1000) }) }); if (!r.ok) continue; body = await readCapped(r, MAX_IMPORT); } catch { continue; }
    for (const line of body.split('\n')) { const s = line.trim(); if (!s) continue; let e; try { e = JSON.parse(s); } catch { continue; } if (!e || !e.id || !e.sig) continue; let ok = false; try { ok = verifyEvent(e); } catch { ok = false; } if (!ok) continue; if (store.put(e, cp) === 'stored') { imported++; note(e); if (e.kind === 5) for (const t of e.tags) { if (t[0] === 'e' && t[1] && store.authorOf(t[1]) === e.pubkey) store.del(t[1]); } } }
  }
  return imported;
}
// resync media: pull blobs this church holds on a peer that we don't have yet. Content-addressed, so it's
// self-verifying (the sha must match) and idempotent. Runs AFTER the event sync, skipped if this relay hosts no
// media, and respects the relay's media caps. A distinct, paced pass — media is the heavy part of a sync.
async function syncMediaFromPeer(cp, peerBase) {
  if (MEDIA_OFF) return 0;
  const manUrl = peerBase + '/sync-media?church=' + encodeURIComponent(cp);
  let man; try { const r = await fetch(manUrl, { headers: { Authorization: relayProof(manUrl, 'GET', cp) } }); if (!r.ok) return 0; man = await r.json(); } catch { return 0; }
  let pulled = 0;
  for (const b of (man && man.blobs) || []) {
    if (!b || !/^[0-9a-f]{64}$/.test(b.sha) || existsSync(join(BLOB_DIR, b.sha))) continue;   // already have it (or junk)
    if (MEDIA_CAP && _mediaBytesTotal + (b.size || 0) > MEDIA_CAP) break;                       // this relay's media is full
    if (CHURCH_MEDIA_CAP && (_mediaBytesByChurch.get(cp) || 0) + (b.size || 0) > CHURCH_MEDIA_CAP) break;
    const blobUrl = peerBase + '/sync-blob/' + b.sha + '?church=' + encodeURIComponent(cp);
    try {
      const r = await fetch(blobUrl, { headers: { Authorization: relayProof(blobUrl, 'GET', cp) } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (createHash('sha256').update(buf).digest('hex') !== b.sha) continue;   // content-addressed integrity check
      writeFileSync(join(BLOB_DIR, b.sha + '.church'), cp);                      // sidecar BEFORE the blob (S4: never servable with no owner)
      writeFileSync(join(BLOB_DIR, b.sha), buf);
      _mediaBytesTotal += buf.length; _mediaBytesByChurch.set(cp, (_mediaBytesByChurch.get(cp) || 0) + buf.length);
      pulled++;
    } catch {}
  }
  return pulled;
}
async function syncAllChurches() {
  if (!CHURCH_PUBS.size) return 0;
  let self = ''; try { self = ORIGIN ? new URL(ORIGIN).host : ''; } catch {}
  let total = 0;
  for (const cp of CHURCH_PUBS) {
    const peers = PEER_URLS.get(cp); if (!peers || !peers.size) continue;
    for (const peer of peers) {
      const base = String(peer).replace(/^ws/i, 'http').replace(/\/+$/, '');
      try { if (self && new URL(base).host === self) continue; } catch { continue; }   // never sync from self
      try { const r = await syncChurchFromPeer(cp, base); if (r.ok && r.imported) { total += r.imported; console.log(`[sync] +${r.imported} from ${base} for church ${cp.slice(0, 8)}`); } } catch {}
      try { const g = await reconcileChurchWithPeer(cp, base); if (g) { total += g; console.log(`[sync] +${g} via reconcile from ${base} for church ${cp.slice(0, 8)}`); } } catch {}   // negentropy: backfill any old gaps the cursor missed
      try { const m = await syncMediaFromPeer(cp, base); if (m) console.log(`[sync] +${m} media from ${base} for church ${cp.slice(0, 8)}`); } catch {}   // paced media pass
    }
  }
  return total;
}
let _syncing = false;
async function runSync() { if (_syncing) return 0; _syncing = true; try { return await syncAllChurches(); } finally { _syncing = false; } }
function scheduleSync() { const ms = (300 + Math.floor(Math.random() * 120)) * 1000; setTimeout(() => { runSync().finally(scheduleSync); }, ms); }   // ~5–7 min, jittered
if (process.env.RELAY_SYNC !== '0') setTimeout(() => { runSync().finally(scheduleSync); }, 20000);   // first pass ~20s after boot (let it settle)
function scheduleSave() {}   // no-op: SQLite persists synchronously (WAL); kept so existing call sites are harmless
// matchFilter is imported from event-store.mjs (single source of truth, also used by the SQL read path)
const matchAny = (evt, filters) => filters.some(f => matchFilter(evt, f));
const subs = new Map();   // ws -> Map(subId -> filters[])

const server = createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024,   // 1 MB cap (default is 100 MB — memory-DoS guard)
  // permessage-deflate: ~70% off wire bytes for members on a thin pipe. Negotiated per-connection (clients that
  // don't support it just skip it). No-context-takeover keeps per-connection memory bounded for many members.
  perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 10 } });
const MAX_SUBS_PER_CONN = 256;  // headroom: a real client opens many subs (members, chat, profiles, etc.)
const MAX_FILTERS_PER_REQ = 32; // a single REQ carrying thousands of filters is a cheap unauthenticated CPU-DoS — cap it
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
      // was this pubkey ALREADY a known member of the church it's posting to? MEMBER_DOCS is rebuilt from stored
      // docs, so this survives relay restarts — a boot re-announce won't re-alert the steward. Captured before note().
      const _mdD = (evt.tags.find(t => t[0] === 'd') || [])[1] || '';
      const wasMember = _mdD.startsWith(MEMBER_D) && (MEMBER_DOCS.get(_mdD.slice(MEMBER_D.length)) || new Set()).has(evt.pubkey);
      note(evt);   // a membership/broadcast change takes effect for subsequent events
      // durable store handles replaceable dedup + smart retention (structure kept, oldest ephemeral culled).
      // 'have-newer' / 'duplicate' → acknowledge but don't re-broadcast.
      const putRes = store.put(evt, resolveChurch(evt));
      if (putRes === 'have-newer') { ws.send(JSON.stringify(['OK', evt.id, true, 'have newer'])); return; }
      if (putRes === 'duplicate') { ws.send(JSON.stringify(['OK', evt.id, true, 'duplicate'])); return; }
      if (++_putsSinceCull >= 256) { _putsSinceCull = 0; store.cull(); }   // E6: throttle the GROUP BY cull off the per-event hot path (was every stored event)
      // NIP-09: a kind-5 deletes the AUTHOR'S OWN referenced events only — authorOf() gates it to self, so a
      // member can retract their message but never delete someone else's. The kind-5 also broadcasts below, so
      // connected clients drop the message live; store.del makes it stay gone on reload/backfill.
      if (evt.kind === 5) for (const t of evt.tags) { if (t[0] === 'e' && t[1] && store.authorOf(t[1]) === evt.pubkey) store.del(t[1]); }
      maybePush(evt);   // notify the targeted member if this is a serving request
      maybePushJoin(evt, wasMember);   // notify the steward's phone if this is a fresh church join
      maybePushMessage(evt);   // notify on a new DM (recipient) or church announcement (members)
      ws.send(JSON.stringify(['OK', evt.id, true, '']));
      let _evtJson = null;   // E6: serialize the event ONCE (lazily, on first match) and reuse for every matching subscriber — was N JSON.stringify(evt) for N subs
      for (const [client, m] of subs) { if (client.readyState !== 1) continue;
        for (const [subId, filters] of m) if (matchAny(evt, filters) && canRead(evt, client._auth)) { if (_evtJson === null) _evtJson = JSON.stringify(evt); client.send('["EVENT",' + JSON.stringify(subId) + ',' + _evtJson + ']'); } }
    } else if (type === 'REQ') {
      const subId = rest[0];
      let filters = rest.slice(1);
      if (filters.length === 1 && Array.isArray(filters[0])) filters = filters[0];
      if (filters.length > MAX_FILTERS_PER_REQ) { ws.send(JSON.stringify(['CLOSED', subId, 'invalid: too many filters'])); return; }
      const mysubs = subs.get(ws);
      if (!mysubs.has(subId) && mysubs.size >= MAX_SUBS_PER_CONN) { ws.send(JSON.stringify(['CLOSED', subId, 'rate-limited: too many subscriptions'])); return; }
      mysubs.set(subId, filters);
      // serve everything this connection may read now (blocked members withheld; invite-only group
      // messages withheld from non-members per NIP-42)
      let matched = []; const _seen = new Set(); let wantsSafeguard = false;
      for (const f of filters) for (const e of store.query(f)) { if (_seen.has(e.id)) continue; _seen.add(e.id); if (BLOCKED.has(e.pubkey)) continue; if (!canRead(e, ws._auth)) { if (!ws._auth && e.kind === 30078) { const dd = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (dd.startsWith(MINORS_D) || dd.startsWith(APPROVED_D) || dd.startsWith(GUARDIANS_D)) wantsSafeguard = true; } continue; } matched.push(e); }
      matched.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));   // oldest→newest, matching the previous array delivery order
      // LAZY NIP-42: challenge ONLY when the REQ explicitly targets an invite-only group (a #t for an
      // invite group id). A broad query (e.g. #p:church) that merely happens to match an invite message
      // is NOT challenged — those messages are just silently withheld — so ordinary reads pay no auth cost.
      const wantsInvite = !ws._auth && filters.some(f => (f['#t'] || []).some(t => GROUP_VIS.get(t) === 'invite'));
      if (wantsInvite || wantsSafeguard) { try { ws.send(JSON.stringify(['AUTH', ws._challenge])); } catch {} }   // safeguarding: challenge so a member's client auths + gets the lists (AUTH-success re-delivers)
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
        if (evt && evt.kind === 22242 && ch === ws._challenge && fresh && verifyEvent(evt) && !BLOCKED.has(evt.pubkey)) {
          // SECURITY-AUDIT-2026-07-06 H1: a BLOCKED pubkey must never satisfy a read gate — refuse to authenticate it.
          ws._auth = evt.pubkey; ws.send(JSON.stringify(['OK', evt.id, true, '']));
          // now authed: replay everything the open subs were waiting on that the connection can NOW read
          // but could NOT while unauthed — invite-only group messages AND the safeguarding lists (minors/
          // approved/guardians). SECURITY-AUDIT-2026-07-06 H1: the old gate re-sent ONLY invite-group kind-1,
          // so a legitimately-authed member never received the safeguarding docs (the mirror silently
          // degraded). Re-send anything withheld-when-unauthed (`!canRead(e,null)`) — public events already
          // went out at REQ time, so `canRead(e,null)===true` skips them and no duplicate is sent.
          const mine = subs.get(ws);
          if (mine) for (const [subId, filters] of mine) {
            const seen = new Set();
            for (const f of filters) for (const e of store.query(f)) {
              if (seen.has(e.id)) continue; seen.add(e.id);
              if (BLOCKED.has(e.pubkey) || !canRead(e, ws._auth)) continue;
              if (!canRead(e, null)) ws.send(JSON.stringify(['EVENT', subId, e]));
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
const BIND_HOST = process.env.RELAY_HOST || '0.0.0.0';   // desktop app sets 127.0.0.1 (loopback → no Windows firewall prompt); servers keep 0.0.0.0
server.listen(PORT, BIND_HOST, () =>
  console.log(`TrinityOne gateway on http://${BIND_HOST}:${PORT}  (app + relay at /relay, ${store.count()} events loaded)` +
    (CHURCH_PUBS.size ? `\n  write policy ON — ${CHURCH_PUBS.size} church(es), ${MEMBERS.size} members, ${BROADCAST.size} broadcast group(s)` : `\n  write policy OFF (open relay — set up a church in the control dashboard)`) +
    `\n  setup / control:  http://localhost:${PORT}/relay-app/control.html` +
    `\n  admin token (needed to configure from another device): ${ADMIN_TOKEN}`));
// "Stay public": if the operator turned on the tunnel before, re-open it on boot (a fresh quick-tunnel URL) and
// re-point the relay's directory name at it — so a restart doesn't silently drop members' access.
if (existsSync(TUNNEL_FLAG)) { setTimeout(() => { startCloudflared().then(r => console.log(r.ok ? `  tunnel re-opened: ${r.url}` : `  tunnel re-open failed: ${r.error || ''}`)).catch(() => {}); }, 2500); }
