# SDD ledger — plan: docs/superpowers/plans/2026-11-10-circular-wave-visualizer.md

## Pre-flight Scan

| Pair | Shared | Plan Says | Finding | Ruling |
|------|--------|-----------|---------|--------|
| Task 1 → Task 2 | `mapSpectrum`, `barCoords`, `smoothLevels` | Task 1 exports them; Task 2 consumes them in `Ring` | Tests in Task 1 specify exact signatures; Task 2 spec uses same names | OK — no conflict |
| Task 2 → Task 3 | `WaveRing.Ring` constructor | Task 2 exports `Ring`; Task 3 constructs `new window.WaveRing.Ring(canvas)` | Task 2 UMD wrapper sets `root.WaveRing = { ...Ring }` | OK — no conflict |
| Task 3 → Task 4 | `waveRing` module variable, `initWaveRing()` | Task 3 creates and draws resting; Task 4 wires `setAnalyser`, `start`, `stop` | Task 3 calls `initWaveRing()` at bottom; Task 4 uses same variable | OK — no conflict |
| Task 1 tests ↔ Task 1 code | `mapSpectrum`, `barCoords`, `smoothLevels` | Tests call exact exported names; implementation must match | Test names match spec signatures | OK |
| Task 2 tests ↔ Task 2 code | `Ring` methods | Tests call `Ring`, `resize`, `drawResting`, `destroy`; implementation must export `Ring` | Test mock `fakeCanvas` guards `getContext` with `typeof` | OK |
| Task 1 vs Global Constraints | zero allocations in rAF | Task 1 helpers are pure functions; `Ring` loop uses preallocated buffers | No per-frame allocations in helpers | OK |
| Task 2 vs Global Constraints | DPR cap 2 | Task 2 `resize` caps at `dprCap` default 2 | Matches spec | OK |
| Task 3 vs Global Constraints | no vinyl/cover/tonearm | Task 3 deletes all three from HTML/CSS/JS | Plan lists every rule to delete | OK |
| Task 4 vs Global Constraints | single rAF loop | Task 4 removes `drawVisualizer`/`startVisualizer`/`stopVisualizer` and uses `waveRing.start/stop` | Only one loop remains | OK |
| Task 5 vs Global Constraints | CSP drops itunes.apple.com | Task 5 edits CSP meta tag | Explicit step | OK |

No conflicts. Proceeding to Task 1.

## Task 1
**Status:** DONE  
**Commits:** 8cdca50 - feat: add wave-ring spectrum and geometry helpers  
**Review:** Clean — implementation matches spec; test precision bug was fixed in committed file (line 59 uses `Math.fround`). All 6 tests pass.

## Task 2
**Status:** DONE  
**Commits:** 197de71 feat: add canvas ring renderer  
**Review:** Initial review flagged 3 critical bugs but the committed code already fixed them (first-frame allocation via `_ensureFreq()`, Node DPR guard, resting redraw on resize, radial tip gap). All 7 tests pass. Minor design choice: inner radius scales with bass pulse (kept as-is).

## Task 3
**Status:** DONE (already in origin/main)  
**Verification:** index.html, css/style.css, and js/app.js already contain wave-ring markup, wave-wrap CSS, and waveRing initialization. No new commits needed.

## Task 4
**Status:** DONE  
**Commits:** e6d60a5 feat: drive wave ring from the audio analyser  
**Review:** Approved — all 5 steps implemented, dead code removed, single rAF loop via `waveRing`. Minor style nit in `nextTrack()` (braces) doesn't affect correctness. ⚠️ items about vinyl/visualizer removal already handled in Task 3 (verified `Select-String` returns no matches).

## Task 5
**Status:** DONE  
**Commits:** c6d6bb4 chore: tighten CSP and finish wave ring cleanup  
**Review:** All checks pass — 7/7 tests, syntax clean, audio verified (484 tracks, 221.9 MB), zero grep matches for legacy terms, live site confirmed: `wave-ring: True`, `no vinyl: True`, `no itunes: True`. CSP tightened (itunes.apple.com removed, img-src narrowed).

---

All tasks complete. Ready for final review.