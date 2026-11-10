### Task 4: Drive the ring from the analyser

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `waveRing` and `WaveRing.Ring` from Task 3.
- Produces: play/pause/error/end wiring; no new public API.

- [ ] **Step 1: Raise analyser resolution**

In `initAudio()`, change `analyser.fftSize = 128` to `analyser.fftSize = 256`. After the analyser is connected, add:

```js
if (waveRing) waveRing.setAnalyser(analyser);
```

- [ ] **Step 2: Replace visualizer calls**

- In `playBuffer()`, replace `startVisualizer()` with `if (waveRing) waveRing.start();`.
- In `pausePlayback()`, replace `stopVisualizer()` with `if (waveRing) waveRing.stop();` and delete the `vinylEl.style.scale = '1'` line.
- In `playIndex()`, delete `initVisualizer()`, `updateVinyl(true)`, and `fetchCover(t)`.
- Replace the two remaining `updateVinyl(false)` calls (load error and repeat-off end) with `if (waveRing) waveRing.stop();`.

- [ ] **Step 3: Remove the dead visual/cover code**

Delete:
- `vinylEl`, `tonearmEl`, `updateVinyl`, `fetchCover`, `initialsOf`, `hashStr`
- `coverCache` from `state`
- `resizeVisualizer`, `initVisualizer`, `drawVisualizer`, `startVisualizer`, `stopVisualizer`
- the `#visualizer` and `#cover-img`/`#cover-fallback` references

Confirm no remaining matches:

Run: `Select-String -Path js/app.js -Pattern "vinyl|tonearm|cover|visualizer"`
Expected: no matches.

- [ ] **Step 4: Verify audio wiring**

Run: `node --check js/app.js`
Expected: no errors.

Manually confirm:
- Play: bars move and the center stays empty.
- Pause: bars settle to the dim resting shape; no animation.
- Seek, next, previous: the ring keeps reacting without overlapping loops.
- A failed track: the ring stops and the error message still appears.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: drive wave ring from the audio analyser"
```