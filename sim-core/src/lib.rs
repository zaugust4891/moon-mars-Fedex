//! sim-core: Moon-to-Mars cargo mission physics engine.
//!
//! Layering (no module reaches "up"):
//!   constants -> kepler -> patched_conic -> propulsion -> analyzer
//!                  |            |                            |
//!                nbody  <-  trajectory  ----------------------
//!
//! Compiles natively for tests and the `report` binary, and to
//! wasm32-unknown-unknown for the web frontend (src/ffi.rs, no wasm-bindgen).

pub mod analyzer;
pub mod constants;
pub mod jsonw;
pub mod kepler;
pub mod nbody;
pub mod patched_conic;
pub mod propulsion;
pub mod trajectory;

#[cfg(target_arch = "wasm32")]
pub mod ffi;
