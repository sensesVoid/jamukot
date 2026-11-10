#!/usr/bin/env python3
"""Download a YouTube video, compress to Opus (16 kbps), save to audio/, update tracks.json."""
import argparse, json, os, re, subprocess, sys, time, glob, tempfile
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from urllib.parse import quote

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")
AUDIO_DIR = os.path.join(BASE, "audio")
LIMIT_BYTES = int(780 * 1024 * 1024)  # 780 MB (GitHub Pages ~1 GB limit, matches player tracker)


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


def sanitize(s):
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
    raise SystemExit("yt-dlp not found. Install with: python -m pip install yt-dlp")


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
    if os.path.exists(TRACKS):
        with open(TRACKS, encoding="utf-8") as f:
            return json.load(f)
    return {"tracks": []}


def save_tracks(data):
    with open(TRACKS, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--title", required=True)
    ap.add_argument("--artist", required=True)
    ap.add_argument("--bitrate", default="16k", help="Opus bitrate (default 16k)")
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()

    title = sanitize(args.title)
    artist = sanitize(args.artist)

    data = load_tracks()
    tracks = data.setdefault("tracks", [])

    # storage limit check (based on Opus file sizes)
    total = sum(t.get("size", 0) for t in tracks)
    if total >= LIMIT_BYTES:
        print(f"Storage limit reached ({total/1e9:.2f} GB / 0.9 GB). Delete a song first.")
        sys.exit(1)

    # determine new id
    new_id = max((t.get("id", 0) for t in tracks), default=0) + 1

    os.makedirs(AUDIO_DIR, exist_ok=True)

    tmp_base = os.path.join(BASE, ".download")
    for f in glob.glob(tmp_base + "*"):
        try:
            os.remove(f)
        except OSError:
            pass

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

    # encode to Opus
    opus_path = os.path.join(AUDIO_DIR, f"{new_id}.opus")
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
    if total + size > LIMIT_BYTES:
        os.remove(opus_path)
        print(f"Adding this track would exceed the 780 MB limit ({(total+size)/1e6:.0f} MB). Delete a song first.")
        sys.exit(1)

    dur = duration_of(opus_path)

    rel_url = f"audio/{new_id}.opus"

    # update tracks.json
    tracks.append({
        "id": new_id,
        "title": title,
        "artist": artist,
        "url": rel_url,
        "duration": dur,
        "size": size,
        "format": "opus",
    })
    save_tracks(data)

    print(f"Added: {artist} - {title} ({dur}s, {size/1e3:.0f} KB) -> {rel_url}")

    if args.push:
        print("Committing and pushing...")
        subprocess.run(["git", "add", "-A"], cwd=BASE, check=True)
        subprocess.run(["git", "commit", "-m", f"Add track: {artist} - {title}"], cwd=BASE, check=True)
        subprocess.run(["git", "push"], cwd=BASE, check=True)
        print("Pushed. Site will redeploy automatically.")


if __name__ == "__main__":
    main()
PY