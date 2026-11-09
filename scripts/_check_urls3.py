import json, ssl, urllib.request, concurrent.futures, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ctx = ssl._create_unverified_context()
d = json.load(open("data/tracks.json", encoding="utf-8"))
tracks = d["tracks"]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
def check(t):
    try:
        req = urllib.request.Request(t["url"], method="HEAD", headers={"User-Agent": UA, "Origin": "https://sensesvoid.github.io"})
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            return t["id"], r.status, r.headers.get("Content-Type"), None
    except Exception as e:
        code = getattr(e, "code", None)
        if code is None:
            code = "ERR"
        return t["id"], code, None, str(e)[:120]
bad = []
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
    futs = [ex.submit(check, t) for t in tracks]
    for f in concurrent.futures.as_completed(futs):
        tid, status, ctype, err = f.result()
        if status not in (200, 206):
            bad.append((tid, status, err))
            print("FAIL id=%d status=%s err=%s" % (tid, status, err))
print("Total: %d, Failed: %d" % (len(tracks), len(bad)))
if bad:
    print("Failed IDs:", [b[0] for b in bad])
PY