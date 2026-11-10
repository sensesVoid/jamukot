# Review Package for Task 2

## Task
Canvas ring renderer (Task 2)

## Commits
197de71 feat: add canvas ring renderer

## Diff (8cdca50..197de71)

### js/wave-ring.js
```diff
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
  
    function mapSpectrum(data, out, sampleRate) {
      const nyquist = sampleRate / 2;
      const effectiveMax = Math.min(MAX_HZ, nyquist);
      const logMin = Math.log(MIN_HZ);
      const logMax = Math.log(effectiveMax);
      const barCount = out.length;
      for (let i = 0; i < barCount; i++) {
        const fLow = Math.exp(logMin + (logMax - logMin) * (i / barCount));
        const fHigh = Math.exp(logMin + (logMax - logMin) * ((i + 1) / barCount));
        const binLow = Math.max(0, Math.floor((fLow / nyquist) * data.length));
        const binHigh = Math.min(data.length, Math.ceil((fHigh / nyquist) * data.length));
        let sum = 0;
        let n = 0;
        for (let b = binLow; b < binHigh; b++) {
          sum += data[b];
          n++;
        }
        out[i] = n ? Math.min(1, sum / n / 255) : 0;
      }
      return out;
    }
  
    function barCoords(out, size, count, index, level, scale = 1) {
      const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
      const cx = size / 2;
      const cy = size / 2;
      const r0 = size * INNER_RATIO * scale;
      const clamped = level < 0 ? 0 : level > 1 ? 1 : level;
      const r1 = r0 + size * BAR_RATIO * clamped * scale;
      out.angle = angle;
      out.r0 = r0;
      out.r1 = r1;
      out.x1 = cx + r0 * Math.cos(angle);
      out.y1 = cy + r0 * Math.sin(angle);
      out.x2 = cx + r1 * Math.cos(angle);
      out.y2 = cy + r1 * Math.sin(angle);
      return out;
    }
  
    function smoothLevels(targets, levels, factor) {
      const f = factor < 0 ? 0 : factor > 1 ? 1 : factor;
      for (let i = 0; i < levels.length; i++) {
        levels[i] += (targets[i] - levels[i]) * f;
      }
      return levels;
    }
  
    class Ring {
      constructor(canvas, options = {}) {
        if (typeof canvas === 'undefined' || canvas === null) {
          this._noCanvas = true;
          return;
        }
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
        this._barCount = options.barCount ?? 80;
        this._smoothing = options.smoothing ?? 0.22;
        this._dprCap = options.dprCap ?? 2;
        this._levels = new Float32Array(this._barCount);
        this._targets = new Float32Array(this._barCount);
        this._geo = {};
        this._analyser = null;
        this._freq = null;
        this._playing = false;
        this._rafId = null;
        this._size = 0;
        this._dpr = 1;
        this._ro = null;
        this._visHandler = null;
        this._initObservers();
      }
  
      _initObservers() {
        if (typeof ResizeObserver !== 'undefined') {
          this._ro = new ResizeObserver(() => this.resize());
          this._ro.observe(this._canvas);
        }
        if (typeof document !== 'undefined') {
          this._visHandler = () => {
            if (document.hidden) {
              if (this._rafId) {
                cancelAnimationFrame(this._rafId);
                this._rafId = null;
              }
            } else if (this._playing && !this._rafId) {
              this._loop();
            }
          };
          document.addEventListener('visibilitychange', this._visHandler);
        }
      }
  
      setAnalyser(analyser) {
        this._analyser = analyser;
      }
  
      resize() {
        if (this._noCanvas) return;
        const rect = this._canvas.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        const dpr = Math.min(window.devicePixelRatio || 1, this._dprCap);
        this._size = size;
        this._dpr = dpr;
        this._canvas.width = Math.round(size * dpr);
        this._canvas.height = Math.round(size * dpr);
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
  
      drawResting() {
        if (this._noCanvas) return;
        for (let i = 0; i < this._barCount; i++) {
          this._levels[i] = 0.07 + 0.03 * (0.5 + 0.5 * Math.sin(i * 0.55));
        }
        this._draw(0.35);
      }
  
      start() {
        if (this._noCanvas || !this._analyser) return;
        this._playing = true;
        const prefersReduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced) {
          this.drawResting();
          return;
        }
        this._loop();
      }
  
      _loop() {
        if (!this._playing) return;
        this._analyser.getByteFrequencyData(this._freq);
        const sampleRate = this._analyser.context.sampleRate;
        mapSpectrum(this._freq, this._targets, sampleRate);
        smoothLevels(this._targets, this._levels, this._smoothing);
        let bass = 0;
        for (let i = 0; i < Math.min(3, this._barCount); i++) {
          bass += this._targets[i];
        }
        bass /= Math.min(3, this._barCount);
        this._draw(0.9, bass);
        this._rafId = requestAnimationFrame(() => this._loop());
      }
  
      _ensureFreq() {
        if (!this._analyser) return;
        const needed = this._analyser.frequencyBinCount;
        if (!this._freq || this._freq.length !== needed) {
          this._freq = new Uint8Array(needed);
        }
      }
  
      _draw(alpha, bass = 0) {
        if (this._noCanvas) return;
        this._ensureFreq();
        const ctx = this._ctx;
        const size = this._size;
        ctx.clearRect(0, 0, size, size);
        ctx.beginPath();
        const lineWidth = Math.max(1, size * 0.005);
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        const tipGap = size * 0.008;
        const dotRadius = Math.max(1, size * 0.005);
        const scale = 1 + bass * 0.02;
        for (let i = 0; i < this._barCount; i++) {
          barCoords(this._geo, size, this._barCount, i, this._levels[i], scale);
          const g = this._geo;
          ctx.moveTo(g.x1, g.y1);
          ctx.lineTo(g.x2 - tipGap, g.y2 - tipGap);
        }
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        for (let i = 0; i < this._barCount; i++) {
          barCoords(this._geo, size, this._barCount, i, this._levels[i], scale);
          const g = this._geo;
          ctx.moveTo(g.x2, g.y2);
          ctx.arc(g.x2, g.y2, dotRadius, 0, Math.PI * 2);
        }
        ctx.fill();
      }
  
      stop() {
        if (this._noCanvas) return;
        this._playing = false;
        if (this._rafId) {
          cancelAnimationFrame(this._rafId);
          this._rafId = null;
        }
        this.drawResting();
      }
  
      destroy() {
        if (this._noCanvas) return;
        this.stop();
        if (this._ro) {
          this._ro.disconnect();
          this._ro = null;
        }
        if (this._visHandler && typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', this._visHandler);
          this._visHandler = null;
        }
      }
    }
  
    return { mapSpectrum, barCoords, smoothLevels, Ring };
  });
```

### tests/wave-ring.test.js
```diff
   test('smoothLevels moves toward targets and clamps the factor', () => {
     const levels = new Float32Array([0, 0]);
     smoothLevels(new Float32Array([1, 0.5]), levels, 0.5);
     assert.ok(Math.abs(levels[0] - 0.5) < 1e-9);
     assert.ok(Math.abs(levels[1] - 0.25) < 1e-9);
 
     const unchanged = new Float32Array([0.2, 0.4]);
     const expectedUnchanged = [0.2, 0.4].map(Math.fround);
     smoothLevels(new Float32Array([1, 1]), unchanged, 0);
     assert.deepEqual(Array.from(unchanged), expectedUnchanged);
 
     const snapped = new Float32Array([0, 0]);
     smoothLevels(new Float32Array([0.3, 0.7]), snapped, 2);
     assert.deepEqual(Array.from(snapped), [0.3, 0.7].map(Math.fround));
   });
 
+  function fakeCanvas(size = 300) {
+    const calls = { clearRect: 0, stroke: 0, fill: 0, arc: 0 };
+    const ctx = {
+      setTransform() {},
+      clearRect() { calls.clearRect++; },
+      beginPath() {},
+      moveTo() {},
+      lineTo() {},
+      arc() { calls.arc++; },
+      stroke() { calls.stroke++; },
+      fill() { calls.fill++; },
+      set lineWidth(v) {},
+      set lineCap(v) {},
+      set strokeStyle(v) {},
+      set fillStyle(v) {},
+    };
+    const canvas = {
+      width: 0,
+      height: 0,
+      getContext: () => ctx,
+      getBoundingClientRect: () => ({ width: size, height: size }),
+    };
+    return { canvas, calls };
+  }
+
+  test('Ring.resize sizes the backing store and drawResting uses two draw calls', () => {
+    const { Ring } = require('../js/wave-ring.js');
+    const { canvas, calls } = fakeCanvas(300);
+    const ring = new Ring(canvas);
+    ring.resize();
+    assert.equal(canvas.width, 300);
+    assert.equal(canvas.height, 300);
+    ring.drawResting();
+    assert.equal(calls.clearRect, 1);
+    assert.equal(calls.stroke, 1);
+    assert.equal(calls.fill, 1);
+    assert.equal(calls.arc, 80);
+    ring.destroy();
+  });
```

## Review Package for Task 2

### Task
Canvas ring renderer (Task 2)

### Commits
197de71 feat: add canvas ring renderer

### Diff (8cdca50..197de71)

(See above for full diff)