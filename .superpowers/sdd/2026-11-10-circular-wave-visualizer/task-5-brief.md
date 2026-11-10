### Task 5: Tighten CSP, clean up, and deploy

**Files:**
- Modify: `index.html` (CSP meta)
- Modify: `js/app.js`, `css/style.css` (leftover cleanup only)

- [ ] **Step 1: Tighten the CSP**

In the CSP meta tag:
- Remove `https://itunes.apple.com` from `connect-src`.
- Change `img-src 'self' data: https:` to `img-src 'self' data:`.

- [ ] **Step 2: Run all checks**

```bash
node --test tests/wave-ring.test.js
node --check js/app.js
node --check js/wave-ring.js
python scripts/verify_audio.py
```

Expected: 7 tests pass, both syntax checks are clean, and every audio file is OK.

Grep for leftovers and confirm zero matches:

```powershell
Select-String -Path index.html,css/style.css,js/app.js -Pattern "vinyl|tonearm|cover-img|cover-fallback|visualizer|itunes"
```

- [ ] **Step 3: Manual browser checks**

- 320px viewport: ring fits without horizontal scroll.
- Resize the window: ring stays sharp and centered.
- Background the tab for 10 seconds: no animation work when hidden; it resumes correctly.
- Enable reduced motion in DevTools: ring is static; playback still works.
- Console: no CSP errors and no request to `itunes.apple.com`.

- [ ] **Step 4: Commit and deploy**

```bash
git add index.html css/style.css js/app.js js/wave-ring.js
git commit -m "chore: tighten CSP and finish wave ring cleanup"
git push
```

Wait for the Pages workflow, then verify the live page contains `wave-ring`, no `vinyl`, and a CSP without `itunes.apple.com`.

- [ ] **Step 5: Confirm live**

```powershell
$h = (Invoke-WebRequest -Uri 'https://sensesvoid.github.io/jamukot/' -UseBasicParsing -TimeoutSec 30).Content
"wave-ring: $($h -match 'wave-ring')"
"no vinyl: $(-not ($h -match 'vinyl'))"
"no itunes: $(-not ($h -match 'itunes'))"
```

Expected: `wave-ring: True`, `no vinyl: True`, `no itunes: True`.