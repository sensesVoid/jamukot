#!/usr/bin/env python3
"""Replace an existing track with a new one (delete old from R2, add new)."""
import argparse, json, os, sys, subprocess, glob, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from urllib.parse import quote, unquote
import boto3
from botocore.config import Config

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")
LIMIT_BYTES = int(9.5 * 1024 * 1024 * 1024)

def load_env():
    env = {}
    env_path = os.path.join(BASE, ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    return env

ENV = load_env()
ACCESS_KEY = ENV.get("Access_Key_ID") or ENV.get("R2_ACCESS_KEY_ID")
SECRET_KEY = ENV.get("Secret_Access_Key") or ENV.get("R2_SECRET_ACCESS_KEY")
BUCKET = ENV.get("R2_BUCKET", "jamukot-audio")
PUBLIC_URL = ENV.get("R2_PUBLIC_URL", "https://pub-f3f7d0214f7f488a9f393ca2dd122193.r2.dev")
ACCOUNT_ID = ENV.get("R2_ACCOUNT_ID", "5eaa981f4ddcdefe09597a949285c222")

s3 = boto3.client("s3", endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=ACCESS_KEY, aws_secret_access_key=SECRET_KEY,
    config=Config(signature_version="s3v4"), region_name="auto")

def sanitize(s):
    import re
    s = re.sub(r'[\\/:*?"<>|]', "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:120] or "track"

def find_ytdlp():
    import shutil
    for name in ("yt-dlp", "yt-dlp.exe"):
        p = shutil.which(name)
        if p:
            return [p]
    try:
        subprocess.run([sys.executable, "-c", "import yt_dlp"], check=True, capture_output=True)
        return [sys.executable, "-m", "yt_dlp"]
    except Exception:
        pass
    for c in ("python3", "python", "py"):
        exe = shutil.which(c)
        if not exe:
            continue
        try:
            subprocess.run([exe, "-c", "import yt_dlp"], check=True, capture_output=True)
            return [exe, "-m", "yt_dlp"]
        except Exception:
            continue
    raise SystemExit("yt-dlp not found")

def run(cmd):
    print(">", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout); print(r.stderr)
        raise SystemExit(f"Command failed")

def duration_of(path):
    r = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True)
    try:
        return round(float(r.stdout.strip()), 2)
    except ValueError:
        return 0.0

def load_tracks():
    with open(TRACKS, encoding="utf-8") as f:
        return json.load(f)

def save_tracks(data):
    with open(TRACKS, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--id", type=int)
    g.add_argument("--title")
    ap.add_argument("--artist")
    ap.add_argument("url")
    ap.add_argument("--new-title", required=True)
    ap.add_argument("--new-artist", required=True)
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()

    data = load_tracks()
    tracks = data["tracks"]
    candidates = []
    for t in tracks:
        if args.id is not None and t["id"] == args.id:
            candidates.append(t)
        elif args.title:
            if args.title.lower() in t["title"].lower():
                if args.artist and args.artist.lower() not in t["artist"].lower():
                    continue
                candidates.append(t)
    if len(candidates) == 0:
        print("Old track not found.")
        sys.exit(1)
    if len(candidates) > 1:
        print("Multiple matches found. Use --id to pick one:")
        for t in candidates:
            print(f"  id={t['id']}  {t['artist']} - {t['title']}")
        sys.exit(1)
    old = candidates[0]

    print(f"Replacing: {old['artist']} - {old['title']}  ->  {args.new_artist} - {args.new_title}")

    new_title = sanitize(args.new_title)
    new_artist = sanitize(args.new_artist)
    new_filename = f"{new_artist} - {new_title}.mp3"

    # download + compress
    tmp_base = os.path.join(BASE, ".download")
    for f in glob.glob(tmp_base + "*"):
        try: os.remove(f)
        except OSError: pass
    cmd = find_ytdlp() + ["-f", "bestaudio", "-o", tmp_base + ".%(ext)s", "--no-playlist",
           "--js-runtimes", "node", "--remote-components", "ejs:github"]
    cookies = os.environ.get("YOUTUBE_COOKIES_FILE")
    if cookies and os.path.exists(cookies):
        cmd += ["--cookies", cookies]
    cmd.append(args.url)
    run(cmd)
    cands = [f for f in glob.glob(tmp_base + ".*")]
    if not cands:
        raise SystemExit("Download produced no file")
    src = cands[0]
    tmp_mp3 = os.path.join(BASE, ".compressed.mp3")
    run(["ffmpeg", "-y", "-i", src, "-vn", "-map", "a", "-b:a", "128k", "-ar", "44100", tmp_mp3])
    try: os.remove(src)
    except OSError: pass

    size = os.path.getsize(tmp_mp3)
    total = sum(t.get("size", 0) for t in tracks) - old.get("size", 0)
    if total + size > LIMIT_BYTES:
        os.remove(tmp_mp3)
        print(f"Would exceed 9.5 GB limit. Delete a song first.")
        sys.exit(1)

    dur = duration_of(tmp_mp3)

    # delete old from R2
    old_key = unquote(old["url"].rsplit("/", 1)[-1])
    try:
        s3.delete_object(Bucket=BUCKET, Key=old_key)
        print(f"Deleted old from R2: {old_key}")
    except Exception as e:
        print(f"R2 delete warning: {e}")

    # upload new
    print(f"Uploading to R2: {new_filename}")
    s3.upload_file(tmp_mp3, BUCKET, new_filename, ExtraArgs={"ContentType": "audio/mpeg"})
    os.remove(tmp_mp3)

    new_url = PUBLIC_URL.rstrip("/") + "/" + quote(new_filename, safe="")

    # update entry
    old["title"] = new_title
    old["artist"] = new_artist
    old["url"] = new_url
    old["duration"] = dur
    old["size"] = size
    save_tracks(data)
    print(f"Replaced: {new_artist} - {new_title} ({dur}s, {size/1e6:.1f} MB)")

    if args.push:
        subprocess.run(["git", "add", "data/tracks.json"], cwd=BASE, check=True)
        subprocess.run(["git", "commit", "-m", f"Replace track: {old['artist']} - {old['title']} -> {new_artist} - {new_title}"], cwd=BASE, check=True)
        subprocess.run(["git", "push"], cwd=BASE, check=True)
        print("Pushed.")

if __name__ == "__main__":
    main()
