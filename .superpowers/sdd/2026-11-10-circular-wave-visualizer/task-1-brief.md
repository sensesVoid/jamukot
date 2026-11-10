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