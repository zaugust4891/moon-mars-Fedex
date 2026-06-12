// Mission parameter editing: propulsion system, cargo mass, target orbit,
// propellant margin. Every change triggers full re-analysis in the Rust core.

import { useSim } from '../state/store';

export function ParameterPanel() {
  const { state, dispatch } = useSim();

  return (
    <div className="panel">
      <h3>Mission Parameters</h3>

      <label className="field">
        Propulsion system
        <select
          value={state.sysId}
          onChange={(e) => dispatch({ type: 'PARAM', patch: { sysId: Number(e.target.value) } })}
        >
          {state.results.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} {r.speculative ? '⚠' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Cargo mass: <b>{(state.cargoKg / 1000).toFixed(1)} t</b> (
        {Math.round(state.cargoKg * 2.20462).toLocaleString()} lb)
        <input
          type="range"
          min={10000}
          max={150000}
          step={1000}
          value={state.cargoKg}
          onChange={(e) => dispatch({ type: 'PARAM', patch: { cargoKg: Number(e.target.value) } })}
        />
      </label>

      <label className="field">
        Target orbit
        <select
          value={state.target}
          onChange={(e) => dispatch({ type: 'PARAM', patch: { target: Number(e.target.value) } })}
        >
          <option value={0}>500 km circular LMO (Δv-expensive, clean rendezvous)</option>
          <option value={1}>1-sol ellipse, 300 km periapsis (cheap capture)</option>
        </select>
      </label>

      <label className="field">
        Propellant margin: <b>{(state.margin * 100).toFixed(0)}%</b>
        <input
          type="range"
          min={0}
          max={0.2}
          step={0.01}
          value={state.margin}
          onChange={(e) => dispatch({ type: 'PARAM', patch: { margin: Number(e.target.value) } })}
        />
      </label>

      <div className="row">
        <button
          className={state.mode === 'mission' ? 'active' : ''}
          onClick={() => dispatch({ type: 'MODE', mode: 'mission' })}
        >
          Mission view
        </button>
        <button
          className={state.mode === 'compare' ? 'active' : ''}
          onClick={() => dispatch({ type: 'MODE', mode: 'compare' })}
        >
          Compare systems
        </button>
      </div>
    </div>
  );
}
