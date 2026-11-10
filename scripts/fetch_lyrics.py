#!/usr/bin/env python3
"""Fetch synced/plain lyrics for all tracks from LRCLIB and store in data/lyrics.json."""
import json, os, sys, time, urllib.request, urllib.parse
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")
LYRICS = os.path.join(BASE, "data", "lyrics.json")

def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "Jamukot/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")

def get_lyrics(artist, title):
    # try exact match first
    params = urllib.parse.urlencode({"artist_name": artist, "track_name": title})
    try:
        raw = fetch(f"https://lrclib.net/api/get?{params}")
        data = json.loads(raw)
        if data and (data.get("syncedLyrics") or data.get("plainLyrics")):
            return {"synced": data.get("syncedLyrics"), "plain": data.get("plainLyrics"), "duration": data.get("duration")}
    except Exception:
        pass
    # try search
    try:
        params = urllib.parse.urlencode({"artist_name": artist, "track_name": title})
        raw = fetch(f"https://lrclib.net/api/search?{params}")
        arr = json.loads(raw)
        if isinstance(arr, list):
            found = None
            for x in arr:
                if x.get("syncedLyrics"):
                    found = x; break
            if not found and arr:
                found = arr[0]
            if found and (found.get("syncedLyrics") or found.get("plainLyrics")):
                return {"synced": found.get("syncedLyrics"), "plain": found.get("plainLyrics"), "duration": found.get("duration")}
    except Exception:
        pass
    return None

def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    data = json.load(open(TRACKS, encoding="utf-8"))
    tracks = data["tracks"]
    if args.limit:
        tracks = tracks[:args.limit]

    # load existing lyrics
    lyrics = {}
    if os.path.exists(LYRICS):
        try:
            lyrics = json.load(open(LYRICS, encoding="utf-8"))
        except Exception:
            lyrics = {}

    found = 0
    missing = 0
    skipped = 0
    for i, t in enumerate(tracks, 1):
        tid = str(t["id"])
        if tid in lyrics and lyrics[tid]:
            skipped += 1
            continue
        artist = t.get("artist", "")
        title = t.get("title", "")
        print(f"[{i}/{len(tracks)}] {artist} - {title}...", end=" ", flush=True)
        result = get_lyrics(artist, title)
        if result:
            lyrics[tid] = result
            found += 1
            print("found" + (" (synced)" if result.get("synced") else " (plain)"))
        else:
            lyrics[tid] = None
            missing += 1
            print("not found")
        # save incrementally
        with open(LYRICS, "w", encoding="utf-8") as f:
            json.dump(lyrics, f, ensure_ascii=False, indent=2)
        time.sleep(0.3)  # be polite to LRCLIB

    print(f"\nDone. found={found} missing={missing} skipped={skipped} total={len(tracks)}")


if __name__ == "__main__":
    main()
PY