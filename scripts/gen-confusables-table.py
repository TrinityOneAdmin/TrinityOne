#!/usr/bin/env python3
"""Generate the confusables table embedded in engine.js (`const _CONF_DATA = "..."`).

WHY. engine.js compares the names of modules a member imports against the names of modules we publish, so that a file
cannot wear a trusted Bible's name ("King James Versiօn" with an Armenian o). It compares the UTS #39 "skeleton" of
each name. The mapping is the Unicode Consortium's data, not hand-written, and this script is how it is made.

SOURCE   https://www.unicode.org/Public/security/latest/confusables.txt   (Unicode Security Mechanisms, UTS #39)
VERSION  18.0.0  (file date 2026-08-06). A pinned copy is committed at scripts/data/confusables-18.0.txt, and its
         SHA-256 is pinned below, so the table is reproducible from this repository alone.
FILTER   keep only lines whose type is "MA" (mixed-script, any case), whose source is ONE character, whose prototype is
         made only of ASCII letters and digits, and whose source is not itself ASCII. Anything else (punctuation lookalikes,
         prototypes that are not ASCII) cannot make a name look like an ASCII one, and names are compared on letters and
         digits only. Plus the Latin SMALL CAPITALS below, which the Unicode file omits and which read as plain letters.
FORMAT   `prototype:hex,hex,...;prototype:...` sorted by prototype, then code point. Printed to stdout, no newline issues.

USE      python3 -I scripts/gen-confusables-table.py scripts/data/confusables-18.0.txt
         then paste the output between the quotes of `const _CONF_DATA = "..."` in engine.js. The test
         scripts/install-bible-from-file-reaudit2.test.mjs (A3) fails if engine.js and this script disagree.
To move to a newer Unicode version: download the new file, commit it under scripts/data/, change PINNED_SHA256 and the
version above, regenerate, and re-run the install-from-file tests.
Data (c) Unicode, Inc., used under the Unicode Terms of Use (https://www.unicode.org/terms_of_use.html).
"""
import hashlib, re, sys

PINNED_SHA256 = '6ed3ee967c9dfdf6677d563c9985182fbc50a2efb7d6059cd57b2e2ce18f5b92'   # scripts/data/confusables-18.0.txt
# LATIN LETTER SMALL CAPITAL x (U+0262, U+026A, U+0274, U+0280, U+028F, U+0299, U+029C, U+029F, U+1D00..U+1D22): listed
# explicitly, not read from this Python's unicodedata, so the output does not depend on the interpreter's Unicode version.
SMALL_CAPS = {0x262: 'g', 0x26a: 'i', 0x274: 'n', 0x280: 'r', 0x28f: 'y', 0x299: 'b', 0x29c: 'h', 0x29f: 'l',
              0x1d00: 'a', 0x1d04: 'c', 0x1d05: 'd', 0x1d07: 'e', 0x1d0a: 'j', 0x1d0b: 'k', 0x1d0d: 'm', 0x1d0f: 'o',
              0x1d18: 'p', 0x1d1b: 't', 0x1d1c: 'u', 0x1d20: 'v', 0x1d21: 'w', 0x1d22: 'z'}

def main(path):
    raw = open(path, 'rb').read()
    got = hashlib.sha256(raw).hexdigest()
    if got != PINNED_SHA256:
        sys.exit('input %s has sha256 %s, not the pinned %s' % (path, got, PINNED_SHA256))
    rows = {}
    for line in raw.decode('utf-8-sig').splitlines():
        if line.startswith('#') or not line.strip():
            continue
        parts = line.split(';')
        if len(parts) < 3 or parts[2].split('#')[0].strip() != 'MA':
            continue
        src = [int(x, 16) for x in parts[0].split()]
        target = ''.join(chr(int(x, 16)) for x in parts[1].split())
        if len(src) != 1 or not re.fullmatch(r'[A-Za-z0-9]+', target):
            continue
        rows[src[0]] = target
    for cp, letter in SMALL_CAPS.items():
        rows.setdefault(cp, letter)
    by = {}
    for cp, t in sorted(rows.items()):
        if cp >= 128:
            by.setdefault(t, []).append(cp)
    print(';'.join(t + ':' + ','.join('%x' % c for c in cps) for t, cps in sorted(by.items())))

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
