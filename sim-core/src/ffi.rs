//! WebAssembly FFI without wasm-bindgen: a deliberately tiny C ABI.
//!
//! Convention: every exported function returns a pointer into linear memory.
//! The first 4 bytes are the little-endian u32 length of the UTF-8 JSON that
//! follows. JavaScript reads the length, decodes the string, then calls
//! `buf_free(ptr)` to return the allocation. Inputs are plain scalars, so no
//! input marshalling is needed at all.
//!
//! Rationale (docs/05): zero build-time dependencies, no version coupling
//! between a bindgen CLI and the crate, and a deterministic ~100 KB module.

use crate::analyzer;
use crate::patched_conic::{self, MissionParams, TargetOrbit};
use crate::trajectory;

fn pack(s: String) -> *mut u8 {
    let bytes = s.into_bytes();
    let len = bytes.len() as u32;
    let mut buf = Vec::with_capacity(4 + bytes.len());
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(&bytes);
    debug_assert_eq!(buf.len(), buf.capacity());
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` must come from a `pack` return value, freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn buf_free(ptr: *mut u8) {
    let mut len_bytes = [0u8; 4];
    core::ptr::copy_nonoverlapping(ptr, len_bytes.as_mut_ptr(), 4);
    let len = u32::from_le_bytes(len_bytes) as usize;
    drop(Vec::from_raw_parts(ptr, len + 4, len + 4));
}

fn params(cargo_kg: f64, target: u32, margin_frac: f64) -> MissionParams {
    let mut p = MissionParams::default();
    if cargo_kg.is_finite() && cargo_kg > 0.0 {
        p.cargo_kg = cargo_kg;
    }
    p.target = TargetOrbit::from_id(target);
    if margin_frac.is_finite() && (0.0..=0.5).contains(&margin_frac) {
        p.margin_frac = margin_frac;
    }
    p
}

#[no_mangle]
pub extern "C" fn ffi_analyze(sys_id: u32, cargo_kg: f64, target: u32, margin_frac: f64) -> *mut u8 {
    let p = params(cargo_kg, target, margin_frac);
    pack(analyzer::analyze(sys_id, &p).to_json())
}

#[no_mangle]
pub extern "C" fn ffi_compare(cargo_kg: f64, target: u32, margin_frac: f64) -> *mut u8 {
    let p = params(cargo_kg, target, margin_frac);
    let items: Vec<String> = analyzer::compare_all(&p).iter().map(|r| r.to_json()).collect();
    pack(crate::jsonw::arr_s(&items))
}

#[no_mangle]
pub extern "C" fn ffi_trajectory(
    sys_id: u32,
    cargo_kg: f64,
    target: u32,
    margin_frac: f64,
    include_nbody: u32,
) -> *mut u8 {
    let p = params(cargo_kg, target, margin_frac);
    pack(trajectory::build_trajectory(sys_id, &p, include_nbody != 0))
}

#[no_mangle]
pub extern "C" fn ffi_monte_carlo(
    sys_id: u32,
    cargo_kg: f64,
    target: u32,
    margin_frac: f64,
    n: u32,
    seed: u32,
) -> *mut u8 {
    let p = params(cargo_kg, target, margin_frac);
    pack(analyzer::monte_carlo(sys_id, &p, n, seed as u64).to_json())
}

#[no_mangle]
pub extern "C" fn ffi_sensitivity(sys_id: u32, cargo_kg: f64, target: u32, margin_frac: f64) -> *mut u8 {
    let p = params(cargo_kg, target, margin_frac);
    pack(analyzer::sensitivity_json(&analyzer::sensitivity(sys_id, &p)))
}

#[no_mangle]
pub extern "C" fn ffi_window(current_phase_deg: f64) -> *mut u8 {
    let b = patched_conic::budget(&MissionParams::default());
    let days = patched_conic::days_to_window(current_phase_deg, b.lead_angle_deg);
    pack(crate::jsonw::obj(&[
        ("requiredLeadDeg", crate::jsonw::num(b.lead_angle_deg)),
        ("daysToWindow", crate::jsonw::num(days)),
        ("synodicDays", crate::jsonw::num(b.synodic_days)),
    ]))
}
