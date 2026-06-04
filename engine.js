// engine.js — TrinityOne data layer (plain JS, no JSX).
// Loads MySword (.bbl.mybible SQLite) and open.bible (USFM-in-zip) modules
// entirely in-browser, parses Scripture markup, and exposes window.Bible.
"use strict";
(function () {
  const SQLJS_BASE = "vendor/sqljs/";   // vendored locally (offline); was cdnjs

  // ── 66-book Protestant canon ──
  const BOOK_NAMES = [
    "Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
    "1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah",
    "Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon","Isaiah","Jeremiah",
    "Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah",
    "Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi","Matthew",
    "Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians","Galatians",
    "Ephesians","Philippians","Colossians","1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus",
    "Philemon","Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John",
    "Jude","Revelation"
  ];
  const BOOK_ABBR = [
    "Gen","Exo","Lev","Num","Deu","Jos","Jdg","Rut","1Sa","2Sa","1Ki","2Ki","1Ch","2Ch","Ezr","Neh",
    "Est","Job","Psa","Pro","Ecc","Sng","Isa","Jer","Lam","Ezk","Dan","Hos","Jol","Amo","Oba","Jon",
    "Mic","Nam","Hab","Zep","Hag","Zec","Mal","Mat","Mrk","Luk","Joh","Act","Rom","1Co","2Co","Gal",
    "Eph","Php","Col","1Th","2Th","1Ti","2Ti","Tit","Phm","Heb","Jas","1Pe","2Pe","1Jn","2Jn","3Jn","Jud","Rev"
  ];
  const bookName = n => BOOK_NAMES[n - 1] || ("Book " + n);
  const bookAbbr = n => BOOK_ABBR[n - 1] || ("B" + n);
  const bookGroup = n => (n <= 39 ? "ot" : "nt");

  const USFM_BOOK = {
    GEN:1,EXO:2,LEV:3,NUM:4,DEU:5,JOS:6,JDG:7,RUT:8,
    "1SA":9,"2SA":10,"1KI":11,"2KI":12,"1CH":13,"2CH":14,EZR:15,NEH:16,
    EST:17,JOB:18,PSA:19,PRO:20,ECC:21,SNG:22,ISA:23,JER:24,
    LAM:25,EZK:26,DAN:27,HOS:28,JOL:29,AMO:30,OBA:31,JON:32,
    MIC:33,NAM:34,HAB:35,ZEP:36,HAG:37,ZEC:38,MAL:39,MAT:40,
    MRK:41,LUK:42,JHN:43,ACT:44,ROM:45,"1CO":46,"2CO":47,GAL:48,
    EPH:49,PHP:50,COL:51,"1TH":52,"2TH":53,"1TI":54,"2TI":55,TIT:56,
    PHM:57,HEB:58,JAS:59,"1PE":60,"2PE":61,"1JN":62,"2JN":63,"3JN":64,
    JUD:65,REV:66
  };

  // ── built-in Strong's lexicon (merged: design glosses + common terms) ──
  const LEX = {
    G3056:{lemma:"λόγος",translit:"logos",pos:"noun, masculine",short:"word; the expression of thought",gloss:"A word, the living spoken expression of an inward thought; reason, the divine utterance by which God reveals himself.",occ:330},
    G2316:{lemma:"θεός",translit:"theos",pos:"noun, masculine",short:"God; the supreme Divinity",gloss:"God; the one true God, supreme over all creation, the source and ground of all being.",occ:1317},
    G2222:{lemma:"ζωή",translit:"zōē",pos:"noun, feminine",short:"life; vitality, the breath of being",gloss:"Life — both the physical breath of living and the higher, unending life that belongs to God and is given to those who are his.",occ:135},
    G5457:{lemma:"φῶς",translit:"phōs",pos:"noun, neuter",short:"light; that which illuminates",gloss:"Light; the source of illumination, used of moral and spiritual radiance that exposes, guides, and gives life.",occ:70},
    G4561:{lemma:"σάρξ",translit:"sarx",pos:"noun, feminine",short:"flesh; human nature in its frailty",gloss:"Flesh — the soft substance of the body; by extension, human nature in its weakness and mortality.",occ:147},
    G5485:{lemma:"χάρις",translit:"charis",pos:"noun, feminine",short:"grace; unmerited favour",gloss:"Grace; gracious goodwill and loving-kindness, especially the freely-given, unearned favour of God toward people.",occ:156},
    G225:{lemma:"ἀλήθεια",translit:"alētheia",pos:"noun, feminine",short:"truth; what is real and reliable",gloss:"Truth; that which is real, faithful, and trustworthy, as opposed to falsehood or mere appearance.",occ:110},
    G1391:{lemma:"δόξα",translit:"doxa",pos:"noun, feminine",short:"glory; weight, splendour, honour",gloss:"Glory; brightness and splendour, the visible weight of honour, dignity, and majesty.",occ:166},
    G25:{lemma:"ἀγαπάω",translit:"agapaō",pos:"verb",short:"to love; to hold dear",gloss:"To love in a social or moral sense; to welcome, esteem, and hold dear.",occ:143},
    H430:{lemma:"אֱלֹהִים",translit:"ʾĕlōhîm",pos:"noun, masculine plural",short:"God, gods",gloss:"God; the supreme God (a plural of majesty), also gods or judges.",occ:2606},
    H7225:{lemma:"רֵאשִׁית",translit:"rēʾšît",pos:"noun, feminine",short:"beginning; first, chief",gloss:"Beginning, chief, first, the choicest or first fruits.",occ:51}
  };
  // installed dictionary modules are consulted before the small built-in set
  const dicts = [];
  function addDict(entries){ if(entries) dicts.push(entries); notify(); }
  function loadDictJSON(obj){ addDict((obj && obj.entries) || obj); }
  function lex(id){
    if(!id) return null;
    id = id.toUpperCase();
    for(const d of dicts){
      if(d[id]){ const e = d[id]; return { id, lang: id[0] === "H" ? "HEBREW" : "GREEK", lemma: e.lemma || "", translit: e.translit || "", pos: e.pos || "", short: e.short || "", gloss: e.gloss || "", kjv: e.kjv, occ: e.occ }; }
    }
    const e = LEX[id];
    if(e) return Object.assign({ id, lang: id[0] === "H" ? "HEBREW" : "GREEK" }, e);
    return { id, lang: id[0] === "H" ? "HEBREW" : "GREEK", missing: true };
  }

  // ── MySword verse-markup parser → display HTML ──
  function parseVerse(s){
    if(!s) return "";
    s = s.replace(/((?:<X?W[GH]\d+>)+)/g, run => {
      const nums = [...run.matchAll(/<X?W([GH])(\d+)>/g)].map(m => m[1] + m[2]);
      return `<sup class="st" data-s="${nums.join(",")}">${nums.join("·")}</sup>`;
    });
    s = s.replace(/<RF[^>]*>([\s\S]*?)<Rf>/g, '<span class="fn">[$1]</span>');
    s = s.replace(/<FR>/g, '<span class="red">').replace(/<Fr>/g, "</span>");
    s = s.replace(/<FI>/g, '<i class="sup">').replace(/<Fi>/g, "</i>");
    s = s.replace(/<CM>\s*/g, "<br><br>").replace(/<CL>\s*/g, "<br>").replace(/¶\s*/g, "<br><br>");
    s = s.replace(/<\/?el>/g, "");
    return s;
  }

  // ── USFM parsing (open.bible / Paratext) ──
  function inlineUSFM(s){
    if(!s) return "";
    s = s.replace(/\\f\b[\s\S]*?\\f\*/g, "").replace(/\\fe\b[\s\S]*?\\fe\*/g, "");
    s = s.replace(/\\x\b[\s\S]*?\\x\*/g, "");
    s = s.replace(/\\wj\*/g, "</span>").replace(/\\wj\b ?/g, '<span class="red">');
    s = s.replace(/\\add\*/g, "</i>").replace(/\\add\b ?/g, '<i class="sup">');
    s = s.replace(/\\nd\*/g, "</span>").replace(/\\nd\b ?/g, '<span class="nd">');
    s = s.replace(/\|[^\\]*?(?=\\[a-z+])/gi, "");
    s = s.replace(/\\\+?[a-z]+\d?\*/gi, "");
    s = s.replace(/\\\+?[a-z]+\d?\b ?/gi, "");
    return s.replace(/[ \t]{2,}/g, " ").trim();
  }
  function parseUSFM(text){
    const idm = text.match(/\\id\s+(\w+)/);
    const code = idm ? idm[1].toUpperCase() : null;
    const chapters = {};
    let chap = null, vbuf = null, vnum = null, pending = "";
    const add = frag => { if(vbuf != null) vbuf += frag; else pending += frag; };
    const flush = () => {
      if(chap != null && vnum != null)
        (chapters[chap] = chapters[chap] || []).push({ v: vnum, html: inlineUSFM(vbuf) });
      vbuf = null; vnum = null;
    };
    for(const line of text.split(/\r?\n/)){
      let m;
      if((m = line.match(/^\\c\s+(\d+)/))){ flush(); chap = +m[1]; pending = ""; continue; }
      if(chap == null) continue;
      if((m = line.match(/^\\v\s+(\S+) ?([\s\S]*)$/))){ flush(); vnum = m[1]; vbuf = pending + (m[2]||""); pending = ""; continue; }
      if((m = line.match(/^\\(?:s\d?|ms\d?|mr|d)\b ?([\s\S]*)$/))){ add('<br><span class="sec">' + inlineUSFM(m[1]||"") + "</span>"); continue; }
      if((m = line.match(/^\\r\b ?([\s\S]*)$/))){ add('<br><span class="parref">' + inlineUSFM(m[1]||"") + "</span>"); continue; }
      if((m = line.match(/^\\(q\d?|qm\d?)\b ?([\s\S]*)$/))){ const lvl = (m[1].match(/\d/)||["1"])[0]; add("<br>" + (lvl >= "2" ? "&emsp;" : "") + (m[2]||"")); continue; }
      if((m = line.match(/^\\(?:p|m|pi\d?|mi|nb|pc|cls|li\d?|pmo|pm|pr)\b ?([\s\S]*)$/))){ add("<br><br>" + (m[1]||"")); continue; }
      if(/^\\b\b/.test(line)){ add("<br>"); continue; }
      if(/^\\/.test(line)){ const rest = line.replace(/^\\\S+ ?/, ""); if(vbuf != null && rest) vbuf += " " + rest; continue; }
      if(vbuf != null) vbuf += " " + line;
    }
    flush();
    return { code, chapters };
  }

  // ── format sniffing ──
  const SQLITE_MAGIC = [0x53,0x51,0x4c,0x69,0x74,0x65,0x20,0x66,0x6f,0x72,0x6d,0x61,0x74,0x20,0x33,0x00];
  function isSqlite(u8){ if(u8.length < 16) return false; for(let i=0;i<16;i++) if(u8[i] !== SQLITE_MAGIC[i]) return false; return true; }
  function isZip(u8){ return u8.length > 3 && u8[0]===0x50 && u8[1]===0x4b && (u8[2]===0x03 || u8[2]===0x05); }

  // ── source builders → {abbr, name, books, maxChap, getVerses, plain} ──
  async function openDb(dbBytes){
    const SQL = await initSqlJs({ locateFile: f => SQLJS_BASE + f });
    const sdb = new SQL.Database(dbBytes);
    const q = (sql, params) => { const st = sdb.prepare(sql); if(params) st.bind(params); const o = []; while(st.step()) o.push(st.getAsObject()); st.free(); return o; };
    const tables = q("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
    return { q, tables, has: t => tables.some(x => x.toLowerCase() === t.toLowerCase()) };
  }
  function detailsOf(db, fb){
    let abbr = fb || "Bible", name = fb || "Module";
    try{ const d = db.q("SELECT * FROM Details LIMIT 1"); if(d.length){ if(d[0].Abbreviation) abbr = d[0].Abbreviation; name = d[0].Description || d[0].Title || name; } }catch(e){}
    return { abbr, name };
  }
  function buildBibleFromDb(db, fb){
    const det = detailsOf(db, fb);
    const maxChap = {}, books = [];
    db.q("SELECT Book, MAX(Chapter) AS mc FROM Bible GROUP BY Book ORDER BY Book").forEach(r => { maxChap[r.Book] = r.mc; books.push(r.Book); });
    return {
      abbr: det.abbr, name: det.name, kind: "mysword", category: "bibles", books, maxChap,
      getVerses: (b, c) => db.q("SELECT Verse, Scripture FROM Bible WHERE Book=? AND Chapter=? ORDER BY Verse", [b, c]).map(r => ({ v: r.Verse, html: parseVerse(r.Scripture), text: stripTags(r.Scripture) })),
      plain: (b, c) => db.q("SELECT Verse, Scripture FROM Bible WHERE Book=? AND Chapter=? ORDER BY Verse", [b, c]).map(r => ({ v: r.Verse, text: stripTags(r.Scripture) }))
    };
  }
  // MySword dictionary/lexicon → { TOPIC: {gloss, short} }
  function buildDictFromDb(db){
    const t = db.tables.find(x => /dictionary/i.test(x)); if(!t) return null;
    const cols = db.q("PRAGMA table_info(" + t + ")").map(c => c.name.toLowerCase());
    const topicCol = cols.includes("topic") ? "topic" : (cols.includes("word") ? "word" : cols[0]);
    const defCol = cols.includes("definition") ? "definition" : (cols.includes("data") ? "data" : cols[1] || cols[0]);
    const entries = {};
    db.q("SELECT " + topicCol + " AS topic, " + defCol + " AS def FROM " + t).forEach(r => {
      const id = String(r.topic || "").trim().toUpperCase(); if(!id) return;
      const g = stripTags(String(r.def || ""));
      entries[id] = { gloss: g, short: g.slice(0, 64) };
    });
    return Object.keys(entries).length ? entries : null;
  }
  function buildFromUSFM(files, fallbackName){
    const dec = new TextDecoder("utf-8");
    const store = {}, maxChap = {}, books = [];
    for(const nm of Object.keys(files)){
      if(nm.startsWith("__MACOSX") || !/\.(usfm|sfm)$/i.test(nm)) continue;
      const { code, chapters } = parseUSFM(dec.decode(files[nm]));
      let bookNum = USFM_BOOK[code];
      if(!bookNum){ const fm = nm.toUpperCase().match(/([1-3]?[A-Z]{2,3})\.(?:USFM|SFM)$/); if(fm) bookNum = USFM_BOOK[fm[1]]; }
      if(!bookNum) continue;
      const mc = Math.max(0, ...Object.keys(chapters).map(Number));
      if(mc <= 0) continue;
      store[bookNum] = chapters; maxChap[bookNum] = mc;
      if(!books.includes(bookNum)) books.push(bookNum);
    }
    if(!books.length) return null;
    books.sort((a, b) => a - b);
    const get = (b, c) => (store[b] && store[b][c]) ? store[b][c].map(x => ({ v: x.v, html: x.html, text: stripTags(x.html) })) : [];
    return {
      abbr: (fallbackName || "USFM").replace(/\.(zip|usfm|sfm)$/i, "").slice(0, 12) || "USFM",
      name: fallbackName || "USFM Bible", kind: "usfm", books, maxChap,
      getVerses: get, plain: (b, c) => get(b, c).map(x => ({ v: x.v, text: x.text }))
    };
  }
  function stripTags(s){ return (s || "").replace(/<X?W[GH]\d+>/g, "").replace(/<[^>]+>/g, "").replace(/\\\+?[a-z]+\d?\*?/gi, "").replace(/[ \t]{2,}/g, " ").trim(); }

  // ── module store + pub/sub ──
  const modules = {};   // abbr -> source
  let order = [];       // load order of abbrs
  let active = null;    // active version abbr
  const subs = new Set();
  const notify = () => subs.forEach(fn => { try{ fn(); }catch(e){} });

  function addSource(src){
    let abbr = src.abbr || "Bible", i = 2;
    while(modules[abbr] && modules[abbr].name !== src.name) abbr = src.abbr + i++;
    src.abbr = abbr;
    modules[abbr] = src;
    if(!order.includes(abbr)) order.push(abbr);
    if(!active) active = abbr;
    notify();
    return abbr;
  }

  function applyMeta(src, meta){ if(meta && meta.abbr) src.abbr = meta.abbr; if(meta && meta.name) src.name = meta.name; src.category = (meta && meta.category) || src.category || "bibles"; return src; }

  // Returns {kind:'bible', abbr} or {kind:'dict'}.
  async function loadModuleBytes(u8, srcName, meta){
    if(isSqlite(u8)){
      const db = await openDb(u8);
      if(db.has("Bible")) return { kind: "bible", abbr: addSource(applyMeta(buildBibleFromDb(db, srcName), meta)) };
      const dict = buildDictFromDb(db);
      if(dict){ addDict(dict); return { kind: "dict" }; }
      throw new Error("unsupported MySword module — no Bible or dictionary table");
    }
    if(isZip(u8)){
      const files = fflate.unzipSync(u8);
      const names = Object.keys(files).filter(n => !n.startsWith("__MACOSX"));
      const dbName = names.find(n => /\.(bbl\.mybible|mybible|bbl|sqlite|db)$/i.test(n)) || names.find(n => isSqlite(files[n]));
      if(dbName){
        const db = await openDb(files[dbName]);
        if(db.has("Bible")) return { kind: "bible", abbr: addSource(applyMeta(buildBibleFromDb(db, srcName), meta)) };
        const dict = buildDictFromDb(db);
        if(dict){ addDict(dict); return { kind: "dict" }; }
        throw new Error("unsupported module inside " + (srcName || "the archive"));
      }
      const src = buildFromUSFM(files, srcName);
      if(!src) throw new Error("no MySword module or USFM books found inside " + (srcName || "the archive"));
      return { kind: "bible", abbr: addSource(applyMeta(src, meta)) };
    }
    const head = new TextDecoder().decode(u8.slice(0, 256));
    if(/\\id\s+\w+/.test(head) || /\\c\s+\d/.test(head)){
      const src = buildFromUSFM({ "book.usfm": u8 }, srcName);
      if(src) return { kind: "bible", abbr: addSource(applyMeta(src, meta)) };
    }
    throw new Error("unrecognized file — expected a MySword .mybible module, a USFM book, or a .zip containing either");
  }

  // ── IndexedDB cache (download-once) ──
  function idb(){ return new Promise((res, rej) => { const r = indexedDB.open("bible-modules", 1); r.onupgradeneeded = () => r.result.createObjectStore("modules"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function idbStore(db, mode){ return db.transaction("modules", mode).objectStore("modules"); }
  async function cacheGet(key){ try{ const db = await idb(); return await new Promise((res, rej) => { const q = idbStore(db, "readonly").get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); }catch(e){ return null; } }
  async function cachePut(key, u8){ try{ const db = await idb(); await new Promise((res, rej) => { const q = idbStore(db, "readwrite").put(u8, key); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); }catch(e){} }
  async function cacheKeys(){ try{ const db = await idb(); return await new Promise((res, rej) => { const q = idbStore(db, "readonly").getAllKeys(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); }catch(e){ return []; } }

  async function fetchAndCacheModule(url, meta){
    const cached = await cacheGet(url);
    if(cached) return loadModuleBytes(cached, url.split("/").pop(), meta);
    const res = await fetch(url);
    if(!res.ok) throw new Error("HTTP " + res.status);
    const u8 = new Uint8Array(await res.arrayBuffer());
    await cachePut(url, u8);
    return loadModuleBytes(u8, url.split("/").pop(), meta);
  }

  // ── catalog + installed-module registry (download-once, MySword style) ──
  const INSTALLED_KEY = "trinityone.installed";   // localStorage map: url -> meta
  const installing = new Set();              // urls currently downloading
  let catalogPromise = null;

  function getInstalled(){ try{ return JSON.parse(localStorage.getItem(INSTALLED_KEY) || "{}"); }catch(e){ return {}; } }
  function setInstalled(map){ try{ localStorage.setItem(INSTALLED_KEY, JSON.stringify(map)); }catch(e){} }
  function catOf(item){ return item.category || (item.kind === "dict" ? "dictionaries" : item.kind === "comment" ? "commentaries" : item.kind === "devotional" ? "devotionals" : "bibles"); }
  function recordInstalled(item){ const m = getInstalled(); m[item.url] = { url: item.url, id: item.id, abbr: item.abbr, name: item.name, kind: item.kind, format: item.format, category: catOf(item) }; setInstalled(m); }
  function isInstalled(url){ return !!getInstalled()[url]; }
  function isInstalling(url){ return installing.has(url); }

  async function getCatalog(){
    if(!catalogPromise) catalogPromise = fetch("catalog.json").then(r => r.ok ? r.json() : { categories: [] }).catch(() => ({ categories: [] }));
    return catalogPromise;
  }

  // deep eBible.org mirror index (bundled, built by scripts/build-ebible-catalog.py).
  // The translation zips it points at are CORS-blocked in a browser but download
  // fine inside the Capacitor APK (native HTTP).
  let mirrorPromise = null;
  async function getMirror(){
    if(!mirrorPromise) mirrorPromise = fetch("ebible-catalog.json").then(r => r.ok ? r.json() : null).catch(() => null);
    return mirrorPromise;
  }

  // bundled snapshot of the church's YouTube videos (scripts/build-trinity-videos.py).
  // Inside the APK this can refresh live from channel.feed (RSS) via native HTTP;
  // CORS blocks that in the browser, so the snapshot is the dev-build source.
  let videosPromise = null;
  async function getVideos(){
    if(!videosPromise) videosPromise = fetch("trinity-videos.json").then(r => r.ok ? r.json() : null).catch(() => null);
    return videosPromise;
  }

  // install one catalog entry: download (cache-once) → load into engine → remember.
  async function installModule(item){
    if(!item || !item.url) throw new Error("nothing to install");
    if(installing.has(item.url)) return;
    installing.add(item.url); notify();
    try{
      if((item.format || "").toUpperCase() === "JSON"){
        let bytes = await cacheGet(item.url);
        if(!bytes){ const res = await fetch(item.url); if(!res.ok) throw new Error("HTTP " + res.status); bytes = new Uint8Array(await res.arrayBuffer()); await cachePut(item.url, bytes); }
        loadDictJSON(JSON.parse(new TextDecoder().decode(bytes)));
      }else{
        await fetchAndCacheModule(item.url, { abbr: item.abbr, name: item.name, category: catOf(item) });
      }
      recordInstalled(item);
      return true;
    }catch(err){ console.error(err); window.Bible._error = "Couldn't install " + (item.name || item.url) + " — " + err.message; throw err; }
    finally{ installing.delete(item.url); notify(); }
  }

  // re-load everything previously installed (boot, before autoLoad)
  async function restoreInstalled(){
    const m = getInstalled();
    for(const url of Object.keys(m)){
      const meta = m[url];
      try{
        const bytes = await cacheGet(url);
        if(!bytes) continue;  // cache cleared — user can re-download
        if((meta.format || "").toUpperCase() === "JSON") loadDictJSON(JSON.parse(new TextDecoder().decode(bytes)));
        else await loadModuleBytes(bytes, url.split("/").pop(), { abbr: meta.abbr, name: meta.name, category: meta.category });
      }catch(e){ console.error("restore failed for", url, e); }
    }
  }

  // ── hidden file input ──
  let fileInput = null, loadingFlag = false;
  function ensureInput(){
    if(fileInput) return fileInput;
    fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.style.display = "none";
    fileInput.addEventListener("change", async e => {
      const f = e.target.files[0]; e.target.value = "";
      if(!f) return;
      loadingFlag = true; notify();
      try{ await loadModuleBytes(new Uint8Array(await f.arrayBuffer()), f.name); }
      catch(err){ console.error(err); window.Bible._error = err.message; }
      finally{ loadingFlag = false; notify(); }
    });
    document.body.appendChild(fileInput);
    return fileInput;
  }
  function pickFile(){ ensureInput().click(); }

  // ── reading helpers over the active module ──
  function src(version){ return modules[version || active] || null; }
  function versions(){ return order.map(a => ({ abbr: a, name: modules[a].name, kind: modules[a].kind })); }
  function books(version){ const s = src(version); return s ? s.books.slice() : []; }
  function maxChapter(b, version){ const s = src(version); return s ? (s.maxChap[b] || 1) : 1; }
  function getVerses(b, c, version){ const s = src(version); return s ? s.getVerses(b, c) : []; }

  function bookMeta(version){
    return books(version).map(n => ({ num: n, name: bookName(n), abbr: bookAbbr(n), group: bookGroup(n), ch: maxChapter(n, version) }));
  }
  function defaultLoc(){
    const bs = books();
    if(!bs.length) return null;
    return { book: bs.includes(43) ? 43 : bs[0], chap: 1 };
  }
  function step(loc, dir){
    const bs = books(); if(!bs.length) return null;
    const idx = bs.indexOf(loc.book);
    let { book, chap } = loc;
    if(dir > 0){
      if(chap < maxChapter(book)) chap++;
      else if(idx < bs.length - 1){ book = bs[idx + 1]; chap = 1; }
      else return null;
    }else{
      if(chap > 1) chap--;
      else if(idx > 0){ book = bs[idx - 1]; chap = maxChapter(book); }
      else return null;
    }
    return { book, chap };
  }
  function refLabel(loc, v){ return bookName(loc.book) + " " + loc.chap + (v != null ? ":" + v : ""); }
  function refKey(loc, v){ return loc.book + "." + loc.chap + "." + v; }

  // ── full-text search over the active module ──
  function search(term, cap){
    const s = src(); if(!s || !term) return [];
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const out = []; cap = cap || 250;
    for(const b of s.books){
      const mc = s.maxChap[b];
      for(let c = 1; c <= mc; c++){
        const vs = s.plain ? s.plain(b, c) : s.getVerses(b, c);
        for(const row of vs){
          if(re.test(row.text)){
            out.push({ book: b, chap: c, verse: row.v, ref: bookName(b) + " " + c + ":" + row.v, text: row.text });
            if(out.length >= cap) return out;
          }
        }
      }
    }
    return out;
  }

  // ── boot: restore installed modules, then optional ?module=<url> autoload ──
  async function autoLoad(){
    loadingFlag = true; notify();
    try{ await restoreInstalled(); }catch(e){ console.error(e); }
    const url = new URLSearchParams(location.search).get("module");
    if(url){
      try{ await fetchAndCacheModule(url); }
      catch(err){ console.error(err); window.Bible._error = err.message; }
    }
    loadingFlag = false; notify();
  }

  window.Bible = {
    BOOK_NAMES, bookName, bookAbbr, bookGroup,
    parseVerse, lex,
    loadModuleBytes, fetchAndCacheModule, pickFile,
    cacheKeys, getCatalog, getMirror, getVideos, installModule, isInstalled, isInstalling,
    installedMap: getInstalled,
    subscribe(fn){ subs.add(fn); return () => subs.delete(fn); },
    get loaded(){ return order.length > 0; },
    get loading(){ return loadingFlag; },
    get activeVersion(){ return active; },
    setActive(v){ if(modules[v]){ active = v; notify(); } },
    versions, books, maxChapter, getVerses, bookMeta, defaultLoc, step, refLabel, refKey, search,
    _error: null
  };

  // kick off autoload once the DOM + CDN libs are present
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoLoad);
  else autoLoad();
})();
