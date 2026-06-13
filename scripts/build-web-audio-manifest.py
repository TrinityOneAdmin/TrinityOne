#!/usr/bin/env python3
# Regenerate web-audio-manifest.json — a static index of the public-domain World English Bible (WEB)
# audio (Michael Paul Johnson recordings, hosted by audiotreasure.com as full OT/NT zips). For each
# book/chapter it records [byteOffset, compressedSize] within the zip, so the app can range-fetch a
# single chapter and inflate it (raw DEFLATE) without downloading the whole 300/900 MB archive.
# Run when the source zips change (rare). Output is committed and shipped with the app.
import struct, re, json, os, sys, urllib.request

NTU = 'https://www.audiotreasure.com/content/WEBD_AT/zipfiles/WEB_NT_Audio.zip'
OTU = 'https://www.audiotreasure.com/content/WEBD_AT/zipfiles/WEB_OT_Audio.zip'

def _range(url, start, end=None):
    h = {'Range': 'bytes=%d-%s' % (start, '' if end is None else str(end))}
    return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120).read()

def _total(url):
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'Range': 'bytes=0-0'}), timeout=60)
    return int(r.headers['Content-Range'].split('/')[-1])

def parse(url):
    total = _total(url)
    tail = _range(url, max(0, total - 66000))            # EOCD (+ optional comment)
    k = tail.rfind(b'PK\x05\x06')
    assert k >= 0, 'no end-of-central-directory record'
    cdsize = struct.unpack('<I', tail[k + 12:k + 16])[0]
    cdoff = struct.unpack('<I', tail[k + 16:k + 20])[0]
    cd = _range(url, cdoff, cdoff + cdsize - 1)           # the complete central directory
    out, i = {}, 0
    while True:
        j = cd.find(b'PK\x01\x02', i)
        if j < 0 or j + 46 > len(cd):
            break
        compsize = struct.unpack('<I', cd[j + 20:j + 24])[0]
        nlen = struct.unpack('<H', cd[j + 28:j + 30])[0]
        off = struct.unpack('<I', cd[j + 42:j + 46])[0]
        name = cd[j + 46:j + 46 + nlen].decode('latin1', 'ignore')
        # filenames: "40_Matt_01.mp3", single-chapter "57_Philemon.mp3", "25_Lam5.mp3"
        m = re.match(r'^(\d+)_(.+?)\.mp3$', name)
        if m:
            book = int(m.group(1))
            ct = re.search(r'(\d+)$', m.group(2))
            chap = int(ct.group(1)) if ct else 1
            out.setdefault(book, {})[chap] = [off, compsize]
        i = j + 46 + nlen
    return out

def main():
    nt, ot = parse(NTU), parse(OTU)
    chapters = {}
    for b, ch in list(ot.items()) + list(nt.items()):
        chapters[str(b)] = {str(c): v for c, v in ch.items()}
    man = {'fmt': 1, 'codec': 'deflate', 'translation': 'WEB',
           'url': {'ot': OTU, 'nt': NTU}, 'chapters': chapters}
    dst = os.path.join(os.path.dirname(__file__), '..', 'web-audio-manifest.json')
    json.dump(man, open(dst, 'w'), separators=(',', ':'))
    total = sum(len(c) for c in chapters.values())
    print('books: %d  chapters: %d  -> %s (%d bytes)' % (len(chapters), total, os.path.basename(dst), os.path.getsize(dst)))
    if len(chapters) != 66 or total != 1189:
        print('WARNING: expected 66 books / 1189 chapters', file=sys.stderr)

if __name__ == '__main__':
    main()
