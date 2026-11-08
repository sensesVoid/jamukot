#!/usr/bin/env python3
"""Download a YouTube video, compress to 128kbps MP3, save to AudioFile/, and update data/tracks.json."""
import argparse, json, os, re, subprocess, sys, glob

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(BASE, "AudioFile")
TRACKS = os.path.join(BASE, "data", "tracks.json")
BITRATE = "128k"

def sanitize(s):
    s = re.sub(r'[\\/:*?"<>|]', "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:120] or "track"

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

    # download best audio
    run(["yt-dlp", "-f", "bestaudio", "-o", tmp_base + ".%(ext)s", "--no-playlist", args.url])

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
