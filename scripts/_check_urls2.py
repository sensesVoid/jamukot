import json, ssl, urllib.request, concurrent.futures, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ctx = ssl._create_unverified_context()
d = json.load(open("data/tracks.json", encoding="utf-8"))
tracks = d["tracks"]
def check(t):
    try:
        req = urllib.request.Request(t["url"], method="HEAD")
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
# also check for suspicious chars in URLs
import re
susp = []
for t in tracks:
    u = t["url"]
    if "#" in u or "?" in u.split("/")[-1] or " " in u:
        susp.append((t["id"], u))
print("URLs with #/?/space:", len(susp))
for s in susp[:20]:
    print("  ", s)
PY