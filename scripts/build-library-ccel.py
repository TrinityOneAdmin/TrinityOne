#!/usr/bin/env python3
"""Build the Library catalog from the Christian Classics Ethereal Library (ccel.org).

CCEL is a curated library of *only* Christian classic texts (public domain). For each curated work we
fetch CCEL's structured ThML (XML) edition and turn it into chapters: each <div1>/<div2 title="...">
is a chapter, <p> are paragraphs, <note> footnotes are dropped. Emits the SAME output the BookReader
already reads:

  - vendor/library/<id>.json.gz   full book (gzip), downloaded on demand
  - vendor/library/index.js       window.TrinityLibrary = { available:[...], previews:{...} }

Offline-first: the app reads the vendored output, never CCEL at runtime. Re-run after editing BOOKS.
Pass ids as args to (re)build only those and merge into the existing catalog.
"""
import gzip, html, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "vendor", "library")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
SOURCE = "Christian Classics Ethereal Library"

# id -> curated metadata + CCEL path "<author>/<work>" (cache text lives at
# /ccel/<initial>/<author>/<work>/cache/<work>.txt). cat drives the library UI filter.
BOOKS = {
    "pilgrim":     {"name": "The Pilgrim's Progress", "author": "John Bunyan", "year": "1678", "cat": "Allegory", "path": "bunyan/pilgrim"},
    "holywar":     {"name": "The Holy War", "author": "John Bunyan", "year": "1682", "cat": "Allegory", "path": "bunyan/holy_war"},
    "grace":       {"name": "Grace Abounding to the Chief of Sinners", "author": "John Bunyan", "year": "1666", "cat": "Biography", "path": "bunyan/grace"},
    "confessions": {"name": "The Confessions", "author": "Augustine of Hippo", "year": "397", "cat": "Biography", "path": "augustine/confessions"},
    "doctrine":    {"name": "On Christian Doctrine", "author": "Augustine of Hippo", "year": "397", "cat": "Theology", "path": "augustine/doctrine"},
    "imitation":   {"name": "The Imitation of Christ", "author": "Thomas à Kempis", "year": "1418", "cat": "Devotional", "path": "kempis/imitation"},
    "presence":    {"name": "The Practice of the Presence of God", "author": "Brother Lawrence", "year": "1692", "cat": "Devotional", "path": "lawrence/practice"},
    "institutes":  {"name": "Institutes of the Christian Religion", "author": "John Calvin", "year": "1536", "cat": "Theology", "path": "calvin/institutes"},
    "incarnation": {"name": "On the Incarnation of the Word", "author": "Athanasius of Alexandria", "year": "318", "cat": "Theology", "path": "athanasius/incarnation"},
    "affections":  {"name": "A Treatise Concerning Religious Affections", "author": "Jonathan Edwards", "year": "1746", "cat": "Theology", "path": "edwards/affections"},
    "orthodoxy":   {"name": "Orthodoxy", "author": "G.K. Chesterton", "year": "1908", "cat": "Apologetics", "path": "chesterton/orthodoxy"},
    "pensees":     {"name": "Pensées", "author": "Blaise Pascal", "year": "1670", "cat": "Apologetics", "path": "pascal/pensees"},
    "interior":    {"name": "The Interior Castle", "author": "Teresa of Ávila", "year": "1577", "cat": "Devotional", "path": "teresa/castle2"},
    # NB: Spurgeon's "Morning and Evening" is a daily devotional (366 dated readings, not chapters) and
    # doesn't fit the chapter-book reader — left out here; it belongs in the devotional system instead.
    "schoolprayer":{"name": "With Christ in the School of Prayer", "author": "Andrew Murray", "year": "1885", "cat": "Devotional", "path": "murray/prayer"},
    "powerprayer": {"name": "Power Through Prayer", "author": "E.M. Bounds", "year": "1907", "cat": "Devotional", "path": "bounds/power"},
    "seriouscall": {"name": "A Serious Call to a Devout and Holy Life", "author": "William Law", "year": "1729", "cat": "Devotional", "path": "law/serious_call"},
    "saintsrest":  {"name": "The Saints' Everlasting Rest", "author": "Richard Baxter", "year": "1650", "cat": "Devotional", "path": "baxter/saints_rest"},
    "riseprogress":{"name": "The Rise and Progress of Religion in the Soul", "author": "Philip Doddridge", "year": "1745", "cat": "Devotional", "path": "doddridge/rise"},
    "crook":       {"name": "The Crook in the Lot", "author": "Thomas Boston", "year": "1737", "cat": "Devotional", "path": "boston/crook"},
    "wesley":      {"name": "Sermons on Several Occasions", "author": "John Wesley", "year": "1746", "cat": "Theology", "path": "wesley/sermons"},
    # ── Church Fathers (early church) ──
    "fathers":     {"name": "Early Christian Fathers", "author": "Clement, Ignatius, Polycarp & others", "year": "c. 95", "cat": "Church Fathers", "path": "richardson/fathers"},
    "tertullian":  {"name": "Tertullian: Apology & Writings", "author": "Tertullian", "year": "c. 197", "cat": "Church Fathers", "path": "tertullian/apology"},
    "apostolic":   {"name": "Apostolic Fathers, Justin Martyr & Irenaeus", "author": "Ante-Nicene Fathers", "year": "c. 150", "cat": "Church Fathers", "path": "schaff/anf01"},
    "enchiridion": {"name": "Handbook on Faith, Hope & Love", "author": "Augustine of Hippo", "year": "421", "cat": "Church Fathers", "path": "augustine/enchiridion"},
    "chrysostom":  {"name": "On the Priesthood", "author": "John Chrysostom", "year": "c. 388", "cat": "Church Fathers", "path": "schaff/npnf109"},
    "eusebius":    {"name": "The Church History", "author": "Eusebius of Caesarea", "year": "c. 324", "cat": "Church Fathers", "path": "schaff/npnf201"},
}

PREVIEW_PARAS = 5
MAX_CHAPTERS = 150
# div titles that are front/back matter, not reading chapters
SKIP_TITLES = {"", "title page", "contents", "copyright", "colophon", "indexes",
               "index of scripture references", "index of scripture commentary",
               "index of citations", "index of names", "index of subjects",
               "index of pages of the print edition", "about this document", "endnotes"}

def fetch(path):
    url = f"https://ccel.org/ccel/{path}.xml"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        data = urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "replace")
        return (data, url) if ("<ThML" in data[:400] or "<div" in data) else (None, url)
    except Exception:
        return None, url

def inline(s):
    s = re.sub(r"<[^>]+>", " ", s)          # drop inline tags (scripRef, span, i, note-marks…)
    s = html.unescape(s)
    s = s.replace("\xad", "")               # soft hyphens
    return re.sub(r"\s+", " ", s).strip()

# front/back matter to drop — normalised (lowercased, trailing punctuation stripped) + substrings
def is_skip(title):
    t = re.sub(r"[\s.,:;]+$", "", title.lower()).strip()
    if t in SKIP_TITLES:
        return True
    return any(s in t for s in ("title page", "select library", "library of the", "introductory note",
                                "translator's", "editor's preface", "bibliograph", "elucidation",
                                "prefatory", "publisher", "table of contents"))

# each <div1>/<div2 title="..."> starts a chapter; <p> are paragraphs; <note> footnotes dropped.
DIV_OR_P = re.compile(r'<div[12]\b[^>]*\btitle="([^"]*)"[^>]*>|<p\b[^>]*>(.*?)</p>', re.S | re.I)

def parse_thml(xml):
    m = re.search(r"<ThML\.body[^>]*>(.*)</ThML\.body>", xml, re.S | re.I)
    body = m.group(1) if m else xml
    body = re.sub(r"<note\b[^>]*>.*?</note>", "", body, flags=re.S | re.I)   # footnotes
    body = re.sub(r"<(pb|note)\b[^>]*/?>", "", body, flags=re.I)
    chapters, cur = [], None
    for tok in DIV_OR_P.finditer(body):
        title, para = tok.group(1), tok.group(2)
        if title is not None:
            t = inline(title)
            if is_skip(t):
                cur = None; continue
            if cur and cur["body"]:
                chapters.append(cur)
            cur = {"title": t, "body": []}
        else:
            txt = inline(para)
            if not txt:
                continue
            if cur is None:
                continue                 # drop paragraphs before the first real section (series/title pages)
            cur["body"].append(txt)
    if cur and cur["body"]:
        chapters.append(cur)
    chapters = [c for c in chapters if len(" ".join(c["body"])) > 200][:MAX_CHAPTERS]
    return chapters

def load_existing():
    try:
        txt = open(os.path.join(OUT, "index.js"), encoding="utf-8").read()
        obj = json.loads(re.search(r"window\.TrinityLibrary\s*=\s*(\{.*\});\s*$", txt, re.S).group(1))
        return list(obj.get("available", [])), dict(obj.get("previews", {}))
    except Exception:
        return [], {}

def main():
    os.makedirs(OUT, exist_ok=True)
    only = [a for a in sys.argv[1:] if a in BOOKS]
    if only:
        available, previews = load_existing()
        todo = {b: BOOKS[b] for b in only}
    else:
        available, previews = [], {}
        todo = BOOKS
    for bid, meta in todo.items():
        raw, url = fetch(meta["path"])
        if not raw:
            print(f"  SKIP  {bid:13s} (no CCEL ThML at {url})"); continue
        chapters = parse_thml(raw)
        if not chapters:
            print(f"  SKIP  {bid:13s} (parsed 0 chapters)"); continue
        words = sum(len(" ".join(c["body"]).split()) for c in chapters)
        pages = max(8, round(words / 300))
        book = {"id": bid, "name": meta["name"], "author": meta["author"], "year": meta["year"],
                "verse": False, "pages": pages, "source": SOURCE, "chapters": chapters}
        with gzip.open(os.path.join(OUT, f"{bid}.json.gz"), "wt", encoding="utf-8") as f:
            json.dump(book, f, ensure_ascii=False)
        first = chapters[0]
        previews[bid] = {"chapter": first["title"], "body": first["body"][:PREVIEW_PARAS],
                         "pages": pages, "verse": False, "year": meta["year"], "source": SOURCE}
        if bid not in available:
            available.append(bid)
        print(f"  OK    {bid:13s} {len(chapters):3d} chapters, ~{pages} pages, {words:,} words")
    idx = ("// Generated by scripts/build-library-ccel.py -- Christian Classics Ethereal Library content.\n"
           "// window.TrinityLibrary.previews = first-chapter previews; full books are\n"
           "// vendor/library/<id>.json.gz, fetched + gunzipped on demand by the BookReader.\n"
           "window.TrinityLibrary = " + json.dumps({"available": available, "previews": previews}, ensure_ascii=False) + ";\n")
    open(os.path.join(OUT, "index.js"), "w", encoding="utf-8").write(idx)
    print(f"\n  wrote {len(available)} books -> vendor/library/  (index.js {len(idx)//1024}KB)")

if __name__ == "__main__":
    main()
