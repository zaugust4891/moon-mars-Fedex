//! Propulsion system catalog and the Tsiolkovsky staging machinery.
//!
//! Tsiolkovsky: dv = c ln(m0/mf), c = g0 * Isp.
//! Stage sizing with structure that scales with propellant:
//!   m_dry_stage = k * m_p + m_fixed          (k = tankage+structure fraction)
//!   m_p = (m_payload + m_fixed) (R - 1) / (1 - k (R - 1)),   R = e^(dv/c)
//! Infeasible when k (R - 1) >= 1 (structure grows faster than the rocket
//! equation can lift it).
//!
//! Cost figures are order-of-magnitude estimates with assumptions in docs/10.
//! The dominant economic asymmetry: LOX and LH2 are producible on the Moon
//! (ISRU), methane and xenon are not and pay Earth->Moon delivery (~$50k/kg
//! landed assumed for chemicals delivered to the surface; EP tugs refuel in
//! orbit at lower delivery cost).

use crate::constants::G0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ThrustClass {
    /// Impulsive burns; flies the patched-conic budget directly.
    HighThrust,
    /// Electric propulsion; spiral budget, needs a chemical ascent kick stage.
    LowThrust,
    /// Electromagnetic launch: ascent+TMI supplied kinetically by fixed
    /// infrastructure; cargo carries only a Mars-side kick stage.
    Launcher,
    /// Launcher + reusable solar-electric tug doing the heliocentric leg.
    Hybrid,
}

#[derive(Clone, Debug)]
pub struct PropSystem {
    pub id: u32,
    pub key: &'static str,
    pub name: &'static str,
    pub class: ThrustClass,
    pub isp_s: f64,
    /// Per-engine vacuum thrust, N (for EP: per-thruster at rated power)
    pub thrust_per_engine_n: f64,
    pub engine_mass_kg: f64,
    pub max_engines: u32,
    /// Stage structure/tankage mass per kg propellant
    pub tank_frac: f64,
    /// Avionics/adapter fixed mass per stage, kg
    pub fixed_mass_kg: f64,
    /// EP only: input power per thruster, kW
    pub power_per_thruster_kw: f64,
    /// EP only: power system specific mass, kg/kW
    pub alpha_kg_per_kw: f64,
    /// EP only: total electric->jet efficiency
    pub efficiency: f64,
    pub trl: u32,
    pub speculative: bool,
    pub dev_cost_musd: f64,
    pub infra_cost_musd: f64,
    pub prop_cost_usd_per_kg: f64,
    pub ops_cost_musd_per_mission: f64,
    pub notes: &'static str,
}

pub fn catalog() -> Vec<PropSystem> {
    vec![
        PropSystem {
            id: 0, key: "lox_lh2", name: "Lunar LOX/LH2 (2-stage)",
            class: ThrustClass::HighThrust,
            isp_s: 451.0, thrust_per_engine_n: 110_000.0, engine_mass_kg: 190.0,
            max_engines: 12, tank_frac: 0.12, fixed_mass_kg: 250.0,
            power_per_thruster_kw: 0.0, alpha_kg_per_kw: 0.0, efficiency: 0.0,
            trl: 9, speculative: false,
            dev_cost_musd: 2_500.0, infra_cost_musd: 3_000.0,
            prop_cost_usd_per_kg: 900.0, ops_cost_musd_per_mission: 25.0,
            notes: "RL10C-class engines. Both propellants ISRU-producible from polar ice. Cryo boiloff managed with sunshades + cryocoolers.",
        },
        PropSystem {
            id: 1, key: "methalox", name: "Methalox (2-stage)",
            class: ThrustClass::HighThrust,
            isp_s: 363.0, thrust_per_engine_n: 2_400_000.0, engine_mass_kg: 1_600.0,
            max_engines: 6, tank_frac: 0.08, fixed_mass_kg: 250.0,
            power_per_thruster_kw: 0.0, alpha_kg_per_kw: 0.0, efficiency: 0.0,
            trl: 9, speculative: false,
            dev_cost_musd: 1_800.0, infra_cost_musd: 2_500.0,
            // O/F 3.6: 78% LOX (ISRU $500/kg) + 22% CH4 imported (~$50k/kg landed)
            prop_cost_usd_per_kg: 11_400.0, ops_cost_musd_per_mission: 20.0,
            notes: "Raptor-class. No lunar carbon source: CH4 (22% of propellant mass) must be imported from Earth, dominating cost.",
        },
        PropSystem {
            id: 2, key: "ntp", name: "Nuclear Thermal (NTR)",
            class: ThrustClass::HighThrust,
            isp_s: 900.0, thrust_per_engine_n: 333_000.0, engine_mass_kg: 3_500.0,
            max_engines: 4, tank_frac: 0.15, fixed_mass_kg: 500.0,
            power_per_thruster_kw: 0.0, alpha_kg_per_kw: 0.0, efficiency: 0.0,
            trl: 6, speculative: false,
            dev_cost_musd: 12_000.0, infra_cost_musd: 4_000.0,
            prop_cost_usd_per_kg: 1_200.0, ops_cost_musd_per_mission: 60.0,
            notes: "NERVA/DRACO-class solid core, LH2 ISRU. Large low-density LH2 tankage; nuclear surface-launch policy risk.",
        },
        PropSystem {
            id: 3, key: "nep", name: "Nuclear Electric (2 MWe class)",
            class: ThrustClass::LowThrust,
            isp_s: 5_000.0, thrust_per_engine_n: 6.3, engine_mass_kg: 150.0,
            max_engines: 40, tank_frac: 0.10, fixed_mass_kg: 1_500.0,
            power_per_thruster_kw: 250.0, alpha_kg_per_kw: 18.0, efficiency: 0.62,
            trl: 4, speculative: false,
            dev_cost_musd: 20_000.0, infra_cost_musd: 5_000.0,
            prop_cost_usd_per_kg: 15_000.0, ops_cost_musd_per_mission: 80.0,
            notes: "Fission reactor + MPD/ion cluster. Needs chemical kick stage for lunar ascent (T/W << 1).",
        },
        PropSystem {
            id: 4, key: "ion", name: "Gridded Ion (NEXT-C class, solar)",
            class: ThrustClass::LowThrust,
            isp_s: 4_170.0, thrust_per_engine_n: 0.236, engine_mass_kg: 58.0,
            max_engines: 400, tank_frac: 0.10, fixed_mass_kg: 800.0,
            power_per_thruster_kw: 6.9, alpha_kg_per_kw: 20.0, efficiency: 0.70,
            trl: 6, speculative: false,
            dev_cost_musd: 6_000.0, infra_cost_musd: 2_000.0,
            prop_cost_usd_per_kg: 15_000.0, ops_cost_musd_per_mission: 40.0,
            notes: "Flight-proven thruster scaled to a large cluster; solar power degrades ~57% at Mars distance (alpha penalized).",
        },
        PropSystem {
            id: 5, key: "hall", name: "Hall Effect (AEPS class, solar)",
            class: ThrustClass::LowThrust,
            isp_s: 2_800.0, thrust_per_engine_n: 0.59, engine_mass_kg: 100.0,
            max_engines: 300, tank_frac: 0.10, fixed_mass_kg: 800.0,
            power_per_thruster_kw: 13.3, alpha_kg_per_kw: 20.0, efficiency: 0.57,
            trl: 7, speculative: false,
            dev_cost_musd: 5_000.0, infra_cost_musd: 2_000.0,
            prop_cost_usd_per_kg: 12_000.0, ops_cost_musd_per_mission: 40.0,
            notes: "12.5 kW AEPS heritage; krypton-compatible (cheaper propellant than xenon).",
        },
        PropSystem {
            id: 6, key: "mass_driver", name: "Mass Driver + LOX/LH2 kick",
            class: ThrustClass::Launcher,
            isp_s: 451.0, thrust_per_engine_n: 110_000.0, engine_mass_kg: 190.0,
            max_engines: 4, tank_frac: 0.14, fixed_mass_kg: 300.0,
            power_per_thruster_kw: 0.0, alpha_kg_per_kw: 0.0, efficiency: 0.50,
            trl: 3, speculative: false,
            dev_cost_musd: 15_000.0, infra_cost_musd: 12_000.0,
            prop_cost_usd_per_kg: 900.0, ops_cost_musd_per_mission: 15.0,
            notes: "Electromagnetic track supplies ascent+TMI kinetically. Cargo carries an ISRU LOX/LH2 MOI kick stage with 259-day cryocooling. efficiency = electric-to-kinetic.",
        },
        PropSystem {
            id: 7, key: "hybrid", name: "Mass Driver + reusable SEP tug",
            class: ThrustClass::Hybrid,
            isp_s: 2_800.0, thrust_per_engine_n: 0.59, engine_mass_kg: 100.0,
            max_engines: 300, tank_frac: 0.10, fixed_mass_kg: 1_200.0,
            power_per_thruster_kw: 13.3, alpha_kg_per_kw: 20.0, efficiency: 0.57,
            trl: 3, speculative: false,
            dev_cost_musd: 18_000.0, infra_cost_musd: 13_000.0,
            prop_cost_usd_per_kg: 12_000.0, ops_cost_musd_per_mission: 30.0,
            notes: "Driver throws cargo to escape; a reusable Hall-thruster tug (amortized over ~10 round trips) does the heliocentric leg and Mars capture spiral.",
        },
        PropSystem {
            id: 8, key: "fusion", name: "D-He3 Fusion (SPECULATIVE)",
            class: ThrustClass::HighThrust,
            isp_s: 8_000.0, thrust_per_engine_n: 100_000.0, engine_mass_kg: 15_000.0,
            max_engines: 3, tank_frac: 0.12, fixed_mass_kg: 2_000.0,
            power_per_thruster_kw: 0.0, alpha_kg_per_kw: 0.0, efficiency: 0.0,
            trl: 1, speculative: true,
            dev_cost_musd: 60_000.0, infra_cost_musd: 8_000.0,
            prop_cost_usd_per_kg: 50_000.0, ops_cost_musd_per_mission: 150.0,
            notes: "TRL 1-2. Assumes net-gain magneto-inertial fusion at 100 kN / Isp 8000 s — no such engine exists; all figures are placeholders for comparison framing only.",
        },
    ]
}

pub fn by_id(id: u32) -> PropSystem {
    catalog().into_iter().find(|p| p.id == id).unwrap_or_else(|| catalog()[0].clone())
}

/// Effective exhaust velocity, km/s
pub fn c_eff_kms(isp_s: f64) -> f64 {
    G0 * isp_s / 1000.0
}

#[derive(Clone, Copy, Debug)]
pub struct StageMass {
    pub prop_kg: f64,
    pub dry_kg: f64, // structure + fixed, excluding engines (added by analyzer)
    pub wet_kg: f64, // prop + dry (excluding payload, excluding engines)
}

/// Size one stage to give `payload_kg` a delta-v of `dv_kms`.
/// Returns None when structurally infeasible: k (R-1) >= 1.
pub fn size_stage(
    payload_kg: f64,
    dv_kms: f64,
    isp_s: f64,
    tank_frac: f64,
    fixed_kg: f64,
    extra_dry_kg: f64, // engines, power systems — counts as dry mass burned-with
) -> Option<StageMass> {
    let c = c_eff_kms(isp_s);
    let r = (dv_kms / c).exp();
    let denom = 1.0 - tank_frac * (r - 1.0);
    if denom <= 1e-6 {
        return None;
    }
    let prop = (payload_kg + fixed_kg + extra_dry_kg) * (r - 1.0) / denom;
    let dry = tank_frac * prop + fixed_kg + extra_dry_kg;
    Some(StageMass { prop_kg: prop, dry_kg: dry, wet_kg: prop + dry })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tsiolkovsky_known_case() {
        // Isp 450 s, dv 9.4 km/s -> mass ratio e^(9400/4413) ~ 8.42
        let c = c_eff_kms(450.0);
        let r = (9.4_f64 / c).exp();
        assert!((r - 8.42).abs() < 0.05, "R {}", r);
    }

    #[test]
    fn stage_sizing_closes() {
        // verify the closed form against the rocket equation
        let s = size_stage(45_359.0, 3.5, 451.0, 0.12, 250.0, 500.0).unwrap();
        let m0 = 45_359.0 + s.wet_kg;
        let mf = m0 - s.prop_kg;
        let dv = c_eff_kms(451.0) * (m0 / mf).ln();
        assert!((dv - 3.5).abs() < 1e-9, "dv {}", dv);
    }

    #[test]
    fn infeasible_when_structure_dominates() {
        // dv 20 km/s at Isp 300 with 12% tankage: R-1 ~ 890 -> infeasible
        assert!(size_stage(1000.0, 20.0, 300.0, 0.12, 0.0, 0.0).is_none());
    }
}
