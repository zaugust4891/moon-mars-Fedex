//! Trajectory generation for the visualization layer, plus the N-body
//! cross-check that quantifies patched-conic error.
//!
//! Three coordinated views are produced:
//!   helio      — heliocentric ecliptic plane, full mission (km)
//!   departure  — selenocentric: ascent, LLO, escape hyperbola (km)
//!   arrival    — areocentric: approach hyperbola, capture, target orbit (km)
//!
//! High-thrust craft fly the analytic Hohmann ellipse (Kepler-propagated in
//! time, so positions are physically timed, not splined). Low-thrust craft fly
//! an Edelbaum spiral (v_c decreases linearly with applied delta-v; r = mu/v^2).
//! The lunar ascent arc is schematic (powered-flight guidance is out of scope)
//! and labeled as such.

use crate::analyzer::{analyze, MissionResult};
use crate::constants::*;
use crate::jsonw as j;
use crate::kepler;
use crate::nbody;
use crate::patched_conic::MissionParams;
use crate::propulsion::ThrustClass;

const N_HELIO: usize = 480;

fn helio_high_thrust(b: &crate::patched_conic::DvBudget, t_end_days: f64) -> (Vec<f64>, Vec<(f64, f64)>) {
    // transfer ellipse: perihelion at Earth departure point (angle 0)
    let h = &b.transfer;
    let a = h.a_t;
    let e = h.e_t;
    let mut ts = Vec::with_capacity(N_HELIO);
    let mut pts = Vec::with_capacity(N_HELIO);
    for i in 0..N_HELIO {
        let td = t_end_days * i as f64 / (N_HELIO - 1) as f64;
        ts.push(td);
        if td <= b.tof_days {
            let (r, nu) = kepler::elliptic_at(MU_SUN, a, e, td * DAY);
            pts.push((r * nu.cos(), r * nu.sin()));
        } else {
            // captured: ride with Mars
            let rails = nbody::Rails::for_departure(b.lead_angle_deg);
            pts.push(rails.mars(td * DAY));
        }
    }
    (ts, pts)
}

/// Edelbaum spiral between circular heliocentric orbits: circular speed falls
/// linearly with accumulated delta-v; r = mu / v^2; angle integrates v/r.
fn helio_spiral(b: &crate::patched_conic::DvBudget, t_helio_start_d: f64, t_helio_dur_d: f64, t_end_days: f64) -> (Vec<f64>, Vec<(f64, f64)>) {
    let v0 = kepler::v_circular(MU_SUN, A_EARTH);
    let v1 = kepler::v_circular(MU_SUN, A_MARS);
    let rails = nbody::Rails::for_departure(b.lead_angle_deg);
    let mut ts = Vec::with_capacity(N_HELIO);
    let mut pts = Vec::with_capacity(N_HELIO);
    let mut theta = 0.0_f64;
    let mut last_td: f64 = 0.0;
    for i in 0..N_HELIO {
        let td = t_end_days * i as f64 / (N_HELIO - 1) as f64;
        ts.push(td);
        if td < t_helio_start_d {
            // still spiraling in cislunar space: ride with Earth
            let p = rails.earth(td * DAY);
            pts.push(p);
            theta = (td * DAY / T_EARTH) * 2.0 * core::f64::consts::PI;
        } else if td <= t_helio_start_d + t_helio_dur_d {
            let f = (td - t_helio_start_d) / t_helio_dur_d;
            let v = v0 + (v1 - v0) * f;
            let r = MU_SUN / (v * v);
            let dt = (td - last_td) * DAY;
            theta += v / r * dt;
            pts.push((r * theta.cos(), r * theta.sin()));
        } else {
            pts.push(rails.mars(td * DAY));
        }
        last_td = td;
    }
    (ts, pts)
}

/// Selenocentric departure: schematic ascent arc, LLO coast, true escape hyperbola.
fn departure_view(b: &crate::patched_conic::DvBudget, p: &MissionParams, from_surface_kinetic: bool) -> String {
    let r_llo = R_MOON + p.llo_alt_km;
    let mut th: Vec<f64> = vec![];
    let mut pts: Vec<(f64, f64)> = vec![];

    let (a_h, e_h, t_offset_h) = if from_surface_kinetic {
        // mass driver: hyperbola with periapsis at the surface
        let vinf2 = b.v_rel_moon.powi(2); // muzzle sized for v_rel at infinity
        let a = -MU_MOON / vinf2;
        let e = 1.0 - R_MOON / a;
        (a, e, 0.0)
    } else {
        // ascent: schematic powered arc, 900 s (labeled schematic in docs)
        for i in 0..40 {
            let s = i as f64 / 39.0;
            let r = R_MOON + (r_llo - R_MOON) * s * s;
            let ang = -0.55 + 0.55 * s; // sweep ~31 deg downrange to insertion point
            th.push(s * 900.0 / 3600.0);
            pts.push((r * ang.cos(), r * ang.sin()));
        }
        // LLO coast: half an orbit
        let t_llo = kepler::period(MU_MOON, r_llo);
        for i in 0..60 {
            let s = i as f64 / 59.0;
            let ang = s * core::f64::consts::PI;
            th.push(0.25 + s * t_llo / 2.0 / 3600.0);
            pts.push((r_llo * ang.cos(), r_llo * ang.sin()));
        }
        let vinf2 = b.v_rel_moon.powi(2);
        let a = -MU_MOON / vinf2;
        let e = 1.0 + r_llo * vinf2 / MU_MOON;
        (a, e, 0.25 + kepler::period(MU_MOON, r_llo) / 2.0 / 3600.0)
    };

    // escape hyperbola, sampled in true time until r = 15,000 km
    let r_exit = 15_000.0;
    let rp = a_h * (1.0 - e_h);
    let cosh_exit = (r_exit / -a_h + 1.0) / e_h;
    let h_exit = (cosh_exit + (cosh_exit * cosh_exit - 1.0).sqrt()).ln();
    let n_mean = (MU_MOON / (-a_h).powi(3)).sqrt();
    let t_exit = (e_h * h_exit.sinh() - h_exit) / n_mean;
    // rotate so the hyperbola periapsis continues from the LLO exit point (angle pi)
    let rot = core::f64::consts::PI;
    for i in 0..120 {
        let t = t_exit * i as f64 / 119.0;
        let (r, nu) = kepler::hyperbolic_at(MU_MOON, a_h, e_h, t);
        let ang = rot + nu;
        th.push(t_offset_h + t / 3600.0);
        pts.push((r * ang.cos(), r * ang.sin()));
    }
    let _ = rp;
    j::obj(&[
        ("frame", j::esc("selenocentric")),
        ("tHours", j::arr_f(&th)),
        ("craft", j::arr_xy(&pts)),
        ("rBody", j::num(R_MOON)),
        ("rOrbit", j::num(r_llo)),
        ("hyperbolaE", j::num(e_h)),
    ])
}

/// Areocentric arrival: inbound hyperbola, capture burn at periapsis, target orbit.
fn arrival_view(b: &crate::patched_conic::DvBudget, p: &MissionParams) -> String {
    let rp = b.capture_rp_km;
    let vinf2 = b.vinf_arr.powi(2);
    let a_h = -MU_MARS / vinf2;
    let e_h = 1.0 + rp * vinf2 / MU_MARS;
    let r_start = 30_000.0;
    let cosh_s = (r_start / -a_h + 1.0) / e_h;
    let h_s = (cosh_s + (cosh_s * cosh_s - 1.0).sqrt()).ln();
    let n_mean = (MU_MARS / (-a_h).powi(3)).sqrt();
    let t_in = (e_h * h_s.sinh() - h_s) / n_mean;

    let mut th: Vec<f64> = vec![];
    let mut pts: Vec<(f64, f64)> = vec![];
    for i in 0..120 {
        let t = -t_in + t_in * i as f64 / 119.0;
        let (r, nu) = kepler::hyperbolic_at(MU_MARS, a_h, e_h, t);
        th.push((t + t_in) / 3600.0);
        pts.push((r * nu.cos(), r * nu.sin()));
    }
    // target orbit after MOI at periapsis (nu = 0)
    let (a_t, e_t) = match p.target {
        crate::patched_conic::TargetOrbit::CircularLmo { alt_km } => (R_MARS + alt_km, 0.0),
        crate::patched_conic::TargetOrbit::OneSolEllipse { peri_alt_km } => {
            let a = kepler::a_from_period(MU_MARS, MARS_SOL);
            (a, 1.0 - (R_MARS + peri_alt_km) / a)
        }
    };
    let t_orb = kepler::period(MU_MARS, a_t);
    let mut orb: Vec<(f64, f64)> = vec![];
    for i in 0..160 {
        let t = t_orb * 1.5 * i as f64 / 159.0;
        let (r, nu) = kepler::elliptic_at(MU_MARS, a_t, e_t.max(1e-9), t);
        orb.push((r * nu.cos(), r * nu.sin()));
        th.push((t_in + t) / 3600.0);
        pts.push((r * nu.cos(), r * nu.sin()));
    }
    j::obj(&[
        ("frame", j::esc("areocentric")),
        ("tHours", j::arr_f(&th)),
        ("craft", j::arr_xy(&pts)),
        ("orbit", j::arr_xy(&orb)),
        ("rBody", j::num(R_MARS)),
        ("rPeri", j::num(rp)),
        ("hyperbolaE", j::num(e_h)),
    ])
}

/// Integrate the heliocentric leg with the full restricted N-body force model
/// and report deviation from the analytic patched-conic arrival point.
/// This is the model-error estimate shown in the UI and docs/09.
pub fn nbody_check(b: &crate::patched_conic::DvBudget) -> (f64, Vec<f64>, Vec<(f64, f64)>) {
    let h = &b.transfer;
    let rails = nbody::Rails::for_departure(b.lead_angle_deg);
    // start at Earth's SOI boundary on the transfer ellipse (avoids the
    // singular start exactly at Earth's position)
    let r0 = A_EARTH + SOI_EARTH;
    let p_semi = h.a_t * (1.0 - h.e_t * h.e_t);
    let cos_nu = ((p_semi / r0 - 1.0) / h.e_t).clamp(-1.0, 1.0);
    let nu0 = cos_nu.acos();
    let v0 = kepler::vis_viva(MU_SUN, r0, h.a_t);
    let h_ang = (A_EARTH * (1.0 - h.e_t)).sqrt() * 0.0 + (MU_SUN * p_semi).sqrt(); // angular momentum
    let vt = h_ang / r0;
    let vr = (v0 * v0 - vt * vt).max(0.0).sqrt();
    // position/velocity in the ellipse frame (perihelion at angle 0)
    let (sn, cs) = nu0.sin_cos();
    let pos = (r0 * cs, r0 * sn);
    let vel = (vr * cs - vt * sn, vr * sn + vt * cs);
    // time at nu0 from Kepler equation
    let ecc_an0 = 2.0 * (((1.0 - h.e_t) / (1.0 + h.e_t)).sqrt() * (nu0 / 2.0).tan()).atan();
    let t0 = (ecc_an0 - h.e_t * ecc_an0.sin()) / (MU_SUN / h.a_t.powi(3)).sqrt();

    let f = |t: f64, x: f64, y: f64| nbody::accel(&rails, t, x, y);
    let y0: nbody::State = [pos.0, pos.1, vel.0, vel.1];
    let path = nbody::propagate_adaptive(&f, t0, y0, h.tof_s, 1.0, 240);

    let (tf, yf) = *path.last().unwrap();
    let _ = tf;
    // analytic arrival: aphelion at angle pi
    let r_arr = h.a_t * (1.0 + h.e_t);
    let dev = ((yf[0] + r_arr).powi(2) + yf[1].powi(2)).sqrt();
    let ts: Vec<f64> = path.iter().map(|(t, _)| t / DAY).collect();
    let pts: Vec<(f64, f64)> = path.iter().map(|(_, y)| (y[0], y[1])).collect();
    (dev, ts, pts)
}

pub fn build_trajectory(sys_id: u32, p: &MissionParams, include_nbody: bool) -> String {
    let r: MissionResult = analyze(sys_id, p);
    let b = &r.budget;
    let t_end = r.transit_days + 6.0;

    let low_thrust = matches!(r.sys.class, ThrustClass::LowThrust | ThrustClass::Hybrid);
    let (ts, pts) = if low_thrust {
        // heliocentric leg timing from the burn timeline
        let helio_burn = r.burns.iter().find(|bn| bn.name.contains("Heliocentric"));
        let (start, dur) = helio_burn
            .map(|bn| (bn.t_start_days, bn.duration_s / DAY))
            .unwrap_or((10.0, r.transit_days * 0.6));
        helio_spiral(b, start, dur, t_end)
    } else {
        helio_high_thrust(b, t_end)
    };

    let rails = nbody::Rails::for_departure(b.lead_angle_deg);
    let n = ts.len();
    let mut earth = Vec::with_capacity(n);
    let mut mars = Vec::with_capacity(n);
    let mut moon = Vec::with_capacity(n);
    for &td in &ts {
        earth.push(rails.earth(td * DAY));
        mars.push(rails.mars(td * DAY));
        moon.push(rails.moon(td * DAY));
    }

    // fuel fraction timeline from burn events
    let prop_total = r.prop_mass_kg.max(1e-9);
    let mut fuel: Vec<(f64, f64)> = vec![(0.0, 1.0)];
    let mut used = 0.0;
    for bn in &r.burns {
        if bn.prop_used_kg > 0.0 {
            fuel.push((bn.t_start_days, 1.0 - used / prop_total));
            used += bn.prop_used_kg;
            fuel.push((bn.t_start_days + bn.duration_s / DAY, 1.0 - used / prop_total));
        }
    }
    fuel.push((t_end, 1.0 - used / prop_total));

    let events: Vec<String> = r
        .burns
        .iter()
        .map(|bn| {
            j::obj(&[
                ("name", j::esc(&bn.name)),
                ("kind", j::esc(bn.kind)),
                ("tDays", j::num(bn.t_start_days)),
                ("dvKms", j::num(bn.dv_kms)),
                ("durationS", j::num(bn.duration_s)),
            ])
        })
        .collect();

    let from_surface_kinetic = matches!(r.sys.class, ThrustClass::Launcher | ThrustClass::Hybrid);
    let dep = departure_view(b, p, from_surface_kinetic);
    let arr = arrival_view(b, p);

    let nbody_field = if include_nbody && !low_thrust {
        let (dev, nts, npts) = nbody_check(b);
        j::obj(&[
            ("deviationKm", j::num(dev)),
            ("tDays", j::arr_f(&nts)),
            ("craft", j::arr_xy(&npts)),
        ])
    } else {
        "null".to_string()
    };

    j::obj(&[
        ("sysId", j::num(sys_id as f64)),
        ("sysName", j::esc(r.sys.name)),
        ("tofDays", j::num(b.tof_days)),
        ("transitDays", j::num(r.transit_days)),
        ("tEndDays", j::num(t_end)),
        ("leadAngleDeg", j::num(b.lead_angle_deg)),
        ("synodicDays", j::num(b.synodic_days)),
        ("aEarthKm", j::num(A_EARTH)),
        ("aMarsKm", j::num(A_MARS)),
        ("aMoonKm", j::num(A_MOON)),
        ("lowThrust", (if low_thrust { "true" } else { "false" }).to_string()),
        ("events", j::arr_s(&events)),
        ("fuel", j::arr_xy(&fuel)),
        (
            "helio",
            j::obj(&[
                ("tDays", j::arr_f(&ts)),
                ("craft", j::arr_xy(&pts)),
                ("earth", j::arr_xy(&earth)),
                ("mars", j::arr_xy(&mars)),
                ("moon", j::arr_xy(&moon)),
            ]),
        ),
        ("departure", dep),
        ("arrival", arr),
        ("nbody", nbody_field),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nbody_deviation_is_bounded_patched_conic_error() {
        let b = crate::patched_conic::budget(&MissionParams::default());
        let (dev, _, pts) = nbody_check(&b);
        // patched-conic arrival error vs full force model: real, but bounded
        assert!(dev > 1_000.0, "suspiciously small deviation {} km", dev);
        assert!(dev < 5.0e6, "deviation too large {} km", dev);
        assert!(pts.len() > 100);
    }

    #[test]
    fn trajectory_json_builds_for_all_systems() {
        for id in 0..9 {
            let s = build_trajectory(id, &MissionParams::default(), false);
            assert!(s.contains("\"helio\""), "system {}", id);
            assert!(s.len() > 5_000, "system {} payload too small", id);
        }
    }
}
