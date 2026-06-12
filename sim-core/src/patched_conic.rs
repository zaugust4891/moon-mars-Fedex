//! Patched-conic mission delta-v budget: lunar surface -> stable Mars orbit.
//!
//! Patch sequence (impulsive, high-thrust reference architecture):
//!   1. ASCENT     selenocentric: surface -> 100 km circular LLO.
//!                 dv = v_LLO + gravity loss (no atmosphere; losses are steering
//!                 + finite-burn only, parametrized on liftoff thrust/weight).
//!   2. TMI        selenocentric -> geocentric -> heliocentric patch.
//!                 Required geocentric speed at lunar distance for hyperbolic
//!                 excess v_inf:   v_req = sqrt(v_inf^2 + 2 mu_E / r_moon)
//!                 Speed relative to the Moon (optimal alignment, coplanar):
//!                 v_rel = v_req - v_moon_orbital
//!                 Single burn from LLO exploiting the Oberth effect:
//!                 dv = sqrt(v_rel^2 + 2 mu_M / r_LLO) - v_LLO
//!   3. MIDCOURSE  allowance for plane change (Mars i = 1.85 deg, mostly
//!                 absorbed in the departure asymptote) + navigation trims.
//!   4. MOI        areocentric capture at periapsis r_p:
//!                 v_hyp = sqrt(v_inf_arr^2 + 2 mu_Mars / r_p)
//!                 dv = v_hyp - v_target_at_periapsis
//!   5. RENDEZVOUS terminal phasing/braking for interception by the orbiter.
//!
//! Assumptions: coplanar circular planetary orbits, optimal launch window,
//! impulsive burns. Validity discussed in docs/02 and docs/09.

use crate::constants::*;
use crate::kepler;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TargetOrbit {
    /// Circular low Mars orbit at given altitude (km). The "stable parking
    /// orbit with orbiter rendezvous" default.
    CircularLmo { alt_km: f64 },
    /// 1-sol elliptic capture orbit (periapsis altitude km, period = 1 Mars sol).
    /// Cheaper capture; rendezvous spacecraft must match the ellipse.
    OneSolEllipse { peri_alt_km: f64 },
}

impl TargetOrbit {
    pub fn from_id(id: u32) -> TargetOrbit {
        match id {
            1 => TargetOrbit::OneSolEllipse { peri_alt_km: 300.0 },
            _ => TargetOrbit::CircularLmo { alt_km: 500.0 },
        }
    }
    pub fn label(&self) -> String {
        match self {
            TargetOrbit::CircularLmo { alt_km } => format!("{:.0} km circular LMO", alt_km),
            TargetOrbit::OneSolEllipse { peri_alt_km } => {
                format!("1-sol ellipse ({:.0} km periapsis)", peri_alt_km)
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct MissionParams {
    pub cargo_kg: f64,
    pub llo_alt_km: f64,
    pub target: TargetOrbit,
    /// Ascent gravity/steering loss, km/s. If NaN the analyzer substitutes a
    /// thrust-to-weight-dependent estimate.
    pub gravity_loss_kms: f64,
    pub midcourse_kms: f64,
    pub rendezvous_kms: f64,
    /// Multiplied onto every segment (propellant reserve), e.g. 0.05 = 5%.
    pub margin_frac: f64,
}

impl Default for MissionParams {
    fn default() -> Self {
        MissionParams {
            cargo_kg: CARGO_DEFAULT_KG,
            llo_alt_km: 100.0,
            target: TargetOrbit::CircularLmo { alt_km: 500.0 },
            gravity_loss_kms: 0.20,
            midcourse_kms: 0.10,
            rendezvous_kms: 0.075,
            margin_frac: 0.05,
        }
    }
}

#[derive(Clone, Debug)]
pub struct DvBudget {
    pub ascent: f64,
    pub tmi: f64,
    pub midcourse: f64,
    pub moi: f64,
    pub rendezvous: f64,
    pub total: f64,          // unmargined, km/s
    pub total_margined: f64, // with margin applied
    // diagnostics
    pub v_llo: f64,
    pub v_req_geo: f64,  // required geocentric speed at lunar distance
    pub v_rel_moon: f64, // hyperbolic excess relative to the Moon
    pub vinf_dep: f64,   // heliocentric departure excess (rel. Earth)
    pub vinf_arr: f64,   // arrival excess (rel. Mars)
    pub tof_days: f64,   // Hohmann time of flight
    pub lead_angle_deg: f64,
    pub synodic_days: f64,
    pub capture_rp_km: f64,
    pub v_hyp_peri: f64,    // hyperbolic speed at Mars periapsis
    pub v_target_peri: f64, // target-orbit speed at periapsis
    pub transfer: kepler::Hohmann,
}

pub fn budget(p: &MissionParams) -> DvBudget {
    let h = kepler::hohmann(MU_SUN, A_EARTH, A_MARS);

    // -- 1. ascent
    let r_llo = R_MOON + p.llo_alt_km;
    let v_llo = kepler::v_circular(MU_MOON, r_llo);
    let g_loss = if p.gravity_loss_kms.is_finite() { p.gravity_loss_kms } else { 0.20 };
    let ascent = v_llo + g_loss;

    // -- 2. TMI (Oberth-stacked departure)
    let v_req_geo = (h.vinf_dep.powi(2) + 2.0 * MU_EARTH / A_MOON).sqrt();
    let v_moon_orb = kepler::v_circular(MU_EARTH, A_MOON);
    let v_rel_moon = v_req_geo - v_moon_orb;
    let tmi = (v_rel_moon.powi(2) + 2.0 * MU_MOON / r_llo).sqrt() - v_llo;

    // -- 4. MOI
    let (rp, v_target) = match p.target {
        TargetOrbit::CircularLmo { alt_km } => {
            let r = R_MARS + alt_km;
            (r, kepler::v_circular(MU_MARS, r))
        }
        TargetOrbit::OneSolEllipse { peri_alt_km } => {
            let r = R_MARS + peri_alt_km;
            let a = kepler::a_from_period(MU_MARS, MARS_SOL);
            (r, kepler::vis_viva(MU_MARS, r, a))
        }
    };
    let v_hyp = (h.vinf_arr.powi(2) + 2.0 * MU_MARS / rp).sqrt();
    let moi = v_hyp - v_target;

    let total = ascent + tmi + p.midcourse_kms + moi + p.rendezvous_kms;

    // departure phasing: Mars must lead Earth by (180 deg - omega_mars * TOF)
    let w_e = 360.0 / (T_EARTH / DAY);
    let w_m = 360.0 / (T_MARS / DAY);
    let lead = 180.0 - w_m * (h.tof_s / DAY);
    let synodic = 360.0 / (w_e - w_m);

    DvBudget {
        ascent,
        tmi,
        midcourse: p.midcourse_kms,
        moi,
        rendezvous: p.rendezvous_kms,
        total,
        total_margined: total * (1.0 + p.margin_frac),
        v_llo,
        v_req_geo,
        v_rel_moon,
        vinf_dep: h.vinf_dep,
        vinf_arr: h.vinf_arr,
        tof_days: h.tof_s / DAY,
        lead_angle_deg: lead,
        synodic_days: synodic,
        capture_rp_km: rp,
        v_hyp_peri: v_hyp,
        v_target_peri: v_target,
        transfer: h,
    }
}

/// Low-thrust (electric propulsion) budget. Spiral approximations:
///  - escape from a circular orbit by continuous tangential thrust costs
///    ~ the local circular speed (Edelbaum limit),
///  - heliocentric circle-to-circle spiral costs |v_c1 - v_c2|,
///  - capture spiral costs ~ circular speed at the equivalent target SMA.
/// These are upper-bound engineering approximations, clearly labeled in docs.
#[derive(Clone, Copy, Debug)]
pub struct LowThrustBudget {
    pub moon_spiral: f64,
    pub earth_spiral: f64,
    pub heliocentric: f64,
    pub capture_spiral: f64,
    pub total: f64,
}

pub fn low_thrust_budget(p: &MissionParams) -> LowThrustBudget {
    let r_llo = R_MOON + p.llo_alt_km;
    let moon_spiral = kepler::v_circular(MU_MOON, r_llo);
    let earth_spiral = kepler::v_circular(MU_EARTH, A_MOON);
    let heliocentric =
        (kepler::v_circular(MU_SUN, A_EARTH) - kepler::v_circular(MU_SUN, A_MARS)).abs();
    let capture_spiral = match p.target {
        TargetOrbit::CircularLmo { alt_km } => kepler::v_circular(MU_MARS, R_MARS + alt_km),
        TargetOrbit::OneSolEllipse { .. } => {
            kepler::v_circular(MU_MARS, kepler::a_from_period(MU_MARS, MARS_SOL))
        }
    };
    let total = moon_spiral + earth_spiral + heliocentric + capture_spiral;
    LowThrustBudget { moon_spiral, earth_spiral, heliocentric, capture_spiral, total }
}

/// Days until the next Mars departure window, given the current Earth-Mars
/// phase angle (deg, Mars ahead of Earth positive).
pub fn days_to_window(current_phase_deg: f64, required_lead_deg: f64) -> f64 {
    let w_e = 360.0 / (T_EARTH / DAY);
    let w_m = 360.0 / (T_MARS / DAY);
    let rel = w_e - w_m; // deg/day, Earth catches up
    let mut gap = (current_phase_deg - required_lead_deg).rem_euclid(360.0);
    if gap < 1e-9 {
        gap = 0.0;
    }
    gap / rel
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chemical_budget_in_expected_range() {
        let b = budget(&MissionParams::default());
        // surface -> 500 km circular LMO, unmargined: expect ~5.7 km/s
        assert!(b.total > 5.3 && b.total < 6.2, "total {}", b.total);
        assert!((b.ascent - 1.83).abs() < 0.05, "ascent {}", b.ascent);
        assert!((b.tmi - 1.60).abs() < 0.08, "tmi {}", b.tmi);
        assert!((b.moi - 2.07).abs() < 0.08, "moi {}", b.moi);
        assert!((b.lead_angle_deg - 44.3).abs() < 1.0, "lead {}", b.lead_angle_deg);
        assert!((b.synodic_days - 779.9).abs() < 2.0, "synodic {}", b.synodic_days);
    }

    #[test]
    fn one_sol_capture_cheaper() {
        let mut p = MissionParams::default();
        p.target = TargetOrbit::OneSolEllipse { peri_alt_km: 300.0 };
        let b = budget(&p);
        assert!((b.moi - 0.90).abs() < 0.06, "moi 1-sol {}", b.moi);
    }
}
