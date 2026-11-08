#!/usr/bin/env python3
"""Download only MP3s missing from tracks.json, compress to 128k, upload to R2, append."""
import json, os, subprocess, sys, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from urllib.parse import quote, unquote
import requests, boto3
from botocore.config import Config

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")
API = "https://api.github.com/repos/Playbookwiki/gitgit4/contents/audioFolder"
LIMIT = int(9.5 * 1024 * 1024 * 1024)

def load_env():
    env = {}
    p = os.path.join(BASE, ".env")
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                line = line.strip()
                if line and "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    return env

ENV = load_env()
s3 = boto3.client("s3", endpoint_url="https://" + ENV["R2_ACCOUNT_ID"] + ".r2.cloudflarestorage.com",
    aws_access_key_id=ENV["Access_Key_ID"], aws_secret_access_key=ENV["Secret_Access_Key"],
    config=Config(signature_version="s3v4"), region_name="auto")
BUCKET = ENV["R2_BUCKET"]
PUBLIC = ENV["R2_PUBLIC_URL"].rstrip("/")

with open(TRACKS, encoding="utf-8") as f:
    data = json.load(f)
tracks = data.setdefault("tracks", [])
existing = set()
for t in tracks:
    u = t.get("url", "")
    if u:
        existing.add(unquote(u.rsplit("/", 1)[-1]))
total = sum(t.get("size", 0) for t in tracks)
print("Existing tracks:", len(tracks), "storage:", round(total/1e9, 2), "GB")

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
print("Source mp3s:", len(mp3s), "missing:", len([f for f in mp3s if f["name"] not in existing]))

def dur_of(path):
    r = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1", path], capture_output=True, text=True)
    try: return round(float(r.stdout.strip()), 2)
    except ValueError: return 0.0

ok = skip = fail = 0
for i, f in enumerate(mp3s, 1):
    name = f["name"]
    if name in existing:
        continue
    if total >= LIMIT:
        print("Storage limit reached. Stopping.")
        break
    tmp_src = os.path.join(BASE, ".pull_tmp")
    tmp_mp3 = os.path.join(BASE, ".pull_tmp.mp3")
    for p in (tmp_src, tmp_mp3):
        try: os.remove(p)
        except OSError: pass
    try:
        with requests.get(f["download_url"], stream=True, timeout=120) as resp:
            resp.raise_for_status()
            with open(tmp_src, "wb") as fh:
                for chunk in resp.iter_content(65536):
                    if chunk: fh.write(chunk)
        subprocess.run(["ffmpeg","-y","-i",tmp_src,"-vn","-map","a","-b:a","128k","-ar","44100",tmp_mp3], check=True, capture_output=True)
        size = os.path.getsize(tmp_mp3)
        if total + size > LIMIT:
            print("Would exceed limit; stopping.")
            break
        s3.upload_file(tmp_mp3, BUCKET, name, ExtraArgs={"ContentType": "audio/mpeg"})
        url = PUBLIC + "/" + quote(name, safe="")
        stem = os.path.splitext(name)[0]
        if " - " in stem:
            artist, title = stem.split(" - ", 1)
        else:
            artist, title = "Unknown", stem
        tracks.append({"id": (max((t.get("id",0) for t in tracks), default=0) + 1),
            "title": title.strip(), "artist": artist.strip(), "url": url,
            "duration": dur_of(tmp_mp3), "size": size})
        total += size
        ok += 1
        print(f"[{i}/{len(mp3s)}] ADDED: {name}")
    except Exception as e:
        fail += 1
        print(f"[{i}/{len(mp3s)}] FAIL: {name} -> {e}")
    finally:
        for p in (tmp_src, tmp_mp3):
            try: os.remove(p)
            except OSError: pass
    time.sleep(0.2)

with open(TRACKS, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print(f"Done. added={ok} failed={fail} total_tracks={len(tracks)} storage={total/1e9:.2f}GB")
