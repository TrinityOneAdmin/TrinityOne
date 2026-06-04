#!/usr/bin/env python3
"""Snapshot Trinity Church Littlehampton's latest YouTube videos for TrinityOne.

Pulls YouTube's public per-channel RSS feed (no API key) and writes a bundled
../trinity-videos.json the Watch screen reads. The feed has no CORS headers, so
the browser dev build relies on this snapshot; inside the APK the Watch screen
can refresh live from the same feed via native HTTP.

Refresh:  python3 scripts/build-trinity-videos.py
"""
import html, json, os, re, sys, urllib.request
from datetime import date

CHANNEL_ID = "UCSwBP6jTFKyrY7dwXRxTlfQ"
HANDLE = "@trinitychurchlittlehampton"
CHANNEL_NAME = "Trinity Church Littlehampton"
AVATAR = "https://yt3.googleusercontent.com/uT3-eCozHx60U07RjdxHiS_08pEYd51lIvEz9nuhh5UEeSgPDU8A6uCtzkXDCipdm523u81lqg=s176-c-k-c0x00ffffff-no-rj"
FEED = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
OUT = os.path.join(os.path.dirname(__file__), "..", "trinity-videos.json")


def grab(pat, text, default=""):
    m = re.search(pat, text, re.S)
    return html.unescape(m.group(1).strip()) if m else default


def main():
    if "--xml" in sys.argv:
        xml = open(sys.argv[sys.argv.index("--xml") + 1], encoding="utf-8").read()
    else:
        print("fetching", FEED)
        req = urllib.request.Request(FEED, headers={"User-Agent": "Mozilla/5.0 trinityone"})
        xml = urllib.request.urlopen(req, timeout=40).read().decode("utf-8")

    videos = []
    for entry in re.findall(r"<entry>(.*?)</entry>", xml, re.S):
        vid = grab(r"<yt:videoId>([^<]+)</yt:videoId>", entry)
        if not vid:
            continue
        videos.append({
            "id": vid,
            "ytId": vid,
            "title": grab(r"<title>([^<]+)</title>", entry),
            "published": grab(r"<published>([^<]+)</published>", entry)[:10],
            "desc": grab(r"<media:description>(.*?)</media:description>", entry)[:600],
            "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        })
    # newest first
    videos.sort(key=lambda v: v["published"], reverse=True)

    out = {
        "channel": {
            "id": CHANNEL_ID, "name": CHANNEL_NAME, "handle": HANDLE,
            "avatar": AVATAR,
            "url": f"https://www.youtube.com/{HANDLE}",
            "feed": FEED,
        },
        "generated": date.today().isoformat(),
        "videos": videos,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {os.path.relpath(OUT)}: {len(videos)} videos")


if __name__ == "__main__":
    main()
