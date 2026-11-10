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