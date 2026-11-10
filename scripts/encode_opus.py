#!/usr/bin/env python3
"""Encode all Jamukot tracks to Opus (16 kbps) and store them in audio/ for GitHub Pages hosting."""
import argparse, json, os, ssl, subprocess, sys, tempfile, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")
AUDIO_DIR = os.path.join(BASE, "audio")
BITRATE = "16k"

def load_env():
    env = {}
    p = os.path.join(BASE, ".env")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    return env

ENV = load_env()
ctx = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def sanitize(s):
    import re
    s = re.sub(r'[\\/:*?"<>|]', "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:80] or "track"


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        data = r.read()
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def encode(src, dst):
    tmp_dst = dst + ".tmp"
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-c:a", "libopus", "-b:a", BITRATE, "-vbr", "on", "-application", "audio", "-f", "ogg", tmp_dst],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        try:
            os.remove(tmp_dst)
        except OSError:
            pass
        raise RuntimeError((r.stderr or "")[-500:])
    os.replace(tmp_dst, dst)


def main():
    global BITRATE
    ap = argparse.ArgumentParser()
    ap.add_argument("--bitrate", default=BITRATE, help="Opus bitrate (default 16k)")
    ap.add_argument("--limit", type=int, default=0, help="Max tracks to encode (0 = all)")
    ap.add_argument("--skip-existing", action="store_true", help="Skip tracks whose .opus file already exists")
    ap.add_argument("--force", action="store_true", help="Re-encode even if .opus exists (re-downloads from R2)")
    args = ap.parse_args()

    # normalize bitrate: append 'k' if bare number
    br = args.bitrate
    if br.isdigit():
        br = br + "k"
    BITRATE = br
    args.bitrate = br

    os.makedirs(AUDIO_DIR, exist_ok=True)
    data = json.load(open(TRACKS, encoding="utf-8"))
    tracks = data["tracks"]

    done = 0
    skipped = 0
    failed = 0
    total_saved = 0

    attempted = 0
    for i, t in enumerate(tracks):
        if args.limit and attempted >= args.limit:
            break
        attempted += 1
        tid = t["id"]
        filename = f"{tid}.opus"
        dst = os.path.join(AUDIO_DIR, filename)
        rel_url = "audio/" + filename

        if args.skip_existing and os.path.exists(dst) and not args.force:
            t["url"] = rel_url
            t["format"] = "opus"
            skipped += 1
            continue

        mp3_tmp = os.path.join(AUDIO_DIR, f".tmp_{tid}.mp3")
        try:
            src_url = t["url"]
            # if already converted and not forcing, skip
            if not src_url.startswith("http") and not args.force:
                print(f"[{i+1}/{len(tracks)}] id={tid} already local, skipping download")
                skipped += 1
                continue
            # if force and url is relative, reconstruct R2 URL from metadata
            if args.force and not src_url.startswith("http"):
                artist = sanitize(t.get("artist", "Unknown"))
                title = sanitize(t.get("title", "track"))
                filename = f"{artist} - {title}.mp3"
                from urllib.parse import quote
                src_url = "https://jamukot-audio.originragnarok05.workers.dev/" + quote(filename, safe="")
                print(f"[{i+1}/{len(tracks)}] id={tid} (force) reconstructing R2 URL...")
            print(f"[{i+1}/{len(tracks)}] id={tid} downloading {t['title']} - {t['artist']}...")
            size = download(src_url, mp3_tmp)
            encode(mp3_tmp, dst)
            opus_size = os.path.getsize(dst)
            total_saved += size - opus_size
            t["url"] = rel_url
            t["format"] = "opus"
            t["original_size"] = t.get("size", size)
            t["size"] = opus_size
            done += 1
            print(f"   {size/1e6:.1f} MB -> {opus_size/1e3:.0f} KB ({opus_size/size*100:.1f}%)")
        except Exception as e:
            failed += 1
            print(f"   FAILED: {e}")
        finally:
            try:
                os.remove(mp3_tmp)
            except OSError:
                pass

    # save updated tracks.json
    with open(TRACKS, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\nDone. encoded={done} skipped={skipped} failed={failed}")
    print(f"Total saved: {total_saved/1e6:.1f} MB")
    print(f"tracks.json updated with relative Opus paths.")


if __name__ == "__main__":
    main()
