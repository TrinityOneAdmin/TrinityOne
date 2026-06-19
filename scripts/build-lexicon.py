#!/usr/bin/env python3
# Build the full Strong's Greek + Hebrew lexicon (complete 1890 definitions + etymology) from
# OpenScriptures (CC-BY-SA) into modules/strongs-dict.json. Replaces the shallow-gloss version.
#   python3 scripts/build-lexicon.py          # fetch from GitHub
#   python3 scripts/build-lexicon.py --local  # use /tmp/greek.js + /tmp/hebrew.js
import re, json, sys, os, urllib.request

SRC = {
    'greek':  'https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js',
    'hebrew': 'https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js',
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def clean(s):
    s = re.sub(r'<[^>]+>', '', s or '')          # strip any markup
    return re.sub(r'\s+', ' ', s).strip().strip(';').strip()

def short_of(defn):
    # brief gloss = the first clause of the full definition
    first = re.split(r'[;:]', defn, 1)[0].strip()
    return (first[:70] + '…') if len(first) > 72 else first

def load(which, local):
    if local:
        txt = open('/tmp/%s.js' % which, encoding='utf-8', errors='replace').read()
    else:
        sys.stderr.write('fetching %s…\n' % which)
        txt = urllib.request.urlopen(SRC[which], timeout=60).read().decode('utf-8', 'replace')
    obj = json.loads(re.search(r'=\s*(\{.*\})\s*;', txt, re.S).group(1))
    out = {}
    for sid, e in obj.items():
        defn = clean(e.get('strongs_def', ''))
        out[sid] = {
            'lemma': (e.get('lemma') or '').strip(),
            'translit': (e.get('translit') or e.get('xlit') or '').strip(),
            'gloss': short_of(defn),
            'short': short_of(defn),
            'def': defn,
            'deriv': clean(e.get('derivation', '')),
            'kjv': clean(e.get('kjv_def', '')),
        }
    return out

def main():
    local = '--local' in sys.argv
    entries = {}
    for which in ('hebrew', 'greek'):
        d = load(which, local)
        entries.update(d)
        sys.stderr.write('  %s: %d entries\n' % (which, len(d)))
    doc = {
        'name': "Strong's Greek & Hebrew Dictionary",
        'abbr': "Strong's",
        'license': "Public domain (1890). JSON: OpenScriptures, CC-BY-SA.",
        'entries': entries,
    }
    out = os.path.join(ROOT, 'modules', 'strongs-dict.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    sys.stderr.write('wrote %s (%d entries, %.1f MB)\n' % (out, len(entries), os.path.getsize(out) / 1e6))

if __name__ == '__main__':
    main()
