# Phase 3 — Mathematical Models and Equations

All symbols: μ = GM (km³/s²), r = radius (km), a = semi-major axis (km),
v (km/s), Isp (s), g₀ = 9.80665 m/s², c = g₀·Isp (effective exhaust velocity).
Implementations referenced as `file.rs::function`.

## 1. Two-body mechanics (`kepler.rs`)

**Vis-viva** (energy integral of the two-body problem):

    v² = μ (2/r − 1/a)

Circular: v_c = √(μ/r). Escape: v_esc = √(2μ/r). Period: T = 2π√(a³/μ).

**Kepler's equation** — elliptic, solved by Newton iteration (tol 1e-13):

    M = E − e·sin E,   r = a(1 − e·cos E),   tan(ν/2) = √((1+e)/(1−e))·tan(E/2)

— hyperbolic (a < 0, e > 1), for escape/arrival legs:

    M = e·sinh H − H,  r = a(1 − e·cosh H),  tan(ν/2) = √((e+1)/(e−1))·tanh(H/2)

These give *physically timed* positions: the visualization animates real
dynamics, not eased splines.

## 2. Hohmann transfer (`kepler.rs::hohmann`)

For coplanar circular orbits r₁ < r₂ about μ_sun:

    a_t = (r₁ + r₂)/2
    v_dep = √(μ(2/r₁ − 1/a_t))      v∞,dep = v_dep − v_c(r₁)
    v_arr = √(μ(2/r₂ − 1/a_t))      v∞,arr = v_c(r₂) − v_arr
    TOF  = π √(a_t³/μ)

Earth→Mars: v∞,dep = 2.94 km/s, v∞,arr = 2.65 km/s, TOF = 258.9 d (validated
in tests against published values). The Hohmann transfer is Δv-optimal among
two-impulse transfers between these radii (bi-elliptic only wins for radius
ratios > 11.94; here ratio = 1.52 — `bielliptic_dv` is provided for study).

**Phasing**: Mars must lead Earth by φ = 180° − ω_mars·TOF ≈ 44.3°.
Synodic period: S = 360°/(ω_E − ω_M) = 779.9 d.

## 3. Patched-conic mission budget (`patched_conic.rs::budget`)

**Ascent** (no atmosphere): Δv₁ = v_c(LLO) + L_g, gravity/steering loss
L_g = 0.25·√(1.5/TWR), clamped [0.06, 0.6] km/s (Apollo-anchored heuristic).

**Trans-Mars injection from LLO** — three patches collapsed into one Oberth
burn. Required geocentric speed at lunar distance r_m for hyperbolic excess
v∞,E:

    v_req = √(v∞,E² + 2μ_E/r_m)               (geocentric energy)
    v_rel = v_req − v_moon                     (optimal alignment, coplanar)
    Δv₂  = √(v_rel² + 2μ_M/r_LLO) − v_c(LLO)   (Oberth at perilune)

Numerically: v_req = 3.28, v_rel = 2.26, Δv₂ = 1.60 km/s.

**Mars orbit insertion** at periapsis r_p:

    v_hyp = √(v∞,M² + 2μ_Mars/r_p)
    Δv₄  = v_hyp − v_target(r_p)

v_target is the circular speed (LMO) or the periapsis speed of the 1-sol
ellipse, a₁ₛₒₗ = (μ(T_sol/2π)²)^⅓ via Kepler III.

## 4. Rocket equation and staging (`propulsion.rs`)

**Tsiolkovsky** (momentum conservation for variable-mass system):

    Δv = c·ln(m₀/m_f),   R = e^(Δv/c)

Stage sizing with structure proportional to propellant
(m_dry = k·m_p + m_fix):

    m_p = (m_pl + m_fix + m_extra)(R − 1) / (1 − k(R − 1))

Derivation: m₀ = m_pl + m_fix + m_extra + k·m_p + m_p and m₀ = R·(m₀ − m_p);
solve for m_p. **Feasibility condition: k(R − 1) < 1** — beyond it, added
propellant's own tankage outweighs its impulse (the structural wall of the
rocket equation). Verified round-trip in `propulsion::tests`.

## 5. Electric propulsion (`analyzer.rs::analyze_low_thrust`)

Thrust–power relation (jet kinetic power over total efficiency η):

    T = 2 η P / c          P = T c / (2η)

Edelbaum circular-spiral budgets (low-thrust limit):

    Δv_escape ≈ v_c(r_start)           Δv_helio ≈ |v_c(Earth) − v_c(Mars)| = 5.65 km/s

Thrusting time: t = Δv·m̄/T with m̄ the average mass (fixed-point iterated
with thruster count, power mass α·P and tankage). Transit = 1.15·t (duty
cycle/steering), floored at 300 d.

## 6. Mass driver (`analyzer.rs::driver_launch`)

Muzzle velocity for direct escape + TMI (energy bookkeeping at the surface):

    v_muzzle = 1.02·√(v_rel² + v_esc,Moon²) = 3.34 km/s

Track kinematics at acceleration limit a: L = v²/2a (285 m @ 2000 g),
t = v/a (0.17 s). Electrical energy per launch E = ½mv²/η_grid: 269 MWh at
η = 0.5 for the 86.7 t thrown mass → 11.2 MW average recharge for daily
launch cadence. Instantaneous rail power is ~TW-class — hence flywheel/
capacitor storage, sized by E not P.

## 7. Numerical integration (`nbody.rs`)

Restricted N-body equations of motion (heliocentric plane):

    r̈ = −μ_s r/|r|³ − Σᵢ μᵢ (r − rᵢ)/|r − rᵢ|³,   i ∈ {Earth, Moon, Mars}

- **RK4**: classic 4-stage, local error O(h⁵). Validation: circular orbit
  radius drift < 1e-6 relative over 1 year at h = 1 h.
- **RKF45**: Fehlberg embedded 4(5) pair; step control
  h ← 0.9·h·(tol/err)^(1/5), position tolerance 1 km/step. Validation:
  two-body energy drift < 1e-7 relative over one orbit.
- Planets on rails: their mutual perturbations over 259 days are negligible
  for this purpose, and the spacecraft (≲300 t) cannot perturb planets —
  standard restricted-problem argument.

## 8. Monte Carlo (`analyzer.rs::monte_carlo`)

xorshift64* PRNG (deterministic by seed) + Box-Muller gaussians. 1σ
dispersions: Isp 1%, structure fraction 8%, fixed mass 5%, Δv margin 2 pts.
Outputs feasibility rate and wet-mass percentiles (p5/p50/p95).

## 9. Cost model (`analyzer.rs::cost_for`)

    $/kg = [ (C_dev + C_infra)/N + C_ops + m_prop·c_prop ] / m_cargo

N = 20 missions baseline (one window per 26 months × ~4 missions/window over
a decade). All C values are order-of-magnitude with rationale in
`propulsion.rs` comments. The crossover cadence where the mass driver beats
chemical: N ≈ 146 missions (see docs/11).
