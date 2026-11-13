// SERVER SIDE OF THE RELAY DATA MOVE — relay storage plan step 6 (TrinityOne-internal/reference/
// PLAN-relay-storage-location-2026-11-12.html, section 2 "R2" and section 8c). The logic that scripts/relay-move.sh (the
// ROOT helper started by trinityone-move.path) cannot safely do in bash: judging a request that came from a web form,
// keeping the move journal in a file only root writes, proving the restarted relay is the same relay, and deleting the
// old copy. relay-move.mjs (the engine) does the move itself and is NOT reimplemented here.
//
// THE REQUEST IS A WISH, NOT AN AUTHORITY. .move-request / .remove-old-request are written by the relay process, which
// is sandboxed but is the one thing a compromise reaches first. So nothing in them is trusted:
//   * a move names a MOUNTPOINT only. The target is always <mountpoint>/trinityone-relay, and the mountpoint must be in
//     /etc/fstab (systemd can mount it before the relay at boot), mounted right now, on a local filesystem we run SQLite
//     on, not under the app / a system folder / /home, with no symlink anywhere on the way and every folder on the way
//     owned by root and not writable by anyone else (so the service user cannot swap one for a link).
//   * a remove names a PATH, but only one the ROOT-owned journal recorded as the old copy or a leftover.
//   * the journal the mover wrote (in a scratch folder the service user owns) is not believed either: absorbJournal()
//     copies it into the root-owned journal only after checking it names the folders this helper itself chose.
//
// Subcommands print one JSON object; exit 0 = ok, 2 = refused / not ok, 1 = usage or unexpected error.
import {
  readFileSync, writeFileSync, existsSync, lstatSync, readdirSync, rmSync, realpathSync, openSync, closeSync, fstatSync,
  readSync, unlinkSync, constants as FS,
} from 'node:fs';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEAF, MOVED_TO, ACTIVE, parseMountinfo, classifyTarget, samePath, keyPubOf, jsonFieldStore, jsonPointer,
  beginCheck, compareAfterRestart, checkPassed, rollbackMove, recoverMove, countRows, writeAtomic,
} from './relay-move.mjs';

// Linux server filesystems we run the relay's SQLite on (plan section 3, "Linux server").
export const SERVER_FS = new Set(['ext4', 'xfs', 'btrfs', 'zfs', 'f2fs']);
// What relay-datadir-apply.sh will write into relay.env and the drop-ins; a folder outside this set is refused here
// so a request never reaches a writer that would refuse it half-way through a move.
export const SAFE_PATH = /^\/[A-Za-z0-9_./@+:=,-]*$/;

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const inside = (a, b) => { const r = relative(b, a); return r === '' || (!!r && !r.startsWith('..') && !isAbsolute(r)); };

// A request file, read the way root must read a file the service user controls: no symlink at the end (O_NOFOLLOW),
// a regular file, small. Returns { ok, request } | { ok:false, code }.
export function readRequestFile(file) {
  let fd;
  try { fd = openSync(file, FS.O_RDONLY | FS.O_NOFOLLOW); } catch (e) { return { ok: false, code: e && e.code === 'ELOOP' ? 'request-is-a-link' : 'bad-request' }; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > 8192) return { ok: false, code: 'bad-request' };
    const buf = Buffer.alloc(st.size); readSync(fd, buf, 0, st.size, 0);
    const o = JSON.parse(buf.toString('utf8'));
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, code: 'bad-request' };
    return { ok: true, request: o };
  } catch { return { ok: false, code: 'bad-request' }; } finally { try { closeSync(fd); } catch {} }
}

// /etc/fstab -> mountpoints (persistent mounts only).
export function fstabMountpoints(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const f = line.replace(/#.*/, '').trim().split(/\s+/); if (f.length < 3) continue;
    const mp = f[1].replace(/\\040/g, ' ');
    if (!mp.startsWith('/') || mp === '/' || f[2] === 'swap') continue;
    out.push(mp);
  }
  return out;
}

// validateMoveRequest: the helper's own judgement of a move request. Pure apart from lstat/readdir, which are
// injectable. Returns { ok:true, drive, target, fsType, warn } or { ok:false, code, detail? }.
//   checkFrom: ancestors ABOVE this path are not required to be root-owned (default '/', i.e. every one is checked);
//              only a test sets it, because a temp folder lives under a sticky, world-writable /tmp.
export function validateMoveRequest({ request, fstabText, mountinfoText, dataDir, codeDir, rootUid = 0, checkFrom = '/',
  lstat = lstatSync, readdir = readdirSync, realpath = realpathSync }) {
  const no = (code, detail) => ({ ok: false, code, ...(detail ? { detail } : {}) });
  const drive = request && request.drive;
  if (typeof drive !== 'string' || !drive.startsWith('/') || drive.includes('\0')) return no('drive-not-offered');
  if (resolve(drive) !== drive || drive === '/') return no('drive-not-offered');
  if (!SAFE_PATH.test(drive)) return no('path-unsupported');
  if (!fstabMountpoints(fstabText).includes(drive)) return no('not-in-fstab');
  const mounts = parseMountinfo(String(mountinfoText || ''));
  const m = [...mounts].reverse().find(x => x.mountpoint === drive);      // the topmost mount if several are stacked
  if (!m) return no('not-mounted');
  if (!SERVER_FS.has(String(m.fsType || '').toLowerCase())) return no('filesystem-not-supported', m.fsType);
  const target = join(drive, LEAF);
  const cls = classifyTarget({ path: target, fsType: m.fsType, mountOptions: m.options, mode: 'server', codeDir, platform: 'linux' });
  if (!cls.eligible) return no('target-ineligible', cls.refuse.join(','));
  if (dataDir && (samePath(target, dataDir, 'linux') || inside(target, dataDir) || inside(dataDir, target))) return no('target-overlaps-source');
  // every folder on the way to the drive: a real directory, no link, root-owned, nobody else can write to it
  const parts = drive.split('/').filter(Boolean); let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    let st; try { st = lstat(cur); } catch { return no('drive-missing'); }
    if (st.isSymbolicLink()) return no('path-has-symlink', cur);
    if (!st.isDirectory()) return no('drive-missing', cur);
    if (inside(cur, checkFrom) && (st.uid !== rootUid || (st.mode & 0o022))) return no('path-not-root-owned', cur);
  }
  let real; try { real = realpath(drive); } catch { return no('drive-missing'); }
  if (real !== drive) return no('path-has-symlink', real);
  let st = null; try { st = lstat(target); } catch {}
  if (st) {
    if (st.isSymbolicLink() || !st.isDirectory()) return no('target-not-empty');
    if (readdir(target).length) return no('target-not-empty');
  }
  return { ok: true, drive, target, fsType: m.fsType, warn: cls.warn };
}

// ── the journal ──────────────────────────────────────────────────────────────────────────────────────────────
// Root's journal is <state>/move-state.json {dataDir, relayPub, move}. The mover runs as the service user against a
// scratch copy; absorbJournal() is the only way its result reaches the root file.
export function seedScratch({ state, work, from }) {
  const root = readJson(state) || {};
  const o = { dataDir: from, relayPub: keyPubOf(from) };
  if (root.move) o.move = root.move;
  writeFileSync(join(work, 'state.json'), JSON.stringify(o, null, 2) + '\n');
  return o;
}
// A recorded leftover / old-copy path is believable only if it is one of the two folders of THIS move, or a sibling the
// mover derives from their names (<name>-failed-<stamp>, <name>-interrupted-<stamp>, <name>.tombstone-tmp-<pid>).
function pathBelievable(p, D, T) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.includes('\0')) return false;
  if (samePath(p, D, 'linux') || samePath(p, T, 'linux')) return true;
  for (const base of [D, T]) {
    if (dirname(p) !== dirname(base)) continue;
    const n = basename(p), b = basename(base);
    if (n.startsWith(b + '-') || n.startsWith(b + '.tombstone-tmp-')) return true;
  }
  return false;
}
export function absorbJournal({ state, work, from, target }) {
  const scratch = readJson(join(work, 'state.json'));
  if (!scratch) return { ok: false, code: 'no-result' };
  const root = readJson(state) || {};
  const D = resolve(from), T = resolve(target);
  const dd = scratch.dataDir && resolve(scratch.dataDir);
  if (dd && !samePath(dd, D, 'linux') && !samePath(dd, T, 'linux')) return { ok: false, code: 'pointer-unexpected' };
  let mv = scratch.move || null;
  if (JSON.stringify(mv) !== JSON.stringify(root.move || null)) {
    // the mover changed the journal: it must be about THIS move
    if (!mv || !mv.from || !mv.to || !samePath(mv.from, D, 'linux') || !samePath(mv.to, T, 'linux')) return { ok: false, code: 'journal-unexpected' };
    mv = { ...mv, from: D, to: T };
    if (mv.oldCopy) mv.oldCopy = pathBelievable(mv.oldCopy.path, D, T) ? mv.oldCopy : null;
    if (Array.isArray(mv.leftovers)) mv.leftovers = mv.leftovers.filter(l => l && pathBelievable(l.path, D, T));
    if (typeof mv.leftover === 'string' && !pathBelievable(mv.leftover, D, T)) delete mv.leftover;
  }
  const out = { ...root, dataDir: dd || root.dataDir || D, relayPub: keyPubOf(dd || D) || root.relayPub, ...(mv ? { move: mv } : {}) };
  if (!mv) delete out.move;
  writeAtomic(state, JSON.stringify(out, null, 2) + '\n');
  return { ok: true, dataDir: out.dataDir, state: mv ? mv.state : null };
}
// A refused or failed attempt, where GET /storage can show it (move.code). Never overwrites a move under way, and keeps
// the old copy's record: when one awaits removal the code is added beside it as `refusal`, not as a new state.
export function recordRefusal({ state, code, detail, from, now = () => new Date() }) {
  const root = readJson(state) || {};
  const prev = root.move || null;
  const at = now().toISOString();
  let mv;
  if (prev && (ACTIVE.has(prev.state) || prev.state === 'awaiting-confirm')) mv = { ...prev, refusal: { code, ...(detail ? { detail } : {}), at } };
  else mv = { ...(prev || {}), ...(from && !(prev && prev.from) ? { from } : {}), state: 'failed', code, ...(detail ? { detail } : {}), endedAt: at, refusal: { code, ...(detail ? { detail } : {}), at } };
  writeAtomic(state, JSON.stringify({ ...root, move: mv }, null, 2) + '\n');
  return mv;
}

// ── remove old copy ────────────────────────────────────────────────────────────────────────────────────────────
// Deletes everything in a recorded old copy / leftover EXCEPT its MOVED-TO note (the tombstone stays, plan section 3 step 9).
// The checks run once before anything is deleted and AGAIN before every deletion (audit L-4 / N-c: the gateway's own
// check is a courtesy; this is the boundary, and the folder can be swapped for a link to the live one between a check
// and an rm). `hooks.beforeDelete(name)` exists only so a test can do exactly that swap.
export function removeRecorded({ path, liveDirs, relayPub }, hooks = {}) {
  const live = (liveDirs || []).filter(Boolean);
  const still = (full) => {
    let st; try { st = lstatSync(path); } catch { return 'gone'; }
    if (st.isSymbolicLink() || !st.isDirectory()) return 'not-a-folder';
    let real; try { real = realpathSync(path); } catch { return 'gone'; }
    for (const l of live) {
      let lr = l; try { lr = realpathSync(l); } catch {}
      for (const x of [path, real]) for (const y of [l, lr]) if (samePath(x, y, 'linux') || inside(x, y) || inside(y, x)) return 'current-folder';
    }
    let nt; try { nt = lstatSync(join(path, MOVED_TO)); } catch { return 'no-moved-note'; }
    if (!nt.isFile()) return 'no-moved-note';
    return null;
  };
  let bad = still();
  if (bad === 'gone') return { ok: true, code: 'already-gone', removed: 0 };
  if (bad) return { ok: false, code: bad };
  const names = readdirSync(path).filter(n => n !== MOVED_TO && !n.startsWith(MOVED_TO + '.tmp-'));
  // a folder that holds more than the note must be THIS relay's own old copy (its key is the one we run)
  if (names.length && (!relayPub || keyPubOf(path) !== relayPub)) return { ok: false, code: 'not-this-relays-copy' };
  let removed = 0;
  for (const n of readdirSync(path)) {
    if (n === MOVED_TO) continue;
    if (hooks.beforeDelete) hooks.beforeDelete(n);
    bad = still();                                   // THE RE-CHECK, at the moment of deletion
    if (bad) return { ok: false, code: bad, removed };
    rmSync(join(path, n), { recursive: true, force: true }); removed++;
  }
  return { ok: true, code: 'removed', removed };
}
// remove-old, end to end against the root journal. request = { path }.
export function removeOld({ state, request, liveDirs, now = () => new Date() }, hooks = {}) {
  const root = readJson(state) || {};
  const j = root.move || null;
  const path = request && typeof request.path === 'string' ? request.path : '';
  if (!j || !path) return { ok: false, code: 'not-recorded' };
  const isOld = j.state === 'awaiting-confirm' && j.oldCopy && j.oldCopy.path && samePath(j.oldCopy.path, path, 'linux');
  const left = (j.leftovers || []).find(l => l && l.path && !l.removedAt && samePath(l.path, path, 'linux'));
  if (!isOld && !left) return { ok: false, code: 'not-recorded' };
  const r = removeRecorded({ path, liveDirs: [...(liveDirs || []), root.dataDir], relayPub: root.relayPub || j.relayPub }, hooks);
  if (!r.ok) { recordRefusal({ state, code: 'remove-' + r.code, from: j.from }); return r; }
  const at = now().toISOString();
  const n = { ...j };
  if (isOld) { n.state = 'done'; n.oldCopy = { ...j.oldCopy, removedAt: at }; }
  if (Array.isArray(n.leftovers)) n.leftovers = n.leftovers.map(l => (l && l.path && samePath(l.path, path, 'linux')) ? { ...l, removedAt: at } : l);
  delete n.refusal;
  writeAtomic(state, JSON.stringify({ ...root, move: n }, null, 2) + '\n');
  return { ok: true, code: r.code, removed: r.removed };
}

// ── proving the relay that came back ───────────────────────────────────────────────────────────────────────────
// Waits for /status to answer ok:true, then asks /relay-identity for a signature over a nonce of OUR choosing and
// verifies it (rule 10: the bare relayPub string in /status or NIP-11 is unauthenticated and proves nothing).
export async function proveIdentity({ port, pub, tries = 60, intervalMs = 2000, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const base = `http://127.0.0.1:${port}`;
  let lastWhy = 'no-answer';
  for (let i = 0; i < tries; i++) {
    try {
      const st = await fetchImpl(base + '/status', { signal: AbortSignal.timeout(5000) });
      const body = st.ok ? await st.json() : null;
      if (!body) lastWhy = 'no-answer';
      else if (body.ok !== true) lastWhy = 'degraded';
      else {
        const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
        const r = await fetchImpl(`${base}/relay-identity?nonce=${nonce}`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) lastWhy = 'identity-' + r.status;
        else {
          const { proof } = await r.json();
          const { verifyEvent } = await import('nostr-tools/pure');
          const tag = n => ((proof && proof.tags) || []).find(t => t[0] === n);
          const fresh = proof && Math.abs(Math.floor(Date.now() / 1000) - proof.created_at) < 120;
          if (proof && proof.kind === 27235 && verifyEvent(proof) && fresh && tag('nonce') && tag('nonce')[1] === nonce) {
            return proof.pubkey === pub ? { ok: true, pub: proof.pubkey } : { ok: false, code: 'relay-key', pub: proof.pubkey };
          }
          lastWhy = 'identity-proof-invalid';
        }
      }
    } catch { lastWhy = 'no-answer'; }
    if (i < tries - 1) await sleep(intervalMs);
  }
  return { ok: false, code: lastWhy };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) { const a = {}; for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return a; }
const need = (a, ...ks) => { for (const k of ks) if (!a[k] || a[k] === true) throw new Error('--' + k + ' required'); };
export async function cli(argv) {
  const cmd = argv[0], a = parseArgs(argv);
  const stores = () => { need(a, 'state'); return { journal: jsonFieldStore(a.state, 'move'), pointer: jsonPointer(a.state) }; };
  switch (cmd) {
    case 'take-request': {                  // read the request safely, write a root-owned copy, delete the original
      need(a, 'file', 'out');
      const r = readRequestFile(a.file);
      try { unlinkSync(a.file); } catch {}
      if (r.ok) { writeFileSync(a.out, JSON.stringify(r.request), { mode: 0o600 }); }
      return r.ok ? { ok: true } : r;
    }
    case 'validate': {
      need(a, 'request', 'fstab', 'mountinfo', 'data-dir');
      const req = readJson(a.request);
      let fstabText = '', mountinfoText = '';
      try { fstabText = readFileSync(a.fstab, 'utf8'); } catch {}
      try { mountinfoText = readFileSync(a.mountinfo, 'utf8'); } catch {}
      return validateMoveRequest({ request: req, fstabText, mountinfoText, dataDir: a['data-dir'], codeDir: a['code-dir'],
        rootUid: a['root-uid'] !== undefined ? Number(a['root-uid']) : 0, checkFrom: a['check-from'] || '/' });
    }
    case 'drive-of': { const q = readJson(a.request); return { ok: true, drive: q && q.drive || '', path: q && q.path || '' }; }
    case 'seed': { need(a, 'state', 'work', 'from'); seedScratch({ state: a.state, work: a.work, from: a.from }); return { ok: true }; }
    case 'absorb': { need(a, 'state', 'work', 'from', 'target'); return absorbJournal({ state: a.state, work: a.work, from: a.from, target: a.target }); }
    case 'refuse': { need(a, 'state', 'code'); recordRefusal({ state: a.state, code: a.code, detail: a.detail && a.detail !== true ? a.detail : undefined, from: a.from }); return { ok: true }; }
    case 'active': { const j = (readJson(a.state) || {}).move; return { ok: true, active: !!(j && ACTIVE.has(j.state)) }; }
    case 'pointer': { const r = readJson(a.state) || {}; return { ok: true, dataDir: r.dataDir || '' }; }
    case 'current-pub': { need(a, 'dir'); return { ok: true, pub: keyPubOf(a.dir) }; }
    case 'begin-check': return beginCheck({ journal: stores().journal });
    case 'compare': {
      need(a, 'pub'); const { journal } = stores(); const j = journal.read();
      if (!j) return { ok: false, bad: ['no-move-to-check'] };
      let counts = null; try { counts = await countRows(j.to, { readOnly: true }); } catch {}
      const bad = compareAfterRestart(j, { relayPub: a.pub, counts });
      return { ok: bad.length === 0, bad };
    }
    case 'pass': { const r = checkPassed(stores()); return r ? { ok: true, state: r.state } : { ok: false, code: 'nothing-to-pass' }; }
    case 'rollback': return rollbackMove(stores());
    case 'recover': { const r = await recoverMove(stores()); return r.action === 'refuse' ? { ok: false, ...r } : { ok: true, ...r }; }
    case 'prove': { need(a, 'port', 'pub'); return proveIdentity({ port: Number(a.port), pub: a.pub, tries: Number(a.tries || 60), intervalMs: Number(a.interval || 2) * 1000 }); }
    case 'remove-old': {
      need(a, 'state', 'request', 'live');
      return removeOld({ state: a.state, request: readJson(a.request), liveDirs: String(a.live).split(':').filter(Boolean) });
    }
    default: throw new Error('usage: relay-move-server.mjs take-request|validate|seed|absorb|refuse|active|pointer|current-pub|begin-check|compare|pass|rollback|recover|prove|remove-old …');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(r => { console.log(JSON.stringify(r)); process.exit(r && r.ok === false ? 2 : 0); },
    e => { console.error(String(e && e.message || e)); process.exit(1); });
}
