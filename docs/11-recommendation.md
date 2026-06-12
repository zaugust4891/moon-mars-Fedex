# Phase 11 — Recommended Propulsion Architecture

**For 45,359 kg (100,000 lb) of solid cargo, lunar surface → stable Mars
orbit with orbiter intercept.** Full numbers in docs/10 (engine-generated).

## Recommendation: two-phase program

### Near term (first ~20 missions): **Lunar LOX/LH₂ two-stage** ✅

- **$9,900/kg delivered — cheapest at low cadence**, TRL 9 engines (RL10
  class), 261-day transit, 0.5 g peak (gentle on everything).
- The decisive factor is not Isp — it is that **both propellants are
  manufacturable on the Moon** from polar ice. Every competitor imports
  something expensive: methane (no lunar carbon — methalox scores a
  catastrophic $67k/kg), xenon/krypton, or reactor hardware.
- Costs: 234 t wet per mission off the lunar surface, i.e. ~167 t of ISRU
  propellant per mission — sets the ISRU plant requirement (~0.5 t/day
  sustained between windows).
- Primary risk: 259-day LH₂ storage on the cruise stage → zero-boiloff
  cryocooler, flight-demonstrated technology class.

### Scale-up (cadence > ~150 missions): **Mass driver + capture infrastructure**

- The mass-driver architectures fly only 82–87 t per mission (⅓ of chemical)
  and the marginal launch cost is **electricity: 269 MWh ≈ tens of k$**.
- Amortization crossover vs LOX/LH₂ occurs at **N ≈ 146 missions**
  ((C_dev+C_infra) difference ÷ per-mission saving; engine cost model).
  Below that, the $27B infrastructure dominates; above it, $/kg falls toward
  ~$3–4k/kg and keeps falling with cadence.
- Solid cargo at 2,000 g is exactly the payload class this was invented for
  (O'Neill/Kolm); 285 m track, 3.34 km/s muzzle. TRL 3 — the long pole.
- Of the two driver variants, **driver + LOX/LH₂ kick** is preferred over
  driver + SEP tug at equal cadence: same thrown-mass class, 261 vs 621 days,
  one less new infrastructure (no tug fleet), and cheaper per kg in our model.

## Why not the others

| System | Verdict | Killer constraint |
|---|---|---|
| Methalox | ❌ for this route | CH₄ import: 22% of 247 t propellant at ~$50k/kg landed → $67k/kg delivered. Fine from Earth, wrong fuel for the Moon. |
| NTP | strong second (117 t wet, $20k/kg) | $12B development + nuclear-surface-launch policy + 259-day LH₂ storage. Becomes attractive if cargo value demands halved fleet mass. |
| NEP / Ion / Hall | niche | 610–630 day transit, kick stage still needed for ascent, $/kg worse than chemical here. Right tool for *outer*-planet cargo, not Mars. |
| Fusion ⚠ | not evaluable | TRL 1; included only to show even optimistic placeholder physics doesn't beat ISRU economics (He-3 propellant cost dominates). |

## Sensitivity caveats (from the engine)

- LOX/LH₂ $/kg moves ±33% with propellant price ×0.5/×2 — ISRU production
  cost is the single most important economic unknown.
- A 5% Isp shortfall costs +23.6 t wet mass (+10% propellant plant) — real
  but not architecture-changing.
- Wet mass scales benignly with cargo (+20% cargo → +20% wet): no cliff;
  the architecture is robust to payload growth.

## Bottom line

**Build the lunar LOX/LH₂ ISRU chain now and fly the two-stage tug; design
the propellant plant and pads so a mass driver can be added when demand
crosses ~150 missions.** The driver is not a competitor to chemical — it is
the amortization endgame that the chemical program's ISRU infrastructure
bootstraps.
