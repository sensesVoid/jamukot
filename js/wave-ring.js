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
      const bin1 = Math.min(n, Math.ceil(f1 / binWidth));

      let sum = 0;
      let cnt = 0;
      for (let b = bin0; b < bin1; b++) {
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

  class Ring {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.barCount = options.barCount ?? 80;
      this.smoothing = options.smoothing ?? 0.22;
      this.dprCap = options.dprCap ?? 2;
      this.levels = new Float32Array(this.barCount);
      this.targets = new Float32Array(this.barCount);
      this.geo = {};
      this.playing = false;
      this.frameId = 0;
      this.analyser = null;
      this.freq = null;
      this.resizeObserver = null;
      this.visibilityHandler = null;
      this.reducedMotion = false;

      if (typeof canvas !== 'undefined' && canvas && typeof canvas.getContext === 'function') {
        this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
      } else {
        this.ctx = null;
      }

      this._setupResizeObserver();
      this._setupVisibilityHandler();
      this._checkReducedMotion();
    this.resize();
    }

    _setupResizeObserver() {
      if (typeof ResizeObserver !== 'undefined' && this.canvas) {
        this.resizeObserver = new ResizeObserver(() => {
          if (!this.playing) {
            this.resize();
            this.drawResting();
          } else {
            this.resize();
          }
        });
        this.resizeObserver.observe(this.canvas);
      }
    }

    _setupVisibilityHandler() {
      if (typeof document !== 'undefined') {
        this.visibilityHandler = () => {
          if (document.hidden) {
            this._cancelFrame();
          } else if (this.playing && !this.reducedMotion) {
            this._scheduleFrame();
          }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
      }
    }

    _checkReducedMotion() {
      if (typeof matchMedia !== 'undefined') {
        const mediaQuery = matchMedia('(prefers-reduced-motion: reduce)');
        this.reducedMotion = mediaQuery.matches;
        this._reducedMotionHandler = (e) => {
          this.reducedMotion = e.matches;
          if (this.playing) {
            if (this.reducedMotion) {
              this._cancelFrame();
              this.draw(0.35);
            } else {
              this._scheduleFrame();
            }
          }
        };
        mediaQuery.addEventListener('change', this._reducedMotionHandler);
      }
    }

    _cancelFrame() {
      if (this.frameId) {
        if (typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(this.frameId);
        }
        this.frameId = 0;
      }
    }

    _scheduleFrame() {
      this._cancelFrame();
      if (typeof requestAnimationFrame !== 'undefined') {
        this.frameId = requestAnimationFrame(() => this._loop());
      }
    }

    _loop() {
      if (!this.playing || !this.analyser) {
        return;
      }

      const freq = this._ensureFreq();
      this.analyser.getByteFrequencyData(freq);
      mapSpectrum(freq, this.targets, this.analyser.context.sampleRate);
      smoothLevels(this.targets, this.levels, this.smoothing);

      let bass = 0;
      for (let i = 0; i < Math.min(3, this.barCount); i++) {
        bass += this.targets[i];
      }
      bass /= Math.min(3, this.barCount);

      this.draw(0.9, bass);
      this._scheduleFrame();
    }

    _ensureFreq() {
      const binCount = this.analyser.frequencyBinCount;
      if (!this.freq || this.freq.length !== binCount) {
        this.freq = new Uint8Array(binCount);
      }
      return this.freq;
    }

    setAnalyser(analyser) {
      this.analyser = analyser;
    }

    resize() {
      if (!this.canvas || !this.ctx) return;

      const rect = this.canvas.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, this.dprCap);

      this.canvas.width = Math.round(size * dpr);
      this.canvas.height = Math.round(size * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._size = size;
    }

    drawResting() {
      if (!this._size) this.resize();
      for (let i = 0; i < this.barCount; i++) {
        this.levels[i] = 0.07 + 0.03 * (0.5 + 0.5 * Math.sin(i * 0.55));
      }
      this.draw(0.35);
    }

    start() {
      if (!this.analyser) return;
      this.playing = true;
      if (this.reducedMotion) {
        this.draw(0.35);
      } else {
        this._scheduleFrame();
      }
    }

    draw(alpha, bass = 0) {
      if (!this.ctx || !this._size) return;

      const size = this._size;
      const ctx = this.ctx;

      ctx.clearRect(0, 0, size, size);

      const lineWidth = Math.max(1, size * 0.005);
      const tipGap = size * 0.008;
      const dotRadius = Math.max(1, size * 0.005);
      const scale = 1 + bass * 0.02;

      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;

      // Stroke all bars in one path
      ctx.beginPath();
      for (let i = 0; i < this.barCount; i++) {
        barCoords(this.geo, size, this.barCount, i, this.levels[i], scale);
        ctx.moveTo(this.geo.x1, this.geo.y1);
        ctx.lineTo(this.geo.x2 - Math.cos(this.geo.angle) * tipGap, this.geo.y2 - Math.sin(this.geo.angle) * tipGap);
      }
      ctx.stroke();

      // Fill all tip dots in one path
      ctx.beginPath();
      for (let i = 0; i < this.barCount; i++) {
        barCoords(this.geo, size, this.barCount, i, this.levels[i], scale);
        const x = this.geo.x2;
        const y = this.geo.y2;
        ctx.moveTo(x + dotRadius, y);
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    stop() {
      this.playing = false;
      this._cancelFrame();
      this.drawResting();
    }

    destroy() {
      this.stop();
      if (this.resizeObserver && this.canvas) {
        this.resizeObserver.unobserve(this.canvas);
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this.visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
        this.visibilityHandler = null;
      }
      if (this._reducedMotionHandler && typeof matchMedia !== 'undefined') {
        matchMedia('(prefers-reduced-motion: reduce)').removeEventListener('change', this._reducedMotionHandler);
        this._reducedMotionHandler = null;
      }
      this.analyser = null;
      this.freq = null;
      this.canvas = null;
      this.ctx = null;
    }
  }

  return { mapSpectrum, barCoords, smoothLevels, Ring };
});