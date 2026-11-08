# Jamukot — Aesthetic Web Music Player

[![Live Site](https://img.shields.io/badge/Live%20Site-sensesvoid.github.io%2Fjamukot-7c5cff?style=for-the-badge)](https://sensesvoid.github.io/jamukot/)

**Live site:** https://sensesvoid.github.io/jamukot/

A static music player hosted on **GitHub Pages** (`github.io`). Features:
- Playlist with search, shuffle, repeat, seek, volume
- Vinyl/CD spin animation with tonearm + cover art
- Synced lyrics (karaoke-style) via [LRCLIB](https://lrclib.net)
- Add tracks from YouTube via a GitHub Actions workflow (download → compress to 128kbps MP3 → commit to `AudioFile/`)

## Structure
```
.
├── index.html
├── css/style.css
├── js/app.js
├── data/tracks.json          # track metadata
├── AudioFile/                # compressed mp3s
├── scripts/
│   ├── gen_tracks.py         # regenerate tracks.json from AudioFile
│   └── add_track.py          # download + compress + register (used by CI)
└── .github/workflows/
    ├── add-track.yml         # manual dispatch: YouTube -> mp3 -> commit
    └── pages.yml             # deploy to GitHub Pages
```

## Setup
1. Create repo `sensesVoid/jamukot` and push this folder.
2. Enable GitHub Pages: Settings → Pages → Source = "GitHub Actions".
3. (Optional) In the player, open Settings and store a PAT (scopes `repo`, `workflow`) to dispatch the Add Track workflow from the UI.

## Add a track (easiest: one command, no setup)

```powershell
.\add-track.ps1 "https://youtube.com/watch?v=..." "Song title" "Artist name"
```
That's it — it downloads, compresses to 128 kbps, commits, and pushes. The site redeploys automatically; refresh after ~1 min.

Or in any shell:
```bash
python scripts/add_track.py "URL" --title "Song" --artist "Artist" --push
```

## Add a track (in-browser, no terminal)

Open the player → **Add Track** → paste URL/title/artist → click **Add track**.
- If you deployed the Cloudflare Worker (see below) and set its URL in Settings, it's a true 1-click dispatch.
- Otherwise it copies the inputs to your clipboard and opens the GitHub Actions page for you to confirm.

### Optional: deploy the 1-click worker (one-time)
```bash
cd worker
npm i -g wrangler
npx wrangler login
npx wrangler secret put GITHUB_TOKEN   # PAT with repo+workflow scopes
npx wrangler deploy
```
Paste the printed `https://...workers.dev` URL into the player's Settings → Worker URL.

> **YouTube bot protection:** headless CI runners are often blocked by YouTube.
> To make the workflow succeed, export your browser cookies to a Netscape
> `cookies.txt` and store its full contents in a repo secret named
> `YOUTUBE_COOKIES` (Settings → Secrets and variables → Actions). The workflow
> writes that secret to a file and passes it to yt-dlp automatically.
> Without it, use the local method below (which uses your browser cookies).

## Add a track (CLI / local)
```bash
pip install yt-dlp
python scripts/add_track.py "https://youtube.com/watch?v=..." --title "Song" --artist "Artist"
```

## Regenerate metadata
```bash
python scripts/gen_tracks.py
```

## Compression profile
MP3, 128 kbps, 44.1 kHz, stereo (via ffmpeg `-b:a 128k`).

## Lyrics
Fetched at runtime from LRCLIB (free, no key). Synced LRC when available, otherwise plain lyrics.
