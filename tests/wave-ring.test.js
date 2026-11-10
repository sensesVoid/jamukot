const { test } = require('node:test');
const assert = require('node:assert');
const { mapSpectrum, barCoords, smoothLevels, Ring } = require('../js/wave-ring.js');

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
  const expectedUnchanged = [0.2, 0.4].map(Math.fround);
  smoothLevels(new Float32Array([1, 1]), unchanged, 0);
  assert.deepEqual(Array.from(unchanged), expectedUnchanged);

  const snapped = new Float32Array([0, 0]);
  smoothLevels(new Float32Array([0.3, 0.7]), snapped, 2);
  assert.deepEqual(Array.from(snapped), [0.3, 0.7].map(Math.fround));
});

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