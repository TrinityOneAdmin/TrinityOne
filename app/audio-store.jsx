// audio-store.jsx — where audio Bibles live on this device: the registry, the chapter store, "Add your own"
// (streaming unzip + name matching), the boot sweep, and the move of World English into app file storage.
// Plan: TrinityOne-internal/PLAN-AUDIO-BIBLES-2026-11-18.html (v5), Build 1.
//
// EVERYTHING IS INSIDE ONE FUNCTION. app/*.jsx are classic scripts sharing ONE global scope; this file adds exactly one
// global, window.TrinityAudioStore, so it cannot collide with a name in another file.
//
// THE GATE (plan N6). One flag, filesOn() = native && Filesystem present && (android || iosBackupExcludeReady), decides
// file storage, migration and which half of the sweep runs. Nothing here branches on isNativePlatform() alone.
// iosBackupExcludeReady is set per run by iosGate() at boot: true only when the BackupExclude plugin (PR #24, appended to
// AppDelegate.swift by scripts/ios-fixup.sh) answers {excluded:true} for Library/audio. Otherwise iOS stays on IndexedDB.
// The web build and the Suite have no native Filesystem and also stay on IndexedDB.
//
// TWO STORES, ONE SHAPE.
//   · files (Android): Directory.Data, audio/<id>/<book>/<chap>.<ext> and audio/<id>/_unplaced/<n>.<ext>
//   · IndexedDB 'trinityone-audio' / 'chapters': keys <id>/<book>/<chap> and <id>/_unplaced/<n>, value a Blob whose type
//     says mp3/m4a/ogg. World English's existing keys WEB/<book>/<chap> already have this shape (id = WEB).
// book and chap are parsed integers, n is a counter, ext comes from the file's first bytes only — a name from inside a
// zip never becomes part of a path.
//
// THE REGISTRY is localStorage trinityone.audioSets, one JSON array of rows
//   {id, name, lang, reader, licence, source:'own'|'catalog', recording, state:'pending'|'ready', chapters, bytes, unplaced?, migrating?}
// id is 16 random hex characters (never 64: the PIN-lock wipe deletes keys matching a 64-hex pattern), or the fixed 'WEB'.
(function () {
  if (typeof window === 'undefined' || window.TrinityAudioStore) return;

  const REG_KEY = 'trinityone.audioSets';
  const VOICE_KEY = 'trinityone.audioVoice';
  const ROOT = 'audio';
  // iOS uses file storage only after THIS run's BackupExclude.exclude({path:'audio'}) answered excluded:true (see iosGate)
  let iosBackupExcludeReady = false;
  // THE iOS LATCH (round-5 R5-1). Once this phone has stored audio in files (a confirmed exclude, then a file written), it
  // keeps using files on every later launch even if the plugin then rejects, is missing or times out: falling back to
  // IndexedDB would hide every chapter already in files and put new ones where iCloud backs them up. One localStorage key.
  const IOS_LATCH_KEY = 'trinityone.audioFilesIos';
  const iosLatched = () => { try { return localStorage.getItem(IOS_LATCH_KEY) === '1'; } catch (e) { return false; } };
  const isIos = () => { const c = cap(); return !!(c && typeof c.getPlatform === 'function' && c.getPlatform() === 'ios'); };
  const CAP_ENTRY = 64 * 1024 * 1024;              // inflated bytes in one entry
  const CAP_TOTAL = 3 * 1024 * 1024 * 1024;        // inflated bytes in one import
  const CAP_ENTRIES = 5000;
  const CAP_RAW = 4 * 1024 * 1024 * 1024 - 1;      // a zip over 4 GB is refused with words for now (zip64 entries under the caps import)
  // the limits the import checks; one object so a test can lower them and prove each one is enforced
  const LIM = { entry: CAP_ENTRY, total: CAP_TOTAL, entries: CAP_ENTRIES, raw: CAP_RAW, excludeMs: 5000 };
  const WRITE_CHUNK = 1024 * 1024;                 // ~1 MB per bridge call, never a 22 MB base64 string
  const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' };
  const EXT_OF_MIME = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' };
  const USFM = ('GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER ' +
    'LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL ' +
    '1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV').split(' ');
  const CHAPTERS = [50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4,
    28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22];
  const NAMES = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings',
    '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
    'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
    '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John',
    '3 John', 'Jude', 'Revelation'];
  // common short forms seen in audio file names (the engine's own abbreviations and names are added at match time)
  const ALIASES = {
    psalm: 19, ps: 19, pss: 19, songofsongs: 22, song: 22, canticles: 22, revelations: 66, apocalypse: 66,
    exod: 2, deut: 5, josh: 6, judg: 7, '1sam': 9, '2sam': 10, '1kgs': 11, '2kgs': 12, '1kings': 11, '2kings': 12, '1chr': 13, '2chr': 14,
    esth: 17, prov: 20, eccl: 21, eccles: 21, qoheleth: 21, isa: 23, jer: 24, lam: 25, ezek: 26, dan: 27, hos: 28, obad: 31, mic: 33, nah: 34,
    hab: 35, zeph: 36, hag: 37, zech: 38, mal: 39, matt: 40, mt: 40, mk: 41, mar: 41, lk: 42, jn: 43, jhn: 43, joh: 43, rom: 45, '1cor': 46, '2cor': 47,
    gal: 48, eph: 49, phil: 50, col: 51, '1thess': 52, '2thess': 53, '1tim': 54, '2tim': 55, tit: 56, philem: 57, phlm: 57, heb: 58, jas: 59,
    '1pet': 60, '2pet': 61, '1jn': 62, '2jn': 63, '3jn': 64, jud: 65, rev: 66,
  };

  const W = () => window;
  const cap = () => W().Capacitor;
  const FSP = () => { const c = cap(); return c && c.Plugins && c.Plugins.Filesystem; };

  // ─────────────── the one gate ───────────────
  function filesOn() {
    const c = cap();
    const native = !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
    const plat = c && typeof c.getPlatform === 'function' ? c.getPlatform() : '';
    return native && !!FSP() && (plat === 'android' || (plat === 'ios' && (iosBackupExcludeReady || iosLatched())));
  }
  // Android: Directory.Data. iOS: Directory.Library, the same base the BackupExclude plugin resolves 'audio' against
  // (FileManager .libraryDirectory, per PR #24), so the folder the plugin excludes is the folder the files go in.
  const DIR = () => { const c = cap(); return (c && typeof c.getPlatform === 'function' && c.getPlatform() === 'ios') ? 'LIBRARY' : 'DATA'; };

  // THE iOS GATE, run at the start of every boot (the exclusion is re-applied on every start). Only a resolved
  // {excluded:true} turns file storage on for this run; a missing plugin, a rejection or excluded:false leaves iOS on
  // IndexedDB. The plugin object is never returned from an async function (Capacitor's plugin proxy answers `then`).
  // The exclude call is raced against LIM.excludeMs (~5 s, round-5 R5-2): a plugin that never answers counts as "no" for
  // this run, so nothing that waits on the gate (the sweep, the move, every import) can hang. When latched, a failure is
  // logged and files stay on; the attribute is already on the folder from the run that latched it.
  async function iosGate() {
    const c = cap();
    if (!c || typeof c.getPlatform !== 'function' || c.getPlatform() !== 'ios') return false;
    const P = (typeof c.isPluginAvailable === 'function' && c.isPluginAvailable('BackupExclude')) ? (c.Plugins && c.Plugins.BackupExclude) : null;
    let r = null;
    if (P && typeof P.exclude === 'function') {
      let timer = null;
      try {
        r = await Promise.race([
          Promise.resolve(P.exclude({ path: 'audio' })).catch(() => null),
          new Promise(res => { timer = setTimeout(() => res(null), LIM.excludeMs); }),
        ]);
      } catch (e) { r = null; }
      if (timer) clearTimeout(timer);
    }
    iosBackupExcludeReady = !!(r && r.excluded === true);
    if (!iosBackupExcludeReady && iosLatched()) { try { console.warn('TrinityOne audio: BackupExclude did not confirm Library/audio this run; staying on file storage'); } catch (e) {} }
    return iosBackupExcludeReady;
  }
  // round-5 R5-3: a closed, un-latched gate is tried once more when the member starts an import or a World English download
  async function ensureGate() {
    if (!isIos() || iosBackupExcludeReady || iosLatched()) return filesOn();
    await iosGate();
    return filesOn();
  }
  // L2 (audit pr24): before the first FILE write this session, make sure Library/audio carries the
  // backup-exclude attribute, so a write can never land under a root that lost/never-got it. A directory's
  // exclusion covers its whole subtree, later files included, so re-excluding the root is enough, and this
  // code never removes the ROOT (only audio/<id> subfolders). On a NORMAL run iosGate() already created +
  // confirmed the root at boot, so there's nothing to redo — skip (that keeps the one boot-time exclude the
  // only call). The real gap is a LATCHED run whose boot exclude did not confirm (files are on via the
  // latch, iosBackupExcludeReady is false, ensureGate() short-circuits): there we re-apply, covering every
  // iOS write path — import, the World English move (R5-1c), putWebChapter, placeUnplaced — since they all
  // go through fWrite or move. exclude() (re)creates the root AND sets the attribute, so the order is right
  // even if the folder is missing. Timeout-raced exactly like iosGate() so a stuck plugin can never hang a
  // write; at most one attempt per session.
  let iosRootExcluded = false;
  async function ensureIosRootExcluded() {
    if (iosRootExcluded || !isIos() || !filesOn()) return;
    iosRootExcluded = true;
    if (iosBackupExcludeReady) return;   // boot exclude already confirmed the root this run; nothing to redo
    const c = cap();
    const P = (c && typeof c.isPluginAvailable === 'function' && c.isPluginAvailable('BackupExclude')) ? (c.Plugins && c.Plugins.BackupExclude) : null;
    if (!P || typeof P.exclude !== 'function') return;
    let timer = null;
    try {
      await Promise.race([
        Promise.resolve(P.exclude({ path: 'audio' })).catch(() => null),
        new Promise(res => { timer = setTimeout(() => res(null), LIM.excludeMs); }),
      ]);
    } catch (e) {}
    if (timer) clearTimeout(timer);
  }

  // ─────────────── registry ───────────────
  function rows() {
    try { const v = JSON.parse(localStorage.getItem(REG_KEY) || '[]'); return Array.isArray(v) ? v.filter(r => r && typeof r.id === 'string') : []; } catch (e) { return []; }
  }
  function saveRows(list) { try { localStorage.setItem(REG_KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
  function row(id) { return rows().find(r => r.id === id) || null; }
  function writeRow(r) { const list = rows().filter(x => x.id !== r.id); list.push(r); return saveRows(list); }
  function patchRow(id, p) { const r = row(id); if (!r) return false; return writeRow({ ...r, ...p }); }
  function dropRow(id) { return saveRows(rows().filter(x => x.id !== id)); }
  function readySets() { return rows().filter(r => r.state === 'ready'); }
  function newId() {
    const b = new Uint8Array(8);
    try { (W().crypto || crypto).getRandomValues(b); } catch (e) { for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
    let s = ''; for (let i = 0; i < 8; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;   // 16 hex characters
  }
  // which ids are also read from IndexedDB while files are on: World English (it may still be moving), and on iOS every
  // set (round-5 R5-1b: a set imported in a run whose gate was closed sits in IndexedDB until the move takes it)
  const idbToo = (id) => !filesOn() || id === 'WEB' || isIos();
  const validId = (id) => id === 'WEB' || /^[0-9a-f]{16}$/.test(String(id || ''));

  // ─────────────── IndexedDB (the web/Suite/iOS store, and World English's old home on Android) ───────────────
  const ADB_STORE = 'chapters';
  let _db = null;
  function adb() {
    if (_db) return _db;
    _db = new Promise((res, rej) => {
      const idb = W().indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
      if (!idb) { rej(new Error('no IndexedDB')); return; }
      const r = idb.open('trinityone-audio', 1);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(ADB_STORE)) db.createObjectStore(ADB_STORE); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    _db.catch(() => { _db = null; });
    return _db;
  }
  async function idbGet(key) { const db = await adb(); return new Promise(res => { const rq = db.transaction(ADB_STORE).objectStore(ADB_STORE).get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); }
  async function idbPut(key, blob) { const db = await adb(); return new Promise((res, rej) => { const tx = db.transaction(ADB_STORE, 'readwrite'); tx.objectStore(ADB_STORE).put(blob, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error || new Error('write failed')); tx.onabort = () => rej(tx.error || new Error('write failed')); }); }
  async function idbKeys() { try { const db = await adb(); return await new Promise(res => { const rq = db.transaction(ADB_STORE).objectStore(ADB_STORE).getAllKeys(); rq.onsuccess = () => res((rq.result || []).map(String)); rq.onerror = () => res([]); }); } catch (e) { return []; } }
  async function idbDel(keys) { if (!keys.length) return; const db = await adb(); return new Promise(res => { const tx = db.transaction(ADB_STORE, 'readwrite'); keys.forEach(k => tx.objectStore(ADB_STORE).delete(k)); tx.oncomplete = () => res(); tx.onerror = () => res(); }); }

  // ─────────────── files (Android) ───────────────
  function b64(u8) {
    let s = ''; const N = 0x8000;
    for (let i = 0; i < u8.length; i += N) s += String.fromCharCode.apply(null, u8.subarray(i, i + N));
    return (W().btoa || btoa)(s);
  }
  const fpath = (id, sub, ext) => ROOT + '/' + id + '/' + sub + (ext ? '.' + ext : '');
  // A CHAPTER FILE APPEARS WHOLE OR NOT AT ALL (audit #1). The bytes go to <path>.part; only when its size matches is it
  // renamed to the final name, which is the only name listBook/listAll count. A failed write deletes the .part; a killed
  // one leaves it for the boot sweep. A half-written chapter can therefore never count as present, hide an intact
  // IndexedDB copy, or stop a download fetching it again.
  async function fWrite(path, u8) {
    await ensureIosRootExcluded();
    const P = FSP(); const tmp = path + '.part';
    try {
      await P.writeFile({ path: tmp, data: b64(u8.subarray(0, WRITE_CHUNK)), directory: DIR(), recursive: true });
      for (let at = WRITE_CHUNK; at < u8.length; at += WRITE_CHUNK) await P.appendFile({ path: tmp, data: b64(u8.subarray(at, at + WRITE_CHUNK)), directory: DIR() });
      const st = await P.stat({ path: tmp, directory: DIR() });
      if (!st || Number(st.size) !== u8.length) throw new Error('write check failed');
      try { await P.rename({ from: tmp, to: path, directory: DIR(), toDirectory: DIR() }); }
      catch (e) {
        // a platform that will not rename over a file (re-audit N3): set the old copy aside as <path>.old, put the new one
        // in place, and only then delete the old one. The good copy is never deleted before its replacement is there; if
        // the second rename fails the old copy is put back. A kill in between leaves a .old the boot sweep resolves.
        const old = path + '.old';
        await P.rename({ from: path, to: old, directory: DIR(), toDirectory: DIR() });
        try { await P.rename({ from: tmp, to: path, directory: DIR(), toDirectory: DIR() }); }
        catch (e2) { try { await P.rename({ from: old, to: path, directory: DIR(), toDirectory: DIR() }); } catch (e3) {} throw e2; }
        await fDel(old);
      }
    } catch (e) { await fDel(tmp); throw e; }
    if (isIos()) { try { if (!iosLatched()) localStorage.setItem(IOS_LATCH_KEY, '1'); } catch (e) {} }
  }
  async function fList(path) {
    try { const r = await FSP().readdir({ path, directory: DIR() }); return (r && r.files || []).map(f => (typeof f === 'string' ? { name: f, type: 'file', size: 0 } : f)); } catch (e) { return []; }
  }
  async function fRmdir(path) { try { await FSP().rmdir({ path, directory: DIR(), recursive: true }); } catch (e) {} }
  async function fDel(path) { try { await FSP().deleteFile({ path, directory: DIR() }); } catch (e) {} }
  async function fBlob(path, ext) {
    const P = FSP(); const c = cap();
    const { uri } = await P.getUri({ path, directory: DIR() });
    // fetch the whole file, no Range header, into memory: an <audio> pointed at convertFileSrc breaks seeking on
    // Capacitor 6 Android (WebViewLocalServer range bug), so playback is always from a Blob, one chapter at a time.
    const r = await fetch(c.convertFileSrc(uri));
    if (!r || !r.ok) return null;
    const b = await r.blob();
    return (b && b.type === MIME[ext]) ? b : new Blob([b], { type: MIME[ext] || 'audio/mpeg' });
  }

  // ─────────────── chapters: one interface over both stores ───────────────
  // list a set's chapters in one book → [{chap, ext, size, where:'file'|'idb'}]; World English on a phone reads BOTH stores
  async function listBook(id, book) {
    const out = new Map();
    if (!validId(id)) return [];
    const useFiles = filesOn();
    if (useFiles) {
      for (const f of await fList(ROOT + '/' + id + '/' + book)) {
        const m = /^(\d+)\.(mp3|m4a|ogg)$/.exec(f.name || ''); if (m) out.set(+m[1], { chap: +m[1], ext: m[2], size: Number(f.size) || 0, where: 'file' });
      }
    }
    if (idbToo(id)) {
      const pre = id + '/' + book + '/';
      for (const k of await idbKeys()) {
        if (k.indexOf(pre) !== 0) continue;
        const c = +k.slice(pre.length); if (!(c > 0) || out.has(c)) continue;
        out.set(c, { chap: c, ext: null, size: 0, where: 'idb' });
      }
    }
    return [...out.values()].sort((a, b) => a.chap - b.chap);
  }
  // every chapter of a set → Map(book → Set(chap))
  async function listAll(id) {
    const out = new Map();
    const add = (b, c) => { if (!(b >= 1 && b <= 66 && c >= 1)) return; if (!out.has(b)) out.set(b, new Set()); out.get(b).add(c); };
    const useFiles = filesOn();
    if (useFiles) {
      for (const d of await fList(ROOT + '/' + id)) {
        if (!/^\d+$/.test(d.name || '')) continue;
        for (const f of await fList(ROOT + '/' + id + '/' + d.name)) { const m = /^(\d+)\.(mp3|m4a|ogg)$/.exec(f.name || ''); if (m) add(+d.name, +m[1]); }
      }
    }
    if (idbToo(id)) {
      for (const k of await idbKeys()) { const m = /^([^/]+)\/(\d+)\/(\d+)$/.exec(k); if (m && m[1] === id) add(+m[2], +m[3]); }
    }
    return out;
  }
  async function hasChapter(id, book, chap) { return (await listBook(id, book)).some(x => x.chap === chap); }
  async function chapterBlob(id, book, chap) {
    const hit = (await listBook(id, book)).find(x => x.chap === chap);
    if (!hit) return null;
    if (hit.where === 'file') return fBlob(fpath(id, book + '/' + chap, hit.ext), hit.ext);
    return idbGet(id + '/' + book + '/' + chap);
  }
  async function chapterUrl(id, book, chap) { const b = await chapterBlob(id, book, chap); return b ? URL.createObjectURL(b) : null; }
  // store one entry (sub = '<book>/<chap>' or '_unplaced/<n>')
  async function put(id, sub, ext, u8) {
    if (!validId(id) || !MIME[ext] || !/^(\d+\/\d+|_unplaced\/\d+)$/.test(sub)) throw new Error('bad path');
    if (filesOn()) { await fWrite(fpath(id, sub, ext), u8); return; }
    await idbPut(id + '/' + sub, new Blob([u8], { type: MIME[ext] }));
  }
  async function delEntry(id, sub, ext) {
    if (filesOn()) { if (ext) await fDel(fpath(id, sub, ext)); else for (const e of Object.keys(MIME)) await fDel(fpath(id, sub, e)); }
    if (idbToo(id)) await idbDel([id + '/' + sub]);
  }
  async function move(id, fromSub, ext, toSub) {
    if (filesOn()) {
      await ensureIosRootExcluded();
      const P = FSP();
      const to = fpath(id, toSub, ext);
      try { await P.mkdir({ path: to.slice(0, to.lastIndexOf('/')), directory: DIR(), recursive: true }); } catch (e) {}
      await P.rename({ from: fpath(id, fromSub, ext), to, directory: DIR(), toDirectory: DIR() });
      return;
    }
    const b = await idbGet(id + '/' + fromSub); if (!b) throw new Error('missing');
    await idbPut(id + '/' + toSub, b); await idbDel([id + '/' + fromSub]);
  }
  // delete every byte of a set in the store(s) it can be in; returns the bytes it held where that is known
  async function wipe(id) {
    if (filesOn()) await fRmdir(ROOT + '/' + id);
    if (idbToo(id)) { const pre = id + '/'; await idbDel((await idbKeys()).filter(k => k.indexOf(pre) === 0)); }
  }
  async function setBytes(id) {
    let n = 0;
    if (filesOn()) {
      for (const d of await fList(ROOT + '/' + id)) { if (!/^\d+$/.test(d.name || '')) continue; for (const f of await fList(ROOT + '/' + id + '/' + d.name)) n += Number(f.size) || 0; }
      if (!idbToo(id)) return n;
    }
    const pre = id + '/';
    for (const k of await idbKeys()) { if (k.indexOf(pre) !== 0 || /\/_unplaced\//.test(k)) continue; const b = await idbGet(k); n += (b && b.size) || 0; }
    return n;
  }

  // ─────────────── small mutex: migration, downloads and the sweep never interleave a chapter ───────────────
  let _chain = Promise.resolve();
  function serial(fn) { const p = _chain.then(fn, fn); _chain = p.catch(() => {}); return p; }

  // ─────────────── magic bytes → ext (nothing else decides what a file is) ───────────────
  // A REAL MPEG layer II/III frame header, not just 0xFF (audit #5): sync (11 bits), version not "reserved", layer II or III
  // (FF FE, the UTF-16 byte-order mark, and FF FF are layer I and are refused), bitrate index not 15, sample rate not 3.
  function mpegFrame(u8) {
    if (!u8 || u8.length < 3 || u8[0] !== 0xFF || (u8[1] & 0xE0) !== 0xE0) return false;
    const ver = (u8[1] >> 3) & 3, layer = (u8[1] >> 1) & 3, br = u8[2] >> 4, sr = (u8[2] >> 2) & 3;
    return ver !== 1 && (layer === 1 || layer === 2) && br !== 15 && sr !== 3;
  }
  function sniff(u8) {
    if (!u8 || u8.length < 4) return null;
    if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) return 'mp3';                       // 'ID3'
    if (mpegFrame(u8)) return 'mp3';
    if (u8.length >= 8 && u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) return 'm4a';   // ....ftyp
    if (u8[0] === 0x4F && u8[1] === 0x67 && u8[2] === 0x67 && u8[3] === 0x53) return 'ogg';     // 'OggS'
    return null;
  }
  const isZipHead = (u8) => !!(u8 && u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04);

  // ─────────────── name matching: book code or name FIRST, then chapter; a leading number is only a cross-check ───────────────
  let _bookMap = null, _romanKeys = new Set();
  const ROMAN_TOKEN = /^(i|ii|iii|first|second|third)$/i;
  // a book from a list of tokens: a leading separate I/II/III/First… may only make a full-name Roman form (round-4 N6)
  function bookOf(tokens) {
    const map = bookMap(); const k = squash(tokens.join(''));
    if (tokens.length > 1 && ROMAN_TOKEN.test(tokens[0])) return _romanKeys.has(k) ? map[k] : 0;
    return map[k] || 0;
  }
  const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function bookMap() {
    if (_bookMap) return _bookMap;
    const m = {};
    NAMES.forEach((n, i) => { m[squash(n)] = i + 1; });
    USFM.forEach((c, i) => { m[squash(c)] = i + 1; });
    Object.keys(ALIASES).forEach(k => { m[k] = ALIASES[k]; });
    try {   // the names and abbreviations the Bible engine knows (only the 66 books of the audio canon)
      const B = W().Bible || {};
      (B.BOOK_NAMES || []).slice(0, 66).forEach((n, i) => { const k = squash(n); if (k && !m[k]) m[k] = i + 1; });
      if (typeof B.bookAbbr === 'function') for (let i = 1; i <= 66; i++) { const k = squash(B.bookAbbr(i)); if (k && !(k in m)) m[k] = i; }
    } catch (e) {}
    // numbered books in the other spellings people use: "I John", "II Kings", "First Samuel" (round-3 N5). Without these,
    // "I John 3" fell through to "John" 3.
    // Only FULL book names get these forms (round-4 N6): on a 2-3 letter abbreviation they made false books ("Ich",
    // "Iki", "Ico"). _romanKeys lists them, so a window that starts with a separate I/II/III/First… token may match ONLY
    // one of them ("I Sa" would otherwise be read as "Isa", Isaiah).
    const ROMAN = { 1: ['i', 'first'], 2: ['ii', 'second'], 3: ['iii', 'third'] };
    const rk = new Set();
    NAMES.forEach((n, i) => { const d = /^([123]) (.+)$/.exec(n); if (d) ROMAN[d[1]].forEach(r => { const k = r + squash(d[2]); rk.add(k); if (!(k in m)) m[k] = i + 1; }); });
    _romanKeys = rk;
    _bookMap = m;
    return m;
  }
  const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  function words(tokens, i) {   // number words from tokens[i] → { n, used } or null
    let n = 0, cur = 0, used = 0;
    for (let j = i; j < tokens.length; j++) {
      const t = tokens[j].toLowerCase();
      if (t in ONES) cur += ONES[t]; else if (t in TENS) cur += TENS[t]; else if (t === 'hundred') cur = (cur || 1) * 100; else if (t === 'and' && used) { used++; continue; } else break;
      used++;
    }
    n += cur;
    return used ? { n, used } : null;
  }
  function tokenize(name) {
    let base = String(name || '').split(/[\\/]/).pop();
    base = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
    const out = [];
    for (const part of base.split(/[^A-Za-z0-9]+/)) {
      if (!part) continue;
      // split letter/digit runs ("Lam5", "1John") and camelCase ("TwentyThree")
      for (const t of part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2').split(' ')) if (t) out.push(t);
    }
    return out;
  }
  // Faith Comes By Hearing / Bible.is download names: <A|B><book in testament, 2 digits>_+<chapter>_<Name>_+<fileset id>,
  // e.g. "B01___01_Matthew_____ENGKJVN1DA" (Matthew 1; the shape is confirmed from an SIL Scripture App Builder thread
  // using FCBH files). A = Old Testament (A01 Genesis … A39 Malachi), B = New (B01 Matthew … B27 Revelation).
  function matchFcbh(base) {
    const m = /^([AB])(\d{2})_+(\d{1,3})_+([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*?)_*([A-Z0-9]{6,}(?:-opus\d+)?)?$/.exec(base);
    if (!m) return null;
    const idx = parseInt(m[2], 10), chap = parseInt(m[3], 10);
    const book = m[1] === 'A' ? (idx >= 1 && idx <= 39 ? idx : 0) : (idx >= 1 && idx <= 27 ? 39 + idx : 0);
    if (!book || !(chap >= 1 && chap <= CHAPTERS[book - 1])) return null;
    // the name part must be THAT book (re-audit N2): "A05_2_track" is not Deuteronomy 2. A name cut short to fit the
    // fixed width is accepted as a prefix of the book's own name (3+ letters).
    const nm = squash(m[4]);
    const full = squash(NAMES[book - 1]);
    if (!(bookMap()[nm] === book || (nm.length >= 3 && full.indexOf(nm) === 0))) return null;
    return { book, chap, lead: null };
  }
  // → { book, chap, lead } or null. lead = the number just before the book token, if any (a cross-check, never decisive).
  // When the file's own name has no book ("Genesis/01.mp3", "01 Genesis/001.mp3"), the folder it is in names the book
  // and the file name's first number is the chapter.
  function matchName(name) {
    const parts = String(name || '').split(/[\\/]/).filter(Boolean);
    const base = (parts[parts.length - 1] || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
    const f = matchFcbh(base); if (f) return f;
    const own = matchTokens(tokenize(base));
    if (own !== undefined) return own;
    // ONLY the folder directly above the file, and only when its WHOLE name (after a leading number) is a book
    // (re-audit N1): "01 Genesis/001.mp3" yes; "Read by John Doe/01.mp3" or ".../Disc 1/Track 07.mp3" no — those go to
    // the check screen rather than being filed under John or Mark because of a reader's name.
    if (parts.length >= 2) {
      // the WHOLE folder name first ("1 John", "1John", "I John", "1 Kings" are books in their own right — round-3 N5);
      // only if that is not a book, drop a SEPARATED leading track number ("01 ", "01_", "01-") and try once more
      const folderFull = parts[parts.length - 2];
      const book = bookOf(tokenize(folderFull)) || bookOf(tokenize(folderFull.replace(/^\d+[\s._-]+/, '')));
      if (book) {
        const tb = tokenize(base);
        const num = tb.find(t => /^\d+$/.test(t));
        const w = num ? null : words(tb, 0);
        const chap = num ? parseInt(num, 10) : (w ? w.n : (CHAPTERS[book - 1] === 1 ? 1 : null));
        if (!(chap >= 1 && chap <= CHAPTERS[book - 1])) return null;
        return { book, chap, lead: null };
      }
    }
    return null;
  }
  // undefined = no book in these tokens at all; null = a book but no usable chapter. bookOnly: just the book.
  function matchTokens(tk, bookOnly) {
    const map = bookMap();
    for (let i = 0; i < tk.length; i++) {
      for (let len = Math.min(3, tk.length - i); len >= 1; len--) {
        const win = tk.slice(i, i + len);
        if (!win.some(t => /[A-Za-z]/.test(t)) || /^\d+$/.test(win[win.length - 1])) continue;
        if (/^\d/.test(win[0]) && !/^[123]$/.test(win[0])) continue;   // "1 John" yes, "01 John" / "40 Matthew" no
        const book = bookOf(win);
        if (!book) continue;
        if (bookOnly) return { book };
        const lead = (i > 0 && /^\d+$/.test(tk[i - 1])) ? parseInt(tk[i - 1], 10) : null;
        let j = i + len, chap = null;
        while (j < tk.length && /^(chapter|chap|ch|c|part|pt)$/i.test(tk[j])) j++;
        if (j < tk.length && /^\d+$/.test(tk[j])) chap = parseInt(tk[j], 10);
        else if (j < tk.length) { const w = words(tk, j); if (w) chap = w.n; }
        if (chap == null && CHAPTERS[book - 1] === 1) chap = 1;
        if (!(chap >= 1 && chap <= CHAPTERS[book - 1])) return null;
        return { book, chap, lead };
      }
    }
    return bookOnly ? null : undefined;
  }
  // keep a name only as short plain text (it is shown as a React text child, never as markup)
  const cleanName = (s) => String(s || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);

  // ─────────────── import: one streaming pass into a pending set (plan N4) ───────────────
  function capErr(reason) { const e = new Error(reason); e.reason = reason; return e; }
  const concat = (parts, n) => { if (parts.length === 1) return parts[0]; const out = new Uint8Array(n); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
  const JUNK = (name) => /\/$/.test(name) || /(^|\/)__MACOSX\//.test(name);

  // the reader of a source: head chunks first, then the live reader. A reader is { read(): {done, value} }.
  function chunkSource(head, reader) {
    const h = (head || []).slice();
    return async () => {
      if (h.length) return h.shift();
      if (!reader) return null;
      const { done, value } = await reader.read();
      return done ? null : (value instanceof Uint8Array ? value : new Uint8Array(value));
    };
  }

  // stream one zip into the set. onEntry(name, u8) is awaited after each pushed chunk, so at most one chunk's worth of
  // finished entries is held before it is written. Caps are checked as bytes inflate.
  async function unzipInto(next, st, onEntry, getAborted) {
    const F = W().fflate;
    if (!F || typeof F.Unzip !== 'function') throw capErr('unreadable');
    const done = [];
    const unz = new F.Unzip((file) => {
      st.entries++;
      if (st.entries > LIM.entries) throw capErr('too-many');
      if (file.compression === 0 && file.size === undefined && !JUNK(file.name)) throw capErr('stored-descriptor');
      if (file.originalSize > LIM.entry) throw capErr('entry-too-big');
      const name = file.name; const junk = JUNK(name);
      let parts = [], n = 0, keep = !junk, decided = junk;
      file.ondata = (err, dat, final) => {
        if (err) { if (!st.broken) st.broken = err; return; }   // fflate hands a throw from here back as `err`: keep the first
        if (dat && dat.length) {
          n += dat.length; st.inflated += dat.length;
          if (n > LIM.entry) throw capErr('entry-too-big');
          if (st.inflated > LIM.total) throw capErr('too-big');
          if (keep) parts.push(dat);
          if (!decided && n >= 12) { decided = true; if (!sniff(concat(parts, n))) { keep = false; parts = []; } }
        }
        if (final) { if (keep && n) done.push({ name, u8: concat(parts, n) }); else if (!junk) st.skipped++; parts = []; }
      };
      file.start();
    });
    unz.register(F.UnzipInflate);
    for (;;) {
      if (getAborted && getAborted()) throw capErr('cancelled');
      const chunk = await next();
      if (chunk) { st.raw += chunk.length; if (st.raw > LIM.raw) throw capErr('over-4gb'); }
      // pushed in 16 KB slices: fflate's Unzip recurses once per entry inside one push, so a big chunk of tiny entries
      // would overflow the stack before the entry cap could answer
      try {
        if (!chunk) unz.push(new Uint8Array(0), true);
        else for (let at = 0; at < chunk.length; at += 16384) { unz.push(chunk.subarray(at, at + 16384), false); if (st.broken) break; }
      } catch (e) { throw e && e.reason ? e : capErr('broken'); }
      if (st.broken) throw (st.broken.reason ? st.broken : capErr('broken'));
      while (done.length) { const e = done.shift(); await onEntry(e.name, e.u8); }
      if (!chunk) break;
    }
  }

  // Begin an import: writes the PENDING row first (a crash after this leaves something the boot sweep removes).
  async function beginImport() {
    await booted();
    await ensureGate();
    const id = newId();
    if (!writeRow({ id, name: '', lang: '', reader: '', licence: '', source: 'own', recording: 'own-' + id, state: 'pending', chapters: 0, bytes: 0, unplaced: [] }))
      throw capErr('no-registry');
    return id;
  }

  // sources: [{ name, head: Uint8Array[], reader }] — a picked File (its stream's reader) or the open-with hand-over.
  // → { ok:true, id, chapters, books, unplaced:[{n,name}], skipped } | { ok:false, reason }
  async function importSources(id, sources, hooks) {
    hooks = hooks || {};
    const st = { entries: 0, inflated: 0, raw: 0, skipped: 0, written: 0, broken: null };
    const placed = new Map(); const unplaced = []; let un = 0;
    const progress = () => { try { hooks.onProgress && hooks.onProgress({ chapters: placed.size, unplaced: unplaced.length, entries: st.entries, bytes: st.raw }); } catch (e) {} };
    const onEntry = async (name, u8) => {
      const ext = sniff(u8);
      if (!ext) { st.skipped++; return; }
      const m = matchName(name);
      const key = m ? m.book + '/' + m.chap : null;
      if (m && !placed.has(key)) { await put(id, key, ext, u8); placed.set(key, { book: m.book, chap: m.chap, ext, lead: m.lead, name: cleanName(name) }); }
      else { const n = ++un; await put(id, '_unplaced/' + n, ext, u8); unplaced.push({ n, name: cleanName(name), ext }); }
      st.written += u8.length;
      progress();
    };
    try {
      for (const src of sources) {
        const next = chunkSource(src.head, src.reader);
        let first = await next();
        if (!first) continue;
        while (first.length < 4) {   // the zip test needs 4 bytes, and a stream may hand them over one at a time
          const more = await next(); if (!more) break;
          const j = new Uint8Array(first.length + more.length); j.set(first); j.set(more, first.length); first = j;
        }
        if (isZipHead(first)) {
          const again = [first]; const rest = next;
          await unzipInto(async () => (again.length ? again.shift() : rest()), st, onEntry, hooks.getAborted);
        } else {
          // one loose audio file: read through its stream with the same per-entry cap
          const parts = [first]; let n = first.length;
          for (;;) {
            if (hooks.getAborted && hooks.getAborted()) throw capErr('cancelled');
            const c = await next(); if (!c) break;
            n += c.length; if (n > LIM.entry) throw capErr('entry-too-big');
            st.inflated += c.length; if (st.inflated > LIM.total) throw capErr('too-big');
            parts.push(c);
          }
          st.entries++; if (st.entries > LIM.entries) throw capErr('too-many');
          await onEntry(src.name || '', concat(parts, n));
        }
      }
      // a leading number that DISAGREES with the name goes to the check screen. First, a number that changes from file to
      // file WITHIN ONE BOOK is a running track number ("001 Genesis 1", "002 Genesis 2" …), not a book number, and is
      // ignored (audit #3): a book's lead counts only if one value covers more than half its files. If most books in a
      // testament have track numbers, every lead there is ignored. What is left is the old check: a file whose offset
      // from its book number is not the offset most files in that testament use (eBible numbers MRK 71, others 41: both
      // are consistent within their own set, so neither is misfiled).
      const outliers = [];
      for (const half of [[1, 39], [40, 66]]) {
        const byBook = new Map();
        for (const p of placed.values()) if (p.book >= half[0] && p.book <= half[1] && p.lead != null) { if (!byBook.has(p.book)) byBook.set(p.book, []); byBook.get(p.book).push(p); }
        let trackBooks = 0; const kept = [];
        byBook.forEach((list) => {
          const c = new Map(); list.forEach(p => c.set(p.lead, (c.get(p.lead) || 0) + 1));
          let mode = null, modeN = 0; c.forEach((k, v) => { if (k > modeN) { mode = v; modeN = k; } });
          if (modeN * 2 <= list.length) { trackBooks++; return; }
          list.forEach(p => { if (p.lead === mode) kept.push(p); else outliers.push(p); });
        });
        if (byBook.size && trackBooks * 2 >= byBook.size) { outliers.splice(0, outliers.length, ...outliers.filter(p => !(p.book >= half[0] && p.book <= half[1]))); continue; }
        if (kept.length < 2) continue;
        const count = new Map(); kept.forEach(p => count.set(p.lead - p.book, (count.get(p.lead - p.book) || 0) + 1));
        let best = null, bestN = -1; count.forEach((c, off) => { if (c > bestN || (c === bestN && off === 0)) { best = off; bestN = c; } });
        for (const p of kept) if (p.lead - p.book !== best) outliers.push(p);
      }
      for (const p of outliers) {
        const n = ++un; await move(id, p.book + '/' + p.chap, p.ext, '_unplaced/' + n);
        placed.delete(p.book + '/' + p.chap); unplaced.push({ n, name: p.name, ext: p.ext });
      }
      if (!patchRow(id, { unplaced: unplaced.map(u => ({ n: u.n, name: u.name, ext: u.ext })), chapters: placed.size })) throw capErr('no-registry');
      progress();
      return { ok: true, id, chapters: placed.size, books: new Set([...placed.values()].map(p => p.book)).size, unplaced: unplaced.map(u => ({ n: u.n, name: u.name })), skipped: st.skipped };
    } catch (e) {
      await cancelImport(id);
      const msg = String((e && (e.reason || e.message)) || '');
      const reason = e && e.reason ? e.reason : (/space|ENOSPC|quota|full/i.test(msg) ? 'no-space' : 'failed');
      return { ok: false, reason };
    }
  }
  // the check screen: put an unplaced file at a chapter. If that chapter is taken, answers {exists:true} unless replace.
  async function placeUnplaced(id, n, book, chap, opts) {
    const r = row(id); if (!r) return { ok: false };
    const u = (r.unplaced || []).find(x => x.n === n); if (!u) return { ok: false };
    book = parseInt(book, 10); chap = parseInt(chap, 10);
    if (!(book >= 1 && book <= 66 && chap >= 1 && chap <= CHAPTERS[book - 1])) return { ok: false, reason: 'bad-chapter' };
    const there = (await listBook(id, book)).find(x => x.chap === chap);
    if (there && !(opts && opts.replace)) return { ok: false, exists: true };
    if (there) await delEntry(id, book + '/' + chap, there.ext);
    await move(id, '_unplaced/' + n, u.ext, book + '/' + chap);
    patchRow(id, { unplaced: (r.unplaced || []).filter(x => x.n !== n) });
    return { ok: true };
  }
  async function leaveOut(id, n) {
    const r = row(id); if (!r) return;
    const u = (r.unplaced || []).find(x => x.n === n);
    if (u) await delEntry(id, '_unplaced/' + n, u.ext);
    patchRow(id, { unplaced: (r.unplaced || []).filter(x => x.n !== n) });
  }
  async function cancelImport(id) {
    if (!validId(id) || id === 'WEB') return;
    await wipe(id); dropRow(id);
  }
  // the name screen's Save: the row flips to READY, then _unplaced/ is deleted (the sweep clears it after a crash between the two)
  async function finishImport(id, meta) {
    meta = meta || {};
    const r = row(id); if (!r || r.state !== 'pending') return { ok: false };
    const all = await listAll(id); let chapters = 0; all.forEach(s => { chapters += s.size; });
    if (!chapters) return { ok: false, reason: 'empty' };
    const bytes = await setBytes(id);
    const t = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
    const ok = writeRow({ id, name: t(meta.name, 80) || 'My audio Bible', lang: t(meta.lang, 40) || 'English', reader: t(meta.reader, 80),
      licence: meta.licence === 'free' ? 'free' : 'own', source: 'own', recording: 'own-' + id, state: 'ready', chapters, bytes });
    if (!ok) return { ok: false, reason: 'no-registry' };
    await clearUnplaced(id);
    return { ok: true, chapters, bytes };
  }
  async function clearUnplaced(id) {
    if (filesOn()) await fRmdir(ROOT + '/' + id + '/_unplaced');
    if (idbToo(id)) { const pre = id + '/_unplaced/'; await idbDel((await idbKeys()).filter(k => k.indexOf(pre) === 0)); }
  }

  // Remove (B2): mark the row pending → delete the files → delete the row. A crash in the middle leaves a pending row the
  // sweep finishes, never a READY row with missing files. If it was the voice in use, the choice falls back to Berean Standard.
  async function removeSet(id) {
    const r = row(id); if (!r || id === 'WEB' || !validId(id)) return { ok: false };
    const bytes = r.bytes || 0;
    patchRow(id, { state: 'pending' });
    await wipe(id);
    dropRow(id);
    try { const v = JSON.parse(localStorage.getItem(VOICE_KEY) || 'null'); if (String(v || '').split('/')[0] === id) localStorage.setItem(VOICE_KEY, JSON.stringify('BSB/david')); } catch (e) {}
    return { ok: true, bytes };
  }

  // ─────────────── the boot sweep (N1, P3, B3) ───────────────
  // Runs everywhere. Files on: deletes audio/<id> whose id is pending or absent from the registry, never audio/WEB, and
  // _unplaced/ under ready sets. Files off: the same for IndexedDB keys <id>/…, never WEB/…. Then drops pending rows.
  async function sweep() {
    return serial(async () => {
      const list = rows(); const by = new Map(list.map(r => [r.id, r]));
      const doomed = (id) => id !== 'WEB' && (!by.has(id) || by.get(id).state !== 'ready');
      if (filesOn()) {
        for (const d of await fList(ROOT)) {
          const id = d.name; if (!id) continue;
          if (id !== 'WEB' && doomed(id)) { await fRmdir(ROOT + '/' + id); continue; }
          if (id !== 'WEB') await fRmdir(ROOT + '/' + id + '/_unplaced');
          // a write killed part-way leaves <chap>.<ext>.part: delete those (and only those), World English included
          for (const sub of await fList(ROOT + '/' + id)) {
            const files = await fList(ROOT + '/' + id + '/' + sub.name); const names = new Set(files.map(f => f.name));
            for (const f of files) {
              const at = ROOT + '/' + id + '/' + sub.name + '/' + f.name;
              if (/\.part$/.test(f.name || '')) await fDel(at);
              // <chap>.<ext>.old: the old copy set aside by a rename fallback. Its replacement in place → delete it;
              // no replacement → it is the only copy, so put it back.
              else if (/\.old$/.test(f.name || '')) { const fin = f.name.slice(0, -4); if (names.has(fin)) await fDel(at); else { try { await FSP().rename({ from: at, to: at.slice(0, -4), directory: DIR(), toDirectory: DIR() }); } catch (e) {} } }
            }
          }
        }
      }
      if (!filesOn() || isIos()) {   // on iOS IndexedDB can hold sets from a run whose gate was closed: sweep it too
        const del = [];
        for (const k of await idbKeys()) {
          const [id, sub] = k.split('/');
          if (id === 'WEB') continue;
          if (doomed(id) || sub === '_unplaced') del.push(k);
        }
        try { await idbDel(del); } catch (e) {}
      }
      saveRows(rows().filter(r => r.id === 'WEB' || r.state === 'ready'));
    });
  }

  // ─────────────── World English moves into file storage (Android only) ───────────────
  // Before the first chapter moves, the WEB row {state:'ready', migrating:true} is written (B5: if that write fails,
  // nothing moves). Per chapter: write the file, stat it, THEN delete the IndexedDB key — a kill between the two leaves
  // the chapter in both stores, and the next run writes it again and deletes the key. Serialised with downloads.
  const WEB_ROW = { id: 'WEB', name: 'World English', lang: 'English', reader: 'David Williams', licence: 'public-domain', source: 'catalog', recording: 'web-williams', state: 'ready' };
  // Round-5 R5-1c: the move also takes a READY own set's chapters out of IndexedDB (on iOS, a set imported in a run whose
  // gate was closed), with the same per-chapter write → check → delete-the-old-copy order and the same resumability.
  async function migrateWeb() {
    if (!filesOn()) return { ran: false };
    const ready = new Set(readySets().map(r => r.id));
    const movable = () => idbKeys().then(ks => ks.filter(k => { const m = /^(WEB|[0-9a-f]{16})\/\d+\/\d+$/.exec(k); return m && (m[1] === 'WEB' || ready.has(m[1])); }));
    const keys = await movable();
    const hasWeb = keys.some(k => k.indexOf('WEB/') === 0);
    const r = row('WEB');
    if (!hasWeb && r && r.migrating) patchRow('WEB', { migrating: false });
    if (!keys.length) return { ran: true, moved: 0 };
    if (hasWeb && !(r && r.migrating) && !writeRow({ ...WEB_ROW, ...(r || {}), state: 'ready', migrating: true })) return { ran: false, reason: 'no-registry' };
    let moved = 0;
    for (const k of keys) {
      const ok = await serial(async () => {
        const blob = await idbGet(k); if (!blob) return true;
        const [id, b, c] = k.split('/');
        const u8 = new Uint8Array(await blob.arrayBuffer());
        const ext = sniff(u8) || 'mp3';
        try { await fWrite(fpath(id, b + '/' + c, ext), u8); } catch (e) { return false; }
        await idbDel([k]);
        return true;
      });
      if (!ok) return { ran: true, moved, stopped: true };
      moved++;
    }
    if (hasWeb && !(await movable()).some(k => k.indexOf('WEB/') === 0)) patchRow('WEB', { migrating: false });
    return { ran: true, moved };
  }

  // a World English chapter from the existing /audiozip download: to files on Android, IndexedDB elsewhere (M4)
  async function putWebChapter(book, chap, u8) {
    return serial(async () => {
      if (filesOn() && !row('WEB')) writeRow({ ...WEB_ROW });
      await put('WEB', book + '/' + chap, sniff(u8) || 'mp3', u8);
    });
  }
  async function removeWebBook(book) {
    return serial(async () => {
      if (filesOn()) await fRmdir(ROOT + '/WEB/' + book);
      const pre = 'WEB/' + book + '/'; await idbDel((await idbKeys()).filter(k => k.indexOf(pre) === 0));
    });
  }

  let _boot = null, _swept = null;
  function boot() {
    if (!_boot) {
      _swept = (async () => { try { await iosGate(); } catch (e) {} try { await sweep(); } catch (e) {} })();
      _boot = _swept.then(async () => { try { await migrateWeb(); } catch (e) {} });
    }
    return _boot;
  }
  // an import waits for the SWEEP ONLY (audit #2), so the sweep can never see an import's fresh pending row as a
  // leftover — but "Add your own" is not held up by World English moving, which can be over a gigabyte
  function booted() { return _swept || Promise.resolve(); }

  window.TrinityAudioStore = {
    filesOn, rows, row, readySets, newId,
    listBook, listAll, hasChapter, chapterBlob, chapterUrl,
    sniff, matchName, isZipHead, chunkSource,
    beginImport, importSources, placeUnplaced, leaveOut, cancelImport, finishImport, removeSet,
    sweep, migrateWeb, putWebChapter, removeWebBook, boot, ensureGate,
    CHAPTERS: CHAPTERS.slice(), USFM: USFM.slice(),
    caps: LIM,
  };
})();
