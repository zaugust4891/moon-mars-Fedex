// Display-only derivations for Ride mode. Honesty contract: every quantity
// here is interpolation or arithmetic over series the Rust core computed
// (Trajectory, MissionResult), plus physical display constants (body radii,
// c, solar constant) that affect no trajectory physics.

import type { MissionResult, Pt, Trajectory, TrajectoryEvent } from '../engine/types';

export const AU_KM = 1.495978707e8;
export const C_KM_S = 299_792.458;
export const SOLAR_CONST_WM2 = 1361;
export const R_SUN_KM = 695_700;
export const R_EARTH_KM = 6_371;
export const R_MOON_KM = 1_737.4;
export const R_MARS_KM = 3_389.5;

/** Binary-search linear interpolation (same scheme as MissionScene). */
export function interp(ts: number[], pts: Pt[], t: number): Pt {
  if (ts.length === 0) return [0, 0];
  if (t <= ts[0]) return pts[0];
  if (t >= ts[ts.length - 1]) return pts[pts.length - 1];
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
  return [
    pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f,
    pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f,
  ];
}

/** Central-difference velocity of a sampled series, km/s in the series frame. */
export function velocityVecKms(ts: number[], pts: Pt[], t: number): Pt {
  if (ts.length < 2) return [0, 0];
  const dt = 0.25; // days; helio grid is ~0.55 d, so this reads the local segment slope
  const t0 = Math.max(t - dt, ts[0]);
  const t1 = Math.min(t + dt, ts[ts.length - 1]);
  const p0 = interp(ts, pts, t0);
  const p1 = interp(ts, pts, t1);
  const dts = (t1 - t0) * 86400 || 1;
  return [(p1[0] - p0[0]) / dts, (p1[1] - p0[1]) / dts];
}

/** Cumulative path length (km) at each sample — precompute once per trajectory. */
export function buildOdometer(ts: number[], pts: Pt[]): number[] {
  const out = new Array<number>(ts.length).fill(0);
  for (let i = 1; i < pts.length; i++) {
    out[i] = out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return out;
}

export function odoAt(ts: number[], prefix: number[], t: number): number {
  if (ts.length === 0) return 0;
  if (t <= ts[0]) return 0;
  if (t >= ts[ts.length - 1]) return prefix[prefix.length - 1];
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
  return prefix[lo] + (prefix[hi] - prefix[lo]) * f;
}

/** Stack mass from the burn/jettison schedule (linear within a burn). */
export function massAtKg(mr: MissionResult, t: number): number {
  let m = mr.wetMassKg;
  for (const b of mr.burns) {
    const dur = Math.max(b.durationS / 86400, 0);
    if (t >= b.tDays + dur) {
      m = b.mAfterKg;
    } else if (t >= b.tDays) {
      const f = dur > 0 ? (t - b.tDays) / dur : 1;
      return b.mBeforeKg + (b.mAfterKg - b.mBeforeKg) * f;
    } else {
      break;
    }
  }
  return m;
}

export function fuelFracAt(fuel: Pt[], t: number): number {
  let f = 1;
  for (const [ft, fv] of fuel) {
    if (ft <= t) f = fv;
    else break;
  }
  return f;
}

/** Active propulsive event under the same window rule the classic views use. */
export function activeEventAt(events: TrajectoryEvent[], t: number): TrajectoryEvent | null {
  return (
    events.find(
      (ev) =>
        ev.kind !== 'jettison' &&
        t >= ev.tDays &&
        t <= ev.tDays + Math.max(ev.durationS / 86400, 0.4),
    ) ?? null
  );
}

/** Deceleration events: the stack flies engines-forward (retrograde thrust). */
export function isDecelEvent(ev: TrajectoryEvent): boolean {
  return /insertion|capture|rendezvous|trim/i.test(ev.name);
}

export interface RideStats {
  tDays: number;
  phase: string;
  activeEvent: TrajectoryEvent | null;
  speedKms: number;
  velKms: Pt;
  posKm: Pt;
  distEarthKm: number;
  distMoonKm: number;
  distMarsKm: number;
  rSunKm: number;
  progress: number; // 0..1 of transit
  odoKm: number;
  massKg: number;
  fuelFrac: number;
  lightDelayS: number;
  solarWm2: number;
  inOrbit: boolean;
  orbitPeriAltKm: number | null;
}

export function statsAt(
  traj: Trajectory,
  mr: MissionResult,
  odoPrefix: number[],
  tDays: number,
): RideStats {
  const h = traj.helio;
  const cp = interp(h.tDays, h.craft, tDays);
  const ep = interp(h.tDays, h.earth, tDays);
  const mp = interp(h.tDays, h.mars, tDays);
  const lp = interp(h.tDays, h.moon, tDays);
  const vel = velocityVecKms(h.tDays, h.craft, tDays);
  const distEarthKm = Math.hypot(cp[0] - ep[0], cp[1] - ep[1]);
  const distMarsKm = Math.hypot(cp[0] - mp[0], cp[1] - mp[1]);
  const distMoonKm = Math.hypot(cp[0] - lp[0], cp[1] - lp[1]);
  const rSunKm = Math.hypot(cp[0], cp[1]);
  const ev = activeEventAt(traj.events, tDays);
  // captured craft rides exactly with Mars in the series. Proximity alone
  // would also fire on the final hours of the inbound hyperbola, so
  // high-thrust missions additionally gate on the MOI epoch.
  const inOrbit =
    distMarsKm < 5e4 &&
    (traj.lowThrust ? tDays > traj.transitDays * 0.5 : tDays >= traj.tofDays);

  let phase: string;
  if (ev) phase = ev.name;
  else if (tDays < 0.5) phase = 'Lunar departure';
  else if (inOrbit) phase = 'Mars orbit operations';
  else phase = 'Trans-Mars cruise';

  return {
    tDays,
    phase,
    activeEvent: ev,
    speedKms: Math.hypot(vel[0], vel[1]),
    velKms: vel,
    posKm: cp,
    distEarthKm,
    distMoonKm,
    distMarsKm,
    rSunKm,
    progress: Math.min(Math.max(tDays / (traj.transitDays || 1), 0), 1),
    odoKm: odoAt(h.tDays, odoPrefix, tDays),
    massKg: massAtKg(mr, tDays),
    fuelFrac: fuelFracAt(traj.fuel, tDays),
    lightDelayS: distEarthKm / C_KM_S,
    solarWm2: SOLAR_CONST_WM2 * (AU_KM / Math.max(rSunKm, 1)) ** 2,
    inOrbit,
    orbitPeriAltKm: traj.arrival.rPeri != null ? traj.arrival.rPeri - traj.arrival.rBody : null,
  };
}

// ---- formatting helpers shared by HUD + markers ----

export function fmtDistKm(km: number): string {
  if (km >= 1e7) return `${(km / 1e6).toFixed(1)}M km`;
  if (km >= 1e6) return `${(km / 1e6).toFixed(2)}M km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

export function fmtClock(tDays: number): string {
  const d = Math.floor(tDays);
  const hf = (tDays - d) * 24;
  const hh = Math.floor(hf);
  const mm = Math.floor((hf - hh) * 60);
  return `${String(d).padStart(3, '0')}:${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function fmtDelay(s: number): string {
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

// ---- HUD 2.0 derivations (all from engine outputs + the core's constants) ----

/** Mirrors sim-core constants.rs MU_SUN (km³/s²). */
export const MU_SUN = 1.32712440018e11;

/** Δv still ahead on the burn schedule at mission time t (km/s). */
export function dvRemainingKms(mr: MissionResult, t: number): number {
  let dv = 0;
  for (const b of mr.burns) {
    if (b.dvKms <= 0) continue;
    const dur = Math.max(b.durationS / 86400, 1e-9);
    if (t <= b.tDays) dv += b.dvKms;
    else if (t < b.tDays + dur) dv += b.dvKms * (1 - (t - b.tDays) / dur);
  }
  return dv;
}

/** |v_craft − v_mars| from finite differences of both series (km/s). */
export function relVelMarsKms(traj: Trajectory, t: number): number {
  const vc = velocityVecKms(traj.helio.tDays, traj.helio.craft, t);
  const vm = velocityVecKms(traj.helio.tDays, traj.helio.mars, t);
  return Math.hypot(vc[0] - vm[0], vc[1] - vm[1]);
}

/** Osculating heliocentric elements from the live state vector. */
export function osculating(
  pos: Pt,
  velKms: Pt,
): { aAu: number; e: number; fpaDeg: number } {
  const r = Math.hypot(pos[0], pos[1]);
  const v2 = velKms[0] * velKms[0] + velKms[1] * velKms[1];
  const eps = v2 / 2 - MU_SUN / Math.max(r, 1);
  const a = -MU_SUN / (2 * eps);
  const h = pos[0] * velKms[1] - pos[1] * velKms[0];
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (MU_SUN * MU_SUN)));
  const v = Math.sqrt(v2) || 1;
  const fpa = Math.asin(Math.min(Math.max((pos[0] * velKms[0] + pos[1] * velKms[1]) / (r * v), -1), 1));
  return { aAu: a / AU_KM, e, fpaDeg: (fpa * 180) / Math.PI };
}

/** Fractional progress of the active burn (0..1), or null. */
export function burnProgress(ev: TrajectoryEvent | null, t: number): number | null {
  if (!ev || ev.durationS <= 0) return null;
  const dur = ev.durationS / 86400;
  return Math.min(Math.max((t - ev.tDays) / dur, 0), 1);
}
