# fable-moon — Lunar→Mars Cargo Mission Simulator

A scientifically grounded, interactive simulator for transporting **45,359 kg
(100,000 lb) of solid cargo from the lunar surface to a stable Mars orbit**,
where it is intercepted by an orbiting spacecraft. Patched-conic orbital
mechanics with an RKF45 restricted N-body cross-check, a nine-architecture
propulsion trade study, Monte Carlo dispersion analysis, and economics — all
computed in a zero-dependency Rust core compiled to WebAssembly, visualized
with React + Three.js.

## Quickstart

```bash
# 1. physics core: test + build WASM (Rust ≥1.75, target wasm32-unknown-unknown)
cd sim-core
cargo test                                              # 26 validation tests
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/sim_core.wasm ../web/public/

# 2. frontend
cd ../web
bun install            # or npm install
bun run dev            # or: bun run build && bun run preview

# regenerate the Phase-10 report
cd ../sim-core && cargo run --release --bin report > ../docs/10-results.md
```

## What you can do in the UI

- **Mission view**: heliocentric transfer with timed burns, velocity/thrust
  vectors, optional gravity-well surface and the orange *N-body ghost path*
  showing real patched-conic model error. Switch to **Lunar departure**
  (ascent → LLO → escape hyperbola) and **Mars arrival** (approach hyperbola
  → capture → target orbit) views.
- **🚀 Ride along**: cinematic ride-along locked to the cargo stack, with an
  HDR pipeline (ACES + bloom + film grain + adaptive exposure), a propulsion-
  specific lunar launch site (gantry pad or mass-driver rail with sequenced
  coils) that recedes by the **real** ascent altitude, lit planet spheres with
  true terminators/atmospheres whose apparent size is `asin(R/d)` from live
  distance, an event-anchored interceptor rendezvous, and 38 holographic
  "Mission Intel" cards. Six cameras (FPV / chase / cinema director / orbit /
  Mars approach / dock), Elite-style reticles, and a HUD with Δv-remaining,
  ETA, rel-vel to Mars and osculating elements — every number derives from
  the same Rust-computed series as the classic views; only starfield, glows,
  grain and shake are cosmetic. Optional 🎬 cinematic pacing slows *playback*
  (never physics) around launch, MOI and rendezvous. Drag to look, wheel to
  zoom, double-click to recenter.
- **Transport controls**: play/pause, step ±1 day, reverse, rewind, 0.5–100
  days/s time warp, click-to-scrub timeline with event markers and fuel gauge.
- **Parameters**: propulsion system (9), cargo mass 10–150 t, target orbit
  (500 km circular LMO or 1-sol ellipse), propellant margin 0–20%. Every
  change re-runs the full analysis incl. 500-sample Monte Carlo in <100 ms.
- **Compare systems**: side-by-side table + bar charts (wet mass, transit,
  $/kg) and sensitivity analysis.

## Documentation (the 11 phases)

| Phase | Document |
|---|---|
| 1 Mission architecture | [docs/01-mission-architecture.md](docs/01-mission-architecture.md) |
| 2 Physics assumptions & constraints | [docs/02-physics-assumptions.md](docs/02-physics-assumptions.md) |
| 3 Mathematical models & equations | [docs/03-mathematical-models.md](docs/03-mathematical-models.md) |
| 4 System architecture | [docs/04-system-architecture.md](docs/04-system-architecture.md) |
| 5 Technology stack / Rust justification | [docs/05-technology-stack.md](docs/05-technology-stack.md) |
| 6 Implementation plan | [docs/06-implementation-plan.md](docs/06-implementation-plan.md) |
| 7 Source code — physics core | [sim-core/](sim-core/src) |
| 8 Source code — visualization | [web/](web/src) |
| 9 Validation & testing | [docs/09-validation.md](docs/09-validation.md) |
| 10 Results & propulsion comparison | [docs/10-results.md](docs/10-results.md) (generated) |
| 11 Recommendation | [docs/11-recommendation.md](docs/11-recommendation.md) |

## Headline numbers (engine-generated; see docs/10)

- Mission Δv (impulsive, surface → 500 km LMO): **5.68 km/s** unmargined
  (ascent 1.83 + TMI 1.60 + midcourse 0.10 + MOI 2.07 + rendezvous 0.075).
- Hohmann transfer **258.9 days**; windows every **779.9 days** (Mars lead 44.3°).
- Recommended: **lunar LOX/LH₂ 2-stage** (234 t wet, $9.9k/kg, TRL 9) now;
  **mass driver** (82–87 t flight mass, 269 MWh/launch) past ~150 missions.

## Honesty contract

Established physics, engineering assumptions, and speculative technology are
explicitly labeled ([E]/[A]/[S] in docs/02, ⚠ in the UI). Every physical
number rendered in the browser is computed by the same tested Rust code that
runs in CI — the TypeScript layer only interpolates and draws.
