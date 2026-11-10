#!/usr/bin/env python3
"""Verify every track's audio file exists, is non-empty, is Ogg Opus, and matches tracks.json."""
import json, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")


def main():
    with open(TRACKS, encoding="utf-8") as f:
        data = json.load(f)

    tracks = data.get("tracks", [])
    errors = []
    total = 0

    for t in tracks:
        url = t.get("url", "")
        if not url.startswith("audio/"):
            continue
        path = os.path.join(BASE, url.replace("/", os.sep))
        tid = t.get("id", "?")
        if not os.path.exists(path):
            errors.append(f"id={tid}: missing {url}")
            continue
        size = os.path.getsize(path)
        total += size
        if size == 0:
            errors.append(f"id={tid}: EMPTY {url}")
            continue
        with open(path, "rb") as f:
            magic = f.read(4)
        if magic != b"OggS":
            errors.append(f"id={tid}: bad magic {magic!r} in {url}")
        recorded = t.get("size")
        if recorded is not None and recorded != size:
            errors.append(f"id={tid}: size mismatch stored={recorded} actual={size}")

    print(f"checked {len(tracks)} tracks, {total / 1048576:.1f} MB")
    if errors:
        print(f"\n{len(errors)} PROBLEM(S):")
        for e in errors[:50]:
            print("  " + e)
        if len(errors) > 50:
            print(f"  ... and {len(errors) - 50} more")
        return 1
    print("all audio files OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
