# Jamukot — Track Management Reference

Quick reference for adding, deleting, replacing, and approving requested tracks. Audio is hosted on Cloudflare R2 (free tier, 10 GB cap). The site auto-redeploys after any push that changes player files.

## Prerequisites (one-time)

- Python 3 with `yt-dlp`, `ffmpeg`, `boto3` installed.
- `.env` file in the repo root with R2 credentials:
  ```
  Access_Key_ID=...
  Secret_Access_Key=...
  R2_BUCKET=jamukot-audio
  R2_PUBLIC_URL=https://jamukot-audio.originragnarok05.workers.dev
  R2_ACCOUNT_ID=...
  ```
- Git configured and authenticated to push to `sensesVoid/jamukot`.

## Add a track

**One command (recommended):**
```powershell
.\add-track.ps1 "https://youtube.com/watch?v=..." "Song title" "Artist name"
```
Downloads from YouTube, compresses to 128 kbps MP3, uploads to R2, updates `data/tracks.json`, commits, and pushes. Site redeploys automatically (~1 min).

**If you already have the MP3 file:**
1. Drop it into `AudioFile/`.
2. Run:
   ```powershell
   python scripts/gen_tracks.py
   ```
   (This regenerates `tracks.json` from `AudioFile/` — but does NOT upload to R2. For R2, use the script below instead.)
3. Or upload manually to R2 and add an entry to `data/tracks.json`.

**Manual (any shell):**
```bash
python scripts/add_track.py "URL" --title "Song" --artist "Artist" --push
```

**Storage limit:** 9.5 GB. The script refuses to add if the limit would be exceeded. Check usage in the top bar of the player.

## Delete a track

The player playlist shows each track's **ID** (e.g. `#42`) next to the duration. Use that ID to avoid ambiguity when titles repeat.

**By track ID (recommended):**
```powershell
.\delete-track.ps1 5 -Push
```

**By title (partial match):**
```powershell
.\delete-track.ps1 "Song title" -Push
```

**By title + artist (when titles repeat):**
```powershell
.\delete-track.ps1 "Song title" -Artist "Artist name" -Push
```
Removes the file from R2, removes the entry from `tracks.json`, commits, and pushes.

**Manual (any shell):**
```bash
python scripts/delete_track.py --id 5 --push
# or
python scripts/delete_track.py --title "Song" --artist "Artist" --push
```

## Replace a track

Replace an existing track with a new one (deletes old from R2, downloads + uploads new). Use the track's **ID** (shown as `#N` in the playlist) to avoid confusion with duplicate titles.

```powershell
.\replace-track.ps1 5 "https://youtube.com/watch?v=..." "New title" "New artist" -Push
```

**By title (or title + artist when titles repeat):**
```powershell
.\replace-track.ps1 "Old title" "URL" "New title" "New artist" -Push
.\replace-track.ps1 "Old title" "URL" "New title" "New artist" -OldArtist "Artist" -Push
```

**Manual (any shell):**
```bash
python scripts/replace_track.py --id 5 "URL" --new-title "New" --new-artist "Artist" --push
# or
python scripts/replace_track.py --title "Old" --artist "Artist" "URL" --new-title "New" --new-artist "Artist" --push
```

## Song requests

Visitors can click the small floating button at the bottom-right of the player and submit a YouTube URL, title, and artist. Submissions are appended to `data/requests.json` by the `jamukot-dispatch` Worker through the GitHub Contents API. Duplicate submissions are rejected immediately (same normalized title + artist, or same YouTube video ID).

Preview the queue without changing anything:
```powershell
.\approve-requests.ps1 -DryRun
```

Approve every pending request:
```powershell
.\approve-requests.ps1 -Push
```
For each pending request, the script downloads with `yt-dlp`, compresses to 128 kbps, uploads to R2, and appends to `data/tracks.json`. Approved and duplicate entries are removed from `data/requests.json`; failed downloads stay queued with `attempts` and `last_error` so they can be retried. A duplicate or failure never stops the rest of the batch. The 9.5 GB cap stops the batch before an upload that would exceed it.

The Worker needs a `GITHUB_TOKEN` secret with **Contents: Read and write** on `sensesVoid/jamukot` (plus the existing workflow-dispatch scope). Commits that only touch `data/requests.json` do not trigger a Pages deploy.

## Notes

- All scripts require `ffmpeg` and `node` on PATH (for yt-dlp).
- After any player change, refresh https://sensesvoid.github.io/jamukot/ to see updates (~1 min after push).
- Storage usage is shown in the top bar of the player (X.XX / 9.5 GB).
