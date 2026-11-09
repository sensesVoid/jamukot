# Song Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public floating "Request a song" form whose submissions queue in `data/requests.json`, plus a local bulk-approval script that downloads, compresses to 128 kbps, uploads to R2, skips duplicates, and removes resolved requests.

**Architecture:** The existing `jamukot-dispatch` Worker gains a `POST /request` route that validates and dedupes submissions, then appends them to `data/requests.json` through the GitHub Contents API. The static player gains a floating button and modal that posts to that route. A Python script drains the queue locally with `yt-dlp` + `ffmpeg`, updates `tracks.json`, and commits both files.

**Tech Stack:** Vanilla HTML/CSS/JS, Cloudflare Workers (ES modules), GitHub Contents API, Python 3.11, boto3, yt-dlp, ffmpeg, Node's built-in test runner, Python `unittest`.

**Spec:** `docs/superpowers/specs/2026-11-09-song-requests-design.md`

## Global Constraints

- Audio is always MP3 at **128 kbps, 44.1 kHz**.
- Hard storage cap is **9.5 GB** (`9.5 * 1024 * 1024 * 1024` bytes).
- Audio host is `https://jamukot-audio.originragnarok05.workers.dev`.
- Request endpoint is `https://jamukot-dispatch.originragnarok05.workers.dev/request`.
- Allowed browser origin is `https://sensesvoid.github.io`.
- Queue file is `data/requests.json`; track file is `data/tracks.json`.
- Existing 476 tracks have no `youtube_id`; they are matched by normalized title + artist.
- Do not add new runtime dependencies beyond what is already installed (`boto3`, `requests`, `yt-dlp`, `ffmpeg`).
- Never expose `GITHUB_TOKEN` or R2 keys to the browser.
- Bump `css/style.css` and `js/app.js` cache versions from `v=15` to `v=16`.

## Review Focus

1. Two submissions of the same song in quick succession — the second returns `409`, never two queue rows.
2. `data/requests.json` missing or malformed — a missing file initializes cleanly; malformed content returns a clear error and is not overwritten.
3. Unicode, quotes, HTML, or control characters in title/artist — stored safely, normalized consistently, and never injected as HTML into the UI.
4. One failed download in a batch — the remaining requests still process; the failed one stays queued with its error.
5. Storage cap reached mid-batch — the script stops before upload and leaves unprocessed requests in the queue.

---

### Task 1: Request validation and dedupe helpers

**Files:**
- Create: `worker/request-utils.js`
- Create: `worker/request-utils.test.mjs`
- Create: `worker/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `extractYouTubeId(url: string): string | null`
  - `sanitizeText(value: unknown, maxLen?: number): string`
  - `normalizeKey(title: string, artist: string): string`
  - `findDuplicate(candidate: { title: string, artist: string, videoId: string | null }, tracks: Array<{title?: string, artist?: string, youtube_id?: string}>, requests: Array<{title?: string, artist?: string, video_id?: string, status?: string}>): 'library' | 'request' | null`

- [ ] **Step 1: Create `worker/package.json`**

```json
{
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: Write the failing tests in `worker/request-utils.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractYouTubeId, sanitizeText, normalizeKey, findDuplicate } from './request-utils.js';

test('extractYouTubeId accepts watch, short, shorts, and music URLs', () => {
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('extractYouTubeId rejects non-YouTube and malformed IDs', () => {
  assert.equal(extractYouTubeId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractYouTubeId('not a url'), null);
  assert.equal(extractYouTubeId('https://youtu.be/short'), null);
});

test('sanitizeText trims, collapses whitespace, strips controls, and truncates', () => {
  assert.equal(sanitizeText('  A\u0000  B  '), 'A B');
  assert.equal(sanitizeText('x'.repeat(200)).length, 120);
  assert.equal(sanitizeText(null), '');
});

test('normalizeKey ignores brackets, feat tails, punctuation, case, and leading the', () => {
  assert.equal(
    normalizeKey('Song (Official Video)', 'The Artist feat. Someone'),
    normalizeKey('song', 'Artist')
  );
  assert.notEqual(normalizeKey('Song A', 'Artist'), normalizeKey('Song B', 'Artist'));
});

test('findDuplicate detects library, queue, and video-id matches', () => {
  const tracks = [{ title: 'Song', artist: 'Artist', youtube_id: 'aaaaaaaaaaa' }];
  const requests = [{ title: 'Other', artist: 'Person', video_id: 'bbbbbbbbbbb', status: 'pending' }];
  assert.equal(findDuplicate({ title: 'Song (Lyrics)', artist: 'Artist', videoId: null }, tracks, requests), 'library');
  assert.equal(findDuplicate({ title: 'Other', artist: 'Person', videoId: null }, tracks, requests), 'request');
  assert.equal(findDuplicate({ title: 'New', artist: 'New', videoId: 'aaaaaaaaaaa' }, tracks, requests), 'library');
  assert.equal(findDuplicate({ title: 'New', artist: 'New', videoId: null }, tracks, requests), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test worker/request-utils.test.mjs`
Expected: FAIL — cannot find module `./request-utils.js`.

- [ ] **Step 4: Implement `worker/request-utils.js`**

Implementation notes:
- `extractYouTubeId` parses with `new URL`, accepts only `youtube.com`, `www.youtube.com`, `music.youtube.com`, `m.youtube.com`, `youtu.be`; extracts `v`, `/shorts/<id>`, or the `youtu.be` path; returns the ID only when it matches `/^[A-Za-z0-9_-]{11}$/`.
- `sanitizeText` uses `String(value ?? '')`, removes `[\u0000-\u001f\u007f]`, collapses `\s+` to one space, trims, slices to `maxLen` (default 120).
- `normalizeText` lowercases, `normalize('NFKD')`, strips combining marks, removes bracketed groups `\([^)]*\)|\[[^\]]*\]`, removes `\b(feat|ft)\.?\s+.*$`, replaces non-alphanumerics with spaces, collapses spaces, trims, and strips a leading `the `.
- `normalizeKey(title, artist)` returns `` `${normalizeText(title)}|${normalizeText(artist)}` ``.
- `findDuplicate` checks `youtube_id`/`video_id` first, then normalized keys; only requests with `status === 'pending'` count; library wins over queue.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test worker/request-utils.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add worker/package.json worker/request-utils.js worker/request-utils.test.mjs
git commit -m "Add request validation and dedupe helpers"
```

---

### Task 2: Worker `/request` endpoint and queue file

**Files:**
- Create: `data/requests.json`
- Modify: `worker/index.js` (add imports, route, GitHub Contents API helpers)
- Create: `worker/request-route.test.mjs`

**Interfaces:**
- Consumes: `extractYouTubeId`, `sanitizeText`, `normalizeKey`, `findDuplicate` from `worker/request-utils.js`.
- Produces: `POST /request` accepting `{ youtube_url, title, artist, website }` and returning:
  - `200 { ok: true, id }`
  - `400 { ok: false, error }` for invalid/missing fields or honeypot
  - `409 { ok: false, error: 'Already in the library' | 'Already requested' }`
  - `429 { ok: false, error }`
  - `500 { ok: false, error }`

- [ ] **Step 1: Create `data/requests.json`**

```json
{
  "requests": []
}
```

- [ ] **Step 2: Write the failing route tests in `worker/request-route.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const env = {
  GITHUB_TOKEN: 'test-token',
  GITHUB_OWNER: 'sensesVoid',
  GITHUB_REPO: 'jamukot',
  ALLOWED_ORIGIN: 'https://sensesvoid.github.io',
};

function body(overrides = {}) {
  return JSON.stringify({
    youtube_url: 'https://youtu.be/dQw4w9WgXcQ',
    title: 'Song',
    artist: 'Artist',
    website: '',
    ...overrides,
  });
}

function request(payload = body(), ip = '1.1.1.1') {
  return new Request('https://worker.dev/request', {
    method: 'POST',
    headers: {
      Origin: 'https://sensesvoid.github.io',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: payload,
  });
}

function mockGitHub({ tracks = [], queue = { requests: [] }, queueMissing = false, queueMalformed = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.includes('raw.githubusercontent.com')) return Response.json({ tracks });
    if (u.includes('api.github.com')) {
      if (!opts.method || opts.method === 'GET') {
        if (queueMissing) return new Response('Not Found', { status: 404 });
        const raw = queueMalformed ? '{not json' : JSON.stringify(queue);
        return Response.json({ sha: 'sha1', content: Buffer.from(raw).toString('base64') });
      }
      if (opts.method === 'PUT') return Response.json({ content: {} }, { status: 201 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  return calls;
}

test('valid request appends to the queue', async () => {
  const calls = mockGitHub();
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 200);
  const put = calls.find(c => c.opts.method === 'PUT');
  const sent = JSON.parse(Buffer.from(JSON.parse(put.opts.body).content, 'base64').toString('utf8'));
  assert.equal(sent.requests.length, 1);
  assert.equal(sent.requests[0].youtube_url, 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(sent.requests[0].status, 'pending');
});

test('missing queue file initializes a new one', async () => {
  const calls = mockGitHub({ queueMissing: true });
  const res = await worker.fetch(request(body({ youtube_url: 'https://youtu.be/aaaaaaaaaaa' }), '2.2.2.2'), env);
  assert.equal(res.status, 200);
  const put = calls.find(c => c.opts.method === 'PUT');
  assert.ok(put.opts.body);
});

test('malformed queue returns 500 and is not overwritten', async () => {
  const calls = mockGitHub({ queueMalformed: true });
  const res = await worker.fetch(request(body({ youtube_url: 'https://youtu.be/ccccccccccc' }), '2.5.2.5'), env);
  assert.equal(res.status, 500);
  assert.equal(calls.some(c => c.opts.method === 'PUT'), false);
});

test('duplicate in library returns 409', async () => {
  mockGitHub({ tracks: [{ title: 'Song', artist: 'Artist' }] });
  const res = await worker.fetch(request(body(), '3.3.3.3'), env);
  assert.equal(res.status, 409);
});

test('duplicate pending request returns 409', async () => {
  mockGitHub({ queue: { requests: [{ title: 'Song', artist: 'Artist', status: 'pending' }] } });
  const res = await worker.fetch(request(body(), '4.4.4.4'), env);
  assert.equal(res.status, 409);
});

test('honeypot and invalid URL return 400', async () => {
  mockGitHub();
  const spam = await worker.fetch(request(body({ website: 'spam' }), '5.5.5.5'), env);
  const badUrl = await worker.fetch(request(body({ youtube_url: 'https://example.com/x' }), '6.6.6.6'), env);
  assert.equal(spam.status, 400);
  assert.equal(badUrl.status, 400);
});

test('other origins are rejected', async () => {
  mockGitHub();
  const req = new Request('https://worker.dev/request', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7' },
    body: body(),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 403);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test worker/request-route.test.mjs`
Expected: FAIL — `/request` falls through to the dispatch handler.

- [ ] **Step 4: Implement the route in `worker/index.js`**

Implementation notes:
- At the top of `fetch`, parse `new URL(request.url)`; if `pathname === '/request'`, delegate to `handleSongRequest(request, env)` and return.
- `handleSongRequest` builds CORS headers from `env.ALLOWED_ORIGIN`; handles `OPTIONS` (204) and non-POST (405); rejects non-empty Origin that differs (403).
- Parse JSON; 400 on invalid body.
- Reject non-empty `website` honeypot (400).
- Extract video ID; 400 if null.
- Sanitize title/artist; 400 if either empty; 400 if over 120 after truncation.
- Rate limit with a module-level `Map` keyed by `CF-Connecting-IP`: max 5 per 600000 ms; return 429.
- Fetch library from `https://raw.githubusercontent.com/${owner}/${repo}/main/data/tracks.json` with `{ cf: { cacheTtl: 60 } }`; on failure use `[]`.
- Loop up to 3 attempts:
  - `readQueue` via `GET https://api.github.com/repos/${owner}/${repo}/contents/data/requests.json?ref=main` with `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `User-Agent: jamukot-dispatch-worker`.
  - 404 → `{ requests: [] }`, `sha = null`.
  - Parse base64 with `TextDecoder`; malformed JSON → 500 `Request queue is unreadable`, no write.
  - `findDuplicate`; return 409 with `Already in the library` or `Already requested`.
  - Append `{ id: crypto.randomUUID(), youtube_url, video_id, title, artist, requested_at: new Date().toISOString(), status: 'pending', attempts: 0, last_error: null }`.
  - `PUT` the same URL with `{ message: \`Song request: ${artist} - ${title}\`, content: base64(JSON.stringify(queue, null, 2) + '\n'), branch: 'main', ...(sha ? { sha } : {}) }`.
  - 200/201 → return 200 `{ ok: true, id }`; 409 → retry; other → 500.
- Missing `GITHUB_TOKEN` → 500 `Request queue is not configured`.
- Use UTF-8-safe base64 helpers (`TextEncoder`/`TextDecoder`), not bare `btoa` on raw strings.
- Leave the existing `POST /` dispatch behavior untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test worker/request-route.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add data/requests.json worker/index.js worker/request-route.test.mjs
git commit -m "Add song request worker endpoint"
```

---

### Task 3: Floating request button and modal

**Files:**
- Modify: `index.html` (button + modal markup; bump `v=16`)
- Modify: `css/style.css` (floating button, modal, form styles)
- Modify: `js/app.js` (endpoint constant + form behavior; bump cache via HTML)

**Interfaces:**
- Consumes: `POST https://jamukot-dispatch.originragnarok05.workers.dev/request`.
- Produces DOM IDs: `#request-song-btn`, `#request-modal`, `#request-form`, `#request-url`, `#request-title`, `#request-artist`, `#request-website`, `#request-status`, `#request-cancel`.

- [ ] **Step 1: Add markup to `index.html`**

Place before the `<audio>` element:
- A `<button class="request-fab" id="request-song-btn" type="button" aria-label="Request a song" title="Request a song">` containing an inline music-plus SVG.
- A `<div class="request-modal" id="request-modal" hidden>` with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="request-modal-title"`.
- Inside: backdrop `<div class="request-backdrop" data-close></div>` and a card `<form class="request-card" id="request-form">`.
- Card contents: heading `Request a song`, helper text, three labeled inputs (`type="url"`, `type="text"`), a hidden honeypot `<input id="request-website" name="website" tabindex="-1" autocomplete="off">` inside `<div class="request-hp" aria-hidden="true">`, a status `<div id="request-status" role="status">`, and buttons `Cancel` / `Send request`.
- Change the CSS and JS query strings to `?v=16`.

- [ ] **Step 2: Add styles to `css/style.css`**

Append a `/* Song request */` section:
- `.request-fab`: `position: fixed; right: 22px; bottom: 22px; z-index: 40; width: 48px; height: 48px; border-radius: 50%;` glass background, accent border/glow, centered SVG, `transition: transform .2s ease, box-shadow .2s ease`; hover lifts.
- `.request-modal[hidden] { display: none; }`
- `.request-modal`: fixed inset 0, z-index 50, grid place-items center.
- `.request-backdrop`: absolute inset 0, `background: rgba(5,6,15,.72)`, `backdrop-filter: blur(6px)`.
- `.request-card`: relative, width `min(420px, calc(100vw - 32px))`, panel background/border/radius, padding 22px, display grid gap 14px.
- Inputs: full width, dark background, border, radius 12px, padding 11px 12px, color text; focus border accent.
- `.request-hp`: `position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden;`
- `.request-actions`: flex end gap; cancel and submit button styles using accent gradient.
- `.request-status`: min-height 1.2em, muted; `.ok` green, `.err` accent-2.
- Respect `prefers-reduced-motion` for the fab transition.

- [ ] **Step 3: Add behavior to `js/app.js`**

Add near the top:
```js
const REQUEST_ENDPOINT = 'https://jamukot-dispatch.originragnarok05.workers.dev/request';
```

Add `initRequestForm()`:
- Query the button, modal, form, status, cancel.
- `open()` removes `hidden`, adds `document.body.classList.add('modal-open')`, focuses `#request-url`.
- `close()` adds `hidden`, removes class.
- Button click opens; cancel click closes; backdrop click closes; `keydown` Escape closes when open.
- Submit handler:
  - `preventDefault()`.
  - Read and trim URL/title/artist; client-validate non-empty and URL starts with `http`.
  - Disable submit, set status to `Sending…`, class `''`.
  - `fetch(REQUEST_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ youtube_url, title, artist, website }) })`.
  - Parse JSON defensively.
  - Success: reset form, status `Request sent! The owner will review it.` class `ok`; re-enable submit.
  - Failure: status `data.error || \`Request failed (${resp.status})\`` class `err`; re-enable.
  - Network error: `Network error: ${e.message}` class `err`.
- Call `initRequestForm();` in the init section next to `loadTracks();`.

- [ ] **Step 4: Verify syntax and manual UI behavior**

Run:
```powershell
node --check js/app.js
python -m http.server 8000
```
Open `http://localhost:8000` and verify:
- The circular button is bottom-right and does not overlap player controls.
- Clicking opens the modal; Escape, Cancel, and backdrop close it.
- Empty submit shows a client validation message.
- The form fields and status are readable at 375 px width.
Expected: all checks pass.

- [ ] **Step 5: Commit**

```bash
git add index.html css/style.css js/app.js
git commit -m "Add floating song request form"
```

---

### Task 4: Bulk approval script and tests

**Files:**
- Create: `scripts/approve_requests.py`
- Create: `approve-requests.ps1`
- Create: `tests/test_approve_requests.py`

**Interfaces:**
- Consumes: `data/requests.json`, `data/tracks.json`, `.env` R2 credentials.
- Produces:
  - `normalize_text(value: str) -> str`
  - `normalize_key(title: str, artist: str) -> str`
  - `find_duplicate(title: str, artist: str, video_id: str | None, tracks: list[dict]) -> dict | None`
  - `unique_filename(stem: str, tracks: list[dict]) -> str`
  - `check_capacity(total: int, size: int, limit: int = LIMIT_BYTES) -> None` (raises `StorageLimitError`)
  - `run_batch(requests: list[dict], tracks_data: dict, processor: Callable) -> dict`
  - CLI: `python scripts/approve_requests.py [--dry-run] [--push] [--no-pull]`

- [ ] **Step 1: Write the failing tests in `tests/test_approve_requests.py`**

```python
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("approve_requests", ROOT / "scripts" / "approve_requests.py")
ar = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ar)


class TestNormalization(unittest.TestCase):
    def test_brackets_feat_case_and_the(self):
        self.assertEqual(
            ar.normalize_key("Song (Official Video)", "The Artist feat. Someone"),
            ar.normalize_key("song", "Artist"),
        )

    def test_different_songs_differ(self):
        self.assertNotEqual(ar.normalize_key("Song A", "Artist"), ar.normalize_key("Song B", "Artist"))

    def test_unicode_is_folded(self):
        self.assertEqual(ar.normalize_key("Café", "Beyoncé"), ar.normalize_key("Cafe", "Beyonce"))


class TestDuplicates(unittest.TestCase):
    def test_matches_existing_track_by_key(self):
        tracks = [{"title": "Song", "artist": "Artist"}]
        self.assertIsNotNone(ar.find_duplicate("Song (Lyrics)", "Artist", None, tracks))

    def test_matches_youtube_id(self):
        tracks = [{"title": "Other", "artist": "Person", "youtube_id": "dQw4w9WgXcQ"}]
        self.assertIsNotNone(ar.find_duplicate("New", "New", "dQw4w9WgXcQ", tracks))

    def test_returns_none_for_new_song(self):
        self.assertIsNone(ar.find_duplicate("New", "New", "dQw4w9WgXcQ", []))


class TestFilename(unittest.TestCase):
    def test_suffixes_when_name_exists(self):
        tracks = [{"url": "https://x.test/Artist%20-%20Song.mp3"}]
        self.assertEqual(ar.unique_filename("Artist - Song", tracks), "Artist - Song (2).mp3")

    def test_plain_name_when_unique(self):
        self.assertEqual(ar.unique_filename("Artist - Song", []), "Artist - Song.mp3")


class TestBatch(unittest.TestCase):
    def test_duplicate_and_failure_do_not_block_others(self):
        requests = [
            {"title": "Duplicate", "artist": "A"},
            {"title": "Fails", "artist": "B"},
            {"title": "Good", "artist": "C"},
        ]
        tracks_data = {"tracks": []}

        def processor(req, data):
            if req["title"] == "Duplicate":
                return "duplicate"
            if req["title"] == "Fails":
                raise RuntimeError("download failed")
            return "added"

        result = ar.run_batch(requests, tracks_data, processor)
        self.assertEqual(result["added"], 1)
        self.assertEqual(result["duplicate"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertEqual([r["title"] for r in requests], ["Fails"])
        self.assertEqual(requests[0]["attempts"], 1)
        self.assertIn("download failed", requests[0]["last_error"])

    def test_storage_limit_stops_and_keeps_remaining(self):
        requests = [{"title": "A"}, {"title": "B"}]

        def processor(req, data):
            raise ar.StorageLimitError("cap")

        result = ar.run_batch(requests, {"tracks": []}, processor)
        self.assertTrue(result["stopped"])
        self.assertEqual(len(requests), 2)

    def test_capacity(self):
        ar.check_capacity(0, 10, limit=100)
        with self.assertRaises(ar.StorageLimitError):
            ar.check_capacity(95, 10, limit=100)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m unittest tests.test_approve_requests -v`
Expected: FAIL — cannot find `scripts/approve_requests.py`.

- [ ] **Step 3: Implement `scripts/approve_requests.py`**

Implementation notes:
- Load `.env` with the same `load_env()` used by `add_track.py`.
- Module constants: `BASE`, `TRACKS`, `REQUESTS`, `LIMIT_BYTES`, `BUCKET`, `PUBLIC_URL`, `ACCOUNT_ID`, `ACCESS_KEY`, `SECRET_KEY`.
- Create the S3 client lazily in `make_s3()` so importing the module for tests does not require credentials.
- `normalize_text`: lowercase, `unicodedata.normalize("NFKD")`, strip combining marks, remove bracketed groups, remove `feat`/`ft` tails, replace non-alphanumerics with spaces, collapse, strip, strip leading `the `.
- `find_duplicate`: check `youtube_id` first, then `normalize_key`.
- `unique_filename`: compare case-insensitively against the unquoted basename of every track URL; append ` (2)`, ` (3)`, etc.
- `check_capacity(total, size, limit)`: raise `StorageLimitError` if `total + size > limit`.
- `run_batch(requests, tracks_data, processor)`:
  - Iterate `list(requests)`.
  - Call `processor(req, tracks_data)`.
  - On `StorageLimitError`: set `result["stopped"] = True`, break, leave the request and all remaining requests untouched.
  - On any other exception: increment `req["attempts"]`, set `req["last_error"]`, count `failed`, keep the request.
  - On `"added"` or `"duplicate"`: remove the request from `requests`, increment the matching count.
  - Return `{added, duplicate, failed, stopped}`.
- `process_one(req, tracks_data, s3, workdir)`:
  - `video_id = extract_youtube_id(req["youtube_url"])`; raise `ValueError` if invalid.
  - `tracks = tracks_data.setdefault("tracks", [])`.
  - If `find_duplicate(...)`: return `"duplicate"`.
  - `total = sum(t.get("size", 0) for t in tracks)`.
  - Download with the same yt-dlp flags as `add_track.py` (`-f bestaudio`, `--no-playlist`, `--js-runtimes node`, `--remote-components ejs:github`, optional `--cookies` from `YOUTUBE_COOKIES_FILE`) into `workdir`.
  - Compress with `ffmpeg -y -i <src> -vn -map a -b:a 128k -ar 44100 <workdir>/out.mp3`.
  - `size = os.path.getsize(...)`; `check_capacity(total, size)`.
  - Probe duration with `ffprobe`.
  - `stem = sanitize(f"{artist} - {title}")`; `filename = unique_filename(stem, tracks)`.
  - Upload to R2 with `ContentType: audio/mpeg`.
  - Append track: `{id: max(...)+1, title, artist, url: PUBLIC_URL + "/" + quote(filename, safe=""), duration, size, youtube_id: video_id}`.
  - Save `tracks.json` immediately; return `"added"`.
- `main()`:
  - argparse `--dry-run`, `--push`, `--no-pull`.
  - `git pull --ff-only` unless `--no-pull`.
  - Load requests and tracks; filter `status == "pending"` for display; if none, print and exit.
  - Dry run: print each pending request and whether it matches an existing track; exit.
  - `run_batch(pending, tracks_data, lambda req, data: process_one(req, data, s3, workdir))`.
  - Save `requests.json` after the batch (it is also saved per success).
  - Print summary and remaining count.
  - If `--push`: `git pull --rebase`; if no changes, skip; else `git add data/tracks.json data/requests.json`, `git commit -m "Approve song requests"`, `git push`.
- Use `tempfile.mkdtemp()` for downloads; delete it in `finally`.
- `extract_youtube_id` in Python mirrors the JS regex.

- [ ] **Step 4: Create `approve-requests.ps1`**

```powershell
param(
  [switch]$DryRun,
  [switch]$Push,
  [switch]$NoPull,
  [Parameter(ValueFromRemainingArguments = $true)]$Rest
)
$argsList = @()
if ($DryRun) { $argsList += '--dry-run' }
if ($Push) { $argsList += '--push' }
if ($NoPull) { $argsList += '--no-pull' }
python "$PSScriptRoot\scripts\approve_requests.py" @argsList @Rest
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m unittest tests.test_approve_requests -v`
Expected: PASS, 10 tests.

- [ ] **Step 6: Dry-run against the current queue**

Run: `.\approve-requests.ps1 --dry-run --no-pull`
Expected: prints `No pending requests.` or a list of pending requests without downloading.

- [ ] **Step 7: Commit**

```bash
git add scripts/approve_requests.py approve-requests.ps1 tests/test_approve_requests.py
git commit -m "Add bulk song request approval script"
```

---

### Task 5: Deploy, workflow guard, docs, and end-to-end verification

**Files:**
- Modify: `.github/workflows/pages.yml` (add `paths-ignore` for `data/requests.json`)
- Modify: `instructions.md` (request workflow section)
- Deploy: worker
- Verify: live request submission + one approved track

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: working production endpoint and documented owner workflow.

- [ ] **Step 1: Update `pages.yml`**

Under `on.push`, add:

```yaml
    paths-ignore:
      - 'data/requests.json'
```

Keep `workflow_dispatch` unchanged.

- [ ] **Step 2: Update `instructions.md`**

Add a `## Song requests` section covering:
- Where the floating button is and what requesters enter.
- `.\approve-requests.ps1 --dry-run` to preview.
- `.\approve-requests.ps1 --push` to approve everything, compress/upload, and commit.
- Duplicates are skipped and removed; failures stay queued with `attempts`/`last_error`.
- The worker requires `GITHUB_TOKEN` with Contents read/write.

- [ ] **Step 3: Deploy the worker**

Run:
```powershell
cd worker
npx wrangler deploy
```
Expected: deploy succeeds and prints the `jamukot-dispatch` URL.

- [ ] **Step 4: Verify the token can write the queue**

Submit a request against the live endpoint:
```powershell
$body = @{
  youtube_url = 'https://www.youtube.com/watch?v=BaW_jenozKc'
  title = 'Jamukot Request Test'
  artist = 'Test'
  website = ''
} | ConvertTo-Json
Invoke-WebRequest -Uri 'https://jamukot-dispatch.originragnarok05.workers.dev/request' `
  -Method Post -Headers @{ Origin='https://sensesvoid.github.io' } `
  -ContentType 'application/json' -Body $body -UseBasicParsing
```
Expected: `200` with `{"ok":true,"id":"..."}`. If `500` mentions the queue, the token lacks Contents write — update the `GITHUB_TOKEN` secret and redeploy/retry.

- [ ] **Step 5: Verify the queue file**

Run:
```powershell
Start-Sleep -Seconds 3
(Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/sensesVoid/jamukot/main/data/requests.json' -UseBasicParsing).Content
```
Expected: the JSON contains the test request with `status: "pending"`.

- [ ] **Step 6: Verify duplicate rejection**

Submit the exact same request again.
Expected: `409` with `Already requested` (or `Already in the library` after approval).

- [ ] **Step 7: Approve the test request end-to-end**

Run:
```powershell
.\approve-requests.ps1 --dry-run --no-pull
.\approve-requests.ps1 --push
```
Expected:
- The script downloads, compresses, uploads, and prints `Added: Test - Jamukot Request Test`.
- `data/requests.json` becomes `{"requests": []}`.
- `data/tracks.json` contains the new track with a `youtube_id`.
- The R2 URL returns `200`/`206` with `audio/mpeg`.
- The commit is pushed.

- [ ] **Step 8: Remove the test track**

Find its ID and delete it:
```powershell
python scripts/delete_track.py --title "Jamukot Request Test" --push
```
Expected: the test row and R2 object are removed, and the live site is back to 476 tracks.

- [ ] **Step 9: Verify the live UI**

Open `https://sensesvoid.github.io/jamukot/` and confirm:
- The floating request button is visible.
- The modal opens/closes cleanly.
- A valid request returns the success message.
- A duplicate returns the duplicate message.
- The layout works at desktop and mobile widths.

- [ ] **Step 10: Commit and push**

```bash
git add .github/workflows/pages.yml instructions.md docs/superpowers/specs/2026-11-09-song-requests-design.md docs/superpowers/plans/2026-11-09-song-requests.md
git commit -m "Document song request workflow"
git push
```

Expected: Pages deploy succeeds and the live site shows the request button.
