# Phase 1 — Mission Architecture Overview

## Objective

Transport **45,359 kg (100,000 lb) of solid cargo** from the lunar surface to a
**stable Mars orbit**, where it is intercepted and captured by an orbiting
spacecraft. The cargo is inert and structurally robust (it tolerates high
g-loads), which opens architectures unavailable to crewed or delicate payloads
— most importantly electromagnetic launch.

## Reference mission sequence (high-thrust architecture)

```
 ┌────────────┐   ┌─────────────┐   ┌──────────────┐   ┌───────────────┐   ┌──────────────┐
 │ 1. ASCENT  │ → │ 2. TMI      │ → │ 3. CRUISE    │ → │ 4. MOI        │ → │ 5. RENDEZVOUS│
 │ surface →  │   │ LLO → Earth │   │ 259-day      │   │ hyperbola →   │   │ orbiter      │
 │ 100 km LLO │   │ escape +    │   │ heliocentric │   │ target orbit  │   │ intercepts   │
 │            │   │ Mars xfer   │   │ Hohmann      │   │ at periapsis  │   │ inert cargo  │
 └────────────┘   └─────────────┘   └──────────────┘   └───────────────┘   └──────────────┘
   Δv 1.83          Δv 1.60           Δv 0.10 (MCC)      Δv 2.07 (LMO)       Δv 0.075        km/s
```

Total impulsive budget: **≈ 5.7 km/s** to a 500 km circular low Mars orbit
(LMO), or **≈ 4.5 km/s** to a 1-sol elliptical capture orbit. Both targets are
supported; the trade is Δv vs. complexity of the interceptor's rendezvous.

## Why launch from the Moon is fundamentally cheap

- Lunar escape velocity is 2.38 km/s vs. Earth's 11.2 km/s — energy per kg to
  escape is ~22× lower.
- No atmosphere: no drag losses, no fairings, no max-Q constraint, and
  electromagnetic launch directly to escape velocity is physically possible.
- The Oberth effect at perilune lets a single burn from low lunar orbit buy
  trans-Mars injection for 1.6 km/s.

## Departure windows

Earth–Mars phase geometry repeats every **779.9 days** (synodic period). The
departure requires Mars to lead Earth by **≈ 44°**. Missing a window costs up
to 26 months — this dominates mission cadence planning and is computed live in
the simulator (`ffi_window`).

## Architectures compared (Phase 10 has full numbers)

| # | Architecture | Class | Key idea |
|---|---|---|---|
| 0 | Lunar LOX/LH₂, 2-stage | chemical | both propellants from polar ice ISRU |
| 1 | Methalox, 2-stage | chemical | flight-proven engines; CH₄ must be imported |
| 2 | Nuclear thermal | nuclear | Isp 900 s halves propellant vs LOX/LH₂ |
| 3 | Nuclear electric (2 MWe) | electric | Isp 5000 s; needs chemical ascent kick |
| 4 | Gridded ion (solar) | electric | flight heritage; very large cluster |
| 5 | Hall effect (solar) | electric | AEPS heritage; krypton-capable |
| 6 | Mass driver + LOX/LH₂ kick | electromagnetic | track supplies ascent+TMI kinetically |
| 7 | Mass driver + reusable SEP tug | hybrid | minimum flight mass per mission |
| 8 | D-He3 fusion | speculative | framing reference only (TRL 1) |

## Interceptor concept

The Mars-side spacecraft holds the target orbit; the cargo arrives with a
rendezvous trim budget (75 m/s) and is captured inert (net/berthing capture of
a cooperative but unpowered target). Terminal GNC is on the interceptor — this
keeps the high-value avionics reusable and the cargo vehicle minimal.

## Roles of the simulator

1. **Engineering tool**: Δv budgets, vehicle sizing, power/energy, cost/kg,
   Monte Carlo dispersion, sensitivity — all computed in the Rust core.
2. **Educational platform**: three synchronized views (heliocentric, lunar
   departure, Mars arrival) with timed burns, vectors and fuel state.
3. **Mission-design sandbox**: cargo mass, target orbit, margin and propulsion
   selection are interactive; every change re-runs the full analysis in
   milliseconds via WASM.
