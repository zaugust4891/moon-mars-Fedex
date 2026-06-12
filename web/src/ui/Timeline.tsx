// Mission timeline: phase/burn events on a scrubber bar plus the fuel gauge.

import { useSim } from '../state/store';
import type { Pt } from '../engine/types';

function fuelAt(fuel: Pt[], t: number): number {
  let f = 1;
  for (const [ft, fv] of fuel) {
    if (ft <= t) f = fv;
    else break;
  }
  return f;
}

export function Timeline() {
  const { state, dispatch } = useSim();
  const t = state.traj;
  if (!t) return null;
  const end = t.tEndDays;
  const fuel = fuelAt(t.fuel, state.tDays);
  const active = t.events.find(
    (ev) => state.tDays >= ev.tDays && state.tDays <= ev.tDays + Math.max(ev.durationS / 86400, 0.5),
  );

  return (
    <div className="panel timeline">
      <div className="tl-bar" onClick={(e) => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        dispatch({ type: 'SET_TIME', tDays: ((e.clientX - rect.left) / rect.width) * end });
      }}>
        <div className="tl-progress" style={{ width: `${(state.tDays / end) * 100}%` }} />
        {t.events.map((ev) => (
          <div
            key={`${ev.name}-${ev.tDays}`}
            className={`tl-event tl-${ev.kind}`}
            style={{ left: `${(ev.tDays / end) * 100}%` }}
            title={`${ev.name} — T+${ev.tDays.toFixed(1)}d${ev.dvKms ? `, Δv ${ev.dvKms.toFixed(2)} km/s` : ''}`}
          />
        ))}
      </div>
      <div className="row tl-info">
        <span className="mono">
          {active ? `▸ ${active.name}` : t.tofDays > state.tDays ? 'Cruise' : 'In Mars orbit'}
        </span>
        <span className="fuel">
          Propellant
          <span className="fuel-bar"><span style={{ width: `${fuel * 100}%` }} /></span>
          <span className="mono">{(fuel * 100).toFixed(0)}%</span>
        </span>
      </div>
    </div>
  );
}
