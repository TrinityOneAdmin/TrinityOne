// gateway.mjs -- TrinityOne unified self-host gateway.
// ONE node process, ONE port: serves the static web app AND the Nostr relay (at /relay), so the
// whole thing needs exactly ONE public tunnel and the app derives its relay from its own origin
// (ws[s]://<host>/relay). This is the engine the church Relay app wraps. NIP-01 + disk persistence.
//
//   node scripts/gateway.mjs [port]        default port 8090
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, appendFileSync, renameSync, statSync, lstatSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, unlinkSync, rmSync, statfsSync } from 'fs';
import { Transform } from 'stream';
import { gzipSync } from 'node:zlib';
import { extname, normalize, join, sep } from 'path';
import { fileURLToPath } from 'url';
import { lookup as dnsLookup } from 'dns/promises';
import { decode as nip19decode, npubEncode } from 'nostr-tools/nip19';
import { openStore, matchFilter } from './event-store.mjs';
// The names this relay gates by, from the ONE declared list (ARCHITECTURE-AUDIT-2026-07-30, rec 2's deferred
// half). These 50 strings used to be typed out below; a typo was not a build error but a document gated under
// one name and published under another, failing silently. D.* is checked against the registry at module load,
// so an undeclared name throws before this relay serves a request. POLICY stays in accept()/canRead().
import { D } from './trinity-doc-types.mjs';   // durable event storage (node:sqlite) + the canonical read predicate
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
// A staged restore must contain NO symlinks: a symlink named e.g. `relay.sqlite` would let the store, once it's
// swapped in, write THROUGH the link to an arbitrary path (an arbitrary-file-write primitive). Reject the whole
// restore if any entry (at any depth) is a symlink. (tar as a non-root user already blocks `..` traversal and
// device nodes; this closes the remaining symlink vector.)
function stagingHasSymlink(p) {
  let st; try { st = lstatSync(p); } catch { return false; }
  if (st.isSymbolicLink()) return true;
  if (st.isDirectory()) { for (const c of readdirSync(p)) if (stagingHasSymlink(join(p, c))) return true; }
  return false;
}
// Restore-on-boot: /relay-restore stages an uploaded backup under .restore-pending/. Apply it BEFORE anything
// reads the data dir (the DB, keys, church.json all load at module init below), then clear the staging. This is
// how "restore this relay / move it to a new machine" takes effect — the operator restarts and the box comes up
// as the backed-up relay. Runs first so a half-applied restore can't leave a mixed old/new data dir.
(function applyPendingRestore() {
  const staging = join(DATA_DIR, '.restore-pending');
  if (!existsSync(staging)) return;
  try {
    if (stagingHasSymlink(staging)) { console.error('  restore-on-boot REFUSED: backup contains a symlink'); rmSync(staging, { recursive: true, force: true }); return; }
    for (const name of readdirSync(staging)) {
      const dst = join(DATA_DIR, name);
      try { rmSync(dst, { recursive: true, force: true }); } catch {}
      renameSync(join(staging, name), dst);
    }
    console.log('  restored relay data from a backup (.restore-pending applied)');
  } catch (e) { console.error('  restore-on-boot failed:', (e && e.message) || e); }
  try { rmSync(staging, { recursive: true, force: true }); } catch {}
})();
const PORT = Number(process.argv[2] || process.env.PORT || 8090);
const DB = process.env.RELAY_DB || join(DATA_DIR,'relay-db.json');                 // legacy JSON store (migrated from, once)
// SHA-256 of the release signing certificate (android/app/keystore.properties -> release.keystore, alias
// trinityone). Public by design — see /.well-known/assetlinks.json below. Override per-deployment if a church
// ships its own signed build.
const ANDROID_CERT_SHA256 = process.env.ANDROID_CERT_SHA256 || '9A:51:21:F0:9D:60:6B:83:E7:0F:19:22:06:CD:C6:17:05:2A:49:41:79:97:B8:24:C6:BB:97:97:AD:8C:A6:00';
const SQLITE_DB = process.env.RELAY_SQLITE || join(DATA_DIR,'relay.sqlite');       // durable event store
const MAX_EVENTS = parseInt(process.env.RELAY_MAX_EVENTS, 10) || 20000;   // ephemeral budget; raise on a shared/public relay
// Set when the store refuses a write, cleared when one succeeds. /status reports ok:false while it is set, so
// an ordinary health check catches a relay that is up, listening, and losing everything it is sent.
let STORE_DEGRADED = null;
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
// C3: ONE cap for how many churches a relay holds, used by BOTH the dashboard's full-replace save and
// the self-registration path. They used to be 50 and 200 — so self-registration could reach a state the
// dashboard could not save without silently deleting 150 congregations.
const CHURCH_REPLACE_CAP = 200;
const MEMBER_DOC_CAP = 500;         // M1: cap distinct addressable (30078) docs per member — one member can't disk-exhaust the relay with novel d-tags
// relay feature toggles — what this box serves besides the Nostr relay itself (owner request). Defaults
// preserve current behaviour (all on); edited via the token-gated /settings endpoint + the control dashboard.
const SETTINGS_FILE = join(DATA_DIR,'relay-settings.json');
// mediaCap/churchCap: operator storage limits in BYTES (0 = unlimited), settable from the control panel — for a
// public relay hosting several churches. The effective cap is the setting if non-zero, else the env fallback.
const SETTINGS = { serveApp: true, serveModules: true, serveAudio: true, appUrl: '', mediaCap: 0, churchCap: 0, inviteOnly: false, offerHosting: false, mediaRequiresHost: false, lanAccess: false };
function loadSettings() {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    if (s && typeof s === 'object') {
      SETTINGS.serveApp = s.serveApp !== false; SETTINGS.serveModules = s.serveModules !== false;
      SETTINGS.serveAudio = s.serveAudio !== false; SETTINGS.appUrl = typeof s.appUrl === 'string' ? s.appUrl.slice(0, 200) : '';
      SETTINGS.mediaCap = Math.max(0, parseInt(s.mediaCap, 10) || 0); SETTINGS.churchCap = Math.max(0, parseInt(s.churchCap, 10) || 0);
      SETTINGS.inviteOnly = s.inviteOnly === true;
      SETTINGS.offerHosting = s.offerHosting === true;
      SETTINGS.mediaRequiresHost = s.mediaRequiresHost === true;
      // Desktop app only: may devices on this wifi reach the relay directly? OFF by default. The desktop
      // launcher reads the `lan-access` marker below at start-up to decide RELAY_HOST, so a change needs a
      // restart — the control panel says so. AUDIT-2026-07-27: the launcher used to leave RELAY_HOST unset,
      // so it silently took the server default of 0.0.0.0 while two comments claimed it bound loopback.
      SETTINGS.lanAccess = s.lanAccess === true;
    }
  } catch {}
}
// Media-hosting policy for a SHARED/community relay: sermon media (audio/video, or any large blob) may only be
// uploaded by a church GRANTED media hosting here (MEDIA_HOSTS — a self-hoster, or one the operator vouches for).
// A church can be provisioned for conversations + text resources (those are Nostr events, never blobs, so this
// never touches them) WITHOUT the media grant — it just can't host sermons, and is told to run its own relay.
// OFF by default (RELAY_MEDIA_REQUIRES_HOST, or the console setting) so a private single-church relay is
// unaffected; flip it on for the community relay (and grant media to the churches that self-host).
const MEDIA_HOST_ENV = /^(1|true|yes|on)$/i.test(process.env.RELAY_MEDIA_REQUIRES_HOST || '');
const mediaRequiresHost = () => SETTINGS.mediaRequiresHost === true || MEDIA_HOST_ENV;
const GUEST_ASSET_MAX = 4 * 1048576;   // a guest church may still upload a small NON-sermon asset (e.g. an image) up to this — the size backstop catches a big blob mislabeled to dodge the audio/video check
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
// P7b: in-memory blob index (church -> Map<sha,size>), so /sync-media + /replication-status don't do a
// readdir + readFileSync(.church) + statSync per blob on every request. Built by the same boot scan below,
// then kept live on upload + media-sync pull (blobs are never pruned, so the index only grows). _indexBlob()
// records one blob everywhere; call it whenever a blob lands on disk with a known owner.
const _blobsByChurch = new Map();   // cp -> Map<sha, size>
function _indexBlob(cp, sha, size) { if (!cp) return; let m = _blobsByChurch.get(cp); if (!m) { m = new Map(); _blobsByChurch.set(cp, m); } m.set(sha, size); }
function _churchBlobList(cp) { const m = _blobsByChurch.get(cp); if (!m) return []; const out = []; for (const [sha, size] of m) out.push({ sha, size }); return out; }
// P7: tally media usage AFTER the relay starts listening (was a synchronous statSync-per-blob walk blocking boot
// on a media-heavy box). SET the totals from the disk scan (authoritative) rather than accumulate, so any upload
// that lands during the brief window isn't double-counted — the scan already sees it on disk.
setTimeout(() => { try { let total = 0; const by = new Map(); const idx = new Map(); for (const f of readdirSync(BLOB_DIR)) { if (f.endsWith('.tmp')) { try { unlinkSync(join(BLOB_DIR, f)); } catch {} continue; }   /* orphaned upload/replication temp: at boot none is in flight, so any *.tmp is dead — sweep it */ if (!/^[0-9a-f]{64}$/.test(f)) continue; let sz; try { sz = statSync(join(BLOB_DIR, f)).size; } catch { continue; } total += sz; const o = _blobOwner(f); if (o) { by.set(o, (by.get(o) || 0) + sz); let m = idx.get(o); if (!m) { m = new Map(); idx.set(o, m); } m.set(f, sz); } } _mediaBytesTotal = total; _mediaBytesByChurch.clear(); for (const [k, v] of by) _mediaBytesByChurch.set(k, v); _blobsByChurch.clear(); for (const [k, v] of idx) _blobsByChurch.set(k, v); } catch {} }, 0);
// Streaming base64 for the native (CapacitorHttp) blob path — encode/decode in aligned chunks so a big blob never
// sits fully in RAM (a 200 MB video buffered + base64'd would cost ~450 MB). Each whole 3-byte group → 4 b64 chars
// independently, so concatenating the chunks equals base64(file); only the final partial group is padded. Decode
// strips whitespace and aligns to 4 chars. base64 length of N bytes = ceil(N/3)*4.
class B64Encode extends Transform {
  constructor() { super(); this._rem = null; }
  _transform(chunk, _e, cb) { const buf = this._rem ? Buffer.concat([this._rem, chunk]) : chunk; const usable = buf.length - (buf.length % 3); if (usable > 0) this.push(buf.subarray(0, usable).toString('base64')); this._rem = usable < buf.length ? Buffer.from(buf.subarray(usable)) : null; cb(); }
  _flush(cb) { if (this._rem && this._rem.length) this.push(this._rem.toString('base64')); cb(); }
}
class B64Decode extends Transform {
  constructor() { super(); this._rem = ''; }
  _transform(chunk, _e, cb) { const s = this._rem + chunk.toString('latin1').replace(/\s+/g, ''); const usable = s.length - (s.length % 4); if (usable > 0) this.push(Buffer.from(s.slice(0, usable), 'base64')); this._rem = s.slice(usable); cb(); }
  _flush(cb) { if (this._rem) this.push(Buffer.from(this._rem, 'base64')); cb(); }
}
// blob auth: a signed, time-bounded kind-24242 event by the CHURCH key, or a steward of a named church.
// action defaults to 'upload'; pass 'delete' for the DELETE route (same signer classes).
function _blobUploader(req, action) {
  const m = /^Nostr\s+(.+)$/i.exec(req.headers['authorization'] || ''); if (!m) return null;
  let ev; try { ev = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return null; }
  if (!ev || ev.kind !== 24242 || !verifyEvent(ev)) return null;
  const tag = (k) => (ev.tags.find(t => t[0] === k) || [])[1];
  if (tag('t') !== (action || 'upload')) return null;
  const exp = parseInt(tag('expiration') || '0', 10); if (!exp || exp < Math.floor(Date.now() / 1000)) return null;   // must expire (anti-replay)
  const cp = tag('church');
  if (cp && stewardOf(ev.pubkey, cp)) return { church: cp, want: (tag('x') || '').toLowerCase() };
  if (CHURCH_PUBS.has(ev.pubkey)) return { church: ev.pubkey, want: (tag('x') || '').toLowerCase() };
  return null;
}
// download gate: a fresh NIP-98 (kind 27235) proof, bound to THIS url, signed by a member of the owning church.
function _blobMember(req, ownerCp, host, path) {
  if (!CHURCH_PUBS.size) return true;   // unconfigured relay → open (nothing to gate against yet)
  if (!ownerCp) return false;           // configured relay but this blob has no recorded owner → fail CLOSED (don't world-serve media on a missing/legacy sidecar); backfill the sidecar to restore access
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
  // Key the cache by the RELEASE REF's commit — so a new commit on that ref auto-invalidates the cache and the
  // next pull rebuilds (no manual `rm relay/.bundle-cache/*`), while an unrelated branch checked out here does
  // NOT become a release.
  //
  // RELEASE-2026-07-20 C1 (CRITICAL): this used to resolve the live `git rev-parse HEAD`. Whatever commit this
  // box happened to have checked out when a relay clicked "Update now" was tarred, signed with the real release
  // key, and installed fleet-wide — no branch check, no ancestry check, and `relay-update.sh` verifies only the
  // signature and the commit DATE. That is exactly how a8 came to run 8086caa, a WIP commit from the parked
  // push branch that predates every 2026-07-20 security fix, with no way for the operator to tell. Worse, the
  // date-only anti-rollback means a parked branch whose HEAD is newer than main can make it IMPOSSIBLE to
  // update to main: the relay refuses it as a downgrade and reports nothing.
  // Override with RELEASE_REF only when you genuinely mean to ship something else (e.g. a release-* tag).
  const RELEASE_REF = process.env.RELEASE_REF || 'main';
  let sha = null;
  try { const g = spawnSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', RELEASE_REF + '^{commit}'], { encoding: 'utf8' }); if (g.status === 0 && g.stdout && g.stdout.trim()) sha = g.stdout.trim(); } catch {}
  if (!sha) {
    // No release ref (a self-host clone with no `main`, a detached CI checkout). Fall back to the sha stamped
    // into version.txt by git-archive — never to a live HEAD, which is the failure mode above.
    sha = BUILD.sha && !BUILD.sha.startsWith('$Format') ? BUILD.sha : null;
    if (!sha) { console.error('[relay] no release ref (' + RELEASE_REF + ') and no stamped build sha — refusing to serve a bundle'); return null; }
  }
  const tgz = join(BUNDLE_CACHE_DIR, sha + '.tgz');
  const sig = join(BUNDLE_CACHE_DIR, sha + '.tgz.sig');
  if (existsSync(tgz)) return { tgz, sig: existsSync(sig) ? sig : null, sha };
  if (!existsSync(RELEASE_KEY)) return null;   // not a release host — no signed bundle to serve
  try {
    mkdirSync(BUNDLE_CACHE_DIR, { recursive: true });
    const tmp = tgz + '.tmp.' + process.pid;
    // C1: DEFAULT to the PRE-TRANSPILED (Babel-free) web bundle — it halves the first-load payload every
    // self-host serves (654 kB gz vs 1339 kB; ~1.7 min vs 3.6 min on 2G) AND lets the strict, eval-free CSP
    // turn on. The JSX→JS transpile needs esbuild, which the release host has (devDep) but a8/self-hosts don't,
    // so it happens HERE and the plain-JS result ships inside the signed bundle (D1). Opt out with
    // STRICT_WEB_BUNDLE=0. Falls back to a plain `git archive` if esbuild is absent or the strict build fails,
    // so a bundle is always produced (and, if raw, the gateway auto-detects it and keeps the lax CSP).
    const strictWanted = process.env.STRICT_WEB_BUNDLE !== '0' && existsSync(join(ROOT, 'node_modules', '.bin', 'esbuild'));
    let strictOK = false;
    if (strictWanted) {
      const bs = spawnSync('bash', [join(ROOT, 'scripts', 'build-strict-tgz.sh'), tmp, sha], { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'ignore', 'inherit'] });   // C1: build the RELEASE ref's commit, not the checkout
      strictOK = bs.status === 0 && existsSync(tmp);
    }
    if (!strictOK) {
      // SILENT-DOWNGRADE GUARD: if we WANTED the strict build but it failed, the fallback ships the raw Babel bundle,
      // which flips every self-host's CSP back to lax (unsafe-eval) with no other signal. Make it LOUD so a release
      // isn't cut with a silently-degraded security posture (the sha-frozen bundle would carry it fleet-wide).
      if (strictWanted) console.error('\n[31m✗✗ STRICT WEB BUNDLE FAILED — falling back to the RAW Babel bundle. Served CSP will be LAX (unsafe-eval) for every relay pulling this bundle. Fix build-strict-tgz.sh + clear relay/.bundle-cache before releasing.[0m\n');
      const ar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar.gz', sha], { maxBuffer: 512 * 1024 * 1024 });   // C1: the release ref's commit, never the checkout
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
const GROUP_D = D.GROUP, FUND_D = D.FUND, MEMBER_D = D.MEMBER, PLAN_D = D.PLAN, DEVO_D = D.DEVO, ROTA_D = D.ROTA;
const CATEGORY_D = D.CATEGORY;   // steward-editable named container for groups (SECURITY-AUDIT-2026-06-24 M1)
const ROSTER_D = D.ROSTER, SERVICE_D = D.SERVICE, EVENT_D = D.EVENT, REQUEST_D = D.REQUEST;
const FIN_JOURNAL_D = D.FIN_JOURNAL;   // church-book double-entry journal entry — d=finance/journal:<seq>, ["church",<cp>], single-writer & append-only
const ROOM_D = D.ROOM, BOOKING_D = D.BOOKING;   // shared room calendar (church-only writes)
const RUNSHEET_D = D.RUNSHEET;   // a service's order-of-service + song setlist — d=runsheet:<serviceId> (church/steward)
const RELAYS_D = D.RELAYS;   // the church's trusted-relays list (resync): d=trinityone/relays, church-signed, content=[{pubkey,url}]
const NETWORK_D = D.NETWORK;   // the church declares it belongs to a network (the network's pubkey)
const BLOCKED_D = D.BLOCKED;   // a church's blocklist (banned member pubkeys) — d=blocked:<churchpub>
const PIN_D = D.PIN;           // a group's pinned message — d=pin:<groupId> (one per group)
const PINSERMON_D = D.PINSERMON; // the church's currently-featured/pinned sermon — d=pinsermon:<churchpub> (one per church) → member Today card + notification
const HIDE_D = D.HIDE;       // a removed/hidden message — d=hidden:<msgId> (one per message)
const MINORS_D = D.MINORS;     // safeguarding: a church's list of minor (child) pubkeys — d=minors:<churchpub>
const APPROVED_D = D.APPROVED; // safeguarding: adults cleared to contact youth (mirrors the church's DBS/cleared list) — d=approved:<churchpub>
// SAFEGUARDING v3 (AUDIT-2026-07-27): a member's OWN clearance, NIP-44 sealed to them — d=clearance:<memberpub>,
// church-tagged. It exists so a member can learn whether THEY are a minor / cleared without the church having to
// publish a cleartext list of its children to every member. The relay still reads minors:/approved:/guardians:
// itself to enforce safeguarding; what changed is that ordinary members can no longer READ the minors list.
const CLEARANCE_D = D.CLEARANCE;
const GUARDIANS_D = D.GUARDIANS; // safeguarding v2: church-signed child→parents map — d=guardians:<churchpub>; a guardian may always DM their own child
const GUARDNOTICE_D = D.GUARDNOTICE; // safeguarding v2: church->parent notice of a steward-made guardian link — d=guardnotice:<parentpub>, p-tagged + NIP-44-encrypted to the parent (child link never in cleartext)
// member-authored replies to church content — the member signs them and ['p']-tags the church
const RSVP_D = D.RSVP;           // a member's RSVP to an event — d=rsvp:<eventId>
const REQREPLY_D = D.REQREPLY;   // a member's accept/decline/swap on a serving request — d=reqreply:<requestId>
const UNAVAIL_D = D.UNAVAIL;     // a member's unavailable dates for the rota — d=unavail:<memberpub>
// CONGREGATION NAME KEY (2026-07-27). A member's display name is the thing that turns a pubkey into a person,
// and it was published in the clear — so a mirror operator, and the relay itself, held a named roster. The
// church now mints a key, wraps a copy for each member (exactly like carekey:/mediakey:), and members publish
// their name for that church encrypted under it. The relay stores ciphertext it cannot read.
const NAMEKEY_D = D.NAMEKEY;     // per-church name key envelope, wrapped per member — church/steward-signed
const NAME_D = D.NAME;           // a MEMBER's own display name for one church, sealed under that key
const CAREKEY_D = D.CAREKEY;     // per-church CARE key, wrapped per member (mirrors mediakey:) — sensitive care fields are sealed under it
const GUARDREQ_D = D.GUARDREQ;   // safeguarding v2: a PARENT's guardian-link request — d=guardreq:<childpub>, p-tagged to the church. SECURITY-AUDIT-2026-07-20 C1: the author IS the claimed parent (enforced in accept()); the console must never trust a `parent` field in the content.
const NOPHOTO_D = D.NOPHOTO;     // moderation: members whose uploaded photo is suppressed — d=nophoto:<churchpub> (owner/steward only)
const MEDIAKEY_D = D.MEDIAKEY;   // Tier-2 media key wrapped per-member — its object keys ARE the member roster, so gate reads to effective members (else it's a world-readable membership list)
// (a parent's guardian-link REQUEST is d=trinityone/guardreq:<childpub>, authored by the parent — member-writable, falls to the default member rule)
const JOINPOLICY_D = D.JOINPOLICY; // church-signed join policy — d=joinpolicy:<churchpub>, content {approval:bool}; ON = members need steward approval to post
const ADMITTED_D = D.ADMITTED;   // church-signed allowlist of approved members — d=admitted:<churchpub> (only meaningful when approval is ON)
// RE-SEAT: a member lost their 12 words, so their old key is gone forever and they came back on a NEW one.
// The church vouches that the two are the same person — d=reseat:<churchpub>, content {pairs:[{old,new,at}]}.
// Nothing here recovers the old key (nobody has it); it only moves a member's SEAT — their name, their place
// on the roster — onto the new key, so the church doesn't end up with two of the same person and the member
// doesn't come back as a stranger. Old DMs and sealed care records stay unreadable, which is correct.
// Church key or a CURRENT steward may write it (see accept()): an unlisted d-tag falls to the generic member
// rule, and "any member may rewrite it" here would mean any member could seize another member's identity.
const RESEAT_D = D.RESEAT;
const STEWARDS_D = D.STEWARDS;   // church-signed steward roster — d=stewards:<churchpub>, content {pubkeys:[…]}; delegates day-to-day church powers to those keys (revocable: owner re-signs without them). Owner-only to edit. See STEWARD-ROSTER-DESIGN.md.
const STEWARDREQ_D = D.STEWARDREQ; // a would-be steward's REQUEST to a church — d=stewardreq:<churchpub>, authored by the requester (openly writable, like a join). The owner reviews + approves it into the roster (owner-only).
// Meal trains / practical-care module (optional, per-church). care: needs are church/steward/care-team-admin authored;
// careslot: are member-signed offers to help; careskip: are RECIPIENT-only ("I don't need help that day"). See SPINE.md + src/steward-meals.src.js.
// NOTE: 'trinityone/care:' is NOT a prefix of careslot:/careskip: — the colon makes them distinct, so startsWith() is unambiguous.
const MEALS_SETTINGS_D = D.MEALS_SETTINGS; // church-signed config — {enabled, visibility, openedBy, adminGroupId} (single doc, no suffix)
const NEED_D = D.NEED;        // a care need — d=care:<id> (church / steward / care-team admin; or any member when openedBy='member')
const SLOT_D = D.SLOT;    // a member's fill for one (need,date) — d=careslot:<careId>:<iso> (member-signed, addressable per author)
const SKIP_D = D.SKIP;    // recipient marks a day they don't need help — d=careskip:<careId>:<iso> (RECIPIENT-only)
const AVAIL_D = D.AVAIL;  // a member's "I'm here to help" availability — d=careavail:<churchpub> (member-signed, one per member per church; non-minors only)
const CAREREQ_D = D.CAREREQ;  // a member's private "ask for help" request — d=carereq:<id>, ['church',cp]; member-signed, content sealed to the care team. Read-gated to care-team ONLY (like SAFE_D), never the whole church. The care team approves it into a NEED_D or opens a chat.
const CARETEAM_D = D.CARETEAM; // church/steward-signed roster of care-team recipient pubkeys — d=careteam:<churchpub>, content {pubs:[hex,…]}. Public-ish (pubkeys only, no secrets) so a member can seal a carereq: to exactly the care team.
const CAREREQSTATUS_D = D.CAREREQSTATUS; // the care team's resolution of a request — d=carereqstatus:<id>, ['church',cp], ['p',requester]. Care-admin/steward/church-authored; read by the care team AND the p-tagged requester (so they see "approved"/"handled"). Clears the queue + tells the asker.
const CARECHAT_D = D.CARECHAT; // a message in a request's shared care-team↔asker thread — d=carechat:<reqId>:<msgId>, ['church',cp], ['p',requester]. Content sealed to the care team + the asker; read-gated to the care team + the p-tagged asker (+ the author). Member-writable so the asker can reply; the per-member doc cap + client-side decryptability filtering bound spam.
// SAFETY CHECK ("mark as safe" — emergency roll-call after a raid/disaster). A check is one active doc per
// church (church/steward/care-team authored); each member replies with their OWN response doc, whose content
// is NIP-44-encrypted to the check's CREATOR (p-tagged) so even a seized relay can't read who's safe / in danger.
const SAFETY_D = D.SAFETY;  // d=safetycheck:<churchpub> — the active check; gated to members (roster-style)
const SAFE_D   = D.SAFE;         // d=safe:<churchpub> — a member's response; read only by self + the check creator + church/stewards
function toHexPub(s) { if (!s) return null; s = String(s).trim(); if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase(); try { const d = nip19decode(s); return d.type === 'npub' ? d.data : null; } catch { return null; } }
// the relay can host MULTIPLE churches — each manages its own data, scoped by author. Configure via
// CHURCH_NPUB (comma-separated) or relay/church.json ({npub} | {npubs:[…]} | {churches:[{npub}…]}).
const CHURCH_PUBS = new Set();
const CHURCH_NAMES = new Map();   // hex pub -> display name (for the Relay app dashboard)
// hex pub -> { by: 'operator' | 'self', at: unix-seconds } — PROVENANCE. Nothing recorded how a church came
// to be on a relay, so an operator faced with rows they never added had no way to tell which were theirs,
// when the others arrived, or which were safe to remove. That is the state that made a bulk delete look
// attractive, and a bulk delete is what silently de-provisioned real congregations. Persisted in church.json.
const CHURCH_META = new Map();
// Churches GRANTED media hosting on this relay (a self-hoster, or one the operator vouches for). A church can be
// provisioned for conversations + text resources WITHOUT this grant. Only consulted when mediaRequiresHost() is on
// (the community-relay policy) — see the blob PUT gate. Grant via church.json ({churches:[{npub,media:true}]} or a
// top-level {media:true}) or the RELAY_MEDIA_CHURCHES env (comma-separated npubs).
const MEDIA_HOSTS = new Set();
const addChurch = (s, name, media, meta) => { const h = toHexPub(s); if (h) { CHURCH_PUBS.add(h); if (name) CHURCH_NAMES.set(h, name); if (media) MEDIA_HOSTS.add(h);
  if (meta && (meta.by || meta.at)) CHURCH_META.set(h, { by: meta.by === 'self' ? 'self' : 'operator', at: meta.at | 0 }); } };
const CHURCH_FILE = join(DATA_DIR,'church.json');
// (re)load the write policy from env + church.json — called at startup and after a browser config save
function loadChurches() {
  CHURCH_PUBS.clear(); CHURCH_NAMES.clear(); MEDIA_HOSTS.clear(); CHURCH_META.clear();
  // RELAY-AUDIT-2026-07-20 C2: CHURCH_NPUB used to be re-applied on EVERY reload, including the one that
  // runs immediately after the operator saves the church list. So a church supplied by env could never be
  // removed from the dashboard: the save wrote church.json without it, loadChurches() put it straight back,
  // and (because the save response echoed the REQUEST) the UI reported success. It also silently wiped that
  // church's display name, since the name only lived in church.json — which is one reason this box's
  // church.json holds 41 churches, 37 of them nameless.
  // The env var is now a SEED, migrated ONCE onto disk. Deliberately not a hard cut-over: a box configured
  // purely by CHURCH_NPUB that also happens to have a church.json (self-registration writes one) would
  // otherwise lose its real church on the next restart, locking out a live congregation. So on the first
  // load after this change we fold env into church.json and stamp `envMigrated`; from then on church.json
  // is the single source of truth and the dashboard governs.
  let envPending = [];
  try { const j = JSON.parse(readFileSync(CHURCH_FILE, 'utf8')); if (!j || !j.envMigrated) envPending = (process.env.CHURCH_NPUB || '').split(','); }
  catch { envPending = (process.env.CHURCH_NPUB || '').split(','); }
  envPending.forEach(s => addChurch(s));
  (process.env.RELAY_MEDIA_CHURCHES || '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => { const h = toHexPub(s); if (h) MEDIA_HOSTS.add(h); });
  try {
    const cj = JSON.parse(readFileSync(CHURCH_FILE, 'utf8'));
    if (cj) { if (cj.npub) addChurch(cj.npub, cj.name, cj.media === true); (cj.npubs || []).forEach(s => addChurch(s)); (cj.churches || []).forEach(c => addChurch(c && (c.npub || c), c && c.name, !!(c && c.media === true), c && { by: c.by, at: c.at })); }
  } catch {}
}
loadChurches();
// WRITE THE SEED TO DISK, ONCE. CHURCH_NPUB is a seed migrated into church.json — but the migration only ran
// when something else happened to save. A relay set up the way RELAY-SETUP.md documents (env var, never
// touched the dashboard) therefore had NO church.json at all, and /relay-backup tars the data dir — so the
// archive could not contain what was never written.
//
// Restore that archive onto a new box without remembering to set the variable again and the relay comes up
// not knowing which church it serves: the write policy is OFF (an open relay — anyone on the internet may
// write), and the congregation cannot read its own membership documents, because note() returns early when
// CHURCH_PUBS is empty. It reports itself perfectly healthy throughout. Measured: 14 documents before,
// 10 after, all three member: docs and the care slot invisible, "write policy OFF".
//
// Stamping it here means the very next backup carries the church. Idempotent: persistChurches() writes
// envMigrated, and loadChurches() stops folding the env var in once it sees that stamp. AUDIT 2026-08-02.
try {
  if (CHURCH_PUBS.size) {
    let stamped = false;
    try { stamped = !!JSON.parse(readFileSync(CHURCH_FILE, 'utf8')).envMigrated; } catch { stamped = false; }
    if (!stamped) { persistChurches(); console.log('  church registration written to church.json (so a backup can carry it)'); }
  }
} catch (e) {}
// admin token — gates the browser config endpoint (/config), which changes the write policy. Generated
// once and stored 0600. Loopback requests (you're on the box) are trusted; LAN/tunnel must present it.
const ADMIN_FILE = join(DATA_DIR,'admin.json');
let ADMIN_TOKEN = '';
try { ADMIN_TOKEN = JSON.parse(readFileSync(ADMIN_FILE, 'utf8')).token || ''; } catch {}
if (!ADMIN_TOKEN) { ADMIN_TOKEN = randomBytes(24).toString('base64url'); try { writeFileSync(ADMIN_FILE, JSON.stringify({ token: ADMIN_TOKEN }), { mode: 0o600 }); } catch {} }
// One-time backup-download tickets. A plain <a download> navigation can't send an Authorization header, so
// the backup URL used to carry ?token=<ADMIN_TOKEN> — putting the relay's secret into browser history, logs
// and referrers (and tripping Brave's "insecure download" heuristic). A ticket is single-use + 60s-lived, so
// the download URL is inert the moment it's used or expires.
const BACKUP_TICKETS = new Map();   // ticket -> expiry ms
function mintBackupTicket() {
  const now = Date.now();
  for (const [k, exp] of BACKUP_TICKETS) if (exp < now) BACKUP_TICKETS.delete(k);   // sweep expired
  const t = randomBytes(24).toString('base64url');
  BACKUP_TICKETS.set(t, now + 60000);
  return t;
}
function consumeBackupTicket(t) {
  if (!t) return false;
  const exp = BACKUP_TICKETS.get(t);
  if (exp === undefined) return false;
  BACKUP_TICKETS.delete(t);   // one-time, even if expired
  return exp >= Date.now();
}
// Relay identity (for resync): this relay's own Nostr keypair. It proves WHICH relay is asking when it pulls a
// peer for a church's full corpus — a church authorises specific relay pubkeys as its trusted infrastructure
// (see TRUSTED_RELAYS), the same church key that gatekeeps writes. Generated once, stored 0600 (gitignored).
const RELAY_KEY_FILE = join(DATA_DIR,'relay-key.json');
let RELAY_SK = null, RELAY_PUB = '';
try { const k = JSON.parse(readFileSync(RELAY_KEY_FILE, 'utf8')); if (k && k.sk && k.pub) { RELAY_SK = Uint8Array.from(Buffer.from(k.sk, 'hex')); RELAY_PUB = k.pub; } } catch {}
if (!RELAY_SK || !RELAY_PUB) { RELAY_SK = generateSecretKey(); RELAY_PUB = getPublicKey(RELAY_SK); try { writeFileSync(RELAY_KEY_FILE, JSON.stringify({ sk: Buffer.from(RELAY_SK).toString('hex'), pub: RELAY_PUB }), { mode: 0o600 }); } catch {} }
// a relay-signed NIP-98 (kind-27235) proof bound to url+method+church — how this relay authenticates to a peer's /sync.
function relayProof(url, method, cp) { return 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', method], ['church', cp]], content: '' }, RELAY_SK))).toString('base64'); }
// this relay's OWN claim (control panel → claim a memorable name in a directory): kind-27235 signed by RELAY_SK,
// binding handle+relay-url (+offer when hosting). The SIGNED event is the gossip record — self-verifying, so any
// relay can store + re-share it without trusting the sender. relayNameClaimEvent returns the event; the *Auth
// header form wraps it for the direct POST.
function relayNameClaimEvent(handle, url, offer) {
  const tags = [['u', 'relay-names/claim'], ['method', 'POST'], ['handle', handle], ['relay', url]];
  if (offer && typeof offer === 'object') tags.push(['offer', JSON.stringify(offer)]);
  return finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, RELAY_SK);
}
function relayNameClaim(handle, url, offer) { return 'Nostr ' + Buffer.from(JSON.stringify(relayNameClaimEvent(handle, url, offer))).toString('base64'); }
// ── Relay name directory (Phase 2): a memorable handle a steward can TYPE to connect a church to a relay,
// instead of a wss:// URL. Any gateway can serve a directory; in practice relays register with the shared
// community host and consoles resolve there. A claim is SIGNED by the relay's own identity key, so a handle is
// owned by the first relay pubkey to take it and only that key can re-point it. Resolution is public.
const RELAY_NAMES_FILE = join(DATA_DIR, 'relay-names.json');
let RELAY_NAMES = {};
try { RELAY_NAMES = JSON.parse(readFileSync(RELAY_NAMES_FILE, 'utf8')) || {}; } catch {}
function saveRelayNames() { try { const tmp = RELAY_NAMES_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify(RELAY_NAMES, null, 2) + '\n'); renameSync(tmp, RELAY_NAMES_FILE); } catch {} }
// pub → handle reverse index (one handle per relay key) so applyClaimRecord is O(1), not an O(n) scan per record.
const _handleByPub = new Map();
const _lastAtByPub = new Map();   // pubkey -> highest created_at ever accepted from it (monotonic; defeats replaying a released handle's old claim)
const RELAY_NAMES_CAP = 20000;    // hard cap on directory size — a flood of valid claims can't grow the map/disk without bound
for (const [h, r] of Object.entries(RELAY_NAMES)) if (r && r.pub) { _handleByPub.set(r.pub, h); if ((r.at || 0) > (_lastAtByPub.get(r.pub) || 0)) _lastAtByPub.set(r.pub, r.at || 0); }
// Debounce the whole-file directory write: a gossip merge of many records does ONE write, not one per record.
let _relayNamesDirty = false;
function scheduleSaveRelayNames() { if (_relayNamesDirty) return; _relayNamesDirty = true; setTimeout(() => { _relayNamesDirty = false; saveRelayNames(); }, 1000); }
const _handleRe = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;   // 3–32 chars, lowercase alnum + inner hyphens
// verify a claim: Authorization 'Nostr <base64 kind-27235 event>' signed by a relay key, tags bind handle+relay.
// Verify a directory record (signed claim event) on its own merits — no request context needed, so the SAME
// check works for a direct POST and for a record gossiped in from a peer. maxAgeSec bounds freshness (strict for
// a live claim = anti-replay; generous/absent for gossip, where latest-wins by created_at prevents rollback).
function verifyClaimEvent(ev, maxAgeSec) {
  try {
    if (!ev || ev.kind !== 27235 || !verifyEvent(ev)) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    // SECURITY-2026-07-13: reject FUTURE-dated claims on EVERY path (incl. gossip merge, which passes maxAgeSec=0).
    // applyClaimRecord is latest-wins by created_at, so a year-3000 claim would be permanently unbeatable — it locks
    // a handle forever and stops the real relay re-pointing its own name. 5-min skew tolerance.
    if ((ev.created_at || 0) > nowSec + 300) return null;
    if (maxAgeSec && Math.abs(nowSec - (ev.created_at || 0)) > maxAgeSec) return null;
    const tag = (n) => (ev.tags.find(t => Array.isArray(t) && t[0] === n) || [])[1];
    const handle = String(tag('handle') || '').toLowerCase();
    const url = String(tag('relay') || '');
    if (!_handleRe.test(handle) || !/^wss?:\/\/.+/i.test(url)) return null;
    let offer; try { const o = tag('offer'); if (o) { const p = JSON.parse(o); offer = { open: !!p.open, churches: (p.churches | 0), region: String(p.region || '').slice(0, 40), operator: String(p.operator || '').slice(0, 64) }; } } catch {}
    return { handle, url, pub: ev.pubkey, at: ev.created_at || 0, offer, ev };
  } catch { return null; }
}
// header form of the above (direct POST): parse Authorization: Nostr <b64 event>, verify, require it bind THIS
// handle+url. Returns the claiming relay pubkey or null. Kept so the existing /relay-names/claim path is intact.
function _verifyRelayClaim(req, handle, relayUrl) {
  const h = req.headers['authorization'] || '';
  if (!/^Nostr /i.test(h)) return null;
  let ev; try { ev = JSON.parse(Buffer.from(h.slice(6), 'base64').toString('utf8')); } catch { return null; }
  const rec = verifyClaimEvent(ev, 120);
  if (!rec || rec.handle !== String(handle).toLowerCase() || rec.url !== relayUrl) return null;
  return ev;   // the verified signed event (caller merges it via applyClaimRecord)
}
// Merge a verified record into the local directory, LATEST-WINS per relay key. Old/replayed claims can't roll a
// name back, and a name stays owned by its first key — so the mirror converges no matter what order records
// arrive. Returns true if it changed the table.
function applyClaimRecord(rec) {
  if (!rec || !rec.handle) return false;
  // SECURITY-2026-07-13: per-key MONOTONIC created_at. The old guards only compared against the record stored under
  // the SAME handle, so replaying a relay's OLD (already-released) handle claim hit an EMPTY slot, passed both guards,
  // and DELETED the key's current handle (rolling it back + freeing the new name for a squatter). Require every record
  // to be strictly newer than anything we've accepted from this key, whatever handle it names — releasing is now
  // monotonic and a replayed old claim is rejected.
  if ((_lastAtByPub.get(rec.pub) || 0) >= rec.at) return false;
  const existing = RELAY_NAMES[rec.handle];
  if (existing && existing.pub !== rec.pub) return false;             // name owned by another key — first-claim-wins
  const prev = _handleByPub.get(rec.pub);                             // this key's previous handle — release it (one handle per relay)
  if (prev && prev !== rec.handle) delete RELAY_NAMES[prev];
  RELAY_NAMES[rec.handle] = { url: rec.url, pub: rec.pub, at: rec.at, ...(rec.offer ? { offer: rec.offer } : {}), ev: rec.ev };
  _handleByPub.set(rec.pub, rec.handle);
  _lastAtByPub.set(rec.pub, rec.at);
  // DoS: bound the directory. If a flood pushed us over the cap, evict the oldest entries (by claim time) — a relay
  // that still cares re-claims on its next gossip tick (fresh created_at), so eviction is self-healing.
  const keys = Object.keys(RELAY_NAMES);
  if (keys.length > RELAY_NAMES_CAP) {
    keys.sort((a, b) => (RELAY_NAMES[a].at || 0) - (RELAY_NAMES[b].at || 0));
    for (let i = 0; i < keys.length - RELAY_NAMES_CAP; i++) { const h = keys[i]; const pub = RELAY_NAMES[h] && RELAY_NAMES[h].pub; delete RELAY_NAMES[h]; if (pub && _handleByPub.get(pub) === h) _handleByPub.delete(pub); }
  }
  scheduleSaveRelayNames();
  return true;
}
// Where THIS relay registers its name + where consoles resolve names. Defaults to the shared community host;
// a church can self-host a directory by pointing RELAY_DIRECTORY at its own gateway.
const DIRECTORY = (process.env.RELAY_DIRECTORY || 'https://app.trinityone.church').replace(/\/+$/, '');
// Directory peers this relay mirrors with — the shared hosts plus any RELAY_DIRECTORY_PEERS override. Each relay
// pulls every peer's records and merges them, so the whole name/offer directory lives on ALL of them, not one.
const DIRECTORY_PEERS = [...new Set([
  DIRECTORY, 'https://app.trinityone.church', 'https://trinityone-master-01.tailbeaac0.ts.net',
  ...(process.env.RELAY_DIRECTORY_PEERS || '').split(',').map(s => s.trim()).filter(Boolean),
].map(u => u.replace(/\/+$/, '')))];
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
// What this relay tells the directory about hosting: `open` = actually accepting new churches now (operator
// opted in to offer, not invite-only, under cap). The directory lists open relays so another church's Auto-find
// can DISCOVER this relay without knowing its name. churches/region/operator are load + contact hints.
function offerMeta() {
  const full = !!(OFFER_CAP && CHURCH_PUBS.size >= OFFER_CAP);
  const open = (OFFER_OPEN || SETTINGS.offerHosting) && !SETTINGS.inviteOnly && !full;
  return { open, churches: CHURCH_PUBS.size, ...(OFFER_REGION ? { region: OFFER_REGION } : {}), ...(OFFER_OPERATOR ? { operator: OFFER_OPERATOR } : {}) };
}
async function reclaimRelayName() {   // re-point the claimed name at the current public URL (needs both) + refresh the offer
  if (!MY_RELAY_NAME || !CF_URL) return;
  const wss = cfPublicWss();
  const auth = relayNameClaim(MY_RELAY_NAME, wss, offerMeta());   // one signed claim (carries the offer); post to every directory peer
  await Promise.allSettled(DIRECTORY_PEERS.map(peer => fetch(peer + '/relay-names/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': auth }, body: JSON.stringify({ handle: MY_RELAY_NAME, url: wss }), signal: AbortSignal.timeout(8000) }).catch(() => {})));
}
// Gossip pull: fetch every directory peer's signed records and merge them, so this relay mirrors the whole
// name/offer directory. Runs shortly after boot and on a timer. Records are self-verifying + latest-wins, so
// pulling from anyone is safe and order-independent.
const _gossipSince = {};   // per-peer high-water (max verified created_at seen) → pull only newer records next time
async function gossipDirectory() {
  for (const peer of DIRECTORY_PEERS) {
    try {
      const r = await fetch(peer + '/relay-names/sync?since=' + (_gossipSince[peer] || 0), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      for (const ev of (j.records || []).slice(0, 5000)) {
        const rec = verifyClaimEvent(ev, 0);
        if (rec) { applyClaimRecord(rec); if (rec.at > (_gossipSince[peer] || 0)) _gossipSince[peer] = rec.at; }
      }
    } catch {}
  }
}
try { setTimeout(() => { gossipDirectory().catch(() => {}); }, 10000); setInterval(() => { gossipDirectory().catch(() => {}); }, 300000); } catch {}
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
// Open a URL in the host's default browser. The relay runs locally in the desktop Suite, so it can do what the
// sandboxed webview can't (the webview has no Tauri IPC + target="_blank" is a no-op there). Fire-and-forget.
function openExternal(url) {
  try {
    const p = process.platform;
    // Windows: rundll32 FileProtocolHandler with an arg array — NEVER `cmd /c start`, which re-parses its command
    // line so metacharacters in the URL could inject commands. macOS/Linux openers already take an arg array.
    const c = p === 'win32' ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' })
      : p === 'darwin' ? spawn('open', [url], { detached: true, stdio: 'ignore' })
      : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    c.on('error', () => {}); c.unref(); return true;
  } catch { return false; }
}
// HEADER-ONLY by default (audit 2026-07-24). Every admin route used to accept the relay's master secret as
// ?token=, and these relays sit behind a Cloudflare tunnel — so the token landed in edge logs, proxy logs and
// browser history for /config, /settings, /stats, /update, /relay-restore, /sync-now. The one place a bare URL
// is genuinely needed is the backup DOWNLOAD (an <a download> can't set a header), and that already has
// one-time tickets; it passes allowQuery so an API caller keeps working.
function reqToken(req, allowQuery) { const h = req.headers['authorization'] || ''; const m = /^Bearer\s+(.+)$/i.exec(h); if (m) return m[1].trim(); if (!allowQuery) return ''; try { return new URL(req.url, 'http://x').searchParams.get('token') || ''; } catch { return ''; } }
// Always require the admin token. Do NOT trust loopback: the relay runs behind the Tailscale Funnel /
// cloudflared, which proxy from 127.0.0.1, so a public request is indistinguishable from a local one.
function adminOK(req, allowQuery) { const t = reqToken(req, allowQuery); if (!t || !ADMIN_TOKEN) return false; const a = Buffer.from(t), b = Buffer.from(ADMIN_TOKEN); return a.length === b.length && timingSafeEqual(a, b); }
const STARTED_AT = Date.now();
const MEMBERS = new Set();     // EFFECTIVE members (write-allowed): self-joined, minus blocked, minus unapproved (when a church gates joining). Rebuilt by rebuildMembers().
const MEMBER_DOCS = new Map(); // churchpub -> Set(pubkeys who published a member: doc — i.e. asked to join / joined)
const TRUSTED_RELAYS = new Map(); // churchpub -> Set(relay pubkeys the church authorised as trusted infra — may pull the FULL corpus)
const PEER_URLS = new Map();      // churchpub -> Set(relay URLs to sync this church WITH, from the same church-signed doc)
const SYNC_CURSOR_FILE = join(DATA_DIR,'sync-cursors.json');   // { "<cp>@<peerUrl>": lastCreatedAt } — resumable, idempotent
let SYNC_CURSORS = {}; try { SYNC_CURSORS = JSON.parse(readFileSync(SYNC_CURSOR_FILE, 'utf8')) || {}; } catch {}
let _cursorsDirty = false;   // written once per sync pass, atomically (tmp+rename) — see saveCursors()
function saveCursors() { if (!_cursorsDirty) return; _cursorsDirty = false; try { const tmp = SYNC_CURSOR_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify(SYNC_CURSORS)); renameSync(tmp, SYNC_CURSOR_FILE); } catch {} }
const SYNC_OVERLAP = 600;   // re-pull a 10-min window before the cursor each time, so an event that arrived out-of-order isn't missed
const GROUP_CHURCH = new Map();  // groupId -> owning church/network pubkey — per-church retention attribution for chat
// A member pubkey -> the SET of churches they belong to. This was a single-valued map, last write wins, and
// a member of two churches is ordinary — someone who moves, or serves at a plant, or has family in another
// congregation. With one slot, whichever member: doc the store rehydrated last won, and the kind-0 read gate
// then denied that person's NAME to everyone in the other church: their messages rendered as "Anonymous
// …a1b2c3" forever, in chat and in the directory, and each phone re-requested the missing profile in every
// 250 ms batch window for the life of the session. Leaving one church also deleted the mapping for the other.
// AUDIT-2026-07-27.
const MEMBER_CHURCHES = new Map();
const memberIn = (m, cp) => !!cp && !!(MEMBER_CHURCHES.get(m) || EMPTY_SET).has(cp);
const churchesOf = (m) => [...(MEMBER_CHURCHES.get(m) || EMPTY_SET)];
const anyChurchOf = (m) => churchesOf(m)[0] || '';
const EMPTY_SET = new Set();
const REQUIRE_APPROVAL = new Set(); // churchpubs whose joins need steward approval (default: open join)
const ADMITTED_BY = new Map();      // churchpub -> Set(approved member pubkeys) (only used when that church requires approval)
const JOIN_NOTIFIED = new Set();    // "pubkey:churchpub" we've already alerted the steward about (join or request) — dedupe push spam
const BROADCAST = new Set();   // group ids the church marked broadcast
// Networks a church joined — allowed to publish church-style content for THAT church.
// SECURITY-AUDIT-2026-07-20 C4: this used to be a single process-global Set. A church publishing
// `network:<pubkey>` inserted that key for EVERY church on the relay, so one tenant (or anyone who
// self-registered a church via /config) could mint a key with leader authority over every other
// congregation — read their roster, safeguarding lists and care needs, and inject church-style
// content into them. Authority is now scoped to the churches that actually declared it; NETWORKS
// is kept only as a cheap "is this pubkey a network anywhere" union for church-agnostic call sites.
const NETWORKS_BY = new Map(); // churchpub -> Set(network pubkeys that church joined)
const NETWORKS = new Set();    // union of the above — NEVER use to authorise access to a specific church
function rebuildNetworks() { NETWORKS.clear(); for (const s of NETWORKS_BY.values()) for (const p of s) NETWORKS.add(p); }
// the ONLY correct network check when a church is in scope: is `pub` a network THIS church joined?
const networkOf = (pub, cp) => { const s = cp && NETWORKS_BY.get(cp); return !!(s && s.has(pub)); };
const GROUP_LEADERS = new Map(); // groupId -> Set(pubkey) — members a leader empowered to post events for that group
const GROUP_LEADER_BY = new Map(); // groupId -> { by, cp } — who authored the leader grant (M2: void it if they're later revoked)
const STEWARDS_BY = new Map();   // churchpub -> Set(steward pubkeys) from the owner-signed stewards: roster (delegated, revocable authority)
// Meal trains / care module state (rebuilt from stored events by note()):
const ROSTER_PEOPLE = new Map();     // teamId(groupId) -> Set(pubkey) — people LINKED on a team roster; the care-team's members live here
const ROSTER_BY = new Map();          // teamId(groupId) -> { by, cp } — who authored the roster (M2: void the care-admin grant if they're later revoked)
const FINANCE_SEQ = new Map();        // churchpub -> last accepted finance-journal seq — the relay is the ordering authority; the next write must be seq+1 (single-writer, no gaps/forks/edits)
const MEALS_ADMIN_GROUP = new Map(); // churchpub -> care-team groupId (its roster people may open/manage care needs)
const MEALS_OPEN_MEMBER = new Set(); // churchpubs whose meals-settings allow ANY member to open their own care need (openedBy='member')
// careId -> sha256 of the need's SKIP TOKEN. The recipient of a care need may mark a day "I don't need help",
// and only they may do it — but once the need's `recipient` field is sealed (H3), the relay can no longer
// see who that is, and gating on a cleartext pubkey would mean publishing "who in this congregation is
// vulnerable" to the relay operator and into every archive.
// So the need carries an opaque `['skiphash', sha256(token)]` tag in the clear, and the token itself is
// encrypted TO THE RECIPIENT ALONE (not under the church-wide care key, which every member holds). To skip a
// day the recipient presents the token; the relay hashes it and compares. It enforces recipient-only writes
// without ever learning who the recipient is — and cannot brute-force it, because the token is random rather
// than derived from an identity.
const CARE_SKIPHASH = new Map();     // careId -> hex sha256 of that need's skip token
const CARE_RECIPIENT = new Map();    // careId -> recipient pubkey — LEGACY (v1 cleartext needs) only
// AUDIT-2026-07-30 S2/S2b: careId -> the church that first opened that need. `care:<id>` is a relay-GLOBAL id,
// exactly like `group:<id>` and `roster:<id>` were before AUDIT-2026-07-24 gave them idOwnerOk() — and the two
// maps above are keyed by the BARE id, so the last church to write one owned the entry. This is what a slot fill
// and a skip are scoped against; it mirrors GROUP_CHURCH.
const CARE_CHURCH = new Map();       // careId -> owning church pubkey
// is `pub` a current steward of church `cp`? (empty/no roster => false => behaviour identical to pre-roster)
const stewardOf = (pub, cp) => { const s = STEWARDS_BY.get(cp); return !!(cp && s && s.has(pub)); };
// M2: a delegated leader/care-admin grant is only honoured while the steward who authored it is STILL a
// steward (or the church/network key). So revoking a steward immediately drops the group-leader and
// care-team grants they created — no re-derivation pass, the check just runs at use-time.
// REVIEW-2026-07-20 B3: `CHURCH_PUBS.has(src.by)` / `NETWORKS.has(src.by)` were unscoped, so a grant authored
// by ANY church or ANY network key counted as a valid grantor for ANY church — which feeds careAdmin() below
// and thus cross-tenant care-PII reads. Scoped to the church the grant is actually for.
const grantorOk = (src) => !!(src && (src.by === src.cp || networkOf(src.by, src.cp) || stewardOf(src.by, src.cp)));
// is `pub` on the care-team of church `cp`? (a member of the roster of cp's configured care-team group)
// AUDIT-2026-07-24 CRITICAL-2: team ids are a relay-GLOBAL namespace, and this never checked that the roster
// it resolved actually BELONGS to cp. A co-tenant church published roster:<cp's team id> listing itself,
// satisfying grantorOk with its own {by:B, cp:B} — and careAdmin() is a read grant for cp's carereq:, safe:,
// safeguarding lists and (via the default-deny branch) every kind-30078 doc of that church. Require the
// roster's own recorded church to be cp; ownership is additionally pinned at write time in note().
const careAdmin = (pub, cp) => { const g = cp && MEALS_ADMIN_GROUP.get(cp); const src = g && ROSTER_BY.get(g); const ppl = g && ROSTER_PEOPLE.get(g); return !!(ppl && ppl.has(pub) && src && src.cp === cp && grantorOk(src)); };
// FIRST-WRITER OWNERSHIP for relay-global id namespaces (group:<id>, roster:<id>). Nothing in the d-tag binds
// an id to the church that created it, so any configured church key could republish another church's id and
// take it over — flipping an invite-only group to public (its whole history then served to anonymous REQs) or
// installing itself on a care-team roster. Once an id is known, only its owning church (or that church's
// network/steward) may rewrite it. Mirrors the pattern EVENT_D/PIN_D/HIDE_D already use via GROUP_CHURCH.
function idOwnerOk(owner, e) {
  if (!owner) return true;                       // unknown id → first writer takes it
  const cp = namedChurch(e) || e.pubkey;
  return cp === owner || networkOf(e.pubkey, owner) || stewardOf(e.pubkey, owner);
}
// the church a steward-authored CONTENT event acts for: its ["church", <cp>] tag, validated to a configured church.
const namedChurch = (e) => { const t = (e.tags || []).find(t => t[0] === 'church'); const h = t && (toHexPub(t[1]) || t[1]); return h && CHURCH_PUBS.has(h) ? h : ''; };
// Resolve the church a kind-30078 doc BELONGS to, for the default-deny read gate (C1). Four shapes exist
// in the corpus, in decreasing order of trustworthiness:
//   1. `<prefix><churchpub>` — the d-tag names it outright (member:/minors:/stewards:/careavail:/safetycheck:…);
//   2. the church key authored it (the ordinary case for church content);
//   3. a steward authored it and named the church in ['church',<cp>] (validated to a configured church);
//   4. a member authored a reply and p-tagged the church (rsvp:/reqreply:/unavail:/guardreq:/stewardreq:).
// Returns '' when ownership can't be proven — the caller MUST treat that as deny, not as public.
const CP_SUFFIXED_D = [MEMBER_D, ADMITTED_D, RESEAT_D, STEWARDS_D, STEWARDREQ_D, BLOCKED_D, MINORS_D, APPROVED_D,
  GUARDIANS_D, MEDIAKEY_D, CAREKEY_D, NAMEKEY_D, CARETEAM_D, AVAIL_D, SAFETY_D, NOPHOTO_D, JOINPOLICY_D];
// Doc types an ORDINARY MEMBER legitimately authors while church-tagging them. Their authority comes from
// authorship, not from delegated church authority, so the revoked-steward roster check in canRead() must
// not be applied to them (REVIEW-2026-07-20 B1 — it silently hid every care sign-up from the church).
const MEMBER_WRITABLE_D = [SLOT_D, SKIP_D, AVAIL_D, SAFE_D, RSVP_D, REQREPLY_D, UNAVAIL_D, GUARDREQ_D, STEWARDREQ_D, MEMBER_D, CAREREQ_D, NAME_D];
function owningChurch(e, d) {
  const suf = CP_SUFFIXED_D.find(p => d.startsWith(p));
  if (suf) { const h = toHexPub(d.slice(suf.length)) || ''; if (h && CHURCH_PUBS.has(h)) return h; }
  if (CHURCH_PUBS.has(e.pubkey)) return e.pubkey;
  const named = namedChurch(e); if (named) return named;
  for (const t of (e.tags || [])) {           // member-authored reply → the church it is addressed to
    if (t[0] !== 'p') continue;
    const h = toHexPub(t[1]) || t[1];
    if (h && CHURCH_PUBS.has(h)) return h;
  }
  return '';
}
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
// ── per-church safeguarding (SECURITY-AUDIT-2026-07-20 C2, CRITICAL) ───────────────────────────────
// MINORS / APPROVED / GUARDIANS are relay-wide UNIONS of every church's list, and the DM gate consulted
// the unions. Because /config self-registration is open by default, anyone could stand up a "church" on
// the shared relay and publish `approved:<their own key>` — becoming a cleared adult for EVERY minor of
// EVERY church on the box. A congregation's DBS list was only as strong as the laxest tenant.
// The gate is now evaluated per-church, over churches the CHILD ACTUALLY JOINED. That is what defeats the
// attack: membership is self-asserted (a `member:` doc signed by the member), so a hostile church can list
// whoever it likes in its own minors doc but cannot make that child one of its members — it is excluded
// from the evaluation entirely, and so can neither grant clearance nor withhold it.
const approvedIn = (pub, cp) => { const s = APPROVED_BY.get(cp); return !!(s && s.has(pub)); };
const guardianLinkedIn = (a, b, cp) => { const m = GUARDIANS_BY.get(cp); if (!m) return false; const ga = m.get(a); if (ga && ga.has(b)) return true; const gb = m.get(b); return !!(gb && gb.has(a)); };
// The churches whose safeguarding policy governs `pub`: ONLY churches that both list them as a minor AND
// that they have actually joined.
//
// REVIEW-2026-07-20 B4: an earlier version fell back to "every church that lists them" when the joined set
// was empty, meaning to cover a child whose account was just created. That fallback re-opened the exact
// cross-tenant hole this function exists to close — it fires for anyone listed ONLY by a church they have
// not joined, i.e. precisely the hostile-tenant case. A self-registered church could name any adult in its
// own minors doc and thereby govern them: severing them from every peer DM (a targeted denial-of-contact
// against, say, a persecuted-church member) while, via the `other === cp` clause below, remaining the only
// party still able to message them — a grooming primitive wearing safeguarding's clothes.
// The fallback was also unnecessary: fellowship.src.js publishes `member:<cp>` with the child's own key at
// account creation, so a legitimately linked child HAS joined. No join, no governance.
function minorGoverningChurches(pub) {
  const out = [];
  for (const [cp, s] of MINORS_BY) { if (!s.has(pub)) continue; const md = MEMBER_DOCS.get(cp); if (md && md.has(pub)) out.push(cp); }
  return out;
}
// May `other` exchange DMs with `minorPub`? Clearance must come from EVERY church that governs the child —
// so one church's lax list can never override another's. Returns true when the child is a minor nowhere.
function safeguardAllows(minorPub, other) {
  const cps = minorGoverningChurches(minorPub);
  if (!cps.length) return true;
  for (const cp of cps) {
    if (approvedIn(other, cp) || guardianLinkedIn(minorPub, other, cp)) continue;
    if (other === cp || stewardOf(other, cp) || networkOf(other, cp)) continue;   // the child's OWN church may always reach them
    return false;
  }
  return true;
}
const GROUP_VIS = new Map();     // groupId -> 'open' | 'invite'
const GROUP_MEMBERS = new Map(); // groupId -> Set(pubkey) allowed to post in an invite-only group
const GROUP_NAMES = new Map();   // groupId -> display name (for push titles)
// AUDIT-2026-07-24: which groups a church marked child-safe. Until now this flag lived ONLY in the client
// (app/screens-chat.jsx filtered the group list with it), so the adults-only boundary was a UI preference: a
// minor on a modified build, an old build, or any raw REQ could read and post in adult-only group chat. It was
// the one safeguarding control that wasn't relay-enforced, while the kind-4 DM gate, the NIP-17 block and the
// care-thread gate all are. Recorded here so accept()/canRead() can enforce it like the rest.
const GROUP_CHILDSAFE = new Set();   // groupIds a church explicitly marked child-safe

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
    const name = '';   // sealed to the congregation — the relay cannot read a member's name (and a push service must not)
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
      // NAMES ARE SEALED TO THE CONGREGATION NOW, so the relay cannot read them — and should not. This used to
      // put the sender's name into a payload handed to an outside push service in the clear, which is a worse
      // leak than the one the encryption is for. "Someone" is the honest word. AUDIT-2026-07-27.
      const who = '';
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
      // SECURITY: scope to the OWNING church's members — MEMBERS is the global union across every church on a
      // shared relay, so an unscoped fan-out pushes one church's announcement to unrelated churches (cross-tenant
      // metadata leak + spam). Mirror maybePushSermon's church filter.
      const gcp = GROUP_CHURCH.get(gid);
      const recips = (GROUP_VIS.get(gid) === 'invite') ? [...(GROUP_MEMBERS.get(gid) || [])] : [...MEMBERS].filter(m => !gcp || memberIn(m, gcp));
      for (const r of recips) {
        if (!r || r === evt.pubkey) continue;
        pushTo(r, { title: gname, body: 'New announcement', url: '/?tab=chat&group=' + gid, tag: 'grp-' + gid }, 'announce');
      }
    }
  } catch {}
}
// notify members when the church FEATURES a sermon (pins it → the Today "New video / New audio clip" card):
// the deliberate "tell everyone" action, one-per-church so bulk uploads don't spam. Fires only on live ingest
// (never on hydration/replay, so a restart can't re-notify), and once per featured item.
const SERMON_PUSHED = new Set();
function maybePushSermon(evt) {
  try {
    if (evt.kind !== 30078) return;
    const d = (evt.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (!d.startsWith(PINSERMON_D)) return;
    const cp = d.slice(PINSERMON_D.length);
    if (!CHURCH_PUBS.has(cp)) return;
    if (evt.pubkey !== cp && !stewardOf(evt.pubkey, cp)) return;                 // only the church/steward features
    if ((evt.tags || []).some(t => t[0] === 'deleted') || !evt.content) return;  // an unpin, not a feature
    let s; try { s = JSON.parse(evt.content); } catch { return; }
    if (!s || !s.sha256) return;
    if (!evt.id || SERMON_PUSHED.has(evt.id)) return; SERMON_PUSHED.add(evt.id);   // dedup on the PIN EVENT, not the sermon id — so re-featuring (a fresh pin event) DOES re-notify, but the same event arriving twice (multi-relay) doesn't
    const isVideo = String(s.mime || '').startsWith('video');
    const cname = CHURCH_NAMES.get(cp) || displayName(cp) || 'Your church';
    const body = (isVideo ? 'New video' : 'New audio clip') + (s.title ? ': ' + s.title : '');
    for (const m of MEMBERS) {
      if (m === cp || !memberIn(m, cp)) continue;
      pushTo(m, { title: cname, body, url: '/', tag: 'sermon-' + String(s.id || s.sha256).slice(0, 10) }, 'announce');   // '/' → Today, where the New card is
    }
  } catch {}
}
// SAFETY CHECK push: alert every member when a check OPENS ("are you safe?"), and nudge the check's creator
// when responses arrive (collapsed to one alert — the creator opens the roll call to see who's safe/in danger).
const SAFETY_PUSHED = new Set();
function maybePushSafety(evt) {
  try {
    if (evt.kind !== 30078 || (evt.id && SAFETY_PUSHED.has(evt.id))) return;
    const d = (evt.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (d.startsWith(SAFETY_D)) {
      const cp = d.slice(SAFETY_D.length);
      if (!CHURCH_PUBS.has(cp) || (evt.pubkey !== cp && !stewardOf(evt.pubkey, cp) && !careAdmin(evt.pubkey, cp))) return;
      let open = true; try { open = !!(JSON.parse(evt.content) || {}).open; } catch {}
      if (!open) return;                                                     // a check being CLOSED → no alert
      SAFETY_PUSHED.add(evt.id);
      const cname = CHURCH_NAMES.get(cp) || displayName(cp) || 'Your church';
      for (const m of MEMBERS) { if (m === evt.pubkey || !memberIn(m, cp)) continue;
        pushTo(m, { title: cname, body: 'Are you safe? Tap to let your church know.', url: '/?safety=1', tag: 'safety-' + cp }, 'announce'); }
    } else if (d.startsWith(SAFE_D)) {
      const cp = d.slice(SAFE_D.length); if (!CHURCH_PUBS.has(cp)) return;
      const p = (evt.tags.find(t => t[0] === 'p') || [])[1]; const creator = p ? (toHexPub(p) || p) : '';
      if (!creator || creator === evt.pubkey) return;
      // only notify an actual check-creator (church / steward / care-team) — a member can't p-tag an arbitrary victim into a push
      if (creator !== cp && !stewardOf(creator, cp) && !careAdmin(creator, cp)) return;
      SAFETY_PUSHED.add(evt.id);
      pushTo(creator, { title: 'Safety check', body: 'Someone responded — open the roll call.', url: '/?safety=rollcall', tag: 'safety-resp-' + cp }, 'announce');
    }
    if (SAFETY_PUSHED.size > 5000) SAFETY_PUSHED.clear();   // bounded: dedup only needs recent ids, not unbounded growth
  } catch {}
}
const dtag = (e) => { const t = (e.tags || []).find(t => t[0] === 'd'); return t ? t[1] : ''; };
// (replaceable/addressable dedup + smart retention now live in event-store.mjs — the durable store owns them.)
const gidOf = (e) => { const t = (e.tags || []).find(t => t[0] === 't' && t[1] !== NET); return t ? t[1] : ''; };
// which church an event counts against for per-church retention: its explicit 'church' tag, else (for chat)
// its group's owning church, else (a member's DMs/reactions) that member's church, else '' (shared bucket).
// NIP-09: a kind-5 deletes the AUTHOR'S OWN referenced events only — applyDeletion() checks authorship against
// the stored row, so a member can retract their own message but never someone else's. It also writes a TOMBSTONE,
// which is what makes the deletion survive: without one, the next negentropy round with a peer that still held the
// event pulled it straight back in. Safe to call on every delivery of the same kind-5 — it is idempotent.
// AUDIT 2026-07-25 (HIGH): unbounded. A single 1 MB frame carries ~14,000 e-tags; applying them was ~900 ms of
// SYNCHRONOUS event-loop stall and 5.4 MB of permanent, un-cullable rows — from one member, one socket. The
// kind-5 itself is ephemeral and gets culled; the tombstones it created never were. Cap it: no honest client
// retracts more than a handful of messages in one event, and the cap is per EVENT, so a real bulk delete just
// sends more of them.
const MAX_DELETE_TAGS = 64;
function applyDeletions(evt) {
  let n = 0;
  for (const t of (evt.tags || [])) {
    if (t[0] !== 'e' || !t[1]) continue;
    if (++n > MAX_DELETE_TAGS) { console.warn(`[relay] kind-5 ${String(evt.id).slice(0, 8)} exceeded ${MAX_DELETE_TAGS} e-tags — ignoring the rest`); break; }
    store.applyDeletion(t[1], evt.pubkey, evt.created_at);
  }
}

function resolveChurch(e) {
  // SECURITY-2026-07-13: honor a self-declared ['church',cp] tag ONLY when the author actually BELONGS to cp. Trusting
  // it blindly let a member of church A tag events ['church', B] and inject them into B's per-church retention bucket
  // (culling B's real chat), B's /export backup, and the corpus B replicates to its trusted relays. Entitled = cp
  // itself / a network / a steward of cp / an EFFECTIVE member of cp (joined ∧ not-blocked ∧ (approved | not-gated),
  // mirrors rebuildMembers). Otherwise fall through to group-owner / member-own-church attribution below.
  const ct = (e.tags || []).find(t => t[0] === 'church'); const cp = ct && ct[1];
  if (cp) {
    const md = MEMBER_DOCS.get(cp), gated = REQUIRE_APPROVAL.has(cp), admitted = ADMITTED_BY.get(cp);
    const effMember = !!(md && md.has(e.pubkey)) && !BLOCKED.has(e.pubkey) && (!gated || !!(admitted && admitted.has(e.pubkey)));
    if (e.pubkey === cp || networkOf(e.pubkey, cp) || stewardOf(e.pubkey, cp) || effMember) return cp;   // B3: scoped
  }
  if (CHURCH_PUBS.has(e.pubkey) || NETWORKS.has(e.pubkey)) return e.pubkey;
  const g = gidOf(e); if (g && GROUP_CHURCH.has(g)) return GROUP_CHURCH.get(g);
  return anyChurchOf(e.pubkey);
}
// (re)build all in-memory church/member/group/care maps from the stored kind-30078 structure docs, oldest-first.
// Run at startup and after a restore/clone import so the imported church's membership + groups take effect at once.
let _hydrating = false;
// Everything note() derives from the event log. Cleared before a re-hydrate so a REMOVED church leaves no
// residue — note() only ever adds, so without this a de-provisioned church kept its members writable and its
// safeguarding lists still governing its ex-minors' DMs until the process restarted (RELAY-AUDIT H1).
// Derived-only: every one of these is rebuilt from stored events by the eachKind pass below, so clearing is
// safe. Deliberately NOT cleared: CHURCH_PUBS/CHURCH_NAMES/MEDIA_HOSTS (owned by loadChurches) and anything
// read from disk rather than derived.
function clearDerivedMaps() {
  for (const m of [MEMBER_DOCS, MEMBER_CHURCHES, GROUP_CHURCH, GROUP_VIS, GROUP_MEMBERS, GROUP_NAMES,
                   GROUP_LEADERS, GROUP_LEADER_BY, STEWARDS_BY, BLOCKED_BY, MINORS_BY, APPROVED_BY,
                   GUARDIANS_BY, NETWORKS_BY, ADMITTED_BY, ROSTER_BY, ROSTER_PEOPLE, MEALS_ADMIN_GROUP,
                   FINANCE_SEQ, CARE_RECIPIENT, CARE_SKIPHASH, PEER_URLS, TRUSTED_RELAYS]) { try { m.clear(); } catch {} }
  for (const s of [BROADCAST, REQUIRE_APPROVAL, MEALS_OPEN_MEMBER]) { try { s.clear(); } catch {} }
}
let _churchHydratePending = false;   // coalesce writeChurches's whole-corpus rehydrate across rapid saves
function hydrateMaps() {
  if (!CHURCH_PUBS.size) return;
  clearDerivedMaps();                                  // H1: drop residue from churches that are no longer configured
  _hydrating = true;                                   // suppress per-doc rebuilds (O(n^2)); rebuild once at the end
  try { store.eachKind([30078], note); }               // uncapped ASC iteration — no 10k truncation of old docs
  finally { _hydrating = false; }
  rebuildBlocked(); rebuildMinors(); rebuildApproved(); rebuildGuardians(); rebuildNetworks();   // rebuildBlocked() also rebuilds MEMBERS from the full maps
}
// MIGRATION (AUDIT-2026-07-24): tombstones are new, so every kind-5 already on disk from an older build has no
// deletions row — and a kind-5 the relay already holds comes back from put() as 'duplicate', which means it would
// NEVER be recorded. Any content that resurrected before the fix would quietly stay resurrected. Replay every
// stored kind-5 once at boot: applyDeletion is idempotent, authorship-checked, and kind-5 counts are tiny, so this
// is cheap and safe to run on every start (it is also the self-heal for a relay that has been resyncing with an
// unpatched peer).
function backfillDeletions() {
  // Watermarked. This replayed every stored kind-5 on every boot, synchronously, before serving anything —
  // ~190 ms per 14k-tag event, so a few thousand of them made the relay take minutes to start, every time, for
  // no benefit after the first pass. Skip when the kind-5 population is unchanged since the last successful
  // run. AUDIT 2026-07-25 (HIGH).
  // Watermark on BOTH populations. Keying on the kind-5 count alone would skip the one case this exists for:
  // an upgraded relay whose kind-5s are all present but whose tombstones are missing entirely.
  let count = 0, tombs = 0;
  try { count = store.countKind(5); tombs = store.countDeletions(); } catch (err) { console.warn('[relay] deletion backfill: store lacks bookkeeping', err && err.message); return; }
  let seen = null;
  try { seen = store.getMeta('deletions_backfill'); } catch {}
  if (seen === count + ':' + tombs) return;
  let n = 0, ev = 0;
  try {
    store.eachKind([5], (e) => {
      ev++;
      let t = 0;
      for (const tag of (e.tags || [])) {
        if (tag[0] !== 'e' || !tag[1]) continue;
        if (++t > MAX_DELETE_TAGS) break;
        if (store.applyDeletion(tag[1], e.pubkey, e.created_at)) n++;
      }
    });
  } catch (err) { console.warn('[relay] deletion backfill failed', err && err.message); return; }
  try { store.setMeta('deletions_backfill', store.countKind(5) + ':' + store.countDeletions()); } catch {}
  if (n) console.log(`[relay] deletion backfill: re-applied ${n} deletion(s) that had resurrected (${ev} kind-5 scanned)`);
}

// persist the current church allow-list to church.json (so a clone-registered church survives a relay restart).
function persistChurches() { try {
  // Mirror writeChurches's on-disk shape: stamp envMigrated and keep by/at provenance. Without envMigrated,
  // loadChurches() re-folds CHURCH_NPUB on the next boot — so a church the operator deliberately removed
  // (which stamped envMigrated) is RESURRECTED the moment an /import clone rewrites church.json here, undoing
  // the C2 removal. Dropping by/at also leaves rows the operator can't place and so can't safely remove.
  const churches = [...CHURCH_PUBS].map(h => { const m = CHURCH_META.get(h) || {}; return { npub: npubEncode(h), name: CHURCH_NAMES.get(h) || '', ...(m.by ? { by: m.by } : {}), ...(m.at ? { at: m.at } : {}) }; });
  const tmp = CHURCH_FILE + '.tmp'; writeFileSync(tmp, JSON.stringify({ churches, envMigrated: true }, null, 2) + '\n'); renameSync(tmp, CHURCH_FILE);
} catch {} }
function note(e) {   // keep MEMBERS / BROADCAST in step with accepted events
  if (!CHURCH_PUBS.size || e.kind !== 30078) return;
  const d = dtag(e), removed = (e.tags || []).some(t => t[0] === 'deleted') || !e.content;
  let cp;   // the church a <cp>-keyed admin doc is for — author is the church itself OR one of its rostered stewards
  if (d.startsWith(MEMBER_D) && CHURCH_PUBS.has(d.slice(MEMBER_D.length))) {   // asked to join / joined one of our churches
    const cp = d.slice(MEMBER_D.length); let s = MEMBER_DOCS.get(cp); if (!s) { s = new Set(); MEMBER_DOCS.set(cp, s); }
    let cs = MEMBER_CHURCHES.get(e.pubkey); if (!cs) { cs = new Set(); MEMBER_CHURCHES.set(e.pubkey, cs); }
    if (removed) { s.delete(e.pubkey); cs.delete(cp); if (!cs.size) MEMBER_CHURCHES.delete(e.pubkey); } else { s.add(e.pubkey); cs.add(cp); }
    if (!_hydrating) rebuildMembers();   // effective membership respects the join policy + admitted list + blocklist
  }
  else if (d.startsWith(NETWORK_D) && CHURCH_PUBS.has(e.pubkey)) {   // a church joined/left a network
    // C4: record WHICH church declared it. The declaring church is the author — a church may only
    // grant network authority over itself, never over its neighbours on a shared relay.
    const np = d.slice(NETWORK_D.length), owner = e.pubkey;
    let s = NETWORKS_BY.get(owner); if (!s) { s = new Set(); NETWORKS_BY.set(owner, s); }
    if (removed) s.delete(np); else s.add(np);
    if (!_hydrating) rebuildNetworks();
  }
  else if (d === RELAYS_D && CHURCH_PUBS.has(e.pubkey)) {   // the church's trusted-relays list (resync peers + full-corpus authorisation)
    const cp = e.pubkey; const pubs = new Set(), urls = new Set();
    if (!removed) { let list = []; try { list = JSON.parse(e.content); } catch {} for (const r of (Array.isArray(list) ? list : [])) { if (r && r.pubkey) pubs.add(String(r.pubkey)); if (r && r.url) urls.add(String(r.url)); } }
    TRUSTED_RELAYS.set(cp, pubs); PEER_URLS.set(cp, urls);
  }
  // B3: scoped — a network key may only define groups for a church that declared it, not for any church.
  else if (d.startsWith(GROUP_D) && (CHURCH_PUBS.has(e.pubkey) || networkOf(e.pubkey, namedChurch(e)) || stewardOf(e.pubkey, namedChurch(e)))) {
    const id = d.slice(GROUP_D.length); let c = {}; try { c = JSON.parse(e.content); } catch {}
    if (!idOwnerOk(GROUP_CHURCH.get(id), e)) return;   // AUDIT-2026-07-24 C1: another church already owns this group id — never let a co-tenant redefine it (rehydrate path too, so a stored forgery can't win on restart)
    if (removed) { BROADCAST.delete(id); GROUP_LEADERS.delete(id); GROUP_LEADER_BY.delete(id); GROUP_VIS.delete(id); GROUP_MEMBERS.delete(id); GROUP_NAMES.delete(id); GROUP_CHURCH.delete(id); GROUP_CHILDSAFE.delete(id); return; }
    if (c.childsafe === true) GROUP_CHILDSAFE.add(id); else GROUP_CHILDSAFE.delete(id);   // safeguarding: adults-only unless the church says otherwise
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
    BLOCKED_BY.set(e.pubkey, set); if (!_hydrating) rebuildBlocked();   // rebuildBlocked() rebuilds MEMBERS (drops the blocked)
  }
  else if (d.startsWith(JOINPOLICY_D) && CHURCH_PUBS.has(cp = d.slice(JOINPOLICY_D.length)) && (e.pubkey === cp || stewardOf(e.pubkey, cp))) {   // a church's join policy
    let approval = false; if (!removed) { try { approval = !!JSON.parse(e.content).approval; } catch {} }
    if (approval) REQUIRE_APPROVAL.add(cp); else REQUIRE_APPROVAL.delete(cp);
    if (!_hydrating) rebuildMembers();
  }
  else if (d.startsWith(ADMITTED_D) && CHURCH_PUBS.has(cp = d.slice(ADMITTED_D.length)) && (e.pubkey === cp || stewardOf(e.pubkey, cp))) {   // a church's approved-members allowlist
    const set = new Set(); if (!removed) { try { (JSON.parse(e.content).pubkeys || []).forEach(p => { const h = toHexPub(p); if (h) set.add(h); }); } catch {} }
    ADMITTED_BY.set(cp, set); if (!_hydrating) rebuildMembers();
  }
  else if (d.startsWith(MINORS_D) && CHURCH_PUBS.has(cp = d.slice(MINORS_D.length)) && e.pubkey === cp) {   // safeguarding: church's minors list — OWNER-ONLY
    const set = new Set(); if (!removed) { try { (JSON.parse(e.content).pubkeys || []).forEach(p => { const h = toHexPub(p); if (h) set.add(h); }); } catch {} }
    MINORS_BY.set(cp, set); if (!_hydrating) rebuildMinors();
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
  else if (d.startsWith(ROSTER_D) && (CHURCH_PUBS.has(e.pubkey) || networkOf(e.pubkey, namedChurch(e)) || stewardOf(e.pubkey, namedChurch(e)))) {   // a team roster — track its LINKED people so care-team admins can be resolved
    const id = d.slice(ROSTER_D.length);
    { const prev = ROSTER_BY.get(id); if (!idOwnerOk(prev && prev.cp, e)) return; }   // AUDIT-2026-07-24 C2: a co-tenant church must not be able to rewrite this team's roster and become its care-admin
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
    // AUDIT-2026-07-30 S2: enforced HERE as well as in accept(), for the same reason ROSTER_D is — a forgery
    // already on disk must not win on rehydrate, when accept() is not in the path at all.
    { if (!idOwnerOk(CARE_CHURCH.get(id), e)) return; }
    if (removed) { CARE_RECIPIENT.delete(id); CARE_SKIPHASH.delete(id); CARE_CHURCH.delete(id); return; }
    { const owner = namedChurch(e) || (CHURCH_PUBS.has(e.pubkey) ? e.pubkey : ''); if (owner) CARE_CHURCH.set(id, owner); }
    // Opaque skip-token hashes in clear TAGS. v3 = one PER DAY: ['skiphash', <iso>, <hash>]; v2 = a single
    // whole-need ['skiphash', <hash>] (kept so a need published before the redesign still skips); v1 carried
    // the recipient pubkey in cleartext content (CARE_RECIPIENT, below).
    const perDay = new Map(); let legacy = '';
    for (const t of (e.tags || [])) {
      if (t[0] !== 'skiphash') continue;
      if (t.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(t[1] || '') && /^[0-9a-f]{64}$/i.test(t[2] || '')) perDay.set(t[1], t[2].toLowerCase());
      else if (/^[0-9a-f]{64}$/i.test(t[1] || '')) legacy = t[1].toLowerCase();
    }
    if (perDay.size || legacy) CARE_SKIPHASH.set(id, { perDay, legacy }); else CARE_SKIPHASH.delete(id);
    try { const r = toHexPub((JSON.parse(e.content) || {}).recipient || ''); if (r) CARE_RECIPIENT.set(id, r); else CARE_RECIPIENT.delete(id); } catch {}
  }
}
// the group id an event-doc is scoped to (its non-NET 't' tag), or '' for a whole-church event
const eventGroup = (e) => { const t = (e.tags || []).find(t => t[0] === 't' && t[1] !== NET); return t ? t[1] : ''; };
function accept(e) {
  if (!CHURCH_PUBS.size) return true;                            // unconfigured = open
  // a network a church belongs to may publish church-style content here (groups/events/plans/posts)
  // REVIEW-2026-07-20 B3: `NETWORKS.has(e.pubkey)` granted church-level WRITE authority for EVERY church on
  // the relay to any key ANY church had declared a network. Scoped: when the event names a church, that
  // church must be the one that declared the network. An event naming no church can still only act for
  // itself — every church-scoped rule below keys off the d-tag suffix, which is checked separately.
  const _netCp = namedChurch(e);
  const isChurch = CHURCH_PUBS.has(e.pubkey), isNetwork = _netCp ? networkOf(e.pubkey, _netCp) : NETWORKS.has(e.pubkey), isLeader = isChurch || isNetwork, isMember = isLeader || MEMBERS.has(e.pubkey);
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
    // SECURITY-AUDIT-2026-07-20 C1 (safeguarding, CRITICAL): a guardian-link REQUEST is d=guardreq:<childpub>,
    // and the steward console renders it as "<parentName> set up a child account for <childName> — Confirm to
    // link them". The console took the parent from a `parent` FIELD IN THE CONTENT, so ANY member could publish
    // a request naming SOMEONE ELSE as the child and THEMSELVES (or anyone) as the parent. One routine-looking
    // click made the attacker a guardian — and guardianLinked() is checked BEFORE the minor gate, so it bought
    // them DM access to a child without youth clearance. Naming an ADULT as the child silently marked that adult
    // a minor, cutting off their DMs. Belt and braces with the console fix (which now uses the signer): the
    // relay refuses any request whose content disagrees with its signer, so an un-updated console is safe too.
    // NOTE: deliberately a VALIDATION guard, not a grant — it falls through to the generic member rule below so
    // the per-member doc cap still applies (d=guardreq:<any pubkey> would otherwise be an unbounded spam vector).
    if (d.startsWith(GUARDREQ_D)) {
      const child = toHexPub(d.slice(GUARDREQ_D.length)) || '';
      if (!child || child === e.pubkey) return false;             // must name a child, and never yourself
      try {
        const c = JSON.parse(e.content || '{}');
        if (c.parent && (toHexPub(c.parent) || c.parent) !== e.pubkey) return false;   // claimed parent ≠ signer
        if (c.child && (toHexPub(c.child) || c.child) !== child) return false;         // content must match the d-tag
      } catch { return false; }
    }
    // the per-church CARE key envelope (d=carekey:<churchpub>) — church key or a current steward of it.
    // The care-need sealing that consumes this is deferred (see care/seal-needs-wip: the key lifecycle needs
    // rework before it is safe to ship). The namespace is reserved and gated NOW so no member can squat the
    // d-tag in the meantime, and CP_SUFFIXED_D already read-gates it to effective members.
    if (d.startsWith(CAREKEY_D)) { const cp = toHexPub(d.slice(CAREKEY_D.length)) || ''; return !!cp && CHURCH_PUBS.has(cp) && (e.pubkey === cp || stewardOf(e.pubkey, cp)); }
    // the per-church NAME key envelope — same authority as the care key.
    if (d.startsWith(NAMEKEY_D)) { const cp = toHexPub(d.slice(NAMEKEY_D.length)) || ''; return !!cp && CHURCH_PUBS.has(cp) && (e.pubkey === cp || stewardOf(e.pubkey, cp)); }
    // a member's OWN sealed name for one church. Only that member may write it — nobody else gets to decide
    // what a person is called, and a forged one would be indistinguishable from theirs once decrypted.
    if (d.startsWith(NAME_D)) {
      const cp = toHexPub(d.slice(NAME_D.length)) || '';
      // Membership, not EFFECTIVE membership: a member awaiting approval must still be able to say what they
      // are called, or a gated church can't show the steward a name to approve. It is their own name, sealed.
      return !!cp && CHURCH_PUBS.has(cp) && !BLOCKED.has(e.pubkey) && !!(MEMBER_DOCS.get(cp) || new Set()).has(e.pubkey);
    }
    // the care-team recipient roster (d=careteam:<churchpub>) — church key or a current steward. Just pubkeys
    // (no secrets), so a member can read it to seal an ask-for-help request to exactly the care team.
    if (d.startsWith(CARETEAM_D)) { const cp = toHexPub(d.slice(CARETEAM_D.length)) || ''; return !!cp && CHURCH_PUBS.has(cp) && (e.pubkey === cp || stewardOf(e.pubkey, cp)); }
    // A member's own safeguarding CLEARANCE (d=clearance:<memberpub>), sealed to them. Church key or a CURRENT
    // steward of the church NAMED IN THE TAG — deliberately not "any church key on the box", which is the shape
    // that let one tenant write guardnotice: docs at another tenant's members. A member must never be able to
    // write their own: that would be self-clearance to contact children. AUDIT-2026-07-27.
    if (d.startsWith(CLEARANCE_D)) {
      const ncp = toHexPub((e.tags.find(t => t[0] === 'church') || [])[1] || '') || '';
      return !!ncp && CHURCH_PUBS.has(ncp) && (e.pubkey === ncp || stewardOf(e.pubkey, ncp));
    }
    // RE-SEAT map (d=reseat:<churchpub>) — church key or a CURRENT steward of that church. This doc says
    // "the person who was <old> is now <new>", so whoever can write it can hand any member's seat to any key.
    // It must never fall through to the generic member rule (see the nophoto: note below for what that costs).
    if (d.startsWith(RESEAT_D)) { const cp = toHexPub(d.slice(RESEAT_D.length)) || ''; return !!cp && CHURCH_PUBS.has(cp) && (e.pubkey === cp || stewardOf(e.pubkey, cp)); }
    // moderation: photo-suppression list — d=nophoto:<churchpub>, owner or a CURRENT steward of that church.
    // (Previously unlisted, so it fell to the generic member rule: any member could rewrite it.)
    if (d.startsWith(NOPHOTO_D)) { const cp = d.slice(NOPHOTO_D.length); return CHURCH_PUBS.has(cp) && (e.pubkey === cp || stewardOf(e.pubkey, cp)); }
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
      || d.startsWith(CATEGORY_D) || d.startsWith(PINSERMON_D)) {
      // AUDIT-2026-07-24 CRITICAL-1/2: group: and roster: ids are relay-GLOBAL, so being *a* church key was
      // enough to rewrite ANOTHER church's group (→ flip invite-only to public) or care-team roster (→ grant
      // yourself care-admin over their private corpus). Refuse at the door once an id has an owner.
      if (d.startsWith(GROUP_D) && !idOwnerOk(GROUP_CHURCH.get(d.slice(GROUP_D.length)), e)) return false;
      if (d.startsWith(ROSTER_D)) { const src = ROSTER_BY.get(d.slice(ROSTER_D.length)); if (!idOwnerOk(src && src.cp, e)) return false; }
      return isLeader || stewardOf(e.pubkey, namedChurch(e));   // SECURITY-AUDIT-2026-06-24 M1: gate category writes
    }
    if (d.startsWith(MEMBER_D) || d.startsWith(NETWORK_D)) return true;   // joining a church / a church joining a network
    if (d.startsWith(STEWARDREQ_D)) {                          // requesting to steward a church — capped (L1: anti-flood)
      // AUDIT-2026-07-30, the sixth of the unscoped write rules. `isMember` is relay-wide, so a member of ANY
      // co-tenant church took the uncapped path into this church's console — and the anti-flood cap below
      // deliberately does not count members, so being a member of somewhere else bypassed it entirely.
      // Scoped: a member OF THIS CHURCH still always gets through; anyone else falls to the capped stranger path
      // below, which is exactly where an outsider volunteering to steward belongs. Not a lockout — the request
      // is still possible, just counted.
      if (churchWriter(e.pubkey, d.slice(STEWARDREQ_D.length))) return true;   // a known member of THAT church asking to help: always
      if (store.query({ kinds: [30078], authors: [e.pubkey], '#d': [d], limit: 1 }).length) return true;   // updating their own pending request
      // P5: bounded scan + early break — was an unbounded limit:1_000_000 fetch on every stranger request
      // (a cheap-request → full-table-scan amplifier). Mirror the M6 kind-0 fix: cap the rows and stop at the cap.
      let pend = 0;
      // Counted against the cap unless they are a member OF THIS CHURCH — the relay-wide MEMBERS union here was
      // the same hole as above: a pending request from any co-tenant church's member was exempt from the count.
      const _reqCp = d.slice(STEWARDREQ_D.length);
      for (const x of store.query({ kinds: [30078], '#d': [d], limit: STEWARDREQ_CAP + MEMBERS.size + 8 })) { if (!effMemberOf(x.pubkey, _reqCp) && ++pend >= STEWARDREQ_CAP) break; }
      return pend < STEWARDREQ_CAP;
    }
    // Meal trains / Care module (optional, per-church) — must precede the generic member fallback:
    if (d === MEALS_SETTINGS_D) return isLeader || stewardOf(e.pubkey, namedChurch(e));   // enable/configure the module: church or rostered steward
    if (d.startsWith(NEED_D)) {                                 // open / edit / close a care need
      // AUDIT-2026-07-30 S2: `care:<id>` is a relay-GLOBAL id and the rule below resolves the owning church from
      // the EVENT, so a co-tenant church naming ITSELF satisfied `e.pubkey === cp` and could republish another
      // congregation's care id. note() then overwrote CARE_SKIPHASH for that bare id, and the genuine recipient's
      // own correct per-day token stopped matching — nobody brings food, and they cannot fix it, silently. Same
      // guard group: and roster: were given in AUDIT-2026-07-24 C1/C2.
      if (!idOwnerOk(CARE_CHURCH.get(d.slice(NEED_D.length)), e)) return false;
      const cp = namedChurch(e) || (isChurch ? e.pubkey : '');
      // B-2: was `isLeader ||`, which an untagged event from any church's network key satisfied for EVERY
      // church — a forged care need in someone else's congregation. Require a resolved owning church.
      // church / steward / care-team admin; or any NON-minor member when the church allows member-opened needs (children never open needs)
      // AUDIT-2026-07-30 S3/S3b: the member clause was `isMember && !MINORS.has(...)` — both relay-wide. A member
      // of any co-tenant church could open a need in this congregation, and any co-tenant church's child marking
      // stopped a named adult ASKING THEIR OWN CHURCH FOR HELP. The church/network/steward/care-admin clauses
      // beside it were already scoped to `cp`; these two were not.
      return !!cp && (e.pubkey === cp || networkOf(e.pubkey, cp) || stewardOf(e.pubkey, cp) || careAdmin(e.pubkey, cp) || (MEALS_OPEN_MEMBER.has(cp) && effMemberOf(e.pubkey, cp) && !minorOf(e.pubkey, cp)));
    }
    // fill a slot: any member OF THE NEED'S OWN CHURCH offers help (keyed by their own pubkey, so they cannot
    // forge another member's).
    // AUDIT-2026-07-30 S2b: this was the relay-wide `isMember`, so a member of any co-tenant church could sign up
    // to help with this congregation's need — the care team then sees a name they cannot place against a day that
    // now looks covered, so nobody else volunteers for it. Scope to the church that opened the need.
    // Unknown care id keeps the previous behaviour: CARE_CHURCH is populated from the need document, so a slot
    // for a need this relay has never seen is one no care team is looking at (same reasoning as the open group).
    if (d.startsWith(SLOT_D)) { const owner = CARE_CHURCH.get(d.slice(SLOT_D.length).split(':')[0]); return owner ? churchWriter(e.pubkey, owner) : isMember; }
    if (d.startsWith(SKIP_D)) {                                 // mark a day "I don't need help": the RECIPIENT, or a steward/care-team blocking a date on their behalf (recipient may not be on the app)
      const parts = d.slice(SKIP_D.length).split(':');
      const careId = parts[0], date = parts[1] || '';
      const cp = namedChurch(e) || (isChurch ? e.pubkey : '');
      // recipient-only, proven WITHOUT identifying them: present THIS day's token, we hash and compare it to
      // the need's per-day hash for THIS date. A token captured for one day cannot skip another. Falls back
      // to the v2 whole-need hash, then the v1 cleartext-recipient check, for needs published before v3.
      const tok = (e.tags.find(t => t[0] === 'skiptok') || [])[1] || '';
      const want = CARE_SKIPHASH.get(careId);
      const wantHash = want && ((want.perDay && want.perDay.get(date)) || want.legacy || '');
      const tokOk = !!(wantHash && tok && createHash('sha256').update(String(tok)).digest('hex') === wantHash);
      // AUDIT-2026-07-24: `isLeader` folds in an UNSCOPED network check for an untagged event, so any church
      // key — or any key any church ever declared a network — could forge "the recipient doesn't need help
      // that day" against ANY need on the box, defeating the per-day skiphash directly above. Same B-2 fix
      // already applied to NEED_D: resolve the owning church and scope to it.
      return !!careId && (tokOk || e.pubkey === CARE_RECIPIENT.get(careId) || (!!cp && (e.pubkey === cp || networkOf(e.pubkey, cp) || stewardOf(e.pubkey, cp) || careAdmin(e.pubkey, cp))));
    }
    // "I'm here to help": any non-minor member of THAT church (keyed by own pubkey; minors excluded — being
    // listed would invite contact from anyone in need).
    // AUDIT-2026-07-30 S4b + S3: both halves were relay-wide. `isMember` let a member of any co-tenant church
    // appear in this congregation's volunteer register, and `MINORS` let any co-tenant church's child marking
    // remove a named adult from their OWN church's register — a targeted, silent denial of service with nothing
    // on screen to explain it. The church is right there in the d-tag; ask about that one.
    if (d.startsWith(AVAIL_D)) { const cp = d.slice(AVAIL_D.length); return CHURCH_PUBS.has(cp) && churchWriter(e.pubkey, cp) && !minorOf(e.pubkey, cp); }
    if (d.startsWith(SAFETY_D)) { const cp = d.slice(SAFETY_D.length); return CHURCH_PUBS.has(cp) && (e.pubkey === cp || stewardOf(e.pubkey, cp) || careAdmin(e.pubkey, cp)); }   // start/close a safety check: church, steward, or care-team admin
    // mark yourself safe / needing help: any member OF THAT CHURCH (minors included — safety matters most).
    // AUDIT-2026-07-30 S4: this was `CHURCH_PUBS.has(cp) && isMember`, relay-wide, and it is the worst place on
    // the box for it. The safety check is the post-emergency roll-call. subscribeSafetyResponses keys results by
    // responder pubkey with no roster filter, and the NIP-44 conversation key is symmetric, so an outsider
    // sealing to the check creator's public key produces a response that DECRYPTS AND DISPLAYS as a genuine
    // "safe" — a steward counting heads after a raid could be counting a stranger.
    if (d.startsWith(SAFE_D)) { const cp = d.slice(SAFE_D.length); return CHURCH_PUBS.has(cp) && churchWriter(e.pubkey, cp); }
    // the care team's RESOLUTION of a request (approved / declined / handled) — d=carereqstatus:<id>. Only the
    // church / a steward / a care-team admin may resolve a request; never the requester (they withdraw instead).
    if (d.startsWith(CAREREQSTATUS_D)) { const cp = namedChurch(e); return !!cp && (e.pubkey === cp || networkOf(e.pubkey, cp) || stewardOf(e.pubkey, cp) || careAdmin(e.pubkey, cp)); }
    // a private "ask for help" request (d=carereq:<id>, content sealed to the care team). Any member — MINORS
    // INCLUDED, since a child in trouble must be able to reach the care team, and it's sealed + care-team-only —
    // may open one. Must name a configured church; then falls through to the member rule so the per-member doc
    // cap (below) still bounds it against a flood of unique d-tags.
    if (d.startsWith(CAREREQ_D) && !namedChurch(e)) return false;
    // a message in a request's shared care-team↔asker thread. Member-writable (so the asker can reply); must
    // name its church, then falls to the member rule + per-member cap. The content is sealed to the care team +
    // asker, so a non-audience write is unreadable garbage the recipients' client filters out on decryption.
    if (d.startsWith(CARECHAT_D)) {
      if (!namedChurch(e)) return false;
      // SAFEGUARDING (relay-enforced): writing INTO a minor asker's thread requires being the asker, or an
      // adult CLEARED to contact that child. A care-team roster seat is NOT youth clearance, so without this a
      // non-cleared care-admin could use the sealed thread to route around the kind-4 minor↔adult gate (the
      // very thing the kind-1059/1060 block guards). Then falls through to the member rule + per-member cap.
      const _p = (e.tags.find(t => t[0] === 'p') || [])[1]; const _asker = _p ? (toHexPub(_p) || _p) : '';
      if (_asker && MINORS.has(_asker) && e.pubkey !== _asker && !safeguardAllows(_asker, e.pubkey)) return false;
    }
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
    // REVIEW-2026-07-20 B-2: `isLeader` folds in an UNSCOPED network check for events carrying no ['church']
    // tag, and kind-1 scopes by GROUP, not by d-tag — so the "every church-scoped rule keys off the d-tag
    // suffix" reasoning did not hold here. A key any church had declared a network could omit the tag and
    // post into ANY other church's broadcast/announcement channel, which canRead then served to that whole
    // congregation, under an attacker-controlled display name. Scope to the group's actual owner.
    if (g && BROADCAST.has(g)) {
      const gcp = GROUP_CHURCH.get(g) || namedChurch(e);
      return !!gcp && (e.pubkey === gcp || networkOf(e.pubkey, gcp) || stewardOf(e.pubkey, gcp));
    }
    // invite-only group. AUDIT-2026-07-24: `isLeader` was unscoped here too (sibling of the BROADCAST fix
    // just above) — any co-tenant church key could post into another congregation's private group.
    if (g && GROUP_VIS.get(g) === 'invite') {
      const gcp = GROUP_CHURCH.get(g) || namedChurch(e); const mem = GROUP_MEMBERS.get(g);
      return (!!gcp && (e.pubkey === gcp || networkOf(e.pubkey, gcp) || stewardOf(e.pubkey, gcp))) || !!(mem && mem.has(e.pubkey));
    }
    // SAFEGUARDING (relay-enforced): a child may only post in a group their church marked child-safe. Was a
    // client-side list filter only, so a modified/old build could post into adult-only rooms.
    // Scoped PER CHURCH, deliberately: MINORS is a relay-wide union of every church's list, and using it here
    // meant a child marking made by ANY of the churches sharing this relay silenced that person in EVERY other
    // congregation's adult rooms — caught on the live box, where an adult member could not post. Whether
    // someone is a child is a judgement only their own church makes, exactly as safeguardAllows() already does.
    if (g && !GROUP_CHILDSAFE.has(g)) { const gcp = GROUP_CHURCH.get(g); const m = gcp && MINORS_BY.get(gcp); if (m && m.has(e.pubkey)) return false; }
    // AUDIT-2026-07-30 S1/S1b: the ORDINARY OPEN GROUP — the one every congregation actually talks in — ended on
    // the relay-wide `isMember`, so a member of ANY church on the box could put arbitrary text and links into
    // another church's chat, delivered to its members as ordinary chat. The identical hole was closed for
    // broadcast groups (:1466) and invite-only groups (:1473, AUDIT-2026-07-24); this branch was not brought
    // along. S1b: `isLeader` folds in NETWORKS relay-wide for an event that names no church, and a kind-1
    // message scopes by GROUP and never names one — so A's declared network could post into B's group too.
    //
    // Ask the scoped question of the group's OWNING church. churchWriter() takes one church, which is what makes
    // multi-church belonging work: someone in three congregations passes for all three, because they are an
    // effective member of each. Never "which church is this person's?".
    //
    // Unknown group → keep the previous behaviour rather than refusing. GROUP_CHURCH is populated from the
    // group's own document, so every group a congregation actually reads from is known here; a group this relay
    // has never seen the document for is one nobody is subscribed to. Default-denying instead would turn a
    // wiped relay (scripts/relay-reset.sh) into a total chat outage until the console republished every group —
    // an outage risk taken on for no reachable attack. The siblings above refuse because a broadcast or
    // invite-only group is defined BY that document; an open group needs no such grant.
    if (g) { const gcp = GROUP_CHURCH.get(g); if (gcp) return churchWriter(e.pubkey, gcp); }
    return isMember;
  }
  if (k === 4) {   // NIP-04 direct message — safeguarding gate
    if (!isMember) return false;
    const target = (e.tags.find(t => t[0] === 'p') || [])[1];
    const targetHex = target ? (toHexPub(target) || target) : '';
    // If either party is a minor, the OTHER party must be cleared BY A CHURCH THAT GOVERNS THAT CHILD (both
    // directions; covers minor↔minor too, since neither is on an approved list). Relay-enforced, client can't
    // bypass. C2: the old rule consulted the relay-wide unions and let ANY configured church key (or any key
    // any church had declared a network) DM any child on the box — safeguardAllows() now scopes both the
    // clearance and the church-authority escape to the churches the child actually belongs to.
    if (!safeguardAllows(e.pubkey, targetHex)) return false;
    if (targetHex && !safeguardAllows(targetHex, e.pubkey)) return false;
    return true;
  }
  if (k === 7) return isMember;                                // reactions
  if (k === 1059 || k === 1060) return false;                 // sealed/gift-wrapped DMs (NIP-17) are unused by this app; block them so they can't route around the kind-4 minor↔adult safeguarding gate. Re-enable with the same gate applied if NIP-17 is ever adopted.
  return isMember;                                               // anything else: members only
}
// read-gate (NIP-42): an invite-only group's messages are served only to a connection that has proven
// (via AUTH) it belongs to that group's member list (or is the church/network). Everything else is public.
// Is `who` an EFFECTIVE member of church cp — joined, not blocked, and admitted where the church gates joins?
// The same rule the kind-30078 branch applies; hoisted so the kind-0/1/5/7 gates cannot drift from it.
function effMemberOf(who, cp) {
  if (!who || !cp) return false;
  const md = MEMBER_DOCS.get(cp);
  const gated = REQUIRE_APPROVAL.has(cp), admitted = ADMITTED_BY.get(cp);
  return !!(md && md.has(who)) && !BLOCKED.has(who) && (!gated || !!(admitted && admitted.has(who)));
}
// May `authed` read content belonging to church cp at all? The church itself, a network it belongs to, one of
// its current stewards, or an effective member.
function churchReader(authed, cp) {
  return !!authed && !!cp && (authed === cp || networkOf(authed, cp) || stewardOf(authed, cp) || effMemberOf(authed, cp));
}
// AUDIT-2026-07-30 S3: is `pub` a child ACCORDING TO CHURCH cp? Whether someone is a child is a judgement only
// their own church makes — the relay-wide MINORS union is every church's list merged, so consulting it lets any
// co-tenant church silence a named person everywhere on the box. safeguardAllows() and the kind-1 child-safe
// check were already scoped for exactly this reason (REVIEW-2026-07-20 B4); hoisted here so the remaining call
// sites cannot drift back onto the union.
function minorOf(pub, cp) {
  const m = cp && MINORS_BY.get(cp);
  return !!(m && m.has(pub));
}
// AUDIT-2026-07-30 S1-S4: the WRITE-side question, for accept(). The set of principals who may act for a church
// is the same on both sides, so this DELEGATES rather than restating the rule — two copies of an authorization
// predicate is how the shared-rules module had already drifted by the time it was written (commit e26accf). The
// separate name exists because `churchReader` at a write site reads as a mistake; if read and write authority
// ever genuinely diverge, split it THEN, with a test for each side.
//
// The one thing this must never become is "which church does this person belong to?" — belonging is not
// exclusive. A person may be a member of several churches and of a church network, so the question is always
// asked of ONE named church: they pass for the churches they belong to and fail for the rest.
function churchWriter(pub, cp) {
  return churchReader(pub, cp);
}
function canRead(e, authed) {
  if (e.kind === 4) {
    const target = (e.tags.find(t => t[0] === 'p') || [])[1];
    const targetHex = target ? (toHexPub(target) || target) : '';
    // SAFEGUARDING (deny to EVERYONE, incl. the parties): never serve a stored minor↔non-cleared-adult DM.
    // Checked first so delivery can't override it. C2: this used the relay-wide MINORS/APPROVED unions and a
    // `churchParty` escape that any configured church key satisfied — so a self-registered church could both
    // clear itself for other churches' children AND DM them directly. Now evaluated per governing church.
    if (!safeguardAllows(e.pubkey, targetHex) || (targetHex && !safeguardAllows(targetHex, e.pubkey))) return false;
    // DEANON Finding 1: a DM's ENVELOPE (sender pubkey + recipient p-tag + timing) is cleartext even though the
    // content is NIP-04-encrypted. Serving it to anyone let an anonymous observer who reaches the relay reconstruct
    // the church's PRIVATE COMMUNICATION GRAPH (who DMs whom, when) — arrest-list-grade metadata, and it unmasks
    // "anonymous" members. Restrict delivery to an ENDPOINT of the conversation. Members always NIP-42-auth, so a
    // recipient still receives their DMs (the auth-challenge trigger fires on a withheld kind-4). NIP-17 gift-wrap
    // is the eventual fix that also hides the graph from the relay ITSELF; this closes the anon-harvest today.
    return !!authed && (authed === e.pubkey || authed === targetHex);
  }
  if (e.kind === 30078) {
    const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (d.startsWith(SAFE_D)) {   // a member's safety response: only the author, the check's CREATOR (p-tag), and the church + its stewards/care-admins may read it (content is NIP-44-encrypted to the creator)
      const cp = d.slice(SAFE_D.length);
      const p = (e.tags.find(t => t[0] === 'p') || [])[1]; const pHex = p ? (toHexPub(p) || p) : '';
      // C3: `CHURCH_PUBS.has(authed)` was unscoped — ANY configured church key read every OTHER church's
      // safety responses. Scope it to the church this response belongs to.
      return !!authed && (authed === e.pubkey || authed === pHex || authed === cp || stewardOf(authed, cp) || careAdmin(authed, cp));
    }
    if (d.startsWith(CAREREQ_D)) {   // a member's private ask-for-help — CARE-TEAM ONLY (mirror SAFE_D), never served to the whole church
      const cp = owningChurch(e, d);
      return !!authed && !!cp && (authed === e.pubkey || authed === cp || stewardOf(authed, cp) || careAdmin(authed, cp));
    }
    if (d.startsWith(CAREREQSTATUS_D)) {   // a request's resolution — the care team AND the p-tagged requester (so the asker sees "approved"/"handled")
      const cp = owningChurch(e, d);
      const p = (e.tags.find(t => t[0] === 'p') || [])[1]; const pHex = p ? (toHexPub(p) || p) : '';
      return !!authed && !!cp && (authed === e.pubkey || authed === cp || stewardOf(authed, cp) || careAdmin(authed, cp) || (!!pHex && authed === pHex));
    }
    if (d.startsWith(CARECHAT_D)) {   // a request thread message — the care team + the p-tagged asker + the author
      const cp = owningChurch(e, d);
      const p = (e.tags.find(t => t[0] === 'p') || [])[1]; const pHex = p ? (toHexPub(p) || p) : '';
      if (!authed || !cp) return false;
      // SAFEGUARDING: if the asker is a minor, only the child + adults CLEARED to contact them (or the child's
      // own church/steward/guardian) may read the thread — a care-team roster seat alone is not clearance.
      if (pHex && MINORS.has(pHex) && authed !== pHex && !safeguardAllows(pHex, authed)) return false;
      return (authed === e.pubkey || authed === cp || stewardOf(authed, cp) || careAdmin(authed, cp) || (!!pHex && authed === pHex));
    }
    // ── kind-30078 read policy: DEFAULT-DENY ──────────────────────────────────────────────────────
    // SECURITY-AUDIT-2026-07-20 C1. This gate used to be a DENY-list of private d-prefixes ending in a
    // world-readable `return true`, so any d-tag nobody remembered to enumerate was served to anonymous
    // clients. That shipped three separate leaks at once:
    //   • group:/roster:/request:/rota: — invite-only group membership (the allowlist is in the cleartext
    //     content) and serving rosters with real names bound to pubkeys;
    //   • the MyData docs (trinityone/highlights|bookmarks|settings) — accept() requires isMember to write
    //     one, so their AUTHORS are by construction the congregation: an anonymous REQ enumerated it;
    //   • trinityone/manna-* — disbursement envelopes, countable even though the content is sealed.
    // The 2026-07-13 fix closed exactly the prefixes THAT audit named and no more, which is precisely why
    // the same class of leak came back under different d-tags. A denylist cannot hold this line: every new
    // feature is a new leak until someone remembers to edit it. So the polarity is inverted — nothing is
    // served unless a rule below says it may be. A forgotten d-tag now fails CLOSED (a feature that doesn't
    // render) instead of OPEN (an arrest list).
    //
    //   1. your own event is always readable by you — MyData (highlights/notes/journal/prayer/settings)
    //      carries no church tag at all, so nothing else could authorise it;
    //   2. an explicit PUBLIC allowlist, justified doc by doc;
    //   3. otherwise: an authenticated effective member / steward / care-admin / the owning church itself.
    if (authed && authed === e.pubkey) return true;
    // PUBLIC: joinpolicy is a bare {approval:bool} with no PII, and a not-yet-joined member must read it
    // before they can join — it is the one document that legitimately precedes membership.
    if (d.startsWith(JOINPOLICY_D)) return true;
    // Resolve the owning church. <prefix><churchpub> d-tags carry it directly; church-authored docs are
    // self-identifying; steward-authored content names it in ['church']; member-authored replies
    // (rsvp:/reqreply:/unavail:/guardreq:/stewardreq:) p-tag it. If none of those resolve, we cannot prove
    // who the doc belongs to, so we cannot prove who may read it → deny.
    const cp = owningChurch(e, d);
    if (!cp) return false;
    // A doc carrying ['church',<cp>] is served only while its author is the church or on <cp>'s CURRENT
    // signed roster — so a revoked steward's content stops being delivered (this check predates the rewrite
    // and is retained: it restricts, never grants).
    //
    // REVIEW-2026-07-20 B1: it must NOT apply to the member-writable doc types. Members church-TAG their own
    // care participation (careslot: "I'll bring Tuesday dinner", careskip: "I don't need help that day",
    // careavail: "I'm here to help") and their safety response — and an ordinary member is neither the church
    // key nor on the steward roster, so this returned false before the member/steward branch below was ever
    // reached. Effect: a steward opened a meal train and saw ZERO sign-ups, and the "here to help" register
    // was invisible to the church — every one of those docs readable only by its own author. The old code
    // never hit this because those prefixes returned earlier from the private-doc block; the rewrite removed
    // that early return. The revoked-steward concern doesn't apply to them anyway: they are members' own
    // events, authorised by authorship, not by delegated church authority.
    // NAME KEY + SEALED NAMES. Both are church-scoped and readable by that church's own people: the envelope
    // carries a copy of the key wrapped to each member, and the names are ciphertext to anyone without it.
    // Serving these to an outsider would defeat the point; withholding them from a member breaks every screen
    // that shows who said something.
    {
      const nkey = d.startsWith(NAMEKEY_D) ? d.slice(NAMEKEY_D.length) : d.startsWith(NAME_D) ? d.slice(NAME_D.length) : '';
      if (nkey) return churchReader(authed, toHexPub(nkey) || nkey) || (!!authed && authed === e.pubkey);
    }
    // SAFEGUARDING READS (AUDIT-2026-07-27). `minors:` is a cleartext list of which members are CHILDREN and
    // `guardians:` maps each child to their parents. Both were readable by any effective member — and joining is
    // a single self-signed publish on an open-join church, so a stranger could have the congregation's children
    // in one frame. The relay keeps reading them itself (safeguardAllows is unchanged); they are simply no
    // longer served to ordinary members. `approved:` — the adults cleared to work with youth — stays readable,
    // because a child's own app needs it to know who they may safely message, and it names leaders, not children.
    // Each member instead receives `clearance:<their pubkey>`, sealed to them, telling them only about THEMSELVES.
    {
      const cpS = d.startsWith(MINORS_D) ? d.slice(MINORS_D.length) : d.startsWith(GUARDIANS_D) ? d.slice(GUARDIANS_D.length) : '';
      if (cpS) return !!authed && (authed === cpS || stewardOf(authed, cpS) || careAdmin(authed, cpS) || networkOf(authed, cpS));
      if (d.startsWith(CLEARANCE_D)) {
        const subj = d.slice(CLEARANCE_D.length);
        const ncp = (e.tags.find(t => t[0] === 'church') || [])[1] || '';
        if (authed && authed === subj) return true;                       // it is about you, and sealed to you
        return !!authed && !!ncp && (authed === ncp || stewardOf(authed, ncp) || careAdmin(authed, ncp));
      }
    }
    const ch = (e.tags.find(t => t[0] === 'church') || [])[1];
    const memberWritable = MEMBER_WRITABLE_D.some(p => d.startsWith(p));
    // A care need (NEED_D) is authored by church / steward / care-team admin / member — accept() gates the
    // write. So, like the member-authored docs above, its read authority is NOT the author's LIVE steward
    // status, and a need shouldn't vanish because the steward who logged it was later revoked. Without this
    // exemption the retraction returned false for every need a CARE-ADMIN or MEMBER opened (neither is in the
    // steward roster), hiding it from EVERYONE — the church and care team included. Sibling of B1, which
    // exempted the sign-ups but missed the need itself. The need's PII is sealed and the authed branch below
    // still restricts readers to effective members of cp, so serving the clear half here is the design.
    const retractionExempt = memberWritable || d.startsWith(NEED_D);
    if (ch && !retractionExempt) { const r = STEWARDS_BY.get(ch); if (!(e.pubkey === ch || (r && r.has(e.pubkey)))) return false; }
    if (!authed) return false;
    // C3: `CHURCH_PUBS.has(authed)` / `NETWORKS.has(authed)` were UNSCOPED — any configured church key, and
    // any key any church had ever declared a network, read every OTHER church's roster, safeguarding lists
    // and care PII. On the shared community relay (where /config self-registration is open by default) that
    // was a cross-tenant read of every congregation on the box. Both are now scoped to THIS church.
    if (authed === cp || networkOf(authed, cp) || stewardOf(authed, cp) || careAdmin(authed, cp)) return true;
    const md = MEMBER_DOCS.get(cp);
    const gated = REQUIRE_APPROVAL.has(cp), admitted = ADMITTED_BY.get(cp);
    return !!(md && md.has(authed)) && !BLOCKED.has(authed) && (!gated || !!(admitted && admitted.has(authed)));
  }
  // ── DEFAULT-ALLOW TAIL, CLOSED. AUDIT-2026-07-27 ──────────────────────────────────────────────────────────
  // This function gated kind-4 and kind-30078 with real care and then ended `if (e.kind !== 1) return true;`,
  // so every other kind fell off the end into default-allow. An anonymous `{"kinds":[0]}` returned every
  // member's display name and verified handle — and on a church's own relay every kind-0 on the box IS a
  // member, i.e. the arrest list. `{"kinds":[7]}` returned reactions, which carry ['p', peer] and ['k','4'] in
  // cleartext, partially reconstructing the exact private conversation graph the kind-4 branch above exists to
  // withhold; kind-0 then puts names to the pubkeys. The kind-30078 branch was rewritten to default-DENY for
  // precisely this reason and the other kinds were never brought along.
  if (e.kind === 0 || e.kind === 5 || e.kind === 7) {
    // Your own event is always yours to read. A member restoring from their 12 words belongs to no church yet,
    // so without this they could not fetch their OWN profile and the restore could never bring their name back.
    if (authed && authed === e.pubkey) return true;
  }
  if (e.kind === 0) {
    // A CHURCH's or a NETWORK's own profile stays public on purpose: someone deciding whether to join has to be
    // able to see the church's name and picture BEFORE they are a member of anything, and the invite/QR/follow
    // flow reads exactly this. Gating it would break joining.
    if (CHURCH_PUBS.has(e.pubkey) || NETWORKS.has(e.pubkey)) return true;
    // ANY church we share is enough. A member of two churches must be readable by both.
    const mine = churchesOf(e.pubkey);
    if (!mine.length) return !!authed && (CHURCH_PUBS.has(authed) || NETWORKS.has(authed) || MEMBER_CHURCHES.has(authed));
    return mine.some(cp => churchReader(authed, cp));
  }
  if (e.kind === 5 || e.kind === 7) {
    const g5 = gidOf(e);
    const gcp = g5 && GROUP_CHURCH.get(g5);
    if (gcp) return churchReader(authed, gcp);
    // No group tag — a DM reaction, say. Attribute it to any church the author belongs to, not to one slot:
    // with a single slot a cross-church reaction was denied to the very peer it was aimed at.
    const mine = churchesOf(e.pubkey);
    if (!mine.length) return !!authed && (CHURCH_PUBS.has(authed) || NETWORKS.has(authed) || MEMBER_CHURCHES.has(authed));
    return mine.some(cp => churchReader(authed, cp));
  }
  // NIP-65 relay list. Published by the CHURCH key only (steward.src.js publishRelayList; a delegated steward
  // cannot), read by members to follow a church whose relay has moved. It advertises relay URLs and no PII, and
  // a member who cannot read it cannot find their church — so it stays public, deliberately and by name.
  if (e.kind === 10002) return true;
  // ── AND THE TAIL IS CLOSED FOR EVERY OTHER KIND. AUDIT-2026-07-29 S1 ─────────────────────────────────────
  // The block above closed the tail for the kinds it enumerated — 0, 5, 7 — and left `if (e.kind !== 1) return
  // true` underneath, so the polarity was still default-ALLOW for anything not on that list. The kind-30078
  // branch was inverted to default-DENY in July precisely because "a denylist cannot hold this line: every new
  // feature is a new leak until someone remembers to edit it". That reasoning applies to KINDS as well, and
  // was not carried across.
  //
  // Demonstrated against a real gateway, publishing as an ordinary member and reading back anonymously:
  //     9802  NIP-84 highlight (a verse you marked)   -> served to a stranger
  //     30000 NIP-51 people set ("praying for")       -> served to a stranger
  //     10003 NIP-51 bookmarks                        -> served to a stranger
  //     30078 church doc (the gated baseline)         -> correctly refused
  // Not exploitable today: the shipped app publishes none of those. But reference/SPINE.md names all three as
  // the intended home for user-owned data, and a "praying for" people set is a congregation's social graph.
  //
  // Reading only. accept() is deliberately NOT tightened alongside this: kind 5 (message deletion) has no
  // explicit rule there and reaches its `return isMember` tail, so refusing unknown kinds on WRITE would stop
  // members deleting their own messages. Storing a kind nobody serves costs a little disk and leaks nothing;
  // the per-church ephemeral budget bounds it.
  if (e.kind !== 1) return !!authed && authed === e.pubkey;   // default-deny — but your own events stay yours
  const g = gidOf(e);
  // SAFEGUARDING: an adults-only group (one the church has NOT marked child-safe) is served only to a reader
  // who has proved they are not a child. Gating on `authed && MINORS.has(authed)` alone would be theatre — a
  // minor closes the loophole by simply not authenticating, and anonymous reads of open groups were allowed.
  // So a non-child-safe group now requires AUTH to read at all, which also stops a passer-by harvesting a
  // congregation's chat. Child-safe groups are unaffected, and the REQ handler challenges for these so a real
  // client authenticates and carries on transparently.
  // MEMBERSHIP — not merely "signed something". AUDIT-2026-07-27, reproduced against a real relay: this used to
  // require only that the reader was `authed`, and AUTH accepts any key that can sign (`verifyEvent(evt) &&
  // !BLOCKED.has(evt.pubkey)`, no membership test). So a keypair generated one second ago read every open group
  // of every church on the box, and a minor closed the safeguarding loophole by simply signing with a second
  // key. The comment this replaces claimed it "stops a passer-by harvesting a congregation's chat" — it did
  // not; it only stopped clients unwilling to sign. The child-safe carve-out made it worse, leaving the rooms
  // containing children as the ONLY anonymously readable chat.
  // Now: a group's messages are served to that group's own church, its network, its stewards, or an EFFECTIVE
  // member of it (joined, not blocked, and admitted where the church gates joins) — the same rule the
  // kind-30078 branch above already applied.
  if (g) {
    if (!authed) return false;
    const gcp = GROUP_CHURCH.get(g);
    if (gcp) {
      if (!churchReader(authed, gcp)) return false;
      // safeguarding, unchanged in intent: an adults-only group is withheld from a minor OF THAT CHURCH.
      if (!GROUP_CHILDSAFE.has(g) && (MINORS_BY.get(gcp) || new Set()).has(authed)) return false;
    } else if (!MEMBER_CHURCHES.has(authed) && !CHURCH_PUBS.has(authed) && !NETWORKS.has(authed)) {
      return false;   // a group we hold no definition for: still never serve it to a total stranger
    }
  }
  // AUDIT-2026-07-30 S5: `!g` fell into this `return true` and was served to ANYONE, unauthenticated. A kind-1
  // with no group tag has no `g`, so the relay stored and served world-readable chat for any client that omitted
  // the tag. Found by accident when a load simulation of mine tagged groups wrongly, then probed deliberately.
  //
  // Not a leak of existing chat — all three publishers in this codebase always tag a group
  // (src/fellowship.src.js:2173, src/steward.src.js:1501 and :2843) — so no legitimate ungrouped message exists.
  // Gated to the author, matching the "your own events stay yours" exception this file already uses for private
  // docs (:1667), rather than refusing the write: reading is the disclosure, and a client that has some reason to
  // publish one keeps it.
  if (!g) return !!authed && authed === e.pubkey;
  if (GROUP_VIS.get(g) !== 'invite') return true;
  if (!authed) return false;
  // REVIEW-2026-07-20 B3: this was the SAME unscoped check the C3/C4 fix removed from the 30078 branch, left
  // behind here — so a key any church had ever declared a network still read every OTHER congregation's
  // invite-only group messages, which is the most sensitive content in the product. Scope both to the church
  // that actually owns this group (GROUP_CHURCH is set from the group def's ['church'] tag or its author).
  const gcp = GROUP_CHURCH.get(g);
  if (gcp && (authed === gcp || networkOf(authed, gcp) || stewardOf(authed, gcp))) return true;
  const mem = GROUP_MEMBERS.get(g); return !!(mem && mem.has(authed));
}

// ---- static file serving ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.jsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.avif': 'image/avif',
  '.gz': 'application/gzip', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
  '.ico': 'image/x-icon', '.map': 'application/json',
  '.apk': 'application/vnd.android.package-archive', '.webmanifest': 'application/manifest+json',
  // self-hosted tutorial/help + sermon media — without these a .mp4 served as octet-stream won't play inline
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.oga': 'audio/ogg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.vtt': 'text/vtt; charset=utf-8',   // WebVTT captions/subtitles for <track>
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
// Stream an NDJSON response line-by-line, invoking onLine(str) per non-empty line, without ever holding the whole
// body (or a split() copy of it) in memory — a first church sync can be up to MAX_IMPORT (256 MB). Enforces the
// byte cap as it reads. On a mid-stream cap the lines already delivered stay imported (content-addressed → the next
// pass dedups and resumes), so it makes forward progress instead of the all-or-nothing buffered read.
async function forEachNdjsonLine(r, maxBytes, onLine) {
  const cl = Number(r.headers.get('content-length') || 0);
  if (cl && cl > maxBytes) throw new Error('response too large');
  if (!r.body) { const t = await r.text(); if (t.length > maxBytes) throw new Error('response too large'); for (const line of t.split('\n')) { const s = line.trim(); if (s) onLine(s); } return; }
  const reader = r.body.getReader(); const dec = new TextDecoder('utf-8'); let buf = '', total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length; if (total > maxBytes) { try { await reader.cancel(); } catch {} throw new Error('response too large'); }
    buf += dec.decode(value, { stream: true });
    let nl; while ((nl = buf.indexOf('\n')) >= 0) { const s = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (s) onLine(s); }
  }
  buf += dec.decode(); const s = buf.trim(); if (s) onLine(s);   // flush any trailing partial (no final newline)
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
// Auto-detect: engage the strict, eval-free CSP only when BOTH served shells are pre-transpiled (no in-browser
// Babel). Requiring both avoids the mismatch where a strict index.html forces a CSP that breaks a still-lax
// steward.html — the shell that holds the church key, where an XSS backstop matters most.
try {
  if (!_strictWeb) {
    const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
    let stw = ''; try { stw = readFileSync(join(ROOT, 'steward.html'), 'utf8'); } catch {}
    _strictWeb = !idx.includes('type="text/babel"') && !stw.includes('type="text/babel"');
  }
} catch {}
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
// The control panel polls /tailscale/state every 4s while open; each tsState() spawns 1–3 tailscale CLIs.
// Cache it briefly so an open panel doesn't churn subprocesses for state that changes on the order of minutes.
// Actions (up/funnel) reset _tsCacheAt so they still read fresh.
let _tsCache = null, _tsCacheAt = 0;
async function tsStateCached() { if (_tsCache && Date.now() - _tsCacheAt < 8000) return _tsCache; _tsCache = await tsState(); _tsCacheAt = Date.now(); return _tsCache; }
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

// C1/thin-pipe: gzip compressible text assets on the fly, cached by path+mtime. The app bundle is ~2–5 MB of JS
// served UNCOMPRESSED — minutes on 2G for a self-hosted relay (a8 gets Cloudflare edge gzip; self-hosts don't). gzip
// is ~3–4× on JS, and caching means we compress each asset at most once no matter how many members cold-load it.
const GZIP_TYPES = new Set(['.js', '.mjs', '.jsx', '.css', '.json', '.svg', '.txt', '.xml', '.map', '.wasm', '.html']);
const _gzCache = new Map();   // filepath -> { mtimeMs, buf }
const _acceptsGzip = (req) => /(^|,)\s*gzip\b/i.test(req.headers['accept-encoding'] || '');
function _gzipFile(file, mtimeMs) {
  const c = _gzCache.get(file);
  if (c && c.mtimeMs === mtimeMs) return c.buf;
  let buf; try { buf = gzipSync(readFileSync(file), { level: 6 }); } catch { return null; }
  if (_gzCache.size > 400) _gzCache.clear();   // bounded — the asset set is small; a full clear is fine on overflow
  _gzCache.set(file, { mtimeMs, buf });
  return buf;
}
function _gzipBuf(body) { try { return gzipSync(body, { level: 6 }); } catch { return null; } }

function serveStatic(req, res) {
  const route = (req.url || '/').split('?')[0];
  // relay status (for the Relay app control dashboard)
  // Dashboard aggregates for the operator's own console. ADMIN-ONLY and default-deny: /status is public
  // and deliberately stays coarse, but this breaks activity down BY CHURCH and by kind — a per-church
  // publishing rhythm ("this congregation went quiet in March") is exactly the pattern an observer with a
  // seized relay would want, so it never leaves the admin boundary. See [read gates must default-deny].
  if (route === '/stats') {
    if (!adminOK(req)) { res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":"unauthorized"}'); return; }
    const days = Math.max(1, Math.min(365, parseInt((req.url.match(/[?&]days=(\d+)/) || [])[1] || '30', 10) || 30));
    let act = { days, daily: [], kinds: [], churches: [], oldest: 0 };
    try { if (store.activity) act = store.activity(days); } catch (e) { /* a broken aggregate must not take the console down */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true, ...act,
      // resolve pubkeys to the names the operator configured — the console would otherwise print raw npubs.
      // CHURCH_NAMES is the module-level map; curChurches() is scoped to the /config handler, not here.
      churches: (act.churches || []).map(c => ({ ...c, name: CHURCH_NAMES.get(c.church) || '' })),
      media: { bytes: _mediaBytesTotal, capBytes: effMediaCap() },
      uptimeMs: Date.now() - STARTED_AT,
    }));
    return;
  }
  if (route === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    // OK MEANS "THIS RELAY IS DOING ITS JOB", not "the process is running". A relay that is up, listening and
    // refusing every write is the worst state to report as healthy: nothing is saved, the clients are told
    // nothing, and every dashboard stays green. AUDIT 2026-08-02.
    res.end(JSON.stringify({
      ok: !STORE_DEGRADED, port: PORT, uptimeMs: Date.now() - STARTED_AT,
      ...(STORE_DEGRADED ? { degraded: { since: STORE_DEGRADED.at, reason: STORE_DEGRADED.why, what: 'storage' } } : {}),
      // FREE SPACE, because the retention cull cannot prevent a full disk. That budget counts EPHEMERAL
      // EVENTS per church — it never touches members, rosters, groups, care, safeguarding or finance (kept
      // for ever by design) and it cannot see media files at all, which are the largest thing on the disk.
      // Nothing anywhere watched actual space, so the first sign of a full disk was silence.
      storage: (() => {
        try {
          const st = statfsSync(DATA_DIR);
          const total = Number(st.blocks) * Number(st.bsize), free = Number(st.bavail) * Number(st.bsize);
          return { freeBytes: free, totalBytes: total, usedPct: total ? Math.round((1 - free / total) * 100) : null };
        } catch (e) { return null; }
      })(),
      version: BUILD.sha, versionShort: BUILD.short, builtAt: BUILD.date, origin: ORIGIN,   // for the dashboard's update check
      // C1: on a RELEASE HOST, what this box would hand the fleet if a relay pulled right now. Absent on an
      // ordinary relay. Surfaced so "which code is being released?" is answerable without shell access —
      // a8 ran a parked branch's WIP commit for a day and nothing anywhere said so.
      ...(existsSync(RELEASE_KEY) ? { releases: (() => {
        const ref = process.env.RELEASE_REF || 'main';
        try {
          const g = spawnSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', ref + '^{commit}'], { encoding: 'utf8' });
          if (g.status !== 0 || !g.stdout.trim()) return { ref, sha: null };
          const sha = g.stdout.trim();
          const d = spawnSync('git', ['-C', ROOT, 'show', '-s', '--format=%cI', sha], { encoding: 'utf8' });
          return { ref, sha, short: sha.slice(0, 7), builtAt: d.status === 0 ? d.stdout.trim() : '' };
        } catch { return { ref, sha: null }; }
      })() } : {}),
      sync: { ..._lastSync, running: _syncing, peers: PEER_URLS.size },   // is auto-sync actually working?
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
            const auth = relayNameClaim(handle, myUrl, offerMeta());   // post the signed claim to every directory peer
            const results = await Promise.allSettled(DIRECTORY_PEERS.map(peer => fetch(peer + '/relay-names/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': auth }, body: JSON.stringify({ handle, url: myUrl }), signal: AbortSignal.timeout(8000) })));
            const okOne = results.find(x => x.status === 'fulfilled' && x.value && x.value.ok);
            if (!okOne) {
              const bad = results.find(x => x.status === 'fulfilled'); let err = 'no directory accepted that name';
              if (bad) { try { err = (await bad.value.json()).error || err; } catch {} }
              res.writeHead(409, H); res.end(JSON.stringify({ error: err })); return;
            }
            MY_RELAY_NAME = handle; try { writeFileSync(MYNAME_FILE, JSON.stringify({ handle }) + '\n'); } catch {}
            res.writeHead(200, H); res.end(JSON.stringify({ ok: true, handle, url: myUrl, directories: DIRECTORY_PEERS.length }));
          } catch (e) { res.writeHead(502, H); res.end(JSON.stringify({ error: 'could not reach any name directory' })); }
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
    // Discovery list: relays that told us they're OPEN to host, claimed recently (a rough liveness filter — a
    // relay re-claims on every go-public/boot). The CLIENT still probes each one's NIP-11 to confirm it's live +
    // actually open before showing it, so a stale entry here is harmless. This is what makes Auto-find global.
    if (req.method === 'GET' && route === '/relay-names/offers') {
      const now = Math.floor(Date.now() / 1000), MAX_AGE = 14 * 86400;
      const relays = Object.entries(RELAY_NAMES)
        .filter(([, r]) => r && r.url && r.offer && r.offer.open && (now - (r.at || 0) < MAX_AGE))
        .map(([handle, r]) => ({ handle, url: r.url, churches: (r.offer.churches | 0), region: r.offer.region || '', operator: r.offer.operator || '' }))
        .sort((a, b) => (a.churches || 0) - (b.churches || 0))
        .slice(0, 200);
      res.writeHead(200, H); res.end(JSON.stringify({ relays })); return;
    }
    if (req.method === 'POST' && route === '/relay-names/claim') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        // The claim is the signed event in the Authorization header (offer + handle + url are all inside it). We
        // store that exact event so it can be gossiped to other directories, self-verifying.
        const hh = req.headers['authorization'] || '';
        let ev = null; try { if (/^Nostr /i.test(hh)) ev = JSON.parse(Buffer.from(hh.slice(6), 'base64').toString('utf8')); } catch {}
        const rec = verifyClaimEvent(ev, 120);
        if (!rec) { res.writeHead(401, H); res.end('{"error":"claim must be a fresh event signed by the relay identity key, binding handle + url"}'); return; }
        const existing = RELAY_NAMES[rec.handle];
        if (existing && existing.pub !== rec.pub) { res.writeHead(409, H); res.end('{"error":"that name is already taken by another relay"}'); return; }
        applyClaimRecord(rec);
        res.writeHead(200, H); res.end(JSON.stringify({ ok: true, handle: rec.handle, url: rec.url, pub: rec.pub }));
      });
      return;
    }
    // Gossip sync: GET returns this directory's signed records (optionally newer than ?since); POST merges a
    // peer's records (each re-verified, latest-wins). Peers pull each other on a timer, so the whole directory
    // converges across every relay — no single host owns it.
    if (route === '/relay-names/sync') {
      if (req.method === 'GET') {
        let since = 0; try { since = parseInt(new URL(req.url, 'http://x').searchParams.get('since') || '0', 10) || 0; } catch {}
        const records = Object.values(RELAY_NAMES).filter(r => r && r.ev && (r.at || 0) > since).map(r => r.ev).slice(0, 5000);
        res.writeHead(200, H); res.end(JSON.stringify({ records, now: Math.floor(Date.now() / 1000) })); return;
      }
      if (req.method === 'POST') {
        // DoS: this is unauthenticated and each record costs a schnorr verify. Serialize (one merge at a time),
        // cap the batch, and yield to the event loop between chunks so a flood of junk records can't freeze the relay.
        if (_gossipMergeBusy) { res.writeHead(429, H); res.end('{"error":"busy — try again shortly"}'); return; }
        let body = ''; req.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); });
        req.on('end', async () => {
          let arr = []; try { arr = JSON.parse(body || '{}').records || []; } catch {}
          arr = arr.slice(0, 1000);
          _gossipMergeBusy = true; let merged = 0;
          try {
            for (let i = 0; i < arr.length; i++) {
              const rec = verifyClaimEvent(arr[i], 0); if (rec && applyClaimRecord(rec)) merged++;
              if ((i & 31) === 31) await new Promise(r => setImmediate(r));   // unblock the loop every 32 verifies
            }
          } finally { _gossipMergeBusy = false; }
          try { res.writeHead(200, H); res.end(JSON.stringify({ merged })); } catch {}
        });
        return;
      }
    }
    res.writeHead(404, H); res.end('{"error":"not found"}'); return;
  }
  // Cloudflare quick-tunnel control (desktop "go public", no account). Admin-gated.
  if (route === '/tunnel/up' || route === '/tunnel/state' || route === '/tunnel/down' || route === '/tunnel/log') {
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
    const blobs = _churchBlobList(cp);
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
    runSync().then((n) => { res.writeHead(200, H); res.end(JSON.stringify(n === null ? { ok: true, busy: true } : { ok: true, imported: n, churches: CHURCH_PUBS.size })); })
      .catch(() => { res.writeHead(500, H); res.end('{"error":"sync failed"}'); });
    return;
  }
  // resync media (manifest): the sha256 + size of every blob this relay holds for a church, to a TRUSTED peer
  // relay — it compares against its own and pulls only what it's missing (below). Same trust gate as /sync.
  if (route === '/sync-media' && req.method === 'GET') {
    const cp = _syncAuth(req, req.headers['host'] || '', '/sync-media');
    const q = new URL(req.url, 'http://x').searchParams;
    if (!cp || q.get('church') !== cp) { res.writeHead(401, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('unauthorized'); return; }
    const blobs = _churchBlobList(cp);
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
    const file = join(BLOB_DIR, sha); let st; try { st = statSync(file); } catch { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store', ...SEC_HEADERS });
    createReadStream(file).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);   // stream, don't buffer a 200MB blob in RAM
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
        // SECURITY-2026-07-13: /import self-registered ANY fresh church key, bypassing the inviteOnly lock + the
        // registration cap that the self-register route (below) enforces — so an attacker could seed unlimited
        // churches on an invite-only relay (each new church key = an isLeader, the precondition for cross-church
        // mischief). Apply the SAME guards here.
        if (fresh && SETTINGS.inviteOnly) { res.writeHead(403, H); res.end('{"error":"this relay is invite-only — ask the operator to add your church"}'); return; }
        // RELAY-AUDIT-2026-07-20 H4, applied here too: /config addChurch gained a BOOTSTRAP-ONLY lock — on a
        // private (non-community) relay that already carries a church, a fresh key can't self-register. /import
        // kept only the inviteOnly + cap guards, so a fresh keypair with a NIP-98 proof could seed itself on a
        // private relay through the clone path, minting an isLeader. Mirror the /config gate exactly.
        if (fresh && !(OFFER_OPEN || SETTINGS.offerHosting) && CHURCH_PUBS.size) { res.writeHead(403, H); res.end('{"error":"this relay is already set up for its church — ask the operator to add yours, or turn on Offer to host other churches"}'); return; }
        if (fresh && CHURCH_PUBS.size >= CHURCH_REPLACE_CAP) { res.writeHead(429, H); res.end('{"error":"registration capacity reached — contact the relay operator"}'); return; }
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
            if (r === 'stored') imported++;
            if (e.kind === 5) applyDeletions(e);   // ALWAYS — a kind-5 we already hold ('duplicate') still has to be applied, or a restore silently resurrects everything it deleted
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
        // R4: enforces = this relay ACTUALLY applies TrinityOne's membership/safeguard write policy — true only
        // when a church key is configured. An open/misconfigured/dev relay (no church) reports false, so a
        // member's capability gate (_verifyEnforcing) refuses to adopt it and never routes gated reads (roster,
        // care PII) to a box that would serve them to anyone. Was hardcoded true, which made the gate a no-op.
        enforces: CHURCH_PUBS.size > 0, multiChurch: true,
        relayPub: RELAY_PUB,                  // R3: this relay's identity key — lets a client tell two URLs apart as the SAME box (dedup the self-sufficiency count by failure-domain, not URL)
        media: !MEDIA_OFF,                    // does this relay host self-hosted media (blobs)? — the client hides the upload UI when false
        // OFFER fields (Phase 3a) appear ONLY when the operator opted in via RELAY_OPEN — a private relay omits
        // them entirely, so discovery/auto-pick never surfaces it. `full` lets a busy relay decline new churches
        // without going offline. `churches` is a load hint (already exposed unauthenticated in /status counts).
        ...((OFFER_OPEN || SETTINGS.offerHosting) ? {
          // `open` = actually accepting new churches now: not invite-only, and not at the church cap. A relay can
          // advertise (appear in discovery) yet be closed to self-join (invite-only) — it shows as full/closed.
          open: !SETTINGS.inviteOnly && !(OFFER_CAP && CHURCH_PUBS.size >= OFFER_CAP),
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
    // ARCHITECTURE-AUDIT-2026-07-30 A4. ASK BEFORE PROMISING. The 200 below used to be written before the
    // `git archive` spawn, so a host that could not produce a bundle had already claimed success by the time
    // it found out — and all it could do was destroy the socket, which through a tunnel arrives as a clean,
    // EMPTY, successful response. Measured on a8: 200 with 0 bytes, three polls, /status healthy throughout.
    // An installed relay is unpacked from a tarball, so it has no .git and this was its normal answer.
    //
    // That is indistinguishable from a zero-byte release to the documented installer: relay-app/install.sh
    // fetches with `curl -f`, which only fails on an error STATUS. It does fail safe one step later (tar
    // exits 2 on an empty archive) but reports "couldn't unpack the code bundle" — pointing the operator at
    // the file instead of at the machine.
    //
    // The right shape was already four lines below, in /relay-app/bundle.sig, which has always refused
    // honestly. Same file, same question, adjacent routes — one honest, one not. This is the "applied here
    // and not to its neighbour" class scripts/trinity-rules.mjs exists for, sitting in the release path.
    //
    // Deliberately a cheap probe rather than buffering the archive: a release host must keep STREAMING (the
    // bundle is ~50 MB and every relay self-update pulls it), so the only thing established up front is
    // whether a source checkout exists at all. spawnSync is fine on this route — ensureSignedBundle above
    // already shells out synchronously on the same path, and this is a rare, cacheable request.
    const canArchive = spawnSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { encoding: 'utf8' });
    if (canArchive.status !== 0) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('no bundle (this host has no release key and no source checkout, so it does not publish releases — fetch it from the release host)');
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
      tsStateCached().then(s => { res.writeHead(200, H); res.end(JSON.stringify(s)); })
        .catch(e => { res.writeHead(200, H); res.end(JSON.stringify({ installed: true, error: String((e && e.message) || e) })); });
      return;
    }
    if (route === '/tailscale/up' && req.method === 'POST') {
      _tsCacheAt = 0;   // an action is happening → next /state read must be fresh
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
      _tsCacheAt = 0;
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
    const curChurches = () => [...CHURCH_PUBS].map(p => { const m = CHURCH_META.get(p) || {};
      return { npub: npubEncode(p), name: CHURCH_NAMES.get(p) || '', by: m.by || '', at: m.at || 0 }; });
    // RELAY-AUDIT-2026-07-20 H1: loadChurches() rebuilds ONLY CHURCH_PUBS/CHURCH_NAMES/MEDIA_HOSTS. Every
    // other map — MEMBER_DOCS, MEMBERS, GROUP_CHURCH, STEWARDS_BY, BLOCKED_BY, MINORS_BY, APPROVED_BY,
    // GUARDIANS_BY, NETWORKS_BY, ADMITTED_BY, REQUIRE_APPROVAL, MEALS_*, ROSTER_*, FINANCE_SEQ — is only
    // ever filled by note() on live writes or by hydrateMaps() at boot. So a config change left them stale
    // in BOTH directions, and neither was recoverable without a restart the dashboard doesn't offer:
    //   • remove a church → its ex-members' writes were still ACCEPTED, and its safeguarding lists still
    //     governed its ex-minors' DMs;
    //   • add (or re-add) a church → its congregation was LOCKED OUT ("blocked: not a member") even though
    //     their member: docs were sitting in SQLite, while the dashboard said "✓ Saved — members can join
    //     now". That is the state you land in after a restore, a box migration, or undoing a mis-click.
    // /import already got this right (see the hydrateMaps() call on the import path); config never did.
    // `envMigrated` stamps the one-time CHURCH_NPUB fold-in described in loadChurches().
    const writeChurches = (list) => {
      const tmp = CHURCH_FILE + '.tmp';
      // keep provenance on disk — a row the operator cannot place is a row they cannot safely remove
      const withMeta = list.map(c => { const h = toHexPub(c.npub) || ''; const m = CHURCH_META.get(h) || {};
        return { npub: c.npub, name: c.name || '', ...(c.by || m.by ? { by: c.by || m.by } : {}), ...(c.at || m.at ? { at: c.at || m.at } : {}) }; });
      writeFileSync(tmp, JSON.stringify({ churches: withMeta, envMigrated: true }, null, 2) + '\n');
      renameSync(tmp, CHURCH_FILE);
      loadChurches();
      // Coalesce the whole-corpus rehydrate: if several saves land in quick succession, run it ONCE after
      // they settle rather than one full scan per save.
      if (!_churchHydratePending) { _churchHydratePending = true; setImmediate(() => { _churchHydratePending = false; try { hydrateMaps(); } catch (e) { console.error('[config] hydrateMaps failed', e); } }); }
    };
    if (req.method === 'GET') {
      if (!isAdmin) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }   // don't leak the church list
      res.writeHead(200, H);
      // ?stats=1 adds what each church actually HOLDS. Opt-in because it is a per-church count query;
      // the dashboard asks for it when rendering the list so a row can be judged before it is removed
      // ("this one has 2,180 messages and 340 MB" vs "this one has never published anything").
      const wantStats = /[?&]stats=1/.test(req.url || '');
      let list = curChurches();
      if (wantStats) list = list.map(c => { const h = toHexPub(c.npub) || '';
        const blobs = _churchBlobList(h);
        return { ...c, events: store.countChurchData ? store.countChurchData(h) : 0,
                 blobs: blobs.length, bytes: blobs.reduce((a, b) => a + (b.size || 0), 0) }; });
      res.end(JSON.stringify({ ok: true, port: PORT, configured: CHURCH_PUBS.size > 0, churches: list }));
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
              // invite-only: the operator has locked the relay — only the admin token may add churches, so a
              // signed self-registration is refused outright (no matter how valid the proof).
              if (SETTINGS.inviteOnly) { res.writeHead(403, H); res.end(JSON.stringify({ error: 'this relay is invite-only — ask the operator to add your church' })); return; }
              // RELAY-AUDIT-2026-07-20 H4 — BOOTSTRAP-ONLY self-registration on a PRIVATE relay.
              // Self-registration exists so the setup flow is effortless: install the relay, open your
              // Steward console, and it registers itself. On a private (single-church) relay that is needed
              // exactly ONCE. Leaving it open forever is what silently turned one box into 19 tenants — every
              // pass through "create a church" mints a fresh key and registers it, and nothing ever removes
              // one. So once a private relay has a church, further self-registration is refused and the
              // operator adds any additional church deliberately, with the admin token.
              // A COMMUNITY relay (Offer to host) stays open — inviting other churches is the whole point of
              // that switch, and turning it into a lock would advertise a relay nobody could join.
              const community = OFFER_OPEN || SETTINGS.offerHosting;
              const alreadyRegistered = CHURCH_PUBS.has(hex);
              if (!community && CHURCH_PUBS.size && !alreadyRegistered) {
                res.writeHead(403, H);
                res.end(JSON.stringify({ error: 'this relay is already set up for its church. Ask the operator to add yours, or turn on “Offer to host other churches”.' }));
                return;
              }
              // H4: a nameless registration is unidentifiable in the dashboard forever — the root call sites
              // pass name:'' and the server only overwrites a name when non-empty, which is why 37 of this
              // box's 41 rows show a bare npub the operator cannot safely act on. Require one for a NEW
              // self-registration (an existing church re-announcing itself is fine, and may update its name).
              if (!alreadyRegistered && !String(parsed.addChurch.name || '').trim()) {
                res.writeHead(400, H);
                res.end(JSON.stringify({ error: 'set your church’s name in the Steward console before connecting it to a relay' }));
                return;
              }
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
            if (!isAdmin && !existing && list.length >= CHURCH_REPLACE_CAP) { res.writeHead(429, H); res.end(JSON.stringify({ error: 'registration capacity reached — contact the relay operator' })); return; }
            // Only rewrite + rehydrate when something actually changed. A re-announce of an already-registered
            // church with no new name is a no-op — and writeChurches ends with a whole-corpus rehydrate, so
            // without this an attacker who self-registered once could loop signed re-announces of the same key
            // and force a church.json rewrite + structure-doc rescan on each (Fable audit #1).
            let changed = false;
            if (existing) { if (name && existing.name !== name) { existing.name = name; changed = true; } }
            else { list.push({ npub: npubEncode(hex), name, by: isAdmin ? 'operator' : 'self', at: Math.floor(Date.now() / 1000) }); changed = true; }
            if (changed) writeChurches(list);
            res.writeHead(200, H); res.end(JSON.stringify({ ok: true, added: npubEncode(hex), configured: true, churches: isAdmin ? list : undefined }));
            return;
          }
          // removeChurch — admin only. De-provision a church AND, optionally, erase its data.
          // RELAY-AUDIT-2026-07-20 H3: until now, removing a church deleted nothing. Its events stayed in
          // the DB forever (structured docs are exempt from culling), became unreadable to everyone once
          // owningChurch() could no longer resolve them, kept counting toward /status and the media cap, and
          // could not be reclaimed from any UI — so an operator could neither free the disk nor honour a
          // request to erase a congregation's history. `{ removeChurch: { npub } }` alone is a dry run that
          // reports what WOULD be deleted; erasing requires an explicit `purge: true`, so the scale is always
          // visible before the irreversible step.
          if (parsed.removeChurch) {
            if (!isAdmin) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
            const hex = toHexPub(String(parsed.removeChurch.npub || '').trim());
            if (!hex) { res.writeHead(400, H); res.end(JSON.stringify({ error: 'not a valid npub' })); return; }
            const events = store.countChurchData ? store.countChurchData(hex) : 0;
            const blobs = _churchBlobList(hex);
            const bytes = blobs.reduce((a, b) => a + (b.size || 0), 0);
            // Three modes, deliberately distinct: no flags = DRY RUN (report the scale, change nothing);
            // confirm = de-provision but KEEP the data; confirm + purge = de-provision and ERASE it.
            // Keeping 'remove' and 'erase' separate matters — an operator may remove a church to protect
            // it, and must not have its history deleted as a side effect of that intent.
            if (!parsed.removeChurch.confirm && !parsed.removeChurch.purge) {   // dry run
              res.writeHead(200, H);
              res.end(JSON.stringify({ ok: true, dryRun: true, npub: npubEncode(hex), name: CHURCH_NAMES.get(hex) || '', wouldDelete: { events, blobs: blobs.length, bytes } }));
              return;
            }
            // C4 again: never let a purge leave the relay with no churches, which would open it to the world.
            const remaining = curChurches().filter(c => toHexPub(c.npub) !== hex);
            if (!remaining.length && CHURCH_PUBS.has(hex)) {
              res.writeHead(400, H);
              res.end(JSON.stringify({ error: 'that is the only church on this relay — removing it would let anyone on the internet write here. Add another first, or turn the relay off.' }));
              return;
            }
            const wantPurge = !!parsed.removeChurch.purge;
            const r = wantPurge && store.purgeChurch ? store.purgeChurch(hex) : { events: 0 };
            let blobsDeleted = 0, bytesFreed = 0;
            for (const b of (wantPurge ? blobs : [])) {
              try { unlinkSync(join(BLOB_DIR, b.sha)); blobsDeleted++; bytesFreed += (b.size || 0); } catch {}
              try { unlinkSync(join(BLOB_DIR, b.sha + '.church')); } catch {}
            }
            // keep the media accounting honest — only subtract what actually went (see the DELETE /blob note)
            if (wantPurge) { _mediaBytesTotal = Math.max(0, _mediaBytesTotal - bytesFreed);
              _mediaBytesByChurch.delete(hex); _blobsByChurch.delete(hex); }
            if (CHURCH_PUBS.has(hex)) writeChurches(remaining);   // also re-hydrates the derived maps (H1)
            else setImmediate(() => { try { hydrateMaps(); } catch {} });
            console.log(`[config] ${wantPurge ? 'purged' : 'removed'} church ${hex.slice(0, 8)}… — ${r.events} events, ${blobsDeleted} blobs, ${bytesFreed} bytes`);
            res.writeHead(200, H);
            res.end(JSON.stringify({ ok: true, removed: npubEncode(hex), purged: wantPurge ? { events: r.events, blobs: blobsDeleted, bytes: bytesFreed } : null, churches: curChurches() }));
            return;
          }
          // full replace — admin token only (rewrites the whole write policy)
          if (!isAdmin) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
          const churches = parsed.churches;
          if (!Array.isArray(churches)) throw new Error('expected { churches: [...] } or { addChurch: {…} }');
          // RELAY-AUDIT-2026-07-20 C3: this used to be `churches.slice(0, 50)` — over 50 rows the surplus was
          // silently DELETED and the operator got `ok:true` and a green tick. Self-registration is capped at
          // 200 (below), so a relay could legitimately hold 200 churches that no dashboard save could then
          // round-trip without de-provisioning 150 congregations. Refuse instead of truncating, and say so.
          if (churches.length > CHURCH_REPLACE_CAP) {
            res.writeHead(400, H);
            res.end(JSON.stringify({ error: `this relay can hold up to ${CHURCH_REPLACE_CAP} churches — you sent ${churches.length}. Remove some first; nothing was changed.` }));
            return;
          }
          const clean = [];
          for (const c of churches) {
            const hex = toHexPub(String((c && c.npub) || '').trim());
            if (!hex) { res.writeHead(400, H); res.end(JSON.stringify({ error: 'not a valid npub: ' + String((c && c.npub) || '').slice(0, 24) })); return; }
            const prev = CHURCH_META.get(hex) || {};
            clean.push({ npub: npubEncode(hex), name: String((c && c.name) || '').slice(0, 80),
                         by: prev.by || 'operator', at: prev.at || Math.floor(Date.now() / 1000) });
          }
          // C4: an EMPTY list must mean "nobody may write", not "everybody may". `!CHURCH_PUBS.size` is the
          // never-configured-yet escape hatch that makes a fresh install usable, and it is reachable from the
          // dashboard: remove the last church, save, and the relay silently becomes an open Nostr relay for
          // the whole internet — while the UI congratulates you. Refuse the emptying save outright.
          if (!clean.length && CHURCH_PUBS.size) {
            res.writeHead(400, H);
            res.end(JSON.stringify({ error: 'removing every church would let anyone on the internet write to this relay. Keep at least one, or turn the relay off.' }));
            return;
          }
          writeChurches(clean);
          // C2: respond with what the server ACTUALLY holds, never the list that was posted. writeChurches →
          // loadChurches folds into a Set, so duplicates collapse and (before the fix above) env churches
          // reappeared — the operator was shown their own request back and told it had been saved.
          const actual = curChurches();
          const dropped = clean.length - actual.length;
          res.writeHead(200, H);
          res.end(JSON.stringify({ ok: true, configured: CHURCH_PUBS.size > 0, churches: actual,
            ...(dropped > 0 ? { note: `${actual.length} saved — ${dropped} duplicate${dropped === 1 ? '' : 's'} collapsed.` } : {}) }));
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
          if ('lanAccess' in s) {
            SETTINGS.lanAccess = !!s.lanAccess;
            // a marker file, because the Tauri launcher decides the bind address before the gateway exists
            try { const mk = join(DATA_DIR, 'lan-access'); if (SETTINGS.lanAccess) writeFileSync(mk, '1\n'); else rmSync(mk, { force: true }); } catch {}
          }
          if ('serveApp' in s) SETTINGS.serveApp = !!s.serveApp;
          if ('serveModules' in s) SETTINGS.serveModules = !!s.serveModules;
          if ('serveAudio' in s) SETTINGS.serveAudio = !!s.serveAudio;
          if ('appUrl' in s) SETTINGS.appUrl = String(s.appUrl || '').slice(0, 200);
          if ('mediaCap' in s) SETTINGS.mediaCap = Math.max(0, parseInt(s.mediaCap, 10) || 0);
          if ('churchCap' in s) SETTINGS.churchCap = Math.max(0, parseInt(s.churchCap, 10) || 0);
          if ('inviteOnly' in s) SETTINGS.inviteOnly = !!s.inviteOnly;
          if ('offerHosting' in s) SETTINGS.offerHosting = !!s.offerHosting;
          saveSettings();
          // push the new offer/access state to the directory now, so discovery reflects it without waiting for
          // the next go-public/boot (no-op unless this relay is public + has a claimed name).
          if ('offerHosting' in s || 'inviteOnly' in s) { try { reclaimRelayName(); } catch {} }
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
  // Open an external URL in the host's browser — for the desktop launcher's "Get update" (the webview can't do
  // it). Hardened against CSRF: it requires the ADMIN TOKEN (which forces a CORS preflight and which a random
  // cross-origin page can't obtain — /local-token is loopback-fenced), on top of loopback-only + no-proxy. The
  // URL is re-parsed and only its canonical href for https://github.com/… is opened (never the raw request
  // string), and openExternal uses no shell — so path/query metacharacters can't inject a command.
  if (route === '/open-external' && req.method === 'POST') {
    const ra = (req.socket && req.socket.remoteAddress) || '';
    const loopbackSock = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
    const proxied = req.headers['x-forwarded-for'] != null || req.headers['forwarded'] != null;
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS };
    let body = ''; req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      if (!loopbackSock || proxied || !adminOK(req)) { res.writeHead(403, H); res.end('{"error":"local admin only"}'); return; }
      let u = ''; try { u = String(JSON.parse(body || '{}').url || ''); } catch {}
      let parsed = null; try { parsed = new URL(u); } catch {}
      if (!parsed || parsed.protocol !== 'https:' || parsed.host.toLowerCase() !== 'github.com') { res.writeHead(400, H); res.end('{"error":"only https://github.com links"}'); return; }
      const ok = openExternal(parsed.href);   // canonical, re-serialised — never the raw request string
      res.writeHead(ok ? 200 : 500, H); res.end(JSON.stringify({ ok }));
    });
    return;
  }
  // Full relay backup: stream the ENTIRE data dir (every church's events + media, plus this relay's identity
  // key + settings) as one gzipped tar. Admin-gated (token in header or ?token=). Uses the platform `tar`
  // (bundled on Win10+/macOS/Linux). A WAL checkpoint first so relay.sqlite is self-consistent in the archive.
  // Mint a one-time ticket for the backup download (auth via header, so the admin secret never rides in a URL).
  if (route === '/relay-backup-ticket' && req.method === 'POST') {
    if (!adminOK(req)) { res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":"unauthorized"}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS });
    res.end(JSON.stringify({ ticket: mintBackupTicket() }));
    return;
  }
  if (route === '/relay-backup' && req.method === 'GET') {
    // Accept a one-time ?ticket= (the console's normal path) OR the admin token (header/?token=, for API use).
    const ticket = (() => { try { return new URL(req.url, 'http://x').searchParams.get('ticket') || ''; } catch { return ''; } })();
    if (!consumeBackupTicket(ticket) && !adminOK(req, true)) { res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":"unauthorized"}'); return; }
    try { store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    const stamp = new Date().toISOString().slice(0, 10);
    const fname = 'trinityone-relay-backup-' + stamp + '.tgz';
    let child;
    try {
      child = spawn('tar', ['-czf', '-', '-C', DATA_DIR,
        '--exclude=./cloudflared.log', '--exclude=./.restore-pending', '--exclude=./.bundle-cache', '--exclude=./relay-launch.log', '.'],
        { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":"tar not available on this box"}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="' + fname + '"', ...SEC_HEADERS });
    child.on('error', () => { try { res.destroy(); } catch {} });
    child.stdout.pipe(res);
    req.on('close', () => { try { child.kill(); } catch {} });
    return;
  }
  // Restore a full relay backup: stream the uploaded .tgz straight into .restore-pending/, then the operator
  // restarts and applyPendingRestore() (top of file) swaps it into place before the DB opens. Admin-gated.
  if (route === '/relay-restore' && req.method === 'POST') {
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS };
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    const staging = join(DATA_DIR, '.restore-pending');
    try { rmSync(staging, { recursive: true, force: true }); } catch {}
    try { mkdirSync(staging, { recursive: true }); } catch {}
    let child;
    try { child = spawn('tar', ['--no-same-owner', '--no-same-permissions', '-xzf', '-', '-C', staging], { stdio: ['pipe', 'ignore', 'ignore'] }); }
    catch (e) { res.writeHead(500, H); res.end('{"error":"tar not available on this box"}'); return; }
    child.on('error', () => { try { res.writeHead(500, H); } catch {} try { res.end('{"error":"extract failed"}'); } catch {} });
    child.on('exit', (code) => {
      // reject anything containing a symlink (arbitrary-write vector), and require a real relay backup shape
      if (code === 0 && stagingHasSymlink(staging)) { try { rmSync(staging, { recursive: true, force: true }); } catch {} res.writeHead(400, H); res.end('{"error":"backup contains a symlink — refused"}'); return; }
      const ok = code === 0 && (existsSync(join(staging, 'relay.sqlite')) || existsSync(join(staging, 'church.json')));
      if (!ok) { try { rmSync(staging, { recursive: true, force: true }); } catch {} res.writeHead(400, H); res.end('{"error":"not a valid relay backup file"}'); return; }
      res.writeHead(200, H); res.end('{"ok":true,"restart":true}');
    });
    req.pipe(child.stdin);
    req.on('error', () => { try { child.kill(); } catch {} });
    return;
  }
  // relay self-update: POST drops a flag in relay/ (the only path the sandboxed relay can write); a root
  // systemd path-unit watches it and runs scripts/relay-update.sh (pull bundle, swap code, restart).
  if (route === '/update') {
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...CORS };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...SEC_HEADERS, ...CORS }); res.end(); return; }
    if (!adminOK(req)) { res.writeHead(401, H); res.end('{"error":"unauthorized"}'); return; }
    let pending = false, pendingAgeS = 0;
    try { const st = statSync(UPDATE_FLAG); pending = true; pendingAgeS = Math.max(0, Math.floor((Date.now() - st.mtimeMs) / 1000)); } catch {}
    // H2/H7: the OUTCOME of the last update, written by relay-update.sh on every exit path. Without this
    // the dashboard could only report success if the browser was watching at the right instant, and a
    // failure was invisible outside a terminal. A flag older than ~5 minutes means nothing consumed it —
    // i.e. the root update watcher isn't installed on this box — which looked identical to "still going".
    let last = null; try { last = JSON.parse(readFileSync(join(DATA_DIR, 'update-status.json'), 'utf8')); } catch {}
    const stalled = pending && pendingAgeS > 300;
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
            // Prefer what the origin would actually SERVE (its release ref) over the version of the
            // process it happens to be running. Since the bundle is built from RELEASE_REF rather than
            // the release host's checkout, those diverge — and comparing against the running process
            // told relays a build was 'available' that was in fact OLDER than the one they had.
            if (s && s.releases && s.releases.sha) latest = { version: s.releases.sha, versionShort: s.releases.short || s.releases.sha.slice(0, 7), builtAt: s.releases.builtAt || '' };
            else if (s && s.version) latest = { version: s.version, versionShort: s.versionShort, builtAt: s.builtAt };
          } catch {}
        }
        res.writeHead(200, H); res.end(JSON.stringify({ ok: true, version: BUILD.sha, versionShort: BUILD.short, builtAt: BUILD.date, origin: ORIGIN, pending, stalled, last, latest }));
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
    const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges' };
    if (req.headers['access-control-request-private-network']) h['Access-Control-Allow-Private-Network'] = 'true';   // permit a backup host on a more-private network (PNA)
    res.writeHead(204, h); res.end(); return;
  }
  // Upload: PUT /blob (church/steward-signed kind-24242). Download: GET /blob/<sha256> (member-gated NIP-98).
  if (route === '/blob' && (req.method === 'PUT' || req.method === 'POST')) {
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (MEDIA_OFF) { res.writeHead(403, H); res.end('{"error":"this relay hosts no media (relay-only)"}'); return; }   // operator disabled media
    const who = _blobUploader(req);
    if (!who) { res.writeHead(401, H); res.end('{"error":"unauthorized: sign a kind-24242 upload auth with the church (or steward) key"}'); return; }
    // Media-hosting policy: on a shared/community relay, a church provisioned for conversations/text but NOT granted
    // media hosting can't upload sermons — reject audio/video up front, and (below) any blob past the small-asset
    // size backstop. Off unless mediaRequiresHost(); a granted (self-hosting) church and a private relay are unaffected.
    const guestMedia = mediaRequiresHost() && !MEDIA_HOSTS.has(who.church);
    const NEEDS_OWN_RELAY = 'To host sermons, connect your church\'s own relay — this community relay keeps your conversations and text resources free, but audio and video need your own relay.';
    { const ct = String(req.headers['content-type'] || '').toLowerCase();
      if (guestMedia && (ct.startsWith('audio/') || ct.startsWith('video/'))) { res.writeHead(403, H); res.end(JSON.stringify({ error: NEEDS_OWN_RELAY })); return; } }
    // Stream the body to a temp file, hashing as it flows — the whole blob (and its base64 for native uploads)
    // never sits in RAM. Native clients send base64 text (CapacitorHttp mangles a raw binary body) → decode in a
    // streaming transform. MAX_BLOB is enforced mid-stream; the storage caps + content-addressed dedup at the end.
    const isB64 = !!req.headers['x-blob-b64'];
    const tmp = join(BLOB_DIR, '.up-' + randomBytes(12).toString('hex') + '.tmp');
    const hash = createHash('sha256'); let size = 0, done = false;
    const out = createWriteStream(tmp);
    const src = isB64 ? req.pipe(new B64Decode()) : req;
    const cleanup = () => { try { unlinkSync(tmp); } catch {} };
    const fail = (code, msg) => { if (done) return; done = true; try { req.destroy(); } catch {} try { if (src !== req) src.destroy(); } catch {} try { out.destroy(); } catch {} cleanup(); try { res.writeHead(code, H); res.end(JSON.stringify({ error: msg })); } catch {} };
    src.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BLOB) { fail(413, 'blob too large'); return; }
      if (guestMedia && size > GUEST_ASSET_MAX) { fail(403, NEEDS_OWN_RELAY); return; }   // guest church: allow a tiny asset, block anything sermon-sized (even if mislabeled)
      hash.update(chunk);
      if (!out.write(chunk)) { src.pause(); out.once('drain', () => { if (!done) src.resume(); }); }
    });
    src.on('error', () => fail(400, 'read'));
    out.on('error', () => fail(500, 'store failed'));
    // client aborts mid-upload (routine over a thin mobile pipe) emit neither 'end' nor 'error' — without this the
    // .up-*.tmp file is orphaned forever (the boot scan + cap accounting ignore non-sha filenames). 'close' fires on
    // BOTH normal completion and abort, so gate on req.complete (true only when the whole body was received) to
    // avoid nuking the temp on a healthy upload whose disk-flush hasn't finished yet.
    req.on('close', () => { if (!done && !req.complete) fail(499, 'aborted'); });
    src.on('end', () => { if (!done) out.end(); });
    out.on('finish', () => {
      if (done) return; done = true;
      if (!size) { cleanup(); res.writeHead(400, H); res.end('{"error":"empty"}'); return; }
      const sha = hash.digest('hex');
      if (who.want && who.want !== sha) { cleanup(); res.writeHead(400, H); res.end('{"error":"hash mismatch (x tag != blob sha256)"}'); return; }
      const finalPath = join(BLOB_DIR, sha);
      const isNew = !existsSync(finalPath);   // content-addressed: a re-upload of an existing blob adds no new bytes
      if (isNew) {
        const _mc = effMediaCap(), _cc = effChurchCap();
        if (_mc && _mediaBytesTotal + size > _mc) { cleanup(); res.writeHead(507, H); res.end('{"error":"this relay\'s media storage is full"}'); return; }
        if (_cc && (_mediaBytesByChurch.get(who.church) || 0) + size > _cc) { cleanup(); res.writeHead(507, H); res.end('{"error":"your church has reached its media storage limit on this relay"}'); return; }
      }
      try {
        if (isNew || !_blobOwner(sha)) writeFileSync(join(BLOB_DIR, sha + '.church'), who.church);   // S4: owner sidecar BEFORE the blob is reachable. Set it on first store OR to backfill a missing one — but do NOT flip ownership when another church dedup-re-uploads an identical blob.
        if (isNew) renameSync(tmp, finalPath); else cleanup();        // dedup: identical blob already stored → drop the temp
        const ct = req.headers['content-type'] || ''; if (ct && ct.indexOf('text/plain') !== 0) { try { writeFileSync(join(BLOB_DIR, sha + '.type'), ct); } catch {} }
      } catch (e) { cleanup(); res.writeHead(500, H); res.end('{"error":"store failed"}'); return; }
      if (isNew) { _mediaBytesTotal += size; _mediaBytesByChurch.set(who.church, (_mediaBytesByChurch.get(who.church) || 0) + size); _indexBlob(who.church, sha, size); }   // account + index the new bytes
      res.writeHead(201, H); res.end(JSON.stringify({ sha256: sha, size, url: '/blob/' + sha, type: req.headers['content-type'] || 'application/octet-stream' }));
    });
    return;
  }
  // Blob DELETE (Blossom): free the stored file so "Remove sermon" actually reclaims disk + cap. Auth = a fresh
  // kind-24242 t=delete signed by the owning church (or a steward), bound to this sha via the x tag.
  if (route.startsWith('/blob/') && req.method === 'DELETE') {
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const sha = route.slice('/blob/'.length).toLowerCase();
    if (!_blobRe.test(sha)) { res.writeHead(400, H); res.end('{"error":"bad hash"}'); return; }
    const who = _blobUploader(req, 'delete');
    if (!who) { res.writeHead(401, H); res.end('{"error":"unauthorized: sign a kind-24242 t=delete auth (x=sha) with the church or steward key"}'); return; }
    if (who.want && who.want !== sha) { res.writeHead(400, H); res.end('{"error":"auth x tag does not match the blob"}'); return; }
    const owner = _blobOwner(sha);
    if (owner && owner !== who.church) { res.writeHead(403, H); res.end('{"error":"not your church\'s media"}'); return; }   // only the owning church may delete
    const file = join(BLOB_DIR, sha); let sz = 0; try { sz = statSync(file).size; } catch {}
    try { unlinkSync(file); } catch {} try { unlinkSync(file + '.church'); } catch {} try { unlinkSync(file + '.type'); } catch {}
    if (sz) { const ch = owner || who.church; _mediaBytesTotal = Math.max(0, _mediaBytesTotal - sz); _mediaBytesByChurch.set(ch, Math.max(0, (_mediaBytesByChurch.get(ch) || 0) - sz)); const m = _blobsByChurch.get(ch); if (m) m.delete(sha); }
    res.writeHead(200, H); res.end(JSON.stringify({ deleted: true, sha256: sha }));
    return;
  }
  if (route.startsWith('/blob/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const sha = route.slice('/blob/'.length).toLowerCase();
    if (!_blobRe.test(sha)) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); res.end('bad hash'); return; }
    const file = join(BLOB_DIR, sha); let st; try { st = statSync(file); } catch { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('not found'); return; }
    const host = (req.headers.host || '').split(',')[0].trim();
    if (!_blobMember(req, _blobOwner(sha), host, route)) { res.writeHead(401, { 'Access-Control-Allow-Origin': '*', 'WWW-Authenticate': 'Nostr' }); res.end('members only'); return; }
    let ct = 'application/octet-stream'; try { ct = readFileSync(join(BLOB_DIR, sha + '.type'), 'utf8').trim() || ct; } catch {}
    const base = { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable', ...SEC_HEADERS };   // content-addressed → immutable; PRIVATE so a shared proxy can't replay a member's fetch to a non-member
    if (/[?&]b64/.test(req.url || '')) {   // native download: CapacitorHttp mangles a binary response body → serve base64 text, the client decodes
      if (req.method === 'HEAD') { res.writeHead(200, { ...base, 'Content-Type': 'text/plain; charset=ascii', 'X-Blob-B64': '1' }); res.end(); return; }
      // stream the file through a base64 encoder (bounded memory) instead of readFileSync().toString('base64')
      res.writeHead(200, { ...base, 'Content-Type': 'text/plain; charset=ascii', 'Content-Length': Math.ceil(st.size / 3) * 4, 'X-Blob-B64': '1' });
      const rs = createReadStream(file); rs.on('error', () => { try { res.destroy(); } catch {} }); rs.pipe(new B64Encode()).pipe(res);
      return;
    }
    const range = req.headers['range'] && /bytes=(\d*)-(\d*)/.exec(req.headers['range']);   // seek support for audio/video
    if (range) {
      let start, end;
      if (range[1] === '' && range[2] !== '') { const n = parseInt(range[2], 10); start = Math.max(0, st.size - n); end = st.size - 1; }   // suffix range `bytes=-N` = the LAST N bytes (mp4 moov-atom probe) — was wrongly served as 0..N
      else { start = range[1] ? parseInt(range[1], 10) : 0; end = range[2] ? parseInt(range[2], 10) : st.size - 1; }
      if (start > end || end >= st.size || start < 0) { res.writeHead(416, base); res.end(); return; }
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
  // Digital Asset Links — proves to Android that this domain and the TrinityOne app belong to the same owner,
  // which is what lets a /join invite open IN THE APP instead of the browser. Without it, a member who installs
  // the APK from an invite link loses the invite context entirely and has to type the church name by hand
  // (AUDIT-2026-07-24, the #1 onboarding drop-off after the sideload prompt itself).
  //
  // NOTE (corrected 2026-07-25): this does NOT give a self-hosting church the in-app path. AndroidManifest.xml
  // hard-codes android:host="app.trinityone.church", so Android only ever fetches assetlinks from that one host
  // and this file is inert on any other domain — a self-hosted church's /join link always opens the browser.
  // Serving it from code still beats a static file (no deploy step, no cache), but the earlier claim here was
  // wrong and would have had an operator expecting a feature that cannot work. Making it work needs a second
  // intent-filter per church domain, which the manifest cannot know at build time.
  // The fingerprint is the release signing key's SHA-256; it is PUBLIC by design — a checksum of a certificate
  // every installer already holds. Verification failure is graceful: the link opens the browser.
  if (route === '/.well-known/assetlinks.json') {
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' });
    res.end(JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.trinityone.app', sha256_cert_fingerprints: [ANDROID_CERT_SHA256] },
    }], null, 2));
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
        // CHURCHES ONLY. Resolving a MEMBER's name turned this into a guess-a-name oracle: ask for "maria" and
        // get her identity back, from anywhere, unauthenticated. The bulk dump was closed in 2026-06-24 (L7);
        // the scoped form is the same leak one name at a time, and it is exactly what a congregation that must
        // not be enumerable cannot afford. A church WANTS a public handle — that is the point of a church —
        // so churches still resolve. AUDIT-2026-07-27.
        if (!CHURCH_PUBS.has(e.pubkey)) continue;
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
    p += (p === '/' && host === marketingHost) ? 'welcome.html' : 'index.html';
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
  // INTERNAL DOCUMENTATION IS NOT PUBLIC. The deploy bundle is a `git archive` of the whole ref, so every
  // tracked file lands on the box — and this handler serves anything under ROOT that the denylist above
  // misses. Confirmed live against a real gateway on 2026-07-28: /AUDIT-2026-07-26-RECOVERY.md, /HANDOFF.md
  // and /docs/design/TREASURY.md all returned 200. The audit files name vulnerabilities and the dates they
  // were found; the handoff describes the internals; the design notes describe what is not built yet. That is
  // a map of where to push, served from the church's own box, to anyone who guesses a filename.
  // Same shape as the 2026-07-06 incident that put `relay` in this list — that fix named one directory
  // instead of asking what else ships. Nothing served links to a .md or into docs/ or reference/.
  // AUDIT-2026-07-28 F3. The same mistake again, one layer down: the .md rule above was written by asking
  // "are the DOCUMENTS served", so it could not catch anything that is not a document. Enumerating every
  // tracked file against a live gateway (220 of 447 were served) turned up three more classes:
  //   • deploy/systemd/*.service — the install path, the service ACCOUNT NAME and the exact Node version,
  //     published by every church's own box. On this one: /mnt/storage/projects/TrinityOne and
  //     node/v22.22.2. That is a shell to aim at and a version to look up advisories for.
  //   • ci/*.yml — how the build is driven.
  //   • relay-app/desktop/src-tauri/{Cargo.toml,build.rs} — desktop build sources; the control UI beside
  //     them is deliberately public, these are not part of it.
  // So the extension rule below is a CLASS rule, not a list of the files I happened to find: config and
  // build descriptors, wherever they turn up. relay-app/install.sh stays served on purpose — the
  // documented one-liner curls it — and so do decks/*.pdf, which about.html links.
  const DENY_DIR = new Set(['relay', 'android', 'ios', 'node_modules', 'docs', 'reference', 'scripts', 'src', 'deploy', 'ci']);
  if (p.split('/').some(s => DENY_DIR.has(s) || (s && s[0] === '.'))) { res.writeHead(404).end('not found'); return; }
  if (p.startsWith('/relay-app/desktop/')) { res.writeHead(404).end('not found'); return; }
  const DENY_EXT = new Set(['.md', '.service', '.yml', '.yaml', '.toml', '.rs', '.lock', '.gradle', '.pro']);
  if (DENY_EXT.has(extname(p).toLowerCase())) { res.writeHead(404).end('not found'); return; }
  // Build files that describe the box rather than serve it. package-lock fingerprints every dependency and
  // its exact version — a ready-made list of which published advisories to try — and capacitor.config.json
  // states plainly whether the shipped app has remote debugging enabled. Neither is referenced by any shell.
  // (manifest/catalog/ebible-catalog/apk-latest ARE needed, so this is a named list, not a blanket .json rule.)
  if (['/package.json', '/package-lock.json', '/capacitor.config.json'].includes(p)) { res.writeHead(404).end('not found'); return; }
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
    // The desktop app's own control panel + launcher (/relay-app/*) MUST NOT be cached: WebView2 was observed
    // serving a stale control.js across reinstalls (it doesn't reliably revalidate 'no-cache'), which froze the
    // panel on old code. These files are always local (the on-box relay) so 'no-store' costs nothing. Everything
    // else stays 'no-cache' so the member app can still load its HTML shell offline.
    const htmlCache = p.startsWith('/relay-app/') ? 'no-store' : 'no-cache';
    const gzH = _acceptsGzip(req) ? _gzipBuf(body) : null;
    res.writeHead(200, { 'Content-Type': MIME['.html'] || 'text/html', 'Content-Length': (gzH || body).length, ...(gzH ? { 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' } : {}), 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': CSP, 'Cache-Control': htmlCache, ...SEC_HEADERS });
    res.end(gzH || body); return;
  }
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Access-Control-Allow-Origin': '*', ...SEC_HEADERS };
  const useGz = GZIP_TYPES.has(ext) && _acceptsGzip(req);   // gzip compressible text assets on the fly (cached) — the cold-start win
  // ETag (weak, size+mtime) lets a repeat request revalidate to a body-less 304 instead of re-downloading. Encoding-
  // aware ('-gz') so a gzipped and an identity response never share an ETag (a cache can't then mismatch encodings).
  const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + (useGz ? '-gz' : '') + '"';
  // app assets change every release — revalidate (belt-and-braces with the ?v= cache-bust above). The desktop
  // control UI (/relay-app/*) is 'no-store' outright — see the HTML note above; WebView2 mishandles 'no-cache'.
  if (['.js', '.mjs', '.jsx', '.css', '.json'].includes(ext)) {
    if (p.startsWith('/relay-app/') || p === '/sw.js') headers['Cache-Control'] = 'no-store';
    else {
      // a request that carries the current build's ?v=<sha> is asking for an IMMUTABLE URL: the HTML rewrite mints
      // a new ?v= every release, so this exact URL only ever serves this byte-for-byte content. Cache it hard and
      // skip revalidation entirely. A request without (or with a stale) ?v= still just revalidates via no-cache.
      const qs = (req.url || '').split('?')[1] || ''; const mv = qs.match(/(?:^|&)v=([^&]*)/); const vparam = mv ? decodeURIComponent(mv[1]) : '';
      headers['Cache-Control'] = (vparam && vparam === ((BUILD && BUILD.short) || '0')) ? 'public, max-age=31536000, immutable' : 'no-cache';
    }
  }
  // conditional GET: a matching If-None-Match returns 304 (no body). Never 304 a 'no-store' asset — it must always re-fetch.
  if (headers['Cache-Control'] !== 'no-store') {
    headers['ETag'] = etag;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { 'ETag': etag, 'Access-Control-Allow-Origin': '*', 'Cache-Control': headers['Cache-Control'] || 'no-cache', ...(useGz ? { 'Vary': 'Accept-Encoding' } : {}), ...SEC_HEADERS }); res.end(); return; }
  }
  if (useGz) {
    const gz = _gzipFile(file, st.mtimeMs);
    if (gz) { headers['Content-Encoding'] = 'gzip'; headers['Content-Length'] = gz.length; headers['Vary'] = 'Accept-Encoding'; res.writeHead(200, headers); res.end(gz); return; }
  }
  // HTTP Range — required for <video>/<audio> seeking (Safari refuses to play a video at all without it).
  // Only on the identity path (range + gzip don't mix, and media isn't gzipped anyway).
  headers['Accept-Ranges'] = 'bytes';
  const rm = req.headers['range'] && /^bytes=(\d*)-(\d*)$/.exec(String(req.headers['range']).trim());
  if (rm) {
    let start, end;
    if (rm[1] === '' && rm[2] !== '') { const n = parseInt(rm[2], 10); start = Math.max(0, st.size - n); end = st.size - 1; }   // suffix `bytes=-N` (mp4 moov probe)
    else { start = rm[1] ? parseInt(rm[1], 10) : 0; end = rm[2] ? parseInt(rm[2], 10) : st.size - 1; }
    if (start > end || end >= st.size || start < 0) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}`, 'Content-Length': 0 }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file, { start, end }).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
    return;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
}

// ---- relay (NIP-01) — events live in SQLite (node:sqlite); REQ reads are indexed queries ----
const store = openStore(SQLITE_DB, { maxEvents: MAX_EVENTS });
// NOTHING USED TO CLOSE THE STORE. There was no SIGTERM/SIGINT handler and no store.close() anywhere, so an
// ordinary `systemctl stop` left the church's data in the -wal side file — see the note on checkpoint() in
// event-store.mjs. Registered once, idempotent, and it re-raises the signal so the exit code stays honest.
let _shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (_shuttingDown) return; _shuttingDown = true;
    try { store.close(); } catch (e) {}
    try { process.removeAllListeners(sig); } catch (e) {}
    try { process.kill(process.pid, sig); } catch (e) { process.exit(0); }
  });
}
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
backfillDeletions();   // re-apply every stored kind-5 — heals content that resurrected before tombstones existed
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
  let maxTs = SYNC_CURSORS[key] || 0, imported = 0;
  try {
    const r = await fetch(url, { headers: { Authorization: relayProof(url, 'GET', cp) } });
    if (!r.ok) return { ok: false, status: r.status };
    await forEachNdjsonLine(r, MAX_IMPORT, (s) => {   // stream the corpus line-by-line (bounded memory)
      let e; try { e = JSON.parse(s); } catch { return; }
      if (!e || !e.id || !e.sig || !verifyEvent(e)) return;   // integrity: never store an unverifiable event
      const put = store.put(e, cp);
      if (put === 'stored') { imported++; note(e); }
      if (e.kind === 5) applyDeletions(e);   // ALWAYS, as the live path does — see the restore path
      if ((e.created_at || 0) > maxTs) maxTs = e.created_at || 0;
    });
  } catch { return { ok: false }; }
  if (maxTs !== (SYNC_CURSORS[key] || 0)) { SYNC_CURSORS[key] = maxTs; _cursorsDirty = true; }   // persisted once per pass by saveCursors()
  return { ok: true, imported };
}
// negentropy set reconciliation: partition a church's event IDs into buckets by ID prefix (256 buckets) and
// fingerprint each — sha256 of the sorted IDs (first 16 bytes) + count. Two relays compare digests; only buckets
// whose fingerprints DIFFER need their ID lists exchanged, so we find EVERY difference (including old gaps a
// forward-only cursor never backfills) while transferring almost nothing when already in sync. sha256-of-the-
// exact-set (not an XOR/sum) can't silently collide. Deterministic — both sides bucket identically.
// Digest cache: building it sorts + hashes every one of a church's event IDs, and a single sync pass asks for it
// repeatedly (once to serve each peer that pulls, once per peer in our own reconcile). Cache per church with a short
// TTL so a burst of digest requests within one pass rebuilds it at most once. Staleness is bounded and harmless:
// negentropy converges over passes and the forward cursor already carries the newest events, so a briefly-stale
// digest only defers backfill of an old gap by one pass (< TTL + one sync interval).
const _digestCache = new Map();   // cp -> { at, val }
const DIGEST_TTL = 15000;
function _bucketDigest(cp) {
  const c = _digestCache.get(cp);
  if (c && (Date.now() - c.at) < DIGEST_TTL) return c.val;
  const buckets = {};
  for (const id of store.churchEventIds(cp)) { if (!/^[0-9a-f]{64}$/.test(id)) continue; const b = id.slice(0, 2); (buckets[b] || (buckets[b] = [])).push(id); }
  const out = {};
  for (const b in buckets) { const ids = buckets[b].sort(); out[b] = { fp: createHash('sha256').update(ids.join('')).digest('hex').slice(0, 32), n: ids.length }; }
  _digestCache.set(cp, { at: Date.now(), val: out });
  return out;
}
// negentropy pull: compare our digest with a peer's; for each differing bucket, fetch the peer's IDs, diff against
// ours, and pull only the events we're missing. Runs ALONGSIDE the v1 cursor pull (kept as a correctness backstop).
async function reconcileChurchWithPeer(cp, peerBase) {
  const digUrl = peerBase + '/sync-digest?church=' + encodeURIComponent(cp);
  let peerBuckets; try { const r = await fetch(digUrl, { headers: { Authorization: relayProof(digUrl, 'GET', cp) } }); if (!r.ok) return 0; peerBuckets = (await r.json()).buckets || {}; } catch { return 0; }
  const mine = _bucketDigest(cp), missing = [];
  // PERF (audit 2026-07-24): this used to call store.churchEventIds(cp) — the church's ENTIRE id list —
  // once per mismatched bucket, inside the loop. Buckets are the first two hex chars of an event id, so there
  // are 256 of them, and a relay that has been offline or is newly paired mismatches on essentially all. For a
  // Raspberry Pi holding 20k events that is 256 × 20k row reads every sync pass, and node:sqlite is
  // SYNCHRONOUS — so the relay stopped answering every connected member for the duration, every 5–7 minutes.
  // Read it once and bucket it once; the work is now O(events) per pass instead of O(256 × events).
  let _haveByBucket = null;
  const haveIn = (b) => {
    if (!_haveByBucket) {
      _haveByBucket = new Map();
      for (const id of store.churchEventIds(cp)) { const k = id.slice(0, 2); let s = _haveByBucket.get(k); if (!s) { s = new Set(); _haveByBucket.set(k, s); } s.add(id); }
    }
    return _haveByBucket.get(b) || new Set();
  };
  for (const b in peerBuckets) {
    if (mine[b] && mine[b].fp === peerBuckets[b].fp) continue;   // bucket identical on both sides -> nothing to do
    const idsUrl = peerBase + '/sync-ids?church=' + encodeURIComponent(cp) + '&bucket=' + b;
    let peerIds; try { const r = await fetch(idsUrl, { headers: { Authorization: relayProof(idsUrl, 'GET', cp) } }); if (!r.ok) continue; peerIds = (await r.json()).ids || []; } catch { continue; }
    const have = haveIn(b);
    for (const id of peerIds) if (/^[0-9a-f]{64}$/.test(id) && !have.has(id)) missing.push(id);
  }
  if (!missing.length) return 0;
  let imported = 0;
  for (let i = 0; i < missing.length; i += 1000) {   // pull the missing events in bounded batches
    const evUrl = peerBase + '/sync-events';
    let body; try { const r = await fetch(evUrl, { method: 'POST', headers: { Authorization: relayProof(evUrl, 'POST', cp), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: missing.slice(i, i + 1000) }) }); if (!r.ok) continue; body = await readCapped(r, MAX_IMPORT); } catch { continue; }
    for (const line of body.split('\n')) { const s = line.trim(); if (!s) continue; let e; try { e = JSON.parse(s); } catch { continue; } if (!e || !e.id || !e.sig) continue; let ok = false; try { ok = verifyEvent(e); } catch { ok = false; } if (!ok) continue; if (store.put(e, cp) === 'stored') { imported++; note(e); } if (e.kind === 5) applyDeletions(e); }
  }
  return imported;
}
// resync media: pull blobs this church holds on a peer that we don't have yet. Content-addressed, so it's
// self-verifying (the sha must match) and idempotent. Runs AFTER the event sync, skipped if this relay hosts no
// media, and respects the relay's media caps. A distinct, paced pass — media is the heavy part of a sync.
async function syncMediaFromPeer(cp, peerBase) {
  if (MEDIA_OFF) return 0;
  // SECURITY-2026-07-13: honour the media-hosting policy on the REPLICATION path too. Without this, a church denied
  // media hosting here (mediaRequiresHost + not in MEDIA_HOSTS) could still land its sermons on this relay by
  // uploading to a peer it controls and letting trusted-relay sync pull them — bypassing the PUT-gate.
  if (mediaRequiresHost() && !MEDIA_HOSTS.has(cp)) return 0;
  const manUrl = peerBase + '/sync-media?church=' + encodeURIComponent(cp);
  let man; try { const r = await fetch(manUrl, { headers: { Authorization: relayProof(manUrl, 'GET', cp) } }); if (!r.ok) return 0; man = await r.json(); } catch { return 0; }
  let pulled = 0;
  for (const b of (man && man.blobs) || []) {
    if (!b || !/^[0-9a-f]{64}$/.test(b.sha) || existsSync(join(BLOB_DIR, b.sha))) continue;   // already have it (or junk)
    const _mc = effMediaCap(), _cc = effChurchCap();                                          // honour panel-set caps, not just env
    if (_mc && _mediaBytesTotal + (b.size || 0) > _mc) break;                                 // this relay's media is full
    if (_cc && (_mediaBytesByChurch.get(cp) || 0) + (b.size || 0) > _cc) break;
    const blobUrl = peerBase + '/sync-blob/' + b.sha + '?church=' + encodeURIComponent(cp);
    const tmp = join(BLOB_DIR, '.dl-' + randomBytes(12).toString('hex') + '.tmp');
    try {
      const r = await fetch(blobUrl, { headers: { Authorization: relayProof(blobUrl, 'GET', cp) } });
      if (!r.ok || !r.body) continue;
      // stream to a temp file, hashing as it flows — never buffer a 200MB blob in RAM, and never write straight to
      // the final <sha> path (a crash there wedges a truncated file that existsSync skips forever with no self-heal).
      const hash = createHash('sha256'); const out = createWriteStream(tmp); const reader = r.body.getReader();
      let n = 0, bad = false;
      for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > MAX_BLOB) { bad = true; try { await reader.cancel(); } catch {} break; } hash.update(value); if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res)); }
      await new Promise((res, rej) => out.end(err => err ? rej(err) : res()));
      if (bad || hash.digest('hex') !== b.sha) { try { unlinkSync(tmp); } catch {} continue; }   // content-addressed integrity check
      writeFileSync(join(BLOB_DIR, b.sha + '.church'), cp);   // owner sidecar BEFORE the blob is reachable
      renameSync(tmp, join(BLOB_DIR, b.sha));                 // atomic publish — no partial file ever sits at <sha>
      _mediaBytesTotal += n; _mediaBytesByChurch.set(cp, (_mediaBytesByChurch.get(cp) || 0) + n); _indexBlob(cp, b.sha, n);
      pulled++;
    } catch { try { unlinkSync(tmp); } catch {} }
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
  saveCursors();   // one atomic write per pass, only if any cursor advanced
  return total;
}
let _syncing = false;
// Returns null when a sync is ALREADY RUNNING, so the caller can say so. It used to return 0 for both
// 'already syncing' and 'nothing new', which made the dashboard report a DROPPED request as
// '\u2713 already up to date' (relay-UX audit L5).
// Last sync outcome, so the dashboard can show that syncing is WORKING rather than offering a button to
// force it. Relays sync themselves every ~5\u20137 min; what an operator actually needs to know is whether
// that is happening, and nothing surfaced it \u2014 a relay whose peers had been unreachable for a week
// looked identical to a healthy one.
let _lastSync = { at: 0, imported: 0, ok: null, error: '' };
async function runSync() {
  if (_syncing) return null;
  _syncing = true;
  try { const n = await syncAllChurches(); _lastSync = { at: Math.floor(Date.now() / 1000), imported: n | 0, ok: true, error: '' }; return n; }
  catch (e) { _lastSync = { at: Math.floor(Date.now() / 1000), imported: 0, ok: false, error: String((e && e.message) || e).slice(0, 200) }; throw e; }
  finally { _syncing = false; }
}
function scheduleSync() { const ms = (300 + Math.floor(Math.random() * 120)) * 1000; setTimeout(() => { runSync().finally(scheduleSync); }, ms); }   // ~5–7 min, jittered
if (process.env.RELAY_SYNC !== '0') setTimeout(() => { runSync().finally(scheduleSync); }, 20000);   // first pass ~20s after boot (let it settle)
function scheduleSave() {}   // no-op: SQLite persists synchronously (WAL); kept so existing call sites are harmless
// matchFilter is imported from event-store.mjs (single source of truth, also used by the SQL read path)
const matchAny = (evt, filters) => filters.some(f => matchFilter(evt, f));
const subs = new Map();   // ws -> Map(subId -> filters[])

const server = createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024,   // 1 MB cap (default is 100 MB — memory-DoS guard)
  // permessage-deflate — the single biggest win for a member on a thin pipe. Negotiated per-connection
  // (clients that don't support it just skip it).
  //
  // PERF-AUDIT-2026-07-20 HIGH-1: measured against the live relay.sqlite, the mean ["EVENT",…] frame is
  // 680 bytes and 339 of 350 frames (96.9%) fell UNDER the old 1024-byte threshold — so almost nothing was
  // ever compressed, despite the comment claiming ~70% off. Threshold is now 128: Nostr frames are highly
  // repetitive JSON (same tag names, same pubkeys, same d-prefixes) and compress well even when small.
  //
  // serverNoContextTakeover was deliberate — it bounds per-connection memory — but it also resets the LZ77
  // dictionary on EVERY message, which measured 1.82× the bytes of a shared-context stream (135,930 vs
  // 74,498 B over 300 real events). Rather than trade memory for bytes outright, keep the dictionary but
  // BOUND IT: windowBits 11 (a 2 KB window, plenty for repetitive event JSON) + memLevel 4 costs roughly
  // 16 KB of zlib state per connection instead of ~256 KB at the defaults — about 80 MB at the 5000-conn
  // ceiling, and a few MB at realistic congregation size. clientNoContextTakeover stays ON so our INFLATE
  // memory stays bounded too; client→server traffic (REQ/EVENT publishes) is small and infrequent, so it
  // loses little. Net: ~60% off all Nostr wire bytes, which on 2G is ~34s per launch on a 500-event backfill.
  perMessageDeflate: {
    threshold: 128,
    serverNoContextTakeover: false, clientNoContextTakeover: true,
    serverMaxWindowBits: 11,
    zlibDeflateOptions: { windowBits: 11, memLevel: 4, level: 6 },
    concurrencyLimit: 10,
  } });
const MAX_CONNS = 5000;         // SECURITY-AUDIT-2026-07-18 M1: global concurrent-WebSocket ceiling (FD/memory-exhaustion guard). Deliberately NO per-IP cap — persecuted-church members routinely share one exit IP (VPN/Tor/national NAT/church WiFi), so a per-IP cap would throttle a legitimate congregation.
const MAX_SUBS_PER_CONN = 256;  // headroom: a real client opens many subs (members, chat, profiles, etc.)
// How long to hold an EOSE open while we wait for a challenged client to AUTH. Long enough for a round trip on
// a thin pipe, short enough to stay under nostr-tools' own EOSE timeout so a client that never authenticates
// still gets a real EOSE from us rather than its own synthetic one. See the REQ handler.
const EOSE_AUTH_GRACE_MS = 2500;
const MAX_FILTERS_PER_REQ = 32; // a single REQ carrying thousands of filters is a cheap unauthenticated CPU-DoS — cap it
// Aggregate events one REQ may materialize+serialize across all its filters (DoS ceiling; real reads are far
// smaller). PERF/audit-2026-07-24: was 20000 — roughly 40-60 MB of V8 heap for a SINGLE in-flight REQ once
// parsed, so a handful of concurrent broad reads OOMs the 1 GB Raspberry Pi a self-hosting church runs on. The
// truncation also happens after all the work. 5000 matches the store's own default page and is still far above
// any real client read.
const MAX_REQ_EVENTS = 5000;
const MAX_WS_BUFFER = 16 * 1024 * 1024; // if a client isn't draining and our socket buffer passes this, it's a slow-loris/OOM lever — stop sending + close
let _gossipMergeBusy = false;   // one /relay-names/sync merge at a time (bounds unauthenticated schnorr-verify CPU)
server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/relay') { socket.destroy(); return; }
  if (wss.clients.size >= MAX_CONNS) { try { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); } catch {} socket.destroy(); return; }   // SECURITY-AUDIT-2026-07-18 M1: shed new connections past the ceiling rather than exhaust FDs/memory
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', (ws, req) => {
  subs.set(ws, new Map());
  ws.isAlive = true;
  // The host this client actually dialled, for the NIP-42 relay-binding check below. Cloudflare/Tailscale
  // tunnels forward the original Host, so this is the public name the member typed/was invited to.
  ws._host = String((req && req.headers && req.headers.host) || '').split(':')[0].toLowerCase();
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
    if (!Array.isArray(msg) || !msg.length) return;   // a non-array message (or empty) would throw at the destructure below
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
      // durable store handles replaceable dedup + smart retention (structure kept, oldest ephemeral culled).
      // 'have-newer' / 'duplicate' → acknowledge but don't re-broadcast.
      // A STORAGE FAILURE MUST NOT BE SILENT. store.put THROWS when the database cannot accept a write — a
      // full disk, a read-only volume, a per-file limit, a malformed image. That throw used to escape into the
      // process-wide uncaughtException handler, which logs and carries on BY DESIGN, so three things happened
      // at once: the event was lost, the client got NO reply at all (not a rejection — silence, so its publish
      // simply never completes and the app waits for ever), and /status kept answering ok:true, so a health
      // check, an uptime monitor and the control dashboard all stayed green. Measured: 44 events stored under
      // a 1 MB file ceiling, then 4 publishes that vanished with no reply and no operator signal anywhere
      // except one line on stderr. AUDIT 2026-08-02.
      let putRes;
      try { putRes = store.put(evt, resolveChurch(evt)); }
      catch (err) {
        STORE_DEGRADED = { at: Date.now(), why: String((err && err.message) || err).slice(0, 200) };
        try { console.error('[relay] STORAGE FAILURE — refusing writes:', STORE_DEGRADED.why); } catch (e) {}
        ws.send(JSON.stringify(['OK', evt.id, false, 'error: relay storage unavailable — nothing was saved']));
        return;
      }
      if (STORE_DEGRADED) STORE_DEGRADED = null;   // a write got through: whatever it was has cleared
      // AUDIT 2026-07-26 (CRITICAL): note() used to run BEFORE put(), so a write the relay then REFUSED had
      // already rewritten the live maps — MEMBER_DOCS, BLOCKED_BY, ADMITTED_BY, STEWARDS_BY, MINORS_BY,
      // GUARDIANS_BY, GROUP_MEMBERS, GROUP_VIS, ROSTER_PEOPLE. Replay is not author-gated (any socket may send
      // any validly signed event), so anyone holding a stale copy of a church doc could replay it and revert
      // authorization until the next restart re-ran hydrateMaps(): a removed member re-admitting themselves, a
      // revoked steward restoring their authority, a child's DM protections being stripped — and worst,
      // replaying a stale group doc put the attacker back in GROUP_MEMBERS, which canRead() consults, handing
      // them the READ history of an invite-only group. The store was always right; the running relay was not.
      if (putRes === 'stored') note(evt);   // a membership/broadcast change takes effect for subsequent events
      // NIP-09 BEFORE the duplicate/have-newer early returns: a re-sent kind-5 comes back as 'duplicate', and
      // the old code returned on that without ever applying the deletion — so the second and every later
      // delivery of a deletion was a no-op. That is the usual case after a reconnect or a resync.
      // NOT before the 'future' return, though: a future-dated kind-5 is refused and never replicates, so
      // applying it would delete locally, tombstone permanently, and then ACK false — a divergence this relay
      // could never heal. AUDIT 2026-07-25.
      if (evt.kind === 5 && putRes !== 'future') applyDeletions(evt);
      // AUDIT-2026-07-24: a discarded write was ACKed as `OK … true`. A client that lost the newest-wins race
      // was told its edit saved; the next read showed the other version and looked like data loss. Say no.
      if (putRes === 'have-newer') { ws.send(JSON.stringify(['OK', evt.id, false, 'invalid: a newer version of this is already stored — reload and edit again'])); return; }
      if (putRes === 'deleted') { ws.send(JSON.stringify(['OK', evt.id, false, 'blocked: this event was deleted by its author'])); return; }
      if (putRes === 'duplicate') { ws.send(JSON.stringify(['OK', evt.id, true, 'duplicate'])); return; }
      // NOT `invalid:` — the client classifier treats invalid/blocked/restricted as PERMANENT and drops the event
      // from the outbox on the first attempt. created_at is fixed at signing while the relay's clock advances, so
      // this is the one refusal here that fixes itself: the same event succeeds on the next retry. Marking it
      // permanent meant a cheap phone with no NTP failed to send EVERY message instead of every message landing a
      // minute later — the first audience, exactly. `error:` is NIP-01's catch-all and reads as transient.
      if (putRes === 'future') { ws.send(JSON.stringify(['OK', evt.id, false, 'error: timestamp is too far in the future — check this device’s clock'])); return; }
      if (++_putsSinceCull >= 256) { _putsSinceCull = 0; store.cull(); }   // E6: throttle the GROUP BY cull off the per-event hot path (was every stored event)
      maybePush(evt);   // notify the targeted member if this is a serving request
      maybePushJoin(evt, wasMember);   // notify the steward's phone if this is a fresh church join
      maybePushMessage(evt);   // notify on a new DM (recipient) or church announcement (members)
      maybePushSermon(evt);    // notify members when the church features a new sermon (video/audio)
      maybePushSafety(evt);    // safety check: alert members on open, nudge the creator on responses
      ws.send(JSON.stringify(['OK', evt.id, true, '']));
      let _evtJson = null;   // E6: serialize the event ONCE (lazily, on first match) and reuse for every matching subscriber — was N JSON.stringify(evt) for N subs
      // Per-client try/catch: a throw while matching ONE subscriber's filters used to abort the whole loop, so
      // every client after it in insertion order silently stopped receiving live messages while the relay
      // stayed up. Isolate each client — no single subscription may ever cost another member their delivery.
      for (const [client, m] of subs) { if (client.readyState !== 1) continue;
        try {
          for (const [subId, filters] of m) if (matchAny(evt, filters) && canRead(evt, client._auth)) { if (_evtJson === null) _evtJson = JSON.stringify(evt); client.send('["EVENT",' + JSON.stringify(subId) + ',' + _evtJson + ']'); }
        } catch (err) { try { console.warn('[relay] broadcast to one client failed', (err && err.message) || err); } catch {} }
      }
    } else if (type === 'REQ') {
      const subId = rest[0];
      let filters = rest.slice(1);
      if (filters.length === 1 && Array.isArray(filters[0])) filters = filters[0];
      if (filters.length > MAX_FILTERS_PER_REQ) { ws.send(JSON.stringify(['CLOSED', subId, 'invalid: too many filters'])); return; }
      const mysubs = subs.get(ws);
      if (!mysubs.has(subId) && mysubs.size >= MAX_SUBS_PER_CONN) { ws.send(JSON.stringify(['CLOSED', subId, 'rate-limited: too many subscriptions'])); return; }
      // Refuse a malformed filter at the door. matchFilter now treats one as matching nothing, but a client
      // that sent rubbish deserves to hear so, and an unstorable filter should never be retained at all.
      const badFilter = filters.find(f => !f || typeof f !== 'object' || Array.isArray(f)
        || ['ids', 'authors', 'kinds'].some(k => f[k] !== undefined && !Array.isArray(f[k]))
        || Object.keys(f).some(k => k[0] === '#' && !Array.isArray(f[k])));
      if (badFilter) { ws.send(JSON.stringify(['CLOSED', subId, 'invalid: malformed filter'])); return; }
      mysubs.set(subId, filters);
      // serve everything this connection may read now (blocked members withheld; invite-only group
      // messages withheld from non-members per NIP-42)
      let matched = []; const _seen = new Set(); let wantsSafeguard = false;
      let _reqEvents = 0;
      const _scanBudget = { left: 300000 };   // shared across ALL filters of this REQ: caps total fallback-scan rows so a crafted many-filter/multi-letter-tag REQ can't freeze the loop (E1)
      // SECURITY-AUDIT-2026-07-20 C1: this branch used to carry a SECOND hand-maintained copy of canRead's
      // private-d-prefix list, purely to decide whether to challenge. Two lists that must agree is one list
      // too many — they had already drifted (canRead gated GUARDNOTICE_D, this one didn't), and every fix to
      // one silently half-applied. It is now derived from canRead itself: if we withheld a doc-or-DM from an
      // unauthenticated connection, challenge it so the legitimate owner can AUTH and have it replayed. Kind-1
      // is deliberately excluded — a broad query that merely happens to match an invite-only group message is
      // still NOT challenged, so ordinary reads pay no auth round-trip (the lazy-auth perf decision stands).
      // AUDIT-2026-07-27: challenge whenever we withhold ANYTHING from an unauthenticated reader, not only
      // kind-30078/4. Once kind-0/5/7 became member-gated, a member's own {kinds:[0]} REQ was withheld and
      // never challenged, so their app rendered a church with no names — a gate has to come with its prompt.
      scan: for (const f of filters) for (const e of store.query(f, _scanBudget)) { if (_seen.has(e.id)) continue; _seen.add(e.id); if (BLOCKED.has(e.pubkey)) continue; if (!canRead(e, ws._auth)) { if (!ws._auth) wantsSafeguard = true; continue; } matched.push(e); if (++_reqEvents >= MAX_REQ_EVENTS) break scan; }   // aggregate cap across ALL filters (DoS): a no-limit REQ can't materialize 32x10k events
      matched.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));   // oldest→newest, matching the previous array delivery order
      // LAZY NIP-42: challenge ONLY when the REQ explicitly targets an invite-only group (a #t for an
      // invite group id). A broad query (e.g. #p:church) that merely happens to match an invite message
      // is NOT challenged — those messages are just silently withheld — so ordinary reads pay no auth cost.
      // Challenge when the REQ names a group whose messages we withhold from an unauthenticated reader: an
      // invite-only group, or (safeguarding) any group not marked child-safe. Without this the client would
      // just receive an empty room. Still filter-driven, so a broad query that merely happens to match such a
      // message is not challenged — the lazy-auth decision stands for ordinary browsing.
      // Challenge for ANY group we know, child-safe included. Child-safe rooms used to be excluded here because
      // they were served anonymously; now that they require membership like every other room, a member whose
      // client was never challenged would simply render an empty room forever. AUDIT-2026-07-27.
      const wantsInvite = !ws._auth && filters.some(f => Array.isArray(f['#t']) && f['#t'].some(t => (GROUP_VIS.get(t) === 'invite') || GROUP_CHURCH.has(t)));
      // Emergency-timing oracle: challenge from the FILTER (not only a found event) so an anon REQ for a safety d-tag
      // gets an identical AUTH whether or not a check is live — no "is this church under attack right now?" distinguisher.
      const wantsSafetyD = !ws._auth && filters.some(f => (f['#d'] || []).some(d => typeof d === 'string' && (d.startsWith(SAFETY_D) || d.startsWith(SAFE_D))));
      if (wantsInvite || wantsSafeguard || wantsSafetyD) { try { ws.send(JSON.stringify(['AUTH', ws._challenge])); } catch {} }   // safeguarding: challenge so a member's client auths + gets the lists (AUTH-success re-delivers)
      // NIP-01's `limit` is per-filter. Taking the MAX across the merged union meant a REQ mixing one limited
      // and one unlimited filter was bounded only by the 5,000 default — the shipped client sends two
      // 1000-limit DM filters and could receive 1000 total instead of 1000+1000. Sum the declared limits so a
      // multi-filter REQ still gets what each filter asked for, and an unlimited filter still caps at the max.
      const _lims = filters.map(f => f.limit || 0);
      const lim = _lims.every(l => l > 0) ? Math.min(MAX_REQ_EVENTS, _lims.reduce((a, b) => a + b, 0)) : Math.max(0, ..._lims);
      if (lim) matched = matched.slice(-lim);
      for (const e of matched) { if (ws.bufferedAmount > MAX_WS_BUFFER) { try { ws.close(1009, 'too slow'); } catch {} return; } ws.send(JSON.stringify(['EVENT', subId, e])); }   // backpressure: a client that isn't reading can't make us buffer unbounded
      // AUDIT-2026-07-24 (root cause of a whole class of client-side data loss): when we WITHHELD private docs
      // from an unauthenticated connection, an immediate EOSE says "that is everything" — indistinguishable
      // from "this church has none". Clients then act on that emptiness destructively: mint a second care key,
      // republish a one-entry minors list over the real one, re-seed the finance book. We already challenge
      // here, so hold the EOSE until the AUTH round-trip resolves (the AUTH handler replays what was withheld
      // and then flushes these), or until a short timeout if the client never authenticates. A late EOSE is
      // ordinary; a premature one is a lie. NOT ["CLOSED", …, "auth-required: …"] — nostr-tools only recovers
      // from that when a per-subscription `onauth` is passed, which SimplePool's automaticallyAuth does not
      // set, so CLOSED would silently kill the subscription instead.
      if (wantsSafeguard && !ws._auth) {
        if (!ws._pendingEose) ws._pendingEose = new Map();
        const prev = ws._pendingEose.get(subId); if (prev) clearTimeout(prev);
        ws._pendingEose.set(subId, setTimeout(() => {
          if (ws._pendingEose) ws._pendingEose.delete(subId);
          if (ws.readyState === 1) { try { ws.send(JSON.stringify(['EOSE', subId])); } catch {} }
        }, EOSE_AUTH_GRACE_MS));
      } else ws.send(JSON.stringify(['EOSE', subId]));
    } else if (type === 'AUTH') {
      // NIP-42: the client proves which pubkey it controls, so we can serve it invite-only group reads
      const evt = rest[0];
      try {
        const ch = evt && (evt.tags.find(t => t[0] === 'challenge') || [])[1];
        const fresh = evt && Math.abs(Math.floor(Date.now() / 1000) - (evt.created_at || 0)) < 600;
        // AUDIT-2026-07-24 (HIGH): NIP-42's ['relay', …] tag exists to bind an auth to ONE relay, and we never
        // read it. The client signs an auth for any relay in its pool, and invites carry ?relay= / ?relayname=
        // straight from a QR — so a hostile relay could open a socket to the church's real relay, harvest its
        // challenge, hand it to the member's app as its own, and replay the signed result to authenticate AS
        // that member: their DMs, the roster, care records. Require the tag to name the host this connection
        // was actually dialled on. (Tunnels forward the original Host, so this is the name the member used.)
        let boundToUs = false;
        try { const rt = evt && (evt.tags.find(t => t[0] === 'relay') || [])[1]; boundToUs = !!rt && !!ws._host && new URL(String(rt)).hostname.toLowerCase() === ws._host; } catch { boundToUs = false; }
        if (evt && evt.kind === 22242 && ch === ws._challenge && fresh && boundToUs && verifyEvent(evt) && !BLOCKED.has(evt.pubkey)) {
          // SECURITY-AUDIT-2026-07-06 H1: a BLOCKED pubkey must never satisfy a read gate — refuse to authenticate it.
          ws._auth = evt.pubkey; ws.send(JSON.stringify(['OK', evt.id, true, '']));
          // now authed: replay everything the open subs were waiting on that the connection can NOW read
          // but could NOT while unauthed — invite-only group messages AND the safeguarding lists (minors/
          // approved/guardians). SECURITY-AUDIT-2026-07-06 H1: the old gate re-sent ONLY invite-group kind-1,
          // so a legitimately-authed member never received the safeguarding docs (the mirror silently
          // degraded). Re-send anything withheld-when-unauthed (`!canRead(e,null)`) — public events already
          // went out at REQ time, so `canRead(e,null)===true` skips them and no duplicate is sent.
          const mine = subs.get(ws);
          // SECURITY-AUDIT-2026-07-18 M1: ONE replay budget shared across ALL subs of this connection — was created
          // per-sub, so a connection holding the max subs could drive subs×300k row-parses on a single cheap AUTH.
          const _replayBudget = { left: 300000 };
          if (mine) for (const [subId, filters] of mine) {
            const seen = new Set();
            for (const f of filters) for (const e of store.query(f, _replayBudget)) {
              if (seen.has(e.id)) continue; seen.add(e.id);
              if (BLOCKED.has(e.pubkey) || !canRead(e, ws._auth)) continue;
              if (!canRead(e, null)) { if (ws.bufferedAmount > MAX_WS_BUFFER) { try { ws.close(1009, 'too slow'); } catch {} return; } ws.send(JSON.stringify(['EVENT', subId, e])); }
            }
          }
          // the replay above is what the deferred EOSEs were waiting for — now the client really does have
          // everything it may read, so end those subscriptions' backlog honestly.
          if (ws._pendingEose) {
            for (const [sid, t] of ws._pendingEose) { clearTimeout(t); try { ws.send(JSON.stringify(['EOSE', sid])); } catch {} }
            ws._pendingEose.clear();
          }
        } else ws.send(JSON.stringify(['OK', (evt && evt.id) || '', false, boundToUs ? 'auth-failed: bad challenge or signature' : 'auth-failed: this auth is not addressed to this relay']));
      } catch { ws.send(JSON.stringify(['OK', (evt && evt.id) || '', false, 'auth-failed'])); }
    } else if (type === 'CLOSE') { subs.get(ws)?.delete(rest[0]); }
  });
  ws.on('close', () => { subs.delete(ws); if (ws._pendingEose) { for (const t of ws._pendingEose.values()) clearTimeout(t); ws._pendingEose.clear(); } });
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
const BIND_HOST = process.env.RELAY_HOST || '0.0.0.0';   // servers keep 0.0.0.0; the desktop app sets this explicitly (loopback unless the operator opts into LAN access — see relay-app/desktop/src-tauri/src/main.rs)
server.listen(PORT, BIND_HOST, () =>
  console.log(`TrinityOne gateway on http://${BIND_HOST}:${PORT}  (app + relay at /relay, ${store.count()} events loaded)` +
    (CHURCH_PUBS.size ? `\n  write policy ON — ${CHURCH_PUBS.size} church(es), ${MEMBERS.size} members, ${BROADCAST.size} broadcast group(s)` : `\n  write policy OFF (open relay — set up a church in the control dashboard)`) +
    `\n  setup / control:  http://localhost:${PORT}/relay-app/control.html` +
    `\n  admin token (needed to configure from another device): ${ADMIN_TOKEN}` +
    (!_strictWeb ? `\n  ⚠ CSP is LAX (unsafe-inline/eval) — served shells still carry in-browser Babel. Deploy a PRE-TRANSPILED build (or set STRICT_CSP=1) before go-live: the console holds the church key.` : '')));
// "Stay public": if the operator turned on the tunnel before, re-open it on boot (a fresh quick-tunnel URL) and
// re-point the relay's directory name at it — so a restart doesn't silently drop members' access.
if (existsSync(TUNNEL_FLAG)) { setTimeout(() => { startCloudflared().then(r => console.log(r.ok ? `  tunnel re-opened: ${r.url}` : `  tunnel re-open failed: ${r.error || ''}`)).catch(() => {}); }, 2500); }
