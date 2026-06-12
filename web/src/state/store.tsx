// Application state: mission parameters, engine outputs, and the simulation
// clock. The Rust engine is synchronous and fast (analysis ~µs, trajectory
// with N-body check ~tens of ms), so recomputation runs eagerly on parameter
// change inside an effect.

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import { engine, initEngine } from '../engine/wasm';
import type {
  MissionResult,
  MonteCarloResult,
  SensitivityRow,
  Trajectory,
} from '../engine/types';
import type { ViewMode } from '../viz/Scene';
import type { CamMode } from '../viz/ride/cameras';

/** Classic Three.js views plus the game-style ride-along POV. */
export type AppView = ViewMode | 'ride';

export interface SimState {
  ready: boolean;
  error: string | null;
  // parameters
  cargoKg: number;
  target: number; // 0 = 500 km circular LMO, 1 = 1-sol ellipse
  margin: number;
  sysId: number;
  includeNbody: boolean;
  // outputs
  results: MissionResult[];
  selected: MissionResult | null;
  traj: Trajectory | null;
  mc: MonteCarloResult | null;
  sens: SensitivityRow[];
  // clock
  playing: boolean;
  direction: 1 | -1;
  speed: number; // mission days per wall-clock second
  tDays: number;
  // ui
  view: AppView;
  mode: 'mission' | 'compare';
  showVectors: boolean;
  showWell: boolean;
  // ride mode presentation (never affects sim math — see paceCap)
  rideCam: CamMode;
  cinematic: boolean;
}

const initial: SimState = {
  ready: false,
  error: null,
  cargoKg: 45359.237,
  target: 0,
  margin: 0.05,
  sysId: 0,
  includeNbody: true,
  results: [],
  selected: null,
  traj: null,
  mc: null,
  sens: [],
  playing: false,
  direction: 1,
  speed: 5,
  tDays: 0,
  view: 'helio',
  mode: 'mission',
  showVectors: true,
  showWell: false,
  rideCam: 'chase',
  cinematic: true,
};

export type Action =
  | { type: 'READY' }
  | { type: 'ERROR'; message: string }
  | { type: 'PARAM'; patch: Partial<Pick<SimState, 'cargoKg' | 'target' | 'margin' | 'sysId' | 'includeNbody'>> }
  | { type: 'OUTPUTS'; results: MissionResult[]; selected: MissionResult; traj: Trajectory; mc: MonteCarloResult; sens: SensitivityRow[] }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'REWIND' }
  | { type: 'STEP'; days: number }
  | { type: 'TICK'; dtSec: number }
  | { type: 'SET_TIME'; tDays: number }
  | { type: 'SPEED'; speed: number }
  | { type: 'DIRECTION'; direction: 1 | -1 }
  | { type: 'VIEW'; view: AppView }
  | { type: 'MODE'; mode: 'mission' | 'compare' }
  | { type: 'TOGGLE'; key: 'showVectors' | 'showWell' | 'cinematic' }
  | { type: 'RIDECAM'; cam: CamMode }
  | { type: 'RESET' };

/**
 * Cinematic pacing: an upper bound on PLAYBACK rate (mission days advanced
 * per wall second) around launch, Mars orbit insertion and rendezvous, so
 * second-scale events are watchable. This is presentation only — it throttles
 * the same user-facing time-warp the speed buttons control. The simulation
 * remains an exact function of tDays; no physics or timing math is altered.
 */
function paceCap(s: SimState): number {
  if (!s.cinematic || s.view !== 'ride' || !s.traj) return Infinity;
  const t = s.tDays;
  const tr = s.traj;
  const kinetic = s.selected?.launcher != null && !tr.lowThrust;
  if (t < 0.0008) return kinetic ? 0.00006 : 0.0012; // rail shot / ignition
  if (t < 0.014) return 0.0018; // ascent
  if (t < 0.05) return 0.012; // climb-out
  if (!tr.lowThrust) {
    if (Math.abs(t - tr.tofDays) < 0.3) return 0.035; // MOI window
    const rdv = tr.events.find((e) => /rendezvous/i.test(e.name));
    if (rdv && t > rdv.tDays - 0.25 && t < rdv.tDays + 0.45) return 0.05;
  }
  return Infinity;
}

function clampT(t: number, traj: Trajectory | null): number {
  const end = traj?.tEndDays ?? 270;
  return Math.min(Math.max(t, 0), end);
}

function reducer(s: SimState, a: Action): SimState {
  switch (a.type) {
    case 'READY':
      return { ...s, ready: true };
    case 'ERROR':
      return { ...s, error: a.message };
    case 'PARAM':
      return { ...s, ...a.patch };
    case 'OUTPUTS':
      return {
        ...s,
        results: a.results,
        selected: a.selected,
        traj: a.traj,
        mc: a.mc,
        sens: a.sens,
        tDays: clampT(s.tDays, a.traj),
      };
    case 'PLAY':
      return { ...s, playing: true };
    case 'PAUSE':
      return { ...s, playing: false };
    case 'REWIND':
      return { ...s, tDays: 0, playing: false, direction: 1 };
    case 'STEP':
      return { ...s, playing: false, tDays: clampT(s.tDays + a.days, s.traj) };
    case 'TICK': {
      const eff = Math.min(s.speed, paceCap(s));
      const t = clampT(s.tDays + s.direction * eff * a.dtSec, s.traj);
      // auto-pause only at the boundary we are travelling toward
      const end = s.traj?.tEndDays ?? 270;
      const atEnd = s.direction === 1 ? t >= end : t <= 0;
      return { ...s, tDays: t, playing: s.playing && !atEnd };
    }
    case 'SET_TIME':
      return { ...s, tDays: clampT(a.tDays, s.traj) };
    case 'SPEED':
      return { ...s, speed: a.speed };
    case 'DIRECTION':
      return { ...s, direction: a.direction };
    case 'VIEW':
      return { ...s, view: a.view };
    case 'MODE':
      return { ...s, mode: a.mode };
    case 'TOGGLE':
      return { ...s, [a.key]: !s[a.key] };
    case 'RIDECAM':
      return { ...s, rideCam: a.cam };
    case 'RESET':
      return { ...initial, ready: s.ready, results: s.results, selected: s.selected, traj: s.traj, mc: s.mc, sens: s.sens };
    default:
      return s;
  }
}

const Ctx = createContext<{ state: SimState; dispatch: Dispatch<Action> } | null>(null);

export function SimProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  // engine boot
  useEffect(() => {
    initEngine()
      .then(() => dispatch({ type: 'READY' }))
      .catch((e: unknown) => dispatch({ type: 'ERROR', message: String(e) }));
  }, []);

  // recompute outputs when parameters change
  const { ready, cargoKg, target, margin, sysId, includeNbody } = state;
  useEffect(() => {
    if (!ready) return;
    try {
      const results = engine.compare(cargoKg, target, margin);
      const selected = results.find((r) => r.id === sysId) ?? results[0];
      const traj = engine.trajectory(sysId, cargoKg, target, margin, includeNbody);
      const mc = engine.monteCarlo(sysId, cargoKg, target, margin, 500, 42);
      const sens = engine.sensitivity(sysId, cargoKg, target, margin);
      dispatch({ type: 'OUTPUTS', results, selected, traj, mc, sens });
    } catch (e) {
      dispatch({ type: 'ERROR', message: String(e) });
    }
  }, [ready, cargoKg, target, margin, sysId, includeNbody]);

  // simulation clock
  useEffect(() => {
    if (!state.playing) return;
    lastRef.current = performance.now();
    const loop = (now: number) => {
      // rAF's frame timestamp can predate the performance.now() captured when
      // the effect started — clamp dt to non-negative or the first tick can
      // rewind the clock to 0
      const dt = Math.min(Math.max((now - lastRef.current) / 1000, 0), 0.1);
      lastRef.current = now;
      dispatch({ type: 'TICK', dtSec: dt });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state.playing]);

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useSim() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSim outside SimProvider');
  return v;
}

export function fmtMass(kg: number): string {
  return kg >= 1e6 ? `${(kg / 1e6).toFixed(2)} kt` : `${(kg / 1000).toFixed(1)} t`;
}

export function fmtPower(kw: number): string {
  if (kw >= 1e6) return `${(kw / 1e6).toFixed(1)} GW (jet)`;
  if (kw >= 1e3) return `${(kw / 1e3).toFixed(1)} MW`;
  return `${kw.toFixed(0)} kW`;
}
