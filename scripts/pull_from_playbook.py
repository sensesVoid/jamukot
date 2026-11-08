#!/usr/bin/env python3
"""Download all MP3s from Playbookwiki/gitgit4/audioFolder, compress to 128 kbps, save to AudioFile/."""
import json, os, subprocess, sys, time, urllib.request
import requests

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(BASE, "AudioFile")
API = "https://api.github.com/repos/Playbookwiki/gitgit4/contents/audioFolder"

os.makedirs(AUDIO_DIR, exist_ok=True)

# 1. list files (paginated)
print("Fetching file list...")
files = []
page = 1
while True:
    r = requests.get(API, params={"per_page": 1000, "page": page}, timeout=60)
    r.raise_for_status()
    batch = r.json()
    if not batch:
        break
    files.extend(batch)
    if len(batch) < 1000:
        break
    page += 1
mp3s = [f for f in files if f.get("name", "").lower().endswith(".mp3")]
print(f"Found {len(mp3s)} mp3 files")

ok = 0
skip = 0
fail = 0
for i, f in enumerate(mp3s, 1):
    name = f["name"]
    target = os.path.join(AUDIO_DIR, name)
    if os.path.exists(target) and os.path.getsize(target) > 0:
        print(f"[{i}/{len(mp3s)}] SKIP (exists): {name}")
        skip += 1
        continue
    url = f["download_url"]
    tmp = os.path.join(AUDIO_DIR, ".dl_" + str(i) + ".mp3")
    try:
        # download
        with requests.get(url, stream=True, timeout=120) as resp:
            resp.raise_for_status()
            with open(tmp, "wb") as fh:
                for chunk in resp.iter_content(chunk_size=65536):
                    if chunk:
                        fh.write(chunk)
        # compress
        subprocess.run(
            ["ffmpeg", "-y", "-i", tmp, "-vn", "-map", "a", "-b:a", "128k", "-ar", "44100", target],
            check=True, capture_output=True,
        )
        os.remove(tmp)
        ok += 1
        print(f"[{i}/{len(mp3s)}] OK: {name}")
    except Exception as e:
        fail += 1
        print(f"[{i}/{len(mp3s)}] FAIL: {name} -> {e}")
        try:
            if os.path.exists(tmp): os.remove(tmp)
            if os.path.exists(target): os.remove(target)
        except OSError:
            pass
    # small delay to be polite
    time.sleep(0.2)

print(f"\nDone. ok={ok} skip={skip} fail={fail}")
