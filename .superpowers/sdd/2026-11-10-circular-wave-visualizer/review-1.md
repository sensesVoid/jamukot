# Review Package for Task 1

## Task
Spectrum, geometry, and smoothing helpers (Task 1)

## Commits
8cdca50 feat: add wave-ring spectrum and geometry helpers

## Diff (3a9775d..8cdca50)

### js/wave-ring.js (new file)
```diff
+ (function (root, factory) {
+   const api = factory();
+   if (typeof module === 'object' && module.exports) module.exports = api;
+   root.WaveRing = api;
+ })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
+   'use strict';
+   const MIN_HZ = 40;
+   const MAX_HZ = 16000;
+   const INNER_RATIO = 0.30;
+   const BAR_RATIO = 0.19;
+ 
+   function mapSpectrum(data, out, sampleRate) {
+     const nyquist = sampleRate / 2;
+     const effectiveMax = Math.min(MAX_HZ, nyquist);
+     const logMin = Math.log(MIN_HZ);
+     const logMax = Math.log(effectiveMax);
+     const barCount = out.length;
+     for (let i = 0; i < barCount; i++) {
+       const fLow = Math.exp(logMin + (logMax - logMin) * (i / barCount));
+       const fHigh = Math.exp(logMin + (logMax - logMin) * ((i + 1) / barCount));
+       const binLow = Math.max(0, Math.floor((fLow / nyquist) * data.length));
+       const binHigh = Math.min(data.length, Math.ceil((fHigh / nyquist) * data.length));
+       let sum = 0;
+       let n = 0;
+       for (let b = binLow; b < binHigh; b++) {
+         sum += data[b];
+         n++;
+       }
+       out[i] = n ? Math.min(1, sum / n / 255) : 0;
+     }
+     return out;
+   }
+ 
+   function barCoords(out, size, count, index, level, scale = 1) {
+     const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
+     const cx = size / 2;
+     const cy = size / 2;
+     const r0 = size * INNER_RATIO * scale;
+     const clamped = level < 0 ? 0 : level > 1 ? 1 : level;
+     const r1 = r0 + size * BAR_RATIO * clamped * scale;
+     out.angle = angle;
+     out.r0 = r0;
+     out.r1 = r1;
+     out.x1 = cx + r0 * Math.cos(angle);
+     out.y1 = cy + r0 * Math.sin(angle);
+     out.x2 = cx + r1 * Math.cos(angle);
+     out.y2 = cy + r1 * Math.sin(angle);
+     return out;
+   }
+ 
+   function smoothLevels(targets, levels, factor) {
+     const f = factor < 0 ? 0 : factor > 1 ? 1 : factor;
+     for (let i = 0; i < levels.length; i++) {
+       levels[i] += (targets[i] - levels[i]) * f;
+     }
+     return levels;
+   }
+ 
+   return { mapSpectrum, barCoords, smoothLevels };
+ });
```

### tests/wave-ring.test.js (new file)
```diff
+ const { test } = require('node:test');
+ const assert = require('node:assert');
+ const { mapSpectrum, barCoords, smoothLevels } = require('../js/wave-ring.js');
+ 
+ test('mapSpectrum fills one level per bar in 0..1', () => {
+   const data = new Uint8Array(128);
+   for (let i = 0; i < data.length; i++) data[i] = i * 2;
+   const out = new Float32Array(80);
+   mapSpectrum(data, out, 48000);
+   assert.equal(out.length, 80);
+   for (const v of out) assert.ok(v >= 0 && v <= 1);
+ });
+ 
+ test('mapSpectrum puts a low-frequency peak in the first bar and silence in the last', () => {
+   const data = new Uint8Array(128).fill(0);
+   data[0] = 255;
+   const out = new Float32Array(80);
+   mapSpectrum(data, out, 48000);
+   assert.ok(out[0] > 0.2);
+   assert.equal(out[79], 0);
+ });
+ 
+ test('mapSpectrum returns silence for silent input', () => {
+   const data = new Uint8Array(128);
+   const out = new Float32Array(80).fill(0.5);
+   mapSpectrum(data, out, 48000);
+   assert.ok(out.every((v) => v === 0));
+ });
+ 
+ test('barCoords starts at the top and clamps the level', () => {
+   const g = {};
+   barCoords(g, 300, 80, 0, 0, 1);
+   assert.ok(Math.abs(g.x1 - 150) < 1e-9);
+   assert.ok(Math.abs(g.y1 - 60) < 1e-9);
+   assert.ok(Math.abs(g.r1 - g.r0) < 1e-9);
+ 
+   barCoords(g, 300, 80, 0, 5, 1);
+   assert.ok(Math.abs(g.r1 - 300 * 0.49) < 1e-9);
+   assert.ok(g.y2 >= 0 && g.y2 <= 300);
+ });
+ 
+ test('barCoords handles the right side and scale', () => {
+   const g = {};
+   barCoords(g, 300, 80, 20, 1, 1);
+   assert.ok(Math.abs(g.x1 - 240) < 1e-9);
+   assert.ok(Math.abs(g.y1 - 150) < 1e-9);
+ 
+   barCoords(g, 300, 80, 0, 1, 1.02);
+   assert.ok(Math.abs(g.r0 - 300 * 0.30 * 1.02) < 1e-9);
+ });
+ 
+ test('smoothLevels moves toward targets and clamps the factor', () => {
+   const levels = new Float32Array([0, 0]);
+   smoothLevels(new Float32Array([1, 0.5]), levels, 0.5);
+   assert.ok(Math.abs(levels[0] - 0.5) < 1e-9);
+   assert.ok(Math.abs(levels[1] - 0.25) < 1e-9);
+ 
+   const unchanged = new Float32Array([0.2, 0.4]);
+   smoothLevels(new Float32Array([1, 1]), unchanged, 0);
+   assert.deepEqual(Array.from(unchanged), [0.2, 0.4]);
+ 
+   const snapped = new Float32Array([0, 0]);
+   smoothLevels(new Float32Array([0.3, 0.7]), snapped, 2);
+   assert.deepEqual(Array.from(snapped), [0.3, 0.7].map(Math.fround));
+ });
```