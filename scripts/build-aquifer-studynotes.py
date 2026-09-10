#!/usr/bin/env python3
"""Build a TrinityOne study-notes module from Aquifer Open Study Notes (CC BY-SA 4.0).

Source: github.com/BibleAquifer/AquiferOpenStudyNotes — one JSON file per Bible book
(`eng/json/01.content.json` … `66.content.json`), each an array of articles whose
`content` is ALREADY an HTML string and whose `associations.passage[]` carries
`BBBCCCVVV` verse keys. Their book numbering is 1-based and identical to ours
(`bookName = n => BOOK_NAMES[n - 1]`, engine.js:66), so no offset is applied — see
scripts/aquifer-study-notes-reach-the-study-panel.test.mjs, which proves that
against the engine's own book table rather than asserting it in a comment.

Output: modules/aquifer-osn-eng.cmt.mybible.zip — a MySword-style commentary SQLite
(Details + Commentary) zipped with the licence and attribution notices. That format
needs NO new loader code: engine.js's buildCommentaryFromDb (engine.js:268) sniffs
the column names and the zip branch of loadModuleBytes already finds a `*.mybible`
inside an archive.

The licence notice travels INSIDE the module, in Details.License, and the Study panel
displays it under each commentary's heading (owner decision 5, 2026-09-10).

Re-run:  python3 scripts/build-aquifer-studynotes.py
         python3 scripts/build-aquifer-studynotes.py --cache /some/dir   (reuse a download)

REPRODUCIBLE ON ONE TOOLCHAIN, NOT ON ALL OF THEM. Zip timestamps are fixed, so the same
notes in give the same bytes out -- verified twice on the box this was built on (Python
3.12.3, SQLite 3.45.1, zlib 1.3). Two of those three decide the bytes and neither is
recorded in the file: SQLite's VACUUM page layout and zlib's deflate output can both
change between versions. So a rebuild on a different machine may legitimately produce a
different SHA-256 from the one catalog.json pins. That is not a corruption. The recovery
is to paste the two fields this script prints at the end into catalog.json; the test in
scripts/aquifer-study-notes-reach-the-study-panel.test.mjs then goes green again.
"""
import json, os, re, shutil, sqlite3, sys, tempfile, urllib.request, zipfile
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = "https://raw.githubusercontent.com/BibleAquifer/AquiferOpenStudyNotes/main/eng/json/%02d.content.json"
BOOKS = range(1, 67)                       # 01 Genesis … 66 Revelation, one file each
OUT_ZIP = "modules/aquifer-osn-eng.cmt.mybible.zip"
DB_NAME = "aquifer-osn-eng.cmt.mybible"

NAME = "Aquifer Open Study Notes"
ABBR = "OSN"
# The one-line notice the Study panel shows under this module's heading. CC BY-SA 4.0 requires the
# author, the title, the licence, and — for an adaptation — a note of what it was adapted from. All four
# are here, taken verbatim from the source repository's own README rather than paraphrased.
LICENSE_LINE = ("Aquifer Open Study Notes © Mission Mutual · CC BY-SA 4.0 · an adaptation of "
                "Tyndale Open Study Notes © 2023 Tyndale House Publishers, also CC BY-SA 4.0")
# The fuller notice, shipped as a file inside the zip. CC BY-SA 4.0 obliges a redistributor to pass the
# licence on with the work, and anyone who ends up holding this file — a church mirroring modules/, an
# operator serving them off their own box, a member who loaded it from a file rather than the catalogue —
# has the whole notice in front of them without needing our catalogue or our app to read it.
LICENSE_FILE = """Aquifer Open Study Notes
========================

Aquifer Open Study Notes (c) Mission Mutual.
Licensed under the Creative Commons Attribution-ShareAlike 4.0 International licence
(CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/

This work is an adaptation of Tyndale Open Study Notes (c) 2023 Tyndale House Publishers,
licensed under CC BY-SA 4.0. The adaptation, Aquifer Open Study Notes, was created by
Mission Mutual and is also licensed under CC BY-SA 4.0.

Source: https://github.com/BibleAquifer/AquiferOpenStudyNotes

WHAT TRINITYONE CHANGED
-----------------------
Nothing in the words. This file is a container change only: the per-book JSON articles were
rewritten into a MySword-style SQLite commentary table keyed by book/chapter/verse, and the
HTML of each article was reduced to the tags TrinityOne's reader renders (engine.js
window.sanitizeHtml). Specifically:

  * attributes other than `class` were dropped -- the reader's sanitiser drops them anyway;
  * <data class="bible-ref"> and <data class="resource-ref"> cross-reference wrappers were
    unwrapped, keeping their text, because <data> is not a tag the reader renders;
  * <a> was unwrapped, keeping its text -- the reader's sanitiser removes <a> together with
    its contents, so leaving it in would have silently deleted the words inside it;
  * <h1>..<h6> became <p>, and elements left with no text at all were dropped.

No sentence, clause or word of the notes was added, removed or reordered.
"""


# ── HTML: emit exactly what the reader's sanitiser would keep ─────────────────────────────────────
# engine.js:8 window.sanitizeHtml whitelists these tags, drops <a>/<img>/<script>/... WITH their
# content, unwraps anything else, and strips every attribute but `class` and `data-s`. Doing that
# here rather than at read time means the bytes we ship are the bytes that render -- and it is where
# the module's size comes from: 8.30 MB of source HTML becomes 5.00 MB.
OK_TAG = {"span", "sup", "sub", "br", "em", "i", "b", "strong", "mark", "u", "p", "div",
          "blockquote", "ul", "ol", "li", "small", "wbr", "hr", "ruby", "rt"}
VOID = {"br", "hr", "wbr"}
# Unwrapped, KEEPING the text: <data> is Aquifer's cross-reference wrapper and <a> is a link. The
# reader shows neither, and for <a> the sanitiser would take the words with it.
UNWRAP = {"data", "a"}
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}


class Node:
    __slots__ = ("tag", "cls", "kids")

    def __init__(self, tag, cls=None):
        self.tag, self.cls, self.kids = tag, cls, []


class Rewriter(HTMLParser):
    """Parse the article HTML into a tree, applying the rules above, then serialise it back.

    A parser rather than a regex pass: <data> holds <em> and <span> children, <a> holds <span>,
    and pairing an opening tag with the right closing one through a string replace is exactly the
    kind of thing that silently eats half an article.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node(None)
        self.stack = [("", self.root)]      # (source tag name, node) so an end tag pops the RIGHT one

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        out = "p" if tag in HEADINGS else tag
        if out in UNWRAP or out not in OK_TAG:
            n = Node(None)                  # unwrap: keep the children, lose the wrapper
        else:
            cls = next((v for k, v in attrs if k.lower() == "class"), None)
            n = Node(out, cls or None)
        self.stack[-1][1].kids.append(n)
        if out not in VOID:
            self.stack.append((tag, n))

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if tag in OK_TAG:
            self.stack[-1][1].kids.append(Node(tag))

    def handle_endtag(self, tag):
        # Pop to the matching OPEN tag, not just "one level". A stray </br> or a mismatched close
        # would otherwise pop somebody else's element and reparent the rest of the article.
        tag = tag.lower()
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        if data:
            self.stack[-1][1].kids.append(data)


ESC = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}


def esc(s):
    return re.sub(r"[&<>]", lambda m: ESC[m.group(0)], s)


def has_content(n):
    """True if this subtree puts anything on the screen. Drops Aquifer's empty <h3></h3> pairs.

    A WHITESPACE-ONLY text node counts as content. It looks like nothing and is not: the single <a>
    in the English notes (1 Corinthians 11) wraps exactly `<span><em> </em></span>`, so a rule that
    called that empty would delete the space between two italicised phrases and join two words.
    """
    if isinstance(n, str):
        return n != ""
    if n.tag in VOID:
        return True
    return any(has_content(k) for k in n.kids)


def render(n):
    if isinstance(n, str):
        return esc(n)
    inner = "".join(render(k) for k in n.kids if has_content(k))
    if n.tag is None:
        return inner
    if n.tag in VOID:
        return "<%s>" % n.tag
    attr = ' class="%s"' % esc(n.cls) if n.cls else ""
    return "<%s%s>%s</%s>" % (n.tag, attr, inner, n.tag)


def clean_html(html):
    p = Rewriter()
    p.feed(html or "")
    p.close()
    out = render(p.root)
    # Collapse runs of ASCII whitespace only. `\s` would take U+00A0 with it, and Aquifer uses
    # &nbsp; deliberately — "1&nbsp;John 2:21" is a reference that must not wrap mid-name.
    return re.sub(r"[ \t\r\n\f\v]+", " ", out).strip()


# ── verse keys ────────────────────────────────────────────────────────────────────────────────────
DOT_BETWEEN_DIGITS = re.compile(r"(?<=\d)\.(?=\d)")


def ref_title(title):
    """An article title, tidied just enough to put on a member's screen.

    Aquifer writes the END of a chapter-crossing range with a period where a colon belongs:
    "John 13:31-17.26", "Genesis 1:1-2.3". 318 of the 16,923 English titles do it and every one is that
    same shape -- a range end, never a decimal, never an abbreviation. Only the five cross-book rows carry
    a title into the app (see build below), and one of them is "John 13:31-17.26", so left verbatim it is a
    visible typo at Luke 22:12. A period BETWEEN TWO DIGITS is the whole rule; the en dash, the book name
    and every other character are untouched, so this cannot turn a correct reference into a wrong one.
    """
    return DOT_BETWEEN_DIGITS.sub(":", (title or "").strip())


def decode_ref(s):
    """BBBCCCVVV -> (book, chapter, verse). '63001001' -> (63, 1, 1)."""
    n = int(s)
    return n // 1000000, (n // 1000) % 1000, n % 1000


def rows_for(passage):
    """One (book, chapter, fromverse, toverse) row per passage range.

    A range that crosses a chapter boundary (223 of the 16,923 English articles) is anchored at the
    chapter it OPENS in, with toverse=0 -- "from this verse on". It is not fanned out across the
    chapters it spans, because the verse range in each of those would need that chapter's length,
    which this data does not carry: a guessed `v1-3` label on a note about 1:1-2:3 would be a claim
    the source cannot support. Existing MySword commentaries behave the same way.

    THE PASSAGE DECIDES THE BOOK, NOT THE FILE NAME. FIVE ASSOCIATIONS ACROSS FOUR ARTICLES point
    into a different book from the file they sit in -- the note titled "Numbers 6:1-21" is
    associated with Acts 18:18 (Paul's vow), "Acts 14:4" with BOTH Luke 10:1 and Luke 10:17, which
    is why the counts differ. All four also carry their home-book association, so nothing is
    displaced: these are additive cross-references, and they are the source's own claims about
    where a note is worth reading. Honoured, not filtered -- owner decision 11. Filtering them out
    on "the file says Numbers" would be this converter overruling the data it is converting.
    Because a note from another book is otherwise a puzzle, build() prepends the article's own
    title to those five rows; see the lead-in below.
    """
    sb, sc, sv = decode_ref(passage["start_ref"])
    eb, ec, ev = decode_ref(passage["end_ref"])
    if eb != sb or ec != sc:
        return (sb, sc, sv, 0)
    return (sb, sc, sv, ev if ev >= sv else sv)


def load_book(n, cache):
    path = os.path.join(cache, "%02d.content.json" % n)
    if not os.path.exists(path):
        sys.stderr.write("downloading %02d ...\n" % n)
        urllib.request.urlretrieve(RAW % n, path)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def build(cache):
    # THE SQLITE IS SCRATCH, AND IT MUST NOT SURVIVE THE RUN. It is 5.75 MB, and the first version of this
    # function made a fresh mkdtemp every time and never removed it: eighteen runs while developing left
    # 127 MB in /tmp and filled the disk on this box, which then failed a rebuild inside `VACUUM` with
    # "database or disk is full" -- and because the build had already printed nothing and exited non-zero,
    # a sabotage measurement silently ran against the PREVIOUS module and reported the wrong answer. A
    # leaking build script is not a tidiness matter; it corrupted a result.
    os.makedirs(cache, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix="aquifer-osn-build-")
    try:
        return _build(cache, tmpdir)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _build(cache, tmpdir):
    dbpath = os.path.join(tmpdir, DB_NAME)
    con = sqlite3.connect(dbpath)
    con.executescript("""
        CREATE TABLE Details (Title TEXT, Abbreviation TEXT, Description TEXT, License TEXT);
        CREATE TABLE Commentary (Book INT, Chapter INT, FromVerse INT, ToVerse INT, Data TEXT);
    """)
    con.execute("INSERT INTO Details VALUES (?,?,?,?)", (NAME, ABBR, NAME, LICENSE_LINE))

    articles = rows = skipped = cross = 0
    for n in BOOKS:
        for a in load_book(n, cache):
            if (a.get("media_type") or "Text") != "Text":
                continue
            html = clean_html(a.get("content"))
            if not html:
                continue
            articles += 1
            ranges = (a.get("associations") or {}).get("passage") or []
            emitted = 0
            for pa in ranges:
                r = rows_for(pa)
                if not r:
                    continue
                # SAY WHERE A CROSS-BOOK NOTE CAME FROM. A row whose book is not the book this article
                # is filed under is a cross-reference (5 of them; see rows_for). Without its title, a
                # reader in Acts 18 gets a note about Nazirite vows labelled "v18" and no clue why, so
                # the article's own title -- "Numbers 6:1-21" -- goes above it and turns a puzzle into a
                # cross-reference. <p>, <small> and <strong> are all tags the reader renders, and the
                # title is escaped like any other text.
                body = html
                if r[0] != n:
                    title = esc(ref_title(a.get("title")))
                    if title:
                        cross += 1
                        body = "<p><small>From the note on <strong>%s</strong></small></p>%s" % (title, html)
                con.execute("INSERT INTO Commentary VALUES (?,?,?,?,?)", r + (body,))
                rows += 1
                emitted += 1
            if not emitted:
                skipped += 1
    # engine.js's getComment queries WHERE Book=? AND Chapter=? on every chapter turn.
    con.execute("CREATE INDEX ix_bc ON Commentary (Book, Chapter)")
    con.commit()
    con.execute("VACUUM")
    con.close()

    dest = os.path.join(ROOT, OUT_ZIP)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # DETERMINISTIC ZIP. zipfile.write() stamps each entry with the source file's mtime, and the SQLite is
    # built in a fresh temp directory every run — so the archive's bytes, and therefore its SHA-256, would
    # change on every rebuild even when not one word of the notes had. catalog.json pins that hash, so a
    # rebuild would silently invalidate the pin. Fixed timestamps make "same notes in, same file out" true.
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for nm, data in ((DB_NAME, open(dbpath, "rb").read()),
                         ("LICENCE-CC-BY-SA-4.0.txt", LICENSE_FILE.encode("utf-8"))):
            zi = zipfile.ZipInfo(nm, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data, compresslevel=9)
    raw = os.path.getsize(dbpath)
    zipped = os.path.getsize(dest)
    print("wrote %s — %d articles, %d rows (%d cross-book, titled), sqlite %.2f MB, zipped %.2f MB%s"
          % (OUT_ZIP, articles, rows, cross, raw / 1e6, zipped / 1e6,
             (" (%d articles had no usable passage reference)" % skipped) if skipped else ""))
    # catalog.json pins this download's hash (engine.js verifyIntegrity honours item.sha256), so a rebuild
    # has to update the entry. Print the two fields that move; a test asserts the catalog matches the file
    # on disk, so forgetting is a red test rather than a module that refuses to install on a phone.
    import hashlib
    digest = hashlib.sha256(open(dest, "rb").read()).hexdigest()
    print('  catalog.json:  "size": "%.1f MB",  "sha256": "%s"' % (zipped / 1e6, digest))


def main():
    cache = "/tmp/aquifer-osn-eng"
    if "--cache" in sys.argv:
        cache = sys.argv[sys.argv.index("--cache") + 1]
    build(cache)


if __name__ == "__main__":
    main()
