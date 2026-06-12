// Engineering metrics for the selected propulsion system: Δv budget, masses,
// stages, power/energy, cost, risks. All values computed in sim-core.

import { fmtMass, fmtPower, useSim } from '../state/store';

export function MetricsPanel() {
  const { state } = useSim();
  const r = state.selected;
  if (!r) return null;
  const b = r.budget;

  return (
    <div className="panel metrics">
      <h3>
        {r.name}{' '}
        {r.feasible ? (
          <span className="ok">FEASIBLE</span>
        ) : (
          <span className="bad">INFEASIBLE</span>
        )}
        {r.speculative && <span className="warn"> SPECULATIVE</span>}
      </h3>
      {!r.feasible && <p className="bad">{r.reasons.join('; ')}</p>}

      <table>
        <tbody>
          <tr><td>Total Δv (propulsive)</td><td className="mono">{r.totalDvKms.toFixed(2)} km/s</td></tr>
          {r.kineticDvKms > 0 && (
            <tr><td>Δv supplied kinetically</td><td className="mono">{r.kineticDvKms.toFixed(2)} km/s</td></tr>
          )}
          <tr><td>Wet mass (flight system)</td><td className="mono">{fmtMass(r.wetMassKg)}</td></tr>
          <tr><td>Propellant</td><td className="mono">{fmtMass(r.propMassKg)}</td></tr>
          <tr><td>Dry mass (non-cargo)</td><td className="mono">{fmtMass(r.dryMassKg)}</td></tr>
          <tr><td>Cargo</td><td className="mono">{fmtMass(state.cargoKg)}</td></tr>
          <tr><td>Transit time</td><td className="mono">{r.transitDays.toFixed(0)} days</td></tr>
          <tr><td>Peak acceleration</td><td className="mono">{r.peakAccelG.toFixed(1)} g</td></tr>
          <tr><td>Power</td><td className="mono">{fmtPower(r.powerKw)}</td></tr>
          <tr><td>Energy</td><td className="mono">{r.energyGj.toFixed(0)} GJ</td></tr>
          <tr><td>Cost / delivered kg</td><td className="mono">${Math.round(r.cost.usdPerKg).toLocaleString()}</td></tr>
          <tr><td>Per-mission cost</td><td className="mono">${r.cost.perMissionMusd.toFixed(0)} M</td></tr>
        </tbody>
      </table>

      <h4>Δv budget (unmargined)</h4>
      <table>
        <tbody>
          <tr><td>Lunar ascent</td><td className="mono">{b.ascent.toFixed(3)} km/s</td></tr>
          <tr><td>Trans-Mars injection</td><td className="mono">{b.tmi.toFixed(3)} km/s</td></tr>
          <tr><td>Midcourse / plane change</td><td className="mono">{b.midcourse.toFixed(3)} km/s</td></tr>
          <tr><td>Mars orbit insertion</td><td className="mono">{b.moi.toFixed(3)} km/s</td></tr>
          <tr><td>Rendezvous</td><td className="mono">{b.rendezvous.toFixed(3)} km/s</td></tr>
          <tr><td><b>Total</b></td><td className="mono"><b>{b.total.toFixed(3)} km/s</b></td></tr>
          <tr><td>v∞ departure / arrival</td><td className="mono">{b.vinfDep.toFixed(2)} / {b.vinfArr.toFixed(2)} km/s</td></tr>
          <tr><td>Window every</td><td className="mono">{b.synodicDays.toFixed(0)} d (lead {b.leadAngleDeg.toFixed(1)}°)</td></tr>
        </tbody>
      </table>

      <h4>Stages</h4>
      {r.stages.map((s) => (
        <div key={s.name} className="stage">
          <b>{s.name}</b>
          <span className="mono">
            {fmtMass(s.propKg)} prop · {fmtMass(s.dryKg)} dry · {s.engines}× engine ·{' '}
            {s.thrustN >= 1000 ? `${(s.thrustN / 1000).toFixed(0)} kN` : `${s.thrustN.toFixed(1)} N`}
          </span>
        </div>
      ))}

      {state.traj?.nbody && (
        <p className="note">
          Patched-conic vs N-body arrival deviation:{' '}
          <b>{(state.traj.nbody.deviationKm / 1e6).toFixed(2)}M km</b> (along-track timing;
          absorbed by departure targeting — see docs/09)
        </p>
      )}

      {state.mc && (
        <>
          <h4>Monte Carlo (n={state.mc.n})</h4>
          <p className="mono small">
            feasible {(state.mc.feasibleFrac * 100).toFixed(1)}% · wet p5/p50/p95:{' '}
            {fmtMass(state.mc.wetP5)} / {fmtMass(state.mc.wetP50)} / {fmtMass(state.mc.wetP95)}
          </p>
        </>
      )}

      {r.risks.length > 0 && (
        <>
          <h4>Risks</h4>
          <ul>{r.risks.map((x) => <li key={x}>{x}</li>)}</ul>
        </>
      )}
      <h4>Assumptions</h4>
      <ul>{r.assumptions.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}
