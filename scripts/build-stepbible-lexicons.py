#!/usr/bin/env python3
"""Build Strong's-keyed lexicon modules from STEPBible data (CC BY 4.0).

Source: github.com/STEPBible/STEPBible-Data — TBESG (Greek, Abbott-Smith based) and
TBESH (Hebrew, BDB based). Both key entries to *extended* Strong's numbers that are
backward-compatible with the original Strong's the reader taps.

Output: modules/lex-abbott-smith.json + modules/lex-bdb.json in the engine's dict
format ({name, abbr, license, entries:{ "G25": {lemma,translit,pos,short,def,gloss} }}).
Run once after a STEPBible update; not part of the release build. Re-run: python3 scripts/build-stepbible-lexicons.py
"""
import json, os, re, html, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/"
SOURCES = [
    {"url": RAW + "TBESG%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Greek%20-%20STEPBible.org%20CC%20BY.txt",
     "cache": "/tmp/tbesg.txt", "out": "modules/lex-abbott-smith.json",
     "name": "Abbott-Smith Greek Lexicon", "abbr": "AbbottSmith",
     "license": "CC BY 4.0 · STEPBible (Abbott-Smith)"},
    {"url": RAW + "TBESH%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Hebrew%20-%20STEPBible.org%20CC%20BY.txt",
     "cache": "/tmp/tbesh.txt", "out": "modules/lex-bdb.json",
     "name": "Brown-Driver-Briggs Hebrew Lexicon", "abbr": "BDB",
     "license": "CC BY 4.0 · STEPBible (BDB)"},
]

# POS code (e.g. "G:V", "H:N-M", "N:N-M-P") -> a friendly label, else "".
POS = {"V": "verb", "A": "adjective", "ADV": "adverb", "PREP": "preposition",
       "CONJ": "conjunction", "PRT": "particle", "INJ": "interjection", "T": "particle",
       "REL": "relative", "PRON": "pronoun", "N-M": "noun, masculine", "N-F": "noun, feminine",
       "N-N": "noun, neuter", "N-M-P": "proper noun", "N-F-P": "proper noun",
       "N-LI": "noun", "N--T": "noun", "N--L": "proper noun, place"}

def friendly_pos(code):
    if not code or ":" not in code:
        return ""
    tail = code.split(":", 1)[1].strip()
    if tail in POS:
        return POS[tail]
    if tail.startswith("N-") and tail.endswith("-P"):
        return "proper noun"
    if tail.startswith("N-M"):
        return "noun, masculine"
    if tail.startswith("N-F"):
        return "noun, feminine"
    if tail.startswith("N-N"):
        return "noun, neuter"
    if tail.startswith("N"):
        return "noun"
    return POS.get(tail.split("-")[0], "")

TAG = re.compile(r"</?(?:b|i|re|sup|small)>", re.I)
REF = re.compile(r"</?ref[^>]*>", re.I)
BR = re.compile(r"<\s*br\s*/?\s*>", re.I)
ANYTAG = re.compile(r"<[^>]+>")
WS = re.compile(r"[ \t]+")

def clean(htmltext):
    s = htmltext or ""
    s = BR.sub(" ", s)
    s = REF.sub("", s)        # drop the <ref> wrappers, keep the verse text inside
    s = TAG.sub("", s)
    s = ANYTAG.sub("", s)     # any stray markup
    s = html.unescape(s)
    s = s.replace("__", " ")  # STEPBible uses __ as a soft list marker
    s = WS.sub(" ", s).strip()
    return s

def norm_key(estrong):
    # G0025 -> G25 ; H0001 -> H1  (match the reader's original-Strong's tags)
    m = re.match(r"^([GH])0*([0-9]+)$", estrong)
    return (m.group(1) + m.group(2)) if m else None

def build(src):
    path = src["cache"]
    if not os.path.exists(path):
        sys.stderr.write("downloading %s ...\n" % src["out"])
        urllib.request.urlretrieve(src["url"], path)
    entries = {}
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 8:
                continue
            key = norm_key(cols[0].strip())
            if not key or key in entries:   # keep the first (base lexical) row per number
                continue
            lemma, translit, pos_code, gloss, definition = cols[3].strip(), cols[4].strip(), cols[5].strip(), cols[6].strip(), cols[7]
            if not lemma:
                continue
            e = {"lemma": lemma, "translit": translit}
            fp = friendly_pos(pos_code)
            if fp:
                e["pos"] = fp
            if gloss:
                e["short"] = gloss
                e["gloss"] = gloss
            d = clean(definition)
            if d:
                e["def"] = d
            entries[key] = e
    out = {"name": src["name"], "abbr": src["abbr"], "license": src["license"], "entries": entries}
    dest = os.path.join(ROOT, src["out"])
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("wrote %s — %d entries, %.1f MB" % (src["out"], len(entries), os.path.getsize(dest) / 1e6))

if __name__ == "__main__":
    for s in SOURCES:
        build(s)
