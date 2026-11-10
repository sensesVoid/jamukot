#!/usr/bin/env python3
"""Approve pending song requests: download, compress to 128 kbps, upload to R2, update tracks.json."""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from urllib.parse import parse_qs, quote, unquote, urlparse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")
REQUESTS = os.path.join(BASE, "data", "requests.json")
LIMIT_BYTES = int(0.9 * 1024 * 1024 * 1024)  # 900 MB (GitHub Pages ~1 GB limit)


def load_env():
    env = {}
    env_path = os.path.join(BASE, ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
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
ACCOUNT_ID = ENV.get("R2_ACCOUNT_ID", "5eaa981f4ddcdefe097a949285c222")

YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


class StorageLimitError(Exception):
    pass


def make_s3():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def sanitize(value):
    s = re.sub(r'[\\/:*?"<>|]', "", str(value or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:120] or "track"


def normalize_text(value):
    s = str(value or "").lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", s)
    s = re.sub(r"\b(?:feat|ft)\.?\s+.*$", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^the\s+", "", s)
    return s


def normalize_key(title, artist):
    return f"{normalize_text(title)}|{normalize_text(artist)}"


def find_duplicate(title, artist, video_id, tracks):
    if not normalize_text(title) or not normalize_text(artist):
        return None
    key = normalize_key(title, artist)
    for track in tracks:
        if video_id and track.get("youtube_id") == video_id:
            return track
        if normalize_key(track.get("title", ""), track.get("artist", "")) == key:
            return track
    return None


def unique_filename(stem, tracks):
    existing = set()
    for track in tracks:
        url = track.get("url") or ""
        if url:
            existing.add(unquote(url.rsplit("/", 1)[-1]).lower())
    name = f"{stem}.mp3"
    index = 2
    while name.lower() in existing:
        name = f"{stem} ({index}).mp3"
        index += 1
    return name


def check_capacity(total, size, limit=LIMIT_BYTES):
    if total + size > limit:
        raise StorageLimitError(
            f"Adding this track would exceed the 9.5 GB limit "
            f"({(total + size) / 1e9:.2f} GB). Delete a song first."
        )


def extract_youtube_id(url):
    try:
        parsed = urlparse(str(url or "").strip())
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    if host not in YOUTUBE_HOSTS:
        return None
    parts = [p for p in parsed.path.split("/") if p]
    video_id = None
    if host == "youtu.be":
        video_id = parts[0] if parts else None
    elif parsed.path.startswith("/shorts/"):
        video_id = parts[1] if len(parts) > 1 else None
    elif parsed.path == "/watch":
        video_id = parse_qs(parsed.query).get("v", [None])[0]
    if not video_id or not VIDEO_ID_RE.match(video_id):
        return None
    return video_id


def find_ytdlp():
    for name in ("yt-dlp", "yt-dlp.exe"):
        path = shutil.which(name)
        if path:
            return [path]
    try:
        subprocess.run([sys.executable, "-c", "import yt_dlp"], check=True, capture_output=True)
        return [sys.executable, "-m", "yt_dlp"]
    except Exception:
        pass
    for candidate in ("python3", "python", "py"):
        exe = shutil.which(candidate)
        if not exe:
            continue
        try:
            subprocess.run([exe, "-c", "import yt_dlp"], check=True, capture_output=True)
            return [exe, "-m", "yt_dlp"]
        except Exception:
            continue
    raise RuntimeError("yt-dlp not found. Install with: python -m pip install yt-dlp")


def run_cmd(cmd, cwd=None):
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "command failed").strip()
        raise RuntimeError(detail[-800:])
    return result


def duration_of(path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True,
        text=True,
    )
    try:
        return round(float(result.stdout.strip()), 2)
    except ValueError:
        return 0.0


def download_and_compress(url, workdir):
    src_base = os.path.join(workdir, "source")
    cmd = find_ytdlp() + [
        "-f", "bestaudio",
        "-o", src_base + ".%(ext)s",
        "--no-playlist",
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
    ]
    cookies = os.environ.get("YOUTUBE_COOKIES_FILE")
    if cookies and os.path.exists(cookies):
        cmd += ["--cookies", cookies]
    cmd.append(url)
    run_cmd(cmd)

    candidates = glob.glob(src_base + ".*")
    if not candidates:
        raise RuntimeError("Download produced no file")
    source = candidates[0]
    output = os.path.join(workdir, "out.opus")
    run_cmd(["ffmpeg", "-y", "-i", source, "-c:a", "libopus", "-b:a", "16k",
             "-vbr", "on", "-application", "audio", output])
    return output


def process_one(req, tracks_data, workdir):
    youtube_url = str(req.get("youtube_url") or "")
    video_id = extract_youtube_id(youtube_url)
    if not video_id:
        raise ValueError("invalid YouTube URL")

    title = sanitize(req.get("title"))
    artist = sanitize(req.get("artist"))
    if not title or not artist or title == "track" or artist == "track":
        raise ValueError("missing title or artist")

    tracks = tracks_data.setdefault("tracks", [])
    if find_duplicate(title, artist, video_id, tracks):
        print(f"DUPLICATE: {artist} - {title}")
        return "duplicate"

    total = sum(int(t.get("size", 0) or 0) for t in tracks)
    if total >= LIMIT_BYTES:
        raise StorageLimitError(f"Storage limit reached ({total / 1e9:.2f} GB / 9.5 GB).")
    check_capacity(total, 0)

    opus = download_and_compress(youtube_url, workdir)
    size = os.path.getsize(opus)
    check_capacity(total, size)
    duration = duration_of(opus)

    new_id = max((int(t.get("id", 0) or 0) for t in tracks), default=0) + 1
    os.makedirs(os.path.join(BASE, "audio"), exist_ok=True)
    opus_dest = os.path.join(BASE, "audio", f"{new_id}.opus")
    import shutil
    shutil.copy2(opus, opus_dest)

    rel_url = f"audio/{new_id}.opus"
    tracks.append({
        "id": new_id,
        "title": title,
        "artist": artist,
        "url": rel_url,
        "duration": duration,
        "size": size,
        "youtube_id": video_id,
        "format": "opus",
    })
    write_json(TRACKS, tracks_data)
    print(f"ADDED: {artist} - {title} ({duration}s, {size / 1e3:.0f} KB)")
    return "added"


def run_batch(requests, tracks_data, processor, on_change=None):
    result = {"added": 0, "duplicate": 0, "failed": 0, "stopped": False}
    for req in list(requests):
        try:
            outcome = processor(req, tracks_data)
        except StorageLimitError as exc:
            result["stopped"] = True
            print(f"Stopped: {exc}")
            if on_change:
                on_change()
            break
        except Exception as exc:
            req["attempts"] = int(req.get("attempts", 0) or 0) + 1
            req["last_error"] = str(exc)[:500]
            result["failed"] += 1
            print(f"FAILED: {req.get('artist', '?')} - {req.get('title', '?')} -> {exc}")
            if on_change:
                on_change()
            continue

        if outcome == "added":
            result["added"] += 1
            requests.remove(req)
        elif outcome == "duplicate":
            result["duplicate"] += 1
            requests.remove(req)
        if on_change:
            on_change()
    return result


def main():
    parser = argparse.ArgumentParser(description="Approve pending song requests.")
    parser.add_argument("--dry-run", action="store_true", help="Preview without downloading or changing files")
    parser.add_argument("--push", action="store_true", help="Commit and push the updated JSON files")
    parser.add_argument("--no-pull", action="store_true", help="Skip the initial git pull")
    args = parser.parse_args()

    if not args.no_pull:
        pull = subprocess.run(["git", "pull", "--ff-only"], cwd=BASE)
        if pull.returncode != 0:
            print("Warning: git pull --ff-only failed; continuing with the local queue.")

    data = load_json(TRACKS, {"tracks": []})
    queue = load_json(REQUESTS, {"requests": []})
    all_requests = queue.setdefault("requests", [])
    pending = [r for r in all_requests if r.get("status", "pending") == "pending"]

    if not pending:
        print("No pending requests.")
        return

    tracks = data.setdefault("tracks", [])
    if args.dry_run:
        for req in pending:
            video_id = extract_youtube_id(req.get("youtube_url", ""))
            duplicate = find_duplicate(req.get("title", ""), req.get("artist", ""), video_id, tracks)
            label = "duplicate" if duplicate else "new"
            print(f"[{label}] {req.get('artist', '?')} - {req.get('title', '?')} | {req.get('youtube_url', '')}")
        print(f"{len(pending)} pending; dry run, nothing changed.")
        return

    def save_queue():
        remaining = {id(r) for r in pending}
        queue["requests"] = [
            r for r in all_requests
            if id(r) in remaining or r.get("status", "pending") != "pending"
        ]
        write_json(REQUESTS, queue)

    workdir = tempfile.mkdtemp(prefix="jamukot-req-")
    try:
        result = run_batch(
            pending,
            data,
            lambda req, tracks_data: process_one(req, tracks_data, workdir),
            on_change=save_queue,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    save_queue()
    print(
        f"Done. added={result['added']} duplicate={result['duplicate']} "
        f"failed={result['failed']} remaining={len(pending)}"
    )
    if result["stopped"]:
        print("Storage limit reached; remaining requests were kept.")

    if args.push:
        subprocess.run(["git", "add", "data/tracks.json", "data/requests.json", "audio/"], cwd=BASE, check=True)
        changed = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=BASE)
        if changed.returncode == 0:
            print("No changes to commit.")
            return
        subprocess.run(["git", "commit", "-m", "Approve song requests"], cwd=BASE, check=True)
        subprocess.run(["git", "pull", "--rebase"], cwd=BASE, check=False)
        subprocess.run(["git", "push"], cwd=BASE, check=True)
        print("Pushed. Site will redeploy automatically.")


if __name__ == "__main__":
    main()
