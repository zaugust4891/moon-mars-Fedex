# Phase 5 — Technology Stack Decisions (Rust Justification)

Mandate: use Rust **only** where it measurably improves performance, numerical
accuracy, memory safety, scalability or determinism. Verdict per subsystem:

## Subsystem-by-subsystem decision record

| Subsystem | Load profile | Decision | Reasoning |
|---|---|---|---|
| Orbital mechanics / Kepler solvers | µs-scale, called in inner loops | **Rust** | shared by every other Rust subsystem; f64 transcendentals compile to tight WASM; one implementation, natively unit-tested |
| Patched-conic Δv budget | trivial cost, correctness-critical | **Rust** | not for speed — for *testability and single-source-of-truth*: the same compiled code runs in CI (`cargo test`, 26 tests) and in the browser |
| Vehicle sizing / analyzer | ~10⁴ flops, but ×9 systems ×N iterations | **Rust** | fixed-point iterations (TWR↔mass↔engines) benefit from deterministic f64; reused by Monte Carlo at scale |
| RKF45 N-body propagation | 10³–10⁵ adaptive steps per call | **Rust** | the only hot loop: measured ~30–50 ms per check in WASM, would be 5–10× slower and GC-jittery in JS; allocation-free inner loop |
| Monte Carlo (500–10⁴ analyses) | bursty, scales with n | **Rust** | 500 full vehicle sizings in <10 ms; xorshift64* gives bit-identical results across native/WASM — reproducible engineering numbers |
| Trajectory sampling for viz | ~10³ Kepler solves per call | **Rust** | physically-timed positions need the solvers anyway; ships compact JSON |
| Rendering (Three.js scene) | GPU-bound | **TypeScript** | Rust adds nothing to WebGL draw calls; ecosystem (OrbitControls etc.) is JS |
| UI / state / interpolation | trivial | **TypeScript** | React's domain; interpolating between samples is O(log n) binary search |
| Report generation | one-shot CLI | **Rust (native bin)** | reuses the engine verbatim; docs/10 is generated, not transcribed |

**Anti-decision**: no Rust in the UI layer, no `wasm-bindgen`/`js-sys` DOM
manipulation. Forcing Rust there would buy nothing and cost build complexity.

## The no-wasm-bindgen FFI decision

Standard practice is `wasm-bindgen` + `wasm-pack`. We deliberately use a
**hand-rolled C ABI** instead (`ffi.rs`):

- Outputs: pointer to `[u32 length | UTF-8 JSON]` in linear memory; JS decodes
  and calls `buf_free`. Inputs: plain f64/u32 scalars — zero marshalling.
- **Zero build dependencies**: `cargo build --target wasm32-unknown-unknown`
  is the whole pipeline. No bindgen-CLI version coupling, no glue codegen,
  reproducible 148 KB module.
- Cost: we forgo automatic rich types across the boundary. With six exported
  functions and JSON payloads, the typed TS wrapper (`engine/wasm.ts`, ~100
  lines) is cheaper than the toolchain it replaces.
- Trade-off note: JSON encode/decode adds ~1–3 ms on trajectory payloads
  (~300 KB). Acceptable against 60 fps budgets; if it ever mattered,
  trajectory arrays could move to shared Float64Array views — the ABI leaves
  that door open.

## Quantified expectations (measured in this build)

- `cargo test` (26 tests incl. N-body energy-conservation runs): **0.02 s**.
- Full parameter change in browser = compare(9 systems) + trajectory +
  500-run Monte Carlo + sensitivity + RKF45 check: **< 100 ms** end-to-end,
  imperceptible against the 16 ms frame budget at interaction rates.
- WASM module: **148 KB** unstripped of JSON text (LTO, opt-level 3,
  panic-abort-free since std unwinding is fine here).

## Frontend stack

- **Vite + React 18 + TypeScript (strict)** — standard, fast HMR, tsc gates
  the production build.
- **Three.js** — WebGL renderer; WebGPU offers nothing for ~10³ line/mesh
  primitives in this scene graph.
- **No state library**: one reducer + context. The state machine has ~12
  action types; adding Redux/zustand would be ceremony.
- **bun** as package manager (fast, lockfile committed); `npm run` scripts
  remain compatible.
