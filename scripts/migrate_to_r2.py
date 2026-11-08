#!/usr/bin/env python3
"""Upload all MP3s in AudioFile/ to Cloudflare R2, rewrite tracks.json with R2 URLs."""
import json, os, subprocess, sys, time
from urllib.parse import quote
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import requests

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(BASE, "AudioFile")
TRACKS = os.path.join(BASE, "data", "tracks.json")

env = {}
env_path = os.path.join(BASE, ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()

ACCESS_KEY = env.get("Access_Key_ID") or env.get("R2_ACCESS_KEY_ID")
SECRET_KEY = env.get("Secret_Access_Key") or env.get("R2_SECRET_ACCESS_KEY")
BUCKET = env.get("R2_BUCKET", "jamukot-audio")
PUBLIC_URL = env.get("R2_PUBLIC_URL", "https://pub-f3f7d0214f7f488a9f393ca2dd122193.r2.dev")
ACCOUNT_ID = env.get("R2_ACCOUNT_ID", "5eaa981f4ddcdefe09597a949285c222")
ENDPOINT = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"

if not ACCESS_KEY or not SECRET_KEY:
    print("Missing R2 credentials in .env")
    sys.exit(1)

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)

mp3s = sorted(f for f in os.listdir(AUDIO_DIR) if f.lower().endswith(".mp3"))
print(f"Found {len(mp3s)} mp3s to upload to bucket '{BUCKET}'")

tracks = []
uploaded = 0
skipped = 0
failed = 0
for i, name in enumerate(mp3s, 1):
    key = name
    target_url = PUBLIC_URL.rstrip("/") + "/" + quote(name, safe="")
    local_path = os.path.join(AUDIO_DIR, name)
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        exists = True
    except ClientError:
        exists = False
    if not exists:
        try:
            s3.upload_file(local_path, BUCKET, key, ExtraArgs={"ContentType": "audio/mpeg"})
            uploaded += 1
            print(f"[{i}/{len(mp3s)}] UPLOADED: {name}")
        except Exception as e:
            failed += 1
            print(f"[{i}/{len(mp3s)}] FAIL: {name} -> {e}")
            continue
    else:
        skipped += 1
        if i % 50 == 0:
            print(f"[{i}/{len(mp3s)}] exists (batch)")

    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", local_path],
            capture_output=True, text=True,
        )
        dur = round(float(r.stdout.strip()), 2)
    except ValueError:
        dur = 0.0

    stem = os.path.splitext(name)[0]
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
    else:
        artist, title = "Unknown", stem
    tracks.append({
        "id": i,
        "title": title.strip(),
        "artist": artist.strip(),
        "url": target_url,
        "duration": dur,
    })

with open(TRACKS, "w", encoding="utf-8") as f:
    json.dump({"tracks": tracks}, f, ensure_ascii=False, indent=2)

print(f"\nDone. uploaded={uploaded} skipped={skipped} failed={failed} tracks={len(tracks)}")
print(f"tracks.json written with R2 URLs.")
