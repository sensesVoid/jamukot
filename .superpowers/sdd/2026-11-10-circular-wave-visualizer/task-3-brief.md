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