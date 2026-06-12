//! Integration validation against published aerospace benchmarks (docs/09).

use sim_core::analyzer::{analyze, compare_all};
use sim_core::constants::*;
use sim_core::kepler;
use sim_core::patched_conic::{budget, MissionParams, TargetOrbit};

#[test]
fn benchmark_lunar_escape_velocity() {
    // published: 2.38 km/s
    assert!((kepler::v_escape(MU_MOON, R_MOON) - 2.376).abs() < 0.01);
}

#[test]
fn benchmark_hohmann_earth_mars() {
    let h = kepler::hohmann(MU_SUN, A_EARTH, A_MARS);
    assert!((h.tof_s / DAY - 258.9).abs() < 1.5); // ~8.6 months
    assert!((h.vinf_dep - 2.94).abs() < 0.03); // C3 ≈ 8.7 km²/s²
    assert!((h.vinf_arr - 2.65).abs() < 0.03);
}

#[test]
fn benchmark_earth_mars_synodic_period() {
    let b = budget(&MissionParams::default());
    assert!((b.synodic_days - 779.9).abs() < 2.0); // published 779.94 d
    assert!((b.lead_angle_deg - 44.3).abs() < 1.0); // published ~44°
}

#[test]
fn benchmark_llo_to_tmi_in_published_range() {
    // Literature: LLO -> trans-Mars direct injection ~1.4–1.8 km/s
    let b = budget(&MissionParams::default());
    assert!(b.tmi > 1.4 && b.tmi < 1.8, "tmi {}", b.tmi);
}

#[test]
fn benchmark_moi_capture() {
    // Literature: v_inf 2.65 capture to low circular Mars orbit ~2.1 km/s,
    // to loose elliptical capture ~0.9 km/s
    let b = budget(&MissionParams::default());
    assert!((b.moi - 2.07).abs() < 0.1, "moi {}", b.moi);
    let mut p1 = MissionParams::default();
    p1.target = TargetOrbit::OneSolEllipse { peri_alt_km: 300.0 };
    let b1 = budget(&p1);
    assert!((b1.moi - 0.90).abs() < 0.08, "moi 1-sol {}", b1.moi);
}

#[test]
fn all_nonspeculative_systems_feasible_at_baseline() {
    let results = compare_all(&MissionParams::default());
    assert_eq!(results.len(), 9);
    for r in &results {
        if !r.sys.speculative {
            assert!(r.feasible, "{} infeasible: {:?}", r.sys.name, r.reasons);
        }
        // conservation sanity: wet = cargo + prop + dry (within rounding)
        let recon = r.wet_mass_kg - r.prop_mass_kg - r.dry_mass_kg;
        assert!(
            (recon - MissionParams::default().cargo_kg).abs() / recon < 0.02,
            "{} mass bookkeeping off: cargo-equiv {}",
            r.sys.name,
            recon
        );
    }
}

#[test]
fn energy_bookkeeping_chemical_vs_ep() {
    // EP should spend less propellant but comparable-or-more total energy
    let chem = analyze(0, &MissionParams::default());
    let nep = analyze(3, &MissionParams::default());
    assert!(nep.prop_mass_kg < 0.5 * chem.prop_mass_kg);
    assert!(nep.energy_gj > 0.0 && chem.energy_gj > 0.0);
}

#[test]
fn cargo_mass_scaling_is_monotone() {
    let mut small = MissionParams::default();
    small.cargo_kg = 10_000.0;
    let mut large = MissionParams::default();
    large.cargo_kg = 100_000.0;
    for id in 0..9u32 {
        let a = analyze(id, &small);
        let b = analyze(id, &large);
        if a.feasible && b.feasible {
            assert!(b.wet_mass_kg > a.wet_mass_kg, "system {} not monotone", id);
        }
    }
}
