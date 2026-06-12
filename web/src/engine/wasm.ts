// Bridge to the Rust/WASM physics core (sim-core).
//
// ABI: every exported sim-core function returns a pointer into WASM linear
// memory; bytes [0..4) are a little-endian u32 length, followed by that many
// bytes of UTF-8 JSON. We decode, free via buf_free, and JSON.parse.
// No wasm-bindgen, no glue codegen — see docs/05 for the rationale.

import type {
  MissionResult,
  MonteCarloResult,
  SensitivityRow,
  Trajectory,
} from './types';

interface SimExports {
  memory: WebAssembly.Memory;
  buf_free(ptr: number): void;
  ffi_analyze(sysId: number, cargoKg: number, target: number, margin: number): number;
  ffi_compare(cargoKg: number, target: number, margin: number): number;
  ffi_trajectory(
    sysId: number,
    cargoKg: number,
    target: number,
    margin: number,
    includeNbody: number,
  ): number;
  ffi_monte_carlo(
    sysId: number,
    cargoKg: number,
    target: number,
    margin: number,
    n: number,
    seed: number,
  ): number;
  ffi_sensitivity(sysId: number, cargoKg: number, target: number, margin: number): number;
  ffi_window(phaseDeg: number): number;
}

let ex: SimExports | null = null;

export async function initEngine(): Promise<void> {
  if (ex) return;
  const url = `${import.meta.env.BASE_URL}sim_core.wasm`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`failed to fetch ${url}: ${resp.status}`);
  const { instance } = await WebAssembly.instantiate(await resp.arrayBuffer(), {});
  ex = instance.exports as unknown as SimExports;
}

function readJson<T>(ptr: number): T {
  if (!ex) throw new Error('engine not initialized');
  // memory.buffer must be re-read every call: it detaches on memory.grow
  const view = new DataView(ex.memory.buffer);
  const len = view.getUint32(ptr, true);
  const bytes = new Uint8Array(ex.memory.buffer, ptr + 4, len);
  const json = new TextDecoder().decode(bytes);
  ex.buf_free(ptr);
  return JSON.parse(json) as T;
}

function need(): SimExports {
  if (!ex) throw new Error('engine not initialized — call initEngine() first');
  return ex;
}

export const engine = {
  analyze(sysId: number, cargoKg: number, target: number, margin: number): MissionResult {
    return readJson(need().ffi_analyze(sysId, cargoKg, target, margin));
  },
  compare(cargoKg: number, target: number, margin: number): MissionResult[] {
    return readJson(need().ffi_compare(cargoKg, target, margin));
  },
  trajectory(
    sysId: number,
    cargoKg: number,
    target: number,
    margin: number,
    includeNbody: boolean,
  ): Trajectory {
    return readJson(
      need().ffi_trajectory(sysId, cargoKg, target, margin, includeNbody ? 1 : 0),
    );
  },
  monteCarlo(
    sysId: number,
    cargoKg: number,
    target: number,
    margin: number,
    n: number,
    seed: number,
  ): MonteCarloResult {
    return readJson(need().ffi_monte_carlo(sysId, cargoKg, target, margin, n, seed));
  },
  sensitivity(sysId: number, cargoKg: number, target: number, margin: number): SensitivityRow[] {
    return readJson(need().ffi_sensitivity(sysId, cargoKg, target, margin));
  },
  window(phaseDeg: number): { requiredLeadDeg: number; daysToWindow: number; synodicDays: number } {
    return readJson(need().ffi_window(phaseDeg));
  },
};
