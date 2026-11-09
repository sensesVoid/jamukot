# Song Requests — Design

## Intent

Let visitors request a song from the player without giving them admin access. Requests collect in a queue that the owner reviews and approves locally in bulk. Approved songs are downloaded, compressed to 128 kbps, uploaded to R2, and added to `data/tracks.json`. Duplicates are skipped without blocking the rest of the batch.

## Goals

- Small floating "Request a song" button on the player.
- Modal form: YouTube URL, Title, Artist.
- Requests stored in `data/requests.json` (public repo, inspectable, editable).
- One local command approves the whole pending queue.
- Duplicate detection at both submit time and approval time.
- A duplicate or failed request never stops other requests from processing.
- Approved and duplicate requests are removed from the queue.
- 9.5 GB storage cap still enforced.
- Existing dispatch worker and GitHub token reused; no new Cloudflare product.

## Non-goals

- No public approval UI, accounts, or login.
- No automatic downloads in GitHub Actions/CI.
- No fuzzy audio fingerprinting.
- No request editing/withdrawing UI.
- No Cloudflare Turnstile (can be added later if spam appears).

## Anti-goals

- A request must never modify `tracks.json`; only the approval script does that.
- A failed request must never be silently deleted.
- The GitHub token must never reach the browser.
- A duplicate must never abort the batch.

## Approaches considered

1. **Existing Worker + `data/requests.json` via GitHub Contents API (chosen).** No new infrastructure. Queue is visible and editable in the repo. Each submission creates a small commit; Pages deploys can ignore that file.
2. **Worker + Workers KV.** Cleaner storage and no commit churn, but requires a KV namespace, an admin secret, and the queue is invisible outside the script.
3. **GitHub Issues.** No backend, but requesters need a GitHub account and the queue lives outside the repo's data.

Approach 1 matches the existing setup and the "JSON file" requirement with the least new machinery.

## Architecture

```
Browser form
  -> POST https://jamukot-dispatch.originragnarok05.workers.dev/request
     -> validates + dedupes against tracks.json and requests.json
     -> appends to data/requests.json via GitHub Contents API (retry on SHA conflict)

Local owner
  -> .\approve-requests.ps1 [--dry-run] [--push]
     -> pulls latest requests.json
     -> for each pending request: dedupe, yt-dlp, ffmpeg 128k, R2 upload
     -> updates tracks.json + requests.json after each success
     -> commits/pushes when --push
```

## Data model

### `data/requests.json`

```json
{
  "requests": [
    {
      "id": "uuid",
      "youtube_url": "https://www.youtube.com/watch?v=...",
      "video_id": "dQw4w9WgXcQ",
      "title": "Song Title",
      "artist": "Artist Name",
      "requested_at": "2026-11-09T12:34:56.000Z",
      "status": "pending",
      "attempts": 0,
      "last_error": null
    }
  ]
}
```

Only `status: "pending"` entries are processed. The script removes entries it resolves (added or duplicate). Failures stay with `attempts + 1` and `last_error`.

### Track entry

New tracks optionally gain `youtube_id`; existing fields stay unchanged:

```json
{
  "id": 477,
  "title": "Song Title",
  "artist": "Artist Name",
  "url": "https://jamukot-audio.originragnarok05.workers.dev/Artist%20-%20Song.mp3",
  "duration": 213.4,
  "size": 3412345,
  "youtube_id": "dQw4w9WgXcQ"
}
```

Existing 476 tracks have no `youtube_id`; they are matched by title + artist.

## Worker

Extend `worker/index.js`; existing `POST /` dispatch behavior stays unchanged.

### `POST /request`

Body: `{ "youtube_url": "...", "title": "...", "artist": "...", "website": "" }`

Validation:
- CORS: allow `https://sensesvoid.github.io`; reject other non-empty origins.
- Honeypot `website` must be empty.
- Accept `youtube.com/watch?v=`, `music.youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`.
- Extract and validate the 11-character video ID.
- Trim/sanitize title and artist: strip control characters, collapse whitespace, 1–120 characters.
- Best-effort rate limit: 5 submissions per IP per 10 minutes (in-memory, per isolate).

Duplicate checks:
- Normalize title + artist: lowercase, remove bracketed segments, remove `feat.`/`ft.` tails, strip punctuation, collapse whitespace, strip leading `the `.
- Reject if normalized title+artist matches any track or pending request.
- Reject if the YouTube video ID matches a pending request.
- Return `409` with `Already in the library` or `Already requested`.

Write:
- Read `data/requests.json` via GitHub Contents API; if 404, start with an empty list.
- Append request with UUID, UTC timestamp, status `pending`.
- PUT via Contents API with current SHA; retry up to 3 times on `409`.
- Return `{ ok: true, id }`.

Requires the existing `GITHUB_TOKEN` secret to have **Contents: Read and write** on `sensesVoid/jamukot`. If the token lacks permission, return a clear `500` error.

Also add `data/requests.json` to `pages.yml` `paths-ignore` so queue commits do not redeploy the site.

## Approval script

`scripts/approve_requests.py` plus `approve-requests.ps1` wrapper.

Flow:
1. `git pull --ff-only` unless `--no-pull`.
2. Load `.env`, `data/tracks.json`, `data/requests.json`.
3. If `--dry-run`, report what would happen and stop.
4. For each pending request:
   - Re-validate URL/video ID.
   - Duplicate if `youtube_id` matches a track, or normalized title+artist matches a track or an earlier approved request in this run.
   - Duplicate: remove the request, count `duplicate`, continue.
   - Storage cap: if adding would exceed 9.5 GB, stop the batch with a clear message.
   - Download with `yt-dlp`, compress with `ffmpeg -b:a 128k -ar 44100`, probe duration, upload to R2 as `Artist - Title.mp3`.
   - Append track with new ID and `youtube_id`, save `tracks.json`, remove request, save `requests.json` immediately.
   - Any exception: keep request, increment `attempts`, set `last_error`, save, continue to the next request.
5. Print summary: added, duplicates, failed, remaining.
6. With `--push`: `git pull --rebase`, commit `data/tracks.json` and `data/requests.json`, push.

Naming/sanitization mirrors `scripts/add_track.py` so filenames stay consistent.

## Frontend

- Fixed 48 px circular button, bottom-right, glass style, music-plus icon, `aria-label="Request a song"`.
- Modal with backdrop:
  - YouTube URL (required, URL input)
  - Title (required, max 120)
  - Artist (required, max 120)
  - Hidden honeypot `website`
  - Submit / Cancel, inline status message
- Close on Esc, backdrop click, and Cancel. Focus the URL field on open. Disable submit while the request is in flight.
- POST JSON to the worker `/request`; show server errors verbatim (duplicate, rate limit, invalid URL).
- No login; the endpoint is public but guarded by origin check, honeypot, rate limit, and dedupe.
- Bump `?v=16` for `style.css` and `app.js`.

## Deployment steps

1. Add empty `data/requests.json`.
2. Extend worker and `pages.yml`; deploy worker with `cd worker && npx wrangler deploy`.
3. Verify `GITHUB_TOKEN` has Contents write; update secret if needed.
4. Commit/push site changes.
5. Submit one test request; run `.\approve-requests.ps1 --dry-run`; then run for real.

## Builder's calls

- One JSON array in the repo; low volume makes optimistic-concurrency retries sufficient.
- Best-effort in-memory rate limiting instead of KV/D1.
- Normalized exact title+artist matching; no duration/fuzzy matching to avoid false positives on covers and live versions.
- `youtube_id` only stored for new tracks; existing tracks match by title+artist.
- Worker route on the existing dispatch Worker rather than a new Worker.
- Failures remain in the queue for retry; only added and duplicate requests are removed.
