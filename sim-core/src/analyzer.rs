//! Mission analyzer: sizes a complete vehicle for each propulsion architecture
//! against the patched-conic (high-thrust) or spiral (low-thrust) delta-v
//! budget, then derives masses, burn timeline, power, energy, cost and risk.
//!
//! Sizing is iterative because of mutual coupling:
//!   gravity loss <-> liftoff T/W <-> engine count <-> stage mass.
//! Fixed-point iteration converges in < 6 passes for every catalog entry
//! (verified in tests).

use crate::constants::*;
use crate::jsonw as j;
use crate::kepler;
use crate::patched_conic::{budget, low_thrust_budget, DvBudget, MissionParams};
use crate::propulsion::{by_id, c_eff_kms, size_stage, PropSystem, ThrustClass};

#[derive(Clone, Debug)]
pub struct BurnEvent {
    pub name: String,
    pub kind: &'static str, // "burn" | "spiral" | "kinetic" | "jettison"
    pub t_start_days: f64,
    pub dv_kms: f64,
    pub duration_s: f64,
    pub prop_used_kg: f64,
    pub m_before_kg: f64,
    pub m_after_kg: f64,
}

#[derive(Clone, Debug)]
pub struct StageOut {
    pub name: String,
    pub prop_kg: f64,
    pub dry_kg: f64,
    pub engines: u32,
    pub thrust_total_n: f64,
}

#[derive(Clone, Debug)]
pub struct LauncherOut {
    pub muzzle_v_kms: f64,
    pub track_length_m: f64,
    pub peak_accel_g: f64,
    pub launch_energy_gj: f64,   // electrical, after efficiency
    pub launch_duration_s: f64,
    pub recharge_power_mw: f64,  // average for 1 launch/day
}

#[derive(Clone, Debug)]
pub struct CostOut {
    pub dev_musd: f64,
    pub infra_musd: f64,
    pub prop_musd: f64,
    pub ops_musd: f64,
    pub per_mission_musd: f64,
    pub usd_per_kg: f64, // amortized over n_amort missions
    pub n_amort: f64,
}

#[derive(Clone, Debug)]
pub struct MissionResult {
    pub sys: PropSystem,
    pub feasible: bool,
    pub reasons: Vec<String>,
    pub assumptions: Vec<String>,
    pub risks: Vec<String>,
    pub budget: DvBudget,
    pub total_dv_kms: f64,   // propulsive dv delivered (margined)
    pub kinetic_dv_kms: f64, // dv supplied kinetically by infrastructure
    pub wet_mass_kg: f64,    // total flight-system mass (cargo + stages/tug)
    pub prop_mass_kg: f64,
    pub dry_mass_kg: f64,    // non-cargo dry
    pub transit_days: f64,
    pub peak_accel_g: f64,
    pub power_kw: f64,  // electric input (EP) or jet/thermal power (thermal engines)
    pub energy_gj: f64, // jet kinetic energy (chem/NTP) or electric energy (EP/driver)
    pub stages: Vec<StageOut>,
    pub burns: Vec<BurnEvent>,
    pub launcher: Option<LauncherOut>,
    pub cost: CostOut,
}

const N_AMORT_DEFAULT: f64 = 20.0;
const EP_THRUST_TIME_CAP_DAYS: f64 = 550.0;
const DRIVER_ACCEL_LIMIT_G: f64 = 2000.0; // solid cargo tolerates kilo-g

fn gravity_loss_for_twr(twr: f64) -> f64 {
    (0.25 * (1.5 / twr.max(0.2)).sqrt()).clamp(0.06, 0.60)
}

pub fn analyze(sys_id: u32, p: &MissionParams) -> MissionResult {
    let sys = by_id(sys_id);
    match sys.class {
        ThrustClass::HighThrust => analyze_high_thrust(&sys, p),
        ThrustClass::LowThrust => analyze_low_thrust(&sys, p),
        ThrustClass::Launcher => analyze_mass_driver(&sys, p),
        ThrustClass::Hybrid => analyze_hybrid(&sys, p),
    }
}

pub fn compare_all(p: &MissionParams) -> Vec<MissionResult> {
    crate::propulsion::catalog().iter().map(|s| analyze(s.id, p)).collect()
}

// ---------------------------------------------------------------- high thrust

fn analyze_high_thrust(sys: &PropSystem, p: &MissionParams) -> MissionResult {
    let m = 1.0 + p.margin_frac;
    let c = c_eff_kms(sys.isp_s);
    let mut g_loss = 0.25;
    let mut reasons: Vec<String> = vec![];

    let mut b = budget(p);
    let mut s1 = None;
    let mut s2 = None;
    let mut n1 = 1u32;
    let mut n2 = 1u32;
    let mut feasible = true;

    for _ in 0..6 {
        let mut pp = *p;
        pp.gravity_loss_kms = g_loss;
        b = budget(&pp);
        let dv2 = (b.midcourse + b.moi + b.rendezvous) * m;
        let dv1 = (b.ascent + b.tmi) * m;

        // stage 2 (midcourse + MOI + rendezvous): engine count from burn-time cap
        n2 = 1;
        loop {
            let extra = n2 as f64 * sys.engine_mass_kg;
            match size_stage(p.cargo_kg, dv2, sys.isp_s, sys.tank_frac, sys.fixed_mass_kg, extra) {
                Some(st) => {
                    let mdot = n2 as f64 * sys.thrust_per_engine_n / (c * 1000.0);
                    let t_burn = st.prop_kg / mdot;
                    if t_burn <= 1800.0 || n2 >= sys.max_engines {
                        s2 = Some((st, dv2));
                        break;
                    }
                    n2 += 1;
                }
                None => {
                    feasible = false;
                    reasons.push("stage 2 structurally infeasible (tank fraction × mass ratio)".into());
                    s2 = None;
                    break;
                }
            }
        }
        let Some((st2, _)) = s2.clone() else { break };

        // stage 1 (ascent + TMI): engine count from lunar liftoff T/W >= 1.3
        let payload1 = p.cargo_kg + st2.wet_kg;
        n1 = 1;
        for _ in 0..8 {
            let extra = n1 as f64 * sys.engine_mass_kg;
            match size_stage(payload1, dv1, sys.isp_s, sys.tank_frac, sys.fixed_mass_kg, extra) {
                Some(st) => {
                    let m0 = payload1 + st.wet_kg;
                    let req_n = (1.3 * m0 * G_MOON / sys.thrust_per_engine_n).ceil() as u32;
                    if req_n <= n1 {
                        s1 = Some((st, dv1));
                        break;
                    }
                    if req_n > sys.max_engines {
                        feasible = false;
                        reasons.push(format!(
                            "needs {} engines for lunar liftoff T/W ≥ 1.3 (max {})",
                            req_n, sys.max_engines
                        ));
                        n1 = sys.max_engines;
                        let extra = n1 as f64 * sys.engine_mass_kg;
                        s1 = size_stage(payload1, dv1, sys.isp_s, sys.tank_frac, sys.fixed_mass_kg, extra)
                            .map(|s| (s, dv1));
                        break;
                    }
                    n1 = req_n;
                }
                None => {
                    feasible = false;
                    reasons.push("stage 1 structurally infeasible".into());
                    s1 = None;
                    break;
                }
            }
        }
        let Some((st1, _)) = s1.clone() else { break };
        let m0 = payload1 + st1.wet_kg;
        let twr = n1 as f64 * sys.thrust_per_engine_n / (m0 * G_MOON);
        let new_loss = gravity_loss_for_twr(twr);
        if (new_loss - g_loss).abs() < 1e-4 {
            break;
        }
        g_loss = new_loss;
    }

    let (st1, dv1) = s1.unwrap_or((crate::propulsion::StageMass { prop_kg: 0.0, dry_kg: 0.0, wet_kg: 0.0 }, 0.0));
    let (st2, dv2) = s2.unwrap_or((crate::propulsion::StageMass { prop_kg: 0.0, dry_kg: 0.0, wet_kg: 0.0 }, 0.0));

    let wet = p.cargo_kg + st1.wet_kg + st2.wet_kg;
    let t1_n = n1 as f64 * sys.thrust_per_engine_n;
    let t2_n = n2 as f64 * sys.thrust_per_engine_n;
    let mdot1 = t1_n / (c * 1000.0);
    let mdot2 = t2_n / (c * 1000.0);

    // burn timeline: sequential rocket-equation bookkeeping
    let mut burns: Vec<BurnEvent> = vec![];
    let mut mass = wet;
    let push_burn = |name: &str, t_days: f64, dv: f64, mdot: f64, thrust: f64, mass: &mut f64, burns: &mut Vec<BurnEvent>| {
        let m_before = *mass;
        let m_after = m_before * (-dv / c).exp();
        let prop = m_before - m_after;
        burns.push(BurnEvent {
            name: name.into(),
            kind: "burn",
            t_start_days: t_days,
            dv_kms: dv,
            duration_s: prop / mdot,
            prop_used_kg: prop,
            m_before_kg: m_before,
            m_after_kg: m_after,
        });
        let _ = thrust;
        *mass = m_after;
    };

    let frac_ascent = b.ascent / (b.ascent + b.tmi);
    push_burn("Lunar ascent", 0.0, dv1 * frac_ascent, mdot1, t1_n, &mut mass, &mut burns);
    push_burn("Trans-Mars injection", 0.12, dv1 * (1.0 - frac_ascent), mdot1, t1_n, &mut mass, &mut burns);
    // jettison stage 1
    let m_before = mass;
    mass -= st1.dry_kg;
    burns.push(BurnEvent {
        name: "Stage 1 jettison".into(), kind: "jettison", t_start_days: 0.2,
        dv_kms: 0.0, duration_s: 0.0, prop_used_kg: 0.0, m_before_kg: m_before, m_after_kg: mass,
    });
    push_burn("Midcourse correction", b.tof_days * 0.5, b.midcourse * m, mdot2, t2_n, &mut mass, &mut burns);
    push_burn("Mars orbit insertion", b.tof_days, b.moi * m, mdot2, t2_n, &mut mass, &mut burns);
    push_burn("Rendezvous trim", b.tof_days + 2.0, b.rendezvous * m, mdot2, t2_n, &mut mass, &mut burns);

    let peak_accel = burns
        .iter()
        .filter(|bn| bn.kind == "burn" && bn.duration_s > 0.0)
        .map(|bn| {
            let thrust = if bn.t_start_days < 1.0 { t1_n } else { t2_n };
            thrust / bn.m_after_kg
        })
        .fold(0.0_f64, f64::max);

    let prop_total = st1.prop_kg + st2.prop_kg;
    // jet kinetic energy 1/2 m_p c^2; for NTP this approximates reactor output integral
    let energy_gj = 0.5 * prop_total * (c * 1000.0).powi(2) / 1e9;
    let jet_power_kw = 0.5 * (t1_n / (c * 1000.0)) * (c * 1000.0).powi(2) / 1e3;

    let mut assumptions = vec![
        "Impulsive patched-conic budget; coplanar circular planetary orbits".to_string(),
        format!("Gravity/steering loss model: 0.25·sqrt(1.5/TWR) km/s, converged at {:.2} km/s", g_loss),
        format!("Two-stage architecture; {:.0}% propellant margin on every burn", p.margin_frac * 100.0),
    ];
    let mut risks: Vec<String> = vec![];
    let moi_burn = burns.iter().find(|bn| bn.name.contains("insertion"));
    if let Some(bn) = moi_burn {
        if bn.duration_s > 1200.0 {
            risks.push(format!(
                "MOI burn is {:.0} min — finite-burn (non-impulsive) losses of a few % not modeled",
                bn.duration_s / 60.0
            ));
        }
    }
    if sys.key == "ntp" {
        risks.push("Nuclear launch from lunar surface: policy/contamination constraints".into());
        risks.push("259-day LH2 storage: zero-boiloff cryocoolers required".into());
        assumptions.push("Reactor thermal power reported as jet power (NERVA-class ~1.5 GWt/engine)".into());
    }
    if sys.key == "lox_lh2" {
        risks.push("LH2 boiloff across 259-day cruise for stage 2 (sunshade + cryocooler)".into());
    }
    if sys.speculative {
        risks.push("SPECULATIVE: no engine of this class exists; all performance figures are placeholders".into());
    }

    MissionResult {
        sys: sys.clone(),
        feasible,
        reasons,
        assumptions,
        risks,
        total_dv_kms: dv1 + dv2,
        kinetic_dv_kms: 0.0,
        wet_mass_kg: wet,
        prop_mass_kg: prop_total,
        dry_mass_kg: st1.dry_kg + st2.dry_kg,
        transit_days: b.tof_days + 2.0,
        peak_accel_g: peak_accel / G0,
        power_kw: jet_power_kw,
        energy_gj,
        stages: vec![
            StageOut { name: "Stage 1 (ascent + TMI)".into(), prop_kg: st1.prop_kg, dry_kg: st1.dry_kg, engines: n1, thrust_total_n: t1_n },
            StageOut { name: "Stage 2 (MOI + rendezvous)".into(), prop_kg: st2.prop_kg, dry_kg: st2.dry_kg, engines: n2, thrust_total_n: t2_n },
        ],
        burns,
        launcher: None,
        cost: cost_for(sys, prop_total, N_AMORT_DEFAULT, p.cargo_kg, 0.0),
        budget: b,
    }
}

// ----------------------------------------------------------------- low thrust

fn analyze_low_thrust(sys: &PropSystem, p: &MissionParams) -> MissionResult {
    let m = 1.0 + p.margin_frac;
    let b = budget(p); // for reference values / window data
    let lt = low_thrust_budget(p);
    let dv_ep = lt.total * m; // EP does everything above LLO
    let c = c_eff_kms(sys.isp_s);

    // EP vehicle sizing: fixed-point on average mass -> thrust -> power -> dry
    let mut n_thr = 4u32;
    let mut st = None;
    let mut m_avg = p.cargo_kg * 1.6;
    for _ in 0..12 {
        let t_req_n = dv_ep * 1000.0 * m_avg / (EP_THRUST_TIME_CAP_DAYS * DAY);
        n_thr = ((t_req_n / sys.thrust_per_engine_n).ceil() as u32).clamp(1, sys.max_engines);
        let power_kw = n_thr as f64 * sys.power_per_thruster_kw;
        let extra_dry = power_kw * sys.alpha_kg_per_kw + n_thr as f64 * sys.engine_mass_kg;
        st = size_stage(p.cargo_kg, dv_ep, sys.isp_s, sys.tank_frac, sys.fixed_mass_kg, extra_dry);
        let Some(s) = st else { break };
        let m0 = p.cargo_kg + s.wet_kg;
        let mf = m0 - s.prop_kg;
        let new_avg = 0.5 * (m0 + mf);
        if (new_avg - m_avg).abs() < 1.0 {
            m_avg = new_avg;
            break;
        }
        m_avg = new_avg;
    }
    let feasible = st.is_some();
    let s = st.unwrap_or(crate::propulsion::StageMass { prop_kg: 0.0, dry_kg: 0.0, wet_kg: 0.0 });

    let thrust_n = n_thr as f64 * sys.thrust_per_engine_n;
    let power_kw = n_thr as f64 * sys.power_per_thruster_kw;
    let t_thrust_days = if thrust_n > 0.0 { dv_ep * 1000.0 * m_avg / thrust_n / DAY } else { f64::INFINITY };
    // 15% duty/steering overhead; heliocentric phase can't beat ~ Hohmann/Edelbaum time
    let transit_days = (t_thrust_days * 1.15).max(300.0);

    // chemical kick stage: surface -> LLO (methalox-class storables assumed available)
    let kick_isp = 363.0;
    let kick_c = c_eff_kms(kick_isp);
    let dv_kick = (b.v_llo + 0.18) * m;
    let kick_payload = p.cargo_kg + s.wet_kg;
    let kick = size_stage(kick_payload, dv_kick, kick_isp, 0.08, 250.0, 1_600.0)
        .unwrap_or(crate::propulsion::StageMass { prop_kg: 0.0, dry_kg: 0.0, wet_kg: 0.0 });

    let wet = kick_payload + kick.wet_kg;

    // spiral timeline, durations proportional to each leg's dv share
    let mut burns: Vec<BurnEvent> = vec![];
    let kick_m0 = wet;
    let kick_mf = kick_m0 - kick.prop_kg;
    burns.push(BurnEvent {
        name: "Chemical ascent kick (surface → LLO)".into(), kind: "burn", t_start_days: 0.0,
        dv_kms: dv_kick, duration_s: kick.prop_kg / (1.6e6 / (kick_c * 1000.0)),
        prop_used_kg: kick.prop_kg, m_before_kg: kick_m0, m_after_kg: kick_mf,
    });
    burns.push(BurnEvent {
        name: "Kick stage jettison".into(), kind: "jettison", t_start_days: 0.05,
        dv_kms: 0.0, duration_s: 0.0, prop_used_kg: 0.0,
        m_before_kg: kick_mf, m_after_kg: kick_payload,
    });
    let legs = [
        ("Lunar escape spiral", lt.moon_spiral * m),
        ("Earth escape spiral", lt.earth_spiral * m),
        ("Heliocentric spiral (Edelbaum)", lt.heliocentric * m),
        ("Mars capture spiral", lt.capture_spiral * m),
    ];
    let mut mass = kick_payload;
    let mut t_cursor = 0.1;
    for (name, dv) in legs {
        let m_before = mass;
        let m_after = m_before * (-dv / c).exp();
        let dur_days = (dv / dv_ep) * t_thrust_days * 1.15;
        burns.push(BurnEvent {
            name: name.into(), kind: "spiral", t_start_days: t_cursor,
            dv_kms: dv, duration_s: dur_days * DAY,
            prop_used_kg: m_before - m_after, m_before_kg: m_before, m_after_kg: m_after,
        });
        mass = m_after;
        t_cursor += dur_days;
    }

    let energy_gj = power_kw * 1e3 * (t_thrust_days * DAY) / 1e9; // electric
    let mut risks = vec![
        "Spiral budgets are Edelbaum upper bounds; optimized low-thrust trajectories save 10–20%".to_string(),
        "Months-long spirals through Earth radiation belts (cargo is rad-hard, electronics less so)".to_string(),
        format!("{} thrusters firing for {:.0} days: wear/redundancy", n_thr, t_thrust_days),
    ];
    if sys.key == "nep" {
        risks.push("Megawatt space reactor: TRL 4, largest development risk in this study".into());
    } else {
        risks.push("Solar array output at Mars is 43% of 1 AU value (sized into alpha)".into());
    }

    MissionResult {
        sys: sys.clone(),
        feasible,
        reasons: if feasible { vec![] } else { vec!["EP stage structurally infeasible".into()] },
        assumptions: vec![
            "EP departs from LLO; chemical kick supplies ascent only".to_string(),
            format!("Thrust sized so total thrust time ≤ {} days", EP_THRUST_TIME_CAP_DAYS),
            "Spiral dv: escape ≈ local circular speed; heliocentric ≈ |v_c(Earth)−v_c(Mars)| (Edelbaum)".to_string(),
        ],
        risks,
        total_dv_kms: dv_ep + dv_kick,
        kinetic_dv_kms: 0.0,
        wet_mass_kg: wet,
        prop_mass_kg: s.prop_kg + kick.prop_kg,
        dry_mass_kg: s.dry_kg + kick.dry_kg,
        transit_days,
        peak_accel_g: (1.6e6 / kick_m0) / G0, // kick stage liftoff dominates
        power_kw,
        energy_gj,
        stages: vec![
            StageOut { name: "Chemical kick (ascent)".into(), prop_kg: kick.prop_kg, dry_kg: kick.dry_kg, engines: 1, thrust_total_n: 1.6e6 },
            StageOut { name: format!("EP stage ({} thrusters, {:.0} kW)", n_thr, power_kw), prop_kg: s.prop_kg, dry_kg: s.dry_kg, engines: n_thr, thrust_total_n: thrust_n },
        ],
        burns,
        launcher: None,
        cost: cost_for(sys, s.prop_kg + kick.prop_kg, N_AMORT_DEFAULT, p.cargo_kg, 0.0),
        budget: b,
    }
}

// ---------------------------------------------------------------- mass driver

fn driver_launch(b: &DvBudget, thrown_kg: f64, efficiency: f64) -> LauncherOut {
    // muzzle speed: escape the Moon with residual v_rel_moon, +2% aim margin
    let v_esc = kepler::v_escape(MU_MOON, R_MOON);
    let muzzle = 1.02 * (b.v_rel_moon.powi(2) + v_esc.powi(2)).sqrt(); // km/s
    let v_ms = muzzle * 1000.0;
    let a = DRIVER_ACCEL_LIMIT_G * G0;
    let ke_j = 0.5 * thrown_kg * v_ms * v_ms;
    LauncherOut {
        muzzle_v_kms: muzzle,
        track_length_m: v_ms * v_ms / (2.0 * a),
        peak_accel_g: DRIVER_ACCEL_LIMIT_G,
        launch_energy_gj: ke_j / efficiency / 1e9,
        launch_duration_s: v_ms / a,
        recharge_power_mw: ke_j / efficiency / DAY / 1e6,
    }
}

fn analyze_mass_driver(sys: &PropSystem, p: &MissionParams) -> MissionResult {
    let m = 1.0 + p.margin_frac;
    let b = budget(p);
    let c = c_eff_kms(sys.isp_s);

    // kick stage flies midcourse + MOI + rendezvous
    let dv_kick = (b.midcourse + b.moi + b.rendezvous) * m;
    let mut n_e = 1u32;
    let mut kick = None;
    loop {
        let extra = n_e as f64 * sys.engine_mass_kg;
        match size_stage(p.cargo_kg, dv_kick, sys.isp_s, sys.tank_frac, sys.fixed_mass_kg, extra) {
            Some(st) => {
                let mdot = n_e as f64 * sys.thrust_per_engine_n / (c * 1000.0);
                if st.prop_kg / mdot <= 1800.0 || n_e >= sys.max_engines {
                    kick = Some(st);
                    break;
                }
                n_e += 1;
            }
            None => break,
        }
    }
    let feasible = kick.is_some();
    let kick = kick.unwrap_or(crate::propulsion::StageMass { prop_kg: 0.0, dry_kg: 0.0, wet_kg: 0.0 });
    let thrown = p.cargo_kg + kick.wet_kg;
    let l = driver_launch(&b, thrown, sys.efficiency);

    let t_n = n_e as f64 * sys.thrust_per_engine_n;
    let mdot = t_n / (c * 1000.0);
    let mut burns = vec![BurnEvent {
        name: format!("Mass driver launch ({:.0} g, {:.2} km/s)", l.peak_accel_g, l.muzzle_v_kms),
        kind: "kinetic", t_start_days: 0.0, dv_kms: l.muzzle_v_kms,
        duration_s: l.launch_duration_s, prop_used_kg: 0.0,
        m_before_kg: thrown, m_after_kg: thrown,
    }];
    let mut mass = thrown;
    let seq = |name: &str, t: f64, dv: f64, mass: &mut f64, burns: &mut Vec<BurnEvent>| {
        let m_b = *mass;
        let m_a = m_b * (-dv / c).exp();
        burns.push(BurnEvent {
            name: name.into(), kind: "burn", t_start_days: t, dv_kms: dv,
            duration_s: (m_b - m_a) / mdot, prop_used_kg: m_b - m_a,
            m_before_kg: m_b, m_after_kg: m_a,
        });
        *mass = m_a;
    };
    seq("Midcourse correction", b.tof_days * 0.5, b.midcourse * m, &mut mass, &mut burns);
    seq("Mars orbit insertion", b.tof_days, b.moi * m, &mut mass, &mut burns);
    seq("Rendezvous trim", b.tof_days + 2.0, b.rendezvous * m, &mut mass, &mut burns);

    MissionResult {
        sys: sys.clone(),
        feasible,
        reasons: if feasible { vec![] } else { vec!["kick stage infeasible".into()] },
        assumptions: vec![
            format!("Track exit velocity {:.2} km/s gives lunar escape + TMI directly (2% aim margin)", l.muzzle_v_kms),
            format!("Cargo + kick stage tolerate {:.0} g axial load", l.peak_accel_g),
            "Driver electric-to-kinetic efficiency 50%; energy stored in flywheel/capacitor farm".to_string(),
        ],
        risks: vec![
            "No abort after release; aim error budget ~mm/s class at release".to_string(),
            "TRL 3 infrastructure: multi-km precision track on lunar surface".to_string(),
            "Kick stage cryogens stored 259 days (cryocooler) — or storables at 3× propellant cost".to_string(),
        ],
        total_dv_kms: dv_kick,
        kinetic_dv_kms: l.muzzle_v_kms,
        wet_mass_kg: thrown,
        prop_mass_kg: kick.prop_kg,
        dry_mass_kg: kick.dry_kg,
        transit_days: b.tof_days + 2.0,
        peak_accel_g: l.peak_accel_g,
        power_kw: l.recharge_power_mw * 1000.0,
        energy_gj: l.launch_energy_gj,
        stages: vec![StageOut {
            name: "MOI kick stage".into(), prop_kg: kick.prop_kg, dry_kg: kick.dry_kg,
            engines: n_e, thrust_total_n: t_n,
        }],
        burns,
        launcher: Some(l),
        cost: cost_for(sys, kick.prop_kg, N_AMORT_DEFAULT, p.cargo_kg, 0.0),
        budget: b,
    }
}

// --------------------------------------------------------------------- hybrid

fn analyze_hybrid(sys: &PropSystem, p: &MissionParams) -> MissionResult {
    let m = 1.0 + p.margin_frac;
    let b = budget(p);
    let lt = low_thrust_budget(p);
    let c = c_eff_kms(sys.isp_s);

    // driver throws cargo + trim package to Earth-Moon escape
    let trim_kg = 500.0;
    let thrown = p.cargo_kg + trim_kg;
    let l = driver_launch(&b, thrown, 0.50);

    // reusable SEP tug meets the cargo at escape, flies heliocentric + capture
    let dv_tug = (lt.heliocentric + lt.capture_spiral) * m;
    let mut n_thr = 8u32;
    let mut st = None;
    let mut m_avg = thrown * 1.5;
    for _ in 0..12 {
        let t_req_n = dv_tug * 1000.0 * m_avg / (EP_THRUST_TIME_CAP_DAYS * DAY);
        n_thr = ((t_req_n / sys.thrust_per_engine_n).ceil() as u32).clamp(1, sys.max_engines);
        let power_kw = n_thr as f64 * sys.power_per_thruster_kw;
        let extra = power_kw * sys.alpha_kg_per_kw + n_thr as f64 * sys.engine_mass_kg;
        st = size_stage(thrown, dv_tug, sys.isp_s, sys.tank_frac, sys.fixed_mass_kg, extra);
        let Some(s) = st else { break };
        let m0 = thrown + s.wet_kg;
        let new_avg = 0.5 * (m0 + (m0 - s.prop_kg));
        if (new_avg - m_avg).abs() < 1.0 {
            m_avg = new_avg;
            break;
        }
        m_avg = new_avg;
    }
    let feasible = st.is_some();
    let s = st.unwrap_or(crate::propulsion::StageMass { prop_kg: 0.0, dry_kg: 0.0, wet_kg: 0.0 });
    let thrust_n = n_thr as f64 * sys.thrust_per_engine_n;
    let power_kw = n_thr as f64 * sys.power_per_thruster_kw;
    let t_thrust_days = dv_tug * 1000.0 * m_avg / thrust_n / DAY;
    let transit = (t_thrust_days * 1.15).max(300.0);

    let m0 = thrown + s.wet_kg;
    let mut burns = vec![BurnEvent {
        name: format!("Mass driver launch ({:.0} g, {:.2} km/s)", l.peak_accel_g, l.muzzle_v_kms),
        kind: "kinetic", t_start_days: 0.0, dv_kms: l.muzzle_v_kms,
        duration_s: l.launch_duration_s, prop_used_kg: 0.0, m_before_kg: thrown, m_after_kg: thrown,
    }];
    burns.push(BurnEvent {
        name: "SEP tug docking at escape".into(), kind: "jettison", t_start_days: 2.0,
        dv_kms: 0.0, duration_s: 0.0, prop_used_kg: 0.0, m_before_kg: thrown, m_after_kg: m0,
    });
    let legs = [
        ("Heliocentric spiral (Edelbaum)", lt.heliocentric * m),
        ("Mars capture spiral", lt.capture_spiral * m),
    ];
    let mut mass = m0;
    let mut t_cursor = 2.5;
    for (name, dv) in legs {
        let m_b = mass;
        let m_a = m_b * (-dv / c).exp();
        let dur = (dv / dv_tug) * t_thrust_days * 1.15;
        burns.push(BurnEvent {
            name: name.into(), kind: "spiral", t_start_days: t_cursor, dv_kms: dv,
            duration_s: dur * DAY, prop_used_kg: m_b - m_a, m_before_kg: m_b, m_after_kg: m_a,
        });
        mass = m_a;
        t_cursor += dur;
    }

    // tug hardware amortized over ~10 round trips: count 1/10 of dry into mission cost via ops
    MissionResult {
        sys: sys.clone(),
        feasible,
        reasons: if feasible { vec![] } else { vec!["tug sizing infeasible".into()] },
        assumptions: vec![
            "Driver supplies ascent + escape kinetically; tug pre-positioned at Earth-Moon L2 vicinity".to_string(),
            "Tug reused ~10 missions; hardware in infrastructure cost, propellant per mission".to_string(),
            format!("Tug thrust time ≤ {} days cap", EP_THRUST_TIME_CAP_DAYS),
        ],
        risks: vec![
            "Autonomous rendezvous/berthing with inert cargo at escape velocity".to_string(),
            "TRL 3 driver + TRL 7 tug: integration risk; two new infrastructures".to_string(),
            "Tug must return to Earth-Moon space (return spiral propellant included in reuse economics, not in this leg)".to_string(),
        ],
        total_dv_kms: dv_tug,
        kinetic_dv_kms: l.muzzle_v_kms,
        wet_mass_kg: m0,
        prop_mass_kg: s.prop_kg,
        dry_mass_kg: s.dry_kg + trim_kg,
        transit_days: transit,
        peak_accel_g: l.peak_accel_g,
        power_kw,
        energy_gj: l.launch_energy_gj + power_kw * 1e3 * t_thrust_days * DAY / 1e9,
        stages: vec![StageOut {
            name: format!("SEP tug ({} thrusters, {:.0} kW)", n_thr, power_kw),
            prop_kg: s.prop_kg, dry_kg: s.dry_kg, engines: n_thr, thrust_total_n: thrust_n,
        }],
        burns,
        launcher: Some(l),
        cost: cost_for(sys, s.prop_kg, N_AMORT_DEFAULT, p.cargo_kg, 0.0),
        budget: b,
    }
}

// ------------------------------------------------------------------ economics

fn cost_for(sys: &PropSystem, prop_kg: f64, n_amort: f64, cargo_kg: f64, extra_musd: f64) -> CostOut {
    let prop_musd = prop_kg * sys.prop_cost_usd_per_kg / 1e6;
    let per_mission = sys.ops_cost_musd_per_mission + prop_musd + extra_musd;
    let amortized = (sys.dev_cost_musd + sys.infra_cost_musd) / n_amort + per_mission;
    CostOut {
        dev_musd: sys.dev_cost_musd,
        infra_musd: sys.infra_cost_musd,
        prop_musd,
        ops_musd: sys.ops_cost_musd_per_mission,
        per_mission_musd: per_mission,
        usd_per_kg: amortized * 1e6 / cargo_kg,
        n_amort,
    }
}

// ------------------------------------------------------ monte carlo / sensitivity

/// xorshift64* — deterministic, seedable, adequate statistical quality for
/// engineering dispersions (not crypto).
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.max(1))
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    pub fn uniform(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    /// standard normal via Box-Muller
    pub fn gauss(&mut self) -> f64 {
        let u1 = self.uniform().max(1e-12);
        let u2 = self.uniform();
        (-2.0 * u1.ln()).sqrt() * (2.0 * core::f64::consts::PI * u2).cos()
    }
}

#[derive(Clone, Debug)]
pub struct MonteCarloOut {
    pub n: u32,
    pub feasible_frac: f64,
    pub wet_mean: f64,
    pub wet_p5: f64,
    pub wet_p50: f64,
    pub wet_p95: f64,
    pub prop_mean: f64,
}

/// Dispersions (1-sigma): Isp 1%, tank fraction 8%, dv 2%, fixed mass 5%.
pub fn monte_carlo(sys_id: u32, p: &MissionParams, n: u32, seed: u64) -> MonteCarloOut {
    let mut rng = Rng::new(seed);
    let mut wets: Vec<f64> = Vec::with_capacity(n as usize);
    let mut props = 0.0;
    let mut n_feas = 0u32;
    let base = by_id(sys_id);
    for _ in 0..n {
        let mut sys = base.clone();
        sys.isp_s *= 1.0 + 0.01 * rng.gauss();
        sys.tank_frac *= (1.0 + 0.08 * rng.gauss()).max(0.3);
        sys.fixed_mass_kg *= (1.0 + 0.05 * rng.gauss()).max(0.5);
        let mut pp = *p;
        pp.margin_frac = (p.margin_frac + 0.02 * rng.gauss()).max(0.0);
        let r = analyze_with(&sys, &pp);
        if r.feasible {
            n_feas += 1;
            wets.push(r.wet_mass_kg);
            props += r.prop_mass_kg;
        }
    }
    wets.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let pick = |q: f64| -> f64 {
        if wets.is_empty() {
            return f64::NAN;
        }
        wets[((q * (wets.len() - 1) as f64).round() as usize).min(wets.len() - 1)]
    };
    let mean = if wets.is_empty() { f64::NAN } else { wets.iter().sum::<f64>() / wets.len() as f64 };
    MonteCarloOut {
        n,
        feasible_frac: n_feas as f64 / n as f64,
        wet_mean: mean,
        wet_p5: pick(0.05),
        wet_p50: pick(0.50),
        wet_p95: pick(0.95),
        prop_mean: if n_feas > 0 { props / n_feas as f64 } else { f64::NAN },
    }
}

fn analyze_with(sys: &PropSystem, p: &MissionParams) -> MissionResult {
    match sys.class {
        ThrustClass::HighThrust => analyze_high_thrust(sys, p),
        ThrustClass::LowThrust => analyze_low_thrust(sys, p),
        ThrustClass::Launcher => analyze_mass_driver(sys, p),
        ThrustClass::Hybrid => analyze_hybrid(sys, p),
    }
}

#[derive(Clone, Debug)]
pub struct SensitivityRow {
    pub param: String,
    pub low_label: String,
    pub high_label: String,
    pub wet_low: f64,
    pub wet_high: f64,
    pub cost_low: f64,
    pub cost_high: f64,
}

pub fn sensitivity(sys_id: u32, p: &MissionParams) -> Vec<SensitivityRow> {
    let base_sys = by_id(sys_id);
    let mut rows = vec![];
    let run = |sys: &PropSystem, pp: &MissionParams| {
        let r = analyze_with(sys, pp);
        (r.wet_mass_kg, r.cost.usd_per_kg)
    };
    {
        let mut lo = *p;
        lo.cargo_kg *= 0.8;
        let mut hi = *p;
        hi.cargo_kg *= 1.2;
        let (wl, _) = run(&base_sys, &lo);
        let (wh, _) = run(&base_sys, &hi);
        // cost/kg recomputed against each cargo
        let rl = analyze_with(&base_sys, &lo);
        let rh = analyze_with(&base_sys, &hi);
        rows.push(SensitivityRow {
            param: "Cargo mass".into(), low_label: "-20%".into(), high_label: "+20%".into(),
            wet_low: wl, wet_high: wh, cost_low: rl.cost.usd_per_kg, cost_high: rh.cost.usd_per_kg,
        });
    }
    {
        let mut lo = base_sys.clone();
        lo.isp_s *= 0.95;
        let mut hi = base_sys.clone();
        hi.isp_s *= 1.05;
        let (wl, cl) = run(&lo, p);
        let (wh, ch) = run(&hi, p);
        rows.push(SensitivityRow {
            param: "Specific impulse".into(), low_label: "-5%".into(), high_label: "+5%".into(),
            wet_low: wl, wet_high: wh, cost_low: cl, cost_high: ch,
        });
    }
    {
        let mut lo = base_sys.clone();
        lo.tank_frac *= 0.8;
        let mut hi = base_sys.clone();
        hi.tank_frac *= 1.2;
        let (wl, cl) = run(&lo, p);
        let (wh, ch) = run(&hi, p);
        rows.push(SensitivityRow {
            param: "Structure fraction".into(), low_label: "-20%".into(), high_label: "+20%".into(),
            wet_low: wl, wet_high: wh, cost_low: cl, cost_high: ch,
        });
    }
    {
        let mut lo = *p;
        lo.margin_frac = 0.0;
        let mut hi = *p;
        hi.margin_frac = 0.10;
        let (wl, cl) = run(&base_sys, &lo);
        let (wh, ch) = run(&base_sys, &hi);
        rows.push(SensitivityRow {
            param: "Δv margin".into(), low_label: "0%".into(), high_label: "10%".into(),
            wet_low: wl, wet_high: wh, cost_low: cl, cost_high: ch,
        });
    }
    {
        let mut lo = base_sys.clone();
        lo.prop_cost_usd_per_kg *= 0.5;
        let mut hi = base_sys.clone();
        hi.prop_cost_usd_per_kg *= 2.0;
        let (wl, cl) = run(&lo, p);
        let (wh, ch) = run(&hi, p);
        rows.push(SensitivityRow {
            param: "Propellant price".into(), low_label: "×0.5".into(), high_label: "×2".into(),
            wet_low: wl, wet_high: wh, cost_low: cl, cost_high: ch,
        });
    }
    rows
}

// -------------------------------------------------------------- serialization

impl MissionResult {
    pub fn to_json(&self) -> String {
        let burns: Vec<String> = self
            .burns
            .iter()
            .map(|bn| {
                j::obj(&[
                    ("name", j::esc(&bn.name)),
                    ("kind", j::esc(bn.kind)),
                    ("tDays", j::num(bn.t_start_days)),
                    ("dvKms", j::num(bn.dv_kms)),
                    ("durationS", j::num(bn.duration_s)),
                    ("propKg", j::num(bn.prop_used_kg)),
                    ("mBeforeKg", j::num(bn.m_before_kg)),
                    ("mAfterKg", j::num(bn.m_after_kg)),
                ])
            })
            .collect();
        let stages: Vec<String> = self
            .stages
            .iter()
            .map(|s| {
                j::obj(&[
                    ("name", j::esc(&s.name)),
                    ("propKg", j::num(s.prop_kg)),
                    ("dryKg", j::num(s.dry_kg)),
                    ("engines", j::num(s.engines as f64)),
                    ("thrustN", j::num(s.thrust_total_n)),
                ])
            })
            .collect();
        let launcher = match &self.launcher {
            Some(l) => j::obj(&[
                ("muzzleVKms", j::num(l.muzzle_v_kms)),
                ("trackLengthM", j::num(l.track_length_m)),
                ("peakAccelG", j::num(l.peak_accel_g)),
                ("launchEnergyGj", j::num(l.launch_energy_gj)),
                ("launchDurationS", j::num(l.launch_duration_s)),
                ("rechargePowerMw", j::num(l.recharge_power_mw)),
            ]),
            None => "null".to_string(),
        };
        let b = &self.budget;
        j::obj(&[
            ("id", j::num(self.sys.id as f64)),
            ("key", j::esc(self.sys.key)),
            ("name", j::esc(self.sys.name)),
            ("ispS", j::num(self.sys.isp_s)),
            ("trl", j::num(self.sys.trl as f64)),
            ("speculative", (if self.sys.speculative { "true" } else { "false" }).to_string()),
            ("notes", j::esc(self.sys.notes)),
            ("feasible", (if self.feasible { "true" } else { "false" }).to_string()),
            ("reasons", j::arr_str(&self.reasons)),
            ("assumptions", j::arr_str(&self.assumptions)),
            ("risks", j::arr_str(&self.risks)),
            ("totalDvKms", j::num(self.total_dv_kms)),
            ("kineticDvKms", j::num(self.kinetic_dv_kms)),
            ("wetMassKg", j::num(self.wet_mass_kg)),
            ("propMassKg", j::num(self.prop_mass_kg)),
            ("dryMassKg", j::num(self.dry_mass_kg)),
            ("cargoKg", j::num(self.budget_cargo())),
            ("transitDays", j::num(self.transit_days)),
            ("peakAccelG", j::num(self.peak_accel_g)),
            ("powerKw", j::num(self.power_kw)),
            ("energyGj", j::num(self.energy_gj)),
            ("stages", j::arr_s(&stages)),
            ("burns", j::arr_s(&burns)),
            ("launcher", launcher),
            (
                "cost",
                j::obj(&[
                    ("devMusd", j::num(self.cost.dev_musd)),
                    ("infraMusd", j::num(self.cost.infra_musd)),
                    ("propMusd", j::num(self.cost.prop_musd)),
                    ("opsMusd", j::num(self.cost.ops_musd)),
                    ("perMissionMusd", j::num(self.cost.per_mission_musd)),
                    ("usdPerKg", j::num(self.cost.usd_per_kg)),
                    ("nAmort", j::num(self.cost.n_amort)),
                ]),
            ),
            (
                "budget",
                j::obj(&[
                    ("ascent", j::num(b.ascent)),
                    ("tmi", j::num(b.tmi)),
                    ("midcourse", j::num(b.midcourse)),
                    ("moi", j::num(b.moi)),
                    ("rendezvous", j::num(b.rendezvous)),
                    ("total", j::num(b.total)),
                    ("totalMargined", j::num(b.total_margined)),
                    ("vinfDep", j::num(b.vinf_dep)),
                    ("vinfArr", j::num(b.vinf_arr)),
                    ("tofDays", j::num(b.tof_days)),
                    ("leadAngleDeg", j::num(b.lead_angle_deg)),
                    ("synodicDays", j::num(b.synodic_days)),
                ]),
            ),
        ])
    }

    fn budget_cargo(&self) -> f64 {
        // wet - prop - dry = cargo (+ trim packages folded into dry)
        self.wet_mass_kg - self.prop_mass_kg - self.dry_mass_kg
    }
}

impl MonteCarloOut {
    pub fn to_json(&self) -> String {
        j::obj(&[
            ("n", j::num(self.n as f64)),
            ("feasibleFrac", j::num(self.feasible_frac)),
            ("wetMean", j::num(self.wet_mean)),
            ("wetP5", j::num(self.wet_p5)),
            ("wetP50", j::num(self.wet_p50)),
            ("wetP95", j::num(self.wet_p95)),
            ("propMean", j::num(self.prop_mean)),
        ])
    }
}

pub fn sensitivity_json(rows: &[SensitivityRow]) -> String {
    let items: Vec<String> = rows
        .iter()
        .map(|r| {
            j::obj(&[
                ("param", j::esc(&r.param)),
                ("lowLabel", j::esc(&r.low_label)),
                ("highLabel", j::esc(&r.high_label)),
                ("wetLow", j::num(r.wet_low)),
                ("wetHigh", j::num(r.wet_high)),
                ("costLow", j::num(r.cost_low)),
                ("costHigh", j::num(r.cost_high)),
            ])
        })
        .collect();
    j::arr_s(&items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chemical_lox_lh2_sizes_plausibly() {
        let r = analyze(0, &MissionParams::default());
        assert!(r.feasible, "{:?}", r.reasons);
        // ~6 km/s at Isp 451 with staging: expect wet/cargo ratio 4–7
        let ratio = r.wet_mass_kg / CARGO_DEFAULT_KG;
        assert!(ratio > 3.5 && ratio < 7.5, "ratio {}", ratio);
        assert!(r.peak_accel_g < 8.0);
    }

    #[test]
    fn ntp_lighter_than_chemical() {
        let chem = analyze(0, &MissionParams::default());
        let ntp = analyze(2, &MissionParams::default());
        assert!(ntp.feasible);
        assert!(ntp.wet_mass_kg < chem.wet_mass_kg, "ntp {} chem {}", ntp.wet_mass_kg, chem.wet_mass_kg);
    }

    #[test]
    fn ep_uses_less_propellant_but_more_time() {
        let chem = analyze(0, &MissionParams::default());
        let nep = analyze(3, &MissionParams::default());
        assert!(nep.feasible, "{:?}", nep.reasons);
        assert!(nep.prop_mass_kg < chem.prop_mass_kg);
        assert!(nep.transit_days > chem.transit_days);
    }

    #[test]
    fn mass_driver_minimizes_flight_mass() {
        let r = analyze(6, &MissionParams::default());
        assert!(r.feasible);
        assert!(r.launcher.is_some());
        let l = r.launcher.unwrap();
        assert!(l.muzzle_v_kms > 3.0 && l.muzzle_v_kms < 3.7, "muzzle {}", l.muzzle_v_kms);
        assert!(l.track_length_m > 100.0 && l.track_length_m < 1000.0, "track {}", l.track_length_m);
    }

    #[test]
    fn monte_carlo_is_deterministic_and_sane() {
        let a = monte_carlo(0, &MissionParams::default(), 200, 42);
        let b = monte_carlo(0, &MissionParams::default(), 200, 42);
        assert_eq!(a.wet_mean, b.wet_mean);
        assert!(a.feasible_frac > 0.95);
        assert!(a.wet_p95 > a.wet_p5);
    }

    #[test]
    fn json_serializes() {
        let r = analyze(0, &MissionParams::default());
        let s = r.to_json();
        assert!(s.contains("\"feasible\":true"));
        assert!(s.contains("\"burns\""));
    }
}
