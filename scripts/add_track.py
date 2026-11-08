#!/usr/bin/env python3
"""Download a YouTube video, compress to 128kbps MP3, save to AudioFile/, and update data/tracks.json."""
import argparse, json, os, re, subprocess, sys, glob, shutil

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(BASE, "AudioFile")
TRACKS = os.path.join(BASE, "data", "tracks.json")
BITRATE = "128k"

def sanitize(s):
    s = re.sub(r'[\\/:*?"<>|]', "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:120] or "track"

def find_ytdlp():
    # 1. binary on PATH
    for name in ("yt-dlp", "yt-dlp.exe"):
        p = shutil.which(name)
        if p:
            return [p]
    # 2. current interpreter
    try:
        subprocess.run([sys.executable, "-c", "import yt_dlp"], check=True, capture_output=True)
        return [sys.executable, "-m", "yt_dlp"]
    except Exception:
        pass
    # 3. candidate interpreters
    candidates = ["python3", "python", "py"]
    # common Windows install locations
    for root in (os.environ.get("LOCALAPPDATA", ""), os.environ.get("APPDATA", "")):
        if root:
            for sub in ("Python", "Programs/Python"):
                base = os.path.join(root, sub)
                if os.path.isdir(base):
                    for d in os.listdir(base):
                        exe = os.path.join(base, d, "python.exe")
                        if os.path.exists(exe):
                            candidates.append(exe)
    for c in candidates:
        exe = shutil.which(c) if not os.path.isabs(c) else c
        if not exe or not os.path.exists(exe):
            continue
        try:
            subprocess.run([exe, "-c", "import yt_dlp"], check=True, capture_output=True)
            return [exe, "-m", "yt_dlp"]
        except Exception:
            continue
    raise SystemExit("yt-dlp not found. Install it with: python -m pip install yt-dlp  (and ensure ffmpeg is on PATH)")

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
        ["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True
    )
    try:
        return round(float(r.stdout.strip()), 2)
    except ValueError:
        return 0.0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--title", required=True)
    ap.add_argument("--artist", required=True)
    args = ap.parse_args()

    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(TRACKS), exist_ok=True)

    title = sanitize(args.title)
    artist = sanitize(args.artist)
    filename = f"{artist} - {title}.mp3"
    out_path = os.path.join(AUDIO_DIR, filename)

    tmp_base = os.path.join(AUDIO_DIR, ".download")
    # clean previous temp
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

    # find downloaded file
    cands = [f for f in glob.glob(tmp_base + ".*") if not f.endswith(".mp3") or True]
    cands = [f for f in glob.glob(tmp_base + ".*")]
    if not cands:
        raise SystemExit("Download produced no file")
    src = cands[0]

    # compress to 128k mp3
    run(["ffmpeg", "-y", "-i", src, "-vn", "-map", "a", "-b:a", BITRATE, "-ar", "44100", out_path])
    try:
        os.remove(src)
    except OSError:
        pass

    dur = duration_of(out_path)

    # update tracks.json
    data = {"tracks": []}
    if os.path.exists(TRACKS):
        with open(TRACKS, encoding="utf-8") as f:
            data = json.load(f)
    tracks = data.setdefault("tracks", [])
    # avoid duplicate filename
    if not any(t.get("file") == "AudioFile/" + filename for t in tracks):
        new_id = (max((t.get("id", 0) for t in tracks), default=0) + 1)
        tracks.append({
            "id": new_id,
            "title": title,
            "artist": artist,
            "file": "AudioFile/" + filename,
            "duration": dur,
        })
    with open(TRACKS, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Added: {artist} - {title} ({dur}s) -> {out_path}")

if __name__ == "__main__":
    main()
sys.exit(0)
