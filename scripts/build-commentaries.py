#!/usr/bin/env python3
"""Build real public-domain commentary modules for TrinityOne from the Free Use Bible API.

The engine already reads MySword .cmt.mybible SQLite natively (buildCommentaryFromDb in engine.js:
a `Commentary` table keyed by Book/Chapter/Verse + a `Details` table). So we fetch verse-level
commentary from https://bible.helloao.org and emit one .cmt.mybible per commentary into ../modules/,
then print catalog.json entries.

Usage:
  python3 scripts/build-commentaries.py                 # the curated starter set
  python3 scripts/build-commentaries.py matthew-henry   # one commentary
  python3 scripts/build-commentaries.py --books GEN,JHN matthew-henry   # a subset (quick test)
"""
import json, os, sqlite3, sys, time, html, urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://bible.helloao.org/api"
MODULES_DIR = os.path.join(os.path.dirname(__file__), "..", "modules")

# curated public-domain starter set (tyndale is CC-BY, left out of the default run)
STARTER = ["matthew-henry", "jamieson-fausset-brown", "adam-clarke"]
ABBR = {"matthew-henry": "MHC", "jamieson-fausset-brown": "JFB", "adam-clarke": "Clarke",
        "john-gill": "Gill", "keil-delitzsch": "K&D", "tyndale": "Tyndale"}

# USFM book code -> MySword book number (1-66) and standard chapter counts
BOOKS = [
    ("GEN",1,50),("EXO",2,40),("LEV",3,27),("NUM",4,36),("DEU",5,34),("JOS",6,24),("JDG",7,21),
    ("RUT",8,4),("1SA",9,31),("2SA",10,24),("1KI",11,22),("2KI",12,25),("1CH",13,29),("2CH",14,36),
    ("EZR",15,10),("NEH",16,13),("EST",17,10),("JOB",18,42),("PSA",19,150),("PRO",20,31),("ECC",21,12),
    ("SNG",22,8),("ISA",23,66),("JER",24,52),("LAM",25,5),("EZK",26,48),("DAN",27,12),("HOS",28,14),
    ("JOL",29,3),("AMO",30,9),("OBA",31,1),("JON",32,4),("MIC",33,7),("NAM",34,3),("HAB",35,3),
    ("ZEP",36,3),("HAG",37,2),("ZEC",38,14),("MAL",39,4),("MAT",40,28),("MRK",41,16),("LUK",42,24),
    ("JHN",43,21),("ACT",44,28),("ROM",45,16),("1CO",46,16),("2CO",47,13),("GAL",48,6),("EPH",49,6),
    ("PHP",50,4),("COL",51,4),("1TH",52,5),("2TH",53,3),("1TI",54,6),("2TI",55,4),("TIT",56,3),
    ("PHM",57,1),("HEB",58,13),("JAS",59,5),("1PE",60,5),("2PE",61,3),("1JN",62,5),("2JN",63,1),
    ("3JN",64,1),("JUD",65,1),("REV",66,22),
]
NUM = {c: n for c, n, _ in BOOKS}
CHAPS = {c: ch for c, _, ch in BOOKS}


def fetch(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1:
                return None
            time.sleep(0.6 * (i + 1))
    return None


def to_html(content):
    """A verse's content array -> sanitised-ish HTML paragraphs."""
    paras = []
    for item in (content or []):
        txt = item if isinstance(item, str) else (item.get("text", "") if isinstance(item, dict) else "")
        for line in str(txt).split("\n"):
            line = line.strip()
            if line:
                paras.append("<p>" + html.escape(line) + "</p>")
    return "".join(paras)


def fetch_chapter(cid, code, chap):
    j = fetch(f"{API}/c/{cid}/{code}/{chap}.json")
    if not j:
        return []
    ch = j.get("chapter", j) or {}
    rows = []
    intro = ch.get("introduction")
    if intro:
        rows.append((NUM[code], chap, 0, 0, "<p>" + html.escape(str(intro).strip()) + "</p>"))
    for item in (ch.get("content") or []):
        if isinstance(item, dict) and item.get("type") == "verse":
            v = int(item.get("number") or 0)
            h = to_html(item.get("content"))
            if h:
                rows.append((NUM[code], chap, v, v, h))
    return rows


def build(cid, present_books, want_codes):
    rows = []
    jobs = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = []
        for code in present_books:
            if want_codes and code not in want_codes:
                continue
            if code not in CHAPS:
                continue
            for chap in range(1, CHAPS[code] + 1):
                futs.append(ex.submit(fetch_chapter, cid, code, chap))
        done = 0
        for f in futs:
            rows.extend(f.result())
            done += 1
            if done % 100 == 0:
                print(f"  {cid}: {done}/{len(futs)} chapters", flush=True)
    path = os.path.join(MODULES_DIR, f"{cid}.cmt.mybible")
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE Details (Title TEXT, Abbreviation TEXT, Description TEXT)")
    name = cid.replace("-", " ").title() + " Commentary"
    db.execute("INSERT INTO Details VALUES (?,?,?)", (name, ABBR.get(cid, cid[:6]), name))
    db.execute("CREATE TABLE Commentary (Book INT, Chapter INT, FromVerse INT, ToVerse INT, Data TEXT)")
    db.executemany("INSERT INTO Commentary VALUES (?,?,?,?,?)", rows)
    db.execute("CREATE INDEX idx_bc ON Commentary (Book, Chapter)")
    db.commit()
    db.close()
    # ship zipped — commentary text compresses ~6x; the engine's isZip path opens the .mybible inside
    import zipfile
    zip_path = path + ".zip"
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.write(path, arcname=f"{cid}.cmt.mybible")
    os.remove(path)
    mb = os.path.getsize(zip_path) / 1e6
    print(f"✓ {zip_path}  ({len(rows)} entries, {mb:.1f} MB zipped)", flush=True)
    return {"id": cid, "name": name, "abbr": ABBR.get(cid, cid[:6]),
            "url": f"modules/{cid}.cmt.mybible.zip", "format": "MySword", "kind": "comment",
            "size": f"{mb:.1f} MB", "license": "Public Domain"}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    want_codes = None
    if "--books" in sys.argv:
        want_codes = set(sys.argv[sys.argv.index("--books") + 1].split(","))
        args = [a for a in args if a not in want_codes and "," not in a]
    targets = args or STARTER
    cat = []
    for cid in targets:
        books_j = fetch(f"{API}/c/{cid}/books.json")
        if not books_j:
            print(f"✗ {cid}: no books", flush=True)
            continue
        present = [b["id"] for b in (books_j.get("books") or books_j) if b.get("id") in NUM]
        print(f"building {cid} ({len(present)} books)…", flush=True)
        cat.append(build(cid, present, want_codes))
    print("\n=== catalog.json entries ===")
    print(json.dumps(cat, indent=1))


if __name__ == "__main__":
    main()
