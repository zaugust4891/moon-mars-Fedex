# Phase 6 — Implementation Plan (as executed)

Order chosen so that every layer is verified before the next consumes it.

## Step 1 — Physics primitives (`constants.rs`, `kepler.rs`)
- μ values from JPL (used directly — known to more digits than G·M separately).
- Kepler solvers (elliptic + hyperbolic) with round-trip unit tests.
- Hohmann/bi-elliptic with published-value benchmark tests.
- **Gate**: `cargo test kepler` green, Earth–Mars TOF within 1 day of 258.9 d.

## Step 2 — Mission budget (`patched_conic.rs`)
- Oberth-stacked TMI from LLO; MOI for two target orbits; window phasing.
- **Gate**: chemical total in [5.3, 6.2] km/s; LLO→TMI within published
  1.4–1.8 km/s band; 1-sol MOI ≈ 0.90 km/s.

## Step 3 — Propulsion + analyzer (`propulsion.rs`, `analyzer.rs`)
- Catalog of 9 systems with sourced-or-stated parameters.
- Closed-form stage sizing; iterative closure of TWR↔gravity-loss↔engine
  count; EP power sizing; mass-driver energetics; cost model; Monte Carlo;
  sensitivity.
- **Gate**: all non-speculative systems feasible at baseline; NTP < chemical
  wet mass; EP propellant < chemical; MC deterministic by seed.

## Step 4 — Numerics + trajectories (`nbody.rs`, `trajectory.rs`)
- RK4 + RKF45 with energy-conservation tests.
- Physically-timed view geometry (Kepler-propagated, not splined) and the
  patched-conic-vs-N-body deviation check.
- **Gate**: energy drift < 1e-7/orbit; deviation in [10³, 5·10⁶] km band.

## Step 5 — FFI + report (`ffi.rs`, `bin/report.rs`)
- Length-prefixed JSON ABI; native report binary generates docs/10.
- **Gate**: `cargo build --release --target wasm32-unknown-unknown` clean;
  report output sane.

## Step 6 — Frontend (web/)
- Typed engine bridge → store/clock → Scene → panels → comparison mode.
- **Gate**: `tsc --noEmit` clean; `vite build` clean.

## Step 7 — End-to-end verification
- Headless-Chrome smoke test: engine loads, metrics correct, canvas renders,
  clock advances at the selected warp, comparison table populated, parameter
  changes recompute (screenshots in Phase 9).

## Deviations from the naive plan (decision log)
- Dropped `wasm-pack`/`wasm-bindgen` (absent toolchain; see docs/05 — the
  hand ABI is also strictly simpler).
- Departure/arrival local views animate on real hyperbolic Kepler time, but
  the powered-ascent arc is schematic (guidance out of scope, labeled).
- Lunar-ascent gravity loss made TWR-dependent rather than constant after the
  first analyzer iteration produced obviously optimistic methalox numbers.
