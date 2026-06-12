//! Restricted N-body propagation: the spacecraft is massless; Sun, Earth,
//! Moon and Mars move on circular coplanar "rails" (their mutual dynamics are
//! ~Keplerian over one transit and the spacecraft cannot perturb them — this
//! is the standard restricted-problem justification).
//!
//! Integrators:
//!   - classic RK4 (fixed step), local error O(h^5)
//!   - Runge-Kutta-Fehlberg 4(5) with adaptive step from the embedded
//!     error estimate: h_new = 0.9 h (tol/err)^(1/5)
//!
//! State y = [x, y, vx, vy] in km, km/s, heliocentric ecliptic-plane frame.

use crate::constants::*;

#[derive(Clone, Copy, Debug)]
pub struct Rails {
    pub th_earth0: f64, // rad at t=0
    pub th_mars0: f64,
    pub th_moon0: f64, // geocentric phase
}

impl Rails {
    pub fn for_departure(lead_angle_deg: f64) -> Rails {
        Rails {
            th_earth0: 0.0,
            th_mars0: lead_angle_deg.to_radians(),
            th_moon0: 0.0,
        }
    }
    pub fn earth(&self, t: f64) -> (f64, f64) {
        let th = self.th_earth0 + 2.0 * core::f64::consts::PI * t / T_EARTH;
        (A_EARTH * th.cos(), A_EARTH * th.sin())
    }
    pub fn mars(&self, t: f64) -> (f64, f64) {
        let th = self.th_mars0 + 2.0 * core::f64::consts::PI * t / T_MARS;
        (A_MARS * th.cos(), A_MARS * th.sin())
    }
    pub fn moon(&self, t: f64) -> (f64, f64) {
        let (ex, ey) = self.earth(t);
        let th = self.th_moon0 + 2.0 * core::f64::consts::PI * t / T_MOON;
        (ex + A_MOON * th.cos(), ey + A_MOON * th.sin())
    }
}

fn point_accel(px: f64, py: f64, bx: f64, by: f64, mu: f64) -> (f64, f64) {
    let dx = px - bx;
    let dy = py - by;
    let r2 = dx * dx + dy * dy;
    let r = r2.sqrt();
    let f = -mu / (r2 * r);
    (f * dx, f * dy)
}

/// Full force model: Sun + Earth + Moon + Mars
pub fn accel(rails: &Rails, t: f64, x: f64, y: f64) -> (f64, f64) {
    let (mut ax, mut ay) = point_accel(x, y, 0.0, 0.0, MU_SUN);
    for (pos, mu) in [
        (rails.earth(t), MU_EARTH),
        (rails.moon(t), MU_MOON),
        (rails.mars(t), MU_MARS),
    ] {
        let (dax, day) = point_accel(x, y, pos.0, pos.1, mu);
        ax += dax;
        ay += day;
    }
    (ax, ay)
}

pub type State = [f64; 4];

fn deriv<F: Fn(f64, f64, f64) -> (f64, f64)>(f: &F, t: f64, y: &State) -> State {
    let (ax, ay) = f(t, y[0], y[1]);
    [y[2], y[3], ax, ay]
}

fn axpy(y: &State, h: f64, k: &State) -> State {
    [y[0] + h * k[0], y[1] + h * k[1], y[2] + h * k[2], y[3] + h * k[3]]
}

/// One classic RK4 step
pub fn rk4_step<F: Fn(f64, f64, f64) -> (f64, f64)>(f: &F, t: f64, y: &State, h: f64) -> State {
    let k1 = deriv(f, t, y);
    let k2 = deriv(f, t + 0.5 * h, &axpy(y, 0.5 * h, &k1));
    let k3 = deriv(f, t + 0.5 * h, &axpy(y, 0.5 * h, &k2));
    let k4 = deriv(f, t + h, &axpy(y, h, &k3));
    [
        y[0] + h / 6.0 * (k1[0] + 2.0 * k2[0] + 2.0 * k3[0] + k4[0]),
        y[1] + h / 6.0 * (k1[1] + 2.0 * k2[1] + 2.0 * k3[1] + k4[1]),
        y[2] + h / 6.0 * (k1[2] + 2.0 * k2[2] + 2.0 * k3[2] + k4[2]),
        y[3] + h / 6.0 * (k1[3] + 2.0 * k2[3] + 2.0 * k3[3] + k4[3]),
    ]
}

/// RKF45 step: returns (4th-order solution, 5th-order solution) for error control
fn rkf45_step<F: Fn(f64, f64, f64) -> (f64, f64)>(
    f: &F,
    t: f64,
    y: &State,
    h: f64,
) -> (State, State) {
    let k1 = deriv(f, t, y);
    let y2 = axpy(y, h * 0.25, &k1);
    let k2 = deriv(f, t + 0.25 * h, &y2);
    let mut y3 = *y;
    for i in 0..4 {
        y3[i] += h * (3.0 / 32.0 * k1[i] + 9.0 / 32.0 * k2[i]);
    }
    let k3 = deriv(f, t + 3.0 / 8.0 * h, &y3);
    let mut y4 = *y;
    for i in 0..4 {
        y4[i] += h * (1932.0 / 2197.0 * k1[i] - 7200.0 / 2197.0 * k2[i] + 7296.0 / 2197.0 * k3[i]);
    }
    let k4 = deriv(f, t + 12.0 / 13.0 * h, &y4);
    let mut y5 = *y;
    for i in 0..4 {
        y5[i] += h
            * (439.0 / 216.0 * k1[i] - 8.0 * k2[i] + 3680.0 / 513.0 * k3[i]
                - 845.0 / 4104.0 * k4[i]);
    }
    let k5 = deriv(f, t + h, &y5);
    let mut y6 = *y;
    for i in 0..4 {
        y6[i] += h
            * (-8.0 / 27.0 * k1[i] + 2.0 * k2[i] - 3544.0 / 2565.0 * k3[i]
                + 1859.0 / 4104.0 * k4[i]
                - 11.0 / 40.0 * k5[i]);
    }
    let k6 = deriv(f, t + 0.5 * h, &y6);

    let mut sol4 = *y;
    let mut sol5 = *y;
    for i in 0..4 {
        sol4[i] += h
            * (25.0 / 216.0 * k1[i] + 1408.0 / 2565.0 * k3[i] + 2197.0 / 4104.0 * k4[i]
                - 0.2 * k5[i]);
        sol5[i] += h
            * (16.0 / 135.0 * k1[i] + 6656.0 / 12825.0 * k3[i] + 28561.0 / 56430.0 * k4[i]
                - 9.0 / 50.0 * k5[i]
                + 2.0 / 55.0 * k6[i]);
    }
    (sol4, sol5)
}

/// Adaptive propagation from t0 to t1. `tol` is the per-step position error
/// tolerance in km. Returns sampled (t, state) pairs (~n_samples evenly-ish).
pub fn propagate_adaptive<F: Fn(f64, f64, f64) -> (f64, f64)>(
    f: &F,
    t0: f64,
    y0: State,
    t1: f64,
    tol: f64,
    n_samples: usize,
) -> Vec<(f64, State)> {
    let mut t = t0;
    let mut y = y0;
    let mut h = (t1 - t0) / 1e4;
    let sample_dt = (t1 - t0) / n_samples as f64;
    let mut next_sample = t0;
    let mut out = Vec::with_capacity(n_samples + 2);
    let mut steps = 0u64;
    while t < t1 && steps < 2_000_000 {
        steps += 1;
        if t + h > t1 {
            h = t1 - t;
        }
        let (s4, s5) = rkf45_step(f, t, &y, h);
        let err = ((s5[0] - s4[0]).powi(2) + (s5[1] - s4[1]).powi(2)).sqrt();
        if err > tol && h > 1.0 {
            h *= 0.9 * (tol / err.max(1e-30)).powf(0.2);
            continue;
        }
        if t >= next_sample {
            out.push((t, y));
            next_sample += sample_dt;
        }
        t += h;
        y = s5; // local extrapolation: advance with the 5th-order solution
        // grow per the error estimate, but never past the sampling interval
        if err > 1e-30 {
            h = (h * 0.9 * (tol / err).powf(0.2)).min(sample_dt);
        } else {
            h = (h * 2.0).min(sample_dt);
        }
    }
    out.push((t, y));
    out
}

/// Specific orbital energy about a single body (two-body test helper)
pub fn two_body_energy(mu: f64, y: &State) -> f64 {
    let r = (y[0] * y[0] + y[1] * y[1]).sqrt();
    let v2 = y[2] * y[2] + y[3] * y[3];
    0.5 * v2 - mu / r
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kepler;

    #[test]
    fn rk4_circular_orbit_holds_radius() {
        // Earth orbit about the Sun, fixed-step RK4, 1 year
        let f = |_t: f64, x: f64, y: f64| point_accel(x, y, 0.0, 0.0, MU_SUN);
        let v = kepler::v_circular(MU_SUN, A_EARTH);
        let mut y: State = [A_EARTH, 0.0, 0.0, v];
        let h = 3600.0;
        let n = (T_EARTH / h) as usize;
        for i in 0..n {
            y = rk4_step(&f, i as f64 * h, &y, h);
        }
        let r = (y[0] * y[0] + y[1] * y[1]).sqrt();
        assert!((r - A_EARTH).abs() / A_EARTH < 1e-6, "radius drift {}", (r - A_EARTH).abs());
    }

    #[test]
    fn rkf45_conserves_two_body_energy() {
        let f = |_t: f64, x: f64, y: f64| point_accel(x, y, 0.0, 0.0, MU_SUN);
        let v = kepler::v_circular(MU_SUN, A_EARTH) * 1.1; // eccentric orbit
        let y0: State = [A_EARTH, 0.0, 0.0, v];
        let e0 = two_body_energy(MU_SUN, &y0);
        let path = propagate_adaptive(&f, 0.0, y0, T_EARTH, 1.0, 100);
        let ef = two_body_energy(MU_SUN, &path.last().unwrap().1);
        assert!(((ef - e0) / e0).abs() < 1e-7, "energy drift {}", ((ef - e0) / e0).abs());
    }
}
