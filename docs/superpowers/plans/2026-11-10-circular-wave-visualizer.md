# Circular Wave Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vinyl, tonearm, album cover, and horizontal visualizer with one minimalist circular sound-wave canvas.

**Architecture:** A self-contained classic script (`js/wave-ring.js`) exposes pure spectrum/geometry helpers plus a `Ring` renderer. `app.js` owns the `AnalyserNode` and calls `Ring.start()` / `Ring.stop()`. One rAF loop draws all bars in a single stroked path and all tip dots in a single filled path.

**Tech Stack:** Vanilla JavaScript (classic script, no modules), Canvas 2D, Web Audio `AnalyserNode`, CSS, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-10-circular-wave-visualizer-design.md`

## Global Constraints

- No new runtime dependencies and no external assets.
- One rAF loop only; at most 2 canvas draw calls per frame.
- Zero allocations and zero layout reads inside the rAF callback.
- 80 bars; inner radius 30% of size; maximum bar length 19% of size.
- White bars at 90% opacity; tip dots ~1.6px with a ~2px gap.
- Empty center: no cover art, vinyl, tonearm, or horizontal bars.
- DPR capped at 2; canvas re-measured on resize only.
- Loop stops when paused or the tab is hidden; `prefers-reduced-motion` draws a static ring.
- CSP drops `https://itunes.apple.com`; `img-src` becomes `'self' data:`.
- Site remains a static GitHub Pages deployment; scripts stay classic (no `type="module"`).

## Review Focus

- **Silent or quiet audio:** the ring settles to a dim resting shape instead of flickering or going blank.
- **Bass-heavy audio:** the radius pulse stays within ±2%, and bar levels clamp at 1 so nothing draws outside the canvas.
- **Pause or background tab:** the loop cancels and CPU drops; resuming continues from the current levels.
- **Resize, orientation, or DPR change:** the canvas stays sharp and centered, with no stretched or offset bars.
- **Reduced motion or a missing canvas/analyser:** the ring is static or silently skipped; playback never breaks.

---

### Task 1: Spectrum, geometry, and smoothing helpers

**Files:**
- Create: `js/wave-ring.js`
- Create: `tests/wave-ring.test.js`

**Interfaces:**
- Produces:
  - `mapSpectrum(data: Uint8Array, out: Float32Array, sampleRate: number): Float32Array`
  - `barCoords(out: object, size: number, count: number, index: number, level: number, scale?: number): object` with fields `angle`, `r0`, `r1`, `x1`, `y1`, `x2`, `y2`
  - `smoothLevels(targets: Float32Array, levels: Float32Array, factor: number): Float32Array`
- The file is a UMD-style classic script: it sets `globalThis.WaveRing` and also `module.exports` when running under Node.

- [ ] **Step 1: Write the failing tests**

Create `tests/wave-ring.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { mapSpectrum, barCoords, smoothLevels } = require('../js/wave-ring.js');

test('mapSpectrum fills one level per bar in 0..1', () => {
  const data = new Uint8Array(128);
  for (let i = 0; i < data.length; i++) data[i] = i * 2;
  const out = new Float32Array(80);
  mapSpectrum(data, out, 48000);
  assert.equal(out.length, 80);
  for (const v of out) assert.ok(v >= 0 && v <= 1);
});

test('mapSpectrum puts a low-frequency peak in the first bar and silence in the last', () => {
  const data = new Uint8Array(128).fill(0);
  data[0] = 255;
  const out = new Float32Array(80);
  mapSpectrum(data, out, 48000);
  assert.ok(out[0] > 0.2);
  assert.equal(out[79], 0);
});

test('mapSpectrum returns silence for silent input', () => {
  const data = new Uint8Array(128);
  const out = new Float32Array(80).fill(0.5);
  mapSpectrum(data, out, 48000);
  assert.ok(out.every((v) => v === 0));
});

test('barCoords starts at the top and clamps the level', () => {
  const g = {};
  barCoords(g, 300, 80, 0, 0, 1);
  assert.ok(Math.abs(g.x1 - 150) < 1e-9);
  assert.ok(Math.abs(g.y1 - 60) < 1e-9);
  assert.ok(Math.abs(g.r1 - g.r0) < 1e-9);

  barCoords(g, 300, 80, 0, 5, 1);
  assert.ok(Math.abs(g.r1 - 300 * 0.49) < 1e-9);
  assert.ok(g.y2 >= 0 && g.y2 <= 300);
});

test('barCoords handles the right side and scale', () => {
  const g = {};
  barCoords(g, 300, 80, 20, 1, 1);
  assert.ok(Math.abs(g.x1 - 240) < 1e-9);
  assert.ok(Math.abs(g.y1 - 150) < 1e-9);

  barCoords(g, 300, 80, 0, 1, 1.02);
  assert.ok(Math.abs(g.r0 - 300 * 0.30 * 1.02) < 1e-9);
});

test('smoothLevels moves toward targets and clamps the factor', () => {
  const levels = new Float32Array([0, 0]);
  smoothLevels(new Float32Array([1, 0.5]), levels, 0.5);
  assert.ok(Math.abs(levels[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(levels[1] - 0.25) < 1e-9);

  const unchanged = new Float32Array([0.2, 0.4]);
  smoothLevels(new Float32Array([1, 1]), unchanged, 0);
  assert.deepEqual(Array.from(unchanged), [0.2, 0.4]);

  const snapped = new Float32Array([0, 0]);
  smoothLevels(new Float32Array([0.3, 0.7]), snapped, 2);
  assert.deepEqual(Array.from(snapped), [0.3, 0.7].map(Math.fround));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/wave-ring.test.js`
Expected: FAIL because `../js/wave-ring.js` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `js/wave-ring.js` with the UMD wrapper:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WaveRing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MIN_HZ = 40;
  const MAX_HZ = 16000;
  const INNER_RATIO = 0.30;
  const BAR_RATIO = 0.19;
  // mapSpectrum, barCoords, smoothLevels here
  return { mapSpectrum, barCoords, smoothLevels };
});
```

Implementation rules:
- `mapSpectrum` maps `MIN_HZ..MAX_HZ` logarithmically across `out.length` bars and averages the covered FFT bins, dividing by 255 and clamping to `0..1`. It must not allocate.
- `barCoords` uses `angle = -Math.PI / 2 + (index / count) * Math.PI * 2`, `r0 = size * INNER_RATIO * scale`, `r1 = r0 + size * BAR_RATIO * clampedLevel * scale`, and a center of `size / 2`. It writes into `out` and returns it.
- `smoothLevels` applies `levels[i] += (targets[i] - levels[i]) * clampedFactor` in place and returns `levels`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wave-ring.test.js`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/wave-ring.js tests/wave-ring.test.js
git commit -m "feat: add wave-ring spectrum and geometry helpers"
```

---

### Task 2: Canvas ring renderer

**Files:**
- Modify: `js/wave-ring.js`
- Modify: `tests/wave-ring.test.js`

**Interfaces:**
- Consumes: `mapSpectrum`, `barCoords`, `smoothLevels` from Task 1.
- Produces: `WaveRing.Ring` with:
  - `constructor(canvas: HTMLCanvasElement, options?: { barCount?: number, smoothing?: number, dprCap?: number })`
  - `setAnalyser(analyser: AnalyserNode): void`
  - `resize(): void`
  - `drawResting(): void`
  - `start(): void`
  - `stop(): void`
  - `destroy(): void`

- [ ] **Step 1: Write the failing renderer test**

Append to `tests/wave-ring.test.js`:

```js
function fakeCanvas(size = 300) {
  const calls = { clearRect: 0, stroke: 0, fill: 0, arc: 0 };
  const ctx = {
    setTransform() {},
    clearRect() { calls.clearRect++; },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() { calls.arc++; },
    stroke() { calls.stroke++; },
    fill() { calls.fill++; },
    set lineWidth(v) {},
    set lineCap(v) {},
    set strokeStyle(v) {},
    set fillStyle(v) {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: size, height: size }),
  };
  return { canvas, calls };
}

test('Ring.resize sizes the backing store and drawResting uses two draw calls', () => {
  const { Ring } = require('../js/wave-ring.js');
  const { canvas, calls } = fakeCanvas(300);
  const ring = new Ring(canvas);
  ring.resize();
  assert.equal(canvas.width, 300);
  assert.equal(canvas.height, 300);
  ring.drawResting();
  assert.equal(calls.clearRect, 1);
  assert.equal(calls.stroke, 1);
  assert.equal(calls.fill, 1);
  assert.equal(calls.arc, 80);
  ring.destroy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/wave-ring.test.js`
Expected: FAIL because `Ring` is not exported.

- [ ] **Step 3: Implement `Ring`**

Add to `js/wave-ring.js` and export it in the returned object.

Rules:
- Constructor stores `canvas`, `ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })`, `barCount` (default 80), `smoothing` (default 0.22), `dprCap` (default 2), preallocated `levels`, `targets`, and a reusable `geo` object. Guard all DOM APIs with `typeof` so Node tests can construct it.
- `resize()` reads `getBoundingClientRect()` once, takes `Math.min(width, height)`, sets `canvas.width/height = Math.round(size * dpr)`, and calls `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. It only sizes the backing store; the `ResizeObserver` handler calls `resize()` and then `drawResting()` when not playing. It must not be called from the animation loop.
- `drawResting()` fills `levels` with a deterministic dim pattern (`0.07 + 0.03 * (0.5 + 0.5 * Math.sin(i * 0.55))`) and calls the shared `draw(0.35)`. It does not clear the canvas itself.
- `start()` stores the analyser, allocates `freq = new Uint8Array(analyser.frequencyBinCount)` only when its length changes, sets `playing = true`, and schedules the loop unless reduced motion is requested.
- The loop calls `analyser.getByteFrequencyData(freq)`, `mapSpectrum(freq, targets, analyser.context.sampleRate)`, `smoothLevels(targets, levels, smoothing)`, computes `bass` from the first three targets, and calls `draw(0.9, bass)`.
- `draw(alpha, bass = 0)` clears the canvas once, strokes all bars in one path, then fills all tip dots in one path (`arc` per bar). Use `lineWidth = Math.max(1, size * 0.005)`, `lineCap = 'round'`, tip gap `size * 0.008`, dot radius `Math.max(1, size * 0.005)`, and pulse `scale = 1 + bass * 0.02`.
- `stop()` clears `playing`, cancels the pending frame, and draws the resting frame.
- `destroy()` stops, disconnects a `ResizeObserver`, and removes the `visibilitychange` listener.
- `document.hidden` cancels the loop without changing `playing`; becoming visible reschedules it. `matchMedia('(prefers-reduced-motion: reduce)')` makes `start()` draw one static frame instead of animating.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wave-ring.test.js`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/wave-ring.js tests/wave-ring.test.js
git commit -m "feat: add canvas ring renderer"
```

---

### Task 3: Replace the vinyl markup and styles

**Files:**
- Modify: `index.html` (now-playing markup, script tags)
- Modify: `css/style.css` (vinyl/tonearm/visualizer rules)
- Modify: `js/app.js` (create the ring and draw its resting frame)

**Interfaces:**
- Consumes: `WaveRing.Ring` from Task 2.
- Produces: `waveRing` module-level variable and `initWaveRing(): void` in `app.js`.

- [ ] **Step 1: Replace the vinyl markup**

In `index.html`, replace the whole `.vinyl-wrap` block (vinyl, grooves, label, cover image, fallback, shine, tonearm) with:

```html
<div class="wave-wrap">
  <canvas id="wave-ring" class="wave-ring" aria-hidden="true"></canvas>
</div>
```

Remove the bottom `<canvas id="visualizer" ...>` line. Add the new script before `app.js`:

```html
<script src="js/wave-ring.js?v=41"></script>
```

Bump `css/style.css?v=40` and `js/app.js?v=40` to `?v=41`.

- [ ] **Step 2: Replace the CSS**

Delete every `.vinyl*`, `.tonearm*`, and `.visualizer` rule. Add:

```css
.wave-wrap {
  position: relative;
  width: min(300px, 70vw);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
}
.wave-ring {
  width: 100%;
  height: 100%;
  display: block;
}
@media (max-width: 600px) {
  .wave-wrap { width: min(240px, 68vw); }
}
@media (prefers-reduced-motion: reduce) {
  .wave-ring { transition: none; }
}
```

- [ ] **Step 3: Create the ring in `app.js`**

Add near the other element constants:

```js
let waveRing = null;
function initWaveRing() {
  const canvas = $('#wave-ring');
  if (!canvas || !window.WaveRing || waveRing) return;
  waveRing = new window.WaveRing.Ring(canvas);
  waveRing.drawResting();
}
```

Call `initWaveRing()` next to the existing `loadTracks()` call at the bottom.

- [ ] **Step 4: Verify the static ring**

Run: `node --check js/app.js` and `node --check js/wave-ring.js`.
Expected: both print no errors.

Open the site locally or on Pages and confirm: a dim ring is visible, and there is no vinyl, tonearm, or cover image in the DOM.

- [ ] **Step 5: Commit**

```bash
git add index.html css/style.css js/app.js js/wave-ring.js
git commit -m "feat: replace vinyl markup with circular wave canvas"
```

---

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

---

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
