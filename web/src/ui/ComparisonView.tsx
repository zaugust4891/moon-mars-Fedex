// Side-by-side propulsion comparison: full metrics table plus SVG bar charts
// for wet mass, transit time, and cost per delivered kilogram.

import { fmtMass, fmtPower, useSim } from '../state/store';
import type { MissionResult } from '../engine/types';

function Bars({
  title,
  results,
  value,
  fmt,
  color,
}: {
  title: string;
  results: MissionResult[];
  value: (r: MissionResult) => number;
  fmt: (v: number) => string;
  color: string;
}) {
  const max = Math.max(...results.map(value), 1e-9);
  return (
    <div className="bars">
      <h4>{title}</h4>
      {results.map((r) => (
        <div key={r.id} className="bar-row" title={r.name}>
          <span className="bar-label">{r.name.replace(/\s*\(.*\)/, '')}</span>
          <svg width="100%" height="14">
            <rect
              x="0" y="2" height="10" rx="2"
              width={`${(value(r) / max) * 100}%`}
              fill={r.feasible ? color : '#553'}
              opacity={r.speculative ? 0.45 : 0.95}
            />
          </svg>
          <span className="bar-value mono">{fmt(value(r))}</span>
        </div>
      ))}
    </div>
  );
}

export function ComparisonView() {
  const { state, dispatch } = useSim();
  const rs = state.results;
  if (rs.length === 0) return null;

  return (
    <div className="panel compare">
      <h3>Propulsion comparison — {(state.cargoKg / 1000).toFixed(1)} t cargo, {state.target === 0 ? '500 km LMO' : '1-sol ellipse'}</h3>
      <div className="charts">
        <Bars title="Wet mass off the lunar surface" results={rs} value={(r) => r.wetMassKg} fmt={fmtMass} color="#66e0ff" />
        <Bars title="Transit time" results={rs} value={(r) => r.transitDays} fmt={(v) => `${v.toFixed(0)} d`} color="#ffd34d" />
        <Bars title="Cost per delivered kg (20-mission amortization)" results={rs} value={(r) => r.cost.usdPerKg} fmt={(v) => `$${Math.round(v).toLocaleString()}`} color="#7dde9a" />
      </div>

      <table className="cmp-table">
        <thead>
          <tr>
            <th>System</th><th>Feas.</th><th>Isp (s)</th><th>Δv (km/s)</th><th>Wet</th><th>Prop</th>
            <th>Transit</th><th>Peak g</th><th>Power</th><th>Energy</th><th>$/kg</th><th>TRL</th>
          </tr>
        </thead>
        <tbody>
          {rs.map((r) => (
            <tr
              key={r.id}
              className={r.id === state.sysId ? 'sel' : ''}
              onClick={() => dispatch({ type: 'PARAM', patch: { sysId: r.id } })}
            >
              <td>{r.name}{r.speculative ? ' ⚠' : ''}</td>
              <td>{r.feasible ? '✅' : '❌'}</td>
              <td className="mono">{r.ispS.toFixed(0)}</td>
              <td className="mono">
                {r.totalDvKms.toFixed(2)}{r.kineticDvKms > 0 ? ` +${r.kineticDvKms.toFixed(2)}k` : ''}
              </td>
              <td className="mono">{fmtMass(r.wetMassKg)}</td>
              <td className="mono">{fmtMass(r.propMassKg)}</td>
              <td className="mono">{r.transitDays.toFixed(0)} d</td>
              <td className="mono">{r.peakAccelG.toFixed(1)}</td>
              <td className="mono">{fmtPower(r.powerKw)}</td>
              <td className="mono">{r.energyGj.toFixed(0)} GJ</td>
              <td className="mono">${Math.round(r.cost.usdPerKg).toLocaleString()}</td>
              <td className="mono">{r.trl}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {state.sens.length > 0 && (
        <>
          <h4>Sensitivity — {state.selected?.name}</h4>
          <table className="cmp-table">
            <thead>
              <tr><th>Parameter</th><th>Low</th><th>Wet</th><th>$/kg</th><th>High</th><th>Wet</th><th>$/kg</th></tr>
            </thead>
            <tbody>
              {state.sens.map((s) => (
                <tr key={s.param}>
                  <td>{s.param}</td>
                  <td className="mono">{s.lowLabel}</td>
                  <td className="mono">{fmtMass(s.wetLow)}</td>
                  <td className="mono">${Math.round(s.costLow).toLocaleString()}</td>
                  <td className="mono">{s.highLabel}</td>
                  <td className="mono">{fmtMass(s.wetHigh)}</td>
                  <td className="mono">${Math.round(s.costHigh).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="note">
        Click a row to load that system in mission view. ⚠ = speculative technology — placeholder
        figures, see docs/02. Cost model assumptions in docs/10.
      </p>
    </div>
  );
}
