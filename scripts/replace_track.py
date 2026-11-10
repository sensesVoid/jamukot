#!/usr/bin/env python3
"""Replace an existing track with a new one (delete old, download + encode new to Opus)."""
import argparse, json, os, sys, subprocess, glob, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from urllib.parse import quote, unquote

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")
AUDIO_DIR = os.path.join(BASE, "audio")
LIMIT_BYTES = int(780 * 1024 * 1024)  # 780 MB (GitHub Pages ~1 GB limit, matches player tracker)


def sanitize(s):
    import re
    s = re.sub(r'[\\/:*?"<>|]', "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:80] or "track"


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
        print(r.stdout)
        print(r.stderr)
        raise SystemExit(f"Command failed: {' '.join(cmd)}")
    return r


def duration_of(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
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
        f.write("\n")


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--id", type=int)
    g.add_argument("--title")
    ap.add_argument("--artist")
    ap.add_argument("url")
    ap.add_argument("--new-title", required=True)
    ap.add_argument("--new-artist", required=True)
    ap.add_argument("--bitrate", default="16k")
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

    # download + encode
    tmp_base = os.path.join(BASE, ".download")
    for f in glob.glob(tmp_base + "*"):
        try:
            os.remove(f)
        except OSError:
            pass
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
    opus_path = os.path.join(AUDIO_DIR, f"{old['id']}.opus")
    os.makedirs(AUDIO_DIR, exist_ok=True)
    tmp_opus = opus_path + ".tmp"
    run(["ffmpeg", "-y", "-i", src, "-c:a", "libopus", "-b:a", args.bitrate,
         "-vbr", "on", "-application", "audio", "-f", "ogg", tmp_opus])
    if not os.path.exists(tmp_opus) or os.path.getsize(tmp_opus) == 0:
        raise SystemExit("ffmpeg produced an empty Opus file")
    with open(tmp_opus, "rb") as f:
        if f.read(4) != b"OggS":
            raise SystemExit("ffmpeg output is not a valid Ogg Opus file")
    os.replace(tmp_opus, opus_path)
    try:
        os.remove(src)
    except OSError:
        pass

    size = os.path.getsize(opus_path)
    total = sum(t.get("size", 0) for t in tracks) - old.get("size", 0)
    if total + size > LIMIT_BYTES:
        os.remove(opus_path)
        print(f"Would exceed 0.9 GB limit. Delete a song first.")
        sys.exit(1)

    dur = duration_of(opus_path)

    # remove old file (if local opus)
    old_url = old.get("url", "")
    if not old_url.startswith("http"):
        old_path = os.path.join(BASE, old_url)
        try:
            os.remove(old_path)
            print(f"Deleted old: {old_path}")
        except OSError:
            pass
    else:
        # legacy R2 track — try to delete from R2
        try:
            import boto3
            from botocore.config import Config
            env = {}
            env_path = os.path.join(BASE, ".env")
            if os.path.exists(env_path):
                with open(env_path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and "=" in line and not line.startswith("#"):
                            k, v = line.split("=", 1)
                            env[k.strip()] = v.strip()
            access = env.get("Access_Key_ID") or env.get("R2_ACCESS_KEY_ID")
            secret = env.get("Secret_Access_Key") or env.get("R2_SECRET_ACCESS_KEY")
            bucket = env.get("R2_BUCKET", "jamukot-audio")
            account = env.get("R2_ACCOUNT_ID", "5eaa981f4ddcdefe097a949285c222")
            s3 = boto3.client("s3", endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
                aws_access_key_id=access, aws_secret_access_key=secret,
                config=Config(signature_version="s3v4"), region_name="auto")
            key = unquote(old_url.rsplit("/", 1)[-1])
            s3.delete_object(Bucket=bucket, Key=key)
            print(f"Deleted old from R2: {key}")
        except Exception as e:
            print(f"R2 delete warning: {e}")

    rel_url = f"audio/{old['id']}.opus"

    # update entry (keep same id)
    old["title"] = new_title
    old["artist"] = new_artist
    old["url"] = rel_url
    old["duration"] = dur
    old["size"] = size
    old["format"] = "opus"
    save_tracks(data)
    print(f"Replaced: {new_artist} - {new_title} ({dur}s, {size/1e3:.0f} KB)")

    if args.push:
        subprocess.run(["git", "add", "-A"], cwd=BASE, check=True)
        subprocess.run(["git", "commit", "-m", f"Replace track: {old['artist']} - {old['title']} -> {new_artist} - {new_title}"], cwd=BASE, check=True)
        subprocess.run(["git", "push"], cwd=BASE, check=True)
        print("Pushed.")


if __name__ == "__main__":
    main()
PY