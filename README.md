# Jamukot — Aesthetic Web Music Player

[![Live Site](https://img.shields.io/badge/Live%20Site-sensesvoid.github.io%2Fjamukot-7c5cff?style=for-the-badge)](https://sensesvoid.github.io/jamukot/)

**Live site:** https://sensesvoid.github.io/jamukot/

A static, self-hosted music player on **GitHub Pages**. All audio is compressed to **Opus (16 kbps)** and stored directly in the repo — no external storage needed. Works in strict network environments where only GitHub and Cloudflare are allowed.

### Features
- Playlist with search, shuffle, repeat, seek, volume
- Vinyl/CD spin animation with tonearm + cover art
- Synced lyrics (karaoke-style) — offline-capable via pre-fetched `data/lyrics.json`
- Beat-synced frequency visualizer (canvas)
- Song request form (floating button → modal → Cloudflare Worker queue)
- Work Rant/Confession wall (Cloudflare KV backend, 200-char limit, 3 posts/day)
- Storage indicator (MB / 780 MB)

### Versions
- **v2.0** (current): Opus on GitHub Pages — https://github.com/sensesVoid/jamukot/releases/tag/v2.0
- **v1.0**: MP3 on Cloudflare R2 — https://github.com/sensesVoid/jamukot/releases/tag/v1.0

## Structure
```
.
├── index.html
├── css/style.css
├── js/
│   ├── app.js
│   └── lib/ogg-opus-decoder.min.js   # vendored Opus decoder (no CDN)
├── audio/                            # Opus files (16 kbps)
├── data/
│   ├── tracks.json                   # track metadata
│   └── lyrics.json                   # pre-fetched lyrics (offline)
├── scripts/
│   ├── encode_opus.py                # bulk MP3 → Opus migration
│   ├── add_track.py                  # download → Opus → register
│   ├── delete_track.py               # remove track + file
│   ├── replace_track.py              # replace track
│   ├── approve_requests.py           # bulk-approve song requests
│   └── fetch_lyrics.py               # fetch lyrics from LRCLIB
├── encode-opus.ps1                   # PowerShell wrapper
├── fetch-lyrics.ps1
├── add-track.ps1 / delete-track.ps1 / replace-track.ps1
├── worker/                           # Cloudflare Worker (dispatch + requests + rants)
└── .github/workflows/
    ├── pages.yml                     # deploy to GitHub Pages
    └── add-track.yml                 # CI track addition
```

## Setup
1. Clone the repo.
2. Enable GitHub Pages: Settings → Pages → Source = "GitHub Actions".
3. (Optional) Deploy the Cloudflare Worker for song requests and rant wall:
   ```bash
   cd worker
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN      # PAT with repo+workflow scopes
   npx wrangler secret put RANT_ADMIN_TOKEN  # any secret string for pinning rants
   ```

## Add a track
```powershell
.\add-track.ps1 "https://youtube.com/watch?v=..." "Song title" "Artist name"
```
Downloads, compresses to Opus (16 kbps), saves to `audio/<id>.opus`, updates `tracks.json`, commits, and pushes.

Or in any shell:
```bash
python scripts/add_track.py "URL" --title "Song" --artist "Artist" --push
```

## Delete a track
```powershell
.\delete-track.ps1 <id> -Push
```

## Replace a track
```powershell
.\replace-track.ps1 <id> "URL" "New title" "New artist" -Push
```

## Song requests
Visitors can click the floating button (bottom-right) to request a song. Requests queue in `data/requests.json` via the Cloudflare Worker. Approve in bulk:
```powershell
.\approve-requests.ps1 -DryRun   # preview
.\approve-requests.ps1 -Push     # approve all, encode to Opus, commit, push
```

## Rant wall
Visitors can post rants (alias + message, 200-char limit, 3/day). To pin a post, triple-click the "Rant Wall" title and enter the admin token.

## Lyrics (offline)
```powershell
.\fetch-lyrics.ps1               # fetch all
.\fetch-lyrics.ps1 -Limit 50     # fetch a batch
```

## Compression profile
Opus, 16 kbps, VBR, 48 kHz, stereo (via ffmpeg `-c:a libopus -b:a 16k`). Each 3-minute track ≈ 360 KB.

## Strict environment
All audio and lyrics are served from GitHub Pages. Only the song-request and rant-wall features use Cloudflare Workers (also allowed in strict environments). Fonts fall back to system fonts if Google Fonts is blocked.