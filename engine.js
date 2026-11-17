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
    "Jude","Revelation",
    "Tobit","Judith","Additions to Esther","Wisdom of Solomon","Sirach","Baruch",
    "Letter of Jeremiah","Prayer of Azariah","Susanna","Bel and the Dragon",
    "1 Maccabees","2 Maccabees","1 Esdras","2 Esdras","Prayer of Manasseh",
    "Psalm 151","3 Maccabees","4 Maccabees"
  ];
  const BOOK_ABBR = [
    "Gen","Exo","Lev","Num","Deu","Jos","Jdg","Rut","1Sa","2Sa","1Ki","2Ki","1Ch","2Ch","Ezr","Neh",
    "Est","Job","Psa","Pro","Ecc","Sng","Isa","Jer","Lam","Ezk","Dan","Hos","Jol","Amo","Oba","Jon",
    "Mic","Nam","Hab","Zep","Hag","Zec","Mal","Mat","Mrk","Luk","Joh","Act","Rom","1Co","2Co","Gal",
    "Eph","Php","Col","1Th","2Th","1Ti","2Ti","Tit","Phm","Heb","Jas","1Pe","2Pe","1Jn","2Jn","3Jn","Jud","Rev",
    "Tob","Jdt","AddEst","Wis","Sir","Bar","LJe","PrAz","Sus","Bel","1Ma","2Ma","1Es","2Es","Man","Ps151","3Ma","4Ma"
  ];
  const bookName = n => BOOK_NAMES[n - 1] || ("Book " + n);
  const bookAbbr = n => BOOK_ABBR[n - 1] || ("B" + n);
  const bookGroup = n => (n <= 39 ? "ot" : n <= 66 ? "nt" : "ap");

  // name → book number, and "John 5" / "1 John 2:3" / "Psalms 23" → {book, chap, verse}
  const NAME_TO_NUM = {};
  BOOK_NAMES.forEach((nm, i) => { NAME_TO_NUM[nm.toLowerCase()] = i + 1; });
  NAME_TO_NUM["psalm"] = 19; NAME_TO_NUM["song of songs"] = 22;
  NAME_TO_NUM["ecclesiasticus"] = 71; NAME_TO_NUM["wisdom"] = 70;
  NAME_TO_NUM["1 maccabees"] = 77; NAME_TO_NUM["2 maccabees"] = 78;
  NAME_TO_NUM["1 esdras"] = 79; NAME_TO_NUM["2 esdras"] = 80;
  const bookNum = name => NAME_TO_NUM[String(name || "").trim().toLowerCase().replace(/\s+/g, " ")] || 0;
  function parseRef(str){
    // "John 3:16-21" -> verse 16 AND verseEnd 21. verseEnd is present only for a same-chapter range that really
    // runs forward; "John 3:16-4:2" (a range into the next chapter) and "John 3:16-16" carry none, so a caller
    // that has never heard of verseEnd sees exactly the object it always did.
    const m = String(str || "").match(/^\s*([1-3]?\s?[A-Za-z][A-Za-z ]*?)\s+(\d+)(?::(\d+)(?:\s*[-\u2013\u2014]\s*(\d+)(?![\d:]))?)?/);
    if(!m) return null;
    const book = bookNum(m[1]); if(!book) return null;
    const out = { book, chap: parseInt(m[2], 10), verse: m[3] ? parseInt(m[3], 10) : undefined };
    if(m[4] && parseInt(m[4], 10) > out.verse) out.verseEnd = parseInt(m[4], 10);
    return out;
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
    JUD:65,REV:66,
    TOB:67,JDT:68,ESG:69,WIS:70,SIR:71,BAR:72,LJE:73,S3Y:74,SUS:75,BEL:76,
    "1MA":77,"2MA":78,"1ES":79,"2ES":80,MAN:81,PS2:82,"3MA":83,"4MA":84
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

  // ── cross-references (openbible.info / Treasury of Scripture Knowledge) — a JSON module, like the lexicon ──
  // Each module's `map` is { "<book>.<chap>.<verse>": ["Display Ref", …] } in TrinityOne book numbering,
  // best-voted first. The display strings round-trip through parseRef(), so a caller navigates straight from
  // one with Bible.parseRef(ref) — no second OSIS mapping at read time.
  // The merge sentinel: getCrossRefs/crossrefLicense treat "all" as "every installed source". It is NOT a
  // real abbr — loadCrossrefsJSON below refuses to register a source under it, so a module that happens to
  // call itself "all" can never hide the merge option or shadow getCrossRefs(b,c,"all").
  const CROSSREF_ALL = "all";
  const crossrefs = {};   // abbr -> { name, license, map }
  function loadCrossrefsJSON(obj, abbr){
    let a = (obj && obj.meta && obj.meta.abbr) || abbr || "TSK";
    if(a === CROSSREF_ALL) a = a + "_";   // keep the sentinel out of the store (see CROSSREF_ALL)
    crossrefs[a] = { name: (obj && obj.meta && obj.meta.name) || a, license: (obj && obj.meta && obj.meta.license) || "", map: (obj && obj.refs) || {} };
    notify();
    return a;
  }
  // The installed cross-ref sources, for the reader's source picker — mirrors commentaryList().
  function crossrefList(){ return Object.keys(crossrefs).map(a => ({ abbr: a, name: crossrefs[a].name })); }
  // Every cross-reference for a chapter, keyed by verse number, merged across installed cross-ref modules.
  // Lazily installs the default set on first use (like the lexicon), so the reader tab works with no manual
  // module install; returns what is loaded now (empty until the install lands, then populated on next read).
  // `source` omitted or the "all" sentinel → merge every installed set (the original behaviour, kept so a
  // no-arg caller is unchanged and "all" is the explicit merge). A named, installed source → ONLY that set.
  // A named-but-absent source reads nothing: the app resolver falls back before it reaches here, but a stale
  // pick must never leak another source's references.
  function getCrossRefs(b, c, source){
    ensureCrossrefs();
    const out = {}, prefix = b + "." + c + ".";
    const names = (source == null || source === CROSSREF_ALL) ? Object.keys(crossrefs)
      : (Object.prototype.hasOwnProperty.call(crossrefs, source) ? [source] : []);
    for(const a of names){
      const map = crossrefs[a].map;
      for(const key in map){
        if(key.lastIndexOf(prefix, 0) !== 0) continue;
        const v = parseInt(key.slice(prefix.length), 10); if(!v) continue;
        const list = out[v] || (out[v] = []);
        for(const r of map[key]) if(list.indexOf(r) === -1) list.push(r);
      }
    }
    return out;
  }
  // The credit that must appear wherever these references are shown (CC BY obliges attribution).
  //   "all"      → EVERY contributing source's credit, de-duplicated (a merge shows each source's refs, so
  //                each source's attribution is owed — returning only the first would break CC BY);
  //   a source   → that source's own credit;
  //   no arg     → the first credit found (legacy callers, unchanged).
  function crossrefLicense(source){
    if(source === CROSSREF_ALL){
      const out = [];
      for(const a in crossrefs){ const l = crossrefs[a].license; if(l && out.indexOf(l) === -1) out.push(l); }
      return out.join(" · ");
    }
    if(source != null) return (crossrefs[source] && crossrefs[source].license) || "";
    for(const a in crossrefs) if(crossrefs[a].license) return crossrefs[a].license;
    return "";
  }

  // ── original-language text (STEPBible TAGNT Greek NT / TAHOT Hebrew OT) — a JSON module, installed on demand ──
  // Module shape (scripts/build-original.mjs): { meta:{abbr,name,license,kind:"original",lang:"greek"|"hebrew"},
  //   v:{ "<book>.<chap>.<verse>": [[form, translit, strongs, morph], …] } } — the SAME verse key as cross-references
  // and refKey. Never a default download: nothing here fetches; the Library installs it (kind "original"), and it is
  // filed under "dictionaries" like word definitions so it is listed and removable there. NOT a Strong's dictionary:
  // it never enters `dicts`, so lex()/searchDict() do not see it.
  const originals = {};   // abbr -> { name, license, lang, v }
  function loadOriginalJSON(obj, abbr){
    const m = (obj && obj.meta) || {};
    const a = m.abbr || abbr || "Original";
    originals[a] = { name: m.name || a, license: m.license || "", lang: m.lang || "", v: (obj && obj.v) || {} };
    notify();
    return a;
  }
  function removeOriginal(abbr){ delete originals[abbr]; }
  // Extended Strong's -> the plain number the lexicons key on: "G0976" -> "G976", "H7225G" -> "H7225".
  function _strongBase(s){ const m = /^([GH])0*(\d+)/.exec(String(s == null ? "" : s).trim().toUpperCase()); return m ? m[1] + m[2] : ""; }
  // Verse -> the original words of the first installed original module that has it (lang "greek"/"hebrew" narrows
  // it; omit for whichever answers): [{ w: form, t: transliteration, s: extended Strong's, m: morphology, g: gloss }], reading
  // order, or [] (nothing installed, or the verse is absent from that text). `strongs` ("G3056", "G3056G", "H7225")
  // keeps only the words with that number — the verse-plus-Strong's lookup.
  function getOriginal(b, c, v, lang, strongs){
    const key = b + "." + c + "." + v, want = strongs ? _strongBase(strongs) : "";
    for(const a in originals){
      const o = originals[a];
      if(lang && o.lang !== lang) continue;
      const list = o.v[key];
      if(!list) continue;
      const out = [];
      for(const x of list){ if(want && _strongBase(x[2]) !== want) continue; out.push({ w: x[0], t: x[1], s: x[2], m: x[3], g: x[4] || "" }); }
      return out;
    }
    return [];
  }
  // Which original-language texts are on this phone: [{abbr,name,lang,license}].
  function originalList(){ return Object.keys(originals).map(a => ({ abbr: a, name: originals[a].name, lang: originals[a].lang, license: originals[a].license })); }
  function hasOriginal(lang){ for(const a in originals) if(!lang || originals[a].lang === lang) return true; return false; }

  // ── word definitions (WordNet, filtered to the shipped Bibles' vocabulary) — a JSON module, like cross-refs ──
  // The Strong's lexicon only answers on TAGGED Bibles; this works on any English text (BSB, an imported
  // translation) because it looks a plain word up. Module shape (scripts/build-worddefs.mjs):
  //   { meta:{abbr,name,license,kind:"worddef"}, defs:{ head:[[pos,gloss],…] }, forms:{ inflected:head } }
  // It is catalogued under "dictionaries" so the Library lists (and can remove) it, but it is kind "worddef",
  // NOT "dict": it is never added to `dicts`, so Strong's lex()/searchDict() do not see it.
  const worddefs = {};   // abbr -> { name, license, defs, forms }
  // "idle" (never asked) | "loading" | "ready" | "failed" — what the Define sheet shows while it waits.
  let _worddefsState = "idle";
  function loadWorddefsJSON(obj, abbr){
    const a = (obj && obj.meta && obj.meta.abbr) || abbr || "WN";
    worddefs[a] = { name: (obj && obj.meta && obj.meta.name) || a, license: (obj && obj.meta && obj.meta.license) || "",
                    defs: (obj && obj.defs) || {}, forms: (obj && obj.forms) || {} };
    _worddefsState = "ready";
    notify();
    return a;
  }
  function removeWorddefs(abbr){ delete worddefs[abbr]; _worddefsRequested = false; _worddefsState = "idle"; }
  function worddefsLicense(){ for(const a in worddefs) if(worddefs[a].license) return worddefs[a].license; return ""; }
  function worddefsState(){ return Object.keys(worddefs).length ? "ready" : _worddefsState; }
  // Light fallback for a word the module has no form for: strip a common ending, restore a dropped e, undouble.
  function _wdStems(w){
    const out = [];
    const add = s => { if(s && s.length > 1 && s !== w && out.indexOf(s) === -1) out.push(s); };
    if(/ies$/.test(w)) add(w.slice(0, -3) + "y");
    if(/ied$/.test(w)) add(w.slice(0, -3) + "y");
    if(/(ches|shes|xes|zes|sses)$/.test(w)) add(w.slice(0, -2));
    if(/s$/.test(w) && !/ss$/.test(w)) add(w.slice(0, -1));
    for(const suf of ["ing", "ed", "er", "est"]){
      if(w.length > suf.length + 2 && w.slice(-suf.length) === suf){
        const stem = w.slice(0, -suf.length);
        add(stem); add(stem + "e");
        if(/([bdgklmnprt])\1$/.test(stem)) add(stem.slice(0, -1));
      }
    }
    if(/ily$/.test(w)) add(w.slice(0, -3) + "y");
    if(/ly$/.test(w)) add(w.slice(0, -2));
    return out;
  }
  // One word -> { word, head, senses:[{pos,gloss}], license } or null. `head` differs from `word` when the word was
  // an inflection ("loved" -> "love"); the sheet shows that. Lazily installs the module on first use.
  function getDefinition(word){
    ensureWorddefs();
    let w = String(word == null ? "" : word).toLowerCase().replace(/\u2019/g, "\x27").replace(/^[^a-z]+|[^a-z]+$/g, "");
    w = w.replace(/\x27s$/, "");
    if(!w) return null;
    // Webster (W1913) answers first when it is installed; WordNet (or any other) is the fallback for a word Webster lacks.
    const order = Object.keys(worddefs).sort((x, y) => (y === "W1913") - (x === "W1913"));
    for(const a of order){
      const d = worddefs[a];
      let head = d.forms[w] || (d.defs[w] ? w : null);
      if(!head){ const st = _wdStems(w); for(let i = 0; i < st.length; i++){ const h = d.forms[st[i]] || (d.defs[st[i]] ? st[i] : null); if(h){ head = h; break; } } }
      if(head && d.defs[head]) return { word: w, head, senses: d.defs[head].map(s => ({ pos: s[0], gloss: s[1] })), license: d.license, source: a,
        label: a === "WN" ? "WordNet" : a === "W1913" ? "Webster 1913" : d.name };
    }
    return null;
  }
  const _WD_STOP = new Set(("a about above after again against all also am an and any are as at be because been before being below between both but by " +
    "can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself " +
    "me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then " +
    "there these they this those through to too under until up upon us very was we were what when where which while who whom whose why will with would you your yours yourself yourselves " +
    "thou thee thy thine ye hath hast hadst doth dost didst art wast wert shalt wilt canst shouldest wouldest couldest unto yea nay lo behold shall may might must let yet else whether " +
    "ever every even just now one two three four five six seven eight nine ten amid among").split(/\s+/));
  // A verse's plain text -> the definable words in order of appearance (no stopwords, no 1-2 letter words, one per
  // headword). Pure apart from the dictionary lookup, which is why it is the thing the tests lift.
  function defineText(text){
    const plain = String(text == null ? "" : text).replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\b[GH]\d{1,5}\b/g, " ");
    const toks = plain.match(/[A-Za-z]+(?:[\x27\u2019][A-Za-z]+)?/g) || [];
    const out = [], seenWord = new Set(), seenHead = new Set();
    for(const t of toks){
      const w = t.toLowerCase().replace(/\u2019/g, "\x27").replace(/\x27s$/, "");
      if(w.length < 3 || _WD_STOP.has(w) || seenWord.has(w)) continue;
      seenWord.add(w);
      const d = getDefinition(w);
      if(!d || seenHead.has(d.head)) continue;
      seenHead.add(d.head); out.push(d);
    }
    return out;
  }
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
    s = s.replace(/<CM>\s*/g, '<span class="pp"></span>').replace(/<CL>\s*/g, "<br>").replace(/¶\s*/g, '<span class="pp"></span>');
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
  // A HEADING'S MARKUP CLOSES INSIDE THE HEADING. inlineUSFM turns `\nd` into `<span class="nd">` and `\nd*` into
  // `</span>`; a heading line with an opener and no closer (`\s1 The \nd Lord`) used to leave the heading's
  // own `</span>` closing the inner span, so the heading span stayed open over the verse that followed — in
  // the reader it styled the verse as a heading, and usfmText dropped the verse's words with the heading
  // (Psalm 2:1 lost "Why do the nations rage,"). Walk the fragment's span/i tags: drop a closer with no
  // opener, close what is left open, innermost first. Used ONLY for heading-like lines (\d, \s, \ms, \mr,
  // \r): a character style in verse text may legitimately run across poetry lines.
  function _balancedInline(html){
    const out = [], stack = [];
    let last = 0, t;
    const re = /<(\/?)(span|i)\b[^>]*>/g;
    while((t = re.exec(html))){
      out.push(html.slice(last, t.index)); last = t.index + t[0].length;
      if(!t[1]){ stack.push(t[2]); out.push(t[0]); }
      else if(stack.length && stack[stack.length - 1] === t[2]){ stack.pop(); out.push(t[0]); }
      // else: a closer with nothing open inside this heading — dropped
    }
    out.push(html.slice(last));
    while(stack.length) out.push("</" + stack.pop() + ">");
    return out.join("");
  }
  // The 22 letter names, in the spellings English Bibles print over Psalm 119's stanzas (see the \d rule below).
  // Every spelling the shipped modules use is here (surveyed 2026-10-01: engbsb's \qa and eng-web's \d —
  // including eng-web's KAPF and TZADHE), and a stanza may carry two joined by "and" ("SIN AND SHIN").
  const _HEB = "aleph|alef|beth|bet|gimel|gimmel|daleth|dalet|he|hey|vav|waw|zayin|zain|heth|het|cheth|chet|teth|tet|yodh|yod|jod|kaph|kapf|kaf|caph|lamedh|lamed|mem|nun|samekh|samech|ayin|pe|peh|tsadhe|tsade|tsaddi|tzadhe|tzaddi|tzade|qoph|qof|koph|resh|shin|sin|tav|taw";
  const HEBREW_LETTER = new RegExp("^(?:" + _HEB + ")(?:\\s+(?:and|&)\\s+(?:" + _HEB + "))?\\.?$", "i");
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
    // A PSALM TITLE AND ITS FIRST VERSE ON ONE LINE — `\d A Psalm of David. \v 1 Lord, how…` or `\d \v 1 For the
    // director of music…`. The \d branch below took the whole rest of the line as the title, so verse 1 was
    // swallowed into it: its words landed at the start of verse 2, or (with no other \v) the chapter had no
    // verses at all. Split such a line at its verse marker, so the title stays the title (and, as scripture,
    // in verse 1's text — owner, 2026-10-01) and verse 1 keeps its words. Only \d lines: no shipped module has
    // a \v mid-line anywhere else (surveyed 2026-10-01), and changing that is a separate question.
    const lines = [];
    for(const line of text.split(/\r?\n/)){
      const at = /^\\d\b/.test(line) ? line.search(/\\v\s/) : -1;
      if(at > 0){ lines.push(line.slice(0, at)); lines.push(line.slice(at)); } else lines.push(line);
    }
    for(const line of lines){
      let m;
      if((m = line.match(/^\\c\s+(\d+)/))){ flush(); chap = +m[1]; pending = ""; continue; }
      if(chap == null) continue;
      if((m = line.match(/^\\v\s+(\S+) ?([\s\S]*)$/))){ flush(); vnum = m[1]; vbuf = pending + (m[2]||""); pending = ""; continue; }
      // \d — a Psalm title — IS scripture (owner, 2026-10-01): it renders like a heading, but carries a second
      // class so usfmText keeps its words in the verse text. \s, \ms, \mr are editorial headings and are not.
      // The trailing space is a word break for `text` when verse 1 follows on the same line (`\d Title \v 1 words`);
      // after a block-level span it renders as nothing.
      // …EXCEPT PSALM 119's ACROSTIC LETTERS, which the World English Bible marks \d ("\d BETH") — a label, like
      // the \qa the BSB uses for the same letters (below), not a title: as \d it was glued into the verse before
      // it ("…forsake me. BETH") and 119:1 began "ALEPH". The rule is narrow on purpose: Psalm 119, and a line
      // whose whole content is one of the 22 letter names. A \d anywhere else stays scripture — Habakkuk 3:19
      // ends with one ("For the Chief Musician…"), which is why "a \d after verse 1" is not the rule.
      if((m = line.match(/^\\d\b ?([\s\S]*)$/)) && code === "PSA" && chap === 119 && HEBREW_LETTER.test(stripTags(inlineUSFM(m[1]||"")).trim())){
        add('<br><span class="sec qa">' + _balancedInline(inlineUSFM(m[1]||"")) + "</span>"); continue;
      }
      if((m = line.match(/^\\d\b ?([\s\S]*)$/))){ if((m[1]||"").trim()) add('<br><span class="sec d">' + _balancedInline(inlineUSFM(m[1]||"")) + "</span> "); continue; }
      if((m = line.match(/^\\(?:s\d?|ms\d?|mr)\b ?([\s\S]*)$/))){ add('<br><span class="sec">' + _balancedInline(inlineUSFM(m[1]||"")) + "</span>"); continue; }
      if((m = line.match(/^\\r\b ?([\s\S]*)$/))){ add('<br><span class="parref">' + _balancedInline(inlineUSFM(m[1]||"")) + "</span>"); continue; }
      // \sp — a SPEAKER LABEL ("Beloved", "Lover" in the Song of Songs): an editorial label, not scripture. It
      // fell to the catch-all below and was read into the verse as a word. Rendered like a heading (the reader's
      // .sec rule), and dropped from `text` by usfmText with the headings.
      if((m = line.match(/^\\sp\b ?([\s\S]*)$/))){ add('<br><span class="sec sp">' + _balancedInline(inlineUSFM(m[1]||"")) + "</span>"); continue; }
      // \qa — an ACROSTIC LETTER (Psalm 119's ALEPH, BETH…): a label, like \sp. It fell to the catch-all and was
      // glued onto the end of the verse before it ("…do not utterly forsake me. BETH"). Shown as a heading,
      // dropped from `text` with the headings.
      if((m = line.match(/^\\qa\b ?([\s\S]*)$/))){ add('<br><span class="sec qa">' + _balancedInline(inlineUSFM(m[1]||"")) + "</span>"); continue; }
      if((m = line.match(/^\\(q\d?|qm\d?)\b ?([\s\S]*)$/))){ const lvl = (m[1].match(/\d/)||["1"])[0]; add("<br>" + (lvl >= "2" ? "&emsp;" : "") + (m[2]||"")); continue; }
      if((m = line.match(/^\\(?:p|m|pi\d?|mi|nb|pc|cls|li\d?|pmo|pm|pr)\b ?([\s\S]*)$/))){ add('<span class="pp"></span>' + (m[1]||"")); continue; }
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
    return { q, tables, has: t => tables.some(x => x.toLowerCase() === t.toLowerCase()), close: () => { try{ sdb.close(); }catch(e){} } };
  }
  // A SQL IDENTIFIER, quoted. Table and column names inside a module come from a file somebody else made, and
  // buildDictFromDb/buildCommentaryFromDb used to paste them into SQL bare: a column NAMED like a recursive
  // query ran that query (audit 2026-11-14 H2). Quoted, a hostile name is only a name.
  const qid = (n) => '"' + String(n).replace(/"/g, '""') + '"';
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
    const qid = (n) => '"' + String(n).replace(/"/g, '""') + '"';   // identifiers come from the file: quote, never paste
    const t = db.tables.find(x => /dictionary/i.test(x)); if(!t) return null;
    const cols = db.q("PRAGMA table_info(" + qid(t) + ")").map(c => c.name.toLowerCase());
    const topicCol = cols.includes("topic") ? "topic" : (cols.includes("word") ? "word" : cols[0]);
    const defCol = cols.includes("definition") ? "definition" : (cols.includes("data") ? "data" : cols[1] || cols[0]);
    const entries = {};
    db.q("SELECT " + qid(topicCol) + " AS topic, " + qid(defCol) + " AS def FROM " + qid(t)).forEach(r => {
      const id = String(r.topic || "").trim().toUpperCase(); if(!id) return;
      const g = stripTags(String(r.def || ""));
      entries[id] = { gloss: g, short: g.slice(0, 64) };
    });
    return Object.keys(entries).length ? entries : null;
  }
  // MySword commentary (.cmt.mybible): a Commentary table keyed by book/chapter (+ verse range)
  function buildCommentaryFromDb(db, fb){
    const qid = (n) => '"' + String(n).replace(/"/g, '""') + '"';   // identifiers come from the file: quote, never paste
    const t = db.tables.find(x => /commentary/i.test(x)); if(!t) return null;
    const cols = db.q("PRAGMA table_info(" + qid(t) + ")").map(c => c.name);
    const find = (...names) => cols.find(c => names.some(n => c.toLowerCase() === n));
    const bookCol = find("book", "booknumber"), chapCol = find("chapter", "chapternumber", "chapterbegin", "fromchapter");
    const fromV = find("fromverse", "versebegin", "verse", "versenumber"), toV = find("toverse", "verseend");
    const dataCol = find("comments", "data", "text", "commentary", "definition");
    if(!bookCol || !chapCol || !dataCol) return null;
    const det = detailsOf(db, fb);
    const sel = "SELECT " + [qid(bookCol) + " AS b", qid(chapCol) + " AS c", (fromV ? qid(fromV) : "0") + " AS fv", (toV ? qid(toV) : (fromV ? qid(fromV) : "0")) + " AS tv", qid(dataCol) + " AS d"].join(", ") + " FROM " + qid(t) + " WHERE " + qid(bookCol) + "=? AND " + qid(chapCol) + "=? ORDER BY fv";
    return {
      abbr: det.abbr, name: det.name, kind: "comment", license: det.license,
      getComment: (b, c) => { try { return db.q(sel, [b, c]).map(r => ({ v: r.fv, vTo: r.tv, html: parseVerse(String(r.d || "")) })).filter(x => x.html.trim()); } catch(e){ return []; } }
    };
  }
  function buildFromUSFM(files, fallbackName){
    const dec = new TextDecoder("utf-8");
    const rawByBook = {}, parsed = {}, fnByChap = {}, maxChap = {}, books = [];
    let hasFn = false;
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
      if(!hasFn && /\\f\b/.test(text)) hasFn = true;
      if(!books.includes(bookNum)) books.push(bookNum);
    }
    if(!books.length) return null;
    books.sort((a, b) => a - b);
    const chaptersFor = (b) => {
      if(!parsed[b]){
        const raw = rawByBook[b];
        parsed[b] = raw ? (parseUSFM(raw).chapters || {}) : {};
        // extract \f … \f* footnotes per chapter+verse before the raw text is discarded
        if(raw){ const fn = {}; let ch = 0, v = 0; for(const line of raw.split(/\r?\n/)){ let m; if((m = line.match(/^\\c\s+(\d+)/))){ ch = +m[1]; v = 0; continue; } if((m = line.match(/^\\v\s+(\d+)/))) v = +m[1]; const fre = /\\f\b([\s\S]*?)\\f\*/g; let fm; while((fm = fre.exec(line))){ const t = fm[1].replace(/^\s*[+\-*]\s*/, "").replace(/\\fr\s[^\\]*/, "").replace(/\\f[rtkqa]\s?/g, "").replace(/\\\+?[a-z]+\d?\*?/gi, "").trim(); if(t && ch){ (fn[ch] = fn[ch] || {})[v] = (fn[ch][v] || []).concat(t); } } } fnByChap[b] = fn; }
        rawByBook[b] = null;
      }
      return parsed[b];
    };
    const get = (b, c) => { const ch = chaptersFor(b); return (ch && ch[c]) ? ch[c].map(x => ({ v: x.v, html: x.html, text: usfmText(x.html) })) : []; };
    return {
      abbr: (fallbackName || "USFM").replace(/\.(zip|usfm|sfm)$/i, "").slice(0, 12) || "USFM",
      name: fallbackName || "USFM Bible", kind: "usfm", books, maxChap,
      getVerses: get, plain: (b, c) => get(b, c).map(x => ({ v: x.v, text: x.text })),
      ...(hasFn ? { footnotes: (b, c) => { chaptersFor(b); const ch = fnByChap[b] && fnByChap[b][c]; if(!ch) return []; return Object.keys(ch).map(Number).sort((a,b) => a - b).map(v => ({ v, notes: ch[v] })); } } : {})
    };
  }
  // THE PLAIN TEXT OF A USFM VERSE, from the html parseUSFM built for it. (2026-10-01, FIX-PLAN item 3.)
  // This used stripTags(html), which is written for MySword markup and gets three things wrong here, all
  // seen on Today's Verse of the Day from a USFM Bible (Isaiah 40:8 in an open.bible text):
  //   · a section heading or parallel reference parseUSFM attached to the END of the verse before it
  //     (`<span class="sec">Here Is Your God!</span>`, `<span class="parref">(Romans 11:33–36)</span>`) kept
  //     its words — stripTags drops the tags, not the content — so the heading was read as scripture;
  //   · a poetry line break (`<br>`) became nothing, gluing "fall,but";
  //   · the indent entity `&emsp;` was printed as the six characters "&emsp;".
  // The html is untouched — the reader still renders headings, indents and breaks from it. Only `text`
  // changes, and with it everything that reads `text`: Today's verse card, copy, share, read-aloud, the
  // compare pane, and the USFM search (search() → plain() → this). stripTags itself is NOT changed: the
  // MySword builders and the dictionary use it on a different markup.
  function usfmText(html){
    let s = String(html || "");
    // Drop heading and parallel-reference spans WITH their content. NOT a Psalm title: parseUSFM writes \d as
    // `<span class="sec d">`, which this pattern does not match, so its words stay in the text (owner,
    // 2026-10-01). Depth-counted, because inlineUSFM can nest a span inside a heading (`\s1 The \nd LORD\nd*
    // reigns` → <span class="nd"> inside the sec span). parseUSFM balances every heading's own markup
    // (_balancedInline), so the heading's closing tag is always found before any verse text — an unclosed
    // `\nd` in a heading can no longer carry the drop into the verse words after it, whatever follows the
    // heading (a \v, a \q, a \qc, a \p). Audit of 3fe46eb finding 7, and its re-audit.
    // `sec sp` is a speaker label (\sp), `sec qa` an acrostic letter (\qa, or Psalm 119's \d letters) — labels,
    // not scripture, dropped like a heading (2026-10-01).
    const OPEN = /<span class="(?:sec|sec sp|sec qa|parref)">/g;
    let m;
    while((m = OPEN.exec(s))){
      let depth = 1, i = m.index + m[0].length;
      const tag = /<span\b[^>]*>|<\/span>/g; tag.lastIndex = i;
      let t;
      while(depth > 0 && (t = tag.exec(s))){ depth += (t[0] === "</span>") ? -1 : 1; i = t.index + t[0].length; }
      // Malformed html that did not come from parseUSFM: drop only the opening tag, never the words after it.
      if(depth > 0) i = m.index + m[0].length;
      s = s.slice(0, m.index) + " " + s.slice(i);
      OPEN.lastIndex = m.index;
    }
    s = s.replace(/<br\s*\/?>/gi, " ");                    // a line break is a word break
    s = stripTags(s);                                       // the remaining markup and USFM codes, as before
    s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
      if(e[0] === "#"){ const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return (n > 0 && n < 0x110000) ? String.fromCodePoint(n) : all; }
      const named = { emsp: " ", ensp: " ", thinsp: " ", nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
      const k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(named, k) ? named[k] : all;
    });
    return s.replace(/\s+/g, " ").trim();
  }
  // clean display/search text: drop note CONTENT (not just tags), Strong's, markup
  function stripTags(s){
    return (s || "")
      .replace(/<RF[^>]*>[\s\S]*?<Rf>/g, "")      // MySword footnotes (remove content)
      .replace(/<RX[^>]*>[\s\S]*?<Rx>/g, "")      // MySword cross-references
      .replace(/\\f\b[\s\S]*?\\f\*/g, "")          // USFM footnotes
      .replace(/\\x\b[\s\S]*?\\x\*/g, "")          // USFM cross-references
      .replace(/<X?W[GH]\d+>/g, "")                // Strong's tags
      .replace(/<(?:CM|CL|PF|PI|PG|TS\d?|Q\d?)[^>]*>|¶|<span class="pp"><\/span>/gi, " ") // block breaks → space
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
  //
  // `preFiles` (optional): the entries of a zip, ALREADY extracted. A file a member handed us is extracted by
  // _zipExtract (one bounded, central-directory-driven reader, below) and passed here, so fflate.unzipSync is never
  // run on it. A hosted catalogue module (fetchAndCacheModule) and a catalogue-pinned copy pass nothing and take the
  // old path: those bytes come from our own server or match a published hash, they are not a stranger's.
  async function loadModuleBytes(u8, srcName, meta){
    const preFiles = arguments[3];   // optional 4th argument (kept off the signature: tests lift this function by its exact first line)
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
      const files = preFiles || fflate.unzipSync(u8);
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
    // A user-supplied cross-reference JSON (the shape scripts/build-crossrefs.mjs emits). A HOSTED set is
    // sha256-pinned and installs through installModule's JSON branch; a FILE a member imports carries no pin,
    // so it arrives here on TLS trust (the same trust every file import rests on). Validate the shape rather
    // than register arbitrary JSON as a cross-ref set: meta.kind must be "crossref" and refs a plain object.
    if(head.replace(/^﻿/, "").trimStart().charAt(0) === "{"){
      let parsed = null; try{ parsed = JSON.parse(new TextDecoder().decode(u8)); }catch(e){ parsed = null; }
      if(parsed && parsed.meta && parsed.meta.kind === "crossref" && parsed.refs && typeof parsed.refs === "object" && !Array.isArray(parsed.refs))
        return { kind: "crossref", abbr: loadCrossrefsJSON(parsed, (parsed.meta && parsed.meta.abbr) || (meta && meta.abbr)) };
    }
    throw new Error("unrecognized file — expected a MySword .mybible module, a USFM book, a cross-reference JSON, or a .zip containing either");
  }

  // ── IndexedDB cache (download-once) ──
  function idb(){ return new Promise((res, rej) => { const r = indexedDB.open("bible-modules", 1); r.onupgradeneeded = () => r.result.createObjectStore("modules"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function idbStore(db, mode){ return db.transaction("modules", mode).objectStore("modules"); }
  async function cacheGet(key){ try{ const db = await idb(); return await new Promise((res, rej) => { const q = idbStore(db, "readonly").get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); }catch(e){ return null; } }
  async function cachePut(key, u8){ const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction("modules", "readwrite"); tx.objectStore("modules").put(u8, key); tx.oncomplete = () => res(); tx.onabort = () => rej(tx.error || new DOMException("transaction aborted", "AbortError")); tx.onerror = () => rej(tx.error); }); }
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
      const cat = await _catAns();
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

  // The bytes of a downloaded module, read by the SAME bounded reader as a member's file (_zipExtract), never by
  // fflate.unzipSync (re-audit 3, M2). `?module=<any https url>` and the eBible mirror fetch zips from hosts that are not
  // ours, with no pin; they were decoded with no size limit and again on every boot. A zip the reader refuses, or (for a
  // non-relative url) a database with a view/trigger/generated column, is refused HERE, before anything is saved.
  async function _hostedFiles(u8, url){
    let files;
    if(isZip(u8)){ const x = _zipExtract(u8); if(x.refuse) throw new Error("module refused (" + x.refuse + "): " + url); files = x.files; }
    if(/^https?:/i.test(url)){
      let pk = null;
      try{ pk = await _peekModule(u8, "", files); }catch(e){ throw new Error("module refused (unreadable): " + url); }
      if(pk && pk.unsafe) throw new Error("module refused (unsafe database): " + url);
    }
    return files;
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
      return _hostedFiles(cached, url).then(files => withReg(() => loadModuleBytes(cached, url.split("/").pop(), meta, files)));
    const res = await fetchAsset(url);
    // SECURITY-AUDIT-2026-06-24 L4: size cap (matches the JSON branch in installModule). The
    // ceiling is well above any real module: BSB ≈ 3 MB, the KJV+S MySword ≈ 9 MB. A compromised
    // mirror could otherwise stream gigabytes into RAM.
    const cl = Number(res.headers.get('content-length') || 0);
    if (cl > 50 * 1024 * 1024) throw new Error("module too large (" + cl + " bytes — refusing)");
    const u8 = new Uint8Array(await res.arrayBuffer());
    if (u8.byteLength > 50 * 1024 * 1024) throw new Error("module too large (" + u8.byteLength + " bytes — refusing)");
    await verifyIntegrity(url, u8, meta && meta.sha256);   // M3: verify before we cache/parse
    // saved and registered under the registration lock, so a file install that is checking names cannot run
    // between the two and then be replaced by this module when it registers
    const files = await _hostedFiles(u8, url);   // refused => nothing below runs, nothing is saved
    return withReg(async () => { await cachePut(url, u8); return loadModuleBytes(u8, url.split("/").pop(), meta, files); });
  }

  // generic cached asset fetch -> raw bytes (same IndexedDB cache + ASSET_BASE host as Bible modules).
  // Used by the on-demand Book library: native pulls from the gateway, then it reads offline from cache.
  async function loadAsset(url){
    const cached = await cacheGet(url);
    if(cached) return cached;
    const res = await fetch(resolveAsset(url));
    if(!res.ok) throw new Error("HTTP " + res.status);
    const u8 = new Uint8Array(await res.arrayBuffer());
    try{ await cachePut(url, u8); }catch(e){ console.warn("cachePut failed for asset (full phone?)", e); }
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
  const DEFAULT_CROSSREFS = { id: "crossrefs-openbible", abbr: "TSK", name: "Cross References (openbible.info)",
    kind: "crossref", format: "JSON", category: "crossrefs", url: "modules/crossrefs-openbible.json" };
  // Lazy, idempotent, and self-healing on a failed connection — the lexicon pattern (_ensureFullLexicon).
  let _crossrefsRequested = false;
  function ensureCrossrefs(){
    if(_crossrefsRequested || Object.keys(crossrefs).length || typeof navigator === "undefined") return;
    _crossrefsRequested = true;
    try{
      if(isInstalled(DEFAULT_CROSSREFS.url)) return;
      installModule(DEFAULT_CROSSREFS).then(notify).catch(err => { _crossrefsRequested = false; console.warn("crossrefs install failed", err); });
    }catch(err){ _crossrefsRequested = false; console.warn("crossrefs install failed", err); }
  }

  const DEFAULT_WORDDEFS = { id: "worddefs-wordnet", abbr: "WN", name: "Word Definitions (WordNet)",
    kind: "worddef", format: "JSON", category: "dictionaries", url: "modules/worddefs-wordnet.json" };
  // Same lazy, idempotent, self-healing shape as ensureCrossrefs. Fired by the first Define tap, so a member who
  // never taps Define never downloads it. A failure clears the flag so the next tap (or retryWorddefs) retries.
  let _worddefsRequested = false;
  function ensureWorddefs(){
    // "failed" does NOT retry by itself: the Define sheet looks up during render, so a retry-on-render would loop
    // (fail -> notify -> render -> retry). A retry is a deliberate act: retryWorddefs(), or opening the sheet again.
    // WordNet is the BACKSTOP behind Webster: a member who installed only Webster still gets WordNet fetched on first Define,
    // so a word Webster lacks is defined rather than dropped. (Keyed on WN, not "anything loaded".)
    if(_worddefsRequested || _worddefsState === "failed" || worddefs.WN || typeof navigator === "undefined") return;
    _worddefsRequested = true; _worddefsState = "loading";
    const fail = err => { _worddefsRequested = false; _worddefsState = "failed"; console.warn("worddefs install failed", err); notify(); };
    // Deferred a tick: the Define sheet looks words up DURING RENDER, and installModule notifies synchronously.
    Promise.resolve().then(() => {
      try{
        // Recorded as installed: boot's restoreInstalled loads it. But a record whose bytes were evicted loads
        // nothing and would leave the sheet on "loading" for ever, so check the bytes and re-download if gone.
        if(isInstalled(DEFAULT_WORDDEFS.url)){
          cacheGet(DEFAULT_WORDDEFS.url).then(b => b ? null : installModule(DEFAULT_WORDDEFS).then(notify)).catch(fail);
          return;
        }
        installModule(DEFAULT_WORDDEFS).then(notify).catch(fail);
      }catch(err){ fail(err); }
    });
  }
  function retryWorddefs(){ _worddefsRequested = false; _worddefsState = "idle"; ensureWorddefs(); }

  // ── catalog + installed-module registry (download-once, MySword style) ──
  const INSTALLED_KEY = "trinityone.installed";   // localStorage map: url -> meta
  const installing = new Set();              // urls currently downloading
  let catalogPromise = null;

  function getInstalled(){ try{ return JSON.parse(localStorage.getItem(INSTALLED_KEY) || "{}"); }catch(e){ return {}; } }
  function setInstalled(map){ try{ localStorage.setItem(INSTALLED_KEY, JSON.stringify(map)); }catch(e){} }
  function catOf(item){ return item.category || (item.kind === "crossref" ? "crossrefs" : (item.kind === "dict" || item.kind === "worddef" || item.kind === "original") ? "dictionaries" : item.kind === "comment" ? "commentaries" : item.kind === "devotional" ? "devotionals" : "bibles"); }
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
  function isLoaded(url){ return Object.values(urlOf).includes(url); }

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
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        loaded = (item.kind === "crossref")
          ? { kind: "crossref", abbr: loadCrossrefsJSON(parsed, item.abbr) }
          : (item.kind === "worddef")
          ? { kind: "worddef", abbr: loadWorddefsJSON(parsed, item.abbr) }
          : (item.kind === "original")
          ? { kind: "original", abbr: loadOriginalJSON(parsed, item.abbr) }
          : { kind: "dict", abbr: loadDictJSON(parsed, item.abbr) };
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

  // A stored module that was NOT loaded because it is unsafe: tell the member once. Told by event if the app is already
  // listening, else kept (told:false on the record) for takeQuarantineNotices(), which the app calls when it mounts.
  function _noticeQuarantine(url, name){
    if(_fileSubs.size){ _emitFile({ phase: "quarantined", name }); const m = getInstalled(); if(m[url]){ m[url].told = true; setInstalled(m); } }
  }
  function takeQuarantineNotices(){
    const m = getInstalled(), out = [];
    for(const u of Object.keys(m)) if(m[u].quarantined && m[u].told === false){ out.push(m[u].name || m[u].abbr || u); m[u].told = true; }
    if(out.length) setInstalled(m);
    return out;
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
        if(meta.quarantined) continue;   // an unsafe stored file: never loaded again; it stays listed so it can be removed
        const bytes = await cacheGet(url);
        if(!bytes) continue;  // cache cleared — user can re-download
        // A FILE A MEMBER IMPORTED (imported/...) is read by the SAME bounded reader as at install time (never
        // fflate.unzipSync), and a stored file an older build accepted unchecked is checked once. FAIL CLOSED: if the reader
        // refuses it or the check cannot finish (it throws), the file is quarantined, not loaded (re-audit L-e, A4). The
        // record stays listed and its bytes stay, so it can be removed in Library > Installed.
        let memberFiles = null;
        // EVERY record that is not an EXACT published url (catalogue, eBible mirror, the default Bible) is a stranger's: imported/,
        // an https url, and also what an old build's ?module= could have saved under `//host/x.zip`, ` https://...` with a
        // leading space or tab, `HTTPS://...`, or a bare name (re-audit round 4, R4-1). Matching on a prefix missed those.
        if(!(await moduleLinkAllowed(url)) && (meta.format || "").toUpperCase() !== "JSON"){
          let bad = false;
          if(isZip(bytes)){ const x = _zipExtract(bytes); if(x.refuse) bad = true; else memberFiles = x.files; }
          if(!bad && !meta.checked){ try{ const pk = await _peekModule(bytes, "", memberFiles); bad = !!(pk && pk.unsafe); }catch(e){ bad = true; } }
          // WHEN WE CANNOT READ OUR OWN LISTS (offline, short read, low memory) a published module looks like a stranger's file, and
          // a transient failure must not brand it unsafe for good (re-audit round 5, R5-1). So a refusal then SKIPS the record for
          // THIS boot only: not loaded (a record that is not ours never loads unless the reader accepts it), not quarantined, not
          // marked, and tried again at the next boot. With the lists readable the refusal is permanent, as before.
          // an imported/ key is a member's own file and can never be a published module, so no list can vouch for it: it is quarantined at once
          if(bad && url.indexOf("imported/") !== 0 && !(await _listsReadable())){ console.warn("restore: skipped (cannot yet tell whether it is ours)", url); continue; }
          const mm = getInstalled();
          if(bad){
            if(mm[url]){ mm[url].quarantined = true; mm[url].told = false; setInstalled(mm); }
            _noticeQuarantine(url, meta.name || meta.abbr || url);
            continue;
          }
          if(!meta.checked && mm[url]){ mm[url].checked = true; setInstalled(mm); }
        }
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
          const raw = bytes, u = url, isXr = meta.kind === "crossref", isWd = meta.kind === "worddef", isOr = meta.kind === "original";
          // A word-definitions module is NOT a dictionary: it is parsed straight into `worddefs` (never queued in
          // _pendingDicts, so removeDict has nothing to find and lex() never sees it), but it is filed under
          // "dictionaries" so the Library lists it with them.
          if(isWd) noteLoadedFrom(u, loadWorddefsJSON(JSON.parse(new TextDecoder().decode(raw)), meta.abbr), "dictionaries");
          else if(isOr) noteLoadedFrom(u, loadOriginalJSON(JSON.parse(new TextDecoder().decode(raw)), meta.abbr), "dictionaries");
          else _pendingDicts.push({ abbr: meta.abbr, url: u, run: () => noteLoadedFrom(u,
            isXr ? loadCrossrefsJSON(JSON.parse(new TextDecoder().decode(raw)), meta.abbr)
                 : loadDictJSON(JSON.parse(new TextDecoder().decode(raw)), meta.abbr),
            isXr ? "crossrefs" : "dictionaries") });
        } else {
          const r = await loadModuleBytes(bytes, url.split("/").pop(), { abbr: meta.abbr, name: meta.name, category: meta.category }, memberFiles);
          noteLoadedFrom(url, r && r.abbr, catOf(meta));
        }
      }catch(e){ console.error("restore failed for", url, e); }
    }
    // parse any deferred lexicon dicts during idle — ready before the reader's tapped, but not blocking boot
    if(_pendingDicts.length){ if(typeof requestIdleCallback === 'function') requestIdleCallback(_ensureDicts, { timeout: 5000 }); else setTimeout(_ensureDicts, 1500); }
  }

  // ── INSTALL A MODULE FROM A FILE (a Bible, commentary, dictionary or cross-reference set someone sent) ──
  //
  // ONE ENTRY POINT, installFromBytes(u8, hint), used by the browser's file picker (pickFile, below) and by
  // "Open with TrinityOne" on Android (app/install-bible.jsx). It NEVER THROWS and never writes Bible._error:
  // it answers {ok:true, kind, abbr, name, already?, renamed?} or {ok:false, reason}, with reason one of
  // "unusable" | "too-big" | "no-space" | "failed". A screen turns that into words (app/install-bible.jsx).
  //
  // WHY IT IS NOT JUST loadModuleBytes. loadModuleBytes (unchanged, and used by the hosted-install and boot
  // paths) trusts what it is given. A file somebody SENT us is the one input here that is untrusted, so every
  // guard lives in this caller and none in the shared function. In order:
  //   0. wait for the boot restore (autoLoad), so a cold open from a file cannot race it into BSB and BSB2;
  //   1. caps: 50 MB raw; for a zip a header-only pass sums the DECLARED inflated size (128 MB) and counts the
  //      entries (2,000) before anything is inflated; fflate allocates from that same field, so the sum is an
  //      upper bound (audit of 2026-11-14 measured it on the vendored fflate 0.8.3);
  //   2. REFUSE any SQLite file holding a view or a trigger, bare or inside a zip. detailsOf() runs
  //      `SELECT * FROM Details`, which a hostile file can make a recursive view: an 8 KB file stalled the
  //      main thread for 13.6 s on a desktop. A finite one would then be paid again on every boot;
  //   3. IDENTITY IS THE BYTES. Key = imported/<first 12 hex of sha256>/<cleaned name><ext>. Identical bytes
  //      are "already here" (nothing is written). Bytes that match a PINNED hash (KNOWN_HASHES, or a
  //      catalogue sha256) take that catalogue entry's name. A module can NEVER take a name a loaded (or
  //      catalogue) module holds: it gets " (from a file)" and a distinct abbreviation instead, because
  //      addSource/addCommentary REPLACE a module with the same abbr and name, and altered Scripture under a
  //      trusted name is the realistic attack on this product's first audience. There is no Replace;
  //   4. load through the unchanged loadModuleBytes, naming it first with the meta this function decided;
  //   5. SAVE THE BYTES, THEN RECORD. cachePut first; a record is written only after it succeeded, and if
  //      saving fails the module is taken back out of memory. A record with no bytes can never exist.
  // Installs run one at a time (_installChain).
  const INSTALL_MAX_RAW = 50 * 1024 * 1024;        // the hosted-install cap (fetchAndCacheModule), same number
  const INSTALL_MAX_INFLATED = 128 * 1024 * 1024;  // sum of a zip's declared inflated sizes
  const INSTALL_MAX_ENTRIES = 2000;
  const FROM_FILE = " (from a file)";
  const DB_NAME_RE = /\.(bbl\.mybible|mybible|bbl|sqlite|db)$/i;   // the same pattern loadModuleBytes uses
  let _bootDone = Promise.resolve();
  let _installChain = Promise.resolve();
  const _fileSubs = new Set();
  function onFileInstall(fn){ _fileSubs.add(fn); return () => _fileSubs.delete(fn); }
  const _emitFile = (ev) => _fileSubs.forEach(fn => { try{ fn(ev); }catch(e){ console.error(e); } });

  // The last part of the stored key: safe as a file name and as a path part (exportModule, shareOneFile and
  // restoreInstalled's srcName all read it). Only [A-Za-z0-9._-], at most 40, never a leading dot, never "..".
  function _cleanFileName(s){
    let t = String(s == null ? "" : s);
    while(/\.(zip|usfm|sfm|json|mybible|bbl|cmt|dct|dvn)$/i.test(t)) t = t.replace(/\.[A-Za-z0-9]+$/, "");
    t = t.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/\.{2,}/g, ".").replace(/^[._-]+/, "").slice(0, 40).replace(/[._-]+$/, "");
    return t || "module";
  }
  // NFKC, and no format characters (zero-width, bidi overrides, U+2060...): a name that LOOKS like another name
  // must not be stored as a different one (audit M2).
  const _cleanTitle = (s) => String(s == null ? "" : s).normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  // THE KEY TWO NAMES ARE COMPARED ON is the Unicode UTS #39 "skeleton": every character that is confusable with an
  // ASCII letter or digit is replaced by it, so "King James Versi\u0585n" (Armenian o), "V\u1d07rsion" (small-cap E),
  // "Kin\u0261" (script g) and "K\u0131ng" (dotless i) all become "kingjamesversion". The table is GENERATED from the
  // Unicode Consortium's confusables.txt (https://www.unicode.org/Public/security/latest/confusables.txt, version 18.0,
  // "MA" mixed-script-any-case mappings, single characters whose prototype is ASCII letters/digits: 1,806 characters),
  // plus the Latin small capitals U+1D00.. which that file omits. Data (c) Unicode, Inc., used under the Unicode
  // terms of use. Format: `prototype:hex,hex,...;prototype:...`. Then NFD with the marks removed, case-folded, and
  // everything that is not a letter or digit dropped (spaces, punctuation, soft hyphens, every format character).
  //
  // WHY THIS AND NOT "LABEL ANY MIXED-SCRIPT NAME": a stricter script rule would label real names (a Ukrainian or
  // Greek Bible whose own name is in its own script, or "Bible Reina-Valera" with a Latin-1 accent) and teach members
  // that the label means nothing. The skeleton labels only what IMITATES a name we hold.
  //
  // LICENCE NOTICE for the data the table below is derived from (Unicode License v3; the same text is in
  // scripts/data/UNICODE-LICENSE-3.0.txt, which is not shipped, so it is repeated here, where the data ships):
  //
  //   UNICODE LICENSE V3
  //   COPYRIGHT AND PERMISSION NOTICE
  //   Copyright (c) 1991-2026 Unicode, Inc.
  //   NOTICE TO USER: Carefully read the following legal agreement. BY DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING
  //   DATA FILES, AND/OR SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE TERMS AND CONDITIONS OF THIS
  //   AGREEMENT. IF YOU DO NOT AGREE, DO NOT DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.
  //   Permission is hereby granted, free of charge, to any person obtaining a copy of data files and any associated
  //   documentation (the "Data Files") or software and any associated documentation (the "Software") to deal in the Data
  //   Files or Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
  //   distribute, and/or sell copies of the Data Files or Software, and to permit persons to whom the Data Files or Software
  //   are furnished to do so, provided that either (a) this copyright and permission notice appear with all copies of the
  //   Data Files or Software, or (b) this copyright and permission notice appear in associated Documentation.
  //   THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
  //   LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF THIRD PARTY
  //   RIGHTS.
  //   IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL
  //   INDIRECT OR CONSEQUENTIAL DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
  //   ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
  //   THE DATA FILES OR SOFTWARE.
  //   Except as contained in this notice, the name of a copyright holder shall not be used in advertising or otherwise to
  //   promote the sale, use or other dealings in these Data Files or Software without prior written authorization of the
  //   copyright holder.
  const _CONF_DATA = "2:1a7,3e8,10c7,14bf,1616,1cb7,a644,a6ef,a75a,ff12,1ccf2,1d7d0,1d7da,1d7e4,1d7ee,1d7f8,1fbf2;3:1b7,21c,417,4e0,545,969,ae9,1702,1c95,2c9c,2cc4,2ccc,a76a,a7ab,ff13,118ca,16f3b,1ccf3,1d206,1d7d1,1d7db,1d7e5,1d7ef,1d7f9,1fbf3;4:13ce,ab9e,ff14,118af,16e82,1ccf4,1d7d2,1d7dc,1d7e6,1d7f0,1d7fa,1fbf4;5:1bc,ff15,118bb,1ccf5,1d7d3,1d7dd,1d7e7,1d7f1,1d7fb,1fbf5;6:3ec,431,13ee,2cd2,2cd3,2cdc,a543,abbe,ff16,118d5,1ccf6,1d7d4,1d7de,1d7e8,1d7f2,1d7fc,1fbf6;7:172a,1c84,ff17,104d2,118c6,16e8a,1ccf7,1d1fe,1d212,1d7d5,1d7df,1d7e9,1d7f3,1d7fd,1fbf7;8:222,223,9ea,a6a,b03,a589,ff18,1031a,11445,169fe,1ccf8,1d7d6,1d7e0,1d7ea,1d7f4,1d7fe,1e8cb,1fbf8;9:9ed,a67,b68,d6d,2cca,2ccb,a76e,a76f,ff19,118ac,118cc,118d6,169c1,1ccf9,1d7d7,1d7e1,1d7eb,1d7f5,1d7ff,1e2f2,1fbf9;A:391,410,13aa,15c5,a4ee,ff21,102a0,16f40,1ccd6,1d400,1d434,1d468,1d49c,1d4d0,1d504,1d538,1d56c,1d5a0,1d5d4,1d608,1d63c,1d670,1d6a8,1d6e2,1d71c,1d756,1d790,1df6a;AA:a732;AE:c6,4d4;AO:a734;AR:1f707;AU:3373,a736;AV:a738,a73a;AY:a73c;B:392,412,13f4,15f7,212c,2c82,a4d0,a557,a7b4,ff22,10282,102a1,10301,1ccd7,1d401,1d435,1d469,1d4d1,1d505,1d539,1d56d,1d5a1,1d5d5,1d609,1d63d,1d671,1d6a9,1d6e3,1d71d,1d757,1d791;Bq:33c3;C:3f9,421,13df,2102,212d,216d,2ca4,a4da,ff23,102a2,10302,10415,1051b,118e9,118f2,1ccd8,1d402,1d436,1d46a,1d49e,1d4d2,1d56e,1d5a2,1d5d6,1d60a,1d63e,1d672,1f74c;D:13a0,15de,15ea,2145,216e,a4d3,ff24,1ccd9,1d403,1d437,1d46b,1d49f,1d4d3,1d507,1d53b,1d56f,1d5a3,1d5d7,1d60b,1d63f,1d673;DJ:1f190;DZ:1f1;Dz:1f2;E:395,415,13ac,2130,22ff,2d39,a4f0,a5cb,ff25,10286,118a6,118ae,1ccda,1d404,1d438,1d46c,1d4d4,1d508,1d53c,1d570,1d5a4,1d5d8,1d60c,1d640,1d674,1d6ac,1d6e6,1d720,1d75a,1d794,1df81;F:3dc,7d3,15b4,2131,a4dd,a798,ff26,10287,102a5,10525,118a2,118c2,1ccdb,1d213,1d405,1d439,1d46d,1d4d5,1d509,1d53d,1d571,1d5a5,1d5d9,1d60d,1d641,1d675,1d7ca;FAX:213b;G:50c,13c0,13f3,a4d6,ff27,1ccdc,1d406,1d43a,1d46e,1d4a2,1d4d6,1d50a,1d53e,1d572,1d5a6,1d5da,1d60e,1d642,1d676;GB:3387;GHz:3393;GPa:33ac;Gy:33c9;H:397,41d,13bb,157c,210b,210c,210d,2c8e,a4e7,ff28,102cf,1ccdd,1d407,1d43b,1d46f,1d4d7,1d573,1d5a7,1d5db,1d60f,1d643,1d677,1d6ae,1d6e8,1d722,1d75c,1d796;HP:33cb;Hg:32cc;Hz:3390;J:37f,408,13ab,148d,a4d9,a7b2,ff2a,1ccdf,1d409,1d43d,1d471,1d4a5,1d4d9,1d50d,1d541,1d575,1d5a9,1d5dd,1d611,1d645,1d679;K:39a,41a,13e6,16d5,2c94,a4d7,ff2b,10518,1cce0,1d40a,1d43e,1d472,1d4a6,1d4da,1d50e,1d542,1d576,1d5aa,1d5de,1d612,1d646,1d67a,1d6b1,1d6eb,1d725,1d75f,1d799;KB:3385;KK:33cd;KM:33ce;L:13de,14aa,2112,216c,2cd0,a4e1,ff2c,1041b,10526,118a3,118b2,16f16,1cce1,1d22a,1d40b,1d43f,1d473,1d4db,1d50f,1d543,1d577,1d5ab,1d5df,1d613,1d647,1d67b;LJ:1c7;LTD:32cf;Lj:1c8;M:39c,3fa,41c,13b7,15f0,16d6,2133,216f,2c98,a4df,ff2d,102b0,10311,10c21,1cce2,1d40c,1d440,1d474,1d4dc,1d510,1d544,1d578,1d5ac,1d5e0,1d614,1d648,1d67c,1d6b3,1d6ed,1d727,1d761,1d79b;MB:3386,1f76b;MHz:3392;MPa:33ab;MV:33b9;MW:33bf;N:39d,2115,2c9a,a4e0,ff2e,10513,11abe,1cce3,1d40d,1d441,1d475,1d4a9,1d4dd,1d511,1d579,1d5ad,1d5e1,1d615,1d649,1d67d,1d6b4,1d6ee,1d728,1d762,1d79c;NJ:1ca;Nj:1cb;No:2116;O:39f,41e,555,7c0,b20,ce6,12d0,1cbf,2c9e,2d54,3007,a4f3,ff10,ff2f,10292,102ab,1030f,10404,104c2,10516,10c17,118b5,118e0,11de0,16ae9,1cce4,1ccf0,1d40e,1d442,1d476,1d4aa,1d4de,1d512,1d546,1d57a,1d5ae,1d5e2,1d616,1d64a,1d67e,1d6b6,1d6f0,1d72a,1d764,1d79e,1d7ce,1d7d8,1d7e2,1d7ec,1d7f6,1e140,1e2f0,1fbf0;OE:152;OO:a698,a74e;Oy:478;P:3a1,420,13e2,146d,2119,2ca2,2cce,a4d1,ff30,10295,1cce5,1d40f,1d443,1d477,1d4ab,1d4df,1d513,1d57b,1d5af,1d5e3,1d617,1d64b,1d67f,1d6b8,1d6f2,1d72c,1d766,1d7a0;PH:33d7;PPM:33d9;PR:33da;PTE:3250;Pa:33a9;Q:51a,211a,2d55,ff31,1cce6,1d410,1d444,1d478,1d4ac,1d4e0,1d514,1d57c,1d5b0,1d5e4,1d618,1d64c,1d680;QE:1f700;R:1a6,24c,13a1,13d2,1587,211b,211c,211d,a4e3,ff32,104b4,16f35,1cce7,1d216,1d411,1d445,1d479,1d4e1,1d57d,1d5b1,1d5e5,1d619,1d64d,1d681;Rs:20a8;S:405,54f,10bd,10fd,13d5,13da,1cbd,a4e2,a576,ff33,10296,10420,16ad6,16f3a,1cce8,1d412,1d446,1d47a,1d4ae,1d4e2,1d516,1d54a,1d57e,1d5b2,1d5e6,1d61a,1d64e,1d682;Sv:33dc;T:3a4,422,7e0,13a2,22a4,27d9,2ca6,3112,4e05,a4d4,a50b,ff34,10297,102b1,10315,118bc,16f0a,1cce9,1d373,1d413,1d447,1d47b,1d4af,1d4e3,1d517,1d54b,1d57f,1d5b3,1d5e7,1d61b,1d64f,1d683,1d6bb,1d6f5,1d72f,1d769,1d7a3,1f768;T3:a728;TEL:2121;THz:3394;U:54d,1200,144c,222a,22c3,a4f4,ff35,104ce,118b8,16f42,1ccea,1d414,1d448,1d47c,1d4b0,1d4e4,1d518,1d54c,1d580,1d5b4,1d5e8,1d61c,1d650,1d684;V:474,667,6f7,13d9,142f,2164,2d38,a4e6,a6df,ff36,1051d,10c1f,118a0,16f08,1cceb,1cefc,1d20d,1d415,1d449,1d47d,1d4b1,1d4e5,1d519,1d54d,1d581,1d5b5,1d5e9,1d61d,1d651,1d685,1e145;VB:1f76c;Vl:2165;Vll:2166;Vlll:2167;W:51c,13b3,13d4,a4ea,ff37,118e6,118ef,1ccec,1d20c,1d416,1d44a,1d47e,1d4b2,1d4e6,1d51a,1d54e,1d582,1d5b6,1d5ea,1d61e,1d652,1d686;Wb:33dd;X:3a7,425,166d,16b7,1cf5,2169,2573,2cac,2d5d,a4eb,a7b3,ff38,10290,102b4,10317,10322,10527,10c13,10c82,10cfc,118ec,1cced,1d417,1d44b,1d47f,1d4b3,1d4e7,1d51b,1d54f,1d583,1d5b7,1d5eb,1d61f,1d653,1d687,1d6be,1d6f8,1d732,1d76c,1d7a6;Xl:216a;Xll:216b;Y:3a5,3d2,423,4ae,7cc,13a9,13bd,2ca8,311a,4e2b,a4ec,ff39,102b2,10c20,118a4,16f43,1ccee,1d418,1d44c,1d480,1d4b4,1d4e8,1d51c,1d550,1d584,1d5b8,1d5ec,1d620,1d654,1d688,1d6bc,1d6f6,1d730,1d76a,1d7a4;Z:396,10cd,13c3,2124,2128,2c6b,2c8c,a4dc,a6c9,ff3a,102f5,10507,118a9,118e5,11abc,1ccef,1d419,1d44d,1d481,1d4b5,1d4e9,1d585,1d5b9,1d5ed,1d621,1d655,1d689,1d6ad,1d6e7,1d721,1d75b,1d795;a:251,3b1,430,1d00,237a,ab64,ff41,1d41a,1d44e,1d482,1d4b6,1d4ea,1d51e,1d552,1d586,1d5ba,1d5ee,1d622,1d656,1d68a,1d6c2,1d6fc,1d736,1d770,1d7aa,1df5a;aa:a733;ae:e6,4d5;ao:a735;au:a737;av:a739,a73b;ay:a73d;b:184,299,42c,7d5,13cf,1472,15af,ff42,1031c,16eb6,1d207,1d41b,1d44f,1d483,1d4b7,1d4eb,1d51f,1d553,1d587,1d5bb,1d5ef,1d623,1d657,1d68b;bar:3374;bl:42b;c:3f2,441,1004,105a,1c83,1d04,217d,2ca5,abaf,ff43,1043d,1d134,1d41c,1d450,1d484,1d4b8,1d4ec,1d520,1d554,1d588,1d5bc,1d5f0,1d624,1d658,1d68c;cal:3388;cc:33c4;cd:33c5;co:ab43;crn:339d;d:501,13e7,146f,1d05,2146,217e,a4d2,ff44,1018b,1d41d,1d451,1d485,1d4b9,1d4ed,1d521,1d555,1d589,1d5bd,1d5f1,1d625,1d659,1d68d;dB:33c8;da:3372;dl:3397;drn:3377;dz:1f3,2a3;e:435,4bd,1d07,212e,212f,2147,ab32,ff45,1d41e,1d452,1d486,1d4ee,1d522,1d556,1d58a,1d5be,1d5f2,1d626,1d65a,1d68e;eV:32ce;erg:32cd;f:17f,192,284,584,1e9d,a799,ab35,ff46,1017e,1d41f,1d453,1d487,1d4bb,1d4ef,1d523,1d557,1d58b,1d5bf,1d5f3,1d627,1d65b,1d68f;ff:fb00;ffi:fb03;ffl:fb04;fi:fb01;fl:fb02;frn:3399;ft:fb05;g:18d,261,262,581,1d83,210a,ff47,1d420,1d454,1d488,1d4f0,1d524,1d558,1d58c,1d5c0,1d5f4,1d628,1d65c,1d690;gal:33ff;h:29c,4ba,4bb,570,10b9,13c2,210e,ff48,1d421,1d489,1d4bd,1d4f1,1d525,1d559,1d58d,1d5c1,1d5f5,1d629,1d65d,1d691;hPa:3371;ha:33ca;i:a1,131,269,26a,3b9,456,582,13a5,2139,2148,2170,2373,2c93,a647,ab75,ff49,118c3,1d422,1d456,1d48a,1d4be,1d4f2,1d526,1d55a,1d58e,1d5c2,1d5f6,1d62a,1d65e,1d692,1d6a4,1d6ca,1d704,1d73e,1d778,1d7b2;ie:1df5d;ii:2171;iii:2172;ij:133;in:33cc;iv:2173;ix:2178;j:237,3f3,458,575,1d0a,2149,ff4a,1d423,1d457,1d48b,1d4bf,1d4f3,1d527,1d55b,1d58f,1d5c3,1d5f7,1d62b,1d65f,1d693,1d6a5;k:1d0b,ff4b,1d424,1d458,1d48c,1d4c0,1d4f4,1d528,1d55c,1d590,1d5c4,1d5f8,1d62c,1d660,1d694;kA:3384;kHz:3391;kPa:33aa;kV:33b8;kW:33be;kcal:3389;kg:338f;kl:3398;krn:339e;kt:33cf;l:196,1c0,29f,399,406,4c0,4cf,5c0,5d5,5df,627,661,6f1,7ca,964,104a,16c1,16d0,2110,2111,2113,2160,217c,21bf,2223,23fd,2502,2503,2c92,2d4a,2d4f,a4f2,a56f,a781,a7ae,a7fe,a830,a8ce,aa5d,fe31,fe8d,fe8e,ff11,ff29,ff4c,ff5c,ffe8,1028a,10309,10320,1050e,10926,10c3e,10ca5,10cfa,11047,110c0,11141,111c5,113d4,1144b,115c5,11641,11c41,11dda,11de1,16d63,16eaa,16f28,1ccde,1ccf1,1d100,1d377,1d408,1d425,1d43c,1d459,1d470,1d48d,1d4c1,1d4d8,1d4f5,1d529,1d540,1d55d,1d574,1d591,1d5a8,1d5c5,1d5dc,1d5f9,1d610,1d62d,1d644,1d661,1d678,1d695,1d6b0,1d6ea,1d724,1d75e,1d798,1d7cf,1d7d9,1d7e3,1d7ed,1d7f7,1e141,1e8c7,1ed01,1ee00,1ee80,1fbf1;lJ:132;lL:1efa;lO:42e;lU:337a;lV:2163;lX:2168;lj:1c9;ll:1c1,5f0,965,104b,2016,2161,2225,a8cf,11048,110c1,11142,111c6,113d5,1144c,11642,11c42,1d262;lll:2162,a516;ln:33d1;log:33d2;lrn:33d0;ls:2aa;lt:20b6;lx:33d3;lz:2ab;m:1d0d;n:274,578,57c,ff4e,1d427,1d45b,1d48f,1d4c3,1d4f7,1d52b,1d55f,1d593,1d5c7,1d5fb,1d62f,1d663,1d697;nA:3381;nF:338b;nV:33b5;nW:33bb;nj:1cc;nrn:339a;ns:33b1;o:3bf,3c3,3ed,43e,585,5e1,647,665,6be,6c1,6d5,6f5,7cb,840,966,9e6,a66,ae6,b66,be6,c02,c66,c82,d02,d20,d66,d82,e50,ed0,101d,1040,10ff,110b,11bc,17e0,1a45,1a80,1a90,1bea,1c82,1d0f,1d11,2134,2c9f,3147,ab3d,fba6,fba7,fba8,fba9,fbaa,fbab,fbac,fbad,fee9,feea,feeb,feec,ff4f,ffb7,1042c,104ea,1092c,10d07,11124,11302,114d0,118c8,118d7,1d428,1d45c,1d490,1d4f8,1d52c,1d560,1d594,1d5c8,1d5fc,1d630,1d664,1d698,1d6d0,1d6d4,1d70a,1d70e,1d744,1d748,1d77e,1d782,1d7b8,1d7bc,1ee24,1ee84;oV:3375;oe:153;oi:1df5e;ol:1ee64;oo:1147,11ee,221e,3180,a699,a74f;ou:1df5f;oy:479;p:fe,1bf,3c1,3f1,3f8,440,1d18,2374,2ca3,2ccf,ff50,1d429,1d45d,1d491,1d4c5,1d4f9,1d52d,1d561,1d595,1d5c9,1d5fd,1d631,1d665,1d699,1d6d2,1d6e0,1d70c,1d71a,1d746,1d754,1d780,1d78e,1d7ba,1d7c8;pA:3380;pF:338a;pV:33b4;pW:33ba;pc:3376;ps:33b0;q:51b,563,566,ff51,1d42a,1d45e,1d492,1d4c6,1d4fa,1d52e,1d562,1d596,1d5ca,1d5fe,1d632,1d666,1d69a;r:280,433,1d26,2c85,ab47,ab48,ab81,ff52,16a19,1d42b,1d45f,1d493,1d4c7,1d4fb,1d52f,1d563,1d597,1d5cb,1d5ff,1d633,1d667,1d69b;rad:33ad;rn:560,217f,ff4d,11700,118e3,1d426,1d45a,1d48e,1d4c2,1d4f6,1d52a,1d55e,1d592,1d5c6,1d5fa,1d62e,1d662,1d696;rnA:3383;rnV:33b7;rnW:33bd;rnb:33d4;rng:338e;rnil:33d5;rnl:3396;rnol:33d6;rnrn:339c;rns:33b3;s:1bd,455,d1f,a731,abaa,ff53,10448,118c1,1d42c,1d460,1d494,1d4c8,1d4fc,1d530,1d564,1d598,1d5cc,1d600,1d634,1d668,1d69c;sr:33db;sss:1f75c;st:fb06;t:1d1b,ff54,1d42d,1d461,1d495,1d4c9,1d4fd,1d531,1d565,1d599,1d5cd,1d601,1d635,1d669,1d69d;tf:a777;th:1df64;ts:2a6;u:28b,3c5,57d,1d1c,a79f,ab4e,ab52,ff55,104f6,118d8,1d42e,1d462,1d496,1d4ca,1d4fe,1d532,1d566,1d59a,1d5ce,1d602,1d636,1d66a,1d69e,1d6d6,1d710,1d74a,1d784,1d7be;ue:1d6b;uo:ab63;v:3bd,475,5d8,1d20,2174,2228,22c1,aba9,ff56,11706,118c0,1d42f,1d463,1d497,1d4cb,1d4ff,1d533,1d567,1d59b,1d5cf,1d603,1d637,1d66b,1d69f,1d6ce,1d708,1d742,1d77c,1d7b6;vi:2175;vii:2176;viii:2177;w:26f,448,461,51d,561,1d21,29e2,2cbd,a7fa,ab83,aba4,ff57,1170a,1170e,1170f,1d430,1d464,1d498,1d4cc,1d500,1d534,1d568,1d59c,1d5d0,1d604,1d638,1d66c,1d6a0,1df7d;wh:1df65;x:d7,445,1541,157d,166e,1763,1bec,2179,292b,292c,2a2f,ff58,10cc2,1d431,1d465,1d499,1d4cd,1d501,1d535,1d569,1d59d,1d5d1,1d605,1d639,1d66d,1d6a1;xi:217a;xii:217b;y:263,28f,3b3,443,4af,10e7,1d8c,1eff,213d,2ca9,ab5a,ff59,118c4,118dc,1d432,1d466,1d49a,1d4ce,1d502,1d536,1d56a,1d59e,1d5d2,1d606,1d63a,1d66e,1d6a2,1d6c4,1d6fe,1d738,1d772,1d7ac;z:1d22,2c6c,2c8d,2d2d,ab93,ff5a,1d433,1d467,1d49b,1d4cf,1d503,1d537,1d56b,1d59f,1d5d3,1d607,1d63b,1d66f,1d6a3";
  let _confMap = null;
  const _confOf = (cp) => {
    if(!_confMap){ _confMap = new Map(); for(const g of _CONF_DATA.split(";")){ const i = g.indexOf(":"); const to = g.slice(0, i); for(const h of g.slice(i + 1).split(",")) _confMap.set(parseInt(h, 16), to); } }
    return _confMap.get(cp);
  };
  const _nameKey = (s) => {
    let o = "";
    // accents come off FIRST (Greek \u03cc and Cyrillic \u04e7, \u0451, \u0457, \u04d1 are an accented lookalike of a letter the table knows), then the map
    // Mn (nonspacing) only: the Telugu, Kannada, Malayalam and Sinhala anusvara are SPACING marks (Mc) that look like "o", and the table maps them
    for(const ch of String(s == null ? "" : s).normalize("NFKC").normalize("NFD").replace(/\p{Mn}/gu, "")){ const t = ch.codePointAt(0) >= 128 ? _confOf(ch.codePointAt(0)) : null; o += t || ch; }
    return o.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  };
  const _deriveAbbr = (name) => {
    const w = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
    return (w.length > 1 ? w.map(x => x[0]).join("").toUpperCase().slice(0, 8) : String(name).replace(/[^A-Za-z0-9]/g, "")).slice(0, 12) || "USFM";
  };
  // A USFM Bible's own name, from the file itself. The \id line carries it after the book code (`\id GEN -
  // Berean Study Bible`) ONLY SOMETIMES: in the shipped KJV it holds each BOOK's title (`\id 1SA The First Book
  // of Samuel`), and \toc1 and \h are always book titles. So: an \id text counts only when it is the SAME in at
  // least two books (or the zip has just one book) and is not the book's own title; failing that, the file name
  // the picker gave us; failing that "USFM Bible" - never a book title (audit M3: the KJV installed as "The First
  // Book of Samuel"). Front-matter files (FRT, INT...) are skipped.
  function _usfmName(files, fileName){
    const dec = new TextDecoder("utf-8"), lc = (x) => String(x || "").toLowerCase();
    const seen = {}; let books = 0;
    for(const nm of Object.keys(files).filter(n => !n.startsWith("__MACOSX") && /\.(usfm|sfm)$/i.test(n)).sort()){
      const head = dec.decode(files[nm].subarray(0, 4096));
      const code = (head.match(/^\\id[ \t]+(\S+)/m) || [])[1];
      if(!code || !USFM_BOOK[code.toUpperCase()]) continue;
      books++;
      let m;
      const h = (m = head.match(/^\\h[ \t]+([^\r\n]*)$/m)) ? _cleanTitle(m[1]) : "";
      const t1 = (m = head.match(/^\\toc1[ \t]+([^\r\n]*)$/m)) ? _cleanTitle(m[1]) : "";
      const t2 = (m = head.match(/^\\toc2[ \t]+([^\r\n]*)$/m)) ? _cleanTitle(m[1]) : "";
      const id = (m = head.match(/^\\id[ \t]+\S+[ \t]*(?:[-\u2013\u2014:][ \t]*)?([^\r\n]*)$/m)) ? _cleanTitle(m[1]) : "";
      if(id && ![h, t1, t2, bookName(USFM_BOOK[code.toUpperCase()])].map(lc).includes(lc(id))) seen[id] = (seen[id] || 0) + 1;
    }
    let idT = null, best = 0;
    for(const t of Object.keys(seen)) if(seen[t] > best){ best = seen[t]; idT = t; }
    if(idT && !(best >= 2 || books === 1)) idT = null;
    const fromFile = _cleanTitle(String(fileName || "").replace(/\.(zip|usfm|sfm)$/i, ""));
    return idT || fromFile || "USFM Bible";
  }
  // Anything in a SQLite file that makes a plain SELECT do work the engine did not ask for. Refused outright:
  //   · a VIEW or TRIGGER (a recursive view in Details froze a desktop for 13.6 s from 8 KB);
  //   · a VIRTUAL table (FTS and the like; they cannot run arbitrary SQL, but nothing here needs one);
  //   · a GENERATED column (computed on every SELECT, e.g. length(hex(zeroblob(N))) in Details or Bible.Scripture);
  //   · a table or column whose NAME is not plain (letters, digits, underscore, space): names go into SQL, and
  //     the builders quote them now, but a module whose names are code is not a MySword module.
  // The database is CLOSED again before this returns (sql.js keeps a closed-over copy of the file in memory until
  // it is, and an 8 MB Bible leaked 8.5 MB per attempt).
  const _PLAIN_NAME = /^[A-Za-z0-9_ ]+$/;
  async function _sqliteUnsafe(dbBytes){
    const SQL = await initSqlJs({ locateFile: f => SQLJS_BASE + f });
    const sdb = new SQL.Database(dbBytes);
    const q = (sql) => { const st = sdb.prepare(sql); const o = []; while(st.step()) o.push(st.getAsObject()); st.free(); return o; };
    try{
      for(const r of q("SELECT type, name, sql FROM sqlite_master")){
        if(r.type === "view" || r.type === "trigger") return true;
        if(r.type === "table"){
          if(/^\s*CREATE\s+VIRTUAL\b/i.test(String(r.sql || ""))) return true;
          if(!_PLAIN_NAME.test(String(r.name))) return true;
          if(/^sqlite_/i.test(String(r.name))) continue;
          for(const c of q("PRAGMA table_xinfo(" + qid(r.name) + ")")){
            if(!_PLAIN_NAME.test(String(c.name)) || c.hidden === 2 || c.hidden === 3) return true;
          }
        }
      }
      return false;
    } finally { try{ sdb.close(); }catch(e){} }
  }
  // What loadModuleBytes WOULD make of these bytes, without registering anything: its kind, the name and
  // abbreviation it would register under, and the extension the stored copy gets. Mirrors loadModuleBytes'
  // own branches; anything it would refuse returns null (and loadModuleBytes would throw on it too).
  async function _peekDb(dbBytes, fb){
    const db = await openDb(dbBytes);
    try{
      if(db.has("Bible")){ const d = detailsOf(db, fb); return { kind: "bible", abbr: d.abbr, name: d.name }; }
      const cmt = buildCommentaryFromDb(db, fb);
      if(cmt) return { kind: "comment", abbr: cmt.abbr, name: cmt.name };
      if(db.tables.find(x => /dictionary/i.test(x))){
        const d = db.has("Details") ? detailsOf(db, "") : null;
        const abbr = (d && d.abbr && d.abbr !== "Bible") ? d.abbr : "Dict";
        return { kind: "dict", abbr, name: (d && d.name && d.name !== "Module") ? d.name : abbr };
      }
      return null;
    } finally { db.close(); }   // the peek only READS the names; the module itself is opened (and kept) by loadModuleBytes
  }
  const _DBEXT = { bible: ".bbl.mybible", comment: ".cmt.mybible", dict: ".dct.mybible" };
  async function _peekModule(u8, hint, preFiles){
    const fb = String(hint || "");
    if(isSqlite(u8)){
      if(await _sqliteUnsafe(u8)) return { unsafe: true };
      const p = await _peekDb(u8, fb);
      return p && { ...p, ext: _DBEXT[p.kind] };
    }
    if(isZip(u8)){
      // the zip is read ONCE, bounded, by _zipExtract; the same entries go on to loadModuleBytes (peek.files)
      let files = preFiles;
      if(!files){ const x = _zipExtract(u8); if(x.refuse) return { unsafe: true }; files = x.files; }
      const names = Object.keys(files).filter(n => !n.startsWith("__MACOSX"));
      const dbNames = names.filter(n => DB_NAME_RE.test(n));
      const sqliteNames = dbNames.length ? dbNames.filter(n => isSqlite(files[n])) : names.filter(n => isSqlite(files[n]));
      for(const n of sqliteNames) if(await _sqliteUnsafe(files[n])) return { unsafe: true };
      const dbName = names.find(n => DB_NAME_RE.test(n)) || names.find(n => isSqlite(files[n]));
      if(dbName){ const p = await _peekDb(files[dbName], fb); return p && { ...p, ext: _DBEXT[p.kind] + ".zip", files }; }
      const name = _usfmName(files, fb);
      return { kind: "bible", abbr: _deriveAbbr(name), name, ext: ".zip", usfm: true, files };
    }
    const head = new TextDecoder().decode(u8.slice(0, 256));
    if(/\\id\s+\w+/.test(head) || /\\c\s+\d/.test(head)){
      const name = _usfmName({ "book.usfm": u8 }, fb);
      return { kind: "bible", abbr: _deriveAbbr(name), name, ext: ".usfm", usfm: true };
    }
    if(head.replace(/^﻿/, "").trimStart().charAt(0) === "{"){
      let parsed = null; try{ parsed = JSON.parse(new TextDecoder().decode(u8)); }catch(e){ parsed = null; }
      if(parsed && parsed.meta && parsed.meta.kind === "crossref" && parsed.refs && typeof parsed.refs === "object" && !Array.isArray(parsed.refs)){
        const abbr = String(parsed.meta.abbr || "TSK");
        return { kind: "crossref", abbr, name: String(parsed.meta.name || abbr), ext: ".json", parsed };
      }
    }
    return null;
  }
  const _CAT_OF_KIND = { bible: "bibles", comment: "commentaries", dict: "dictionaries", crossref: "crossrefs" };
  // Is this name or abbreviation already held — by a LOADED module of the same kind (the stores that REPLACE
  // on a clash), or by a CATALOGUE or eBible-mirror entry we publish (a file must not borrow a trusted Bible's name
  // even before that Bible is installed)? Compared on _nameKey, so an invisible character or a lookalike letter
  // does not make a different name.
  function _taken(kind, abbr, name, reserved){
    const K = _nameKey, ka = K(abbr), kn = K(name);
    const coll = kind === "bible" ? modules : kind === "comment" ? commentaries : kind === "crossref" ? crossrefs : null;
    let held = false;
    if(coll){
      for(const a of Object.keys(coll)){ if(K(a) === ka || K(coll[a].name) === kn) { held = true; break; } }
      if(kind === "crossref" && abbr === CROSSREF_ALL) held = true;
    } else if(kind === "dict") held = hasDict(abbr) || dicts.some(d => K(d.abbr) === ka);
    return held || reserved.has(ka) || reserved.has(kn);
  }
  async function _reservedNames(kind){
    const out = new Set(), cat = _CAT_OF_KIND[kind];
    const add = (it, abbrToo = true) => { if(it && catOf(it) === cat){ if(it.name) out.add(_nameKey(it.name)); if(abbrToo && it.abbr) out.add(_nameKey(it.abbr)); } };
    add(DEFAULT_MODULE); add(DEFAULT_LEXICON);
    try{ const c = await _catAns(); for(const g of (c && c.categories) || []) for(const it of (g.items || [])) if(it && it.kind !== "import") add(it); }catch(e){}
    // the 1,290 eBible translations the Library offers by name: a file must not wear one either
    if(kind === "bible"){ try{ const m = await _mirAns(); for(const it of (m && m.items) || []) add({ ...it, category: "bibles" }, false); }catch(e){} }   // NAMES only: 990 of its abbreviations are 3 letters or fewer (AMP, NT, RV...) and a genuine "Amplified Bible" must not be labelled for one
    return out;
  }
  async function _pinnedEntry(h){
    for(const it of [DEFAULT_MODULE, DEFAULT_LEXICON]) if(it.url && KNOWN_HASHES[it.url] === h) return it;
    try{ const c = await _catAns(); for(const g of (c && c.categories) || []) for(const it of (g.items || [])) if(it && it.sha256 && String(it.sha256).toLowerCase() === h) return it; }catch(e){}
    return null;
  }
  // take a just-loaded module back out of memory (no record, no bytes involved)
  function _undoLoaded(kind, abbr){
    if(kind === "bible"){ delete modules[abbr]; order = order.filter(a => a !== abbr); if(active === abbr) active = order[0] || null; }
    else if(kind === "comment") delete commentaries[abbr];
    else if(kind === "dict") removeDict(abbr);
    else if(kind === "crossref") delete crossrefs[abbr];
    notify();
  }
  const _fail = (reason) => ({ ok: false, reason });
  // ONE ZIP READER FOR EVERYTHING A MEMBER HANDS US (re-audit 3, A1). Twice the install check read a zip one way and the
  // loader read it another: first local headers against the central directory, then a classic end record against the
  // zip64 locator fflate prefers. Patching the check each time left the structure, so the structure is gone: nothing
  // on the member-file path calls fflate.unzipSync any more. _zipParse reads the central directory (and refuses
  // anything ambiguous), _zipExtract decodes every entry once, bounded by its declared size, and the entries it returns
  // are the ones the peek AND loadModuleBytes use. The check and the use are the same bytes because they are the same
  // call. Where the line falls: a HOSTED catalogue module (fetchAndCacheModule) and a catalogue-pinned copy still go
  // through loadModuleBytes' own unzipSync; those bytes come from our server or match a published hash.
  //
  // Refused (reason "unusable", or "too-big" for the size caps): no end record, MORE THAN ONE end record in the last 64 KB,
  // a zip64 locator (fflate's exact test: signature 0x07064b50 at end-20, which sends fflate to a second directory),
  // zip64 or multi-disk markers (a zip under 50 MB never needs them), the two entry counts disagreeing, more than 2,000
  // entries, a declared inflated total over 128 MB, an encrypted entry, a local header that is not where the
  // directory says, a method other than stored/deflate, a stored entry whose sizes differ, and a deflate stream that
  // yields more or fewer bytes than the directory declared.
  function _zipParse(u8){
    const bad = { refuse: "unusable" };
    const len = u8.length;
    if(len < 22) return bad;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1; const low = Math.max(0, len - 65558);
    for(let i = len - 22; i >= low; i--) if(dv.getUint32(i, true) === 0x06054b50){ if(e >= 0) return bad; e = i; }
    if(e < 0) return bad;
    if(e >= 20 && dv.getUint32(e - 20, true) === 0x07064b50) return bad;
    const count = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
    if(dv.getUint16(e + 8, true) !== count || dv.getUint16(e + 4, true) !== 0 || dv.getUint16(e + 6, true) !== 0) return bad;
    if(count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff || cdOff + cdSize > e) return bad;
    if(count > INSTALL_MAX_ENTRIES) return bad;
    const entries = []; let p = cdOff, total = 0;
    for(let i = 0; i < count; i++){
      if(p + 46 > len || dv.getUint32(p, true) !== 0x02014b50) return bad;
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      if(csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff || (flags & 1) || p + 46 + nl > len) return bad;
      total += usize;
      if(total > INSTALL_MAX_INFLATED) return { refuse: "too-big" };
      const nb = u8.subarray(p + 46, p + 46 + nl);
      entries.push({ name: (flags & 0x800) ? new TextDecoder("utf-8").decode(nb) : String.fromCharCode.apply(null, nb), method, csize, usize, lho });
      p += 46 + nl + xl + cl;
    }
    return { entries, dv };
  }
  // Inflate into a buffer of EXACTLY the declared size, in 8 KB pushes (a deflate stream cannot expand more than ~1000:1, so
  // each push is bounded work), and give up the moment the output would pass it. null on any failure.
  function _inflateExact(data, size){
    const out = new Uint8Array(size); let at = 0, over = false;
    const inf = new fflate.Inflate();
    inf.ondata = (chunk) => { if(at + chunk.length > size){ over = true; return; } out.set(chunk, at); at += chunk.length; };
    try{ for(let i = 0; i < data.length && !over; i += 8192) inf.push(data.subarray(i, Math.min(i + 8192, data.length)), i + 8192 >= data.length); }
    catch(e){ return null; }
    return (!over && at === size) ? out : null;
  }
  // -> { files: {name: Uint8Array} } or { refuse: "unusable" | "too-big" }. The only place a member's zip is decoded.
  function _zipExtract(u8){
    const z = _zipParse(u8);
    if(z.refuse) return z;
    const files = Object.create(null), dv = z.dv;
    // every entry's record (local header + data) must be its own bytes: 2,000 directory entries pointing at ONE deflate
    // stream decode it 2,000 times (a 108 KB file made 125 MB of decode on every boot; re-audit 3, L3)
    const spans = [];
    for(const en of z.entries){
      if(en.lho + 30 > u8.length || dv.getUint32(en.lho, true) !== 0x04034b50) return { refuse: "unusable" };
      en.start = en.lho + 30 + dv.getUint16(en.lho + 26, true) + dv.getUint16(en.lho + 28, true);
      if(en.start + en.csize > u8.length) return { refuse: "unusable" };
      spans.push([en.lho, en.start + en.csize]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    for(let i = 1; i < spans.length; i++) if(spans[i][0] < spans[i - 1][1]) return { refuse: "unusable" };
    for(const en of z.entries){
      const start = en.start;
      const data = u8.subarray(start, start + en.csize);
      if(en.method === 0){ if(en.csize !== en.usize) return { refuse: "unusable" }; files[en.name] = u8.slice(start, start + en.csize); }
      else if(en.method === 8){ const out = _inflateExact(data, en.usize); if(!out) return { refuse: "unusable" }; files[en.name] = out; }
      else return { refuse: "unusable" };
    }
    return { files };
  }
  let _installDepth = 0;      // installs in flight: the reconnect retry of autoLoad must not start a second default install under one
  // Registration is one at a time across file installs AND hosted ones (fetchAndCacheModule): the name check and
  // the registration it protects must not be interleaved with another module claiming the same name.
  let _regTail = Promise.resolve();
  function withReg(fn){ const run = _regTail.then(fn, fn); _regTail = run.then(() => {}, () => {}); return run; }
  async function _installOne(u8, hint){
    try{
      try{ await _bootDone; }catch(e){}
      if(!u8 || !u8.length) return _fail("unusable");
      if(u8.length > INSTALL_MAX_RAW) return _fail("too-big");
      hint = typeof hint === "string" ? hint : "";

      // BYTES FIRST. Identical bytes (or the pinned catalogue copy of them) are "already here" BEFORE anything is
      // parsed, so a re-delivered file costs a hash and nothing else.
      const h = await sha256hex(u8), h12 = h.slice(0, 12);
      const inst = getInstalled();
      const heldKey = async (url) => { if(!url || !inst[url]) return null; const b = await cacheGet(url); return b ? url : null; };
      let dupKey = null;
      for(const k of Object.keys(inst)) if(k.indexOf("imported/" + h12 + "/") === 0 && await heldKey(k)){ dupKey = k; break; }
      const pinned = await _pinnedEntry(h);
      if(!dupKey && pinned) dupKey = await heldKey(pinned.url);
      // the SAME bytes were stored and later quarantined: say so, never "already installed"
      if(dupKey && inst[dupKey].quarantined) return { ok: false, reason: "quarantined", name: inst[dupKey].name || inst[dupKey].abbr || dupKey };
      if(dupKey){ const r = inst[dupKey]; return { ok: true, already: true, kind: r.kind || (r.category === "commentaries" ? "comment" : r.category === "dictionaries" ? "dict" : r.category === "crossrefs" ? "crossref" : "bible"), abbr: r.abbr, name: r.name || r.abbr }; }
      // a record whose bytes are gone is stale: drop it so this install can stand in its place
      for(const k of Object.keys(inst)) if(k.indexOf("imported/" + h12 + "/") === 0){ const m = getInstalled(); delete m[k]; setInstalled(m); }

      let files = null;
      if(isZip(u8)){ const x = _zipExtract(u8); if(x.refuse) return _fail(x.refuse); files = x.files; }
      let peek = null;
      try{ peek = await _peekModule(u8, hint, files); }catch(e){ console.warn("install: not readable as a module", e); return _fail("unusable"); }
      if(!peek || peek.unsafe) return _fail("unusable");

      // names: a pinned copy takes its catalogue entry's; everything else may never take a held name
      let abbr = pinned ? pinned.abbr : peek.abbr, name = pinned ? pinned.name : peek.name;
      abbr = _cleanTitle(abbr).slice(0, 12) || "Module"; name = _cleanTitle(name) || abbr;
      // an object-prototype name would rewrite the store's prototype (modules["__proto__"] = ...)
      if(/^(__proto__|constructor|prototype)$/i.test(abbr) || /^(__proto__|constructor|prototype)$/i.test(name)) return _fail("unusable");
      const reserved = pinned ? new Set() : await _reservedNames(peek.kind);
      const cat = _CAT_OF_KIND[peek.kind];
      return await withReg(async () => {
        let renamed = false;
        if(_taken(peek.kind, abbr, name, reserved)){
          renamed = true;
          const a0 = abbr, n0 = name;
          abbr = a0 + "-F"; name = n0 + FROM_FILE;
          for(let i = 2; _taken(peek.kind, abbr, name, reserved) && i < 1000; i++){ abbr = a0 + "-F" + i; name = n0 + " (from a file " + i + ")"; }
        }
        // A cross-reference file names itself INSIDE the json, and loadCrossrefsJSON trusts that over any meta,
        // so a renamed one is rewritten (and the REWRITTEN bytes are what is saved, so a restart agrees).
        let bytes = u8;
        if(peek.kind === "crossref" && (renamed || abbr !== peek.abbr)){
          const p = peek.parsed; p.meta = { ...p.meta, abbr, name };
          bytes = new TextEncoder().encode(JSON.stringify(p));
        }
        let r;
        try{ r = await loadModuleBytes(bytes, hint, { abbr, name, category: cat }, peek.files); }
        catch(e){ console.warn("install: loadModuleBytes refused the file", e); return _fail("unusable"); }
        if(!r || !r.abbr) return _fail("unusable");
        const shown = (r.kind === "bible" && modules[r.abbr] && modules[r.abbr].name) || (r.kind === "comment" && commentaries[r.abbr] && commentaries[r.abbr].name)
          || (r.kind === "crossref" && crossrefs[r.abbr] && crossrefs[r.abbr].name) || name;
        // Bytes that ARE a catalogue module (pinned) are filed as that catalogue module, so the Library shows it
        // Installed and can never offer "Get" for a second copy (audit L2). Anything else goes under imported/.
        const asCatalogue = !!(pinned && !renamed && bytes === u8 && pinned.url && catOf(pinned) === cat);   // only the very bytes that were received: a rewritten file is not the catalogue's pinned copy
        const key = asCatalogue ? pinned.url : "imported/" + h12 + "/" + _cleanFileName(hint || shown) + peek.ext;
        // SAVE FIRST. Only then does a record exist.
        try{ await cachePut(key, bytes); }
        catch(e){ console.warn("install: cachePut failed (full phone?)", e); _undoLoaded(r.kind, r.abbr); return _fail("no-space"); }
        recordInstalled(asCatalogue
          ? { url: key, id: pinned.id, abbr: r.abbr, name: shown, kind: r.kind, format: pinned.format, category: cat }
          : { url: key, id: r.abbr, abbr: r.abbr, name: shown, kind: r.kind, category: cat });
        if(!isInstalled(key)){ await cacheDelete(key); _undoLoaded(r.kind, r.abbr); return _fail("no-space"); }
        { const m = getInstalled(); if(m[key]){ m[key].checked = true; setInstalled(m); } }   // it passed the unsafe-file check above: boot need not repeat it
        noteLoadedFrom(key, r.abbr, cat);
        notify();
        return { ok: true, kind: r.kind, abbr: r.abbr, name: shown, renamed };
      });
    }catch(e){ console.error(e); return _fail("failed"); }
  }
  function installFromBytes(u8, hint){
    const run = async () => { _installDepth++; try{ return await _installOne(u8, hint); } finally { _installDepth--; } };
    const p = _installChain.then(run, run);
    _installChain = p.then(() => {}, () => {});
    return p;
  }

  // ── hidden file input (the browser's own picker; no `accept`, MySword files have no registered type) ──
  let fileInput = null, loadingFlag = false;
  function ensureInput(){
    if(fileInput) return fileInput;
    fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.style.display = "none";
    fileInput.addEventListener("change", async e => {
      const f = e.target.files[0]; e.target.value = "";
      if(!f) return;
      loadingFlag = true; notify();
      _emitFile({ phase: "installing" });
      let result;
      try{
        result = (f.size > INSTALL_MAX_RAW) ? _fail("too-big") : await installFromBytes(new Uint8Array(await f.arrayBuffer()), f.name);
      }catch(err){ console.error(err); result = _fail("failed"); }
      finally{ loadingFlag = false; notify(); }
      _emitFile({ phase: "result", result });
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
    if(cat === "bibles" && active && isTheActiveBible && !(meta && meta.quarantined)) return false;   // a quarantined record never loaded, so it is never "the Bible being read" even if a loaded one shares its abbreviation
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
    const loadedHere = !url || (!(meta && meta.quarantined) && (!here || here === url));   // a quarantined record never loaded: nothing in memory is its own
    if(loadedHere){
      if(meta && meta.kind === "worddef") removeWorddefs(abbr);
      else if(meta && meta.kind === "original") removeOriginal(abbr);
      else if(cat === "commentaries") delete commentaries[abbr];
      else if(cat === "dictionaries") removeDict(abbr, url);
      else if(cat === "crossrefs") delete crossrefs[abbr];
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
  // First chapter of a book that this Bible really HAS text for (a partial Bible - a draft, a portion, a single chapter - need not
  // start at 1), or null. Used by the reader's "not in this Bible" screen and by "Read it now" after an install.
  function firstChapter(b, version){ const n = maxChapter(b, version); for(let c = 1; c <= n; c++){ try{ if(getVerses(b, c, version).length) return c; }catch(e){} } return null; }
  // A passage THIS Bible has: `loc` itself if it has text there, else that book's first chapter, else its first book's first chapter.
  function passageFor(version, loc){
    try{
      if(loc && loc.book != null && loc.chap != null && getVerses(loc.book, loc.chap, version).length) return { book: loc.book, chap: loc.chap };
      const bs = books(version);
      if(loc && bs.indexOf(loc.book) >= 0){ const c = firstChapter(loc.book, version); if(c != null) return { book: loc.book, chap: c }; }
      for(const b of bs){ const c = firstChapter(b, version); if(c != null) return { book: b, chap: c }; }
    }catch(e){}
    return null;
  }
  // commentary for a passage: installed commentary modules + footnotes baked into the active Bible
  function getCommentary(b, c, version){
    const out = [];
    // `license` rides along with the block, not fetched separately by the panel: the notice has to appear
    // WHEREVER these words appear, and one object per source is the only shape in which the panel cannot
    // draw a module's words without its credit beside them.
    for(const abbr in commentaries){ const s = commentaries[abbr]; let rows = []; try { rows = s.getComment(b, c); } catch(e){} if(rows && rows.length) out.push({ abbr, name: s.name, kind: "module", license: s.license || "", imported: typeof urlOf !== "undefined" && String(urlOf["commentaries|" + abbr] || "").indexOf("imported/") === 0, rows }); }
    const s = src(version);
    if(s && s.footnotes){ let fn = []; try { fn = s.footnotes(b, c); } catch(e){} if(fn.length) out.push({ abbr: s.abbr, name: s.name + " — footnotes", kind: "footnotes", rows: fn.map(f => ({ v: f.v, vTo: f.v, html: f.notes.map(t => "<p>" + t + "</p>").join("") })) }); }
    return out;
  }
  function commentaryList(version){ const out = Object.keys(commentaries).map(a => ({ abbr: a, name: commentaries[a].name })); const s = src(version); if(s && s.footnotes) out.push({ abbr: s.abbr, name: s.name + " — footnotes" }); return out; }

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
  // The lists are NETWORK reads (catalog.json, and the 414 KB eBible mirror list). A member's own imported file must never wait
  // on them, and nothing may wait on them for ever: a list that has not answered in LIST_WAIT_MS counts as unreadable.
  const LIST_WAIT_MS = 6000;
  const _within = (p, ms, fallback) => new Promise((res) => { const t = setTimeout(() => res(fallback), ms); Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(fallback); }); });
  // ONE bounded answer per list per boot. restoreInstalled sets _bootLists; every reader of a list during the boot (the pin
  // list, the link check, the readable check, reserved names) shares that one promise, so a catalogue that never answers costs
  // ONE LIST_WAIT_MS in total, not one per record, and every record sees the SAME answer (a record cannot be judged "not ours"
  // by a timed-out read and then "readable" by a later one). Outside the boot each call is its own bounded read.
  let _bootLists = null;
  const _catAns = () => { const f = () => _within(getCatalog(), LIST_WAIT_MS, null); if(!_bootLists) return f(); return _bootLists.cat || (_bootLists.cat = f()); };
  const _mirAns = () => { const f = () => _within(getMirror(), LIST_WAIT_MS, null); if(!_bootLists) return f(); return _bootLists.mir || (_bootLists.mir = f()); };
  async function moduleLinkAllowed(url){
    if(typeof url !== "string" || !url) return false;
    if(url === DEFAULT_MODULE.url) return true;
    // An imported/ key is a member's own file and can never be published: answer at once, no list read. Before this, the member's
    // own Bible waited at every launch behind a 414 KB list download (10 s on the web build while it compiles, minutes on a thin
    // pipe, for ever if the connection hangs), and every record after it waited too.
    if(url.indexOf("imported/") === 0) return false;
    try{ const c = await _catAns(); for(const g of (c && c.categories) || []) for(const it of (g.items || [])) if(it && it.url === url) return true; }catch(e){}   // (an import ROW has no url, so no `kind` test is needed here)
    // the mirror's urls are all https: a relative url cannot be in it, so do not fetch it for one
    if(/^https?:/i.test(url)){ try{ const m = await _mirAns(); for(const it of (m && m.items) || []) if(it && it.url === url) return true; }catch(e){} }
    return false;
  }
  // Can we READ the lists that say what is ours? (getCatalog resolves {categories:[]} on failure, getMirror null.)
  async function _listsReadable(){
    try{
      const c = await _catAns(); if(!(c && (c.categories || []).length)) return false;
      const m = await _mirAns(); return !!(m && (m.items || []).length);
    }catch(e){ return false; }
  }
  // told by event if the app is already listening, else kept for takeLinkNotice() at mount (same shape as the quarantine notice)
  let _linkRefusedPending = false;
  const _linkRefusedSeen = new Set();   // reconnecting with no Bible loaded re-runs autoLoad on the SAME query string: once per link, not once per reconnect
  function _noteLinkRefused(url){ if(_linkRefusedSeen.has(url)) return; _linkRefusedSeen.add(url); if(_fileSubs.size) _emitFile({ phase: "link-refused" }); else _linkRefusedPending = true; }
  function takeLinkNotice(){ const v = _linkRefusedPending; _linkRefusedPending = false; return v; }
  async function autoLoad(){
    loadingFlag = true; notify();
    _bootLists = {};
    try{ await restoreInstalled(); }catch(e){ console.error(e); }
    finally{ _bootLists = null; }
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
    // ?module=<url> OPENS ONLY WHAT WE PUBLISH (owner decision 2026-11-16). A link is a way to make a phone fetch somebody
    // else's file, with no pin, from any https host. It is now accepted for a url that is in catalog.json, in the eBible
    // mirror list the Library offers, or the default Bible; anything else is refused BEFORE a request is made, nothing is
    // saved, and the member is told in plain words (_noteLinkRefused). Nothing in the app builds such a link, so no flow of ours changes.
    if(url && !isInstalled(url) && !(await moduleLinkAllowed(url))){ _noteLinkRefused(url); }
    else if(url && !isInstalled(url)){
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
    loadModuleBytes, fetchAndCacheModule, loadAsset, assetCached, pickFile, exportModule, installFromBytes, onFileInstall, takeQuarantineNotices, takeLinkNotice,
    cacheKeys, getCatalog, getMirror, getVideos, installModule, removeModule, isInstalled, isInstalling, isLoaded,
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
    versions, books, maxChapter, getVerses, firstChapter, passageFor, getCommentary, commentaryList, getCrossRefs, crossrefLicense, crossrefList, getOriginal, originalList, hasOriginal, getDefinition, defineText, worddefsLicense, worddefsState, retryWorddefs, bookMeta, defaultLoc, step, refLabel, refKey, search, searchDict,
    _error: null
  };

  // kick off autoload once the DOM + CDN libs are present
  // installFromBytes waits on _bootDone, so a file opened on a cold start cannot race the boot restore
  if(document.readyState === "loading") _bootDone = new Promise(res => document.addEventListener("DOMContentLoaded", () => { autoLoad().then(res, res); }));
  else _bootDone = autoLoad().then(() => {}, () => {});

  // modules download on first run; if that first launch was offline, retry the moment we're back
  // online so the app self-heals into a readable state without a manual reload.
  if(typeof window !== "undefined") window.addEventListener("online", () => {
    // not while a file install is in flight (it would race the default install into two copies of one Bible), and
    // installFromBytes waits on the re-run exactly as on the first boot
    if(order.length === 0 && !loadingFlag && _installDepth === 0){ window.Bible._error = null; _bootDone = autoLoad().then(() => {}, () => {}); }
  });
})();
