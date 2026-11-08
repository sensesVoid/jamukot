import os, json, subprocess, glob

base = r"C:\Users\geral\jamukot"
audio_dir = os.path.join(base, "AudioFile")
out = os.path.join(base, "data", "tracks.json")

tracks = []
for path in sorted(glob.glob(os.path.join(audio_dir, "*.mp3"))):
    name = os.path.basename(path)
    stem = os.path.splitext(name)[0]
    # split "Artist - Title"
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
    else:
        artist, title = "Unknown", stem
    artist = artist.strip()
    title = title.strip()
    # duration via ffprobe
    try:
        r = subprocess.run(
            ["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True
        )
        dur = float(r.stdout.strip())
    except Exception:
        dur = 0.0
    tracks.append({
        "id": len(tracks)+1,
        "title": title,
        "artist": artist,
        "file": "AudioFile/" + name,
        "duration": round(dur, 2)
    })

with open(out, "w", encoding="utf-8") as f:
    json.dump({"tracks": tracks}, f, ensure_ascii=False, indent=2)

print(f"Wrote {len(tracks)} tracks")
