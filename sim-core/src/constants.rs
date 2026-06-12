//! Physical constants. Units: km, kg, s unless noted.
//! Gravitational parameters (mu = G*M) are used directly because they are known
//! to far higher precision than G and M separately (JPL DE ephemerides).

/// Standard gravity, m/s^2 (exact, by definition). Used in Isp <-> exhaust velocity.
pub const G0: f64 = 9.80665;

/// Gravitational parameters, km^3/s^2
pub const MU_SUN: f64 = 1.327_124_400_18e11;
pub const MU_EARTH: f64 = 398_600.4418;
pub const MU_MOON: f64 = 4_902.800_066;
pub const MU_MARS: f64 = 42_828.375_214;

/// Mean body radii, km
pub const R_MOON: f64 = 1_737.4;
pub const R_MARS: f64 = 3_389.5;
pub const R_EARTH: f64 = 6_371.0;

/// Heliocentric mean orbital radii (semi-major axes), km.
/// Coplanar circular orbit assumption — see docs/02 for error discussion.
pub const A_EARTH: f64 = 1.495_978_707e8;
pub const A_MARS: f64 = 2.279_393_66e8;

/// Geocentric lunar mean orbital radius, km
pub const A_MOON: f64 = 384_400.0;

/// Sidereal periods, s
pub const T_EARTH: f64 = 365.256_36 * 86_400.0;
pub const T_MARS: f64 = 686.980 * 86_400.0;
pub const T_MOON: f64 = 27.321_66 * 86_400.0;

/// Mars sidereal day ("sol") and the 1-sol capture-orbit period, s
pub const MARS_SOL: f64 = 88_775.244;

/// Lunar surface gravity, m/s^2
pub const G_MOON: f64 = 1.625;

/// Sphere-of-influence radii (Laplace), km — patch points for conic stitching
pub const SOI_MOON: f64 = 66_100.0;
pub const SOI_EARTH: f64 = 924_600.0;
pub const SOI_MARS: f64 = 577_000.0;

pub const DAY: f64 = 86_400.0;

/// Mission payload: 100,000 lb of solid cargo, kg
pub const CARGO_DEFAULT_KG: f64 = 45_359.237;
