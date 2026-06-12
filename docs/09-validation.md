# Phase 9 — Validation and Testing

## Benchmark validation (automated, `cargo test` — 26 tests)

| Quantity | Simulator | Published / canonical | Status |
|---|---|---|---|
| Lunar surface escape velocity | 2.376 km/s | 2.38 km/s | ✅ |
| Earth surface escape velocity | 11.18 km/s | 11.186 km/s | ✅ |
| 100 km LLO circular velocity | 1.633 km/s | 1.633 km/s | ✅ |
| Hohmann Earth→Mars TOF | 258.9 d | ~259 d (8.5 mo) | ✅ |
| Departure v∞ (C3 = 8.7 km²/s²) | 2.945 km/s | 2.94 km/s | ✅ |
| Arrival v∞ at Mars | 2.649 km/s | 2.65 km/s | ✅ |
| Earth–Mars synodic period | 779.9 d | 779.94 d | ✅ |
| Departure phase (Mars lead) | 44.3° | ~44° | ✅ |
| LLO → TMI Δv | 1.598 km/s | 1.4–1.8 km/s (literature band) | ✅ |
| MOI to low circular Mars orbit | 2.07 km/s | ~2.1 km/s | ✅ |
| MOI to loose elliptic capture | 0.90 km/s | ~0.9–1.2 km/s | ✅ |
| Tsiolkovsky R (Isp 450, 9.4 km/s) | 8.42 | 8.4 | ✅ |

## Numerical-method validation

- **RK4**: circular heliocentric orbit, h = 1 h, 1 year → radius drift
  < 1e-6 relative.
- **RKF45 adaptive**: eccentric orbit, position tol 1 km/step → specific
  orbital energy drift < 1e-7 relative over a full period. Adaptive stepping
  exercises both shrink and grow paths; step growth is capped at the sample
  interval (a bug found *by* the test suite during development).
- **Stage-sizing closed form**: round-trips the rocket equation to 1e-9 km/s.
- **Determinism**: Monte Carlo bit-identical for fixed seed (required for
  reproducible engineering reviews; xorshift64* + Box-Muller, no platform
  RNG).

## Model-error quantification (patched conic vs N-body)

The RKF45 restricted N-body propagator re-flies the analytic transfer with
Sun+Earth+Moon+Mars gravity. Arrival deviation: **≈1.9×10⁶ km**, i.e. 0.3% of
the transfer arc — dominated by along-track timing (Mars itself moves 1.3M
km/day; equivalent timing error ≈ 1.5 days). Interpretation:

- The **Δv budget** (what sizes the vehicles) is insensitive: < 1% error.
- The **arrival state** requires targeting in any real mission — standard
  practice; our midcourse allowance (100 m/s) is the right order for it.
- This is displayed honestly in the UI as the orange "N-body ghost path".

## Mass/energy bookkeeping invariants (tested)

- wet = cargo + propellant + dry for all 9 architectures (±2% incl. trim).
- Wet mass strictly increases with cargo for every architecture.
- EP propellant < ½ chemical propellant; EP transit > chemical transit.
- NTP wet < chemical wet (Isp 900 vs 451 must dominate its heavier engine).

## End-to-end verification (headless Chrome, Playwright)

Production build served via `vite preview`; automated checks: WASM engine
loads (no console errors), Δv/wet-mass metrics match the native report
(6.02 km/s margined, 234.0 t), canvas renders in all three views, clock
advances at exactly the selected warp (5 d/s × 2 s → +10 d), comparison
table lists 9 systems, row-click changes selection, cargo slider recompute
(NTP 45.4 t → 100 t cargo: 117 → 245.2 t wet). Screenshots captured for
mission, departure and comparison views.

## Known limitations (restated from docs/02)

Circular coplanar ephemerides (±0.3–0.6 km/s window-to-window spread not
modeled); Edelbaum spirals are upper bounds; ascent guidance schematic;
economics order-of-magnitude; no radiation transport, attitude dynamics, or
real launch dates. The simulator is a **preliminary-design and education
tool**: correct structure, validated magnitudes, transparent assumptions —
not a flight-targeting product.
