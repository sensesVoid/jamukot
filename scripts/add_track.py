#!/usr/bin/env python3
"""Download a YouTube video, compress to 128kbps MP3, upload to Cloudflare R2, update tracks.json."""
import argparse, json, os, re, subprocess, sys, time, glob
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from urllib.parse import quote
import boto3
from botocore.config import Config

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")
LIMIT_BYTES = int(9.5 * 1024 * 1024 * 1024)  # 9.5 GB

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
PUBLIC_URL = ENV.get("R2_PUBLIC_URL", "https://jamukot-audio.originragnarok05.workers.dev")
ACCOUNT_ID = ENV.get("R2_ACCOUNT_ID", "5eaa981f4ddcdefe09597a949285c222")

s3 = boto3.client("s3", endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=ACCESS_KEY, aws_secret_access_key=SECRET_KEY,
    config=Config(signature_version="s3v4"), region_name="auto")

def sanitize(s):
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
    candidates = ["python3", "python", "py"]
    for c in candidates:
        exe = shutil.which(c)
        if not exe:
            continue
        try:
            subprocess.run([exe, "-c", "import yt_dlp"], check=True, capture_output=True)
            return [exe, "-m", "yt_dlp"]
        except Exception:
            continue
    raise SystemExit("yt-dlp not found. Install with: python -m pip install yt-dlp")

def run(cmd):
    print(">", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout); print(r.stderr)
        raise SystemExit(f"Command failed: {' '.join(cmd)}")
    return r

def duration_of(path):
    r = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True)
    try:
        return round(float(r.stdout.strip()), 2)
    except ValueError:
        return 0.0

def load_tracks():
    if os.path.exists(TRACKS):
        with open(TRACKS, encoding="utf-8") as f:
            return json.load(f)
    return {"tracks": []}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--title", required=True)
    ap.add_argument("--artist", required=True)
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()

    title = sanitize(args.title)
    artist = sanitize(args.artist)
    filename = f"{artist} - {title}.mp3"

    data = load_tracks()
    tracks = data.setdefault("tracks", [])

    # storage limit check
    total = sum(t.get("size", 0) for t in tracks)
    if total >= LIMIT_BYTES:
        print(f"Storage limit reached ({total/1e9:.2f} GB / 9.5 GB). Delete a song first.")
        sys.exit(1)

    tmp_base = os.path.join(BASE, ".download")
    for f in glob.glob(tmp_base + "*"):
        try: os.remove(f)
        except OSError: pass

    # download
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
    if total + size > LIMIT_BYTES:
        os.remove(tmp_mp3)
        print(f"Adding this track would exceed the 9.5 GB limit ({(total+size)/1e9:.2f} GB). Delete a song first.")
        sys.exit(1)

    dur = duration_of(tmp_mp3)

    # upload to R2
    key = filename
    print(f"Uploading to R2: {filename}")
    s3.upload_file(tmp_mp3, BUCKET, key, ExtraArgs={"ContentType": "audio/mpeg"})
    os.remove(tmp_mp3)

    url = PUBLIC_URL.rstrip("/") + "/" + quote(filename, safe="")

    # update tracks.json
    if not any(t.get("url") == url for t in tracks):
        new_id = (max((t.get("id", 0) for t in tracks), default=0) + 1)
        tracks.append({
            "id": new_id,
            "title": title,
            "artist": artist,
            "url": url,
            "duration": dur,
            "size": size,
        })
    with open(TRACKS, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Added: {artist} - {title} ({dur}s, {size/1e6:.1f} MB) -> {url}")

    if args.push:
        print("Committing and pushing...")
        subprocess.run(["git", "add", "data/tracks.json"], cwd=BASE, check=True)
        subprocess.run(["git", "commit", "-m", f"Add track: {artist} - {title}"], cwd=BASE, check=True)
        subprocess.run(["git", "push"], cwd=BASE, check=True)
        print("Pushed. Site will redeploy automatically.")

if __name__ == "__main__":
    main()
