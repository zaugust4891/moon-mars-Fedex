//! Two-body orbital mechanics: vis-viva, Hohmann/bi-elliptic transfers,
//! and Kepler-equation propagation for elliptic and hyperbolic conics.
//!
//! Vis-viva:            v^2 = mu (2/r - 1/a)
//! Kepler (elliptic):   M = E - e sin E,         r = a (1 - e cos E)
//! Kepler (hyperbolic): M = e sinh H - H,        r = a (1 - e cosh H), a < 0
//! true anomaly:        tan(nu/2) = sqrt((1+e)/(1-e)) tan(E/2)   (elliptic)
//!                      tan(nu/2) = sqrt((e+1)/(e-1)) tanh(H/2)  (hyperbolic)

pub fn vis_viva(mu: f64, r: f64, a: f64) -> f64 {
    (mu * (2.0 / r - 1.0 / a)).max(0.0).sqrt()
}

pub fn v_circular(mu: f64, r: f64) -> f64 {
    (mu / r).sqrt()
}

pub fn v_escape(mu: f64, r: f64) -> f64 {
    (2.0 * mu / r).sqrt()
}

pub fn period(mu: f64, a: f64) -> f64 {
    2.0 * core::f64::consts::PI * (a.powi(3) / mu).sqrt()
}

/// Semi-major axis of an orbit with a given period
pub fn a_from_period(mu: f64, t: f64) -> f64 {
    let n = 2.0 * core::f64::consts::PI / t;
    (mu / (n * n)).cbrt()
}

#[derive(Clone, Copy, Debug)]
pub struct Hohmann {
    pub a_t: f64,      // transfer semi-major axis, km
    pub e_t: f64,      // transfer eccentricity
    pub v_dep: f64,    // heliocentric speed at departure (perihelion), km/s
    pub v_arr: f64,    // heliocentric speed at arrival (aphelion), km/s
    pub vinf_dep: f64, // hyperbolic excess relative to inner body, km/s
    pub vinf_arr: f64, // hyperbolic excess relative to outer body, km/s
    pub tof_s: f64,    // time of flight (half transfer ellipse), s
}

/// Hohmann transfer between coplanar circular orbits r1 < r2 about mu.
pub fn hohmann(mu: f64, r1: f64, r2: f64) -> Hohmann {
    let a_t = 0.5 * (r1 + r2);
    let v1 = v_circular(mu, r1);
    let v2 = v_circular(mu, r2);
    let v_dep = vis_viva(mu, r1, a_t);
    let v_arr = vis_viva(mu, r2, a_t);
    Hohmann {
        a_t,
        e_t: (r2 - r1) / (r2 + r1),
        v_dep,
        v_arr,
        vinf_dep: v_dep - v1,
        vinf_arr: v2 - v_arr,
        tof_s: core::f64::consts::PI * (a_t.powi(3) / mu).sqrt(),
    }
}

/// Total delta-v of a bi-elliptic transfer r1 -> rb -> r2 (for comparison studies).
pub fn bielliptic_dv(mu: f64, r1: f64, rb: f64, r2: f64) -> (f64, f64) {
    let a1 = 0.5 * (r1 + rb);
    let a2 = 0.5 * (rb + r2);
    let dv1 = vis_viva(mu, r1, a1) - v_circular(mu, r1);
    let dv2 = (vis_viva(mu, rb, a2) - vis_viva(mu, rb, a1)).abs();
    let dv3 = (v_circular(mu, r2) - vis_viva(mu, r2, a2)).abs();
    let tof = core::f64::consts::PI * ((a1.powi(3) / mu).sqrt() + (a2.powi(3) / mu).sqrt());
    (dv1 + dv2 + dv3, tof)
}

/// Delta-v of a simple plane change of `angle` rad at speed v: dv = 2 v sin(angle/2)
pub fn plane_change_dv(v: f64, angle_rad: f64) -> f64 {
    2.0 * v * (0.5 * angle_rad).sin()
}

/// Solve elliptic Kepler equation M = E - e sin E for E (Newton, tol 1e-13).
pub fn solve_kepler_e(m: f64, e: f64) -> f64 {
    let m = m.rem_euclid(2.0 * core::f64::consts::PI);
    let mut ecc_an = if e < 0.8 { m } else { core::f64::consts::PI };
    for _ in 0..60 {
        let f = ecc_an - e * ecc_an.sin() - m;
        let fp = 1.0 - e * ecc_an.cos();
        let d = f / fp;
        ecc_an -= d;
        if d.abs() < 1e-13 {
            break;
        }
    }
    ecc_an
}

/// Solve hyperbolic Kepler equation M = e sinh H - H for H (Newton).
pub fn solve_kepler_h(m: f64, e: f64) -> f64 {
    // initial guess: asinh(M/e) is robust for all M
    let mut h = (m / e).asinh();
    for _ in 0..80 {
        let f = e * h.sinh() - h - m;
        let fp = e * h.cosh() - 1.0;
        let d = f / fp;
        h -= d;
        if d.abs() < 1e-13 {
            break;
        }
    }
    h
}

/// Position on an elliptic orbit at time t since periapsis.
/// Returns (r, nu): radius km, true anomaly rad.
pub fn elliptic_at(mu: f64, a: f64, e: f64, t: f64) -> (f64, f64) {
    let n = (mu / a.powi(3)).sqrt();
    let ecc_an = solve_kepler_e(n * t, e);
    let r = a * (1.0 - e * ecc_an.cos());
    let nu = 2.0 * (((1.0 + e) / (1.0 - e)).sqrt() * (0.5 * ecc_an).tan()).atan();
    // keep nu continuous with E's branch
    let nu = if ecc_an.rem_euclid(2.0 * core::f64::consts::PI) > core::f64::consts::PI {
        2.0 * core::f64::consts::PI + nu
    } else {
        nu.rem_euclid(2.0 * core::f64::consts::PI)
    };
    (r, nu)
}

/// Position on a hyperbolic orbit (a < 0, e > 1) at time t since periapsis
/// (t may be negative for the inbound leg). Returns (r, nu).
pub fn hyperbolic_at(mu: f64, a: f64, e: f64, t: f64) -> (f64, f64) {
    let n = (mu / (-a).powi(3)).sqrt();
    let h = solve_kepler_h(n * t, e);
    let r = a * (1.0 - e * h.cosh());
    let nu = 2.0 * (((e + 1.0) / (e - 1.0)).sqrt() * (0.5 * h).tanh()).atan();
    (r, nu)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::*;

    #[test]
    fn kepler_elliptic_roundtrip() {
        for &e in &[0.0_f64, 0.2, 0.7, 0.95] {
            for k in 0..12 {
                let ecc = k as f64 * 0.5;
                let m = ecc - e * ecc.sin();
                let got = solve_kepler_e(m, e);
                let m2 = got - e * got.sin();
                assert!((m2 - m.rem_euclid(2.0 * core::f64::consts::PI)).abs() < 1e-10);
            }
        }
    }

    #[test]
    fn hohmann_earth_mars_benchmarks() {
        let h = hohmann(MU_SUN, A_EARTH, A_MARS);
        // canonical values: ~258.9 d TOF, v_inf 2.94 / 2.65 km/s
        assert!((h.tof_s / DAY - 258.9).abs() < 1.0, "tof {}", h.tof_s / DAY);
        assert!((h.vinf_dep - 2.944).abs() < 0.02, "vinf_dep {}", h.vinf_dep);
        assert!((h.vinf_arr - 2.649).abs() < 0.02, "vinf_arr {}", h.vinf_arr);
    }

    #[test]
    fn escape_velocities() {
        assert!((v_escape(MU_MOON, R_MOON) - 2.376).abs() < 0.005);
        assert!((v_escape(MU_EARTH, R_EARTH + 0.0) - 11.186).abs() < 0.02);
        assert!((v_circular(MU_MOON, R_MOON + 100.0) - 1.633).abs() < 0.005);
    }
}
