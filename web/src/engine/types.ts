// Mirrors the JSON emitted by sim-core (Rust). See sim-core/src/analyzer.rs
// and trajectory.rs for the authoritative schema.

export interface Burn {
  name: string;
  kind: 'burn' | 'spiral' | 'kinetic' | 'jettison';
  tDays: number;
  dvKms: number;
  durationS: number;
  propKg: number;
  mBeforeKg: number;
  mAfterKg: number;
}

export interface Stage {
  name: string;
  propKg: number;
  dryKg: number;
  engines: number;
  thrustN: number;
}

export interface LauncherInfo {
  muzzleVKms: number;
  trackLengthM: number;
  peakAccelG: number;
  launchEnergyGj: number;
  launchDurationS: number;
  rechargePowerMw: number;
}

export interface CostInfo {
  devMusd: number;
  infraMusd: number;
  propMusd: number;
  opsMusd: number;
  perMissionMusd: number;
  usdPerKg: number;
  nAmort: number;
}

export interface BudgetInfo {
  ascent: number;
  tmi: number;
  midcourse: number;
  moi: number;
  rendezvous: number;
  total: number;
  totalMargined: number;
  vinfDep: number;
  vinfArr: number;
  tofDays: number;
  leadAngleDeg: number;
  synodicDays: number;
}

export interface MissionResult {
  id: number;
  key: string;
  name: string;
  ispS: number;
  trl: number;
  speculative: boolean;
  notes: string;
  feasible: boolean;
  reasons: string[];
  assumptions: string[];
  risks: string[];
  totalDvKms: number;
  kineticDvKms: number;
  wetMassKg: number;
  propMassKg: number;
  dryMassKg: number;
  cargoKg: number;
  transitDays: number;
  peakAccelG: number;
  powerKw: number;
  energyGj: number;
  stages: Stage[];
  burns: Burn[];
  launcher: LauncherInfo | null;
  cost: CostInfo;
  budget: BudgetInfo;
}

export type Pt = [number, number];

export interface FrameSeries {
  tDays: number[];
  craft: Pt[];
  earth: Pt[];
  mars: Pt[];
  moon: Pt[];
}

export interface LocalView {
  frame: string;
  tHours: number[];
  craft: Pt[];
  orbit?: Pt[];
  rBody: number;
  rOrbit?: number;
  rPeri?: number;
  hyperbolaE: number;
}

export interface NBodyCheck {
  deviationKm: number;
  tDays: number[];
  craft: Pt[];
}

export interface TrajectoryEvent {
  name: string;
  kind: string;
  tDays: number;
  dvKms: number;
  durationS: number;
}

export interface Trajectory {
  sysId: number;
  sysName: string;
  tofDays: number;
  transitDays: number;
  tEndDays: number;
  leadAngleDeg: number;
  synodicDays: number;
  aEarthKm: number;
  aMarsKm: number;
  aMoonKm: number;
  lowThrust: boolean;
  events: TrajectoryEvent[];
  fuel: Pt[]; // [tDays, fraction]
  helio: FrameSeries;
  departure: LocalView;
  arrival: LocalView;
  nbody: NBodyCheck | null;
}

export interface MonteCarloResult {
  n: number;
  feasibleFrac: number;
  wetMean: number;
  wetP5: number;
  wetP50: number;
  wetP95: number;
  propMean: number;
}

export interface SensitivityRow {
  param: string;
  lowLabel: string;
  highLabel: string;
  wetLow: number;
  wetHigh: number;
  costLow: number;
  costHigh: number;
}
