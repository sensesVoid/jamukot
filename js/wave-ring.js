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
    const n = data.length;
    const binWidth = sampleRate / (2 * n);
    const logMin = Math.log(MIN_HZ);
    const logMax = Math.log(MAX_HZ);
    const logRange = logMax - logMin;
    const count = out.length;

    for (let i = 0; i < count; i++) {
      const f0 = Math.exp(logMin + (i / count) * logRange);
      const f1 = Math.exp(logMin + ((i + 1) / count) * logRange);
      const bin0 = Math.max(0, Math.floor(f0 / binWidth));
      const bin1 = Math.min(n - 1, Math.ceil(f1 / binWidth));

      let sum = 0;
      let cnt = 0;
      for (let b = bin0; b <= bin1; b++) {
        sum += data[b];
        cnt++;
      }
      const avg = cnt > 0 ? sum / cnt : 0;
      out[i] = Math.min(1, Math.max(0, avg / 255));
    }
    return out;
  }

  function barCoords(out, size, count, index, level, scale = 1) {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const center = size / 2;
    const r0 = size * INNER_RATIO * scale;
    const clampedLevel = Math.min(1, Math.max(0, level));
    const r1 = r0 + size * BAR_RATIO * clampedLevel * scale;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    out.angle = angle;
    out.r0 = r0;
    out.r1 = r1;
    out.x1 = center + r0 * cos;
    out.y1 = center + r0 * sin;
    out.x2 = center + r1 * cos;
    out.y2 = center + r1 * sin;

    return out;
  }

  function smoothLevels(targets, levels, factor) {
    const clampedFactor = Math.min(1, Math.max(0, factor));
    for (let i = 0; i < levels.length; i++) {
      levels[i] += (targets[i] - levels[i]) * clampedFactor;
    }
    return levels;
  }

  return { mapSpectrum, barCoords, smoothLevels };
});