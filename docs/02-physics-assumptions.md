# Phase 2 — Physics Assumptions and Constraints

Every model in the simulator is classified as **[E] established physics**,
**[A] engineering assumption**, or **[S] speculative**. The same labels appear
in the UI and in code comments.

## [E] Established physics used directly

| Principle | Where used |
|---|---|
| Newtonian gravitation & mechanics | everywhere; relativistic effects ~10⁻⁸ of solar gravity at 1–1.5 AU — negligible for cargo |
| Conservation of momentum (variable-mass systems) | Tsiolkovsky equation, staging (`propulsion.rs`) |
| Conservation of energy | vis-viva, jet power accounting, mass-driver energetics |
| Kepler two-body orbits | all conic segments (`kepler.rs`) |
| Oberth effect | TMI burn from LLO (`patched_conic.rs`) |
| Restricted N-body dynamics | RKF45 verification propagator (`nbody.rs`) |

## [A] Engineering assumptions (each with error estimate)

1. **Coplanar, circular planetary orbits.** Earth e=0.017, Mars e=0.093,
   relative inclination 1.85°. Effect: real-window Δv varies ±0.3–0.6 km/s
   across the 15-year Mars cycle. Covered by the midcourse allowance + margin
   slider. This is the textbook patched-conic idealization (Vallado §6;
   Curtis ch. 8).
2. **Patched conics.** SOI-stitched two-body arcs. The built-in RKF45
   restricted N-body check measures the consequence: ~1.9M km along-track
   arrival deviation (timing), <1% error in Δv. Standard for preliminary
   design; flight uses numerically-targeted trajectories.
3. **Impulsive burns** for chemical/NTP. Finite-burn losses ≈ (Δv·ω·t_burn²)
   corrections of a few % when burn arcs exceed ~20 min; the analyzer flags
   any MOI burn > 20 min as a risk instead of hiding it.
4. **Gravity/steering loss on lunar ascent** = 0.25·√(1.5/TWR) km/s, clamped
   [0.06, 0.60]. Anchored to Apollo LM ascent (~0.2 km/s loss on 1.9 km/s
   total at TWR≈2 lunar). Converged iteratively with vehicle mass.
5. **Edelbaum spiral budgets** for electric propulsion: escape ≈ local
   circular speed; circle-to-circle heliocentric ≈ |v_c1 − v_c2|. These are
   *upper bounds*; optimized low-thrust trajectories save 10–20%. Stated in
   the UI as such.
6. **Structure scaling**: stage dry mass = k·m_prop + fixed, k per technology
   (0.08 methalox … 0.15 NTP H₂ tankage). Industry-typical preliminary-design
   practice.
7. **Power system specific mass** α (kg/kW): 18 NEP, 20 solar-EP *at Mars
   distance* (1 AU arrays derated ×0.43).
8. **Solid cargo tolerates 2,000 g** axial (mass-driver launch). True for
   ingots/regolith products/bulk water ice; not for assembled machinery —
   the limit is a slider-able constant in `analyzer.rs`.
9. **Economics**: order-of-magnitude; all unit costs listed in
   `propulsion.rs` with rationale. Largest asymmetry: lunar ISRU LOX/LH₂ at
   ~$900/kg vs Earth-imported CH₄/Xe at ~$50k/kg landed.

## [S] Speculative content (clearly fenced)

- **D-He3 fusion entry**: TRL 1–2. No net-gain space fusion engine exists.
  Isp 8000 s / 100 kN figures are placeholders so users can see *what it would
  take*, flagged `speculative: true` in code, ⚠ in every UI surface.

## Constraints enforced by the analyzer

- Lunar liftoff thrust-to-weight ≥ 1.3 (local g = 1.625 m/s²).
- Stage feasibility: tank_frac·(e^(Δv/c) − 1) < 1, else INFEASIBLE with reason.
- Engine-count caps per system (e.g. 12 RL10-class).
- EP total thrust time ≤ 550 days (thruster wear / cadence).
- MOI burn-arc duration surfaced as risk when impulsive validity degrades.

## Explicitly out of scope

Attitude dynamics and powered-descent guidance; radiation transport (noted as
risk only); third-body capture/ballistic-transfer trajectories (cheaper but
months slower — noted in docs/11); finite ephemeris (no real launch dates).
