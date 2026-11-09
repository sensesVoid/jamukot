import json, ssl, urllib.request, subprocess, tempfile, os, sys, random
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ctx = ssl._create_unverified_context()
d = json.load(open("data/tracks.json", encoding="utf-8"))
tracks = d["tracks"]
# pick special-char tracks + random sample
import re
special = [t for t in tracks if re.search(r'[^A-Za-z0-9 \.\-_\(\)\[\]!,&\'\+]', __import__('urllib.parse',fromlist=['unquote']).unquote(t['url'].split('/')[-1]))]
random.seed(42)
sample = random.sample(tracks, 40)
to_check = {t['id']: t for t in (special + sample)}.values()
print("Checking %d tracks" % len(to_check))
bad = []
for t in to_check:
    try:
        req = urllib.request.Request(t["url"], headers={"User-Agent": "Mozilla/5.0", "Origin": "https://sensesvoid.github.io"})
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            data = r.read()
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
        tmp.write(data); tmp.close()
        # ffprobe
        r2 = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration,bit_rate:stream=codec_name,sample_rate,channels","-of","json",tmp.name], capture_output=True, text=True, timeout=30)
        os.remove(tmp.name)
        if r2.returncode != 0 or not r2.stdout.strip():
            bad.append((t["id"], "ffprobe fail: " + (r2.stderr or "")[:80]))
            print("BAD id=%d: ffprobe fail %s" % (t["id"], (r2.stderr or "")[:80]))
            continue
        import json as J
        info = J.loads(r2.stdout)
        streams = info.get("streams", [])
        if not streams:
            bad.append((t["id"], "no streams"))
            print("BAD id=%d: no streams" % t["id"])
            continue
        s = streams[0]
        sr = s.get("sample_rate")
        ch = s.get("channels")
        codec = s.get("codec_name")
        dur = info.get("format", {}).get("duration")
        if codec != "mp3" or sr != "44100":
            print("UNUSUAL id=%d codec=%s sr=%s ch=%s dur=%s" % (t["id"], codec, sr, ch, dur))
    except Exception as e:
        bad.append((t["id"], str(e)[:80]))
        print("BAD id=%d: %s" % (t["id"], str(e)[:80]))
print("Checked %d, problems: %d" % (len(to_check), len(bad)))
if bad:
    print("Problem IDs:", [b[0] for b in bad])
PY