#!/usr/bin/env bash
# Disaster-archive layer: generate one .torrent per module file with a magnet URI.
# The app itself doesn't use these for active download (Blossom + multi-mirror http handle that);
# they exist so anyone can recover the public-domain module library off a torrent swarm if every
# TrinityOne mirror/relay went offline.
#
# Best-effort: if mktorrent isn't installed, this script warns and exits 0 — the release still
# proceeds; entries simply won't get a `magnet:` field, which is fine. To enable: `sudo apt
# install mktorrent`.
#
# Output:
#   modules/torrents/<file>.torrent       — the .torrent file itself
#   modules/torrents/<file>.torrent.magnet — the magnet URI (read by build-catalog.mjs)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v mktorrent >/dev/null 2>&1; then
  echo "⚠  mktorrent not installed — skipping torrent generation (apt install mktorrent to enable)."
  exit 0
fi

# Trackers we point swarms at. Use well-known open trackers — torrents are recoverable even if
# one tracker dies because each .torrent embeds the full list and DHT keeps swarms alive.
TRACKERS=(
  "udp://tracker.opentrackr.org:1337/announce"
  "udp://tracker.openbittorrent.com:6969/announce"
  "udp://tracker.torrent.eu.org:451/announce"
  "udp://open.demonii.com:1337/announce"
  "wss://tracker.openwebtorrent.com"
)

mkdir -p modules/torrents
TOUCHED=0
for f in modules/*; do
  [ -f "$f" ] || continue
  case "$f" in
    *.torrent|*.magnet) continue ;;        # skip outputs themselves
    modules/torrents/*) continue ;;
  esac
  base="$(basename "$f")"
  out="modules/torrents/$base.torrent"

  # Re-generate only if the source is newer than the torrent (avoid churning catalog every release).
  if [ -f "$out" ] && [ "$out" -nt "$f" ]; then continue; fi

  rm -f "$out"
  args=()
  for t in "${TRACKERS[@]}"; do args+=("-a" "$t"); done
  # -l 18 = piece size 2^18 = 256 KiB (good for our ~1-10 MB modules; small enough for many pieces).
  mktorrent "${args[@]}" -l 18 -o "$out" "$f" >/dev/null

  # Derive the info-hash + write the magnet sidecar that build-catalog.mjs reads.
  # The info-hash is sha1 of the bencoded 'info' dict; we use a tiny Python snippet rather than add
  # a Node bencode dep. Python 3 ships everywhere mktorrent does.
  magnet=$(python3 - "$out" <<'PY'
import sys, hashlib, urllib.parse, re
# SECURITY-AUDIT-2026-06-24 L2: bencode parser robustness.
#   • MAX_DEPTH guards against a hostile .torrent crafted with deep `l`/`d` nesting (no input cap
#     ⇒ Python RecursionError ⇒ release pipeline break). Today we only parse mktorrent's own output,
#     but the comment encouraged reuse — and that's exactly when this guard becomes load-bearing.
#   • After parse(), assert the cursor consumed the entire buffer. Trailing garbage = malformed
#     bencode; refusing it keeps the parser strict, not lenient.
MAX_DEPTH = 64
def bdecode(data):
    i = [0]
    def parse(depth=0):
        if depth > MAX_DEPTH:
            raise ValueError('bencode nesting too deep at %d' % i[0])
        c = data[i[0]:i[0]+1]
        if c == b'd':
            i[0]+=1; d={}
            while data[i[0]:i[0]+1] != b'e':
                k = parse(depth+1); v = parse(depth+1); d[k] = v
            i[0]+=1; return d
        if c == b'l':
            i[0]+=1; l=[]
            while data[i[0]:i[0]+1] != b'e':
                l.append(parse(depth+1))
            i[0]+=1; return l
        if c == b'i':
            i[0]+=1; end = data.index(b'e', i[0]); n=int(data[i[0]:end]); i[0]=end+1; return n
        if c.isdigit():
            end = data.index(b':', i[0]); n=int(data[i[0]:end]); i[0]=end+1+n; return data[end+1:end+1+n]
        raise ValueError('bad bencode at %d' % i[0])
    out = parse()
    if i[0] != len(data):
        raise ValueError('trailing garbage after bencode (parsed %d of %d bytes)' % (i[0], len(data)))
    return out

def bencode(o):
    if isinstance(o, int): return b'i' + str(o).encode() + b'e'
    if isinstance(o, bytes): return str(len(o)).encode() + b':' + o
    if isinstance(o, list): return b'l' + b''.join(bencode(x) for x in o) + b'e'
    if isinstance(o, dict):
        return b'd' + b''.join(bencode(k) + bencode(v) for k,v in sorted(o.items())) + b'e'
    raise TypeError(type(o))

data = open(sys.argv[1], 'rb').read()
t = bdecode(data)
ih = hashlib.sha1(bencode(t[b'info'])).hexdigest()
name = t[b'info'][b'name'].decode('utf-8', errors='replace')
trackers = []
if b'announce' in t: trackers.append(t[b'announce'].decode())
for tier in t.get(b'announce-list', []) or []:
    for tr in tier: trackers.append(tr.decode())
qs = urllib.parse.urlencode([('dn', name)] + [('tr', tr) for tr in trackers])
print(f'magnet:?xt=urn:btih:{ih}&{qs}')
PY
)
  echo "$magnet" > "$out.magnet"
  TOUCHED=$((TOUCHED+1))
done

echo "torrents: $TOUCHED file(s) (re)generated under modules/torrents/"
