# Circular Wave Visualizer — Design

**Date:** 2026-11-10  
**Status:** proposed  
**Approach:** A — single Canvas 2D ring

## Intent

Replace the CSS vinyl, tonearm, and album cover with a minimalist circular
sound-wave visualizer inspired by the Pinterest pin. The ring becomes the
sole now-playing visual and the sole audio visualizer.

## Why

- The vinyl imitates physical media; the ring shows the audio directly.
- One canvas is cheaper than a collection of animated DOM layers.
- Removing album art removes the iTunes artwork request, making track
  changes faster and keeping the strict network environment quiet.

## Goals

- Empty-center ring of thin white radial bars with dotted tips.
- No vinyl, tonearm, cover art, or horizontal bar canvas.
- Smooth on desktop and mobile, with no wasted frames.
- Remove the iTunes artwork fetch and tighten the CSP.

## Non-goals

- Playback, playlist, lyrics, wall, or request changes.
- New colors, themes, or layouts outside the now-playing panel.

## Anti-goals

- More than one rAF loop.
- Per-frame DOM writes, layout reads, or allocations.
- Reintroducing cover art or a rotating disc.

## Constraints

- Static GitHub Pages; strict network allows only GitHub/Cloudflare.
- Existing Web Audio graph (`analyser` → `gainNode` → destination).
- No external libraries; no new assets.
- Must work down to ~320px viewport width.

## Approaches considered

| Approach | Trade-off |
|---|---|
| **A. Canvas 2D ring** | One canvas, two draw calls per frame, exact control over the dotted look. **Chosen.** |
| B. SVG lines | 80 attribute writes and repaints per frame; heavier, no visual gain. |
| C. CSS-transformed divs | 80 composited layers; blurry at size; awkward dotted tips. |

## Behavior

- **Playing:** bars follow a log-spaced spectrum (40 Hz–16 kHz), smoothed;
  a subtle bass value modulates the inner radius by at most ±2%.
- **Paused:** one static resting frame with short, dim bars. No loop runs.
- **Track change:** the last frame stays until playback starts.
- **Hidden tab:** the loop cancels; it resumes when visible and playing.
- **Reduced motion:** a static frame is drawn once; no animation.
- **Resize:** the canvas is re-measured with a `ResizeObserver`; DPR is
  capped at 2.

## Visual spec

- Outer diameter ~300px desktop, ~240px mobile; square wrapper.
- 80 bars, 4.5° apart, starting at 30% radius, max length 19%.
- Line width ~1.5px at 320px; white at 90% opacity.
- Tip dots 1.6px radius with a ~2px gap from the bar.
- No inner circle, glow, gradient, or center content.
- Paused state fades to ~35% opacity.

## Technical plan

**HTML**
- Replace `.vinyl-wrap` (vinyl, label, shine, tonearm) with
  `.wave-wrap > canvas#wave-ring`.
- Remove `#cover-img`, `#cover-fallback`, and the bottom `#visualizer`.

**CSS**
- Delete `.vinyl*`, `.tonearm*`, and `.visualizer` rules.
- Add a square, responsive `.wave-wrap` and a block-level canvas.
- Add mobile size and reduced-motion rules.

**JS**
- Remove `vinylEl`, `updateVinyl`, `tonearmEl`, `fetchCover`,
  `initialsOf`, `state.coverCache`, and all calls.
- Replace the visualizer block with the ring renderer.
- Raise `analyser.fftSize` to 256; keep smoothing at 0.8.
- Preallocate `Uint8Array(128)` and `Float32Array(80)`.
- Draw one path for all bars (single `stroke()`) and one path for all
  tips (single `fill()`).
- Add `startRing()` / `stopRing()`, a `visibilitychange` handler, and a
  reduced-motion check.
- Observe the wrapper for resizes.

**CSP**
- Drop `https://itunes.apple.com` from `connect-src`.
- Narrow `img-src` to `'self' data:`.

## Performance budget

- At most 2 canvas draw calls per animation frame.
- Zero allocations inside the rAF callback.
- One rAF loop.
- No layout reads inside the loop; measure only on resize.

## Accessibility

- Canvas is `aria-hidden="true"`; title and artist remain real text.
- `prefers-reduced-motion` is honored.
- Play/pause remains keyboard accessible.

## Verification

- `node --check js/app.js`.
- Manual: play, pause, seek, next/previous, resize, narrow mobile width,
  background tab, reduced motion.
- Console: no CSP errors and no requests to `itunes.apple.com`.
- Confirm exactly one rAF loop and no cover-art DOM.

## Files

- `index.html`
- `css/style.css`
- `js/app.js`

## Builder's calls

- Final bar count (72–96) and resting pattern after seeing it live.
- Exact opacity/line width tuning.
