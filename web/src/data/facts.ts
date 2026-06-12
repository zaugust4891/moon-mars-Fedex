// Mission Intel: stage-triggered fact cards for Ride mode.
//
// Accuracy rules: every mission-specific number is read live from the engine
// outputs (Trajectory / MissionResult); general space/physics/history figures
// are established values. Facts fire once per playthrough; triggers are a mix
// of mission-time fractions, live distances/speeds and event windows.

import type { MissionResult, Trajectory } from '../engine/types';
import type { RideStats } from '../viz/rideMath';

export interface FactCtx {
  s: RideStats;
  traj: Trajectory;
  mr: MissionResult;
}

export type FactTag = 'PHYSICS' | 'ENGINEERING' | 'SPACE' | 'MISSION' | 'HISTORY' | 'MARS';

export interface Fact {
  id: string;
  tag: FactTag;
  /** Nominal trigger position as a fraction of transit; orders the backlog. */
  order: number;
  title: string;
  when(c: FactCtx): boolean;
  text(c: FactCtx): string;
}

const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const ft = (x: number) => `${(x / 1000).toFixed(1)} t`;
const AU = 1.495978707e8;

export const FACTS: Fact[] = [
  // ---------- departure ----------
  {
    id: 'moon-port',
    tag: 'SPACE',
    order: 0.001,
    title: 'Why ship from the Moon?',
    when: () => true,
    text: () =>
      'Escaping the Moon costs only ~2.4 km/s of Δv versus 11.2 km/s from Earth — a gravity ' +
      'well 22× shallower in energy terms. No atmosphere, 1/6 g, and oxygen locked in the ' +
      'regolith make it the solar system’s best loading dock for heavy cargo.',
  },
  {
    id: 'mass-driver',
    tag: 'ENGINEERING',
    order: 0.002,
    title: 'Thrown by electromagnets',
    when: (c) => c.mr.launcher != null,
    text: (c) => {
      const l = c.mr.launcher!;
      return (
        `Your cargo was accelerated along a ${(l.trackLengthM / 1000).toFixed(1)} km rail at ` +
        `${l.peakAccelG.toFixed(0)} g, leaving the muzzle at ${f2(l.muzzleVKms)} km/s. The shot ` +
        `drew ${f1(l.launchEnergyGj)} GJ, recharged at ${f1(l.rechargePowerMw)} MW. Only airless ` +
        'worlds allow this — in an atmosphere, drag would vaporize the payload.'
      );
    },
  },
  {
    id: 'oneill',
    tag: 'HISTORY',
    order: 0.004,
    title: 'O’Neill’s catapult',
    when: (c) => c.mr.launcher != null,
    text: () =>
      'Lunar mass drivers aren’t science fiction homework — Gerard O’Neill’s Princeton group ' +
      'built working bench-scale electromagnetic launchers in the late 1970s to prove the ' +
      'concept of exporting lunar material. The physics scaled then; only the funding didn’t.',
  },
  {
    id: 'regolith-lox',
    tag: 'ENGINEERING',
    order: 0.006,
    title: 'Mining oxygen from rock',
    when: (c) => c.mr.launcher == null,
    text: () =>
      'Lunar regolith is roughly 40% oxygen by mass, bound into oxides. Molten-salt ' +
      'electrolysis and hydrogen reduction can crack it out — which is why a lunar LOX plant ' +
      'is the keystone of any propellant economy up here: the heavy half of LOX/LH₂ never ' +
      'has to leave a gravity well at all.',
  },
  {
    id: 'tmi-oberth',
    tag: 'PHYSICS',
    order: 0.01,
    title: 'The Oberth effect',
    when: (c) => c.s.activeEvent != null && /injection/i.test(c.s.activeEvent.name),
    text: (c) =>
      `This ${f2(c.s.activeEvent?.dvKms ?? 0)} km/s injection burn fires deep in the gravity ` +
      'well on purpose: thrust applied at high orbital speed adds kinetic energy at a rate ' +
      'P = F·v. The same propellant spent in deep space would buy far less orbital energy — ' +
      'so engines always light at periapsis.',
  },
  {
    id: 'tsiolkovsky-history',
    tag: 'HISTORY',
    order: 0.02,
    title: '1903: a schoolteacher’s equation',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.015,
    text: () =>
      'Konstantin Tsiolkovsky — a self-taught, nearly deaf Russian schoolteacher — published ' +
      'the rocket equation in 1903, the same year the Wright Flyer hopped 37 meters. Every ' +
      'trajectory in this simulator still obeys the line he wrote in a village notebook: ' +
      'Δv = vₑ·ln(m₀/m₁).',
  },
  {
    id: 'free-speed',
    tag: 'PHYSICS',
    order: 0.03,
    title: 'Most of your speed was free',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.025,
    text: (c) =>
      `You are doing ${f1(c.s.speedKms)} km/s around the Sun, but the engines only supplied a ` +
      `departure excess of ${f2(c.mr.budget.vinfDep)} km/s. The other ~30 km/s is Earth’s own ` +
      'orbital velocity, inherited at departure. Interplanetary flight is mostly clever ' +
      'borrowing, not brute force.',
  },
  {
    id: 'whipple',
    tag: 'ENGINEERING',
    order: 0.045,
    title: 'Armor made of nothing',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.04,
    text: () =>
      'The thin standoff panels on this stack are Whipple shields: a sacrificial outer sheet ' +
      'shocks an incoming micrometeoroid into vapor, and the debris cloud spreads before it ' +
      'reaches the wall — centimeters of spacing outperform solid armor at a fraction of the ' +
      'mass. Invented by Fred Whipple in 1947, flown on everything since.',
  },
  {
    id: 'patched-conics',
    tag: 'PHYSICS',
    order: 0.06,
    title: 'Patched conics & the N-body truth',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.05,
    text: (c) => {
      const dev = c.traj.nbody
        ? ` Integrating the full Sun–Earth–Moon–Mars force field (RKF45) lands ${(
            c.traj.nbody.deviationKm / 1e3
          ).toFixed(0)}k km from the analytic point over the whole transfer — the orange ghost ` +
          'path in the classic view, and the reason real missions carry midcourse propellant.'
        : ' Real navigation integrates every body’s pull and corrects the difference en route.';
      return (
        'This sim hands you from the Moon’s sphere of influence to the Sun’s — Earth’s SOI ' +
        'ends ~0.93 million km out. Inside each region only one body’s gravity is solved; ' +
        'the trick has guided every interplanetary mission since Mariner.' + dev
      );
    },
  },
  {
    id: 'mariner4',
    tag: 'HISTORY',
    order: 0.08,
    title: '1965: 21 grainy pictures',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.07,
    text: () =>
      'Mariner 4 made the first Mars flyby in July 1965 and radioed home 21 pictures at 8⅓ ' +
      'bits per second — each frame took about ten hours. Engineers hand-colored a printout ' +
      'of the raw numbers because they couldn’t wait for the processor. You are flying the ' +
      'route it scouted.',
  },
  {
    id: 'speed-scale',
    tag: 'SPACE',
    order: 0.1,
    title: 'How fast is fast?',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.09,
    text: (c) =>
      `At your current ${f1(c.s.speedKms)} km/s you would cross the continental US in ` +
      `${Math.round(4500 / c.s.speedKms)} seconds. The ISS orbits at 7.7 km/s; Voyager 1, the ` +
      'fastest outbound human object, coasts at ~17 km/s. Heliocentric travelers are fast ' +
      'because they keep their planet’s orbital speed and add to it.',
  },
  {
    id: 'gravity-assist',
    tag: 'PHYSICS',
    order: 0.13,
    title: 'Stealing speed from planets',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.11,
    text: () =>
      'This route buys speed with propellant, but there’s another currency: a gravity assist ' +
      'trades momentum with a planet itself. Voyager 2 chained four of them to tour the outer ' +
      'planets — the planet slows by an immeasurable hair, the spacecraft gains kilometers ' +
      'per second. Momentum is conserved; nobody audits Jupiter.',
  },
  {
    id: 'hohmann',
    tag: 'PHYSICS',
    order: 0.16,
    title: 'The minimum-energy ellipse',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.13,
    text: (c) =>
      `Your path is a Hohmann-class transfer: an ellipse tangent to Earth’s orbit at departure ` +
      `and Mars’s at arrival — the cheapest two-impulse route. It takes ${f1(c.traj.tofDays)} days, ` +
      `required Mars to lead Earth by ${f1(c.traj.leadAngleDeg)}°, and that geometry repeats only ` +
      `every ${f1(c.traj.synodicDays)} days. Miss the window, wait ~26 months.`,
  },
  {
    id: 'hohmann-history',
    tag: 'HISTORY',
    order: 0.18,
    title: 'Drawn in 1925, flown ever since',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.16,
    text: () =>
      'Walter Hohmann was a city architect in Essen who worked out minimum-energy transfer ' +
      'ellipses as an evening hobby and published them in 1925 — decades before anything ' +
      'could fly one. Every Mars probe, including this cargo run, follows the curve a ' +
      'building inspector drew between the wars.',
  },
  {
    id: 'light-delay',
    tag: 'SPACE',
    order: 0.22,
    title: 'Nobody is flying this thing',
    when: (c) => c.s.lightDelayS > 60,
    text: (c) =>
      `Radio from Earth now takes ${(c.s.lightDelayS / 60).toFixed(1)} minutes one way ` +
      '— a joystick command would arrive long after the moment had passed. Beyond the ' +
      'Moon, every spacecraft must fly itself; ground control sends intentions, not inputs.',
  },
  {
    id: 'sunlight-age',
    tag: 'PHYSICS',
    order: 0.25,
    title: 'The light here is old',
    when: (c) => c.s.rSunKm > 1.12 * AU,
    text: (c) =>
      `The sunlight on your hull left the photosphere ${(c.s.rSunKm / 299792.458 / 60).toFixed(1)} ` +
      'minutes ago — but the energy in it began as gamma rays in the core perhaps 100,000 ' +
      'years before that, random-walking out through the Sun’s plasma a few centimeters at a ' +
      'time. The last leg of its trip is the fast part.',
  },
  {
    id: 'tsiolkovsky',
    tag: 'PHYSICS',
    order: 0.3,
    title: 'The tyranny of the rocket equation',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.27 && !c.traj.lowThrust,
    text: (c) => {
      const ve = (c.mr.ispS * 9.80665) / 1000;
      return (
        `Δv = vₑ·ln(m₀/m₁). Your engines exhaust at ${f2(ve)} km/s (Isp ${Math.round(
          c.mr.ispS,
        )} s), so delivering ${ft(c.mr.cargoKg)} of cargo meant lifting off the Moon at ` +
        `${ft(c.mr.wetMassKg)} — propellant is ${Math.round(
          (c.mr.propMassKg / c.mr.wetMassKg) * 100,
        )}% of the stack. Mass ratios are exponential; that’s the whole game.`
      );
    },
  },
  {
    id: 'ep-whisper',
    tag: 'ENGINEERING',
    order: 0.32,
    title: 'Thrust you could not feel',
    when: (c) => c.traj.lowThrust && c.s.tDays > c.traj.transitDays * 0.2,
    text: (c) =>
      `Electric propulsion trades force for efficiency: Isp ${Math.round(c.mr.ispS)} s — several ` +
      'times any chemical engine — but thrust comparable to the weight of a few coins in ' +
      `your palm. Hence the long spiral: ${Math.round(c.mr.transitDays)} days in transit, the ` +
      'engines humming for months while solar or nuclear power does the real work.',
  },
  {
    id: 'ion-history',
    tag: 'HISTORY',
    order: 0.34,
    title: 'From lab curiosity to workhorse',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.31,
    text: () =>
      'Deep Space 1 (1998) was the first spacecraft to cruise on ion propulsion; Dawn then ' +
      'used it to orbit two different worlds — Vesta and Ceres — racking up over 11 km/s of ' +
      'Δv, the most any spacecraft has produced. Hundreds of Hall thrusters now fly on ' +
      'commercial satellites. The future arrived quietly, at 90 millinewtons.',
  },
  {
    id: 'mli',
    tag: 'ENGINEERING',
    order: 0.37,
    title: 'The gold foil isn’t gold',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.34,
    text: () =>
      'The amber wrap on the tankage is multi-layer insulation: dozens of aluminized polymer ' +
      'sheets, each reflecting heat radiation back the way it came. In vacuum — no air to ' +
      'conduct — twenty grams per square meter of crinkled film outperforms a brick of ' +
      'foam. The crinkles are functional: they minimize layer-to-layer contact.',
  },
  {
    id: 'radiation',
    tag: 'SPACE',
    order: 0.42,
    title: 'The quiet sleet of cosmic rays',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.38,
    text: () =>
      'Curiosity’s RAD instrument measured ~1.8 mSv per day during its cruise to Mars — ' +
      'hundreds of times the dose rate on Earth’s surface. Your solid cargo doesn’t care; ' +
      'astronauts would. That asymmetry is exactly why heavy freight flies separately, ' +
      'and ahead of, any crew.',
  },
  {
    id: 'polyakov',
    tag: 'HISTORY',
    order: 0.45,
    title: '437 days, on purpose',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.42,
    text: (c) =>
      `Physician-cosmonaut Valeri Polyakov stayed aboard Mir for 437 consecutive days in ` +
      `1994–95 — longer than this ${Math.round(c.mr.transitDays)}-day cargo transit — largely to ` +
      'prove a human could arrive at Mars functional. He walked from his capsule on landing, ' +
      'by his own insistence.',
  },
  {
    id: 'midcourse',
    tag: 'MISSION',
    order: 0.5,
    title: 'A nudge at the halfway mark',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.48,
    text: (c) =>
      `The midcourse correction budgeted here is just ${f2(
        c.mr.budget.midcourse,
      )} km/s — under 2% of the mission total — yet it erases injection errors that would ` +
      'otherwise miss Mars by thousands of km. This sim’s 500-run Monte Carlo dispersion ' +
      'analysis sized exactly such margins.',
  },
  {
    id: 'iss-25',
    tag: 'SPACE',
    order: 0.53,
    title: 'A quarter century without a gap',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.5,
    text: () =>
      'Humans have lived continuously off-planet since November 2000 — over 25 years of ' +
      'uninterrupted habitation aboard the ISS. Every logistics lesson in this cargo ' +
      'architecture — pre-positioning, autonomous rendezvous, propellant margins — was ' +
      'learned 400 km overhead, one resupply flight at a time.',
  },
  {
    id: 'solar-fade',
    tag: 'PHYSICS',
    order: 0.58,
    title: 'The Sun, dimmed by square law',
    when: (c) => c.s.rSunKm > 1.25 * AU,
    text: (c) =>
      `Sunlight here delivers ${Math.round(c.s.solarWm2)} W/m² — ${Math.round(
        (c.s.solarWm2 / 1361) * 100,
      )}% of the 1361 W/m² at Earth. By Mars it drops to ~43%. Inverse-square attenuation is ` +
      'why Mars-bound solar arrays are oversized, and why missions past Jupiter go nuclear.',
  },
  {
    id: 'aerogel',
    tag: 'ENGINEERING',
    order: 0.6,
    title: 'Solid smoke',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.56,
    text: () =>
      'Aerogel — a silica lattice that is 99%+ empty space — is the lightest solid ever made ' +
      'and one of the best insulators known. Stardust used a block of it to catch comet dust ' +
      'intact at 6 km/s; Mars rovers use it to keep their electronics warm through −90 °C ' +
      'nights. Materials science is half of spaceflight.',
  },
  {
    id: 'nerva',
    tag: 'HISTORY',
    order: 0.63,
    title: 'The nuclear engine that worked',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.6 && /nuclear thermal/i.test(c.mr.name),
    text: () =>
      'Your propulsion class flew — on a test stand. NERVA reactors fired for hours in the ' +
      'Nevada desert through 1972, hitting ~850 s of Isp, roughly double the best chemical ' +
      'engines. The program was cancelled with the Mars plans it was built for; the physics ' +
      'has been waiting ever since.',
  },
  {
    id: 'odometer',
    tag: 'SPACE',
    order: 0.66,
    title: '100 million kilometers, engines off',
    when: (c) => c.s.odoKm > 1e8,
    text: () =>
      'Your odometer just passed 100,000,000 km — almost all of it coasting. An orbit is ' +
      'free travel: after the injection burn, gravity alone carries the cargo along the ' +
      'ellipse. Spacecraft don’t cruise like aircraft; they fall, very precisely, for months.',
  },
  {
    id: 'cryo',
    tag: 'ENGINEERING',
    order: 0.72,
    title: 'Keeping hydrogen at 20 kelvin',
    when: (c) =>
      c.s.tDays > c.traj.tofDays * 0.68 && c.mr.risks.some((r) => /LH2|boiloff/i.test(r)),
    text: (c) =>
      `The arrival burn’s liquid hydrogen has now been kept at ~20 K for ${Math.round(
        c.s.tDays,
      )} days. Without sunshades and zero-boiloff cryocoolers it would have evaporated long ` +
      'ago — long-duration cryo storage is one of the quiet enabling technologies of this ' +
      'architecture, and one of its flagged risks.',
  },
  {
    id: 'cost',
    tag: 'MISSION',
    order: 0.75,
    title: 'The freight bill',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.7,
    text: (c) =>
      `This architecture works out to ~$${Math.round(c.mr.cost.usdPerKg).toLocaleString(
        'en-US',
      )}/kg delivered to Mars orbit (amortized over ${c.mr.cost.nAmort} missions). For scale: ` +
      'launch to low Earth orbit alone historically ran $10–20k/kg before reusable boosters. ' +
      'Every kilogram of margin you don’t carry is money.',
  },
  {
    id: 'conjunction',
    tag: 'PHYSICS',
    order: 0.78,
    title: 'Why everything launches at once',
    when: (c) => c.s.tDays > c.traj.tofDays * 0.74,
    text: (c) =>
      `Because the transfer window recurs only every ${f1(c.traj.synodicDays / 30.4)} months, ` +
      'real Mars campaigns launch in fleets — 2020 saw three missions (Hope, Tianwen-1, ' +
      'Perseverance) leave within eleven days of each other. Orbital mechanics, not ' +
      'competition, sets the starting gun.',
  },
  {
    id: 'phobos',
    tag: 'MARS',
    order: 0.82,
    title: 'The moon that outruns its sky',
    when: (c) => c.s.distMarsKm < 3e7,
    text: () =>
      'Phobos orbits Mars in 7 h 39 m — faster than Mars rotates — so from the surface it ' +
      'rises in the WEST and sets in the east twice a day. It’s also spiraling inward a few ' +
      'centimeters a year; in ~50 million years Mars gets a ring. Deimos, the outer moon, ' +
      'is barely 12 km across.',
  },
  {
    id: 'olympus',
    tag: 'MARS',
    order: 0.86,
    title: 'A volcano the size of France',
    when: (c) => c.s.distMarsKm < 1.5e7,
    text: () =>
      'Olympus Mons ahead is ~22 km tall — two and a half Everests — with a footprint the ' +
      'size of France and cliffs at its rim taller than most mountains on Earth. Its slope ' +
      'is so gentle you could drive up without noticing; you’d just be above most of the ' +
      'atmosphere when you arrived.',
  },
  {
    id: 'mars-atmo',
    tag: 'MARS',
    order: 0.9,
    title: 'A sky 0.6% as thick',
    when: (c) => c.s.distMarsKm < 1e7,
    text: () =>
      'Mars’s atmosphere is 95% CO₂ at ~0.6% of Earth’s surface pressure — too thin to ' +
      'breathe or to parachute heavy cargo safely, but thick enough to burn up an unshielded ' +
      'arrival and to host planet-circling dust storms (one ended Opportunity in 2018). Its ' +
      'sunsets glow blue: fine dust scatters red light away from the disc.',
  },
  {
    id: 'mars-approach',
    tag: 'MISSION',
    order: 0.93,
    title: 'No brakes but rocket brakes',
    when: (c) => c.s.distMarsKm < 8e6 && !c.s.inOrbit,
    text: (c) =>
      `Mars is ${(c.s.distMarsKm / 1e6).toFixed(1)}M km ahead and you’ll meet it carrying ` +
      `${f2(c.mr.budget.vinfArr)} km/s of excess speed. Do nothing and you whip past into ` +
      `permanent solar orbit. The insertion burn must shed ${f2(c.mr.budget.moi)} km/s — ` +
      'there is exactly one chance to get it right.',
  },
  {
    id: 'skycrane',
    tag: 'HISTORY',
    order: 0.95,
    title: 'Seven minutes of terror',
    when: (c) => c.s.distMarsKm < 5e6,
    text: () =>
      'Every Mars landing is autonomous — light delay forbids joysticks. Curiosity’s 2012 ' +
      'arrival ran 500,000 lines of code through entry, a supersonic parachute, and a ' +
      'rocket crane that lowered the rover on cables, then flew away to crash on purpose. ' +
      'Your cargo’s orbital handoff is gentle by comparison.',
  },
  {
    id: 'moi-flip',
    tag: 'PHYSICS',
    order: 0.985,
    title: 'Flying backwards, on purpose',
    when: (c) => c.s.activeEvent != null && /insertion|capture/i.test(c.s.activeEvent.name),
    text: (c) =>
      `That flip wasn’t a glitch: to decelerate, the stack points its engines into the ` +
      `direction of travel. The capture burn fires at periapsis — Oberth again, in reverse — ` +
      `where each m/s of Δv removes the most orbital energy${
        c.traj.arrival.rPeri
          ? `, just ${Math.round(c.traj.arrival.rPeri - c.traj.arrival.rBody).toLocaleString(
              'en-US',
            )} km above the surface`
          : ''
      }.`,
  },
  {
    id: 'mars-exploration',
    tag: 'MARS',
    order: 1.0,
    title: 'The robot census',
    when: (c) => c.s.inOrbit,
    text: () =>
      'Mars is the only planet we know of inhabited entirely by robots: from Sojourner ' +
      '(1997, 11.5 kg, the size of a microwave) to Perseverance and the Ingenuity ' +
      'helicopter — which flew 72 times in air 1% as dense as Earth’s, the first powered ' +
      'flight on another world. Your cargo joins a very exclusive neighborhood.',
  },
  {
    id: 'rendezvous-ballet',
    tag: 'MISSION',
    order: 1.02,
    title: 'Orbital rendezvous is weird',
    when: (c) => c.s.inOrbit && c.s.tDays > c.traj.tofDays + 0.4,
    text: () =>
      'The interceptor closing in can’t just thrust toward you: speeding up raises its orbit ' +
      'and makes it drift BACKWARD relative to the target. Rendezvous is flown sideways, in ' +
      'orbital phase space — a lesson Gemini astronauts had to unlearn from fighter-pilot ' +
      'instinct in 1965 before any docking could succeed.',
  },
  {
    id: 'delivered',
    tag: 'MISSION',
    order: 1.05,
    title: 'Cargo delivered',
    when: (c) => c.s.inOrbit && c.s.tDays > c.traj.tofDays + 0.8,
    text: (c) =>
      `${ft(c.mr.cargoKg)} of cargo is parked in a stable Mars orbit, captured by the ` +
      'interceptor — final closing speeds under a few m/s. Below: a day lasting 24 h 37 m, ' +
      'gravity at 0.38 g, and sunsets that glow blue. Delivery complete.',
  },
];

/**
 * All unseen facts whose predicate currently holds, oldest nominal stage
 * first. Caller queues them; on big time scrubs it may trim the backlog.
 */
export function matchFacts(c: FactCtx, seen: ReadonlySet<string>): Fact[] {
  return FACTS.filter((f) => !seen.has(f.id) && f.when(c)).sort((a, b) => a.order - b.order);
}
