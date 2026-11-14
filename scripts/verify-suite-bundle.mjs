#!/usr/bin/env node
// Verify a Suite JS auto-update bundle's detached Ed25519 signature over the EXACT tarball bytes, and report the
// build identity that is INSIDE those signed bytes.
//
//   node scripts/verify-suite-bundle.mjs <bundle.tgz> <bundle.sig> <release-pubkey.pem>
//
// Exit 0 = the signature is good AND the bundle is a Suite JS bundle carrying a well-formed version.txt. On exit 0
// stdout is ONE line of JSON: {"sha":"<40 hex>","date":"<ISO commit date>"} — read from version.txt INSIDE the
// verified tarball. Any non-zero exit = REJECT; the reason is written to stderr.
//
// WHY THE IDENTITY COMES FROM HERE (audit AUDIT-suite-autoupdate-be258b42 HIGH 2). The signature covers only the
// tarball's bytes. suite-latest.json (sha, date, version) is NOT signed — anyone who can edit the GitHub Release
// can rewrite it. Every "is this newer?" decision (anti-rollback, the downgrade floor, which sha to quarantine,
// the date recorded as installed) must therefore use the sha + commit date in the bundle's OWN version.txt,
// which build-relay-payload.sh stamps and the release key signs. Reading it here, from the same buffer the
// signature was checked over, leaves no gap between "verified" and "read".
//
// WHAT COUNTS AS A SUITE BUNDLE. The same release key also signs the SERVER relay bundle (bundle.tgz) on the same
// Release. Nothing in a signature says what kind of file it is, so a manifest could point a Suite at that file.
// A Suite bundle is recognised by carrying, at its root: version.txt (sha + date), release-origin (written only
// by build-relay-payload.sh — the server bundle never has it; without it the override boots PACKAGED=false) and
// scripts/gateway.mjs. Anything else is refused (exit 7) even though its signature is good.
//
// STEP-1 PROTECTION (audit L-6). The Suite runs ANY newer signed bundle, and trusts that bundle's gateway.mjs to
// carry the data-folder guard from relay storage step 1: refuse to start on a missing / moved-out folder rather
// than mint a NEW relay identity there (rule 10). A bundle built from older code lacks it, so it is refused
// (exit 7) even though its signature is good. The markers are searched in the gateway source with comments
// STRIPPED, so a comment that merely names them does not pass; they are the guard's own statements.
//
// WHY THIS IS IN NODE (not Rust, not openssl): the Rust app shell holds no crypto and has no portable openssl
// (not reliably present on Windows/macOS), so it shells out to THIS script with the bundled node. It reuses the
// crypto path production already trusts for the release manifest (crypto.verify(null, …) — raw Ed25519). ONE
// implementation, used by the relay (pre-verify at stage time) and the shell (authoritative verify before
// activating, and at every launch). Self-contained and side-effect-free: it reads three files, writes nothing.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

// A JS bundle unpacks to tens of MB; 1 GiB is far above any real bundle and stops a gzip bomb (only reachable
// with a validly-SIGNED file anyway, since this runs after the signature check).
const MAX_UNPACKED = 1024 * 1024 * 1024;

// Minimal tar reader: returns Map(name -> Buffer) for the regular files whose normalised name is in `wanted`.
// Handles ustar prefix, pax 'x' path records and GNU 'L' long names. A name listed twice is an error (a tar
// extract would keep the LAST copy, so an ambiguous archive is refused rather than guessed at).
function readTarFiles(tar, wanted) {
  const out = new Map();
  // Normalise the way tar resolves a member path: leading '/', empty and '.' segments vanish ('/version.txt',
  // './/version.txt' and 'scripts/./gateway.mjs' all land where their plain names do). A '..' segment is
  // refused outright. Without this an archive could name version.txt twice under spellings the reader saw as
  // different and tar -x wrote to one file (audit f4129a25 LOW 1).
  const norm = (n) => {
    const parts = n.split('/').filter((p) => p !== '' && p !== '.');
    if (parts.includes('..')) throw new Error('a member path climbs out of the bundle: ' + n);
    return parts.join('/');
  };
  const str = (b, s, e) => { const x = b.subarray(s, e); const z = x.indexOf(0); return (z < 0 ? x : x.subarray(0, z)).toString('utf8'); };
  const num = (b, s, e) => {
    if (b[s] & 0x80) { let v = 0; for (let i = s + 1; i < e; i++) v = v * 256 + b[i]; return v; }   // base-256
    const t = str(b, s, e).trim(); return t ? parseInt(t, 8) : 0;
  };
  let off = 0, longName = null, paxPath = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;                           // end-of-archive block
    const size = num(h, 124, 136);
    if (!Number.isFinite(size) || size < 0) throw new Error('bad tar header');
    const type = String.fromCharCode(h[156] || 48);
    let name = str(h, 0, 100);
    if (str(h, 257, 262) === 'ustar') { const pre = str(h, 345, 500); if (pre) name = pre + '/' + name; }
    const dataStart = off + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = str(data, 0, data.length); continue; }
    if (type === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8')); paxPath = m ? m[1] : null; continue; }
    if (type === 'g') continue;
    if (longName != null) { name = longName; longName = null; }
    if (paxPath != null) { name = paxPath; paxPath = null; }
    const n = norm(name);
    if (!wanted.has(n)) continue;
    if (out.has(n)) throw new Error('duplicate entry ' + n);
    if (type !== '0') throw new Error(n + ' is not a regular file');
    out.set(n, Buffer.from(data));
  }
  return out;
}

// Remove // and /* */ comments from JS source, leaving strings, template literals and regex literals intact.
// Good enough for a marker search on our own gateway.mjs (a mis-parse can only HIDE a marker -> refuse, never
// invent one). Exported for the test.
export function stripJsComments(src) {
  let out = '', i = 0, last = '';   // last = last significant char emitted (decides whether '/' starts a regex)
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; last = c; continue;
    }
    if (c === '/' && (last === '' || '(,=:[!&|?{};'.includes(last))) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n' && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      out += src.slice(i, j + 1); i = j + 1; last = '/'; continue;
    }
    out += c; if (!/\s/.test(c)) last = c; i++;
  }
  return out;
}

// The statements that ARE step 1. Each would disappear if the guard were removed; none is satisfiable by a comment.
const STEP1_MARKERS = [
  ['the TRINITY_DATA_DIR_PINNED switch', /process\.env\.TRINITY_DATA_DIR_PINNED\b/],
  ['the MOVED-TO tombstone path', /join\(\s*DATA_DIR\s*,\s*'MOVED-TO'\s*\)/],
  ['the MOVED-TO refusal', /existsSync\(\s*DATA_DIR_MOVED\s*\)/],
  ['the missing-folder refusal when pinned', /if\s*\(\s*DATA_DIR_PINNED\s*\)\s*refuseDataDir\(/],
  ['the refusal exit', /process\.exit\(\s*DATA_DIR_REFUSED\s*\)/],
];
export function missingStep1(gatewayBytes) {
  const code = stripJsComments(Buffer.from(gatewayBytes).toString('utf8'));
  return STEP1_MARKERS.filter(([, re]) => !re.test(code)).map(([what]) => what);
}

// The signed build identity of a verified tarball (already-read bytes). Throws with a reason if absent/malformed.
export function bundleIdentity(tgzBytes) {
  let tar;
  try { tar = gunzipSync(tgzBytes, { maxOutputLength: MAX_UNPACKED }); } catch (e) { throw new Error('not a gzip tarball: ' + ((e && e.message) || e)); }
  const files = readTarFiles(tar, new Set(['version.txt', 'release-origin', 'scripts/gateway.mjs']));
  if (!files.has('release-origin')) throw new Error('not a Suite JS bundle (no release-origin at its root)');
  if (!files.has('scripts/gateway.mjs')) throw new Error('not a Suite JS bundle (no scripts/gateway.mjs)');
  if (!files.has('version.txt')) throw new Error('no version.txt in the bundle');
  const lacking = missingStep1(files.get('scripts/gateway.mjs'));
  if (lacking.length) throw new Error('its scripts/gateway.mjs lacks the data-folder protection (relay storage step 1: ' + lacking.join('; ') + ') — running it could mint a new relay identity in a missing folder');
  const [l1, l2] = files.get('version.txt').toString('utf8').split('\n');
  const sha = (l1 || '').trim(), date = (l2 || '').trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('version.txt line 1 is not a git sha');
  if (!date || !Number.isFinite(Date.parse(date))) throw new Error('version.txt line 2 is not a date');
  return { sha, date };
}

export function verifyBundle(tgzPath, sigPath, pemPath) {
  if (!tgzPath || !sigPath || !pemPath) return { code: 2, error: 'usage: verify-suite-bundle.mjs <tgz> <sig> <pubkey.pem>' };
  let pub, data, signature;
  try { pub = createPublicKey(readFileSync(pemPath)); } catch (e) { return { code: 3, error: 'cannot read public key: ' + ((e && e.message) || e) }; }
  try { data = readFileSync(tgzPath); } catch (e) { return { code: 4, error: 'cannot read bundle: ' + ((e && e.message) || e) }; }
  try { signature = readFileSync(sigPath); } catch (e) { return { code: 5, error: 'cannot read signature: ' + ((e && e.message) || e) }; }
  let ok = false;
  try { ok = cryptoVerify(null, data, pub, signature); } catch (e) { return { code: 6, error: 'verify error: ' + ((e && e.message) || e) }; }
  if (!ok) return { code: 1, error: 'signature does not verify against the key' };
  // Signature good → read the identity from THESE bytes (the ones just verified), never from a re-read file.
  try { return { code: 0, identity: bundleIdentity(data) }; }
  catch (e) { return { code: 7, error: 'signed, but refused: ' + ((e && e.message) || e) }; }
}

// Run only when invoked as a script (not when imported by a test). import.meta.url === the executed file.
const invokedDirectly = (() => {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return true; }
})();
if (invokedDirectly) {
  const r = verifyBundle(process.argv[2], process.argv[3], process.argv[4]);
  if (r.code !== 0) process.stderr.write(r.error + '\n');
  else process.stdout.write(JSON.stringify(r.identity) + '\n');
  process.exit(r.code);
}
