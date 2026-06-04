#!/usr/bin/env python3
"""Build a compact, bundled eBible.org mirror index for TrinityOne.

Fetches eBible's machine-readable translations.csv, keeps only the entries that
are both `downloadable` and `Redistributable`, and writes ../ebible-catalog.json
— the deep "Browse by language" catalog the app loads inside the APK.

USFM zip URLs are derived directly:  https://ebible.org/Scriptures/{id}_usfm.zip

Re-run any time to refresh:  python3 scripts/build-ebible-catalog.py
"""
import csv, io, json, os, re, sys, urllib.request
from datetime import date

CSV_URL = "https://ebible.org/Scriptures/translations.csv"
ZIP_PATTERN = "https://ebible.org/Scriptures/{id}_usfm.zip"
OUT = os.path.join(os.path.dirname(__file__), "..", "ebible-catalog.json")


def truthy(v):
    return str(v).strip().lower() in ("true", "1", "yes")


def load_csv():
    # allow a local override for offline builds:  --csv /path/to/translations.csv
    if "--csv" in sys.argv:
        path = sys.argv[sys.argv.index("--csv") + 1]
        data = open(path, encoding="utf-8-sig").read()
    else:
        print("fetching", CSV_URL)
        req = urllib.request.Request(CSV_URL, headers={"User-Agent": "trinityone-catalog-builder"})
        data = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(data)))


def abbr_of(tid, short):
    # derive a compact version label, e.g. eng-asv->ASV, engBBE->BBE, kud->KUD.
    if "-" in tid or "_" in tid:
        tail = re.split(r"[-_]", tid, 1)[1]               # part after the separator
    else:
        # strip a leading 2-3 char language code only when an uppercase/digit
        # boundary follows (engBBE->BBE); otherwise keep the whole id (kud->KUD)
        m = re.match(r"^[a-z]{2,3}(?=[A-Z0-9])(.+)$", tid)
        tail = m.group(1) if m else tid
    tail = re.sub(r"[^A-Za-z0-9]", "", tail).upper()
    return (tail or tid.upper())[:8]


def scope_of(r):
    nt = int(r.get("NTbooks") or 0)
    ot = int(r.get("OTbooks") or 0)
    if ot >= 39 and nt >= 27:
        return "Full Bible"
    if nt >= 27:
        return "New Testament"
    if ot > 0 and nt == 0:
        return "Old Testament"
    return "Portions"


def main():
    rows = load_csv()
    items, lang_count = [], {}
    for r in rows:
        if not (truthy(r["downloadable"]) and truthy(r["Redistributable"])):
            continue
        tid = r["translationId"].strip()
        if not tid:
            continue
        lang = r["languageNameInEnglish"].strip() or r["languageName"].strip() or r["languageCode"]
        code = r["languageCode"].strip()
        items.append({
            "id": tid,
            "name": (r["title"].strip() or r["shortTitle"].strip() or tid),
            "abbr": abbr_of(tid, r["shortTitle"]),
            "lang": code,
            "langName": lang,
            "scope": scope_of(r),
            "dir": (r.get("textDirection") or "ltr").strip().lower() or "ltr",
            "license": (r["Copyright"].strip() or "see eBible.org"),
            "url": ZIP_PATTERN.format(id=tid),
            "kind": "bible",
            "format": "USFM",
        })
        lang_count[code] = lang_count.get(code, (lang, 0))
        lang_count[code] = (lang_count[code][0], lang_count[code][1] + 1)

    items.sort(key=lambda x: (x["langName"].lower(), x["name"].lower()))
    languages = sorted(
        [{"code": c, "name": n, "count": cnt} for c, (n, cnt) in lang_count.items()],
        key=lambda l: (-l["count"], l["name"].lower()),
    )
    out = {
        "source": "eBible.org",
        "note": "Redistributable, downloadable USFM translations. Downloads work inside the APK (native HTTP); CORS blocks the browser dev build.",
        "generated": date.today().isoformat(),
        "zipPattern": ZIP_PATTERN,
        "languages": languages,
        "items": items,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUT)
    print(f"wrote {os.path.relpath(OUT)}: {len(items)} translations across "
          f"{len(languages)} languages, {size/1024:.0f} KB")


if __name__ == "__main__":
    main()
