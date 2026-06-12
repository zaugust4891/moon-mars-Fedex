# Phase 4 — System Architecture Design

## Component diagram

```
┌──────────────────────────── Browser ────────────────────────────────┐
│                                                                     │
│  React UI (TypeScript)                  Three.js renderer           │
│  ┌──────────────┐ ┌──────────────┐      ┌────────────────────────┐  │
│  │ParameterPanel│ │ ControlPanel │      │ MissionScene           │  │
│  │MetricsPanel  │ │ Timeline     │ ───► │  helio / departure /   │  │
│  │ComparisonView│ │ (transport)  │      │  arrival views,        │  │
│  └──────┬───────┘ └──────┬───────┘      │  vectors, gravity well │  │
│         │                │              └───────────▲────────────┘  │
│         ▼                ▼                          │ interpolation │
│  ┌──────────────────────────────────┐               │ only          │
│  │ store.tsx — reducer + sim clock  │───────────────┘               │
│  └───────────────┬──────────────────┘                               │
│                  │ scalar params in / JSON out                      │
│  ┌───────────────▼──────────────────┐                               │
│  │ engine/wasm.ts — length-prefixed │                               │
│  │ JSON ABI, typed API              │                               │
│  └───────────────┬──────────────────┘                               │
└──────────────────┼──────────────────────────────────────────────────┘
                   │ WebAssembly boundary
┌──────────────────▼──────────────────────────────────────────────────┐
│ sim-core (Rust, zero runtime deps)                                  │
│                                                                     │
│  constants → kepler → patched_conic → propulsion → analyzer         │
│                 │          │                          │             │
│               nbody  ◄── trajectory ◄─────────────────┘             │
│                                                                     │
│  ffi.rs (wasm32 only)        bin/report.rs (native)                 │
│  tests/validation.rs (native, benchmark suite)                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Separation of concerns

| Layer | Owns | Never does |
|---|---|---|
| `sim-core` | all physics, sizing, economics, statistics, trajectory sampling | rendering, formatting for display |
| `engine/wasm.ts` | ABI decoding, typed contracts (`types.ts`) | computation |
| `store.tsx` | parameters, outputs, simulation clock | physics, drawing |
| `viz/Scene.ts` | drawing + interpolation between engine samples | any numeric derivation beyond lerp |
| `ui/*` | presentation of engine outputs | computation |

The discipline that matters: **every physical number on screen originated in
Rust**. The TypeScript side interpolates positions between engine-computed
samples and formats units. This makes the displayed simulation exactly as
trustworthy as the tested core — there is no second physics implementation to
drift out of sync.

## Data flow per interaction

1. User drags cargo slider → `PARAM` action.
2. Effect calls `engine.compare`, `engine.trajectory`, `engine.monteCarlo`,
   `engine.sensitivity` (synchronous WASM, ~5–60 ms total including the
   RKF45 N-body check).
3. Reducer stores typed results; scene receives new trajectory; metrics
   re-render. No caching layer is needed at these latencies.

## Simulation clock

`requestAnimationFrame` loop in the provider advances mission time by
`direction × warp × dt` (warp = 0.5–100 days/s), clamped to [0, t_end].
Scrubbing, stepping (±1 d) and reverse playback all set the same single
source of truth (`tDays`); the scene is a pure function of it.

## Extension points

- New propulsion system: one `PropSystem` entry in `propulsion.rs::catalog`
  (+class-specific analyzer branch if its staging concept is novel). UI
  pick-lists and comparison populate automatically from `ffi_compare`.
- New target orbit: extend `TargetOrbit` enum + `from_id`.
- Higher-fidelity ephemerides: swap `nbody::Rails` for real elements; the
  integrator and FFI are unaffected.
