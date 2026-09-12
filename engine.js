// engine.js — TrinityOne data layer (plain JS, no JSX).
// Loads MySword (.bbl.mybible SQLite) and open.bible (USFM-in-zip) modules
// entirely in-browser, parses Scripture markup, and exposes window.Bible.
"use strict";
// XSS guard: verse + commentary HTML is rendered via dangerouslySetInnerHTML, but a malicious
// .mybible/.cmt module could embed <script> or onerror= in its content. Whitelist-sanitize first —
// keep the engine's safe formatting tags/classes, drop everything else.
window.sanitizeHtml = function (html) {
  if (typeof html !== "string" || html.indexOf("<") === -1) return html || "";
  try {
    const OK_TAG = { SPAN: 1, SUP: 1, SUB: 1, BR: 1, EM: 1, I: 1, B: 1, STRONG: 1, MARK: 1, U: 1, P: 1, DIV: 1, BLOCKQUOTE: 1, UL: 1, OL: 1, LI: 1, SMALL: 1, WBR: 1, HR: 1, RUBY: 1, RT: 1 };
    const OK_ATTR = { "class": 1, "data-s": 1 };
    const DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, BASE: 1, FORM: 1, SVG: 1, IMG: 1, AUDIO: 1, VIDEO: 1, BUTTON: 1, INPUT: 1, A: 1 };
    const t = document.createElement("template");
    t.innerHTML = html;
    const els = t.content.querySelectorAll("*");
    for (let i = els.length - 1; i >= 0; i--) {       // reverse = innermost first
      const el = els[i], tag = el.tagName;
      if (DROP[tag]) { el.remove(); continue; }        // remove dangerous elements + their content
      if (!OK_TAG[tag]) { el.replaceWith.apply(el, [].slice.call(el.childNodes)); continue; }  // unwrap, keep text
      const attrs = [].slice.call(el.attributes);
      for (let j = 0; j < attrs.length; j++) { if (!OK_ATTR[attrs[j].name.toLowerCase()]) el.removeAttribute(attrs[j].name); }
    }
    return t.innerHTML;
  } catch (e) { return String(html).replace(/<[^>]*>/g, ""); }   // fallback: strip all tags
};
// SECURITY-AUDIT-2026-07-06 H2/M7/L6: profile fields (church + member accent/picture/banner/photo) come
// from untrusted relay-published kind-0 events and are interpolated into CSS background/url() or an <img src>.
// A crafted value like "#fff),url(https://evil/beacon)/*" or a remote picture URL makes every viewer's client
// fetch an attacker host on render → silent IP/geo/online-time deanonymisation (persecuted-church threat model).
// Guard at every render site. Mirrors the inline guard identity-avatar.jsx already had for member avatars.
//   safeCssColor: accept ONLY a hex literal or a `var(--token)`; else fall back. Blocks url()/expression smuggling.
//   safeImgUrl:   accept ONLY a `data:image/...` URI (how the app itself makes uploads — cropped data URIs);
//                 reject remote/`http(s):`/`javascript:` etc. so a profile field can never beacon out.
window.safeCssColor = function (v, fallback) {
  const s = typeof v === "string" ? v.trim() : "";
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  if (/^var\(--[a-zA-Z0-9-]+\)$/.test(s)) return s;
  return fallback || "var(--clay)";
};
window.safeImgUrl = function (v) {
  const s = typeof v === "string" ? v.trim() : "";
  return /^data:image\/[a-zA-Z0-9.+-]+;/.test(s) ? s : "";
};
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

  // name → book number, and "John 5" / "1 John 2:3" / "Psalms 23" → {book, chap, verse}
  const NAME_TO_NUM = {};
  BOOK_NAMES.forEach((nm, i) => { NAME_TO_NUM[nm.toLowerCase()] = i + 1; });
  NAME_TO_NUM["psalm"] = 19; NAME_TO_NUM["song of songs"] = 22;
  const bookNum = name => NAME_TO_NUM[String(name || "").trim().toLowerCase().replace(/\s+/g, " ")] || 0;
  function parseRef(str){
    const m = String(str || "").match(/^\s*([1-3]?\s?[A-Za-z][A-Za-z ]*?)\s+(\d+)(?::(\d+))?/);
    if(!m) return null;
    const book = bookNum(m[1]); if(!book) return null;
    return { book, chap: parseInt(m[2], 10), verse: m[3] ? parseInt(m[3], 10) : undefined };
  }

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
  // installed dictionary modules are consulted before the small built-in set.
  //
  // EACH ONE CARRIES THE ABBR IT WAS INSTALLED UNDER, and that is the whole reason this is a list of
  // records rather than a list of entry maps. A dictionary used to go in as a bare object with no identity
  // of any kind, so nothing could ever find it again — which is why removeModule could not remove one, on
  // a product whose first audience is phones with very little storage (see removeModule below). The two
  // readers (lex, searchDict) take `d.entries`; nothing outside engine.js touches this list.
  const dicts = [];
  // RETURNS THE ABBR IT REGISTERED, which is not always the one asked for — the same dedupe addSource and
  // addCommentary have always done, for the same reason. Two modules can carry one catalogue abbr (260 of
  // the 1,290 entries in ebible-catalog.json are "NT"), and two dictionaries filed under one name would be
  // one name that removes both. The caller records what comes back, never what it asked for.
  // A DICTIONARY WITH NO NAME CANNOT BE REMOVED, so it is given one. Nothing hands addDict a name on the
  // two paths that carry no catalogue entry — a file import, and `?module=<url>` — and an unnamed
  // dictionary was skipped by the `if(r && r.abbr)` guard in both, so it was never cached, never recorded,
  // never restored after a restart, and never removable. "Dict" (then Dict2, Dict3…) is the same fallback
  // addCommentary has used for exactly this since it was written.
  function addDict(entries, abbr){
    if(!entries) return null;
    const want = abbr || "Dict";
    let a = want, i = 2;
    while(hasDict(a)) a = want + i++;
    dicts.push({ abbr: a, entries });
    notify();
    return a;
  }
  // Lexicon dicts (Strong's ≈ 14k entries) aren't needed until a word is tapped — defer their parse off the
  // boot path. They load on idle after boot, or on the first lex()/dict access, whichever comes first.
  // A pending one carries its abbr too: a dictionary removed BEFORE its deferred parse ran would otherwise
  // be put straight back by _ensureDicts a second later, with its bytes already deleted.
  const _pendingDicts = []; let _dictsLoaded = false;
  function _ensureDicts(){ if(_dictsLoaded) return; _dictsLoaded = true; for(const d of _pendingDicts.splice(0)){ try{ d.run(); }catch(e){ console.error("lazy dict", e); } } }
  function hasDict(abbr){ return !!abbr && (dicts.some(d => d.abbr === abbr) || _pendingDicts.some(d => d.abbr === abbr)); }
  // Drop a dictionary from memory — both the parsed entries and any deferred parse still holding its raw
  // bytes. Splicing the record is what actually frees the memory: nothing else references it.
  //
  // The `!abbr` guard is a refusal to match on an empty name, not a gap: addDict gives every dictionary a
  // name (see above), so nothing in `dicts` carries "" any more, and matching it would mean an unnamed
  // record sweeping out dictionaries it has nothing to do with.
  function removeDict(abbr, url){
    if(!abbr) return;
    for(let i = dicts.length - 1; i >= 0; i--) if(dicts[i].abbr === abbr) dicts.splice(i, 1);
    // A PENDING PARSE IS MATCHED BY URL WHERE THERE IS ONE. Until it runs, a deferred dictionary is still
    // carrying the name its RECORD had — so two records written by an older build under one name (both
    // "BDB") would have one Remove throw away the other's queued parse too, and the dictionary the member
    // kept would be missing from lookups until the next launch. The url is not ambiguous.
    for(let i = _pendingDicts.length - 1; i >= 0; i--){
      const p = _pendingDicts[i];
      if(p.abbr === abbr && (!url || !p.url || p.url === url)) _pendingDicts.splice(i, 1);
    }
  }
  // SECURITY-AUDIT-2026-06-24 N4: strip raw HTML from third-party dictionary string fields. Today
  // every lexicon value reaches the DOM as a React text child (auto-escaped, no XSS), so this is
  // defence in depth — but if a future change ever wraps lex output in dangerouslySetInnerHTML
  // (e.g. someone wants bold lemmas), or a member installs a third-party `.dct` module via the
  // Import flow, the embedded markup would suddenly become live without this strip. Single-pass
  // tag removal is enough; we don't try to preserve formatting.
  const _LEX_FIELDS = ['lemma','translit','pos','short','gloss','def','deriv','kjv'];
  function _stripTags(s){ return (typeof s === 'string' && s.indexOf('<') !== -1) ? s.replace(/<[^>]*>/g, '') : s; }
  function loadDictJSON(obj, abbr){
    // The security strip (raw HTML out of third-party dict fields) now happens lazily per-entry in lex() on
    // lookup, so we skip the O(14k) walk here — it was a measurable boot cost for zero benefit before a tap.
    return addDict((obj && obj.entries) || obj || {}, abbr);
  }
  const commentaries = {};   // abbr -> commentary source { name, getComment(book,chap) }
  function addCommentary(src){ if(!src) return null; let abbr = src.abbr || "Cmt", i = 2; while(commentaries[abbr] && commentaries[abbr].name !== src.name) abbr = (src.abbr || "Cmt") + i++; src.abbr = abbr; commentaries[abbr] = src; notify(); return abbr; }
  // PERF-AUDIT-2026-07-20 MEDIUM-2: the full Strong's dictionary (modules/strongs-dict.json — 4.01 MB raw,
  // 958 KB gzipped) used to install UNCONDITIONALLY on first run. That was 19% of the entire cold-start wire
  // cost — about 153 SECONDS on 2G — for a feature the auto-installed default Bible (BSB) doesn't even
  // expose, downloaded before the member had tapped anything. It now installs on the first Strong's lookup.
  // The small built-in LEX below still answers common terms immediately, so a tap is never dead; when the
  // download lands, notify() re-renders the open panel with the full entry. One-shot: a failure clears the
  // flag so a later tap (or a better connection) retries, and it is a no-op once installed.
  let _lexRequested = false;
  function _ensureFullLexicon(){
    if(_lexRequested || typeof navigator === "undefined") return;
    _lexRequested = true;
    try{
      if(isInstalled(DEFAULT_LEXICON.url)) return;
      installModule(DEFAULT_LEXICON).then(notify).catch(err => { _lexRequested = false; console.warn("lexicon install failed", err); });
    }catch(err){ _lexRequested = false; console.warn("lexicon install failed", err); }
  }
  function lex(id){
    if(!id) return null;
    _ensureDicts();
    _ensureFullLexicon();   // first tap pays for it, not first launch
    id = id.toUpperCase();
    for(const rec of dicts){
      const d = rec.entries;
      if(d[id]){ const e = d[id]; return { id, lang: id[0] === "H" ? "HEBREW" : "GREEK", lemma: _stripTags(e.lemma || ""), translit: _stripTags(e.translit || ""), pos: _stripTags(e.pos || ""), short: _stripTags(e.short || ""), gloss: _stripTags(e.gloss || ""), def: _stripTags(e.def || ""), deriv: _stripTags(e.deriv || ""), kjv: _stripTags(e.kjv), occ: e.occ }; }
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
  // A module's own Details row. `license` is the ATTRIBUTION NOTICE THE MODULE CARRIES ITSELF, not a
  // catalogue label: an openly-licensed resource (CC BY-SA and friends) obliges us to credit the author and
  // name the licence wherever its words are shown, and a notice that lives only in catalog.json covers only
  // the modules WE list. A module loaded from a file — pickFile(), a hand-copied .cmt.mybible, one built by
  // somebody else's script — has no catalogue entry at all, and the file-input path calls loadModuleBytes
  // with no meta whatsoever, so applyMeta() has nothing to apply. Reading the notice out of the file is what
  // makes the credit travel with the words. That path is the one the tests drive: they call
  // buildCommentaryFromDb + addCommentary directly, with no meta, and the notice still reaches the screen.
  // getCommentary() passes it to the Study panel, which prints it under the heading. Public-domain modules
  // have no such column and get no line — nothing to attribute.
  function detailsOf(db, fb){
    let abbr = fb || "Bible", name = fb || "Module", license = "";
    try{ const d = db.q("SELECT * FROM Details LIMIT 1"); if(d.length){ if(d[0].Abbreviation) abbr = d[0].Abbreviation; name = d[0].Description || d[0].Title || name; license = d[0].License || d[0].Licence || d[0].Copyright || ""; } }catch(e){}
    return { abbr, name, license: String(license || "") };
  }
  function buildBibleFromDb(db, fb){
    const det = detailsOf(db, fb);
    const maxChap = {}, books = [];
    db.q("SELECT Book, MAX(Chapter) AS mc FROM Bible GROUP BY Book ORDER BY Book").forEach(r => { maxChap[r.Book] = r.mc; books.push(r.Book); });
    return {
      abbr: det.abbr, name: det.name, kind: "mysword", category: "bibles", books, maxChap,
      getVerses: (b, c) => db.q("SELECT Verse, Scripture FROM Bible WHERE Book=? AND Chapter=? ORDER BY Verse", [b, c]).map(r => ({ v: r.Verse, html: parseVerse(r.Scripture), text: stripTags(r.Scripture) })),
      plain: (b, c) => db.q("SELECT Verse, Scripture FROM Bible WHERE Book=? AND Chapter=? ORDER BY Verse", [b, c]).map(r => ({ v: r.Verse, text: stripTags(r.Scripture) })),
      // study/footnotes baked into the verse text (e.g. Geneva Bible <RF>…<Rf>) — pulled into Commentary
      footnotes: (b, c) => { const out = []; db.q("SELECT Verse, Scripture FROM Bible WHERE Book=? AND Chapter=? ORDER BY Verse", [b, c]).forEach(r => { const notes = []; String(r.Scripture || "").replace(/<RF[^>]*>([\s\S]*?)<Rf>/g, (m, t) => { const x = stripTags(t).trim(); if(x) notes.push(x); return ""; }); if(notes.length) out.push({ v: r.Verse, notes }); }); return out; },
      // fast search: coarse SQL LIKE to narrow candidates, then refine on stripped text
      search: (re, term, cap) => {
        const like = "%" + term.replace(/[%_\\]/g, "\\$&") + "%";
        const rows = db.q("SELECT Book, Chapter, Verse, Scripture FROM Bible WHERE Scripture LIKE ? ESCAPE '\\' ORDER BY Book, Chapter, Verse LIMIT ?", [like, cap * 4]);
        const out = [];
        for(const r of rows){ const text = stripTags(r.Scripture); if(re.test(text)){ out.push({ book: r.Book, chap: r.Chapter, verse: r.Verse, text }); if(out.length >= cap) break; } }
        return out;
      }
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
  // MySword commentary (.cmt.mybible): a Commentary table keyed by book/chapter (+ verse range)
  function buildCommentaryFromDb(db, fb){
    const t = db.tables.find(x => /commentary/i.test(x)); if(!t) return null;
    const cols = db.q("PRAGMA table_info(" + t + ")").map(c => c.name);
    const find = (...names) => cols.find(c => names.some(n => c.toLowerCase() === n));
    const bookCol = find("book", "booknumber"), chapCol = find("chapter", "chapternumber", "chapterbegin", "fromchapter");
    const fromV = find("fromverse", "versebegin", "verse", "versenumber"), toV = find("toverse", "verseend");
    const dataCol = find("comments", "data", "text", "commentary", "definition");
    if(!bookCol || !chapCol || !dataCol) return null;
    const det = detailsOf(db, fb);
    const sel = "SELECT " + [bookCol + " AS b", chapCol + " AS c", (fromV ? fromV : "0") + " AS fv", (toV ? toV : (fromV || "0")) + " AS tv", dataCol + " AS d"].join(", ") + " FROM " + t + " WHERE " + bookCol + "=? AND " + chapCol + "=? ORDER BY fv";
    return {
      abbr: det.abbr, name: det.name, kind: "comment", license: det.license,
      getComment: (b, c) => { try { return db.q(sel, [b, c]).map(r => ({ v: r.fv, vTo: r.tv, html: parseVerse(String(r.d || "")) })).filter(x => x.html.trim()); } catch(e){ return []; } }
    };
  }
  function buildFromUSFM(files, fallbackName){
    const dec = new TextDecoder("utf-8");
    const rawByBook = {}, parsed = {}, maxChap = {}, books = [];
    for(const nm of Object.keys(files)){
      if(nm.startsWith("__MACOSX") || !/\.(usfm|sfm)$/i.test(nm)) continue;
      const text = dec.decode(files[nm]);
      // LAZY BIBLE (E1): identify the book + its chapter count cheaply here, but DEFER the expensive per-verse
      // parse (parseUSFM) until the book is actually opened. Parsing all 66 books up front cost ~0.6s on
      // desktop / 2-5s on a modest phone on EVERY boot; this drops it to a few ms for the one book being read.
      // The \id + line-start \c detection mirrors parseUSFM exactly, so the book list + maxChap are identical.
      const idm = text.match(/\\id\s+(\w+)/);
      let bookNum = idm ? USFM_BOOK[idm[1].toUpperCase()] : 0;
      if(!bookNum){ const fm = nm.toUpperCase().match(/([1-3]?[A-Z]{2,3})\.(?:USFM|SFM)$/); if(fm) bookNum = USFM_BOOK[fm[1]]; }
      if(!bookNum) continue;
      let mc = 0; const cre = /^\\c\s+(\d+)/gm; let cm; while((cm = cre.exec(text))){ const n = +cm[1]; if(n > mc) mc = n; }
      if(mc <= 0) continue;
      rawByBook[bookNum] = text; maxChap[bookNum] = mc;
      if(!books.includes(bookNum)) books.push(bookNum);
    }
    if(!books.length) return null;
    books.sort((a, b) => a - b);
    const chaptersFor = (b) => {
      if(!parsed[b]){ const raw = rawByBook[b]; parsed[b] = raw ? (parseUSFM(raw).chapters || {}) : {}; rawByBook[b] = null; }
      return parsed[b];
    };
    const get = (b, c) => { const ch = chaptersFor(b); return (ch && ch[c]) ? ch[c].map(x => ({ v: x.v, html: x.html, text: stripTags(x.html) })) : []; };
    return {
      abbr: (fallbackName || "USFM").replace(/\.(zip|usfm|sfm)$/i, "").slice(0, 12) || "USFM",
      name: fallbackName || "USFM Bible", kind: "usfm", books, maxChap,
      getVerses: get, plain: (b, c) => get(b, c).map(x => ({ v: x.v, text: x.text }))
    };
  }
  // clean display/search text: drop note CONTENT (not just tags), Strong's, markup
  function stripTags(s){
    return (s || "")
      .replace(/<RF[^>]*>[\s\S]*?<Rf>/g, "")      // MySword footnotes (remove content)
      .replace(/<RX[^>]*>[\s\S]*?<Rx>/g, "")      // MySword cross-references
      .replace(/\\f\b[\s\S]*?\\f\*/g, "")          // USFM footnotes
      .replace(/\\x\b[\s\S]*?\\x\*/g, "")          // USFM cross-references
      .replace(/<X?W[GH]\d+>/g, "")                // Strong's tags
      .replace(/<(?:CM|CL|PF|PI|PG|TS\d?|Q\d?)[^>]*>|¶/gi, " ") // block breaks → space
      .replace(/<[^>]+>/g, "")                     // any remaining markup tags
      .replace(/\\\+?[a-z]+\d?\*?/gi, "")          // remaining USFM codes
      .replace(/\s{2,}/g, " ").trim();
  }

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
      const cmt = buildCommentaryFromDb(db, srcName);
      if(cmt){ addCommentary(applyMeta(cmt, meta)); return { kind: "comment", abbr: cmt.abbr }; }
      const dict = buildDictFromDb(db);
      if(dict){ return { kind: "dict", abbr: addDict(dict, meta && meta.abbr) }; }
      throw new Error("unsupported MySword module — no Bible, commentary or dictionary table");
    }
    if(isZip(u8)){
      const files = fflate.unzipSync(u8);
      const names = Object.keys(files).filter(n => !n.startsWith("__MACOSX"));
      const dbName = names.find(n => /\.(bbl\.mybible|mybible|bbl|sqlite|db)$/i.test(n)) || names.find(n => isSqlite(files[n]));
      if(dbName){
        const db = await openDb(files[dbName]);
        if(db.has("Bible")) return { kind: "bible", abbr: addSource(applyMeta(buildBibleFromDb(db, srcName), meta)) };
        const cmt = buildCommentaryFromDb(db, srcName);
        if(cmt){ addCommentary(applyMeta(cmt, meta)); return { kind: "comment", abbr: cmt.abbr }; }
        const dict = buildDictFromDb(db);
        if(dict){ return { kind: "dict", abbr: addDict(dict, meta && meta.abbr) }; }
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
  async function cacheDelete(key){ try{ const db = await idb(); await new Promise((res, rej) => { const q = idbStore(db, "readwrite").delete(key); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); }catch(e){} }
  // "IS IT STILL THERE?" — AND IT THROWS WHEN IT CANNOT LOOK. Every other helper above swallows its errors
  // and answers null/[]/nothing, which is right for reading a module (a cache miss and a broken store both
  // mean "fetch it") and WRONG for the one question removeModule asks after deleting: cacheGet() returns
  // null when the bytes are gone AND when indexedDB.open() failed, and the delete that just ran swallowed
  // the identical failure — so the same broken store made the delete a no-op and the read-back say "proved
  // gone". Measured: 25 MB left in the store with the record deleted, and since nothing then lists the
  // module, nothing could ever offer to remove it again. That is the exact outcome the delete-before-forget
  // ordering exists to prevent, so this one deliberately does NOT catch: "I could not look" must reach the
  // caller as an error and never as "no".
  //
  // It reads with get() rather than count() deliberately: get() is the call cacheGet already makes on every
  // launch of every phone this ships to, so nothing here rests on an IndexedDB method this app has never
  // used on a device. The cost of reading the blob instead of counting it is only ever paid when the answer
  // is YES — i.e. when the delete failed — because a deleted key returns undefined with nothing to read.
  //
  // THREE THINGS IT MUST NOT DO, all of them reached by a phone and not by a desk:
  //   · a MISSING object store is a provable absence, not an unknown — the bytes cannot be in a store that
  //     is not there, so that answers "no" rather than stranding the record for ever;
  //   · an ABORTED transaction (the database is being deleted, a version change is pending, the quota is
  //     revoked mid-read) fires neither onsuccess nor onerror on the request, so without onabort the
  //     promise never settles and the member's Remove button spins for ever with no toast — a dead
  //     control, which is the failure this whole programme exists to stop;
  //   · nor may it hang for ever if IndexedDB simply never answers, which it does on Android when the
  //     database is locked by another tab or a compaction. 10s then refuse, honestly.
  async function cacheHas(key){
    const db = await idb();
    let store;
    try{ store = idbStore(db, "readonly"); }
    catch(e){ if(e && (e.name === "NotFoundError" || e.name === "InvalidStateError")) return false; throw e; }
    return await new Promise((res, rej) => {
      let done = false;
      const settle = (fn, v) => { if(done) return; done = true; clearTimeout(timer); fn(v); };
      const timer = setTimeout(() => settle(rej, new Error("timed out asking whether " + key + " is still cached")), 10000);
      const q = store.get(key);
      q.onsuccess = () => settle(res, q.result != null);
      q.onerror = () => settle(rej, q.error);
      store.transaction.onabort = () => settle(rej, store.transaction.error || new Error("the read was aborted"));
    });
  }

  // Modules (Bibles + the Strong's lexicon) are NOT embedded in the app — they download on demand.
  // The web build serves them same-origin. On native, MOST modules are not in the APK, so a relative url
  // resolves against our public gateway (CapacitorHttp makes that cross-origin fetch work; the gateway serves
  // /modules/* with CORS). Cache keys stay the ORIGINAL (relative) url so a cache hit is host-independent.
  // Swap ASSET_BASE for the church's own domain post-pilot.
  //
  // ⚠ resolveAsset is NOT the whole story and must not be used as a bare fetch target: the DEFAULT Bible IS
  // shipped inside the APK (scripts/sync-web.sh → www/modules/engbsb.zip). Go through fetchAsset(), which
  // tries the on-device copy first. This comment used to say "the APK ships none" — true when it was written,
  // false since the file was added, and that one stale line is why the offline Bible never loaded.
  const IS_NATIVE = !!(typeof window !== "undefined" && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const ASSET_BASE = IS_NATIVE ? "https://app.trinityone.church/" : "";
  const resolveAsset = (u) => (ASSET_BASE && u && !/^https?:/i.test(u)) ? (ASSET_BASE + String(u).replace(/^\//, "")) : u;

  // ── M3: download integrity ────────────────────────────────────────────────
  // Modules come from third-party hosts (eBible.org) or the gateway (ASSET_BASE) over the network. A
  // compromised host or MITM could serve a malicious build. We pin known-good SHA-256s for the bundled
  // DEFAULTS (BSB + Strong's — the only modules every install downloads) and verify after download,
  // before caching/parsing. A catalog entry may also carry its own `sha256`; otherwise (the open
  // catalogue) there's no pinned hash and we rely on TLS — see SECURITY-AUDIT M3.
  const KNOWN_HASHES = {
    "modules/engbsb.zip":        "a7f61bf7986aa11cf3ced7044af79dadce029053573ce99703c2a8d66601e41b",
    "modules/strongs-dict.json": "8a2a130d8e0f2c0ec22bd1891c186cd9eed9477152e57f582ed0dbfb6f3769c1",
  };
  async function sha256hex(u8){
    const d = await crypto.subtle.digest("SHA-256", u8);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // throws if a pinned/declared hash doesn't match; no-op when nothing is pinned for this url.
  async function verifyIntegrity(url, u8, declaredHash){
    const expected = (declaredHash || (url && KNOWN_HASHES[url]) || "").toLowerCase();
    if(!expected) return;
    const got = await sha256hex(u8);
    if(got !== expected) throw new Error("integrity check failed for " + (url || "module") + " — refusing a tampered download");
  }

  // ── does the copy on this phone match the one that is PUBLISHED? ──────────
  //
  // THIS IS AN UPDATE MECHANISM, NOT A SECURITY BOUNDARY. Do not describe it as one. Refused bytes never
  // enter the cache (verifyIntegrity runs before cachePut, guarded by a test that bites), and on native an
  // attacker who can write this IndexedDB can already patch the APK. What this function is for is the
  // thing that was actually broken: a phone that installed v1 of a module kept v1 for ever, silently,
  // because every cache-hit path returned the cached bytes without ever looking at the catalogue's pin
  // again. Republishing at the same url was a provable no-op for existing installs — which collides with
  // the pilot rule "add, never repurpose" (reference/RELAY-COMPAT-AND-AUTOUPDATE.md:26), and stranded ten
  // of slice 2's languages on their first build.
  //
  // The pin therefore doubles as a VERSION IDENTITY: if the catalogue's sha256 is not the hash of the
  // bytes we hold, the publisher has shipped a different build and this copy is a previous version.
  //
  // Same "no pin means nothing to check" rule as verifyIntegrity, deliberately reusing the same
  // expression so the two can never drift apart. That rule is the common case, not the corner: nothing
  // in catalog.json except the study notes carries a sha256, and all 1,290 entries in
  // ebible-catalog.json are un-pinned. An un-pinned module must keep working exactly as it does now —
  // making those re-download, or fail, would be worse than the bug being fixed here.
  //
  // Cost, measured on the Oppo CPH2477 (Chrome 152 WebView, 2026-09-10, median of 5 after a warm-up):
  // 1.99 MB — the real study-notes module — hashes in 11.5 ms, and 19.94 MB (ten languages' worth, i.e.
  // all of slice 2 installed at once) in 78.2 ms. That is why this hashes the bytes on every cache hit
  // instead of persisting "the pin these bytes were verified against" and comparing pin to pin. The
  // cheaper shape was considered and rejected: it saves ~11.5 ms per module per launch, needs a new
  // persisted field, needs a migration rule for entries installed before it existed, and it cannot
  // notice a cached copy that has been corrupted rather than superseded. Not worth three new branches.
  async function cachedCopyIsCurrent(url, u8, declaredHash){
    const expected = (declaredHash || (url && KNOWN_HASHES[url]) || "").toLowerCase();
    if(!expected) return true;
    return (await sha256hex(u8)) === expected;
  }

  // The pins as PUBLISHED right now, url -> sha256, read from the catalogue rather than from anything
  // this phone wrote down at install time. "What's published" is the whole point: a pin recorded locally
  // is the OLD pin and could never detect its own replacement.
  //
  // Best-effort by design. Offline, or with the gateway down, getCatalog() resolves to { categories: [] }
  // and this returns {} — every installed module then has no pin, which is exactly today's behaviour:
  // load the cached copy. A phone with no signal must still open its Bible.
  //
  // ⚠ A moved pin reaches a phone ONE LAUNCH LATE, and so does a brand-new catalogue entry: sw.js:133
  // serves catalog.json cache-first with a background refresh, so the launch that republication happens
  // on still reads the previous catalogue and sees nothing to do. The launch after that updates. That is
  // accepted (measured on the device 2026-09-10) and is half of what "publishing a module" means today.
  async function publishedPins(){
    const out = {};
    try{
      const cat = await getCatalog();
      for(const c of (cat && cat.categories) || [])
        for(const it of (c.items || []))
          if(it && it.url && it.sha256) out[it.url] = String(it.sha256).toLowerCase();
    }catch(e){}
    return out;
  }

  // Fetch a module asset, trying the ON-DEVICE copy first.
  //
  // scripts/sync-web.sh puts the default Bible in www/modules/, and Capacitor serves it from the APK at
  // https://localhost/modules/engbsb.zip. But resolveAsset() rewrites EVERY relative module url to the public
  // gateway whenever IS_NATIVE, and both fetch sites did a single unconditional fetch of that rewritten url
  // with no fallback — so the 3 MB shipped inside the APK was never once read, and a phone opened with no
  // connection was told "You appear to be offline. Connect to the internet and your Bible will download
  // automatically." The comment above resolveAsset still claimed "the APK ships none", written before the
  // file was added and never revisited. Found by the UX audit, 2026-08-04.
  //
  // Local first, gateway second. The cache key stays the ORIGINAL relative url either way, so a hit remains
  // host-independent — that part was already right.
  function assetCandidates(u){
    const remote = resolveAsset(u);
    return remote === u ? [u] : [u, remote];
  }
  // Bound the CONNECTION, not the download. The timer is cleared the moment fetch() resolves — i.e. when the
  // response headers arrive — so a genuinely slow 3 MB body over a thin pipe is never cut off, while a
  // black-holed host fails in seconds instead of hanging for ever. Previously neither site had any timeout,
  // and a hung first download also disabled the `online` self-heal, which is gated on !loadingFlag.
  const ASSET_CONNECT_MS = 15000;
  async function fetchAsset(u){
    const AC = (typeof AbortController !== "undefined") ? AbortController : null;
    let last = null;
    for(const cand of assetCandidates(u)){
      const ac = AC ? new AC() : null;
      const t = ac ? setTimeout(() => { try{ ac.abort(); }catch(e){} }, ASSET_CONNECT_MS) : null;
      try{
        const res = await fetch(cand, ac ? { signal: ac.signal } : undefined);
        if(res && res.ok) return res;
        last = new Error("HTTP " + (res && res.status));
      }catch(e){ last = e; }
      finally{ if(t) clearTimeout(t); }
    }
    throw last || new Error("could not fetch " + u);
  }

  async function fetchAndCacheModule(url, meta){
    const cached = await cacheGet(url);
    // A CACHE HIT IS ONLY GOOD IF IT IS THE PUBLISHED BUILD. This used to be an unconditional
    // `if(cached) return ...`, so once a module was on the phone the catalogue's pin was never consulted
    // again and a corrected module could not reach anyone who already had the old one. On a mismatch we
    // deliberately fall THROUGH to the download below, which verifies before it caches — so the stale
    // copy is replaced rather than merely refused, and a phone that is offline keeps reading (the fetch
    // throws and the caller reports it, exactly as it does for a first install with no signal).
    if(cached && await cachedCopyIsCurrent(url, cached, meta && meta.sha256))
      return loadModuleBytes(cached, url.split("/").pop(), meta);
    const res = await fetchAsset(url);
    // SECURITY-AUDIT-2026-06-24 L4: size cap (matches the JSON branch in installModule). The
    // ceiling is well above any real module: BSB ≈ 3 MB, the KJV+S MySword ≈ 9 MB. A compromised
    // mirror could otherwise stream gigabytes into RAM.
    const cl = Number(res.headers.get('content-length') || 0);
    if (cl > 50 * 1024 * 1024) throw new Error("module too large (" + cl + " bytes — refusing)");
    const u8 = new Uint8Array(await res.arrayBuffer());
    if (u8.byteLength > 50 * 1024 * 1024) throw new Error("module too large (" + u8.byteLength + " bytes — refusing)");
    await verifyIntegrity(url, u8, meta && meta.sha256);   // M3: verify before we cache/parse
    await cachePut(url, u8);
    return loadModuleBytes(u8, url.split("/").pop(), meta);
  }

  // generic cached asset fetch -> raw bytes (same IndexedDB cache + ASSET_BASE host as Bible modules).
  // Used by the on-demand Book library: native pulls from the gateway, then it reads offline from cache.
  async function loadAsset(url){
    const cached = await cacheGet(url);
    if(cached) return cached;
    const res = await fetch(resolveAsset(url));
    if(!res.ok) throw new Error("HTTP " + res.status);
    const u8 = new Uint8Array(await res.arrayBuffer());
    await cachePut(url, u8);
    return u8;
  }
  function assetCached(url){ return cacheGet(url).then(b => !!b).catch(() => false); }

  // bundled default Bible — auto-installed on first run so the app lands reading, not on an
  // empty "browse modules" wall. Removable/switchable like any other module afterwards.
  // Berean Standard Bible: a clear, accurate, modern, public-domain text — the warmest default
  // for a first read (Strong's still resolves via the lexicon + the AKJV+S module).
  const DEFAULT_MODULE = { id: "engbsb", abbr: "BSB",
    name: "Berean Standard Bible",
    kind: "bible", format: "USFM", category: "bibles", url: "modules/engbsb.zip" };
  // the full Strong's lexicon (14,197 entries) is auto-installed on first run too, so every Strong's
  // number resolves to a full definition (not just the tiny built-in fallback set).
  const DEFAULT_LEXICON = { id: "strongs", abbr: "Strong's", name: "Strong's Greek & Hebrew Dictionary",
    kind: "dict", format: "JSON", category: "dictionaries", url: "modules/strongs-dict.json" };

  // ── catalog + installed-module registry (download-once, MySword style) ──
  const INSTALLED_KEY = "trinityone.installed";   // localStorage map: url -> meta
  const installing = new Set();              // urls currently downloading
  let catalogPromise = null;

  function getInstalled(){ try{ return JSON.parse(localStorage.getItem(INSTALLED_KEY) || "{}"); }catch(e){ return {}; } }
  function setInstalled(map){ try{ localStorage.setItem(INSTALLED_KEY, JSON.stringify(map)); }catch(e){} }
  function catOf(item){ return item.category || (item.kind === "dict" ? "dictionaries" : item.kind === "comment" ? "commentaries" : item.kind === "devotional" ? "devotionals" : "bibles"); }
  // A RECORD MUST NAME THE MODULE THE ENGINE REGISTERED, NOT THE ONE THE CATALOGUE ASKED FOR.
  // addSource/addCommentary/addDict have always deduped a colliding name (NT -> NT2), and the record kept
  // the catalogue's regardless, so two modules sharing one catalogue abbr produced two records saying the
  // same thing and one of them named a module that is not there.
  //
  // It is not a corner case: 260 of the 1,290 entries in ebible-catalog.json carry abbr "NT" (9 "NTPO",
  // 7 "BL"), and two minority-language New Testaments is the ordinary case for this product's first
  // audience. Three things broke, all measured: the Library disabled Remove on BOTH rows whenever either
  // was the Bible being read (`r.abbr === active`); removing one ran `delete modules["NT"]` and evicted the
  // one the member KEPT; and the reader's Translations sheet, which passes the REGISTERED abbr, matched no
  // record at all, so it deleted nothing, freed nothing and said "Removed NT2".
  //
  // The installed map is what every screen lists and what removal keys off, so there is one identity here
  // now, not two — and ONE mechanism writes it. This records what it was given; noteLoadedFrom() corrects it
  // to what the engine actually registered, on the same tick at install time and again on every launch for a
  // record an older build wrote. A second correction here, from a `registered` parameter, was measured to be
  // unfalsifiable: sabotaging it changed no test, because the call right after it put the record right.
  function recordInstalled(item){
    const m = getInstalled();
    m[item.url] = { url: item.url, id: item.id, abbr: item.abbr, name: item.name, kind: item.kind, format: item.format, category: catOf(item) };
    setInstalled(m);
  }
  // WHERE EACH LOADED MODULE CAME FROM — registered abbr -> url, in memory only, rebuilt on every launch
  // because it is only ever true of modules that ARE loaded. That is exactly what makes it worth keeping:
  // a record whose module failed to load has no entry here, so it cannot be mistaken for the active Bible
  // and have its Remove disabled for ever over bytes nobody can then reclaim.
  // Keyed by CATEGORY AND NAME, because a name is only unique inside its own store: a Bible and a
  // commentary may both be "KJV", and one map keyed by name alone would have the second one loaded
  // overwrite the first's url — which is the same defect this branch is fixing everywhere else.
  const urlOf = {};
  const urlKey = (cat, abbr) => (cat || "bibles") + "|" + abbr;
  function noteLoadedFrom(url, abbr, cat){ if(!url || !abbr) return; urlOf[urlKey(cat, abbr)] = url; noteRegisteredAbbr(url, abbr); }
  // Repair one record in place when the engine turns out to have registered a different name — an older
  // build's record, or a collision that only appears once the second module is installed.
  function noteRegisteredAbbr(url, abbr){
    if(!url || !abbr) return;
    const m = getInstalled();
    if(!m[url] || m[url].abbr === abbr) return;
    m[url].abbr = abbr;
    setInstalled(m);
  }
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
      let loaded = null;
      if((item.format || "").toUpperCase() === "JSON"){
        let bytes = await cacheGet(item.url);
        // A THIRD CACHE-HIT SITE, not named in the brief and the same defect as the other two: a cached
        // lexicon was handed straight to loadDictJSON without the pin being looked at again, so a
        // republished dictionary could not reach a phone that had the old one either. Dropping the
        // reference re-enters the download branch below, which verifies before it caches.
        if(bytes && !(await cachedCopyIsCurrent(item.url, bytes, item.sha256))) bytes = null;
        if(!bytes){
          const res = await fetchAsset(item.url);   // local-first, then the gateway — see fetchAsset
          // SECURITY-AUDIT-2026-06-24 L4: size cap before arrayBuffer + JSON.parse. A compromised /
          // un-pinned host could otherwise serve a multi-GB JSON and OOM the device. 50 MB is well above
          // any real lexicon today (BDB ≈ 2 MB, Abbott-Smith ≈ 4 MB, Strong's ≈ 4 MB).
          const cl = Number(res.headers.get('content-length') || 0);
          if (cl > 50 * 1024 * 1024) throw new Error("module too large (" + cl + " bytes — refusing)");
          bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("module too large (" + bytes.byteLength + " bytes — refusing)");
          await verifyIntegrity(item.url, bytes, item.sha256); await cachePut(item.url, bytes);
        }   // M3: verify before cache/parse
        loaded = { kind: "dict", abbr: loadDictJSON(JSON.parse(new TextDecoder().decode(bytes)), item.abbr) };
      }else{
        // FORWARD THE CATALOGUE'S PIN. `verifyIntegrity(url, u8, meta && meta.sha256)` is the only thing
        // standing between a compromised gateway or mirror and a module whose HTML goes into the reader
        // through dangerouslySetInnerHTML — and until 2026-09-10 this line did not pass `item.sha256` at
        // all. The JSON branch above always has; this branch, which is every Bible, every USFM zip and
        // every commentary, silently dropped it, so `expected` fell back to KNOWN_HASHES and only the two
        // bundled defaults were ever checked. Proved in headless Chromium: the study-notes entry with its
        // pin replaced by zeros installed anyway. It went unnoticed because no catalogue entry carried a
        // `sha256` until that day — the field was honoured on a path nothing used.
        //
        // An entry WITHOUT a pin must still install: verifyIntegrity treats a falsy declaredHash as "no
        // pin here" and returns, so `undefined` behaves exactly as before. Every entry in catalog.json
        // and all 1,290 in ebible-catalog.json are un-pinned, so that is not a corner case, it is the
        // common one. applyMeta() reads only abbr/name/category, so the extra key is inert downstream.
        loaded = await fetchAndCacheModule(item.url, { abbr: item.abbr, name: item.name, category: catOf(item), sha256: item.sha256 });
      }
      recordInstalled(item);
      noteLoadedFrom(item.url, loaded && loaded.abbr, catOf(item));
      return loaded || true;   // {kind:'bible',abbr} for a translation (the real registered abbr) — lets callers switch to it
    }catch(err){ console.error(err); window.Bible._error = "Couldn't install " + (item.name || item.url) + " — " + err.message; throw err; }
    finally{ installing.delete(item.url); notify(); }
  }

  // re-load everything previously installed (boot, before autoLoad)
  async function restoreInstalled(){
    const m = getInstalled();
    // THE COLD-BOOT PATH, which until 2026-09-10 verified nothing at all: it read the cached bytes and
    // handed them to loadModuleBytes on every launch, so a phone that installed v1 of a module re-loaded
    // v1 for ever no matter what the catalogue said. This is the worse of the two named sites, because it
    // runs unattended on every single launch rather than only when somebody taps Install.
    //
    // The pins come from the CATALOGUE, not from the installed map, so what is compared is the published
    // build against the copy on disk. Un-pinned modules get {} here and behave exactly as before. One
    // small await is added to boot; in the normal case it is a service-worker cache read, and on a
    // first-ever launch this loop is empty because nothing is installed yet.
    const pins = Object.keys(m).length ? await publishedPins() : {};
    for(const url of Object.keys(m)){
      const meta = m[url];
      try{
        const bytes = await cacheGet(url);
        if(!bytes) continue;  // cache cleared — user can re-download
        if(!(await cachedCopyIsCurrent(url, bytes, pins[url]))){
          // The catalogue pins a different build: this module was republished after the phone installed
          // it. Re-install through the ordinary path — installModule re-downloads, verifies before it
          // caches, and loads the result — so there is one download-and-verify implementation, not two.
          //
          // If that fails we fall through and load the copy we already have, with a warning. That is the
          // deliberate choice for an UPDATE mechanism: a member on a thin pipe or no pipe at all keeps
          // reading the version they have instead of losing the module until they next get signal. It
          // would be the wrong choice for a security boundary, which this is not.
          try{
            await installModule({ url, id: meta.id, abbr: meta.abbr, name: meta.name, kind: meta.kind,
                                  format: meta.format, category: meta.category, sha256: pins[url] });
            continue;
          }catch(e){
            // installModule sets window.Bible._error ("Couldn't install …") on its way out, which the UI
            // shows. That message is wrong here: the module IS installed and about to load, it just could
            // not be UPDATED. Clear it rather than tell a member their module failed.
            console.warn("a republished module could not be fetched; reading the cached copy", url, e);
            try{ window.Bible._error = null; }catch(e2){}
          }
        }
        // WHAT THE ENGINE REGISTERS IS WHAT THE RECORD MUST SAY. A record written by a build before
        // 2026-09-11 carries the CATALOGUE abbr, and two modules sharing one (260 entries in
        // ebible-catalog.json are "NT") then have two records naming one module — the Library disables
        // Remove on both, and removing either evicts the wrong one from the reader. The registered name is
        // only knowable once the module is loaded, which is here, so the repair happens on the next launch
        // and costs a localStorage write only when the two actually differ.
        if((meta.format || "").toUpperCase() === "JSON") {
          const raw = bytes, u = url;
          _pendingDicts.push({ abbr: meta.abbr, url: u, run: () => noteLoadedFrom(u, loadDictJSON(JSON.parse(new TextDecoder().decode(raw)), meta.abbr), "dictionaries") });
        } else {
          const r = await loadModuleBytes(bytes, url.split("/").pop(), { abbr: meta.abbr, name: meta.name, category: meta.category });
          noteLoadedFrom(url, r && r.abbr, catOf(meta));
        }
      }catch(e){ console.error("restore failed for", url, e); }
    }
    // parse any deferred lexicon dicts during idle — ready before the reader's tapped, but not blocking boot
    if(_pendingDicts.length){ if(typeof requestIdleCallback === 'function') requestIdleCallback(_ensureDicts, { timeout: 5000 }); else setTimeout(_ensureDicts, 1500); }
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
      try{
        const u8 = new Uint8Array(await f.arrayBuffer());
        const r = await loadModuleBytes(u8, f.name);
        // persist an imported module so it survives a restart — the shared-Bible / fully-offline case
        // (a module handed over by Quick Share must stick, not vanish when the app reopens).
        if(r && r.abbr){
          const url = "imported/" + f.name;
          await cachePut(url, u8);
          recordInstalled({ url, id: r.abbr, abbr: r.abbr, name: (modules[r.abbr] && modules[r.abbr].name) || r.abbr, kind: r.kind || "bible", category: r.kind === "dict" ? "dictionaries" : r.kind === "comment" ? "commentaries" : "bibles" });
          noteLoadedFrom(url, r.abbr, r.kind === "dict" ? "dictionaries" : r.kind === "comment" ? "commentaries" : "bibles");
        }
      }
      catch(err){ console.error(err); window.Bible._error = err.message; }
      finally{ loadingFlag = false; notify(); }
    });
    document.body.appendChild(fileInput);
    return fileInput;
  }
  function pickFile(){ ensureInput().click(); }
  // export an installed module's raw cached bytes for peer-to-peer sharing (Quick Share / Bluetooth).
  async function exportModule(url){
    const bytes = await cacheGet(url);
    if(!bytes || !bytes.length) return null;
    return { bytes, filename: (String(url).split("/").pop() || "bible.module") };
  }

  // REMOVE AN INSTALLED MODULE OF ANY CATEGORY — a Bible, a commentary, a dictionary or lexicon — and
  // actually give the space back. Takes the module's url, or the abbr it was recorded under.
  //
  // WHAT WAS WRONG. The first line used to be `if(!modules[abbr] || abbr === active) return false;`, and
  // `modules` holds BIBLES ONLY: a commentary lives in `commentaries`, a dictionary in `dicts`. So every
  // non-Bible module on the Library's Installed tier offered a Remove that returned false at the first
  // line and freed nothing — the member could download a 25 MB commentary and never get the space back.
  // That matters most where it is least visible: the first audience for this app is phones with very
  // little storage on thin, expensive connections.
  //
  // THREE THINGS HAVE TO HAPPEN or the removal is not real, and they happen IN THIS ORDER:
  //   1. the cached bytes go (IndexedDB "bible-modules" — the only place a module's megabytes live);
  //   2. the installed map forgets it, so it stops being listed and restoreInstalled stops reloading it;
  //   3. the loaded copy leaves memory, so the reader / lexicon / notes panel stops consulting it.
  // The cache goes FIRST and is proved gone with a read-back. Forgetting the record first and failing to
  // delete afterwards would orphan those megabytes for ever: nothing would list the module, so nothing
  // could ever offer to remove it again. Failing at step 1 returns false, and the app says so rather than
  // claiming a removal that did not happen.
  //
  // TWO REFUSALS, both returning false so the caller reports honestly:
  //   · the ACTIVE Bible — you would have nothing to read (unchanged, and deliberately NOT widened to
  //     other categories: a commentary open on screen is not a reason to keep it on the phone for ever.
  //     CommentaryPanel re-reads getCommentary() through Bible.subscribe(), so it empties instead);
  //   · a module whose download is STILL RUNNING — installModule would recordInstalled() and re-cache it
  //     the moment it finished, putting back exactly what was just removed.
  // ONE NAME IS NOT ENOUGH TO NAME A MODULE — a CATEGORY AND a name are. addSource, addCommentary and
  // addDict each dedupe inside their OWN store, which is deliberate and right: a commentary called "KJV"
  // beside the KJV Bible is how a member reads "notes on the KJV", and forcing one global namespace would
  // rename modules that are already on phones and make a name depend on install order across categories.
  // So the fix is to stop pretending the name is global. Everything that maps a name back to a module is
  // scoped by category here, and an ambiguous name is REFUSED rather than guessed at.
  //
  // FOUND BY AUDIT, 2026-09-12, and it pre-dates this branch: this lookup scanned the whole installed map,
  // so a member who imported a MySword commentary whose own Details table calls it "KJV" (ordinary — the
  // abbr comes from the module, and Import is offered in the Share sheet) and then tapped Remove beside KJV
  // in the reader's Translations sheet had the app delete THE COMMENTARY: 25 MB, record and bytes, no undo,
  // while the Bible they asked to remove stayed on the phone. The Translations sheet asks for a Bible, so
  // it now says so (app.jsx passes "bibles"), and a caller that names no category gets a refusal instead of
  // whichever record happened to be written first.
  async function removeModule(id, category){
    const inst = getInstalled();
    // Identity is the URL: it keys both the installed map and the byte cache. A name is accepted too,
    // because that is what the reader's translation sheet has to hand (ctx.removeTranslation).
    let url = inst[id] ? id : null;
    if(!url){
      const named = Object.keys(inst).filter(u => inst[u].abbr === id && (!category || catOf(inst[u]) === category));
      if(named.length > 1){
        // TWO RECORDS, ONE NAME, ONE CATEGORY — and this is not hypothetical. `addSource`'s dedupe is
        // `while(modules[abbr] && modules[abbr].name !== src.name)`, so an identical NAME skips the rename
        // and both records are written under one abbr. ebible-catalog.json ships two such groups covering
        // FIVE translations: "NT | Nuevo Testamento Guaraní Pe" (2 urls) and "NT | Mushog Testamento" (3) —
        // minority-language New Testaments, which is this product's first audience.
        //
        // The reader's Translations sheet has only a name to give us (`versions()` carries abbr/name/kind and
        // no url), so refusing outright made Remove permanently dead for those five: "Couldn't remove NT",
        // for ever, with the megabytes unreclaimable. Refusing was still RIGHT compared with what preceded
        // it — guessing deleted the wrong module's bytes — but it is not the end of the job.
        //
        // So: prefer the url the LOADED module of that name came from. That is the copy the member is
        // actually looking at in the reader, it is recorded by `noteLoadedFrom` at load time rather than
        // inferred here, and it must still be one of the candidate records. If we cannot establish it we
        // refuse exactly as before — a guess is never better than a refusal on a destructive action.
        const loadedFrom = category ? urlOf[urlKey(category, id)] : null;
        if(!loadedFrom || !named.includes(loadedFrom)) return false;
        url = loadedFrom;
      } else url = named[0] || null;
    }
    const meta = url ? inst[url] : null;
    const abbr = (meta && meta.abbr) || id;
    const cat = meta ? catOf(meta) : (category
      || (modules[abbr] ? "bibles" : commentaries[abbr] ? "commentaries" : hasDict(abbr) ? "dictionaries" : ""));
    // nothing of this name is installed or loaded — there is nothing here to remove
    if(!url && !cat) return false;
    // THE ACTIVE BIBLE IS REFUSED — you would have nothing to read — AND NOTHING ELSE IS. This compared
    // any record's name against the active BIBLE's name, so a commentary or dictionary that happened to
    // share it could not be removed at all: 27 MB stuck behind "Switch to another Bible before removing
    // this one", with nothing to switch to if that Bible is the member's only one.
    //
    // It asks by URL where it can. `urlOf` is what the ACTIVE module was actually loaded from, so a record
    // whose module never loaded (bytes evicted, or corrupt enough to throw) can no longer borrow the active
    // module's name and make its own megabytes unreclaimable. The name comparison stays as the fallback for
    // a module loaded from no url at all — a file import that could not be written down.
    //
    // ⚠ THE TERNARY THAT USED TO BE HERE PICKED ITS BRANCH ON THE WRONG THING — on whether the ACTIVE module
    // had a known url, not on whether THIS CALL had resolved one. With `activeFrom` known and `url` null (a
    // loaded Bible whose record was never written, because setInstalled swallowed a failure) neither side of
    // the comparison fired, the refusal was skipped, and `loadedHere = !url` was then true — so
    // `delete modules[active]` ran with `active` still naming it: a blank reader over a dangling pointer.
    // Compare urls only when BOTH are known; otherwise fall back to the name, which is what the line did
    // unconditionally before urls existed here.
    const activeFrom = active ? urlOf[urlKey("bibles", active)] : null;
    const isTheActiveBible = (url && activeFrom) ? (url === activeFrom) : (abbr === active);
    if(cat === "bibles" && active && isTheActiveBible) return false;
    if(url && installing.has(url)) return false;
    if(url){
      await cacheDelete(url);
      // PROVE THE SPACE CAME BACK, and refuse when it cannot be proved. cacheDelete swallows its own
      // errors, so the call having been made says nothing; cacheHas() answers the question and THROWS
      // rather than saying "no" when the store cannot be opened — which is the case where the delete was
      // a silent no-op, and where believing it would forget the record over bytes nobody can reach again.
      let stillThere = true;
      try{ stillThere = await cacheHas(url); }catch(e){ console.warn("could not confirm the module was deleted", url, e); }
      if(stillThere) return false;
      const m = getInstalled(); delete m[url]; setInstalled(m);
    }
    // With no `url` there is no record and no bytes we can name: the module was loaded into memory and
    // never written down (localStorage full or blocked, so setInstalled's catch swallowed it). Dropping it
    // from memory is then the whole of what "removed" can mean here — it leaves the reader and the list —
    // and any bytes cached under a url we cannot learn stay where they are. The one shipped path that used
    // to land here, `?module=<url>`, now records what it caches (see autoLoad).
    //
    // AND ONLY IF THE LOADED MODULE OF THAT NAME IS THIS ONE. A record whose module never loaded keeps
    // whatever name was written at install time, so a stale "NT" record pointed `delete modules["NT"]` at
    // the OTHER New Testament — the one the member is reading — and evicted it from the reader while the
    // bytes being freed were somebody else's. `urlOf` says where the loaded module of that name really came
    // from; when it came from somewhere else, nothing of ours is in memory and there is nothing to drop.
    const here = urlOf[urlKey(cat, abbr)];
    const loadedHere = !url || !here || here === url;
    if(loadedHere){
      if(cat === "commentaries") delete commentaries[abbr];
      else if(cat === "dictionaries") removeDict(abbr, url);
      else if(modules[abbr]){ delete modules[abbr]; order = order.filter(a => a !== abbr); }
      if(here === url) delete urlOf[urlKey(cat, abbr)];
    }
    notify();
    return true;
  }

  // ── reading helpers over the active module ──
  function src(version){ return modules[version || active] || null; }
  function versions(){ return order.map(a => ({ abbr: a, name: modules[a].name, kind: modules[a].kind })); }
  function books(version){ const s = src(version); return s ? s.books.slice() : []; }
  function maxChapter(b, version){ const s = src(version); return s ? (s.maxChap[b] || 1) : 1; }
  function getVerses(b, c, version){ const s = src(version); return s ? s.getVerses(b, c) : []; }
  // commentary for a passage: installed commentary modules + footnotes baked into the active Bible
  function getCommentary(b, c, version){
    const out = [];
    // `license` rides along with the block, not fetched separately by the panel: the notice has to appear
    // WHEREVER these words appear, and one object per source is the only shape in which the panel cannot
    // draw a module's words without its credit beside them.
    for(const abbr in commentaries){ const s = commentaries[abbr]; let rows = []; try { rows = s.getComment(b, c); } catch(e){} if(rows && rows.length) out.push({ abbr, name: s.name, kind: "module", license: s.license || "", rows }); }
    const s = src(version);
    if(s && s.footnotes){ let fn = []; try { fn = s.footnotes(b, c); } catch(e){} if(fn.length) out.push({ abbr: s.abbr, name: s.name + " — footnotes", kind: "footnotes", rows: fn.map(f => ({ v: f.v, vTo: f.v, html: f.notes.map(t => "<p>" + t + "</p>").join("") })) }); }
    return out;
  }
  function commentaryList(){ return Object.keys(commentaries).map(a => ({ abbr: a, name: commentaries[a].name })); }

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
  function search(term, cap, version){
    const s = src(version); if(!s || !term) return [];
    cap = cap || 250;
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    let rows;
    if(s.search){
      rows = s.search(re, term, cap);                 // fast path (SQLite LIKE + refine)
    }else{
      rows = [];                                       // generic scan (USFM, in-memory)
      outer: for(const b of s.books){
        const mc = s.maxChap[b];
        for(let c = 1; c <= mc; c++){
          const vs = s.plain ? s.plain(b, c) : s.getVerses(b, c);
          for(const row of vs){
            if(re.test(row.text)){ rows.push({ book: b, chap: c, verse: row.v, text: row.text }); if(rows.length >= cap) break outer; }
          }
        }
      }
    }
    return rows.map(r => ({ book: r.book, chap: r.chap, verse: r.verse, ref: bookName(r.book) + " " + r.chap + ":" + r.verse, text: r.text }));
  }

  // Free-text search over installed dictionary/lexicon DEFINITIONS (distinct from search(), which scans
  // verse text). Walks every loaded dict + the built-in lexicon, matching the query against each entry's
  // headword (id/topic, lemma, transliteration, short gloss) and its body. Returns lex()-shaped entries,
  // best matches first (headword hits above body hits, then by frequency), tag-stripped, capped.
  function searchDict(query, cap){
    const q = String(query || "").trim().toLowerCase();
    if(q.length < 2) return [];
    _ensureDicts();
    _ensureFullLexicon();   // searching definitions wants the full dictionary too (see lex())
    cap = cap || 60;
    const FIELDS = ['lemma','translit','pos','short','gloss','def','deriv','kjv'];
    const seen = new Set(), hits = [];
    const scan = (map) => {
      for(const id in map){
        if(seen.has(id)) continue;                       // first dict wins, mirroring lex() precedence
        const e = map[id]; if(!e || typeof e !== "object") continue;
        const idl = id.toLowerCase();
        const head = (id + " " + (e.lemma||"") + " " + (e.translit||"") + " " + (e.short||"")).toLowerCase();
        const body = FIELDS.map(f => e[f] || "").join(" ").toLowerCase();
        let rank = 0;
        if(idl === q || head.split(/\s+/).includes(q)) rank = 3;   // exact headword
        else if(head.indexOf(q) !== -1) rank = 2;                  // partial headword
        else if(body.indexOf(q) !== -1) rank = 1;                 // in the definition body
        if(rank){ seen.add(id); hits.push({ id, e, rank }); }
      }
    };
    for(const d of dicts) scan(d.entries);
    scan(LEX);
    hits.sort((a, b) => b.rank - a.rank || (b.e.occ || 0) - (a.e.occ || 0));
    const strong = id => /^[GH]\d+$/i.test(id);
    return hits.slice(0, cap).map(({ id, e }) => ({
      id, lang: strong(id) ? (id[0].toUpperCase() === "H" ? "HEBREW" : "GREEK") : "",
      lemma: _stripTags(e.lemma || ""), translit: _stripTags(e.translit || ""), pos: _stripTags(e.pos || ""),
      short: _stripTags(e.short || ""), gloss: _stripTags(e.gloss || ""), def: _stripTags(e.def || ""),
      deriv: _stripTags(e.deriv || ""), kjv: _stripTags(e.kjv), occ: e.occ
    }));
  }

  // ── boot: restore installed modules, then optional ?module=<url> autoload ──
  async function autoLoad(){
    loadingFlag = true; notify();
    try{ await restoreInstalled(); }catch(e){ console.error(e); }
    const url = new URLSearchParams(location.search).get("module");
    // RECORD IT, as the file-import path already does. fetchAndCacheModule() writes the bytes into the same
    // IndexedDB every other module lives in, and this path used to leave no record of them: the module was
    // absent from the Library's Installed tier, so nothing could ever offer to remove it, and it was
    // reloaded from nowhere at the next launch — downloaded once, kept for ever, unreachable. A record
    // makes it an ordinary installed module: listed, restored, removable.
    //
    // AND IT DOES NOTHING AT ALL FOR A URL THAT IS ALREADY INSTALLED, which is new on this branch and
    // deliberate. restoreInstalled() has just loaded that module from the catalogue's metadata; fetching it
    // again here passes NO metadata, so the source is named from its own file, addSource sees a second name
    // for one abbr and registers a DUPLICATE (DEEP -> DEEP2) — and the record written over the top of the
    // good one would name the duplicate. The member would then have one module twice in the reader and a
    // record pointing at the copy, which Remove would strip of its bytes while the other copy read on.
    if(url && !isInstalled(url)){
      try{
        const r = await fetchAndCacheModule(url);
        if(r && r.abbr){
          recordInstalled({ url, id: r.abbr, abbr: r.abbr, name: (modules[r.abbr] && modules[r.abbr].name) || r.abbr,
                            kind: r.kind || "bible", category: r.kind === "dict" ? "dictionaries" : r.kind === "comment" ? "commentaries" : "bibles" });
          noteLoadedFrom(url, r.abbr, r.kind === "dict" ? "dictionaries" : r.kind === "comment" ? "commentaries" : "bibles");
        }
      }
      catch(err){ console.error(err); window.Bible._error = err.message; }
    }
    // NOTHING TO READ? INSTALL THE DEFAULT BIBLE. The condition is `order.length === 0` and NOTHING ELSE,
    // and the `&& !url` that used to be here was the bug.
    //
    // `order` holds BIBLES only (addSource is its one writer), so this asks exactly "does this phone have a
    // Bible loaded" — which is the question a member's empty reader is asking.
    //
    // ⚠ THE TWO GUARDS HAD DRIFTED APART AND BETWEEN THEM LEFT AN EMPTY READER. The `?module=` branch above
    // gates on the RECORD (`isInstalled(url)`); this one gated on the QUERY STRING. So for a module whose
    // record survived but whose BYTES did not, the first branch declined to re-download (a record exists)
    // and this one declined to self-heal (a url was asked for) — restoreInstalled hit `if(!bytes) continue;`
    // and the member landed on nothing, with no error. `cachePut` swallows its own failures, so installing
    // on a full phone produces exactly that state; so does an evicted store, or a module loadModuleBytes
    // throws on. Before the record was added to this path the link simply re-downloaded and the reader
    // worked. Found by audit 2026-09-12; it is the silent-blank-app class this codebase keeps paying for.
    //
    // It also fixes a second, older face of the same line: a FRESH phone opening `?module=<a dictionary>`
    // installs the dictionary and, because a dictionary never enters `order`, used to end up with no Bible
    // at all. Now it gets one.
    if(order.length === 0){
      try{ await installModule(DEFAULT_MODULE); }
      catch(err){ console.error(err); window.Bible._error = err.message; }
    }
    // NOTE: the full Strong's lexicon is deliberately NOT installed here any more — see _ensureFullLexicon().
    // It was 958 KB gzipped (~153s on 2G) of a first launch, before the member had asked for anything.
    loadingFlag = false; notify();
  }

  window.Bible = {
    BOOK_NAMES, bookName, bookAbbr, bookGroup, bookNum, parseRef,
    parseVerse, lex,
    loadModuleBytes, fetchAndCacheModule, loadAsset, assetCached, pickFile, exportModule,
    cacheKeys, getCatalog, getMirror, getVideos, installModule, removeModule, isInstalled, isInstalling,
    installedMap: getInstalled,
    subscribe(fn){ subs.add(fn); return () => subs.delete(fn); },
    get loaded(){ return order.length > 0; },
    get loading(){ return loadingFlag; },
    get activeVersion(){ return active; },
    // The url the ACTIVE Bible was loaded from, or null. A screen that asks "is this row the Bible being
    // read?" must not answer by comparing names: names are unique per category, not across the phone, and
    // a record written by an older build can carry a name no loaded module has.
    get activeUrl(){ return (active && urlOf[urlKey("bibles", active)]) || null; },
    setActive(v){ if(modules[v]){ active = v; notify(); } },
    versions, books, maxChapter, getVerses, getCommentary, commentaryList, bookMeta, defaultLoc, step, refLabel, refKey, search, searchDict,
    _error: null
  };

  // kick off autoload once the DOM + CDN libs are present
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoLoad);
  else autoLoad();

  // modules download on first run; if that first launch was offline, retry the moment we're back
  // online so the app self-heals into a readable state without a manual reload.
  if(typeof window !== "undefined") window.addEventListener("online", () => {
    if(order.length === 0 && !loadingFlag){ window.Bible._error = null; autoLoad(); }
  });
})();
