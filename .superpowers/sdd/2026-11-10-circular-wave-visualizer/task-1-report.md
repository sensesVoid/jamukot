# Task 1 Report: Spectrum, geometry, and smoothing helpers

## What I Implemented

Created two files as specified:

1. **`js/wave-ring.js`** - UMD-style classic script that sets `globalThis.WaveRing` and `module.exports`, exporting three pure functions:
   - `mapSpectrum(data, out, sampleRate)` - Maps FFT data (Uint8Array) logarithmically across output bars (40Hz–16kHz), averages covered bins, divides by 255, clamps to 0..1. No allocation.
   - `barCoords(out, size, count, index, level, scale)` - Computes polar-to-cartesian geometry for a bar at `index` of `count` around a circle of `size`. Uses `INNER_RATIO=0.30`, `BAR_RATIO=0.19`. Writes `angle`, `r0`, `r1`, `x1`, `y1`, `x2`, `y2` into `out` and returns it.
   - `smoothLevels(targets, levels, factor)` - In-place exponential smoothing: `levels[i] += (targets[i] - levels[i]) * clamp(factor, 0, 1)`. Returns `levels`.

2. **`tests/wave-ring.test.js`** - Six test cases covering all three functions per the spec.

## TDD Evidence

### RED Phase
```bash
node --test tests/wave-ring.test.js
```
Failed because `../js/wave-ring.js` did not exist:
```
Error: Cannot find module '../js/wave-ring.js'
```

### GREEN Phase
After implementing `js/wave-ring.js`:
```bash
node --test tests/wave-ring.test.js
```
All 6 tests pass:
```
✔ mapSpectrum fills one level per bar in 0..1
✔ mapSpectrum puts a low-frequency peak in the first bar and silence in the last
✔ mapSpectrum returns silence for silent input
✔ barCoords starts at the top and clamps the level
✔ barCoords handles the right side and scale
✔ smoothLevels moves toward targets and clamps the factor
```

## Files Changed
- `js/wave-ring.js` (created, 70 lines)
- `tests/wave-ring.test.js` (created, 63 lines)

## Self-Review Findings

**Completeness:** All requirements met. UMD wrapper correct, three functions implemented per spec, constants match, no DOM dependencies, no allocation in `mapSpectrum`, in-place mutation in `smoothLevels`.

**Quality:** Clean, readable code. Names match spec exactly. UMD pattern follows the template. Pure functions with no side effects beyond documented outputs.

**Discipline:** No overbuilding. Only implemented what was specified. Fixed a float32 precision bug in the provided test (the `factor=0` assertion compared `Float32Array` values to decimal literals, which can't represent 0.2/0.4 exactly; changed to use `Math.fround` like the `factor=2` test case).

**Testing:** TDD followed. All 6 tests pass with pristine output (no warnings, no noise). Tests verify real behavior (boundary conditions, clamping, logarithmic mapping, geometry).

## Concerns
Minor: The test file had a precision bug in the original spec (comparing float32 values to exact decimals). Fixed it to use `Math.fround` for correct comparison. This is a necessary correction for the tests to pass as intended.