#!/usr/bin/env python3
"""Build the real public-domain Library catalog.

Fetches the 13 classic titles from Project Gutenberg, strips the PG boilerplate, splits
into chapters, and emits:
  - vendor/library/<id>.json.gz   full book (gzip) for on-demand download
  - vendor/library/index.js       sets window.TrinityLibrary = { available:[...], previews:{...} }
                                  (real first-chapter previews, small, loaded with the app)

Titles that don't resolve are skipped gracefully -- the app falls back to data.jsx BOOK_TEXT.
Re-run after editing the curated map. Offline-first: the app reads the vendored output, never
Gutenberg at runtime.
"""
import gzip, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "vendor", "library")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"

# id -> curated metadata + Project Gutenberg ebook number(s) to try (first that validates wins).
# `kw` = a keyword that must appear in the PG Title line (guards against a wrong id).
BOOKS = {
    "pilgrim":     {"name": "The Pilgrim's Progress", "author": "John Bunyan", "year": "1678", "kw": "pilgrim",     "gids": [131]},
    "paradise":    {"name": "Paradise Lost", "author": "John Milton", "year": "1667", "verse": True, "kw": "paradise", "gids": [26, 20]},
    "holywar":     {"name": "The Holy War", "author": "John Bunyan", "year": "1682", "kw": "holy war", "gids": [21459, 6049]},
    "confessions": {"name": "Confessions", "author": "Augustine of Hippo", "year": "397", "kw": "confession", "gids": [3296, 39597]},
    "grace":       {"name": "Grace Abounding", "author": "John Bunyan", "year": "1666", "kw": "grace abounding", "gids": [654]},
    "martyrs":     {"name": "Foxe's Book of Martyrs", "author": "John Foxe", "year": "1563", "kw": "martyrs", "gids": [22400, 576]},
    "imitation":   {"name": "The Imitation of Christ", "author": "Thomas a Kempis", "year": "1418", "kw": "imitation", "gids": [1653]},
    "presence":    {"name": "The Practice of the Presence of God", "author": "Brother Lawrence", "year": "1692", "kw": "presence of god", "gids": [5657, 4096]},
    "interior":    {"name": "The Interior Castle", "author": "Teresa of Avila", "year": "1577", "kw": "interior castle", "gids": [69770, 31840]},
    "institutes":  {"name": "Institutes of the Christian Religion", "author": "John Calvin", "year": "1536", "kw": "institutes", "gids": [45001]},
    "cityofgod":   {"name": "The City of God", "author": "Augustine of Hippo", "year": "426", "kw": "city of god", "gids": [45304, 45305]},
    "orthodoxy":   {"name": "Orthodoxy", "author": "G.K. Chesterton", "year": "1908", "kw": "orthodoxy", "gids": [16769, 130]},
    "pensees":     {"name": "Pensees", "author": "Blaise Pascal", "year": "1670", "kw": "pascal", "gids": [18269, 46921]},
}

PREVIEW_PARAS = 5     # paragraphs of the first chapter to keep as the in-app preview
MAX_CHAPTERS = 40     # safety cap

def fetch(gid):
    for url in (f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt",
                f"https://www.gutenberg.org/files/{gid}/{gid}-0.txt"):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            data = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
            if len(data) > 2000:
                return data
        except Exception:
            continue
    return None

def strip_boilerplate(text):
    s = re.search(r"\*\*\*\s*START OF TH[EIS].*?\*\*\*", text)
    e = re.search(r"\*\*\*\s*END OF TH[EIS].*?\*\*\*", text)
    if s:
        text = text[s.end():]
    if e:
        m = re.search(r"\*\*\*\s*END OF TH[EIS].*?\*\*\*", text)
        if m:
            text = text[:m.start()]
    return text.strip()

def to_paragraphs(text, verse):
    # normalize newlines; split on blank lines into paragraphs
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n[ \t]*\n", text)
    paras = []
    for b in blocks:
        b = b.strip("\n")
        if not b.strip():
            continue
        if verse:
            paras.append(b.rstrip())            # keep line breaks for poetry
        else:
            paras.append(re.sub(r"\s*\n\s*", " ", b).strip())  # unwrap prose lines
    return paras

CH_RE = re.compile(r"^\s*(chapter|book|part|stage|mansions?|the (first|second|third)|letter|meditation|psalm)\b[\s\w.,:'-]{0,60}$", re.I)

def chapterize(paras):
    chapters, cur = [], None
    for p in paras:
        head = len(p) <= 70 and CH_RE.match(p)
        if head:
            if cur and cur["body"]:
                chapters.append(cur)
            cur = {"title": re.sub(r"\s+", " ", p).strip(), "body": []}
        else:
            if cur is None:
                cur = {"title": "Opening", "body": []}
            cur["body"].append(p)
    if cur and cur["body"]:
        chapters.append(cur)
    # drop tiny leading front-matter chapters
    chapters = [c for c in chapters if len(" ".join(c["body"])) > 120][:MAX_CHAPTERS]
    if not chapters:
        chapters = [{"title": "The Book", "body": paras}]
    return chapters

def main():
    os.makedirs(OUT, exist_ok=True)
    available, previews = [], {}
    for bid, meta in BOOKS.items():
        raw = None
        for gid in meta["gids"]:
            t = fetch(gid)
            if t and meta["kw"] in t[:3000].lower():
                raw = t; used = gid; break
        if not raw:
            print(f"  SKIP  {bid:11s} (no Gutenberg match -> keeps data.jsx fallback)")
            continue
        verse = meta.get("verse", False)
        paras = to_paragraphs(strip_boilerplate(raw), verse)
        chapters = chapterize(paras)
        words = sum(len(" ".join(c["body"]).split()) for c in chapters)
        pages = max(8, round(words / 300))
        book = {"id": bid, "name": meta["name"], "author": meta["author"], "year": meta["year"],
                "verse": verse, "pages": pages, "source": f"Project Gutenberg #{used}", "chapters": chapters}
        with gzip.open(os.path.join(OUT, f"{bid}.json.gz"), "wt", encoding="utf-8") as f:
            json.dump(book, f, ensure_ascii=False)
        first = chapters[0]
        previews[bid] = {"chapter": first["title"], "body": first["body"][:PREVIEW_PARAS],
                         "pages": pages, "verse": verse, "source": book["source"]}
        available.append(bid)
        print(f"  OK    {bid:11s} PG#{used:<6d} {len(chapters):3d} chapters, ~{pages} pages, {words:,} words")

    idx = ("// Generated by scripts/build-library-catalog.py -- real public-domain Library content.\n"
           "// window.TrinityLibrary.previews = real first-chapter previews; full books are\n"
           "// vendor/library/<id>.json.gz, fetched + gunzipped on demand by the BookReader.\n"
           "window.TrinityLibrary = " + json.dumps({"available": available, "previews": previews}, ensure_ascii=False) + ";\n")
    with open(os.path.join(OUT, "index.js"), "w", encoding="utf-8") as f:
        f.write(idx)
    print(f"\n  wrote {len(available)}/{len(BOOKS)} books -> vendor/library/  (index.js {len(idx)//1024}KB)")

if __name__ == "__main__":
    main()
